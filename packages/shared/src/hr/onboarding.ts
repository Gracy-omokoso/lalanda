// RH lot 1 (ADR-0068) — invitation depuis la fiche, matricules, référentiel des postes,
// import du personnel, jours fériés proposés. Contrats seulement : la FORME. Les règles
// qui exigent la base (poste vacant de l'organisation, membre, unicité) sont vérifiées
// par l'API ; les calculs (préfixe par défaut, rang d'un numéro) par le moteur.

import { z } from 'zod';

import { HrExpectedRevision, HrId, hrFr, hrRequiredText } from './common.js';
import { HR_LIMITS } from './constants.js';

// ── Matricules (§ 2) ────────────────────────────────────────────────────────

export const EMPLOYEE_NUMBERING_LIMITS = {
  prefixMax: 10,
  widthMin: 3,
  widthMax: 8,
  widthDefault: 4,
  reasonMin: 3,
  reasonMax: 300,
} as const;

/** Préfixe : lettres, chiffres et « - _ / . », commence par une lettre ou un chiffre. */
export const EMPLOYEE_NUMBER_PREFIX_INPUT = /^[A-Za-z0-9][A-Za-z0-9\-_/.]{0,9}$/;

export interface EmployeeNumberingView {
  /** Préfixe appliqué (réglé, sinon dérivé du nom de l'organisation). */
  prefix: string;
  /** `null` : préfixe dérivé du nom (non réglé). */
  configuredPrefix: string | null;
  /** Préfixe que le nom de l'organisation donnerait. */
  defaultPrefix: string;
  width: number;
  /** Prochain matricule probable (aperçu ; un numéro déjà porté sera sauté). */
  nextNumber: string;
  /** `0` tant que rien n'est réglé. */
  revision: number;
}

/** `PUT /hr/settings/numbering` — `hr.manage`. `prefix: null` revient au préfixe dérivé du nom. */
export const UpdateEmployeeNumberingBody = z
  .object({
    expectedRevision: z.number().int().min(0),
    prefix: z
      .string(hrFr('Préfixe attendu.'))
      .trim()
      .refine((v) => EMPLOYEE_NUMBER_PREFIX_INPUT.test(v), {
        message: 'Préfixe : 1 à 10 lettres, chiffres ou « - _ / . ».',
        params: { code: 'EMPLOYEE_NUMBER_PREFIX_INVALID' },
      })
      .nullable(),
    width: z
      .number(hrFr('Largeur attendue.'))
      .int()
      .min(EMPLOYEE_NUMBERING_LIMITS.widthMin, { message: 'De 3 à 8 chiffres.' })
      .max(EMPLOYEE_NUMBERING_LIMITS.widthMax, { message: 'De 3 à 8 chiffres.' }),
  })
  .strict();
export type UpdateEmployeeNumberingBody = z.output<typeof UpdateEmployeeNumberingBody>;

/** `PUT /hr/employees/:id/employee-number` — droit RH administrateur, motif obligatoire. */
export const ChangeEmployeeNumberBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    employeeNumber: hrRequiredText(HR_LIMITS.employeeNumber, 'Matricule'),
    reason: hrRequiredText(EMPLOYEE_NUMBERING_LIMITS.reasonMax, 'Motif').refine(
      (v) => v.length >= EMPLOYEE_NUMBERING_LIMITS.reasonMin,
      { message: 'Motif : 3 caractères au moins.', params: { code: 'REASON_TOO_SHORT' } },
    ),
  })
  .strict();
export type ChangeEmployeeNumberBody = z.output<typeof ChangeEmployeeNumberBody>;

// ── Postes (§ 3) ────────────────────────────────────────────────────────────

export const HR_POSITION_STATUSES = ['open', 'filled', 'deleted'] as const;
export type HrPositionStatus = (typeof HR_POSITION_STATUSES)[number];

export const HR_POSITION_LIMITS = { title: 120, pageMax: 500 } as const;

/** Choix du poste à la création d'un collaborateur. */
export const EmployeePositionChoice = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('replacement'), positionId: HrId }).strict(),
  z.object({ mode: z.literal('new') }).strict(),
]);
export type EmployeePositionChoice = z.output<typeof EmployeePositionChoice>;

export const CreatePositionBody = z
  .object({
    title: hrRequiredText(HR_POSITION_LIMITS.title, 'Intitulé'),
    departmentId: HrId.nullable().optional(),
  })
  .strict();
export type CreatePositionBody = z.output<typeof CreatePositionBody>;

