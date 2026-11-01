// Clôtures (ADR-0049 § 4, § 13) : mois et exercices, conditions manquantes listées,
// réouverture réservée au Propriétaire. Logique pure. Le serveur reste juge de chaque
// condition ; l'écran annonce, il ne décide pas.

import type { AccountingPeriodStatus } from '@lalanda/shared/accounting';

import type { OrgAction, OrgRole } from '@/lib/api';

import { codeDe, peutCloturer, peutRouvrir } from './comptabilite-model';

export interface ActionsPeriode {
  cloturer: boolean;
  rouvrir: boolean;
  /** Pourquoi la réouverture n'est pas offerte, si la période est close. */
  raisonRouvrir: string | null;
}

export function actionsPeriode(
  statut: AccountingPeriodStatus,
  actions: readonly OrgAction[] | null,
  role: OrgRole | null,
): ActionsPeriode {
  if (statut === 'open') {
    return { cloturer: peutCloturer(actions), rouvrir: false, raisonRouvrir: null };
  }
  const proprietaire = peutRouvrir(role);
  return {
    cloturer: false,
    rouvrir: proprietaire,
    raisonRouvrir: proprietaire ? null : 'Seul le Propriétaire rouvre une période close.',
  };
}

const PHRASES_RAISON: Record<string, string> = {
  PERIODS_OPEN: 'Des mois de l’exercice sont encore ouverts.',
  AWAITING_RATE: 'Des écritures attendent un taux de change.',
  SUSPENSE_NOT_ACCEPTED:
    'Le compte d’attente n’est pas soldé, et son solde n’a pas été accepté avec un motif.',
  PERIOD_HAS_DRAFTS: 'Des brouillons occupent encore ce mois.',
};

/**
 * Conditions manquantes d'un refus de clôture (`details.reasons[]` de
 * `409 FISCAL_YEAR_NOT_CLOSABLE`, ou `PERIOD_HAS_DRAFTS`), en phrases simples.
 * Un code inconnu est rendu tel quel plutôt que tu.
 */
export function raisonsDuRefus(err: unknown): string[] {
  const code = codeDe(err);
  if (code === 'PERIOD_HAS_DRAFTS') return [PHRASES_RAISON['PERIOD_HAS_DRAFTS']!];
  if (code !== 'FISCAL_YEAR_NOT_CLOSABLE') return [];
  const reasons = (err as { detail?: { details?: { reasons?: unknown } } }).detail?.details
    ?.reasons;
  if (!Array.isArray(reasons)) return [];
  return reasons.map((r) => {
    const c =
      typeof r === 'string'
        ? r
        : typeof r === 'object' && r !== null
          ? String((r as { code?: unknown }).code ?? '')
          : '';
    return PHRASES_RAISON[c] ?? c;
  });
}
