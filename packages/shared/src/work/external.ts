// Membres externes d'un projet — ADR-0078.
//
//   - Contact client : relié à la fiche client de l'organisation, invité sur des projets
//     `kind: client` de CE client seulement ;
//   - Consultant : relié à une fiche fournisseur, membre du projet, voit ses tâches (ou le
//     projet si « peut ouvrir le projet »), saisit son temps valorisé au taux d'achat.
//
// Les deux se connectent à l'espace externe (`/portail`) par un compte propre et un code à
// usage unique reçu par e-mail À CHAQUE connexion. Aucun montant, aucune marge, aucun coût
// ne figure dans les vues de l'espace externe.
//
// Contrats zod partagés par l'API et le web. Les règles qui exigent la base (fiche du
// client, projet du client, référent) sont vérifiées par le service.

import { z } from 'zod';

import { WORK_RATE_CURRENCIES } from './constants.js';
import { WorkDay, WorkId } from './schemas.js';
import type { WorkMemberRef } from './views.js';

// ── Constantes ──────────────────────────────────────────────────────────────

/** Genre d'un compte externe (un seul type de compte, deux genres). */
export const WORK_EXTERNAL_KINDS = ['client', 'consultant'] as const;
export type WorkExternalKind = (typeof WORK_EXTERNAL_KINDS)[number];

export const WORK_EXTERNAL_KIND_LABELS: Readonly<Record<WorkExternalKind, string>> = {
  client: 'Contact client',
  consultant: 'Consultant',
};

/** Bornes de la connexion par code (ADR-0078 § 3). */
export const WORK_EXTERNAL_AUTH = {
  /** Code numérique à six chiffres (saisi par `OtpInput`). */
  codeLength: 6,
  /** Validité d'un code. */
  codeTtlMinutes: 10,
  /** Essais par code ; au-delà, le code est invalidé. */
  maxAttempts: 5,
  /** Durée de vie absolue d'une session externe. */
  sessionHours: 12,
  /** Demandes de code par adresse, par fenêtre. */
  requestsPerEmail: 5,
  /** Demandes de code par adresse IP, par fenêtre. */
  requestsPerIp: 20,
  /** Vérifications par adresse, par fenêtre. */
  verifiesPerEmail: 10,
  /** Vérifications par adresse IP, par fenêtre. */
  verifiesPerIp: 30,
  /** Fenêtre des limites de débit, en millisecondes (15 minutes). */
  windowMs: 15 * 60_000,
} as const;

/** Bornes des données (ADR-0078). */
export const WORK_EXTERNAL_LIMITS = {
  nameMax: 120,
  emailMax: 254,
  /** Projets ouverts à un compte externe. */
  projectsPerAccountMax: 50,
  /** Membres externes d'un projet. */
  membersPerProjectMax: 50,
  reasonMax: 500,
  /** Collaborateurs consultants d'une tâche. */
  consultantCollaboratorsMax: 10,
} as const;

/** Cookie de session de l'espace externe (distinct de celui de better-auth). */
export const WORK_EXTERNAL_SESSION_COOKIE = 'lalanda_ext_session';

/** Visibilité d'un commentaire (ADR-0078 § 1.4). Défaut : `internal`. */
export const WORK_COMMENT_VISIBILITIES = ['internal', 'shared'] as const;
export type WorkCommentVisibility = (typeof WORK_COMMENT_VISIBILITIES)[number];

/** État de la validation par le client d'une tâche ou d'un jalon (ADR-0078 § 1.5). */
export const WORK_CLIENT_APPROVAL_STATES = [
  'none',
  'pending',
  'approved',
  'changes_requested',
] as const;
export type WorkClientApprovalState = (typeof WORK_CLIENT_APPROVAL_STATES)[number];

export const WORK_CLIENT_APPROVAL_LABELS: Readonly<Record<WorkClientApprovalState, string>> = {
  none: 'Pas de validation client',
  pending: 'En attente du client',
  approved: 'Approuvé par le client',
  changes_requested: 'Modifications demandées par le client',
};

