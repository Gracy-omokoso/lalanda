import { describe, expect, it } from 'vitest';

import type { AdminSubscriptionInvoiceView } from '@/lib/api';

import { gestesFacture, libelleFournisseur, motifValide } from './factures-abonnements-model';

const ligne = (
  extra: Partial<AdminSubscriptionInvoiceView> = {},
): AdminSubscriptionInvoiceView => ({
  id: '1',
  organizationId: 'o',
  organizationName: 'Org',
  provider: 'manual',
  eventId: 'manual:LLD-1',
  reference: 'LLD-1',
  plan: 'pro',
  interval: 'month',
  amountCents: 2204,
  currency: 'USD',
  method: 'mobile_money',
  paidAt: '2026-11-03T00:00:00Z',
  status: 'issued',
  origin: 'automatic',
  invoiceNumber: 'IN2611-000001',
  issuedAt: '2026-11-03T00:00:00Z',
  lastError: null,
  emissionReason: null,
  creditNote: null,
  ...extra,
});

describe('ADR-0047 — factures d’abonnement dans la console', () => {
  it('demander un avoir : facture émise, aucun avoir en cours', () => {
    expect(gestesFacture(ligne(), 'u1').demanderAvoir).toBe(true);
    expect(gestesFacture(ligne({ status: 'failed' }), 'u1').demanderAvoir).toBe(false);
  });

  it('approuver : jamais par la personne qui a demandé', () => {
    const cn = {
      status: 'requested' as const,
      reason: 'Remboursement accordé',
      requestedBy: 'u1',
      approvedBy: null,
      soleApprover: false,
      number: null,
      lastError: null,
    };
    expect(gestesFacture(ligne({ creditNote: cn }), 'u1').approuverAvoir).toBe(false);
    expect(gestesFacture(ligne({ creditNote: cn }), 'u2').approuverAvoir).toBe(true);
    expect(gestesFacture(ligne({ creditNote: cn }), 'u2').demanderAvoir).toBe(false);
  });

  it('motif : dix caractères au moins ; libellés des fournisseurs', () => {
    expect(motifValide('court')).toBe(false);
    expect(motifValide('Régularisation du paiement')).toBe(true);
    expect(libelleFournisseur('stripe')).toBe('Carte (Stripe)');
  });
});
