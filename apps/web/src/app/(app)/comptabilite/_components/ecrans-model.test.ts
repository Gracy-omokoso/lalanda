// Modèles des écrans de la comptabilité — ADR-0049 § 4, § 6.10, § 9, § 10, § 13, lot K8.

import {
  ACCOUNTING_DISCLAIMER,
  ACCOUNTING_SIMULATION_EXPORT_MARK,
} from '@lalanda/shared/accounting';
import { describe, expect, it } from 'vitest';

import type {
  AccountingEntryView,
  AccountingStatementView,
  AccountingTrialBalanceView,
} from '@/lib/api-accounting';

import { actionsPeriode, raisonsDuRefus } from './clotures-model';
import { corpsRecherche, lienPiece, numeroEcriture, origineEcriture } from './ecritures-model';
import { bandeauxEtat, estProjet, etatNonDisponible, rubriquesAConfirmer } from './etats-model';
import { empreinteCourte, formatsDe, titreExport, TYPES_EXPORT } from './exports-model';
import { dernieresClotures, phraseMode, reservesDe, tuilesVue } from './vue-ensemble-model';

const BIENTOT = { ok: false as const, erreur: { status: 404, detail: {} } };

const BALANCE = (reserves: AccountingTrialBalanceView['reserves']): AccountingTrialBalanceView => ({
  bookCurrency: 'CDF',
  from: '2026-10-01',
  to: '2026-10-31',
  rows: [],
  totals: { debit: '0.00', credit: '0.00', balanced: true },
  reserves,
});

describe('vue d’ensemble (§ 13)', () => {
  it('routes pas encore livrées : des phrases, jamais un zéro inventé', () => {
    const t = tuilesVue({ balance: BIENTOT, aComptabiliser: BIENTOT });
    expect(t.map((x) => x.id)).toEqual(['reserves', 'attente', 'a-comptabiliser']);
    for (const x of t)
      expect(x.contenu).toEqual({ etat: 'indisponible', phrase: 'Bientôt disponible' });
    expect(reservesDe(BIENTOT)).toBeNull();
  });

  it('réserves en premier ; le solde d’attente est celui de la réserve du moteur', () => {
    const b = BALANCE([
      { code: 'PACK_NOT_REVIEWED', message: 'Plan non relu.' },
      { code: 'SUSPENSE_BALANCE', message: 'Attente.', details: { amount: '1500.00' } },
    ]);
    const t = tuilesVue({
      balance: { ok: true, valeur: b },
      aComptabiliser: { ok: true, valeur: { items: [], nextCursor: null } },
    });
    expect(t[0]!.id).toBe('reserves');
    expect(t[0]!.contenu).toMatchObject({ etat: 'connu', valeur: '2', attention: true });
    const attente = t[1]!.contenu;
    expect(attente.etat).toBe('connu');
    if (attente.etat === 'connu') {
      expect(attente.valeur.replace(/\s/g, ' ')).toBe('1 500,00 CDF');
      expect(attente.attention).toBe(true);
    }
    expect(t[2]!.contenu).toMatchObject({ etat: 'connu', valeur: '0', attention: false });
  });

  it('dernières clôtures : les plus récentes d’abord, trois au plus', () => {
    const c = dernieresClotures([
      {
        year: 2026,
        start: '2026-01-01',
        end: '2026-12-31',
        status: 'open',
        closedAt: null,
        revision: 1,
        periods: [
          {
            year: 2026,
            month: 8,
            start: '',
            end: '',
            status: 'closed',
            closedAt: '2026-09-05T10:00:00Z',
          },
          {
            year: 2026,
            month: 9,
            start: '',
            end: '',
            status: 'closed',
            closedAt: '2026-10-05T10:00:00Z',
          },
          { year: 2026, month: 10, start: '', end: '', status: 'open', closedAt: null },
          {
            year: 2026,
            month: 7,
            start: '',
            end: '',
            status: 'closed',
            closedAt: '2026-08-05T10:00:00Z',
          },
          {
            year: 2026,
            month: 6,
            start: '',
            end: '',
            status: 'closed',
            closedAt: '2026-07-05T10:00:00Z',
          },
        ],
      },
    ]);
    expect(c.map((x) => x.libelle)).toEqual(['septembre 2026', 'août 2026', 'juillet 2026']);
  });

  it('mode éteint ou inconnu : une phrase', () => {
    expect(phraseMode('off')).toMatch(/éteinte/);
    expect(phraseMode(null)).toMatch(/pas encore lisible/);
    expect(phraseMode('simulation')).toBeNull();
  });
});

const ECRITURE: AccountingEntryView = {
  id: 'e1',
  journalCode: 'VE',
  fiscalYear: 2026,
  number: 12,
  date: '2026-10-03',
  status: 'posted',
  label: null,
  source: {
    kind: 'sales_invoice',
    id: 'abc',
    number: 'FV-12',
    date: '2026-10-03',
    partyName: 'Client',
  },
  lines: [],
  reversalOf: null,
  reversedBy: null,
  generation: { ruleSetVersion: 3, engineVersion: '1.0.0' },
  manual: null,
  suspense: false,
};

