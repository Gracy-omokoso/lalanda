// Smoke test standalone du pipeline PDF — pas de Mongo, pas de Nest, juste :
//   moteur → HTML → Puppeteer → PDF sur disque.
// Usage : pnpm --filter @lalanda/api exec tsx apps/api/scripts/smoke-pdf.mjs [slug]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateTemplate, parseTemplate } from '@lalanda/engine';

import { renderReportHtml } from '../src/reports/report-html.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const slug = process.argv[2] ?? 'restaurant-kinshasa';

const yamlPath = resolve(__dirname, `../../../packages/engine/src/templates/${slug}.yaml`);
const template = parseTemplate(readFileSync(yamlPath, 'utf8'));
const evaluation = evaluateTemplate(template, {});

const html = renderReportHtml({
  organization: { name: 'Smoke Test Org', pays: 'CD' },
  project: {
    name: `Test ${slug}`,
    templateSlug: slug,
    pays: 'CD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  template,
  driverValues: Object.fromEntries(evaluation.drivers),
  lines: evaluation.lines.map((l) => ({
    sheetId: l.sheetId,
    lineId: l.lineId,
    label: l.label,
    value: l.value,
    format: l.format,
  })),
  generatedAt: new Date().toISOString(),
  currency: template.devise_base ?? 'USD',
});

writeFileSync(resolve(__dirname, `smoke-${slug}.html`), html);
console.log(`OK HTML rendu (${html.length} chars) -> apps/api/scripts/smoke-${slug}.html`);

// Puppeteer -> PDF.
const puppeteer = await import('puppeteer');
const browser = await puppeteer.launch({
  headless: true,
});
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'domcontentloaded' });
const pdf = await page.pdf({
  format: 'A4',
  printBackground: true,
  margin: { top: '0', bottom: '0', left: '0', right: '0' },
});
await browser.close();

const outPath = resolve(__dirname, `smoke-${slug}.pdf`);
writeFileSync(outPath, pdf);
console.log(`OK PDF genere (${pdf.byteLength} octets) -> ${outPath}`);
// pdf est un Uint8Array en Puppeteer 25 — convertir en Buffer pour le check ascii.
const magic = Buffer.from(pdf.subarray(0, 4)).toString('ascii');
if (magic !== '%PDF') {
  throw new Error(`Le fichier genere ne commence pas par %PDF (magic: ${magic})`);
}
console.log('OK magic bytes %PDF presents');
