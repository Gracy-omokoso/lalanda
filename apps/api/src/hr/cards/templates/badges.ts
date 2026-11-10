// Dix modèles de carte de service (5 horizontaux, 5 verticaux) — ADR-0069 § 5.
//
// CR80 : 85,60 × 53,98 mm (horizontal) ou 53,98 × 85,60 mm (vertical), sans fond
// perdu, zone de sécurité 3 mm. Chaque modèle a SA composition ; tous posent le QR
// de vérification (≥ 15 mm) et la mention « Vérifier : lalanda.co/v » au recto,
// et un verso de restitution avec un QR plus grand.

import { fitSize } from '../card-model.js';
import {
  badgeVerso,
  badgeVersoCss,
  baseCss,
  esc,
  logo,
  m,
  matricule,
  photo,
  verifyQr,
  type CardTemplateDef,
} from './parts.js';

// 1.1.0 (10 nov. 2026, ADR-0073) : logo selon le choix unique de l'organisation ;
// nom de marque retiré à côté du logo quand un logo est imprimé ; motif de fond.
const V = '1.1.0';

const nameHtml = (first: string, last: string) =>
  `${esc(first)} <b>${esc(last.toLocaleUpperCase('fr'))}</b>`;

// ── Horizontaux ─────────────────────────────────────────────────────────────

const bandeau: CardTemplateDef = {
  id: 'badge-h-bandeau',
  kind: 'badge',
  orientation: 'horizontal',
  version: V,
  name: 'Bandeau',
  description: 'Bandeau de marque en tête, photo à gauche, QR en bas à droite.',
  displayFont: null,
  render(d, t, f) {
    const ns = fitSize(d.displayName, 4.1, 2.9, 0.09, 18);
    return {
      css: `${baseCss(t)}${badgeVersoCss(t, f)}
      .t1 .band { left: 0; top: 0; right: 0; height: 12.5mm; background: ${t.accent}; display: flex; align-items: center; justify-content: space-between; padding: 0 3mm; gap: 3mm; }
      .t1 .band .lg { height: 7mm; max-width: 40mm; }
      .t1 .band .lg { color: ${t.onAccent}; }
      .t1 .band .kicker { color: ${t.onAccent}; font-size: 1.7mm; letter-spacing: 0.35mm; text-transform: uppercase; font-weight: 600; text-align: right; }
      .t1 .ph { left: 3mm; top: 15.5mm; width: 20.5mm; height: 25.5mm; border-radius: 1.4mm; }
      .t1 .ph-none span { font-size: 7mm; }
      .t1 .who { left: 27mm; top: 16mm; width: 36mm; }
      .t1 .name { font-family: ${t.display}; font-size: ${m(ns)}; font-weight: 500; line-height: 1.08; }
      .t1 .name b { font-weight: 800; }
      .t1 .title { margin-top: 1.4mm; font-size: 2.55mm; font-weight: 600; color: ${t.accentInk}; }
      .t1 .dept { margin-top: 0.8mm; font-size: 2.05mm; color: ${t.muted}; }
      .t1 .mat { left: 3mm; bottom: 3mm; }
      .t1 .qr { right: 3mm; bottom: 3mm; position: absolute; }
      .t1 .vfy { right: 21.4mm; bottom: 3mm; text-align: right; color: ${t.muted}; }
      .t1 .rule { left: 27mm; top: 45mm; width: 36mm; height: 0.35mm; background: ${t.line}; }`,
      recto: `<div class="t1">
        <div class="abs band">${logo(d, t, true)}<div class="kicker">Carte de service</div></div>
        <div class="abs">${photo(d, 'ph abs')}</div>
        <div class="abs who"><div class="name">${nameHtml(d.firstName, d.lastName)}</div><div class="title">${esc(d.jobTitle)}</div>${d.department ? `<div class="dept">${esc(d.department)}</div>` : ''}</div>
        ${matricule(d, 'mat abs')}
        <div class="abs vfy">Vérifier<br/><b>${esc(d.verifyLabel)}</b></div>
        ${verifyQr(d, 16.5)}
      </div>`,
      verso: badgeVerso(d, t, f, 'band'),
    };
  },
};

