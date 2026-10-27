// Lecture des sources des documents de vente — ADR-0023 critères E2.
//
// 1. L'API ne fait AUCUNE opération sur un montant : ni `Number(`, ni
//    `parseFloat`, ni `Math.` dans `sales/invoices/**` (le moteur calcule).
// 2. Un seul écrivain par collection : compteurs (`InvoiceNumberingService`),
//    journal et têtes de journal (`InvoiceJournalService`) ; seuls les services
//    de brouillon, de gel et de numérotation écrivent `sales_invoices`.

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

async function filesMatching(pattern: RegExp): Promise<string[]> {
  const hits: string[] = [];
  for (const f of await sources(SRC)) {
    if (pattern.test(await readFile(f, 'utf8'))) hits.push(relative(SRC, f));
  }
  return hits.sort();
}

describe('documents de vente — lecture des sources', () => {
  it('aucune arithmétique de montant dans sales/invoices', async () => {
    const fautifs: string[] = [];
    for (const f of await sources(ICI)) {
      const text = (await readFile(f, 'utf8'))
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      if (/\bNumber\(|parseFloat|\bMath\./.test(text)) fautifs.push(relative(SRC, f));
    }
    expect(fautifs).toEqual([]);
  });

  it('aucune arithmétique de montant dans sales/documents (ADR-0025 : mise en forme seule)', async () => {
    const fautifs: string[] = [];
    for (const f of await sources(resolve(SRC, 'sales/documents'))) {
      const text = (await readFile(f, 'utf8'))
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      if (/\bNumber\(|parseFloat|parseInt|\bMath\./.test(text)) fautifs.push(relative(SRC, f));
    }
    expect(fautifs).toEqual([]);
  });

  it('compteurs : seul InvoiceNumberingService les écrit', async () => {
    expect(await filesMatching(/InjectModel\(SalesInvoiceCounter\.name\)/)).toEqual([
      'sales/invoices/invoice-numbering.service.ts',
    ]);
    expect(await filesMatching(/['"]sales_invoice_counters['"]/)).toEqual([
      'sales/invoices/invoice-counter.schema.ts',
    ]);
  });

  it('journal : seul InvoiceJournalService l’écrit, sans mise à jour ni suppression', async () => {
    expect(
      await filesMatching(/InjectModel\((SalesInvoiceJournalEntry|SalesJournalHead)\.name\)/),
    ).toEqual(['sales/invoices/invoice-journal.service.ts']);
    expect(await filesMatching(/['"](sales_invoice_journal|sales_journal_heads)['"]/)).toEqual([
      'sales/invoices/invoice-journal.schema.ts',
      'sales/invoices/journal-head.schema.ts',
    ]);
    const journal = await readFile(resolve(ICI, 'invoice-journal.service.ts'), 'utf8');
    expect(journal).not.toMatch(/this\.entries\.(update|delete|replace|findOneAndUpdate)/);
  });

  it('sales_invoices : écrit par les brouillons, le gel et la numérotation seulement', async () => {
    expect(await filesMatching(/InjectModel\(SalesInvoice\.name\)/)).toEqual([
      // ADR-0031 : LECTEURS seulement (règlement et pont vers le réalisé), vérifié
      // ci-dessous.
      'actuals/run-bridge/run-bridge.service.ts',
      // ADR-0033 : LECTEUR seulement (brief du matin) — vérifié ci-dessous.
      'morning-brief/morning-brief.service.ts',
      // ADR-0025 (S25g) : seul écrivain de `duplicateCount`, et de lui seul.
      'sales/documents/invoice-documents.service.ts',
      'sales/invoices/invoice-drafts.service.ts',
      'sales/invoices/invoice-freezing.service.ts',
      'sales/invoices/invoice-numbering.service.ts',
      // ADR-0024 (F2) : seul écrivain de la normalisation (`normalization`, statuts
      // `normalized` et `normalization_failed`).
      'sales/normalization/normalization-recorder.ts',
      'sales/receipts/settlements.service.ts',
      // ADR-0034, amendement du 26 oct. 2026 : LECTEUR des échéances pour la trésorerie.
      'sales/receipts/treasury-feed.service.ts',
    ]);
    for (const lecteur of [
      'actuals/run-bridge/run-bridge.service.ts',
      'sales/receipts/settlements.service.ts',
      'sales/receipts/treasury-feed.service.ts',
    ]) {
      const code = await readFile(resolve(SRC, lecteur), 'utf8');
      expect(code, lecteur).not.toMatch(
        /this\.invoices\s*\.\s*(update|create|insert|delete|replace|findOneAndUpdate|bulkWrite)/,
      );
    }
    const brief = await readFile(resolve(SRC, 'morning-brief/morning-brief.service.ts'), 'utf8');
    const briefInvoices = brief.match(/this\.invoices\s*\.\s*\w+/g) ?? [];
    expect(briefInvoices.map((m) => m.replace(/\s/g, ''))).toEqual(['this.invoices.find']);
    const documents = await readFile(
      resolve(SRC, 'sales/documents/invoice-documents.service.ts'),
      'utf8',
    );
    const writes = documents.match(/\$(set|inc|unset|push|pull)\b[^}]*\}/g) ?? [];
    expect(writes).toEqual(['$inc: { duplicateCount: 1 }']);
    expect(await filesMatching(/duplicateCount:\s*1\b|\$inc:\s*\{\s*duplicateCount/)).toEqual([
      'sales/documents/invoice-documents.service.ts',
    ]);
    // Les champs figés (empreinte, montants normalisés) ne sont posés qu'au gel.
    expect(await filesMatching(/contentSha256(:|,)\s/)).toEqual(
      expect.arrayContaining(['sales/invoices/invoice-freezing.service.ts']),
    );
    const numbering = await readFile(resolve(ICI, 'invoice-numbering.service.ts'), 'utf8');
    expect(numbering).not.toMatch(/normalizedAmounts|contentSha256|documentAmounts/);
  });
});
