// Couverture des routes (ADR-0012 § Plan de validation).
//
// « Une route sensible sans permission déclarée est un trou. » `PermissionsGuard`
// laisse volontairement passer une route non annotée — sinon `/health` et les
// routes pré-organisation casseraient. C'est donc CE test qui transforme le
// « refus par défaut » d'une intention en une propriété vérifiée : toute route
// ajoutée sans `@RequirePermission` et sans inscription dans la liste ci-dessous
// fait échouer la CI.
//
// Le test lit les métadonnées des contrôleurs par introspection — il ne démarre
// pas l'application et ne touche pas à MongoDB.

import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { AccountController } from '../account/account.controller.js';
import { EmailVerificationController } from '../account/email-verification.controller.js';
import { ActualsController } from '../actuals/actuals.controller.js';
import { AdminController } from '../admin/admin.controller.js';
import {
  IntegrationsController,
  ReauthController,
} from '../integrations/integrations.controller.js';
import { AiActionsController } from '../ai/ai-actions.controller.js';
import { BillingController } from '../billing/billing.controller.js';
import { CanvasController } from '../canvas/canvas.controller.js';
import { EvaluateController } from '../evaluate/evaluate.controller.js';
import { HealthController } from '../health/health.controller.js';
import { ObjectivesController } from '../objectives/objectives.controller.js';
import { InvitationsController } from '../organizations/invitations.controller.js';
import { MembersController } from '../organizations/members.controller.js';
import { OrganizationsController } from '../organizations/organizations.controller.js';
import { ParameterPacksController } from '../parameter-packs/parameter-packs.controller.js';
import { PlansController } from '../plans/plans.controller.js';
import { ProjectsController } from '../projects/projects.controller.js';
import { ReportsController } from '../reports/reports.controller.js';
import { AuditController } from './audit.controller.js';
import { REQUIRED_PERMISSIONS_KEY, REQUIRED_PLATFORM_ROLES_KEY } from './authz.decorators.js';
import { MeController } from './me.controller.js';
import { ACTIONS, PLATFORM_FORBIDDEN_ACTIONS, type Action } from './permissions.js';

/**
 * TOUS les contrôleurs de l'application. Un contrôleur absent de cette liste
 * échapperait au test — d'où l'assertion de complétude plus bas, qui compare
 * cette liste au nombre de fichiers `*.controller.ts` réellement présents.
 */
const CONTROLEURS = [
  AccountController,
  ActualsController,
  AdminController,
  AiActionsController,
  AuditController,
  IntegrationsController,
  ReauthController,
  EmailVerificationController,
  BillingController,
  CanvasController,
  EvaluateController,
  HealthController,
  InvitationsController,
  MeController,
  MembersController,
  ObjectivesController,
  OrganizationsController,
  ParameterPacksController,
  PlansController,
  ProjectsController,
  ReportsController,
];

/**
 * Routes VOLONTAIREMENT sans permission d'organisation, avec la raison.
 *
 * Toute entrée ici est une décision, pas un oubli : ajouter une ligne à cette
 * liste doit être aussi visible en revue qu'ajouter une route.
 */
