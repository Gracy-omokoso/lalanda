// Dix modèles de carte de visite recto verso (5 horizontaux, 5 verticaux) — ADR-0069 § 5.
//
// 85 × 55 mm (ou 55 × 85), fond perdu 3 mm, zone de sécurité 4 mm. Les
// coordonnées sont celles de la BOÎTE AVEC FOND PERDU : `o` = bord de la coupe,
// `s` = bord de la zone de sécurité. Les aplats débordent jusqu'au bord de la boîte.

import type { CardFormat } from '../card-formats.js';
import type { CardData, CardTheme } from '../card-model.js';
import { fitSize } from '../card-model.js';
import { baseCss, contacts, esc, logo, m, vcardQr, type CardTemplateDef } from './parts.js';

const V = '1.0.0';

function box(f: CardFormat) {
  const o = f.bleed;
  const s = f.bleed + f.safe;
  return { o, s, W: f.width + 2 * f.bleed, H: f.height + 2 * f.bleed };
}

const slogan = (d: CardData, cls = 'slg') =>
  d.org.slogan ? `<div class="${cls}">${esc(d.org.slogan)}</div>` : '';
const site = (d: CardData, cls = 'site') =>
  d.org.website ? `<div class="${cls}">${esc(d.org.website)}</div>` : '';
const qrNote = (d: CardData, cls = 'qn') =>
  d.vcardQrSvg ? `<div class="${cls}">Scannez pour enregistrer le contact</div>` : '';

function common(t: CardTheme): string {
  return `${baseCss(t)}
  .bc .name { font-family: ${t.display}; font-weight: 700; line-height: 1.06; }
  .bc .title { font-weight: 600; color: ${t.accentInk}; }
  .bc .slg { font-family: ${t.display}; font-style: italic; }
  .bc .qn { font-size: 1.6mm; }
  `;
}

// ── Horizontaux ─────────────────────────────────────────────────────────────

const classique: CardTemplateDef = {
  id: 'visite-h-classique',
  kind: 'business',
  orientation: 'horizontal',
  version: V,
  name: 'Classique',
  description: 'Recto blanc à liseré de marque ; verso plein aux couleurs, logo centré.',
  displayFont: null,
  render(d, t, f) {
    const { o, s, W } = box(f);
    const ns = fitSize(d.displayName, 4.6, 3.2, 0.1, 18);
    return {
      css: `${common(t)}
      .h1 .edge { right: 0; top: 0; bottom: 0; width: ${m(o + 2.6)}; background: ${t.accent}; }
      .h1 .lg { position: absolute; left: ${m(s)}; top: ${m(s)}; height: 8mm; max-width: 40mm; }
      .h1 .who { left: ${m(s)}; top: ${m(o + 18)}; width: ${m(W - 2 * s - 6)}; }
      .h1 .name { font-size: ${m(ns)}; }
      .h1 .title { margin-top: 1.2mm; font-size: 2.6mm; }
      .h1 .bar { margin-top: 2mm; width: 9mm; height: 0.6mm; background: ${t.second}; }
      .h1 .ct { position: absolute; left: ${m(s)}; bottom: ${m(s)}; width: ${m(W - 2 * s - 6)}; }
      .h1v .bg { inset: 0; background: ${t.accent}; }
      .h1v .lg { position: absolute; left: ${m(s)}; right: ${m(s)}; top: ${m(o + 14)}; height: 15mm; justify-content: center; }
      .h1v .lg { color: ${t.onAccent}; } .h1v .mono-name { font-size: 3.2mm; max-width: 60mm; }
      .h1v .slg { left: ${m(s)}; right: ${m(s)}; top: ${m(o + 32)}; text-align: center; color: ${t.onAccent}; font-size: 2.5mm; }
      .h1v .site { left: ${m(s)}; right: ${m(s)}; bottom: ${m(s)}; text-align: center; color: ${t.onAccent}; font-size: 2.2mm; letter-spacing: 0.2mm; }`,
      recto: `<div class="bc h1"><div class="abs edge"></div>${logo(d, t, false)}<div class="abs who"><div class="name">${esc(d.displayName)}</div><div class="title">${esc(d.jobTitle)}</div><div class="bar"></div></div>${contacts(d)}</div>`,
      verso: `<div class="bc h1v"><div class="abs bg"></div>${logo(d, t, true)}${slogan(d, 'abs slg')}${site(d, 'abs site')}</div>`,
    };
  },
};

