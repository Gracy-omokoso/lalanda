// ─────────────────────────────────────────────────────────────────────────────
// LECTURE D'UN ÉTAT D'ABONNEMENT (S22b) — fonctions PURES
//
// Ce fichier ne DÉCIDE rien : il met des mots sur ce que l'API a déjà décidé.
// La distinction est la même que pour le moteur financier (docs/26) — un
// composant qui calculerait lui-même « il reste 3 jours d'essai » finirait par
// afficher 3 quand l'API en compte 2, et c'est l'affichage qui aurait tort.
//
// Ce qui est ici : traductions de statut, priorité d'affichage, formatage de
// montants, et le choix du chemin (payer maintenant / programmer / rien à
// faire). Ce qui n'y est PAS : montants, jours restants, éligibilité à l'essai,
// disponibilité des fournisseurs. Tout cela vient du serveur.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  BillingInterval,
  PaymentMethod,
  Plan,
  PlanQuoteView,
  SubscriptionStateView,
  SubscriptionStatus,
} from '@/lib/api';

/** Libellé lisible d'un statut. */
export const STATUS_LABELS: Readonly<Record<SubscriptionStatus, string>> = {
  trialing: 'Essai en cours',
  active: 'Abonnement actif',
  past_due: 'Paiement en échec',
  grace: 'Période de grâce',
  suspended: 'Abonnement suspendu',
  canceled: 'Aucun abonnement',
};

/** Libellé d'une offre. */
export const PLAN_LABELS: Readonly<Record<Plan, string>> = {
  free: 'Free',
  pro: 'Pro',
  business: 'Business',
};

export const INTERVAL_LABELS: Readonly<Record<BillingInterval, string>> = {
  month: 'Mensuel',
  year: 'Annuel',
};

export const METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  card: 'Carte bancaire',
  paypal: 'PayPal',
  mobile_money: 'Mobile money',
  bank_transfer: 'Virement bancaire',
};

/**
 * Moyens de paiement encaissés par confirmation HUMAINE.
 *
 * Ils méritent un avertissement dans le tunnel : l'abonnement n'est pas actif au
 * clic, et surtout il ne se RENOUVELLE PAS tout seul — un dépôt mobile money est
 * un paiement ponctuel, il n'existe aucun mandat de prélèvement derrière. Le
 * taire produirait des suspensions surprises au mois suivant.
 */
export const MANUAL_METHODS: readonly PaymentMethod[] = ['mobile_money', 'bank_transfer'];

export function isManualMethod(method: PaymentMethod): boolean {
  return MANUAL_METHODS.includes(method);
}

/** Ton de l'encart d'état — pilote la couleur, jamais le contenu. */
export type Ton = 'info' | 'succes' | 'attention' | 'critique';

export interface EtatAffiche {
  ton: Ton;
  titre: string;
  /** Une phrase, au plus. Le détail va dans les actions, pas dans un paragraphe. */
  detail: string;
}

/**
 * Ce qu'il faut montrer en haut du tunnel.
 *
 * L'ordre des cas est l'ordre d'URGENCE, pas l'ordre de la machine d'état : un
 * client suspendu ne doit pas d'abord lire « votre essai a été utilisé ».
 *
 * `notice` du serveur est PRÉFÉRÉ quand il existe : il porte le message que
 * l'API a jugé nécessaire (échéance, motif d'échec), et le dupliquer ici
 * garantirait deux textes divergents.
 */
export function etatAffiche(state: SubscriptionStateView): EtatAffiche {
  const plan = PLAN_LABELS[state.subscribedPlan];

  switch (state.status) {
    case 'suspended':
      return {
        ton: 'critique',
        titre: 'Abonnement suspendu',
        detail:
          state.notice?.message ??
          `L'accès aux fonctions ${plan} est interrompu faute de paiement. Aucune donnée n'a été supprimée : un règlement rétablit tout en l'état.`,
      };

    case 'grace':
      return {
        ton: 'critique',
        titre: 'Période de grâce',
        detail:
          state.notice?.message ??
          `Il reste ${joursOuZero(state.grace.daysLeft)} jour(s) avant suspension. Régularisez le paiement pour conserver l'accès.`,
      };

    case 'past_due':
      return {
        ton: 'attention',
        titre: 'Paiement en échec',
        detail:
          state.notice?.message ??
          "Le dernier prélèvement n'a pas abouti. Votre accès reste ouvert pendant les relances.",
      };

    case 'trialing':
      return {
        ton: 'info',
        titre: `Essai en cours — ${joursOuZero(state.trial.daysLeft)} jour(s) restant(s)`,
        detail:
          state.notice?.message ??
          `Vous bénéficiez de l'offre ${PLAN_LABELS[state.plan]}. À l'échéance, le compte revient à l'offre gratuite ; aucun projet n'est supprimé.`,
      };

    case 'active':
      return {
        ton: 'succes',
        titre: `Abonnement ${plan} actif`,
        detail:
          state.notice?.message ??
          (state.pendingChange
            ? `Changement programmé vers ${PLAN_LABELS[state.pendingChange.plan]} à la prochaine échéance.`
            : 'Votre abonnement est à jour.'),
      };

    case 'canceled':
    default:
      return {
        ton: 'info',
        titre: 'Aucun abonnement en cours',
        detail: state.trial.used
          ? "Votre période d'essai a déjà été utilisée. Choisissez une offre pour reprendre les fonctions payantes."
          : 'Vous pouvez démarrer un essai gratuit, sans carte bancaire, ou souscrire directement.',
      };
  }
}

