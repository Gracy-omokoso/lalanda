// Notes de frais (ADR-0051 § 1, § 2.1, § 3.1, § 6.1). ADR-0051 — H8.
//
// Libellé d'interface ↔ code : « Note de frais » = `ExpenseReport`, « Ligne de frais » =
// `ExpenseLine`, « Justificatif » = `ExpenseReceipt`.
//
// Contrats seulement : unions fermées, bornes, réglages par défaut, codes et corps zod.
// AUCUNE règle sociale ni fiscale (ADR-0051 § 11) : ni barème kilométrique, ni forfait de
// repas, ni indemnité journalière, ni seuil de justificatif ; une ligne est un montant
// réellement payé. Le total d'une note est calculé par le moteur (`expenseReportTotals`,
// lot H9), jamais saisi ; la TVA déclarée est conservée, jamais utilisée dans un calcul.

import { z } from 'zod';

import {
  HrCalendarDay,
  HrCurrencySchema,
  HrExpectedRevision,
  HrId,
  HrPositiveAmount,
  canonicalHrAmount,
  hrFr,
  hrIssue,
  hrOptionalText,
  hrRequiredText,
} from './common.js';
import { HR_PAGE_LIMIT_DEFAULT, HR_PAGE_LIMIT_MAX } from './constants.js';

// ── Unions fermées ──────────────────────────────────────────────────────────

/**
 * Statut stocké d'une note (§ 2.1). `approved` → `reimbursed`, `settled_by_advance` ou
 * `partially_settled` (note liée à une avance, § 3.3).
 */
export const EXPENSE_REPORT_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'reimbursed',
  'settled_by_advance',
  'partially_settled',
  'cancelled',
] as const;
export type ExpenseReportStatus = (typeof EXPENSE_REPORT_STATUSES)[number];

/** Étapes d'une note ou d'une avance, figées à la soumission (`expenseApprovalSteps`). */
export const EXPENSE_APPROVAL_STEPS = ['manager', 'finance'] as const;
export type ExpenseApprovalStepKey = (typeof EXPENSE_APPROVAL_STEPS)[number];

export const EXPENSE_APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export type ExpenseApprovalDecisionValue = (typeof EXPENSE_APPROVAL_DECISIONS)[number];

/** Circuit des notes de frais (décision ouverte n° 3). */
export const EXPENSE_APPROVAL_FLOWS = ['manager_then_finance', 'finance_only'] as const;
export type ExpenseApprovalFlow = (typeof EXPENSE_APPROVAL_FLOWS)[number];

/** Moyen de remboursement ou de versement (§ 3.1 point 5). Aucun numéro de compte. */
export const HR_PAYMENT_METHODS = ['cash', 'mobile_money', 'bank_transfer', 'other'] as const;
export type HrPaymentMethod = (typeof HR_PAYMENT_METHODS)[number];

export const HR_PAYMENT_METHOD_LABELS: Readonly<Record<HrPaymentMethod, string>> = Object.freeze({
  cash: 'Espèces',
  mobile_money: 'Mobile money',
  bank_transfer: 'Virement bancaire',
  other: 'Autre',
});

/**
 * Catégories d'une ligne de frais : les quatorze catégories de dépense d'ADR-0034 § 1,
 * MOINS `investissement` et `remboursement_emprunt` (une immobilisation passe par les
 * achats, `422 EXPENSE_LINE_CATEGORY_NOT_ALLOWED`). Aucune catégorie nouvelle : le lot
 * H10 vérifie l'égalité avec `EXPENSE_CATEGORIES` du moteur.
 */
export const EXPENSE_LINE_CATEGORIES = [
  'achats',
  'personnel',
  'loyer',
  'transport',
  'marketing',
  'outils_logiciels',
  'energie_telecom',
  'services_exterieurs',
  'impots_taxes',
  'impot_benefices',
  'frais_financiers',
  'charges_diverses',
] as const;
export type ExpenseLineCategory = (typeof EXPENSE_LINE_CATEGORIES)[number];

/** Catégories de dépense refusées sur une ligne de frais (§ 2.1). */
export const EXPENSE_LINE_FORBIDDEN_CATEGORIES = [
  'investissement',
  'remboursement_emprunt',
] as const;

/** Types de justificatif acceptés (motif d'ADR-0044 § 2.7). */
export const EXPENSE_RECEIPT_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;
export type ExpenseReceiptContentType = (typeof EXPENSE_RECEIPT_CONTENT_TYPES)[number];

