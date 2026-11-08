// Rendu d'une carte par un modèle intégré, puis export (PDF, PNG 300 dpi, planche,
// archive de PNG) par le Chromium confiné partagé — ADR-0069 § 1 et § 5.

import type { CardFace } from '@lalanda/shared/hr';

import type { PdfRenderingService } from '../../reports/pdf-rendering.service.js';
import { writeZip } from '../../security/zip-reader.js';
import type { FontId } from '../../sales/documents/templates/invoice-fonts.js';
import {
  pagesDocument,
  sheetDocument,
  singleFaceDocument,
  type CardDocumentInput,
  type RenderedCard,
} from './card-document.js';
import {
  bleedBox,
  mm,
  mmToCssPx,
  mmToPx,
  PRINT_SCALE,
  SHEET,
  type CardFormat,
} from './card-formats.js';
import type { CardData, CardTheme } from './card-model.js';
import { cropPng } from './png-crop.js';
import type { CardTemplateDef } from './templates/parts.js';

/** Faces d'une carte selon son type et les réglages (verso du badge facultatif). */
export function facesFor(kind: 'badge' | 'business', badgeVerso: boolean): CardFace[] {
  return kind === 'business' || badgeVerso ? ['recto', 'verso'] : ['recto'];
}

export function renderBuiltinCard(
  def: CardTemplateDef,
  d: CardData,
  t: CardTheme,
  f: CardFormat,
  faces: readonly CardFace[],
): RenderedCard {
  const out = def.render(d, t, f);
  return {
    css: out.css,
    faces: faces.map((face) => ({ face, html: face === 'recto' ? out.recto : out.verso })),
    paper: t.paper,
    sample: d.sample,
  };
}

export interface CardExportJob {
  format: CardFormat;
  fonts: readonly FontId[];
  cards: RenderedCard[];
  overlay?: CardDocumentInput['overlay'];
  extraCss?: string;
}

/** Date figée des métadonnées PDF : même carte ⇒ mêmes octets. */
const FIXED = new Date('2026-01-01T00:00:00Z');

export async function exportPdf(r: PdfRenderingService, job: CardExportJob): Promise<Buffer> {
  const b = bleedBox(job.format);
  return r.render(pagesDocument(job), {
    size: { width: mm(b.width), height: mm(b.height) },
    fixedDate: FIXED,
  });
}

export async function exportSheet(r: PdfRenderingService, job: CardExportJob): Promise<Buffer> {
  return r.render(sheetDocument(job), {
    size: { width: mm(SHEET.width), height: mm(SHEET.height) },
    fixedDate: FIXED,
  });
}

export async function exportPng(
  r: PdfRenderingService,
  job: CardExportJob,
  face: CardFace,
): Promise<Buffer> {
  const b = bleedBox(job.format);
  const shot = await r.renderPng(singleFaceDocument(job, face), {
    width: mmToCssPx(b.width),
    height: mmToCssPx(b.height),
    printScale: PRINT_SCALE,
  });
  // Pixels exacts à 300 dpi (Chromium arrondit la capture au pixel CSS).
  return cropPng(shot, mmToPx(b.width), mmToPx(b.height));
}

/** Archive ZIP : `<nom>-recto.png`, `<nom>-verso.png` par carte. */
export async function exportPngZip(
  r: PdfRenderingService,
  job: CardExportJob,
  names: readonly string[],
): Promise<Buffer> {
  const files: Array<{ name: string; data: Buffer }> = [];
  for (const [i, card] of job.cards.entries()) {
    for (const face of card.faces) {
      const data = await exportPng(r, { ...job, cards: [card] }, face.face);
      files.push({ name: `${names[i] ?? `carte-${i + 1}`}-${face.face}.png`, data });
    }
  }
  return writeZip(files);
}

/** Nom de fichier sûr (ASCII, tirets). */
export function fileSlug(s: string): string {
  const out = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return out || 'carte';
}
