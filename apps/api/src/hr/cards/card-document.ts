// Assemblage HTML des cartes pour Chromium — ADR-0069 § 1.
//
// Trois mises en page :
//   - `pages`  : une page PDF par face, à la taille coupe + fond perdu ;
//   - `sheet`  : planche A4, cartes à la coupe, traits de coupe, verso en miroir
//                (impression recto verso sur imprimante de bureau) ;
//   - `single` : une face seule (capture PNG 300 dpi).
//
// Chaque carte est enfermée dans `@scope (.lx-cN)` : la feuille d'une carte (ses
// tailles de nom calculées) ne touche pas sa voisine dans un lot. Même CSP que les
// factures : aucun script, aucune ressource hors `data:` (S22e).

import type { CardFace } from '@lalanda/shared/hr';

import { esc } from '../../sales/documents/invoice-document-html.js';
import { fontFacesCss, type FontId } from '../../sales/documents/templates/invoice-fonts.js';
import { bleedBox, mm, sheetLayout, SHEET, type CardFormat } from './card-formats.js';

export interface RenderedFace {
  face: CardFace;
  /** Contenu de la face (boîte avec fond perdu, coordonnées absolues). */
  html: string;
}

export interface RenderedCard {
  css: string;
  faces: RenderedFace[];
  /** Fond de page (variante sombre) — appliqué à la boîte de la face. */
  paper: string;
  sample: boolean;
}

export interface CardDocumentInput {
  format: CardFormat;
  fonts: readonly FontId[];
  cards: readonly RenderedCard[];
  /** Couche du moteur posée au-dessus de chaque face (réservée ; non utilisée en v1). */
  overlay?: (cardIndex: number, face: CardFace) => string;
  /** CSS hors `@scope` : `@font-face` des polices d'un paquet sur mesure. */
  extraCss?: string;
}

const SAMPLE_CSS = `.lx-sample { position: absolute; z-index: 50; right: -9mm; top: 4mm; width: 34mm; transform: rotate(35deg); background: #b91c1c; color: #ffffff; text-align: center; font: 700 2.2mm Arial, sans-serif; letter-spacing: 0.5mm; padding: 0.6mm 0; }`;

function faceBox(
  f: CardFormat,
  i: number,
  face: RenderedFace,
  card: RenderedCard,
  overlay: string,
) {
  const b = bleedBox(f);
  return `<div class="lx-c${i} lx-wrap"><div class="lx-face lx-${face.face}" style="width:${mm(b.width)};height:${mm(b.height)};background:${esc(card.paper)}">${face.html}${overlay}${card.sample ? '<div class="lx-sample">EXEMPLE</div>' : ''}</div></div>`;
}

