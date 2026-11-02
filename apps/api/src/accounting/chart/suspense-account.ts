// Compte d'attente en vigueur (ADR-0049 § 6.0 ; amendement du 3 nov. 2026).
//
// Tant que le pack choisi n'est pas relu (`approved` ou `active`) ou ne désigne aucun
// compte, le compte technique `ATTENTE` est employé, signalé comme tel. Un pack relu qui
// désigne son compte d'attente (`suspenseAccount`, pack v2) le remplace : les écritures
// nouvelles y vont, avec leur motif. Aucun numéro n'est écrit ici : il vient du YAML.

import {
  ACCOUNTING_ACTIVATABLE_PACK_STATUSES,
  ACCOUNTING_SIMULATION_SUSPENSE_ACCOUNT,
} from '@lalanda/shared/accounting';

import type { AccountingChartPackLean } from './chart-pack.schema.js';

type PackLike = Pick<AccountingChartPackLean, 'status' | 'content'> | null;

/** Compte d'attente des écritures nouvelles : celui du pack relu, sinon `ATTENTE`. */
export function suspenseAccountOf(pack: PackLike): string {
  const designated = pack?.content.suspenseAccount ?? null;
  if (
    pack !== null &&
    designated !== null &&
    ACCOUNTING_ACTIVATABLE_PACK_STATUSES.includes(pack.status)
  ) {
    return designated;
  }
  return ACCOUNTING_SIMULATION_SUSPENSE_ACCOUNT;
}

/**
 * Comptes lus comme « attente » (réserves, rapprochement, drapeau des écritures) : le
 * compte technique, que des écritures antérieures peuvent viser, et le compte désigné.
 */
export function suspenseAccountsOf(pack: PackLike): string[] {
  return [...new Set([ACCOUNTING_SIMULATION_SUSPENSE_ACCOUNT, suspenseAccountOf(pack)])];
}
