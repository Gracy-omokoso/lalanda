// Règles pures des avances (ADR-0051 § 2.2, § 3.3, § 4). ADR-0051 — H10.
//
// Aucune lecture de base : entrée du moteur (`advanceOutstanding`, `advanceSettlementPlan`,
// `advanceFindings`), statut de l'argent après une régularisation, et ce qu'un lecteur a
// le droit de savoir d'une avance (une avance SUR SALAIRE n'existe pas pour le manager ni
// pour `hr.read` seul : 404 ; le payeur en voit le numéro, le montant et la date).

import { advanceOutstanding, type AdvanceInput } from '@lalanda/engine';
import type { AdvanceStatus } from '@lalanda/shared/hr';

import type { Action } from '../../authz/permissions.js';
import type { EmployeeAdvanceLean, StoredSettlement } from './advance.schema.js';

/** Régularisations en vigueur (un complément annulé est gardé, marqué, et ignoré). */
export function liveSettlements(a: Pick<EmployeeAdvanceLean, 'settlements'>): StoredSettlement[] {
  return (a.settlements ?? []).filter((s) => !s.cancelledAt);
}

/** Entrée du moteur pour une avance, avec des régularisations éventuellement ajoutées. */
export function advanceInputOf(
  a: Pick<
    EmployeeAdvanceLean,
    'kind' | 'currency' | 'amount' | 'disbursement' | 'settlements' | 'expectedSettlement'
  >,
  extra: readonly Pick<StoredSettlement, 'id' | 'kind' | 'amount' | 'on'>[] = [],
): AdvanceInput {
  return {
    kind: a.kind,
    currency: a.currency,
    amount: a.amount,
    disbursement: a.disbursement ? { paidOn: a.disbursement.paidOn } : null,
    settlements: [...liveSettlements(a), ...extra].map((s) => ({
      id: s.id,
      kind: s.kind,
      amount: s.amount,
      on: s.on,
    })),
    expectedSettlement: a.expectedSettlement ?? null,
  };
}

/**
 * Statut d'une avance versée après ses régularisations (moteur) : `settled` (ou
 * `written_off` si un abandon l'a soldée), `partially_settled`, sinon `disbursed`.
 */
export function moneyStatusOf(input: AdvanceInput): AdvanceStatus {
  const o = advanceOutstanding(input);
  if (o.state === 'settled') {
    return input.settlements.some((s) => s.kind === 'write_off') ? 'written_off' : 'settled';
  }
  if (o.state === 'partially_settled') return 'partially_settled';
  return 'disbursed';
}

/** Statuts où une avance de frais peut être justifiée par une note. */
export const LINKABLE_ADVANCE_STATUSES: readonly AdvanceStatus[] = [
  'disbursed',
  'partially_settled',
];

export interface AdvanceAccess {
  self: boolean;
  creator: boolean;
  manager: boolean;
  /** `expenses.approve` (et, pour une avance sur salaire, `hr.sensitive.read`). */
  approver: boolean;
  payer: boolean;
  hrRead: boolean;
  /** Le lecteur voit la nature « sur salaire » et le détail (motif sur demande). */
  sensitive: boolean;
}

export function advanceAccessOf(
  a: Pick<EmployeeAdvanceLean, 'kind' | 'employeeId' | 'createdBy'>,
  viewer: {
    userId: string;
    actions: ReadonlySet<Action>;
    selfEmployeeId: string | null;
    teamEmployeeIds: readonly string[];
  },
): AdvanceAccess {
  const salary = a.kind === 'salary';
  const self = viewer.selfEmployeeId === a.employeeId;
  const creator = a.createdBy === viewer.userId;
  const sensitiveReader =
    viewer.actions.has('expenses.approve') && viewer.actions.has('hr.sensitive.read');
  return {
    self,
    creator,
    // Une avance sur salaire n'est jamais montrée au manager (décision ouverte n° 4).
    manager: !salary && viewer.teamEmployeeIds.includes(a.employeeId),
    approver: salary ? sensitiveReader : viewer.actions.has('expenses.approve'),
    payer: viewer.actions.has('payables.pay'),
    // `hr.read` seul ne voit pas une avance sur salaire.
    hrRead: !salary && viewer.actions.has('hr.read'),
    sensitive: !salary || self || creator || sensitiveReader,
  };
}

/** Le lecteur voit-il l'avance (sinon 404) ? Un brouillon : le bénéficiaire et l'auteur. */
export function seesAdvance(access: AdvanceAccess, status: AdvanceStatus): boolean {
  if (access.self || access.creator) return true;
  if (status === 'draft') return false;
  return access.manager || access.approver || access.payer || access.hrRead;
}
