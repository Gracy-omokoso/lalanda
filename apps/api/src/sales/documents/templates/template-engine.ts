// Moteur de rendu des modèles de facture — ADR-0028 § 2 et § 3.
//
// Il assemble ce qu'aucun modèle ne décide : CSP (aucun script, aucune
// ressource hors `data:`), polices intégrées, filigrane de test ou d'exemple,
// bandeaux imposés, en-tête et pied répétés sur chaque page. Puis il VÉRIFIE
// que le HTML porte toutes les mentions du document (`dgi-content.ts`) ; à
// défaut, rien n'est imprimé.
//
// `presentation === null` : présentation d'origine (`invoice-document-html.ts`,
// gabarit 1.0.0), octet pour octet celle d'avant les modèles — c'est elle qui
// imprime les documents gelés sans champ `presentation`.

import {
  esc,
  invoiceFooterTemplate,
  invoiceHeaderTemplate,
  renderInvoiceDocumentHtml,
  safeSvg,
} from '../invoice-document-html.js';
import type { InvoiceDocumentModel } from '../invoice-document.model.js';
import {
  TemplateDgiContentError,
  missingMentions,
  missingRepeatedMentions,
} from './dgi-content.js';
import { fontFacesCss } from './invoice-fonts.js';
import { themeOf } from './theme.js';
import {
  LOGO_VARIANTS,
  type FrozenIdentity,
  type InvoiceTemplate,
  type LogoVariant,
  type PageMargins,
  type RenderLogo,
  type TemplateOptions,
} from './template.contract.js';

/** Marges de la présentation d'origine (inchangées). */
export const LEGACY_PAGE_MARGIN: PageMargins = {
  top: '16mm',
  bottom: '18mm',
  left: '12mm',
  right: '12mm',
};

/**
 * Ce que le moteur attend d'un modèle : un modèle intégré (`InvoiceTemplate`)
 * ou un modèle sur mesure compilé (`custom/custom-template.ts`, ADR-0029).
 */
export type RenderableTemplate = Pick<InvoiceTemplate, 'version' | 'page' | 'render'> & {
  readonly id: string;
};

/** Présentation résolue d'un rendu : modèle, options figées ou courantes, logos intégrés. */
export interface ResolvedPresentation {
  template: RenderableTemplate;
  options: TemplateOptions;
  identity: FrozenIdentity;
  logos: Record<LogoVariant, RenderLogo | null>;
}

export interface RenderedDocumentHtml {
  html: string;
  headerTemplate: string;
  footerTemplate: string;
  margin: PageMargins;
}

const DATA_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const BASE_CSS = `
  @page { size: A4; }
  * { box-sizing: border-box; }
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .dgi-watermark { position: fixed; top: 38%; left: 0; right: 0; text-align: center; font-family: Arial, sans-serif; font-size: 150pt; font-weight: 800; letter-spacing: 12pt; color: rgba(185, 28, 28, 0.13); transform: rotate(-30deg); z-index: 1000; pointer-events: none; }
  .dgi-watermark.sample { font-size: 110pt; color: rgba(30, 64, 175, 0.12); }
`;

/** Initiales du vendeur (deux premiers mots), à défaut de logo. */
export function initialsOf(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w !== '');
  const s = words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return s === '' ? '·' : s;
}

function checkedLogos(
  logos: Record<LogoVariant, RenderLogo | null>,
): Record<LogoVariant, RenderLogo | null> {
  const out = {} as Record<LogoVariant, RenderLogo | null>;
  for (const v of LOGO_VARIANTS) {
    const l = logos[v];
    if (l && !DATA_URI.test(l.dataUri)) throw new Error(`Logo « ${v} » : URI de données refusée.`);
    out[v] = l ?? null;
  }
  return out;
}

/**
 * HTML imprimé d'un document. Déterministe : même document, même présentation
 * (figée), mêmes octets de logo ⇒ même HTML. Lève `TemplateDgiContentError` si
 * une mention exigée manque.
 */
export function renderDocumentHtml(
  m: InvoiceDocumentModel,
  qrSvg: string | null,
  presentation: ResolvedPresentation | null,
): RenderedDocumentHtml {
  const headerTemplate = invoiceHeaderTemplate(m);
  const footerTemplate = invoiceFooterTemplate(m);
  if (presentation === null) {
    if (m.sample)
      throw new Error('Un aperçu fictif s’imprime avec un modèle, pas la présentation d’origine.');
    return {
      html: renderInvoiceDocumentHtml(m, qrSvg),
      headerTemplate,
      footerTemplate,
      margin: LEGACY_PAGE_MARGIN,
    };
  }

  const { template, options, identity } = presentation;
  const theme = themeOf(options, identity);
  const qr = m.security ? safeSvg(qrSvg ?? '') : '';
  const out = template.render({
    document: m,
    dgi: {
      testBand: m.test ? `<div class="dgi-test-band">${esc(m.test.banner)}</div>` : '',
      sampleBand: m.sample ? `<div class="dgi-sample-band">${esc(m.sample.banner)}</div>` : '',
      qrSvg: qr,
    },
    brand: { logos: checkedLogos(presentation.logos), initials: initialsOf(m.seller.title) },
    theme,
    options,
  });
  // Filigrane imposé, AU-DESSUS du contenu (un aplat de couleur ne le masque pas).
  const watermark =
    (m.test ? `<div class="dgi-watermark">${esc(m.test.mark)}</div>` : '') +
    (m.sample
      ? `<div class="dgi-watermark sample"${m.test ? ' style="top:62%"' : ''}>${esc(m.sample.mark)}</div>`
      : '');

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" />
  <title>${esc(m.title)} — ${esc(m.reference.value)}</title>
  <style>${BASE_CSS}
${fontFacesCss(theme.fonts)}
${out.css}</style>
</head>
<body data-template="${esc(template.id)}@${esc(template.version)}">
${out.body}
${watermark}
</body>
</html>`;

  const missing = [
    ...missingMentions(m, html, m.security ? qr : null),
    ...missingRepeatedMentions(m, headerTemplate, footerTemplate),
  ];
  if (missing.length > 0) throw new TemplateDgiContentError(template.id, missing);
  return { html, headerTemplate, footerTemplate, margin: template.page };
}
