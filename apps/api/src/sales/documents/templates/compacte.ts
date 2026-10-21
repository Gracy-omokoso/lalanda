// Modèle 5 · Compacte — maquette validée le 21 oct. 2026 (`Compacte.dc.html`).
// Grille serrée et encadrée, numéro de ligne et code en colonnes : pensée pour
// les factures de nombreuses lignes.

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
  securityRows,
  stateLines,
} from './parts.js';
import type { InvoiceTemplate, TemplateRenderInput } from './template.contract.js';

const COLS = '0.4fr 1fr 3fr 0.6fr 0.6fr 0.9fr 1.1fr 1.2fr';
const GCOLS = '0.7fr 0.6fr 1.2fr 1.1fr 1.2fr';
const CAP = 'font-size:8.5px;text-transform:uppercase;color:#4b5563;font-weight:600';

function render({ document: m, dgi, brand, theme }: TemplateRenderInput) {
  const css = `
  .doc { padding: 0 36px; font-family: ${theme.body}; font-size: 10px; line-height: 1.4; color: #111827; display: flex; flex-direction: column; gap: 10px; }
  .dgi-test-band, .dgi-sample-band { background: #fef2f2; border: 1px solid #b91c1c; color: #b91c1c; font-weight: 700; text-align: center; padding: 4px; }
  .dgi-sample-band { background: #eff6ff; border-color: #1e40af; color: #1e40af; }
  .box { border: 1px solid #111827; }
  .c { padding: 4px 6px; }
  .row { display: grid; grid-template-columns: ${COLS}; border-top: 1px solid #e5e7eb; break-inside: avoid; }
  .g { display: grid; grid-template-columns: ${GCOLS}; border-top: 1px solid #e5e7eb; }
  .r { text-align: right; }
  .sum { display: flex; justify-content: space-between; padding: 4px 8px; }
  `;
  const sub = (l: (typeof m.lines)[number]) =>
    [l.modification, l.specificTax]
      .filter((x): x is string => x !== null && x !== '')
      .map((x) => div(x, 'color:#6b7280;font-size:8.5px'))
      .join('');
  const body = `
  <div class="doc">
    ${dgi.testBand}${dgi.sampleBand}
    <div class="box" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr))">
      <div style="padding:10px;border-right:1px solid #111827;display:flex;gap:10px;align-items:flex-start">
        ${logo(brand, theme, ['symbol', 'primary', 'horizontal'], { w: 70, h: 40 }, `width:40px;height:40px;background:${theme.accent};color:${theme.onAccent};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0`)}
        <div style="display:flex;flex-direction:column;min-width:0">
          ${div(m.seller.title, 'font-weight:700;font-size:12px')}
          ${each(m.seller.lines.slice(0, 2), (l) => div(l))}
        </div>
      </div>
      <div style="padding:10px;border-right:1px solid #111827;display:flex;flex-direction:column">
        ${each(m.seller.lines.slice(2), (l) => div(l))}
      </div>
      <div style="padding:10px;background:${theme.soft};display:flex;flex-direction:column;align-items:flex-end;text-align:right">
        ${div(m.title, `font-weight:700;font-size:14px;text-transform:uppercase;color:${theme.accent};font-family:${theme.display}`)}
        <div>${natureBadges(m, 'display:inline-block;border:0.8px solid #111827;padding:0 5px;margin-left:4px;font-size:8.5px;font-weight:700')}</div>
        ${stateLines(m, 'color:#92400e;font-weight:700')}
        <div>${esc(m.reference.label)} <strong>${esc(m.reference.value)}</strong></div>
        <div>${esc(m.date.label)} : ${esc(m.date.value)}</div>
        ${duplicateBadge(m, 'display:inline-block;border:1.5px solid #111827;font-weight:800;padding:2px 8px;letter-spacing:1px;margin-top:3px')}
      </div>
    </div>
    <div class="box" style="display:grid;grid-template-columns:2fr 1.4fr 1.2fr">
      <div class="c" style="padding:6px 10px;border-right:1px solid #d1d5db"><div style="${CAP}">Client</div>${div(m.customer.title, 'font-weight:700')}${creditRefHtml(m, '')}</div>
      <div class="c" style="padding:6px 10px;border-right:1px solid #d1d5db"><div style="${CAP}">Type · identifiants</div>${each(m.customer.lines, (l) => div(l))}</div>
      <div class="c" style="padding:6px 10px"><div style="${CAP}">Prix / devise</div>${div(m.priceModeLabel)}${div(m.amountsNote)}</div>
    </div>
    <div class="box">
      <div class="row" style="border-top:none;background:${theme.accent};color:${theme.onAccent};font-size:8.5px;text-transform:uppercase;font-weight:700">
        <div class="c">#</div><div class="c">Code</div><div class="c">Désignation</div><div class="c">Type</div><div class="c">Gr.</div><div class="c r">Qté</div><div class="c r">P.U.</div><div class="c r">Montant</div>
      </div>
      ${each(
        m.lines,
        (l, i) => `<div class="row" style="background:${i % 2 ? theme.soft : '#ffffff'}">
          <div class="c" style="color:#6b7280">${i + 1}</div><div class="c" style="font-family:${theme.code};font-size:9px;word-break:break-all">${esc(l.code ?? '')}</div><div class="c"><div>${esc(l.name)}</div>${sub(l)}</div><div class="c">${esc(l.itemType)}</div><div class="c">${esc(l.group)}</div><div class="c r">${esc(l.quantity)}</div><div class="c r">${esc(l.unitPrice)}</div><div class="c r">${esc(l.amount)}</div>
        </div>`,
      )}
    </div>
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:10px;break-inside:avoid">
      <div class="box" style="display:flex;flex-direction:column">
        <div class="g" style="border-top:none;background:${theme.soft};font-size:8.5px;text-transform:uppercase;font-weight:700"><div class="c">Groupe</div><div class="c">Taux</div><div class="c r">Base</div><div class="c r">TVA</div><div class="c r">Total</div></div>
        ${each(m.groups, (g) => `<div class="g"><div class="c">${esc(g.group)}</div><div class="c">${esc(g.rate)}</div><div class="c r">${esc(g.ht)}</div><div class="c r">${esc(g.vat)}</div><div class="c r">${esc(g.total)}</div></div>`)}
        ${each(m.payments, (p) => `<div class="sum" style="border-top:1px solid #111827;padding:4px 6px"><span>Paiement : ${esc(p.label)}</span><span>${esc(p.amount)}</span></div>`)}
      </div>
      <div class="box" style="display:flex;flex-direction:column">
        ${m.specificTaxTotal ? `<div class="sum"><span>${esc(DGI_LABELS.specificTax)}</span><span>${esc(m.specificTaxTotal)}</span></div>` : ''}
        <div class="sum"><span>${esc(DGI_LABELS.vatTotal)}</span><span>${esc(m.vatTotal)}</span></div>
        <div class="sum" style="padding:7px 8px;background:${theme.accent};color:${theme.onAccent};font-weight:700;font-size:12px;margin-top:auto"><span>TTC (${esc(m.currency)})</span><span>${esc(m.total)}</span></div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:2px">
      ${div(m.totalInWords, 'font-style:italic')}
      ${m.counterValue ? div(m.counterValue, 'font-weight:600') : ''}
    </div>
    ${
      m.security
        ? `<div class="box" style="padding:8px 10px;display:flex;gap:14px;align-items:center;break-inside:avoid">
      <div class="qr" style="width:90px;height:90px;flex-shrink:0">${dgi.qrSvg}</div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:18px;row-gap:2px;flex:1;font-size:9.5px">
        <div style="grid-column:1 / 3;font-weight:700;text-transform:uppercase">${esc(DGI_LABELS.securityTitle)}</div>
        ${each(securityRows(m), ([k, v]) => `<div><span style="color:#4b5563">${esc(k)} </span><span style="font-family:${theme.code};font-weight:500;word-break:break-all">${esc(v)}</span></div>`)}
        ${m.operator ? `<div>${operatorHtml(m, '')}</div>` : ''}
      </div>
    </div>`
        : operatorHtml(m, 'color:#4b5563')
    }
    <div style="color:#4b5563">${commentsHtml(m, '')}</div>
  </div>`;
  return { css, body };
}

export const COMPACTE: InvoiceTemplate = {
  id: 'compacte',
  version: '1.0.0',
  label: 'Compacte',
  description: 'Grille serrée et encadrée : idéale pour les factures de nombreuses lignes.',
  defaults: { palette: 'brand', accent: '#334155', font: 'ibm-plex-sans' },
  fontChoices: ['ibm-plex-sans', 'inter', 'manrope', 'source-serif-4'],
  page: { top: '12mm', bottom: '16mm', left: '0', right: '0' },
  render,
};
