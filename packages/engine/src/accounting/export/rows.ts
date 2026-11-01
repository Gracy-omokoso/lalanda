// Lignes d'export pour l'expert-comptable (ADR-0049 § 9, § 12 `exportRows`).
//
// Une ligne par ligne d'écriture `posted`. Colonnes « de type FEC » (fichier
// des écritures comptables utilisé en France) : un FORMAT PRATIQUE, pas une
// obligation en RDC (décision ouverte n° 14, question E10) ; plus quatre
// colonnes Lalanda. Le moteur rend des chaînes ; la sérialisation (CSV `;`,
// UTF-8 avec BOM, formules neutralisées, `.xlsx`) appartient à l'API.

import {
  checkCurrency,
  checkDay,
  compareLines,
  formatCents,
  postedLines,
} from '../ledger/money.js';
import {
  ACCOUNTING_REPORTING_VERSION,
  type LineRef,
  type ReportingCurrency,
  type ReportingDay,
  type ReportingEntry,
} from '../ledger/types.js';
import type { Reserve } from '../statements/reserves.js';
import { EXPORT_FORMAT_NOTE, PROJECT_BANNER, SIMULATION_BANNER } from '../statements/wording.js';

/** Colonnes, dans l'ordre : les dix-huit de type FEC, puis les quatre de Lalanda. */
export const EXPORT_COLUMNS = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
  'CleSource',
  'VersionRegles',
  'VersionMoteur',
  'EmpreinteEcriture',
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];
export type ExportRow = Record<ExportColumn, string>;

export interface ExportRowsInput {
  entries: readonly ReportingEntry[];
  mode: 'simulation' | 'active';
  bookCurrency: ReportingCurrency;
  from: ReportingDay;
  to: ReportingDay;
  chartPack: { slug: string; version: number | string };
  journalLabels?: Readonly<Record<string, string>>;
  accountLabels?: Readonly<Record<string, string>>;
  auxiliaryLabels?: Readonly<Record<string, string>>;
  /** État courant du lettrage (ligne → code et date) ; à défaut, le code porté par la ligne. */
  lettering?: Readonly<Record<LineRef, { code: string; date: ReportingDay }>>;
  /** Réserves imprimées dans l'en-tête (§ 6.10). */
  reserves: readonly Reserve[];
}

export interface ExportRows {
  version: string;
  header: {
    banner: string;
    simulation: boolean;
    from: ReportingDay;
    to: ReportingDay;
    bookCurrency: ReportingCurrency;
    chartPack: { slug: string; version: number | string };
    /** Versions de règles présentes dans les lignes exportées. */
    ruleSetVersions: number[];
    formatNote: string;
    reserves: { code: string; message: string }[];
  };
  columns: readonly ExportColumn[];
  rows: ExportRow[];
  /** Contrôle : totaux des colonnes `Debit` et `Credit`. */
  totals: { debit: string; credit: string; lineCount: number; entryCount: number };
  /** Nom de fichier proposé (sans extension), préfixé en simulation. */
  fileStem: string;
}

export function exportRows(input: ExportRowsInput): ExportRows {
  checkCurrency(input.bookCurrency, 'Monnaie de tenue');
  checkDay(input.from, 'Début de période');
  checkDay(input.to, 'Fin de période');
  if (input.from > input.to) throw new RangeError('Période inversée');
  const simulation = input.mode === 'simulation';
  const lines = postedLines(input.entries)
    .filter((l) => l.entry.date >= input.from && l.entry.date <= input.to)
    .sort(compareLines);

  let debit = 0n;
  let credit = 0n;
  const entryIds = new Set<string>();
  const ruleSets = new Set<number>();
  const rows: ExportRow[] = lines.map((l) => {
    debit += l.debit;
    credit += l.credit;
    entryIds.add(l.entry.id);
    const gen = l.entry.generation ?? null;
    if (gen !== null && gen.ruleSetVersion !== null) ruleSets.add(gen.ruleSetVersion);
    const letter = input.lettering?.[l.ref] ?? null;
    const aux = l.line.auxiliaryAccountNumber ?? null;
    const amount = l.doc < 0n ? -l.doc : l.doc;
    return {
      JournalCode: l.entry.journalCode,
      JournalLib: input.journalLabels?.[l.entry.journalCode] ?? '',
      EcritureNum: l.entry.number === null ? '' : String(l.entry.number),
      EcritureDate: l.entry.date,
      CompteNum: l.line.accountNumber,
      CompteLib: input.accountLabels?.[l.line.accountNumber] ?? '',
      CompAuxNum: aux ?? '',
      CompAuxLib:
        aux === null ? '' : (input.auxiliaryLabels?.[aux] ?? l.entry.source?.partyName ?? ''),
      PieceRef: l.entry.source?.number ?? l.entry.source?.id ?? '',
      PieceDate: l.entry.source?.date ?? '',
      EcritureLib: l.line.label,
      Debit: formatCents(l.debit),
      Credit: formatCents(l.credit),
      EcritureLet: letter?.code ?? l.line.letteringCode ?? '',
      DateLet: letter?.date ?? '',
      ValidDate: l.entry.postedOn ?? '',
      Montantdevise: formatCents(amount),
      Idevise: l.currency,
      CleSource: l.entry.sourceKey ?? '',
      VersionRegles: gen === null || gen.ruleSetVersion === null ? '' : String(gen.ruleSetVersion),
      VersionMoteur: gen?.engineVersion ?? '',
      EmpreinteEcriture: l.entry.hash ?? '',
    };
  });

  const stem = `comptabilite-projet_${input.from}_${input.to}`;
  return {
    version: ACCOUNTING_REPORTING_VERSION,
    header: {
      banner: simulation ? SIMULATION_BANNER : PROJECT_BANNER,
      simulation,
      from: input.from,
      to: input.to,
      bookCurrency: input.bookCurrency,
      chartPack: input.chartPack,
      ruleSetVersions: [...ruleSets].sort((a, b) => a - b),
      formatNote: EXPORT_FORMAT_NOTE,
      reserves: input.reserves.map((r) => ({ code: r.code, message: r.message })),
    },
    columns: EXPORT_COLUMNS,
    rows,
    totals: {
      debit: formatCents(debit),
      credit: formatCents(credit),
      lineCount: rows.length,
      entryCount: entryIds.size,
    },
    fileStem: simulation ? `SIMULATION_${stem}` : stem,
  };
}
