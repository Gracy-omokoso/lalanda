// Catalogue des événements notifiés de tout Lalanda — ADR-0079 § 2.
//
// Pour chaque type de la boîte commune (`NOTIFICATION_KINDS`) : module, famille,
// libellé (à la première personne : ce que la personne règle), audience (qui le reçoit
// selon sa relation à l'objet), palier (dans quels modes il est actif), importance
// (sur quels canaux il part par défaut), canaux PERMIS, modèle WhatsApp.
//
// ── Modes (validés par la dirigeante le 17 nov. 2026) ──────────────────────────
//
//   Perroquet  : tout, partout.
//   Atténué    : ce qui me concerne ET la vie des projets que je dirige.
//   Essentiel  : ce qui me concerne directement.
//
// Palier d'un événement = le mode le PLUS CALME qui l'active (`essentiel` : actif dans
// les trois ; `attenue` : Atténué et Perroquet ; `perroquet` : Perroquet seulement).
//
// Canaux par défaut d'un événement actif (importance × mode) :
//
//   | importance | Essentiel           | Atténué               | Perroquet                    |
//   |------------|---------------------|-----------------------|------------------------------|
//   | urgent     | cloche, e-mail, Slack, WhatsApp (les trois modes)                          |
//   | important  | cloche, e-mail      | cloche, e-mail, Slack | cloche, e-mail, Slack, WhatsApp |
//   | info       | cloche              | cloche                | cloche, e-mail, Slack        |
//
// Le résultat est ensuite RESTREINT aux canaux permis de l'événement (ex. RH : cloche et
// e-mail seulement), puis personnalisé par la personne (surcharges PAR MODE), puis
// complété par les notifications rendues obligatoires par l'organisation.
//
// Ce fichier n'importe que des TYPES de `index.ts` (pas de cycle à l'exécution).

import type { NotificationKind, NotificationSourceModule } from './index.js';

export const NOTIFICATION_CHANNELS = ['bell', 'email', 'slack', 'whatsapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CHANNEL_LABELS: Readonly<Record<NotificationChannel, string>> = {
  bell: 'Cloche',
  email: 'E-mail',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
};

/** Modes, du plus bavard au plus calme. */
export const NOTIFICATION_MODES = ['perroquet', 'attenue', 'essentiel'] as const;
export type NotificationMode = (typeof NOTIFICATION_MODES)[number];

export const NOTIFICATION_MODE_LABELS: Readonly<Record<NotificationMode, string>> = {
  perroquet: 'Perroquet',
  attenue: 'Atténué',
  essentiel: 'Essentiel',
};

/** Explication courte de chaque mode (cartes de l'écran « Mes notifications »). */
export const NOTIFICATION_MODE_DESCRIPTIONS: Readonly<Record<NotificationMode, string>> = {
  perroquet:
    'Tout, partout : chaque mouvement de vos projets et de vos modules, aussi par e-mail et Slack.',
  attenue:
    'Ce qui vous concerne, plus la vie des projets que vous dirigez (tâches créées, terminées, commentaires).',
  essentiel:
    'Seulement ce qui vous concerne directement : assignations, mentions, validations, échéances.',
};

/** Palier : le mode le plus calme qui active l'événement. */
export type NotificationTier = NotificationMode;

export const NOTIFICATION_IMPORTANCES = ['urgent', 'important', 'info'] as const;
export type NotificationImportance = (typeof NOTIFICATION_IMPORTANCES)[number];

/** Relation du destinataire avec l'objet notifié. */
export const NOTIFICATION_AUDIENCES = [
  'assignee',
  'collaborators',
  'followers',
  'mentioned',
  'project_lead',
  'project_members',
  'approver',
  'requester',
  'manager',
  'permission_holders',
  'record_owner',
  'concerned',
] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_AUDIENCE_LABELS: Readonly<Record<NotificationAudience, string>> = {
  assignee: 'responsable de la tâche',
  collaborators: 'collaborateurs',
  followers: 'abonnés',
  mentioned: 'personne mentionnée',
  project_lead: 'chef et adjoint du projet',
  project_members: 'membres du projet',
  approver: 'valideur',
  requester: 'demandeur',
  manager: 'manager',
  permission_holders: 'détenteurs du droit',
  record_owner: 'responsable de la fiche',
  concerned: 'personne concernée',
};

/** Modules réglables, dans l'ordre de l'écran. */
export const NOTIFICATION_MODULE_LABELS: Readonly<Record<NotificationSourceModule, string>> = {
  work: 'Projets',
  crm: 'CRM',
  sales: 'Ventes',
  purchases: 'Achats',
  hr: 'Ressources humaines',
  stock: 'Stocks',
  assets: 'Équipements',
  documents: 'Documents',
  organization: 'Organisation',
};

