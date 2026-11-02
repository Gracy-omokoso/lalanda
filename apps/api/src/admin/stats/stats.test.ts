import { describe, expect, it } from 'vitest';

import {
  allCells,
  cell,
  computePlatformStats,
  partition,
  STATS_MODULE_COLLECTIONS,
  STATS_MODULES,
  type PlatformStatsInput,
  type StatsOrganization,
} from './stats.js';

const NOW = new Date('2026-11-02T00:00:00Z');

function orgs(n: number, over: Partial<StatsOrganization> = {}, prefix = 'o'): StatsOrganization[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    pays: 'CD',
    type: 'solo',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }));
}

function entree(over: Partial<PlatformStatsInput> = {}): PlatformStatsInput {
  return {
    now: NOW,
    windowDays: 30,
    minCell: 5,
    plans: ['free', 'pro', 'cabinet', 'business', 'expert'],
    organizations: [],
    subscriptions: [],
    users: { total: 0, createdInWindow: 0, activeInWindow: 0 },
    activeOrganizationIds: [],
    moduleAdoption: {},
    usage: { aiCallsInWindow: 0, pdfExportsInWindow: 0 },
    ...over,
  };
}

describe('stats — seuil de diffusion (critère 20)', () => {
  it('masque toute case de moins de 5, zéro compris', () => {
    expect(cell(0, 5)).toEqual({ value: null, masked: true });
    expect(cell(4, 5)).toEqual({ value: null, masked: true });
    expect(cell(5, 5)).toEqual({ value: 5, masked: false });
    expect(() => cell(-1, 5)).toThrow(RangeError);
  });

  it('masque en second la plus petite case quand une seule est masquée dans une partition', () => {
    const rows = partition(
      new Map([
        ['CD', 20],
        ['CG', 7],
        ['GA', 6],
        ['CM', 2],
      ]),
      5,
    );
    expect(rows.filter((r) => r.cell.masked).map((r) => r.key)).toEqual(['GA', 'CM']);
  });

  it('ne masque rien de plus quand deux cases le sont déjà', () => {
    const rows = partition(
      new Map([
        ['a', 20],
        ['b', 1],
        ['c', 2],
      ]),
      5,
    );
    expect(rows.filter((r) => r.cell.masked).map((r) => r.key)).toEqual(['b', 'c']);
  });

  it('aucune case servie en clair sous le seuil, quel que soit le jeu (propriété)', () => {
    let s = 7;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let essai = 0; essai < 50; essai++) {
      const liste = Array.from({ length: Math.floor(rnd() * 40) }, (_, i) => ({
        id: `x${i}`,
        pays: ['CD', 'CG', 'GA', 'FR'][Math.floor(rnd() * 4)]!,
        type: ['solo', 'agence', 'ecole'][Math.floor(rnd() * 3)]!,
        createdAt: new Date(NOW.getTime() - Math.floor(rnd() * 90) * 86_400_000),
      }));
      const stats = computePlatformStats(
        entree({
          organizations: liste,
          subscriptions: liste
            .filter(() => rnd() < 0.5)
            .map((o) => ({
              organizationId: o.id,
              effectivePlan: ['pro', 'cabinet'][Math.floor(rnd() * 2)]!,
              status: ['active', 'trialing'][Math.floor(rnd() * 2)]!,
              trialStartedAt: rnd() < 0.5 ? NOW : null,
              lastPaymentAt: rnd() < 0.5 ? NOW : null,
            })),
          users: { total: Math.floor(rnd() * 10), createdInWindow: 1, activeInWindow: 3 },
          activeOrganizationIds: liste.filter(() => rnd() < 0.3).map((o) => o.id),
          moduleAdoption: { crm: liste.filter(() => rnd() < 0.4).map((o) => o.id) },
        }),
      );
      for (const c of allCells(stats)) {
        expect(c.masked || (c.value !== null && c.value >= 5)).toBe(true);
      }
      for (const repartition of [stats.organizations.byPlan, stats.organizations.byCountry]) {
        // Une case masquée seule se déduirait du total — sauf répartition à une case,
        // dont la valeur EST le total (masqué lui aussi).
        if (repartition.length > 1) {
          expect(repartition.filter((r) => r.cell.masked).length).not.toBe(1);
        }
      }
    }
  });
});

describe('stats — agrégats', () => {
  it('compte offres (effectives), pays, états, essais, actifs et modules', () => {
    const liste = [
      ...orgs(6, {}, 'pro'),
      ...orgs(5, { pays: 'CG', createdAt: new Date('2026-10-20T00:00:00Z') }, 'free'),
    ];
    const stats = computePlatformStats(
      entree({
        organizations: liste,
        subscriptions: [
          ...liste.slice(0, 6).map((o) => ({
            organizationId: o.id,
            effectivePlan: 'pro',
            status: 'active',
            trialStartedAt: new Date('2026-09-01T00:00:00Z'),
            lastPaymentAt: new Date('2026-09-20T00:00:00Z'),
          })),
          // Orphelin : ignoré.
          {
            organizationId: 'supprimee',
            effectivePlan: 'business',
            status: 'active',
            trialStartedAt: null,
            lastPaymentAt: null,
          },
        ],
        users: { total: 30, createdInWindow: 6, activeInWindow: 12 },
        activeOrganizationIds: [...liste.slice(0, 7).map((o) => o.id), 'inconnue'],
        moduleAdoption: { crm: liste.map((o) => o.id), rh: ['pro0', 'pro0', 'pro1'] },
        usage: { aiCallsInWindow: 40, pdfExportsInWindow: 2 },
      }),
    );
    const o = stats.organizations;
    expect(o.total).toEqual({ value: 11, masked: false });
    expect(o.activeInWindow).toEqual({ value: 7, masked: false });
    expect(o.createdInWindow).toEqual({ value: 5, masked: false });
    expect(Object.fromEntries(o.byPlan.map((r) => [r.key, r.cell.value]))).toEqual({
      free: 5,
      pro: 6,
      cabinet: null,
      business: null,
      expert: null,
    });
    expect(o.byCountry.map((r) => [r.key, r.cell.value])).toEqual([
      ['CD', 6],
      ['CG', 5],
    ]);
    expect(o.bySubscriptionStatus.map((r) => [r.key, r.cell.value])).toEqual([
      ['active', 6],
      ['none', 5],
    ]);
    expect(stats.trials.started.value).toBe(6);
    expect(stats.trials.converted.value).toBe(6);
    expect(stats.trials.ongoing.masked).toBe(true);
    expect(stats.modules.find((m) => m.key === 'crm')!.cell.value).toBe(11);
    expect(stats.modules.find((m) => m.key === 'rh')!.cell.masked).toBe(true);
    expect(stats.usage.pdfExportsInWindow.masked).toBe(true);
    expect(stats.users.activeInWindow.value).toBe(12);
  });

  it('ne sert aucun identifiant d’organisation', () => {
    const liste = orgs(8, {}, 'secret-org-');
    const stats = computePlatformStats(
      entree({
        organizations: liste,
        activeOrganizationIds: liste.map((o) => o.id),
        moduleAdoption: { crm: liste.map((o) => o.id) },
      }),
    );
    expect(JSON.stringify(stats)).not.toContain('secret-org-');
  });

  it('chaque module suivi nomme au moins une collection', () => {
    for (const m of STATS_MODULES) expect(STATS_MODULE_COLLECTIONS[m].length).toBeGreaterThan(0);
  });
});
