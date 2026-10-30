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
import { AvatarImageController } from '../account/avatar-image.controller.js';
import { EmailVerificationController } from '../account/email-verification.controller.js';
import { ActualsController } from '../actuals/actuals.controller.js';
import { AdminController } from '../admin/admin.controller.js';
import { PlatformAccessController } from '../admin/platform-access.controller.js';
import {
  IntegrationsController,
  ReauthController,
} from '../integrations/integrations.controller.js';
import { SessionReauthController } from '../integrations/session-reauth.controller.js';
import { AiActionsController } from '../ai/ai-actions.controller.js';
import { LalaController } from '../ai/lala.controller.js';
import { LalaVocalController } from '../ai/lala-vocal.controller.js';
import { AuthProvidersController } from '../auth/auth-providers.controller.js';
import { BillingController } from '../billing/billing.controller.js';
import { BrandAssetImageController } from '../branding/brand-asset-image.controller.js';
import { BrandingController } from '../branding/branding.controller.js';
import { BusinessPlanOrgController } from '../business-plan/business-plan-org.controller.js';
import { BusinessPlanController } from '../business-plan/business-plan.controller.js';
import { CanvasController } from '../canvas/canvas.controller.js';
import { EvaluateController } from '../evaluate/evaluate.controller.js';
import { FiscalProfileController } from '../fiscal/fiscal-profile.controller.js';
import { NormalizedInvoicingController } from '../fiscal/normalized-invoicing.controller.js';
import { GrowController } from '../grow/grow.controller.js';
import { HealthController } from '../health/health.controller.js';
import { IdeaLabController } from '../idea-lab/idea-lab.controller.js';
import { LegalController } from '../legal/legal.controller.js';
import { MorningBriefController } from '../morning-brief/morning-brief.controller.js';
import { ObjectivesController } from '../objectives/objectives.controller.js';
import { OrganizationSpaceController } from '../organization-space/organization-space.controller.js';
import { InvitationsController } from '../organizations/invitations.controller.js';
import { MembersController } from '../organizations/members.controller.js';
import { OrganizationsController } from '../organizations/organizations.controller.js';
import { ParameterPacksController } from '../parameter-packs/parameter-packs.controller.js';
import { PaymentsController } from '../payments/payments.controller.js';
import { PlansController } from '../plans/plans.controller.js';
import { ProjectsController } from '../projects/projects.controller.js';
import { ReportsController } from '../reports/reports.controller.js';
import { CatalogItemsController } from '../sales/catalog-items.controller.js';
import { CustomersController } from '../sales/customers.controller.js';
import { InvoiceDocumentsController } from '../sales/documents/invoice-documents.controller.js';
import { InvoiceTemplatePackagesController } from '../sales/documents/invoice-template-packages.controller.js';
import { InvoiceTemplatesController } from '../sales/documents/invoice-templates.controller.js';
import { ReceiptsController } from '../sales/receipts/receipts.controller.js';
import { RunBridgeController } from '../actuals/run-bridge/run-bridge.controller.js';
import { InvoicesController } from '../sales/invoices/invoices.controller.js';
import { JournalController } from '../sales/invoices/journal.controller.js';
import { NormalizationController } from '../sales/normalization/normalization.controller.js';
import { TaxGroupsController } from '../sales/tax-groups.controller.js';
import { TreasuryAccountsController } from '../treasury/treasury-accounts.controller.js';
import { TreasuryActualsController } from '../treasury/treasury-actuals.controller.js';
import { TreasuryExpensesController } from '../treasury/treasury-expenses.controller.js';
// ADR-0044 — P2
import { PurchaseSuppliersController } from '../purchases/suppliers/purchase-suppliers.controller.js';
// ADR-0044 — P3
import { PurchaseOrdersController } from '../purchases/orders/purchase-orders.controller.js';
import { PurchaseSettingsController } from '../purchases/settings/purchase-settings.controller.js';
// ADR-0044 — P4
import { PurchaseReceptionsController } from '../purchases/receptions/purchase-receptions.controller.js';
import { SupplierInvoicesController } from '../purchases/invoices/supplier-invoices.controller.js';
// ADR-0044 — P5
import { SupplierPaymentsController } from '../purchases/payments/supplier-payments.controller.js';
// ADR-0044 — P6
import { SupplierOverviewController } from '../purchases/overview/supplier-overview.controller.js';
import { PurchasesSummaryController } from '../purchases/payables/purchases-summary.controller.js';
import { QuotesController } from '../sales/quotes/quotes.controller.js';
import { CrmActivitiesController } from '../crm/crm-activities.controller.js';
import { CrmContactsController } from '../crm/crm-contacts.controller.js';
import { CrmOpportunitiesController } from '../crm/crm-opportunities.controller.js';
import { CrmSettingsController } from '../crm/crm-settings.controller.js';
// ADR-0039 — L1
import { WorkBillingController } from '../work/billing/work-billing.controller.js';
import { WorkAttachmentsController } from '../work/work-attachments.controller.js';
import { WorkCommentsController } from '../work/work-comments.controller.js';
import { WorkMembersController } from '../work/work-members.controller.js';
import { WorkProjectsController } from '../work/work-projects.controller.js';
import { WorkSettingsController } from '../work/work-settings.controller.js';
import { WorkTasksController } from '../work/work-tasks.controller.js';
import { WorkTimeController } from '../work/work-time.controller.js';
import { AuditController } from './audit.controller.js';
import { REQUIRED_PERMISSIONS_KEY, REQUIRED_PLATFORM_ROLES_KEY } from './authz.decorators.js';
import { MeController } from './me.controller.js';
import { CatalogController } from './catalog.controller.js';
// ADR-0039 — L2
import { NotificationsController } from '../notifications/notifications.controller.js';
// ADR-0040 — C1
import { CrmAccountConversionController } from '../crm/accounts/conversion/crm-account-conversion.controller.js';
import { CrmAccountsController } from '../crm/accounts/crm-accounts.controller.js';
// ADR-0040 — C8
import { CrmOverviewController } from '../crm/overview/crm-overview.controller.js';
// ADR-0040 — C2
import { QuotesFromOpportunityController } from '../sales/quotes/quotes-from-opportunity.controller.js';
// ADR-0040 — C3
import { CrmReportsController } from '../crm/reports/crm-reports.controller.js';
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
  AuthProvidersController,
  AvatarImageController,
  EmailVerificationController,
  BillingController,
  CanvasController,
  EvaluateController,
  FiscalProfileController,
  HealthController,
  InvitationsController,
  LalaController,
  LalaVocalController,
  LegalController,
  MeController,
  MembersController,
  NormalizedInvoicingController,
  ObjectivesController,
  OrganizationSpaceController,
  OrganizationsController,
  ParameterPacksController,
  PaymentsController,
  PlansController,
  PlatformAccessController,
  ProjectsController,
  ReportsController,
  SessionReauthController,
  // ADR-0022 — clients et catalogue (S25c).
  CustomersController,
  CatalogItemsController,
  TaxGroupsController,
  // ADR-0023 — documents de vente et journal électronique (S25e).
  InvoicesController,
  JournalController,
  // ADR-0024 § 9.1 (F2)
  NormalizationController,
  InvoiceDocumentsController,
  // ADR-0028 — identité visuelle et modèles de facture.
  BrandingController,
  BrandAssetImageController,
  InvoiceTemplatesController,
  // ADR-0031 — encaissements, règlement et pont vers le réalisé.
  ReceiptsController,
  RunBridgeController,
  // ADR-0034 — dépenses, trésorerie, report au réalisé.
  TreasuryExpensesController,
  TreasuryAccountsController,
  TreasuryActualsController,
  // ADR-0035 — devis et CRM minimal.
  QuotesController,
  CrmSettingsController,
  CrmContactsController,
  CrmOpportunitiesController,
  CrmActivitiesController,
  InvoiceTemplatePackagesController,
  // ADR-0033 — brief du matin.
  MorningBriefController,
  // ADR-0032 — GROW (santé, indicateurs investisseurs, parcours).
  GrowController,
  // ADR-0037 — business plan narratif (BUILD).
  BusinessPlanController,
  BusinessPlanOrgController,
  // ADR-0036 — Idea Lab et validation d'idée.
  IdeaLabController,
  // ADR-0039 — L2
  NotificationsController,
  // ADR-0039 — L1 : projets et tâches du RUN (API cœur).
  WorkSettingsController,
  WorkMembersController,
  WorkProjectsController,
  WorkTasksController,
  WorkCommentsController,
  WorkAttachmentsController,
  WorkTimeController,
  // ADR-0039 — L4a : branchements argent (devis, factures, marge).
  WorkBillingController,
  // ADR-0040 — C1 : comptes 360° et conversion prospect → client.
  CrmAccountsController,
  CrmAccountConversionController,
  // ADR-0040 — C8 : fiche 360° et fil chronologique.
  CrmOverviewController,
  // ADR-0040 — C2 : devis prérempli depuis une opportunité.
  QuotesFromOpportunityController,
  // ADR-0041 — A2 : catalogue des autorisations.
  CatalogController,
  // ADR-0040 — C3 : rapports du CRM.
  CrmReportsController,
  // ADR-0044 — P2 : fiches fournisseurs.
  PurchaseSuppliersController,
  // ADR-0044 — P3 : demandes, commandes, approbations, réglages.
  PurchaseOrdersController,
  PurchaseSettingsController,
  // ADR-0044 — P4 : réceptions et factures fournisseurs.
  PurchaseReceptionsController,
  SupplierInvoicesController,
  // ADR-0044 — P5 : paiements fournisseurs, échéancier, doublons.
  SupplierPaymentsController,
  // ADR-0044 — P6
  SupplierOverviewController,
  PurchasesSummaryController,
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
  'PlatformAccessController.platformAccess':
    'Lecture de ses PROPRES rôles plateforme (S21b). Même circularité que ci-dessus, et ' +
    "surtout : la placer sous /admin la rendrait inaccessible à l'écrasante majorité des " +
    "utilisateurs, c'est-à-dire précisément à ceux qui ont besoin d'apprendre qu'ils n'ont " +
    "aucun rôle. N'autorise rien — le serveur refuse de toute façon.",

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
  'AccountController.uploadAvatar': 'Téléversement de sa PROPRE photo de profil.',
  'AccountController.deleteAvatar': 'Retrait de sa propre photo de profil.',
  'AccountController.avatarLimits':
    'Bornes de validation d’un téléversement (taille, dimensions, formats). ' +
    'Aucune donnée d’aucun utilisateur — des constantes, servies pour que ' +
    'l’interface ne les code pas en dur.',
  'AvatarImageController.serve':
    'Sert les octets d’une photo de profil. AUTHENTIFIÉE PAR JETON SIGNÉ et non ' +
    'par session — même régime que la vérification d’email ci-dessous, et pour ' +
    'la même raison : la ressource est consommée par une balise <img> qui ne ' +
    'porte pas les cookies en cross-origin. Le jeton scelle un identifiant ' +
    'd’objet de 128 bits tiré au hasard, avec expiration ; signature invalide, ' +
    'jeton expiré et objet inconnu rendent tous 404. Décision et limites : ' +
    'account/avatar-url.ts.',
  'BrandAssetImageController.serve':
    'Sert les octets d’un logo d’organisation à l’interface (ADR-0028 § 7). AUTHENTIFIÉE ' +
    'PAR JETON SIGNÉ, même régime que la photo de profil : consommée par une balise <img> ' +
    'cross-origin sans cookie. Identifiant de 128 bits tiré au hasard, expiration, 404 ' +
    'unique ; servie SEULEMENT si le logo est encore relié à son organisation. Voir ' +
    'branding/brand-asset-url.ts.',
  'EmailVerificationController.verify':
    'Vérification par jeton. L’appelant n’est pas nécessairement authentifié : ' +
    'le jeton fait autorité, comme pour l’acceptation d’invitation.',

  // ── Paiements (S22b) ────────────────────────────────────────────────────
  'PaymentsController.webhook':
    'Rappel de fournisseur de paiement. AUTHENTIFIÉ PAR SIGNATURE et non par ' +
    'session : Stripe et PayPal ne portent aucun cookie. La vérification a lieu ' +
    'avant toute lecture du corps, et un secret absent provoque un 503 — jamais ' +
    'une acceptation. Voir payments/webhook-signature.ts.',
  'PaymentsController.methods':
    'Liste les moyens de paiement disponibles. Appelée par la page tarifs ' +
    'PUBLIQUE, sans session. Ne renvoie aucun secret ni motif détaillé ' +
    'd’indisponibilité — seulement « carte : oui/non ».',

  // ── Moyens de connexion disponibles (S22a) ──────────────────────────────
  'AuthProvidersController.list':
    'Dit à la page de connexion si le bouton Google doit s’afficher. Consultée AVANT ' +
    'toute session, par définition : exiger une permission d’organisation la rendrait ' +
    'inutilisable. Ne renvoie qu’un booléen, aucun identifiant ni secret.',
  // ── Acceptation des conditions (S22c) ───────────────────────────────────
  // Même raisonnement que l'espace compte, poussé plus loin : l'acceptation est
  // demandée à l'INSCRIPTION, à l'instant où l'organisation personnelle vient
  // d'être créée par un hook non transactionnel. Exiger une permission
  // d'organisation ferait échouer l'enregistrement de l'accord sur le seul écran
  // où il est donné — et un accord perdu se redemande, mais un accord refusé
  // pour une raison technique ressemble à un accord jamais donné.
  // C'est en outre un fait PERSONNEL : un utilisateur accepte des conditions,
  // pas une organisation.
  'LegalController.read': 'État de son propre accord, scopé par la session.',
  'LegalController.accept': 'Enregistrement de son propre accord, scopé par la session.',

  // ── Ré-authentification d'un membre d'organisation (ADR-0021 §8) ─────────
  // On ré-authentifie SA PROPRE session : la fenêtre n'ouvre aucun droit, elle
  // prouve seulement la présence de la personne. Exiger une permission
  // d'organisation pour prouver sa présence serait sans objet — ce sont les
  // routes protégées par la fenêtre qui portent, elles, leur permission.
  'SessionReauthController.confirm':
    'Ouvre la fenêtre de ré-authentification de 10 minutes de SA PROPRE session ' +
    '(mot de passe, ou connexion Google récente pour un compte sans mot de passe).',
  'SessionReauthController.status':
    'État de la fenêtre de ré-authentification de SA PROPRE session, et moyen de ' +
    'preuve attendu (mot de passe ou Google). Aucune donnée d’organisation.',

  // ── ADR-0041 — A2 ───────────────────────────────────────────────────────
  'CatalogController.catalog':
    'Vocabulaire statique des autorisations (domaines, libellés, dépendances, paires, ' +
    'actions non délégables, ligne de chaque rôle) tiré de permissions.ts. Ne dit rien ' +
    'd’aucun membre ni d’aucune organisation : la matrice est publique (docs/12).',
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

  it('toute action déclarée appartient au vocabulaire des 24 actions', () => {
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
      // ── Identité fiscale et facture normalisée (ADR-0021 §8, §10) ─────────
      // `fiscal.manage` : Propriétaire et Directeur financier seulement.
      'FiscalProfileController.get': ['fiscal.manage'],
      'FiscalProfileController.put': ['fiscal.manage'],
      'NormalizedInvoicingController.get': ['fiscal.manage'],
      'NormalizedInvoicingController.activate': ['fiscal.manage'],
      'NormalizedInvoicingController.deactivate': ['fiscal.manage'],
      'NormalizedInvoicingController.environment': ['fiscal.manage'],
      'NormalizedInvoicingController.createPointOfSale': ['fiscal.manage'],
      'NormalizedInvoicingController.patchPointOfSale': ['fiscal.manage'],
      'NormalizedInvoicingController.replaceToken': ['fiscal.manage'],
      'NormalizedInvoicingController.testPointOfSale': ['fiscal.manage'],
      'NormalizedInvoicingController.disablePointOfSale': ['fiscal.manage'],
      'NormalizedInvoicingController.referenceDataOf': ['fiscal.manage'],
      // ── Clients et catalogue (ADR-0022 § S25c.5) ──────────────────────────
      'CustomersController.list': ['sales.read'],
      'CustomersController.get': ['sales.read'],
      'CustomersController.create': ['sales.manage'],
      'CustomersController.put': ['sales.manage'],
      'CustomersController.deactivate': ['sales.manage'],
      'CustomersController.reactivate': ['sales.manage'],
      'CustomersController.remove': ['sales.manage'],
      'CatalogItemsController.list': ['sales.read'],
      'CatalogItemsController.get': ['sales.read'],
      'CatalogItemsController.create': ['sales.manage'],
      'CatalogItemsController.put': ['sales.manage'],
      'CatalogItemsController.deactivate': ['sales.manage'],
      'CatalogItemsController.reactivate': ['sales.manage'],
      'CatalogItemsController.remove': ['sales.manage'],
      'TaxGroupsController.list': ['sales.read'],
      'InvoicesController.list': ['sales.read'],
      'InvoicesController.get': ['sales.read'],
      'InvoicesController.create': ['sales.manage'],
      'InvoicesController.put': ['sales.manage'],
      'InvoicesController.remove': ['sales.manage'],
      'InvoicesController.createCreditNote': ['sales.manage'],
      'InvoicesController.issue': ['sales.invoice'],
      'InvoicesController.normalize': ['sales.invoice'],
      'InvoicesController.backToDraft': ['sales.manage'],
      'InvoicesController.exchangeRateReference': ['sales.read'],
      'JournalController.list': ['sales.read'],
      // ADR-0024 § 9.1 (F2)
      'NormalizationController.retry': ['sales.invoice'],
      'NormalizationController.check': ['sales.invoice'],
      'NormalizationController.declareNotNormalized': ['fiscal.manage'],
      'NormalizationController.dgiExchanges': ['sales.read'],
      'InvoiceDocumentsController.pdf': ['sales.read'],
      'InvoiceDocumentsController.duplicate': ['sales.manage'],
      // ADR-0042 — envoi par e-mail : préremplissage et envoi, PDF joint.
      'InvoiceDocumentsController.emailDraft': ['sales.invoice'],
      'InvoiceDocumentsController.email': ['sales.invoice'],
      // ADR-0028 : identité visuelle et choix du modèle = administration de
      // l'organisation ; consultation des modèles et aperçu = lecture des ventes.
      'BrandingController.get': ['organization.manage'],
      'BrandingController.putIdentity': ['organization.manage'],
      'BrandingController.uploadLogo': ['organization.manage'],
      'BrandingController.removeLogo': ['organization.manage'],
      'InvoiceTemplatesController.list': ['sales.read'],
      'InvoiceTemplatesController.put': ['organization.manage'],
      'InvoiceTemplatesController.preview': ['sales.read'],
      // ADR-0031 § 4 : lire les encaissements et les règlements = lecture des
      // ventes ; enregistrer, modifier, annuler = `sales.receipt` ; échéance =
      // `sales.manage` ; écrire le réalisé depuis les ventes = import du réalisé
      // ET lecture des ventes.
      'ReceiptsController.list': ['sales.read'],
      'ReceiptsController.summary': ['sales.read'],
      'ReceiptsController.get': ['sales.read'],
      'ReceiptsController.create': ['sales.receipt'],
      'ReceiptsController.put': ['sales.receipt'],
      'ReceiptsController.cancel': ['sales.receipt'],
      'ReceiptsController.settlementsList': ['sales.read'],
      'ReceiptsController.settlement': ['sales.read'],
      'ReceiptsController.dueDate': ['sales.manage'],
      'RunBridgeController.view': ['sales.read'],
      'RunBridgeController.candidates': ['actuals.import', 'sales.read'],
      'RunBridgeController.configure': ['actuals.import', 'sales.read'],
      'RunBridgeController.sync': ['actuals.import', 'sales.read'],
      // ── Dépenses et trésorerie (ADR-0034 § 8) ─────────────────────────────
      'TreasuryExpensesController.categories': ['treasury.read'],
      'TreasuryExpensesController.list': ['treasury.read'],
      'TreasuryExpensesController.summary': ['treasury.read'],
      'TreasuryExpensesController.suppliers': ['treasury.read'],
      'TreasuryExpensesController.get': ['treasury.read'],
      'TreasuryExpensesController.create': ['treasury.manage'],
      'TreasuryExpensesController.put': ['treasury.manage'],
      'TreasuryExpensesController.cancel': ['treasury.manage'],
      'TreasuryExpensesController.attach': ['treasury.manage'],
      'TreasuryExpensesController.readAttachment': ['treasury.read'],
      'TreasuryExpensesController.detach': ['treasury.manage'],
      'TreasuryExpensesController.listRecurring': ['treasury.read'],
      'TreasuryExpensesController.due': ['treasury.read'],
      'TreasuryExpensesController.createRecurring': ['treasury.manage'],
      'TreasuryExpensesController.putRecurring': ['treasury.manage'],
      'TreasuryExpensesController.confirm': ['treasury.manage'],
      'TreasuryAccountsController.list': ['treasury.read'],
      'TreasuryAccountsController.get': ['treasury.read'],
      'TreasuryAccountsController.create': ['treasury.manage'],
      'TreasuryAccountsController.put': ['treasury.manage'],
      'TreasuryAccountsController.ledger': ['treasury.read'],
      'TreasuryAccountsController.transfer': ['treasury.manage'],
      'TreasuryAccountsController.other': ['treasury.manage'],
      'TreasuryAccountsController.cancel': ['treasury.manage'],
      'TreasuryAccountsController.forecast': ['treasury.read'],
      'TreasuryAccountsController.settings': ['treasury.read'],
      'TreasuryAccountsController.putSettings': ['treasury.manage'],
      // Relier au réalisé exige en plus le droit d'importer le réalisé.
      'TreasuryActualsController.getBridge': ['treasury.read'],
      'TreasuryActualsController.putBridge': ['actuals.import', 'treasury.read'],
      'TreasuryActualsController.sync': ['actuals.import', 'treasury.read'],
      'TreasuryActualsController.reconciliation': ['treasury.read', 'analytics.read'],
      // ── Devis (ADR-0035 § 4) : n'engagent pas le contribuable ─────────────
      // ADR-0040 — C0 : écriture sous `sales.quote` ; convertir exige aussi
      // `sales.manage` (le brouillon de facture reste un geste de facturation).
      'QuotesController.list': ['sales.read'],
      'QuotesController.get': ['sales.read'],
      'QuotesController.pdf': ['sales.read'],
      'QuotesController.create': ['sales.quote'],
      'QuotesController.put': ['sales.quote'],
      'QuotesController.remove': ['sales.quote'],
      'QuotesController.send': ['sales.quote'],
      'QuotesController.accept': ['sales.quote'],
      'QuotesController.refuse': ['sales.quote'],
      'QuotesController.newVersion': ['sales.quote'],
      'QuotesController.convert': ['sales.quote', 'sales.manage'],
      // ADR-0042 — envoi du devis par e-mail.
      'QuotesController.emailDraft': ['sales.quote'],
      'QuotesController.email': ['sales.quote'],
      // ADR-0040 — C0 § 4.4 : un réalisé de plan exige `project.read`.
      'ActualsController.variances': ['project.read', 'analytics.read'],
      'ActualsController.updatedProjection': ['project.read', 'analytics.read'],
      'ObjectivesController.attainment': ['project.read', 'analytics.read'],
      // ── CRM minimal (ADR-0035 § 3) ────────────────────────────────────────
      'CrmSettingsController.get': ['crm.read'],
      'CrmSettingsController.put': ['crm.manage'],
      'CrmSettingsController.pipeline': ['crm.read'],
      'CrmContactsController.list': ['crm.read'],
      'CrmContactsController.get': ['crm.read'],
      'CrmContactsController.create': ['crm.manage'],
      'CrmContactsController.put': ['crm.manage'],
      'CrmContactsController.remove': ['crm.manage'],
      'CrmContactsController.export': ['crm.manage'],
      'CrmContactsController.import': ['crm.manage'],
      'CrmOpportunitiesController.list': ['crm.read'],
      'CrmOpportunitiesController.get': ['crm.read'],
      'CrmOpportunitiesController.create': ['crm.manage'],
      'CrmOpportunitiesController.put': ['crm.manage'],
      'CrmOpportunitiesController.move': ['crm.manage'],
      'CrmOpportunitiesController.remove': ['crm.manage'],
      'CrmOpportunitiesController.export': ['crm.manage'],
      'CrmOpportunitiesController.import': ['crm.manage'],
      'CrmActivitiesController.list': ['crm.read'],
      'CrmActivitiesController.create': ['crm.manage'],
      'CrmActivitiesController.put': ['crm.manage'],
      'CrmActivitiesController.complete': ['crm.manage'],
      'CrmActivitiesController.remove': ['crm.manage'],
      'InvoiceTemplatePackagesController.list': ['sales.read'],
      'InvoiceTemplatePackagesController.install': ['organization.manage'],
      'InvoiceTemplatePackagesController.preview': ['sales.read'],
      'InvoiceTemplatePackagesController.activate': ['organization.manage'],
      // ADR-0033 — brief du matin : ouvert à tout membre (`analytics.read`), le
      // bloc ventes suit `sales.read` dans le service ; l'IA du brief se règle
      // par organisation.
      'MorningBriefController.get': ['analytics.read'],
      'MorningBriefController.explanation': ['analytics.read'],
      'MorningBriefController.getPreferences': ['analytics.read'],
      'MorningBriefController.putPreferences': ['analytics.read'],
      'MorningBriefController.putSettings': ['organization.manage'],
      // ADR-0037 — business plan narratif : rédiger prolonge le Canvas
      // (`canvas.update`), valider fige une version (`plan.approve`, séparation
      // des tâches), exporter suit le dossier financier (`report.export`).
      'BusinessPlanController.get': ['project.read'],
      'BusinessPlanController.putPlan': ['canvas.update'],
      'BusinessPlanController.putSection': ['canvas.update'],
      'BusinessPlanController.draft': ['canvas.update'],
      'BusinessPlanController.accept': ['canvas.update'],
      'BusinessPlanController.discard': ['canvas.update'],
      'BusinessPlanController.listVersions': ['project.read'],
      'BusinessPlanController.getVersion': ['project.read'],
      'BusinessPlanController.validate': ['plan.approve'],
      'BusinessPlanController.downloadPdf': ['report.export'],
      'BusinessPlanOrgController.list': ['project.read'],
      'BusinessPlanOrgController.getSettings': ['project.read'],
      'BusinessPlanOrgController.putSettings': ['organization.manage'],
      // ADR-0036 — Idea Lab : lecture `project.read` (tous les rôles), écriture
      // `canvas.update` (ceux qui écrivent déjà le Canvas) ; aucune action nouvelle.
      'IdeaLabController.list': ['project.read'],
      'IdeaLabController.get': ['project.read'],
      'IdeaLabController.create': ['canvas.update'],
      'IdeaLabController.update': ['canvas.update'],
      'IdeaLabController.archive': ['canvas.update'],
      'IdeaLabController.rate': ['canvas.update'],
      'IdeaLabController.clearRating': ['canvas.update'],
      'IdeaLabController.addExperiment': ['canvas.update'],
      'IdeaLabController.updateExperiment': ['canvas.update'],
      'IdeaLabController.deleteExperiment': ['canvas.update'],
      'IdeaLabController.promote': ['canvas.update'],
      'IdeaLabController.assist': ['canvas.update'],
      'IdeaLabController.putSettings': ['organization.manage'],
      // ADR-0039 — L2 : donnée personnelle de l'appelant (convention du brief).
      'NotificationsController.list': ['analytics.read'],
      'NotificationsController.unreadCount': ['analytics.read'],
      'NotificationsController.markRead': ['analytics.read'],
      'NotificationsController.markAllRead': ['analytics.read'],
      'NotificationsController.getPreferences': ['analytics.read'],
      'NotificationsController.putPreferences': ['analytics.read'],
      // ADR-0039 — L1 : lire `work.read`, travailler `work.update`, gouverner
      // `work.manage` ; les taux (donnée salariale) cumulent `treasury.manage`.
      'WorkSettingsController.get': ['work.read'],
      'WorkSettingsController.put': ['work.manage'],
      'WorkMembersController.list': ['work.read'],
      'WorkProjectsController.list': ['work.read'],
      'WorkProjectsController.create': ['work.manage'],
      'WorkProjectsController.get': ['work.read'],
      'WorkProjectsController.update': ['work.manage'],
      'WorkProjectsController.archive': ['work.manage'],
      'WorkProjectsController.restore': ['work.manage'],
      'WorkProjectsController.remove': ['work.manage'],
      'WorkProjectsController.activityOf': ['work.read'],
      'WorkTasksController.listProject': ['work.read'],
      'WorkTasksController.create': ['work.update'],
      'WorkTasksController.list': ['work.read'],
      'WorkTasksController.myTasks': ['work.read'],
      'WorkTasksController.get': ['work.read'],
      'WorkTasksController.patch': ['work.update'],
      'WorkTasksController.move': ['work.update'],
      'WorkTasksController.complete': ['work.update'],
      'WorkTasksController.reopen': ['work.update'],
      'WorkTasksController.remove': ['work.manage'],
      'WorkTasksController.addDependency': ['work.update'],
      'WorkTasksController.removeDependency': ['work.update'],
      'WorkTasksController.activityOf': ['work.read'],
      'WorkCommentsController.list': ['work.read'],
      'WorkCommentsController.create': ['work.update'],
      'WorkCommentsController.update': ['work.update'],
      'WorkCommentsController.remove': ['work.update'],
      'WorkAttachmentsController.list': ['work.read'],
      'WorkAttachmentsController.upload': ['work.update'],
      'WorkAttachmentsController.download': ['work.read'],
      'WorkAttachmentsController.remove': ['work.update'],
      'WorkTimeController.list': ['work.read'],
      'WorkTimeController.create': ['work.update'],
      'WorkTimeController.update': ['work.update'],
      'WorkTimeController.remove': ['work.update'],
      'WorkTimeController.summary': ['work.read'],
      'WorkTimeController.listRates': ['work.read', 'treasury.manage'],
      'WorkTimeController.setRate': ['work.manage', 'treasury.manage'],
      'WorkTimeController.removeRate': ['work.manage', 'treasury.manage'],
      // ADR-0039 — L4a : les gestes qui touchent l'argent cumulent les actions.
      'WorkBillingController.createFromQuote': ['work.manage', 'sales.read'],
      'WorkBillingController.projectForQuote': ['work.read', 'sales.read'],
      'WorkBillingController.listInvoices': ['work.read', 'sales.read'],
      'WorkBillingController.linkInvoice': ['work.manage', 'sales.read'],
      'WorkBillingController.unlinkInvoice': ['work.manage'],
      'WorkBillingController.prepareInvoice': ['work.read', 'sales.manage'],
      'WorkBillingController.margin': ['work.read', 'sales.read', 'treasury.read'],
      // ADR-0040 — C1 : comptes lus sous `crm.read`, gérés sous `crm.manage` ;
      // convertir un prospect crée une fiche client (NIF, type DGI) : `sales.manage` en plus.
      'CrmAccountsController.list': ['crm.read'],
      'CrmAccountsController.create': ['crm.manage'],
      'CrmAccountsController.migrationReport': ['crm.manage'],
      'CrmAccountsController.get': ['crm.read'],
      'CrmAccountsController.update': ['crm.manage'],
      'CrmAccountsController.archive': ['crm.manage'],
      'CrmAccountsController.restore': ['crm.manage'],
      'CrmAccountsController.remove': ['crm.manage'],
      'CrmAccountsController.merge': ['crm.manage'],
      'CrmAccountConversionController.convert': ['crm.manage', 'sales.manage'],
      // ADR-0040 — C4 : décocher une activité depuis « Mes tâches » (relances CRM).
      'CrmActivitiesController.reopen': ['crm.manage'],
      // ADR-0040 — C8 : `crm.read` pour la route ; les sections ventes et projets
      // exigent en plus `sales.read` / `work.read`, sinon elles sont `hidden`.
      'CrmOverviewController.overview': ['crm.read'],
      'CrmOverviewController.timeline': ['crm.read'],
      // ADR-0040 — C2 : réassignation en masse (`crm.manage`) ; devis prérempli
      // depuis une opportunité : préparer un devis ET lire l'opportunité.
      'CrmOpportunitiesController.reassign': ['crm.manage'],
      'QuotesFromOpportunityController.create': ['sales.quote', 'crm.read'],
      // ADR-0040 — C3 : rapports en lecture seule, comme le pipeline.
      'CrmReportsController.reports': ['crm.read'],
      // ADR-0040 — C7 : opportunité gagnée → projet ; `sales.read` en plus, contrôlé
      // dans le service, seulement si un devis est désigné (`quoteId`).
      'WorkBillingController.createFromOpportunity': ['work.manage', 'crm.read'],
      'WorkBillingController.projectForOpportunity': ['work.read', 'crm.read'],
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
    expect(trous, `Routes /admin sans rôle plateforme exigé :\n  ${trous.join('\n  ')}`).toEqual(
      [],
    );
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

// ADR-0041 — A4
describe('ADR-0041 — A4 : routes de gestion des autorisations par membre', () => {
  it('chaque écriture du titre, de l’écart ou du droit de clôture exige `organization.manage`', () => {
    const attendu: Record<string, Action[]> = {
      'MembersController.list': ['organization.manage'],
      'MembersController.changeRole': ['organization.manage'],
      'MembersController.setPermissions': ['organization.manage'],
      'MembersController.setCloseRight': ['organization.manage'],
      'MembersController.revoke': ['organization.manage'],
      'MembersController.transfer': ['organization.manage'],
      // L'invitation porte l'écart : même permission qu'avant, `validateOverrides` fait le reste.
      'InvitationsController.create': ['members.invite'],
    };
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = TOUTES_LES_ROUTES.find((r) => r.cle === cle);
      expect(route, `route introuvable : ${cle}`).toBeDefined();
      expect(route!.actions, cle).toEqual(actions);
    }
  });

  it('la route des autorisations ne figure pas parmi les exceptions sans permission', () => {
    expect(Object.keys(SANS_PERMISSION)).not.toContain('MembersController.setPermissions');
  });
});

// ADR-0044 — P2
describe('ADR-0044 — P2 : fournisseurs et coordonnées de paiement', () => {
  it('chaque route des fournisseurs déclare la permission de l’ADR (§ 3.1)', () => {
    const attendu: Record<string, Action[]> = {
      'PurchaseSuppliersController.list': ['purchase.read'],
      'PurchaseSuppliersController.get': ['purchase.read'],
      'PurchaseSuppliersController.create': ['purchase.manage'],
      'PurchaseSuppliersController.update': ['purchase.manage'],
      'PurchaseSuppliersController.archive': ['purchase.manage'],
      'PurchaseSuppliersController.restore': ['purchase.manage'],
      'PurchaseSuppliersController.remove': ['purchase.manage'],
      'PurchaseSuppliersController.merge': ['purchase.manage'],
      'PurchaseSuppliersController.addPaymentMethod': ['purchase.manage'],
      'PurchaseSuppliersController.updatePaymentMethod': ['purchase.manage'],
      'PurchaseSuppliersController.removePaymentMethod': ['purchase.manage'],
      'PurchaseSuppliersController.migrationReport': ['purchase.manage'],
      // Le clair des coordonnées : celui qui paie, et lui seul (§ 2.1.1).
      'PurchaseSuppliersController.reveal': ['payables.pay'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      r.cle.startsWith('PurchaseSuppliersController.'),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
  });
});

// ADR-0044 — P3
describe('ADR-0044 — P3 : demandes, bons de commande et réglages', () => {
  it('chaque route des demandes et commandes déclare la permission de l’ADR (§ 3.2, § 3.3)', () => {
    const attendu: Record<string, Action[]> = {
      'PurchaseOrdersController.list': ['purchase.read'],
      'PurchaseOrdersController.get': ['purchase.read'],
      'PurchaseOrdersController.pdf': ['purchase.read'],
      // Sa demande : `purchase.request` ; au-delà, le service exige `purchase.manage`.
      'PurchaseOrdersController.create': ['purchase.request'],
      'PurchaseOrdersController.update': ['purchase.request'],
      'PurchaseOrdersController.remove': ['purchase.request'],
      'PurchaseOrdersController.submit': ['purchase.request'],
      'PurchaseOrdersController.duplicate': ['purchase.request'],
      // Autorité de dépense : approuver, refuser, voir ce qu'on peut approuver.
      'PurchaseOrdersController.approve': ['purchase.approve'],
      'PurchaseOrdersController.reject': ['purchase.approve'],
      'PurchaseOrdersController.pending': ['purchase.approve'],
      'PurchaseOrdersController.markSent': ['purchase.manage'],
      'PurchaseOrdersController.cancel': ['purchase.manage'],
      'PurchaseOrdersController.close': ['purchase.manage'],
      'PurchaseOrdersController.emailDraft': ['purchase.manage'],
      'PurchaseOrdersController.email': ['purchase.manage'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) => r.cle.startsWith('PurchaseOrdersController.'));
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
  });

  it('changer les paliers exige d’être soi-même approbateur (§ 3.7)', () => {
    const attendu: Record<string, Action[]> = {
      'PurchaseSettingsController.get': ['purchase.read'],
      'PurchaseSettingsController.update': ['purchase.manage', 'purchase.approve'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) => r.cle.startsWith('PurchaseSettingsController.'));
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
  });
});

// ADR-0044 — P4
describe('ADR-0044 — P4 : réceptions, factures fournisseurs et rapprochement', () => {
  it('chaque route des réceptions et des factures déclare la permission de l’ADR (§ 3.4, § 3.5)', () => {
    const attendu: Record<string, Action[]> = {
      'PurchaseReceptionsController.list': ['purchase.read'],
      'PurchaseReceptionsController.get': ['purchase.read'],
      'PurchaseReceptionsController.create': ['purchase.manage'],
      'PurchaseReceptionsController.cancel': ['purchase.manage'],
      'PurchaseReceptionsController.uploadAttachment': ['purchase.manage'],
      'PurchaseReceptionsController.downloadAttachment': ['purchase.read'],
      'SupplierInvoicesController.list': ['purchase.read'],
      'SupplierInvoicesController.get': ['purchase.read'],
      'SupplierInvoicesController.create': ['purchase.manage'],
      'SupplierInvoicesController.fromOrder': ['purchase.manage'],
      'SupplierInvoicesController.update': ['purchase.manage'],
      'SupplierInvoicesController.validate': ['purchase.manage'],
      // Valider malgré un écart bloquant : une autorité de dépense (§ 5.3).
      'SupplierInvoicesController.forceValidate': ['purchase.approve'],
      'SupplierInvoicesController.dispute': ['purchase.manage'],
      'SupplierInvoicesController.resolveDispute': ['purchase.manage'],
      'SupplierInvoicesController.cancel': ['purchase.manage'],
      'SupplierInvoicesController.uploadAttachment': ['purchase.manage'],
      'SupplierInvoicesController.downloadAttachment': ['purchase.read'],
    };
    const routes = TOUTES_LES_ROUTES.filter(
      (r) =>
        r.cle.startsWith('PurchaseReceptionsController.') ||
        r.cle.startsWith('SupplierInvoicesController.'),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
  });

  it('aucune route des réceptions ni des factures n’est une exception sans permission', () => {
    for (const cle of Object.keys(SANS_PERMISSION)) {
      expect(cle.startsWith('PurchaseReceptionsController.')).toBe(false);
      expect(cle.startsWith('SupplierInvoicesController.')).toBe(false);
    }
  });
});

// ADR-0044 — P5
describe('ADR-0044 — P5 : paiements fournisseurs, échéancier et doublons', () => {
  it('chaque route des dettes et paiements déclare la permission de l’ADR (§ 3.6)', () => {
    const attendu: Record<string, Action[]> = {
      'SupplierPaymentsController.payables': ['purchase.read'],
      // Paiements et doublons révèlent des dépenses : il faut aussi lire la trésorerie.
      'SupplierPaymentsController.list': ['purchase.read', 'treasury.read'],
      'SupplierPaymentsController.get': ['purchase.read', 'treasury.read'],
      'SupplierPaymentsController.duplicates': ['purchase.read', 'treasury.read'],
      // Payer est un décaissement ; rattacher une dépense existante, aussi la modifier.
      'SupplierPaymentsController.create': ['payables.pay'],
      'SupplierPaymentsController.fromExpense': ['payables.pay', 'treasury.manage'],
      'SupplierPaymentsController.cancel': ['payables.pay'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) => r.cle.startsWith('SupplierPaymentsController.'));
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
  });

  it('aucune écriture de paiement n’est accessible par `purchase.approve` seul', () => {
    const ecritures = TOUTES_LES_ROUTES.filter((r) =>
      [
        'SupplierPaymentsController.create',
        'SupplierPaymentsController.fromExpense',
        'SupplierPaymentsController.cancel',
      ].includes(r.cle),
    );
    expect(ecritures.length).toBe(3);
    for (const r of ecritures) {
      expect(r.actions, r.cle).toContain('payables.pay');
      expect(r.actions, r.cle).not.toContain('purchase.approve');
    }
    for (const cle of Object.keys(SANS_PERMISSION)) {
      expect(cle.startsWith('SupplierPaymentsController.')).toBe(false);
    }
  });
});

// ADR-0044 — P6
describe('ADR-0044 — P6 : fiche fournisseur 360° et résumé des achats', () => {
  it('la fiche 360° exige `purchase.read` ; les sections de trésorerie sont filtrées dedans', () => {
    const routes = TOUTES_LES_ROUTES.filter((r) => r.cle.startsWith('SupplierOverviewController.'));
    expect(routes.map((r) => r.cle)).toEqual(['SupplierOverviewController.overview']);
    expect(routes[0]!.actions).toEqual(['purchase.read']);
    for (const cle of Object.keys(SANS_PERMISSION)) {
      expect(cle.startsWith('SupplierOverviewController.')).toBe(false);
    }
  });

  it('le résumé des achats exige `purchase.read` (§ 3.6)', () => {
    const routes = TOUTES_LES_ROUTES.filter((r) => r.cle.startsWith('PurchasesSummaryController.'));
    expect(routes.map((r) => [r.cle, r.actions])).toEqual([
      ['PurchasesSummaryController.summary', ['purchase.read']],
    ]);
  });
});
