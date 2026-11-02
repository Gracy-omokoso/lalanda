// Pack v2 (SYSCOHADA révisé, RDC) et jeu de règles par défaut — ADR-0049, amendement du
// 3 nov. 2026 (décision de la dirigeante). Le v1 reste `draft`, inchangé.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { RECEIPT_METHODS } from '../../receivables/types.js';
import { EXPENSE_CATEGORY_CODES } from '../../treasury/types.js';
import { TAX_GROUP_LETTERS } from '../../invoice-totals/types.js';
import { entriesForSalesInvoice } from '../entries/index.js';
import { context, invoiceBC } from '../entries/fixtures.test.js';
import { ACCOUNTING_NON_REVENUE_TAX_GROUPS, isOperationKey } from '../rules/index.js';
import { findForbiddenWords } from '../statements/wording.js';
import type { MappingRuleSet } from '../types.js';
import {
  ChartPackError,
  ChartPackSchema,
  RULE_TOKENS,
  chartPackFingerprint,
  chartPackId,
  parseChartPack,
  validateChartPack,
  type ChartPack,
} from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = resolve(__dirname, '../packs');
const V2_FILE = resolve(PACKS_DIR, 'syscohada-revise-2017-cd-v2.yaml');
const REVIEW_DOC = resolve(
  __dirname,
  '../../../../../docs/comptabilite/relecture-pack-syscohada-v2.md',
);
const DECISION = "décision de la dirigeante du 3 nov. 2026, à revoir avec l'expert-comptable";

const v2Yaml = readFileSync(V2_FILE, 'utf8');
const pack = parseChartPack(v2Yaml);
const rawV2 = (): Record<string, unknown> & ChartPack =>
  parseYaml(v2Yaml) as Record<string, unknown> & ChartPack;

/** Jeu de règles par défaut tel que l'organisation le reçoit, puis le valide. */
function defaultRuleSet(): MappingRuleSet {
  return {
    version: 1,
    status: 'validated',
    rules: pack.proposedRules.map((r) => ({
      key: r.key,
      debit: [...r.debit],
      credit: [...r.credit],
      requiresReview: r.requiresReview,
    })),
  };
}

describe('pack v2 syscohada-revise-2017-cd — contenu', () => {
  it('se lit sans défaut au statut approved, identité slug@2', () => {
    expect(validateChartPack(pack)).toEqual([]);
    expect(pack.status).toBe('approved');
    expect(chartPackId(pack)).toBe('syscohada-revise-2017-cd@2');
    expect(pack.expectedAccounts).toEqual([]);
    expect(pack.review?.reviewedOn).toBe('2026-11-03');
    expect(pack.review?.reportDocumentKey).toBe('docs/comptabilite/relecture-pack-syscohada-v2.md');
  });

  it('neuf classes et chaque compte : source AUDCIF, sourced, note de la décision', () => {
    expect(pack.classes.map((c) => c.number)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ]);
    for (const item of [...pack.classes, ...pack.accounts]) {
      expect(item.sourceId).toBe('audcif-2017');
      expect(item.confirmation).toBe('sourced');
      expect(item.note?.toLowerCase()).toContain(DECISION);
    }
    for (const a of pack.accounts) expect(a.nature).not.toBeNull();
  });

  it('contient les comptes principaux demandés par la décision', () => {
    const numbers = new Set(pack.accounts.map((a) => a.number));
    for (const n of [
      '101',
      '109',
      '111',
      '112',
      '118',
      '121',
      '129',
      '131',
      '139',
      '401',
      '4091',
      '411',
      '4191',
      '421',
      '422',
      '4431',
      '4452',
      '4454',
      '4441',
      '471',
      '521',
      '571',
      '585',
      '601',
      '604',
      '605',
      '701',
      '706',
      '707',
    ]) {
      expect(numbers.has(n), n).toBe(true);
    }
    // Écartés par doute (document de relecture v2) : jamais dans le pack.
    for (const n of ['676', '776', '656', '756', '552', '634'])
      expect(numbers.has(n), n).toBe(false);
  });

  it('un collectif clients (411) et un collectif fournisseurs (401), seuls de leur nature', () => {
    const collective = pack.accounts.filter((a) => a.collective);
    expect(collective.map((a) => [a.number, a.auxiliaryKind])).toEqual([
      ['401', 'supplier'],
      ['411', 'customer'],
    ]);
  });

  it('désigne 471 comme compte d’attente', () => {
    expect(pack.suspenseAccount).toBe('471');
  });

  it('modèles du bilan et du compte de résultat ; tableau des flux non fourni', () => {
    expect(pack.statementTemplates.balanceSheet?.length).toBeGreaterThan(5);
    expect(pack.statementTemplates.incomeStatement?.length).toBeGreaterThan(5);
    expect(pack.statementTemplates.cashFlow).toBeNull();
    const all = [
      ...(pack.statementTemplates.balanceSheet ?? []),
      ...(pack.statementTemplates.incomeStatement ?? []),
    ];
    for (const r of all) expect(r.note?.toLowerCase()).toContain(DECISION);
  });

  it('aucun mot interdit dans le pack', () => {
    expect(findForbiddenWords(v2Yaml)).toEqual([]);
  });
});

