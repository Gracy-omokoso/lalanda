// ─────────────────────────────────────────────────────────────────────────────
// PRORATA DE CHANGEMENT DE PLAN (S22b) — docs/13 § Changements de plan
//
// « Montée en gamme immédiate avec prorata selon fournisseur ; baisse à la
// prochaine échéance. »
//
// Fonction PURE et testée à part : le calcul de ce que doit un client est de la
// même nature qu'un calcul du moteur financier (docs/21) — il n'a rien à faire
// dans un contrôleur, et il doit être vérifiable sans base ni réseau.
//
// Ce que ce module calcule et ce qu'il ne calcule PAS :
//
//   ✓ le montant à percevoir immédiatement lors d'une montée en gamme;
//   ✓ la date d'effet d'une baisse de gamme;
//   ✗ la facture elle-même, la TVA, les retenues locales.
//
// Le dernier point n'est pas un oubli : la fiscalité de la vente numérique est
// listée par docs/13 § Validation commerciale requise comme NON arbitrée. Un
// développeur qui coderait un taux ici inventerait une règle fiscale — ce que
// CLAUDE.md interdit explicitement. Le prorata calculé est donc HORS TAXES, et
// c'est écrit dans la réponse d'API (`taxIncluded: false`).
// ─────────────────────────────────────────────────────────────────────────────

import type { Plan } from './entitlements.js';
import { intervalDays, planRank, priceCents, type BillingInterval } from './pricing-catalog.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Sens du changement demandé. */
export type PlanChangeDirection = 'upgrade' | 'downgrade' | 'same';

/** Quand le changement prend effet. */
export type PlanChangeEffect = 'immediate' | 'period_end';

export interface ProrationInput {
  currentPlan: Plan;
  targetPlan: Plan;
  currentInterval: BillingInterval;
  targetInterval: BillingInterval;
  /** Fin de la période payée en cours. `null` si aucune période en cours (essai, résilié). */
  currentPeriodEnd: Date | null;
  now: Date;
}

export interface ProrationResult {
  direction: PlanChangeDirection;
  effect: PlanChangeEffect;
  /** Jours restants sur la période courante (0 si aucune période en cours). */
  remainingDays: number;
  /** Durée totale de la période courante, en jours. */
  periodDays: number;
  /** Crédit accordé pour la portion non consommée du plan actuel, en centimes. */
  creditCents: number;
  /** Coût de la portion restante au tarif du nouveau plan, en centimes. */
  chargeCents: number;
  /**
   * Montant à percevoir MAINTENANT, en centimes. Jamais négatif : un crédit
   * supérieur au coût ne donne pas lieu à remboursement (voir plus bas).
   */
  amountDueCents: number;
  /** Crédit non consommé, en centimes — reporté, jamais remboursé. */
  carriedCreditCents: number;
  /** Le montant est hors taxes (voir l'en-tête de ce fichier). */
  taxIncluded: false;
}

/** Le plan cible est-il au-dessus, au-dessous, ou identique ? */
export function directionOf(
  currentPlan: Plan,
  targetPlan: Plan,
  currentInterval: BillingInterval,
  targetInterval: BillingInterval,
): PlanChangeDirection {
  const rankDelta = planRank(targetPlan) - planRank(currentPlan);
  if (rankDelta > 0) return 'upgrade';
  if (rankDelta < 0) return 'downgrade';
  if (currentInterval === targetInterval) return 'same';
  // Même plan, périodicité différente : mensuel → annuel est un engagement
  // supérieur, traité comme une montée en gamme (paiement immédiat de l'année).
  // Annuel → mensuel est une baisse, effet à l'échéance.
  return targetInterval === 'year' ? 'upgrade' : 'downgrade';
}

/**
 * Jours entiers restants avant `periodEnd`, bornés à [0, periodDays].
 *
 * Arrondi vers le BAS, volontairement : facturer 12 jours quand il en reste
 * 11,4 est une surfacturation, et une surfacturation systématique de quelques
 * centimes est le genre de détail qui finit en litige. Le client garde la
 * fraction de journée entamée.
 */
function remainingDaysOf(now: Date, periodEnd: Date | null, periodDays: number): number {
  if (periodEnd === null) return 0;
  const ms = periodEnd.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(Math.floor(ms / MS_PER_DAY), periodDays);
}

