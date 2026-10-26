// Lecture des sources de la normalisation — ADR-0024 § 4.2 et § 4.3 (verrou).
//
// 1. Un SEUL écrivain du statut « facture normalisée » : `normalization-recorder.ts`.
// 2. Seul le gel ordinaire produit `issued`.
// 3. L'ordonnanceur (rattrapage, rafraîchissement, cohérence) n'envoie JAMAIS
//    de `POST` ni de `confirm`.
// 4. Seul l'enregistreur détient le modèle `SalesInvoice` dans ce dossier.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ICI = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(ICI, '../..');

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) out.push(...(await sources(p)));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

async function filesMatching(pattern: RegExp, dir = SRC): Promise<string[]> {
  const hits: string[] = [];
  for (const f of await sources(dir)) {
    if (pattern.test(await readFile(f, 'utf8'))) hits.push(relative(SRC, f));
  }
  return hits.sort();
}

describe('normalisation — lecture des sources', () => {
  it('seul normalization-recorder.ts écrit le statut « normalized »', async () => {
    expect(await filesMatching(/status:\s*['"]normalized['"]/)).toEqual([
      'sales/normalization/normalization-recorder.ts',
    ]);
  });

  it('seul le gel ordinaire produit « issued »', async () => {
    expect(await filesMatching(/status:\s*['"]issued['"]/)).toEqual([]);
    expect(await filesMatching(/route === 'issue' \? 'issued'/)).toEqual([
      'sales/invoices/invoice-freezing.service.ts',
    ]);
  });

  it('les tâches planifiées n’envoient jamais de POST ni de confirm', async () => {
    for (const file of [
      'reconciliation.job.ts',
      'reference-refresh.job.ts',
      'consistency.job.ts',
      'alerts.job.ts',
    ]) {
      const text = await readFile(resolve(ICI, file), 'utf8');
      expect(text, file).not.toMatch(/submitInvoice|confirmInvoice/);
    }
  });

  it('dans sales/normalization, seul l’enregistreur détient le modèle SalesInvoice', async () => {
    expect(await filesMatching(/InjectModel\(SalesInvoice\.name\)/, ICI)).toEqual([
      'sales/normalization/normalization-recorder.ts',
    ]);
  });
});