describe('écritures (§ 2.6, § 13)', () => {
  it('filtres en corps, seulement ceux renseignés', () => {
    expect(corpsRecherche({ journal: '', mois: '', compte: ' ', piece: '' })).toEqual({
      limit: 50,
    });
    expect(
      corpsRecherche({ journal: 'VE', mois: '2026-10', compte: '9', piece: 'FV-1' }, 'c'),
    ).toEqual({
      journalCode: 'VE',
      from: '2026-10-01',
      to: '2026-10-31',
      accountNumber: '9',
      sourceNumber: 'FV-1',
      cursor: 'c',
      limit: 50,
    });
  });

  it('numéro, ou son absence en simulation', () => {
    expect(numeroEcriture(ECRITURE)).toBe('VE 2026 n° 12');
    expect(numeroEcriture({ ...ECRITURE, number: null, fiscalYear: null, status: 'draft' })).toBe(
      'VE, sans numéro',
    );
  });

  it('la pièce complète exige la lecture de son module (§ 8.1) ; l’expert n’a que la copie', () => {
    expect(lienPiece(ECRITURE.source, ['accounting.read', 'sales.read'])).toBe(
      '/ventes/factures/abc',
    );
    expect(lienPiece(ECRITURE.source, ['accounting.read', 'accounting.export'])).toBeNull();
    expect(lienPiece(null, ['sales.read'])).toBeNull();
  });

  it('origine : règle et sa version, ou motif de la saisie', () => {
    expect(origineEcriture(ECRITURE)).toMatch(/règles version 3/);
    expect(
      origineEcriture({
        generation: null,
        manual: { authorId: 'a', validatorId: null, reason: 'Reclassement' },
      }),
    ).toMatch(/Reclassement/);
  });
});

const ETAT: AccountingStatementView = {
  status: 'draft_unverified',
  disclaimer: ACCOUNTING_DISCLAIMER,
  reserves: [{ code: 'PACK_NOT_REVIEWED', message: 'Plan non relu.' }],
  kind: 'income-statement',
  label: 'Compte de résultat',
  bookCurrency: 'CDF',
  from: '2026-01-01',
  to: '2026-12-31',
  sections: [
    {
      code: 'P',
      label: 'Produits',
      toConfirm: true,
      total: '10.00',
      rubrics: [
        { code: 'P1', label: 'Ventes', toConfirm: false, amount: '10.00' },
        { code: 'P2', label: 'Autres', toConfirm: false, amount: '0.00' },
      ],
    },
    {
      code: 'C',
      label: 'Charges',
      toConfirm: false,
      total: '0.00',
      rubrics: [{ code: 'C1', label: 'Achats', toConfirm: true, amount: '0.00' }],
    },
  ],
  result: '10.00',
};

describe('projets d’états (§ 10)', () => {
  it('le bandeau projet est là AVANT toute lecture et après', () => {
    expect(bandeauxEtat(null)).toEqual([ACCOUNTING_DISCLAIMER]);
    expect(bandeauxEtat(ETAT)).toEqual([ACCOUNTING_DISCLAIMER]);
    expect(bandeauxEtat({ ...ETAT, disclaimer: 'Autre mention.' })).toEqual([
      ACCOUNTING_DISCLAIMER,
      'Autre mention.',
    ]);
  });

  it('statut projet, rubriques à confirmer, tableau des flux non disponible', () => {
    expect(estProjet(ETAT)).toBe(true);
    expect(rubriquesAConfirmer(ETAT)).toBe(3);
    expect(etatNonDisponible({ status: 409, detail: { code: 'STATEMENT_NOT_AVAILABLE' } })).toBe(
      true,
    );
    expect(etatNonDisponible({ status: 404, detail: {} })).toBe(false);
  });
});

describe('clôtures (§ 4)', () => {
  it('clôturer : `accounting.close` ; rouvrir : Propriétaire seul', () => {
    expect(actionsPeriode('open', ['accounting.close'], 'accountant').cloturer).toBe(true);
    expect(actionsPeriode('open', ['accounting.read'], 'viewer').cloturer).toBe(false);
    const df = actionsPeriode('closed', ['accounting.close'], 'finance_director');
    expect(df.rouvrir).toBe(false);
    expect(df.raisonRouvrir).toMatch(/Propriétaire/);
    expect(actionsPeriode('closed', ['accounting.close'], 'owner').rouvrir).toBe(true);
  });

  it('conditions manquantes d’une clôture d’exercice', () => {
    const err = {
      status: 409,
      detail: {
        code: 'FISCAL_YEAR_NOT_CLOSABLE',
        details: { reasons: ['AWAITING_RATE', { code: 'X' }] },
      },
    };
    expect(raisonsDuRefus(err)).toEqual(['Des écritures attendent un taux de change.', 'X']);
    expect(raisonsDuRefus({ status: 409, detail: { code: 'PERIOD_HAS_DRAFTS' } })).toHaveLength(1);
    expect(raisonsDuRefus({ status: 500 })).toEqual([]);
  });
});

describe('exports (§ 9)', () => {
  it('formats proposés par contenu', () => {
    expect(formatsDe('entries')).toEqual(['csv']);
    expect(formatsDe('statements')).toEqual(['pdf', 'xlsx']);
    for (const t of TYPES_EXPORT) expect(t.formats.length).toBeGreaterThan(0);
  });

  it('marque « SIMULATION » et empreinte abrégée', () => {
    expect(
      titreExport({ kind: 'entries', simulation: true }).startsWith(
        ACCOUNTING_SIMULATION_EXPORT_MARK,
      ),
    ).toBe(true);
    expect(titreExport({ kind: 'entries', simulation: false })).not.toMatch(/SIMULATION/);
    expect(empreinteCourte('a'.repeat(64))).toBe('aaaaaaaa…aaaaaaaa');
  });
});
