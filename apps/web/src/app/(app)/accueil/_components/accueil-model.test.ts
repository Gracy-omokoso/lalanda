// Accueil — ADR-0038 § 5 : des chiffres lus, jamais inventés.

import { describe, expect, it } from 'vitest';

import type { SettlementView } from '@/lib/api';

import {
  accorder,
  alertesAccueil,
  cheminInterne,
  chiffresBuild,
  chiffresGrow,
  chiffresRun,
} from './accueil-model';

function facture(overdue: boolean, sansReglement = false): SettlementView {
  return {
    invoiceId: 'x',
    number: 'F-1',
    type: 'FV',
    currency: 'CDF',
    customerName: null,
    issuedOn: null,
    total: '100',
    dueDate: null,
    status: overdue ? 'overdue' : 'unpaid',
    reason: null,
    settlement: sansReglement
      ? null
      : {
          status: overdue ? 'overdue' : 'unpaid',
          overdue,
          due: '100',
          credited: '0',
          received: '0',
          outstanding: '100',
          creditBalance: '0',
          version: '1',
        },
    asOf: '2026-10-29',
  };
}

describe('accords (Initiative est féminin)', () => {
  it('singulier jusqu’à 1, pluriel au-delà', () => {
    expect(accorder(0, 'initiative', 'initiatives')).toBe('initiative');
    expect(accorder(1, 'initiative', 'initiatives')).toBe('initiative');
    expect(accorder(2, 'initiative', 'initiatives')).toBe('initiatives');
  });

  it('BUILD : « 1 initiative », « 3 idées actives »', () => {
    expect(chiffresBuild({ initiatives: 1, ideesActives: 3 })).toEqual([
      { id: 'initiatives', valeur: '1', libelle: 'initiative', attention: false },
      { id: 'idees', valeur: '3', libelle: 'idées actives', attention: false },
    ]);
  });
});

describe('aucun chiffre inventé', () => {
  it('un fait inconnu n’est pas affiché — ni zéro, ni estimation', () => {
    expect(chiffresBuild({ initiatives: null, ideesActives: null })).toEqual([]);
    expect(chiffresBuild({ initiatives: 2, ideesActives: null }).map((c) => c.id)).toEqual([
      'initiatives',
    ]);
    expect(chiffresRun(null)).toEqual([]);
    expect(chiffresGrow({ alertes: null, sante: null })).toEqual([]);
  });

  it('un zéro connu, lui, s’affiche', () => {
    expect(chiffresBuild({ initiatives: 0, ideesActives: 0 }).map((c) => c.valeur)).toEqual([
      '0',
      '0',
    ]);
  });
});

describe('RUN : factures ouvertes', () => {
  it('compte les factures à encaisser et celles en retard', () => {
    const c = chiffresRun([facture(false), facture(true), facture(true), facture(false, true)]);
    expect(c.map((x) => [x.id, x.valeur, x.libelle, x.attention])).toEqual([
      ['a-encaisser', '3', 'factures à encaisser', false],
      ['en-retard', '2', 'factures en retard', true],
    ]);
  });

  it('aucun retard : pas de mise en relief', () => {
    expect(chiffresRun([facture(false)])[1]).toMatchObject({ valeur: '0', attention: false });
  });
});

describe('GROW', () => {
  it('alertes du brief et score de santé arrondi', () => {
    expect(
      chiffresGrow({ alertes: 1, sante: 72.4 }).map((c) => `${c.valeur} ${c.libelle}`),
    ).toEqual(['1 alerte du brief', '72/100 score de santé']);
  });
});

describe('alertes de l’accueil', () => {
  const a = (
    ruleId: string,
    severity: 'critique' | 'attention' | 'info',
    rank: number,
    actionPath = '/ventes/encaissements',
  ) => ({
    ruleId,
    severity,
    rank,
    title: ruleId,
    message: '',
    actionPath,
  });

  it('les plus graves d’abord, trois au plus', () => {
    expect(
      alertesAccueil([
        a('i', 'info', 1),
        a('c2', 'critique', 2),
        a('at', 'attention', 1),
        a('c1', 'critique', 1),
      ]).map((x) => x.id),
    ).toEqual(['c1', 'c2', 'at']);
  });

  it('un lien externe retombe sur le brief', () => {
    expect(alertesAccueil([a('x', 'info', 1, 'https://exemple.test')])[0]?.lien).toBe(
      '/organisation/brief',
    );
    expect(cheminInterne('//hote/x')).toBe(false);
    expect(cheminInterne('/ventes')).toBe(true);
  });
});
