// ─────────────────────────────────────────────────────────────────────────────
// CONTENU DE LA PAGE TARIFS — dérivé du catalogue, jamais recopié
//
// Cette page est une PROMESSE COMMERCIALE : chaque ligne doit correspondre à ce
// que l'API applique réellement. La version précédente le garantissait par un
// test qui RECOPIAIT les valeurs de l'API (`API_PRICES`, `API_ENTITLEMENTS`) —
// donc une troisième copie, qui a fini par diverger comme les deux autres.
//
// Ici, plus aucune valeur n'est écrite : montants, limites et noms viennent de
// `@lalanda/shared/pricing`, le module qu'importe aussi `apps/api`. Une page qui
// annoncerait autre chose que l'API ne peut plus être écrite — il faudrait
// modifier le catalogue, et l'API changerait avec elle.
//
// ── Ce qui reste éditorial, et pourquoi ──────────────────────────────────────
//
// Les phrases (arguments, FAQ) restent ici : ce sont des choix de rédaction, pas
// des engagements chiffrés. Dès qu'une phrase contient un NOMBRE, ce nombre est
// interpolé depuis le catalogue plutôt que tapé — c'est la ligne de partage.
//
// ── Ce qui n'est PAS ici ─────────────────────────────────────────────────────
//
// Les moyens de paiement. Ils dépendent de ce qui est configuré en production à
// l'instant où la page est lue, et viennent de `GET /payments/methods` (voir
// `payment-methods.tsx`).
// ─────────────────────────────────────────────────────────────────────────────

import {
  annualSavingPercent as catalogAnnualSaving,
  formatQuota,
  hasAnnualOffer as catalogHasAnnualOffer,
  isSelfServePlan,
  PLAN_CATALOG,
  PLANS,
  TRIAL_DAYS as CATALOG_TRIAL_DAYS,
  TRIAL_PLAN as CATALOG_TRIAL_PLAN,
  usdFromCents,
  type Entitlements,
  type Plan,
} from '@lalanda/shared/pricing';

export type PlanSlug = Plan;
export { PLANS };

/** Durée de l'essai, en jours — valeur du catalogue, pas une constante locale. */
export const TRIAL_DAYS = CATALOG_TRIAL_DAYS;

/** Plan accordé pendant l'essai. */
export const TRIAL_PLAN: PlanSlug = CATALOG_TRIAL_PLAN;

export interface Tier {
  slug: PlanSlug;
  name: string;
  /** Prix mensuel affiché en USD. `null` = aucun tarif publié (offre sur devis). */
  priceMonthUsd: number | null;
  /** Prix annuel affiché en USD. `null` = aucune offre annuelle publiée. */
  priceYearUsd: number | null;
  tagline: string;
  features: string[];
  cta: string;
  /** Destination du bouton. Expert mène au contact, pas à l'inscription. */
  ctaHref: string;
  /**
   * L'offre se souscrit-elle en ligne ?
   *
   * `false` pour Expert : le pack inclut du temps d'expert humain. La carte
   * affiche « Nous contacter » et n'ouvre AUCUN tunnel de paiement — un bouton
   * d'achat sous une prestation humaine vend un engagement qu'on ne peut pas
   * tenir. `free` est également `false` : il n'y a rien à acheter.
   */
  selfServe: boolean;
  highlighted?: boolean;
}

/**
 * Arguments d'une offre, avec les nombres pris dans ses entitlements.
 *
 * Écrire « Projets illimités » sous Pro pendant que l'API en autorise 5 est
 * exactement le litige que cette page doit rendre impossible : les quatre
 * premières puces sont donc CALCULÉES, et seule la dernière est éditoriale.
 */
function featuresOf(plan: Plan): string[] {
  const e: Entitlements = PLAN_CATALOG[plan].entitlements;

  const projets =
    e.maxProjects === null
      ? 'Projets illimités'
      : `${e.maxProjects} ${e.maxProjects > 1 ? 'projets' : 'projet'}`;

  const pdf = e.pdfWatermark
    ? `${formatQuota(e.pdfExportsPerMonth, 'exports PDF')} par mois, avec filigrane`
    : e.pdfExportsPerMonth === null
      ? 'Exports PDF illimités, sans filigrane'
      : `${e.pdfExportsPerMonth} exports PDF par mois, sans filigrane`;

  const ia =
    e.aiMessagesPerMonth === null
      ? 'Assistant IA sans limite de messages'
      : `${e.aiMessagesPerMonth.toLocaleString('fr-FR')} messages IA par mois`;

  const sieges =
    e.seats === null
      ? 'Sièges négociés au contrat'
      : `${e.seats} ${e.seats > 1 ? 'sièges inclus' : 'siège'}`;

  const realise = e.actualsEnabled
    ? 'Suivi du réalisé (prévisionnel vs. réel)'
    : 'Prévisionnel seul (sans suivi du réalisé)';

  const editorial: Record<Plan, string> = {
    free: 'Accès à tous les templates et packs pays',
    pro: 'Historique des versions et support par email',
    cabinet: 'Espace multi-clients et support par email',
    business: 'White-label, accès API et support prioritaire',
    expert: 'Accompagnement par un expert, sur devis',
  };

  return [projets, pdf, ia, sieges, realise, editorial[plan]];
}

