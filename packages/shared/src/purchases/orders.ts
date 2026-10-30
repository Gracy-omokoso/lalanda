// Demandes d'achat et bons de commande — corps, requêtes de liste et vues
// (ADR-0044 § 2.3, § 3.2, § 3.3). ADR-0044 — P3.
//
// Un seul document, deux phases (O1) : il naît DEMANDE (`draft` → `submitted` →
// `approved` | `rejected`) et devient BON DE COMMANDE à l'approbation complète
// (numéro `BC`), puis vit sa vie de commande. Les montants (lignes, sous-total,
// taxes déclarées, total) sont rendus par le moteur (`computeOrderTotals`) ; ce
// fichier ne valide que la FORME. Les taxes sont celles INDIQUÉES par le
// fournisseur, jamais calculées (§ 9).
//
// Les règles qui exigent la base (fournisseur actif de l'organisation, projet non
// archivé, catégorie connue, demandeur détenteur de `purchase.request`) sont
// vérifiées par le service.

import { z } from 'zod';

import {
  PurchaseAmount,
  PurchaseCalendarDay,
  PurchaseCurrencySchema,
  PurchaseExpectedRevision,
  PurchaseId,
  PurchaseQuantity,
  purchaseFr,
  purchaseIssue,
  purchaseOptionalText,
  purchaseRequiredText,
} from './common.js';
import {
  PURCHASE_LIMITS,
  PURCHASE_LINE_KINDS,
  PURCHASE_ORDER_PHASES,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_PAGE_LIMIT_DEFAULT,
  PURCHASE_PAGE_LIMIT_MAX,
  type PurchaseApprovalCount,
  type PurchaseApprovalDecisionValue,
  type PurchaseCurrency,
  type PurchaseLineKind,
  type PurchaseOrderPhase,
  type PurchaseOrderSentVia,
  type PurchaseOrderStatus,
} from './constants.js';
import { PurchaseCategoryCode } from './suppliers.js';

const L = PURCHASE_LIMITS;

/** Codes d'erreur propres au lot P3 (en plus de `PURCHASE_ERROR_CODES`). */
export const PURCHASE_ORDER_ERROR_CODES = [
  'PURCHASE_ORDER_NOT_FOUND',
  'PURCHASE_ORDER_NOT_EDITABLE',
  'PURCHASE_ORDER_STATUS',
  'PURCHASE_ORDER_CURRENCY_LOCKED',
  'PURCHASE_ORDER_SUPPLIER_REQUIRED',
  'PURCHASE_ORDER_SUPPLIER_INACTIVE',
  'PURCHASE_ORDER_REQUESTER_INELIGIBLE',
  'PURCHASE_ORDER_NOT_YOURS',
  'PURCHASE_CATEGORY_UNKNOWN',
  'DOCUMENT_NOT_PRINTABLE',
] as const;
export type PurchaseOrderErrorCode = (typeof PURCHASE_ORDER_ERROR_CODES)[number];

const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/** Remise en pourcentage, 0 à 100, deux décimales au plus, en chaîne ; vide → `null`. */
export const PurchaseDiscountPercent = z
  .union([z.string(), z.null()])
  .transform((raw, ctx): string | null => {
    if (raw === null || raw.trim() === '') return null;
    const m = PERCENT.exec(raw.trim());
    const value = m ? Number(raw.trim()) : Number.NaN;
    if (m === null || !(value >= 0 && value <= 100)) {
      purchaseIssue(ctx, 'DISCOUNT_INVALID', 'Remise : 0 à 100 %, deux décimales au plus.');
      return z.NEVER;
    }
    return raw.trim();
  });

/** Identifiant d'utilisateur (better-auth) : opaque, borné. */
const PurchaseUserId = z.string(purchaseFr('Identifiant de membre attendu.')).trim().min(1).max(64);