export const NOTIFICATION_FAMILIES = {
  'work.tasks': 'Tâches',
  'work.approvals': 'Validation',
  'work.exchanges': 'Échanges',
  'work.milestones': 'Jalons et facturation',
  'work.project': 'Projet',
  'work.time': 'Temps',
  'crm.activities': 'Relances',
  'crm.opportunities': 'Opportunités',
  'sales.contracts': 'Contrats',
  'sales.subscriptions': 'Abonnements',
  'purchases.approvals': 'Demandes et approbations',
  'purchases.invoices': 'Factures fournisseurs',
  'purchases.suppliers': 'Fournisseurs',
  'hr.leave': 'Absences',
  'hr.records': 'Contrats, essais et documents',
  'hr.onboarding': 'Listes d’accueil et de départ',
  'hr.expenses': 'Frais et avances',
  'hr.attendance': 'Pointage et plannings',
  'hr.performance': 'Évaluations et objectifs',
  'stock.levels': 'Niveaux de stock',
  'stock.counts': 'Inventaires',
  'assets.reminders': 'Entretien et couvertures',
  'documents.expiry': 'Échéances',
  'organization.access': 'Accès et autorisations',
} as const;
export type NotificationFamily = keyof typeof NOTIFICATION_FAMILIES;

/** Modèle WhatsApp générique hors Projets (ADR-0079 § 7) — à faire approuver par Meta. */
export const WHATSAPP_GENERIC_TEMPLATE = 'lalanda_notification_generale';
/** Modèle WhatsApp des validations hors Projets (ADR-0079 § 7) — à faire approuver. */
export const WHATSAPP_APPROVAL_TEMPLATE = 'lalanda_validation_attendue';

export interface NotificationEventSpec {
  kind: NotificationKind;
  module: NotificationSourceModule;
  family: NotificationFamily;
  /** Libellé à la première personne (« Une tâche m’est assignée »). */
  label: string;
  /** Qui le reçoit (« Le responsable et les collaborateurs »). */
  recipients: string;
  audience: readonly NotificationAudience[];
  tier: NotificationTier;
  importance: NotificationImportance;
  /** Canaux PERMIS (le réglage ne peut pas en ajouter d'autres). */
  channels: readonly NotificationChannel[];
  /** Modèle WhatsApp (Meta) utilisé ; `null` : pas de WhatsApp pour cet événement. */
  whatsappTemplate: string | null;
  /** Regroupement des rafales : « 5 nouveaux commentaires — … » (§ 5). */
  burst?: { noun: string };
}

const ALL: readonly NotificationChannel[] = NOTIFICATION_CHANNELS;
/** RH : jamais hors de Lalanda et de la boîte e-mail (ADR-0079 § 2, confidentialité). */
const PRIVATE: readonly NotificationChannel[] = ['bell', 'email'];
const PROJECT_TEMPLATE = 'lalanda_notification_projet';

type Row = Omit<NotificationEventSpec, 'kind' | 'module' | 'channels' | 'whatsappTemplate'> & {
  channels?: readonly NotificationChannel[];
  whatsappTemplate?: string | null;
};

function work(r: Row): Omit<NotificationEventSpec, 'kind'> {
  return {
    module: 'work',
    channels: ALL,
    whatsappTemplate: PROJECT_TEMPLATE,
    ...r,
  };
}
function mod(module: NotificationSourceModule, r: Row): Omit<NotificationEventSpec, 'kind'> {
  const approval = r.importance === 'urgent';
  return {
    module,
    channels: ALL,
    whatsappTemplate: approval ? WHATSAPP_APPROVAL_TEMPLATE : WHATSAPP_GENERIC_TEMPLATE,
    ...r,
  };
}
function hr(r: Row): Omit<NotificationEventSpec, 'kind'> {
  return { module: 'hr', channels: PRIVATE, whatsappTemplate: null, ...r };
}

const SPECS: Record<
  Exclude<NotificationKind, 'platform.announcement' | 'organization.notification_test'>,
  Omit<NotificationEventSpec, 'kind'>
