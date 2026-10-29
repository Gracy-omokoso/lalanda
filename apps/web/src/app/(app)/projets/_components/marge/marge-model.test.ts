import type { ProjectMarginView } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { constats, duree, lignesDevise, montantSigne, suggestionFacture } from './marge-model';

const vue: ProjectMarginView = {
  projectId: 'p',
  version: '1.0.0',
  from: null,
  to: null,
  currencies: [
    {
      currency: 'USD',
      received: '92.80',
      refunded: '0.00',
      expenses: '20.00',
      timeCost: '18.75',
      margin: '54.05',
      invoicedExclTax: '80.00',
      invoiceCount: 1,
      expenseCount: 1,
      timeMinutes: 90,
    },
  ],
  findings: [
    { code: 'TIME_WITHOUT_RATE', minutes: 30 },
    { code: 'DRAFT_INVOICES_IGNORED', count: 1 },
    { code: 'AMOUNTS_INCLUDE_TAX' },
  ],
  minutesWithoutRate: 30,
  byMember: null,
};

/** Espaces insécables (milliers, devise) ramenés à des espaces pour la lecture. */
const plat = (v: string): string => v.replace(/[\u00a0\u202f]/g, ' ');

describe('marge-model', () => {
  it('montants signés et durées, sans aucun calcul de montant', () => {
    expect(plat(montantSigne('-10000.00', 'CDF'))).toBe('−10 000,00 CDF');
    expect(plat(montantSigne('54.05', 'USD'))).toBe('54,05 USD');
    expect(duree(90)).toBe('1 h 30');
    expect(duree(45)).toBe('45 min');
    expect(duree(120)).toBe('2 h');
  });

  it('lignes dans l’ordre de la formule ; composantes retranchées signées', () => {
    expect(lignesDevise(vue.currencies[0]!).map((l) => [l.libelle, plat(l.valeur)])).toEqual([
      ['Encaissé', '92,80 USD'],
      ['Avoirs remboursés', '0,00 USD'],
      ['Dépenses rattachées', '−20,00 USD'],
      ['Coût du temps (1 h 30)', '−18,75 USD'],
    ]);
  });

  it('constats traduits ; le temps sans taux est une attention', () => {
    const c = constats(vue);
    expect(c.map((x) => x.code)).toEqual([
      'TIME_WITHOUT_RATE',
      'DRAFT_INVOICES_IGNORED',
      'AMOUNTS_INCLUDE_TAX',
    ]);
    expect(c[0]).toMatchObject({ ton: 'attention' });
    expect(c[0]!.texte).toContain('30 min');
  });

  it('suggestion PREPARE_INVOICE repérée dans une réponse d’écriture', () => {
    expect(suggestionFacture([{ code: 'PREPARE_INVOICE', taskId: 't' }])).toEqual({
      code: 'PREPARE_INVOICE',
      taskId: 't',
    });
    expect(suggestionFacture([])).toBeNull();
    expect(suggestionFacture(undefined)).toBeNull();
  });
});