/** Préfixe des objets justificatifs (§ 1) ; clé au hasard, jamais le nom de fichier. */
export const EXPENSE_RECEIPT_KEY_PREFIX = 'hr-expense-receipts/' as const;

/** Champ multipart du justificatif. */
export const EXPENSE_RECEIPT_FILE_FIELD = 'file';

/** Regroupement du résumé (`GET /hr/expenses/summary`). */
export const EXPENSE_SUMMARY_GROUP_BY = ['category', 'department', 'project'] as const;
export type ExpenseSummaryGroupBy = (typeof EXPENSE_SUMMARY_GROUP_BY)[number];

/** Vues de l'écran « Frais et avances » (§ 10). */
export const EXPENSE_LIST_VIEWS = ['a-valider', 'a-payer', 'toutes'] as const;
export type ExpenseListView = (typeof EXPENSE_LIST_VIEWS)[number];

// ── Bornes et réglages ──────────────────────────────────────────────────────

export const EXPENSE_LIMITS = Object.freeze({
  title: 120,
  linesMin: 1,
  linesMax: 50,
  lineLabel: 200,
  merchant: 120,
  missingReceiptReason: 300,
  comment: 2_000,
  cancelReason: 500,
  reference: 120,
  receiptImageMaxBytes: 2 * 1024 * 1024,
  receiptPdfMaxBytes: 10 * 1024 * 1024,
  receiptUploadsPerHour: 30,
});

/** Numéro de note : `NF{AA}{MM}-NNNNNN`, attribué à la soumission (§ 1). */
export const EXPENSE_REPORT_NUMBER_PATTERN = /^NF\d{4}-\d{6}$/;

/** Réglages `hr_settings.expenses` par défaut (§ 2.7). */
export const HR_EXPENSES_SETTINGS_DEFAULTS = Object.freeze({
  enabled: true,
  approvalFlow: 'manager_then_finance' as ExpenseApprovalFlow,
  receiptRequired: true,
});

/** Durée de conservation des justificatifs : non fixée, aucune purge (J4, C5). */
export const HR_EXPENSE_RECEIPTS_RETENTION_DEFAULT: number | null = null;

// ── Codes ───────────────────────────────────────────────────────────────────

/** Codes d'erreur nommés par l'ADR pour les notes de frais et leur remboursement. */
export const HR_EXPENSES_ERROR_CODES = [
  'HR_FEATURE_DISABLED',
  'EMPLOYEE_NOT_LINKED',
  'EXPENSE_REPORT_CURRENCY_MISMATCH',
  'EXPENSE_IN_FUTURE',
  'EXPENSE_LINE_CATEGORY_NOT_ALLOWED',
  'EXPENSE_WORK_PROJECT_UNKNOWN',
  'EXPENSE_RECEIPT_TYPE',
  'EXPENSE_RECEIPT_REASON_REQUIRED',
  'EXPENSE_REBILLABLE_WITHOUT_PROJECT',
  'EXPENSE_VAT_ABOVE_AMOUNT',
  'SELF_APPROVAL_FORBIDDEN',
  'CREATOR_APPROVAL_FORBIDDEN',
  'APPROVER_ALREADY_APPROVED',
  'EXPENSE_NOT_YOUR_STEP',
  'SELF_PAYMENT_FORBIDDEN',
  'APPROVER_CANNOT_PAY',
  'EXPENSE_OWNED_BY_HR',
  'STALE_REVISION',
] as const;
export type HrExpensesErrorCode = (typeof HR_EXPENSES_ERROR_CODES)[number];

/** Événements d'audit des notes (justificatif servi : audit simple, § 7.7). */
export const HR_EXPENSES_AUDIT_EVENTS = [
  'hr.expense_receipt.downloaded',
  'hr.expense_report.approved',
  'hr.expense_report.reimbursed',
  'hr.expense_report.reimbursement_cancelled',
] as const;
export type HrExpensesAuditEvent = (typeof HR_EXPENSES_AUDIT_EVENTS)[number];

// ── Briques ─────────────────────────────────────────────────────────────────

/** Taille de page d'une liste par curseur (second volet RH). */
export const hrPageLimit = z
  .string()
  .regex(/^\d{1,3}$/, { message: 'Nombre attendu.' })
  .transform(Number)
  .refine((n) => n >= 1 && n <= HR_PAGE_LIMIT_MAX, {
    message: `Entre 1 et ${HR_PAGE_LIMIT_MAX}.`,
  })
  .default(HR_PAGE_LIMIT_DEFAULT);