/**
 * Calcule le prorata d'un changement de plan.
 *
 * Règles, dans l'ordre où elles s'appliquent :
 *
 * 1. **Même plan et même périodicité** → aucun mouvement.
 * 2. **Baisse de gamme** → effet `period_end`, montant nul. docs/13 :
 *    « baisse à la prochaine échéance ». Le client garde ce qu'il a payé
 *    jusqu'au bout ; aucun projet n'est supprimé (docs/13 : « aucune suppression
 *    automatique de projet ») — la limite s'appliquera aux CRÉATIONS futures.
 * 3. **Montée en gamme** → effet `immediate`. Le client est crédité de la
 *    portion non consommée de son plan actuel et débité de la portion restante
 *    au nouveau tarif.
 *
 * Cas particulier assumé — **le crédit ne donne jamais lieu à remboursement**.
 * Si le crédit dépasse le coût (possible en passant d'un annuel à un mensuel
 * plus cher au mois mais moins cher au total restant), `amountDueCents` est
 * ramené à 0 et le reliquat apparaît dans `carriedCreditCents`. Rembourser
 * automatiquement ouvrirait un chemin d'extraction de trésorerie par
 * changements de plan successifs ; le report est la pratique du secteur et il
 * est affiché au client, pas caché.
 */
export function computeProration(input: ProrationInput): ProrationResult {
  const { currentPlan, targetPlan, currentInterval, targetInterval, currentPeriodEnd, now } = input;

  const direction = directionOf(currentPlan, targetPlan, currentInterval, targetInterval);
  const periodDays = intervalDays(currentInterval);
  const remainingDays = remainingDaysOf(now, currentPeriodEnd, periodDays);

  const base: Omit<ProrationResult, 'direction' | 'effect'> = {
    remainingDays,
    periodDays,
    creditCents: 0,
    chargeCents: 0,
    amountDueCents: 0,
    carriedCreditCents: 0,
    taxIncluded: false,
  };

  if (direction === 'same') {
    return { ...base, direction, effect: 'period_end', remainingDays };
  }

  if (direction === 'downgrade') {
    // Rien à percevoir : le changement attend l'échéance.
    return { ...base, direction, effect: 'period_end' };
  }

  // ── Montée en gamme ────────────────────────────────────────────────────────
  const currentPrice = priceCents(currentPlan, currentInterval) ?? 0;
  const targetPrice = priceCents(targetPlan, targetInterval);
  if (targetPrice === null) {
    // Couple (plan, périodicité) non commercialisé — l'appelant doit refuser en
    // amont (`isSellable`). On ne devine pas un tarif.
    throw new Error(
      `Aucun tarif publié pour « ${targetPlan} » en « ${targetInterval} » — changement impossible.`,
    );
  }

  // Crédit : portion non consommée du plan actuel, au prorata des jours.
  const creditCents = periodDays > 0 ? Math.floor((currentPrice * remainingDays) / periodDays) : 0;

  // Coût : le nouveau plan pour la durée restante. Quand la périodicité change,
  // la nouvelle période démarre à neuf — on facture une période entière.
  const chargeCents =
    currentInterval === targetInterval && periodDays > 0
      ? Math.ceil((targetPrice * remainingDays) / periodDays)
      : targetPrice;

  const net = chargeCents - creditCents;
  const amountDueCents = Math.max(net, 0);
  const carriedCreditCents = Math.max(-net, 0);

  return {
    direction,
    effect: 'immediate',
    remainingDays,
    periodDays,
    creditCents,
    chargeCents,
    amountDueCents,
    carriedCreditCents,
    taxIncluded: false,
  };
}

/**
 * Fin de la prochaine période à partir d'une date de départ.
 * Calendaire volontairement simple (30/365 jours) et non « même jour du mois
 * suivant » : le fournisseur de paiement fait autorité sur les dates réelles de
 * prélèvement ; cette valeur sert d'affichage et de garde-fou local tant qu'un
 * webhook n'a pas confirmé la période exacte.
 */
export function nextPeriodEnd(from: Date, interval: BillingInterval): Date {
  return new Date(from.getTime() + intervalDays(interval) * MS_PER_DAY);
}

/** Ajoute `days` jours à une date (essai, grâce). */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * MS_PER_DAY);
}
