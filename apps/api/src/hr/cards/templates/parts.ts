// Briques communes des vingt modèles de carte — ADR-0069 § 5.
//
// Mise en forme SEULEMENT : chaque texte passe par `esc` (le rendu est fait par
// Chromium ; un nom saisi ne doit jamais devenir du HTML). Les images sont des
// `data:` déjà vérifiées ; les icônes sont des SVG constants du dépôt.

import { esc } from '../../../sales/documents/invoice-document-html.js';
import type { CardFormat } from '../card-formats.js';
import type { CardData, CardImage, CardTheme } from '../card-model.js';

export { esc };

export interface CardTemplateRender {
  css: string;
  recto: string;
  verso: string;
}

export interface CardTemplateDef {
  readonly id: string;
  readonly kind: 'badge' | 'business';
  readonly orientation: 'vertical' | 'horizontal';
  /** Version du rendu : une version publiée ne change plus (ADR-0069 § 5). */
  readonly version: string;
  readonly name: string;
  readonly description: string;
  /** Police de titre propre au modèle (`null` : police de l'identité). */
  readonly displayFont: 'fraunces' | 'source-serif-4' | 'manrope' | null;
  render(d: CardData, t: CardTheme, f: CardFormat): CardTemplateRender;
}

/** Valeur numérique en `mm`. */
export const m = (v: number): string => `${Number(v.toFixed(2))}mm`;

export function img(i: CardImage, cls: string, alt: string): string {
  return `<img class="${cls}" src="${esc(i.dataUri)}" alt="${esc(alt)}" />`;
}

/** Logo de l'organisation (version claire sur fond sombre), sinon monogramme + nom. */
export function logo(d: CardData, t: CardTheme, onDark: boolean, cls = 'lg'): string {
  void t;
  const mono = `<span class="mono-mark">${esc(d.org.initials)}</span><span class="mono-name">${esc(d.org.name)}</span>`;
  if (onDark) {
    if (d.org.logoLight)
      return `<div class="${cls}">${img(d.org.logoLight, 'lg-img', d.org.name)}</div>`;
    // Pas de version claire : le logo est posé sur une pastille blanche.
    if (d.org.logo)
      return `<div class="${cls} lg-chip">${img(d.org.logo, 'lg-img', d.org.name)}</div>`;
    return `<div class="${cls} lg-mono lg-on">${mono}</div>`;
  }
  if (d.org.logo) return `<div class="${cls}">${img(d.org.logo, 'lg-img', d.org.name)}</div>`;
  return `<div class="${cls} lg-mono">${mono}</div>`;
}

/** Photo consentie, sinon initiales sur teinte de marque. */
export function photo(d: CardData, cls = 'ph'): string {
  return d.photo
    ? `<div class="${cls}">${img(d.photo, 'ph-img', d.displayName)}</div>`
    : `<div class="${cls} ph-none"><span>${esc(d.initials)}</span></div>`;
}

/** QR de vérification sur tuile blanche (zone de silence incluse dans le SVG). */
export function verifyQr(d: CardData, size: number, cls = 'qr'): string {
  if (!d.verifyQrSvg) return '';
  return `<div class="${cls}" style="width:${m(size)};height:${m(size)}">${d.verifyQrSvg}</div>`;
}

export function vcardQr(d: CardData, size: number, cls = 'qr'): string {
  if (!d.vcardQrSvg) return '';
  return `<div class="${cls}" style="width:${m(size)};height:${m(size)}">${d.vcardQrSvg}</div>`;
}

const ICONS = {
  phone:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" fill="currentColor"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 7.2L4 7.3V17h16V7.3z" fill="currentColor"/></svg>',
  web: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.6 15.6 0 0 0-1.4-3.9A8 8 0 0 1 18.9 8zM12 4.1A13.4 13.4 0 0 1 13.9 8h-3.8A13.4 13.4 0 0 1 12 4.1zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4zm.8 2h3a15.6 15.6 0 0 0 1.4 3.9A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.4-3.9A15.6 15.6 0 0 0 8.1 8zM12 19.9a13.4 13.4 0 0 1-1.9-3.9h3.8a13.4 13.4 0 0 1-1.9 3.9zm2.3-5.9H9.7a14.6 14.6 0 0 1 0-4h4.6a14.6 14.6 0 0 1 0 4zm.2 5.9a15.6 15.6 0 0 0 1.4-3.9h3a8 8 0 0 1-4.4 3.9zm1.8-5.9a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4z" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>',
} as const;

