// Tests du pack de plan comptable — ADR-0049 critère 17 (lot K1).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import {
  ChartPackError,
  ChartPackSchema,
  TO_CONFIRM_MENTION,
  chartPackFingerprint,
  chartPackId,
  parseChartPack,
  validateChartPack,
  type ChartPack,
} from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = resolve(__dirname, '../packs');
const V1_FILE = resolve(PACKS_DIR, 'syscohada-revise-2017-cd-v1.yaml');
const REVIEW_DOC = resolve(
  __dirname,
  '../../../../../docs/comptabilite/relecture-pack-syscohada-v1.md',
);

const v1Yaml = readFileSync(V1_FILE, 'utf8');

/** Copie modifiable du pack v1, sous forme brute (avant lecture). */
function rawV1(): Record<string, unknown> & ChartPack {
  return parseYaml(v1Yaml) as Record<string, unknown> & ChartPack;
}

function codesOf(pack: unknown): string[] {
  return validateChartPack(ChartPackSchema.parse(pack)).map((i) => i.code);
}

function expectRejected(pack: unknown, code: string): void {
  let caught: unknown;
  try {
    parseChartPack(stringifyYaml(pack));
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ChartPackError);
  expect((caught as ChartPackError).issues.map((i) => i.code)).toContain(code);
}

describe('pack v1 syscohada-revise-2017-cd — contenu', () => {
  const pack = parseChartPack(v1Yaml);

  it('se lit sans défaut, au statut draft, identité slug@version', () => {
    expect(validateChartPack(pack)).toEqual([]);
    expect(pack.status).toBe('draft');
    expect(pack.framework).toBe('syscohada-revise-2017');
    expect(pack.countries).toEqual(['CD']);
    expect(chartPackId(pack)).toBe('syscohada-revise-2017-cd@1');
  });

  it('le nom du fichier porte le slug et la version', () => {
    for (const file of readdirSync(PACKS_DIR).filter((f) => f.endsWith('.yaml'))) {
      const p = parseChartPack(readFileSync(join(PACKS_DIR, file), 'utf8'));
      expect(file).toBe(`${p.slug}-v${p.version}.yaml`);
    }
  });

  it('neuf classes, toutes to_confirm, sourcées AUDCIF, avec la mention', () => {
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
    for (const c of pack.classes) {
      expect(c.confirmation).toBe('to_confirm');
      expect(c.sourceId).toBe('audcif-2017');
      expect(c.note).toContain(TO_CONFIRM_MENTION);
    }
  });

  it("exactement les dix candidats de l'ADR-0049 § 2.1.1, tous to_confirm", () => {
    expect(pack.accounts.map((a) => a.number).sort()).toEqual(
      ['401', '411', '4431', '4452', '521', '571', '585', '601', '701', '706'].sort(),
    );
    for (const a of pack.accounts) {
      expect(a.confirmation).toBe('to_confirm');
      expect(a.sourceId).toBe('audcif-2017');
      expect(a.note).toContain(TO_CONFIRM_MENTION);
      expect(a.nature).toBeNull();
    }
  });

  it("aucun numéro pour les comptes « à fournir par l'expert » : ils sont attendus", () => {
    expect(pack.expectedAccounts.map((e) => e.id)).toEqual([
      'mobile_money',
      'suspense',
      'expense_categories',
      'income_tax',
      'fixed_assets',
      'borrowings',
      'result_and_retained_earnings',
      'exchange_differences',
    ]);
  });

  it('ni règle proposée ni modèle d’état tant que l’expert n’a pas répondu', () => {
    expect(pack.proposedRules).toEqual([]);
    expect(pack.statementTemplates).toEqual({
      balanceSheet: null,
      incomeStatement: null,
      cashFlow: null,
    });
    expect(pack.review).toBeNull();
  });

  it('la source AUDCIF est déclarée non vérifiée', () => {
    const [src] = pack.sources;
    expect(src?.id).toBe('audcif-2017');
    expect(src?.adoptedOn).toBe('2017-01-26');
    expect(src?.verifiedOn).toBeNull();
    expect(src?.verifiedBy).toBeNull();
  });
});

