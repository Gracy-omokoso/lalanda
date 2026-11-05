// Lecture d'un fichier de tâches (.xlsx ou .csv) et passage au plan commun —
// ADR-0062.
//
// Deux étages, tous deux sans base ni réseau :
//
//   1. `readTable` : octets → tableau de cellules TEXTE. Le .xlsx est lu par
//      `exceljs` (déjà dépendance de l'API, audit propre) APRÈS un contrôle du
//      zip : taille décompressée bornée (bombe zip), aucune macro
//      (`vbaProject.bin`). Une formule n'est JAMAIS évaluée : on lit la valeur
//      mise en cache par le tableur, ou rien. Le .csv est décodé en UTF-8 (BOM
//      retiré ; à défaut Windows-1252), séparateur deviné parmi « ; », « , » et
//      tabulation, guillemets à la RFC 4180.
//   2. `tableToPlan` : cellules → lignes du plan (`WorkPlanTask`) et problèmes
//      ligne par ligne, en français. Une ERREUR écarte la ligne ; un
//      AVERTISSEMENT signale une correction (responsable inconnu → sans
//      responsable, dépendance introuvable ignorée, cycle cassé…).

import {
  WORK_LIMITS,
  WORK_PLAN_LIMITS,
  isCalendarDay,
  planCycle,
  type WorkImportIssue,
  type WorkImportPreview,
  type WorkImportRowView,
  type WorkPlanTask,
  type WorkPriority,
} from '@lalanda/shared/work';
import ExcelJS from 'exceljs';

import { normalizeLabel } from './work-plan-builder.js';

// ── Colonnes du modèle ──────────────────────────────────────────────────────

export type ImportField =
  | 'section'
  | 'title'
  | 'description'
  | 'assignee'
  | 'startDate'
  | 'dueDate'
  | 'priority'
  | 'milestone'
  | 'dependsOn'
  | 'labels'
  | 'parent'
  | 'estimate';

/** En-têtes du modèle, dans l'ordre (libellés écrits dans le fichier). */
export const IMPORT_COLUMNS: readonly { field: ImportField; header: string }[] = [
  { field: 'section', header: 'Section' },
  { field: 'title', header: 'Tâche' },
  { field: 'description', header: 'Description' },
  { field: 'assignee', header: 'Responsable (e-mail)' },
  { field: 'startDate', header: 'Début' },
  { field: 'dueDate', header: 'Échéance' },
  { field: 'priority', header: 'Priorité' },
  { field: 'milestone', header: 'Jalon' },
  { field: 'dependsOn', header: 'Dépend de' },
  { field: 'labels', header: 'Étiquettes' },
  { field: 'parent', header: 'Sous-tâche de' },
  { field: 'estimate', header: 'Estimation (heures)' },
];

/** Noms acceptés pour chaque colonne (comparés sans accents, sans casse, sans « * » ni parenthèses). */
const ALIASES: Record<ImportField, readonly string[]> = {
  section: ['section', 'colonne', 'phase', 'etape', 'statut'],
  title: ['tache', 'titre', 'nom', 'nom de la tache', 'intitule', 'task', 'title'],
  description: ['description', 'details', 'detail', 'notes'],
  assignee: ['responsable', 'assigne', 'assigne a', 'e-mail', 'email', 'courriel', 'assignee'],
  startDate: ['debut', 'date de debut', 'commence le', 'start', 'start date'],
  dueDate: ['echeance', 'date d echeance', 'date limite', 'fin', 'date de fin', 'due', 'due date'],
  priority: ['priorite', 'priority'],
  milestone: ['jalon', 'milestone'],
  dependsOn: ['depend de', 'dependances', 'dependance', 'predecesseur', 'predecesseurs', 'apres'],
  labels: ['etiquettes', 'etiquette', 'tags', 'tag', 'labels'],
  parent: ['sous-tache de', 'sous tache de', 'tache parente', 'parent'],
  estimate: ['estimation', 'estimation heures', 'heures', 'charge', 'duree estimee'],
};

