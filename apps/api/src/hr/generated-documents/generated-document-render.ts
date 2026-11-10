// Mise en page A4 des documents RH générés — ADR-0072 § 4.
//
// Trois modèles sobres, du code du dépôt, versionnés (`classique@1`, `bandeau@1`,
// `marge@1`). Une page A4 de taille fixe (aucune marge Chromium : la page porte ses
// marges). Tout texte est ÉCHAPPÉ ; les seules ressources sont des `data:` (logo,
// polices) ; même CSP que les factures et les cartes (S22e) : aucun script, aucun
// réseau. Le Chromium confiné partagé rend ce HTML (`PdfRenderingService`).

import type { GeneratedDocumentTemplateId } from '@lalanda/shared/hr';

import { inkSafe, readableOn, tint } from '../../branding/colors.js';
import { esc } from '../../sales/documents/invoice-document-html.js';
import {
  fontFacesCss,
  fontStack,
  isBodyFont,
  type FontId,
} from '../../sales/documents/templates/invoice-fonts.js';
import { patternDeclarations } from '../../sales/documents/templates/template-engine.js';
import type { RenderPattern } from '../../sales/documents/templates/template.contract.js';
import { longDate, type DocContent } from './generated-document-content.js';

// Version 2 (10 nov. 2026, ADR-0073) : logo selon le choix unique de
// l'organisation, nom retiré de l'en-tête quand un logo s'imprime (il reste au
// pied avec les identifiants légaux), motif de fond facultatif. Les pièces déjà
// générées sont des PDF rangés : elles ne changent pas.
export const GENERATED_TEMPLATE_VERSIONS: Readonly<Record<GeneratedDocumentTemplateId, number>> = {
  classique: 2,
  bandeau: 2,
  marge: 2,
};

export function templateRef(id: GeneratedDocumentTemplateId): string {
  return `${id}@${GENERATED_TEMPLATE_VERSIONS[id]}`;
}

export interface DocImage {
  dataUri: string;
  width: number;
  height: number;
}

/** Employeur : identification tirée de la fiche fiscale et de l'identité visuelle. */
export interface DocOrganization {
  name: string;
  initials: string;
  /** Siège, téléphone, e-mail : lignes déjà composées, seulement si renseignées. */
  contactLines: string[];
  /** « RCCM : … », « Id. nat. : … », « NIF : … » — seulement si renseignés. */
  legalIds: string[];
  logo: DocImage | null;
  logoLight: DocImage | null;
}

export interface DocIdentity {
  primaryColor: string | null;
  secondaryColor: string | null;
  font: string | null;
}

export interface DocRenderInput {
  templateId: GeneratedDocumentTemplateId;
  content: DocContent;
  org: DocOrganization;
  identity: DocIdentity;
  number: string;
  issuedOn: string;
  place: string;
  signatory: { name: string; title: string };
  /** Aperçu : filigrane « APERÇU — sans valeur ». */
  preview: boolean;
  /** Motif de fond (ADR-0073 § 4) ; absent ou `null` : aucun. */
  pattern?: RenderPattern | null;
}

const HEX = /^#[0-9a-f]{6}$/;
const DEFAULT_ACCENT = '#1f4e79';

interface Theme {
  accent: string;
  onAccent: string;
  accentInk: string;
  soft: string;
  line: string;
  body: string;
  fonts: FontId[];
}

export function themeOf(identity: DocIdentity): Theme {
  const accent =
    identity.primaryColor && HEX.test(identity.primaryColor)
      ? identity.primaryColor
      : DEFAULT_ACCENT;
  const second =
    identity.secondaryColor && HEX.test(identity.secondaryColor) ? identity.secondaryColor : accent;
  const font: FontId = isBodyFont(identity.font) ? identity.font : 'inter';
  return {
    accent,
    onAccent: readableOn(accent),
    accentInk: inkSafe(accent),
    soft: tint(second, 0.92),
    line: tint(accent, 0.55),
    body: fontStack(font),
    fonts: [font],
  };
}

function logoImg(img: DocImage | null, cls: string): string {
  if (!img) return '';
  return `<img class="${cls}" src="${esc(img.dataUri)}" alt="" />`;
}