export const UpdatePositionBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    title: hrRequiredText(HR_POSITION_LIMITS.title, 'Intitulé').optional(),
    departmentId: HrId.nullable().optional(),
  })
  .strict();
export type UpdatePositionBody = z.output<typeof UpdatePositionBody>;

export const PositionRevisionBody = z.object({ expectedRevision: HrExpectedRevision }).strict();
export type PositionRevisionBody = z.output<typeof PositionRevisionBody>;

export const ListPositionsQuery = z
  .object({
    /** `current` : vacants et pourvus (sans les supprimés). */
    status: z.enum([...HR_POSITION_STATUSES, 'current', 'all']).default('current'),
  })
  .strict();
export type ListPositionsQuery = z.output<typeof ListPositionsQuery>;

export interface PositionHolderView {
  employeeId: string;
  displayName: string;
  employeeNumber: string | null;
  from: string;
  to: string | null;
}

export interface PositionView {
  id: string;
  positionNumber: string;
  title: string;
  departmentId: string | null;
  departmentName: string | null;
  status: HrPositionStatus;
  holderEmployeeId: string | null;
  holderName: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PositionDetailView extends PositionView {
  holders: PositionHolderView[];
}

export interface PositionListView {
  items: PositionView[];
}

// ── Invitation depuis la fiche (§ 1) ────────────────────────────────────────

/**
 * Issue d'« Inviter sur Lalanda ». `invitation_sent` est rendu À L'IDENTIQUE que
 * l'adresse ait un compte dans une autre organisation ou non (non-énumération).
 */
export const EMPLOYEE_INVITE_OUTCOMES = [
  'not_requested',
  'not_sent_no_email',
  'not_sent_permission',
  'already_linked',
  'linked',
  'member_already_linked',
  'invitation_sent',
  'invitation_pending',
] as const;
export type EmployeeInviteOutcome = (typeof EMPLOYEE_INVITE_OUTCOMES)[number];

export interface EmployeeInvitationResult {
  outcome: EmployeeInviteOutcome;
  /** `null` si aucun courriel n'a été tenté. */
  emailDelivered: boolean | null;
}

export type EmployeeAccountState = 'linked' | 'invitation_pending' | 'invitation_expired' | 'none';

export interface EmployeeAccountView {
  state: EmployeeAccountState;
  userId: string | null;
  invitation: { id: string; email: string; expiresAt: string; createdAt: string } | null;
}

// ── Import du personnel (§ 4) ───────────────────────────────────────────────

export const EMPLOYEE_IMPORT_FIELDS = [
  'employeeNumber',
  'lastName',
  'firstName',
  'jobTitle',
  'department',
  'contractType',
  'startDate',
  'contractEndDate',
  'workEmail',
  'workPhone',
  'workLocation',
] as const;
export type EmployeeImportField = (typeof EMPLOYEE_IMPORT_FIELDS)[number];

export interface EmployeeImportIssue {
  level: 'error' | 'warning';
  field: EmployeeImportField | null;
  message: string;
}

export interface EmployeeImportRowView {
  /** Numéro de ligne dans le fichier (en-tête = 1). */
  row: number;
  valid: boolean;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  jobTitle: string;
  departmentName: string | null;
  contractType: string | null;
  startDate: string | null;
  workEmail: string | null;
  issues: EmployeeImportIssue[];
}

export interface EmployeeImportPreview {
  format: 'xlsx' | 'csv';
  /** En-têtes du fichier et champ reconnu (`null` : colonne ignorée). */
  columns: { header: string; field: EmployeeImportField | null }[];
  rows: EmployeeImportRowView[];
  counts: { total: number; valid: number; invalid: number; warnings: number };
}

export interface EmployeeImportResult {
  created: {
    row: number;
    employeeId: string;
    employeeNumber: string | null;
    invitation: EmployeeInviteOutcome;
  }[];
  skippedRows: number[];
}

// ── Jours fériés proposés (§ 5) ─────────────────────────────────────────────

export const CountryHolidaysQuery = z
  .object({ year: z.coerce.number().int().min(2023).max(2100) })
  .strict();
export type CountryHolidaysQuery = z.output<typeof CountryHolidaysQuery>;

export interface CountryHolidaysProposalView {
  country: 'CD';
  year: number;
  version: string;
  source: { text: string; readVia: string; url: string; consultedOn: string };
  items: { date: string; label: string; alreadyPresent: boolean }[];
}

export interface CountryHolidaysLoadResult {
  created: number;
  alreadyPresent: number;
}
