// Règles d'affichage des factures d'abonnement dans la console (ADR-0047). L'API
// décide ; ce module ne fait que nommer et classer.

import type { AdminSubscriptionInvoiceView } from '@/lib/api';

export const LIBELLES_ETAT_FACTURE: Record<AdminSubscriptionInvoiceView['status'], string> = {
  pending: 'En cours',
  issued: 'Émise',
  failed: 'Non émise',
};

export const LIBELLES_ETAT_AVOIR: Record<
  NonNullable<AdminSubscriptionInvoiceView['creditNote']>['status'],
  string
> = {
  requested: 'Avoir demandé — seconde personne attendue',
  issued: 'Avoir émis',
  failed: 'Avoir non émis',
};

export const MOTIF_MIN = 10;

export function motifValide(motif: string): boolean {
  return motif.trim().length >= MOTIF_MIN;
}

/** Ce qu'un opérateur peut faire sur une ligne, selon son état. */
export function gestesFacture(
  f: AdminSubscriptionInvoiceView,
  operateur: string | null,
): { demanderAvoir: boolean; approuverAvoir: boolean } {
  const cn = f.creditNote;
  return {
    demanderAvoir: f.status === 'issued' && (cn === null || cn.status === 'failed'),
    // Celui qui a demandé l'avoir ne l'approuve pas (l'API tolère le seul détenteur).
    approuverAvoir:
      cn?.status === 'requested' && (operateur === null || cn.requestedBy !== operateur),
  };
}

/** Libellé du fournisseur d'un paiement. */
export function libelleFournisseur(provider: string): string {
  return provider === 'manual'
    ? 'Dépôt manuel'
    : provider === 'stripe'
      ? 'Carte (Stripe)'
      : provider === 'paypal'
        ? 'PayPal'
        : provider;
}
