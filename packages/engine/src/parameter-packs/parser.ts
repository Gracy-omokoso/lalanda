// Parseur YAML → ParameterPack validé.

import { parse as parseYaml, YAMLParseError } from 'yaml';

import { EngineError } from '../dsl/errors.js';
import { ParameterPackSchema, type ParameterPack } from './schema.js';

/**
 * Parse un YAML de ParameterPack et le valide. Lève un `EngineError` avec code
 * `DSL_PARSE_ERROR` (YAML invalide) ou `DSL_SCHEMA_ERROR` (structure non conforme) —
 * on réutilise les codes du DSL pour cohérence côté API.
 */
export function parseParameterPack(yaml: string): ParameterPack {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (err) {
    const message = err instanceof YAMLParseError ? err.message : String(err);
    throw new EngineError('DSL_PARSE_ERROR', `YAML invalide : ${message}`);
  }
  if (raw === null || raw === undefined) {
    throw new EngineError('DSL_PARSE_ERROR', 'YAML vide');
  }
  const result = ParameterPackSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new EngineError('DSL_SCHEMA_ERROR', `ParameterPack invalide :\n${issues}`, {
      issues: result.error.issues,
    });
  }
  return result.data;
}