/** Lignes de contact professionnelles, icône + texte ; vides omises. */
export function contacts(
  d: CardData,
  opts: { address?: boolean; website?: boolean; icons?: boolean; cls?: string } = {},
): string {
  const rows: Array<[keyof typeof ICONS, string | null]> = [
    ['phone', d.workPhone ?? d.org.phone],
    ['mail', d.workEmail],
    ['web', opts.website === false ? null : d.org.website],
    ['pin', opts.address === false ? null : d.org.address],
  ];
  const icons = opts.icons !== false;
  return `<ul class="${opts.cls ?? 'ct'}">${rows
    .filter((r): r is [keyof typeof ICONS, string] => typeof r[1] === 'string' && r[1] !== '')
    .map(([k, v]) => `<li>${icons ? `<i>${ICONS[k]}</i>` : ''}<span>${esc(v)}</span></li>`)
    .join('')}</ul>`;
}

/** Ligne « Matricule … » si affichée. */
export function matricule(d: CardData, cls = 'mat'): string {
  return d.employeeNumber
    ? `<div class="${cls}"><span>Matricule</span> ${esc(d.employeeNumber)}</div>`
    : '';
}

/**
 * CSS commun : polices, image en contenu, monogramme, contacts, QR. Les modèles
 * le complètent par leur propre feuille (préfixée par leur classe racine).
 */
export function baseCss(t: CardTheme): string {
  return `
  .lx-face { font-family: ${t.body}; color: ${t.ink}; background: ${t.paper}; line-height: 1.2; -webkit-font-smoothing: antialiased; }
  .lx-face .abs { position: absolute; }
  .lx-face .lg { display: flex; align-items: center; }
  .lx-face .lg-img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; filter: ${t.logoFilter}; }
  .lx-face .lg-chip { background: #ffffff; border-radius: 1.2mm; padding: 0.8mm 1.2mm; }
  .lx-face .lg-mono { gap: 1.4mm; }
  .lx-face .mono-mark { display: inline-flex; align-items: center; justify-content: center; min-width: 6.4mm; height: 6.4mm; padding: 0 1mm; border-radius: 1.4mm; background: ${t.accent}; color: ${t.onAccent}; font-family: ${t.display}; font-weight: 800; font-size: 2.6mm; letter-spacing: 0.1mm; }
  .lx-face .mono-name { font-family: ${t.display}; font-weight: 700; font-size: 2.5mm; line-height: 1.05; max-width: 34mm; overflow-wrap: anywhere; }
  .lx-face .lg-on .mono-mark { background: transparent; color: inherit; border: 0.35mm solid currentColor; }
  .lx-face .lg-on .mono-name { color: inherit; }
  .lx-face .ph { overflow: hidden; background: ${t.soft}; }
  .lx-face .ph-img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .lx-face .ph-none { display: flex; align-items: center; justify-content: center; background: ${t.variant === 'inverse' ? t.soft : t.accent}; color: ${t.variant === 'inverse' ? t.ink : t.onAccent}; font-family: ${t.display}; font-weight: 700; }
  .lx-face .qr { background: #ffffff; flex: none; }
  .lx-face .qr svg { display: block; width: 100%; height: 100%; }
  .lx-face .ct { list-style: none; margin: 0; padding: 0; }
  .lx-face .ct li { display: flex; align-items: flex-start; gap: 1.3mm; margin: 0 0 0.9mm 0; font-size: 2.2mm; line-height: 1.25; overflow-wrap: anywhere; }
  .lx-face .ct i { flex: none; width: 2.4mm; height: 2.4mm; margin-top: 0.05mm; color: ${t.accentInk}; }
  .lx-face .ct i svg { display: block; width: 100%; height: 100%; }
  .lx-face .mat { font-size: 2mm; letter-spacing: 0.1mm; white-space: nowrap; }
  .lx-face .mat span { text-transform: uppercase; font-size: 1.6mm; letter-spacing: 0.25mm; opacity: 0.75; }
  .lx-face .vfy { font-size: 1.55mm; letter-spacing: 0.1mm; line-height: 1.2; }
  .lx-face .name, .lx-face .title { overflow-wrap: anywhere; }
  `;
}

