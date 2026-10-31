// Historique des affectations d'un équipement (ADR-0046 § 3.2) : une seule
// affectation ouverte, aucun chevauchement. Convention : une affectation couvre
// [from, to[ — la remise du jour `to` au détenteur suivant est permise
// (réaffecter clôt l'ouverte et ouvre la suivante le même jour).

import { byString, checkDay, checkId, checkNullableDay, dayNumber } from './money.js';
import {
  ASSETS_VERSION,
  type AssetAssignee,
  type AssetAssignmentInput,
  type AssetDay,
  type AssignmentHistory,
  type AssignmentHistoryEntry,
  type AssignmentIssue,
  type NewAssignmentCheck,
} from './types.js';

/** Au-delà de toute date valide : une affectation ouverte se trie en dernier. */
const OPEN_END = '9999-12-31';

function assigneeKey(a: AssetAssignee): string {
  switch (a.kind) {
    case 'employee':
      return `employee:${a.employeeId}`;
    case 'project':
      return `project:${a.workProjectId}`;
    case 'location':
      return `location:${a.locationId}`;
    case 'member':
      return `member:${a.userId}`;
    default:
      throw new RangeError(`Affectation : bénéficiaire inconnu ${JSON.stringify(a)}`);
  }
}

/**
 * Historique trié (remise, retour, identifiant) des affectations de `assetId` ;
 * les lignes d'un autre équipement sont ignorées. Signale les retours antérieurs
 * à la remise, les chevauchements et les affectations ouvertes multiples.
 */
export function assignmentHistory(
  assignments: readonly AssetAssignmentInput[],
  assetId: string,
  today: AssetDay,
): AssignmentHistory {
  checkId(assetId, 'Équipement');
  checkDay(today, 'Jour de référence');
  const rows = assignments
    .filter((a) => a.assetId === assetId)
    .map((a, i) => {
      const what = `Affectation ${a.id || `n° ${i + 1}`}`;
      checkId(a.id, what);
      assigneeKey(a.assignee);
      return {
        id: a.id,
        assignee: a.assignee,
        from: checkDay(a.from, `${what} (remise)`),
        to: checkNullableDay(a.to, `${what} (retour)`),
      };
    })
    // Remise, puis retour (une affectation ouverte en dernier), puis identifiant.
    .sort(
      (a, b) =>
        byString(a.from, b.from) ||
        byString(a.to ?? OPEN_END, b.to ?? OPEN_END) ||
        byString(a.id, b.id),
    );
  const issues: AssignmentIssue[] = [];
  for (const r of rows) {
    if (r.to !== null && r.to < r.from) issues.push({ code: 'END_BEFORE_START', ids: [r.id] });
  }
  const open = rows.filter((r) => r.to === null);
  if (open.length > 1) issues.push({ code: 'MULTIPLE_OPEN', ids: open.map((r) => r.id) });
  for (let i = 0; i < rows.length; i += 1) {
    const a = rows[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < rows.length; j += 1) {
      const b = rows[j];
      if (b === undefined) continue;
      // b.from ≥ a.from par le tri : chevauchement si b commence avant la fin de a.
      if (a.to === null ? b.from >= a.from : b.from < a.to) {
        if (a.to === null && b.to === null) continue; // déjà signalé par MULTIPLE_OPEN
        issues.push({ code: 'ASSIGNMENT_OVERLAP', ids: [a.id, b.id] });
      }
    }
  }
  const todayN = dayNumber(today);
  const entries: AssignmentHistoryEntry[] = rows.map((r) => {
    const end = r.to === null ? todayN : dayNumber(r.to);
    const days = end - dayNumber(r.from);
    return { ...r, days: days > 0 ? days : 0 };
  });
  const current = entries.filter((e) => e.to === null);
  return {
    version: ASSETS_VERSION,
    assetId,
    today,
    entries,
    current: current.length === 1 ? (current[0] ?? null) : null,
    issues,
    valid: issues.length === 0,
  };
}

/** Détenteur de l'équipement à `day` (`from` ≤ day < `to`), ou `null`. */
export function assigneeOn(
  history: AssignmentHistory,
  day: AssetDay,
): AssignmentHistoryEntry | null {
  checkDay(day, 'Date');
  if (!history.valid) throw new RangeError('Historique d’affectations incohérent');
  return history.entries.find((e) => e.from <= day && (e.to === null || day < e.to)) ?? null;
}

/**
 * Contrôle d'une nouvelle affectation à partir de `from` : l'historique doit
 * être cohérent, la remise ne peut précéder ni la dernière remise ni le dernier
 * retour, et réaffecter au même bénéficiaire est refusé. Rend l'affectation
 * ouverte à clore (au jour `from`), s'il y en a une.
 */
export function checkNewAssignment(
  history: AssignmentHistory,
  assignee: AssetAssignee,
  from: AssetDay,
): NewAssignmentCheck {
  checkDay(from, 'Remise');
  const key = assigneeKey(assignee);
  if (!history.valid) return { ok: false, code: 'INVALID_HISTORY' };
  const last = history.entries[history.entries.length - 1];
  if (last === undefined) return { ok: true, closes: null };
  if (from < last.from || (last.to !== null && from < last.to)) {
    return { ok: false, code: 'STARTS_BEFORE_LAST_ASSIGNMENT' };
  }
  if (last.to !== null) return { ok: true, closes: null };
  if (assigneeKey(last.assignee) === key) return { ok: false, code: 'SAME_ASSIGNEE' };
  return { ok: true, closes: { id: last.id, to: from } };
}
