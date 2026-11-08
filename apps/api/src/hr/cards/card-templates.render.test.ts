// Rendu Chromium RÉEL des vingt modèles de carte — ADR-0069 (plan de validation).
//
// Sauté là où Chromium n'est pas téléchargé (CI avec PUPPETEER_SKIP_DOWNLOAD).
// Écrit les aperçus PNG 300 dpi et les PDF dans `apps/api/.vitest/card-samples/`.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { PdfRenderingService } from '../../reports/pdf-rendering.service.js';
import { qrCodeSvg } from '../../sales/documents/invoice-qr.js';
import { cardFormat, mmToPx } from './card-formats.js';
import { cardThemeOf } from './card-model.js';
import { exportPdf, exportPng, exportSheet, facesFor, renderBuiltinCard } from './card-render.js';
import { sampleCardData } from './card-sample.js';
import { BUILTIN_CARD_TEMPLATES } from './templates/registry.js';
import { vcardOf } from './vcard.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../../.vitest/card-samples');

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

function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe.skipIf(!hasChromium)('cartes — rendu Chromium réel des vingt modèles', () => {
  afterAll(async () => {
    await renderer.onModuleDestroy();
  }, 60_000);

  it('chaque modèle produit un PDF et des PNG 300 dpi aux dimensions exactes', async () => {
    await mkdir(OUT, { recursive: true });
    const verify = await qrCodeSvg('https://lalanda.co/v/AbCdEfGhIjKlMnOpQrStUvWx');
    const vcard = await qrCodeSvg(
      vcardOf({
        firstName: 'Aline',
        lastName: 'Mbuyi Kabongo',
        organization: 'Kivu Logistique',
        jobTitle: 'Responsable des opérations',
        workPhone: '+243 81 000 00 00',
        workEmail: 'aline.mbuyi@exemple.cd',
        website: 'www.exemple.cd',
        address: null,
      }),
    );
    const org = {
      name: 'Kivu Logistique',
      logo: null,
      logoLight: null,
      address: null,
      website: null,
      phone: null,
      slogan: null,
    };
    const palettes = [
      { primaryColor: '#0f766e', secondaryColor: '#f59e0b', font: 'manrope' },
      { primaryColor: '#7c2d12', secondaryColor: '#1e3a8a', font: 'inter' },
    ];
    for (const [i, def] of BUILTIN_CARD_TEMPLATES.entries()) {
      const f = cardFormat(def.kind, def.orientation);
      const theme = cardThemeOf(palettes[i % 2]!, 'brand', null, def.displayFont);
      const d = sampleCardData(def.kind, org, { verify, vcard }, 'lalanda.co/v');
      const card = renderBuiltinCard(def, d, theme, f, facesFor(def.kind, true));
      const job = { format: f, fonts: theme.fonts, cards: [card] };
      const pdf = await exportPdf(renderer, job);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      await writeFile(resolve(OUT, `${def.id}.pdf`), pdf);
      for (const face of ['recto', 'verso'] as const) {
        const png = await exportPng(renderer, job, face);
        const size = pngSize(png);
        expect(size.width).toBe(mmToPx(f.width + 2 * f.bleed));
        expect(size.height).toBe(mmToPx(f.height + 2 * f.bleed));

        await writeFile(resolve(OUT, `${def.id}-${face}.png`), png);
      }
    }
    // Planche A4 de dix cartes de service.
    const def = BUILTIN_CARD_TEMPLATES[0]!;
    const f = cardFormat(def.kind, def.orientation);
    const theme = cardThemeOf(palettes[0]!, 'brand', null, def.displayFont);
    const cards = Array.from({ length: 10 }, () =>
      renderBuiltinCard(
        def,
        sampleCardData('badge', org, { verify, vcard: null }, 'lalanda.co/v'),
        theme,
        f,
        ['recto', 'verso'],
      ),
    );
    const sheet = await exportSheet(renderer, { format: f, fonts: theme.fonts, cards });
    expect(sheet.subarray(0, 5).toString()).toBe('%PDF-');
    await writeFile(resolve(OUT, 'planche-badges.pdf'), sheet);
  }, 900_000);
});
