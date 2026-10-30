// Dépense possédée par les achats — ADR-0044 § 2.8, § 6.2 et § 8 (lot P8). Logique
// pure.
//
// Un paiement fournisseur crée (ou rattache) des dépenses `origin.kind =
// 'supplier_payment'`. La trésorerie les montre en LECTURE SEULE : ni annulation, ni
// pièce jointe depuis ici (l'API refuse de toute façon : `409
// EXPENSE_OWNED_BY_PURCHASES`) ; un lien mène au paiement, sur la fiche de la facture
// fournisseur qu'il règle.

import type { ExpenseView } from '@/lib/treasury-api';

type Depense = Pick<ExpenseView, 'origin'>;

export function estPossedeeParAchats(d: Depense): boolean {
  return d.origin !== undefined && d.origin !== null && d.origin.kind === 'supplier_payment';
}

export interface LienPaiement {
  href: string;
  libelle: string;
}

/** Lien « Ouvrir le paiement PF… » vers la facture réglée (section des paiements). */
export function lienPaiement(d: Depense): LienPaiement | null {
  if (!estPossedeeParAchats(d)) return null;
  const o = d.origin!;
  return {
    href: `/achats/factures/${encodeURIComponent(o.invoiceId)}#paiements`,
    libelle: o.paymentNumber
      ? `Ouvrir le paiement ${o.paymentNumber}`
      : 'Ouvrir le paiement fournisseur',
  };
}

export const MENTION_POSSEDEE =
  'Paiement d’une facture fournisseur : cette dépense se modifie ou s’annule depuis les achats.';

/** Message d'un refus `409 EXPENSE_OWNED_BY_PURCHASES` (route de la trésorerie). */
export function messageDepensePossedee(code: string | null): string | null {
  return code === 'EXPENSE_OWNED_BY_PURCHASES' ? MENTION_POSSEDEE : null;
}

/** Les gestes de la trésorerie (annuler, joindre) sont-ils permis sur cette dépense ? */
export function gestesTresorerie(
  d: Pick<ExpenseView, 'origin' | 'status'>,
  gerer: boolean,
): { annuler: boolean; joindre: boolean } {
  const libre = gerer && d.status === 'recorded' && !estPossedeeParAchats(d);
  return { annuler: libre, joindre: libre };
}