/** Motifs de fermeture d'un accès externe (audit, affichage). */
export const WORK_EXTERNAL_CLOSE_REASONS = [
  'manual',
  'member_removed',
  'project_archived',
  'customer_inactive',
  'supplier_inactive',
  'converted',
] as const;
export type WorkExternalCloseReason = (typeof WORK_EXTERNAL_CLOSE_REASONS)[number];

// ── Outils ──────────────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Adresse e-mail, ramenée en minuscules, espaces de bord retirés. */
export const ExternalEmail = z
  .string({ error: 'Adresse e-mail attendue.' })
  .trim()
  .toLowerCase()
  .max(WORK_EXTERNAL_LIMITS.emailMax, { message: 'Adresse trop longue.' })
  .refine((v) => EMAIL.test(v), {
    message: 'Adresse e-mail invalide.',
    params: { code: 'EMAIL_INVALID' },
  });

const name = z
  .string({ error: 'Nom attendu.' })
  .trim()
  .min(1, { message: 'Nom obligatoire.' })
  .max(WORK_EXTERNAL_LIMITS.nameMax, {
    message: `${WORK_EXTERNAL_LIMITS.nameMax} caractères au plus.`,
  });

const reason = z
  .string({ error: 'Motif attendu.' })
  .trim()
  .max(WORK_EXTERNAL_LIMITS.reasonMax, {
    message: `${WORK_EXTERNAL_LIMITS.reasonMax} caractères au plus.`,
  });

const expectedRevision = z.number().int().min(0);

/** Code à six chiffres. */
export const ExternalCode = z
  .string({ error: 'Code attendu.' })
  .trim()
  .refine((v) => /^\d{6}$/.test(v), {
    message: 'Le code compte six chiffres.',
    params: { code: 'EXTERNAL_CODE_FORMAT' },
  });

// ── Corps : gestion interne ─────────────────────────────────────────────────

/**
 * `POST /work/projects/:projectId/external-members` — invite un contact client ou un
 * consultant. Un compte de la même adresse existe déjà dans l'organisation : il est
 * réutilisé (même genre, même fiche), sinon il est créé.
 */
export const InviteExternalMemberBody = z
  .object({
    kind: z.enum(WORK_EXTERNAL_KINDS, { error: 'Genre : client ou consultant.' }),
    email: ExternalEmail,
    name,
    /** Contact client : fiche client (doit être celle du projet). */
    customerId: WorkId.optional(),
    /** Contact client : compte CRM facultatif, relié à la même fiche. */
    crmAccountId: WorkId.nullable().optional(),
    /** Consultant : fiche fournisseur (obligatoire). */
    supplierId: WorkId.optional(),
    /** Consultant : référent interne (valide ses feuilles de temps). */
    referentUserId: WorkId.optional(),
    /** Consultant : peut ouvrir la vue du projet (défaut : non). */
    canOpenProject: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'client' && !v.customerId) {
      ctx.addIssue({
        code: 'custom',
        path: ['customerId'],
        message: 'Choisissez la fiche client.',
        params: { code: 'FIELD_REQUIRED' },
      });
    }
    if (v.kind === 'consultant' && !v.supplierId) {
      ctx.addIssue({
        code: 'custom',
        path: ['supplierId'],
        message: 'Choisissez la fiche fournisseur du consultant.',
        params: { code: 'FIELD_REQUIRED' },
      });
    }
    if (v.kind === 'consultant' && !v.referentUserId) {
      ctx.addIssue({
        code: 'custom',
        path: ['referentUserId'],
        message: 'Choisissez le référent interne du consultant.',
        params: { code: 'FIELD_REQUIRED' },
      });
    }
    if (v.kind === 'client' && (v.supplierId || v.referentUserId || v.canOpenProject)) {
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'Fournisseur, référent et ouverture du projet concernent un consultant.',
        params: { code: 'WORK_EXTERNAL_KIND_FIELDS' },
      });
    }
    if (v.kind === 'consultant' && (v.customerId || v.crmAccountId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'Fiche client et compte CRM concernent un contact client.',
        params: { code: 'WORK_EXTERNAL_KIND_FIELDS' },
      });
    }
  });
export type InviteExternalMemberBody = z.output<typeof InviteExternalMemberBody>;

