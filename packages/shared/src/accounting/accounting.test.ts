import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ACCOUNTING_ACTIVATABLE_PACK_STATUSES,
  ACCOUNTING_ACTIVATION_MISSING_CODES,
  ACCOUNTING_CHART_PACK_STATUSES,
  ACCOUNTING_DEFAULT_JOURNALS,
  ACCOUNTING_DISCLAIMER,
  ACCOUNTING_ENTRY_STATUSES,
  ACCOUNTING_ERROR_CODES,
  ACCOUNTING_MODE_BANNERS,
  ACCOUNTING_MODES,
  ACCOUNTING_PENDING_REASONS,
  ACCOUNTING_RATE_SOURCES,
  ACCOUNTING_RECONCILIATION_CAUSES,
  ACCOUNTING_RESERVES,
  ACCOUNTING_SETTINGS_DEFAULTS,
  ACCOUNTING_STATEMENT_KINDS,
  ACCOUNTING_STATEMENT_STATUS,
  ACCOUNTING_SYNC_SOURCES,
  AccountingAccountNumber,
  AccountingAmount,
  AccountingCalendarDay,
  AccountingCurrencySchema,
  AccountingId,
  AccountingJournalCode,
  AccountingMonthParam,
  AccountingRate,
  AccountingReopenSchema,
  AccountingYearParam,
  canonicalAccountingDecimal,
  findForbiddenAccountingWords,
} from './index.js';

type Issues = { issues: { params?: { code?: string }; message: string }[] };
const codes = (r: { success: boolean; error?: unknown }): string[] =>
  r.success ? [] : (r.error as Issues).issues.map((i) => i.params?.code ?? i.message);

describe('comptabilité — constantes (ADR-0049 §§ 2 à 11)', () => {
  it('trois modes, `off` par défaut ; aucune monnaie de tenue ni bascule par défaut', () => {
    expect([...ACCOUNTING_MODES]).toEqual(['off', 'simulation', 'active']);
    expect(ACCOUNTING_SETTINGS_DEFAULTS).toEqual({
      mode: 'off',
      bookCurrency: null,
      cutoverDate: null,
      fiscalYearStartMonth: 1,
      stockPosting: 'off',
      depreciationPosting: 'off',
    });
  });

  it('pack : cycle de docs/09 ; seuls `approved` et `active` permettent le mode actif', () => {
    expect([...ACCOUNTING_CHART_PACK_STATUSES]).toEqual([
      'draft',
      'review',
      'approved',
      'active',
      'retired',
    ]);
    expect([...ACCOUNTING_ACTIVATABLE_PACK_STATUSES]).toEqual(['approved', 'active']);
  });

  it('activation : six conditions, dont `CHART_PACK_NOT_APPROVED` (critère 2)', () => {
    expect(ACCOUNTING_ACTIVATION_MISSING_CODES).toHaveLength(6);
    expect(ACCOUNTING_ACTIVATION_MISSING_CODES[0]).toBe('CHART_PACK_NOT_APPROVED');
  });

  it('écritures : brouillon, en attente de taux, validée ; quatre origines de taux', () => {
    expect([...ACCOUNTING_ENTRY_STATUSES]).toEqual(['draft', 'awaiting_rate', 'posted']);
    expect([...ACCOUNTING_RATE_SOURCES]).toEqual([
      'same_currency',
      'document',
      'observed',
      'entered',
    ]);
  });

  it('journaux par défaut VE, AC, OD, AN ; sept sources synchronisées ; cinq motifs en attente', () => {
    expect(ACCOUNTING_DEFAULT_JOURNALS.map((j) => j.code)).toEqual(['VE', 'AC', 'OD', 'AN']);
    expect(ACCOUNTING_SYNC_SOURCES).toHaveLength(7);
    expect(ACCOUNTING_PENDING_REASONS).toHaveLength(5);
  });

  it('restitution : neuf réserves, sept causes d’écart, trois projets d’états', () => {
    expect(ACCOUNTING_RESERVES).toHaveLength(9);
    expect(ACCOUNTING_RECONCILIATION_CAUSES).toContain('UNEXPLAINED');
    expect([...ACCOUNTING_STATEMENT_KINDS]).toEqual([
      'balance-sheet',
      'income-statement',
      'cash-flow',
    ]);
    expect(ACCOUNTING_STATEMENT_STATUS).toBe('draft_unverified');
  });

  it('codes d’erreur uniques, en SCREAMING_SNAKE_CASE', () => {
    expect(new Set(ACCOUNTING_ERROR_CODES).size).toBe(ACCOUNTING_ERROR_CODES.length);
    for (const c of ACCOUNTING_ERROR_CODES) expect(c).toMatch(/^[A-Z][A-Z0-9_]+$/);
  });
});