> = {
  // ── Projets · Tâches ──────────────────────────────────────────────────────
  'work.task_created': work({
    family: 'work.tasks',
    label: 'Une tâche est créée dans un projet que je dirige',
    recipients: 'Le chef et l’adjoint du projet',
    audience: ['project_lead'],
    tier: 'attenue',
    importance: 'info',
  }),
  'work.task_assigned': work({
    family: 'work.tasks',
    label: 'Une tâche m’est assignée',
    recipients: 'Le nouveau responsable de la tâche',
    audience: ['assignee'],
    tier: 'essentiel',
    importance: 'urgent',
    whatsappTemplate: 'lalanda_tache_assignee',
  }),
  'work.task_due_date_changed': work({
    family: 'work.tasks',
    label: 'L’échéance d’une de mes tâches change',
    recipients: 'Le responsable et les collaborateurs ; le chef et l’adjoint',
    audience: ['assignee', 'collaborators', 'project_lead'],
    tier: 'essentiel',
    importance: 'info',
  }),
  'work.task_completed': work({
    family: 'work.tasks',
    label: 'Une tâche est terminée',
    recipients: 'Le chef et l’adjoint du projet, les abonnés',
    audience: ['project_lead', 'followers'],
    tier: 'attenue',
    importance: 'info',
  }),
  'work.task_reopened': work({
    family: 'work.tasks',
    label: 'Une tâche est rouverte',
    recipients: 'Le responsable, le chef et l’adjoint',
    audience: ['assignee', 'project_lead'],
    tier: 'attenue',
    importance: 'info',
  }),
  'work.task_status_changed': work({
    family: 'work.tasks',
    label: 'Statut (colonne) d’une de mes tâches changé',
    recipients: 'Le responsable et les collaborateurs',
    audience: ['assignee', 'collaborators'],
    tier: 'essentiel',
    importance: 'info',
  }),
  'work.task_due_soon': work({
    family: 'work.tasks',
    label: 'Échéance proche d’une de mes tâches',
    recipients: 'Le responsable de la tâche',
    audience: ['assignee'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'work.task_overdue': work({
    family: 'work.tasks',
    label: 'Échéance dépassée d’une de mes tâches',
    recipients: 'Le responsable de la tâche',
    audience: ['assignee'],
    tier: 'essentiel',
    importance: 'urgent',
    whatsappTemplate: 'lalanda_echeance_depassee',
  }),
  // ADR-0080 : seulement pour une échéance avec heure ; Essentiel · important (cloche et
  // e-mail dans les trois modes, Slack dès Atténué, WhatsApp en Perroquet).
  'work.task_due_in_hour': work({
    family: 'work.tasks',
    label: 'Échéance dans une heure d’une de mes tâches',
    recipients: 'Le responsable de la tâche',
    audience: ['assignee'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'work.project_task_overdue': work({
    family: 'work.tasks',
    label: 'Une tâche d’un projet que je dirige est en retard',
    recipients: 'Le chef et l’adjoint du projet',
    audience: ['project_lead'],
    tier: 'attenue',
    importance: 'important',
  }),
  'work.task_collaborator_added': work({
    family: 'work.tasks',
    label: 'Je suis ajouté comme collaborateur d’une tâche',
    recipients: 'Le collaborateur ajouté',
    audience: ['collaborators'],
    tier: 'essentiel',
    importance: 'important',
  }),
  // ── Projets · Validation ──────────────────────────────────────────────────
  'work.task_approval_requested': work({
    family: 'work.approvals',
    label: 'Une tâche attend ma validation',
    recipients: 'Le valideur (à défaut le chef, puis l’adjoint)',
    audience: ['approver'],
    tier: 'essentiel',
    importance: 'urgent',
  }),
  'work.task_approval_decided': work({
    family: 'work.approvals',
    label: 'Ma tâche a été validée, renvoyée ou refusée',
    recipients: 'Le responsable de la tâche',
    audience: ['assignee'],
    tier: 'essentiel',
    importance: 'important',
  }),
  // ── Projets · Échanges ────────────────────────────────────────────────────
  'work.mentioned': work({
    family: 'work.exchanges',
    label: 'Je suis mentionné',
    recipients: 'Les personnes mentionnées',
    audience: ['mentioned'],
    tier: 'essentiel',
    importance: 'urgent',
    whatsappTemplate: 'lalanda_mention',
  }),
  'work.comment_on_followed': work({
    family: 'work.exchanges',
    label: 'Commentaire sur une tâche que je suis',
    recipients: 'Les abonnés de la tâche',
    audience: ['followers'],
    tier: 'essentiel',
    importance: 'info',
    burst: { noun: 'nouveaux commentaires' },
  }),
  'work.comment_added': work({
    family: 'work.exchanges',
    label: 'Commentaire dans un projet que je dirige',
    recipients: 'Le chef et l’adjoint (s’ils ne suivent pas déjà la tâche)',
    audience: ['project_lead'],
    tier: 'attenue',
    importance: 'info',
    burst: { noun: 'nouveaux commentaires' },
  }),
  'work.attachment_added': work({
    family: 'work.exchanges',
    label: 'Pièce jointe ajoutée à une tâche qui me concerne',
    recipients: 'Le responsable, les collaborateurs, les abonnés ; le chef et l’adjoint',
    audience: ['assignee', 'collaborators', 'followers', 'project_lead'],
    tier: 'attenue',
    importance: 'info',
    burst: { noun: 'nouvelles pièces jointes' },
  }),
  // ── Projets · Jalons et facturation ───────────────────────────────────────
  'work.milestone_completed': work({
    family: 'work.milestones',
    label: 'Un jalon d’un projet que je dirige est atteint',
    recipients: 'Le chef du projet',
    audience: ['project_lead'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'work.invoice_draft_prepared': work({
    family: 'work.milestones',
    label: 'Un brouillon de facture est préparé pour un de mes jalons',
    recipients: 'Le chef et l’adjoint du projet',
    audience: ['project_lead'],
    tier: 'attenue',
    importance: 'important',
  }),
  // ── Projets · Projet ──────────────────────────────────────────────────────
  'work.added_to_project': work({
    family: 'work.project',
    label: 'Je suis ajouté à un projet',
    recipients: 'Les personnes ajoutées et les membres des équipes ajoutées',
    audience: ['project_members'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'work.project_member_added': work({
    family: 'work.project',
    label: 'Un membre rejoint un projet que je dirige',
    recipients: 'Le chef et l’adjoint du projet',
    audience: ['project_lead'],
    tier: 'attenue',
    importance: 'info',
  }),
  'work.project_status_posted': work({
    family: 'work.project',
    label: 'Nouveau statut d’un de mes projets',
    recipients: 'Le chef, l’adjoint et les membres du projet',
    audience: ['project_members', 'project_lead'],
    tier: 'essentiel',
    importance: 'info',
  }),
  'work.project_at_risk': work({
    family: 'work.project',
    label: 'Un de mes projets passe à risque',
    recipients: 'Le chef et les membres du projet',
    audience: ['project_lead', 'project_members'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'work.project_archived': work({
    family: 'work.project',
    label: 'Un de mes projets est archivé',
    recipients: 'Le chef, l’adjoint et les membres du projet',
    audience: ['project_lead', 'project_members'],
    tier: 'attenue',
    importance: 'info',
  }),
  'work.project_restored': work({
    family: 'work.project',
    label: 'Un de mes projets est restauré',
    recipients: 'Le chef, l’adjoint et les membres du projet',
    audience: ['project_lead', 'project_members'],
    tier: 'attenue',
    importance: 'info',
  }),
  'work.project_created': work({
    family: 'work.project',
    label: 'Un projet est créé depuis un devis, une opportunité ou un contrat',
    recipients: 'Le chef désigné ; à défaut, les gestionnaires des projets',
    audience: ['project_lead', 'permission_holders'],
    tier: 'essentiel',
    importance: 'info',
  }),
  // ── Projets · Temps (ADR-0077 § 4) ────────────────────────────────────────
  'work.timesheet_submitted': work({
    family: 'work.time',
    label: 'Une feuille de temps attend ma validation',
    recipients: 'Le manager ; à défaut, les gestionnaires des projets',
    audience: ['manager', 'permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'work.timesheet_approved': work({
    family: 'work.time',
    label: 'Ma feuille de temps est validée',
    recipients: 'La personne dont la semaine est validée',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'info',
  }),
  'work.timesheet_returned': work({
    family: 'work.time',
    label: 'Ma feuille de temps m’est renvoyée',
    recipients: 'La personne dont la semaine est renvoyée',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'work.timesheet_reopened': work({
    family: 'work.time',
    label: 'Ma feuille de temps validée est rouverte',
    recipients: 'La personne dont la semaine est rouverte',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'important',
  }),
  // ── Projets · Membres externes (ADR-0078) ─────────────────────────────────
  'work.client_approved': work({
    family: 'work.approvals',
    label: 'Le client valide un livrable',
    recipients: 'Le responsable, les collaborateurs, le chef et l’adjoint',
    audience: ['assignee', 'collaborators', 'project_lead'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'work.client_changes_requested': work({
    family: 'work.approvals',
    label: 'Le client demande des modifications',
    recipients: 'Le responsable, les collaborateurs, le chef et l’adjoint (motif dans Lalanda)',
    audience: ['assignee', 'collaborators', 'project_lead'],
    tier: 'essentiel',
    importance: 'urgent',
  }),
  'work.external_comment': work({
    family: 'work.exchanges',
    label: 'Un client ou un consultant commente',
    recipients: 'Le responsable, les collaborateurs, les abonnés, le chef et l’adjoint',
    audience: ['assignee', 'collaborators', 'followers', 'project_lead'],
    tier: 'essentiel',
    importance: 'important',
    burst: { noun: 'nouveaux commentaires externes' },
  }),
  'work.consultant_time_logged': work({
    family: 'work.time',
    label: 'Un consultant que je suis saisit du temps',
    recipients: 'Le référent interne du consultant',
    audience: ['manager'],
    tier: 'essentiel',
    importance: 'info',
    burst: { noun: 'saisies de temps' },
  }),
  // ── CRM (ADR-0040) ────────────────────────────────────────────────────────
  'crm.activity_assigned': mod('crm', {
    family: 'crm.activities',
    label: 'Une relance m’est assignée',
    recipients: 'Le responsable de la relance',
    audience: ['assignee'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'crm.activity_due_soon': mod('crm', {
    family: 'crm.activities',
    label: 'Une de mes relances arrive à échéance',
    recipients: 'Le responsable de la relance',
    audience: ['assignee'],
    tier: 'essentiel',
    importance: 'info',
  }),
  'crm.activity_overdue': mod('crm', {
    family: 'crm.activities',
    label: 'Une de mes relances est en retard',
    recipients: 'Le responsable de la relance',
    audience: ['assignee'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'crm.opportunity_assigned': mod('crm', {
    family: 'crm.opportunities',
    label: 'Une opportunité m’est confiée',
    recipients: 'Le responsable de l’opportunité',
    audience: ['record_owner'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'crm.opportunity_won': mod('crm', {
    family: 'crm.opportunities',
    label: 'Une opportunité est gagnée',
    recipients: 'Le responsable de l’opportunité',
    audience: ['record_owner'],
    tier: 'essentiel',
    importance: 'info',
  }),
  // ── Organisation (ADR-0041) ───────────────────────────────────────────────
  'organization.permissions_changed': mod('organization', {
    family: 'organization.access',
    label: 'Mes autorisations changent',
    recipients: 'Le membre concerné',
    audience: ['concerned'],
    tier: 'essentiel',
    importance: 'important',
  }),
  // ── Achats (ADR-0044) ─────────────────────────────────────────────────────
  'purchases.approval_requested': mod('purchases', {
    family: 'purchases.approvals',
    label: 'Une demande d’achat attend mon approbation',
    recipients: 'Les approbateurs (détenteurs du droit d’approuver)',
    audience: ['approver', 'permission_holders'],
    tier: 'essentiel',
    importance: 'urgent',
  }),
  'purchases.request_approved': mod('purchases', {
    family: 'purchases.approvals',
    label: 'Ma demande d’achat est approuvée',
    recipients: 'Le demandeur',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'purchases.request_rejected': mod('purchases', {
    family: 'purchases.approvals',
    label: 'Ma demande d’achat est refusée',
    recipients: 'Le demandeur',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'purchases.invoice_variance': mod('purchases', {
    family: 'purchases.invoices',
    label: 'Une facture fournisseur présente un écart',
    recipients: 'Les détenteurs du droit de valider les factures fournisseurs',
    audience: ['permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'purchases.invoice_due_soon': mod('purchases', {
    family: 'purchases.invoices',
    label: 'Une facture fournisseur arrive à échéance',
    recipients: 'Les détenteurs du droit de payer',
    audience: ['permission_holders'],
    tier: 'essentiel',
    importance: 'info',
  }),
  'purchases.invoice_overdue': mod('purchases', {
    family: 'purchases.invoices',
    label: 'Une facture fournisseur est en retard de paiement',
    recipients: 'Les détenteurs du droit de payer',
    audience: ['permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'purchases.supplier_payment_details_changed': mod('purchases', {
    family: 'purchases.suppliers',
    label: 'Les coordonnées de paiement d’un fournisseur changent',
    recipients: 'Les détenteurs du droit de payer (contrôle anti-fraude)',
    audience: ['permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  // ── Ressources humaines (ADR-0045, ADR-0051) : cloche et e-mail seulement ─
  'hr.leave_requested': hr({
    family: 'hr.leave',
    label: 'Une demande d’absence attend ma décision',
    recipients: 'Le manager ; à défaut, les détenteurs du droit RH',
    audience: ['manager', 'permission_holders'],
    tier: 'essentiel',
    importance: 'urgent',
  }),
  'hr.leave_approved': hr({
    family: 'hr.leave',
    label: 'Ma demande d’absence est approuvée',
    recipients: 'Le demandeur',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.leave_rejected': hr({
    family: 'hr.leave',
    label: 'Ma demande d’absence est refusée',
    recipients: 'Le demandeur',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.leave_cancelled': hr({
    family: 'hr.leave',
    label: 'Une absence est annulée',
    recipients: 'Le manager ou le demandeur',
    audience: ['manager', 'requester'],
    tier: 'essentiel',
    importance: 'info',
  }),
  'hr.probation_ending': hr({
    family: 'hr.records',
    label: 'Une période d’essai se termine bientôt',
    recipients: 'Le manager et les détenteurs du droit RH',
    audience: ['manager', 'permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.contract_ending': hr({
    family: 'hr.records',
    label: 'Un contrat de travail se termine bientôt',
    recipients: 'Le manager et les détenteurs du droit RH',
    audience: ['manager', 'permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.document_expiring': hr({
    family: 'hr.records',
    label: 'Un document RH expire bientôt',
    recipients: 'La personne concernée et les détenteurs du droit RH',
    audience: ['concerned', 'permission_holders'],
    tier: 'essentiel',
    importance: 'info',
  }),
  'hr.checklist_item_assigned': hr({
    family: 'hr.onboarding',
    label: 'Une étape d’accueil ou de départ m’est confiée',
    recipients: 'Le responsable de l’étape',
    audience: ['assignee'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.bank_details_changed': hr({
    family: 'hr.records',
    label: 'Des coordonnées bancaires changent',
    recipients: 'La personne concernée et les détenteurs du droit de paie',
    audience: ['concerned', 'permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.expense_submitted': hr({
    family: 'hr.expenses',
    label: 'Une note de frais attend ma décision',
    recipients: 'Le manager ; à défaut, les détenteurs du droit',
    audience: ['manager', 'permission_holders'],
    tier: 'essentiel',
    importance: 'urgent',
  }),
  'hr.expense_approved': hr({
    family: 'hr.expenses',
    label: 'Ma note de frais est approuvée',
    recipients: 'Le demandeur',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.expense_rejected': hr({
    family: 'hr.expenses',
    label: 'Ma note de frais est refusée',
    recipients: 'Le demandeur',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.expense_reimbursed': hr({
    family: 'hr.expenses',
    label: 'Ma note de frais est remboursée',
    recipients: 'Le demandeur',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'info',
  }),
  'hr.advance_submitted': hr({
    family: 'hr.expenses',
    label: 'Une demande d’avance attend ma décision',
    recipients: 'Le manager ; à défaut, les détenteurs du droit',
    audience: ['manager', 'permission_holders'],
    tier: 'essentiel',
    importance: 'urgent',
  }),
  'hr.advance_decided': hr({
    family: 'hr.expenses',
    label: 'Ma demande d’avance est décidée',
    recipients: 'Le demandeur',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.advance_disbursed': hr({
    family: 'hr.expenses',
    label: 'Mon avance est versée',
    recipients: 'Le demandeur',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'info',
  }),
  'hr.advance_overdue': hr({
    family: 'hr.expenses',
    label: 'Une avance n’est pas régularisée à temps',
    recipients: 'Les détenteurs du droit',
    audience: ['permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.attendance_correction_requested': hr({
    family: 'hr.attendance',
    label: 'Une correction de pointage attend ma décision',
    recipients: 'Le manager ; à défaut, les détenteurs du droit',
    audience: ['manager', 'permission_holders'],
    tier: 'essentiel',
    importance: 'urgent',
  }),
  'hr.attendance_correction_decided': hr({
    family: 'hr.attendance',
    label: 'Ma correction de pointage est décidée',
    recipients: 'Le demandeur',
    audience: ['requester'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.shifts_published': hr({
    family: 'hr.attendance',
    label: 'Mon planning est publié',
    recipients: 'Les personnes planifiées',
    audience: ['concerned'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.shift_changed': hr({
    family: 'hr.attendance',
    label: 'Un de mes créneaux change',
    recipients: 'La personne planifiée',
    audience: ['concerned'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.review_step': hr({
    family: 'hr.performance',
    label: 'Une étape d’évaluation m’attend',
    recipients: 'L’évalué ou l’évaluateur',
    audience: ['concerned', 'manager'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'hr.goal_proposed': hr({
    family: 'hr.performance',
    label: 'Un objectif m’est proposé',
    recipients: 'L’évalué ou le manager',
    audience: ['concerned', 'manager'],
    tier: 'essentiel',
    importance: 'info',
  }),
  'hr.goal_agreed': hr({
    family: 'hr.performance',
    label: 'Un objectif est convenu',
    recipients: 'L’évalué et le manager',
    audience: ['concerned', 'manager'],
    tier: 'essentiel',
    importance: 'info',
  }),
  // ── Stocks, équipements, documents (ADR-0046) ─────────────────────────────
  'stock.below_reorder': mod('stock', {
    family: 'stock.levels',
    label: 'Un article passe sous son seuil de réapprovisionnement',
    recipients: 'Les détenteurs du droit de gérer le stock',
    audience: ['permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'stock.negative': mod('stock', {
    family: 'stock.levels',
    label: 'Un stock devient négatif',
    recipients: 'Les détenteurs du droit de gérer le stock',
    audience: ['permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'stock.pending_lines': mod('stock', {
    family: 'stock.levels',
    label: 'Des lignes de stock sont à traiter',
    recipients: 'Les détenteurs du droit de gérer le stock',
    audience: ['permission_holders'],
    tier: 'essentiel',
    importance: 'info',
  }),
  'stock.count_assigned': mod('stock', {
    family: 'stock.counts',
    label: 'Un inventaire m’est confié',
    recipients: 'Le compteur désigné',
    audience: ['assignee'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'stock.count_submitted': mod('stock', {
    family: 'stock.counts',
    label: 'Un inventaire attend ma validation',
    recipients: 'Les détenteurs du droit de valider',
    audience: ['approver', 'permission_holders'],
    tier: 'essentiel',
    importance: 'urgent',
  }),
  'assets.maintenance_due': mod('assets', {
    family: 'assets.reminders',
    label: 'Un entretien d’équipement est à prévoir',
    recipients: 'Le responsable de l’équipement et les gestionnaires',
    audience: ['record_owner', 'permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'assets.coverage_expiring': mod('assets', {
    family: 'assets.reminders',
    label: 'Une garantie ou une assurance d’équipement expire bientôt',
    recipients: 'Les gestionnaires des équipements',
    audience: ['permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'documents.expiring': mod('documents', {
    family: 'documents.expiry',
    label: 'Un document de la bibliothèque expire bientôt',
    recipients: 'Les gestionnaires des documents',
    audience: ['permission_holders'],
    tier: 'essentiel',
    importance: 'info',
  }),
  // ── Ventes · contrats et abonnements (ADR-0050) ───────────────────────────
  'sales.contract_submitted': mod('sales', {
    family: 'sales.contracts',
    label: 'Un contrat client attend mon approbation',
    recipients: 'Les détenteurs du droit d’approuver les contrats',
    audience: ['approver', 'permission_holders'],
    tier: 'essentiel',
    importance: 'urgent',
  }),
  'sales.contract_approved': mod('sales', {
    family: 'sales.contracts',
    label: 'Un contrat que j’ai soumis est approuvé',
    recipients: 'Le responsable du contrat',
    audience: ['record_owner'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'sales.contract_rejected': mod('sales', {
    family: 'sales.contracts',
    label: 'Un contrat que j’ai soumis est refusé',
    recipients: 'Le responsable du contrat',
    audience: ['record_owner'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'sales.contract_notice_due': mod('sales', {
    family: 'sales.contracts',
    label: 'Le préavis d’un contrat approche',
    recipients: 'Le responsable du contrat et les détenteurs du droit',
    audience: ['record_owner', 'permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'sales.contract_term_ending': mod('sales', {
    family: 'sales.contracts',
    label: 'Un contrat arrive à son terme',
    recipients: 'Le responsable du contrat et les détenteurs du droit',
    audience: ['record_owner', 'permission_holders'],
    tier: 'essentiel',
    importance: 'important',
  }),
  'sales.subscription_drafts_ready': mod('sales', {
    family: 'sales.subscriptions',
    label: 'Les brouillons de factures d’abonnement sont prêts',
    recipients: 'Les détenteurs du droit de facturer',
    audience: ['permission_holders'],
    tier: 'essentiel',
    importance: 'info',
  }),
};

/** Catalogue complet des événements RÉGLABLES (hors annonces et tests). */
export const NOTIFICATION_CATALOG: Readonly<Record<string, NotificationEventSpec>> =
  Object.fromEntries(
    Object.entries(SPECS).map(([kind, spec]) => [
      kind,
      { kind: kind as NotificationKind, ...spec },
    ]),
  );

/** Types réglables, dans l'ordre du catalogue (module, famille). */
export const CONFIGURABLE_NOTIFICATION_KINDS = Object.keys(SPECS) as NotificationKind[];

export function notificationSpecOf(kind: string): NotificationEventSpec | null {
  return NOTIFICATION_CATALOG[kind] ?? null;
}

export type NotificationChannelSet = Record<NotificationChannel, boolean>;
export type NotificationChannelOverride = Partial<NotificationChannelSet>;
/** Surcharges d'UN mode : par type, par canal. */
export type NotificationModeOverrides = Partial<
  Record<NotificationKind, NotificationChannelOverride>
>;

const MODE_RANK: Readonly<Record<NotificationMode, number>> = {
  essentiel: 0,
  attenue: 1,
  perroquet: 2,
};

/** Un événement de ce palier est-il actif dans ce mode ? */
export function tierActiveIn(tier: NotificationTier, mode: NotificationMode): boolean {
  return MODE_RANK[mode] >= MODE_RANK[tier];
}

function none(): NotificationChannelSet {
  return { bell: false, email: false, slack: false, whatsapp: false };
}

/** Canaux par défaut d'un événement dans un mode (table de l'en-tête), restreints aux permis. */
export function defaultChannelsFor(
  spec: NotificationEventSpec,
  mode: NotificationMode,
): NotificationChannelSet {
  const out = none();
  if (!tierActiveIn(spec.tier, mode)) return out;
  out.bell = true;
  if (spec.importance === 'urgent') {
    out.email = true;
    out.slack = true;
    out.whatsapp = true;
  } else if (spec.importance === 'important') {
    out.email = true;
    out.slack = mode !== 'essentiel';
    out.whatsapp = mode === 'perroquet';
  } else {
    out.email = mode === 'perroquet';
    out.slack = mode === 'perroquet';
  }
  for (const c of NOTIFICATION_CHANNELS) if (!spec.channels.includes(c)) out[c] = false;
  return out;
}

/** Notification rendue obligatoire par l'organisation, sur un canal. */
export interface MandatoryNotification {
  kind: NotificationKind;
  channel: NotificationChannel;
}

/**
 * Canaux EFFECTIFS d'un événement : défauts du mode, surcharges de la personne pour CE
 * mode, restreints aux canaux permis, types coupés de l'ancienne page (cloche), puis
 * obligations de l'organisation (qui l'emportent toujours). Pur : partagé par le
 * serveur (envoi) et l'écran (aperçu en direct).
 */
export function effectiveChannels(input: {
  spec: NotificationEventSpec;
  mode: NotificationMode;
  overrides?: NotificationModeOverrides | null;
  mutedKinds?: readonly string[] | null;
  mandatory?: readonly MandatoryNotification[] | null;
}): NotificationChannelSet {
  const { spec } = input;
  const out = defaultChannelsFor(spec, input.mode);
  const over = input.overrides?.[spec.kind];
  if (over) {
    for (const c of NOTIFICATION_CHANNELS) {
      const v = over[c];
      if (typeof v === 'boolean') out[c] = v && spec.channels.includes(c);
    }
  }
  if (input.mutedKinds?.includes(spec.kind)) out.bell = false;
  for (const m of input.mandatory ?? []) {
    if (m.kind === spec.kind && spec.channels.includes(m.channel)) out[m.channel] = true;
  }
  return out;
}

/** Le mode est-il personnalisé (au moins une surcharge qui diffère du défaut) ? */
export function isModeCustomized(
  mode: NotificationMode,
  overrides: NotificationModeOverrides | null | undefined,
): boolean {
  if (!overrides) return false;
  for (const [kind, over] of Object.entries(overrides)) {
    const spec = notificationSpecOf(kind);
    if (!spec || !over) continue;
    const base = defaultChannelsFor(spec, mode);
    for (const c of NOTIFICATION_CHANNELS) {
      const v = over[c];
      if (typeof v === 'boolean' && spec.channels.includes(c) && v !== base[c]) return true;
    }
  }
  return false;
}

/**
 * Surcharges minimales qui donnent `wanted` dans `mode` : seules les valeurs qui
 * diffèrent du défaut sont gardées (conversion des anciennes préférences, § 4.3).
 */
export function overridesFor(
  mode: NotificationMode,
  wanted: Partial<Record<NotificationKind, NotificationChannelOverride>>,
): NotificationModeOverrides {
  const out: NotificationModeOverrides = {};
  for (const [kind, w] of Object.entries(wanted)) {
    const spec = notificationSpecOf(kind);
    if (!spec || !w) continue;
    const base = defaultChannelsFor(spec, mode);
    const diff: NotificationChannelOverride = {};
    for (const c of NOTIFICATION_CHANNELS) {
      const v = w[c];
      if (typeof v === 'boolean' && spec.channels.includes(c) && v !== base[c]) diff[c] = v;
    }
    if (Object.keys(diff).length > 0) out[kind as NotificationKind] = diff;
  }
  return out;
}

/** « Perroquet (personnalisé) ». */
export function modeDisplayLabel(mode: NotificationMode, customized: boolean): string {
  return customized
    ? `${NOTIFICATION_MODE_LABELS[mode]} (personnalisé)`
    : NOTIFICATION_MODE_LABELS[mode];
}

/** Titre d'une rafale regroupée (§ 5) : « 3 nouveaux commentaires — <dernier titre> ». */
export function burstTitle(count: number, noun: string, latestTitle: string, max = 200): string {
  const t = `${count} ${noun} — ${latestTitle}`;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
