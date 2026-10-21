// Modèle 4 · Minimal — maquette validée le 21 oct. 2026 (`Minimal.dc.html`).
// Typographie seule : numéro en grand, filets fins, noir et blanc par défaut.

import {
  DGI_LABELS,
  commentsHtml,
  creditRefHtml,
  div,
  duplicateBadge,
  each,
  esc,
  logo,
  natureBadges,
  operatorHtml,
  securityGrid,
  stateLines,
} from './parts.js';
import type { InvoiceTemplate, TemplateRenderInput } from './template.contract.js';

const COLS = '3fr 0.6fr 0.5fr 0.9fr 1.2fr 1.2fr';
const CAP = 'font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#4b5563';

function render({ document: m, dgi, brand, theme }: TemplateRenderInput) {
  const css = `
  .doc { padding: 8px 64px 0; font-family: ${theme.body}; font-size: 10.5px; line-height: 1.5; color: #111111; display: flex; flex-direction: column; gap: 24px; }
  .dgi-test-band, .dgi-sample-band { color: #b91c1c; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; font-size: 10px; text-align: center; border-top: 1px solid #b91c1c; border-bottom: 1px solid #b91c1c; padding: 5px; }
  .dgi-sample-band { color: #1e40af; border-color: #1e40af; }
  .row { display: grid; grid-template-columns: ${COLS}; gap: 8px; padding: 10px 0; border-top: 1px solid #e5e7eb; break-inside: avoid; }
  .r { text-align: right; }
  `;
  const subs = (l: (typeof m.lines)[number]) =>
    [l.code, l.modification, l.specificTax]
      .filter((x): x is string => x !== null && x !== '')
      .map((x) => ` <span style="color:#6b7280">· ${esc(x)}</span>`)
      .join('');
  const body = `
  <div class="doc">
    ${dgi.testBand}${dgi.sampleBand}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:16px">
      <div style="display:flex;align-items:center;gap:12px">
        ${logo(brand, theme, ['horizontal', 'primary', 'symbol'], { w: 160, h: 36 }, 'display:none')}
        ${div(m.seller.title, `font-size:13px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:${theme.accent}`)}
      </div>
      <div style="text-align:right">
        ${div(m.title, 'font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#4b5563')}
        <div>${natureBadges(m, 'display:inline-block;border:0.8px solid #111111;padding:0 5px;margin-left:4px;font-size:8.5px;letter-spacing:1px')}</div>
        ${stateLines(m, 'color:#92400e;font-weight:600')}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px">
      ${div(m.reference.label, CAP)}
      ${div(m.reference.value, `font-size:40px;font-weight:300;letter-spacing:-1px;line-height:1;font-family:${theme.display}`)}
      <div style="color:#4b5563">${esc(m.date.label)} : ${esc(m.date.value)}</div>
      ${duplicateBadge(m, 'display:inline-block;border:1px solid #111111;font-weight:700;padding:2px 10px;letter-spacing:2px;margin-top:4px')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:32px">
      <div style="display:flex;flex-direction:column;gap:1px">
        <div style="${CAP};margin-bottom:4px">De</div>
        ${div(m.seller.title, 'font-weight:600')}
        ${each(m.seller.lines, (l) => div(l))}
      </div>
      <div style="display:flex;flex-direction:column;gap:1px">
        <div style="${CAP};margin-bottom:4px">Pour</div>
        ${div(m.customer.title, 'font-weight:600')}
        ${each(m.customer.lines, (l) => div(l))}
        ${creditRefHtml(m, 'margin-top:4px')}
      </div>
    </div>
    <div>
      <div class="row" style="border-top:none;padding:0 0 8px;font-size:9px;letter-spacing:1.2px;text-transform:uppercase;color:#4b5563"><div>Désignation</div><div>Type</div><div>Gr.</div><div class="r">Qté</div><div class="r">Prix</div><div class="r">Montant</div></div>
      ${each(
        m.lines,
        (l) => `<div class="row">
          <div><span>${esc(l.name)}</span>${subs(l)}</div>
          <div>${esc(l.itemType)}</div><div>${esc(l.group)}</div><div class="r">${esc(l.quantity)}</div><div class="r">${esc(l.unitPrice)}</div><div class="r">${esc(l.amount)}</div>
        </div>`,
      )}
      <div style="border-top:1px solid #111111"></div>
      <div style="margin-top:6px;color:#4b5563">${esc(m.priceModeLabel)}</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:32px;break-inside:avoid">
      <div style="display:flex;flex-direction:column;gap:2px;color:#374151">
        ${each(m.groups, (g) => `<div>${esc(g.group)} ${esc(g.rate)} — base ${esc(g.ht)} · TVA ${esc(g.vat)} · ${esc(g.total)}</div>`)}
        ${m.specificTaxTotal ? `<div>${esc(DGI_LABELS.specificTax)} ${esc(m.specificTaxTotal)}</div>` : ''}
        <div>${esc(DGI_LABELS.vatTotal)} ${esc(m.vatTotal)}</div>
        ${each(m.payments, (p) => `<div>Paiement : <span>${esc(p.label)}</span> — <span>${esc(p.amount)}</span></div>`)}
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="${CAP}">Total TTC — ${esc(m.currency)}</div>
        ${div(m.total, `font-size:30px;font-weight:300;color:${theme.accent};font-family:${theme.display}`)}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:3px;color:#374151">
      ${div(m.totalInWords)}
      ${div(m.amountsNote)}
      ${m.counterValue ? div(m.counterValue) : ''}
    </div>
    ${
      m.security
        ? `<div style="display:flex;gap:20px;align-items:center;padding-top:18px;border-top:1px solid #e5e7eb;break-inside:avoid">
      <div class="qr" style="width:100px;height:100px;flex-shrink:0">${dgi.qrSvg}</div>
      <div style="display:flex;flex-direction:column;gap:3px">
        ${div(DGI_LABELS.securityTitle, `${CAP};letter-spacing:1.2px;margin-bottom:3px`)}
        ${securityGrid(m, theme, { labelStyle: 'color:#4b5563', columns: '100px 1fr' })}
      </div>
    </div>`
        : ''
    }
    <div style="color:#4b5563;font-size:9.5px">${operatorHtml(m, '')}${commentsHtml(m, '')}</div>
  </div>`;
  return { css, body };
}

export const MINIMAL: InvoiceTemplate = {
  id: 'minimal',
  version: '1.0.0',
  label: 'Minimal',
  description: 'Épuré : de la typographie et des filets fins, noir et blanc par défaut.',
  defaults: { palette: 'mono', accent: '#0f5132', font: 'inter' },
  fontChoices: ['inter', 'ibm-plex-sans', 'manrope', 'source-serif-4'],
  page: { top: '12mm', bottom: '16mm', left: '0', right: '0' },
  render,
};