const SANS_PERMISSION: Record<string, string> = {
  'HealthController.check': 'Sonde publique — aucune authentification, aucune donnée.',
  'OrganizationsController.list':
    "Liste les organisations de l'appelant. Antérieure à tout contexte d'organisation : " +
    "c'est la route qui permet d'en choisir une.",
  'OrganizationsController.create':
    "Création d'une organisation. L'appelant n'y a par définition aucun rôle avant de la créer.",
  'InvitationsController.listMine':
    "Invitations adressées à l'email de l'appelant, toutes organisations confondues. " +
    "Scopée par la session, pas par une organisation dont il n'est pas encore membre.",
  'InvitationsController.accept':
    "Acceptation d'une invitation. L'appelant n'est pas encore membre de l'organisation " +
    'cible : exiger une permission dessus serait circulaire. Le jeton fait autorité.',
  'MeController.permissions':
    'Lecture de ses PROPRES permissions. Exiger une permission pour lire ses permissions ' +
    'serait circulaire.',

  // ── Espace compte (S20b) ────────────────────────────────────────────────
  // ADR-0012 § risque n°2 : `/compte` est le SEUL espace accessible sans
  // organisation. Un utilisateur fraîchement inscrit, ou dont la dernière
  // organisation a été supprimée, doit garder la main sur son propre compte.
  // Ces routes sont scopées par la session (`CurrentUser`), jamais par une
  // organisation : leur imposer une permission d'organisation les rendrait
  // inatteignables précisément quand elles sont le plus nécessaires.
  'AccountController.getProfile': 'Profil de l’appelant, scopé par sa session.',
  'AccountController.putProfile': 'Modification de son propre profil.',
  'AccountController.getPreferences': 'Préférences de l’appelant.',
  'AccountController.putPreferences': 'Modification de ses propres préférences.',
  'AccountController.listSessions': 'Ses propres sessions actives.',
  'AccountController.revokeSession': 'Révocation d’une de ses propres sessions.',
  'AccountController.revokeOtherSessions': 'Révocation de ses autres sessions.',
  'AccountController.getEmailChange': 'État de son propre changement d’adresse.',
  'AccountController.requestEmailChange': 'Demande de changement de sa propre adresse.',
  'AccountController.cancelEmailChange': 'Annulation de sa propre demande.',
  'AccountController.deletionEligibility':
    'Vérifie si l’appelant peut supprimer son compte — refusé s’il est dernier ' +
    'propriétaire d’une organisation (docs/12 § Règles critiques).',
  'AccountController.deleteAccount': 'Suppression de son propre compte.',
  'EmailVerificationController.verify':
    'Vérification par jeton. L’appelant n’est pas nécessairement authentifié : ' +
    'le jeton fait autorité, comme pour l’acceptation d’invitation.',
};

interface RouteInspectee {
  cle: string;
  actions: Action[] | undefined;
  rolesPlateforme: string[] | undefined;
}

/**
 * Handlers d'un contrôleur = méthodes du prototype portant un chemin Nest.
 *
 * La métadonnée est cherchée sur la MÉTHODE puis, à défaut, sur la CLASSE.
 * `PermissionsGuard` fait exactement cela (`getAllAndOverride([handler,
 * controller])`) : un `@RequirePlatformRole` posé au niveau du contrôleur
 * s'applique à toutes ses routes. Sans ce repli, les contrôleurs `/admin` de
 * S21b — qui déclarent leur plancher une seule fois, en tête de classe —
 * apparaîtraient comme autant de trous alors qu'ils sont mieux protégés que s'ils
 * répétaient l'annotation route par route.
 */
function routesDe(controleur: new (...args: never[]) => unknown): RouteInspectee[] {
  const proto = controleur.prototype as Record<string, unknown>;
  return (
    Object.getOwnPropertyNames(proto)
      .filter((nom) => nom !== 'constructor')
      .filter((nom) => typeof proto[nom] === 'function')
      // `path` est la métadonnée posée par @Get/@Post/@Put/@Patch/@Delete.
      .filter((nom) => Reflect.getMetadata('path', proto[nom] as object) !== undefined)
      .map((nom) => ({
        cle: `${controleur.name}.${nom}`,
        actions: (Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto[nom] as object) ??
          Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controleur)) as Action[] | undefined,
        rolesPlateforme: (Reflect.getMetadata(REQUIRED_PLATFORM_ROLES_KEY, proto[nom] as object) ??
          Reflect.getMetadata(REQUIRED_PLATFORM_ROLES_KEY, controleur)) as string[] | undefined,
      }))
  );
}

const TOUTES_LES_ROUTES = CONTROLEURS.flatMap((c) =>
  routesDe(c as new (...args: never[]) => unknown),
);

