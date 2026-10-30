// Envoi d'un document de vente par e-mail — règles pures (ADR-0042).
//
// Ce fichier ne touche ni à la base, ni au rendu, ni au transport : il dit quel
// document part (§ 2), sous quel intitulé et avec quelle mention fixe, ce que
// l'on préremplit (§ 3) et ce que l'API accepte en entrée. Testé sans Nest.

import { z } from 'zod';

import type { InvoiceStatus, InvoiceType } from '../invoices/invoice.contract.js';
import { CREDIT_NOTE_TYPES } from '../invoices/invoice.contract.js';

/** Nature du document envoyé : décide de l'intitulé et de la mention fixe. */
// ADR-0044 § 3.3 (lot P3) : `purchase_order`, le bon de commande envoyé au fournisseur.
export type DocumentEmailNature =
  'invoice' | 'credit_note' | 'proforma' | 'quote' | 'purchase_order';

/** Code du 409 d'un document qui ne part pas (ADR-0042 § 2). */
export const DOCUMENT_NOT_SENDABLE = 'DOCUMENT_NOT_SENDABLE';

export type Sendability =
  { sendable: true; nature: DocumentEmailNature } | { sendable: false; reason: string };

/**
 * Document de `sales_invoices` (§ 2). `printedKind` est la nature IMPRIMÉE
 * (`documentKindOf`) : un `normalized` sans éléments de sécurité s'imprime pro
 * forma et ne part pas.
 */
export function invoiceSendability(
  status: InvoiceStatus,
  type: InvoiceType,
  printedKind: 'invoice' | 'proforma',
): Sendability {
  const credit = (CREDIT_NOTE_TYPES as readonly InvoiceType[]).includes(type);
  switch (status) {
    case 'draft':
      return { sendable: true, nature: 'proforma' };
    case 'issued':
      return { sendable: true, nature: credit ? 'credit_note' : 'invoice' };
    case 'normalized':
      if (printedKind !== 'invoice') {
        return {
          sendable: false,
          reason:
            'Ce document normalisé n’a pas ses éléments de sécurité : il ne peut pas être envoyé.',
        };
      }
      return { sendable: true, nature: credit ? 'credit_note' : 'invoice' };
    case 'pending_normalization':
      return {
        sendable: false,
        reason: 'La normalisation DGI est en cours : attendez son issue avant d’envoyer.',
      };
    case 'normalization_failed':
      return {
        sendable: false,
        reason: 'La normalisation DGI a échoué : reprenez-la avant d’envoyer ce document.',
      };
  }
}

/** Devis (§ 2) : envoyé et non échu, ou accepté. `status` est le statut DÉRIVÉ. */
export function quoteSendability(
  status: 'draft' | 'sent' | 'accepted' | 'refused' | 'expired',
): Sendability {
  switch (status) {
    case 'sent':
    case 'accepted':
      return { sendable: true, nature: 'quote' };
    case 'draft':
      return {
        sendable: false,
        reason: 'Marquez d’abord ce devis comme envoyé, puis envoyez-le par e-mail.',
      };
    case 'refused':
      return { sendable: false, reason: 'Ce devis a été refusé : il ne peut plus être envoyé.' };
    case 'expired':
      return {
        sendable: false,
        reason: 'Ce devis est échu : créez une nouvelle version avant de l’envoyer.',
      };
  }
}

const LABELS: Record<DocumentEmailNature, string> = {
  invoice: 'Facture',
  credit_note: 'Avoir',
  proforma: 'Pro forma',
  quote: 'Devis',
  purchase_order: 'Bon de commande',
};

/** Mention fixe, imprimée hors du texte modifiable (§ 2). */
export function noticeOf(nature: DocumentEmailNature): string | null {
  if (nature === 'proforma') return 'Pro forma — ce document n’est pas une facture.';
  if (nature === 'quote') return 'Devis — ce document n’est pas une facture.';
  if (nature === 'purchase_order') return 'Bon de commande — ce document n’est pas une facture.';
  return null;
}

export function headingOf(nature: DocumentEmailNature, reference: string): string {
  return `${LABELS[nature]} ${reference}`;
}

export interface DocumentEmailDefaultsInput {
  nature: DocumentEmailNature;
  reference: string;
  sellerName: string;
  /** Total imprimé, déjà formaté par le modèle du document. */
  total: string;
  currency: string;
  senderName: string;
  /** Devis : date de validité lisible (« 30/11/2026 »), sinon `null`. */
  validUntil?: string | null;
}

/** Objet et message préremplis (§ 3), modifiables par l'utilisateur. */
export function documentEmailDefaults(i: DocumentEmailDefaultsInput): {
  subject: string;
  message: string;
} {
  const subject = `${headingOf(i.nature, i.reference)} — ${i.sellerName}`.slice(0, 200);
  const montant = `${i.total} ${i.currency}`;
  let corps: string;
  switch (i.nature) {
    case 'invoice':
      corps = `Veuillez trouver ci-joint notre facture n° ${i.reference}, d’un montant de ${montant}.`;
      break;
    case 'credit_note':
      corps = `Veuillez trouver ci-joint notre avoir n° ${i.reference}, d’un montant de ${montant}.`;
      break;
    case 'proforma':
      corps =
        `Veuillez trouver ci-joint le pro forma ${i.reference}, d’un montant de ${montant}. ` +
        'Ce document n’est pas une facture.';
      break;
    case 'quote':
      corps =
        `Veuillez trouver ci-joint notre devis n° ${i.reference}, d’un montant de ${montant}` +
        (i.validUntil ? `, valable jusqu’au ${i.validUntil}.` : '.');
      break;
    case 'purchase_order':
      corps =
        `Veuillez trouver ci-joint notre bon de commande n° ${i.reference}, d’un montant de ${montant}. ` +
        'Ce document n’est pas une facture.';
      break;
  }
  return {
    subject,
    message: `Bonjour,\n\n${corps}\n\nCordialement,\n${i.senderName}\n${i.sellerName}`,
  };
}

// ── Entrée de `POST …/email` ─────────────────────────────────────────────────

const address = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ message: 'Adresse e-mail invalide.' }));

/** Corps de l'envoi (§ 3). Objet sans saut de ligne : pas d'injection d'en-tête. */
export const DocumentEmailSchema = z
  .object({
    to: address,
    cc: z.array(address).max(5).default([]),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((s) => !/[\r\n]/.test(s), 'L’objet tient sur une seule ligne.'),
    message: z.string().max(5000),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>([v.to.toLowerCase()]);
    v.cc.forEach((c, i) => {
      const k = c.toLowerCase();
      if (seen.has(k)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cc', i],
          message: 'Adresse en double (déjà destinataire ou en copie).',
        });
      }
      seen.add(k);
    });
  });

export type DocumentEmailInput = z.infer<typeof DocumentEmailSchema>;

/** Réponse de `GET …/email` : valeurs préremplies et possibilité d'envoi. */
export interface DocumentEmailDraft {
  sendable: boolean;
  reason: string | null;
  nature: DocumentEmailNature | null;
  to: string | null;
  cc: string[];
  subject: string;
  message: string;
  attachmentName: string | null;
}

/** Réponse de `POST …/email`. */
export interface DocumentEmailResult {
  delivered: boolean;
  reason: 'MAIL_NOT_CONFIGURED' | 'SMTP_ERROR' | 'ZEPTOMAIL_ERROR' | null;
  to: string;
  cc: string[];
}