const HEADER_OF: Record<ImportField, string> = Object.fromEntries(
  IMPORT_COLUMNS.map((c) => [c.field, c.header]),
) as Record<ImportField, string>;

function headerKey(raw: string): string {
  return normalizeLabel(
    raw
      .replace(/\(.*?\)/g, ' ')
      .replace(/[*:]/g, ' ')
      .replace(/['’_]/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Champ reconnu pour un en-tête, ou `null`. */
export function fieldOfHeader(raw: string): ImportField | null {
  const k = headerKey(raw);
  if (k === '') return null;
  for (const [field, names] of Object.entries(ALIASES) as [ImportField, readonly string[]][]) {
    if (names.includes(k)) return field;
  }
  return null;
}

// ── Priorités (valeurs réelles du modèle de tâche) ──────────────────────────

/** Libellés français des priorités, dans l'ordre du modèle (`none` = « Aucune »). */
export const PRIORITY_LABELS: Record<WorkPriority, string> = {
  none: 'Aucune',
  low: 'Basse',
  medium: 'Moyenne',
  high: 'Haute',
  urgent: 'Urgente',
};

const PRIORITY_OF: Record<string, WorkPriority> = {
  aucune: 'none',
  none: 'none',
  basse: 'low',
  faible: 'low',
  low: 'low',
  moyenne: 'medium',
  normale: 'medium',
  medium: 'medium',
  haute: 'high',
  elevee: 'high',
  high: 'high',
  urgente: 'urgent',
  urgent: 'urgent',
};

// ── Étage 1 : lecture du fichier ────────────────────────────────────────────

export class ImportFileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImportFileError';
  }
}

export interface ImportTable {
  format: 'xlsx' | 'csv';
  headers: string[];
  /** Lignes de données ; `row` = numéro de ligne dans le fichier (en-tête = 1). */
  rows: { row: number; cells: string[] }[];
}

/** Décompressé maximal d'un .xlsx (contre les bombes zip). */
export const XLSX_UNCOMPRESSED_MAX = 40 * 1024 * 1024;

function isZip(buf: Buffer): boolean {
  return (
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
  );
}

/**
 * Lit le répertoire central du zip SANS rien décompresser : somme des tailles
 * annoncées, présence de macros. Refuse un zip illisible, trop gros une fois
 * décompressé, ou porteur de macros.
 */
export function inspectZip(buf: Buffer): { entries: string[]; uncompressed: number } {
  const min = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0)
    throw new ImportFileError(
      'IMPORT_FILE_UNREADABLE',
      'Classeur illisible : le fichier .xlsx est abîmé.',
    );
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: string[] = [];
  let uncompressed = 0;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new ImportFileError(
        'IMPORT_FILE_UNREADABLE',
        'Classeur illisible : le fichier .xlsx est abîmé.',
      );
    }
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push(name);
    uncompressed += size === 0xffffffff ? Number.MAX_SAFE_INTEGER : size;
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (entries.some((e) => /vbaproject\.bin$/i.test(e) || (/\.bin$/i.test(e) && /macro/i.test(e)))) {
    throw new ImportFileError(
      'IMPORT_FILE_MACRO',
      'Ce classeur contient des macros : enregistrez-le en .xlsx simple (sans macros) puis réessayez.',
    );
  }
  if (uncompressed > XLSX_UNCOMPRESSED_MAX) {
    throw new ImportFileError(
      'IMPORT_FILE_TOO_LARGE',
      'Ce classeur est trop volumineux une fois ouvert : gardez seulement l’onglet des tâches.',
    );
  }
  if (!entries.some((e) => e === 'xl/workbook.xml')) {
    throw new ImportFileError(
      'IMPORT_FILE_UNREADABLE',
      'Ce fichier n’est pas un classeur Excel (.xlsx). Formats acceptés : .xlsx et .csv.',
    );
  }
  return { entries, uncompressed };
}