describe('validateChartPack — refus d’un pack incohérent', () => {
  it('refuse un pack approved contenant un to_confirm (critère 17)', () => {
    const p = rawV1();
    p.status = 'approved';
    const codes = codesOf(p);
    expect(codes).toContain('APPROVED_WITH_TO_CONFIRM');
    expect(codes).toContain('APPROVED_WITHOUT_REVIEW');
    expect(codes).toContain('APPROVED_WITH_EXPECTED_ACCOUNTS');
    expect(codes).toContain('APPROVED_WITHOUT_NATURE');
    expect(codes).toContain('APPROVED_WITH_UNVERIFIED_SOURCE');
    expectRejected(p, 'APPROVED_WITH_TO_CONFIRM');
  });

  it('refuse aussi un pack active ou retired incomplet', () => {
    for (const status of ['active', 'retired'] as const) {
      const p = rawV1();
      p.status = status;
      expect(codesOf(p)).toContain('APPROVED_WITH_TO_CONFIRM');
    }
  });

  it('admet un pack review incomplet (relecture en cours)', () => {
    const p = rawV1();
    p.status = 'review';
    expect(codesOf(p)).toEqual([]);
  });

  it('refuse un compte sourced sans source (critère 17)', () => {
    const p = rawV1();
    p.accounts[0]!.confirmation = 'sourced';
    p.accounts[0]!.sourceId = null;
    expectRejected(p, 'SOURCED_WITHOUT_SOURCE');
  });

  it('refuse une source inconnue', () => {
    const p = rawV1();
    p.classes[0]!.sourceId = 'inconnue';
    expectRejected(p, 'UNKNOWN_SOURCE');
  });

  it("refuse un élément to_confirm sans la mention « à confirmer par l'expert-comptable »", () => {
    const p = rawV1();
    p.accounts[1]!.note = 'candidat';
    expectRejected(p, 'TO_CONFIRM_WITHOUT_MENTION');
  });

  it('refuse un numéro de compte en double', () => {
    const p = rawV1();
    p.accounts.push({ ...p.accounts[0]! });
    expectRejected(p, 'DUPLICATE_ACCOUNT');
  });

  it('refuse une classe en double', () => {
    const p = rawV1();
    p.classes.push({ ...p.classes[0]! });
    expectRejected(p, 'DUPLICATE_CLASS');
  });

  it('refuse un compte hors de sa classe ou rattaché à une classe inconnue', () => {
    const p = rawV1();
    p.accounts[0]!.classNumber = '5';
    expectRejected(p, 'ACCOUNT_OUTSIDE_CLASS');

    const q = rawV1();
    q.classes = q.classes.filter((c) => c.number !== '7');
    expectRejected(q, 'UNKNOWN_CLASS');
  });

  it('refuse un parent inconnu ou qui n’est pas un préfixe', () => {
    const p = rawV1();
    p.accounts[0]!.parent = '999';
    expectRejected(p, 'UNKNOWN_PARENT');

    const q = rawV1();
    const [first, second] = q.accounts;
    first!.parent = second!.number;
    expectRejected(q, 'PARENT_NOT_PREFIX');
  });

  it('refuse un compte auxiliaire sur un compte non collectif', () => {
    const p = rawV1();
    p.accounts[0]!.collective = false;
    expectRejected(p, 'AUXILIARY_NOT_COLLECTIVE');
  });

  it('refuse une règle qui vise un compte absent du pack ou n’a pas de ligne', () => {
    const p = rawV1();
    p.proposedRules = [
      {
        key: 'transfer.internal',
        debit: ['000'],
        credit: ['{treasuryAccount}'],
        requiresReview: true,
        confirmation: 'to_confirm',
        sourceId: null,
        note: TO_CONFIRM_MENTION,
      },
    ];
    expectRejected(p, 'UNKNOWN_ACCOUNT_IN_RULE');

    p.proposedRules[0]!.debit = [];
    expectRejected(p, 'RULE_WITHOUT_LINES');
  });

  it('refuse une rubrique d’état qui ne correspond à aucun compte', () => {
    const p = rawV1();
    p.statementTemplates.incomeStatement = [
      {
        code: 'essai',
        label: 'Essai',
        accountPrefixes: ['0'],
        confirmation: 'to_confirm',
        sourceId: null,
        note: TO_CONFIRM_MENTION,
      },
    ];
    expectRejected(p, 'UNKNOWN_ACCOUNT_IN_TEMPLATE');
  });

  it('refuse la forme : numéro non numérique, statut inconnu, clé inconnue, YAML vide ou cassé', () => {
    const bad = rawV1();
    bad.accounts[0]!.number = '41A';
    expect(() => parseChartPack(stringifyYaml(bad))).toThrow(ChartPackError);

    const status = rawV1() as Record<string, unknown>;
    status['status'] = 'published';
    expect(() => parseChartPack(stringifyYaml(status))).toThrow(/status/);

    const extra = rawV1() as Record<string, unknown>;
    extra['taux'] = 0.16;
    expect(() => parseChartPack(stringifyYaml(extra))).toThrow(ChartPackError);

    expect(() => parseChartPack('')).toThrow(/YAML vide/);
    expect(() => parseChartPack('slug: [')).toThrow(/YAML invalide/);
  });

  it('un numéro YAML non cité (nombre) est refusé : les zéros de tête comptent', () => {
    const yaml = v1Yaml.replace("number: '411'", 'number: 411');
    expect(() => parseChartPack(yaml)).toThrow(ChartPackError);
  });
});