const filet: CardTemplateDef = {
  id: 'visite-h-filet',
  kind: 'business',
  orientation: 'horizontal',
  version: V,
  name: 'Filet',
  description: 'Filet vertical de marque ; verso blanc avec QR de contact.',
  displayFont: null,
  render(d, t, f) {
    const { o, s, W, H } = box(f);
    const ns = fitSize(d.displayName, 4.3, 3, 0.1, 18);
    return {
      css: `${common(t)}
      .h2 .rule { left: ${m(s)}; top: ${m(s)}; bottom: ${m(s)}; width: 0.9mm; background: ${t.accent}; }
      .h2 .lg { position: absolute; right: ${m(s)}; top: ${m(s)}; height: 7mm; max-width: 30mm; }
      .h2 .who { left: ${m(s + 4)}; top: ${m(s)}; width: 40mm; }
      .h2 .name { font-size: ${m(ns)}; }
      .h2 .title { margin-top: 1mm; font-size: 2.4mm; }
      .h2 .ct { position: absolute; left: ${m(s + 4)}; bottom: ${m(s)}; width: ${m(W - 2 * s - 4)}; display: grid; grid-template-columns: 1fr 1fr; column-gap: 3mm; }
      .h2v .lg { position: absolute; left: ${m(s)}; top: ${m(s)}; height: 9mm; max-width: 42mm; }
      .h2v .slg { left: ${m(s)}; top: ${m(o + 18)}; width: 44mm; color: ${t.ink}; font-size: 2.6mm; }
      .h2v .site { left: ${m(s)}; bottom: ${m(s)}; color: ${t.accentInk}; font-size: 2.3mm; font-weight: 600; }
      .h2v .qrw { position: absolute; right: ${m(s)}; top: ${m((H - 22) / 2 - 1)}; display: flex; flex-direction: column; align-items: center; gap: 0.8mm; width: 22mm; text-align: center; color: ${t.muted}; }
      .h2v .band { left: 0; right: 0; bottom: 0; height: ${m(o + 1.6)}; background: ${t.accent}; }`,
      recto: `<div class="bc h2"><div class="abs rule"></div>${logo(d, t, false)}<div class="abs who"><div class="name">${esc(d.displayName)}</div><div class="title">${esc(d.jobTitle)}</div></div>${contacts(d)}</div>`,
      verso: `<div class="bc h2v">${logo(d, t, false)}${slogan(d, 'abs slg')}${site(d, 'abs site')}<div class="qrw">${vcardQr(d, 20)}${qrNote(d)}</div><div class="abs band"></div></div>`,
    };
  },
};

const angle: CardTemplateDef = {
  id: 'visite-h-angle',
  kind: 'business',
  orientation: 'horizontal',
  version: V,
  name: 'Angle',
  description: 'Angles de couleur superposés ; verso partagé logo / contact.',
  displayFont: null,
  render(d, t, f) {
    const { o, s, W } = box(f);
    const ns = fitSize(d.displayName, 4.4, 3, 0.1, 18);
    return {
      css: `${common(t)}
      .h3 .tri { inset: 0; background: ${t.accent}; clip-path: polygon(100% 34%, 100% 100%, 58% 100%); }
      .h3 .tri2 { inset: 0; background: ${t.second}; clip-path: polygon(100% 62%, 100% 100%, 80% 100%); }
      .h3 .who { left: ${m(s)}; top: ${m(s)}; width: 50mm; }
      .h3 .name { font-size: ${m(ns)}; }
      .h3 .title { margin-top: 1.1mm; font-size: 2.5mm; }
      .h3 .ct { position: absolute; left: ${m(s)}; top: ${m(o + 22)}; width: 46mm; }
      .h3 .lg { position: absolute; right: ${m(s)}; top: ${m(s)}; height: 7mm; max-width: 26mm; }
      .h3v .l { left: 0; top: 0; bottom: 0; width: ${m(W / 2)}; background: ${t.accent}; }
      .h3v .lg { position: absolute; left: ${m(s)}; top: ${m(s)}; bottom: ${m(s)}; width: ${m(W / 2 - 2 * s)}; justify-content: center; }
      .h3v .lg { color: ${t.onAccent}; } .h3v .mono-name { font-size: 3mm; }
      .h3v .r { left: ${m(W / 2 + 4)}; right: ${m(s)}; top: ${m(s)}; bottom: ${m(s)}; display: flex; flex-direction: column; justify-content: space-between; align-items: flex-start; }
      .h3v .slg { font-size: 2.3mm; color: ${t.ink}; }
      .h3v .site { font-size: 2.1mm; color: ${t.accentInk}; font-weight: 600; }`,
      recto: `<div class="bc h3"><div class="abs tri"></div><div class="abs tri2"></div><div class="abs who"><div class="name">${esc(d.displayName)}</div><div class="title">${esc(d.jobTitle)}</div></div>${contacts(d)}${logo(d, t, false)}</div>`,
      verso: `<div class="bc h3v"><div class="abs l"></div>${logo(d, t, true)}<div class="abs r">${slogan(d)}${vcardQr(d, 17)}${site(d)}</div></div>`,
    };
  },
};