describe('jeu de règles par défaut v1 (pack v2)', () => {
  const tokens = new Set<string>(RULE_TOKENS);
  const numbers = new Set(pack.accounts.map((a) => a.number));
  const byKey = new Map(pack.proposedRules.map((r) => [r.key, r]));

  it('chaque règle vise une clé du catalogue et un compte du pack ou un jeton', () => {
    for (const r of pack.proposedRules) {
      expect(isOperationKey(r.key), r.key).toBe(true);
      for (const ref of [...r.debit, ...r.credit]) {
        expect(tokens.has(ref) || numbers.has(ref), `${r.key} → ${ref}`).toBe(true);
      }
      expect(r.note?.toLowerCase()).toContain(DECISION);
    }
  });

  it('une règle « à revoir » pointe vers le compte d’attente et dit son motif', () => {
    for (const r of pack.proposedRules.filter((x) => x.requiresReview)) {
      expect(r.debit).toEqual(['471']);
      expect(r.note).toMatch(/motif : /);
    }
  });

  it('couvre chaque clé connue des ventes, encaissements et dépenses', () => {
    const keys: string[] = [];
    for (const p of ['sale.invoice', 'sale.deposit', 'sale.credit_note']) {
      keys.push(`${p}.receivable`);
      for (const g of TAX_GROUP_LETTERS) {
        keys.push(`${p}.vat.${g}`, `${p}.nonrevenue.${g}`);
        if (!(ACCOUNTING_NON_REVENUE_TAX_GROUPS as readonly string[]).includes(g)) {
          keys.push(`${p}.revenue.BIE.${g}`, `${p}.revenue.SER.${g}`);
        }
      }
    }
    for (const m of RECEIPT_METHODS) keys.push(`receipt.${m}`, `sale.payment_at_issue.${m}`);
    for (const c of EXPENSE_CATEGORY_CODES) {
      keys.push(`expense.${c}`, `purchase.invoice.${c}`, `purchase.credit_note.${c}`);
    }
    keys.push(
      'receipt.receivable',
      'receipt.unallocated',
      'expense.payment',
      'expense.vat_declared',
      'purchase.payment.payable',
      'purchase.payment.unallocated',
      'transfer.treasury',
      'transfer.internal',
      'exchange.difference',
      'hr.advance.settled',
      'hr.advance.disbursed',
      'hr.advance.returned',
    );
    for (const k of keys) expect(byKey.has(k), k).toBe(true);
  });

  it('correspondances de la décision : ventes, acomptes, avances, virements', () => {
    const credit = (k: string): string | undefined => byKey.get(k)?.credit[0];
    expect(credit('sale.invoice.revenue.SER.B')).toBe('706');
    expect(credit('sale.invoice.revenue.BIE.B')).toBe('701');
    expect(credit('sale.invoice.vat.B')).toBe('4431');
    expect(credit('sale.invoice.receivable')).toBe('{customer}');
    expect(credit('sale.deposit.revenue.SER.B')).toBe('4191');
    expect(credit('receipt.unallocated')).toBe('4191');
    expect(credit('purchase.payment.unallocated')).toBe('4091');
    expect(credit('hr.advance.settled')).toBe('421');
    expect(credit('transfer.internal')).toBe('585');
    expect(credit('expense.achats')).toBe('601');
    expect(byKey.get('exchange.difference')?.requiresReview).toBe(true);
    // Les écritures de stock restent éteintes (question E4) : aucune règle `stock.*`.
    expect(pack.proposedRules.some((r) => r.key.startsWith('stock.'))).toBe(false);
  });

  it('une facture de vente produit 411 / 706 / 4431, sans compte d’attente', () => {
    const r = entriesForSalesInvoice(
      invoiceBC({
        groups: [
          { group: 'B', ht: '100000.00', vat: '16000.00', total: '116000.00', specificTax: '0.00' },
        ],
        lines: [{ taxGroup: 'B', itemType: 'SER', amount: '100000.00' }],
        total: '116000.00',
        payments: [{ method: 'CREDIT', amount: '116000.00' }],
      }),
      context({
        ruleSet: defaultRuleSet(),
        suspenseAccount: '471',
        customerAccounts: { c1: { collectiveNumber: '411', auxiliaryNumber: '411C1' } },
      }),
    );
    const [e] = r.entries;
    expect(e?.suspense).toBe(false);
    expect(e?.lines.map((l) => [l.side, l.accountNumber, l.amount])).toEqual([
      ['debit', '411', '116000.00'],
      ['credit', '706', '100000.00'],
      ['credit', '4431', '16000.00'],
    ]);
  });
});

