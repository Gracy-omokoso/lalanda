// Contrats d'entrée de la trésorerie RUN — ADR-0034.
//
// Les règles de FORME (types, longueurs, dates, montants) vivent ici ; les règles
// qui exigent la base (compte existant, même devise, occurrence d'une règle)
// vivent dans les services. Les codes métier passent par `params.code`, comme
// `sales.dto.ts` : la réponse 400 les expose dans `details.issues[].code`.

import {
  EXPENSE_CATEGORY_CODES,
  FORECAST_SCENARIOS,
  RECURRENCE_FREQUENCIES,
  TREASURY_ACCOUNT_KINDS,
  TREASURY_CURRENCIES,
  isCalendarDay,
  isCalendarMonthKey,
  isValidScenarioHypotheses,
  treasuryCentsOf,
  type ExpenseCategory,
} from '@lalanda/engine';
import { z } from 'zod';

type Ctx = z.RefinementCtx;

function issue(ctx: Ctx, path: (string | number)[], code: string, message: string): void {
  ctx.addIssue({ code: 'custom', path, message, params: { code } });
}

/** Texte nettoyé : espaces de bord retirés ; chaîne vide → `null`. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .nullable()
    .optional()
    .transform((v) => {
      const t = (v ?? '').trim();
      return t === '' ? null : t;
    })
    .refine((v) => v === null || v.length <= max, { error: `${max} caractères au plus.` });

const requiredText = (max: number) =>
  z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= 1, { error: 'Champ obligatoire.' })
    .refine((v) => v.length <= max, { error: `${max} caractères au plus.` });

const calendarDay = z.string().refine(isCalendarDay, {
  error: 'Date attendue au format AAAA-MM-JJ.',
  params: { code: 'INVALID_DATE' },
});

const currency = z.enum(TREASURY_CURRENCIES);
const category = z.enum(EXPENSE_CATEGORY_CODES as [ExpenseCategory, ...ExpenseCategory[]]);

/** Montant strictement positif, deux décimales au plus. */
const positiveAmount = z.string().refine(
  (v) => {
    const c = treasuryCentsOf(v);
    return c !== null && c > 0n && !v.startsWith('-');
  },
  {
    error: 'Montant positif attendu (deux décimales au plus).',
    params: { code: 'INVALID_AMOUNT' },
  },
);

/** Montant signé (solde d'ouverture : un découvert est possible). */
const signedAmount = z.string().refine((v) => treasuryCentsOf(v) !== null, {
  error: 'Montant attendu (deux décimales au plus).',
  params: { code: 'INVALID_AMOUNT' },
});

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Identifiant invalide.');

// ─── Comptes ─────────────────────────────────────────────────────────────────

export const CreateAccountSchema = z
  .object({
    name: requiredText(80),
    kind: z.enum(TREASURY_ACCOUNT_KINDS),
    institution: optionalText(80),
    currency,
    openingBalance: signedAmount,
    openingDate: calendarDay,
  })
  .strict();
export type CreateAccountInput = z.output<typeof CreateAccountSchema>;

export const PutAccountSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    name: requiredText(80),
    kind: z.enum(TREASURY_ACCOUNT_KINDS),
    institution: optionalText(80),
    openingBalance: signedAmount,
    active: z.boolean(),
  })
  .strict();
export type PutAccountInput = z.output<typeof PutAccountSchema>;

// ─── Dépenses ────────────────────────────────────────────────────────────────

const ExpenseFields = {
  spentOn: calendarDay,
  amount: positiveAmount,
  currency,
  category,
  label: requiredText(200),
  supplierName: optionalText(120),
  accountId: objectId
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  deductibleVat: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === null || v.trim() === '' ? null : v.trim())),
  reference: optionalText(100),
  /**
   * Projet du RUN (ADR-0039 § 2.10). Absent : `null` à la création, inchangé à la
   * modification (un client qui ignore le champ ne détache rien) ; `null` : détacher.
   */
  workProjectId: objectId.nullable().optional(),
};

function checkExpense(raw: { amount: string; deductibleVat: string | null }, ctx: Ctx): void {
  if (raw.deductibleVat === null) return;
  const vat = treasuryCentsOf(raw.deductibleVat);
  const amount = treasuryCentsOf(raw.amount);
  if (vat === null || vat < 0n || raw.deductibleVat.startsWith('-')) {
    issue(
      ctx,
      ['deductibleVat'],
      'INVALID_AMOUNT',
      'TVA déductible : montant positif ou nul attendu.',
    );
    return;
  }
  if (amount !== null && vat > amount) {
    issue(
      ctx,
      ['deductibleVat'],
      'VAT_EXCEEDS_AMOUNT',
      'La TVA déductible dépasse le montant payé.',
    );
  }
}

export const CreateExpenseSchema = z.object(ExpenseFields).strict().superRefine(checkExpense);
export type ExpenseInputDto = z.output<typeof CreateExpenseSchema>;

export const PutExpenseSchema = z
  .object({ expectedRevision: z.number().int().min(1), expense: CreateExpenseSchema })
  .strict();

export const CancelSchema = z.object({ reason: requiredText(300) }).strict();

