// Fournisseurs — corps de requête, requêtes de liste et vues (ADR-0044 § 2.1, § 3.1).
// ADR-0044 — P0 : contrats posés avant le lot P2, qui les implémente.
//
// Les coordonnées de paiement (§ 2.1.1) ne circulent EN CLAIR que dans les corps
// d'écriture (`…/payment-methods`) et la réponse de `…/reveal` (`payables.pay`) ;
// toute autre vue ne porte que `masked` et `fingerprint`. Validation de FORME
// seulement : aucune vérification auprès d'une banque, d'un opérateur ou de la DGI.

import { z } from 'zod';

import {
  PurchaseCurrencySchema,
  PurchaseExpectedRevision,
  PurchaseId,
  purchaseBooleanParam,
  purchaseFr,
  purchaseIssue,
  purchaseOptionalText,
  purchaseRequiredText,
} from './common.js';
import {
  PURCHASE_LIMITS,
  PURCHASE_PAGE_LIMIT_DEFAULT,
  PURCHASE_PAGE_LIMIT_MAX,
  PURCHASE_PHONE_PATTERN,
  SUPPLIER_KINDS,
  SUPPLIER_NIF_PATTERN,
  normalizeSupplierNif,
  type PurchaseCurrency,
  type PurchaseSectionStatus,
  type PurchaseWarningCode,
  type SupplierKind,
  type SupplierPaymentMethodKind,
} from './constants.js';

const L = PURCHASE_LIMITS;

const phone = purchaseOptionalText(L.phone).superRefine((v, ctx) => {
  if (v !== null && !PURCHASE_PHONE_PATTERN.test(v)) {
    purchaseIssue(ctx, 'PHONE_INVALID', 'Numéro de téléphone invalide.');
  }
});

const email = purchaseOptionalText(L.email).superRefine((v, ctx) => {
  if (v !== null && !z.email().safeParse(v).success) {
    purchaseIssue(ctx, 'EMAIL_INVALID', 'Adresse e-mail invalide.');
  }
});

/** NIF facultatif, normalisé (majuscules, espaces et tirets retirés), forme seulement. */
const nif = purchaseOptionalText(40)
  .transform((v) => (v === null ? null : normalizeSupplierNif(v)))
  .superRefine((v, ctx) => {
    if (v !== null && !SUPPLIER_NIF_PATTERN.test(v)) {
      purchaseIssue(ctx, 'NIF_INVALID', 'NIF : 5 à 20 lettres ou chiffres.');
    }
  });

/**
 * Catégorie de dépense d'ADR-0034 § 1 (code `snake_case`). La liste fermée vit dans le
 * moteur (`EXPENSE_CATEGORY_CODES`), dont ce paquet ne dépend pas : le service la
 * vérifie (`400 CATEGORY_UNKNOWN`) ; ici, la forme seulement.
 */
export const PurchaseCategoryCode = z
  .string(purchaseFr('Catégorie attendue.'))
  .regex(/^[a-z][a-z_]{1,39}$/, { message: 'Catégorie invalide.' });

/** Conditions de paiement (§ 2.1) ; l'échéance en est déduite par le moteur. */
export const SupplierPaymentTerms = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('immediate') }).strict(),
  z
    .object({
      kind: z.literal('net'),
      days: z.number().int().min(L.netDaysMin).max(L.paymentTermsDaysMax),
    })
    .strict(),
  z
    .object({
      kind: z.literal('end_of_month'),
      days: z.number().int().min(0).max(L.paymentTermsDaysMax),
    })
    .strict(),
]);
export type SupplierPaymentTerms = z.infer<typeof SupplierPaymentTerms>;

/** Un contact ; `id` absent à la création, rendu par le service. */
export const SupplierContactInput = z
  .object({
    id: z.string().min(1).max(64).optional(),
    name: purchaseRequiredText(L.contactName, 'Nom du contact'),
    role: purchaseOptionalText(L.contactRole).optional(),
    phone: phone.optional(),
    email: email.optional(),
    isPrimary: z.boolean().default(false),
  })
  .strict();
export type SupplierContactInput = z.infer<typeof SupplierContactInput>;

const contacts = z
  .array(SupplierContactInput)
  .max(L.contactsMax)
  .superRefine((list, ctx) => {
    if (list.filter((c) => c.isPrimary).length > 1) {
      purchaseIssue(ctx, 'SUPPLIER_CONTACT_PRIMARY_DUPLICATE', 'Un seul contact principal.');
    }
  });