const colonne: CardTemplateDef = {
  id: 'badge-h-colonne',
  kind: 'badge',
  orientation: 'horizontal',
  version: V,
  name: 'Colonne',
  description: 'Colonne de couleur portant la photo, identité sur fond clair.',
  displayFont: null,
  render(d, t, f) {
    const ns = fitSize(d.displayName, 4.4, 3, 0.1, 16);
    return {
      css: `${baseCss(t)}${badgeVersoCss(t, f)}
      .t2 .col { left: 0; top: 0; bottom: 0; width: 29mm; background: ${t.accent}; }
      .t2 .ph { left: 4mm; top: 5mm; width: 21mm; height: 26mm; border-radius: 1mm; border: 0.6mm solid #ffffff; }
      .t2 .ph-none { background: ${t.dark}; color: ${t.onDark}; }
      .t2 .ph-none span { font-size: 7mm; }
      .t2 .colmat { left: 2.5mm; width: 24mm; top: 34mm; color: ${t.onAccent}; text-align: center; }
      .t2 .colmat .mat span { opacity: 0.8; }
      .t2 .colkick { left: 2.5mm; width: 24mm; bottom: 3mm; color: ${t.onAccent}; text-align: center; font-size: 1.6mm; letter-spacing: 0.35mm; text-transform: uppercase; font-weight: 700; }
      .t2 .lg { left: 33mm; top: 3.5mm; height: 7mm; max-width: 34mm; position: absolute; }
      .t2 .who { left: 33mm; top: 15mm; right: 3mm; }
      .t2 .name { font-family: ${t.display}; font-size: ${m(ns)}; font-weight: 800; line-height: 1.05; }
      .t2 .title { margin-top: 1.5mm; font-size: 2.5mm; color: ${t.accentInk}; font-weight: 600; }
      .t2 .dept { margin-top: 0.8mm; font-size: 2mm; color: ${t.muted}; }
      .t2 .qr { position: absolute; right: 3mm; bottom: 3mm; }
      .t2 .vfy { left: 33mm; bottom: 3mm; color: ${t.muted}; }
      .t2 .bar { left: 33mm; top: 13mm; width: 8mm; height: 0.6mm; background: ${t.second}; }`,
      recto: `<div class="t2">
        <div class="abs col"></div>
        ${photo(d, 'ph abs')}
        <div class="abs colmat">${matricule(d)}</div>
        <div class="abs colkick">Carte de service</div>
        ${logo(d, t, false)}
        <div class="abs bar"></div>
        <div class="abs who"><div class="name">${esc(d.firstName)}<br/>${esc(d.lastName.toLocaleUpperCase('fr'))}</div><div class="title">${esc(d.jobTitle)}</div>${d.department ? `<div class="dept">${esc(d.department)}</div>` : ''}</div>
        <div class="abs vfy">Vérifier : <b>${esc(d.verifyLabel)}</b></div>
        ${verifyQr(d, 16)}
      </div>`,
      verso: badgeVerso(d, t, f, 'side'),
    };
  },
};