/** `PUT /work/projects/:projectId/external-members/:accountId` — consultant seulement. */
export const UpdateExternalMemberBody = z.object({ canOpenProject: z.boolean() }).strict();
export type UpdateExternalMemberBody = z.output<typeof UpdateExternalMemberBody>;

/** `PUT /work/external-accounts/:accountId` — nom, référent (consultant). */
export const UpdateExternalAccountBody = z
  .object({ name: name.optional(), referentUserId: WorkId.optional() })
  .strict();
export type UpdateExternalAccountBody = z.output<typeof UpdateExternalAccountBody>;

/** `POST /work/external-accounts/:accountId/close` — fermeture manuelle. */
export const CloseExternalAccountBody = z.object({ reason: reason.optional() }).strict();
export type CloseExternalAccountBody = z.output<typeof CloseExternalAccountBody>;

/** Montant décimal positif en chaîne (deux décimales au plus). */
const DecimalAmount = z
  .string({ error: 'Montant attendu en chaîne décimale.' })
  .trim()
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v) && Number(v) > 0, {
    message: 'Montant positif, deux décimales au plus.',
    params: { code: 'AMOUNT_INVALID' },
  });

/**
 * `POST /work/external-accounts/:accountId/rates` — taux d'achat horaire daté d'un
 * consultant (rangé avec les taux des membres, `work_member_rates`, clé = compte externe).
 */
export const SetConsultantRateBody = z
  .object({
    currency: z.enum(WORK_RATE_CURRENCIES, { error: 'Devise : CDF ou USD.' }),
    hourlyRate: DecimalAmount,
    effectiveFrom: WorkDay,
  })
  .strict();
export type SetConsultantRateBody = z.output<typeof SetConsultantRateBody>;

/** `GET /work/external-accounts/:accountId/time-recap` — période facultative. */
export const ConsultantRecapQuery = z
  .object({
    from: WorkDay.optional(),
    to: WorkDay.optional(),
  })
  .strict();
export type ConsultantRecapQuery = z.output<typeof ConsultantRecapQuery>;

/**
 * `PUT /work/tasks/:taskId/client-settings` — réglages externes d'une tâche (gestion du
 * projet) : visible par le client, validation client requise, consultants de la tâche.
 */
export const PutTaskExternalSettingsBody = z
  .object({
    expectedRevision: expectedRevision.min(1),
    clientVisible: z.boolean().optional(),
    clientApprovalRequired: z.boolean().optional(),
    consultantAssigneeId: WorkId.nullable().optional(),
    consultantCollaboratorIds: z
      .array(WorkId)
      .max(WORK_EXTERNAL_LIMITS.consultantCollaboratorsMax)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.clientApprovalRequired === true && v.clientVisible === false) {
      ctx.addIssue({
        code: 'custom',
        path: ['clientApprovalRequired'],
        message: 'Une validation client exige une tâche visible par le client.',
        params: { code: 'WORK_CLIENT_APPROVAL_NEEDS_VISIBLE' },
      });
    }
  });
export type PutTaskExternalSettingsBody = z.output<typeof PutTaskExternalSettingsBody>;

/** `POST /work/tasks/:taskId/client-approval/reset` — remet la validation client en attente. */
export const ResetClientApprovalBody = z
  .object({ expectedRevision: expectedRevision.min(1) })
  .strict();
export type ResetClientApprovalBody = z.output<typeof ResetClientApprovalBody>;

/** `PUT /work/comments/:commentId/visibility`. */
export const PutCommentVisibilityBody = z
  .object({
    expectedRevision: expectedRevision.min(1),
    visibility: z.enum(WORK_COMMENT_VISIBILITIES, { error: 'Visibilité : internal ou shared.' }),
  })
  .strict();
export type PutCommentVisibilityBody = z.output<typeof PutCommentVisibilityBody>;

/**
 * `POST /work/guests/:userId/convert` — conversion MANUELLE d'un Invité externe en contact
 * client ou consultant. Les projets choisis doivent être des projets dont l'invité est
 * membre ; il en est retiré comme membre interne et y devient membre externe.
 */
