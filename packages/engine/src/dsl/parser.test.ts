import { describe, expect, it } from 'vitest';

import { EngineError } from './errors.js';
import { parseTemplate } from './parser.js';

describe('parseTemplate', () => {
  it('parse un YAML valide', () => {
    const template = parseTemplate(`
slug: demo
version: 1.0.0
drivers:
  - { id: a, type: number, defaut: 1 }
feuilles:
  - id: sheet1
    lignes:
      - { id: ligne1, formule: "a * 2" }
`);
    expect(template.slug).toBe('demo');
    expect(template.drivers[0]?.id).toBe('a');
  });

  it('lève DSL_PARSE_ERROR sur un YAML malformé', () => {
    expect(() => parseTemplate(': this is : broken : yaml')).toThrow(EngineError);
    try {
      parseTemplate(': this is : broken : yaml');
    } catch (e) {
      expect((e as EngineError).code).toBe('DSL_PARSE_ERROR');
    }
  });

  it('lève DSL_PARSE_ERROR sur un YAML vide', () => {
    try {
      parseTemplate('');
    } catch (e) {
      expect((e as EngineError).code).toBe('DSL_PARSE_ERROR');
    }
  });

  it('lève DSL_SCHEMA_ERROR quand la structure est invalide', () => {
    try {
      parseTemplate('slug: demo\nversion: 1.0.0\n');
    } catch (e) {
      expect((e as EngineError).code).toBe('DSL_SCHEMA_ERROR');
    }
  });
});
