import { describe, expect, it } from 'vitest';

import {
  MENTION_POSSEDEE,
  MENTION_POSSEDEE_RH,
  estPossedeeParRh,
  lienNoteFrais,
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

describe('ADR-0051 H16 — dépense possédée par les RH', () => {
  const rh = {
    kind: 'expense_report' as const,
    reportId: 'r1',
    reportNumber: 'NF2611-000001',
    lineIndex: 0,
    settledByAdvanceId: null,
  };

  it('marque « Note de frais », lien vers les RH, jamais confondue avec les achats', () => {
    expect(estPossedeeParRh({ origin: rh })).toBe(true);
    expect(estPossedeeParAchats({ origin: rh })).toBe(false);
    expect(lienPaiement({ origin: rh })).toBeNull();
    expect(lienNoteFrais({ origin: rh })).toEqual({
      href: '/rh/frais?vue=toutes',
      libelle: 'Ouvrir la note de frais NF2611-000001',
    });
    expect(lienNoteFrais({ origin: null })).toBeNull();
  });

  it('lecture seule en trésorerie ; refus `EXPENSE_OWNED_BY_HR` expliqué', () => {
    expect(gestesTresorerie({ origin: rh, status: 'recorded' }, true)).toEqual({
      annuler: false,
      joindre: false,
    });
    expect(messageDepensePossedee('EXPENSE_OWNED_BY_HR')).toBe(MENTION_POSSEDEE_RH);
  });
});
