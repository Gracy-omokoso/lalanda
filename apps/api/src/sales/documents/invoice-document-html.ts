// Mise en page HTML d'un document de vente — ADR-0025.
//
// Mise en forme SEULEMENT : tout ce qui s'imprime vient du modèle
// (`invoice-document.model.ts`), qui porte les règles. Chaque valeur est
// échappée (`esc`) : le PDF est rendu par Chromium, et un champ saisi par
// l'utilisateur (nom de client, désignation) ne doit jamais devenir du HTML.
// La CSP du document interdit tout script et toute ressource hors styles inline
// (même filet que les rapports, S22e) ; le QR code est un SVG inline.

import type { InvoiceDocumentModel } from './invoice-document.model.js';

export function esc(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Le SVG produit par `qrcode` ne contient que des éléments graphiques : on le vérifie. */
export function safeSvg(svg: string): string {
  if (!/^<svg[\s>]/.test(svg.trim()) || /<script|on\w+=|href=|<foreignObject/i.test(svg)) {
    throw new Error('SVG du QR code inattendu.');
  }
  return svg;
}

const CSS = `
  @page { size: A4; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9.5pt; color: #111827; line-height: 1.35; }
  .test-mark { position: fixed; top: 38%; left: 0; right: 0; text-align: center; font-size: 150pt; font-weight: 800; letter-spacing: 12pt; color: rgba(185, 28, 28, 0.13); transform: rotate(-30deg); z-index: 0; pointer-events: none; }
  .test-band { border: 1.5pt solid #b91c1c; color: #b91c1c; background: #fef2f2; font-weight: 700; text-align: center; padding: 2mm; margin-bottom: 4mm; font-size: 10.5pt; position: relative; z-index: 1; }
  .content { position: relative; z-index: 1; }
  .head { display: flex; justify-content: space-between; gap: 8mm; align-items: flex-start; }
  .seller-name { font-size: 13pt; font-weight: 700; }
  .muted { color: #4b5563; }
  .doc-box { text-align: right; }
  .doc-title { font-size: 15pt; font-weight: 800; text-transform: none; }
  .pill { display: inline-block; border: 1pt solid #b91c1c; color: #b91c1c; font-weight: 800; font-size: 9pt; padding: 0.5mm 2mm; border-radius: 2mm; margin-left: 2mm; vertical-align: middle; }
  .dup { display: inline-block; border: 1.5pt solid #111827; font-weight: 800; padding: 1mm 3mm; margin-top: 2mm; letter-spacing: 1pt; }
  .mentions { margin-top: 1.5mm; font-weight: 700; }
  .mentions span { display: inline-block; border: 0.8pt solid #111827; padding: 0.4mm 1.6mm; margin: 0.6mm 0 0 1.2mm; font-size: 8.5pt; }
  .state { margin-top: 1.5mm; color: #92400e; font-weight: 700; }
  .meta { margin-top: 2mm; }
  .parties { display: flex; gap: 6mm; margin-top: 5mm; }
  .party { flex: 1; border: 0.6pt solid #d1d5db; border-radius: 1.5mm; padding: 2.5mm 3mm; }
  .party h3 { margin: 0 0 1mm 0; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.6pt; color: #6b7280; }
  .party .name { font-weight: 700; font-size: 10.5pt; }
  .note { margin-top: 4mm; font-size: 8.5pt; color: #374151; display: flex; justify-content: space-between; }
  table { width: 100%; border-collapse: collapse; margin-top: 1.5mm; }
  th { background: #f3f4f6; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.4pt; text-align: left; padding: 1.5mm; border-bottom: 0.8pt solid #9ca3af; }
  td { padding: 1.5mm; border-bottom: 0.4pt solid #e5e7eb; vertical-align: top; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  .sub { font-size: 8pt; color: #4b5563; }
  .totals { display: flex; justify-content: space-between; gap: 6mm; margin-top: 4mm; align-items: flex-start; }
  .totals .groups { flex: 1.4; }
  .totals .sum { flex: 1; }
  .sum table td { border: none; padding: 0.8mm 1.5mm; }
  .sum .grand td { font-size: 11.5pt; font-weight: 800; border-top: 1pt solid #111827; padding-top: 1.5mm; }
  .words { margin-top: 3mm; font-style: italic; }
  .cv { margin-top: 1.5mm; font-weight: 600; }
  .security { margin-top: 5mm; border: 1pt solid #111827; border-radius: 1.5mm; padding: 3mm; display: flex; gap: 5mm; align-items: center; page-break-inside: avoid; }
  .security h3 { margin: 0 0 1.5mm 0; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.5pt; }
  .security table td { border: none; padding: 0.6mm 1.5mm 0.6mm 0; font-size: 9pt; }
  .security .k { color: #4b5563; white-space: nowrap; }
  .security .v { font-family: 'Courier New', monospace; font-weight: 700; word-break: break-all; }
  .qr { width: 34mm; height: 34mm; flex: none; }
  .qr svg { width: 34mm; height: 34mm; display: block; }
  .foot { margin-top: 4mm; font-size: 8.5pt; color: #374151; }
`;

function partyHtml(heading: string, p: InvoiceDocumentModel['seller']): string {
  return `<div class="party"><h3>${esc(heading)}</h3><div class="name">${esc(p.title)}</div>${p.lines
    .map((l) => `<div>${esc(l)}</div>`)
    .join('')}</div>`;
}

/** Bandeau répété en tête et en pied de CHAQUE page (gabarits Chromium). */
function bandTemplate(m: InvoiceDocumentModel, where: 'header' | 'footer'): string {
  const parts: string[] = [];
  if (where === 'header') {
    if (m.test) parts.push(`<b style="color:#b91c1c">${esc(m.test.banner)}</b>`);
    if (m.duplicate) parts.push(`<b>${esc(m.duplicate.label)}</b>`);
  } else {
    // `footer` porte déjà la mention de test et le numéro de duplicata.
    parts.push(
      m.test
        ? `<b style="color:#b91c1c">${esc(m.footer)}</b>`
        : m.duplicate
          ? `<b>${esc(m.footer)}</b>`
          : esc(m.footer),
    );
    parts.push('Page <span class="pageNumber"></span> / <span class="totalPages"></span>');
  }
  return `<div style="width:100%;font-size:7.5pt;font-family:Arial,sans-serif;color:#374151;padding:0 12mm;display:flex;justify-content:space-between;gap:4mm;">${parts
    .map((p) => `<span>${p}</span>`)
    .join('')}</div>`;
}

export function invoiceHeaderTemplate(m: InvoiceDocumentModel): string {
  return bandTemplate(m, 'header');
}

export function invoiceFooterTemplate(m: InvoiceDocumentModel): string {
  return bandTemplate(m, 'footer');
}

/** HTML complet du document. `qrSvg` : SVG du QR (facture normalisée), sinon `null`. */
export function renderInvoiceDocumentHtml(m: InvoiceDocumentModel, qrSvg: string | null): string {
  const testMark = m.test ? `<div class="test-mark">${esc(m.test.mark)}</div>` : '';
  const testBand = m.test ? `<div class="test-band">${esc(m.test.banner)}</div>` : '';
  const pill = m.test ? `<span class="pill">${esc(m.test.mark)}</span>` : '';
  const dup = m.duplicate ? `<div><span class="dup">${esc(m.duplicate.label)}</span></div>` : '';
  const mentions =
    m.natureMentions.length > 0
      ? `<div class="mentions">${m.natureMentions.map((x) => `<span>${esc(x)}</span>`).join('')}</div>`
      : '';
  const state = m.stateMentions.map((x) => `<div class="state">${esc(x)}</div>`).join('');

  const lineRows = m.lines
    .map(
      (l) => `<tr>
        <td>${esc(l.name)}${l.code ? `<div class="sub">${esc(l.code)}</div>` : ''}${
          l.modification ? `<div class="sub">${esc(l.modification)}</div>` : ''
        }${l.specificTax ? `<div class="sub">${esc(l.specificTax)}</div>` : ''}</td>
        <td>${esc(l.itemType)}</td>
        <td>${esc(l.group)}</td>
        <td class="n">${esc(l.quantity)}</td>
        <td class="n">${esc(l.unitPrice)}</td>
        <td class="n">${esc(l.amount)}</td>
      </tr>`,
    )
    .join('');

  const groupRows = m.groups
    .map(
      (g) =>
        `<tr><td>${esc(g.group)}</td><td class="n">${esc(g.rate)}</td><td class="n">${esc(g.ht)}</td><td class="n">${esc(g.vat)}</td><td class="n">${esc(g.total)}</td></tr>`,
    )
    .join('');

  const payRows = m.payments
    .map((p) => `<tr><td>${esc(p.label)}</td><td class="n">${esc(p.amount)}</td></tr>`)
    .join('');

  const security = m.security
    ? `<div class="security">
        <div class="qr">${safeSvg(qrSvg ?? '')}</div>
        <div>
          <h3>Éléments de sécurité DGI</h3>
          <table>
            <tr><td class="k">Code DEF/DGI</td><td class="v">${esc(m.security.codeDefDgi)}</td></tr>
            <tr><td class="k">DEF NIM</td><td class="v">${esc(m.security.nim)}</td></tr>
            <tr><td class="k">DEF Compteurs</td><td class="v">${esc(m.security.counters)}</td></tr>
            <tr><td class="k">DEF Heure</td><td class="v">${esc(m.security.dgiDateTime)}</td></tr>
            <tr><td class="k">ISF</td><td class="v">${esc(m.security.isf)}</td></tr>
          </table>
        </div>
      </div>`
    : '';

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" />
  <title>${esc(m.title)} — ${esc(m.reference.value)}</title>
  <style>${CSS}</style>
</head>
<body>
  ${testMark}
  <div class="content">
    ${testBand}
    <div class="head">
      <div>
        <div class="seller-name">${esc(m.seller.title)}</div>
        ${m.seller.lines.map((l) => `<div class="muted">${esc(l)}</div>`).join('')}
      </div>
      <div class="doc-box">
        <div class="doc-title">${esc(m.title)}${pill}</div>
        ${mentions}
        ${state}
        ${dup}
        <div class="meta">${esc(m.reference.label)} <b>${esc(m.reference.value)}</b></div>
        <div>${esc(m.date.label)} : ${esc(m.date.value)}</div>
      </div>
    </div>

    <div class="parties">
      ${partyHtml('Client', m.customer)}
      ${
        m.creditReference.length > 0
          ? `<div class="party"><h3>Référence</h3>${m.creditReference.map((r) => `<div>${esc(r)}</div>`).join('')}</div>`
          : ''
      }
    </div>

    <div class="note"><span>${esc(m.amountsNote)}</span><span>${esc(m.priceModeLabel)}</span></div>
    <table>
      <thead><tr><th>Désignation</th><th>Type</th><th>Groupe</th><th class="n">Quantité</th><th class="n">Prix unitaire</th><th class="n">Montant</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>

    <div class="totals">
      <div class="groups">
        <table>
          <thead><tr><th>Groupe</th><th class="n">Taux</th><th class="n">Base</th><th class="n">TVA</th><th class="n">Total</th></tr></thead>
          <tbody>${groupRows}</tbody>
        </table>
        ${
          payRows
            ? `<table><thead><tr><th>Mode de paiement</th><th class="n">Montant</th></tr></thead><tbody>${payRows}</tbody></table>`
            : ''
        }
      </div>
      <div class="sum">
        <table>
          ${m.specificTaxTotal ? `<tr><td>Taxe spécifique</td><td class="n">${esc(m.specificTaxTotal)}</td></tr>` : ''}
          <tr><td>Total TVA</td><td class="n">${esc(m.vatTotal)}</td></tr>
          <tr class="grand"><td>Total TTC (${esc(m.currency)})</td><td class="n">${esc(m.total)}</td></tr>
        </table>
      </div>
    </div>

    <div class="words">${esc(m.totalInWords)}</div>
    ${m.counterValue ? `<div class="cv">${esc(m.counterValue)}</div>` : ''}

    ${security}

    <div class="foot">
      ${m.operator ? `<div>Établi par : ${esc(m.operator)}</div>` : ''}
      ${m.comments.map((c) => `<div>${esc(c)}</div>`).join('')}
    </div>
  </div>
</body>
</html>`;
}