/** Montant positif ou nul, canonique, deux décimales au plus (TVA déclarée). */
export const HrNonNegativeAmount = z.unknown().transform((raw, ctx): string => {
  if (typeof raw === 'number') {
    hrIssue(
      ctx,
      'DECIMAL_MUST_BE_STRING',
      'Montant attendu sous forme de chaîne (par exemple "12.50"), jamais de nombre.',
    );
    return z.NEVER;
  }
  if (typeof raw !== 'string') {
    hrIssue(ctx, 'FIELD_REQUIRED', 'Montant obligatoire.');
    return z.NEVER;
  }
  const canonical = canonicalHrAmount(raw.trim());
  if (canonical === null) {
    hrIssue(
      ctx,
      'INVALID_AMOUNT',
      'Montant invalide : chiffres et point décimal, deux décimales au plus.',
    );
    return z.NEVER;
  }
  return canonical;
});

/** Compare deux montants canoniques (`"12.50"`), sans flottant. */
function centsOf(amount: string): bigint {
  const [i, f] = amount.split('.') as [string, string];
  return BigInt(i) * 100n + BigInt(f);
}

/** Moyen de paiement. */
export const HrPaymentMethodSchema = z.enum(
  HR_PAYMENT_METHODS,
  hrFr('Moyen : cash, mobile_money, bank_transfer ou other.'),
);

// ── Corps ───────────────────────────────────────────────────────────────────

/**
 * Ligne de frais (§ 2.1). La date jamais future et le projet RUN existant sont vérifiés
 * par l'API (jour de Kinshasa, base) ; ici : forme, catégorie, cohérences locales.
 */
export const ExpenseLineSchema = z
  .object({
    spentOn: HrCalendarDay,
    category: z.string(hrFr('Catégorie attendue.')).superRefine((v, ctx) => {
      if ((EXPENSE_LINE_FORBIDDEN_CATEGORIES as readonly string[]).includes(v)) {
        hrIssue(
          ctx,
          'EXPENSE_LINE_CATEGORY_NOT_ALLOWED',
          'Une immobilisation ou un remboursement d’emprunt passe par les achats.',
        );
        return;
      }
      if (!(EXPENSE_LINE_CATEGORIES as readonly string[]).includes(v)) {
        hrIssue(ctx, 'EXPENSE_CATEGORY_UNKNOWN', 'Catégorie de dépense inconnue.');
      }
    }),
    label: hrRequiredText(EXPENSE_LIMITS.lineLabel, 'Libellé'),
    amount: HrPositiveAmount,
    merchant: hrOptionalText(EXPENSE_LIMITS.merchant).optional(),
    deductibleVat: HrNonNegativeAmount.nullable().optional(),
    workProjectId: HrId.nullable().optional(),
    rebillable: z.boolean(hrFr('Booléen attendu.')).optional(),
    missingReceiptReason: hrOptionalText(EXPENSE_LIMITS.missingReceiptReason).optional(),
  })
  .strict()
  .superRefine((line, ctx) => {
    if (line.rebillable === true && (line.workProjectId ?? null) === null) {
      hrIssue(
        ctx,
        'EXPENSE_REBILLABLE_WITHOUT_PROJECT',
        'Une ligne refacturable est imputée à un projet.',
        ['rebillable'],
      );
    }
    const vat = line.deductibleVat ?? null;
    if (vat !== null && centsOf(vat) > centsOf(line.amount)) {
      hrIssue(ctx, 'EXPENSE_VAT_ABOVE_AMOUNT', 'La TVA déclarée ne dépasse pas le montant payé.', [
        'deductibleVat',
      ]);
    }
  })
  .transform((line) => ({ ...line, category: line.category as ExpenseLineCategory }));
export type ExpenseLineInput = z.output<typeof ExpenseLineSchema>;

const lines = z
  .array(ExpenseLineSchema, hrFr('Lignes attendues.'))
  .min(EXPENSE_LIMITS.linesMin, { message: 'Au moins une ligne.' })
  .max(EXPENSE_LIMITS.linesMax, { message: `${EXPENSE_LIMITS.linesMax} lignes au plus.` });

/**
 * `POST /hr/expense-reports` — `expenses.claim`. `employeeId` absent : la fiche reliée à
 * l'appelant ; présent : saisie pour un collaborateur sans compte (`hr.manage` en plus).
 * Une devise par note.
 */
