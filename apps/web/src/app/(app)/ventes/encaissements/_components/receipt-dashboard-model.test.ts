// Mise en forme du tableau de bord des encaissements (ADR-0067) : aucun calcul,
// des libellés justes, des chiffres repris tels que le serveur les sert.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ReceiptStatsSchema, type ReceiptStats } from '@lalanda/shared/sales-invoices';
import { describe, expect, it } from 'vitest';

import type { ReceiptView } from '@/lib/api';

import {
  barresMoyens,
  cartesEncaissements,
  correspond,
  noteDevisesEncaissements,
  statutEncaissement,
  variation,
} from './receipt-dashboard-model';

const NB = ' ';

const stats = (over: Partial<ReceiptStats> = {}): ReceiptStats =>
  ReceiptStatsSchema.parse({
    currency: 'CDF',
    currencySource: 'default_cdf',
    asOf: '2026-11-06',
    from: '2025-12',
    to: '2026-11',
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i === 0 ? '2025-12' : `2026-${String(i).padStart(2, '0')}`,
      collected: `${i * 10000}.00`,
      count: i,
    })),
    totals: { collected: '660000.00', count: 66 },
    thisMonth: { amount: '110000.00', count: 11 },
    previousMonth: { month: '2026-10', amount: '100000.00', count: 10 },
    changePercent: 10,
    averageDelay: { windowDays: 90, since: '2026-08-09', days: 14, allocations: 30 },
    outstanding: { amount: '166000.00', count: 2 },
    overdue: { amount: '116000.00', count: 1 },
    byMethod: [
      { method: 'ESPECES', amount: '50000.00', count: 1 },
      { method: 'VIREMENT', amount: '0.00', count: 0 },
      { method: 'CARTEBANCAIRE', amount: '0.00', count: 0 },
      { method: 'MOBILEMONEY', amount: '610000.00', count: 65 },
      { method: 'CHEQUES', amount: '0.00', count: 0 },
      { method: 'AUTRE', amount: '0.00', count: 0 },
    ],
    statusCounts: { all: 67, recorded: 66, cancelled: 1 },
    excluded: { notConvertible: [{ currency: 'USD', count: 2, total: '420.00' }] },
    truncated: false,
    version: '1.0.0',
    ...over,
  });

describe('cartes du tableau des encaissements', () => {
  it('reprend les chiffres du serveur', () => {
    const [mois, precedent, delai, restant] = cartesEncaissements(stats());
    expect(mois!.valeur).toBe(`110${NB}000${NB}CDF`);
    expect(mois!.note).toBe('11 encaissements');
    expect(precedent!.valeur).toBe(`+10${NB}%`);
    expect(precedent!.note).toBe(`100${NB}000${NB}CDF en octobre 2026`);
    expect(delai!.valeur).toBe(`14${NB}j`);
    expect(restant!).toMatchObject({ valeur: `166${NB}000${NB}CDF`, ton: 'alerte' });
    expect(restant!.note).toBe(`dont 116${NB}000${NB}CDF en retard`);
  });

  it('rien le mois précédent, aucun règlement : tirets', () => {
    const s = stats({
      changePercent: null,
      averageDelay: { windowDays: 90, since: '2026-08-09', days: null, allocations: 0 },
    });
    const [, precedent, delai] = cartesEncaissements(s);
    expect(precedent!.valeur).toBe('—');
    expect(delai!.valeur).toBe('—');
    expect(delai!.note).toBe('Aucun règlement sur 90 jours');
  });

  it('variation écrite avec le signe typographique', () => {
    expect(variation(-40)).toBe(`−40${NB}%`);
    expect(variation(0)).toBe(`0${NB}%`);
  });

  it('moyens : seuls ceux utilisés, du plus gros au plus petit', () => {
    expect(barresMoyens(stats()).map((b) => b.id)).toEqual(['MOBILEMONEY', 'ESPECES']);
    expect(barresMoyens(stats())[0]!.label).toBe('Mobile Money · 65');
  });

  it('note : devise, règlements non convertis, paiements à l’émission', () => {
    const note = noteDevisesEncaissements(stats());
    expect(note).toContain('au taux figé sur chaque facture');
    expect(note).toContain('2 règlements en USD');
    expect(note).toContain('écran Factures');
  });
});

describe('liste des encaissements', () => {
  const r = {
    status: 'recorded',
    reference: 'MP-778',
    note: null,
    allocations: [{ invoiceId: 'x', invoiceNumber: 'IN2611-000026', amount: '1.00' }],
  } as unknown as ReceiptView;
  it('recherche par numéro de facture ou référence', () => {
    expect(correspond(r, 'in2611')).toBe(true);
    expect(correspond(r, 'mp-7')).toBe(true);
    expect(correspond(r, 'autre')).toBe(false);
    expect(correspond(r, '  ')).toBe(true);
  });
  it('statut', () => {
    expect(statutEncaissement(r)).toEqual({ ton: 'ok', label: 'Enregistré' });
    expect(statutEncaissement({ status: 'cancelled' }).ton).toBe('late');
  });
});

describe('lecture des sources : aucun calcul de montant dans l’interface', () => {
  for (const fichier of ['./receipt-dashboard-model.ts', './receipt-dashboard.tsx']) {
    it(fichier, () => {
      const code = readFileSync(fileURLToPath(new URL(fichier, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/\bNumber\s*\(|\bparseFloat\b|\bparseInt\b|\.toFixed\s*\(|\bMath\./);
    });
  }
});
