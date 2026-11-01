// Lecture d'un pack de plan comptable, identité et empreinte — ADR-0049 § 2.1, § 12 (lot K1).

import { createHash } from 'node:crypto';

import { parse as parseYaml, YAMLParseError } from 'yaml';

import { ChartPackSchema, type ChartPack } from './schema.js';
import { validateChartPack, type ChartPackIssue } from './validate.js';

export type ChartPackErrorCode = 'CHART_PACK_PARSE_ERROR' | 'CHART_PACK_INVALID';

export class ChartPackError extends Error {
  readonly code: ChartPackErrorCode;
  readonly issues: ChartPackIssue[];

  constructor(code: ChartPackErrorCode, message: string, issues: ChartPackIssue[] = []) {
    super(message);
    this.name = 'ChartPackError';
    this.code = code;
    this.issues = issues;
  }
}

/**
 * Lit un YAML de pack de plan comptable : forme (schéma) puis cohérence
 * (`validateChartPack`). Lève `ChartPackError` au premier défaut de forme, ou avec la
 * liste complète des défauts de cohérence.
 */
export function parseChartPack(yaml: string): ChartPack {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (err) {
    const message = err instanceof YAMLParseError ? err.message : String(err);
    throw new ChartPackError('CHART_PACK_PARSE_ERROR', `YAML invalide : ${message}`);
  }
  if (raw === null || raw === undefined) {
    throw new ChartPackError('CHART_PACK_PARSE_ERROR', 'YAML vide');
  }

  const result = ChartPackSchema.safeParse(raw);
  if (!result.success) {
    const issues: ChartPackIssue[] = result.error.issues.map((i) => ({
      code: 'SCHEMA',
      path: i.path.join('.') || '<racine>',
      message: i.message,
    }));
    throw new ChartPackError(
      'CHART_PACK_INVALID',
      `Pack de plan comptable invalide :\n${issues.map((i) => `  - ${i.path} : ${i.message}`).join('\n')}`,
      issues,
    );
  }

  const issues = validateChartPack(result.data);
  if (issues.length > 0) {
    throw new ChartPackError(
      'CHART_PACK_INVALID',
      `Pack de plan comptable incohérent :\n${issues.map((i) => `  - ${i.code} ${i.path} : ${i.message}`).join('\n')}`,
      issues,
    );
  }
  return result.data;
}

/** Identité stable d'un pack : `slug@version` (unique `slug + version`, ADR-0049 § 2.1). */
export function chartPackId(pack: Pick<ChartPack, 'slug' | 'version'>): string {
  return `${pack.slug}@${pack.version}`;
}

/** JSON canonique : clés triées, sans espace ; l'ordre des tableaux est significatif. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Empreinte SHA-256 (hexadécimale) du contenu d'un pack lu. Indépendante de la mise en
 * forme du YAML (commentaires, ordre des clés) ; change dès qu'un numéro, un libellé, un
 * statut ou une source change. Une version `active` étant immuable (docs/09), son
 * empreinte ne doit jamais varier : l'API (K4) peut la retenir au chargement.
 */
export function chartPackFingerprint(pack: ChartPack): string {
  return createHash('sha256').update(canonicalJson(pack), 'utf8').digest('hex');
}
