// Tests du filigrane PDF « offre gratuite » (S16b) et de l'en-tête de marque (S22h).
// On teste au niveau du HTML (source du PDF Puppeteer) — pas besoin de Chromium.
// Le positionnement (répétition par page, bas de page) a été vérifié visuellement ;
// ici on garantit la présence/absence pilotée par l'entitlement `pdfWatermark`.
//
// ⚠ Ces tests ne prouvent PAS qu'une image s'affiche : une chaîne de caractères
// dans le HTML reste une chaîne de caractères, et une image avortée par
// l'interception réseau de reports.service.ts laisse un blanc qu'aucune
// assertion textuelle ne verrait. Ce qu'ils verrouillent, c'est l'invariant qui
// décide de l'affichage : la source de chaque image est un data URI, jamais une
// URL réseau. Le rendu lui-même a été vérifié en ouvrant de vrais PDF.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateTemplate, parseTemplate } from '@lalanda/engine';

import { renderReportHtml, WATERMARK_TEXT, type ReportData } from './report-html.js';
import { LOGO_LIGHT_DATA_URI, LOGO_WATERMARK_DATA_URI } from './assets/brand.js';

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

  // Décision du décideur : le logo vient EN PLUS du texte, jamais à sa place.
  // Le texte porte l'information commerciale — un logo seul n'expliquerait pas
  // pourquoi le document est marqué.
  it('compose le logo AVEC le texte, et non à sa place', () => {
    const html = renderReportHtml(buildData(true));
    expect(html).toContain(WATERMARK_TEXT);
    expect(html).toContain(LOGO_WATERMARK_DATA_URI);
    // L'image est bien à l'intérieur du bloc filigrane, pas ailleurs dans la page.
    expect(html).toMatch(/<div class="watermark">\s*<img [^>]*src="data:image\/png;base64,/);
  });

  it("n'embarque pas le logo du filigrane quand watermark=false", () => {
    const html = renderReportHtml(buildData(false));
    expect(html).not.toContain(LOGO_WATERMARK_DATA_URI);
  });
});

describe('renderReportHtml — en-tête de marque de la page de garde', () => {
  it('affiche le lockup couleur, quel que soit le plan', () => {
    for (const watermark of [true, false, undefined]) {
      const html = renderReportHtml(buildData(watermark));
      expect(html).toContain(LOGO_LIGHT_DATA_URI);
      expect(html).toContain('class="brand-logo"');
      // Le nom de l'éditeur survit à une image manquante.
      expect(html).toContain('alt="Lalanda"');
    }
  });

  it("n'utilise PAS la déclinaison filigrane pour l'en-tête", () => {
    // L'en-tête est sur fond blanc : le gris 25 % y serait illisible.
    const html = renderReportHtml(buildData(false));
    expect(html).toContain(LOGO_LIGHT_DATA_URI);
    expect(html).not.toContain(LOGO_WATERMARK_DATA_URI);
  });
});

/**
 * L'invariant qui décide de tout. Le rendu PDF coupe JavaScript et avorte TOUTE
 * requête sortante (reports.service.ts, barrière anti-SSRF délibérée). Vérifié en
 * rendant les trois cas côte à côte sous ce confinement : un `<img src="http://…">`
 * donne un cadre vide, un `src="file://…"` ne donne rien du tout, le data URI
 * s'affiche. Si quelqu'un remplace un jour ces constantes par une URL — un CDN,
 * un bucket MinIO, un chemin de fichier — le logo disparaîtra silencieusement des
 * dossiers déposés en banque, et seul ce test le dira.
 */
describe('renderReportHtml — aucune ressource réseau dans le document', () => {
  const html = renderReportHtml(buildData(true));

  it('ne référence aucune URL http(s) ni file:// dans un attribut src ou href', () => {
    const refs = [...html.matchAll(/(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('data:')).toBe(true);
    }
  });

  it('ne contient aucun url() CSS pointant hors du document', () => {
    for (const [, target] of html.matchAll(/url\(\s*['"]?([^'")]+)/g)) {
      expect(target.startsWith('data:')).toBe(true);
    }
  });
});
