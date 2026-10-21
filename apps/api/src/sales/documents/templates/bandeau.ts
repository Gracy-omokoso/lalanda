// Modèle 2 · Bandeau — maquette validée le 21 oct. 2026 (`Bandeau.dc.html`).
// Large bandeau de couleur en tête (logo en version claire), trois colonnes
// Vendeur / Facturé à / Émission, tableau zébré, totaux sur fond doux.

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
  paymentsHtml,
  securityGrid,
  specificTaxRow,
  stateLines,
} from './parts.js';
import type { InvoiceTemplate, TemplateRenderInput } from './template.contract.js';

const COLS = '3fr 0.7fr 0.6fr 1fr 1.3fr 1.3fr';

function render({ document: m, dgi, brand, theme }: TemplateRenderInput) {
  const [nameLine, ...otherSeller] = m.seller.lines;
  const dark = theme.onAccent === '#ffffff';
  const css = `
  .doc { font-family: ${theme.body}; font-size: 11px; line-height: 1.45; color: #111827; display: flex; flex-direction: column; }
  .dgi-test-band, .dgi-sample-band { background: #b91c1c; color: #ffffff; font-weight: 700; text-align: center; padding: 5px; font-size: 10.5px; letter-spacing: 0.3px; text-transform: uppercase; }
  .dgi-sample-band { background: #1e40af; }
  .band { background: ${theme.accent}; color: ${theme.onAccent}; padding: 28px 48px 24px; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
  .inner { padding: 22px 48px 0; display: flex; flex-direction: column; gap: 18px; }
  .cap { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; color: ${theme.accent}; }
  .row { display: grid; grid-template-columns: ${COLS}; gap: 8px; padding: 8px 10px; break-inside: avoid; }
  .r { text-align: right; }
  .sum { display: flex; justify-content: space-between; }
  `;
  const body = `
  <div class="doc">
    ${dgi.testBand}${dgi.sampleBand}
    <div class="band">
      <div style="display:flex;gap:14px;align-items:center">
        ${logo(brand, theme, dark ? ['light', 'symbol', 'primary', 'horizontal'] : ['primary', 'symbol', 'horizontal', 'light'], { w: 140, h: 54 }, `width:54px;height:54px;border-radius:50%;border:2px solid ${theme.onAccent};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px`, { onDark: dark })}
        <div style="display:flex;flex-direction:column">
          ${div(m.seller.title, 'font-size:17px;font-weight:700')}
          ${nameLine ? div(nameLine, 'opacity:0.9') : ''}
        </div>
      </div>
      <div style="text-align:right">
        ${div(m.title, `font-size:26px;font-weight:800;line-height:1.1;font-family:${theme.display}`)}
        <div style="margin-top:4px">${natureBadges(m, `display:inline-block;border:1px solid ${theme.onAccent};padding:1px 6px;margin-left:4px;font-size:9px;font-weight:700`)}</div>
        <div style="font-size:13px;margin-top:4px">${esc(m.reference.label)} ${esc(m.reference.value)}</div>
      </div>
    </div>
    <div class="inner">
      ${stateLines(m, 'color:#92400e;font-weight:700')}
      ${duplicateBadge(m, 'display:inline-block;border:1.5px solid #111827;font-weight:800;padding:3px 10px;letter-spacing:1px')}
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px">
        <div style="display:flex;flex-direction:column;gap:1px">
          <div class="cap">Vendeur</div>
          ${each(otherSeller, (l) => div(l))}
        </div>
        <div style="display:flex;flex-direction:column;gap:1px">
          <div class="cap">Facturé à</div>
          ${div(m.customer.title, 'font-weight:700;font-size:12px')}
          ${each(m.customer.lines, (l) => div(l))}
          ${creditRefHtml(m, 'margin-top:4px')}
        </div>
        <div style="display:flex;flex-direction:column;gap:1px">
          <div class="cap">Émission</div>
          ${div(m.date.label, 'color:#4b5563')}
          ${div(m.date.value)}
          ${div(m.amountsNote)}
          ${div(m.priceModeLabel)}
        </div>
      </div>
      <div style="border-radius:8px;overflow:hidden;border:1px solid ${theme.line}">
        <div class="row" style="background:${theme.accent};color:${theme.onAccent};font-size:9px;text-transform:uppercase;letter-spacing:0.4px;font-weight:700"><div>Désignation</div><div>Type</div><div>Groupe</div><div class="r">Quantité</div><div class="r">Prix unitaire</div><div class="r">Montant</div></div>
        ${each(
          m.lines,
          (l, i) => `<div class="row" style="background:${i % 2 ? theme.soft : '#ffffff'}">
            <div>${div(l.name, 'font-weight:600')}${lineSubs(l, 'color:#6b7280;font-size:9px')}</div>
            <div>${esc(l.itemType)}</div><div>${esc(l.group)}</div><div class="r">${esc(l.quantity)}</div><div class="r">${esc(l.unitPrice)}</div><div class="r">${esc(l.amount)}</div>
          </div>`,
        )}
      </div>
      <div style="display:flex;gap:22px;align-items:stretch;break-inside:avoid">
        <div style="flex:1.3;display:flex;flex-direction:column;gap:4px">
          <div class="cap">Ventilation par groupe</div>
          ${each(
            m.groups,
            (
              g,
            ) => `<div style="display:grid;grid-template-columns:0.6fr 0.6fr 1.3fr 1.2fr 1.3fr;gap:6px;padding:4px 0;border-bottom:1px solid #e5e7eb">
              <div>${esc(g.group)}</div><div>${esc(g.rate)}</div><div class="r">base ${esc(g.ht)}</div><div class="r">TVA ${esc(g.vat)}</div><div class="r">${esc(g.total)}</div>
            </div>`,
          )}
          <div style="margin-top:6px">${paymentsHtml(m, '')}</div>
        </div>
        <div style="flex:1;background:${theme.soft};border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:4px">
          ${specificTaxRow(m, (k, v) => `<div class="sum"><span>${esc(k)}</span><span>${esc(v)}</span></div>`)}
          <div class="sum"><span>${esc(DGI_LABELS.vatTotal)}</span><span>${esc(m.vatTotal)}</span></div>
          <div class="sum" style="margin-top:auto;padding-top:8px;border-top:1.5px solid ${theme.accent};font-size:15px;font-weight:800;color:${theme.accent}"><span>Total TTC</span><span>${esc(m.total)} ${esc(m.currency)}</span></div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px">
        ${div(m.totalInWords, 'font-style:italic')}
        ${m.counterValue ? div(m.counterValue, 'font-weight:600') : ''}
      </div>
      ${
        m.security
          ? `<div style="border:1.5px solid ${theme.accent};border-radius:10px;padding:12px 14px;display:flex;gap:16px;align-items:center;break-inside:avoid">
          <div class="qr" style="width:110px;height:110px;flex-shrink:0">${dgi.qrSvg}</div>
          <div style="display:flex;flex-direction:column;gap:3px;flex:1">
            ${div(DGI_LABELS.securityTitle, `font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${theme.accent}`)}
            ${securityGrid(m, theme, { labelStyle: 'color:#4b5563' })}
          </div>
        </div>`
          : ''
      }
      <div style="color:#4b5563">${operatorHtml(m, '')}${commentsHtml(m, '')}</div>
    </div>
  </div>`;
  return { css, body };
}

export const BANDEAU: InvoiceTemplate = {
  id: 'bandeau',
  version: '1.0.0',
  label: 'Bandeau',
  description: 'Affirmé : un bandeau aux couleurs de la marque, tableau zébré.',
  defaults: { palette: 'brand', accent: '#1d4ed8', font: 'manrope' },
  fontChoices: ['manrope', 'inter', 'ibm-plex-sans', 'source-serif-4'],
  page: { top: '12mm', bottom: '16mm', left: '0', right: '0' },
  render,
};
