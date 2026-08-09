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
import { AiActionsController } from '../ai/ai-actions.controller.js';
import { BillingController } from '../billing/billing.controller.js';
import { CanvasController } from '../canvas/canvas.controller.js';
import { EvaluateController } from '../evaluate/evaluate.controller.js';
import { HealthController } from '../health/health.controller.js';
import { ObjectivesController } from '../objectives/objectives.controller.js';
import { OrganizationSpaceController } from '../organization-space/organization-space.controller.js';
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
import { ACTIONS, type Action } from './permissions.js';

/**
 * TOUS les contrôleurs de l'application. Un contrôleur absent de cette liste
 * échapperait au test — d'où l'assertion de complétude plus bas, qui compare
 * cette liste au nombre de fichiers `*.controller.ts` réellement présents.
 */
const CONTROLEURS = [
  AccountController,
  ActualsController,
  AiActionsController,
  AuditController,
  EmailVerificationController,
  BillingController,
  CanvasController,
  EvaluateController,
  HealthController,
  InvitationsController,
  MeController,
  MembersController,
  ObjectivesController,
  OrganizationSpaceController,
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

/** Handlers d'un contrôleur = méthodes du prototype portant un chemin Nest. */
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
        actions: Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto[nom] as object) as
          Action[] | undefined,
        rolesPlateforme: Reflect.getMetadata(REQUIRED_PLATFORM_ROLES_KEY, proto[nom] as object) as
          string[] | undefined,
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

    // Un fichier `*.controller.ts` de plus que de contrôleurs inspectés = un
    // contrôleur qui échapperait silencieusement au contrôle de couverture.
    expect(trouves.length).toBe(CONTROLEURS.length);
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
      // ── Espace organisation (S21a) ────────────────────────────────────────
      // Le tableau de bord est gardé par `analytics.read`, que les HUIT rôles
      // détiennent : c'est délibéré, l'espace doit être utile à un Lecteur. Le
      // filtrage réel se fait bloc par bloc dans le service, à partir de la même
      // matrice — vérifié bout en bout par `organization-space.e2e.test.ts`.
      'OrganizationSpaceController.dashboard': ['analytics.read'],
      'OrganizationSpaceController.getSettings': ['organization.manage'],
      'OrganizationSpaceController.putSettings': ['organization.manage'],
      // `billing.manage` n'est détenu que par le Propriétaire (ADR-0012 §3).
      'OrganizationSpaceController.billing': ['billing.manage'],
    };
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = TOUTES_LES_ROUTES.find((r) => r.cle === cle);
      expect(route, `route introuvable : ${cle}`).toBeDefined();
      expect(route!.actions, cle).toEqual(actions);
    }
  });
});