describe('comptabilité — bandeaux et mots interdits (§ 10, critère 14)', () => {
  it('le bandeau dit « Projet » et « expert-comptable »', () => {
    expect(ACCOUNTING_DISCLAIMER.startsWith('Projet — à valider par un expert-comptable.')).toBe(
      true,
    );
    expect(ACCOUNTING_MODE_BANNERS.active).toContain('Projet');
    expect(ACCOUNTING_MODE_BANNERS.simulation).toContain('Simulation');
  });

  it('le bandeau officiel et les bandeaux de mode ne déclenchent pas le contrôle', () => {
    expect(findForbiddenAccountingWords(ACCOUNTING_DISCLAIMER)).toEqual([]);
    expect(findForbiddenAccountingWords(`${ACCOUNTING_DISCLAIMER} Bilan au 31/12`)).toEqual([]);
    for (const b of Object.values(ACCOUNTING_MODE_BANNERS)) {
      expect(findForbiddenAccountingWords(b)).toEqual([]);
    }
  });

  it('trouve les mots interdits, formes fléchies et casse comprises', () => {
    expect(findForbiddenAccountingWords('Bilan certifié')).toEqual(['certifié']);
    expect(findForbiddenAccountingWords('États DÉFINITIFS')).toEqual(['définitif']);
    expect(findForbiddenAccountingWords('Comptes certifiés conformes')).toEqual([
      'conforme',
      'certifié',
    ]);
    expect(findForbiddenAccountingWords('Attestation de conformité')).toEqual(['conforme']);
    expect(findForbiddenAccountingWords('Liasse fiscale')).toEqual(['liasse']);
  });

  it('aucune constante du contrat ne porte un mot interdit hors du bandeau', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of readdirSync(here).filter((f) => !f.endsWith('.test.ts'))) {
      const source = readFileSync(join(here, file), 'utf8')
        // Les commentaires et la liste elle-même citent les mots pour les interdire.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/ACCOUNTING_FORBIDDEN_WORDS = \[[^\]]*\]/, '')
        .replace(/export function findForbiddenAccountingWords[\s\S]*?\n\}\n/, '');
      expect(findForbiddenAccountingWords(source), file).toEqual([]);
    }
  });
});

describe('comptabilité — briques de schéma (ADR-0049 O8)', () => {
  it('identifiant Mongo ramené en minuscules', () => {
    expect(AccountingId.parse('ABCDEFABCDEFABCDEFABCDEF')).toBe('abcdefabcdefabcdefabcdef');
    expect(codes(AccountingId.safeParse('xyz'))).toEqual(['ACCOUNTING_ID_INVALID']);
  });

  it('devise : CDF ou USD seulement', () => {
    expect(AccountingCurrencySchema.parse('USD')).toBe('USD');
    expect(AccountingCurrencySchema.safeParse('EUR').success).toBe(false);
  });

  it('dates civiles réelles, années et mois de chemin', () => {
    expect(AccountingCalendarDay.parse('2028-02-29')).toBe('2028-02-29');
    expect(codes(AccountingCalendarDay.safeParse('2026-02-29'))).toEqual(['INVALID_DATE']);
    expect(AccountingYearParam.parse('2026')).toBe(2026);
    expect(AccountingYearParam.safeParse('26').success).toBe(false);
    expect(AccountingMonthParam.parse('03')).toBe(3);
    expect(AccountingMonthParam.parse('12')).toBe(12);
    expect(AccountingMonthParam.safeParse('13').success).toBe(false);
    expect(AccountingMonthParam.safeParse('0').success).toBe(false);
  });

  it('numéro de compte : forme seulement, chiffres', () => {
    expect(AccountingAccountNumber.parse(' 4711 ')).toBe('4711');
    expect(codes(AccountingAccountNumber.safeParse('47A'))).toEqual(['ACCOUNT_NUMBER_INVALID']);
    expect(codes(AccountingAccountNumber.safeParse('1'.repeat(21)))).toEqual([
      'ACCOUNT_NUMBER_INVALID',
    ]);
  });

  it('code de journal : majuscules et chiffres', () => {
    expect(AccountingJournalCode.parse('T01')).toBe('T01');
    expect(codes(AccountingJournalCode.safeParse('ve'))).toEqual(['JOURNAL_CODE_INVALID']);
  });

  it('montant : chaîne, strictement positif, deux décimales', () => {
    expect(AccountingAmount.parse('1250.5')).toBe('1250.50');
    expect(AccountingAmount.parse('007')).toBe('7.00');
    expect(codes(AccountingAmount.safeParse(12.5))).toEqual(['DECIMAL_MUST_BE_STRING']);
    expect(codes(AccountingAmount.safeParse('0.00'))).toEqual(['AMOUNT_ZERO']);
    expect(codes(AccountingAmount.safeParse('-1'))).toEqual(['INVALID_AMOUNT']);
    expect(codes(AccountingAmount.safeParse('1.234'))).toEqual(['INVALID_AMOUNT']);
    expect(codes(AccountingAmount.safeParse(undefined))).toEqual(['FIELD_REQUIRED']);
  });

  it('taux : chaîne, strictement positif, dix décimales', () => {
    expect(AccountingRate.parse('2800')).toBe('2800.0000000000');
    expect(codes(AccountingRate.safeParse('0'))).toEqual(['AMOUNT_ZERO']);
    expect(canonicalAccountingDecimal('1.5', 0)).toBeNull();
  });

  it('réouverture : motif obligatoire, corps strict', () => {
    expect(AccountingReopenSchema.parse({ reason: '  erreur de date  ' })).toEqual({
      reason: 'erreur de date',
    });
    expect(codes(AccountingReopenSchema.safeParse({ reason: '   ' }))).toEqual(['FIELD_REQUIRED']);
    expect(AccountingReopenSchema.safeParse({ reason: 'x', extra: 1 }).success).toBe(false);
  });
});