const diagonale: CardTemplateDef = {
  id: 'badge-h-diagonale',
  kind: 'badge',
  orientation: 'horizontal',
  version: V,
  name: 'Diagonale',
  description: 'Pan de couleur en biais, photo ronde, QR et matricule en pied.',
  displayFont: null,
  render(d, t, f) {
    const ns = fitSize(d.displayName, 4.2, 2.9, 0.1, 16);
    return {
      css: `${baseCss(t)}${badgeVersoCss(t, f)}
      .t3 .pan { inset: 0; background: ${t.accent}; clip-path: polygon(62% 0, 100% 0, 100% 100%, 44% 100%); }
      .t3 .pan2 { inset: 0; background: ${t.second}; clip-path: polygon(58% 0, 62% 0, 44% 100%, 40% 100%); }
      .t3 .ph { right: 7mm; top: 9mm; width: 25mm; height: 25mm; border-radius: 50%; border: 0.8mm solid #ffffff; }
      .t3 .ph-none { background: ${t.dark}; color: ${t.onDark}; }
      .t3 .ph-none span { font-size: 8mm; }
      .t3 .lg { position: absolute; left: 3mm; top: 3mm; height: 6.5mm; max-width: 32mm; }
      .t3 .who { left: 3mm; top: 13.5mm; width: 40mm; }
      .t3 .name { font-family: ${t.display}; font-size: ${m(ns)}; font-weight: 800; line-height: 1.06; }
      .t3 .title { margin-top: 1.3mm; font-size: 2.45mm; color: ${t.accentInk}; font-weight: 600; }
      .t3 .dept { margin-top: 0.7mm; font-size: 2mm; color: ${t.muted}; }
      .t3 .qr { position: absolute; left: 3mm; bottom: 3mm; }
      .t3 .foot { left: 20.5mm; bottom: 3mm; width: 22mm; color: ${t.muted}; }
      .t3 .foot .mat { color: ${t.ink}; margin-bottom: 0.8mm; }
      .t3 .kick { right: 3mm; bottom: 3mm; color: ${t.onAccent}; font-size: 1.7mm; letter-spacing: 0.35mm; text-transform: uppercase; font-weight: 700; text-align: right; }`,
      recto: `<div class="t3">
        <div class="abs pan"></div><div class="abs pan2"></div>
        ${photo(d, 'ph abs')}
        ${logo(d, t, false)}
        <div class="abs who"><div class="name">${nameHtml(d.firstName, d.lastName)}</div><div class="title">${esc(d.jobTitle)}</div>${d.department ? `<div class="dept">${esc(d.department)}</div>` : ''}</div>
        ${verifyQr(d, 16)}
        <div class="abs foot">${matricule(d)}<div class="vfy">Vérifier<br/><b>${esc(d.verifyLabel)}</b></div></div>
        <div class="abs kick">Carte de service</div>
      </div>`,
      verso: badgeVerso(d, t, f, 'plain'),
    };
  },
};

const sobre: CardTemplateDef = {
  id: 'badge-h-sobre',
  kind: 'badge',
  orientation: 'horizontal',
  version: V,
  name: 'Sobre',
  description: 'Blanc, filet de marque, typographie dominante ; photo et QR en colonne.',
  displayFont: null,
  render(d, t, f) {
    const ns = fitSize(d.displayName, 5, 3.2, 0.12, 14);
    return {
      css: `${baseCss(t)}${badgeVersoCss(t, f)}
      .t4 .rule { left: 0; top: 0; right: 0; height: 1.3mm; background: ${t.accent}; }
      .t4 .lg { position: absolute; left: 3mm; top: 4.3mm; height: 6.5mm; max-width: 38mm; }
      .t4 .ph { right: 3mm; top: 4.3mm; width: 17mm; height: 21mm; border-radius: 0.8mm; }
      .t4 .ph-none span { font-size: 6mm; }
      .t4 .qr { position: absolute; right: 3.5mm; bottom: 3mm; }
      .t4 .who { left: 3mm; top: 17mm; width: 58mm; }
      .t4 .kick { font-size: 1.65mm; letter-spacing: 0.4mm; text-transform: uppercase; color: ${t.muted}; margin-bottom: 1.2mm; }
      .t4 .name { font-family: ${t.display}; font-size: ${m(ns)}; font-weight: 700; line-height: 1.04; letter-spacing: -0.05mm; }
      .t4 .title { margin-top: 1.4mm; font-size: 2.6mm; color: ${t.accentInk}; font-weight: 600; }
      .t4 .foot { left: 3mm; bottom: 3mm; width: 58mm; display: flex; justify-content: space-between; align-items: flex-end; gap: 2mm; padding-top: 1.2mm; border-top: 0.3mm solid ${t.line}; }
      .t4 .foot .dept { font-size: 2mm; color: ${t.muted}; }
      .t4 .vfy { color: ${t.muted}; text-align: right; }`,
      recto: `<div class="t4">
        <div class="abs rule"></div>
        ${logo(d, t, false)}
        ${photo(d, 'ph abs')}
        <div class="abs who"><div class="kick">Carte de service</div><div class="name">${esc(d.displayName)}</div><div class="title">${esc(d.jobTitle)}</div></div>
        <div class="abs foot"><div>${d.department ? `<div class="dept">${esc(d.department)}</div>` : ''}${matricule(d)}</div><div class="vfy">Vérifier<br/><b>${esc(d.verifyLabel)}</b></div></div>
        ${verifyQr(d, 15.5)}
      </div>`,
      verso: badgeVerso(d, t, f, 'frame'),
    };
  },
};