/** Ligne d'une demande (§ 2.3). `id` : ligne existante conservée lors d'une modification. */
export const PurchaseOrderLineBody = z
  .object({
    id: z.string().min(1).max(64).optional(),
    label: purchaseRequiredText(L.lineLabel, 'Libellé de la ligne'),
    quantity: PurchaseQuantity,
    unit: purchaseOptionalText(L.lineUnit).optional(),
    unitPrice: PurchaseAmount,
    discountPercent: PurchaseDiscountPercent.optional(),
    kind: z.enum(PURCHASE_LINE_KINDS, purchaseFr('Nature attendue : goods ou service.')),
    /** Défaut : `true` pour un bien, `false` pour un service. */
    receivable: z.boolean().optional(),
    /** Catégorie de dépense (ADR-0034 § 1) ; défaut : celle du fournisseur. */
    category: PurchaseCategoryCode.nullable().optional(),
    workProjectId: PurchaseId.nullable().optional(),
    itemRef: purchaseOptionalText(L.itemRef).optional(),
  })
  .strict();
export type PurchaseOrderLineBody = z.infer<typeof PurchaseOrderLineBody>;

/** Taxe telle qu'indiquée par le fournisseur sur son devis — jamais calculée (§ 9). */
export const PurchaseDeclaredTaxBody = z
  .object({
    label: purchaseRequiredText(L.taxLabel, 'Libellé de la taxe'),
    amount: PurchaseAmount,
  })
  .strict();
export type PurchaseDeclaredTaxBody = z.infer<typeof PurchaseDeclaredTaxBody>;

const orderFields = {
  title: purchaseRequiredText(L.title, 'Objet'),
  justification: purchaseOptionalText(L.justification).optional(),
  /** Requis à la soumission, facultatif sur un brouillon. */
  supplierId: PurchaseId.nullable().optional(),
  currency: PurchaseCurrencySchema,
  lines: z
    .array(PurchaseOrderLineBody)
    .min(1, { message: 'Au moins une ligne.' })
    .max(L.linesMax, { message: `${L.linesMax} lignes au plus.` }),
  declaredTaxes: z
    .array(PurchaseDeclaredTaxBody)
    .max(L.declaredTaxesMax, { message: `${L.declaredTaxesMax} taxes au plus.` })
    .optional(),
  expectedOn: PurchaseCalendarDay.nullable().optional(),
  deliveryAddress: purchaseOptionalText(L.deliveryAddress).optional(),
  /**
   * Membre qui exprime le besoin ; défaut : l'appelant. Un autre membre seulement si
   * l'appelant détient `purchase.manage` (vérifié par le service).
   */
  requestedBy: PurchaseUserId.optional(),
};

/** `POST /purchases/orders` — `purchase.request` : crée une demande `draft`. */
export const CreatePurchaseOrderBody = z.object(orderFields).strict();
export type CreatePurchaseOrderBody = z.infer<typeof CreatePurchaseOrderBody>;

/**
 * `PUT /purchases/orders/:id` — remplace le contenu. Sur une demande `submitted` ou
 * `approved`, efface les approbations et la remet à `submitted` (§ 2.3).
 */
export const UpdatePurchaseOrderBody = z
  .object({ ...orderFields, expectedRevision: PurchaseExpectedRevision })
  .strict();
export type UpdatePurchaseOrderBody = z.infer<typeof UpdatePurchaseOrderBody>;

/** `POST …/:id/submit`, `…/mark-sent`, `…/close`. */
export const PurchaseOrderRevisionBody = z
  .object({ expectedRevision: PurchaseExpectedRevision })
  .strict();
export type PurchaseOrderRevisionBody = z.infer<typeof PurchaseOrderRevisionBody>;

/** `POST …/:id/approve` — `purchase.approve`. */
export const ApprovePurchaseOrderBody = z
  .object({
    comment: purchaseOptionalText(L.approvalComment).optional(),
    expectedRevision: PurchaseExpectedRevision,
  })
  .strict();
export type ApprovePurchaseOrderBody = z.infer<typeof ApprovePurchaseOrderBody>;

