// ─────────────────────────────────────────────────────────────────────────────
// RH lot 1, suite (ADR-0068, amendement du 8 nov. 2026) — règles pures
//
// - `positionChangeCheck` : dates d'un changement de poste (mutation). La date
//   d'effet ne précède ni l'entrée du collaborateur ni le début de son occupation
//   du poste actuel (l'historique des titulaires reste ordonné).
// - `resolveImportManagers` : colonne « Manager » de l'import, en DEUX passes. Une
//   référence (matricule ou e-mail professionnel) désigne un collaborateur existant
//   OU une ligne du même fichier ; une référence inconnue, ambiguë, vers une ligne en
//   erreur, vers un collaborateur qui n'est plus actif, ou qui crée un cycle
//   (`reportingCycle`) écarte la ligne. Les écarts se propagent : une ligne dont le
//   manager est une ligne écartée est écartée à son tour.
// ─────────────────────────────────────────────────────────────────────────────

import { numberKeyOf } from './numbering.js';
import { reportingCycle } from './structure.js';
import { HR_VERSION } from './types.js';

// ── Changement de poste ─────────────────────────────────────────────────────

export type PositionChangeIssue = 'DATE_BEFORE_START' | 'DATE_BEFORE_CURRENT_HOLDING';

export interface PositionChangeCheckResult {
  version: string;
  ok: boolean;
  issue: PositionChangeIssue | null;
}

/** Dates `AAAA-MM-JJ` (comparaison lexicographique). */
export function positionChangeCheck(input: {
  startDate: string;
  /** Début de l'occupation du poste actuel (`null` : aucun poste). */
  currentHoldingFrom: string | null;
  effectiveDate: string;
}): PositionChangeCheckResult {
  const fail = (issue: PositionChangeIssue): PositionChangeCheckResult => ({
    version: HR_VERSION,
    ok: false,
    issue,
  });
  if (input.effectiveDate < input.startDate) return fail('DATE_BEFORE_START');
  if (input.currentHoldingFrom !== null && input.effectiveDate < input.currentHoldingFrom) {
    return fail('DATE_BEFORE_CURRENT_HOLDING');
  }
  return { version: HR_VERSION, ok: true, issue: null };
}

// ── Manager à l'import ──────────────────────────────────────────────────────

export interface ImportManagerExisting {
  id: string;
  managerEmployeeId: string | null;
  employeeNumber: string | null;
  workEmail: string | null;
  active: boolean;
}

export interface ImportManagerRow {
  row: number;
  /** Ligne déjà valide pour tout le reste (nom, dates, contrat…). */
  valid: boolean;
  employeeNumber: string | null;
  workEmail: string | null;
  /** Cellule « Manager » : matricule ou e-mail professionnel ; `null` : aucun. */
  managerRef: string | null;
}

export type ImportManagerIssue =
  | 'MANAGER_NOT_FOUND'
  | 'MANAGER_AMBIGUOUS'
  | 'MANAGER_NOT_ACTIVE'
  | 'MANAGER_SELF'
  | 'MANAGER_ROW_INVALID'
  | 'MANAGER_CYCLE';

export type ImportManagerVerdict =
  | { row: number; kind: 'none' }
  | { row: number; kind: 'existing'; employeeId: string }
  | { row: number; kind: 'row'; managerRow: number }
  | { row: number; kind: 'error'; issue: ImportManagerIssue; managerRow: number | null };

export interface ImportManagersResult {
  version: string;
  verdicts: ImportManagerVerdict[];
}

const isEmail = (ref: string): boolean => ref.includes('@');
const emailKey = (raw: string): string => raw.trim().toLowerCase();

/**
 * Résout la colonne « Manager ». Une ligne du fichier est prioritaire sur rien : si la
 * référence désigne À LA FOIS un collaborateur existant et une ligne du fichier, elle
 * est ambiguë (le cas ne survient pas avec des matricules, déjà refusés en double).
 */
