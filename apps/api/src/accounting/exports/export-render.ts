// Mise en forme des exports comptables : CSV, `.xlsx`, HTML imprimé en PDF (ADR-0049 § 9,
// § 10). ADR-0049 — K6.
//
// Fonctions PURES de SÉRIALISATION : les montants arrivent déjà calculés par le moteur, en
// chaînes décimales ; rien n'est additionné ici. Chaque fichier porte en tête le bandeau
// (« Projet — à valider par un expert-comptable », ou celui de la simulation), la période,
// la monnaie de tenue, le pack et les versions de règles, puis la liste des réserves.
//
// - CSV : séparateur « ; », UTF-8 avec BOM, formules neutralisées (`csvCell`, partagé avec
//   l'export du journal des ventes) ; un montant n'est jamais préfixé.
// - `.xlsx` : bandeau en tête de CHAQUE feuille et dans son en-tête d'impression ; valeurs
//   écrites en cellule, jamais en formule.
// - PDF : bandeau dans le corps ET dans l'en-tête répété de CHAQUE page (gabarit Chromium).

import ExcelJS from 'exceljs';

import { csvCell } from '../../sales/invoices/journal-export.js';

export interface ExportColumnSpec {
  key: string;
  label: string;
  /** Montant décimal : jamais neutralisé, aligné à droite, nombre en `.xlsx`. */
  amount?: boolean;
}

export interface ExportTable {
  title: string;
  columns: readonly ExportColumnSpec[];
  rows: readonly Record<string, string | number | null>[];
  /** Phrase imprimée sous le titre (disclaimer d'un projet d'état, « non disponible »…). */
  notes?: readonly string[];
}

export interface ExportDocument {
  title: string;
  banner: string;
  /** Paires « libellé ; valeur » de l'en-tête. */
  preamble: readonly (readonly [string, string])[];
  reserves: readonly { code: string; message: string }[];
  tables: readonly ExportTable[];
}

const BOM = '﻿';
const AMOUNT = /^-?\d+(\.\d+)?$/;

function cellOf(value: string | number | null | undefined, amount: boolean): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return csvCell(s, !(amount && AMOUNT.test(s)));
}

/** CSV : en-tête du projet, réserves, puis chaque tableau (titre, colonnes, lignes). */
export function renderCsv(doc: ExportDocument): Buffer {
  const lines: string[] = [];
  const row = (cells: readonly (string | null)[]) => cells.map((c) => cellOf(c, false)).join(';');
  lines.push(row([doc.banner]));
  lines.push(row([doc.title]));
  for (const [k, v] of doc.preamble) lines.push(row([k, v]));
  if (doc.reserves.length === 0) lines.push(row(['Réserves', 'Aucune']));
  for (const r of doc.reserves) lines.push(row(['Réserve', r.code, r.message]));
  for (const t of doc.tables) {
    lines.push('');
    if (doc.tables.length > 1) lines.push(row([t.title]));
    for (const n of t.notes ?? []) lines.push(row([n]));
    lines.push(row(t.columns.map((c) => c.label)));
    for (const r of t.rows) {
      lines.push(t.columns.map((c) => cellOf(r[c.key], c.amount === true)).join(';'));
    }
  }
  return Buffer.from(`${BOM}${lines.join('\r\n')}\r\n`, 'utf8');
}

