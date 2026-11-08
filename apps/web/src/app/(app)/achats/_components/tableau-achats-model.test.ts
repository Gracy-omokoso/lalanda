// Mise en forme des tableaux de bord des achats (ADR-0071) : aucun calcul, des
// libellés justes, des chiffres repris tels que le serveur les sert.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  PayablesStatsSchema,
  PurchaseOrderStatsSchema,
  SupplierInvoiceStatsSchema,
} from '@lalanda/shared/purchases';
import { describe, expect, it } from 'vitest';

import {
  barresAnciennete,
  barresCategories,
  blocDevise,
  cartesAPayer,
  cartesCommandes,
  cartesFactures,
  compteursAPayer,
  compteursCommandes,
  compteursFactures,
  devisesDe,
  noteDeviseAchats,
  tonPastille,
} from './tableau-achats-model';

const NB = ' ';
const ac = (amount: string, count: number) => ({ amount, count });
const mois = (amount = '0.00') =>
  Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    amount,
    count: 0,
  }));

const factures = SupplierInvoiceStatsSchema.parse({
  asOf: '2026-11-08',
  from: '2025-12',
  to: '2026-11',
  statusCounts: { all: 9, draft: 3, variance: 1, validated: 5, overdue: 2, disputed: 1 },
  byCurrency: [
    {
      currency: 'USD',
      months: mois('10.00'),
      thisMonth: ac('1250.60', 2),
      previousMonth: { month: '2026-10', amount: '1000.00', count: 1 },
      changePercent: 25,
      outstanding: ac('900.00', 3),
      overdue: ac('300.00', 2),
      disputed: ac('0.00', 0),
      drafts: ac('40.00', 3),
      variances: ac('30.00', 1),
      byCategory: [{ category: 'achats', label: 'Achats', amount: '1250.00', count: 2 }],
    },
    {
      currency: 'CDF',
      months: mois(),
      thisMonth: ac('0.00', 0),
      previousMonth: { month: '2026-10', amount: '0.00', count: 0 },
      changePercent: null,
      outstanding: ac('0.00', 0),
      overdue: ac('0.00', 0),
      disputed: ac('0.00', 0),
      drafts: ac('0.00', 0),
      variances: ac('0.00', 0),
      byCategory: [],
    },
  ],
  truncated: false,
  version: '1.0.0',
});

describe('factures fournisseurs', () => {
  it('cartes : montants arrondis à l’unité, variation, retard en alerte, écarts à traiter', () => {
    const c = cartesFactures(factures, factures.byCurrency[0]!);
    expect(c.map((x) => x.valeur)).toEqual([
      `1${NB}251${NB}USD`,
      `900${NB}USD`,
      `300${NB}USD`,
      '3',
    ]);
    expect(c[0]!.note).toBe(`+25${NB}% vs oct.`);
    expect(c[2]!.ton).toBe('alerte');
    expect(c[3]!.ton).toBe('attention');
  });

  it('compteurs, devises, catégories et note', () => {
    expect(compteursFactures(factures)['en-retard']).toBe(2);
    expect(compteursFactures(factures).ecart).toBe(1);
    expect(devisesDe(factures)).toEqual(['USD', 'CDF']);
    expect(blocDevise(factures.byCurrency, 'CDF')!.currency).toBe('CDF');
    expect(blocDevise(factures.byCurrency, null)!.currency).toBe('USD');
    expect(barresCategories(factures.byCurrency[0]!)[0]).toMatchObject({ label: 'Achats' });
    expect(noteDeviseAchats(factures, 'USD')).toMatch(/jamais convertis/);
    expect(tonPastille('danger')).toBe('late');
  });
});

describe('à payer et commandes', () => {
  const zero = ac('0.00', 0);
  const payer = PayablesStatsSchema.parse({
    asOf: '2026-11-08',
    from: '2025-12',
    to: '2026-11',
    dueSoonDays: 7,
    dueSoonUntil: '2026-11-15',
    groupCounts: { overdue: 1, soon: 2, later: 3, disputed: 0 },
    byCurrency: [
      {
        currency: 'USD',
        due: ac('500.00', 6),
        overdue: ac('100.00', 1),
        dueWithin7: ac('50.00', 2),
        dueWithin30: ac('200.00', 3),
        disputed: zero,
        months: mois(),
        thisMonth: zero,
        previousMonth: { month: '2026-10', ...zero },
        changePercent: null,
        averageDelay: { windowDays: 90, since: '2026-08-11', days: 12, allocations: 4 },
        aging: {
          notDue: ac('400.00', 5),
          days1To30: ac('100.00', 1),
          days31To60: zero,
          days61To90: zero,
          over90: zero,
          open: ac('500.00', 6),
          disputed: zero,
        },
        topSuppliers: [],
      },
    ],
    truncated: true,
    version: '1.0.0',
  });
  it('cartes et ancienneté', () => {
    const c = cartesAPayer(payer, payer.byCurrency[0]!);
    expect(c[1]!.ton).toBe('alerte');
    expect(c[2]!.note).toBe(`200${NB}USD sous 30 jours`);
    expect(c[3]!.valeur).toBe(`12${NB}j`);
    expect(barresAnciennete(payer.byCurrency[0]!).map((b) => b.id)).toEqual([
      'notDue',
      'days1To30',
    ]);
    expect(compteursAPayer(payer)['plus-tard']).toBe(3);
    expect(noteDeviseAchats(payer, 'USD')).toMatch(/partiels/);
  });

  it('commandes', () => {
    const s = PurchaseOrderStatsSchema.parse({
      asOf: '2026-11-08',
      from: '2025-12',
      to: '2026-11',
      statusCounts: { all: 4, mine: 2, draft: 1, submitted: 1, order: 2 },
      byStatus: [{ status: 'sent', count: 2 }],
      byCurrency: [
        {
          currency: 'CDF',
          months: mois(),
          thisMonth: zero,
          previousMonth: { month: '2026-10', ...zero },
          changePercent: null,
          open: ac('10.00', 1),
          pendingApproval: ac('5.00', 1),
          averageApprovalDelay: { windowDays: 90, since: '2026-08-11', days: null, approvals: 0 },
        },
      ],
      truncated: false,
      version: '1.0.0',
    });
    const c = cartesCommandes(s, s.byCurrency[0]!);
    expect(c[2]!.valeur).toBe('1');
    expect(c[3]!.valeur).toBe('—');
    expect(compteursCommandes(s)['a-approuver']).toBe(1);
  });
});

describe('lecture des sources : aucun calcul de montant dans l’interface', () => {
  for (const fichier of [
    './tableau-achats-model.ts',
    './factures-liste.tsx',
    './a-payer.tsx',
    './commandes-liste.tsx',
    '../../../../components/tableau-de-bord/tableau.tsx',
  ]) {
    it(fichier, () => {
      const code = readFileSync(fileURLToPath(new URL(fichier, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/\bNumber\s*\(|\bparseFloat\b|\bparseInt\b|\.toFixed\s*\(|\bMath\./);
    });
  }
});
