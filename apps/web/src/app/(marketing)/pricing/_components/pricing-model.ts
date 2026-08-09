// ─────────────────────────────────────────────────────────────────────────────
// CONTENU DE LA PAGE TARIFS (S22b) — données pures, testées
//
// Extrait de la page pour une raison précise : cette page est une PROMESSE
// COMMERCIALE. Chaque ligne doit correspondre à ce que l'API applique
// réellement (`apps/api/src/billing/entitlements.ts` et `pricing-catalog.ts`).
// Une promesse dans un JSX de 400 lignes ne se relit pas ; une table de données
// avec un test qui la confronte au catalogue, si.
//
// ── Ce qui n'est PAS ici ─────────────────────────────────────────────────────
//
// Les moyens de paiement. Ils ne sont pas une donnée statique : ils dépendent
// de ce qui est configuré en production à l'instant où la page est lue. Ils
// viennent de `GET /payments/methods` (voir `payment-methods.tsx`). Écrire
// « mobile money » en dur, comme le faisait la version précédente de cette page,
// promettait un moyen de paiement que rien ne garantissait.
// ─────────────────────────────────────────────────────────────────────────────

export type PlanSlug = 'free' | 'pro' | 'business';

/**
 * Durée de l'essai, en jours. Doit valoir `TRIAL_DAYS`
 * (`apps/api/src/billing/pricing-catalog.ts`) — le test le rappelle.
 */
export const TRIAL_DAYS = 14;

/** Plan accordé pendant l'essai — `TRIAL_PLAN` côté API. */
export const TRIAL_PLAN: PlanSlug = 'pro';

export interface Tier {
  slug: PlanSlug;
  name: string;
  /** Prix mensuel affiché. `null` = offre gratuite. */
  priceMonthUsd: number | null;
  /** Prix annuel affiché, ou `null` si aucune offre annuelle n'est PUBLIÉE. */
  priceYearUsd: number | null;
  tagline: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}

/**
 * Les trois offres.
 *
 * Business n'a PAS de prix annuel : aucun n'est publié, et en inventer un
 * (« 490 USD/an ») serait un engagement commercial pris par un développeur.
 * L'API refuse d'ailleurs de vendre ce couple (`PLAN_NOT_SELLABLE`) — la page et
 * l'API disent donc la même chose, ce qui est le minimum attendu d'une grille
 * tarifaire.
 */
export const TIERS: readonly Tier[] = [
  {
    slug: 'free',
    name: 'Free',
    priceMonthUsd: null,
    priceYearUsd: null,
    tagline: 'Pour tester Lalanda sur un premier projet.',
    features: [
      '1 projet',
      '1 scénario',
      'Export PDF avec filigrane',
      'Accès à tous les templates sectoriels',
      'Packs pays RDC, CI, SN, OHADA',
    ],
    cta: "S'inscrire gratuitement",
  },
  {
    slug: 'pro',
    name: 'Pro',
    priceMonthUsd: 9,
    priceYearUsd: 90,
    tagline: 'Pour un entrepreneur qui monte plusieurs dossiers.',
    features: [
      'Projets illimités',
      'Jusqu’à 3 scénarios par projet',
      'Export PDF sans filigrane',
      'Historique des versions',
      'Support par email',
    ],
    cta: `Essayer ${TRIAL_DAYS} jours`,
    highlighted: true,
  },
  {
    slug: 'business',
    name: 'Business',
    priceMonthUsd: 49,
    priceYearUsd: null,
    tagline: 'Pour cabinets, incubateurs et institutions financières.',
    features: [
      'Tout Pro, plus :',
      'White-label (logo et couleurs)',
      '20 sièges inclus',
      'Accès API',
      'Support prioritaire',
    ],
    cta: `Essayer ${TRIAL_DAYS} jours`,
  },
] as const;

/**
 * Une ligne du comparatif.
 *
 * `true`/`false` produisent une coche ou un tiret ; une chaîne est affichée
 * telle quelle. Un comparatif dont chaque cellule serait une phrase libre
 * deviendrait illisible sur mobile.
 */
export interface ComparisonRow {
  label: string;
  /** Précision affichée en petit sous le libellé. */
  note?: string;
  free: string | boolean;
  pro: string | boolean;
  business: string | boolean;
}

export interface ComparisonSection {
  title: string;
  rows: ComparisonRow[];
}

/**
 * Comparatif détaillé.
 *
 * Les lignes qui portent une limite APPLIQUÉE par l'API (projets, filigrane)
 * sont confrontées au catalogue par le test. Les autres décrivent des fonctions
 * dont l'accès n'est pas encore restreint par un entitlement : elles reprennent
 * mot pour mot ce que les cartes annoncent, sans rien y ajouter.
 */
