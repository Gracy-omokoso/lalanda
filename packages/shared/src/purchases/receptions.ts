// Réceptions et pièces jointes des achats — corps, requêtes et vues (ADR-0044 § 2.4,
// § 2.7, § 3.4). ADR-0044 — P4.
//
// Une réception constate une livraison (ou un « service fait ») sur une commande ;
// aucune quantité en stock n'est tenue (§ 6.6). La somme reçue d'une ligne peut
// DÉPASSER la commande : c'est un écart (`RECEIVED_OVER_ORDERED`), jamais un refus.
// Les règles qui exigent la base (commande de l'organisation, ligne de la commande,
// date jamais future au jour de Kinshasa) sont vérifiées par le service.

import { z } from 'zod';

import {
  PurchaseCalendarDay,
  PurchaseExpectedRevision,
  PurchaseId,
  PurchaseQuantity,
  purchaseFr,
  purchaseOptionalText,
  purchaseRequiredText,
} from './common.js';
import {
  PURCHASE_LIMITS,
  PURCHASE_PAGE_LIMIT_DEFAULT,
  PURCHASE_PAGE_LIMIT_MAX,
  type PurchaseOrderStatus,
  type PurchaseReceptionStatus,
} from './constants.js';

const L = PURCHASE_LIMITS;

// ── Pièces jointes (§ 2.7) ──────────────────────────────────────────────────

/** Types acceptés, déduits du CONTENU (jamais du nom ni de l'en-tête du client). */
export const PURCHASE_ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;
export type PurchaseAttachmentType = (typeof PURCHASE_ATTACHMENT_TYPES)[number];

/**
 * Bornes du § 2.7 (motif exact d'ADR-0039 § 2.5) : images assainies ≤ 2 Mio, PDF
 * ≤ 10 Mio non analysés, 30 envois par heure et par utilisateur, 1 Gio par
 * organisation EN COMMUN avec les pièces des projets.
 */
export const PURCHASE_ATTACHMENT_LIMITS = Object.freeze({
  imageMaxBytes: 2 * 1024 * 1024,
  pdfMaxBytes: 10 * 1024 * 1024,
  uploadsPerHourPerUser: 30,
  fileNameMax: 200,
  storagePerOrganizationBytes: 1024 * 1024 * 1024,
});

/** Pièce d'une réception ou d'une facture fournisseur (une par document en R3). */
export interface PurchaseAttachmentView {
  fileName: string;
  contentType: PurchaseAttachmentType;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

// ── Corps ───────────────────────────────────────────────────────────────────

export const PurchaseReceptionLineInput = z
  .object({
    orderLineId: z
      .string(purchaseFr('Ligne de commande attendue.'))
      .trim()
      .min(1, { message: 'Ligne de commande attendue.' })
      .max(64),
    quantity: PurchaseQuantity,
  })
  .strict();
export type PurchaseReceptionLineInput = z.infer<typeof PurchaseReceptionLineInput>;

export const CreatePurchaseReceptionBody = z
  .object({
    orderId: PurchaseId,
    receivedOn: PurchaseCalendarDay,
    lines: z
      .array(PurchaseReceptionLineInput, purchaseFr('Lignes attendues.'))
      .min(1, { message: 'Au moins une ligne reçue.' })
      .max(L.linesMax, { message: `${L.linesMax} lignes au plus.` }),
    deliveryNoteRef: purchaseOptionalText(L.deliveryNoteRef).optional(),
    note: purchaseOptionalText(L.receptionNote).optional(),
  })
  .strict();
export type CreatePurchaseReceptionBody = z.infer<typeof CreatePurchaseReceptionBody>;

export const CancelPurchaseReceptionBody = z
  .object({
    reason: purchaseRequiredText(L.cancellationReason, 'Motif'),
    expectedRevision: PurchaseExpectedRevision,
  })
  .strict();
export type CancelPurchaseReceptionBody = z.infer<typeof CancelPurchaseReceptionBody>;

export const ListPurchaseReceptionsQuery = z
  .object({
    orderId: PurchaseId.optional(),
    from: PurchaseCalendarDay.optional(),
    to: PurchaseCalendarDay.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PURCHASE_PAGE_LIMIT_MAX)
      .default(PURCHASE_PAGE_LIMIT_DEFAULT),
  })
  .strict();
export type ListPurchaseReceptionsQuery = z.infer<typeof ListPurchaseReceptionsQuery>;

// ── Vues ────────────────────────────────────────────────────────────────────

export interface PurchaseReceptionLineView {
  orderLineId: string;
  /** Libellé de la ligne de commande (lecture de la commande). */
  label: string | null;
  unit: string | null;
  quantity: string;
}

export interface PurchaseReceptionView {
  id: string;
  orderId: string;
  orderNumber: string | null;
  supplierId: string;
  receivedOn: string;
  lines: PurchaseReceptionLineView[];
  deliveryNoteRef: string | null;
  note: string | null;
  attachment: PurchaseAttachmentView | null;
  status: PurchaseReceptionStatus;
  cancellation: { at: string; by: string; reason: string } | null;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseReceptionPage {
  items: PurchaseReceptionView[];
  nextCursor: string | null;
}

/**
 * Réponse d'une écriture : la réception et le statut de la commande, DÉRIVÉ des
 * réceptions par le moteur (`orderReceptionStatus`), avec le reste à recevoir.
 */
export interface PurchaseReceptionWriteResult {
  reception: PurchaseReceptionView;
  order: {
    id: string;
    status: PurchaseOrderStatus;
    lines: {
      orderLineId: string;
      receivable: boolean;
      ordered: string;
      received: string;
      remaining: string;
      overReceived: string;
    }[];
  };
}