function head(css: string, pageW: number, pageH: number): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" />
<title>Cartes</title>
<style>
@page { size: ${mm(pageW)} ${mm(pageH)}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; }
.lx-face { position: relative; overflow: hidden; }
.lx-face img { max-width: none; }
${SAMPLE_CSS}
${css}
</style>
</head>
<body>`;
}

function cardStyles(input: CardDocumentInput): string {
  return [
    fontFacesCss(input.fonts),
    input.extraCss ?? '',
    ...input.cards.map((c, i) => `@scope (.lx-c${i}) {\n${c.css}\n}`),
  ].join('\n');
}

/** Une page par face, à la taille de la boîte avec fond perdu. */
export function pagesDocument(input: CardDocumentInput): string {
  const b = bleedBox(input.format);
  const pages = input.cards.flatMap((c, i) =>
    c.faces.map(
      (face) =>
        `<section class="lx-page" style="width:${mm(b.width)};height:${mm(b.height)}">${faceBox(input.format, i, face, c, input.overlay?.(i, face.face) ?? '')}</section>`,
    ),
  );
  return `${head(`${cardStyles(input)}\n.lx-page { overflow: hidden; break-after: page; }\n.lx-page:last-child { break-after: auto; }`, b.width, b.height)}${pages.join('')}</body></html>`;
}

/** Une seule face (capture PNG). */
export function singleFaceDocument(input: CardDocumentInput, face: CardFace): string {
  const b = bleedBox(input.format);
  const c = input.cards[0]!;
  const f = c.faces.find((x) => x.face === face) ?? c.faces[0]!;
  return `${head(cardStyles({ ...input, cards: [c] }), b.width, b.height)}${faceBox(input.format, 0, f, c, input.overlay?.(0, f.face) ?? '')}</body></html>`;
}

/** Planche A4 (cartes à la coupe, traits de coupe, verso en miroir). */
export function sheetDocument(input: CardDocumentInput): string {
  const f = input.format;
  const L = sheetLayout(f);
  const hasVerso = input.cards.some((c) => c.faces.some((x) => x.face === 'verso'));
  const pages: string[] = [];
  for (let start = 0; start < input.cards.length; start += L.perPage) {
    const group = input.cards.slice(start, start + L.perPage);
    for (const face of (hasVerso ? ['recto', 'verso'] : ['recto']) as CardFace[]) {
      const slots = group.map((c, k) => {
        const i = start + k;
        const row = Math.floor(k / L.cols);
        let col = k % L.cols;
        if (face === 'verso') col = L.cols - 1 - col; // miroir : retournement par le grand côté
        const rf = c.faces.find((x) => x.face === face);
        if (!rf) return '';
        const x = L.originX + col * f.width;
        const y = L.originY + row * f.height;
        return `<div class="lx-slot" style="left:${mm(x)};top:${mm(y)};width:${mm(f.width)};height:${mm(f.height)}"><div class="lx-in" style="left:${mm(-f.bleed)};top:${mm(-f.bleed)}">${faceBox(f, i, rf, c, input.overlay?.(i, face) ?? '')}</div></div>`;
      });
      pages.push(
        `<section class="lx-sheet">${cropMarks(f, L)}${slots.join('')}<div class="lx-note">${esc(
          face === 'recto' ? 'Recto' : 'Verso (imprimer au dos, retournement par le grand côté)',
        )} — ${esc(f.kind === 'badge' ? 'Cartes de service' : 'Cartes de visite')} — échelle 100 %</div></section>`,
      );
    }
  }
  const css = `${cardStyles(input)}
  .lx-sheet { position: relative; width: ${mm(SHEET.width)}; height: ${mm(SHEET.height)}; overflow: hidden; break-after: page; }
  .lx-sheet:last-child { break-after: auto; }
  .lx-slot { position: absolute; overflow: hidden; }
  .lx-in { position: absolute; }
  .lx-crop { position: absolute; background: #000000; }
  .lx-note { position: absolute; left: 10mm; bottom: 4mm; font: 2.4mm Arial, sans-serif; color: #6b7280; }`;
  return `${head(css, SHEET.width, SHEET.height)}${pages.join('')}</body></html>`;
}

function cropMarks(f: CardFormat, L: ReturnType<typeof sheetLayout>): string {
  const marks: string[] = [];
  const len = 4;
  const gap = 1.5;
  const t = 0.15;
  const x0 = L.originX;
  const y0 = L.originY;
  const x1 = x0 + L.cols * f.width;
  const y1 = y0 + L.rows * f.height;
  for (let c = 0; c <= L.cols; c += 1) {
    const x = x0 + c * f.width;
    marks.push(
      `<div class="lx-crop" style="left:${mm(x - t / 2)};top:${mm(y0 - gap - len)};width:${mm(t)};height:${mm(len)}"></div>`,
    );
    marks.push(
      `<div class="lx-crop" style="left:${mm(x - t / 2)};top:${mm(y1 + gap)};width:${mm(t)};height:${mm(len)}"></div>`,
    );
  }
  for (let r = 0; r <= L.rows; r += 1) {
    const y = y0 + r * f.height;
    marks.push(
      `<div class="lx-crop" style="top:${mm(y - t / 2)};left:${mm(x0 - gap - len)};height:${mm(t)};width:${mm(len)}"></div>`,
    );
    marks.push(
      `<div class="lx-crop" style="top:${mm(y - t / 2)};left:${mm(x1 + gap)};height:${mm(t)};width:${mm(len)}"></div>`,
    );
  }
  return marks.join('');
}
