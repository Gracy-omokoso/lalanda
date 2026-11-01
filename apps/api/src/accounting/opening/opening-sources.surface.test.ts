// La reprise LIT les pièces des modules sources, elle ne les écrit jamais
// (ADR-0049 § 3.2, règle « aucune ligne des modules sources ne change »). ADR-0049 — K7.

import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ICI = dirname(fileURLToPath(import.meta.url));

describe('reprise de l’existant — surface en lecture seule', () => {
  it('aucun fichier du lot n’appelle une méthode d’écriture sur une collection source', async () => {
    const files = (await readdir(ICI)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const code = await readFile(resolve(ICI, f), 'utf8');
      expect(code, f).not.toMatch(
        /collection\([^)]*\)\s*\.\s*(insert|update|delete|replace|findOneAnd|bulkWrite)/,
      );
      expect(code, f).not.toMatch(/actual_periods|ActualPeriod/);
    }
  });

  it('le lecteur des pièces ne fait que des `find`, toujours par organisation', async () => {
    const code = await readFile(resolve(ICI, 'opening-sources.ts'), 'utf8');
    const calls = code.match(/\.collection\([^)]*\)\s*\.\s*(\w+)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.replace(/\s/g, '')).toMatch(/\.find$/);
    expect(code).toMatch(/\{ \.\.\.filter, organizationId \}/);
  });
});
