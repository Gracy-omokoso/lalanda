// Rendu Chromium RÉEL des modèles sur mesure — ADR-0029 (plan de validation).
//
// Sauté là où Chromium n'est pas téléchargé (CI avec PUPPETEER_SKIP_DOWNLOAD).
// Écrit les PDF du paquet d'exemple dans `apps/api/.vitest/pdf-samples/`.
//
// Barrières de confinement prouvées dans le VRAI navigateur : des règles qui
// cacheraient la zone DGI si elles s'échappaient du conteneur du modèle sont
// placées (a) seulement préfixées, (b) seulement dans `@scope` ; dans les deux
// cas, la capture de la page est IDENTIQUE à celle sans ces règles. Chaque
// barrière suffit donc à elle seule.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { PdfRenderingService } from '../../../../reports/pdf-rendering.service.js';
import { qrCodeSvg } from '../../invoice-qr.js';
import { renderDocumentHtml } from '../template-engine.js';
import type { CompiledCustomTemplate } from './custom-template.js';
import { collectPackageFiles } from './package-files.js';
import { IssueList } from './report.js';
import { SAMPLE_IDENTITY, sampleLogos, validatePackageFiles } from './validate-package.js';
import { validationCases } from './validation-cases.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../../../..');
const EXAMPLE = resolve(ROOT, 'docs/modeles-facture/exemple-ocre');
const OUT = resolve(ROOT, 'apps/api/.vitest/pdf-samples');

async function chromiumAvailable(): Promise<boolean> {
  try {
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
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function example(): Promise<CompiledCustomTemplate> {
  const entries: Array<{ name: string; directory: boolean; data: Buffer; size: number }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const data = readFileSync(full);
        entries.push({
          name: relative(EXAMPLE, full).split(sep).join('/'),
          directory: false,
          data,
          size: data.length,
        });
      }
    }
  };
  walk(EXAMPLE);
  const issues = new IssueList();
  const { template, report } = await validatePackageFiles(
    collectPackageFiles(entries, issues),
    issues,
  );
  expect(report.errors).toEqual([]);
  return template!;
}

async function html(
  template: CompiledCustomTemplate,
  caseName: string,
  palette?: 'brand' | 'mono',
) {
  const c = validationCases({ label: template.label, version: template.manifest.version }).find(
    (x) => x.name.startsWith(caseName),
  )!;
  const qr = c.model.security ? await qrCodeSvg(c.model.security.qrContent) : null;
  const r = renderDocumentHtml(c.model, qr, {
    template,
    options: { ...template.defaults, palette: palette ?? c.palette },
    identity: SAMPLE_IDENTITY,
    logos: sampleLogos(c.withLogos),
  });
  return { r, model: c.model };
}

async function pdfOf(
  template: CompiledCustomTemplate,
  caseName: string,
  palette?: 'brand' | 'mono',
) {
  const { r, model } = await html(template, caseName, palette);
  return renderer.render(r.html, {
    margin: r.margin,
    fixedDate: model.fixedDate,
    headerTemplate: r.headerTemplate,
    footerTemplate: r.footerTemplate,
  });
}

async function png(page: string): Promise<Buffer> {
  return renderer.renderPng(page, { width: 794, height: 1123, deviceScaleFactor: 1 });
}

describe.skipIf(!hasChromium)('modèles sur mesure : rendu Chromium réel', () => {
  afterAll(async () => {
    await renderer.onModuleDestroy();
  }, 120_000);

  it('paquet d’exemple : PDF test + duplicata, production noir et blanc, 30 lignes ; déterministe', async () => {
    const t = await example();
    await mkdir(OUT, { recursive: true });
    const test = await pdfOf(t, 'environnement de test');
    expect(test.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const raw = test.toString('latin1');
    // Le CSS du paquet s'applique bien (titre dans la police du paquet).
    expect(raw, 'police du paquet intégrée').toMatch(/\/FontName\s*\/[A-Z]{6}\+Fraunces/);
    expect(raw, 'police des codes DGI intégrée').toMatch(/\/FontName\s*\/[A-Z]{6}\+JetBrainsMono/);
    expect(raw, 'images intégrées (frise, logo)').toContain('/Subtype /Image');
    await writeFile(resolve(OUT, 'sur-mesure-ocre-test-duplicata.pdf'), test);
    await writeFile(
      resolve(OUT, 'sur-mesure-ocre-noir-et-blanc.pdf'),
      await pdfOf(t, 'facture normalisée, noir', 'mono'),
    );
    await writeFile(
      resolve(OUT, 'sur-mesure-ocre-30-lignes.pdf'),
      await pdfOf(t, 'document riche'),
    );
    await writeFile(resolve(OUT, 'sur-mesure-ocre-pro-forma.pdf'), await pdfOf(t, 'pro forma'));
    expect(sha(await pdfOf(t, 'environnement de test'))).toBe(sha(test));
  }, 300_000);

  it('barrières de confinement : des règles hostiles, confinées, ne changent rien au PDF', async () => {
    const t = await example();
    const { r, model } = await html(t, 'environnement de test');
    const pdf = (page: string) =>
      renderer.render(page, {
        margin: r.margin,
        fixedDate: model.fixedDate,
        headerTemplate: r.headerTemplate,
        footerTemplate: r.footerTemplate,
      });
    const baseline = await pdf(r.html);
    await mkdir(OUT, { recursive: true });
    await writeFile(resolve(OUT, 'sur-mesure-ocre-apercu.png'), await png(r.html));

    // Règles qui, si elles atteignaient la page, cacheraient ou recouvriraient
    // la zone DGI. Aucune ne vise un élément du gabarit d'exemple.
    const hostile = [
      '.lx-dgi, .lx-dgi-securite, .lx-dgi-haut, .qr, .dgi-test-band, .dgi-watermark { display: none !important; visibility: hidden !important; }',
      'body, html, svg { opacity: 0 !important; background: #000000 !important; }',
    ];
    const prefixedOnly = hostile
      .map((rule) => rule.replace(/(^|, )([^,{]+?)(?=,| \{)/g, '$1.lx-modele $2'))
      .join('\n');
    const scopedOnly = `@scope (.lx-modele) {\n${hostile.join('\n')}\n}`;
    // Témoin : les mêmes règles SANS barrière changent bien le rendu.
    const unconfined = hostile.join('\n');
    // Injection directe dans le HTML assemblé : on contourne exprès le
    // validateur CSS pour éprouver chaque barrière SEULE. Le PDF ne contient
    // pas la feuille : mêmes octets ⇔ même rendu.
    const inject = (css: string) => r.html.replace('</style>', `${css}</style>`);
    expect(sha(await pdf(inject(prefixedOnly))), 'préfixe seul').toBe(sha(baseline));
    expect(sha(await pdf(inject(scopedOnly))), '@scope seul').toBe(sha(baseline));
    expect(sha(await pdf(inject(unconfined))), 'témoin sans barrière').not.toBe(sha(baseline));
  }, 300_000);
});