function initialsBox(org: DocOrganization, cls: string): string {
  return `<div class="${cls}">${esc(org.initials)}</div>`;
}

/** Bloc de l'employeur ; sans le nom quand un logo est imprimé à côté (ADR-0073 § 2). */
function orgBlock(org: DocOrganization, cls: string, withLogo = false): string {
  return `<div class="${cls}">${withLogo ? '' : `<div class="org-name">${esc(org.name)}</div>`}${org.contactLines
    .map((l) => `<div>${esc(l)}</div>`)
    .join('')}</div>`;
}

function bodyHtml(c: DocContent): string {
  return c.blocks
    .map((b) => {
      if (b.kind === 'p') {
        return b.text
          .split(/\n+/)
          .map((t) => `<p>${esc(t)}</p>`)
          .join('');
      }
      if (b.kind === 'facts') {
        return `<table class="facts">${b.rows
          .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
          .join('')}</table>`;
      }
      return `<div class="jobs"><div class="jobs-title">${esc(b.title)}</div><ul>${b.rows
        .map((r) => `<li><strong>${esc(r.title)}</strong> — ${esc(r.period)}</li>`)
        .join('')}</ul></div>`;
    })
    .join('');
}

function signatureHtml(i: DocRenderInput): string {
  return `<div class="sign">
<div class="place">Fait à ${esc(i.place)}, le ${esc(longDate(i.issuedOn))}</div>
<div class="sign-box"><div class="sign-title">${esc(i.signatory.title)}</div><div class="sign-space"></div><div class="sign-name">${esc(i.signatory.name)}</div></div>
</div>`;
}

function footerHtml(i: DocRenderInput): string {
  const ids = i.org.legalIds.map(esc).join(' · ');
  return `<div class="foot"><div class="foot-ids">${esc(i.org.name)}${ids ? ` · ${ids}` : ''}</div><div class="foot-num">Pièce n° ${esc(i.number)}</div></div>`;
}

const BASE_CSS = (t: Theme) => `
@page { size: 210mm 297mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; }
body { font-family: ${t.body}; color: #111827; font-size: 10.5pt; line-height: 1.55; }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; }
.content { position: absolute; left: 22mm; right: 22mm; top: 62mm; bottom: 82mm; overflow: hidden; }
h1 { font-size: 17pt; letter-spacing: 0.4mm; text-transform: uppercase; margin: 0 0 9mm; color: ${t.accentInk}; text-align: center; font-weight: 700; }
p { margin: 0 0 4.5mm; text-align: justify; }
.facts { border-collapse: collapse; margin: 2mm 0 6mm; width: 100%; }
.facts th { text-align: left; font-weight: 600; width: 62mm; padding: 1.6mm 3mm 1.6mm 0; vertical-align: top; color: #374151; }
.facts td { padding: 1.6mm 0; border-bottom: 0.2mm solid ${t.line}; }
.jobs { margin: 2mm 0 5mm; }
.jobs-title { font-weight: 600; margin-bottom: 1.5mm; color: #374151; }
.jobs ul { margin: 0; padding-left: 5mm; }
.jobs li { margin-bottom: 1mm; }
.sign { position: absolute; left: 22mm; right: 22mm; bottom: 34mm; }
.place { margin-bottom: 4mm; }
.sign-box { margin-left: auto; width: 75mm; text-align: center; }
.sign-title { font-weight: 600; }
.sign-space { height: 24mm; }
.sign-name { border-top: 0.2mm solid #9ca3af; padding-top: 1.5mm; }
.foot { position: absolute; left: 22mm; right: 22mm; bottom: 12mm; font-size: 7.5pt; color: #4b5563; display: flex; justify-content: space-between; gap: 6mm; border-top: 0.3mm solid ${t.line}; padding-top: 2mm; }
.foot-num { white-space: nowrap; font-weight: 600; }
.org-name { font-weight: 700; font-size: 11pt; color: #111827; }
.watermark { position: absolute; left: 0; right: 0; top: 130mm; text-align: center; transform: rotate(-28deg); font-size: 46pt; font-weight: 800; color: rgba(185, 28, 28, 0.16); letter-spacing: 2mm; }
`;

