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
// ADR-0053 — P4
import { AdminFeaturesController } from '../admin/features/admin-features.controller.js';
import { MeFeaturesController } from '../admin/features/me-features.controller.js';
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
// ADR-0052 — O0
import { OrganizationSetupController } from '../organization-setup/organization-setup.controller.js';
// ADR-0052 — O1
import { OrganizationSetupProgressController } from '../organization-setup/organization-setup-progress.controller.js';
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
// ADR-0045 — H2
import { HrDepartmentsController } from '../hr/departments/hr-departments.controller.js';
import { HrEmployeesController } from '../hr/employees/hr-employees.controller.js';
import { HrPrivateController } from '../hr/private/hr-private.controller.js';
import { HrSettingsController } from '../hr/settings/hr-settings.controller.js';
// ADR-0045 — H3
import { HrCalendarController } from '../hr/calendar/hr-calendar.controller.js';
import { HrHolidaysController } from '../hr/holidays/hr-holidays.controller.js';
import { HrLeaveTypesController } from '../hr/leave/hr-leave-types.controller.js';
import { HrLeaveController } from '../hr/leave/hr-leave.controller.js';
// ADR-0045 — H5
import { HrReportsController } from '../hr/reports/hr-reports.controller.js';
import { WorkTimesheetsController } from '../work/timesheets/work-timesheets.controller.js';
// ADR-0045 — H4
import { HrChecklistsController } from '../hr/checklists/hr-checklists.controller.js';
import { HrDocumentsController } from '../hr/documents/hr-documents.controller.js';
import { HrDeadlinesController } from '../hr/reminders/hr-deadlines.controller.js';
// ADR-0046 — S6
import {
  DocumentFoldersController,
  LibraryDocumentsController,
} from '../documents/library-documents.controller.js';
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
import { WorkOverviewController } from '../work/work-overview.controller.js';
// ADR-0058 : accueil des projets (portefeuille).
import { WorkPortfolioController } from '../work/work-portfolio.controller.js';
// ADR-0060 : membres d'un projet et équipes.
import { WorkProjectMembersController } from '../work/work-project-members.controller.js';
import { HrTeamsController } from '../hr/teams/hr-teams.controller.js';
// ADR-0061 : mes notifications des Projets.
import { WorkNotificationPreferencesController } from '../work/preferences/work-notification-preferences.controller.js';
// ADR-0062 : import d'un fichier de tâches.
import { WorkImportController } from '../work/work-import.controller.js';
// ADR-0063 : construction d'un plan par l'IA.
import { WorkAiPlanController } from '../work/work-ai-plan.controller.js';
import { WorkSettingsController } from '../work/work-settings.controller.js';
// ADR-0064 : notifications des Projets par Slack.
import { SlackController } from '../slack/slack.controller.js';
import { WorkSlackController } from '../slack/work-slack.controller.js';
import { WorkSlackChannelController } from '../work/work-slack-channel.controller.js';
// ADR-0065 : notifications des Projets par WhatsApp.
import { WhatsappController } from '../whatsapp/whatsapp.controller.js';
import { WorkWhatsappController } from '../whatsapp/work-whatsapp.controller.js';
import { WorkTasksController } from '../work/work-tasks.controller.js';
import { WorkTimeController } from '../work/work-time.controller.js';
import { AuditController } from './audit.controller.js';
import {
  PLATFORM_CONSOLE_ROUTE_KEY,
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_PLATFORM_ACTIONS_KEY,
  REQUIRED_PLATFORM_ROLES_KEY,
} from './authz.decorators.js';
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
// ADR-0046 — S5
import { AssetMaintenanceController } from '../assets/maintenance/asset-maintenance.controller.js';
import { AssetsController } from '../assets/registry/assets.controller.js';
import { AssetSettingsController } from '../assets/settings/asset-settings.controller.js';
import { ACTIONS, PLATFORM_FORBIDDEN_ACTIONS, type Action } from './permissions.js';
// ADR-0046 — S3
import { StockCountsController } from '../stock/stock-counts.controller.js';
import { StockItemsController } from '../stock/stock-items.controller.js';
import { StockLevelsController } from '../stock/stock-levels.controller.js';
import { StockLocationsController } from '../stock/stock-locations.controller.js';
import { StockPendingController } from '../stock/stock-pending.controller.js';
import { StockReportsController } from '../stock/stock-reports.controller.js';
import { StockSettingsController } from '../stock/stock-settings.controller.js';
import { StockVouchersController } from '../stock/stock-vouchers.controller.js';
// ADR-0046 — S4
import { StockSyncController } from '../stock/links/stock-sync.controller.js';
// ADR-0048 — formulaire public de prospects
import { CrmLeadFormsController } from '../crm/lead-forms/crm-lead-forms.controller.js';
import { PublicLeadFormsController } from '../crm/lead-forms/public-lead-forms.controller.js';
// ADR-0053 — P0
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionsGuard } from './permissions.guard.js';
import { PlatformAuthGuard } from './platform-auth.guard.js';
import {
  isPlatformAction,
  platformActionHolders,
  type PlatformAction,
} from './platform-actions.js';

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
  WorkOverviewController,
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
  // ADR-0045 — H2 : dossiers, données sensibles, services, réglages (lecture).
  HrEmployeesController,
  HrPrivateController,
  HrDepartmentsController,
  HrSettingsController,
  // ADR-0045 — H3 : types d'absence, fériés, demandes et soldes, calendrier.
  HrLeaveTypesController,
  HrHolidaysController,
  HrLeaveController,
  HrCalendarController,
  // ADR-0045 — H5 : rapports et registre ; feuille de temps en lecture.
  HrReportsController,
  WorkTimesheetsController,
  // ADR-0058 : accueil des projets (portefeuille).
  WorkPortfolioController,
  // ADR-0060 : membres d'un projet (utilisateurs, équipes) ; équipes RH.
  WorkProjectMembersController,
  HrTeamsController,
  WorkNotificationPreferencesController,
  // ADR-0062 : import d'un fichier de tâches.
  WorkImportController,
  // ADR-0063 : construction d'un plan par l'IA.
  WorkAiPlanController,
  // ADR-0064 : connexion Slack de l'organisation, retour OAuth et événements, canal d'un projet.
  WorkSlackController,
  SlackController,
  WorkSlackChannelController,
  // ADR-0065 : numéro WhatsApp de l'appelant, webhook Meta.
  WorkWhatsappController,
  WhatsappController,
  // ADR-0045 — H4 : documents, listes d'entrée et de sortie, échéances.
  HrDocumentsController,
  HrChecklistsController,
  HrDeadlinesController,
  // ADR-0046 — S3 : référentiel, grand livre, bons, « À traiter », inventaires.
  StockItemsController,
  StockLocationsController,
  StockLevelsController,
  StockVouchersController,
  StockPendingController,
  StockCountsController,
  StockReportsController,
  StockSettingsController,
  // ADR-0046 — S4 : rattrapages achats et ventes à la demande.
  StockSyncController,
  // ADR-0046 — S5 : équipements (registre, affectations, maintenance, couvertures, réglages).
  AssetsController,
  AssetMaintenanceController,
  AssetSettingsController,
  // ADR-0046 — S6 : bibliothèque de documents.
  DocumentFoldersController,
  LibraryDocumentsController,
  // ADR-0048 : formulaire public de prospects (réglages et routes publiques).
  CrmLeadFormsController,
  PublicLeadFormsController,
  // ADR-0052 — O0 : statut de complétude de la mise en route.
  OrganizationSetupController,
  // ADR-0052 — O1 : avancement par organisation (sélecteur).
  OrganizationSetupProgressController,
  // ADR-0053 — P4 : fonctionnalités par offre (console et `GET /me/features`).
  AdminFeaturesController,
  MeFeaturesController,
  // ADR-0068 — RH lot 1 : postes, matricules, compte du collaborateur, import, fériés proposés.
  HrNumberingController,
  HrPositionsController,
  HrEmployeeAccountController,
  HrEmployeeNumbersController,
  HrEmployeeImportController,
  HrCountryHolidaysController,
];

/**
 * Routes VOLONTAIREMENT sans permission d'organisation, avec la raison.
 *
 * Toute entrée ici est une décision, pas un oubli : ajouter une ligne à cette
 * liste doit être aussi visible en revue qu'ajouter une route.
 */