const nuit: CardTemplateDef = {
  id: 'visite-h-nuit',
  kind: 'business',
  orientation: 'horizontal',
  version: V,
  name: 'Nuit',
  description: 'Recto sombre au texte clair ; verso blanc et bande de marque.',
  displayFont: 'manrope',
  render(d, t, f) {
    const { o, s, W } = box(f);
    const ns = fitSize(d.displayName, 4.6, 3.1, 0.1, 18);
    return {
      css: `${common(t)}
      .h4 .bg { inset: 0; background: ${t.dark}; }
      .h4 .lg { position: absolute; right: ${m(s)}; top: ${m(s)}; height: 7.5mm; max-width: 30mm; }
      .h4 .lg { color: ${t.onDark}; }
      .h4 .who { left: ${m(s)}; top: ${m(o + 15)}; width: ${m(W - 2 * s)}; color: ${t.onDark}; }
      .h4 .name { font-size: ${m(ns)}; font-weight: 800; letter-spacing: -0.05mm; }
      .h4 .title { color: ${t.onDark}; opacity: 0.85; margin-top: 1.2mm; font-size: 2.5mm; font-weight: 500; }
      .h4 .line { left: ${m(s)}; top: ${m(o + 13)}; width: 14mm; height: 0.7mm; background: ${t.accent}; }
      .h4 .ct { position: absolute; left: ${m(s)}; bottom: ${m(s)}; width: ${m(W - 2 * s)}; color: ${t.onDark}; display: grid; grid-template-columns: 1fr 1fr; column-gap: 3mm; }
      .h4 .ct i { color: ${t.onDark}; opacity: 0.8; }
      .h4v .lg { position: absolute; left: ${m(s)}; right: ${m(s)}; top: ${m(o + 11)}; height: 14mm; justify-content: center; }
      .h4v .slg { left: ${m(s)}; right: ${m(s)}; top: ${m(o + 28)}; text-align: center; font-size: 2.4mm; color: ${t.muted}; }
      .h4v .band { left: 0; right: 0; bottom: 0; height: ${m(o + 9)}; background: ${t.accent}; }
      .h4v .site { left: ${m(s)}; right: ${m(s)}; bottom: ${m(o + 3)}; text-align: center; color: ${t.onAccent}; font-size: 2.3mm; font-weight: 600; letter-spacing: 0.3mm; }`,
      recto: `<div class="bc h4"><div class="abs bg"></div>${logo(d, t, true)}<div class="abs line"></div><div class="abs who"><div class="name">${esc(d.displayName)}</div><div class="title">${esc(d.jobTitle)}</div></div>${contacts(d)}</div>`,
      verso: `<div class="bc h4v">${logo(d, t, false)}${slogan(d, 'abs slg')}<div class="abs band"></div>${site(d, 'abs site')}</div>`,
    };
  },
};