/** Jour civil d'une date de tableur (minuit UTC chez exceljs). */
function dayOfDate(d: Date): string {
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Texte d'une cellule exceljs ; une formule rend sa valeur EN CACHE, jamais un calcul. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return dayOfDate(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v['richText'])) {
      return (v['richText'] as { text?: unknown }[])
        .map((r) => (typeof r.text === 'string' ? r.text : ''))
        .join('');
    }
    if ('formula' in v || 'sharedFormula' in v) return 'result' in v ? cellText(v['result']) : '';
    if (typeof v['text'] === 'string') return v['text'];
    if ('error' in v) return '';
  }
  return '';
}

async function readXlsx(buf: Buffer): Promise<ImportTable> {
  inspectZip(buf);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError(
      'IMPORT_FILE_UNREADABLE',
      'Classeur illisible : ouvrez-le dans Excel, enregistrez-le en .xlsx et réessayez.',
    );
  }
  const sheets = wb.worksheets;
  const sheet =
    sheets.find((s) => headerKey(s.name) === 'taches') ??
    sheets.find((s) => headerKey(s.name) !== 'guide') ??
    sheets[0];
  if (!sheet)
    throw new ImportFileError('IMPORT_FILE_EMPTY', 'Le classeur ne contient aucune feuille.');
  const width = Math.min(sheet.columnCount, 50);
  const lines: { row: number; cells: string[] }[] = [];
  sheet.eachRow({ includeEmpty: false }, (r, rowNumber) => {
    if (lines.length > WORK_PLAN_LIMITS.importRowsMax + 1) return;
    const cells: string[] = [];
    for (let c = 1; c <= width; c += 1) cells.push(cellText(r.getCell(c).value).trim());
    lines.push({ row: rowNumber, cells });
  });
  const header = lines.shift();
  if (!header) throw new ImportFileError('IMPORT_FILE_EMPTY', 'La feuille des tâches est vide.');
  return { format: 'xlsx', headers: header.cells, rows: lines };
}

function decodeText(buf: Buffer): string {
  let b = buf;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('windows-1252').decode(b);
  }
}

/** Séparateur le plus fréquent de la première ligne (hors guillemets). */
export function guessDelimiter(firstLine: string): string {
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > 0 ? best[0] : ';';
}

/** CSV à la RFC 4180 (guillemets doublés, retours à la ligne dans un champ). */
export function parseCsv(text: string, delimiter: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
      if (out.length > WORK_PLAN_LIMITS.importRowsMax + 50) break;
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

function readCsv(buf: Buffer): ImportTable {
  const text = decodeText(buf);
  if (text.includes('\u0000')) {
    throw new ImportFileError(
      'IMPORT_FILE_UNREADABLE',
      'Ce fichier n’est ni un .xlsx ni un .csv lisible.',
    );
  }
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const all = parseCsv(text, guessDelimiter(firstLine));
  const numbered = all.map((cells, i) => ({ row: i + 1, cells: cells.map((c) => c.trim()) }));
  const lines = numbered.filter((l) => l.cells.some((c) => c !== ''));
  const header = lines.shift();
  if (!header) throw new ImportFileError('IMPORT_FILE_EMPTY', 'Le fichier est vide.');
  return { format: 'csv', headers: header.cells, rows: lines };
}

/** Octets → tableau. Le contenu décide du format (signature zip), pas le nom. */
export async function readTable(buf: Buffer): Promise<ImportTable> {
  if (buf.length === 0) throw new ImportFileError('IMPORT_FILE_EMPTY', 'Le fichier est vide.');
  if (buf.length > WORK_PLAN_LIMITS.importFileMaxBytes) {
    throw new ImportFileError('IMPORT_FILE_TOO_LARGE', 'Le fichier dépasse 2 Mo.');
  }
  return isZip(buf) ? readXlsx(buf) : readCsv(buf);
}

// ── Étage 2 : cellules → plan ───────────────────────────────────────────────

/** Membre de l'organisation proposé comme responsable. */
export interface ImportMember {
  userId: string;
  name: string;
  email: string | null;
  canUpdate: boolean;
}

/**
 * Date civile d'une cellule : JJ/MM/AAAA (aussi « - » ou « . »), AAAA-MM-JJ, ou
 * numéro de série Excel. `''` → `null` ; illisible → `undefined`.
 */
export function parseDay(raw: string): string | null | undefined {
  const s = raw.trim();
  if (s === '') return null;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const d = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    return isCalendarDay(d) ? d : undefined;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) {
    const d = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
    return isCalendarDay(d) ? d : undefined;
  }
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    // 1er janv. 1970 = 25 569 dans le calendrier Excel (système 1900).
    const d = new Date((serial - 25_569) * 86_400_000).toISOString().slice(0, 10);
    return isCalendarDay(d) ? d : undefined;
  }
  return undefined;
}