describe('empreinte et version', () => {
  const pack = parseChartPack(v1Yaml);
  const fp = chartPackFingerprint(pack);

  it('est un SHA-256 hexadécimal, stable d’un appel à l’autre', () => {
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(chartPackFingerprint(parseChartPack(v1Yaml))).toBe(fp);
  });

  it('ne dépend ni des commentaires ni de l’ordre des clés du YAML', () => {
    const raw = rawV1();
    const reordered = Object.fromEntries(Object.entries(raw).reverse());
    const yaml = `# autre commentaire\n${stringifyYaml(reordered)}`;
    expect(chartPackFingerprint(parseChartPack(yaml))).toBe(fp);
  });

  it('change dès qu’un libellé, un statut, une version ou une source change', () => {
    const label = rawV1();
    label.accounts[0]!.label = 'Clients — essai';
    expect(chartPackFingerprint(parseChartPack(stringifyYaml(label)))).not.toBe(fp);

    const status = rawV1();
    status.status = 'review';
    expect(chartPackFingerprint(parseChartPack(stringifyYaml(status)))).not.toBe(fp);

    const version = rawV1();
    version.version = 2;
    const v2 = parseChartPack(stringifyYaml(version));
    expect(chartPackId(v2)).toBe('syscohada-revise-2017-cd@2');
    expect(chartPackFingerprint(v2)).not.toBe(fp);

    const source = rawV1();
    source.sources[0]!.reference = 'JO OHADA — à préciser';
    expect(chartPackFingerprint(parseChartPack(stringifyYaml(source)))).not.toBe(fp);
  });

  it('refuse une version nulle, négative ou décimale', () => {
    for (const v of [0, -1, 1.5]) {
      const p = rawV1();
      p.version = v;
      expect(() => parseChartPack(stringifyYaml(p))).toThrow(ChartPackError);
    }
  });
});

describe('aucun numéro de compte dans le code (critère 17, analyse statique)', () => {
  const pack = parseChartPack(v1Yaml);
  const numbers = pack.accounts.map((a) => a.number);

  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return tsFiles(full);
      return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
    });
  }

  it('aucun fichier TypeScript de accounting/ hors tests ne cite un numéro du pack', () => {
    const files = tsFiles(resolve(__dirname, '..'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const n of numbers) {
        expect(src, `${file} cite le compte ${n}`).not.toMatch(new RegExp(`['"\`]${n}\\d*['"\`]`));
      }
    }
  });
});

describe('document de relecture pour l’expert-comptable', () => {
  const pack = parseChartPack(v1Yaml);
  const doc = readFileSync(REVIEW_DOC, 'utf8');

  it('liste chaque classe, chaque compte candidat et chaque compte attendu du pack', () => {
    for (const c of pack.classes) expect(doc).toContain(`| ${c.number} | ${c.label} |`);
    for (const a of pack.accounts) expect(doc).toContain(`| ${a.number} | ${a.label} |`);
    for (const e of pack.expectedAccounts) expect(doc).toContain(e.need);
  });

  it('cite la version et l’empreinte du pack relu', () => {
    expect(doc).toContain(chartPackId(pack));
    expect(doc).toContain(chartPackFingerprint(pack));
  });
});