export const ConvertGuestBody = z
  .object({
    kind: z.enum(WORK_EXTERNAL_KINDS, { error: 'Genre : client ou consultant.' }),
    projectIds: z.array(WorkId).min(1).max(WORK_EXTERNAL_LIMITS.projectsPerAccountMax),
    customerId: WorkId.optional(),
    supplierId: WorkId.optional(),
    referentUserId: WorkId.optional(),
    canOpenProject: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'client' && !v.customerId) {
      ctx.addIssue({
        code: 'custom',
        path: ['customerId'],
        message: 'Choisissez la fiche client.',
        params: { code: 'FIELD_REQUIRED' },
      });
    }
    if (v.kind === 'consultant' && (!v.supplierId || !v.referentUserId)) {
      ctx.addIssue({
        code: 'custom',
        path: [v.supplierId ? 'referentUserId' : 'supplierId'],
        message: 'Un consultant exige une fiche fournisseur et un référent interne.',
        params: { code: 'FIELD_REQUIRED' },
      });
    }
  });
export type ConvertGuestBody = z.output<typeof ConvertGuestBody>;

// ── Corps : espace externe ──────────────────────────────────────────────────

/** `POST /portal/auth/request-code` — même réponse que l'adresse existe ou non. */
export const PortalRequestCodeBody = z.object({ email: ExternalEmail }).strict();
export type PortalRequestCodeBody = z.output<typeof PortalRequestCodeBody>;

/** `POST /portal/auth/verify`. `organizationId` : choix quand l'adresse sert plusieurs organisations. */
export const PortalVerifyCodeBody = z
  .object({ email: ExternalEmail, code: ExternalCode, organizationId: WorkId.optional() })
  .strict();
export type PortalVerifyCodeBody = z.output<typeof PortalVerifyCodeBody>;

/** `POST /portal/tasks/:taskId/comments` — toujours partagé. */
export const PortalCommentBody = z
  .object({
    body: z
      .string({ error: 'Commentaire attendu.' })
      .trim()
      .min(1, { message: 'Commentaire obligatoire.' })
      .max(10_000, { message: '10 000 caractères au plus.' }),
  })
  .strict();
export type PortalCommentBody = z.output<typeof PortalCommentBody>;

export const PORTAL_CLIENT_DECISIONS = ['approve', 'request_changes'] as const;
export type PortalClientDecision = (typeof PORTAL_CLIENT_DECISIONS)[number];

/** `POST /portal/tasks/:taskId/client-decision` — motif obligatoire pour des modifications. */
export const PortalClientDecisionBody = z
  .object({
    expectedRevision: expectedRevision.min(1),
    decision: z.enum(PORTAL_CLIENT_DECISIONS, { error: 'Décision : approve ou request_changes.' }),
    reason: reason.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === 'request_changes' && !v.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Indiquez les modifications demandées.',
        params: { code: 'FIELD_REQUIRED' },
      });
    }
  });
export type PortalClientDecisionBody = z.output<typeof PortalClientDecisionBody>;

// ── Vues : gestion interne ──────────────────────────────────────────────────

export interface WorkExternalAccountView {
  id: string;
  kind: WorkExternalKind;
  email: string;
  name: string;
  status: 'active' | 'closed';
  closedAt: string | null;
  closedReason: WorkExternalCloseReason | null;
  customerId: string | null;
  customerName: string | null;
  crmAccountId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  referent: WorkMemberRef | null;
  /** Projets ouverts (accès actif). */
  projectCount: number;
  lastLoginAt: string | null;
  revision: number;
  createdAt: string;
}

export interface WorkExternalMemberView {
  account: WorkExternalAccountView;
  projectId: string;
  status: 'active' | 'closed';
  closedReason: WorkExternalCloseReason | null;
  canOpenProject: boolean;
  invitedAt: string;
  invitedBy: WorkMemberRef;
}

export interface WorkExternalMembersView {
  projectId: string;
  /** Projet `kind: client` relié à une fiche : l'invitation d'un contact client est possible. */
  canInviteClient: boolean;
  /** Gestion du projet (chef, adjoint, `work.manage`). */
  canManage: boolean;
  customerId: string | null;
  members: WorkExternalMemberView[];
}

