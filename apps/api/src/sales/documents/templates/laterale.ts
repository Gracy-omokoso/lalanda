// Modèle 3 · Latérale — maquette validée le 21 oct. 2026 (`Laterale.dc.html`).
// Colonne de couleur à gauche (logo, vendeur, identifiants, paiement, QR code),
// contenu à droite. Le cadre DGI garde ses libellés à droite ; le QR est dans
// la colonne, comme sur la maquette.

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
  securityGrid,
  specificTaxRow,
  stateLines,
} from './parts.js';
import type { InvoiceTemplate, TemplateRenderInput } from './template.contract.js';

const COLS = '2.6fr 0.7fr 0.6fr 0.9fr 1.2fr 1.2fr';

function render({ document: m, dgi, brand, theme }: TemplateRenderInput, withHtTotal = false) {
  const dark = theme.onSide === '#ffffff';
  const css = `
  .doc { font-family: ${theme.body}; font-size: 11px; line-height: 1.45; color: #111827; display: flex; align-items: stretch; min-height: 268mm; }
  .side { width: 210px; flex-shrink: 0; background: ${theme.side}; color: ${theme.onSide}; padding: 28px 22px 24px; display: flex; flex-direction: column; gap: 20px; }
  .side .cap { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; opacity: 0.8; font-weight: 700; }
  .main { flex: 1; padding: 28px 40px 0; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .dgi-test-band, .dgi-sample-band { border: 1.5px dashed #b91c1c; color: #b91c1c; font-weight: 700; text-align: center; padding: 6px; }
  .dgi-sample-band { border-color: #1e40af; color: #1e40af; }
  .row { display: grid; grid-template-columns: ${COLS}; gap: 6px; padding: 7px 0; border-bottom: 1px solid #e5e7eb; break-inside: avoid; }
  .r { text-align: right; }
  .sum { display: flex; justify-content: space-between; }
  `;
  const body = `
  <div class="doc">
    <div class="side">
      ${logo(brand, theme, dark ? ['light', 'symbol', 'primary', 'horizontal'] : ['primary', 'symbol', 'horizontal', 'light'], { w: 150, h: 64 }, `width:64px;height:64px;border-radius:14px;background:${theme.onSide};color:${theme.side};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px`, { onDark: dark })}
      <div style="display:flex;flex-direction:column;gap:2px">
        ${div(m.seller.title, 'font-size:15px;font-weight:700')}
        ${each(m.seller.lines, (l) => div(l, 'opacity:0.9;word-break:break-word'))}
      </div>
      <div style="display:flex;flex-direction:column;gap:2px">
        <div class="cap">Paiement</div>
        ${each(m.payments, (p) => `<div><span>${esc(p.label)}</span> — <span>${esc(p.amount)}</span> ${esc(m.currency)}</div>`)}
      </div>
      ${
        m.security
          ? `<div style="margin-top:auto;display:flex;flex-direction:column;gap:8px;break-inside:avoid">
        <div class="qr" style="width:118px;height:118px;padding:4px;background:#ffffff;border-radius:6px">${dgi.qrSvg}</div>
        <div style="font-size:9px;opacity:0.85">QR code DGI — vérification de la facture</div>
      </div>`
          : ''
      }
    </div>
    <div class="main">
      ${dgi.testBand}${dgi.sampleBand}
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
        <div>
          ${div(m.title, `font-size:24px;font-weight:700;color:${theme.accent};font-family:${theme.display}`)}
          <div>${natureBadges(m, 'display:inline-block;border:0.8px solid #111827;padding:1px 6px;margin-right:4px;font-size:9px;font-weight:700')}</div>
          ${stateLines(m, 'color:#92400e;font-weight:700')}
          <div style="font-size:13px">${esc(m.reference.label)} <strong>${esc(m.reference.value)}</strong></div>
          ${duplicateBadge(m, 'display:inline-block;border:1.5px solid #111827;font-weight:800;padding:3px 10px;letter-spacing:1px;margin-top:4px')}
        </div>
        <div style="text-align:right;color:#374151">
          ${div(m.date.label)}
          ${div(m.date.value)}
        </div>
      </div>
      <div style="border-left:3px solid ${theme.accent};padding:2px 0 2px 12px;display:flex;flex-direction:column;gap:1px">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.6px;color:#4b5563;font-weight:700">Client</div>
        ${div(m.customer.title, 'font-weight:700;font-size:12px')}
        ${each(m.customer.lines, (l) => div(l))}
        ${creditRefHtml(m, 'margin-top:4px')}
      </div>
      <div style="font-size:10px;color:#4b5563">${esc(m.amountsNote)} · ${esc(m.priceModeLabel)}</div>
      <div>
        <div class="row" style="padding:6px 0;font-size:9px;text-transform:uppercase;letter-spacing:0.4px;font-weight:700;border-bottom:1.5px solid #111827"><div>Désignation</div><div>Type</div><div>Gr.</div><div class="r">Qté</div><div class="r">P.U.</div><div class="r">Montant</div></div>
        ${each(
          m.lines,
          (l) => `<div class="row">
            <div>${div(l.name, 'font-weight:600')}${lineSubs(l, 'color:#6b7280;font-size:9px')}</div>
            <div>${esc(l.itemType)}</div><div>${esc(l.group)}</div><div class="r">${esc(l.quantity)}</div><div class="r">${esc(l.unitPrice)}</div><div class="r">${esc(l.amount)}</div>
          </div>`,
        )}
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;color:#374151">
        ${each(m.groups, (g) => `<div class="sum"><span>Groupe ${esc(g.group)} · ${esc(g.rate)} · base ${esc(g.ht)}</span><span>TVA ${esc(g.vat)} · total ${esc(g.total)}</span></div>`)}
      </div>
      <div style="align-self:flex-end;width:270px;display:flex;flex-direction:column;gap:4px;break-inside:avoid">
        ${withHtTotal ? `<div class="sum"><span>${esc(HT_TOTAL_LABEL)}</span><span>${esc(m.htTotal)}</span></div>` : ''}${specificTaxRow(m, (k, v) => `<div class="sum"><span>${esc(k)}</span><span>${esc(v)}</span></div>`)}
        <div class="sum"><span>${esc(DGI_LABELS.vatTotal)}</span><span>${esc(m.vatTotal)}</span></div>
        <div class="sum" style="background:${theme.soft};padding:8px 10px;border-radius:6px;font-size:14px;font-weight:700"><span>Total TTC (${esc(m.currency)})</span><span>${esc(m.total)}</span></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px">
        ${div(m.totalInWords, 'font-style:italic')}
        ${m.counterValue ? div(m.counterValue, 'font-weight:600') : ''}
      </div>
      ${
        m.security
          ? `<div style="border-top:1.5px solid #111827;padding-top:10px;display:flex;flex-direction:column;gap:3px;break-inside:avoid">
        ${div(DGI_LABELS.securityTitle, 'font-weight:700;text-transform:uppercase;letter-spacing:0.5px')}
        ${securityGrid(m, theme, { labelStyle: 'color:#4b5563' })}
      </div>`
          : ''
      }
      <div style="color:#4b5563">${operatorHtml(m, '')}${commentsHtml(m, '')}</div>
    </div>
  </div>`;
  return { css, body };
}

/**
 * Version 1.0.0 — publiée le 21 oct. 2026, sans « Total HT ». Ne change plus :
 * elle réimprime à l'identique les factures gelées avec elle (ADR-0028 § 4).
 */
export const LATERALE_1_0_0: InvoiceTemplate = {
  id: 'laterale',
  version: '1.0.0',
  label: 'Latérale',
  description: 'Une colonne de couleur porte l’identité du vendeur et le QR code.',
  defaults: { palette: 'brand', accent: '#7c2d12', font: 'ibm-plex-sans' },
  fontChoices: ['ibm-plex-sans', 'inter', 'manrope', 'source-serif-4'],
  page: { top: '12mm', bottom: '16mm', left: '0', right: '0' },
  render,
};

/** Version 1.1.0 — ligne « Total HT » (somme des bases par groupe, moteur ; ADR-0028
 *  décision ouverte n° 1, 21 oct. 2026). Seule différence avec 1.0.0. */
export const LATERALE: InvoiceTemplate = {
  ...LATERALE_1_0_0,
  version: '1.1.0',
  render: (input) => render(input, true),
};