/** Texte de verso d'une carte de service. */
export function badgeVersoText(d: CardData): { title: string; body: string; lost: string | null } {
  const lost = [d.org.phone, d.org.address].filter((x): x is string => !!x).join(' · ');
  return {
    title: 'Carte de service',
    body: `Cette carte est personnelle et reste la propriété de ${d.org.name}. Elle se présente à toute demande et se restitue à la fin des fonctions.`,
    lost: lost ? `Carte trouvée ? Merci de contacter : ${lost}` : null,
  };
}

/** Verso commun d'une carte de service, décliné par `style`. */
export function badgeVerso(
  d: CardData,
  t: CardTheme,
  f: CardFormat,
  style: 'band' | 'plain' | 'dark' | 'frame' | 'side',
): string {
  const v = badgeVersoText(d);
  const qrSize = f.orientation === 'horizontal' ? 20 : 22;
  const dark = style === 'dark';
  const head = `<div class="bv-head">${logo(d, t, dark || style === 'band', 'lg bv-logo')}<div class="bv-title">${esc(v.title)}</div></div>`;
  const text = `<div class="bv-text"><p>${esc(v.body)}</p>${v.lost ? `<p class="bv-lost">${esc(v.lost)}</p>` : ''}${matricule(d, 'mat bv-mat')}${d.serial !== null ? `<div class="bv-serial">Émission n° ${d.serial}</div>` : ''}</div>`;
  const qr = `<div class="bv-qr">${verifyQr(d, qrSize)}<div class="vfy">Vérifier cette carte<br/><b>${esc(d.verifyLabel)}</b></div></div>`;
  return `<div class="bv bv-${style} bv-${f.orientation}">${head}<div class="bv-body">${text}${qr}</div></div>`;
}

export function badgeVersoCss(t: CardTheme, f: CardFormat): string {
  const h = f.orientation === 'horizontal';
  return `
  .bv { position: absolute; inset: 0; display: flex; flex-direction: column; padding: ${m(f.safe)}; }
  .bv-head { display: flex; align-items: center; justify-content: space-between; gap: 2mm; padding-bottom: 1.6mm; border-bottom: 0.3mm solid ${t.line}; }
  .bv-logo { height: 6mm; max-width: 30mm; }
  .bv-title { font-family: ${t.display}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.35mm; font-size: 2.1mm; color: ${t.accentInk}; text-align: right; }
  .bv-body { flex: 1; display: flex; ${h ? 'flex-direction: row; align-items: center;' : 'flex-direction: column; justify-content: space-between;'} gap: 2.5mm; padding-top: 2mm; }
  .bv-text { flex: 1; font-size: 1.95mm; line-height: 1.35; color: ${t.muted}; }
  .bv-text p { margin: 0 0 1.2mm 0; }
  .bv-lost { color: ${t.ink}; font-weight: 600; }
  .bv-mat { color: ${t.ink}; margin-top: 1mm; }
  .bv-serial { font-size: 1.6mm; margin-top: 0.6mm; opacity: 0.7; }
  .bv-qr { display: flex; flex-direction: column; align-items: center; gap: 1mm; text-align: center; color: ${t.muted}; }
  .bv-qr b { color: ${t.ink}; }
  .bv-band .bv-head { margin: -${m(f.safe)} -${m(f.safe)} 0; padding: 2.4mm ${m(f.safe)}; background: ${t.accent}; border: none; }
  .bv-band .bv-title { color: ${t.onAccent}; }
  .bv-band .bv-head { color: ${t.onAccent}; }
  .bv-dark { background: ${t.dark}; }
  .bv-dark .bv-head { border-color: ${t.line}; color: ${t.onDark}; }
  .bv-dark .bv-title, .bv-dark .bv-lost, .bv-dark .bv-mat, .bv-dark .bv-qr b, .bv-dark .mono-name { color: ${t.onDark}; }
  .bv-dark .bv-text, .bv-dark .bv-qr { color: ${t.onDark}; opacity: 0.92; }
  .bv-frame { border: 0.8mm solid ${t.accent}; }
  .bv-side { border-left: 3mm solid ${t.accent}; }
  `;
}
