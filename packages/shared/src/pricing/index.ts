// ─────────────────────────────────────────────────────────────────────────────
// CATALOGUE DES OFFRES — SOURCE DE VÉRITÉ UNIQUE
//
// Ce fichier est le SEUL endroit du dépôt où vivent les montants et les limites
// commerciales. Ni l'API, ni la page tarifs, ni le tunnel de souscription n'en
// recopient une valeur : ils importent ce module.
//
// ── Pourquoi dans `@lalanda/shared` et pas dans `apps/api/src/billing` ───────
//
// La grille était jusqu'ici écrite DEUX fois : une fois dans
// `apps/api/src/billing/{entitlements,pricing-catalog}.ts`, une fois dans
// `apps/web/.../pricing/_components/pricing-model.ts`, avec un test qui recopiait
// une TROISIÈME fois les valeurs attendues pour vérifier que les deux premières
// coïncidaient. Trois copies ne se corrigent pas ensemble : la page annonçait un
// tarif annuel Business que l'API refusait de vendre.
//
// `apps/web` ne peut pas importer `apps/api` (ce serait faire dépendre le front
// d'un serveur Nest), mais les deux dépendent déjà de `@lalanda/shared`. C'est
// donc le seul emplacement d'où une valeur peut être lue par les deux sans être
// dupliquée. Changer un prix = éditer `PLAN_CATALOG` ci-dessous, une seule fois.
//
// ── Ce que ce module ne fait pas ─────────────────────────────────────────────
//
// Il ne DÉCIDE rien : aucune limite n'est appliquée ici. L'application des
// limites appartient à l'API (`apps/api/src/billing`), conformément à docs/13 :
// « l'interface peut expliquer une limite, mais l'API l'impose ». Un catalogue
// importé par le navigateur ne protège rien — il informe.
//
// ── Unités ───────────────────────────────────────────────────────────────────
//
// Les montants sont en CENTIMES ENTIERS. Aucun flottant ne traverse une
// facture : `9.99 * 100` vaut 998.9999999999999 en IEEE-754. Le moteur financier
// applique la même règle (docs/21).
// ─────────────────────────────────────────────────────────────────────────────

/** Identifiants des offres, du moins au plus riche. L'ordre fait foi (`planRank`). */
export const PLANS = ['free', 'pro', 'cabinet', 'business', 'expert'] as const;
export type Plan = (typeof PLANS)[number];

export function isPlan(value: unknown): value is Plan {
  return typeof value === 'string' && (PLANS as readonly string[]).includes(value);
}

/** Périodicités de facturation proposées (docs/13 : « mensuel ou annuel »). */
export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === 'string' && (BILLING_INTERVALS as readonly string[]).includes(value);
}

/**
 * Devise de facturation. USD uniquement — la page publique annonce
 * « Facturation en USD ». Le CDF impliquerait un taux de change daté et une
 * politique de conversion : c'est une décision commerciale, pas un paramètre
 * (docs/13 § La devise et la fiscalité restent les vrais bloquants).
 */
export const BILLING_CURRENCY = 'USD' as const;
export type BillingCurrency = typeof BILLING_CURRENCY;

/**
 * Limites appliquées par l'API.
 *
 * Convention unique et non négociable : **`null` signifie « illimité »**, jamais
 * « inconnu » ni « zéro ». Un champ absent serait ambigu ; tous sont donc
 * obligatoires, et une nouvelle offre ne compile pas tant qu'elle ne les a pas
 * tous renseignés.
 */