const bande: CardTemplateDef = {
  id: 'visite-h-bande',
  kind: 'business',
  orientation: 'horizontal',
  version: V,
  name: 'Bande',
  description: 'Bande basse de couleur portant les coordonnées ; verso monogramme.',
  displayFont: null,
  render(d, t, f) {
    const { o, s, W, H } = box(f);
    const ns = fitSize(d.displayName, 4.3, 3, 0.1, 18);
    const bandH = 19;
    return {
      css: `${common(t)}
      .h5 .lg { position: absolute; left: ${m(s)}; top: ${m(s)}; height: 7mm; max-width: 34mm; }
      .h5 .who { left: ${m(s)}; right: ${m(s)}; top: ${m(o + 15)}; text-align: right; }
      .h5 .name { font-size: ${m(ns)}; }
      .h5 .title { margin-top: 1mm; font-size: 2.4mm; }
      .h5 .band { left: 0; right: 0; bottom: 0; height: ${m(o + bandH)}; background: ${t.accent}; }
      .h5 .ct { position: absolute; left: ${m(s)}; right: ${m(s)}; bottom: ${m(s)}; height: ${m(bandH - 7)}; color: ${t.onAccent}; display: grid; grid-template-columns: 1fr 1fr; column-gap: 3mm; align-content: center; }
      .h5 .ct i { color: ${t.onAccent}; }
      .h5v .bg { inset: 0; background: ${t.soft}; }
      .h5v .wm { right: -4mm; bottom: -10mm; font-family: ${t.display}; font-weight: 800; font-size: 44mm; line-height: 1; color: ${t.line}; }
      .h5v .lg { position: absolute; left: ${m(s)}; top: ${m((H - 12) / 2 - 4)}; height: 12mm; max-width: 46mm; }
      .h5v .slg { left: ${m(s)}; top: ${m((H - 12) / 2 + 10)}; width: 50mm; font-size: 2.3mm; color: ${t.ink}; }
      .h5v .site { left: ${m(s)}; bottom: ${m(s)}; font-size: 2.2mm; color: ${t.accentInk}; font-weight: 700; }
      .h5v .qrw { position: absolute; right: ${m(s)}; top: ${m(s)}; }`,
      recto: `<div class="bc h5">${logo(d, t, false)}<div class="abs who"><div class="name">${esc(d.displayName)}</div><div class="title">${esc(d.jobTitle)}</div></div><div class="abs band"></div>${contacts(d)}</div>`,
      verso: `<div class="bc h5v"><div class="abs bg"></div><div class="abs wm">${esc(d.org.initials)}</div>${logo(d, t, false)}${slogan(d, 'abs slg')}${site(d, 'abs site')}<div class="qrw">${vcardQr(d, 16)}</div></div>`,
    };
  },
};

// ── Verticaux ───────────────────────────────────────────────────────────────

const centre: CardTemplateDef = {
  id: 'visite-v-centre',
  kind: 'business',
  orientation: 'vertical',
  version: V,
  name: 'Centré',
  description: 'Composition centrée et aérée ; verso plein, logo clair.',
  displayFont: null,
  render(d, t, f) {
    const { o, s, H } = box(f);
    const ns = fitSize(d.displayName, 4, 2.8, 0.09, 16);
    return {
      css: `${common(t)}
      .v1 .lg { position: absolute; left: ${m(s)}; right: ${m(s)}; top: ${m(s + 2)}; height: 9mm; justify-content: center; }
      .v1 .who { left: ${m(s)}; right: ${m(s)}; top: ${m(o + 28)}; text-align: center; }
      .v1 .name { font-size: ${m(ns)}; }
      .v1 .title { margin-top: 1.2mm; font-size: 2.4mm; }
      .v1 .dots { margin: 2.6mm auto 0; width: 10mm; height: 0.6mm; background: ${t.second}; border-radius: 0.3mm; }
      .v1 .ct { position: absolute; left: ${m(s)}; right: ${m(s)}; bottom: ${m(s)}; text-align: center; }
      .v1 .ct li { justify-content: center; }
      .v1v .bg { inset: 0; background: ${t.accent}; }
      .v1v .lg { position: absolute; left: ${m(s)}; right: ${m(s)}; top: ${m(H / 2 - 12)}; height: 16mm; justify-content: center; }
      .v1v .lg { color: ${t.onAccent}; } .v1v .mono-name { font-size: 3mm; }
      .v1v .slg { left: ${m(s)}; right: ${m(s)}; top: ${m(H / 2 + 7)}; text-align: center; color: ${t.onAccent}; font-size: 2.4mm; }
      .v1v .site { left: ${m(s)}; right: ${m(s)}; bottom: ${m(s)}; text-align: center; color: ${t.onAccent}; font-size: 2.1mm; letter-spacing: 0.2mm; }`,
      recto: `<div class="bc v1">${logo(d, t, false)}<div class="abs who"><div class="name">${esc(d.displayName)}</div><div class="title">${esc(d.jobTitle)}</div><div class="dots"></div></div>${contacts(d, { icons: false })}</div>`,
      verso: `<div class="bc v1v"><div class="abs bg"></div>${logo(d, t, true)}${slogan(d, 'abs slg')}${site(d, 'abs site')}</div>`,
    };
  },
};