export const CreateExpenseReportBody = z
  .object({
    employeeId: HrId.optional(),
    title: hrRequiredText(EXPENSE_LIMITS.title, 'Titre'),
    currency: HrCurrencySchema,
    lines,
    advanceId: HrId.nullable().optional(),
  })
  .strict();
export type CreateExpenseReportBody = z.output<typeof CreateExpenseReportBody>;

/** `PUT /hr/expense-reports/:id` — brouillon seulement. */
export const UpdateExpenseReportBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    title: hrRequiredText(EXPENSE_LIMITS.title, 'Titre').optional(),
    currency: HrCurrencySchema.optional(),
    lines: lines.optional(),
    advanceId: HrId.nullable().optional(),
  })
  .strict();
export type UpdateExpenseReportBody = z.output<typeof UpdateExpenseReportBody>;

/** `POST …/:id/submit`. */
export const SubmitExpenseReportBody = z.object({ expectedRevision: HrExpectedRevision }).strict();
export type SubmitExpenseReportBody = z.output<typeof SubmitExpenseReportBody>;

/** `POST …/:id/approve` — `expenseApprovalDecision`. */
export const ApproveExpenseBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    comment: hrOptionalText(EXPENSE_LIMITS.comment).optional(),
  })
  .strict();
export type ApproveExpenseBody = z.output<typeof ApproveExpenseBody>;

/** `POST …/:id/reject` — un refus porte toujours un commentaire (§ 3.1 point 4). */
export const RejectExpenseBody = z
  .object({
    expectedRevision: HrExpectedRevision.optional(),
    comment: hrRequiredText(EXPENSE_LIMITS.comment, 'Commentaire'),
  })
  .strict();
export type RejectExpenseBody = z.output<typeof RejectExpenseBody>;

/**
 * `POST …/:id/cancel` — le bénéficiaire (brouillon ou soumise) ; `expenses.approve`
 * (avant remboursement), motif obligatoire : vérifié par l'API selon l'appelant.
 */
export const CancelExpenseBody = z
  .object({
    expectedRevision: HrExpectedRevision.optional(),
    reason: hrOptionalText(EXPENSE_LIMITS.cancelReason).optional(),
  })
  .strict();
export type CancelExpenseBody = z.output<typeof CancelExpenseBody>;

/**
 * `POST …/:id/reimburse` — `payables.pay` + `treasury.read`, `reimbursementDecision`.
 * Le payeur ne voit jamais les coordonnées bancaires du collaborateur (décision n° 7).
 */
export const ReimburseExpenseReportBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    paidOn: HrCalendarDay,
    accountId: HrId.nullable().optional(),
    method: HrPaymentMethodSchema,
    reference: hrOptionalText(EXPENSE_LIMITS.reference).optional(),
  })
  .strict();
export type ReimburseExpenseReportBody = z.output<typeof ReimburseExpenseReportBody>;

/** `POST …/:id/reimbursement/cancel` — motif obligatoire (§ 3.1 point 6). */
export const CancelReimbursementBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    reason: hrRequiredText(EXPENSE_LIMITS.cancelReason, 'Motif'),
  })
  .strict();
export type CancelReimbursementBody = z.output<typeof CancelReimbursementBody>;

/** `GET /hr/expense-reports`. */
export const ListExpenseReportsQuery = z
  .object({
    employeeId: HrId.optional(),
    status: z.enum(EXPENSE_REPORT_STATUSES).optional(),
    view: z.enum(EXPENSE_LIST_VIEWS).optional(),
    from: HrCalendarDay.optional(),
    to: HrCalendarDay.optional(),
    cursor: z.string().max(200).optional(),
    limit: hrPageLimit,
  })
  .strict();
export type ListExpenseReportsQuery = z.output<typeof ListExpenseReportsQuery>;

/** `GET /hr/expenses/summary` — totaux approuvés et remboursés, par devise. */
export const ExpenseSummaryQuery = z
  .object({
    from: HrCalendarDay,
    to: HrCalendarDay,
    groupBy: z.enum(EXPENSE_SUMMARY_GROUP_BY).default('category'),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.to < q.from) hrIssue(ctx, 'PERIOD_END_BEFORE_START', 'La fin précède le début.', ['to']);
  });
export type ExpenseSummaryQuery = z.output<typeof ExpenseSummaryQuery>;