/** `POST …/:id/reject` — `purchase.approve`, commentaire obligatoire. */
export const RejectPurchaseOrderBody = z
  .object({
    comment: purchaseRequiredText(L.approvalComment, 'Motif du refus'),
    expectedRevision: PurchaseExpectedRevision,
  })
  .strict();
export type RejectPurchaseOrderBody = z.infer<typeof RejectPurchaseOrderBody>;

/** `POST …/:id/cancel` — `purchase.manage`, motif obligatoire. */
export const CancelPurchaseOrderBody = z
  .object({
    reason: purchaseRequiredText(L.cancellationReason, 'Motif de l’annulation'),
    expectedRevision: PurchaseExpectedRevision,
  })
  .strict();
export type CancelPurchaseOrderBody = z.infer<typeof CancelPurchaseOrderBody>;

const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(PURCHASE_PAGE_LIMIT_MAX)
  .default(PURCHASE_PAGE_LIMIT_DEFAULT);

/**
 * `GET /purchases/orders?phase=&status=&supplierId=&requestedBy=me|<id>&workProjectId=`
 * — triée par dernière mise à jour décroissante, curseur opaque.
 */
export const ListPurchaseOrdersQuery = z
  .object({
    phase: z.enum(PURCHASE_ORDER_PHASES).optional(),
    status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
    supplierId: PurchaseId.optional(),
    requestedBy: PurchaseUserId.optional(),
    workProjectId: PurchaseId.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit,
  })
  .strict();
export type ListPurchaseOrdersQuery = z.infer<typeof ListPurchaseOrdersQuery>;

/** `GET /purchases/approvals/pending`. */
export const PendingApprovalsQuery = z
  .object({ cursor: z.string().min(1).max(512).optional(), limit })
  .strict();
export type PendingApprovalsQuery = z.infer<typeof PendingApprovalsQuery>;

// ── Vues (réponses de l'API) ────────────────────────────────────────────────

export interface PurchaseOrderLineView {
  id: string;
  label: string;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  discountPercent: string | null;
  kind: PurchaseLineKind;
  receivable: boolean;
  category: string | null;
  workProjectId: string | null;
  itemRef: string | null;
  /** Montant HT de la ligne, rendu par le moteur (`computeOrderTotals`). */
  amount: string;
}

export interface PurchaseDeclaredTaxView {
  label: string;
  amount: string;
}

/** Totaux rendus par le moteur ; jamais additionnés entre devises. */
export interface PurchaseOrderTotalsView {
  subtotal: string;
  taxes: string;
  total: string;
}

export interface PurchaseApprovalView {
  userId: string;
  decision: PurchaseApprovalDecisionValue;
  at: string;
  comment: string | null;
  /** Geste rendu possible par l'échappatoire « approbateur unique » (§ 2.3). */
  soleApprover: boolean;
}

export interface PurchaseOrderView {
  id: string;
  phase: PurchaseOrderPhase;
  status: PurchaseOrderStatus;
  requestNumber: string | null;
  orderNumber: string | null;
  requestedBy: string;
  createdBy: string;
  title: string;
  justification: string | null;
  supplierId: string | null;
  /** Copie d'affichage du nom de la fiche fournisseur. */
  supplierName: string | null;
  currency: PurchaseCurrency;
  lines: PurchaseOrderLineView[];
  declaredTaxes: PurchaseDeclaredTaxView[];
  totals: PurchaseOrderTotalsView;
  expectedOn: string | null;
  deliveryAddress: string | null;
  /** Figé à la soumission par le moteur ; `null` pour un brouillon. */
  requiredApprovals: PurchaseApprovalCount | null;
  approvals: PurchaseApprovalView[];
  approvedTotal: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  sentVia: PurchaseOrderSentVia | null;
  cancellation: { at: string; by: string; reason: string } | null;
  closedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderPage {
  items: PurchaseOrderView[];
  nextCursor: string | null;
}
