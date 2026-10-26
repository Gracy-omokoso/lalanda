// Modèle 1 · Classique — maquette validée le 21 oct. 2026 (`Main.dc.html`).
// En-tête vendeur à gauche, intitulé à droite ; cartes Client / Conditions ;
// tableau des lignes ; ventilation et totaux côte à côte ; cadre DGI encadré.

import {
  DGI_LABELS,
  HT_TOTAL_LABEL,
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
const GCOLS = '0.8fr 0.7fr 1.3fr 1.2fr 1.3fr';

function render({ document: m, dgi, brand, theme }: TemplateRenderInput, withHtTotal = false) {
  const css = `
  .doc { padding: 0 48px; font-family: ${theme.body}; font-size: 11px; line-height: 1.45; color: #111827; display: flex; flex-direction: column; gap: 16px; }
  .dgi-test-band, .dgi-sample-band { border: 1.5px solid #b91c1c; background: #fef2f2; color: #b91c1c; font-weight: 700; text-align: center; padding: 6px; font-size: 11px; }
  .dgi-sample-band { border-color: #1e40af; background: #eff6ff; color: #1e40af; }
  .card { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 1px; }
  .cap { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: #4b5563; font-weight: 600; }
  .row { display: grid; grid-template-columns: ${COLS}; gap: 8px; padding: 7px 8px; border-bottom: 1px solid #e5e7eb; break-inside: avoid; }
  .head { background: ${theme.soft}; font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; border-bottom: 1px solid ${theme.line}; }
  .g { display: grid; grid-template-columns: ${GCOLS}; gap: 6px; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
  .r { text-align: right; }
  .sub { color: #6b7280; font-size: 9px; }
  .sum { display: flex; justify-content: space-between; }
  `;
  const bodyHtml = `
  <div class="doc">
    ${dgi.testBand}${dgi.sampleBand}
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px">
      <div style="display:flex;gap:14px;align-items:flex-start">
        ${logo(brand, theme, ['primary', 'symbol', 'horizontal'], { w: 120, h: 52 }, `width:52px;height:52px;border-radius:10px;background:${theme.accent};color:${theme.onAccent};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;letter-spacing:0.5px`)}
        <div style="display:flex;flex-direction:column;gap:1px">
          ${div(m.seller.title, 'font-size:15px;font-weight:700')}
          ${each(m.seller.lines, (l) => div(l))}
        </div>
      </div>
      <div style="text-align:right;display:flex;flex-direction:column;gap:2px;align-items:flex-end">
        ${div(m.title, `font-size:22px;font-weight:700;color:${theme.accent};font-family:${theme.display}`)}
        <div>${natureBadges(m, 'display:inline-block;border:0.8px solid #111827;padding:1px 6px;margin-left:4px;font-size:9px;font-weight:700')}</div>
        ${stateLines(m, 'color:#92400e;font-weight:700')}
        ${duplicateBadge(m, 'display:inline-block;border:1.5px solid #111827;font-weight:800;padding:3px 10px;letter-spacing:1px')}
        <div>${esc(m.reference.label)} <strong>${esc(m.reference.value)}</strong></div>
        <div>${esc(m.date.label)} : ${esc(m.date.value)}</div>
      </div>
    </div>
    <div style="display:flex;gap:16px">
      <div class="card">
        <div class="cap">Client</div>
        ${div(m.customer.title, 'font-weight:700;font-size:12px')}
        ${each(m.customer.lines, (l) => div(l))}
        ${creditRefHtml(m, 'margin-top:4px')}
      </div>
      <div class="card">
        <div class="cap">Conditions</div>
        ${div(m.amountsNote)}
        ${div(m.priceModeLabel)}
        ${paymentsHtml(m, '')}
      </div>
    </div>
    <div>
      <div class="row head"><div>Désignation</div><div>Type</div><div>Groupe</div><div class="r">Quantité</div><div class="r">Prix unitaire</div><div class="r">Montant</div></div>
      ${each(
        m.lines,
        (l) => `<div class="row">
          <div>${div(l.name, 'font-weight:600')}${lineSubs(l, 'color:#6b7280;font-size:9px')}</div>
          <div>${esc(l.itemType)}</div><div>${esc(l.group)}</div><div class="r">${esc(l.quantity)}</div><div class="r">${esc(l.unitPrice)}</div><div class="r">${esc(l.amount)}</div>
        </div>`,
      )}
    </div>
    <div style="display:flex;gap:20px;align-items:flex-start;break-inside:avoid">
      <div style="flex:1.4">
        <div class="g head"><div>Groupe</div><div>Taux</div><div class="r">Base</div><div class="r">TVA</div><div class="r">Total</div></div>
        ${each(m.groups, (g) => `<div class="g"><div>${esc(g.group)}</div><div>${esc(g.rate)}</div><div class="r">${esc(g.ht)}</div><div class="r">${esc(g.vat)}</div><div class="r">${esc(g.total)}</div></div>`)}
      </div>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        ${withHtTotal ? `<div class="sum"><span>${esc(HT_TOTAL_LABEL)}</span><span>${esc(m.htTotal)}</span></div>` : ''}${specificTaxRow(m, (k, v) => `<div class="sum"><span>${esc(k)}</span><span>${esc(v)}</span></div>`)}
        <div class="sum"><span>${esc(DGI_LABELS.vatTotal)}</span><span>${esc(m.vatTotal)}</span></div>
        <div class="sum" style="border-top:1.5px solid #111827;padding-top:6px;margin-top:2px;font-size:14px;font-weight:700"><span>Total TTC (${esc(m.currency)})</span><span>${esc(m.total)}</span></div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:3px">
      ${div(m.totalInWords, 'font-style:italic')}
      ${m.counterValue ? div(m.counterValue, 'font-weight:600') : ''}
    </div>
    ${
      m.security
        ? `<div style="border:1px solid #111827;border-radius:8px;padding:12px 14px;display:flex;gap:16px;align-items:center;break-inside:avoid">
        <div class="qr" style="width:110px;height:110px;flex-shrink:0">${dgi.qrSvg}</div>
        <div style="display:flex;flex-direction:column;gap:3px;flex:1">
          ${div(DGI_LABELS.securityTitle, 'font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px')}
          ${securityGrid(m, theme, { labelStyle: 'color:#4b5563' })}
        </div>
      </div>`
        : ''
    }
    <div style="color:#4b5563">${operatorHtml(m, '')}${commentsHtml(m, '')}</div>
  </div>`;
  return { css, body: bodyHtml };
}

/**
 * Version 1.0.0 — publiée le 21 oct. 2026, sans « Total HT ». Ne change plus :
 * elle réimprime à l'identique les factures gelées avec elle (ADR-0028 § 4).
 */
export const CLASSIQUE_1_0_0: InvoiceTemplate = {
  id: 'classique',
  version: '1.0.0',
  label: 'Classique',
  description: 'Sobre et complet : vendeur et intitulé en tête, cartes client et conditions.',
  defaults: { palette: 'brand', accent: '#0f5132', font: 'inter' },
  fontChoices: ['inter', 'ibm-plex-sans', 'manrope', 'source-serif-4'],
  page: { top: '12mm', bottom: '16mm', left: '0', right: '0' },
  render,
};

/** Version 1.1.0 — ligne « Total HT » (somme des bases par groupe, moteur ; ADR-0028
 *  décision ouverte n° 1, 21 oct. 2026). Seule différence avec 1.0.0. */
export const CLASSIQUE: InvoiceTemplate = {
  ...CLASSIQUE_1_0_0,
  version: '1.1.0',
  render: (input) => render(input, true),
};