function ctaOf(plan: Plan): string {
  if (plan === 'free') return "S'inscrire gratuitement";
  // Expert n'a pas d'essai à proposer : il n'a pas de tunnel du tout.
  if (!isSelfServePlan(plan)) return 'Nous contacter';
  return `Essayer ${TRIAL_DAYS} jours`;
}

/**
 * Les cinq offres, dans l'ordre du catalogue.
 *
 * Aucun montant n'est écrit ici. Ajouter un palier au catalogue le fait
 * apparaître sur la page ; en retirer un l'en retire. C'est le seul agencement
 * où la page ne peut pas mentir.
 */
export const TIERS: readonly Tier[] = PLANS.map((slug) => {
  const def = PLAN_CATALOG[slug];
  return {
    slug,
    name: def.name,
    priceMonthUsd: usdFromCents(def.price.monthCents),
    priceYearUsd: usdFromCents(def.price.yearCents),
    tagline: def.tagline,
    features: featuresOf(slug),
    cta: ctaOf(slug),
    // Expert ne mène pas à `/register` : l'inscription ouvrirait un compte
    // gratuit sans rien dire du devis, ce qui n'est pas ce que le bouton promet.
    ctaHref: slug === 'expert' ? '/contact?offre=expert' : '/register',
    selfServe: def.selfServe,
    // Cabinet est le palier mis en avant : c'est la clientèle réelle (cabinets
    // et incubateurs), et c'est le palier que l'ancienne grille n'avait pas.
    ...(slug === 'cabinet' ? { highlighted: true } : {}),
  };
});

/**
 * Une ligne du comparatif.
 *
 * `values` est indexé par plan plutôt que par trois champs nommés : avec cinq
 * offres, `free/pro/business` obligerait à toucher chaque ligne pour ajouter une
 * colonne, et une cellule oubliée s'afficherait vide — ce qu'un lecteur
 * interprète comme « non inclus ». Le type force les cinq clés.
 */
export interface ComparisonRow {
  label: string;
  /** Précision affichée en petit sous le libellé. */
  note?: string;
  values: Readonly<Record<Plan, string | boolean>>;
}

export interface ComparisonSection {
  title: string;
  rows: ComparisonRow[];
}

/** Construit une ligne à partir d'une fonction des entitlements du plan. */
function rowFromEntitlements(
  label: string,
  read: (e: Entitlements) => string | boolean,
  note?: string,
): ComparisonRow {
  return {
    label,
    ...(note === undefined ? {} : { note }),
    values: Object.fromEntries(PLANS.map((p) => [p, read(PLAN_CATALOG[p].entitlements)])) as Record<
      Plan,
      string | boolean
    >,
  };
}

/** Construit une ligne dont les valeurs sont éditoriales (aucun entitlement). */
function row(label: string, values: Record<Plan, string | boolean>, note?: string): ComparisonRow {
  return { label, ...(note === undefined ? {} : { note }), values };
}

/**
 * Comparatif détaillé.
 *
 * Les lignes qui portent une limite APPLIQUÉE par l'API sont construites depuis
 * les entitlements — elles ne peuvent pas diverger. Les autres décrivent des
 * fonctions dont l'accès n'est pas encore restreint par un entitlement : elles
 * sont éditoriales et le disent.
 */
