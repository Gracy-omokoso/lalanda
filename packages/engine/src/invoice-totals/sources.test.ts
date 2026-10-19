// Tests verrous de lecture des sources (ADR-0022, critères D3).
//
// - Aucun `number` JavaScript dans les calculs : seuls `decimalToJsonNumber`,
//   `decimalFromJsonNumber` et `isValidDecimal` (bloc « frontière JSON » de
//   `edef-shape.ts`) et `decimalFromJsonRate` (bloc « frontière JSON » de
//   `conversion.ts`, ADR-0023) en manipulent.
// - Aucun import hors du module : ni `apps/`, ni Mongo, ni Nest, ni réseau ;
//   aucune horloge.

import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const DIR = new URL('./', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, DIR), 'utf8');

const TOKENS =
  /\/\*[\s\S]*?\*\/|\/\/.*$|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/gm;

/** Retire les commentaires (les explications citent « number » et « 0,1 + 0,2 »). */
function code(source: string): string {
  return source.replace(TOKENS, (token) => (token.startsWith('/') ? '' : token));
}

/** Retire aussi le contenu des chaînes (messages affichables : « 464.00 »). */
function bareCode(source: string): string {
  return source.replace(TOKENS, (token) => (token.startsWith('/') ? '' : "''"));
}

const BOUNDARY_START = '// ── frontière JSON : début';
const BOUNDARY_END = '// ── frontière JSON : fin';

function withoutJsonBoundary(source: string): string {
  const start = source.indexOf(BOUNDARY_START);
  const end = source.indexOf(BOUNDARY_END);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(0, start) + source.slice(end);
}

/**
 * Les signatures de `credit-notes.ts` figées par le jalon E0 typent les positions de
 * ligne (`lineIndex: number`, `originLineIndex: number`) : ce sont des index, pas des
 * montants. Elles seules sont neutralisées avant la recherche.
 */
function withoutFrozenIndexTypes(source: string): string {
  return source.replace(/\b(lineIndex|originLineIndex): number\b/g, '$1: Index');
}

const FLOAT_PATTERNS: readonly [string, RegExp][] = [
  ['type number', /\bnumber\b/],
  ['Number', /\bNumber\b/],
  ['parseFloat', /\bparseFloat\b/],
  ['parseInt', /\bparseInt\b/],
  ['Math', /\bMath\./],
  ['toFixed', /\.toFixed\(/],
  ['littéral décimal', /(?<![\w.'"`])\d+\.\d+(?![\w'"`])/],
];

describe('aucun number dans les calculs', () => {
  const sources: Record<string, string> = {
    'decimal.ts': read('decimal.ts'),
    'compute.ts': read('compute.ts'),
    'currency.ts': read('currency.ts'),
    'pricing.ts': read('pricing.ts'),
    'edef-shape.ts (hors frontière JSON)': withoutJsonBoundary(read('edef-shape.ts')),
    // ADR-0023 (chantier E1).
    'payments.ts': read('payments.ts'),
    'conversion.ts (hors frontière JSON)': withoutJsonBoundary(read('conversion.ts')),
    'credit-notes.ts (hors signatures figées)': withoutFrozenIndexTypes(read('credit-notes.ts')),
    'check-reference-cases.ts': read('check-reference-cases.ts'),
  };

  for (const [file, source] of Object.entries(sources)) {
    it(file, () => {
      const stripped = bareCode(source);
      for (const [label, pattern] of FLOAT_PATTERNS) {
        expect(pattern.test(stripped), `${file} : ${label}`).toBe(false);
      }
    });
  }

  it('la frontière JSON de conversion.ts ne contient que decimalFromJsonRate', () => {
    const source = read('conversion.ts');
    const boundary = source.slice(source.indexOf(BOUNDARY_START), source.indexOf(BOUNDARY_END));
    expect([...boundary.matchAll(/\bfunction (\w+)/g)].map((m) => m[1])).toEqual([
      'decimalFromJsonRate',
    ]);
  });

  it('la frontière JSON contient bien les trois fonctions, et elles seules', () => {
    const source = read('edef-shape.ts');
    const boundary = source.slice(source.indexOf(BOUNDARY_START), source.indexOf(BOUNDARY_END));
    const exported = [...boundary.matchAll(/export function (\w+)/g)].map((m) => m[1]);
    expect(exported).toEqual(['isValidDecimal', 'decimalFromJsonNumber', 'decimalToJsonNumber']);
  });

  it('le verrou détecte bien un number (contrôle du contrôle)', () => {
    const hit = (text: string) => FLOAT_PATTERNS.some(([, p]) => p.test(bareCode(text)));
    expect(hit('const x: number = 1;')).toBe(true);
    expect(hit('const y = 0.5;')).toBe(true);
    expect(hit('const n = Number(s);')).toBe(true);
    expect(hit("const z = '0.5 number'; // 0.5 number")).toBe(false);
    expect(hit('const m = "n\'y a pas 1.5"; /* Number */')).toBe(false);
  });
});

describe('dépendances du module invoice-totals', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('liste les fichiers attendus', () => {
    expect(files.sort()).toEqual([
      'check-reference-cases.ts',
      'compute.ts',
      'conversion.ts',
      'credit-notes.ts',
      'currency.ts',
      'decimal.ts',
      'edef-shape.ts',
      'index.ts',
      'invoice-checks.types.ts',
      'payments.ts',
      'pricing.ts',
      'reference-cases.ts',
      // ADR-0024 § 7.3 (jalon F0).
      'rounding-calibration.ts',
      'tax-groups.ts',
      'types.ts',
    ]);
  });

  for (const file of files) {
    it(`${file} n'importe que des fichiers du module, sans horloge ni réseau`, () => {
      const stripped = code(read(file));
      const specifiers = [...stripped.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const specifier of specifiers) {
        // Le point est admis dans le nom (`invoice-checks.types.js`, ADR-0023), pas le `/`.
        expect(specifier, `${file} : ${specifier}`).toMatch(/^\.\/[\w.-]+\.js$/);
      }
      expect(/\bimport\s*\(|\brequire\s*\(/.test(stripped), `${file} : import dynamique`).toBe(
        false,
      );
      for (const forbidden of [/\bDate\b/, /\bfetch\b/, /\bprocess\./, /\bperformance\./]) {
        expect(forbidden.test(stripped), `${file} : ${forbidden.source}`).toBe(false);
      }
    });
  }

  it('decimal.ts reste interne : le barrel ne le réexporte pas', () => {
    expect(read('index.ts')).not.toMatch(/decimal\.js/);
  });
});