describe('validateChartPack — compte d’attente et clés des règles', () => {
  it('refuse un compte d’attente absent du pack', () => {
    const p = rawV2();
    p.suspenseAccount = '4799';
    expect(validateChartPack(ChartPackSchema.parse(p)).map((i) => i.code)).toContain(
      'UNKNOWN_SUSPENSE_ACCOUNT',
    );
  });

  it('refuse une règle dont la clé est inconnue du moteur', () => {
    const p = rawV2();
    p.proposedRules[0]!.key = 'sale.invoice.inconnue';
    let caught: unknown;
    try {
      parseChartPack(stringifyYaml(p));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ChartPackError);
    expect((caught as ChartPackError).issues.map((i) => i.code)).toContain(
      'UNKNOWN_OPERATION_KEY_IN_RULE',
    );
  });
});

describe('aucun numéro du pack v2 dans le code (analyse statique)', () => {
  const numbers = pack.accounts.map((a) => a.number).filter((n) => n.length >= 3);

  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return tsFiles(full);
      return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
    });
  }

  it('aucun fichier TypeScript de accounting/ hors tests ne cite un compte du pack v2', () => {
    for (const file of tsFiles(resolve(__dirname, '..'))) {
      const src = readFileSync(file, 'utf8');
      for (const n of numbers) {
        expect(src, `${file} cite le compte ${n}`).not.toMatch(new RegExp(`['"\`]${n}\\d*['"\`]`));
      }
    }
  });
});

describe('document de relecture v2', () => {
  const doc = readFileSync(REVIEW_DOC, 'utf8');

  it('liste chaque compte du pack, cite la version et l’empreinte', () => {
    for (const a of pack.accounts) expect(doc).toContain(`| ${a.number} | ${a.label} |`);
    expect(doc).toContain(chartPackId(pack));
    expect(doc).toContain(chartPackFingerprint(pack));
  });

  it('aucun mot interdit', () => {
    expect(findForbiddenWords(doc)).toEqual([]);
  });
});
