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
import { allTemplates } from './templates/registry.js';
import { renderDocumentHtml, type ResolvedPresentation } from './templates/template-engine.js';
import type { InvoiceTemplate, TemplateOptions } from './templates/template.contract.js';
import { draftUsd, normalizedProduction, normalizedTest } from './testing/invoice-fixtures.js';
import { IDENTITY, modelFor, renderLogos, richModel } from './testing/template-fixtures.js';

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

/** Rendu RÉEL par un modèle (ADR-0028), via le moteur et son vérificateur DGI. */
async function renderWith(
  template: InvoiceTemplate,
  m: ReturnType<typeof modelFor>,
  options: TemplateOptions = template.defaults,
): Promise<Buffer> {
  const qr = m.security ? await qrCodeSvg(m.security.qrContent) : null;
  const p: ResolvedPresentation = {
    template,
    options,
    identity: IDENTITY,
    logos: renderLogos(true),
  };
  const r = renderDocumentHtml(m, qr, p);
  return renderer.render(r.html, {
    margin: r.margin,
    fixedDate: m.fixedDate,
    headerTemplate: r.headerTemplate,
    footerTemplate: r.footerTemplate,
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

  it.each(allTemplates().map((t) => [t.label, t] as const))(
    'modèle %s : PDF exemple, polices intégrées, logo, déterministe',
    async (_label, template) => {
      await mkdir(OUT, { recursive: true });
      const m = modelFor(normalizedTest({ softwareVersion: '0.9.3' }), template);
      const pdf = await renderWith(template, m);
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      const raw = pdf.toString('latin1');
      // Polices du modèle intégrées au PDF (sous-ensemble « XXXXXX+Famille »).
      const family = {
        inter: 'Inter',
        'ibm-plex-sans': 'IBMPlexSans',
        manrope: 'Manrope',
        'source-serif-4': 'SourceSerif4',
        'fraunces+inter': 'Fraunces',
      }[template.defaults.font as string];
      expect(raw, 'police du modèle intégrée').toMatch(
        new RegExp(`/FontName\\s*/[A-Z]{6}\\+${family}`),
      );
      expect(raw, 'police des codes DGI intégrée').toMatch(
        /\/FontName\s*\/[A-Z]{6}\+JetBrainsMono/,
      );
      expect(raw, 'logo intégré').toContain('/Subtype /Image');
      await writeFile(resolve(OUT, `modele-${template.id}-test.pdf`), pdf);
      await writeFile(
        resolve(OUT, `modele-${template.id}-production-noir-et-blanc.pdf`),
        await renderWith(template, modelFor(normalizedProduction(), template), {
          ...template.defaults,
          palette: 'mono',
        }),
      );
      await writeFile(
        resolve(OUT, `modele-${template.id}-30-lignes.pdf`),
        await renderWith(template, richModel(template)),
      );
      expect(sha(await renderWith(template, m))).toBe(sha(pdf));
    },
    300_000,
  );

  it('un duplicata diffère de l’original', async () => {
    expect(sha(await render(normalizedTest(), 1))).not.toBe(sha(await render(normalizedTest())));
  }, 300_000);
});