describe('couverture des routes par le RBAC', () => {
  it("l'introspection trouve bien des routes (le test ne se valide pas à vide)", () => {
    // Sans cette garde, une régression de l'introspection rendrait tous les
    // contrôles ci-dessous trivialement verts.
    expect(TOUTES_LES_ROUTES.length).toBeGreaterThan(25);
  });

  it('la liste des contrôleurs inspectés est exhaustive', async () => {
    const { readdir } = await import('node:fs/promises');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');

    const trouves: string[] = [];
    async function parcourir(dossier: string): Promise<void> {
      for (const entree of await readdir(dossier, { withFileTypes: true })) {
        const chemin = resolve(dossier, entree.name);
        if (entree.isDirectory()) await parcourir(chemin);
        else if (entree.name.endsWith('.controller.ts')) trouves.push(entree.name);
      }
    }
    await parcourir(racine);

    // Un fichier `*.controller.ts` dont le contrôleur principal n'est pas
    // inspecté échapperait silencieusement au contrôle de couverture.
    //
    // La comparaison porte sur les NOMS et non sur un simple comptage : depuis
    // S21b, `integrations.controller.ts` déclare DEUX contrôleurs
    // (`IntegrationsController` et `ReauthController`), et l'égalité
    // « un fichier = un contrôleur » ne tient plus. Un comptage laisserait passer
    // un fichier oublié dès qu'un autre fichier en déclare deux — exactement le
    // genre de compensation qui rend un test vert pour la mauvaise raison.
    const inspectes = new Set(CONTROLEURS.map((c) => c.name));
    const attendusDepuisFichiers = trouves.map(
      (fichier) =>
        `${fichier
          .replace(/\.controller\.ts$/, '')
          .split(/[-.]/)
          .map((mot) => mot.charAt(0).toUpperCase() + mot.slice(1))
          .join('')}Controller`,
    );
    const manquants = attendusDepuisFichiers.filter((nom) => !inspectes.has(nom));
    expect(
      manquants,
      `Contrôleurs non inspectés :\n  ${manquants.join('\n  ')}\n` +
        'Ajoutez-les à CONTROLEURS, sinon leurs routes échappent au contrôle de couverture.',
    ).toEqual([]);
  });

  it('chaque route déclare une permission, ou figure dans la liste des exceptions', () => {
    const trous = TOUTES_LES_ROUTES.filter(
      (r) =>
        !r.actions?.length && !r.rolesPlateforme?.length && SANS_PERMISSION[r.cle] === undefined,
    ).map((r) => r.cle);

    expect(
      trous,
      `Routes sans permission déclarée ni exception documentée :\n  ${trous.join('\n  ')}\n` +
        'Ajoutez `@RequirePermission(...)` ou justifiez la route dans SANS_PERMISSION.',
    ).toEqual([]);
  });

  it("aucune exception n'est obsolète", () => {
    // Une route supprimée ou finalement annotée doit disparaître de la liste :
    // sinon les exceptions s'accumulent et personne ne les relit jamais.
    const cles = new Set(TOUTES_LES_ROUTES.map((r) => r.cle));
    const annotees = new Set(
      TOUTES_LES_ROUTES.filter((r) => r.actions?.length || r.rolesPlateforme?.length).map(
        (r) => r.cle,
      ),
    );
    for (const cle of Object.keys(SANS_PERMISSION)) {
      expect(cles.has(cle), `Exception pour une route inexistante : ${cle}`).toBe(true);
      expect(annotees.has(cle), `Exception inutile — ${cle} est déjà annotée`).toBe(false);
    }
  });

  it('chaque exception porte une justification non vide', () => {
    for (const [cle, raison] of Object.entries(SANS_PERMISSION)) {
      expect(raison.trim().length, `Justification vide pour ${cle}`).toBeGreaterThan(20);
    }
  });

  it('toute action déclarée appartient au vocabulaire des 15 actions', () => {
    for (const route of TOUTES_LES_ROUTES) {
      for (const action of route.actions ?? []) {
        expect(ACTIONS, `${route.cle} déclare une action inconnue : ${action}`).toContain(action);
      }
    }
  });

  it('les routes de mutation sensibles portent la bonne action', () => {
    // Vérifications ciblées sur les routes que docs/12 nomme explicitement.
    const attendu: Record<string, Action[]> = {
      'PlansController.approve': ['plan.approve'],
      'ActualsController.close': ['period.close'],
      // R3 — la « deuxième permission distincte ».
      'ActualsController.reopen': ['period.close', 'plan.approve'],
      'ActualsController.upsert': ['actuals.import'],
      'ReportsController.downloadPdf': ['report.export'],
      'ReportsController.downloadXlsx': ['report.export'],
      'InvitationsController.create': ['members.invite'],
      'InvitationsController.revoke': ['members.invite'],
      'MembersController.changeRole': ['organization.manage'],
      'MembersController.revoke': ['organization.manage'],
      'MembersController.transfer': ['organization.manage'],
      'AuditController.list': ['audit.read'],
      'ProjectsController.create': ['project.create'],
      'CanvasController.put': ['canvas.update'],
    };
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = TOUTES_LES_ROUTES.find((r) => r.cle === cle);
      expect(route, `route introuvable : ${cle}`).toBeDefined();
      expect(route!.actions, cle).toEqual(actions);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Espace admin plateforme (S21b — ADR-0012 §4)
// ─────────────────────────────────────────────────────────────────────────────

describe('espace admin plateforme', () => {
  const CONTROLEURS_ADMIN = [AdminController, IntegrationsController, ReauthController];
  const ROUTES_ADMIN = CONTROLEURS_ADMIN.flatMap((c) =>
    routesDe(c as new (...args: never[]) => unknown),
  );

  it("l'introspection trouve bien les routes d'admin", () => {
    expect(ROUTES_ADMIN.length).toBeGreaterThan(10);
  });

  it('chaque route /admin exige un rôle plateforme — aucune exception', () => {
    // Il n'y a PAS de liste d'exceptions ici, contrairement aux routes métier :
    // `/admin` n'a aucune route pré-organisation, aucune sonde publique, aucun
    // flux par jeton. Une route d'administration sans rôle exigé est un trou, et
    // rien d'autre.
    const trous = ROUTES_ADMIN.filter((r) => !r.rolesPlateforme?.length).map((r) => r.cle);
    expect(trous, `Routes /admin sans rôle plateforme exigé :\n  ${trous.join('\n  ')}`).toEqual([]);
  });

  it("aucune route /admin n'expose l'un des trois interdits absolus", () => {
    // ADR-0012 §4 : `plan.approve`, `period.close` et `report.export` sont
    // refusés à TOUS les rôles plateforme, super-administrateur compris.
    // `canPlatform()` les refuserait de toute façon — mais une route qui les
    // déclarerait serait morte, donc trompeuse : elle promettrait dans /admin une
    // capacité qui répondrait 403 à tout le monde. Le trou n'est pas dans
    // l'autorisation, il est dans l'interface.
    for (const route of ROUTES_ADMIN) {
      for (const action of route.actions ?? []) {
        expect(
          PLATFORM_FORBIDDEN_ACTIONS,
          `${route.cle} déclare l'action interdite « ${action} » (ADR-0012 §4)`,
        ).not.toContain(action);
      }
    }
  });

  it('les écritures sensibles sont réservées au super-administrateur', () => {
    // Attribuer un rôle plateforme, c'est distribuer du pouvoir sur la
    // plateforme; écrire un secret d'intégration, c'est détenir les clés de
    // paiement. Ni l'un ni l'autre ne descend sous `platform_super_admin`.
    const attendu: Record<string, string[]> = {
      'AdminController.grantRole': ['platform_super_admin'],
      'AdminController.revokeRole': ['platform_super_admin'],
      'IntegrationsController.update': ['platform_super_admin'],
      'IntegrationsController.deleteSecret': ['platform_super_admin'],
      'IntegrationsController.test': ['platform_super_admin'],
      'IntegrationsController.list': ['platform_super_admin'],
      'IntegrationsController.detail': ['platform_super_admin'],
    };
    for (const [cle, roles] of Object.entries(attendu)) {
      const route = ROUTES_ADMIN.find((r) => r.cle === cle);
      expect(route, `route introuvable : ${cle}`).toBeDefined();
      expect(route!.rolesPlateforme, cle).toEqual(roles);
    }
  });

  it("aucune route d'intégration ne porte un nom qui promettrait une lecture de secret", () => {
    // ADR-0013 §4 : « Il n'existe pas de `GET …/reveal`, ni de paramètre
    // `?includeValues`, ni de mode debug. En ajouter un est un changement d'ADR. »
    // Ce test attrape le jour où quelqu'un en ajoutera un sans lire l'ADR.
    const interdits = /reveal|decrypt|plaintext|unmask|show.?secret/i;
    for (const route of routesDe(IntegrationsController as never)) {
      expect(interdits.test(route.cle), `route suspecte : ${route.cle}`).toBe(false);
    }
  });
});