const bloc: CardTemplateDef = {
  id: 'visite-v-bloc',
  kind: 'business',
  orientation: 'vertical',
  version: V,
  name: 'Bloc',
  description: 'Bloc de marque en tête ; verso blanc centré sur le QR de contact.',
  displayFont: null,
  render(d, t, f) {
    const { o, s, H } = box(f);
    const ns = fitSize(d.displayName, 4, 2.8, 0.09, 15);
    return {
      css: `${common(t)}
      .v2 .top { left: 0; right: 0; top: 0; height: ${m(o + 27)}; background: ${t.accent}; }
      .v2 .lg { position: absolute; left: ${m(s)}; top: ${m(s)}; height: 9mm; max-width: 38mm; }
      .v2 .lg { color: ${t.onAccent}; }
      .v2 .slgt { left: ${m(s)}; right: ${m(s)}; top: ${m(o + 18)}; color: ${t.onAccent}; font-size: 2.1mm; font-family: ${t.display}; font-style: italic; }
      .v2 .who { left: ${m(s)}; right: ${m(s)}; top: ${m(o + 32)}; }
      .v2 .name { font-size: ${m(ns)}; }
      .v2 .title { margin-top: 1.1mm; font-size: 2.35mm; }
      .v2 .ct { position: absolute; left: ${m(s)}; right: ${m(s)}; bottom: ${m(s)}; }
      .v2v .qrw { position: absolute; left: ${m(s)}; right: ${m(s)}; top: ${m(H / 2 - 17)}; display: flex; flex-direction: column; align-items: center; gap: 1.4mm; text-align: center; color: ${t.muted}; }
      .v2v .lg { position: absolute; left: ${m(s)}; right: ${m(s)}; top: ${m(s)}; height: 7mm; justify-content: center; }
      .v2v .site { left: ${m(s)}; right: ${m(s)}; bottom: ${m(s)}; text-align: center; color: ${t.accentInk}; font-size: 2.2mm; font-weight: 700; }
      .v2v .foot { left: 0; right: 0; bottom: 0; height: ${m(o + 1.4)}; background: ${t.accent}; }
      .v2v .slg { font-size: 2.3mm; color: ${t.ink}; }`,
      recto: `<div class="bc v2"><div class="abs top"></div>${logo(d, t, true)}${d.org.slogan ? `<div class="abs slgt">${esc(d.org.slogan)}</div>` : ''}<div class="abs who"><div class="name">${esc(d.displayName)}</div><div class="title">${esc(d.jobTitle)}</div></div>${contacts(d)}</div>`,
      verso: `<div class="bc v2v">${logo(d, t, false)}<div class="qrw">${d.vcardQrSvg ? `${vcardQr(d, 24)}${qrNote(d)}` : slogan(d)}</div>${site(d, 'abs site')}<div class="abs foot"></div></div>`,
    };
  },
};

