// Test de structure de l'isolation par organisation — ADR-0052 critère 17 (lot O6).
//
// Toute collection de données client porte un `organizationId` OBLIGATOIRE : c'est
// la clé de chaque filtre d'isolation (docs/17). Le test parcourt les modèles
// Mongoose RÉELLEMENT enregistrés par l'application, et non une liste tenue à la
// main : une collection ajoutée demain sans `organizationId` fait échouer le test,
// sauf à être inscrite, avec sa raison, dans l'une des deux listes ci-dessous.
//
// Il recoupe aussi le code source : chaque nom de collection écrit en dur dans
// `apps/api/src` (`@Schema({ collection: … })`, accès direct au pilote) doit être
// celui d'un modèle enregistré ou d'une collection de better-auth. Un schéma déclaré
// mais jamais enregistré échapperait sinon au premier contrôle.

import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { e2eSuite, makeE2EApp, teardown } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

/**
 * Collections de portée UTILISATEUR ou PLATEFORME, sans `organizationId` à juste
 * titre (ADR-0052 § Audit). Chaque entrée dit pourquoi.
 */
const SANS_ORGANISATION: Readonly<Record<string, string>> = {
  // better-auth : identité et sessions, propres à la personne, pas à une société.
  user: 'compte de la personne (better-auth)',
  session: 'session de connexion (better-auth)',
  account: 'moyen de connexion de la personne (better-auth)',
  verification: 'jetons de vérification (better-auth)',
  // Espace compte : réglages et traces de la PERSONNE, valables dans toutes ses sociétés.
  user_preferences: 'préférences de présentation de la personne (ADR-0052 F6)',
  user_avatars: 'photo de profil de la personne',
  email_change_requests: "changement d'adresse de connexion de la personne",
  terms_acceptances: 'preuve d’acceptation des conditions par la personne',
  // Plateforme : rôles et réauthentification des opérateurs Lalanda, hors de toute société.
  platform_roles: 'rôles des opérateurs de la plateforme',
  platform_reauth: 'réauthentification des opérateurs de la plateforme',
  // ADR-0053 — P4 : l'organisation visée est `targetOrganizationId`, jamais une clé de locataire.
  platform_feature_overrides: 'dérogations de fonctionnalité accordées par la plateforme',
  // La société elle-même : c'est l'`_id` qui sert de clé, pas un `organizationId`.
  organizations: "l'organisation elle-même (son _id est la clé)",
  // Ordonnanceur : verrous de tâches qui parcourent toutes les organisations.
  scheduled_jobs: 'verrous des tâches planifiées, toutes organisations',
  // Référentiels publics, identiques pour toutes les sociétés.
  edef_reference_snapshots: 'référentiel public e-MCF de la DGI',
  accounting_chart_packs: 'plans comptables SYSCOHADA publiés (référentiel)',
};

/**
 * Collections dont `organizationId` existe mais peut valoir `null` : une ligne y est
 * tantôt d'une société, tantôt de la plateforme. Le champ doit exister.
 */
const ORGANISATION_FACULTATIVE: Readonly<Record<string, string>> = {
  integrations: 'portée plateforme en v1 (ADR-0013 § 1) : organizationId null',
  payment_events: 'rappel de paiement non rattachable à une organisation : null',
  edef_exchanges: 'journal e-MCF : les lectures de référentiel ne sont d’aucune société',
};

/** Collections de better-auth : pas de modèle Mongoose, l'adaptateur les écrit. */
const BETTER_AUTH = new Set(['user', 'session', 'account', 'verification']);

/** Noms de collection écrits en dur dans le code de l'API, hors tests. */
function collectionsDuSource(): Map<string, string> {
  const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const trouvees = new Map<string, string>();
  const motifs = [
    /\bcollection:\s*['"]([a-z][a-z0-9_]*)['"]/g,
    /\.collection\(\s*['"]([a-z][a-z0-9_]*)['"]/g,
  ];
  const parcourir = (dossier: string): void => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (entree.name !== '__tests__') parcourir(chemin);
        continue;
      }
      if (!entree.name.endsWith('.ts') || entree.name.endsWith('.test.ts')) continue;
      const texte = readFileSync(chemin, 'utf8');
      for (const motif of motifs) {
        for (const m of texte.matchAll(motif)) {
          if (!trouvees.has(m[1]!)) trouvees.set(m[1]!, chemin.slice(racine.length + 1));
        }
      }
    }
  };
  parcourir(racine);
  return trouvees;
}

e2eSuite('collections et organizationId (ADR-0052 critère 17)', () => {
  let app: INestApplication;
  let connection: Connection;

  beforeAll(async () => {
    app = await makeE2EApp();
    connection = app.get<Connection>(getConnectionToken());
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await teardown(app, []);
  }, E2E_HOOK_TIMEOUT_MS);

  const modeles = () =>
    Object.values(connection.models).map((m) => ({
      collection: m.collection.collectionName,
      modele: m.modelName,
      champ: m.schema.path('organizationId') as
        { instance: string; isRequired?: boolean } | undefined,
    }));

  it('parcourt bien l’ensemble des modèles de l’application', () => {
    // Garde-fou du test lui-même : si l'enregistrement des modèles changeait de
    // connexion, on parcourrait une liste vide et tout passerait au vert.
    expect(modeles().length).toBeGreaterThan(100);
  });

  it('chaque collection de données client porte un organizationId obligatoire', () => {
    const fautes: string[] = [];
    for (const { collection, modele, champ } of modeles()) {
      if (collection in SANS_ORGANISATION) continue;
      if (!champ) {
        fautes.push(`${collection} (${modele}) : aucun champ organizationId`);
        continue;
      }
      if (champ.instance !== 'String') {
        fautes.push(`${collection} (${modele}) : organizationId de type ${champ.instance}`);
      }
      if (!champ.isRequired && !(collection in ORGANISATION_FACULTATIVE)) {
        fautes.push(`${collection} (${modele}) : organizationId facultatif`);
      }
    }
    expect(fautes, 'ajouter organizationId, ou justifier une exception ici').toEqual([]);
  });

  it('les exceptions sont à jour : chacune existe et n’a vraiment pas d’organisation', () => {
    const parCollection = new Map(modeles().map((m) => [m.collection, m]));
    const perimees: string[] = [];
    for (const nom of Object.keys(SANS_ORGANISATION)) {
      const m = parCollection.get(nom);
      if (!m && !BETTER_AUTH.has(nom)) perimees.push(`${nom} : collection inconnue`);
      if (m?.champ) perimees.push(`${nom} : porte organizationId, à retirer des exceptions`);
    }
    for (const nom of Object.keys(ORGANISATION_FACULTATIVE)) {
      const m = parCollection.get(nom);
      if (!m) perimees.push(`${nom} : collection inconnue`);
      else if (!m.champ) perimees.push(`${nom} : aucun champ organizationId`);
      else if (m.champ.isRequired) perimees.push(`${nom} : organizationId déjà obligatoire`);
    }
    expect(perimees).toEqual([]);
  });

  it('toute collection nommée dans le code est un modèle enregistré ou de better-auth', () => {
    const enregistrees = new Set(modeles().map((m) => m.collection));
    const source = collectionsDuSource();
    // Le relevé de l'ADR compte 151 collections : un relevé vide trahirait le motif.
    expect(source.size).toBeGreaterThan(100);
    const orphelines = [...source]
      .filter(([nom]) => !enregistrees.has(nom) && !BETTER_AUTH.has(nom))
      .map(([nom, fichier]) => `${nom} (${fichier})`);
    expect(orphelines, 'schéma déclaré mais jamais enregistré').toEqual([]);
  });
});