/** Nom de feuille Excel : 31 caractères, sans `\ / ? * [ ] :`. */
function sheetName(raw: string, used: Set<string>): string {
  const base =
    raw
      .replace(/[\\/?*[\]:]/g, ' ')
      .slice(0, 28)
      .trim() || 'Feuille';
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base.slice(0, 26)} ${n++}`;
  used.add(name);
  return name;
}

/** Classeur : une feuille par tableau, plus « Réserves » ; bandeau sur chaque feuille. */
export async function renderXlsx(doc: ExportDocument): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lalanda';
  wb.title = doc.title;
  wb.subject = doc.banner;
  const used = new Set<string>();

  const head = (ws: ExcelJS.Worksheet, title: string): void => {
    ws.headerFooter.oddHeader = `&C${doc.banner.replace(/&/g, '&&')}`;
    ws.headerFooter.oddFooter = `&L${doc.banner.replace(/&/g, '&&')}&RPage &P / &N`;
    const b = ws.addRow([doc.banner]);
    b.font = { bold: true };
    ws.addRow([title]).font = { bold: true };
    for (const [k, v] of doc.preamble) ws.addRow([k, v]);
    ws.addRow([]);
  };

  for (const t of doc.tables) {
    const ws = wb.addWorksheet(sheetName(t.title, used));
    head(ws, t.title);
    for (const n of t.notes ?? []) ws.addRow([n]).font = { italic: true };
    const header = ws.addRow(t.columns.map((c) => c.label));
    header.font = { bold: true };
    for (const r of t.rows) {
      ws.addRow(
        t.columns.map((c) => {
          const v = r[c.key];
          if (v === null || v === undefined) return null;
          if (c.amount === true && typeof v === 'string' && AMOUNT.test(v)) return Number(v);
          return typeof v === 'number' ? v : String(v);
        }),
      );
    }
    t.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.min(Math.max(c.label.length + 2, 12), 48);
      if (c.amount === true) col.numFmt = '#,##0.00';
    });
  }

  const rs = wb.addWorksheet(sheetName('Réserves', used));
  head(rs, 'Réserves');
  rs.addRow(['Code', 'Réserve']).font = { bold: true };
  if (doc.reserves.length === 0) rs.addRow(['—', 'Aucune réserve signalée.']);
  for (const r of doc.reserves) rs.addRow([r.code, r.message]);
  rs.getColumn(1).width = 34;
  rs.getColumn(2).width = 100;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** HTML imprimé en PDF : aucun script, aucune ressource externe (rendu confiné, S22e). */
export function renderHtml(doc: ExportDocument): string {
  const e = escapeHtml;
  const table = (t: ExportTable): string => `
    <section>
      <h2>${e(t.title)}</h2>
      ${(t.notes ?? []).map((n) => `<p class="note">${e(n)}</p>`).join('')}
      ${
        t.rows.length === 0
          ? '<p class="vide">Aucune ligne.</p>'
          : `<table><thead><tr>${t.columns
              .map((c) => `<th${c.amount ? ' class="m"' : ''}>${e(c.label)}</th>`)
              .join('')}</tr></thead><tbody>${t.rows
              .map(
                (r) =>
                  `<tr>${t.columns
                    .map((c) => {
                      const v = r[c.key];
                      return `<td${c.amount ? ' class="m"' : ''}>${e(v === null || v === undefined ? '' : String(v))}</td>`;
                    })
                    .join('')}</tr>`,
              )
              .join('')}</tbody></table>`
      }
    </section>`;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${e(doc.title)}</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; font-size: 10px; color: #111; }
  .bandeau { border: 2px solid #111; padding: 6px 8px; font-weight: bold; margin-bottom: 8px; }
  h1 { font-size: 14px; margin: 4px 0; } h2 { font-size: 12px; margin: 12px 0 4px; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: 2px 4px; text-align: left; }
  .m { text-align: right; white-space: nowrap; } .note { font-style: italic; } dl { margin: 0; }
  dt { font-weight: bold; float: left; clear: left; width: 30%; } dd { margin-left: 31%; }
</style></head><body>
<div class="bandeau">${e(doc.banner)}</div>
<h1>${e(doc.title)}</h1>
<dl>${doc.preamble.map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join('')}</dl>
<h2>Réserves</h2>
${
  doc.reserves.length === 0
    ? '<p>Aucune réserve signalée.</p>'
    : `<ul>${doc.reserves.map((r) => `<li><strong>${e(r.code)}</strong> — ${e(r.message)}</li>`).join('')}</ul>`
}
${doc.tables.map(table).join('')}
</body></html>`;
}

/** En-tête répété sur chaque page du PDF (gabarit Chromium : texte déjà échappé). */
export function pdfHeaderTemplate(banner: string): string {
  return `<div style="font-size:8px;width:100%;text-align:center;font-weight:bold;">${escapeHtml(banner)}</div>`;
}

export function pdfFooterTemplate(banner: string): string {
  return `<div style="font-size:7px;width:100%;padding:0 10mm;display:flex;justify-content:space-between;"><span>${escapeHtml(banner)}</span><span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}
