// Confinement du renderer PDF (S22e — docs/29-AUDIT-SECURITE-S22e.md, axe D).
//
// Le PDF est rendu par un Chromium `--no-sandbox` qui, dans le conteneur de
// production, partage le réseau de mongo:27017, minio:9000 et de l'endpoint de
// métadonnées cloud 169.254.169.254. Un futur oubli d'`escapeHtml` deviendrait
// alors une SSRF exfiltrante (démontré dans l'audit : un `<script>fetch(...)`
// injecté joignait MinIO). Trois barrières indépendantes ont été posées; celle
// qui vit DANS le document — la CSP `<meta>` — est la seule testable sans lancer
// Chromium, et c'est le filet qui survivrait même à une régression du service.
//
// Les deux autres (JavaScript coupé, interception réseau) sont câblées dans
// reports.service.ts et vérifiées par démonstration Puppeteer dans l'audit; les
// répéter ici imposerait de booter un vrai navigateur pour un gain marginal.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateTemplate, parseTemplate } from '@lalanda/engine';

import { renderReportHtml, type ReportData } from './report-html.js';

const templatePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/engine/src/toy-template.yaml',
);
const template = parseTemplate(readFileSync(templatePath, 'utf-8'));

function buildData(): ReportData {
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
  };
}

describe('renderReportHtml — confinement du renderer (S22e)', () => {
  it('pose une CSP qui interdit tout script et toute ressource hors styles/images inline', () => {
    const html = renderReportHtml(buildData());
    const match = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
    expect(match, 'la balise meta CSP doit être présente dans le <head>').not.toBeNull();
    const policy = match![1]!;
    // `default-src 'none'` est la clause qui coupe scripts, connect, frame, etc.
    expect(policy).toContain("default-src 'none'");
    // Aucune source de script n'est autorisée : pas de `script-src` permissif ni
    // d'`unsafe-inline` côté script.
    expect(policy).not.toContain('script-src');
    // Le rapport n'a besoin que de CSS inline; rien ne doit ouvrir le réseau.
    expect(policy).not.toMatch(/https?:/);
  });
});