/** Champs de la fiche, hors moyens de paiement (§ 3.1 : routes dédiées). */
const supplierFields = {
  kind: z.enum(SUPPLIER_KINDS).optional(),
  nif: nif.optional(),
  rccm: purchaseOptionalText(L.rccm).optional(),
  nationalId: purchaseOptionalText(L.nationalId).optional(),
  address: purchaseOptionalText(L.address).optional(),
  phone: phone.optional(),
  email: email.optional(),
  website: purchaseOptionalText(L.website).optional(),
  contacts: contacts.optional(),
  defaultCurrency: PurchaseCurrencySchema.nullable().optional(),
  paymentTerms: SupplierPaymentTerms.optional(),
  defaultCategory: PurchaseCategoryCode.nullable().optional(),
  notes: purchaseOptionalText(L.notes).optional(),
};

/** `POST /purchases/suppliers` — `purchase.manage`. */
export const CreateSupplierBody = z
  .object({ name: purchaseRequiredText(L.supplierName, 'Nom'), ...supplierFields })
  .strict();
export type CreateSupplierBody = z.infer<typeof CreateSupplierBody>;

/** `PUT /purchases/suppliers/:id` — `purchase.manage`. */
export const UpdateSupplierBody = z
  .object({
    expectedRevision: PurchaseExpectedRevision,
    name: purchaseRequiredText(L.supplierName, 'Nom').optional(),
    ...supplierFields,
  })
  .strict();
export type UpdateSupplierBody = z.infer<typeof UpdateSupplierBody>;

/** `POST …/:id/archive`, `…/restore`. */
export const SupplierRevisionBody = z
  .object({ expectedRevision: PurchaseExpectedRevision })
  .strict();
export type SupplierRevisionBody = z.infer<typeof SupplierRevisionBody>;

/** `POST …/:id/merge` — refusé par le service si les deux NIF diffèrent. */
export const MergeSupplierBody = z
  .object({ targetSupplierId: PurchaseId, expectedRevision: PurchaseExpectedRevision })
  .strict();
export type MergeSupplierBody = z.infer<typeof MergeSupplierBody>;

// ── Moyens de paiement (§ 2.1.1) : en clair à l'écriture seulement ─────────

const DIGITS_AND_SEPARATORS = /^[A-Za-z0-9][A-Za-z0-9 .-]*$/;

const bankDetails = z
  .object({
    bankName: purchaseRequiredText(L.bankName, 'Banque'),
    accountHolder: purchaseRequiredText(L.accountHolder, 'Titulaire'),
    accountNumber: purchaseRequiredText(L.accountNumber, 'Numéro de compte').refine(
      (v) => DIGITS_AND_SEPARATORS.test(v),
      { message: 'Numéro de compte : lettres, chiffres, espaces, points ou tirets.' },
    ),
    iban: purchaseOptionalText(L.iban)
      .transform((v) => (v === null ? null : v.replace(/\s+/g, '').toUpperCase()))
      .refine((v) => v === null || /^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(v), {
        message: 'IBAN : deux lettres, deux chiffres, puis lettres et chiffres.',
      })
      .optional(),
    swift: purchaseOptionalText(L.swift)
      .transform((v) => (v === null ? null : v.toUpperCase()))
      .refine((v) => v === null || /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(v), {
        message: 'SWIFT : 8 ou 11 lettres ou chiffres.',
      })
      .optional(),
  })
  .strict();

const mobileMoneyDetails = z
  .object({
    operator: purchaseRequiredText(L.mobileOperator, 'Opérateur'),
    phoneNumber: purchaseRequiredText(L.phone, 'Numéro').refine(
      (v) => PURCHASE_PHONE_PATTERN.test(v),
      { message: 'Numéro de téléphone invalide.' },
    ),
    holderName: purchaseRequiredText(L.holderName, 'Titulaire'),
  })
  .strict();

/** `POST …/:id/payment-methods` — `purchase.manage` ; audit strict, notification. */
export const CreateSupplierPaymentMethodBody = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('bank'),
      label: purchaseRequiredText(L.paymentMethodLabel, 'Libellé'),
      isDefault: z.boolean().default(false),
      details: bankDetails,
      expectedRevision: PurchaseExpectedRevision,
    })
    .strict(),
  z
    .object({
      kind: z.literal('mobile_money'),
      label: purchaseRequiredText(L.paymentMethodLabel, 'Libellé'),
      isDefault: z.boolean().default(false),
      details: mobileMoneyDetails,
      expectedRevision: PurchaseExpectedRevision,
    })
    .strict(),
]);
export type CreateSupplierPaymentMethodBody = z.infer<typeof CreateSupplierPaymentMethodBody>;