const ligne: CardTemplateDef = {
  id: 'visite-v-ligne',
  kind: 'business',
  orientation: 'vertical',
  version: V,
  name: 'Ligne',
  description: 'Prénom et nom sur deux lignes, filet latéral ; verso sombre.',
  displayFont: 'manrope',
  render(d, t, f) {
    const { o, s, H } = box(f);
    const fs = fitSize(d.firstName, 4.6, 3, 0.16, 10);
    const ls = fitSize(d.lastName, 4.6, 3, 0.16, 10);
    return {
      css: `${common(t)}
      .v3 .rule { left: ${m(o + 2.4)}; top: ${m(s)}; height: 22mm; width: 0.9mm; background: ${t.accent}; }
      .v3 .who { left: ${m(s + 2.4)}; right: ${m(s)}; top: ${m(s)}; }
      .v3 .first { font-family: ${t.display}; font-size: ${m(fs)}; font-weight: 400; line-height: 1.05; }
      .v3 .last { font-family: ${t.display}; font-size: ${m(ls)}; font-weight: 800; line-height: 1.05; }
      .v3 .title { margin-top: 1.6mm; font-size: 2.3mm; }
      .v3 .ct { position: absolute; left: ${m(s + 2.4)}; right: ${m(s)}; top: ${m(o + 38)}; }
      .v3 .lg { position: absolute; left: ${m(s + 2.4)}; bottom: ${m(s)}; height: 7mm; max-width: 30mm; }
      .v3v .bg { inset: 0; background: ${t.dark}; }
      .v3v .lg { position: absolute; left: ${m(s)}; right: ${m(s)}; top: ${m(H / 2 - 14)}; height: 14mm; justify-content: center; }
      .v3v .lg { color: ${t.onDark}; }
      .v3v .slg { left: ${m(s)}; right: ${m(s)}; top: ${m(H / 2 + 3)}; text-align: center; color: ${t.onDark}; font-size: 2.4mm; }
      .v3v .qrw { position: absolute; left: 0; right: 0; bottom: ${m(s)}; display: flex; justify-content: center; }
      .v3v .site { left: ${m(s)}; right: ${m(s)}; top: ${m(s)}; text-align: center; color: ${t.onDark}; font-size: 2mm; letter-spacing: 0.3mm; opacity: 0.85; }`,
      recto: `<div class="bc v3"><div class="abs rule"></div><div class="abs who"><div class="first">${esc(d.firstName)}</div><div class="last">${esc(d.lastName)}</div><div class="title">${esc(d.jobTitle)}</div></div>${contacts(d)}${logo(d, t, false)}</div>`,
      verso: `<div class="bc v3v"><div class="abs bg"></div>${site(d, 'abs site')}${logo(d, t, true)}${slogan(d, 'abs slg')}<div class="qrw">${vcardQr(d, 15)}</div></div>`,
    };
  },
};

const tuile: CardTemplateDef = {
  id: 'visite-v-tuile',
  kind: 'business',
  orientation: 'vertical',
  version: V,
  name: 'Tuile',
  description: 'Fond teinté et tuile blanche ; verso rayé aux couleurs.',
  displayFont: null,
  render(d, t, f) {
    const { o, s, W, H } = box(f);
    const ns = fitSize(d.displayName, 3.8, 2.7, 0.09, 15);
    return {
      css: `${common(t)}
      .v4 .bg { inset: 0; background: ${t.soft}; }
      .v4 .tile { left: ${m(o + 2.5)}; right: ${m(o + 2.5)}; top: ${m(o + 2.5)}; bottom: ${m(o + 14)}; background: #ffffff; border-radius: 2mm; }
      .v4 .who { left: ${m(s + 1.5)}; right: ${m(s + 1.5)}; top: ${m(s + 2)}; }
      .v4 .name { font-size: ${m(ns)}; }
      .v4 .title { margin-top: 1mm; font-size: 2.3mm; }
      .v4 .acc { margin-top: 2.2mm; width: 7mm; height: 0.8mm; background: ${t.accent}; }
      .v4 .ct { position: absolute; left: ${m(s + 1.5)}; right: ${m(s + 1.5)}; bottom: ${m(o + 17)}; }
      .v4 .lg { position: absolute; left: ${m(s)}; right: ${m(s)}; bottom: ${m(s - 1)}; height: 6.5mm; justify-content: center; }
      .v4v .bg { inset: 0; background: repeating-linear-gradient(135deg, ${t.accent} 0, ${t.accent} 3mm, ${t.second} 3mm, ${t.second} 3.6mm); }
      .v4v .chip { left: ${m(W / 2 - 18)}; top: ${m(H / 2 - 16)}; width: 36mm; height: 32mm; background: #ffffff; border-radius: 2mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5mm; padding: 2mm; }
      .v4v .chip .lg { height: 11mm; max-width: 30mm; justify-content: center; }
      .v4v .slg { font-size: 2mm; color: ${t.ink}; text-align: center; }
      .v4v .site { left: ${m(s)}; right: ${m(s)}; bottom: ${m(s)}; text-align: center; font-size: 2.1mm; font-weight: 700; color: ${t.onAccent}; }`,
      recto: `<div class="bc v4"><div class="abs bg"></div><div class="abs tile"></div><div class="abs who"><div class="name">${esc(d.displayName)}</div><div class="title">${esc(d.jobTitle)}</div><div class="acc"></div></div>${contacts(d)}${logo(d, t, false)}</div>`,
      verso: `<div class="bc v4v"><div class="abs bg"></div><div class="abs chip">${logo(d, t, false)}${slogan(d)}</div>${site(d, 'abs site')}</div>`,
    };
  },
};