export interface Entitlements {
  /** Projets par organisation. `null` = illimité. */
  readonly maxProjects: number | null;
  /** Filigrane « offre gratuite » sur les exports PDF. */
  readonly pdfWatermark: boolean;
  /** Exports PDF par mois calendaire. `null` = illimité. */
  readonly pdfExportsPerMonth: number | null;
  /**
   * Messages IA par mois calendaire. `null` = illimité.
   *
   * Compte les appels qui ont RÉELLEMENT atteint le modèle. Un repli
   * déterministe (aucun appel réseau) ne consomme rien : facturer à
   * l'utilisateur une panne de configuration serait un défaut, pas un quota.
   */
  readonly aiMessagesPerMonth: number | null;
  /** Sièges inclus. `null` = négocié au contrat (offre Expert). */
  readonly seats: number | null;
  /** Suivi du réalisé (docs/08 — prévisionnel vs. réalisé). */
  readonly actualsEnabled: boolean;
}

/** Prix d'une offre. `null` = aucun tarif publié (offre sur devis). */
export interface PlanPrice {
  readonly monthCents: number | null;
  readonly yearCents: number | null;
}

export interface PlanDefinition {
  readonly slug: Plan;
  /** Nom commercial affiché. */
  readonly name: string;
  readonly price: PlanPrice;
  readonly entitlements: Entitlements;
  /**
   * L'offre se souscrit-elle SEULE, en ligne, sans négociation ?
   *
   * `false` pour Expert : le pack inclut du temps d'expert humain, dont le coût
   * dépasse un mois de Business. Vendre en un clic ce qui ne se livre pas sans
   * accord commercial produit un engagement qu'on ne peut pas tenir. Une offre
   * `selfServe: false` n'a donc aucun prix Stripe, aucun bouton de paiement et
   * aucun couple (plan, périodicité) vendable — elle porte « Nous contacter ».
   */
  readonly selfServe: boolean;
  /** Phrase de positionnement affichée sous le nom, sur la page tarifs. */
  readonly tagline: string;
}

/**
 * LA GRILLE. Arbitrée par le décideur — c'est le seul endroit à éditer.
 *
 * Chaque ligne est un engagement public ET une règle appliquée par l'API : les
 * deux ne peuvent plus diverger puisqu'elles lisent la même donnée.
 */
export const PLAN_CATALOG: Readonly<Record<Plan, PlanDefinition>> = Object.freeze({
  free: Object.freeze({
    slug: 'free',
    name: 'Free',
    // Le gratuit est un prix, pas une absence de prix : 0, pas `null`.
    price: Object.freeze({ monthCents: 0, yearCents: 0 }),
    entitlements: Object.freeze({
      maxProjects: 1,
      pdfWatermark: true,
      pdfExportsPerMonth: 3,
      aiMessagesPerMonth: 20,
      seats: 1,
      actualsEnabled: false,
    }),
    // `free` n'est pas un achat : rien à souscrire, donc rien à vendre.
    selfServe: false,
    tagline: 'Pour tester Lalanda sur un premier projet.',
  }),
  pro: Object.freeze({
    slug: 'pro',
    name: 'Pro',
    price: Object.freeze({ monthCents: 1900, yearCents: 19000 }),
    entitlements: Object.freeze({
      maxProjects: 5,
      pdfWatermark: false,
      pdfExportsPerMonth: 30,
      aiMessagesPerMonth: 500,
      seats: 1,
      actualsEnabled: true,
    }),
    selfServe: true,
    tagline: 'Pour un entrepreneur qui monte plusieurs dossiers.',
  }),
  cabinet: Object.freeze({
    slug: 'cabinet',
    name: 'Cabinet',
    price: Object.freeze({ monthCents: 3900, yearCents: 39000 }),
    entitlements: Object.freeze({
      maxProjects: 20,
      pdfWatermark: false,
      pdfExportsPerMonth: 100,
      aiMessagesPerMonth: 1500,
      seats: 3,
      actualsEnabled: true,
    }),
    selfServe: true,
    tagline: 'Pour un cabinet ou un incubateur qui suit plusieurs clients.',
  }),
  business: Object.freeze({
    slug: 'business',
    name: 'Business',
    price: Object.freeze({ monthCents: 7900, yearCents: 79000 }),
    entitlements: Object.freeze({
      maxProjects: null,
      pdfWatermark: false,
      pdfExportsPerMonth: null,
      aiMessagesPerMonth: 2000,
      seats: 20,
      actualsEnabled: true,
    }),
    selfServe: true,
    tagline: 'Pour institutions financières et structures multi-équipes.',
  }),
  expert: Object.freeze({
    slug: 'expert',
    name: 'Expert',
    // Aucun montant publié : le pack inclut du temps humain, chiffré au cas par
    // cas. Un « 199 USD/mois » plausible serait un prix inventé par un
    // développeur (CLAUDE.md : « ne pas inventer de règle commerciale »).
    price: Object.freeze({ monthCents: null, yearCents: null }),
    entitlements: Object.freeze({
      maxProjects: null,
      pdfWatermark: false,
      pdfExportsPerMonth: null,
      aiMessagesPerMonth: null,
      // Négocié au contrat — d'où `null` et non un nombre arbitraire.
      seats: null,
      actualsEnabled: true,
    }),
    selfServe: false,
    tagline: 'Accompagnement par un expert, sur devis.',
  }),
});

