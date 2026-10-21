// Modèle 6 · Éditoriale — maquette validée le 21 oct. 2026 (`Editoriale.dc.html`).
// Composition centrée, paire de polices titre + texte, filets de couleur,
// cadre DGI sur fond doux.

import {
  DGI_LABELS,
  commentsHtml,
  creditRefHtml,
  div,
  duplicateBadge,
  each,
  esc,
  lineSubs,
  logo,
  natureBadges,
  operatorHtml,
  securityGrid,
  stateLines,
} from './parts.js';
import type { InvoiceTemplate, TemplateRenderInput } from './template.contract.js';

const COLS = '3fr 0.6fr 0.5fr 0.9fr 1.2fr 1.2fr';

function render({ document: m, dgi, brand, theme }: TemplateRenderInput) {
  const css = `
  .doc { padding: 4px 60px 0; font-family: ${theme.body}; font-size: 10.5px; line-height: 1.5; color: #1c1917; display: flex; flex-direction: column; gap: 18px; }
  .dgi-test-band, .dgi-sample-band { text-align: center; color: #b91c1c; font-weight: 600; font-size: 10.5px; border: 1px solid #b91c1c; padding: 5px; }
  .dgi-sample-band { color: #1e40af; border-color: #1e40af; }
  .disp { font-family: ${theme.display}; }
  .row { display: grid; grid-template-columns: ${COLS}; gap: 8px; padding: 9px 0; border-bottom: 1px solid #e7e5e4; break-inside: avoid; }
  .r { text-align: right; }
  .sum { display: flex; justify-content: space-between; }
  `;
  const body = `
  <div class="doc">
    ${dgi.testBand}${dgi.sampleBand}
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center">
      ${logo(brand, theme, ['primary', 'symbol', 'horizontal'], { w: 160, h: 56 }, `width:50px;height:50px;border:1.5px solid ${theme.accent};color:${theme.accent};border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:${theme.display};font-size:18px;font-weight:600`)}
      ${div(m.seller.title, `font-family:${theme.display};font-size:20px;font-weight:600`)}
      <div style="color:#44403c">${m.seller.lines.map((l) => `<span>${esc(l)}</span>`).join(' · ')}</div>
    </div>
    <div style="display:flex;align-items:center;gap:14px">
      <div style="flex:1;height:1px;background:${theme.accent}"></div>
      ${div(m.title, `font-family:${theme.display};font-size:24px;color:${theme.accent};text-align:center`)}
      <div style="flex:1;height:1px;background:${theme.accent}"></div>
    </div>
    ${
      m.natureMentions.length > 0 || m.stateMentions.length > 0 || m.duplicate
        ? `<div style="text-align:center">${natureBadges(m, 'display:inline-block;border:0.8px solid #1c1917;padding:1px 6px;margin:0 3px;font-size:9px;font-weight:700')}${stateLines(m, 'color:#92400e;font-weight:700')}${duplicateBadge(m, 'display:inline-block;border:1.5px solid #1c1917;font-weight:700;padding:3px 10px;letter-spacing:1px;margin-top:4px')}</div>`
        : ''
    }
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:30px">
      <div style="display:flex;flex-direction:column;gap:1px">
        <div class="disp" style="font-style:italic;color:#57534e">Adressée à</div>
        ${div(m.customer.title, 'font-weight:600;font-size:12px')}
        ${each(m.customer.lines, (l) => div(l))}
        ${creditRefHtml(m, 'margin-top:4px')}
      </div>
      <div style="display:flex;flex-direction:column;gap:1px;text-align:right">
        <div class="disp" style="font-style:italic;color:#57534e">Référence</div>
        <div style="font-weight:600;font-size:12px">${esc(m.reference.label)} ${esc(m.reference.value)}</div>
        <div>${esc(m.date.label)} : ${esc(m.date.value)}</div>
      </div>
    </div>
    <div>
      <div class="row disp" style="padding:6px 0;border-top:1.5px solid #1c1917;border-bottom:1px solid #1c1917;font-style:italic;color:#44403c"><div>Désignation</div><div>Type</div><div>Gr.</div><div class="r">Quantité</div><div class="r">Prix</div><div class="r">Montant</div></div>
      ${each(
        m.lines,
        (l) => `<div class="row">
          <div>${div(l.name, 'font-weight:600')}${lineSubs(l, 'color:#78716c;font-size:9px')}</div>
          <div>${esc(l.itemType)}</div><div>${esc(l.group)}</div><div class="r">${esc(l.quantity)}</div><div class="r">${esc(l.unitPrice)}</div><div class="r">${esc(l.amount)}</div>
        </div>`,
      )}
    </div>
    <div style="display:flex;justify-content:space-between;gap:30px;break-inside:avoid">
      <div style="flex:1.2;display:flex;flex-direction:column;gap:2px;color:#44403c">
        ${each(m.groups, (g) => `<div class="sum"><span>Groupe ${esc(g.group)} — ${esc(g.rate)}</span><span>base ${esc(g.ht)} · TVA ${esc(g.vat)} · ${esc(g.total)}</span></div>`)}
        ${each(m.payments, (p) => `<div style="margin-top:4px">Règlement : <span>${esc(p.label)}</span> — <span>${esc(p.amount)}</span></div>`)}
        <div>${esc(m.amountsNote)} · ${esc(m.priceModeLabel)}</div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;gap:3px">
        ${m.specificTaxTotal ? `<div class="sum"><span>${esc(DGI_LABELS.specificTax)}</span><span>${esc(m.specificTaxTotal)}</span></div>` : ''}
        <div class="sum"><span>${esc(DGI_LABELS.vatTotal)}</span><span>${esc(m.vatTotal)}</span></div>
        <div class="sum" style="align-items:baseline;border-top:1px solid ${theme.accent};border-bottom:1px solid ${theme.accent};padding:6px 0;margin-top:3px"><span class="disp" style="font-size:13px">Total TTC</span><span class="disp" style="font-size:17px;font-weight:600;color:${theme.accent}">${esc(m.total)} ${esc(m.currency)}</span></div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:3px;text-align:center;color:#44403c">
      ${div(m.totalInWords, `font-family:${theme.display};font-style:italic`)}
      ${m.counterValue ? div(m.counterValue) : ''}
    </div>
    ${
      m.security
        ? `<div style="background:${theme.soft};padding:14px 16px;display:flex;gap:18px;align-items:center;break-inside:avoid">
      <div class="qr" style="width:104px;height:104px;padding:4px;background:#ffffff;flex-shrink:0">${dgi.qrSvg}</div>
      <div style="display:flex;flex-direction:column;gap:2px">
        ${div(DGI_LABELS.securityTitle, `font-family:${theme.display};font-size:13px;margin-bottom:2px`)}
        ${securityGrid(m, theme, { labelStyle: 'color:#57534e' })}
      </div>
    </div>`
        : ''
    }
    <div style="color:#57534e">${operatorHtml(m, '')}${commentsHtml(m, '')}</div>
  </div>`;
  return { css, body };
}

export const EDITORIALE: InvoiceTemplate = {
  id: 'editoriale',
  version: '1.0.0',
  label: 'Éditoriale',
  description: 'Composition centrée, paire de polices titre et texte, filets de couleur.',
  defaults: { palette: 'brand', accent: '#7f1d1d', font: 'fraunces+inter' },
  fontChoices: ['fraunces+inter', 'source-serif-4+ibm-plex-sans', 'source-serif-4+manrope'],
  page: { top: '12mm', bottom: '16mm', left: '0', right: '0' },
  render,
};