/** Réglages externes d'une tâche (`GET /work/tasks/:taskId/external`). */
export interface WorkTaskExternalView {
  taskId: string;
  revision: number;
  clientVisible: boolean;
  clientApproval: {
    required: boolean;
    state: WorkClientApprovalState;
    decidedAt: string | null;
    decidedBy: WorkMemberRef | null;
    reason: string | null;
  };
  consultantAssignee: WorkMemberRef | null;
  consultantCollaborators: WorkMemberRef[];
  /** Consultants actifs du projet (choix possibles). */
  consultants: WorkMemberRef[];
  canManage: boolean;
}

/** Ligne du récapitulatif temps × taux d'un consultant (base de sa facture fournisseur). */
export interface ConsultantRecapRow {
  /** Mois `AAAA-MM`. */
  period: string;
  projectId: string;
  projectName: string;
  /** `null` : minutes sans taux applicable. */
  currency: 'CDF' | 'USD' | null;
  minutes: number;
  /** Montant HT au centime, `null` sans taux. */
  amount: string | null;
}

export interface ConsultantRecapView {
  account: { id: string; name: string; supplierId: string | null; supplierName: string | null };
  from: string | null;
  to: string | null;
  rows: ConsultantRecapRow[];
  totals: { currency: 'CDF' | 'USD'; minutes: number; amount: string }[];
  minutesWithoutRate: number;
  /** Version du calcul (moteur). */
  version: string;
}

/** Consultants d'une fiche fournisseur (`GET /work/suppliers/:supplierId/consultants`). */
export interface SupplierConsultantsView {
  supplierId: string;
  consultants: {
    account: WorkExternalAccountView;
    projects: { projectId: string; projectName: string; status: 'active' | 'closed' }[];
    recap: ConsultantRecapView;
  }[];
}

// ── Vues : espace externe ───────────────────────────────────────────────────

export interface PortalMeView {
  accountId: string;
  kind: WorkExternalKind;
  name: string;
  email: string;
  organizationName: string;
}

export interface PortalOrganizationChoice {
  organizationId: string;
  organizationName: string;
}

export interface PortalProjectSummary {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  dueDate: string | null;
  /** Nom du chef de projet, seul membre interne nommé. */
  leadName: string | null;
  /** Tâches visibles par l'appelant. */
  taskCount: number;
  doneTaskCount: number;
  /** Validations en attente du client (contact client). */
  pendingClientApprovals: number;
}

export interface PortalTaskSummary {
  id: string;
  number: number;
  title: string;
  done: boolean;
  /** `todo` | `in_progress` | `done`. */
  stage: string;
  dueDate: string | null;
  isMilestone: boolean;
  /** Consultant : la tâche est la sienne (responsable ou collaborateur). */
  mine: boolean;
  clientApproval: { required: boolean; state: WorkClientApprovalState };
  revision: number;
}

export interface PortalProjectView {
  project: PortalProjectSummary;
  /** Consultant : vue complète du projet (« peut ouvrir le projet »). */
  fullView: boolean;
  tasks: PortalTaskSummary[];
}

export interface PortalCommentView {
  id: string;
  /** Nom affiché : le sien, le chef de projet, ou « L'équipe projet ». */
  authorName: string;
  mine: boolean;
  body: string;
  createdAt: string;
}

export interface PortalTimeEntryView {
  id: string;
  taskId: string;
  taskNumber: number;
  taskTitle: string;
  workedOn: string;
  minutes: number;
  note: string | null;
  revision: number;
}

export interface PortalTaskView {
  task: PortalTaskSummary;
  projectId: string;
  projectName: string;
  description: string | null;
  clientApproval: {
    required: boolean;
    state: WorkClientApprovalState;
    decidedAt: string | null;
    reason: string | null;
  };
  comments: PortalCommentView[];
  canDecide: boolean;
  canLogTime: boolean;
  /** Consultant : ses saisies sur la tâche. */
  timeEntries: PortalTimeEntryView[];
}

/** Feuille de temps de la semaine d'un consultant, dans l'espace externe. */
export interface PortalTimesheetView {
  week: string;
  entries: PortalTimeEntryView[];
  totalMinutes: number;
  status: string;
  revision: number;
  reason: string | null;
  canSubmit: boolean;
  locked: boolean;
}