export const COMPARISON: readonly ComparisonSection[] = [
  {
    title: 'Modélisation',
    rows: [
      { label: 'Projets', free: '1', pro: 'Illimités', business: 'Illimités' },
      { label: 'Scénarios par projet', free: '1', pro: "Jusqu'à 3", business: "Jusqu'à 3" },
      {
        label: 'Templates sectoriels',
        note: 'Tous les templates, dès la formule gratuite.',
        free: true,
        pro: true,
        business: true,
      },
      {
        label: 'Packs pays (RDC, CI, SN, OHADA)',
        note: 'Paramètres fiscaux sourcés et datés.',
        free: true,
        pro: true,
        business: true,
      },
      {
        label: 'Moteur de calcul complet',
        note: 'Bilan, compte de résultat, trésorerie, seuil de rentabilité.',
        free: true,
        pro: true,
        business: true,
      },
    ],
  },
  {
    title: 'Restitution',
    rows: [
      {
        label: 'Export PDF',
        free: 'Avec filigrane',
        pro: 'Sans filigrane',
        business: 'Sans filigrane',
      },
      { label: 'Export Excel', free: true, pro: true, business: true },
      { label: 'Historique des versions', free: false, pro: true, business: true },
      { label: 'White-label (logo, couleurs)', free: false, pro: false, business: true },
    ],
  },
  {
    title: 'Équipe et intégration',
    rows: [
      {
        label: 'Sièges inclus',
        note: 'Membres de l’organisation.',
        free: '1',
        pro: '1',
        business: '20',
      },
      { label: 'Accès API', free: false, pro: false, business: true },
      { label: 'Support', free: 'Documentation', pro: 'Email', business: 'Prioritaire' },
    ],
  },
] as const;

export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * Foire aux questions.
 *
 * Écrite pour répondre aux objections RÉELLES d'un tunnel de souscription, pas
 * pour meubler : carte bancaire exigée ou non, ce qui arrive aux données à la
 * fin de l'essai, ce que devient un projet après une baisse de gamme, et la
 * fiscalité — qui n'est PAS arbitrée et qu'il serait malhonnête de passer sous
 * silence sur une page de prix.
 */
export const FAQ: readonly FaqEntry[] = [
  {
    question: `L'essai de ${TRIAL_DAYS} jours demande-t-il une carte bancaire ?`,
    answer:
      'Non. Aucun moyen de paiement n’est demandé pour démarrer l’essai, et aucun prélèvement ' +
      'n’a lieu à son terme : le compte revient simplement à l’offre gratuite.',
  },
  {
    question: 'Que deviennent mes projets à la fin de l’essai ?',
    answer:
      'Ils restent intacts. Le compte repasse en offre gratuite, ce qui limite la CRÉATION de ' +
      'nouveaux projets, mais aucun projet existant n’est supprimé ni fermé — vous continuez à ' +
      'les consulter et à les exporter.',
  },
  {
    question: 'Puis-je changer d’offre en cours de mois ?',
    answer:
      'Oui. Une montée en gamme est immédiate et vous n’êtes facturé que de la différence : la ' +
      'part non consommée de votre offre actuelle est déduite. Une baisse prend effet à la ' +
      'prochaine échéance, sans perte de la période déjà réglée.',
  },
  {
    question: 'Que se passe-t-il si un paiement échoue ?',
    answer:
      'L’accès n’est pas coupé au premier échec. Vous conservez vos fonctions pendant les ' +
      'relances, puis pendant une période de grâce. La suspension n’intervient qu’ensuite, et ' +
      'elle ne supprime rien : un paiement rétablit l’accès en l’état.',
  },
  {
    question: 'Les prix sont-ils hors taxes ?',
    answer:
      'Les montants affichés sont hors taxes. Le traitement fiscal applicable à une vente de ' +
      'service numérique dépend de votre pays et de votre statut ; il n’est pas encore arbitré ' +
      'et sera précisé sur la facture avant tout prélèvement.',
  },
  {
    question: 'Puis-je résilier à tout moment ?',
    answer:
      'Oui, depuis l’espace organisation. La résiliation prend effet à l’échéance de la période ' +
      'en cours et ne supprime aucune donnée.',
  },
] as const;

/** Libellé d'affichage d'un moyen de paiement (`GET /payments/methods`). */
export const PAYMENT_METHOD_LABELS: Readonly<Record<string, string>> = {
  card: 'Carte bancaire',
  paypal: 'PayPal',
  mobile_money: 'Mobile money',
  bank_transfer: 'Virement bancaire',
};

/** Moyens de paiement encaissés par confirmation humaine plutôt qu'en ligne. */
export const MANUAL_METHODS: readonly string[] = ['mobile_money', 'bank_transfer'];

/**
 * Formate un prix mensuel. `null` → « 0 USD » : l'offre gratuite est un prix,
 * pas une absence de prix, et l'écrire « Gratuit » dans une colonne de montants
 * casse l'alignement des chiffres.
 */
export function formatPrice(usd: number | null): string {
  return `${usd ?? 0} USD`;
}

/**
 * Économie annuelle en pourcentage, arrondie à l'entier inférieur.
 *
 * `null` quand l'un des deux prix n'est pas publié — c'est le cas de Business.
 * Arrondi vers le BAS : annoncer « 17 % » quand l'économie réelle est de 16,6 %
 * est une surpromesse, fût-elle minuscule.
 */
export function annualSavingPercent(tier: Tier): number | null {
  if (tier.priceMonthUsd === null || tier.priceYearUsd === null) return null;
  const fullYear = tier.priceMonthUsd * 12;
  if (fullYear <= 0) return null;
  const saved = fullYear - tier.priceYearUsd;
  if (saved <= 0) return null;
  return Math.floor((saved / fullYear) * 100);
}

/**
 * Cette offre propose-t-elle une facturation annuelle ?
 *
 * Consommé par le tunnel pour n'afficher la bascule mensuel/annuel que là où
 * elle mène quelque part. Sans ce garde-fou, un client choisirait « annuel » sur
 * Business et recevrait un refus de l'API — un cul-de-sac dans un tunnel de
 * paiement.
 */
export function hasAnnualOffer(slug: PlanSlug): boolean {
  const tier = TIERS.find((t) => t.slug === slug);
  return tier?.priceYearUsd !== null && tier?.priceYearUsd !== undefined;
}
