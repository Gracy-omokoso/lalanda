// CSV du CRM : lecture et écriture — ADR-0035 § 2.
//
// Fonctions PURES. Écriture : séparateur « ; » (tableurs francophones), UTF-8
// avec BOM, cellule texte qui commence par = + - @ neutralisée par une
// apostrophe (`csvCell`, partagée avec l'export du journal des ventes). Lecture :
// RFC 4180 (guillemets, guillemets doublés, sauts de ligne dans un champ),
// séparateur « ; » ou « , » détecté sur l'en-tête, BOM toléré, apostrophe de
// neutralisation retirée — un fichier exporté se réimporte tel quel.

import { csvCell } from '../sales/invoices/journal-export.js';

const BOM = '﻿';

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | null)[])[],
): string {
  const line = (cells: readonly (string | null)[]) => cells.map((c) => csvCell(c)).join(';');
  return `${BOM}${[line(header), ...rows.map(line)].join('\r\n')}\r\n`;
}

export type CsvParse =
  | { ok: true; header: string[]; rows: { line: number; cells: Record<string, string> }[] }
  | { ok: false; message: string };

function splitRecords(text: string, sep: string): { line: number; cells: string[] }[] | null {
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      cells.push(cell);
      out.push({ line: startLine, cells });
      cells = [];
      cell = '';
      line += 1;
      startLine = line;
    } else cell += ch;
  }
  if (quoted) return null;
  if (cell !== '' || cells.length > 0) {
    cells.push(cell);
    out.push({ line: startLine, cells });
  }
  return out.filter((r) => r.cells.some((c) => c.trim() !== ''));
}

/** Cellule lue : espaces de bord retirés, apostrophe de neutralisation ôtée. */
function cleanCell(raw: string): string {
  const t = raw.trim();
  return /^'[=+\-@]/.test(t) ? t.slice(1) : t;
}

/** En-tête normalisé : minuscules, sans accents, espaces → « _ ». */
export function headerKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function parseCsv(
  input: string,
  opts: { required: readonly string[]; maxRows: number },
): CsvParse {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep =
    (firstLine.match(/;/g) ?? []).length >= (firstLine.match(/,/g) ?? []).length ? ';' : ',';
  const records = splitRecords(text, sep);
  if (records === null) return { ok: false, message: 'Guillemet non refermé dans le fichier.' };
  const [head, ...body] = records;
  if (!head) return { ok: false, message: 'Fichier vide : la ligne d’en-tête manque.' };
  const header = head.cells.map(headerKey);
  const missing = opts.required.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { ok: false, message: `Colonne(s) obligatoire(s) absente(s) : ${missing.join(', ')}.` };
  }
  if (body.length === 0) return { ok: false, message: 'Aucune ligne de données.' };
  if (body.length > opts.maxRows) {
    return { ok: false, message: `${opts.maxRows} lignes au plus par import.` };
  }
  return {
    ok: true,
    header,
    rows: body.map((r) => {
      const cells: Record<string, string> = {};
      header.forEach((h, i) => {
        cells[h] = cleanCell(r.cells[i] ?? '');
      });
      return { line: r.line, cells };
    }),
  };
}

/** Montant saisi dans un tableur (« 1 500,00 ») → forme de l'API (« 1500.00 »), sans calcul. */
export function amountFromSheet(raw: string): string {
  return raw.replace(/[\s  ]/g, '').replace(',', '.');
}