type Layout = (i: DocRenderInput, t: Theme) => { css: string; header: string };

const LAYOUTS: Readonly<Record<GeneratedDocumentTemplateId, Layout>> = {
  classique: (i, t) => ({
    css: `
.head { position: absolute; left: 22mm; right: 22mm; top: 16mm; height: 34mm; display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 0.8mm solid ${t.accent}; padding-bottom: 4mm; }
.logo { max-height: 22mm; max-width: 60mm; }
.ini { width: 18mm; height: 18mm; border-radius: 2mm; background: ${t.accent}; color: ${t.onAccent}; font-weight: 700; font-size: 14pt; display: flex; align-items: center; justify-content: center; }
.org { text-align: right; font-size: 8.5pt; color: #374151; max-width: 95mm; }`,
    header: `<div class="head">${i.org.logo ? logoImg(i.org.logo, 'logo') : initialsBox(i.org, 'ini')}${orgBlock(i.org, 'org', i.org.logo !== null)}</div>`,
  }),
  bandeau: (i, t) => ({
    css: `
.band { position: absolute; left: 0; right: 0; top: 0; height: 44mm; background: ${t.accent}; color: ${t.onAccent}; display: flex; align-items: center; gap: 8mm; padding: 0 22mm; }
.band .org-name { color: ${t.onAccent}; font-size: 13pt; }
.band .org { font-size: 8.5pt; }
.logo { max-height: 22mm; max-width: 55mm; }
.ini { width: 18mm; height: 18mm; border-radius: 50%; border: 0.5mm solid ${t.onAccent}; font-weight: 700; font-size: 14pt; display: flex; align-items: center; justify-content: center; }
.content { top: 64mm; }`,
    header: `<div class="band">${
      i.org.logoLight
        ? logoImg(i.org.logoLight, 'logo')
        : i.org.logo && t.onAccent !== '#ffffff'
          ? logoImg(i.org.logo, 'logo')
          : initialsBox(i.org, 'ini')
    }${orgBlock(i.org, 'org', i.org.logoLight !== null || (i.org.logo !== null && t.onAccent !== '#ffffff'))}</div>`,
  }),
  marge: (i, t) => ({
    css: `
.side { position: absolute; left: 0; top: 0; bottom: 0; width: 9mm; background: ${t.accent}; }
.head { position: absolute; left: 22mm; right: 22mm; top: 16mm; display: flex; gap: 6mm; align-items: center; padding: 4mm; background: ${t.soft}; border-radius: 2mm; }
.logo { max-height: 18mm; max-width: 45mm; }
.ini { width: 16mm; height: 16mm; background: ${t.accent}; color: ${t.onAccent}; font-weight: 700; font-size: 13pt; display: flex; align-items: center; justify-content: center; }
.org { font-size: 8.5pt; color: #374151; }
h1 { text-align: left; border-left: 1.2mm solid ${t.accent}; padding-left: 3mm; }`,
    header: `<div class="side"></div><div class="head">${i.org.logo ? logoImg(i.org.logo, 'logo') : initialsBox(i.org, 'ini')}${orgBlock(i.org, 'org', i.org.logo !== null)}</div>`,
  }),
};

/** HTML complet d'un document (une page A4). */
export function generatedDocumentHtml(i: DocRenderInput): string {
  const t = themeOf(i.identity);
  const layout = LAYOUTS[i.templateId](i, t);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" />
<title>${esc(i.content.title)} ${esc(i.number)}</title>
<style>
${fontFacesCss(t.fonts)}
${BASE_CSS(t)}
${layout.css}
</style>
</head>
<body><div class="page"${i.pattern ? ' style="isolation:isolate"' : ''}>${
    i.pattern
      ? `<div style="position:absolute;top:0;left:0;right:0;bottom:0;z-index:-1;pointer-events:none;${esc(patternDeclarations(i.pattern, 0.5))}" aria-hidden="true"></div>`
      : ''
  }${layout.header}<div class="content"><h1>${esc(i.content.title)}</h1>${bodyHtml(i.content)}</div>${signatureHtml(i)}${footerHtml(i)}${
    i.preview ? '<div class="watermark">APERÇU — SANS VALEUR</div>' : ''
  }</div></body></html>`;
}
