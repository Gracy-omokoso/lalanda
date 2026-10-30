import { describe, expect, it } from 'vitest';

import {
  MENTION_POSSEDEE,
  estPossedeeParAchats,
  gestesTresorerie,
  lienPaiement,
  messageDepensePossedee,
} from './depense-possedee';

const origin = {
  kind: 'supplier_payment' as const,
  paymentId: 'p1',
  invoiceId: 'f 1',
  allocationIndex: 0,
};

describe('dépense possédée par les achats (ADR-0044 § 2.8)', () => {
  it('reconnue par son origine ; une dépense directe ne l’est pas', () => {
    expect(estPossedeeParAchats({ origin })).toBe(true);
    expect(estPossedeeParAchats({ origin: null })).toBe(false);
    expect(estPossedeeParAchats({})).toBe(false);
  });

  it('lien vers le paiement, sur la fiche de la facture réglée', () => {
    expect(lienPaiement({ origin: { ...origin, paymentNumber: 'PF2610-000002' } })).toEqual({
      href: '/achats/factures/f%201#paiements',
      libelle: 'Ouvrir le paiement PF2610-000002',
    });
    expect(lienPaiement({ origin })!.libelle).toBe('Ouvrir le paiement fournisseur');
    expect(lienPaiement({ origin: null })).toBeNull();
  });

  it('lecture seule : ni annulation ni pièce depuis la trésorerie', () => {
    expect(gestesTresorerie({ origin, status: 'recorded' }, true)).toEqual({
      annuler: false,
      joindre: false,
    });
    expect(gestesTresorerie({ origin: null, status: 'recorded' }, true)).toEqual({
      annuler: true,
      joindre: true,
    });
    expect(gestesTresorerie({ origin: null, status: 'recorded' }, false).annuler).toBe(false);
    expect(gestesTresorerie({ origin: null, status: 'cancelled' }, true).annuler).toBe(false);
  });

  it('refus 409 EXPENSE_OWNED_BY_PURCHASES traduit', () => {
    expect(messageDepensePossedee('EXPENSE_OWNED_BY_PURCHASES')).toBe(MENTION_POSSEDEE);
    expect(messageDepensePossedee('AUTRE')).toBeNull();
    expect(messageDepensePossedee(null)).toBeNull();
  });
});
