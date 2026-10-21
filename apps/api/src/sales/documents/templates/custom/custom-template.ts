// Modèle sur mesure compilé et assemblage d'un rendu — ADR-0029 § 4.
//
// Le paquet ne fournit que le CONTENU du conteneur `<main class="lx-modele">`.
// Le moteur pose lui-même, HORS de ce conteneur et hors de portée du CSS du
// paquet (préfixe + `@scope`, `css-policy.ts`) :
//   - la zone haute : bandeau de test, bandeau EXEMPLE, DUPLICATA ;
//   - la zone de sécurité : « Éléments de sécurité DGI », QR code tel quel,
//     les cinq éléments et leurs libellés ;
// et `renderDocumentHtml` (template-engine.ts) ajoute le filigrane, la CSP, les
// polices, l'en-tête et le pied Chromium, puis vérifie TOUTES les mentions.
//
// Les zones du moteur sont positionnées au-dessus du conteneur (z-index) avec
// un fond blanc : même un débordement du contenu du modèle ne les recouvre pas.

import { esc } from '../../invoice-document-html.js';
import type { InvoiceDocumentModel } from '../../invoice-document.model.js';
import { DGI_LABELS } from '../dgi-content.js';
import {
  LOGO_VARIANTS,
  type PageMargins,
  type TemplateFontChoice,
  type TemplateOptions,
  type TemplateRenderInput,
  type TemplateRenderOutput,
} from '../template.contract.js';
import { LOGO_TOKEN_PREFIX, logoToken, templateDataOf } from './data-contract.js';
import { checkHtml } from './html-policy.js';
import type { TemplateManifest } from './manifest.js';
import { renderTemplate, type MustacheNode } from './mustache.js';
import { IssueList } from './report.js';

/** Identifiant figé d'un modèle sur mesure (`presentation.template.id`). */
export const CUSTOM_TEMPLATE_ID = 'sur-mesure' as const;

/**
 * Version du MOTEUR sur mesure (assemblage, zones, règles de rendu). Une
 * facture gelée la garde : la modifier, c'est publier une nouvelle version et
 * garder l'ancienne (ADR-0028 § 4, ADR-0029 § 7).
 */
export const CUSTOM_ENGINE_VERSION = '1.0.0';

/** Marges imposées : l'en-tête et le pied Chromium vivent dedans. */
export const CUSTOM_PAGE: PageMargins = { top: '12mm', bottom: '16mm', left: '0', right: '0' };

export class CustomTemplateOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomTemplateOutputError';
  }
}

/** CSS du moteur : zones DGI et conteneur. Le CSS du paquet ne l'atteint pas. */
const ENGINE_CSS = `
  .lx-modele { display: flow-root; isolation: isolate; color: #111827; font-size: 10.5px; line-height: 1.45; }
  .lx-dgi { position: relative; z-index: 2; background: #ffffff; margin: 0 12mm; font-family: Arial, Helvetica, sans-serif; color: #111111; }
  .lx-dgi-haut { display: flex; flex-direction: column; gap: 4px; }
  .lx-dgi-haut:empty { display: none; }
  .lx-dgi-haut .dgi-test-band, .lx-dgi-haut .dgi-sample-band { border: 1.5px solid #b91c1c; background: #fef2f2; color: #b91c1c; font-weight: 700; text-align: center; padding: 6px; font-size: 11px; }
  .lx-dgi-haut .dgi-sample-band { border-color: #1e40af; background: #eff6ff; color: #1e40af; }
  .lx-dgi-duplicata { align-self: flex-end; border: 1.5px solid #111111; font-weight: 800; padding: 3px 10px; letter-spacing: 1px; font-size: 12px; }
  .lx-dgi-securite { margin-top: 14px; border: 1px solid #111111; border-radius: 6px; padding: 12px 14px; display: flex; gap: 16px; align-items: center; break-inside: avoid; page-break-inside: avoid; }
  .lx-dgi-securite .qr { width: 110px; height: 110px; flex-shrink: 0; }
  .lx-dgi-titre { font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .lx-dgi-grille { display: grid; grid-template-columns: 110px 1fr; row-gap: 2px; column-gap: 8px; font-size: 10px; }
  .lx-dgi-grille .k { color: #4b5563; }
  .lx-dgi-grille .v { font-family: var(--lalanda-font-code); font-weight: 500; word-break: break-all; }
`;

/** Zone haute du moteur (vide sans test, aperçu ni duplicata). */
function topZone(m: InvoiceDocumentModel, input: TemplateRenderInput): string {
  const dup = m.duplicate ? `<div class="lx-dgi-duplicata">${esc(m.duplicate.label)}</div>` : '';
  const inner = `${input.dgi.testBand}${input.dgi.sampleBand}${dup}`;
  return inner ? `<div class="lx-dgi lx-dgi-haut">${inner}</div>` : '';
}