const editoB: CardTemplateDef = {
  id: 'visite-v-editorial',
  kind: 'business',
  orientation: 'vertical',
  version: V,
  name: 'Éditorial',
  description: 'Empattements, filets fins, titre en italique ; verso monogramme.',
  displayFont: 'source-serif-4',
  render(d, t, f) {
    const { o, s, H } = box(f);
    const ns = fitSize(d.displayName, 4.2, 2.9, 0.1, 15);
    return {
      css: `${common(t)}
      .v5 .t { left: ${m(s)}; right: ${m(s)}; top: ${m(s)}; height: 0.3mm; background: ${t.ink}; }
      .v5 .b { left: ${m(s)}; right: ${m(s)}; bottom: ${m(s + 9)}; height: 0.3mm; background: ${t.ink}; }
      .v5 .kick { left: ${m(s)}; right: ${m(s)}; top: ${m(s + 1.6)}; font-size: 1.7mm; letter-spacing: 0.45mm; text-transform: uppercase; color: ${t.accentInk}; font-weight: 700; }
      .v5 .who { left: ${m(s)}; right: ${m(s)}; top: ${m(o + 17)}; }
      .v5 .name { font-size: ${m(ns)}; font-weight: 600; }
      .v5 .title { margin-top: 1.4mm; font-size: 2.4mm; font-style: italic; font-weight: 400; color: ${t.accentInk}; font-family: ${t.display}; }
      .v5 .ct { position: absolute; left: ${m(s)}; right: ${m(s)}; bottom: ${m(s + 12)}; }
      .v5 .lg { position: absolute; left: ${m(s)}; bottom: ${m(s)}; height: 6.5mm; max-width: 32mm; }
      .v5v .mono { left: ${m(s)}; right: ${m(s)}; top: ${m(H / 2 - 20)}; text-align: center; font-family: ${t.display}; font-size: 22mm; font-weight: 700; color: ${t.accent}; line-height: 1; }
      .v5v .org { left: ${m(s)}; right: ${m(s)}; top: ${m(H / 2 + 5)}; text-align: center; font-family: ${t.display}; font-size: 3mm; font-weight: 600; }
      .v5v .slg { left: ${m(s)}; right: ${m(s)}; top: ${m(H / 2 + 10.5)}; text-align: center; font-size: 2.2mm; color: ${t.muted}; }
      .v5v .site { left: ${m(s)}; right: ${m(s)}; bottom: ${m(s)}; text-align: center; font-size: 2mm; letter-spacing: 0.3mm; }
      .v5v .qrw { position: absolute; left: 0; right: 0; top: ${m(s)}; display: flex; justify-content: center; }`,
      recto: `<div class="bc v5"><div class="abs t"></div><div class="abs kick">${esc(d.org.name)}</div><div class="abs who"><div class="name">${esc(d.displayName)}</div><div class="title">${esc(d.jobTitle)}</div></div>${contacts(d)}<div class="abs b"></div>${logo(d, t, false)}</div>`,
      verso: `<div class="bc v5v"><div class="qrw">${vcardQr(d, 14)}</div><div class="abs mono">${esc(d.org.initials)}</div><div class="abs org">${esc(d.org.name)}</div>${slogan(d, 'abs slg')}${site(d, 'abs site')}</div>`,
    };
  },
};

export const BUSINESS_TEMPLATES: readonly CardTemplateDef[] = [
  classique,
  filet,
  angle,
  nuit,
  bande,
  centre,
  bloc,
  ligne,
  tuile,
  editoB,
];