const plein: CardTemplateDef = {
  id: 'badge-h-plein',
  kind: 'badge',
  orientation: 'horizontal',
  version: V,
  name: 'Plein fond',
  description: 'Fond plein sombre de marque, monogramme en filigrane, QR sur tuile blanche.',
  displayFont: null,
  render(d, t, f) {
    const ns = fitSize(d.displayName, 4.3, 3, 0.1, 16);
    return {
      css: `${baseCss(t)}${badgeVersoCss(t, f)}
      .t5 .bg { inset: 0; background: ${t.dark}; }
      .t5 .wm { right: -6mm; top: -9mm; font-family: ${t.display}; font-weight: 800; font-size: 46mm; line-height: 1; color: ${t.accent}; opacity: 0.35; letter-spacing: -1mm; }
      .t5 .ph { left: 3mm; top: 3mm; width: 22mm; height: 27.5mm; border-radius: 1.6mm; border: 0.7mm solid #ffffff; }
      .t5 .ph-none { background: ${t.accent}; color: ${t.onAccent}; }
      .t5 .ph-none span { font-size: 7mm; }
      .t5 .lg { position: absolute; right: 3mm; top: 3mm; height: 7mm; max-width: 30mm; }
      .t5 .lg { color: ${t.onDark}; }
      .t5 .who { left: 28.5mm; top: 13mm; width: 36mm; color: ${t.onDark}; }
      .t5 .name { font-family: ${t.display}; font-size: ${m(ns)}; font-weight: 500; line-height: 1.07; }
      .t5 .name b { font-weight: 800; }
      .t5 .title { margin-top: 1.4mm; font-size: 2.45mm; font-weight: 600; color: ${t.onDark}; opacity: 0.9; }
      .t5 .dept { margin-top: 0.7mm; font-size: 2mm; color: ${t.onDark}; opacity: 0.75; }
      .t5 .chip { position: absolute; right: 3mm; bottom: 3mm; background: #ffffff; border-radius: 1.4mm; padding: 0.6mm; }
      .t5 .foot { left: 3mm; bottom: 3mm; color: ${t.onDark}; }
      .t5 .foot .vfy { margin-top: 0.8mm; opacity: 0.85; }
      .t5 .stripe { left: 28.5mm; top: 10mm; width: 9mm; height: 0.7mm; background: ${t.accent}; }`,
      recto: `<div class="t5">
        <div class="abs bg"></div>
        <div class="abs wm">${esc(d.org.initials)}</div>
        ${photo(d, 'ph abs')}
        ${logo(d, t, true)}
        <div class="abs stripe"></div>
        <div class="abs who"><div class="name">${nameHtml(d.firstName, d.lastName)}</div><div class="title">${esc(d.jobTitle)}</div>${d.department ? `<div class="dept">${esc(d.department)}</div>` : ''}</div>
        <div class="abs foot">${matricule(d)}<div class="vfy">Carte de service · Vérifier : <b>${esc(d.verifyLabel)}</b></div></div>
        <div class="chip">${verifyQr(d, 15.5)}</div>
      </div>`,
      verso: badgeVerso(d, t, f, 'dark'),
    };
  },
};

