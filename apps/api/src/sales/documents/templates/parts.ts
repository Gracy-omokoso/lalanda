// Morceaux de HTML partagés par les modèles de facture — ADR-0028 § 3.
//
// Chaque valeur du document passe par `esc` (le PDF est rendu par Chromium ; un
// nom de client ne doit jamais devenir du HTML) et est écrite D'UN SEUL TENANT :
// le vérificateur de contenu (`dgi-content.ts`) cherche chaque mention, échappée,
// telle quelle.

import { esc } from '../invoice-document-html.js';
import type { DocumentLine, InvoiceDocumentModel } from '../invoice-document.model.js';
import { DGI_LABELS } from './dgi-content.js';
import type { LogoVariant, TemplateBrand, TemplateTheme } from './template.contract.js';

export { esc, DGI_LABELS };

/** Liste HTML : chaque élément dans `tag`, `style` inline facultatif. */
export function each<T>(items: readonly T[], f: (x: T, i: number) => string): string {
  return items.map(f).join('');
}

export function div(text: string, style = ''): string {
  return `<div${style ? ` style="${style}"` : ''}>${esc(text)}</div>`;
}

/**
 * Logo : la première déclinaison disponible dans l'ordre de préférence, sinon
 * les initiales du vendeur dans une pastille (`fallbackStyle`). Le `src` est une
 * URI `data:` déjà vérifiée par le moteur (aucune ressource distante).
 */
export function logo(
  brand: TemplateBrand,
  theme: TemplateTheme,
  prefs: readonly LogoVariant[],
  box: { w: number; h: number },
  fallbackStyle: string,
  opts: { onDark?: boolean } = {},
): string {
  for (const v of prefs) {
    const l = brand.logos[v];
    if (l) {
      const img = `<img class="brand-logo" data-variant="${v}" src="${l.dataUri}" alt="" style="display:block;max-width:${box.w}px;max-height:${box.h}px;width:auto;height:auto;object-fit:contain;filter:${theme.logoFilter}" />`;
      // Sur fond sombre, seule la version claire se pose à nu ; les autres
      // déclinaisons reçoivent une pastille blanche pour rester lisibles.
      return opts.onDark && v !== 'light'
        ? `<div style="background:#ffffff;border-radius:8px;padding:6px;display:inline-block">${img}</div>`
        : img;
    }
  }
  return `<div class="brand-initials" style="${fallbackStyle}">${esc(brand.initials)}</div>`;
}

/** Sous-lignes d'une désignation : code envoyé, modification de prix, taxe spécifique. */
export function lineSubs(l: DocumentLine, style: string, opts: { code?: boolean } = {}): string {
  const subs: string[] = [];
  if (opts.code !== false && l.code) subs.push(l.code);
  if (l.modification) subs.push(l.modification);
  if (l.specificTax) subs.push(l.specificTax);
  return subs.map((s) => div(s, style)).join('');
}

/** Mentions de nature (« D’ACOMPTE », « FACTURE D’AVOIR — … ») en pastilles. */
export function natureBadges(m: InvoiceDocumentModel, style: string): string {
  return each(m.natureMentions, (x) => `<span style="${style}">${esc(x)}</span>`);
}

export function stateLines(m: InvoiceDocumentModel, style: string): string {
  return each(m.stateMentions, (x) => div(x, style));
}

export function duplicateBadge(m: InvoiceDocumentModel, style: string): string {
  return m.duplicate ? `<div><span style="${style}">${esc(m.duplicate.label)}</span></div>` : '';
}

/** Lignes du cadre DGI : libellé, valeur. Vide sans éléments de sécurité. */
export function securityRows(m: InvoiceDocumentModel): Array<[string, string]> {
  const s = m.security;
  if (!s) return [];
  return [
    [DGI_LABELS.codeDefDgi, s.codeDefDgi],
    [DGI_LABELS.nim, s.nim],
    [DGI_LABELS.counters, s.counters],
    [DGI_LABELS.dgiDateTime, s.dgiDateTime],
    [DGI_LABELS.isf, s.isf],
  ];
}

/** Grille libellé / valeur des éléments de sécurité. */
export function securityGrid(
  m: InvoiceDocumentModel,
  theme: TemplateTheme,
  o: { labelStyle: string; valueStyle?: string; columns?: string; fontSize?: string },
): string {
  return `<div style="display:grid;grid-template-columns:${o.columns ?? '110px 1fr'};row-gap:2px;column-gap:8px;font-size:${o.fontSize ?? '10px'}">${each(
    securityRows(m),
    ([k, v]) =>
      `<span style="${o.labelStyle}">${esc(k)}</span><span style="font-family:${theme.code};font-weight:500;word-break:break-all;${o.valueStyle ?? ''}">${esc(v)}</span>`,
  )}</div>`;
}

/** Paiements : « Virement : 631 193,30 » par mode. */
export function paymentsHtml(m: InvoiceDocumentModel, style: string, prefix = 'Paiement'): string {
  return each(
    m.payments,
    (p) =>
      `<div style="${style}">${esc(prefix)} — <span>${esc(p.label)}</span> : <span>${esc(p.amount)}</span></div>`,
  );
}

export function creditRefHtml(m: InvoiceDocumentModel, style: string): string {
  return each(m.creditReference, (r) => div(r, style));
}

export function commentsHtml(m: InvoiceDocumentModel, style: string): string {
  return each(m.comments, (c) => div(c, style));
}

export function operatorHtml(m: InvoiceDocumentModel, style: string): string {
  return m.operator
    ? `<div style="${style}">${esc(DGI_LABELS.operator)} : ${esc(m.operator)}</div>`
    : '';
}

/** Ligne « Taxe spécifique » des totaux, si le document en porte une. */
export function specificTaxRow(
  m: InvoiceDocumentModel,
  row: (label: string, value: string) => string,
): string {
  return m.specificTaxTotal ? row(DGI_LABELS.specificTax, m.specificTaxTotal) : '';
}

/** Fragment de texte échappé. */
export const t = esc;