/** Oui/Non ; `undefined` si illisible. */
export function parseYesNo(raw: string): boolean | undefined {
  const k = normalizeLabel(raw);
  if (k === '' || ['non', 'no', 'n', 'faux', 'false', '0'].includes(k)) return false;
  if (['oui', 'yes', 'o', 'y', 'x', 'vrai', 'true', '1'].includes(k)) return true;
  return undefined;
}

/** Heures (« 1,5 », « 2 », « 1h30 », « 90 min ») → minutes ; `null` vide ; `undefined` illisible. */
export function parseEstimateMinutes(raw: string): number | null | undefined {
  const s = normalizeLabel(raw).replace(/\s+/g, '');
  if (s === '') return null;
  let m = /^(\d+)h(\d{1,2})?$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  m = /^(\d+)(?:min|mn|m)$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d+(?:[.,]\d+)?)(?:h|heures?)?$/.exec(s);
  if (m) return Math.round(Number(m[1]!.replace(',', '.')) * 60);
  return undefined;
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

interface Draft {
  row: number;
  ref: string;
  title: string;
  description: string | null;
  section: string | null;
  assignee: { userId: string; name: string } | null;
  startDate: string | null;
  dueDate: string | null;
  priority: WorkPriority;
  isMilestone: boolean;
  dependsRaw: string[];
  labels: string[];
  parentRaw: string | null;
  estimateMinutes: number | null;
  valid: boolean;
  dependsOn: number[];
  parentRow: number | null;
}

export interface ImportPlanResult {
  preview: WorkImportPreview;
  /** Lignes valides, au format du plan commun. */
  tasks: WorkPlanTask[];
}

/**
 * Cellules → plan. `known` donne les sections (colonnes) et étiquettes déjà
 * connues : les autres sont annoncées comme « à créer ».
 */
