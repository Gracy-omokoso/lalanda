// Moteur des équipements (ADR-0046 § 7.2). Attendus calculés à la main ; les
// propriétés utilisent un générateur pseudo-aléatoire à graine fixe : un échec
// est rejouable à l'identique.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ASSETS_VERSION,
  ENGINE_VERSION,
  MANAGEMENT_ESTIMATE_LABEL,
  MANAGEMENT_ESTIMATE_NOTICE,
  assetDeadlines,
  assetRegisterSummary,
  assetTotalCostOfOwnership,
  assigneeOn,
  assignmentHistory,
  checkNewAssignment,
  expiryStatus,
  managementDepreciationEstimate,
  managementDepreciationSchedule,
  nextMaintenanceDate,
  type AssetAssignee,
  type AssetAssignmentInput,
  type AssetCoverageInput,
  type AssetInput,
  type AssetMaintenanceInput,
  type ManagementEstimate,
  type ManagementScheduleAvailable,
} from '../index.js';
import { addDays, dayOfNumber, dayNumber } from '../treasury/calendar.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const int = (r: () => number, min: number, max: number): number =>
  min + Math.floor(r() * (max - min + 1));
const cents = (v: string): bigint => {
  const neg = v.startsWith('-');
  const [i, d = ''] = (neg ? v.slice(1) : v).split('.');
  const c = BigInt(i ?? '0') * 100n + BigInt(d.padEnd(2, '0'));
  return neg ? -c : c;
};
const str = (c: bigint): string => `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;

const laptop = (over: Partial<AssetInput> = {}): AssetInput => ({
  id: 'a1',
  categoryId: 'it',
  status: 'in_service',
  acquisition: { on: '2026-01-15', cost: '1200.00', currency: 'USD' },
  managementDepreciation: { years: 3, residualValue: '0', startOn: '2026-01-15' },
  disposal: null,
  ...over,
});

function estimate(asset: AssetInput, on: string): ManagementEstimate {
  const r = managementDepreciationEstimate(asset, on);
  if (!r.estimable) throw new Error(`non estimable : ${r.reason}`);
  return r;
}
function schedule(asset: AssetInput): ManagementScheduleAvailable {
  const r = managementDepreciationSchedule(asset);
  if (!r.estimable) throw new Error(`non estimable : ${r.reason}`);
  return r;
}

describe('version', () => {
  it('le module a sa propre version, sans toucher ENGINE_VERSION', () => {
    expect(ASSETS_VERSION).toBe('1.0.0');
    expect(ENGINE_VERSION).toBe('0.2.0');
    expect(MANAGEMENT_ESTIMATE_LABEL).toBe('management_estimate');
    expect(MANAGEMENT_ESTIMATE_NOTICE).toContain('Estimation de gestion');
  });
});

// ─── managementDepreciationEstimate ──────────────────────────────────────────

describe('managementDepreciationEstimate', () => {
  it('critère 14 : 1 200 USD, 3 ans, début 15 janv. → 800,00 au 31 déc. (12 mois sur 36)', () => {
    expect(managementDepreciationEstimate(laptop(), '2026-12-31')).toEqual({
      version: ASSETS_VERSION,
      label: 'management_estimate',
      estimable: true,
      currency: 'USD',
      cost: '1200.00',
      residualValue: '0.00',
      depreciableBase: '1200.00',
      startOn: '2026-01-15',
      endOn: '2028-12-31',
      monthsTotal: 36,
      monthsElapsed: 12,
      onDate: '2026-12-31',
      effectiveOn: '2026-12-31',
      stoppedByDisposalOn: null,
      consumed: '400.00',
      estimatedValue: '800.00',
      consumedPercent: '33.33',
    });
  });

  it('mois entamé compté ; avant le début : valeur entière ; après la fin : valeur résiduelle', () => {
    expect(estimate(laptop(), '2026-01-14')).toMatchObject({
      monthsElapsed: 0,
      estimatedValue: '1200.00',
      consumedPercent: '0.00',
    });
    expect(estimate(laptop(), '2026-01-15')).toMatchObject({
      monthsElapsed: 1,
      estimatedValue: '1166.67',
    });
    expect(estimate(laptop(), '2026-01-31').monthsElapsed).toBe(1);
    expect(estimate(laptop(), '2026-02-01').monthsElapsed).toBe(2);
    const residual = laptop({
      managementDepreciation: { years: 3, residualValue: '150.00', startOn: '2026-01-15' },
    });
    expect(estimate(residual, '2028-12-31')).toMatchObject({
      monthsElapsed: 36,
      estimatedValue: '150.00',
      consumedPercent: '100.00',
    });
    expect(estimate(residual, '2040-01-01').estimatedValue).toBe('150.00');
  });

  it('sans durée saisie : « non estimable », jamais 0', () => {
    const none = { version: ASSETS_VERSION, label: 'management_estimate', estimable: false };
    expect(
      managementDepreciationEstimate(laptop({ managementDepreciation: null }), '2026-12-31'),
    ).toEqual({
      ...none,
      reason: 'NO_DURATION',
    });
    expect(
      managementDepreciationEstimate(laptop({ managementDepreciation: undefined }), '2026-12-31'),
    ).toEqual({ ...none, reason: 'NO_DURATION' });
    expect(
      managementDepreciationEstimate(
        laptop({
          managementDepreciation: { years: null, residualValue: '0', startOn: '2026-01-01' },
        }),
        '2026-12-31',
      ),
    ).toEqual({ ...none, reason: 'NO_DURATION' });
    expect(
      managementDepreciationEstimate(
        laptop({
          managementDepreciation: { years: 3, residualValue: '1200.01', startOn: '2026-01-01' },
        }),
        '2026-12-31',
      ),
    ).toEqual({ ...none, reason: 'RESIDUAL_ABOVE_COST' });
    expect(managementDepreciationSchedule(laptop({ managementDepreciation: null }))).toEqual({
      ...none,
      reason: 'NO_DURATION',
    });
  });

  it('reste d’arrondi : cumul arrondi au centime, le dernier mois solde la base', () => {
    const odd = laptop({
      acquisition: { on: '2026-03-01', cost: '100.00', currency: 'CDF' },
      managementDepreciation: { years: 3, residualValue: '0.01', startOn: '2026-03-31' },
    });
    // base 99,99 sur 36 mois : 2,7775 / mois.
    expect(estimate(odd, '2026-03-31')).toMatchObject({
      consumed: '2.78',
      estimatedValue: '97.22',
    });
    expect(estimate(odd, '2026-04-01')).toMatchObject({ consumed: '5.56' });
    expect(estimate(odd, '2029-02-28')).toMatchObject({
      monthsElapsed: 36,
      estimatedValue: '0.01',
    });
    const s = schedule(odd);
    expect(s.months).toHaveLength(36);
    expect(s.endOn).toBe('2029-02-28');
    const total = s.months.reduce((t, m) => t + cents(m.charge), 0n);
    expect(total).toBe(9999n);
    expect(s.months.at(-1)?.closingValue).toBe('0.01');
    for (const m of s.months) expect([277n, 278n]).toContain(cents(m.charge));
  });

  it('arrêt à la cession : valeur figée au mois de cession', () => {
    const sold = laptop({ status: 'disposed', disposal: { on: '2026-06-10', kind: 'sold' } });
    expect(estimate(sold, '2027-05-01')).toMatchObject({
      monthsElapsed: 6,
      effectiveOn: '2026-06-10',
      stoppedByDisposalOn: '2026-06-10',
      estimatedValue: '1000.00',
    });
    // Avant la cession, rien ne change.
    expect(estimate(sold, '2026-03-31')).toMatchObject({
      monthsElapsed: 3,
      stoppedByDisposalOn: null,
      estimatedValue: '1100.00',
    });
    const s = schedule(sold);
    expect(s.months).toHaveLength(6);
    expect(s.stoppedByDisposalOn).toBe('2026-06-10');
    expect(s.months.at(-1)).toEqual({
      month: '2026-06',
      index: 6,
      charge: '33.33',
      cumulative: '200.00',
      closingValue: '1000.00',
    });
    // Cession après la fin : tableau complet, rien d'arrêté.
    const late = schedule(laptop({ disposal: { on: '2030-01-01' } }));
    expect(late.months).toHaveLength(36);
    expect(late.stoppedByDisposalOn).toBeNull();
  });

  it('tableau : regroupement par année civile', () => {
    const s = schedule(laptop());
    expect(s.years).toEqual([
      { year: 2026, months: 12, charge: '400.00', closingValue: '800.00' },
      { year: 2027, months: 12, charge: '400.00', closingValue: '400.00' },
      { year: 2028, months: 12, charge: '400.00', closingValue: '0.00' },
    ]);
    expect(s.months[0]).toEqual({
      month: '2026-01',
      index: 1,
      charge: '33.33',
      cumulative: '33.33',
      closingValue: '1166.67',
    });
    expect(s.months[1]?.charge).toBe('33.34');
  });

  it('entrées invalides : erreurs explicites', () => {
    for (const years of [0, 51, 1.5, -1]) {
      expect(() =>
        managementDepreciationEstimate(
          laptop({ managementDepreciation: { years, residualValue: '0', startOn: '2026-01-01' } }),
          '2026-12-31',
        ),
      ).toThrow(RangeError);
    }
    expect(() =>
      managementDepreciationEstimate(
        laptop({ acquisition: { on: '2026-01-01', cost: '1.234', currency: 'USD' } }),
        '2026-12-31',
      ),
    ).toThrow(/montant/);
    expect(() =>
      managementDepreciationEstimate(
        laptop({ acquisition: { on: '2026-01-01', cost: '1', currency: 'EUR' as 'USD' } }),
        '2026-12-31',
      ),
    ).toThrow(/devise/);
    expect(() => managementDepreciationEstimate(laptop(), '2026-02-30')).toThrow(/date/);
    expect(() =>
      managementDepreciationEstimate(
        laptop({
          managementDepreciation: { years: 2, residualValue: '-1', startOn: '2026-01-01' },
        }),
        '2026-12-31',
      ),
    ).toThrow(/montant/);
  });

  it('propriétés : valeur décroissante, bornée, cohérente avec le tableau (graine 46)', () => {
    const r = rng(46);
    for (let n = 0; n < 300; n += 1) {
      const cost = BigInt(int(r, 0, 5_000_000));
      const residual = BigInt(int(r, 0, Number(cost)));
      const years = int(r, 1, 50);
      const startOn = dayOfNumber(int(r, dayNumber('2000-01-01'), dayNumber('2030-12-31')));
      const asset = laptop({
        acquisition: { on: startOn, cost: str(cost), currency: r() < 0.5 ? 'USD' : 'CDF' },
        managementDepreciation: { years, residualValue: str(residual), startOn },
      });
      const s = schedule(asset);
      const base = cost - residual;
      const months = years * 12;
      expect(s.months).toHaveLength(months);
      expect(s.months.reduce((t, m) => t + cents(m.charge), 0n)).toBe(base);
      expect(s.years.reduce((t, y) => t + cents(y.charge), 0n)).toBe(base);
      expect(cents(s.months.at(-1)?.closingValue ?? '')).toBe(residual);
      const floor = base / BigInt(months);
      for (const m of s.months) {
        const c = cents(m.charge);
        expect(c >= floor && c <= floor + 1n).toBe(true);
      }
      let previous = cost;
      let day = addDays(startOn, -int(r, 0, 40));
      for (let step = 0; step < 12; step += 1) {
        const e = estimate(asset, day);
        const v = cents(e.estimatedValue);
        expect(v <= previous && v >= residual && v <= cost).toBe(true);
        expect(cents(e.consumed) + v).toBe(cost);
        const row = s.months[e.monthsElapsed - 1];
        expect(e.consumed).toBe(row === undefined ? '0.00' : row.cumulative);
        previous = v;
        day = addDays(day, int(r, 0, 400));
      }
    }
  }, 30_000); // propriété lourde : marge sous charge (CI)

  it('aucune sortie ne dépend de DUREES_SYSCOHADA (critère 14, 20)', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/DUREES_SYSCOHADA|amortissements\/|parameter-packs/);
    }
  });
});

// ─── nextMaintenanceDate, expiryStatus ───────────────────────────────────────

describe('nextMaintenanceDate', () => {
  it('fins de mois bornées et années bissextiles', () => {
    expect(nextMaintenanceDate('2026-08-31', 6)).toBe('2027-02-28'); // critère 13
    expect(nextMaintenanceDate('2027-08-31', 6)).toBe('2028-02-29');
    expect(nextMaintenanceDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(nextMaintenanceDate('2028-01-31', 1)).toBe('2028-02-29');
    expect(nextMaintenanceDate('2024-02-29', 12)).toBe('2025-02-28');
    expect(nextMaintenanceDate('2026-02-28', 1)).toBe('2026-03-28');
    expect(nextMaintenanceDate('2026-11-15', 3)).toBe('2027-02-15');
    expect(nextMaintenanceDate('2026-05-31', 60)).toBe('2031-05-31');
  });

  it('périodicité de 1 à 60 mois entiers', () => {
    for (const m of [0, 61, 1.5, -3]) {
      expect(() => nextMaintenanceDate('2026-01-01', m)).toThrow(RangeError);
    }
    expect(() => nextMaintenanceDate('2026-13-01', 1)).toThrow(/date/);
  });

  it('propriété : mois d’arrivée exact, quantième conservé ou ramené à la fin du mois (graine 13)', () => {
    const r = rng(13);
    for (let n = 0; n < 2000; n += 1) {
      const from = dayOfNumber(int(r, dayNumber('1990-01-01'), dayNumber('2090-12-31')));
      const every = int(r, 1, 60);
      const next = nextMaintenanceDate(from, every);
      const [fy, fm, fd] = from.split('-').map((x) => Number.parseInt(x, 10)) as [
        number,
        number,
        number,
      ];
      const [ny, nm, nd] = next.split('-').map((x) => Number.parseInt(x, 10)) as [
        number,
        number,
        number,
      ];
      expect(ny * 12 + nm - (fy * 12 + fm)).toBe(every);
      expect(nd <= fd).toBe(true);
      if (nd < fd) expect(addDays(next, 1).slice(8)).toBe('01'); // fin de mois
    }
  });
});

describe('expiryStatus', () => {
  it('expirée, bientôt, à jour', () => {
    expect(expiryStatus('2026-11-20', 30, '2026-10-31')).toBe('due_soon'); // 20 jours, rappel 30
    expect(expiryStatus('2026-11-30', 30, '2026-10-31')).toBe('due_soon'); // borne incluse
    expect(expiryStatus('2026-12-01', 30, '2026-10-31')).toBe('ok');
    expect(expiryStatus('2026-10-31', 0, '2026-10-31')).toBe('due_soon'); // finit aujourd'hui
    expect(expiryStatus('2026-10-30', 30, '2026-10-31')).toBe('expired');
    expect(expiryStatus('2026-11-01', 0, '2026-10-31')).toBe('ok');
  });

  it('rappel de 0 à 120 jours entiers, dates lisibles', () => {
    expect(() => expiryStatus('2026-11-01', -1, '2026-10-31')).toThrow(RangeError);
    expect(() => expiryStatus('2026-11-01', 121, '2026-10-31')).toThrow(RangeError);
    expect(() => expiryStatus('2026-11-01', 2.5, '2026-10-31')).toThrow(RangeError);
    expect(() => expiryStatus('demain', 3, '2026-10-31')).toThrow(/date/);
  });

  it('propriété : partition selon l’écart en jours (graine 30)', () => {
    const r = rng(30);
    for (let n = 0; n < 2000; n += 1) {
      const today = dayOfNumber(int(r, dayNumber('2000-01-01'), dayNumber('2040-01-01')));
      const gap = int(r, -200, 200);
      const reminder = int(r, 0, 120);
      const s = expiryStatus(addDays(today, gap), reminder, today);
      expect(s).toBe(gap < 0 ? 'expired' : gap <= reminder ? 'due_soon' : 'ok');
    }
  });
});

// ─── assetDeadlines ──────────────────────────────────────────────────────────

describe('assetDeadlines', () => {
  const today = '2026-10-31';
  const settings = { reminderDays: 30, maintenanceDueSoonDays: 7 };
  const assets: AssetInput[] = [
    laptop({
      id: 'pc',
      currentAssignment: {
        assignee: { kind: 'employee', employeeId: 'e-gone' },
        from: '2026-01-15',
      },
    }),
    laptop({
      id: 'car',
      currentAssignment: {
        assignee: { kind: 'employee', employeeId: 'e-here' },
        from: '2026-01-15',
      },
    }),
    laptop({ id: 'old', status: 'disposed', disposal: { on: '2026-05-01' } }),
    laptop({ id: 'phone', status: 'lost' }),
  ];
  const m = (over: Partial<AssetMaintenanceInput> & { id: string }): AssetMaintenanceInput => ({
    assetId: 'car',
    kind: 'preventive',
    status: 'planned',
    plannedOn: null,
    ...over,
  });
  const maintenance: AssetMaintenanceInput[] = [
    m({ id: 'm-late', plannedOn: '2026-10-20' }),
    m({ id: 'm-soon', plannedOn: '2026-11-07' }),
    m({ id: 'm-far', plannedOn: '2026-11-08' }),
    m({ id: 'm-done', status: 'done', plannedOn: '2026-10-01', doneOn: '2026-10-02' }),
    m({ id: 'm-cancel', status: 'cancelled', plannedOn: '2026-10-01' }),
    m({ id: 'm-disposed', assetId: 'old', plannedOn: '2026-10-01' }),
    m({ id: 'm-unplanned', plannedOn: null }),
    m({ id: 'm-unknown', assetId: 'ghost', plannedOn: '2026-10-01' }),
  ];
  const c = (over: Partial<AssetCoverageInput> & { id: string }): AssetCoverageInput => ({
    assetId: 'pc',
    kind: 'warranty',
    startOn: '2025-01-01',
    endOn: '2027-12-31',
    ...over,
  });
  const coverages: AssetCoverageInput[] = [
    c({ id: 'w-20', endOn: '2026-11-20' }), // critère 13 : 20 jours, rappel 30
    c({ id: 'ins-old', kind: 'insurance', endOn: '2026-10-15' }),
    c({ id: 'ins-new', kind: 'insurance', startOn: '2026-10-16', endOn: '2027-10-15' }),
    c({ id: 'sc-lapsed', kind: 'service_contract', endOn: '2026-10-01' }),
    c({ id: 'w-car', assetId: 'car', endOn: '2026-11-05', reminderDays: 3 }),
    c({
      id: 'w-car-short',
      assetId: 'car',
      kind: 'insurance',
      endOn: '2026-11-03',
      reminderDays: 3,
    }),
    c({ id: 'w-old', assetId: 'old', endOn: '2026-11-01' }),
  ];
  const employees = [
    { id: 'e-gone', endDate: '2026-10-30' },
    { id: 'e-here', endDate: '2026-10-31' }, // sort ce soir : encore présent
  ];

  it('maintenances, couvertures, détenteurs sortis ; cédés, perdus, renouvelés ignorés', () => {
    const r = assetDeadlines(assets, maintenance, coverages, today, settings, employees);
    expect(r.version).toBe(ASSETS_VERSION);
    expect(r.deadlines.map((d) => [d.kind, d.refId ?? d.employeeId, d.date, d.daysLeft])).toEqual([
      ['coverage_expired', 'sc-lapsed', '2026-10-01', -30],
      ['maintenance_overdue', 'm-late', '2026-10-20', -11],
      ['held_by_former_employee', 'e-gone', '2026-10-30', -1],
      ['coverage_due_soon', 'w-car-short', '2026-11-03', 3],
      ['maintenance_due_soon', 'm-soon', '2026-11-07', 7],
      ['coverage_due_soon', 'w-20', '2026-11-20', 20],
    ]);
    expect(r.counts).toEqual({
      maintenance_overdue: 1,
      maintenance_due_soon: 1,
      coverage_expired: 1,
      coverage_due_soon: 2,
      held_by_former_employee: 1,
    });
    expect(r.total).toBe(6);
  });

  it('clé de déduplication stable d’un jour à l’autre (une seule notification)', () => {
    const keyOf = (day: string): string | undefined =>
      assetDeadlines(assets, maintenance, coverages, day, settings, employees).deadlines.find(
        (d) => d.refId === 'w-20',
      )?.dedupeKey;
    const k = keyOf('2026-10-31');
    expect(k).toBe('pc:coverage:w-20:2026-11-20');
    expect(keyOf('2026-11-01')).toBe(k);
    expect(keyOf('2026-11-21')).toBe(k); // devenue expirée : même clé
    expect(keyOf('2026-10-20')).toBeUndefined(); // 31 jours : pas encore
    const late = assetDeadlines(assets, maintenance, [], '2026-11-01', settings).deadlines.find(
      (d) => d.refId === 'm-soon',
    );
    expect(late?.dedupeKey).toBe('car:maintenance:m-soon:2026-11-07');
  });

  it('indépendant de l’ordre des entrées ; réglages bornés', () => {
    const a = assetDeadlines(assets, maintenance, coverages, today, settings, employees);
    const b = assetDeadlines(
      [...assets].reverse(),
      [...maintenance].reverse(),
      [...coverages].reverse(),
      today,
      settings,
      [...employees].reverse(),
    );
    expect(b).toEqual(a);
    expect(() =>
      assetDeadlines([], [], [], today, { reminderDays: 121, maintenanceDueSoonDays: 7 }),
    ).toThrow(RangeError);
    expect(() =>
      assetDeadlines(
        [],
        [],
        [c({ id: 'x', startOn: '2026-02-01', endOn: '2026-01-01' })],
        today,
        settings,
      ),
    ).toThrow(/fin précède/);
    expect(assetDeadlines([], [], [], today, settings).total).toBe(0);
  });
});

// ─── Registre et coût total ──────────────────────────────────────────────────

describe('assetRegisterSummary', () => {
  const assets: AssetInput[] = [
    laptop({ id: 'a' }),
    laptop({
      id: 'b',
      categoryId: 'car',
      acquisition: { on: '2025-01-01', cost: '25000000.50', currency: 'CDF' },
      managementDepreciation: null,
    }),
    laptop({ id: 'c', status: 'disposed', disposal: { on: '2026-06-01' } }),
    laptop({
      id: 'd',
      categoryId: null,
      status: 'in_storage',
      acquisition: { on: '2026-01-01', cost: '99.99', currency: 'USD' },
    }),
  ];

  it('nombres par statut et catégorie, coûts par devise', () => {
    const r = assetRegisterSummary(assets);
    expect(r.total).toBe(4);
    expect(r.byStatus).toEqual([
      { status: 'in_service', count: 2 },
      { status: 'in_storage', count: 1 },
      { status: 'under_maintenance', count: 0 },
      { status: 'lost', count: 0 },
      { status: 'disposed', count: 1 },
    ]);
    expect(r.byCategory.map((x) => [x.categoryId, x.count])).toEqual([
      ['car', 1],
      ['it', 2],
      [null, 1],
    ]);
    expect(r.byCategory[1]?.acquisitionCosts).toEqual([
      { currency: 'USD', count: 2, total: '2400.00' },
    ]);
    expect(r.acquisitionCosts).toEqual([
      { currency: 'CDF', count: 1, total: '25000000.50' },
      { currency: 'USD', count: 3, total: '2499.99' },
    ]);
    expect(r.activeAcquisitionCosts).toEqual([
      { currency: 'CDF', count: 1, total: '25000000.50' },
      { currency: 'USD', count: 2, total: '1299.99' },
    ]);
    expect(r.managementEstimate).toBeNull();
  });

  it('estimation de gestion à une date, étiquetée, hors cédés', () => {
    const r = assetRegisterSummary(assets, '2026-12-31');
    expect(r.managementEstimate).toEqual({
      label: 'management_estimate',
      onDate: '2026-12-31',
      estimatedValues: [{ currency: 'USD', count: 2, total: '866.66' }], // 800 + 66.66
      notEstimable: 1,
    });
    // Avant la cession, l'équipement cédé compte encore.
    expect(assetRegisterSummary(assets, '2026-03-31').managementEstimate?.estimatedValues).toEqual([
      { currency: 'USD', count: 3, total: '2291.66' }, // 1100 + 1100 + 91.66
    ]);
  });

  it('propriété : les totaux par devise égalent la somme des coûts (graine 7)', () => {
    const r = rng(7);
    for (let n = 0; n < 100; n += 1) {
      const list: AssetInput[] = [];
      const expected = { CDF: 0n, USD: 0n };
      const count = int(r, 0, 25);
      for (let i = 0; i < count; i += 1) {
        const cost = BigInt(int(r, 0, 1_000_000_000));
        const currency = r() < 0.5 ? 'CDF' : 'USD';
        expected[currency] += cost;
        list.push(
          laptop({
            id: `x${i}`,
            categoryId: `k${int(r, 0, 3)}`,
            acquisition: { on: '2026-01-01', cost: str(cost), currency },
          }),
        );
      }
      const s = assetRegisterSummary(list);
      for (const t of s.acquisitionCosts) expect(cents(t.total)).toBe(expected[t.currency]);
      expect(s.byCategory.reduce((t, c) => t + c.count, 0)).toBe(list.length);
      expect(s.byStatus.reduce((t, c) => t + c.count, 0)).toBe(list.length);
    }
  });
});

describe('assetTotalCostOfOwnership', () => {
  const maintenance: AssetMaintenanceInput[] = [
    {
      id: 'm1',
      assetId: 'a1',
      kind: 'preventive',
      status: 'done',
      doneOn: '2026-03-01',
      cost: '50.25',
      currency: 'USD',
    },
    {
      id: 'm2',
      assetId: 'a1',
      kind: 'corrective',
      status: 'done',
      doneOn: '2026-08-01',
      cost: '120000',
      currency: 'CDF',
    },
    { id: 'm3', assetId: 'a1', kind: 'inspection', status: 'done', doneOn: '2026-09-01' },
    {
      id: 'm4',
      assetId: 'a1',
      kind: 'preventive',
      status: 'planned',
      plannedOn: '2026-12-01',
      cost: '999.00',
      currency: 'USD',
    },
    {
      id: 'm5',
      assetId: 'other',
      kind: 'preventive',
      status: 'done',
      doneOn: '2026-03-01',
      cost: '1.00',
      currency: 'USD',
    },
  ];
  const coverages: AssetCoverageInput[] = [
    {
      id: 'c1',
      assetId: 'a1',
      kind: 'insurance',
      startOn: '2026-02-01',
      endOn: '2027-01-31',
      cost: '80.00',
      currency: 'USD',
    },
  ];

  it('acquisition + maintenances faites + couvertures, par devise sans conversion', () => {
    expect(assetTotalCostOfOwnership(laptop(), maintenance, coverages)).toEqual({
      version: ASSETS_VERSION,
      assetId: 'a1',
      until: null,
      byCurrency: [
        {
          currency: 'CDF',
          acquisition: '0.00',
          maintenance: '120000.00',
          coverages: '0.00',
          total: '120000.00',
        },
        {
          currency: 'USD',
          acquisition: '1200.00',
          maintenance: '50.25',
          coverages: '80.00',
          total: '1330.25',
        },
      ],
      maintenanceCount: 3,
      unpricedMaintenanceCount: 1,
      coverageCount: 1,
    });
  });

  it('arrêté à une date ; sans couvertures ; coût sans devise refusé', () => {
    const r = assetTotalCostOfOwnership(laptop(), maintenance, [], '2026-06-30');
    expect(r.byCurrency).toEqual([
      {
        currency: 'USD',
        acquisition: '1200.00',
        maintenance: '50.25',
        coverages: '0.00',
        total: '1250.25',
      },
    ]);
    expect(r.maintenanceCount).toBe(1);
    expect(assetTotalCostOfOwnership(laptop(), [], [], '2025-12-31').byCurrency).toEqual([]);
    expect(() =>
      assetTotalCostOfOwnership(laptop(), [
        {
          id: 'x',
          assetId: 'a1',
          kind: 'preventive',
          status: 'done',
          doneOn: '2026-01-01',
          cost: '1.00',
        },
      ]),
    ).toThrow(/devise/);
  });
});

// ─── Affectations ────────────────────────────────────────────────────────────

describe('affectations', () => {
  const emp = (id: string): AssetAssignee => ({ kind: 'employee', employeeId: id });
  const row = (
    id: string,
    from: string,
    to: string | null,
    who: AssetAssignee = emp(id),
  ): AssetAssignmentInput => ({
    id,
    assetId: 'pc',
    assignee: who,
    from,
    to,
  });

  it('historique trié, affectation courante, remise le jour du retour permise', () => {
    const h = assignmentHistory(
      [
        row('b', '2026-03-01', null),
        row('a', '2026-01-10', '2026-03-01'),
        { ...row('z', '2026-01-01', null), assetId: 'other' },
      ],
      'pc',
      '2026-03-11',
    );
    expect(h.valid).toBe(true);
    expect(h.entries.map((e) => [e.id, e.days])).toEqual([
      ['a', 50],
      ['b', 10],
    ]);
    expect(h.current?.id).toBe('b');
    expect(assigneeOn(h, '2026-02-28')?.id).toBe('a');
    expect(assigneeOn(h, '2026-03-01')?.id).toBe('b');
    expect(assigneeOn(h, '2025-12-31')).toBeNull();
  });

  it('affectation de durée nulle corrigée le jour même : triée avant la suivante', () => {
    const h = assignmentHistory(
      [row('r10', '2026-03-01', null), row('r9', '2026-03-01', '2026-03-01')],
      'pc',
      '2026-03-05',
    );
    expect(h.valid).toBe(true);
    expect(h.entries.map((e) => [e.id, e.days])).toEqual([
      ['r9', 0],
      ['r10', 4],
    ]);
    expect(assigneeOn(h, '2026-03-01')?.id).toBe('r10');
  });

  it('chevauchements, ouvertes multiples, retour avant remise', () => {
    const h = assignmentHistory(
      [
        row('a', '2026-01-01', '2026-02-10'),
        row('b', '2026-02-01', '2026-03-01'),
        row('c', '2026-04-01', null),
        row('d', '2026-05-01', null),
        row('e', '2026-06-10', '2026-06-01'),
      ],
      'pc',
      '2026-10-31',
    );
    expect(h.valid).toBe(false);
    expect(h.current).toBeNull();
    expect(h.issues).toEqual([
      { code: 'END_BEFORE_START', ids: ['e'] },
      { code: 'MULTIPLE_OPEN', ids: ['c', 'd'] },
      { code: 'ASSIGNMENT_OVERLAP', ids: ['a', 'b'] },
      { code: 'ASSIGNMENT_OVERLAP', ids: ['c', 'e'] },
      { code: 'ASSIGNMENT_OVERLAP', ids: ['d', 'e'] },
    ]);
    expect(() => assigneeOn(h, '2026-01-05')).toThrow(/incohérent/);
    expect(checkNewAssignment(h, emp('x'), '2026-11-01')).toEqual({
      ok: false,
      code: 'INVALID_HISTORY',
    });
  });

  it('critère 13 : réaffecter clôt l’affectation ouverte', () => {
    const h = assignmentHistory([row('a', '2026-01-10', null, emp('e1'))], 'pc', '2026-10-31');
    expect(checkNewAssignment(h, emp('e2'), '2026-10-31')).toEqual({
      ok: true,
      closes: { id: 'a', to: '2026-10-31' },
    });
    expect(checkNewAssignment(h, emp('e1'), '2026-10-31')).toEqual({
      ok: false,
      code: 'SAME_ASSIGNEE',
    });
    expect(checkNewAssignment(h, { kind: 'project', workProjectId: 'e1' }, '2026-10-31').ok).toBe(
      true,
    );
    expect(checkNewAssignment(h, emp('e2'), '2026-01-09')).toEqual({
      ok: false,
      code: 'STARTS_BEFORE_LAST_ASSIGNMENT',
    });
    const closed = assignmentHistory([row('a', '2026-01-10', '2026-02-01')], 'pc', '2026-10-31');
    expect(checkNewAssignment(closed, emp('a'), '2026-01-20')).toEqual({
      ok: false,
      code: 'STARTS_BEFORE_LAST_ASSIGNMENT',
    });
    expect(checkNewAssignment(closed, emp('a'), '2026-02-01')).toEqual({ ok: true, closes: null });
    expect(
      checkNewAssignment(assignmentHistory([], 'pc', '2026-10-31'), emp('a'), '2026-02-01'),
    ).toEqual({
      ok: true,
      closes: null,
    });
  });

  it('propriété : une suite acceptée par checkNewAssignment reste sans chevauchement (graine 2026)', () => {
    const r = rng(2026);
    for (let n = 0; n < 200; n += 1) {
      let rows: AssetAssignmentInput[] = [];
      let day = dayOfNumber(int(r, dayNumber('2020-01-01'), dayNumber('2026-01-01')));
      const count = int(r, 1, 15);
      for (let i = 0; i < count; i += 1) {
        day = addDays(day, int(r, -5, 60));
        const h = assignmentHistory(rows, 'pc', '2030-01-01');
        expect(h.valid).toBe(true);
        const who = emp(`e${int(r, 0, 3)}`);
        const check = checkNewAssignment(h, who, day);
        if (!check.ok) continue;
        if (check.closes !== null) {
          const { id, to } = check.closes;
          rows = rows.map((x) => (x.id === id ? { ...x, to } : x));
        }
        rows.push(row(`r${i}`, day, null, who));
        if (r() < 0.2) {
          const ret = addDays(day, int(r, 0, 30));
          rows = rows.map((x) => (x.to === null ? { ...x, to: ret } : x));
          day = ret;
        }
      }
      const h = assignmentHistory(rows, 'pc', '2030-01-01');
      expect(h.valid).toBe(true);
      expect(h.entries.filter((e) => e.to === null).length).toBeLessThanOrEqual(1);
      // Au plus un détenteur par jour, et l'ordre des entrées n'importe pas.
      expect(assignmentHistory([...rows].reverse(), 'pc', '2030-01-01')).toEqual(h);
      for (const e of h.entries) {
        // Une affectation de durée nulle (corrigée le jour même) ne détient aucun jour.
        if (e.to !== e.from) expect(assigneeOn(h, e.from)?.id).toBe(e.id);
      }
    }
  });
});

// ─── Pureté ──────────────────────────────────────────────────────────────────

describe('pureté du module', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ f, text: readFileSync(join(dir, f), 'utf8') }));

  it('aucune horloge, aucun flottant pour un montant, aucun taux de change (critère 20)', () => {
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/new Date\(|Date\.now|parseFloat|\bNumber\(|Math\.random/);
      expect(text, f).not.toMatch(/exchangeRate|fxRate|tauxDeChange/i);
    }
  });
});