/** Raccourci de lecture — les limites d'une offre. */
export const PLAN_ENTITLEMENTS: Readonly<Record<Plan, Entitlements>> = Object.freeze(
  Object.fromEntries(PLANS.map((p) => [p, PLAN_CATALOG[p].entitlements])) as Record<
    Plan,
    Entitlements
  >,
);

/** Raccourci de lecture — les prix d'une offre. */
export const PLAN_PRICES: Readonly<Record<Plan, PlanPrice>> = Object.freeze(
  Object.fromEntries(PLANS.map((p) => [p, PLAN_CATALOG[p].price])) as Record<Plan, PlanPrice>,
);

/**
 * Offres souscriptibles EN LIGNE, dans l'ordre d'affichage.
 *
 * Exclut `free` (rien à acheter) et `expert` (rien à acheter SANS parler à
 * quelqu'un). C'est la liste que le tunnel de souscription propose.
 */
export const SELF_SERVE_PLANS: readonly Plan[] = PLANS.filter((p) => PLAN_CATALOG[p].selfServe);

export function isSelfServePlan(plan: Plan): boolean {
  return PLAN_CATALOG[plan].selfServe;
}

/**
 * Prix d'un couple (plan, périodicité), ou `null` si ce couple n'est pas
 * commercialisé. `null` doit être traité comme un REFUS, jamais comme 0.
 */
export function priceCents(plan: Plan, interval: BillingInterval): number | null {
  const price = PLAN_CATALOG[plan].price;
  return interval === 'month' ? price.monthCents : price.yearCents;
}

/**
 * Ce couple (plan, périodicité) est-il vendable en libre-service ?
 *
 * Deux conditions, et les deux comptent : un tarif publié NE SUFFIT PAS si
 * l'offre n'est pas en libre-service. C'est ce qui empêche Expert d'être vendu
 * par une requête directe si un prix venait à lui être ajouté un jour.
 */
export function isSellable(plan: Plan, interval: BillingInterval): boolean {
  return isSelfServePlan(plan) && priceCents(plan, interval) !== null;
}

/** Cette offre propose-t-elle une facturation annuelle ? */
export function hasAnnualOffer(plan: Plan): boolean {
  return isSellable(plan, 'year');
}

/**
 * Rang commercial d'une offre — distingue une MONTÉE en gamme (prorata
 * immédiat) d'une BAISSE (effet à l'échéance), docs/13 § Changements de plan.
 *
 * Dérivé de la POSITION dans `PLANS` et non du prix mensuel, comme c'était le
 * cas jusqu'ici : Expert n'a pas de prix, et un rang dérivé d'un `null` aurait
 * classé l'offre la plus riche au niveau du gratuit. L'ordre de `PLANS` est donc
 * la donnée, et le test vérifie qu'il reste cohérent avec les prix publiés.
 */