export function tableToPlan(
  table: ImportTable,
  members: readonly ImportMember[],
  known: { sections: readonly string[]; labels: readonly string[] },
  fileName: string | null = null,
): ImportPlanResult {
  const issues: WorkImportIssue[] = [];
  const add = (
    row: number | null,
    field: ImportField | null,
    severity: 'error' | 'warning',
    code: string,
    message: string,
  ): void => {
    issues.push({ row, column: field ? HEADER_OF[field] : null, severity, code, message });
  };

  // En-têtes : champ par position, colonnes inconnues ignorées.
  const position = new Map<ImportField, number>();
  const ignoredColumns: string[] = [];
  table.headers.forEach((h, i) => {
    const f = fieldOfHeader(h);
    if (f && !position.has(f)) position.set(f, i);
    else if (h.trim() !== '') ignoredColumns.push(h.trim());
  });
  const empty = (): ImportPlanResult => ({
    preview: {
      fileName,
      format: table.format,
      rows: [],
      issues,
      counts: {
        rows: 0,
        valid: 0,
        invalid: 0,
        warnings: 0,
        milestones: 0,
        subtasks: 0,
        dependencies: 0,
      },
      newSections: [],
      newLabels: [],
      ignoredColumns,
    },
    tasks: [],
  });
  if (!position.has('title')) {
    add(
      null,
      'title',
      'error',
      'IMPORT_TITLE_COLUMN_MISSING',
      'Colonne « Tâche » introuvable : la première ligne doit porter les en-têtes du modèle (Section, Tâche, Description…).',
    );
    return empty();
  }
  if (table.rows.length > WORK_PLAN_LIMITS.importRowsMax) {
    add(
      null,
      null,
      'error',
      'IMPORT_TOO_MANY_ROWS',
      `Le fichier compte plus de ${WORK_PLAN_LIMITS.importRowsMax} lignes de tâches : découpez-le en plusieurs imports.`,
    );
    return empty();
  }
  const cell = (cells: string[], f: ImportField): string => {
    const i = position.get(f);
    return i === undefined ? '' : (cells[i] ?? '').trim();
  };

  const byEmail = new Map<string, ImportMember>();
  const byName = new Map<string, ImportMember[]>();
  for (const m of members) {
    if (m.email) byEmail.set(m.email.trim().toLowerCase(), m);
    const n = normalizeLabel(m.name);
    byName.set(n, [...(byName.get(n) ?? []), m]);
  }

  const drafts: Draft[] = [];
  for (const { row, cells } of table.rows) {
    if (cells.every((c) => c === '')) continue;
    const d: Draft = {
      row,
      ref: `L${row}`,
      title: cell(cells, 'title'),
      description: cell(cells, 'description') || null,
      section: cell(cells, 'section') || null,
      assignee: null,
      startDate: null,
      dueDate: null,
      priority: 'none',
      isMilestone: false,
      dependsRaw: splitList(cell(cells, 'dependsOn')),
      labels: [],
      parentRaw: cell(cells, 'parent') || null,
      estimateMinutes: null,
      valid: true,
      dependsOn: [],
      parentRow: null,
    };
    const fail = (field: ImportField, code: string, message: string): void => {
      d.valid = false;
      add(row, field, 'error', code, message);
    };

    if (d.title === '') fail('title', 'IMPORT_TITLE_MISSING', 'Le nom de la tâche est vide.');
    else if (d.title.length > WORK_LIMITS.taskTitleMax) {
      fail(
        'title',
        'TEXT_TOO_LONG',
        `Le nom de la tâche dépasse ${WORK_LIMITS.taskTitleMax} caractères.`,
      );
    }
    if (d.description && d.description.length > WORK_LIMITS.taskDescriptionMax) {
      d.description = d.description.slice(0, WORK_LIMITS.taskDescriptionMax);
      add(
        row,
        'description',
        'warning',
        'IMPORT_TEXT_CUT',
        `Description coupée à ${WORK_LIMITS.taskDescriptionMax} caractères.`,
      );
    }
    if (d.section && d.section.length > WORK_PLAN_LIMITS.sectionMax) {
      d.section = d.section.slice(0, WORK_PLAN_LIMITS.sectionMax).trim();
      add(
        row,
        'section',
        'warning',
        'IMPORT_TEXT_CUT',
        `Nom de section coupé à ${WORK_PLAN_LIMITS.sectionMax} caractères.`,
      );
    }

    // Responsable : e-mail d'un membre (le nom exact est aussi accepté).
    const who = cell(cells, 'assignee');
    if (who !== '') {
      const named = byName.get(normalizeLabel(who)) ?? [];
      const m = byEmail.get(who.toLowerCase()) ?? (named.length === 1 ? named[0] : undefined);
      if (!m) {
        add(
          row,
          'assignee',
          'warning',
          'IMPORT_ASSIGNEE_UNKNOWN',
          `Responsable « ${who} » inconnu dans l’organisation : la tâche sera importée sans responsable.`,
        );
      } else if (!m.canUpdate) {
        add(
          row,
          'assignee',
          'warning',
          'IMPORT_ASSIGNEE_NOT_ELIGIBLE',
          `${m.name} ne peut pas être responsable d’une tâche (son rôle ne permet pas de travailler sur les projets) : importée sans responsable.`,
        );
      } else d.assignee = { userId: m.userId, name: m.name };
    }

    // Dates.
    for (const f of ['startDate', 'dueDate'] as const) {
      const raw = cell(cells, f);
      const day = parseDay(raw);
      if (day === undefined) {
        fail(
          f,
          'IMPORT_DATE_INVALID',
          `Date « ${raw} » illisible : écrivez-la JJ/MM/AAAA (par exemple 15/01/2027).`,
        );
      } else d[f] = day;
    }
    if (d.startDate && d.dueDate && d.dueDate < d.startDate) {
      fail('dueDate', 'WORK_DATES_INVERTED', 'L’échéance précède la date de début.');
    }

    // Priorité.
    const pr = cell(cells, 'priority');
    if (pr !== '') {
      const p = PRIORITY_OF[normalizeLabel(pr)];
      if (p) d.priority = p;
      else
        add(
          row,
          'priority',
          'warning',
          'IMPORT_PRIORITY_UNKNOWN',
          `Priorité « ${pr} » inconnue (Basse, Moyenne, Haute ou Urgente) : importée sans priorité.`,
        );
    }

    // Jalon : une échéance, pas de début.
    const jal = cell(cells, 'milestone');
    const isMilestone = parseYesNo(jal);
    if (isMilestone === undefined) {
      add(
        row,
        'milestone',
        'warning',
        'IMPORT_MILESTONE_UNKNOWN',
        `Jalon « ${jal} » : répondez Oui ou Non. Importée comme tâche simple.`,
      );
    } else d.isMilestone = isMilestone;
    if (d.isMilestone) {
      if (!d.dueDate && d.startDate) {
        d.dueDate = d.startDate;
        d.startDate = null;
        add(
          row,
          'dueDate',
          'warning',
          'IMPORT_MILESTONE_DATE_MOVED',
          'Un jalon n’a qu’une échéance : la date de début devient son échéance.',
        );
      } else if (d.startDate) {
        d.startDate = null;
        add(
          row,
          'startDate',
          'warning',
          'IMPORT_MILESTONE_START_DROPPED',
          'Un jalon n’a pas de date de début : elle est ignorée.',
        );
      }
      if (!d.dueDate && d.valid) {
        fail('dueDate', 'WORK_MILESTONE_NEEDS_DATE', 'Un jalon exige une échéance.');
      }
    }

    // Étiquettes.
    let labels = [
      ...new Map(splitList(cell(cells, 'labels')).map((l) => [normalizeLabel(l), l])).values(),
    ];
    if (labels.some((l) => l.length > WORK_PLAN_LIMITS.labelMax)) {
      labels = labels.map((l) => l.slice(0, WORK_PLAN_LIMITS.labelMax).trim());
      add(
        row,
        'labels',
        'warning',
        'IMPORT_TEXT_CUT',
        `Étiquette coupée à ${WORK_PLAN_LIMITS.labelMax} caractères.`,
      );
    }
    if (labels.length > WORK_LIMITS.labelKeysPerTaskMax) {
      labels = labels.slice(0, WORK_LIMITS.labelKeysPerTaskMax);
      add(
        row,
        'labels',
        'warning',
        'IMPORT_LABELS_CUT',
        `${WORK_LIMITS.labelKeysPerTaskMax} étiquettes au plus par tâche : les suivantes sont ignorées.`,
      );
    }
    d.labels = labels;

    // Estimation (heures → minutes).
    const est = cell(cells, 'estimate');
    const minutes = parseEstimateMinutes(est);
    if (minutes === undefined || (minutes !== null && minutes > WORK_LIMITS.estimateMinutesMax)) {
      add(
        row,
        'estimate',
        'warning',
        'IMPORT_ESTIMATE_INVALID',
        `Estimation « ${est} » illisible (nombre d’heures, par exemple 1,5) : ignorée.`,
      );
    } else d.estimateMinutes = minutes;

    drafts.push(d);
  }

  // Références : numéro de ligne, sinon titre (unique).
  const byRow = new Map(drafts.map((d) => [d.row, d]));
  const byTitle = new Map<string, Draft[]>();
  for (const d of drafts) {
    const k = normalizeLabel(d.title);
    if (k) byTitle.set(k, [...(byTitle.get(k) ?? []), d]);
  }
  const resolve = (raw: string): { target?: Draft; why?: string } => {
    const n = /^(?:l(?:igne)?\s*)?(\d{1,5})$/i.exec(raw.trim());
    if (n) {
      const t = byRow.get(Number(n[1]));
      return t ? { target: t } : { why: `ligne ${n[1]} introuvable` };
    }
    const same = byTitle.get(normalizeLabel(raw)) ?? [];
    if (same.length === 1) return { target: same[0] };
    if (same.length > 1)
      return { why: `plusieurs tâches s’appellent « ${raw} » : indiquez le numéro de ligne` };
    return { why: `aucune tâche « ${raw} »` };
  };

  for (const d of drafts) {
    if (!d.valid) continue;
    if (d.parentRaw) {
      const { target, why } = resolve(d.parentRaw);
      if (!target) {
        add(
          d.row,
          'parent',
          'warning',
          'IMPORT_PARENT_UNKNOWN',
          `Tâche parente introuvable (${why}) : importée comme tâche de premier niveau.`,
        );
      } else if (target === d) {
        add(
          d.row,
          'parent',
          'warning',
          'IMPORT_PARENT_SELF',
          'Une tâche ne peut pas être sa propre sous-tâche : importée comme tâche de premier niveau.',
        );
      } else if (!target.valid) {
        add(
          d.row,
          'parent',
          'warning',
          'IMPORT_PARENT_INVALID',
          `La tâche parente (ligne ${target.row}) a une erreur et ne sera pas importée : celle-ci devient une tâche de premier niveau.`,
        );
      } else if (target.parentRaw || target.isMilestone || d.isMilestone) {
        add(
          d.row,
          'parent',
          'warning',
          'IMPORT_PARENT_DEPTH',
          `Un seul niveau de sous-tâches, et un jalon n’en porte pas : la ligne ${d.row} devient une tâche de premier niveau.`,
        );
      } else d.parentRow = target.row;
    }
  }
  // Un parent qui est lui-même sous-tâche d'une ligne écartée garde son niveau.
  for (const d of drafts) {
    if (d.parentRow !== null && byRow.get(d.parentRow)?.parentRow !== null) {
      add(
        d.row,
        'parent',
        'warning',
        'IMPORT_PARENT_DEPTH',
        `Un seul niveau de sous-tâches : la ligne ${d.row} devient une tâche de premier niveau.`,
      );
      d.parentRow = null;
    }
  }
  const childCount = new Map<number, number>();
  for (const d of drafts) {
    if (d.parentRow === null) continue;
    const n = (childCount.get(d.parentRow) ?? 0) + 1;
    childCount.set(d.parentRow, n);
    if (n > WORK_LIMITS.subtasksMax) {
      add(
        d.row,
        'parent',
        'warning',
        'IMPORT_PARENT_FULL',
        `Une tâche compte au plus ${WORK_LIMITS.subtasksMax} sous-tâches : la ligne ${d.row} devient une tâche de premier niveau.`,
      );
      d.parentRow = null;
    }
  }

  for (const d of drafts) {
    if (!d.valid) continue;
    const deps = new Set<number>();
    for (const raw of d.dependsRaw) {
      const { target, why } = resolve(raw);
      if (!target) {
        add(
          d.row,
          'dependsOn',
          'warning',
          'IMPORT_DEPENDENCY_UNKNOWN',
          `Dépendance introuvable (${why}) : ignorée.`,
        );
      } else if (target === d) {
        add(
          d.row,
          'dependsOn',
          'warning',
          'IMPORT_DEPENDENCY_SELF',
          'Une tâche ne peut pas dépendre d’elle-même : dépendance ignorée.',
        );
      } else if (!target.valid) {
        add(
          d.row,
          'dependsOn',
          'warning',
          'IMPORT_DEPENDENCY_INVALID',
          `La ligne ${target.row} a une erreur et ne sera pas importée : dépendance ignorée.`,
        );
      } else deps.add(target.row);
    }
    if (deps.size > WORK_LIMITS.dependenciesMax) {
      add(
        d.row,
        'dependsOn',
        'warning',
        'IMPORT_DEPENDENCIES_CUT',
        `${WORK_LIMITS.dependenciesMax} dépendances au plus : les suivantes sont ignorées.`,
      );
    }
    d.dependsOn = [...deps].slice(0, WORK_LIMITS.dependenciesMax);
  }

  // Cycles : on casse la boucle en retirant une dépendance, signalée.
  const valid = drafts.filter((d) => d.valid);
  for (let guard = 0; guard < valid.length + 1; guard += 1) {
    const cycle = planCycle(
      valid.map((d) => ({ ref: d.ref, dependsOn: d.dependsOn.map((r) => `L${r}`) })),
    );
    if (cycle === null) break;
    const from = byRow.get(Number(cycle[0]!.slice(1)))!;
    const to = Number(cycle[1]!.slice(1));
    from.dependsOn = from.dependsOn.filter((r) => r !== to);
    const path = cycle.map((r) => `ligne ${r.slice(1)}`).join(' → ');
    add(
      from.row,
      'dependsOn',
      'warning',
      'WORK_DEPENDENCY_CYCLE',
      `Cycle de dépendances (${path}) : la dépendance de la ligne ${from.row} envers la ligne ${to} est ignorée.`,
    );
  }

  const tasks: WorkPlanTask[] = valid.map((d) => ({
    ref: d.ref,
    title: d.title,
    description: d.description,
    section: d.section,
    assigneeUserId: d.assignee?.userId ?? null,
    startDate: d.startDate,
    dueDate: d.dueDate,
    priority: d.priority,
    isMilestone: d.isMilestone,
    dependsOn: d.dependsOn.map((r) => `L${r}`),
    labels: d.labels,
    parentRef: d.parentRow !== null ? `L${d.parentRow}` : null,
    estimateMinutes: d.estimateMinutes,
  }));

  const knownSections = new Set(known.sections.map(normalizeLabel));
  const knownLabels = new Set(known.labels.map(normalizeLabel));
  const distinct = (xs: string[], seen: Set<string>): string[] => {
    const out: string[] = [];
    for (const x of xs) {
      const n = normalizeLabel(x);
      if (!seen.has(n)) {
        seen.add(n);
        out.push(x);
      }
    }
    return out;
  };
  const rows: WorkImportRowView[] = drafts.map((d) => ({
    row: d.row,
    ref: d.ref,
    title: d.title,
    section: d.section,
    assignee: d.assignee,
    startDate: d.startDate,
    dueDate: d.dueDate,
    priority: d.priority,
    isMilestone: d.isMilestone,
    dependsOn: d.dependsOn,
    labels: d.labels,
    parentRow: d.parentRow,
    estimateMinutes: d.estimateMinutes,
    valid: d.valid,
  }));
  if (drafts.length === 0) {
    add(
      null,
      null,
      'error',
      'IMPORT_NO_ROWS',
      'Aucune tâche dans le fichier : remplissez au moins la colonne « Tâche » sous les en-têtes.',
    );
  }
  return {
    preview: {
      fileName,
      format: table.format,
      rows,
      issues,
      counts: {
        rows: drafts.length,
        valid: valid.length,
        invalid: drafts.length - valid.length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
        milestones: tasks.filter((t) => t.isMilestone).length,
        subtasks: tasks.filter((t) => t.parentRef).length,
        dependencies: tasks.reduce((n, t) => n + (t.dependsOn?.length ?? 0), 0),
      },
      newSections: distinct(
        tasks.map((t) => t.section).filter((s): s is string => !!s),
        knownSections,
      ),
      newLabels: distinct(
        tasks.flatMap((t) => t.labels ?? []),
        knownLabels,
      ),
      ignoredColumns,
    },
    tasks,
  };
}