export function resolveImportManagers(
  existing: readonly ImportManagerExisting[],
  rows: readonly ImportManagerRow[],
): ImportManagersResult {
  const byNumber = new Map<string, string[]>();
  const byEmail = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string): void => {
    const list = m.get(k) ?? [];
    list.push(v);
    m.set(k, list);
  };
  for (const e of existing) {
    if (e.employeeNumber) push(byNumber, numberKeyOf(e.employeeNumber), e.id);
    if (e.workEmail) push(byEmail, emailKey(e.workEmail), e.id);
  }
  const rowByNumber = new Map<string, number[]>();
  const rowByEmail = new Map<string, number[]>();
  const pushRow = (m: Map<string, number[]>, k: string, v: number): void => {
    const list = m.get(k) ?? [];
    list.push(v);
    m.set(k, list);
  };
  for (const r of rows) {
    if (r.employeeNumber) pushRow(rowByNumber, numberKeyOf(r.employeeNumber), r.row);
    if (r.workEmail) pushRow(rowByEmail, emailKey(r.workEmail), r.row);
  }
  const activeIds = new Set(existing.filter((e) => e.active).map((e) => e.id));

  // Passe 1 : chaque référence vers un collaborateur existant ou une ligne.
  const verdicts = new Map<number, ImportManagerVerdict>();
  for (const r of rows) {
    const ref = r.managerRef?.trim() ?? '';
    if (ref === '') {
      verdicts.set(r.row, { row: r.row, kind: 'none' });
      continue;
    }
    const people = isEmail(ref)
      ? (byEmail.get(emailKey(ref)) ?? [])
      : (byNumber.get(numberKeyOf(ref)) ?? []);
    const lines = isEmail(ref)
      ? (rowByEmail.get(emailKey(ref)) ?? [])
      : (rowByNumber.get(numberKeyOf(ref)) ?? []);
    const error = (issue: ImportManagerIssue, managerRow: number | null = null): void => {
      verdicts.set(r.row, { row: r.row, kind: 'error', issue, managerRow });
    };
    if (people.length + lines.length === 0) error('MANAGER_NOT_FOUND');
    else if (people.length + lines.length > 1) error('MANAGER_AMBIGUOUS');
    else if (lines.length === 1) {
      if (lines[0] === r.row) error('MANAGER_SELF', r.row);
      else verdicts.set(r.row, { row: r.row, kind: 'row', managerRow: lines[0]! });
    } else if (!activeIds.has(people[0]!)) error('MANAGER_NOT_ACTIVE');
    else verdicts.set(r.row, { row: r.row, kind: 'existing', employeeId: people[0]! });
  }

  // Passe 2 : cycles entre lignes du fichier (moteur `reportingCycle`). Les lignes
  // n'ont pas d'identifiant : on leur en donne un, propre à ce calcul.
  const idOfRow = (row: number): string => `ligne:${row}`;
  const graph = [
    ...existing.map((e) => ({ id: e.id, managerEmployeeId: e.managerEmployeeId })),
    ...rows.map((r) => {
      const v = verdicts.get(r.row)!;
      return {
        id: idOfRow(r.row),
        managerEmployeeId:
          v.kind === 'row' ? idOfRow(v.managerRow) : v.kind === 'existing' ? v.employeeId : null,
      };
    }),
  ];
  for (const r of rows) {
    const v = verdicts.get(r.row)!;
    if (v.kind !== 'row') continue;
    if (reportingCycle(graph, idOfRow(r.row), idOfRow(v.managerRow)).cycle) {
      verdicts.set(r.row, {
        row: r.row,
        kind: 'error',
        issue: 'MANAGER_CYCLE',
        managerRow: v.managerRow,
      });
    }
  }

  // Propagation : le manager d'une ligne retenue doit être une ligne retenue.
  const rowValid = new Map(rows.map((r) => [r.row, r.valid]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rows) {
      const v = verdicts.get(r.row)!;
      if (v.kind !== 'row') continue;
      const target = verdicts.get(v.managerRow)!;
      if (rowValid.get(v.managerRow) === true && target.kind !== 'error') continue;
      verdicts.set(r.row, {
        row: r.row,
        kind: 'error',
        issue: 'MANAGER_ROW_INVALID',
        managerRow: v.managerRow,
      });
      changed = true;
    }
  }
  return { version: HR_VERSION, verdicts: rows.map((r) => verdicts.get(r.row)!) };
}