/** `null` ou négatif → 0 : « -1 jour restant » n'a aucun sens à l'affichage. */
export function joursOuZero(days: number | null): number {
  return days === null || days < 0 ? 0 : days;
}

/**
 * Le tunnel doit-il proposer de démarrer l'essai ?
 *
 * L'éligibilité vient du serveur (`trial.eligible`) et n'est PAS recalculée :
 * la règle antifraude « une seule période par organisation » appartient à
 * l'API. On ajoute une seule condition d'affichage — ne pas proposer un essai à
 * quelqu'un qui a déjà un accès payant en cours, ce qui serait une régression
 * proposée comme une offre.
 */
export function peutDemarrerEssai(state: SubscriptionStateView): boolean {
  return state.trial.eligible && !state.paidAccess;
}

/** Sens d'un changement d'offre, du point de vue du client. */
export type Chemin =
  | { type: 'paiement'; raison: string }
  | { type: 'programme'; raison: string }
  | { type: 'aucun'; raison: string };

/**
 * Que se passe-t-il si le client valide ce choix ?
 *
 * Dérivé du CHIFFRAGE renvoyé par l'API, jamais d'une comparaison de plans faite
 * ici : c'est `computeProration` qui décide qu'un mensuel → annuel est une
 * montée en gamme, et une seconde règle côté client finirait par diverger.
 */
export function cheminDepuisChiffrage(quote: PlanQuoteView): Chemin {
  if (quote.direction === 'same') {
    return { type: 'aucun', raison: "C'est déjà votre offre actuelle." };
  }
  if (quote.effect === 'period_end') {
    return {
      type: 'programme',
      raison:
        "Ce changement prend effet à la prochaine échéance. Rien n'est prélevé, et vous conservez vos fonctions actuelles jusque-là.",
    };
  }
  return {
    type: 'paiement',
    raison:
      quote.creditCents > 0
        ? `La part non consommée de votre offre actuelle (${formatCents(quote.creditCents)}) est déduite.`
        : 'Le changement prend effet dès le paiement.',
  };
}

/**
 * Centimes → « 9,00 USD ».
 *
 * Formatage manuel plutôt qu'`Intl.NumberFormat` : la locale du navigateur
 * déciderait du séparateur, et un montant affiché « 9.00 » ici et « 9,00 » sur
 * la facture est le genre d'écart qui fait douter d'un prix.
 */
export function formatCents(cents: number, currency = 'USD'): string {
  const signe = cents < 0 ? '-' : '';
  const absolu = Math.abs(cents);
  const unites = Math.trunc(absolu / 100);
  const centimes = (absolu % 100).toString().padStart(2, '0');
  return `${signe}${unites},${centimes} ${currency}`;
}

/** Date ISO → « 9 août 2026 ». `null` → tiret cadratin. */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Code d'erreur d'une réponse d'API, ou `null`. */
export function codeErreur(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const detail = (error as { detail?: unknown }).detail;
  if (typeof detail !== 'object' || detail === null) return null;
  const code = (detail as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Message destiné au client à partir d'un refus de l'API.
 *
 * Chaque code a une phrase qui dit QUOI FAIRE. « PLAN_NOT_SELLABLE » affiché tel
 * quel n'apprend rien à un client, et un message générique (« une erreur est
 * survenue ») sur un tunnel de paiement fait abandonner l'achat.
 */
export function messageRefus(error: unknown, defaut: string): string {
  switch (codeErreur(error)) {
    case 'TRIAL_ALREADY_USED':
      return "Cette organisation a déjà utilisé sa période d'essai. Choisissez une offre pour continuer.";
    case 'SUBSCRIPTION_ACTIVE':
      return "Un abonnement est déjà en cours : l'essai ne s'applique pas.";
    case 'PLAN_NOT_SELLABLE':
      return "Cette combinaison d'offre et de périodicité n'est pas proposée. Choisissez une autre périodicité.";
    case 'UPGRADE_REQUIRES_PAYMENT':
      return 'Une montée en gamme passe par le paiement — sélectionnez un moyen de paiement.';
    case 'DOWNGRADE_NOT_PAYABLE':
      return "Une baisse de gamme ne se paie pas : elle prend effet à l'échéance.";
    case 'ALREADY_CANCELED':
      return 'Cet abonnement est déjà clos.';
    case 'PROVIDER_UNAVAILABLE':
      return "Ce moyen de paiement n'est pas disponible actuellement. Essayez-en un autre.";
    case 'NO_SUBSCRIPTION':
      return 'Aucun abonnement à modifier pour cette organisation.';
    case 'INVALID_PLAN_OR_INTERVAL':
      return 'Offre ou périodicité invalide.';
    default:
      return defaut;
  }
}

/** Un refus d'autorisation (403) — l'appelant n'a pas `billing.manage`. */
export function estRefusAutorisation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 403
  );
}
