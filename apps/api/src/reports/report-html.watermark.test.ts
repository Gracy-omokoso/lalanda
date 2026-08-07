// Tests du filigrane PDF « offre gratuite » (S16b).
// On teste au niveau du HTML (source du PDF Puppeteer) — pas besoin de Chromium.
// Le positionnement (répétition par page, bas de page) a été vérifié visuellement ;
// ici on garantit la présence/absence pilotée par l'entitlement `pdfWatermark`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateTemplate, parseTemplate } from '@lalanda/engine';

import { renderReportHtml, WATERMARK_TEXT, type ReportData } from './report-html.js';

const templatePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/engine/src/toy-template.yaml',
);
const template = parseTemplate(readFileSync(templatePath, 'utf-8'));

function buildData(watermark: boolean | undefined): ReportData {
  const evaluation = evaluateTemplate(template, {});
  return {
    organization: { name: 'Org test', pays: 'CD' },
    project: {
      name: 'Projet démo',
      templateSlug: template.slug,
      pays: 'CD',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
    template,
    driverValues: Object.fromEntries(evaluation.drivers),
    lines: evaluation.lines.map((l) => ({
      sheetId: l.sheetId,
      lineId: l.lineId,
      label: l.label,
      value: l.value,
      format: l.format,
      seuil: l.seuil,
    })),
    generatedAt: '2025-01-01T12:00:00.000Z',
    currency: 'USD',
    ...(watermark === undefined ? {} : { watermark }),
  };
}

describe('renderReportHtml — filigrane offre gratuite', () => {
  it('affiche le filigrane quand watermark=true (plan free)', () => {
    const html = renderReportHtml(buildData(true));
    expect(html).toContain(WATERMARK_TEXT);
    expect(html).toContain('class="watermark"');
  });

  it("n'affiche PAS le filigrane quand watermark=false (plan pro/business)", () => {
    const html = renderReportHtml(buildData(false));
    expect(html).not.toContain(WATERMARK_TEXT);
    expect(html).not.toContain('class="watermark"');
  });

  it("n'affiche PAS le filigrane quand watermark est absent (rétro-compatibilité)", () => {
    const html = renderReportHtml(buildData(undefined));
    expect(html).not.toContain(WATERMARK_TEXT);
  });
});