// ── Verticaux ───────────────────────────────────────────────────────────────

const arche: CardTemplateDef = {
  id: 'badge-v-arche',
  kind: 'badge',
  orientation: 'vertical',
  version: V,
  name: 'Arche',
  description: 'En-tête arrondi de marque, photo ronde qui le chevauche, composition centrée.',
  displayFont: null,
  render(d, t, f) {
    const ns = fitSize(d.displayName, 4, 2.8, 0.09, 16);
    return {
      css: `${baseCss(t)}${badgeVersoCss(t, f)}
      .t6 .arch { left: -6mm; right: -6mm; top: -2mm; height: 34mm; background: ${t.accent}; border-radius: 0 0 50% 50% / 0 0 9mm 9mm; }
      .t6 .lg { position: absolute; left: 6mm; right: 6mm; top: 4mm; height: 7mm; justify-content: center; }
      .t6 .lg { color: ${t.onAccent}; }
      .t6 .kick { left: 3mm; right: 3mm; top: 12.5mm; text-align: center; color: ${t.onAccent}; font-size: 1.6mm; letter-spacing: 0.4mm; text-transform: uppercase; font-weight: 700; }
      .t6 .ph { left: 13.5mm; top: 17mm; width: 27mm; height: 27mm; border-radius: 50%; border: 0.9mm solid #ffffff; }
      .t6 .ph-none span { font-size: 9mm; }
      .t6 .who { left: 3mm; right: 3mm; top: 47mm; text-align: center; }
      .t6 .name { font-family: ${t.display}; font-size: ${m(ns)}; font-weight: 800; line-height: 1.08; }
      .t6 .title { margin-top: 1.3mm; font-size: 2.45mm; color: ${t.accentInk}; font-weight: 600; }
      .t6 .dept { margin-top: 0.6mm; font-size: 1.95mm; color: ${t.muted}; }
      .t6 .qr { position: absolute; right: 3mm; bottom: 3mm; }
      .t6 .foot { left: 3mm; bottom: 3mm; width: 30mm; color: ${t.muted}; }
      .t6 .foot .mat { color: ${t.ink}; margin-bottom: 1mm; }`,
      recto: `<div class="t6">
        <div class="abs arch"></div>
        ${logo(d, t, true)}
        <div class="abs kick">Carte de service</div>
        ${photo(d, 'ph abs')}
        <div class="abs who"><div class="name">${esc(d.displayName)}</div><div class="title">${esc(d.jobTitle)}</div>${d.department ? `<div class="dept">${esc(d.department)}</div>` : ''}</div>
        <div class="abs foot">${matricule(d)}<div class="vfy">Vérifier cette carte<br/><b>${esc(d.verifyLabel)}</b></div></div>
        ${verifyQr(d, 16)}
      </div>`,
      verso: badgeVerso(d, t, f, 'band'),
    };
  },
};