export const COMPARISON: readonly ComparisonSection[] = [
  {
    title: 'Modélisation',
    rows: [
      rowFromEntitlements('Projets', (e) =>
        e.maxProjects === null ? 'Illimités' : String(e.maxProjects),
      ),
      row('Scénarios par projet', {
        free: '1',
        pro: "Jusqu'à 3",
        cabinet: "Jusqu'à 3",
        business: "Jusqu'à 3",
        expert: "Jusqu'à 3",
      }),
      row(
        'Templates sectoriels',
        { free: true, pro: true, cabinet: true, business: true, expert: true },
        'Tous les templates, dès la formule gratuite.',
      ),
      row(
        'Packs pays (RDC, CI, SN, OHADA)',
        { free: true, pro: true, cabinet: true, business: true, expert: true },
        'Paramètres fiscaux sourcés et datés.',
      ),
      row(
        'Moteur de calcul complet',
        { free: true, pro: true, cabinet: true, business: true, expert: true },
        'Bilan, compte de résultat, trésorerie, seuil de rentabilité.',
      ),
      rowFromEntitlements(
        'Suivi du réalisé',
        (e) => e.actualsEnabled,
        'Saisie mensuelle du réel et écarts avec le prévisionnel.',
      ),
    ],
  },
  {
    title: 'Restitution',
    rows: [
      rowFromEntitlements(
        'Exports PDF',
        (e) => {
          const quota =
            e.pdfExportsPerMonth === null ? 'Illimités' : `${e.pdfExportsPerMonth}/mois`;
          return e.pdfWatermark ? `${quota}, avec filigrane` : `${quota}, sans filigrane`;
        },
        'Le filigrane est appliqué par l’API, jamais par l’interface.',
      ),
      row('Export Excel', {
        free: true,
        pro: true,
        cabinet: true,
        business: true,
        expert: true,
      }),
      row('Historique des versions', {
        free: false,
        pro: true,
        cabinet: true,
        business: true,
        expert: true,
      }),
      row('White-label (logo, couleurs)', {
        free: false,
        pro: false,
        cabinet: false,
        business: true,
        expert: true,
      }),
    ],
  },
  {
    title: 'Assistant IA',
    rows: [
      rowFromEntitlements(
        'Messages par mois',
        (e) =>
          e.aiMessagesPerMonth === null
            ? 'Illimités'
            : e.aiMessagesPerMonth.toLocaleString('fr-FR'),
        'Le quota repart le 1er de chaque mois. Une réponse rendue sans appel au modèle n’est pas décomptée.',
      ),
    ],
  },
  {
    title: 'Équipe et intégration',
    rows: [
      rowFromEntitlements(
        'Sièges inclus',
        (e) => (e.seats === null ? 'Négociés' : String(e.seats)),
        'Membres de l’organisation.',
      ),
      row('Accès API', {
        free: false,
        pro: false,
        cabinet: false,
        business: true,
        expert: true,
      }),
      row('Temps d’expert humain', {
        free: false,
        pro: false,
        cabinet: false,
        business: false,
        expert: true,
      }),
      row('Support', {
        free: 'Documentation',
        pro: 'Email',
        cabinet: 'Email',
        business: 'Prioritaire',
        expert: 'Dédié',
      }),
    ],
  },
];

export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * Foire aux questions.
 *
 * Écrite pour répondre aux objections RÉELLES d'un tunnel de souscription, pas
 * pour meubler : carte bancaire exigée ou non, ce qui arrive aux données à la
 * fin de l'essai, ce que devient un projet après une baisse de gamme, comment se
 * comptent les messages IA, et la fiscalité — qui n'est PAS arbitrée et qu'il
 * serait malhonnête de passer sous silence sur une page de prix.
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
    question: 'Comment sont comptés les messages de l’assistant IA ?',
    answer:
      'Un message est décompté lorsqu’il a réellement été traité par le modèle. Lorsque ' +
      'l’assistant répond à partir de ses règles internes, sans appeler le modèle, rien n’est ' +
      'décompté. Le compteur repart à zéro le 1er de chaque mois, et l’application vous indique ' +
      'à tout moment ce qu’il vous reste ainsi que la date de réinitialisation.',
  },
  {
    question: 'Puis-je changer d’offre en cours de mois ?',
    answer:
      'Oui. Une montée en gamme est immédiate et vous n’êtes facturé que de la différence : la ' +
      'part non consommée de votre offre actuelle est déduite. Une baisse prend effet à la ' +
      'prochaine échéance, sans perte de la période déjà réglée.',
  },
  {
    question: 'Pourquoi l’offre Expert n’a-t-elle pas de prix affiché ?',
    answer:
      'Parce qu’elle inclut du temps d’un expert humain, dont le volume dépend de votre dossier. ' +
      'Elle ne se souscrit donc pas en ligne : nous établissons un devis après un échange, et ' +
      'les accès sont ouverts une fois l’accord conclu.',
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
];

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
 * Formate un prix mensuel.
 *
 * `null` ne veut PAS dire zéro ici : il signifie « aucun tarif publié », et
 * l'afficher « 0 USD » annoncerait l'offre Expert comme gratuite. Le gratuit,
 * lui, porte un vrai 0 dans le catalogue.
 */
export function formatPrice(usd: number | null): string {
  return usd === null ? 'Sur devis' : `${usd} USD`;
}

/**
 * Économie annuelle en pourcentage, arrondie à l'entier inférieur.
 * Déléguée au catalogue : la page et l'API annoncent le même chiffre.
 */
export function annualSavingPercent(tier: Tier): number | null {
  return catalogAnnualSaving(tier.slug);
}

/**
 * Cette offre propose-t-elle une facturation annuelle vendable en ligne ?
 *
 * Consommé par le tunnel pour n'afficher la bascule mensuel/annuel que là où
 * elle mène quelque part. Le catalogue exige AUSSI le libre-service : sans quoi
 * Expert, s'il recevait un tarif annuel un jour, deviendrait achetable en un
 * clic sans que personne n'ait touché au tunnel.
 */
export function hasAnnualOffer(slug: PlanSlug): boolean {
  return catalogHasAnnualOffer(slug);
}