/** Zone de sécurité DGI du moteur (vide sans éléments de sécurité). */
function securityZone(m: InvoiceDocumentModel, input: TemplateRenderInput): string {
  const s = m.security;
  if (!s) return '';
  const rows: Array<[string, string]> = [
    [DGI_LABELS.codeDefDgi, s.codeDefDgi],
    [DGI_LABELS.nim, s.nim],
    [DGI_LABELS.counters, s.counters],
    [DGI_LABELS.dgiDateTime, s.dgiDateTime],
    [DGI_LABELS.isf, s.isf],
  ];
  return `<section class="lx-dgi lx-dgi-securite">
  <div class="qr">${input.dgi.qrSvg}</div>
  <div>
    <div class="lx-dgi-titre">${esc(DGI_LABELS.securityTitle)}</div>
    <div class="lx-dgi-grille">${rows
      .map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`)
      .join('')}</div>
  </div>
</section>`;
}

export interface CompiledCustomTemplateParts {
  packageId: string | null;
  manifest: TemplateManifest;
  digest: string;
  nodes: readonly MustacheNode[];
  /** CSS du paquet, déjà filtré et confiné. */
  css: string;
  /** `@font-face` des polices du paquet (données intégrées). */
  fontFaces: string;
  /** Images du paquet → URI `data:` (octets assainis). */
  images: ReadonlyMap<string, string>;
}

/**
 * Modèle sur mesure prêt à rendre. Même forme qu'un modèle intégré (`render`,
 * `page`, `defaults`, `fontChoices`) : il passe par `renderDocumentHtml` et son
 * vérificateur de mentions, comme les six modèles.
 */
export interface CompiledCustomTemplate {
  readonly id: typeof CUSTOM_TEMPLATE_ID;
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly defaults: TemplateOptions;
  readonly fontChoices: readonly TemplateFontChoice[];
  readonly palettes: readonly TemplateOptions['palette'][];
  readonly page: PageMargins;
  readonly manifest: TemplateManifest;
  readonly digest: string;
  readonly packageId: string | null;
  render(input: TemplateRenderInput): TemplateRenderOutput;
}

/** Libellé imprimé en pied de page (« modèle Ocre (sur mesure) 1.0.0 »). */
export function customLayoutLabel(name: string): string {
  return `${name} (sur mesure)`;
}

export function compileCustomTemplate(parts: CompiledCustomTemplateParts): CompiledCustomTemplate {
  const { manifest } = parts;
  const imagePaths = new Set(parts.images.keys());
  const render = (input: TemplateRenderInput): TemplateRenderOutput => {
    const m = input.document;
    const data = templateDataOf(m, input.brand, input.theme.mono);
    const html = renderTemplate(parts.nodes, data);
    // Re-validation de la SORTIE avant assemblage (défense en profondeur).
    const present = new Set(
      LOGO_VARIANTS.filter((v) => input.brand.logos[v]).map((v) => logoToken(v)),
    );
    const scratch = new IssueList();
    const ok = checkHtml(
      html,
      {
        mode: 'output',
        file: 'gabarit.html',
        images: imagePaths,
        allowedSrc: (s) => present.has(s),
      },
      scratch,
    );
    if (!ok) {
      throw new CustomTemplateOutputError(
        `Sortie du gabarit refusée : ${scratch.errors[0]?.message ?? 'HTML inattendu'}`,
      );
    }
    // Substitution des jetons d'image APRÈS validation (aucune donnée du document
    // ne peut produire un `src`).
    const body = html.replace(/ src="([^"]*)"/g, (_all, src: string) => {
      if (src.startsWith(LOGO_TOKEN_PREFIX)) {
        const v = src.slice(LOGO_TOKEN_PREFIX.length) as (typeof LOGO_VARIANTS)[number];
        return ` src="${input.brand.logos[v]!.dataUri}"`;
      }
      return ` src="${parts.images.get(src)!}"`;
    });
    const t = input.theme;
    const vars = `.lx-modele { --lalanda-accent: ${t.accent}; --lalanda-on-accent: ${t.onAccent}; --lalanda-soft: ${t.soft}; --lalanda-line: ${t.line}; --lalanda-side: ${t.side}; --lalanda-on-side: ${t.onSide}; --lalanda-font-body: ${t.body}; --lalanda-font-display: ${t.display}; --lalanda-font-code: ${t.code}; font-family: ${t.body}; }
  .lx-dgi { --lalanda-font-code: ${t.code}; }
  .lx-modele img { filter: ${t.logoFilter}; }`;
    return {
      css: `${ENGINE_CSS}\n${vars}\n${parts.fontFaces}\n${parts.css}`,
      body: `${topZone(m, input)}
<main class="lx-modele">
${body}
</main>
${securityZone(m, input)}`,
    };
  };
  return {
    id: CUSTOM_TEMPLATE_ID,
    version: CUSTOM_ENGINE_VERSION,
    label: customLayoutLabel(manifest.name),
    description: manifest.description,
    defaults: {
      palette: manifest.options.palettes[0]!,
      accent: manifest.options.accent.toLowerCase(),
      font: manifest.options.font as TemplateFontChoice,
    },
    fontChoices: manifest.options.fonts as TemplateFontChoice[],
    palettes: manifest.options.palettes,
    page: CUSTOM_PAGE,
    manifest,
    digest: parts.digest,
    packageId: parts.packageId,
    render,
  };
}
