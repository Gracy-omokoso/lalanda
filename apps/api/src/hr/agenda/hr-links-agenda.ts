// Éléments « Mes tâches » des frais, avances et corrections de pointage — ADR-0051 § 7.5.
// ADR-0051 — H14.
//
// Mise en forme PURE de ce que `HrExpenseAgendaReader` a retenu (droits déjà jugés) :
// aucun montant, aucun motif, jamais « sur salaire » — une avance est « Avance AV… »
// pour tous (critère 15). Sans case à cocher : valider, payer, décider est une décision.

import {
  HR_EXPENSES_ALL_LINK,
  HR_EXPENSES_TO_APPROVE_LINK,
  HR_EXPENSES_TO_PAY_LINK,
  HR_LINK_AGENDA_LABELS,
  HR_MY_EXPENSES_LINK,
  HR_PRESENCES_LINK,
  hrLinkAgendaId,
  type HrLinkTaskItem,
} from '@lalanda/shared/hr';
import { kinshasaDayOf } from '@lalanda/shared/work';

import type { EmployeeLean } from '../employees/employee.schema.js';
import { displayNameOf } from '../leave/display-name.js';
import type { HrLinkPiece, HrLinksResult } from './hr-expense-agenda.reader.js';

function pieceLabel(p: Pick<HrLinkPiece, 'entityType' | 'number'>): string {
  const what = p.entityType === 'advance' ? 'Avance' : 'Note de frais';
  return p.number ? `${what} ${p.number}` : what;
}

function nameOf(employees: ReadonlyMap<string, EmployeeLean>, employeeId: string): string {
  const e = employees.get(employeeId);
  return e && e.status !== 'anonymized' ? displayNameOf(e) : '';
}

/** Éléments de l'appelant, dans l'ordre : à valider, à payer, à régulariser, corrections. */
export function hrLinkItemsOf(
  links: Pick<HrLinksResult, 'approvals' | 'toPay' | 'toSettle' | 'corrections' | 'employees'>,
  selfUserId: string,
): HrLinkTaskItem[] {
  const out: HrLinkTaskItem[] = [];
  for (const p of links.approvals) {
    out.push({
      source: 'hr',
      kind: 'expense_approval',
      id: hrLinkAgendaId('expense_approval', p.id),
      entityType: p.entityType,
      entityId: p.id,
      number: p.number,
      label: pieceLabel(p),
      employeeName: nameOf(links.employees, p.employeeId),
      dueDate: kinshasaDayOf(p.at),
      priority: 'none',
      rank: p.at.toISOString(),
      done: false,
      kindLabel: HR_LINK_AGENDA_LABELS.expense_approval,
      href: HR_EXPENSES_TO_APPROVE_LINK,
    });
  }
  for (const p of links.toPay) {
    out.push({
      source: 'hr',
      kind: 'expense_to_pay',
      id: hrLinkAgendaId('expense_to_pay', p.id),
      entityType: p.entityType,
      entityId: p.id,
      number: p.number,
      label: pieceLabel(p),
      employeeName: nameOf(links.employees, p.employeeId),
      dueDate: kinshasaDayOf(p.at),
      priority: 'none',
      rank: p.at.toISOString(),
      done: false,
      kindLabel: p.entityType === 'advance' ? 'À verser' : HR_LINK_AGENDA_LABELS.expense_to_pay,
      href: HR_EXPENSES_TO_PAY_LINK,
    });
  }
  for (const p of links.toSettle) {
    const own = links.employees.get(p.employeeId)?.userId === selfUserId;
    out.push({
      source: 'hr',
      kind: 'advance_to_settle',
      id: hrLinkAgendaId('advance_to_settle', p.id),
      entityType: 'advance',
      entityId: p.id,
      number: p.number,
      label: pieceLabel(p),
      employeeName: nameOf(links.employees, p.employeeId),
      dueDate: p.dueOn,
      priority: 'none',
      rank: p.at.toISOString(),
      done: false,
      kindLabel: HR_LINK_AGENDA_LABELS.advance_to_settle,
      href: own ? HR_MY_EXPENSES_LINK : HR_EXPENSES_ALL_LINK,
    });
  }
  for (const c of links.corrections) {
    out.push({
      source: 'hr',
      kind: 'attendance_correction',
      id: hrLinkAgendaId('attendance_correction', c.id),
      entityType: 'attendance_correction',
      entityId: c.id,
      number: null,
      label: `Correction du pointage du ${c.date}`,
      employeeName: nameOf(links.employees, c.employeeId),
      dueDate: kinshasaDayOf(c.at),
      priority: 'none',
      rank: c.at.toISOString(),
      done: false,
      kindLabel: HR_LINK_AGENDA_LABELS.attendance_correction,
      href: HR_PRESENCES_LINK,
    });
  }
  return out;
}