/**
 * `PUT …/:id/payment-methods/:methodId`. La nature ne change pas ; `details`, s'il est
 * fourni, REMPLACE le clair (il est rechiffré), sinon seul le libellé ou le défaut change.
 */
export const UpdateSupplierPaymentMethodBody = z
  .object({
    label: purchaseRequiredText(L.paymentMethodLabel, 'Libellé').optional(),
    isDefault: z.boolean().optional(),
    details: z.union([bankDetails, mobileMoneyDetails]).optional(),
    expectedRevision: PurchaseExpectedRevision,
  })
  .strict();
export type UpdateSupplierPaymentMethodBody = z.infer<typeof UpdateSupplierPaymentMethodBody>;

/** `GET /purchases/suppliers?q=&active=&cursor=&limit=`. */
export const ListSuppliersQuery = z
  .object({
    q: z.string().trim().min(1).max(L.search).optional(),
    active: purchaseBooleanParam.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PURCHASE_PAGE_LIMIT_MAX)
      .default(PURCHASE_PAGE_LIMIT_DEFAULT),
  })
  .strict();
export type ListSuppliersQuery = z.infer<typeof ListSuppliersQuery>;

// ── Vues (réponses de l'API) ────────────────────────────────────────────────

export interface SupplierContactView {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}

/** Moyen de paiement tel que servi partout : MASQUÉ (`Rawbank •••• 4521`). */
export interface SupplierPaymentMethodView {
  id: string;
  kind: SupplierPaymentMethodKind;
  label: string;
  isDefault: boolean;
  masked: string;
  /** HMAC tronqué : signale deux fournisseurs qui partagent un compte. */
  fingerprint: string;
  /** Instant ISO du dernier changement ; sert au bandeau d'alerte (§ 2.1.1). */
  changedAt: string;
  changedBy: string;
}

/** Réponse de `…/reveal` (`payables.pay`, audit strict) : le clair d'un seul moyen. */
export type SupplierPaymentMethodRevealView =
  | {
      id: string;
      kind: 'bank';
      details: {
        bankName: string;
        accountHolder: string;
        accountNumber: string;
        iban: string | null;
        swift: string | null;
      };
    }
  | {
      id: string;
      kind: 'mobile_money';
      details: { operator: string; phoneNumber: string; holderName: string };
    };

export interface SupplierView {
  id: string;
  name: string;
  kind: SupplierKind;
  nif: string | null;
  rccm: string | null;
  nationalId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  contacts: SupplierContactView[];
  defaultCurrency: PurchaseCurrency | null;
  paymentTerms: SupplierPaymentTerms;
  defaultCategory: string | null;
  paymentMethods: SupplierPaymentMethodView[];
  /** Alerte de changement de coordonnées en cours (§ 2.1.1), sinon `null`. */
  paymentDetailsChangedAlert: { at: string; by: string; until: string } | null;
  notes: string | null;
  active: boolean;
  mergedInto: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Ligne de la liste : la fiche et, si l'appelant détient AUSSI `treasury.read`, le
 * reste dû par devise (sinon `null` — jamais additionné entre devises).
 */
export interface SupplierListItem extends SupplierView {
  remainingByCurrency: Partial<Record<PurchaseCurrency, string>> | null;
}

export interface SupplierPage {
  items: SupplierListItem[];
  nextCursor: string | null;
}

export interface SupplierWarning {
  code: PurchaseWarningCode;
  /** Fiche concernée (homonyme, ou fiche qui partage les coordonnées). */
  supplierId: string;
}

/** Réponse d'une création ou d'une mise à jour : la fiche et ses avertissements. */
export interface SupplierWriteResult {
  supplier: SupplierView;
  warnings: SupplierWarning[];
}

/** Section de la fiche 360° (§ 3.1.1) : masquée ⇒ aucune donnée. */
export interface SupplierOverviewSection<T> {
  status: PurchaseSectionStatus;
  data: T | null;
}

/** Rapport de migration des fournisseurs texte (§ 2.9). */
export interface SupplierMigrationReportView {
  suppliersCreated: number;
  expensesLinked: number;
  recurringLinked: number;
  suppliers: { supplierId: string; name: string; spellings: string[]; expenses: number }[];
}