export const ListExpensesQuerySchema = z
  .object({
    from: calendarDay.optional(),
    to: calendarDay.optional(),
    category: category.optional(),
    currency: currency.optional(),
    accountId: objectId.optional(),
    workProjectId: objectId.optional(),
    status: z.enum(['recorded', 'cancelled', 'all']).default('recorded'),
    q: z.string().max(100).optional(),
    limit: z
      .string()
      .optional()
      .transform((v) => (v === undefined ? 50 : Number(v)))
      .pipe(z.number().int().min(1).max(200)),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ListExpensesQuery = z.output<typeof ListExpensesQuerySchema>;

export const SummaryQuerySchema = z
  .object({ from: calendarDay.optional(), to: calendarDay.optional() })
  .strict();

// ─── Dépenses récurrentes ────────────────────────────────────────────────────

export const RecurringExpenseSchema = z
  .object({
    label: requiredText(200),
    amount: positiveAmount,
    currency,
    category,
    supplierName: optionalText(120),
    accountId: objectId
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    startDate: calendarDay,
    endDate: calendarDay
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    active: z.boolean().optional().default(true),
  })
  .strict()
  .superRefine((raw, ctx) => {
    if (raw.endDate !== null && raw.endDate < raw.startDate) {
      issue(ctx, ['endDate'], 'END_BEFORE_START', 'La date de fin précède la date de début.');
    }
  });
export type RecurringExpenseInputDto = z.output<typeof RecurringExpenseSchema>;

export const PutRecurringExpenseSchema = z
  .object({ expectedRevision: z.number().int().min(1), recurringExpense: RecurringExpenseSchema })
  .strict();

/** Corps facultatif de la confirmation : le montant réellement payé peut différer. */
export const ConfirmOccurrenceSchema = z
  .object({
    amount: positiveAmount.optional(),
    spentOn: calendarDay.optional(),
    accountId: objectId.nullable().optional(),
    reference: optionalText(100),
  })
  .strict();

// ─── Mouvements ──────────────────────────────────────────────────────────────

export const TransferSchema = z
  .object({
    date: calendarDay,
    fromAccountId: objectId,
    toAccountId: objectId,
    amountOut: positiveAmount,
    amountIn: positiveAmount,
    label: optionalText(200),
    reference: optionalText(100),
  })
  .strict()
  .superRefine((raw, ctx) => {
    if (raw.fromAccountId === raw.toAccountId) {
      issue(
        ctx,
        ['toAccountId'],
        'TRANSFER_SAME_ACCOUNT',
        'Les deux comptes doivent être distincts.',
      );
    }
  });
export type TransferInput = z.output<typeof TransferSchema>;

export const OtherMovementSchema = z
  .object({
    kind: z.enum(['other_in', 'other_out']),
    date: calendarDay,
    accountId: objectId,
    amount: positiveAmount,
    label: requiredText(200),
    reference: optionalText(100),
  })
  .strict();
export type OtherMovementInput = z.output<typeof OtherMovementSchema>;

export const ListMovementsQuerySchema = z
  .object({
    accountId: objectId.optional(),
    from: calendarDay.optional(),
    to: calendarDay.optional(),
  })
  .strict();

// ─── Prévision et réglages ───────────────────────────────────────────────────

export const ForecastQuerySchema = z.object({ currency }).strict();

const hypotheses = z
  .object({
    receivableCollectionRate: z.number(),
    receivableDelayDays: z.number(),
    noDueDateDays: z.number(),
    recurringFactor: z.number(),
    planRevenueRate: z.number(),
    planChargesRate: z.number(),
  })
  .strict()
  .superRefine((h, ctx) => {
    if (!isValidScenarioHypotheses(h)) {
      issue(
        ctx,
        [],
        'INVALID_HYPOTHESES',
        'Taux entre 0 et 2 (0,9 = 90 %), délais en jours entiers entre 0 et 365.',
      );
    }
  });

const minimumAmount = z
  .string()
  .nullable()
  .refine((v) => v === null || (treasuryCentsOf(v) !== null && !v.startsWith('-')), {
    error: 'Minimum positif ou nul attendu.',
    params: { code: 'INVALID_AMOUNT' },
  });

export const PutSettingsSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    minimumBalances: z.object({ CDF: minimumAmount, USD: minimumAmount }).strict(),
    /** `null` = revenir aux valeurs par défaut proposées. */
    scenarios: z
      .object(
        Object.fromEntries(FORECAST_SCENARIOS.map((id) => [id, hypotheses])) as Record<
          (typeof FORECAST_SCENARIOS)[number],
          typeof hypotheses
        >,
      )
      .strict()
      .nullable(),
  })
  .strict();
export type PutSettingsInput = z.output<typeof PutSettingsSchema>;

// ─── Pont vers le réalisé ────────────────────────────────────────────────────

const lineId = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'Identifiant de ligne invalide.')
  .max(64);

export const PutBridgeSchema = z
  .object({
    enabled: z.boolean(),
    projectId: objectId.nullable(),
    firstMonth: z
      .string()
      .refine(isCalendarMonthKey, { error: 'Mois attendu au format AAAA-MM.' })
      .nullable(),
    mapping: z.partialRecord(category, lineId),
  })
  .strict()
  .superRefine((raw, ctx) => {
    if (raw.enabled && (raw.projectId === null || raw.firstMonth === null)) {
      issue(
        ctx,
        ['projectId'],
        'BRIDGE_INCOMPLETE',
        'Pour activer le report, choisissez l’initiative et le mois d’ouverture de l’exercice 1.',
      );
    }
  });
export type PutBridgeInput = z.output<typeof PutBridgeSchema>;

export const SyncSchema = z.object({ dryRun: z.boolean().optional().default(false) }).strict();

export const ReconciliationQuerySchema = z
  .object({
    year: z
      .string()
      .optional()
      .transform((v) => (v === undefined ? 1 : Number(v)))
      .pipe(z.number().int().min(1).max(5)),
  })
  .strict();