const cordon: CardTemplateDef = {
  id: 'badge-v-cordon',
  kind: 'badge',
  orientation: 'vertical',
  version: V,
  name: 'Cordon',
  description: 'Fente de cordon, grande photo, bloc de couleur portant nom et QR.',
  displayFont: null,
  render(d, t, f) {
    const ns = fitSize(d.displayName, 3.7, 2.7, 0.08, 16);
    return {
      css: `${baseCss(t)}${badgeVersoCss(t, f)}
      .t7 .slot { left: 20.5mm; top: 3mm; width: 13mm; height: 2.4mm; border-radius: 1.2mm; border: 0.3mm solid ${t.line}; background: ${t.soft}; }
      .t7 .lg { position: absolute; left: 4mm; right: 4mm; top: 7.5mm; height: 5.5mm; justify-content: center; }
      .t7 .ph { left: 10mm; top: 15mm; width: 34mm; height: 36mm; border-radius: 1.6mm; }
      .t7 .ph-none span { font-size: 11mm; }
      .t7 .block { left: 0; right: 0; bottom: 0; height: 32mm; background: ${t.accent}; color: ${t.onAccent}; }
      .t7 .who { left: 3mm; right: 20mm; top: 56.5mm; color: ${t.onAccent}; }
      .t7 .name { font-family: ${t.display}; font-size: ${m(ns)}; font-weight: 800; line-height: 1.08; }
      .t7 .title { margin-top: 1.1mm; font-size: 2.25mm; font-weight: 600; opacity: 0.92; }
      .t7 .dept { margin-top: 0.5mm; font-size: 1.9mm; opacity: 0.8; }
      .t7 .chip { position: absolute; right: 3mm; bottom: 3mm; background: #ffffff; border-radius: 1mm; padding: 0.5mm; }
      .t7 .foot { left: 3mm; bottom: 3mm; right: 20mm; color: ${t.onAccent}; }
      .t7 .foot .vfy { margin-top: 0.8mm; opacity: 0.9; }
      .t7 .kick { right: 3mm; top: 56.5mm; width: 16mm; text-align: center; color: ${t.onAccent}; font-size: 1.45mm; letter-spacing: 0.3mm; text-transform: uppercase; font-weight: 700; }`,
      recto: `<div class="t7">
        <div class="abs slot"></div>
        ${logo(d, t, false)}
        ${photo(d, 'ph abs')}
        <div class="abs block"></div>
        <div class="abs who"><div class="name">${esc(d.firstName)}<br/>${esc(d.lastName.toLocaleUpperCase('fr'))}</div><div class="title">${esc(d.jobTitle)}</div>${d.department ? `<div class="dept">${esc(d.department)}</div>` : ''}</div>
        <div class="abs kick">Carte de service</div>
        <div class="abs foot">${matricule(d)}<div class="vfy">Vérifier : <b>${esc(d.verifyLabel)}</b></div></div>
        <div class="chip">${verifyQr(d, 15.5)}</div>
      </div>`,
      verso: badgeVerso(d, t, f, 'plain'),
    };
  },
};

const cadre: CardTemplateDef = {
  id: 'badge-v-cadre',
  kind: 'badge',
  orientation: 'vertical',
  version: V,
  name: 'Cadre',
  description: 'Double cadre de marque, composition officielle centrée.',
  displayFont: 'source-serif-4',
  render(d, t, f) {
    const ns = fitSize(d.displayName, 3.8, 2.7, 0.08, 16);
    return {
      css: `${baseCss(t)}${badgeVersoCss(t, f)}
      .t8 .fr1 { inset: 1.6mm; border: 0.8mm solid ${t.accent}; border-radius: 1.6mm; }
      .t8 .fr2 { inset: 3.1mm; border: 0.2mm solid ${t.line}; border-radius: 0.8mm; }
      .t8 .lg { position: absolute; left: 6mm; right: 6mm; top: 5.5mm; height: 6mm; justify-content: center; }
      .t8 .kick { left: 4mm; right: 4mm; top: 12.8mm; text-align: center; font-family: ${t.display}; font-size: 1.9mm; letter-spacing: 0.5mm; text-transform: uppercase; color: ${t.accentInk}; font-weight: 700; }
      .t8 .ph { left: 14.5mm; top: 16.5mm; width: 25mm; height: 30mm; border-radius: 0.6mm; border: 0.3mm solid ${t.line}; }
      .t8 .ph-none span { font-size: 8mm; }
      .t8 .who { left: 4.5mm; right: 4.5mm; top: 48.5mm; text-align: center; }
      .t8 .name { font-family: ${t.display}; font-size: ${m(ns)}; font-weight: 700; line-height: 1.08; }
      .t8 .title { margin-top: 1.1mm; font-size: 2.3mm; color: ${t.accentInk}; font-weight: 600; }
      .t8 .dept { margin-top: 0.5mm; font-size: 1.9mm; color: ${t.muted}; }
      .t8 .qr { position: absolute; right: 5mm; bottom: 5mm; }
      .t8 .foot { left: 5mm; bottom: 5mm; width: 25mm; color: ${t.muted}; }
      .t8 .foot .mat { color: ${t.ink}; margin-bottom: 1mm; }`,
      recto: `<div class="t8">
        <div class="abs fr1"></div><div class="abs fr2"></div>
        ${logo(d, t, false)}
        <div class="abs kick">Carte de service</div>
        ${photo(d, 'ph abs')}
        <div class="abs who"><div class="name">${esc(d.displayName)}</div><div class="title">${esc(d.jobTitle)}</div>${d.department ? `<div class="dept">${esc(d.department)}</div>` : ''}</div>
        <div class="abs foot">${matricule(d)}<div class="vfy">Vérifier<br/><b>${esc(d.verifyLabel)}</b></div></div>
        ${verifyQr(d, 15)}
      </div>`,
      verso: badgeVerso(d, t, f, 'frame'),
    };
  },
};

