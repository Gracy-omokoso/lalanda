// Rendu PDF RÉEL d'un document de vente — ADR-0025 (plan de validation).
//
// Exige Chromium (Puppeteer) : sauté là où il n'est pas téléchargé (CI avec
// PUPPETEER_SKIP_DOWNLOAD=true — le modèle et le HTML y sont testés par
// `invoice-document.model.test.ts`). Écrit des PDF d'exemple, test et
// production, dans `apps/api/.vitest/pdf-samples/` (ignoré par Git).

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { PdfRenderingService } from '../../reports/pdf-rendering.service.js';
import type { InvoiceLean } from '../invoices/invoice.types.js';
import { buildInvoiceDocument } from './invoice-document.model.js';
import {
  invoiceFooterTemplate,
  invoiceHeaderTemplate,
  renderInvoiceDocumentHtml,
} from './invoice-document-html.js';
import { qrCodeSvg } from './invoice-qr.js';
import { draftUsd, normalizedProduction, normalizedTest } from './testing/invoice-fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../../.vitest/pdf-samples');

async function chromiumAvailable(): Promise<boolean> {
  try {
    // Puppeteer 25 : `executablePath()` rend une promesse.
    type P = { executablePath?: () => string | Promise<string> };
    const mod = (await import('puppeteer')) as unknown as P & { default?: P };
    const target = mod.default ?? mod;
    const path = await target.executablePath?.call(target);
    return typeof path === 'string' && existsSync(path);
  } catch {
    return false;
  }
}

const hasChromium = await chromiumAvailable();
const renderer = new PdfRenderingService();

async function render(doc: InvoiceLean, duplicateNumber: number | null = null): Promise<Buffer> {
  const m = buildInvoiceDocument(doc, {
    duplicateNumber,
    draftSeller: null,
    organizationName: 'Exemple SARL',
    draftInTestEnvironment: false,
  });
  const qr = m.security ? await qrCodeSvg(m.security.qrContent) : null;
  return renderer.render(renderInvoiceDocumentHtml(m, qr), {
    margin: { top: '16mm', bottom: '18mm', left: '12mm', right: '12mm' },
    fixedDate: m.fixedDate,
    headerTemplate: invoiceHeaderTemplate(m),
    footerTemplate: invoiceFooterTemplate(m),
  });
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe.skipIf(!hasChromium)('rendu PDF réel (Chromium)', () => {
  afterAll(async () => {
    await renderer.onModuleDestroy();
  }, 120_000);

  it('produit des PDF valides et écrit les exemples test / production', async () => {
    await mkdir(OUT, { recursive: true });
    const samples: Array<[string, Buffer]> = [
      ['facture-normalisee-test.pdf', await render(normalizedTest())],
      ['facture-normalisee-test-duplicata-1.pdf', await render(normalizedTest(), 1)],
      ['facture-normalisee-production.pdf', await render(normalizedProduction())],
      ['pro-forma.pdf', await render(draftUsd())],
    ];
    for (const [name, pdf] of samples) {
      expect(pdf.subarray(0, 5).toString('latin1'), name).toBe('%PDF-');
      expect(pdf.byteLength, name).toBeGreaterThan(5_000);
      await writeFile(resolve(OUT, name), pdf);
    }
  }, 300_000);

  it('déterministe : même document figé → mêmes octets', async () => {
    const a = await render(normalizedTest());
    const b = await render(normalizedTest());
    expect(sha(a)).toBe(sha(b));
    // Les dates de métadonnées sont celles du document, pas celles du rendu.
    expect(a.toString('latin1')).toContain('D:20261020091530');
  }, 300_000);

  it('un duplicata diffère de l’original', async () => {
    expect(sha(await render(normalizedTest(), 1))).not.toBe(sha(await render(normalizedTest())));
  }, 300_000);
});
