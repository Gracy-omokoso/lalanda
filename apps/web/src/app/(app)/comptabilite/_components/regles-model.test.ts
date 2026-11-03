// Règles de correspondance et premier exercice — ADR-0049 § 2.4, § 2.7, § 3.1.

import { describe, expect, it } from 'vitest';

import type { OrgAction } from '@/lib/api';
import type {
  AccountingChartPackDetail,
  AccountingFiscalYearView,
  AccountingRuleSetView,
  AccountingSettingsView,
} from '@/lib/api-accounting';

import {
  actionOuvrirExercice,
  actionsRegles,
  brouillonDe,
  corpsValidation,
  exerciceAProposer,
  lireComptes,
  motifsDuPack,
  phraseAttente,
  reglesProposees,
  remplacerRegle,
  repriseDuBrouillon,
} from './regles-model';

// Numéros fictifs : aucun numéro du plan n'est écrit dans l'application (textes.test.ts).
const REGLAGES: AccountingSettingsView = {
  mode: 'simulation',
  banner: null,
  chartPack: {
    slug: 'pack-test',
    version: 2,
    label: 'Pack test',
    status: 'approved',
    warnings: [],
  },
  bookCurrency: 'CDF',
  cutoverDate: '2026-10-01',
  fiscalYearStartMonth: 1,
  stockPosting: 'off',
  depreciationPosting: 'off',
  ruleSetVersion: null,
  activatedAt: null,
  activatedBy: null,
  activation: { possible: false, missing: [] },
  locks: { bookCurrency: false, cutoverDate: false, fiscalYearStartMonth: false },
  revision: 3,
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const PACK = {
  slug: 'pack-test',
  version: 2,
  suspenseAccount: '9X9',
  proposedRules: [
    { key: 'a.b', debit: ['{customer}'], credit: ['{customer}'], requiresReview: false },
    {
      key: 'a.c',
      debit: ['1X1'],
      credit: ['1X1'],
      requiresReview: false,
      confirmation: 'to_confirm',
    },
    {
      key: 'a.d',
      debit: ['9X9'],
      credit: ['9X9'],
      requiresReview: true,
      note: 'À revoir — motif : compte à choisir par l’expert.',
    },
    { debit: [], credit: [] },
  ],
} as unknown as AccountingChartPackDetail;

const JEU = (
  version: number,
  status: AccountingRuleSetView['status'],
  basedOn: AccountingRuleSetView['basedOn'] = { packSlug: 'pack-test', packVersion: 2 },
  rules: AccountingRuleSetView['rules'] = [
    { key: 'a.b', debit: ['{customer}'], credit: ['{customer}'], requiresReview: false },
    { key: 'a.d', debit: ['9X9'], credit: ['9X9'], requiresReview: true },
  ],
): AccountingRuleSetView => ({
  version,
  status,
  basedOn,
  rules,
  validation: null,
  revision: 2,
  createdBy: 'u',
  updatedBy: 'u',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
});

const GERANT: OrgAction[] = ['accounting.read', 'accounting.manage', 'accounting.close'];
const LECTEUR: OrgAction[] = ['accounting.read', 'accounting.export'];

describe('règles proposées par le pack', () => {
  it('même passage que le serveur : « à confirmer » devient « à revoir » ; clé absente ignorée', () => {
    expect(reglesProposees(PACK)).toEqual([
      { key: 'a.b', debit: ['{customer}'], credit: ['{customer}'], requiresReview: false },
      { key: 'a.c', debit: ['1X1'], credit: ['1X1'], requiresReview: true },
      { key: 'a.d', debit: ['9X9'], credit: ['9X9'], requiresReview: true },
    ]);
  });

  it('motif de chaque règle et compte d’attente lus dans le pack', () => {
    expect(motifsDuPack(PACK).get('a.d')).toMatch(/motif/);
    expect(motifsDuPack(PACK).has('a.b')).toBe(false);
    expect(motifsDuPack(null).size).toBe(0);
    expect(phraseAttente(PACK)).toBe('au compte d’attente 9X9');
    expect(phraseAttente(null)).toBe('au compte d’attente technique');
  });
});

describe('brouillon et reprise après un changement de plan', () => {
  it('le brouillon est la version `draft`', () => {
    expect(brouillonDe([JEU(1, 'validated'), JEU(2, 'draft')])?.version).toBe(2);
    expect(brouillonDe([JEU(1, 'validated')])).toBeNull();
    expect(brouillonDe(null)).toBeNull();
  });

  it('brouillon né d’un autre pack (v1 → v2) : reprise demandée, raison dite', () => {
    const v1 = JEU(1, 'draft', { packSlug: 'pack-test', packVersion: 1 }, []);
    expect(repriseDuBrouillon(v1, REGLAGES, 3)).toMatch(/version 1.*version 2/);
  });

  it('brouillon vide alors que le pack propose des règles : reprise demandée', () => {
    const vide = JEU(1, 'draft', { packSlug: 'pack-test', packVersion: 2 }, []);
    expect(repriseDuBrouillon(vide, REGLAGES, 3)).toMatch(/vide.*3 règles/);
    expect(repriseDuBrouillon(vide, REGLAGES, 0)).toBeNull();
    expect(repriseDuBrouillon(vide, REGLAGES, null)).toBeNull();
  });

  it('brouillon du pack choisi, non vide : rien à reprendre', () => {
    expect(repriseDuBrouillon(JEU(1, 'draft'), REGLAGES, 3)).toBeNull();
    expect(repriseDuBrouillon(null, REGLAGES, 3)).toBeNull();
  });
});

describe('droits sur les règles (accounting.manage)', () => {
  it('sans brouillon : créer ; avec brouillon : modifier et valider', () => {
    expect(actionsRegles(REGLAGES, [], GERANT)).toEqual({
      creer: true,
      modifier: false,
      raison: null,
    });
    expect(actionsRegles(REGLAGES, [JEU(1, 'validated')], GERANT).creer).toBe(true);
    expect(actionsRegles(REGLAGES, [JEU(2, 'draft')], GERANT)).toEqual({
      creer: false,
      modifier: true,
      raison: null,
    });
  });

  it('sans le droit : rien n’est offert, raison dite', () => {
    const a = actionsRegles(REGLAGES, [JEU(2, 'draft')], LECTEUR);
    expect(a.creer || a.modifier).toBe(false);
    expect(a.raison).toMatch(/rôle/);
  });

  it('sans plan comptable : créer est refusé, raison dite', () => {
    const a = actionsRegles({ ...REGLAGES, chartPack: null }, [], GERANT);
    expect(a.creer).toBe(false);
    expect(a.raison).toMatch(/plan comptable/);
  });

  it('lectures en cours : rien n’est offert', () => {
    expect(actionsRegles(REGLAGES, null, GERANT)).toEqual({
      creer: false,
      modifier: false,
      raison: null,
    });
  });
});

describe('modifier une règle du brouillon', () => {
  const regles = JEU(1, 'draft').rules;

  it('lit les comptes séparés par virgules, points-virgules ou espaces', () => {
    expect(lireComptes(' 1X1, {customer} ;2X2  3X3 ')).toEqual(['1X1', '{customer}', '2X2', '3X3']);
    expect(lireComptes('  ')).toEqual([]);
  });

  it('remplace débit, crédit et « à revoir » de la seule règle visée', () => {
    const r = remplacerRegle(regles, 'a.d', { debit: '1X1', credit: '2X2', aRevoir: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.regles.map((x) => x.key)).toEqual(['a.b', 'a.d']);
    expect(r.regles[1]).toEqual({
      key: 'a.d',
      debit: ['1X1'],
      credit: ['2X2'],
      requiresReview: false,
    });
    expect(r.regles[0]).toEqual(regles[0]);
  });

  it('refus : clé inconnue, plus de cinq comptes, règle appliquée sans compte', () => {
    expect(remplacerRegle(regles, 'x.y', { debit: '', credit: '', aRevoir: true }).ok).toBe(false);
    expect(
      remplacerRegle(regles, 'a.b', { debit: '1 2 3 4 5 6', credit: '', aRevoir: false }).ok,
    ).toBe(false);
    expect(remplacerRegle(regles, 'a.b', { debit: '', credit: '', aRevoir: false }).ok).toBe(false);
    expect(remplacerRegle(regles, 'a.b', { debit: '', credit: '', aRevoir: true }).ok).toBe(true);
  });
});

describe('valider avec la déclaration de relecture', () => {
  const saisie = { coche: true, nom: ' Cabinet Essai ', date: '2026-11-03', note: ' ' };

  it('corps attendu par l’API : déclarée, nom, date, note vide → null', () => {
    expect(corpsValidation(7, saisie, '2026-11-03')).toEqual({
      ok: true,
      corps: {
        expectedRevision: 7,
        expertReview: { declared: true, name: 'Cabinet Essai', date: '2026-11-03', note: null },
      },
    });
  });

  it('case, nom et date exigés ; date future refusée', () => {
    expect(corpsValidation(1, { ...saisie, coche: false }, '2026-11-03').ok).toBe(false);
    expect(corpsValidation(1, { ...saisie, nom: '  ' }, '2026-11-03').ok).toBe(false);
    expect(corpsValidation(1, { ...saisie, date: '' }, '2026-11-03').ok).toBe(false);
    const futur = corpsValidation(1, { ...saisie, date: '2026-11-04' }, '2026-11-03');
    expect(futur).toEqual({ ok: false, erreur: expect.stringMatching(/futur/) });
  });
});

describe('premier exercice (FISCAL_YEAR_NOT_OPEN)', () => {
  const ex = (
    year: number,
    status: AccountingFiscalYearView['status'],
  ): AccountingFiscalYearView => ({
    year,
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    status,
    closedAt: null,
    periods: [],
    revision: 1,
  });

  it('aucun exercice : celui qui contient la bascule', () => {
    expect(exerciceAProposer(REGLAGES, [], '2027-03-01')).toBe(2026);
    expect(exerciceAProposer({ ...REGLAGES, cutoverDate: null }, [], '2027-03-01')).toBe(2027);
  });

  it('début d’exercice en juillet : bascule en mars → exercice commencé l’année d’avant', () => {
    const r = { ...REGLAGES, fiscalYearStartMonth: 7, cutoverDate: '2026-03-15' };
    expect(exerciceAProposer(r, [], '2026-11-03')).toBe(2025);
    expect(exerciceAProposer({ ...r, cutoverDate: '2026-07-01' }, [], '2026-11-03')).toBe(2026);
  });

  it('un exercice ouvert : rien à proposer ; tous clos : le suivant', () => {
    expect(exerciceAProposer(REGLAGES, [ex(2026, 'open')], '2026-11-03')).toBeNull();
    expect(
      exerciceAProposer(REGLAGES, [ex(2025, 'closed'), ex(2026, 'closed')], '2026-11-03'),
    ).toBe(2027);
  });

  it('ouvrir un exercice demande `accounting.close`, raison dite sinon', () => {
    expect(actionOuvrirExercice(GERANT)).toEqual({ offert: true, raison: null });
    expect(actionOuvrirExercice(LECTEUR).raison).toMatch(/clôturer/);
    expect(actionOuvrirExercice(null).offert).toBe(false);
  });
});