const partage: CardTemplateDef = {
  id: 'badge-v-partage',
  kind: 'badge',
  orientation: 'vertical',
  version: V,
  name: 'Partage',
  description: 'Moitié haute de couleur, photo carrée à cheval, texte aligné à gauche.',
  displayFont: null,
  render(d, t, f) {
    const ns = fitSize(d.displayName, 4.2, 2.9, 0.1, 15);
    return {
      css: `${baseCss(t)}${badgeVersoCss(t, f)}
      .t9 .top { left: 0; right: 0; top: 0; height: 38mm; background: ${t.accent}; }
      .t9 .top2 { left: 0; top: 38mm; width: 18mm; height: 1.2mm; background: ${t.second}; }
      .t9 .lg { position: absolute; left: 3mm; top: 3.5mm; height: 7mm; max-width: 34mm; }
      .t9 .lg { color: ${t.onAccent}; }
      .t9 .kick { left: 3mm; top: 13mm; color: ${t.onAccent}; font-size: 1.65mm; letter-spacing: 0.4mm; text-transform: uppercase; font-weight: 700; }
      .t9 .ph { left: 3mm; top: 21mm; width: 25mm; height: 27mm; border-radius: 1.2mm; border: 0.8mm solid #ffffff; }
      .t9 .ph-none { background: ${t.dark}; color: ${t.onDark}; }
      .t9 .ph-none span { font-size: 8mm; }
      .t9 .who { left: 3mm; right: 3mm; top: 51mm; }
      .t9 .name { font-family: ${t.display}; font-size: ${m(ns)}; font-weight: 800; line-height: 1.06; }
      .t9 .title { margin-top: 1.2mm; font-size: 2.4mm; color: ${t.accentInk}; font-weight: 600; }
      .t9 .dept { margin-top: 0.5mm; font-size: 1.95mm; color: ${t.muted}; }
      .t9 .qr { position: absolute; right: 3mm; bottom: 3mm; }
      .t9 .foot { left: 3mm; bottom: 3mm; width: 30mm; color: ${t.muted}; }
      .t9 .foot .mat { color: ${t.ink}; margin-bottom: 1mm; }
      .t9 .side { right: 3mm; top: 22mm; width: 19mm; color: ${t.onAccent}; font-size: 1.8mm; line-height: 1.3; text-align: right; }`,
      recto: `<div class="t9">
        <div class="abs top"></div><div class="abs top2"></div>
        ${logo(d, t, true)}
        <div class="abs kick">Carte de service</div>
        ${photo(d, 'ph abs')}
        <div class="abs side">${d.org.logo ? '' : esc(d.org.name)}</div>
        <div class="abs who"><div class="name">${esc(d.firstName)}<br/>${esc(d.lastName.toLocaleUpperCase('fr'))}</div><div class="title">${esc(d.jobTitle)}</div>${d.department ? `<div class="dept">${esc(d.department)}</div>` : ''}</div>
        <div class="abs foot">${matricule(d)}<div class="vfy">Vérifier<br/><b>${esc(d.verifyLabel)}</b></div></div>
        ${verifyQr(d, 15.5)}
      </div>`,
      verso: badgeVerso(d, t, f, 'side'),
    };
  },
};

