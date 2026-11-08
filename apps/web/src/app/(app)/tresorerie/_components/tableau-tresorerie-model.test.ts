// Mise en forme des tableaux de bord de la trésorerie (ADR-0071) : aucun calcul,
// des chiffres repris tels que le serveur les sert, les comptes réels annoncés
// comme tels (jamais la vue simplifiée des plans).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { AccountStatsSchema, ExpenseStatsSchema } from '@lalanda/shared/treasury';
import { describe, expect, it } from 'vitest';

import {
  barresCategoriesDepenses,
  barresComptes,
  cartesComptes,
  cartesDepenses,
  compteursDepenses,
  noteComptes,
  noteDepenses,
  statutDepense,
} from './tableau-tresorerie-model';

const NB = ' ';
const mois = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);

const depenses = ExpenseStatsSchema.parse({
  asOf: '2026-11-08',
  from: '2025-12',
  to: '2026-11',
  listMonth: '2026-11',
  statusCounts: { recorded: 3, cancelled: 1, all: 4 },
  byCurrency: [
    {
      currency: 'USD',
      months: mois.map((m) => ({ month: m, amount: '10.00', count: 1 })),
      thisMonth: { amount: '65.40', count: 3 },
      previousMonth: { month: '2026-10', amount: '50.00', count: 1 },
      changePercent: 31,
      monthlyAverage: '4.55',
      byCategoryThisMonth: [
        { category: 'loyer', label: 'Loyer et charges locatives', amount: '30.00', count: 1 },
      ],
      withoutAttachmentThisMonth: { amount: '30.00', count: 1 },
    },
  ],
  truncated: false,
  version: '1.0.0',
});

describe('dépenses', () => {
  it('cartes, catégories, compteurs, statut et note', () => {
    const c = cartesDepenses(depenses, depenses.byCurrency[0]!);
    expect(c.map((x) => x.valeur)).toEqual([`65${NB}USD`, `+31${NB}%`, `30${NB}USD`, '1']);
    expect(c[2]!.note).toBe('Loyer et charges locatives');
    expect(c[3]!.ton).toBe('attention');
    expect(barresCategoriesDepenses(depenses.byCurrency[0]!)[0]!.label).toMatch(/^Loyer/);
    expect(compteursDepenses(depenses)).toEqual({ recorded: 3, cancelled: 1, all: 4 });
    expect(statutDepense({ status: 'cancelled' }).ton).toBe('late');
    expect(noteDepenses(depenses, 'USD')).toMatch(/jamais convertis/);
  });
});

describe('comptes', () => {
  const s = AccountStatsSchema.parse({
    asOf: '2026-11-08',
    from: '2025-12',
    to: '2026-11',
    byCurrency: [
      {
        currency: 'CDF',
        balance: '-1500.00',
        activeAccounts: 2,
        overdrawn: 1,
        months: mois.map((m) => ({
          month: m,
          inflows: '0.00',
          outflows: '0.00',
          closingBalance: '-1500.00',
        })),
        thisMonth: { inflows: '100.00', outflows: '200.00', net: '-100.00' },
        accounts: [
          { accountId: 'a', name: 'Caisse', balance: '500.00' },
          { accountId: 'b', name: 'Banque', balance: '-2000.00' },
        ],
      },
    ],
    truncated: false,
    version: '1.0.0',
  });
  it('solde négatif en alerte, découvert compté, barres jamais négatives', () => {
    const c = cartesComptes(s, s.byCurrency[0]!);
    expect(c[0]!.valeur).toBe(`−1${NB}500${NB}CDF`);
    expect(c[0]!.ton).toBe('alerte');
    expect(c[1]!.note).toBe(`Variation nette −100${NB}CDF`);
    expect(c[3]!.ton).toBe('alerte');
    const b = barresComptes(s.byCurrency[0]!);
    expect(b[1]!.value).toBe(0);
    expect(b[1]!.display).toBe(`−2${NB}000${NB}CDF`);
    expect(noteComptes(s, 'CDF')).toMatch(/vue simplifiée/);
  });
});

describe('lecture des sources : aucun calcul de montant dans l’interface', () => {
  for (const fichier of ['./tableau-tresorerie-model.ts']) {
    it(fichier, () => {
      const code = readFileSync(fileURLToPath(new URL(fichier, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/\bNumber\s*\(|\bparseFloat\b|\bparseInt\b|\.toFixed\s*\(|\bMath\./);
    });
  }
});