const SANS_PERMISSION: Record<string, string> = {
  'HealthController.check': 'Sonde publique — aucune authentification, aucune donnée.',
  // ADR-0064 § 2 et § 6 — appelées par Slack ou par le navigateur qui en revient.
  'SlackController.callback':
    'Retour OAuth de Slack. Le `state` signé (HMAC, échéance 10 min) porte organisation et ' +
    'utilisateur ; la session courante doit être celle de cet utilisateur et détenir ' +
    '`organization.manage` dans CETTE organisation (vérifié dans le service). Toujours une ' +
    'redirection vers l’écran, jamais une donnée.',
  'SlackController.events':
    'Events API de Slack (`app_uninstalled`, `tokens_revoked`, `url_verification`). Aucune ' +
    'session possible : la signature `X-Slack-Signature` (HMAC SHA-256, horodatage < 5 min, ' +
    'comparaison à temps constant) fait autorité ; sans elle, 401.',
  // ADR-0065 § 5 — appelées par Meta, jamais par un navigateur.
  'WhatsappController.verify':
    'Poignée de main du webhook Meta (`hub.mode=subscribe`). Aucune session possible : ' +
    'le `hub.verify_token` doit égaler le jeton de vérification du fournisseur (comparaison ' +
    'à temps constant) ; sinon 403. Ne renvoie que `hub.challenge`, aucune donnée.',
  'WhatsappController.events':
    'Webhook Meta (statuts de livraison, « STOP »). Aucune session possible : la signature ' +
    '`X-Hub-Signature-256` (HMAC SHA-256 du corps brut avec la clé secrète de l’application, ' +
    'comparaison à temps constant) fait autorité ; sans elle, 401. Ne renvoie aucune donnée.',
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

  // ── ADR-0048 — formulaire public de prospects ───────────────────────────
  // Consultées par un VISITEUR ANONYME du site de l'organisation : aucune
  // session ne peut exister. Le jeton (192 bits, aléatoire, remplaçable) fait
  // autorité et n'ouvre que SON formulaire ; inconnu, désactivé ou remplacé :
  // même 404. Rien n'est lu en dehors du titre, des libellés, du consentement
  // et du logo choisi ; rien n'est écrit en dehors de l'organisation du jeton.
  'PublicLeadFormsController.config':
    'Configuration AFFICHÉE d’un formulaire public actif (titre, libellés, consentement, ' +
    'logo signé si choisi) et ticket de remplissage signé. Jeton non devinable ; aucun ' +
    'nom d’organisation, identifiant interne ni responsable n’est rendu (ADR-0048 § 5.2).',
  'PublicLeadFormsController.submit':
    'Soumission d’un visiteur anonyme : jeton actif, champ piège, délai minimal par ticket ' +
    'signé, débit par empreinte d’IP et par formulaire, champs bornés, sans pièce jointe ; ' +
    'écrit seulement dans l’organisation du jeton (ADR-0048 § 3, § 6).',

  // ── ADR-0052 — O0 : statut de complétude ────────────────────────────────
  'OrganizationSetupController.read':
    'Statut de complétude de l’organisation ACTIVE, ouvert à tout membre (ADR-0052 § 7, ' +
    'option O5 : aucune action nouvelle). AuthGuard vérifie l’appartenance ; la réponse ' +
    'ne porte que des booléens et des codes, jamais une valeur (NIF, solde, nom) ; ' +
    '`canAct` suit les droits effectifs de l’appelant.',
  // ── ADR-0052 — O1 : avancement de la mise en route dans le sélecteur ──────
  'OrganizationSetupProgressController.list':
    'Avancement de la mise en route de chaque organisation de l’appelant, comme ' +
    '`GET /organizations` : la liste vient de SES appartenances, jamais d’un paramètre ; ' +
    'la réponse ne porte que des compteurs, lisibles par tout membre (ADR-0052 § 7).',
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
      'InvoicesController.stats': ['sales.read'],
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
      'ReceiptsController.stats': ['sales.read'],
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
      'QuotesController.stats': ['sales.read'],
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
      'WorkOverviewController.overview': ['work.read'],
      // ADR-0062 : modèle (lire), aperçu et import dans un projet (travailler),
      // nouveau projet depuis un fichier (gouverner).
      'WorkImportController.templateXlsx': ['work.read'],
      'WorkImportController.templateCsv': ['work.read'],
      'WorkImportController.preview': ['work.update'],
      'WorkImportController.importProject': ['work.manage'],
      'WorkImportController.importTasks': ['work.update'],
      // ADR-0063 : proposer un plan (IA) et créer le projet relu — gouverner.
      'WorkAiPlanController.propose': ['work.manage'],
      'WorkAiPlanController.create': ['work.manage'],
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
      // ADR-0051 — H14 (§ 7.3) : frais refacturables, mêmes droits que la marge.
      'WorkBillingController.rebillableExpenses': ['work.read', 'sales.read', 'treasury.read'],
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
      // ADR-0048 : lire les réglages du formulaire public sous `crm.read`, les
      // créer, régler, activer et remplacer le lien sous `crm.manage`.
      'CrmLeadFormsController.get': ['crm.read'],
      'CrmLeadFormsController.create': ['crm.manage'],
      'CrmLeadFormsController.update': ['crm.manage'],
      'CrmLeadFormsController.rotateToken': ['crm.manage'],
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

// ADR-0045 — H2
describe('ADR-0045 — H2 : dossiers collaborateurs, services, organigramme, données sensibles', () => {
  it('chaque route déclare la permission de l’ADR (§ 3.1, § 3.3) ; relationnelles en `analytics.read`', () => {
    const attendu: Record<string, Action[]> = {
      'HrEmployeesController.list': ['hr.read'],
      'HrEmployeesController.create': ['hr.manage'],
      'HrEmployeesController.fromMembers': ['hr.manage'],
      // Relationnelles : `hr.read`, ou soi, ou manager — portée décidée par le moteur.
      'HrEmployeesController.get': ['analytics.read'],
      'HrEmployeesController.update': ['hr.manage'],
      'HrEmployeesController.exit': ['hr.manage'],
      'HrEmployeesController.reinstate': ['hr.manage'],
      'HrEmployeesController.anonymize': ['hr.sensitive.read', 'hr.manage'],
      'HrEmployeesController.me': ['analytics.read'],
      'HrEmployeesController.team': ['analytics.read'],
      'HrEmployeesController.orgChart': ['analytics.read'],
      // Lecture : `hr.sensitive.read`, ou le collaborateur lui-même (décidé dans le service).
      'HrPrivateController.summary': ['analytics.read'],
      'HrPrivateController.reveal': ['analytics.read'],
      'HrPrivateController.write': ['hr.sensitive.read', 'hr.manage'],
      'HrDepartmentsController.list': ['hr.read'],
      'HrDepartmentsController.create': ['hr.manage'],
      'HrDepartmentsController.update': ['hr.manage'],
      'HrDepartmentsController.archive': ['hr.manage'],
      'HrSettingsController.get': ['hr.read'],
      // ADR-0045 — H3 : écriture des réglages (§ 3.3) ; le circuit exige `leave.approve`.
      'HrSettingsController.update': ['hr.manage'],
      'HrSettingsController.updateApproval': ['leave.approve', 'hr.manage'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      /^Hr(Employees|Private|Departments|Settings)Controller\./.test(r.cle),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
    for (const cle of Object.keys(SANS_PERMISSION)) expect(cle.startsWith('Hr')).toBe(false);
  });

  it('`hr.sensitive.read` reste interdit à la plateforme, même sous accès délégué', () => {
    expect(PLATFORM_FORBIDDEN_ACTIONS).toContain('hr.sensitive.read');
  });
});

// ADR-0045 — H3
describe('ADR-0045 — H3 : absences, congés, fériés, calendrier', () => {
  it('chaque route déclare la permission de l’ADR (§ 3.2) ; relationnelles en `analytics.read`', () => {
    const attendu: Record<string, Action[]> = {
      // Lecture des types par tout membre (nom, unité, confidentialité).
      'HrLeaveTypesController.list': ['analytics.read'],
      'HrLeaveTypesController.create': ['hr.manage'],
      'HrLeaveTypesController.update': ['hr.manage'],
      'HrLeaveTypesController.archive': ['hr.manage'],
      'HrHolidaysController.list': ['analytics.read'],
      'HrHolidaysController.create': ['hr.manage'],
      'HrHolidaysController.remove': ['hr.manage'],
      // Pour soi ; `hr.manage` pour autrui, vérifié dans le service.
      'HrLeaveController.create': ['leave.request'],
      // Relationnelles : soi, équipe (manager), `hr.read` ; validation par le manager
      // désigné ou `leave.approve` (`leaveApprovalDecision`, dans le service).
      'HrLeaveController.list': ['analytics.read'],
      'HrLeaveController.approve': ['analytics.read'],
      'HrLeaveController.reject': ['analytics.read'],
      'HrLeaveController.cancel': ['analytics.read'],
      'HrLeaveController.pending': ['analytics.read'],
      'HrLeaveController.balances': ['analytics.read'],
      'HrLeaveController.ledger': ['analytics.read'],
      'HrLeaveController.adjust': ['hr.manage'],
      'HrCalendarController.calendar': ['analytics.read'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      /^Hr(LeaveTypes|Holidays|Leave|Calendar)Controller\./.test(r.cle),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
  });

  it('changer le circuit exige d’être soi-même validateur ; `leave.approve` nommée en premier', () => {
    const route = TOUTES_LES_ROUTES.find((r) => r.cle === 'HrSettingsController.updateApproval');
    expect(route!.actions).toEqual(['leave.approve', 'hr.manage']);
    for (const cle of Object.keys(SANS_PERMISSION)) expect(cle.startsWith('Hr')).toBe(false);
  });
});

// ADR-0045 — H5
describe('ADR-0045 — H5 : rapports, registre exporté, feuille de temps', () => {
  it('chaque route déclare la permission de l’ADR (§ 3.3)', () => {
    const attendu: Record<string, Action[]> = {
      'HrReportsController.reports': ['hr.read'],
      // Un fichier qui sort de l'organisation : `hr.manage` en plus, audit strict. Pas
      // `report.export`, qui ouvre aussi les exports financiers (plan, business plan).
      'HrReportsController.exportRegister': ['hr.read', 'hr.manage'],
      // Soi au guard ; autrui (`work.manage` ou manager) décidé dans le service.
      'WorkTimesheetsController.weekly': ['work.read'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      /^(HrReports|WorkTimesheets)Controller\./.test(r.cle),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
  });

  it('aucune route d’écriture sur la feuille de temps (ni saisie, ni validation)', () => {
    const routes = TOUTES_LES_ROUTES.filter((r) => r.cle.startsWith('WorkTimesheetsController.'));
    expect(routes.map((r) => r.cle)).toEqual(['WorkTimesheetsController.weekly']);
  });
});

// ADR-0045 — H4
describe('ADR-0045 — H4 : documents, listes d’entrée et de sortie, échéances', () => {
  it('chaque route déclare la permission de l’ADR (§ 3.3) ; relationnelles en `analytics.read`', () => {
    const attendu: Record<string, Action[]> = {
      // Relationnelles : `hr.read` (non sensibles), `hr.sensitive.read` (tous), soi
      // (`visibleToEmployee`, justificatif) — décidé dans le service, droits effectifs.
      'HrDocumentsController.list': ['analytics.read'],
      'HrDocumentsController.upload': ['analytics.read'],
      'HrDocumentsController.download': ['analytics.read'],
      'HrDocumentsController.remove': ['hr.manage'],
      'HrChecklistsController.listTemplates': ['hr.read'],
      'HrChecklistsController.createTemplate': ['hr.manage'],
      'HrChecklistsController.updateTemplate': ['hr.manage'],
      'HrChecklistsController.removeTemplate': ['hr.manage'],
      'HrChecklistsController.instantiate': ['hr.manage'],
      'HrChecklistsController.list': ['hr.read'],
      // L'assigné, ou `hr.manage` (sinon 404), décidé dans le service.
      'HrChecklistsController.done': ['analytics.read'],
      'HrChecklistsController.undone': ['analytics.read'],
      'HrDeadlinesController.list': ['hr.read'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      /^Hr(Documents|Checklists|Deadlines)Controller\./.test(r.cle),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
    for (const cle of Object.keys(SANS_PERMISSION)) expect(cle.startsWith('Hr')).toBe(false);
  });
});

// ADR-0046 — S3
describe('ADR-0046 — S3 : stocks (référentiel, grand livre, bons, inventaires)', () => {
  it('chaque route déclare la permission de l’ADR (§ 5.1)', () => {
    const attendu: Record<string, Action[]> = {
      'StockItemsController.list': ['stock.read'],
      'StockItemsController.get': ['stock.read'],
      'StockItemsController.movements': ['stock.read'],
      'StockItemsController.create': ['stock.manage'],
      'StockItemsController.update': ['stock.manage'],
      'StockItemsController.archive': ['stock.manage'],
      'StockItemsController.restore': ['stock.manage'],
      'StockLocationsController.list': ['stock.read'],
      'StockLocationsController.create': ['stock.manage'],
      'StockLocationsController.update': ['stock.manage'],
      'StockLocationsController.archive': ['stock.manage'],
      'StockLevelsController.levels': ['stock.read'],
      'StockLevelsController.rebuild': ['stock.manage'],
      'StockLevelsController.cost': ['stock.manage'],
      // Ajustement : `stock.manage` en plus, décidé dans le service (droits effectifs).
      'StockVouchersController.list': ['stock.read'],
      'StockVouchersController.get': ['stock.read'],
      'StockVouchersController.create': ['stock.move'],
      'StockVouchersController.update': ['stock.move'],
      'StockVouchersController.post': ['stock.move'],
      'StockVouchersController.cancel': ['stock.move'],
      // `stock.move` (motifs de coût : `stock.manage`), décidé dans le service : le
      // Comptable, qui n'a pas `stock.move`, saisit les coûts en attente.
      'StockPendingController.list': ['stock.read'],
      'StockPendingController.resolve': ['stock.read'],
      'StockPendingController.dismiss': ['stock.read'],
      'StockCountsController.list': ['stock.read'],
      'StockCountsController.get': ['stock.read'],
      'StockCountsController.create': ['stock.manage'],
      'StockCountsController.start': ['stock.manage'],
      'StockCountsController.countLine': ['stock.count'],
      'StockCountsController.submit': ['stock.count'],
      'StockCountsController.cancel': ['stock.count'],
      'StockCountsController.validate': ['stock.manage'],
      // Valeurs : `purchase.read` ou `treasury.read` en plus, décidé dans le service.
      'StockReportsController.valuation': ['stock.read'],
      'StockReportsController.replenishment': ['stock.read'],
      'StockReportsController.report': ['stock.read'],
      'StockSettingsController.get': ['stock.read'],
      'StockSettingsController.update': ['stock.manage'],
    };
    const routes = TOUTES_LES_ROUTES.filter(
      (r) => /^Stock[A-Za-z]+Controller\./.test(r.cle) && !(r.cle in ROUTES_S4), // ADR-0046 — S4
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
    for (const cle of Object.keys(SANS_PERMISSION)) expect(cle.startsWith('Stock')).toBe(false);
  });
});

// ADR-0046 — S5
describe('ADR-0046 — S5 : équipements', () => {
  it('chaque route déclare la permission de l’ADR (§ 5.2) ; export avec `report.export`', () => {
    const attendu: Record<string, Action[]> = {
      'AssetsController.list': ['assets.read'],
      'AssetsController.get': ['assets.read'],
      'AssetsController.deadlines': ['assets.read'],
      'AssetsController.reports': ['assets.read'],
      'AssetsController.exportRegister': ['assets.read', 'report.export'],
      'AssetsController.assignments': ['assets.read'],
      'AssetsController.create': ['assets.manage'],
      'AssetsController.update': ['assets.manage'],
      'AssetsController.dispose': ['assets.manage'],
      'AssetsController.reinstate': ['assets.manage'],
      'AssetsController.assign': ['assets.manage'],
      'AssetsController.returnAsset': ['assets.manage'],
      'AssetMaintenanceController.listMaintenance': ['assets.read'],
      'AssetMaintenanceController.createMaintenance': ['assets.manage'],
      'AssetMaintenanceController.updateMaintenance': ['assets.manage'],
      'AssetMaintenanceController.completeMaintenance': ['assets.manage'],
      'AssetMaintenanceController.listCoverages': ['assets.read'],
      'AssetMaintenanceController.createCoverage': ['assets.manage'],
      'AssetMaintenanceController.updateCoverage': ['assets.manage'],
      'AssetMaintenanceController.removeCoverage': ['assets.manage'],
      'AssetSettingsController.listCategories': ['assets.read'],
      'AssetSettingsController.createCategory': ['assets.manage'],
      'AssetSettingsController.updateCategory': ['assets.manage'],
      'AssetSettingsController.getSettings': ['assets.read'],
      'AssetSettingsController.updateSettings': ['assets.manage'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      /^Asset(s|Maintenance|Settings)Controller\./.test(r.cle),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
    for (const cle of Object.keys(SANS_PERMISSION)) expect(cle.startsWith('Asset')).toBe(false);
  });
});

// ADR-0046 — S6
describe('ADR-0046 — S6 : bibliothèque de documents', () => {
  it('chaque route déclare la permission de l’ADR (§ 5.3) ; les droits par dossier et par lien dans le service', () => {
    const attendu: Record<string, Action[]> = {
      'DocumentFoldersController.list': ['docs.read'],
      'DocumentFoldersController.create': ['docs.manage'],
      'DocumentFoldersController.defaults': ['docs.manage'],
      'DocumentFoldersController.update': ['docs.manage'],
      'DocumentFoldersController.archive': ['docs.manage'],
      // Lecture : `docs.read` au guard, puis dossier ET module de chaque lien (service).
      'LibraryDocumentsController.list': ['docs.read'],
      'LibraryDocumentsController.search': ['docs.read'],
      'LibraryDocumentsController.deadlines': ['docs.read'],
      'LibraryDocumentsController.entityPieces': ['docs.read'],
      'LibraryDocumentsController.get': ['docs.read'],
      'LibraryDocumentsController.download': ['docs.read'],
      // Écriture : `docs.read` au guard, puis écriture du DOSSIER (`docs.manage` ou
      // membre de `access.write`) ; sensible ou sans dossier : `docs.manage` (service).
      'LibraryDocumentsController.upload': ['docs.read'],
      'LibraryDocumentsController.update': ['docs.read'],
      'LibraryDocumentsController.archive': ['docs.read'],
      'LibraryDocumentsController.restore': ['docs.read'],
      'LibraryDocumentsController.remove': ['docs.read'],
      'LibraryDocumentsController.addVersion': ['docs.read'],
      'LibraryDocumentsController.restoreVersion': ['docs.read'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      /^(DocumentFolders|LibraryDocuments)Controller\./.test(r.cle),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
    for (const cle of Object.keys(SANS_PERMISSION)) {
      expect(/^(DocumentFolders|LibraryDocuments)Controller\./.test(cle)).toBe(false);
    }
  });
});

// ADR-0046 — S4
/** Routes ajoutées par le lot S4 aux stocks (vérifiées ici, exclues du bloc S3). */
const ROUTES_S4: Record<string, Action[]> = {
  // Rattrapages achats et ventes à la demande (§ 5.1) ; 6 par heure.
  'StockSyncController.run': ['stock.manage'],
  // Complément des écrans S8 : grand livre de tous les articles ; valeurs masquées
  // sans `purchase.read` ni `treasury.read` (service).
  'StockLevelsController.ledger': ['stock.read'],
};
describe('ADR-0046 — S4 : branchements achats et ventes, grand livre', () => {
  it('chaque route déclare la permission de l’ADR (§ 5.1)', () => {
    for (const [cle, actions] of Object.entries(ROUTES_S4)) {
      const route = TOUTES_LES_ROUTES.find((r) => r.cle === cle);
      expect(route, cle).toBeDefined();
      expect(route!.actions, cle).toEqual(actions);
    }
    const sync = TOUTES_LES_ROUTES.filter((r) => /^StockSyncController\./.test(r.cle));
    expect(sync.map((r) => r.cle)).toEqual(['StockSyncController.run']);
    for (const cle of Object.keys(SANS_PERMISSION)) expect(cle in ROUTES_S4).toBe(false);
  });
});

// ADR-0049 — K4
// Bloc du lot K4 (zone de conflit : un bloc par lot, à la fin). Les contrôleurs sont
// ajoutés ICI à `CONTROLEURS` et à `TOUTES_LES_ROUTES` (les `import` sont hissés) : les
// tests d'exhaustivité et de couverture ci-dessus, exécutés après le chargement du
// module, les voient comme les autres.
import { AccountingAccountsController } from '../accounting/chart/accounting-accounts.controller.js';
import {
  AccountingChartPacksController,
  AccountingChartPacksPlatformController,
} from '../accounting/chart/accounting-chart-packs.controller.js';
import { AccountingJournalsController } from '../accounting/journals/accounting-journals.controller.js';
import { AccountingFiscalYearsController } from '../accounting/periods/accounting-fiscal-years.controller.js';
import { AccountingRatesController } from '../accounting/rates/accounting-rates.controller.js';
import { AccountingRuleSetsController } from '../accounting/rules/accounting-rule-sets.controller.js';
import { AccountingSettingsController } from '../accounting/settings/accounting-settings.controller.js';

const CONTROLEURS_K4 = [
  AccountingSettingsController,
  AccountingChartPacksController,
  AccountingChartPacksPlatformController,
  AccountingAccountsController,
  AccountingRuleSetsController,
  AccountingJournalsController,
  AccountingRatesController,
  AccountingFiscalYearsController,
];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_K4);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_K4.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

describe('ADR-0049 — K4 : référentiel et réglages de la comptabilité', () => {
  it('chaque route déclare la permission de l’ADR (§ 11)', () => {
    const attendu: Record<string, Action[]> = {
      'AccountingSettingsController.get': ['accounting.read'],
      'AccountingSettingsController.update': ['accounting.manage'],
      // § 3.1 : cumul exigé par la route (activer engage l'organisation).
      'AccountingSettingsController.activate': ['accounting.manage', 'fiscal.manage'],
      'AccountingSettingsController.deactivate': ['accounting.manage', 'fiscal.manage'],
      'AccountingChartPacksController.list': ['accounting.read'],
      'AccountingChartPacksController.get': ['accounting.read'],
      'AccountingAccountsController.list': ['accounting.read'],
      'AccountingAccountsController.create': ['accounting.manage'],
      'AccountingAccountsController.update': ['accounting.manage'],
      'AccountingAccountsController.archive': ['accounting.manage'],
      'AccountingRuleSetsController.list': ['accounting.read'],
      'AccountingRuleSetsController.get': ['accounting.read'],
      'AccountingRuleSetsController.create': ['accounting.manage'],
      'AccountingRuleSetsController.update': ['accounting.manage'],
      // Case ⓢ : `ruleSetDecision` dans le service.
      'AccountingRuleSetsController.validate': ['accounting.manage'],
      'AccountingJournalsController.list': ['accounting.read'],
      'AccountingJournalsController.create': ['accounting.manage'],
      'AccountingJournalsController.update': ['accounting.manage'],
      'AccountingRatesController.list': ['accounting.read'],
      'AccountingRatesController.put': ['accounting.post'],
      'AccountingFiscalYearsController.list': ['accounting.read'],
      'AccountingFiscalYearsController.create': ['accounting.close'],
    };
    const routes = TOUTES_LES_ROUTES.filter(
      (r) => /^Accounting\w+Controller\./.test(r.cle) && !r.cle.includes('Platform'),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(route!.rolesPlateforme, cle).toBeUndefined();
    }
    for (const cle of Object.keys(SANS_PERMISSION))
      expect(cle.startsWith('Accounting')).toBe(false);
  });

  it('le chargement et le cycle des packs sont réservés au gestionnaire comptable et fiscal de la plateforme (§ 2.1)', () => {
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      r.cle.startsWith('AccountingChartPacksPlatformController.'),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual([
      'AccountingChartPacksPlatformController.load',
      'AccountingChartPacksPlatformController.transition',
    ]);
    for (const route of routes) {
      expect(route.rolesPlateforme, route.cle).toEqual(['platform_country_pack_manager']);
      // Aucune action d'organisation : la plateforme n'écrit jamais les livres d'un client.
      expect(route.actions, route.cle).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0049 — K5 : écritures, « À comptabiliser », lettrage, synchronisation (§ 11)
// ─────────────────────────────────────────────────────────────────────────────
//
// Contrôleurs nommés `Bookkeeping…` : le bloc K4 ci-dessus énumère à l'égalité stricte
// les routes `Accounting…Controller`.

import { BookkeepingEntriesController } from '../accounting/entries/bookkeeping-entries.controller.js';
import { BookkeepingLetteringController } from '../accounting/lettering/bookkeeping-lettering.controller.js';
import { BookkeepingPendingController } from '../accounting/pending/bookkeeping-pending.controller.js';
import { BookkeepingSyncController } from '../accounting/sync/bookkeeping-sync.controller.js';

const CONTROLEURS_K5 = [
  BookkeepingEntriesController,
  BookkeepingPendingController,
  BookkeepingLetteringController,
  BookkeepingSyncController,
];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_K5);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_K5.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

describe('ADR-0049 — K5 : écritures et synchronisation de la comptabilité', () => {
  it('chaque route déclare la permission de l’ADR (§ 11)', () => {
    const attendu: Record<string, Action[]> = {
      'BookkeepingEntriesController.list': ['accounting.read'],
      'BookkeepingEntriesController.search': ['accounting.read'],
      'BookkeepingEntriesController.get': ['accounting.read'],
      'BookkeepingEntriesController.create': ['accounting.post'],
      'BookkeepingEntriesController.update': ['accounting.post'],
      // Case ⓢ : `manualEntryDecision` dans le service.
      'BookkeepingEntriesController.validate': ['accounting.post'],
      'BookkeepingEntriesController.reverse': ['accounting.post'],
      'BookkeepingEntriesController.remove': ['accounting.post'],
      'BookkeepingPendingController.list': ['accounting.read'],
      'BookkeepingPendingController.resolve': ['accounting.post'],
      'BookkeepingLetteringController.letter': ['accounting.post'],
      'BookkeepingLetteringController.unletter': ['accounting.post'],
      'BookkeepingSyncController.run': ['accounting.manage'],
      'BookkeepingSyncController.regenerate': ['accounting.manage'],
      'BookkeepingSyncController.links': ['accounting.read'],
      'BookkeepingSyncController.putLink': ['accounting.manage'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) => /^Bookkeeping\w+Controller\./.test(r.cle));
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(route!.rolesPlateforme, cle).toBeUndefined();
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('aucune écriture comptable n’est ouverte à la plateforme (§ 8.1)', () => {
    const ecritures = TOUTES_LES_ROUTES.filter(
      (r) => /^Bookkeeping\w+Controller\./.test(r.cle) && !r.actions?.includes('accounting.read'),
    );
    expect(ecritures.length).toBeGreaterThan(0);
    for (const route of ecritures) {
      for (const action of route.actions ?? []) {
        expect(PLATFORM_FORBIDDEN_ACTIONS as readonly string[], route.cle).toContain(action);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0049 — K7 : reprise de l'existant, à-nouveaux de reprise (§ 3.2, § 11)
// ─────────────────────────────────────────────────────────────────────────────
//
// Contrôleur nommé `CutoverOpening…` : les blocs K4 et K5 ci-dessus énumèrent à l'égalité
// stricte les routes `Accounting…Controller` et `Bookkeeping…Controller`.

import { CutoverOpeningController } from '../accounting/opening/cutover-opening.controller.js';

(CONTROLEURS as unknown[]).push(CutoverOpeningController);
TOUTES_LES_ROUTES.push(...routesDe(CutoverOpeningController as new (...args: never[]) => unknown));

describe('ADR-0049 — K7 : reprise de l’existant', () => {
  it('chaque route déclare la permission de l’ADR (§ 11)', () => {
    const attendu: Record<string, Action[]> = {
      'CutoverOpeningController.proposal': ['accounting.read'],
      'CutoverOpeningController.status': ['accounting.read'],
      'CutoverOpeningController.create': ['accounting.post'],
      // Case ⓢ : `manualEntryDecision` dans le service.
      'CutoverOpeningController.validate': ['accounting.post'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) => /^CutoverOpening\w*Controller\./.test(r.cle));
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(route!.rolesPlateforme, cle).toBeUndefined();
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('la saisie et la validation de la reprise sont interdites à la plateforme (§ 8.1)', () => {
    for (const cle of ['CutoverOpeningController.create', 'CutoverOpeningController.validate']) {
      const route = TOUTES_LES_ROUTES.find((r) => r.cle === cle)!;
      for (const action of route.actions ?? []) {
        expect(PLATFORM_FORBIDDEN_ACTIONS as readonly string[], cle).toContain(action);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0049 — K6 : restitution, clôtures, rapprochement, exports (§ 11)
// ─────────────────────────────────────────────────────────────────────────────
//
// Contrôleurs nommés `Ledger…` : les blocs K4 et K5 ci-dessus énumèrent à l'égalité
// stricte les routes `Accounting…Controller` et `Bookkeeping…Controller`.

import { LedgerClosingController } from '../accounting/closing/ledger-closing.controller.js';
import { LedgerExportsController } from '../accounting/exports/ledger-exports.controller.js';
import { LedgerReconciliationController } from '../accounting/reconciliation/ledger-reconciliation.controller.js';
import { LedgerReportsController } from '../accounting/reports/ledger-reports.controller.js';
import { LedgerStatementsController } from '../accounting/statements/ledger-statements.controller.js';

const CONTROLEURS_K6 = [
  LedgerReportsController,
  LedgerStatementsController,
  LedgerClosingController,
  LedgerReconciliationController,
  LedgerExportsController,
];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_K6);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_K6.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

describe('ADR-0049 — K6 : restitution, clôtures et exports de la comptabilité', () => {
  it('chaque route déclare la permission de l’ADR (§ 11)', () => {
    const attendu: Record<string, Action[]> = {
      'LedgerReportsController.ledger': ['accounting.read'],
      'LedgerReportsController.trialBalance': ['accounting.read'],
      'LedgerReportsController.auxiliaryBalance': ['accounting.read'],
      'LedgerStatementsController.get': ['accounting.read'],
      'LedgerClosingController.closePeriod': ['accounting.close'],
      // Titre de Propriétaire en plus (`accountingReopenDecision`, dans le service).
      'LedgerClosingController.reopenPeriod': ['accounting.close'],
      'LedgerClosingController.closeFiscalYear': ['accounting.close'],
      'LedgerClosingController.reopenFiscalYear': ['accounting.close'],
      // § 11 : le rapprochement lit aussi le réalisé d'un projet.
      'LedgerReconciliationController.actuals': ['accounting.read', 'project.read'],
      'LedgerExportsController.create': ['accounting.export'],
      'LedgerExportsController.list': ['accounting.read'],
      'LedgerExportsController.file': ['accounting.export'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) => /^Ledger\w+Controller\./.test(r.cle));
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(route!.rolesPlateforme, cle).toBeUndefined();
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('la plateforme lit, mais ne clôt ni n’exporte jamais les livres d’un client (§ 8.1)', () => {
    const ecritures = TOUTES_LES_ROUTES.filter(
      (r) => /^Ledger\w+Controller\./.test(r.cle) && !r.actions?.includes('accounting.read'),
    );
    expect(ecritures.length).toBeGreaterThan(0);
    for (const route of ecritures) {
      for (const action of route.actions ?? []) {
        expect(PLATFORM_FORBIDDEN_ACTIONS as readonly string[], route.cle).toContain(action);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0050 — V2 : commandes clients, liens et pièces (§ 3)
// ─────────────────────────────────────────────────────────────────────────────

import { QuoteToOrderController } from '../sales/contracts/orders/quote-to-order.controller.js';
import { SalesOrdersController } from '../sales/contracts/orders/sales-orders.controller.js';

const CONTROLEURS_V2 = [SalesOrdersController, QuoteToOrderController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_V2);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_V2.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

describe('ADR-0050 — V2 : commandes clients', () => {
  it('chaque route déclare la permission de l’ADR (§ 3)', () => {
    const attendu: Record<string, Action[]> = {
      'SalesOrdersController.list': ['sales.read'],
      'SalesOrdersController.get': ['sales.read'],
      'SalesOrdersController.file': ['sales.read'],
      'SalesOrdersController.create': ['sales.contract'],
      'SalesOrdersController.put': ['sales.contract'],
      'SalesOrdersController.remove': ['sales.contract'],
      'SalesOrdersController.confirm': ['sales.contract'],
      'SalesOrdersController.close': ['sales.contract'],
      'SalesOrdersController.cancel': ['sales.contract'],
      'SalesOrdersController.addFile': ['sales.contract'],
      // Brouillon seulement : l'émission reste sous `sales.invoice` (routes existantes).
      'SalesOrdersController.prepareInvoice': ['sales.read', 'sales.manage'],
      'QuoteToOrderController.toOrder': ['sales.contract'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      /^(SalesOrdersController|QuoteToOrderController)\./.test(r.cle),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(route!.rolesPlateforme, cle).toBeUndefined();
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('aucune route du module n’émet ni ne normalise : `sales.invoice` n’y apparaît pas', () => {
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      /^(SalesOrdersController|QuoteToOrderController)\./.test(r.cle),
    );
    for (const route of routes)
      expect(route.actions ?? [], route.cle).not.toContain('sales.invoice');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0050 — V3 : contrats, avenants, signature, reconduction, réglages (§ 3)
// ─────────────────────────────────────────────────────────────────────────────

import { SalesContractAmendmentsController } from '../sales/contracts/amendments/sales-contract-amendments.controller.js';
import { QuoteToContractController } from '../sales/contracts/contracts/quote-to-contract.controller.js';
import { SalesContractsController } from '../sales/contracts/contracts/sales-contracts.controller.js';
import { SalesContractSettingsController } from '../sales/contracts/settings/sales-contract-settings.controller.js';

const CONTROLEURS_V3 = [
  SalesContractsController,
  SalesContractAmendmentsController,
  QuoteToContractController,
  SalesContractSettingsController,
];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_V3);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_V3.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

const MOTIF_V3 =
  /^(SalesContractsController|SalesContractAmendmentsController|QuoteToContractController|SalesContractSettingsController)\./;

describe('ADR-0050 — V3 : contrats et avenants', () => {
  it('chaque route déclare la permission de l’ADR (§ 3)', () => {
    const attendu: Record<string, Action[]> = {
      'SalesContractsController.list': ['sales.read'],
      'SalesContractsController.get': ['sales.read'],
      'SalesContractsController.file': ['sales.read'],
      'SalesContractsController.create': ['sales.contract'],
      'SalesContractsController.put': ['sales.contract'],
      'SalesContractsController.remove': ['sales.contract'],
      'SalesContractsController.submit': ['sales.contract'],
      'SalesContractsController.newVersion': ['sales.contract'],
      'SalesContractsController.cancel': ['sales.contract'],
      'SalesContractsController.signature': ['sales.contract'],
      'SalesContractsController.addFile': ['sales.contract'],
      // Engagent l'organisation : case ⓢ, séparation par `contractApprovalDecision`.
      'SalesContractsController.approve': ['sales.contract.approve'],
      'SalesContractsController.reject': ['sales.contract.approve'],
      'SalesContractsController.recordRenewal': ['sales.contract.approve'],
      'SalesContractsController.terminate': ['sales.contract.approve'],
      'SalesContractAmendmentsController.list': ['sales.read'],
      'SalesContractAmendmentsController.get': ['sales.read'],
      'SalesContractAmendmentsController.create': ['sales.contract'],
      'SalesContractAmendmentsController.put': ['sales.contract'],
      'SalesContractAmendmentsController.submit': ['sales.contract'],
      'SalesContractAmendmentsController.cancel': ['sales.contract'],
      'SalesContractAmendmentsController.signature': ['sales.contract'],
      'SalesContractAmendmentsController.approve': ['sales.contract.approve'],
      'SalesContractAmendmentsController.reject': ['sales.contract.approve'],
      'QuoteToContractController.toContract': ['sales.contract'],
      'SalesContractSettingsController.get': ['sales.read'],
      'SalesContractSettingsController.put': ['sales.contract.approve'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) => MOTIF_V3.test(r.cle));
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(route!.rolesPlateforme, cle).toBeUndefined();
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('aucune route des contrats ne prépare ni n’émet de facture : ni `sales.manage` ni `sales.invoice`', () => {
    for (const route of TOUTES_LES_ROUTES.filter((r) => MOTIF_V3.test(r.cle))) {
      expect(route.actions ?? [], route.cle).not.toContain('sales.invoice');
      expect(route.actions ?? [], route.cle).not.toContain('sales.manage');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0051 — H12 : présences et plannings (§ 6.2)
// ─────────────────────────────────────────────────────────────────────────────

import { HrAttendanceController } from '../hr/attendance/hr-attendance.controller.js';
import { HrShiftsController } from '../hr/planning/hr-shifts.controller.js';

const CONTROLEURS_H12 = [HrAttendanceController, HrShiftsController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_H12);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_H12.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

describe('ADR-0051 — H12 : présences et plannings', () => {
  it('chaque route déclare la permission de l’ADR (§ 6.2) ; relationnelles : analytics.read', () => {
    const attendu: Record<string, Action[]> = {
      'HrAttendanceController.getSettings': ['analytics.read'],
      'HrAttendanceController.putSettings': ['hr.manage'],
      'HrAttendanceController.clock': ['attendance.clock'],
      'HrAttendanceController.record': ['analytics.read'],
      'HrAttendanceController.days': ['analytics.read'],
      'HrAttendanceController.listCorrections': ['analytics.read'],
      'HrAttendanceController.requestCorrection': ['analytics.read'],
      'HrAttendanceController.approve': ['analytics.read'],
      'HrAttendanceController.reject': ['analytics.read'],
      'HrShiftsController.list': ['analytics.read'],
      'HrShiftsController.create': ['analytics.read'],
      'HrShiftsController.publish': ['analytics.read'],
      'HrShiftsController.copyWeek': ['analytics.read'],
      'HrShiftsController.update': ['analytics.read'],
      'HrShiftsController.cancel': ['analytics.read'],
      'HrShiftsController.unavailability': ['analytics.read'],
      'HrShiftsController.listNeeds': ['hr.read'],
      'HrShiftsController.createNeed': ['hr.manage'],
      'HrShiftsController.updateNeed': ['hr.manage'],
      'HrShiftsController.deleteNeed': ['hr.manage'],
      'HrShiftsController.gaps': ['analytics.read'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      /^(HrAttendanceController|HrShiftsController)\./.test(r.cle),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(route!.rolesPlateforme, cle).toBeUndefined();
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0053 — P0 : console Lalanda, garde sans organisation et actions plateforme
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0053 — P0 : la garde sans organisation ne vaut que pour la console', () => {
  /** Contrôleurs autorisés à porter `PlatformAuthGuard` : la console, et elle seule. */
  const CONTROLEURS_CONSOLE = [
    'AdminController',
    'PlatformAccessController',
    'IntegrationsController',
    'ReauthController',
    'AccountingChartPacksPlatformController',
    // ADR-0053 — P3
    'PlatformBillingController',
    // ADR-0053 — P4
    'AdminFeaturesController',
    // ADR-0053 — P5
    'AdminAuditController',
    // ADR-0053 — P6
    'PlatformAnnouncementsController',
    // ADR-0053 — P7
    'AdminStatsController',
    'AdminFinanceController',
    // ADR-0053 — P8
    'PlatformTwoFactorController',
    // ADR-0047 : factures des abonnements, sous Abonnements.
    'PlatformSubscriptionInvoicesController',
  ];
  /** Routes de console sans rôle ni action plateforme, avec leur raison (déjà justifiées). */
  const CONSOLE_SANS_EXIGENCE = ['PlatformAccessController.platformAccess'];
  /**
   * Routes plateforme ENCORE sous `AuthGuard`, servies une version (compatibilité N-1,
   * ADR-0053 § 2.2, § 7). VIDÉE par le lot P3 : `/payments/manual/*` et
   * `/payments/maintenance/sweep` sont dupliquées sous `/admin/billing/**` et répondent
   * désormais `410`. Liste figée : aucune entrée nouvelle.
   */
  const PLATEFORME_SOUS_AUTHGUARD_N1: string[] = [];

  interface RouteGardee {
    cle: string;
    controleur: string;
    cheminControleur: string;
    gardes: unknown[];
    console: boolean;
    actions: Action[] | undefined;
    rolesPlateforme: string[] | undefined;
    actionsPlateforme: string[] | undefined;
  }

  function lire<T>(cle: string, methode: object, classe: object): T | undefined {
    return (Reflect.getMetadata(cle, methode) ?? Reflect.getMetadata(cle, classe)) as T | undefined;
  }

  const ROUTES: RouteGardee[] = CONTROLEURS.flatMap((controleur) => {
    const proto = controleur.prototype as Record<string, unknown>;
    const gardesClasse = (Reflect.getMetadata(GUARDS_METADATA, controleur) ?? []) as unknown[];
    return Object.getOwnPropertyNames(proto)
      .filter((nom) => nom !== 'constructor' && typeof proto[nom] === 'function')
      .filter((nom) => Reflect.getMetadata('path', proto[nom] as object) !== undefined)
      .map((nom) => {
        const methode = proto[nom] as object;
        return {
          cle: `${controleur.name}.${nom}`,
          controleur: controleur.name,
          cheminControleur: String(Reflect.getMetadata('path', controleur) ?? ''),
          gardes: [
            ...gardesClasse,
            ...((Reflect.getMetadata(GUARDS_METADATA, methode) ?? []) as unknown[]),
          ],
          console: lire<boolean>(PLATFORM_CONSOLE_ROUTE_KEY, methode, controleur) === true,
          actions: lire<Action[]>(REQUIRED_PERMISSIONS_KEY, methode, controleur),
          rolesPlateforme: lire<string[]>(REQUIRED_PLATFORM_ROLES_KEY, methode, controleur),
          actionsPlateforme: lire<string[]>(REQUIRED_PLATFORM_ACTIONS_KEY, methode, controleur),
        };
      });
  });
  const avecGardePlateforme = ROUTES.filter((r) => r.gardes.includes(PlatformAuthGuard));
  const plateforme = (r: RouteGardee): boolean =>
    Boolean(r.rolesPlateforme?.length || r.actionsPlateforme?.length);

  it("l'introspection voit les gardes (le test ne se valide pas à vide)", () => {
    expect(ROUTES.length).toBe(TOUTES_LES_ROUTES.length);
    expect(ROUTES.filter((r) => r.gardes.includes(AuthGuard)).length).toBeGreaterThan(100);
    expect(avecGardePlateforme.length).toBeGreaterThan(10);
  });

  it('seuls les contrôleurs de la console portent `PlatformAuthGuard`', () => {
    const hors = avecGardePlateforme.filter((r) => !CONTROLEURS_CONSOLE.includes(r.controleur));
    expect(hors.map((r) => r.cle)).toEqual([]);
    expect([...new Set(avecGardePlateforme.map((r) => r.controleur))].sort()).toEqual(
      [...CONTROLEURS_CONSOLE].sort(),
    );
  });

  it('toute route sous `PlatformAuthGuard` est marquée console, sans `AuthGuard`, suivie de `PermissionsGuard`', () => {
    for (const r of avecGardePlateforme) {
      expect(r.console, `${r.cle} : marqueur @PlatformConsoleRoute absent`).toBe(true);
      expect(r.gardes.includes(AuthGuard), `${r.cle} : deux gardes d'authentification`).toBe(false);
      if (plateforme(r)) {
        expect(
          r.gardes.indexOf(PermissionsGuard),
          `${r.cle} : PermissionsGuard doit suivre PlatformAuthGuard`,
        ).toBeGreaterThan(r.gardes.indexOf(PlatformAuthGuard));
      }
    }
  });

  it('toute route marquée console porte `PlatformAuthGuard` (un marqueur seul ne vaut rien)', () => {
    const orphelines = ROUTES.filter((r) => r.console && !r.gardes.includes(PlatformAuthGuard));
    expect(orphelines.map((r) => r.cle)).toEqual([]);
  });

  it("aucune route d'organisation ne devient accessible sans organisation — table entière", () => {
    // Une route qui déclare une action d'organisation passe TOUJOURS par `AuthGuard`, qui
    // résout une organisation (ou refuse `403 NO_ORGANIZATION`) : jamais par la garde de
    // console, jamais marquée console.
    const avecAction = ROUTES.filter((r) => r.actions?.length);
    expect(avecAction.length).toBeGreaterThan(100);
    for (const r of avecAction) {
      expect(r.gardes.includes(PlatformAuthGuard), `${r.cle} : garde sans organisation`).toBe(
        false,
      );
      expect(r.console, `${r.cle} : route d'organisation marquée console`).toBe(false);
      expect(r.gardes.includes(AuthGuard), `${r.cle} : AuthGuard absent`).toBe(true);
    }
  });

  it("une route plateforme n'accepte aucune action d'organisation ; une route d'organisation, aucune exigence plateforme", () => {
    for (const r of ROUTES) {
      if (plateforme(r)) {
        expect(
          r.actions ?? [],
          `${r.cle} : action d'organisation sur une route plateforme`,
        ).toEqual([]);
        expect(
          r.gardes.includes(PlatformAuthGuard) || PLATEFORME_SOUS_AUTHGUARD_N1.includes(r.cle),
          `${r.cle} : route plateforme sous AuthGuard`,
        ).toBe(true);
      }
      if (r.actions?.length) expect(plateforme(r), r.cle).toBe(false);
    }
  });

  it('toute route de console exige un rôle ou une action plateforme, sauf la lecture de ses propres droits', () => {
    const sansExigence = avecGardePlateforme.filter((r) => !plateforme(r)).map((r) => r.cle);
    expect(sansExigence).toEqual(CONSOLE_SANS_EXIGENCE);
    for (const cle of CONSOLE_SANS_EXIGENCE) expect(SANS_PERMISSION[cle], cle).toBeDefined();
  });

  it('la liste N-1 est exacte : chaque entrée existe et reste plateforme sous `AuthGuard`', () => {
    for (const cle of PLATEFORME_SOUS_AUTHGUARD_N1) {
      const r = ROUTES.find((x) => x.cle === cle);
      expect(r, cle).toBeDefined();
      expect(plateforme(r!) && r!.gardes.includes(AuthGuard), cle).toBe(true);
    }
  });

  it('chaque `/admin/**` est sous la garde de console', () => {
    const admin = ROUTES.filter((r) => /^admin(\/|$)/.test(r.cheminControleur));
    expect(admin.length).toBeGreaterThan(10);
    for (const r of admin) expect(r.gardes.includes(PlatformAuthGuard), r.cle).toBe(true);
  });

  it('une action plateforme déclarée appartient au catalogue et pose ses détenteurs', () => {
    const declarees = ROUTES.filter((r) => r.actionsPlateforme?.length);
    expect(declarees.map((r) => r.cle)).toContain('AdminController.overview');
    for (const r of declarees) {
      for (const a of r.actionsPlateforme!) {
        expect(isPlatformAction(a), `${r.cle} : ${a}`).toBe(true);
        expect(r.rolesPlateforme, r.cle).toEqual(platformActionHolders(a as PlatformAction));
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0050 — V5 : échéancier et abonnements (§ 3, § 5.3)
// ─────────────────────────────────────────────────────────────────────────────

import { SalesSubscriptionsController } from '../sales/contracts/subscriptions/sales-subscriptions.controller.js';

const CONTROLEURS_V5 = [SalesSubscriptionsController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_V5);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_V5.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

describe('ADR-0050 — V5 : échéancier et abonnements', () => {
  it('chaque route déclare la permission de l’ADR (§ 3)', () => {
    const attendu: Record<string, Action[]> = {
      'SalesSubscriptionsController.schedule': ['sales.read'],
      // Brouillon seulement : l'émission reste sous `sales.invoice` (routes existantes).
      'SalesSubscriptionsController.prepare': ['sales.read', 'sales.manage'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) => /^SalesSubscriptionsController\./.test(r.cle));
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(route!.rolesPlateforme, cle).toBeUndefined();
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('aucune route de l’échéancier n’émet ni ne normalise : `sales.invoice` n’y apparaît pas', () => {
    for (const route of TOUTES_LES_ROUTES.filter((r) =>
      /^SalesSubscriptionsController\./.test(r.cle),
    )) {
      expect(route.actions ?? [], route.cle).not.toContain('sales.invoice');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0051 — H15 : objectifs individuels et évaluations (§ 6.3)
// ─────────────────────────────────────────────────────────────────────────────

import { HrGoalsController } from '../hr/performance/hr-goals.controller.js';
import { HrPerformanceSettingsController } from '../hr/performance/hr-performance-settings.controller.js';
import { HrReviewsController } from '../hr/performance/hr-reviews.controller.js';

const CONTROLEURS_H15 = [HrGoalsController, HrReviewsController, HrPerformanceSettingsController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_H15);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_H15.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

describe('ADR-0051 — H15 : objectifs et évaluations', () => {
  const MOTIF = /^(HrGoals|HrReviews|HrPerformanceSettings)Controller\./;

  it('chaque route déclare la permission de l’ADR (§ 6.3) ; relationnelles en `analytics.read`', () => {
    const attendu: Record<string, Action[]> = {
      // Relationnelles : soi, chaîne de managers, `performance.read` (décidé dans le service).
      'HrGoalsController.list': ['analytics.read'],
      'HrGoalsController.create': ['analytics.read'],
      'HrGoalsController.update': ['analytics.read'],
      'HrGoalsController.agree': ['analytics.read'],
      'HrGoalsController.close': ['analytics.read'],
      'HrGoalsController.progress': ['analytics.read'],
      // Campagnes : `performance.read` + `hr.manage`, `performance.read` nommée au refus.
      'HrReviewsController.listCycles': ['performance.read', 'hr.manage'],
      'HrReviewsController.createCycle': ['performance.read', 'hr.manage'],
      'HrReviewsController.updateCycle': ['performance.read', 'hr.manage'],
      'HrReviewsController.openCycle': ['performance.read', 'hr.manage'],
      'HrReviewsController.closeCycle': ['performance.read', 'hr.manage'],
      // Statuts seulement ; contenu par `reveal` (lecteurs du § 4, audit strict).
      'HrReviewsController.list': ['analytics.read'],
      'HrReviewsController.writeSection': ['analytics.read'],
      'HrReviewsController.reveal': ['analytics.read'],
      'HrReviewsController.submitSelf': ['analytics.read'],
      'HrReviewsController.submitManager': ['analytics.read'],
      'HrReviewsController.share': ['analytics.read'],
      'HrReviewsController.acknowledge': ['analytics.read'],
      // Étape RH : garde de route, puis `reviewCloseDecision` dans le service.
      'HrReviewsController.close': ['hr.manage', 'performance.read'],
      'HrReviewsController.reassign': ['hr.manage', 'performance.read'],
      'HrPerformanceSettingsController.get': ['analytics.read'],
      'HrPerformanceSettingsController.update': ['hr.manage'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) => MOTIF.test(r.cle));
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(route!.rolesPlateforme, cle).toBeUndefined();
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('`performance.read` reste interdit à la plateforme, même sous accès délégué', () => {
    expect(PLATFORM_FORBIDDEN_ACTIONS).toContain('performance.read');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0053 — P2 : comptes et organisations — une action par route, ré-authentification
// sur chaque écriture, inactivité de 12 heures exemptée pour la seule ré-authentification
// ─────────────────────────────────────────────────────────────────────────────

/** `CONSOLE_IDLE_EXEMPT_KEY` d'`authz.decorators.ts` (un seul import par module, lint). */
const P2_IDLE_EXEMPT_KEY = 'lalanda:console_idle_exempt';
import { REQUIRES_RECENT_REAUTH_KEY as P2_REAUTH_KEY } from '../integrations/reauth.guard.js';

describe('ADR-0053 — P2 : routes `/admin` de comptes et d’organisations', () => {
  /** Route → [action plateforme, ré-authentification exigée]. */
  const ATTENDU: Record<string, [PlatformAction, boolean]> = {
    'AdminController.overview': ['platform.console.read', false],
    'AdminController.listOrganizations': ['platform.orgs.read', false],
    'AdminController.getOrganization': ['platform.orgs.read', false],
    'AdminController.setPlan': ['platform.billing.grant', true],
    'AdminController.suspend': ['platform.orgs.suspend', true],
    'AdminController.restore': ['platform.orgs.suspend', true],
    'AdminController.lift': ['platform.orgs.suspend', true],
    'AdminController.listUsers': ['platform.users.read', false],
    'AdminController.getUser': ['platform.users.read', false],
    'AdminController.block': ['platform.users.block', true],
    'AdminController.unblock': ['platform.users.block', true],
    'AdminController.setDisabled': ['platform.users.block', true],
    'AdminController.grantRole': ['platform.roles.manage', true],
    'AdminController.revokeRole': ['platform.roles.manage', true],
    // ADR-0053 — P5 : `auditEvents` est passée à `AdminAuditController` (bloc P5).
  };

  const proto = AdminController.prototype as unknown as Record<string, object>;
  const handlers = Object.getOwnPropertyNames(proto).filter(
    (nom) => nom !== 'constructor' && Reflect.getMetadata('path', proto[nom]!) !== undefined,
  );

  it('la table est exhaustive : chaque route de `AdminController` y figure', () => {
    expect(handlers.map((n) => `AdminController.${n}`).sort()).toEqual(Object.keys(ATTENDU).sort());
  });

  it('chaque route déclare SON action plateforme (plus aucune liste de rôles recopiée)', () => {
    for (const [cle, [action]] of Object.entries(ATTENDU)) {
      const methode = proto[cle.split('.')[1]!]!;
      expect(Reflect.getMetadata(REQUIRED_PLATFORM_ACTIONS_KEY, methode), cle).toEqual([action]);
      expect(Reflect.getMetadata(REQUIRED_PLATFORM_ROLES_KEY, methode), cle).toEqual(
        platformActionHolders(action),
      );
    }
  });

  it('toute écriture exige la ré-authentification ; aucune lecture ne l’exige', () => {
    for (const [cle, [, reauth]] of Object.entries(ATTENDU)) {
      const methode = proto[cle.split('.')[1]!]!;
      const verbe = Reflect.getMetadata('method', methode) as number;
      // RequestMethod.GET === 0
      expect(verbe !== 0, `${cle} : écriture ⇔ ré-authentification`).toBe(reauth);
      expect(Reflect.getMetadata(P2_REAUTH_KEY, methode) === true, cle).toBe(reauth);
    }
  });

  it('la ré-authentification est ouverte à tout opérateur et seule exemptée de l’inactivité', () => {
    expect(Reflect.getMetadata(REQUIRED_PLATFORM_ACTIONS_KEY, ReauthController)).toEqual([
      'platform.console.read',
    ]);
    expect(Reflect.getMetadata(P2_IDLE_EXEMPT_KEY, ReauthController)).toBe(true);
    const exemptes = CONTROLEURS.filter(
      (c) => Reflect.getMetadata(P2_IDLE_EXEMPT_KEY, c) === true,
    ).map((c) => c.name);
    expect(exemptes).toEqual(['ReauthController']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0050 — V4 : acomptes des commandes et des contrats (§ 3, § 5.1, § 5.2)
// ─────────────────────────────────────────────────────────────────────────────

import { SalesContractDepositsController } from '../sales/contracts/deposits/sales-contract-deposits.controller.js';
import { SalesOrderDepositsController } from '../sales/contracts/deposits/sales-order-deposits.controller.js';

const CONTROLEURS_V4 = [SalesOrderDepositsController, SalesContractDepositsController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_V4);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_V4.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

const MOTIF_V4 = /^(SalesOrderDepositsController|SalesContractDepositsController)\./;

describe('ADR-0050 — V4 : acomptes', () => {
  it('chaque route déclare la permission de l’ADR (§ 3, § 5.2)', () => {
    const attendu: Record<string, Action[]> = {};
    for (const c of ['SalesOrderDepositsController', 'SalesContractDepositsController']) {
      attendu[`${c}.list`] = ['sales.read'];
      // Brouillon `FT`/`ET` seulement ; geste « traité » déclaratif sous `sales.manage`.
      attendu[`${c}.prepare`] = ['sales.read', 'sales.manage'];
      attendu[`${c}.resolve`] = ['sales.read', 'sales.manage'];
    }
    const routes = TOUTES_LES_ROUTES.filter((r) => MOTIF_V4.test(r.cle));
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(route!.rolesPlateforme, cle).toBeUndefined();
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('aucune route des acomptes n’émet ni ne normalise : `sales.invoice` n’y apparaît pas', () => {
    for (const route of TOUTES_LES_ROUTES.filter((r) => MOTIF_V4.test(r.cle))) {
      expect(route.actions ?? [], route.cle).not.toContain('sales.invoice');
    }
  });
});

// ADR-0051 — H10 : notes de frais et avances (§ 6.1)
import { HrAdvancesController } from '../hr/advances/hr-advances.controller.js';
import { HrExpenseReportsController } from '../hr/expenses/hr-expense-reports.controller.js';

const CONTROLEURS_H10 = [HrExpenseReportsController, HrAdvancesController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_H10);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_H10.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

const MOTIF_H10 = /^(HrExpenseReportsController|HrAdvancesController)\./;

describe('ADR-0051 — H10 : notes de frais et avances', () => {
  it('chaque route déclare la permission de l’ADR (§ 6.1) ; relationnelles en `analytics.read`', () => {
    const attendu: Record<string, Action[]> = {
      // Relationnelles : siennes, équipe, validateurs, payeurs, `hr.read` (sans justificatif).
      'HrExpenseReportsController.list': ['analytics.read'],
      'HrExpenseReportsController.get': ['analytics.read'],
      'HrExpenseReportsController.create': ['expenses.claim'],
      'HrExpenseReportsController.update': ['expenses.claim'],
      'HrExpenseReportsController.remove': ['expenses.claim'],
      'HrExpenseReportsController.uploadReceipt': ['expenses.claim'],
      'HrExpenseReportsController.downloadReceipt': ['analytics.read'],
      'HrExpenseReportsController.submit': ['expenses.claim'],
      'HrExpenseReportsController.duplicate': ['expenses.claim'],
      // Déclarant, ou `expenses.approve` avec motif (décidé dans le service).
      'HrExpenseReportsController.cancel': ['analytics.read'],
      // Manager de l'étape (relation) ou `expenses.approve` : `expenseApprovalDecision`.
      'HrExpenseReportsController.approve': ['analytics.read'],
      'HrExpenseReportsController.reject': ['analytics.read'],
      // Décaisser : paire `expenses.approve` + `payables.pay` (`reimbursementDecision`).
      'HrExpenseReportsController.reimburse': ['payables.pay', 'treasury.read'],
      'HrExpenseReportsController.cancelReimbursement': ['payables.pay', 'treasury.read'],
      // `expenses.approve` ou `hr.read`, vérifié dans le service.
      'HrExpenseReportsController.summary': ['analytics.read'],
      'HrExpenseReportsController.toPay': ['payables.pay'],
      'HrExpenseReportsController.getSettings': ['analytics.read'],
      // Le circuit exige en plus `expenses.approve` (vérifié dans le contrôleur).
      'HrExpenseReportsController.putSettings': ['hr.manage'],
      'HrAdvancesController.list': ['analytics.read'],
      'HrAdvancesController.get': ['analytics.read'],
      'HrAdvancesController.create': ['expenses.claim'],
      'HrAdvancesController.update': ['expenses.claim'],
      'HrAdvancesController.submit': ['expenses.claim'],
      'HrAdvancesController.cancel': ['analytics.read'],
      'HrAdvancesController.approve': ['analytics.read'],
      'HrAdvancesController.reject': ['analytics.read'],
      'HrAdvancesController.disburse': ['payables.pay', 'treasury.read'],
      'HrAdvancesController.cancelDisbursement': ['payables.pay', 'treasury.read'],
      // Selon la nature (§ 3.3) : vérifié dans le service.
      'HrAdvancesController.settle': ['analytics.read'],
      // Bénéficiaire, ou `expenses.approve` + `hr.sensitive.read` ; audit strict.
      'HrAdvancesController.revealReason': ['analytics.read'],
      // Changer qui valide exige d'être soi-même validateur (§ 2.7).
      'HrAdvancesController.putSettings': ['expenses.approve', 'hr.manage'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) => MOTIF_H10.test(r.cle));
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(route!.rolesPlateforme, cle).toBeUndefined();
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('valider ne décaisse pas : aucune route de validation ne porte `payables.pay`', () => {
    for (const cle of [
      'HrExpenseReportsController.approve',
      'HrAdvancesController.approve',
      'HrAdvancesController.putSettings',
    ]) {
      const route = TOUTES_LES_ROUTES.find((r) => r.cle === cle);
      expect(route!.actions ?? [], cle).not.toContain('payables.pay');
    }
  });
});

// ADR-0052 — O2/O3 : déclarations de la mise en route (§ 4 et § 7).
describe('ADR-0052 — O2/O3 : déclarations de la mise en route', () => {
  it('chaque déclaration exige l’action de son étape (§ 7) ; la lecture reste ouverte à tout membre', () => {
    const attendu: Record<string, Action[]> = {
      'OrganizationSetupController.confirmCountry': ['organization.manage'],
      'OrganizationSetupController.putModules': ['organization.manage'],
      'OrganizationSetupController.deferNormalisation': ['fiscal.manage'],
      'OrganizationSetupController.undeferNormalisation': ['fiscal.manage'],
      'OrganizationSetupController.deferTresorerie': ['treasury.manage'],
      'OrganizationSetupController.undeferTresorerie': ['treasury.manage'],
      'OrganizationSetupController.deferComptabilite': ['accounting.manage'],
      'OrganizationSetupController.undeferComptabilite': ['accounting.manage'],
      'OrganizationSetupController.deferEquipe': ['members.invite'],
      'OrganizationSetupController.undeferEquipe': ['members.invite'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      r.cle.startsWith('OrganizationSetupController.'),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(
      [...Object.keys(attendu), 'OrganizationSetupController.read'].sort(),
    );
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(route!.rolesPlateforme, cle).toBeUndefined();
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
    // Critère 7 : aucune route de report pour la fiche fiscale.
    expect(routes.some((r) => /fiscal$/i.test(r.cle))).toBe(false);
    expect(SANS_PERMISSION['OrganizationSetupController.read']).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0053 — P3 : abonnements et paiements manuels de la console (§ 6.2, § 7)
// ─────────────────────────────────────────────────────────────────────────────

import { PlatformBillingController } from '../admin/billing/platform-billing.controller.js';

const CONTROLEURS_P3 = [PlatformBillingController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_P3);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_P3.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

/** Anciennes routes plateforme : `410 ROUTE_GONE` à tous, sans session ni action. */
const ROUTES_RETIREES_P3: Record<string, string> = {
  'PaymentsController.pendingManual':
    'ADR-0053 P3 : retirée (410), remplacée par GET /admin/billing/manual-payments',
  'PaymentsController.confirmManual':
    'ADR-0053 P3 : retirée (410), remplacée par POST /admin/billing/manual-payments/:reference/confirm',
  'PaymentsController.rejectManual':
    'ADR-0053 P3 : retirée (410), remplacée par POST /admin/billing/manual-payments/:reference/reject',
  'PaymentsController.sweep':
    'ADR-0053 P3 : retirée (410), remplacée par POST /admin/billing/sweep',
};
Object.assign(SANS_PERMISSION, ROUTES_RETIREES_P3);

describe('ADR-0053 — P3 : `/admin/billing/**`', () => {
  const routesP3 = () =>
    TOUTES_LES_ROUTES.filter((r) => r.cle.startsWith('PlatformBillingController.'));

  it('chaque route déclare l’action plateforme du § 7, jamais une action d’organisation', () => {
    const attendu: Record<string, PlatformAction> = {
      'PlatformBillingController.subscriptions': 'platform.billing.read',
      'PlatformBillingController.manualPayments': 'platform.billing.read',
      'PlatformBillingController.grants': 'platform.billing.read',
      'PlatformBillingController.confirm': 'platform.billing.confirm',
      'PlatformBillingController.reject': 'platform.billing.confirm',
      'PlatformBillingController.sweep': 'platform.billing.confirm',
      'PlatformBillingController.createGrant': 'platform.billing.grant',
      'PlatformBillingController.approveGrant': 'platform.billing.grant',
      'PlatformBillingController.revokeGrant': 'platform.billing.grant',
    };
    expect(
      routesP3()
        .map((r) => r.cle)
        .sort(),
    ).toEqual(Object.keys(attendu).sort());
    const proto = PlatformBillingController.prototype as unknown as Record<string, object>;
    for (const [cle, action] of Object.entries(attendu)) {
      const route = routesP3().find((r) => r.cle === cle)!;
      expect(route.actions ?? [], cle).toEqual([]);
      expect(route.rolesPlateforme, cle).toEqual(platformActionHolders(action));
      const declarees = (Reflect.getMetadata(
        REQUIRED_PLATFORM_ACTIONS_KEY,
        proto[cle.split('.')[1]!]!,
      ) ?? []) as string[];
      expect(declarees, cle).toEqual([action]);
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('`platform_admin` ne confirme plus un dépôt manuel ; la finance, si (§ 5.2)', () => {
    expect(platformActionHolders('platform.billing.confirm')).not.toContain('platform_admin');
    expect(platformActionHolders('platform.billing.confirm')).toContain('platform_billing');
  });

  it('toute écriture motivée exige la ré-authentification (§ 2.4) ; le balayage, non (§ 7)', () => {
    const proto = PlatformBillingController.prototype as unknown as Record<string, object>;
    const avecReauth = ['confirm', 'reject', 'createGrant', 'approveGrant', 'revokeGrant'];
    for (const nom of Object.getOwnPropertyNames(proto)) {
      if (nom === 'constructor' || Reflect.getMetadata('path', proto[nom]!) === undefined) continue;
      expect(Reflect.getMetadata(P2_REAUTH_KEY, proto[nom]!) === true, nom).toBe(
        avecReauth.includes(nom),
      );
    }
  });

  it('les anciennes routes `/payments/manual/*` et le balayage sont retirés : aucune garde, aucune exigence', () => {
    for (const cle of Object.keys(ROUTES_RETIREES_P3)) {
      const route = TOUTES_LES_ROUTES.find((r) => r.cle === cle);
      expect(route, cle).toBeDefined();
      expect(route!.actions ?? [], cle).toEqual([]);
      expect(route!.rolesPlateforme ?? [], cle).toEqual([]);
      const nom = cle.split('.')[1]!;
      const methode = (PaymentsController.prototype as unknown as Record<string, object>)[nom]!;
      expect(Reflect.getMetadata(GUARDS_METADATA, methode) ?? [], cle).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0053 — P5 : journal plateforme, export et événements de sécurité (§ 6.5, § 7)
// ─────────────────────────────────────────────────────────────────────────────

import { AdminAuditController } from '../admin/audit/admin-audit.controller.js';
import { PlatformAuditExportThrottlerGuard } from '../admin/audit/audit-export-throttler.guard.js';

const CONTROLEURS_P5 = [AdminAuditController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_P5);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_P5.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

describe('ADR-0053 — P5 : `/admin/audit-events`, export, `/admin/security-events`', () => {
  const proto = AdminAuditController.prototype as unknown as Record<string, object>;
  const routesP5 = () => TOUTES_LES_ROUTES.filter((r) => r.cle.startsWith('AdminAuditController.'));

  it('chaque route déclare l’action plateforme du § 7, jamais une action d’organisation', () => {
    const attendu: Record<string, PlatformAction> = {
      'AdminAuditController.auditEvents': 'platform.audit.read',
      'AdminAuditController.exportCsv': 'platform.audit.export',
      'AdminAuditController.securityEvents': 'platform.audit.read',
    };
    expect(
      routesP5()
        .map((r) => r.cle)
        .sort(),
    ).toEqual(Object.keys(attendu).sort());
    for (const [cle, action] of Object.entries(attendu)) {
      const route = routesP5().find((r) => r.cle === cle)!;
      expect(route.actions ?? [], cle).toEqual([]);
      expect(route.rolesPlateforme, cle).toEqual(platformActionHolders(action));
      expect(
        Reflect.getMetadata(REQUIRED_PLATFORM_ACTIONS_KEY, proto[cle.split('.')[1]!]!),
        cle,
      ).toEqual([action]);
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('garde de console sans organisation, et aucune route d’écriture', () => {
    const gardes = (Reflect.getMetadata(GUARDS_METADATA, AdminAuditController) ?? []) as unknown[];
    expect(gardes).toEqual([PlatformAuthGuard, PermissionsGuard]);
    expect(Reflect.getMetadata(PLATFORM_CONSOLE_ROUTE_KEY, AdminAuditController)).toBe(true);
    for (const r of routesP5()) {
      const nom = r.cle.split('.')[1]!;
      // RequestMethod.GET === 0 : le journal est en ajout seul, la console le lit.
      expect(Reflect.getMetadata('method', proto[nom]!), r.cle).toBe(0);
    }
  });

  it('l’export est limité en débit ; seul le super-administrateur exporte (§ 5.2)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, proto['exportCsv']!)).toEqual([
      PlatformAuditExportThrottlerGuard,
    ]);
    expect(platformActionHolders('platform.audit.export')).toEqual(['platform_super_admin']);
    expect(platformActionHolders('platform.audit.read')).not.toContain('platform_support');
  });

  it('`AdminController` ne sert plus le journal (une seule route par chemin)', () => {
    const admin = AdminController.prototype as unknown as Record<string, unknown>;
    expect(admin['auditEvents']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0053 — P6 : annonces de la plateforme (§ 6.6, § 7)
// ─────────────────────────────────────────────────────────────────────────────

import { MeAnnouncementsController } from '../admin/announcements/me-announcements.controller.js';
import { PlatformAnnouncementsController } from '../admin/announcements/platform-announcements.controller.js';

const CONTROLEURS_P6 = [PlatformAnnouncementsController, MeAnnouncementsController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_P6);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_P6.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

/** Routes du DESTINATAIRE : `AuthGuard`, aucune action (§ 7). */
const ROUTES_DESTINATAIRE_P6: Record<string, string> = {
  'MeAnnouncementsController.list':
    'ADR-0053 P6 : ses PROPRES annonces (accusés de la session), quelle que soit ' +
    "l'organisation active ; aucune action RBAC (§ 7), la personne vient de la session.",
  'MeAnnouncementsController.read':
    'ADR-0053 P6 : marque lue une annonce dont la session est destinataire (404 sinon).',
  'MeAnnouncementsController.dismiss':
    'ADR-0053 P6 : ferme une annonce dont la session est destinataire (404 sinon).',
};
Object.assign(SANS_PERMISSION, ROUTES_DESTINATAIRE_P6);

describe('ADR-0053 — P6 : `/admin/announcements/**` et `/me/announcements`', () => {
  const proto = PlatformAnnouncementsController.prototype as unknown as Record<string, object>;

  it('chaque route de console déclare l’action plateforme du § 7, jamais une action d’organisation', () => {
    const attendu: Record<string, PlatformAction> = {
      'PlatformAnnouncementsController.list': 'platform.announcements.draft',
      'PlatformAnnouncementsController.create': 'platform.announcements.draft',
      'PlatformAnnouncementsController.update': 'platform.announcements.draft',
      'PlatformAnnouncementsController.preview': 'platform.announcements.draft',
      'PlatformAnnouncementsController.submit': 'platform.announcements.draft',
      'PlatformAnnouncementsController.cancel': 'platform.announcements.draft',
      'PlatformAnnouncementsController.approve': 'platform.announcements.approve',
      'PlatformAnnouncementsController.send': 'platform.announcements.approve',
      // ADR-0054 — retrait d'une annonce envoyée (motif, ré-authentification).
      'PlatformAnnouncementsController.withdraw': 'platform.announcements.draft',
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      r.cle.startsWith('PlatformAnnouncementsController.'),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, action] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle)!;
      expect(route.actions ?? [], cle).toEqual([]);
      expect(route.rolesPlateforme, cle).toEqual(platformActionHolders(action));
      const declarees = (Reflect.getMetadata(
        REQUIRED_PLATFORM_ACTIONS_KEY,
        proto[cle.split('.')[1]!]!,
      ) ?? []) as string[];
      expect(declarees, cle).toEqual([action]);
    }
  });

  it('aucun rôle d’organisation ne prépare ni n’approuve une annonce', () => {
    for (const action of [
      'platform.announcements.draft',
      'platform.announcements.approve',
    ] as const) {
      for (const role of platformActionHolders(action)) {
        expect(role.startsWith('platform_'), `${action} × ${role}`).toBe(true);
      }
    }
  });

  it('toute écriture exige la ré-authentification, sauf l’aperçu qui ne fait que compter', () => {
    const avecReauth = ['create', 'update', 'submit', 'approve', 'send', 'cancel', 'withdraw'];
    for (const nom of Object.getOwnPropertyNames(proto)) {
      if (nom === 'constructor' || Reflect.getMetadata('path', proto[nom]!) === undefined) continue;
      expect(Reflect.getMetadata(P2_REAUTH_KEY, proto[nom]!) === true, nom).toBe(
        avecReauth.includes(nom),
      );
    }
  });

  it('les routes du destinataire ne portent ni action, ni rôle plateforme, ni garde de console', () => {
    for (const cle of Object.keys(ROUTES_DESTINATAIRE_P6)) {
      const route = TOUTES_LES_ROUTES.find((r) => r.cle === cle);
      expect(route, cle).toBeDefined();
      expect(route!.actions ?? [], cle).toEqual([]);
      expect(route!.rolesPlateforme ?? [], cle).toEqual([]);
    }
    const gardes = (Reflect.getMetadata(GUARDS_METADATA, MeAnnouncementsController) ??
      []) as unknown[];
    expect(gardes).toEqual([AuthGuard]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0053 — P7 : statistiques et finances du site (§ 6.7, § 6.8, § 7)
// ─────────────────────────────────────────────────────────────────────────────

import { AdminFinanceController } from '../admin/finance/admin-finance.controller.js';
import { AdminStatsController } from '../admin/stats/admin-stats.controller.js';

const CONTROLEURS_P7 = [AdminStatsController, AdminFinanceController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_P7);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_P7.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

describe('ADR-0053 — P7 : `/admin/stats` et `/admin/finance`', () => {
  const attendu: Record<string, PlatformAction> = {
    'AdminStatsController.stats': 'platform.stats.read',
    'AdminFinanceController.report': 'platform.finance.read',
    'AdminFinanceController.export': 'platform.finance.export',
  };

  it('chaque route déclare l’action plateforme du § 7, jamais une action d’organisation', () => {
    const routes = TOUTES_LES_ROUTES.filter(
      (r) =>
        r.cle.startsWith('AdminStatsController.') || r.cle.startsWith('AdminFinanceController.'),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, action] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle)!;
      expect(route.actions ?? [], cle).toEqual([]);
      expect(route.rolesPlateforme, cle).toEqual(platformActionHolders(action));
      const [nomClasse, nom] = cle.split('.') as [string, string];
      const classe =
        nomClasse === 'AdminStatsController' ? AdminStatsController : AdminFinanceController;
      const declarees = (Reflect.getMetadata(
        REQUIRED_PLATFORM_ACTIONS_KEY,
        (classe.prototype as unknown as Record<string, object>)[nom]!,
      ) ?? []) as string[];
      expect(declarees, cle).toEqual([action]);
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('matrice § 5.2 : l’administrateur plateforme lit les statistiques, pas les finances', () => {
    expect(platformActionHolders('platform.stats.read')).toEqual(
      expect.arrayContaining(['platform_super_admin', 'platform_admin', 'platform_billing']),
    );
    expect(platformActionHolders('platform.finance.read')).not.toContain('platform_admin');
    expect(platformActionHolders('platform.finance.export')).not.toContain('platform_support');
  });
});

// ── ADR-0053 — P8 : double authentification de la console ────────────────────
import { PlatformTwoFactorController } from '../admin/two-factor/platform-two-factor.controller.js';
// Modules déjà importés plus haut : relus ici sans dupliquer leurs `import`.
const { ReauthController: ReauthControllerP8 } =
  await import('../integrations/integrations.controller.js');
const { PlatformAccessController: PlatformAccessControllerP8 } =
  await import('../admin/platform-access.controller.js');
const { PLATFORM_TWO_FACTOR_EXEMPT_KEY } = await import('./authz.decorators.js');
const { REQUIRES_RECENT_REAUTH_KEY } = await import('../integrations/reauth.guard.js');

const CONTROLEURS_P8 = [PlatformTwoFactorController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_P8);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_P8.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

describe('ADR-0053 — P8 : double authentification de la console', () => {
  const exemption = (classe: object, nom: string): unknown =>
    Reflect.getMetadata(
      PLATFORM_TWO_FACTOR_EXEMPT_KEY,
      (classe as { prototype: Record<string, object> }).prototype[nom]!,
    ) ?? Reflect.getMetadata(PLATFORM_TWO_FACTOR_EXEMPT_KEY, classe);

  it('chaque route déclare une action plateforme, jamais une action d’organisation', () => {
    const attendu: Record<string, PlatformAction> = {
      'PlatformTwoFactorController.status': 'platform.console.read',
      'PlatformTwoFactorController.startEnrollment': 'platform.console.read',
      'PlatformTwoFactorController.confirmEnrollment': 'platform.console.read',
      'PlatformTwoFactorController.reset': 'platform.roles.manage',
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      r.cle.startsWith('PlatformTwoFactorController.'),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, action] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle)!;
      expect(route.actions ?? [], cle).toEqual([]);
      expect(route.rolesPlateforme, cle).toEqual(platformActionHolders(action));
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('seules l’enrôlement, l’état et `/me/platform-access` sont ouverts à un non-enrôlé', () => {
    const proto = PlatformTwoFactorController.prototype as unknown as Record<string, object>;
    for (const nom of ['status', 'startEnrollment', 'confirmEnrollment']) {
      expect(Reflect.getMetadata(PLATFORM_TWO_FACTOR_EXEMPT_KEY, proto[nom]!), nom).toBe(
        'enrollment',
      );
    }
    expect(Reflect.getMetadata(PLATFORM_TWO_FACTOR_EXEMPT_KEY, proto['reset']!)).toBeUndefined();
    expect(Reflect.getMetadata(PLATFORM_TWO_FACTOR_EXEMPT_KEY, PlatformTwoFactorController)).toBe(
      undefined,
    );
    expect(exemption(PlatformAccessControllerP8, 'platformAccess')).toBe('enrollment');
    // La ré-authentification vérifie la session : ouverte à une session NON vérifiée, mais
    // jamais à un opérateur non enrôlé.
    expect(exemption(ReauthControllerP8, 'confirm')).toBe('verification');
  });

  it('aucune autre route de la console ne porte d’exemption', () => {
    const autorisees = new Set([
      'PlatformTwoFactorController.status',
      'PlatformTwoFactorController.startEnrollment',
      'PlatformTwoFactorController.confirmEnrollment',
      'PlatformAccessController.platformAccess',
      'ReauthController.status',
      'ReauthController.confirm',
    ]);
    for (const route of TOUTES_LES_ROUTES) {
      const [nomClasse, nom] = route.cle.split('.') as [string, string];
      const classe = (CONTROLEURS as Array<{ name: string; prototype: object }>).find(
        (c) => c.name === nomClasse,
      );
      if (!classe) continue;
      if (exemption(classe, nom) !== undefined) {
        expect(autorisees.has(route.cle), route.cle).toBe(true);
      }
    }
  });

  it('la réinitialisation exige une ré-authentification récente', () => {
    const proto = PlatformTwoFactorController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata(REQUIRES_RECENT_REAUTH_KEY, proto['reset']!)).toBe(true);
    expect(platformActionHolders('platform.roles.manage')).toEqual(['platform_super_admin']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0047 : factures des abonnements Lalanda (espace de l'abonné et console)
// ─────────────────────────────────────────────────────────────────────────────

import { PlatformSubscriptionInvoicesController } from '../subscription-invoices/platform-subscription-invoices.controller.js';
import { SubscriptionInvoicesController } from '../subscription-invoices/subscription-invoices.controller.js';
// ADR-0068 — RH lot 1
import { HrEmployeeAccountController } from '../hr/employees/hr-employee-account.controller.js';
import { HrEmployeeImportController } from '../hr/employees/hr-employee-import.controller.js';
import { HrEmployeeNumbersController } from '../hr/employees/hr-employee-numbers.controller.js';
import { HrCountryHolidaysController } from '../hr/holidays/hr-country-holidays.controller.js';
import { HrNumberingController } from '../hr/numbering/hr-numbering.controller.js';
import { HrPositionsController } from '../hr/positions/hr-positions.controller.js';

const CONTROLEURS_ADR47 = [SubscriptionInvoicesController, PlatformSubscriptionInvoicesController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_ADR47);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_ADR47.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

describe('ADR-0047 : factures des abonnements', () => {
  it('l’espace de l’abonné exige `billing.manage`, sans exception ni rôle plateforme', () => {
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      r.cle.startsWith('SubscriptionInvoicesController.'),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(
      [
        'SubscriptionInvoicesController.list',
        'SubscriptionInvoicesController.pdf',
        'SubscriptionInvoicesController.profile',
        'SubscriptionInvoicesController.saveProfile',
      ].sort(),
    );
    for (const r of routes) {
      expect(r.actions, r.cle).toEqual(['billing.manage']);
      expect(r.rolesPlateforme ?? [], r.cle).toEqual([]);
      expect(SANS_PERMISSION[r.cle], r.cle).toBeUndefined();
    }
  });

  it('la console déclare l’action plateforme attendue ; toute écriture exige la ré-authentification', () => {
    const attendu: Record<string, [PlatformAction, boolean]> = {
      'PlatformSubscriptionInvoicesController.list': ['platform.billing.read', false],
      'PlatformSubscriptionInvoicesController.uninvoiced': ['platform.billing.read', false],
      'PlatformSubscriptionInvoicesController.seller': ['platform.billing.read', false],
      'PlatformSubscriptionInvoicesController.pdf': ['platform.billing.read', false],
      'PlatformSubscriptionInvoicesController.emit': ['platform.billing.confirm', true],
      'PlatformSubscriptionInvoicesController.requestCreditNote': [
        'platform.billing.confirm',
        true,
      ],
      'PlatformSubscriptionInvoicesController.approveCreditNote': [
        'platform.billing.confirm',
        true,
      ],
      'PlatformSubscriptionInvoicesController.designate': ['platform.billing.grant', true],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      r.cle.startsWith('PlatformSubscriptionInvoicesController.'),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    const proto = PlatformSubscriptionInvoicesController.prototype as unknown as Record<
      string,
      object
    >;
    for (const [cle, [action, reauth]] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle)!;
      expect(route.actions ?? [], cle).toEqual([]);
      expect(route.rolesPlateforme, cle).toEqual(platformActionHolders(action));
      const methode = proto[cle.split('.')[1]!]!;
      expect(Reflect.getMetadata(REQUIRED_PLATFORM_ACTIONS_KEY, methode), cle).toEqual([action]);
      expect(Reflect.getMetadata(P2_REAUTH_KEY, methode) === true, cle).toBe(reauth);
    }
  });
});

// ADR-0058
describe('ADR-0058 : accueil des projets (portefeuille)', () => {
  it('une seule route, en lecture, sous `work.read`', () => {
    const routes = TOUTES_LES_ROUTES.filter((r) => r.cle.startsWith('WorkPortfolioController.'));
    expect(routes.map((r) => r.cle)).toEqual(['WorkPortfolioController.get']);
    expect(routes[0]!.actions).toEqual(['work.read']);
  });
});

// ADR-0060 et ADR-0061
describe('ADR-0060 et ADR-0061 : équipes, membres d’un projet, mes notifications', () => {
  it('chaque route déclare sa permission', () => {
    const attendu: Record<string, Action[]> = {
      // ADR-0060 : équipes — lecture large (`hr.read`), gestion RH et direction (`hr.manage`).
      'HrTeamsController.list': ['hr.read'],
      'HrTeamsController.get': ['hr.read'],
      'HrTeamsController.candidates': ['hr.read'],
      'HrTeamsController.create': ['hr.manage'],
      'HrTeamsController.update': ['hr.manage'],
      'HrTeamsController.addMembers': ['hr.manage'],
      'HrTeamsController.removeMember': ['hr.manage'],
      'HrTeamsController.remove': ['hr.manage'],
      // ADR-0060 : membres d'un projet ; équipes proposées aux Projets.
      'WorkProjectMembersController.teams': ['work.read'],
      'WorkProjectMembersController.get': ['work.read'],
      'WorkProjectMembersController.add': ['work.manage'],
      'WorkProjectMembersController.removeUser': ['work.manage'],
      'WorkProjectMembersController.removeTeam': ['work.manage'],
      // ADR-0061 : préférences PERSONNELLES de l'appelant.
      'WorkNotificationPreferencesController.get': ['work.read'],
      'WorkNotificationPreferencesController.put': ['work.read'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      /^(HrTeams|WorkProjectMembers|WorkNotificationPreferences)Controller\./.test(r.cle),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
  });
});

// ADR-0068 — RH lot 1
describe('ADR-0068 : invitation depuis la fiche, matricules, postes, import, fériés proposés', () => {
  it('chaque route déclare sa permission ; inviter exige `members.invite` EN PLUS de `hr.manage`', () => {
    const attendu: Record<string, Action[]> = {
      'HrNumberingController.get': ['hr.read'],
      'HrNumberingController.update': ['hr.manage'],
      'HrPositionsController.list': ['hr.read'],
      'HrPositionsController.get': ['hr.read'],
      'HrPositionsController.create': ['hr.manage'],
      'HrPositionsController.update': ['hr.manage'],
      'HrPositionsController.remove': ['hr.manage'],
      'HrEmployeeAccountController.account': ['hr.read'],
      'HrEmployeeAccountController.invite': ['hr.manage', 'members.invite'],
      'HrEmployeeAccountController.resend': ['hr.manage', 'members.invite'],
      'HrEmployeeAccountController.cancel': ['hr.manage', 'members.invite'],
      // Fiche ancienne sans matricule : `hr.manage` ; correction : droit RH administrateur.
      'HrEmployeeNumbersController.auto': ['hr.manage'],
      'HrEmployeeNumbersController.change': ['hr.sensitive.read', 'hr.manage'],
      'HrEmployeeImportController.template': ['hr.read'],
      'HrEmployeeImportController.preview': ['hr.manage'],
      'HrEmployeeImportController.apply': ['hr.manage'],
      'HrCountryHolidaysController.proposal': ['hr.manage'],
      'HrCountryHolidaysController.load': ['hr.manage'],
      'HrCountryHolidaysController.verify': ['hr.manage'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      /^Hr(Numbering|Positions|EmployeeAccount|EmployeeNumbers|EmployeeImport|CountryHolidays)Controller\./.test(
        r.cle,
      ),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0069 : cartes de service (badge vérifiable) et cartes de visite
// ─────────────────────────────────────────────────────────────────────────────

import { HrCardsController } from '../hr/cards/hr-cards.controller.js';
import { PublicCardsController } from '../hr/cards/public-cards.controller.js';

const CONTROLEURS_0069 = [HrCardsController, PublicCardsController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_0069);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_0069.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);
// Consultées par QUICONQUE tient la carte (contrôle d'accès, client, administration) :
// aucune session ne peut exister. Le jeton (144 bits, aléatoire, révocable, remplacé à
// chaque émission) fait autorité et n'ouvre que SA carte ; débit borné avant toute
// lecture (empreinte d'IP et jeton) ; inconnu, révoqué, remplacé ou fiche anonymisée :
// même réponse `{ valid: false }` (ADR-0069 § 4).
Object.assign(SANS_PERMISSION, {
  'PublicCardsController.verify':
    'Vérification publique d’une carte de service par son jeton : prénom nom, poste, ' +
    'organisation (nom, logo signé), « En fonction » / « N’est plus en fonction », photo ' +
    'seulement avec second accord. Ni matricule, ni service, ni coordonnées ; aucun oracle ' +
    '(ADR-0069 § 4).',
  'PublicCardsController.photo':
    'Photo d’une carte vérifiée, servie seulement si le jeton est valide ET que la personne ' +
    'a consenti à la photo ET à sa publication ; 404 unique sinon ; en-têtes inertes ' +
    '(nosniff, sandbox) ; débit borné (ADR-0069 § 4).',
});

describe('ADR-0069 : cartes de service et cartes de visite', () => {
  it('chaque route interne déclare hr.read (lecture, export) ou hr.manage (écriture)', () => {
    const attendu: Record<string, Action[]> = {
      'HrCardsController.getSettings': ['hr.read'],
      'HrCardsController.putSettings': ['hr.manage'],
      'HrCardsController.preview': ['hr.read'],
      'HrCardsController.listPackages': ['hr.read'],
      'HrCardsController.installPackage': ['hr.manage'],
      'HrCardsController.batch': ['hr.read'],
      'HrCardsController.getProfile': ['hr.read'],
      'HrCardsController.getPhoto': ['hr.read'],
      'HrCardsController.putConsent': ['hr.manage'],
      'HrCardsController.putPhoto': ['hr.manage'],
      'HrCardsController.removePhoto': ['hr.manage'],
      'HrCardsController.issue': ['hr.manage'],
      'HrCardsController.revoke': ['hr.manage'],
      'HrCardsController.export': ['hr.read'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) => r.cle.startsWith('HrCardsController.'));
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });

  it('les deux seules routes publiques sont celles de la vérification, justifiées', () => {
    const routes = TOUTES_LES_ROUTES.filter((r) => r.cle.startsWith('PublicCardsController.'));
    expect(routes.map((r) => r.cle).sort()).toEqual([
      'PublicCardsController.photo',
      'PublicCardsController.verify',
    ]);
    for (const r of routes) {
      expect(r.actions ?? [], r.cle).toEqual([]);
      expect(SANS_PERMISSION[r.cle], r.cle).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0068, amendement du 8 nov. 2026 : changement de poste, modèle d'import XLSX
// ─────────────────────────────────────────────────────────────────────────────

import { HrPositionChangeController } from '../hr/positions/hr-position-change.controller.js';

const CONTROLEURS_ADR68_SUITE = [HrPositionChangeController];
(CONTROLEURS as unknown[]).push(...CONTROLEURS_ADR68_SUITE);
TOUTES_LES_ROUTES.push(
  ...CONTROLEURS_ADR68_SUITE.flatMap((c) => routesDe(c as new (...args: never[]) => unknown)),
);

describe('ADR-0068, amendement du 8 nov. 2026', () => {
  it('changer de poste exige `hr.manage`', () => {
    const attendu: Record<string, Action[]> = {
      'HrPositionChangeController.change': ['hr.manage'],
    };
    const routes = TOUTES_LES_ROUTES.filter((r) =>
      /^HrPositionChangeController\./.test(r.cle),
    );
    expect(routes.map((r) => r.cle).sort()).toEqual(Object.keys(attendu).sort());
    for (const [cle, actions] of Object.entries(attendu)) {
      const route = routes.find((r) => r.cle === cle);
      expect(route!.actions, cle).toEqual(actions);
      expect(SANS_PERMISSION[cle], cle).toBeUndefined();
    }
  });
});
