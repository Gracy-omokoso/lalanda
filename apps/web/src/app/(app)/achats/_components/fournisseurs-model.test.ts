import { describe, expect, it } from 'vitest';

import type { SupplierView } from '@/lib/api-purchases';

import { formatMontant } from '../../ventes/_components/sales-model';

import {
  RAISON_SANS_PAIEMENT,
  boutonAfficher,
  contactPrincipal,
  fournisseurRetenu,
  formulaireFournisseur,
  libelleConditions,
  lignesCoordonnees,
  phraseSection,
  phrasesAvertissements,
  preparerFournisseur,
  requeteFournisseurs,
  resteDuLignes,
  retenirFournisseurs,
  trancheAnciennete,
} from './fournisseurs-model';

describe('liste', () => {
  it('requête : actifs par défaut, recherche bornée', () => {
    expect(requeteFournisseurs({ q: '  soci ', archives: false })).toEqual({
      active: 'true',
      limit: 50,
      q: 'soci',
    });
    expect(requeteFournisseurs({ q: '', archives: true }, 'c')).toEqual({
      active: 'false',
      limit: 50,
      cursor: 'c',
    });
  });
  it('reste dû : une ligne par devise, `null` sans lecture de trésorerie', () => {
    expect(resteDuLignes({ remainingByCurrency: null })).toBeNull();
    expect(resteDuLignes({ remainingByCurrency: { USD: '1500.00', CDF: '20000.00' } })).toEqual([
      formatMontant('20000.00', 'CDF'),
      formatMontant('1500.00', 'USD'),
    ]);
  });
  it('conditions de paiement', () => {
    expect(libelleConditions({ kind: 'immediate' })).toBe('Paiement immédiat');
    expect(libelleConditions({ kind: 'net', days: 30 })).toBe('30 jours net');
    expect(libelleConditions({ kind: 'end_of_month', days: 0 })).toBe('Fin de mois');
    expect(libelleConditions({ kind: 'end_of_month', days: 30 })).toBe('Fin de mois + 30 jours');
  });
  it('mémoire de la liste pour le repli de la fiche', () => {
    retenirFournisseurs([{ id: 'x1', name: 'A' } as SupplierView]);
    expect(fournisseurRetenu('x1')?.name).toBe('A');
    expect(fournisseurRetenu('inconnu')).toBeNull();
  });
  it('contact principal, sinon le premier', () => {
    const c = (id: string, isPrimary: boolean) => ({
      id,
      name: id,
      role: null,
      phone: null,
      email: null,
      isPrimary,
    });
    expect(contactPrincipal({ contacts: [c('a', false), c('b', true)] })?.id).toBe('b');
    expect(contactPrincipal({ contacts: [] })).toBeNull();
  });
});

describe('création', () => {
  it('corps normalisé : NIF, conditions, contact principal', () => {
    const f = {
      ...formulaireFournisseur(),
      name: ' Socimex ',
      nif: 'a-12 345',
      termsKind: 'net' as const,
      termsDays: '30',
      contactName: 'Jean',
      contactEmail: 'jean@socimex.cd',
    };
    const r = preparerFournisseur(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corps).toMatchObject({
      name: 'Socimex',
      nif: 'A12345',
      paymentTerms: { kind: 'net', days: 30 },
      contacts: [{ name: 'Jean', email: 'jean@socimex.cd', phone: null, isPrimary: true }],
    });
  });
  it('erreurs de forme', () => {
    const r = preparerFournisseur({
      ...formulaireFournisseur(),
      nif: '12',
      email: 'x',
      termsKind: 'net',
      termsDays: '0',
      contactPhone: '+243 81 000 0000',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.champs).sort()).toEqual([
      'contactName',
      'email',
      'name',
      'nif',
      'termsDays',
    ]);
  });
  it('avertissements en phrases', () => {
    expect(
      phrasesAvertissements([{ code: 'SUPPLIER_SIMILAR_NAME', supplierId: 'a' }]),
    ).toHaveLength(1);
    expect(phrasesAvertissements([])).toEqual([]);
  });
});

describe('coordonnées de paiement', () => {
  it('« Afficher » exige `payables.pay`, sinon désactivé avec sa raison', () => {
    expect(boutonAfficher(['purchase.read', 'payables.pay'])).toEqual({
      actif: true,
      raison: null,
    });
    expect(boutonAfficher(['purchase.read', 'purchase.manage'])).toEqual({
      actif: false,
      raison: RAISON_SANS_PAIEMENT,
    });
    expect(boutonAfficher(null).actif).toBe(false);
  });
  it('clair en paires, champs vides omis', () => {
    expect(
      lignesCoordonnees({
        id: 'm',
        kind: 'bank',
        details: {
          bankName: 'Rawbank',
          accountHolder: 'Socimex',
          accountNumber: '0001 4521',
          iban: null,
          swift: null,
        },
      }),
    ).toEqual([
      ['Banque', 'Rawbank'],
      ['Titulaire', 'Socimex'],
      ['Numéro de compte', '0001 4521'],
    ]);
  });
});

describe('fiche 360°', () => {
  it('section masquée ou vide : une phrase, jamais un zéro', () => {
    expect(phraseSection({ status: 'hidden' }, 'M', 'V')).toBe('M');
    expect(phraseSection({ status: 'empty' }, 'M', 'V')).toBe('V');
    expect(phraseSection({ status: 'known' }, 'M', 'V')).toBeNull();
  });
  it('ancienneté : six tranches, montants du moteur formatés', () => {
    const t = trancheAnciennete({
      currency: 'USD',
      remaining: '500.00',
      notDue: '200.00',
      days1to30: '300.00',
      days31to60: '0.00',
      days61to90: '0.00',
      over90: '0.00',
      disputed: '0.00',
    });
    expect(t).toHaveLength(6);
    expect(t[1]).toEqual({ libelle: '1 à 30 jours', montant: '300,00 USD' });
  });
});
