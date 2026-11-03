// Assistant d'activation — ADR-0049 § 3.1, § 13, critère 2, lot K8.

import { describe, expect, it } from 'vitest';

import type { OrgAction } from '@/lib/api';
import type { AccountingRuleSetView, AccountingSettingsView } from '@/lib/api-accounting';

import {
  LIBELLES_CONDITION,
  conditionsDuRefus,
  etapesActivation,
  optionsMode,
  reglesAConfirmer,
  reglesEnVigueur,
} from './activation-model';

const REGLAGES: AccountingSettingsView = {
  mode: 'off',
  banner: null,
  chartPack: { slug: 'pack-test', version: 1, label: 'Pack test', status: 'draft', warnings: [] },
  bookCurrency: null,
  cutoverDate: null,
  fiscalYearStartMonth: 1,
  stockPosting: 'off',
  depreciationPosting: 'off',
  ruleSetVersion: null,
  activatedAt: null,
  activatedBy: null,
  activation: { possible: false, missing: [] },
  locks: { bookCurrency: false, cutoverDate: false, fiscalYearStartMonth: false },
  revision: 1,
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const PROPRIETAIRE: OrgAction[] = ['accounting.read', 'accounting.manage', 'fiscal.manage'];
const COMPTABLE: OrgAction[] = ['accounting.read', 'accounting.manage'];
const EXPERT: OrgAction[] = ['analytics.read', 'accounting.read', 'accounting.export'];

const option = (r: AccountingSettingsView | null, a: OrgAction[], m: string) =>
  optionsMode(r, a).find((o) => o.mode === m)!;

describe('choix du mode (§ 3.1)', () => {
  it('trois modes, dans l’ordre off, simulation, active', () => {
    expect(optionsMode(REGLAGES, PROPRIETAIRE).map((o) => o.mode)).toEqual([
      'off',
      'simulation',
      'active',
    ]);
  });

  it('pack brouillon : `active` grisé AVEC sa raison ; la simulation reste offerte', () => {
    const active = option(REGLAGES, PROPRIETAIRE, 'active');
    expect(active.desactive).toBe(true);
    expect(active.raison).toMatch(/pas encore approuvé/);
    expect(active.raison).toMatch(/brouillon/);
    const simulation = option(REGLAGES, PROPRIETAIRE, 'simulation');
    expect(simulation.desactive).toBe(false);
    expect(simulation.raison).toBeNull();
  });

  it('aucun pack choisi : `active` grisé, raison dite', () => {
    const r = { ...REGLAGES, chartPack: null };
    expect(option(r, PROPRIETAIRE, 'active').raison).toMatch(/Aucun plan comptable/);
  });

  it('pack approuvé : `active` offert au Propriétaire, grisé pour qui n’a pas `fiscal.manage`', () => {
    const r: AccountingSettingsView = {
      ...REGLAGES,
      chartPack: {
        slug: 'pack-test',
        version: 2,
        label: 'Pack test',
        status: 'approved',
        warnings: [],
      },
    };
    expect(option(r, PROPRIETAIRE, 'active').desactive).toBe(false);
    const comptable = option(r, COMPTABLE, 'active');
    expect(comptable.desactive).toBe(true);
    expect(comptable.raison).toMatch(/fiscalité/);
  });

  it('sans `accounting.manage` : tout est grisé, raison dite (expert-comptable externe)', () => {
    for (const o of optionsMode(REGLAGES, EXPERT)) {
      expect(o.desactive).toBe(true);
      if (!o.courant) expect(o.raison).toMatch(/paramétrer/);
    }
  });

  it('réglages illisibles : rien n’est offert', () => {
    for (const o of optionsMode(null, PROPRIETAIRE)) expect(o.desactive).toBe(true);
  });

  it('le mode courant est marqué et non proposé à nouveau', () => {
    const o = option({ ...REGLAGES, mode: 'simulation' }, PROPRIETAIRE, 'simulation');
    expect(o.courant).toBe(true);
    expect(o.desactive).toBe(true);
  });
});

describe('refus du serveur (409 ACCOUNTING_ACTIVATION_PRECONDITION)', () => {
  it('liste les conditions manquantes dans l’ordre de l’assistant', () => {
    const err = {
      status: 409,
      detail: {
        code: 'ACCOUNTING_ACTIVATION_PRECONDITION',
        details: { missing: ['CUTOVER_DATE_REQUIRED', 'CHART_PACK_NOT_APPROVED', 'INCONNU'] },
      },
    };
    expect(conditionsDuRefus(err)).toEqual(['CHART_PACK_NOT_APPROVED', 'CUTOVER_DATE_REQUIRED']);
    expect(conditionsDuRefus({ status: 403, detail: {} })).toBeNull();
    for (const t of Object.values(LIBELLES_CONDITION)) expect(t.length).toBeGreaterThan(10);
  });
});

const JEU = (
  v: number,
  statut: AccountingRuleSetView['status'],
  relu: boolean,
): AccountingRuleSetView => ({
  version: v,
  status: statut,
  basedOn: null,
  rules: [
    { key: 'sale.invoice.receivable', debit: ['x'], credit: [], requiresReview: true },
    {
      key: 'sale.invoice.revenue.SER.B',
      debit: [],
      credit: ['y'],
      requiresReview: false,
    },
  ],
  validation:
    statut === 'validated'
      ? {
          by: 'u',
          at: '2026-10-01',
          soleApprover: false,
          expertReview: { declared: relu, name: relu ? 'Expert' : null, date: null, note: null },
        }
      : null,
  revision: 1,
  createdBy: 'u',
  updatedBy: 'u',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

describe('étapes de l’assistant (§ 13)', () => {
  it('cinq étapes : pack, monnaie, bascule, règles, premier exercice', () => {
    expect(etapesActivation(REGLAGES, null).map((e) => [e.numero, e.id])).toEqual([
      [1, 'pack'],
      [2, 'monnaie'],
      [3, 'bascule'],
      [4, 'regles'],
      [5, 'exercice'],
    ]);
  });

  it('premier exercice : fait seulement avec un exercice ouvert', () => {
    const ex = (status: 'open' | 'closed') => ({
      year: 2026,
      start: '2026-01-01',
      end: '2026-12-31',
      status,
      closedAt: null,
      periods: [],
      revision: 1,
    });
    expect(etapesActivation(REGLAGES, null, null)[4]!.etat).toBe('a-faire');
    expect(etapesActivation(REGLAGES, null, [ex('closed')])[4]!.etat).toBe('a-faire');
    const e = etapesActivation(REGLAGES, null, [ex('open')])[4]!;
    expect(e.etat).toBe('fait');
    expect(e.resume).toMatch(/Exercice 2026 ouvert/);
  });

  it('règles : un brouillon est annoncé, à valider avec la déclaration de relecture', () => {
    expect(etapesActivation(REGLAGES, [])[3]!.resume).toMatch(/créez les règles/);
    expect(etapesActivation(REGLAGES, [JEU(4, 'draft', false)])[3]!.resume).toMatch(
      /Version 4 en brouillon \(2 règles\)/,
    );
  });

  it('libellé exact : un plan « approuvé » sans prétendre à la relecture d’un expert', () => {
    expect(LIBELLES_CONDITION.CHART_PACK_NOT_APPROVED).not.toMatch(/expert/);
    expect(LIBELLES_CONDITION.CHART_PACK_NOT_APPROVED).toMatch(/approuvé/);
    const r = { ...REGLAGES, chartPack: null };
    expect(option(r, PROPRIETAIRE, 'active').raison).not.toMatch(/expert/);
  });

  it('pack brouillon : « en attente de l’expert-comptable » ; monnaie sans défaut', () => {
    const e = etapesActivation(REGLAGES, null);
    expect(e[0]!.etat).toBe('attente-expert');
    expect(e[1]!.etat).toBe('a-faire');
    expect(e[1]!.resume).toMatch(/ne la choisit pas pour vous/);
    expect(e[2]!.etat).toBe('a-faire');
    expect(e[3]!.etat).toBe('a-faire');
  });

  it('règles : faites seulement avec une version validée ET la déclaration de relecture', () => {
    const r = { ...REGLAGES, bookCurrency: 'CDF' as const, cutoverDate: '2026-11-01' };
    expect(etapesActivation(r, [JEU(1, 'validated', false)])[3]!.etat).toBe('a-faire');
    const e = etapesActivation(r, [
      JEU(1, 'validated', false),
      JEU(2, 'validated', true),
      JEU(3, 'draft', false),
    ]);
    expect(e[1]!.etat).toBe('fait');
    expect(e[2]!.etat).toBe('fait');
    expect(e[3]!.etat).toBe('fait');
    expect(e[3]!.resume).toMatch(/Version 2/);
  });

  it('règles à confirmer comptées ; version en vigueur', () => {
    expect(reglesAConfirmer(JEU(1, 'draft', false))).toBe(1);
    expect(reglesEnVigueur([JEU(1, 'draft', false)])).toBeNull();
    expect(reglesEnVigueur(null)).toBeNull();
  });
});
