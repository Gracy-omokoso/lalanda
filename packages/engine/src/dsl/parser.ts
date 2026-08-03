// Parseur YAML → Template validé.

import { parse as parseYaml, YAMLParseError } from 'yaml';

import { EngineError } from './errors.js';
import { TemplateSchema, type Template } from './schema.js';

/**
 * Parse une chaîne YAML et valide qu'elle constitue un Template Lalanda.
 * Lève {@link EngineError} avec code `DSL_PARSE_ERROR` (YAML invalide)
 * ou `DSL_SCHEMA_ERROR` (structure non conforme).
 */
export function parseTemplate(yaml: string): Template {
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

  const result = TemplateSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new EngineError('DSL_SCHEMA_ERROR', `Template invalide :\n${issues}`, {
      issues: result.error.issues,
    });
  }

  return result.data;
}
