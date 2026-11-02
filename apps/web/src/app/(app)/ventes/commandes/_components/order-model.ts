// Logique pure des écrans Commandes clients — ADR-0050 § 2.2, § 9, lot V7.
//
// Le reste à facturer est calculé par le moteur (`orderInvoicing`) et servi par l'API ;
// l'écran ne fait que proposer des quantités (celles « à préparer ») et contrôler leur
// FORME. Préparer une facture crée un BROUILLON : l'émission reste dans l'écran des
// factures (`sales.invoice`).

import {
  SALES_CONTRACT_LIMITS as L,
  type SalesOrderInvoicingStatus,
  type SalesOrderStatus,
} from '@lalanda/shared/sales-contracts';

import type {
  OrderInvoicingView,
  PrepareOrderInvoiceBody,
  SalesOrderBody,
} from '@/lib/api-sales-contracts';

import type { FormulaireDocument } from '../../factures/_components/invoice-model';
import {
  comparerDecimaux,
  lireQuantiteSaisie,
  preparerDocument,
  quantitePourSaisie,
} from '../../factures/_components/invoice-model';

export const FILTRES_COMMANDES: readonly { valeur: SalesOrderStatus | 'all'; label: string }[] = [
  { valeur: 'all', label: 'Tous les statuts' },
  { valeur: 'draft', label: 'Brouillons' },
  { valeur: 'confirmed', label: 'Confirmées' },
  { valeur: 'closed', label: 'Closes' },
  { valeur: 'cancelled', label: 'Annulées' },
];

export const FACTURATION_COMMANDE_LABELS: Record<SalesOrderInvoicingStatus, string> = {
  not_invoiced: 'Rien de facturé',
  partially_invoiced: 'Facturée en partie',
  invoiced: 'Entièrement facturée',
};

export function tonCommande(
  status: SalesOrderStatus,
  facturation: SalesOrderInvoicingStatus | null,
): 'neutre' | 'attention' {
  return status === 'confirmed' && facturation === 'partially_invoiced' ? 'attention' : 'neutre';
}

export interface MetaCommande {
  orderedOn: string;
  customerReference: string;
  requestedDeliveryDate: string;
  notes: string;
  opportunityId: string | null;
}

export function metaVide(aujourdhui: string): MetaCommande {
  return {
    orderedOn: aujourdhui,
    customerReference: '',
    requestedDeliveryDate: '',
    notes: '',
    opportunityId: null,
  };
}

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Contrôle de forme (celui des factures, client OBLIGATOIRE) puis corps de la commande.
 * Une personne sans fiche est refusée : un prospect est d'abord converti en client
 * (décision ouverte n° 20).
 */
export function preparerCommande(
  f: FormulaireDocument,
  m: MetaCommande,
): { ok: true; corps: SalesOrderBody } | { ok: false; champs: Record<string, string> } {
  const doc = preparerDocument({ ...f, type: 'FV', paiements: [], nature: null });
  const champs: Record<string, string> = doc.ok ? {} : { ...doc.champs };
  if (f.client === null || f.client.mode !== 'fiche') {
    champs['customer'] = 'Choisissez un client enregistré.';
  }
  if (!JOUR.test(m.orderedOn)) champs['orderedOn'] = 'Date de la commande : AAAA-MM-JJ.';
  if (m.requestedDeliveryDate !== '' && !JOUR.test(m.requestedDeliveryDate)) {
    champs['requestedDeliveryDate'] = 'Date de livraison : AAAA-MM-JJ.';
  }
  if (m.customerReference.length > L.customerReferenceMax) {
    champs['customerReference'] = `${L.customerReferenceMax} caractères au plus.`;
  }
  if (m.notes.length > L.notesMax) champs['notes'] = `${L.notesMax} caractères au plus.`;
  if (!doc.ok || Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      orderedOn: m.orderedOn,
      customerReference: m.customerReference.trim() === '' ? null : m.customerReference.trim(),
      requestedDeliveryDate: m.requestedDeliveryDate === '' ? null : m.requestedDeliveryDate,
      notes: m.notes.trim() === '' ? null : m.notes.trim(),
      opportunityId: m.opportunityId,
      currency: doc.corps.currency,
      priceMode: doc.corps.priceMode,
      customer: doc.corps.customer,
      lines: doc.corps.lines,
    },
  };
}

/** Quantités proposées : ce qui reste « à préparer » de chaque ligne (moteur). */
export function quantitesProposees(invoicing: OrderInvoicingView | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of invoicing?.lines ?? []) {
    if (comparerDecimaux(l.remainingToPrepare, '0') === 1) {
      out[l.lineRef] = quantitePourSaisie(l.remainingToPrepare);
    }
  }
  return out;
}

/**
 * Corps de « Préparer la facture » : les lignes avec une quantité saisie. Une quantité
 * au-delà du reste à préparer est SIGNALÉE (l'API tranche ; le moteur la comptera en
 * « facturé au-delà »), jamais corrigée.
 */
export function preparerFacturation(p: {
  expectedRevision: number;
  type: 'FV' | 'EV';
  quantites: Record<string, string>;
  invoicing: OrderInvoicingView | null;
}):
  | { ok: true; corps: PrepareOrderInvoiceBody; avertissements: string[] }
  | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  const avertissements: string[] = [];
  const lines: { lineRef: string; quantity: string }[] = [];
  for (const [lineRef, saisie] of Object.entries(p.quantites)) {
    if (saisie.trim() === '') continue;
    const q = lireQuantiteSaisie(saisie);
    if (!q.ok) {
      champs[lineRef] = q.erreur;
      continue;
    }
    const reste = p.invoicing?.lines.find((l) => l.lineRef === lineRef)?.remainingToPrepare;
    if (reste !== undefined && comparerDecimaux(q.valeur, reste) === 1) {
      avertissements.push(
        `Ligne ${lineRef} : ${quantitePourSaisie(q.valeur)} dépasse le reste à préparer (${quantitePourSaisie(reste)}).`,
      );
    }
    lines.push({ lineRef, quantity: q.valeur });
  }
  if (lines.length === 0 && Object.keys(champs).length === 0) {
    champs['lines'] = 'Indiquez au moins une quantité à facturer.';
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: { expectedRevision: p.expectedRevision, type: p.type, lines },
    avertissements,
  };
}