export function planRank(plan: Plan): number {
  return PLANS.indexOf(plan);
}

/** Durée d'une période de facturation, en jours. */
export function intervalDays(interval: BillingInterval): number {
  return interval === 'month' ? 30 : 365;
}

/**
 * Économie annuelle en pourcentage, arrondie à l'entier INFÉRIEUR.
 *
 * `null` quand l'un des deux tarifs n'est pas publié. Arrondi vers le bas :
 * annoncer « 17 % » quand l'économie réelle vaut 16,6 % est une surpromesse,
 * fût-elle minuscule.
 */
export function annualSavingPercent(plan: Plan): number | null {
  const { monthCents, yearCents } = PLAN_CATALOG[plan].price;
  if (monthCents === null || yearCents === null) return null;
  const fullYear = monthCents * 12;
  if (fullYear <= 0) return null;
  const saved = fullYear - yearCents;
  if (saved <= 0) return null;
  return Math.floor((saved / fullYear) * 100);
}

/** Nombre de mois offerts par le tarif annuel, arrondi au dixième. */
export function annualFreeMonths(plan: Plan): number | null {
  const { monthCents, yearCents } = PLAN_CATALOG[plan].price;
  if (monthCents === null || yearCents === null || monthCents <= 0) return null;
  const months = (monthCents * 12 - yearCents) / monthCents;
  return months > 0 ? Math.round(months * 10) / 10 : null;
}

// ── Essai et période de grâce ────────────────────────────────────────────────

/**
 * Plan accordé pendant l'essai de 14 jours.
 *
 * `pro` et non `business` : docs/13 § Essai demande un « accès fonctionnel
 * généreux mais quotas raisonnables ». Pro lève le filigrane et ouvre le suivi
 * du réalisé — c'est-à-dire l'essentiel de la valeur perçue — sans offrir les
 * 20 sièges de Business, qui transformeraient l'essai en licence d'équipe
 * gratuite pendant deux semaines.
 */
export const TRIAL_PLAN: Plan = 'pro';

/** Durée de l'essai en jours (docs/13 : « 14 jours calendaires »). */
export const TRIAL_DAYS = 14;

/**
 * Période de grâce après épuisement des tentatives de paiement.
 *
 * DÉFAUT d'implémentation, pas une décision : docs/13 laisse la durée
 * « à définir ». Remonté au décideur.
 */
export const GRACE_DAYS = 7;

// ── Formatage ────────────────────────────────────────────────────────────────

/**
 * Centimes → montant entier en USD, ou `null` si aucun tarif n'est publié.
 * Les cinq tarifs de la grille sont des entiers ; l'arrondi n'a donc rien à
 * masquer, il existe pour que l'affichage ne dépende pas du format des centimes.
 */
export function usdFromCents(cents: number | null): number | null {
  return cents === null ? null : Math.round(cents / 100);
}

/**
 * Libellé d'un quota mensuel. `null` → « Illimité ».
 * Centralisé pour que la page tarifs, le tunnel et un futur écran d'usage
 * n'écrivent pas trois mots différents pour la même absence de limite.
 */
export function formatQuota(value: number | null, unit: string): string {
  return value === null ? 'Illimité' : `${value} ${unit}`;
}

// ── Fenêtre des quotas mensuels ──────────────────────────────────────────────

/**
 * Début du mois calendaire courant, en UTC.
 *
 * UTC et non l'heure locale du serveur : deux instances déployées dans des
 * fuseaux différents doivent réinitialiser le quota au MÊME instant, sinon un
 * utilisateur obtient deux réinitialisations ou aucune selon l'instance qui le
 * sert. Le mois calendaire (plutôt qu'une fenêtre glissante de 30 jours) est
 * choisi parce qu'il est explicable : « votre quota repart le 1er ».
 */
export function monthWindowStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Instant de réinitialisation du quota : le 1er du mois suivant, à 00:00 UTC. */
export function monthWindowReset(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}