const editoV: CardTemplateDef = {
  id: 'badge-v-editorial',
  kind: 'badge',
  orientation: 'vertical',
  version: V,
  name: 'Éditorial',
  description: 'Nom de l’organisation en marge verticale, grand nom à empattements.',
  displayFont: 'fraunces',
  render(d, t, f) {
    const fs = fitSize(d.firstName, 4.4, 3, 0.15, 10);
    const ls = fitSize(d.lastName, 4.6, 2.9, 0.17, 9);
    return {
      css: `${baseCss(t)}${badgeVersoCss(t, f)}
      .t10 .margin { left: 0; top: 0; bottom: 0; width: 9mm; background: ${t.accent}; }
      .t10 .vert { left: 1.4mm; top: 3mm; bottom: 3mm; width: 6.2mm; writing-mode: vertical-rl; transform: rotate(180deg); color: ${t.onAccent}; font-family: ${t.display}; font-size: 2.6mm; letter-spacing: 0.3mm; display: flex; align-items: center; justify-content: flex-start; white-space: nowrap; overflow: hidden; }
      .t10 .ph { left: 12mm; top: 3mm; width: 39mm; height: 33mm; border-radius: 0.6mm; }
      .t10 .ph-none span { font-size: 11mm; }
      .t10 .who { left: 12mm; right: 3mm; top: 38.5mm; }
      .t10 .first { font-family: ${t.display}; font-size: ${m(fs)}; font-weight: 400; line-height: 1.05; }
      .t10 .last { font-family: ${t.display}; font-size: ${m(ls)}; font-weight: 700; line-height: 1.05; letter-spacing: 0.1mm; }
      .t10 .title { margin-top: 1.4mm; font-size: 2.35mm; font-style: italic; color: ${t.accentInk}; }
      .t10 .dept { margin-top: 0.4mm; font-size: 1.9mm; color: ${t.muted}; }
      .t10 .hr { left: 12mm; width: 12mm; top: 37mm; height: 0.5mm; background: ${t.second}; }
      .t10 .lg { position: absolute; left: 12mm; bottom: 3mm; height: 5.5mm; max-width: 22mm; }
      .t10 .mono-name { font-size: 1.9mm; max-width: 15mm; }
      .t10 .mono-mark { min-width: 5.5mm; height: 5.5mm; font-size: 2.2mm; }
      .t10 .qr { position: absolute; right: 3mm; bottom: 3mm; }
      .t10 .mid { left: 12mm; bottom: 10.5mm; width: 24mm; color: ${t.muted}; }
      .t10 .mid .mat { color: ${t.ink}; margin-bottom: 0.8mm; }`,
      recto: `<div class="t10">
        <div class="abs margin"></div>
        <div class="abs vert">${d.org.logo ? '' : `${esc(d.org.name)} · `}Carte de service</div>
        ${photo(d, 'ph abs')}
        <div class="abs hr"></div>
        <div class="abs who"><div class="first">${esc(d.firstName)}</div><div class="last">${esc(d.lastName.toLocaleUpperCase('fr'))}</div><div class="title">${esc(d.jobTitle)}</div>${d.department ? `<div class="dept">${esc(d.department)}</div>` : ''}</div>
        <div class="abs mid">${matricule(d)}<div class="vfy">Vérifier : <b>${esc(d.verifyLabel)}</b></div></div>
        ${logo(d, t, false)}
        ${verifyQr(d, 15.5)}
      </div>`,
      verso: badgeVerso(d, t, f, 'side'),
    };
  },
};

export const BADGE_TEMPLATES: readonly CardTemplateDef[] = [
  bandeau,
  colonne,
  diagonale,
  sobre,
  plein,
  arche,
  cordon,
  cadre,
  partage,
  editoV,
];
