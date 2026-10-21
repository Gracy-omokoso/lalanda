// ─────────────────────────────────────────────────────────────────────────────
// GROW — indicateurs investisseurs (ADR-0032 § 3)
//
// Chaque indicateur rend sa source, sa période, sa méthode et ses hypothèses, ou
// `disponible: false` avec un code de raison. Aucun `0` par défaut : un mois jamais
// clôturé, une ligne jamais saisie, une vente dans une autre devise ne valent pas
// zéro (docs/08, règle cardinale).
// ─────────────────────────────────────────────────────────────────────────────

import type { Fixed } from '../invoice-totals/decimal.js';
import {
  compareMonths,
  daysBetween,
  exerciseLabel,
  lastCompleteMonth,
  monthLabel,
  monthWindow,
} from './periods.js';
import {
  fixedRatio,
  fixedToNumber,
  salesRevenue,
  sumEntries,
  type GrowRevenueEntry,
  type GrowSalesRevenue,
} from './sales-revenue.js';
import {
  GROW_VERSION,
  type GrowActualPeriod,
  type GrowActualsSource,
  type GrowFacts,
  type GrowIndicator,
  type GrowIndicatorCode,
  type GrowIndicatorsResult,
  type GrowInputs,
  type GrowMonth,
  type GrowPeriod,
  type GrowSourceRef,
  type GrowTopCustomer,
  type GrowUnit,
} from './types.js';

/**
 * Fenêtres et seuils de données des indicateurs, versionnés avec `GROW_VERSION`
 * (ADR-0032 § 3, décision ouverte n° 5).
 */
export const GROW_WINDOWS_V1 = Object.freeze({
  /** Mois clôturés moyennés pour le burn, les marges. */
  moisRealise: 3,
  /** Mois civils comparés (3 + 3) pour la croissance. */
  moisCroissance: 3,
  /** Mois civils de la concentration clients. */
  moisConcentration: 12,
  /** Historique minimal (mois complets depuis la première vente) pour la concentration. */
  historiqueMinConcentration: 3,
  /** Mois civils comparés (6 + 6) pour les clients revenants. */
  moisFidelisation: 6,
  /** Âge maximal d'un solde déclaré, en jours. */
  joursValiditeSolde: 90,
});

/**
 * Lignes du réalisé reconnues comme MARGE BRUTE, dans l'ordre de préférence.
 * Table explicite : aucune équivalence devinée par racine (docs/08, convention 2).
 * `marge_matiere` est la marge brute du modèle restaurant (CA − coût matière).
 */
export const GROW_GROSS_MARGIN_LINES: readonly string[] = Object.freeze([
  'marge_brute',
  'marge_matiere',
]);

/** Lignes du réalisé lues par GROW (compte d'exploitation commun aux modèles). */
export const GROW_ACTUAL_LINES = Object.freeze({ ca: 'ca', resultatNet: 'resultat_net' });

const LIBELLES: Readonly<Record<GrowIndicatorCode, string>> = {
  mrr: 'Revenu récurrent mensuel (MRR)',
  arr: 'Revenu récurrent annualisé (ARR)',
  burn_rate: 'Consommation mensuelle (burn rate)',
  runway: 'Autonomie de trésorerie (runway)',
  croissance_ventes: 'Croissance des ventes',
  croissance_ca_realise: 'Croissance du chiffre d’affaires réalisé',
  marge_brute: 'Marge brute',
  marge_nette: 'Marge nette',
  concentration_clients: 'Concentration clients',
  clients_revenants: 'Part des ventes aux clients revenants',
};

const HYP_BURN =
  'Approximation : le résultat net saisi au réalisé tient lieu de flux de trésorerie ; il ignore le BFR, les investissements et les emprunts. Il sera remplacé par les flux réels quand la trésorerie réelle existera.';
const HYP_CLOS =
  'Seuls les mois clôturés comptent : un mois saisi mais ouvert reste une estimation (docs/08).';
const HYP_HT =
  'Chiffre d’affaires des ventes = bases HT hors TVA des factures finales, moins les avoirs ; acomptes exclus ; aucun taux de change appliqué.';
const HYP_ANONYMES =
  'Les ventes sans client identifié sont exclues du classement mais comptées dans le total.';

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

function unavailable(
  code: GrowIndicatorCode,
  raison: string,
  message: string,
  sources: readonly GrowSourceRef[],
  hypotheses: readonly string[] = [],
): GrowIndicator {
  return { code, libelle: LIBELLES[code], disponible: false, raison, message, sources, hypotheses };
}

function available(
  code: GrowIndicatorCode,
  fields: {
    valeur: number;
    unite: GrowUnit;
    devise: string | null;
    sources: readonly GrowSourceRef[];
    periode: GrowPeriod;
    methode: string;
    hypotheses: readonly string[];
  },
): GrowIndicator {
  return { code, libelle: LIBELLES[code], disponible: true, ...fields };
}

// ─── Réalisé ─────────────────────────────────────────────────────────────────

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function chronological(a: GrowActualPeriod, b: GrowActualPeriod): number {
  return a.year - b.year || a.month - b.month;
}

/**
 * Les `count` derniers mois CLÔTURÉS portant toutes les `lines`, dans l'ordre
 * chronologique ; moins de `count` si l'historique est plus court.
 */
function lastClosedWith(
  periods: readonly GrowActualPeriod[],
  lines: readonly string[],
  count: number,
): GrowActualPeriod[] {
  const closed = periods
    .filter((p) => p.status === 'closed' && lines.every((l) => isNumber(p.values[l])))
    .sort(chronological);
  return closed.slice(Math.max(0, closed.length - count));
}

function sumLine(periods: readonly GrowActualPeriod[], line: string): number {
  return periods.reduce((s, p) => s + (p.values[line] ?? 0), 0);
}

function closedPeriod(periods: readonly GrowActualPeriod[], intro: string): GrowPeriod {
  const mois = periods.map(exerciseLabel);
  const bornes = mois.length > 1 ? `${mois[0]} à ${mois[mois.length - 1]}` : (mois[0] ?? '');
  return { libelle: `${intro} (${bornes})`, mois };
}

function actualsSource(a: Extract<GrowActualsSource, { kind: 'project' }>): GrowSourceRef {
  const how = a.selection === 'declared' ? 'projet de référence choisi' : 'seul projet';
  return {
    source: 'build.actuals',
    libelle: `Réalisé clôturé du projet « ${a.projectName} » (${how}, ${a.currency})`,
  };
}

function noProject(
  code: GrowIndicatorCode,
  actuals: Extract<GrowActualsSource, { kind: 'none' }>,
  hypotheses: readonly string[] = [],
): GrowIndicator {
  const message =
    actuals.reason === 'AUCUN_PROJET'
      ? 'Aucun projet : le réalisé se saisit dans un projet doté d’un plan validé.'
      : 'Plusieurs projets : choisissez celui dont le réalisé représente l’entreprise.';
  return unavailable(code, actuals.reason, message, [], hypotheses);
}

function notEnoughClosed(
  code: GrowIndicatorCode,
  source: GrowSourceRef,
  have: number,
  need: number,
  line: string,
): GrowIndicator {
  return unavailable(
    code,
    'MOIS_CLOTURES_INSUFFISANTS',
    `${need} mois clôturés portant la ligne « ${line} » sont nécessaires ; ${have} disponible${have > 1 ? 's' : ''}.`,
    [source],
    [HYP_CLOS],
  );
}

// ─── Ventes ──────────────────────────────────────────────────────────────────

function salesSource(revenue: GrowSalesRevenue): GrowSourceRef {
  return { source: 'run.sales', libelle: `Ventes RUN (${revenue.currency ?? 'devise ?'}, HT)` };
}

/** Indisponibilité commune des indicateurs de ventes, ou `null` si les ventes sont lisibles. */
function salesBlocker(
  code: GrowIndicatorCode,
  revenue: GrowSalesRevenue,
  hypotheses: readonly string[],
): GrowIndicator | null {
  if (revenue.currencyIssue === 'DEVISE_DE_REFERENCE_INDETERMINEE') {
    return unavailable(
      code,
      'DEVISE_DE_REFERENCE_INDETERMINEE',
      `Vos ventes sont en plusieurs devises (${revenue.currenciesSeen.join(', ')}) et aucun taux n’est arrêté : choisissez un projet de référence, sa devise servira de référence.`,
      [],
      hypotheses,
    );
  }
  if (revenue.entries.length === 0) {
    const autre = revenue.excluded.autreDevise;
    return unavailable(
      code,
      autre > 0 ? 'VENTES_HORS_DEVISE_DE_REFERENCE' : 'AUCUNE_VENTE',
      autre > 0
        ? `${autre} document${autre > 1 ? 's' : ''} de vente dans une autre devise que ${revenue.currency} : sans taux arrêté, ils ne sont pas lus.`
        : 'Aucune facture finale dans Lalanda : cet indicateur se calcule sur vos ventes.',
      [salesSource(revenue)],
      hypotheses,
    );
  }
  return null;
}

function firstSaleMonth(entries: readonly GrowRevenueEntry[]): GrowMonth | null {
  let first: GrowMonth | null = null;
  for (const e of entries) if (first === null || compareMonths(e.month, first) < 0) first = e.month;
  return first;
}

function calendarPeriod(months: readonly GrowMonth[], intro: string): GrowPeriod {
  const bornes =
    months.length > 1
      ? `${monthLabel(months[0]!)} à ${monthLabel(months[months.length - 1]!)}`
      : monthLabel(months[0] ?? '');
  return { libelle: `${intro} (${bornes})`, mois: [...months] };
}

/** CA net par client identifié sur un ensemble de mois. */
function byCustomer(
  entries: readonly GrowRevenueEntry[],
  months: ReadonlySet<GrowMonth>,
): Map<string, { name: string | null; amount: Fixed }> {
  const map = new Map<string, { name: string | null; amount: Fixed }>();
  for (const e of entries) {
    if (e.customerKey === null || !months.has(e.month)) continue;
    const cur = map.get(e.customerKey);
    if (cur) {
      cur.amount += e.amount;
      if (cur.name === null) cur.name = e.customerName;
    } else {
      map.set(e.customerKey, { name: e.customerName, amount: e.amount });
    }
  }
  return map;
}

// ─── Calcul ──────────────────────────────────────────────────────────────────

/**
 * Indicateurs investisseurs depuis les données RÉELLES (ADR-0032 § 3).
 * Fonction pure : mêmes entrées, même résultat, quel que soit l'ordre des documents.
 */
export function computeInvestorIndicators(inputs: GrowInputs): GrowIndicatorsResult {
  const W = GROW_WINDOWS_V1;
  const { actuals, asOf } = inputs;
  const lastMonth = lastCompleteMonth(asOf);
  const revenue = salesRevenue(
    inputs.sales,
    actuals.kind === 'project' ? actuals.currency : null,
    inputs.recurringCatalogItemIds,
  );
  const sSales = salesSource(revenue);
  const firstSale = firstSaleMonth(revenue.entries);
  const out = {} as Record<GrowIndicatorCode, GrowIndicator>;

  // ── Réalisé : burn, marges, croissance du CA réalisé ──
  let burn: { value: number; periods: GrowActualPeriod[] } | null = null;
  if (actuals.kind === 'none') {
    for (const code of [
      'burn_rate',
      'marge_brute',
      'marge_nette',
      'croissance_ca_realise',
    ] as const) {
      out[code] = noProject(code, actuals, code === 'burn_rate' ? [HYP_BURN] : []);
    }
  } else {
    const src = actualsSource(actuals);
    const cur = actuals.currency;
    const { ca, resultatNet } = GROW_ACTUAL_LINES;

    // Burn rate
    const pBurn = lastClosedWith(actuals.periods, [resultatNet], W.moisRealise);
    if (pBurn.length < W.moisRealise) {
      out.burn_rate = notEnoughClosed('burn_rate', src, pBurn.length, W.moisRealise, resultatNet);
    } else {
      const mean = sumLine(pBurn, resultatNet) / pBurn.length;
      const value = round(Math.max(0, -mean), 2);
      burn = { value, periods: pBurn };
      out.burn_rate = available('burn_rate', {
        valeur: value,
        unite: 'montant',
        devise: cur,
        sources: [src],
        periode: closedPeriod(pBurn, `${pBurn.length} derniers mois clôturés`),
        methode:
          'Opposé de la moyenne mensuelle du résultat net réalisé, borné à zéro : un résultat moyen positif ne consomme pas de trésorerie.',
        hypotheses: [HYP_BURN, HYP_CLOS],
      });
    }

    // Marge nette
    const pNet = lastClosedWith(actuals.periods, [ca, resultatNet], W.moisRealise);
    if (pNet.length < W.moisRealise) {
      out.marge_nette = notEnoughClosed('marge_nette', src, pNet.length, W.moisRealise, 'ca');
    } else {
      const den = sumLine(pNet, ca);
      out.marge_nette =
        den <= 0
          ? unavailable(
              'marge_nette',
              'BASE_NULLE',
              'Chiffre d’affaires réalisé nul ou négatif sur la période : aucune marge ne se calcule.',
              [src],
              [HYP_CLOS],
            )
          : available('marge_nette', {
              valeur: round(sumLine(pNet, resultatNet) / den, 4),
              unite: 'ratio',
              devise: null,
              sources: [src],
              periode: closedPeriod(pNet, `${pNet.length} derniers mois clôturés`),
              methode: 'Somme du résultat net réalisé ÷ somme du chiffre d’affaires réalisé.',
              hypotheses: [HYP_CLOS],
            });
    }

    // Marge brute : ligne reconnue par la table, jamais devinée.
    const marginLine = GROW_GROSS_MARGIN_LINES.find((l) =>
      actuals.periods.some((p) => p.status === 'closed' && isNumber(p.values[l])),
    );
    if (marginLine === undefined) {
      out.marge_brute = unavailable(
        'marge_brute',
        'LIGNE_MARGE_ABSENTE',
        `Aucun mois clôturé ne porte de ligne de marge brute (${GROW_GROSS_MARGIN_LINES.join(' ou ')}). Certains modèles, comme la prestation de services, n’en ont pas.`,
        [src],
        [HYP_CLOS],
      );
    } else {
      const pGm = lastClosedWith(actuals.periods, [ca, marginLine], W.moisRealise);
      const den = sumLine(pGm, ca);
      out.marge_brute =
        pGm.length < W.moisRealise
          ? notEnoughClosed('marge_brute', src, pGm.length, W.moisRealise, marginLine)
          : den <= 0
            ? unavailable(
                'marge_brute',
                'BASE_NULLE',
                'Chiffre d’affaires réalisé nul ou négatif sur la période : aucune marge ne se calcule.',
                [src],
                [HYP_CLOS],
              )
            : available('marge_brute', {
                valeur: round(sumLine(pGm, marginLine) / den, 4),
                unite: 'ratio',
                devise: null,
                sources: [src],
                periode: closedPeriod(pGm, `${pGm.length} derniers mois clôturés`),
                methode: `Somme de la ligne « ${marginLine} » ÷ somme du chiffre d’affaires réalisé.`,
                hypotheses: [
                  HYP_CLOS,
                  `Ligne de marge retenue : « ${marginLine} » (table GROW_GROSS_MARGIN_LINES).`,
                ],
              });
    }

    // Croissance du CA réalisé : 3 derniers mois clôturés contre les 3 précédents.
    const n = W.moisCroissance;
    const pCa = lastClosedWith(actuals.periods, [ca], 2 * n);
    if (pCa.length < 2 * n) {
      out.croissance_ca_realise = notEnoughClosed(
        'croissance_ca_realise',
        src,
        pCa.length,
        2 * n,
        ca,
      );
    } else {
      const prev = sumLine(pCa.slice(0, n), ca);
      const recent = sumLine(pCa.slice(n), ca);
      out.croissance_ca_realise =
        prev <= 0
          ? unavailable(
              'croissance_ca_realise',
              'BASE_NULLE',
              'Chiffre d’affaires réalisé nul ou négatif sur la période de comparaison : aucune croissance ne se calcule.',
              [src],
              [HYP_CLOS],
            )
          : available('croissance_ca_realise', {
              valeur: round((recent - prev) / prev, 4),
              unite: 'ratio',
              devise: null,
              sources: [src],
              periode: closedPeriod(pCa, `${n} derniers mois clôturés contre les ${n} précédents`),
              methode:
                '(CA réalisé des 3 derniers mois clôturés − CA des 3 précédents) ÷ CA des 3 précédents.',
              hypotheses: [
                HYP_CLOS,
                'Mois d’exercice consécutifs dans l’ordre du plan, sans correction de saisonnalité.',
              ],
            });
    }
  }

  // ── Runway ──
  const sCash: GrowSourceRef | null = inputs.declaredCash
    ? {
        source: 'grow.declared_cash',
        libelle: `Solde de trésorerie déclaré le ${inputs.declaredCash.asOf}`,
      }
    : null;
  const HYP_CASH =
    'Le solde de trésorerie est DÉCLARÉ par l’utilisateur : c’est une hypothèse, pas un relevé bancaire.';
  if (actuals.kind === 'none') {
    out.runway = noProject('runway', actuals, [HYP_BURN]);
  } else if (burn === null) {
    out.runway = unavailable(
      'runway',
      'BURN_INDISPONIBLE',
      'L’autonomie se calcule à partir de la consommation mensuelle, indisponible (voir ce dernier indicateur).',
      sCash ? [actualsSource(actuals), sCash] : [actualsSource(actuals)],
      [HYP_BURN],
    );
  } else if (inputs.declaredCash === null || sCash === null) {
    out.runway = unavailable(
      'runway',
      'TRESORERIE_NON_DECLAREE',
      'Déclarez votre solde de trésorerie à date : l’autonomie en dépend.',
      [actualsSource(actuals)],
      [HYP_BURN],
    );
  } else {
    const cash = inputs.declaredCash;
    const age = daysBetween(cash.asOf, asOf);
    const sources = [sCash, actualsSource(actuals)];
    if (cash.currency !== actuals.currency) {
      out.runway = unavailable(
        'runway',
        'DEVISE_DIFFERENTE',
        `Solde déclaré en ${cash.currency}, réalisé en ${actuals.currency} : sans taux arrêté, l’autonomie ne se calcule pas.`,
        sources,
        [HYP_CASH, HYP_BURN],
      );
    } else if (age < 0) {
      out.runway = unavailable(
        'runway',
        'SOLDE_DATE_INVALIDE',
        `Le solde est daté du ${cash.asOf}, après la date du calcul (${asOf}).`,
        sources,
        [HYP_CASH],
      );
    } else if (age > W.joursValiditeSolde) {
      out.runway = unavailable(
        'runway',
        'SOLDE_PERIME',
        `Le solde déclaré date de ${age} jours (plus de ${W.joursValiditeSolde}) : mettez-le à jour.`,
        sources,
        [HYP_CASH],
      );
    } else if (burn.value === 0) {
      out.runway = unavailable(
        'runway',
        'PAS_DE_CONSOMMATION',
        'Le résultat net moyen est positif : l’entreprise ne consomme pas sa trésorerie sur la période, l’autonomie n’est pas limitée par l’exploitation.',
        sources,
        [HYP_CASH, HYP_BURN],
      );
    } else {
      out.runway = available('runway', {
        valeur: round(Math.max(0, cash.amount) / burn.value, 1),
        unite: 'mois',
        devise: null,
        sources,
        periode: {
          libelle: `Solde au ${cash.asOf} ÷ consommation des ${burn.periods.length} derniers mois clôturés`,
          mois: burn.periods.map(exerciseLabel),
        },
        methode: 'Solde de trésorerie déclaré ÷ consommation mensuelle (burn rate).',
        hypotheses: [
          HYP_CASH,
          HYP_BURN,
          'La consommation est supposée constante pour la suite.',
          ...(age > 31 ? [`Le solde déclaré date de ${age} jours.`] : []),
        ],
      });
    }
  }

  // ── Ventes : MRR, ARR, croissance, concentration, clients revenants ──
  const hypMrr = [
    HYP_HT,
    'Un article déclaré récurrent est supposé facturé chaque mois.',
    'Une facture n’est comptée que si toutes ses lignes sont des articles déclarés récurrents.',
  ];
  const mrrBlocker = salesBlocker('mrr', revenue, hypMrr);
  if (inputs.recurringCatalogItemIds.length === 0) {
    out.mrr = unavailable(
      'mrr',
      'REVENU_RECURRENT_NON_DECLARE',
      'Aucun revenu récurrent identifiable : déclarez les articles du catalogue qui sont des abonnements ou des contrats mensuels.',
      [],
      hypMrr,
    );
  } else if (mrrBlocker) {
    out.mrr = mrrBlocker;
  } else if (firstSale === null || compareMonths(firstSale, lastMonth) > 0) {
    out.mrr = unavailable(
      'mrr',
      'HISTORIQUE_INSUFFISANT',
      `Aucun mois civil complet de ventes : le premier mois complet sera ${monthLabel(firstSale ?? lastMonth)}.`,
      [sSales],
      hypMrr,
    );
  } else {
    const ofMonth = revenue.entries.filter((e) => e.month === lastMonth);
    const mixed = ofMonth.filter((e) => e.recurrence === 'mixte').length;
    if (mixed > 0) {
      out.mrr = unavailable(
        'mrr',
        'FACTURES_MIXTES',
        `${mixed} facture${mixed > 1 ? 's' : ''} de ${monthLabel(lastMonth)} mêle${mixed > 1 ? 'nt' : ''} articles récurrents et non récurrents : la ventilation par ligne n’est pas calculée.`,
        [sSales],
        hypMrr,
      );
    } else {
      const sum = sumEntries(ofMonth, (e) => e.recurrence === 'recurrent');
      out.mrr = available('mrr', {
        valeur: fixedToNumber(sum),
        unite: 'montant',
        devise: revenue.currency,
        sources: [sSales],
        periode: calendarPeriod([lastMonth], 'Dernier mois civil complet'),
        methode: 'Chiffre d’affaires HT des factures d’articles déclarés récurrents, net d’avoirs.',
        hypotheses: hypMrr,
      });
    }
  }
  const mrr = out.mrr;
  out.arr = mrr.disponible
    ? available('arr', {
        valeur: round(mrr.valeur * 12, 2),
        unite: 'montant',
        devise: mrr.devise,
        sources: mrr.sources,
        periode: mrr.periode,
        methode: 'MRR × 12.',
        hypotheses: [
          ...mrr.hypotheses,
          'Convention : le revenu récurrent du mois se répète 12 fois.',
        ],
      })
    : unavailable(
        'arr',
        mrr.raison,
        `MRR indisponible : ${mrr.message}`,
        mrr.sources,
        mrr.hypotheses,
      );

  // Croissance des ventes : 3 derniers mois civils complets contre les 3 précédents.
  {
    const n = GROW_WINDOWS_V1.moisCroissance;
    const months = monthWindow(lastMonth, 2 * n);
    const blocker = salesBlocker('croissance_ventes', revenue, [HYP_HT]);
    if (blocker) out.croissance_ventes = blocker;
    else if (firstSale === null || compareMonths(firstSale, months[0]!) > 0) {
      out.croissance_ventes = unavailable(
        'croissance_ventes',
        'HISTORIQUE_INSUFFISANT',
        `${2 * n} mois civils complets de ventes sont nécessaires (première vente : ${monthLabel(firstSale ?? lastMonth)}).`,
        [sSales],
        [HYP_HT],
      );
    } else {
      const prevSet = new Set(months.slice(0, n));
      const recentSet = new Set(months.slice(n));
      const prev = sumEntries(revenue.entries, (e) => prevSet.has(e.month));
      const recent = sumEntries(revenue.entries, (e) => recentSet.has(e.month));
      out.croissance_ventes =
        prev <= 0n
          ? unavailable(
              'croissance_ventes',
              'BASE_NULLE',
              'Ventes nulles ou négatives sur la période de comparaison : aucune croissance ne se calcule.',
              [sSales],
              [HYP_HT],
            )
          : available('croissance_ventes', {
              valeur: round(fixedRatio(recent - prev, prev), 4),
              unite: 'ratio',
              devise: null,
              sources: [sSales],
              periode: calendarPeriod(
                months,
                `${n} derniers mois civils complets contre les ${n} précédents`,
              ),
              methode:
                '(Ventes HT des 3 derniers mois − ventes HT des 3 précédents) ÷ ventes HT des 3 précédents.',
              hypotheses: [HYP_HT, 'Un mois sans facture compte pour zéro vente.'],
            });
    }
  }

  // Concentration clients : 12 derniers mois civils complets (bornés à la première vente).
  {
    const months = monthWindow(lastMonth, W.moisConcentration).filter(
      (m) => firstSale !== null && compareMonths(m, firstSale) >= 0,
    );
    const hyp = [HYP_HT, HYP_ANONYMES];
    const blocker = salesBlocker('concentration_clients', revenue, hyp);
    if (blocker) out.concentration_clients = blocker;
    else if (months.length < W.historiqueMinConcentration) {
      out.concentration_clients = unavailable(
        'concentration_clients',
        'HISTORIQUE_INSUFFISANT',
        `${W.historiqueMinConcentration} mois civils complets de ventes sont nécessaires ; ${months.length} disponible${months.length > 1 ? 's' : ''}.`,
        [sSales],
        hyp,
      );
    } else {
      const set = new Set(months);
      const total = sumEntries(revenue.entries, (e) => set.has(e.month));
      const ranked = [...byCustomer(revenue.entries, set).entries()]
        .filter(([, v]) => v.amount > 0n)
        .sort(([ka, a], [kb, b]) =>
          a.amount === b.amount ? (ka < kb ? -1 : 1) : a.amount > b.amount ? -1 : 1,
        );
      if (total <= 0n) {
        out.concentration_clients = unavailable(
          'concentration_clients',
          'BASE_NULLE',
          'Ventes nulles ou négatives sur la période : aucune part ne se calcule.',
          [sSales],
          hyp,
        );
      } else if (ranked.length === 0) {
        out.concentration_clients = unavailable(
          'concentration_clients',
          'AUCUN_CLIENT_IDENTIFIE',
          'Aucune vente rattachée à un client du fichier clients sur la période.',
          [sSales],
          hyp,
        );
      } else {
        const top: GrowTopCustomer[] = ranked.slice(0, 3).map(([cle, v], i) => ({
          rang: i + 1,
          cle,
          nom: v.name,
          montant: fixedToNumber(v.amount),
          part: round(fixedRatio(v.amount, total), 4),
        }));
        const top3 = ranked.slice(0, 3).reduce((s, [, v]) => s + v.amount, 0n);
        out.concentration_clients = {
          ...available('concentration_clients', {
            valeur: top[0]!.part,
            unite: 'ratio',
            devise: null,
            sources: [sSales],
            periode: calendarPeriod(months, `${months.length} derniers mois civils complets`),
            methode: 'CA HT net du premier client ÷ CA HT net total de la période.',
            hypotheses: hyp,
          }),
          premiersClients: top,
          partTroisPremiers: round(fixedRatio(top3, total), 4),
        } as GrowIndicator;
      }
    }
  }

  // Clients revenants : part des ventes des 6 derniers mois faite avec des clients
  // déjà facturés les 6 mois précédents.
  {
    const n = W.moisFidelisation;
    const months = monthWindow(lastMonth, 2 * n);
    const hyp = [
      HYP_HT,
      HYP_ANONYMES,
      'Un client revenant est un client identifié facturé (CA net > 0) sur les 6 mois précédents.',
    ];
    const blocker = salesBlocker('clients_revenants', revenue, hyp);
    if (blocker) out.clients_revenants = blocker;
    else if (firstSale === null || compareMonths(firstSale, months[0]!) > 0) {
      out.clients_revenants = unavailable(
        'clients_revenants',
        'HISTORIQUE_INSUFFISANT',
        `${2 * n} mois civils complets de ventes sont nécessaires (première vente : ${monthLabel(firstSale ?? lastMonth)}).`,
        [sSales],
        hyp,
      );
    } else {
      const prevSet = new Set(months.slice(0, n));
      const recentSet = new Set(months.slice(n));
      const before = new Set(
        [...byCustomer(revenue.entries, prevSet).entries()]
          .filter(([, v]) => v.amount > 0n)
          .map(([k]) => k),
      );
      const total = sumEntries(revenue.entries, (e) => recentSet.has(e.month));
      const returning = sumEntries(
        revenue.entries,
        (e) => recentSet.has(e.month) && e.customerKey !== null && before.has(e.customerKey),
      );
      out.clients_revenants =
        total <= 0n
          ? unavailable(
              'clients_revenants',
              'BASE_NULLE',
              'Ventes nulles ou négatives sur les 6 derniers mois : aucune part ne se calcule.',
              [sSales],
              hyp,
            )
          : available('clients_revenants', {
              valeur: round(Math.min(1, Math.max(0, fixedRatio(returning, total))), 4),
              unite: 'ratio',
              devise: null,
              sources: [sSales],
              periode: calendarPeriod(
                months,
                `${n} derniers mois civils complets, clients des ${n} précédents`,
              ),
              methode:
                'CA HT net des 6 derniers mois réalisé avec des clients déjà facturés les 6 mois précédents ÷ CA HT net des 6 derniers mois.',
              hypotheses: [...hyp, 'Part bornée entre 0 et 100 % (avoirs d’un mois à l’autre).'],
            });
    }
  }

  // ── Faits ──
  const months12 = new Set(monthWindow(lastMonth, 12));
  const closed =
    actuals.kind === 'project' ? actuals.periods.filter((p) => p.status === 'closed') : [];
  const lastClosedAt = closed
    .map((p) => p.closedAt)
    .filter((t): t is string => t !== null && Number.isFinite(Date.parse(t)))
    .sort()
    .pop();
  const faits: GrowFacts = {
    devise: revenue.currency,
    projet:
      actuals.kind === 'project'
        ? { id: actuals.projectId, nom: actuals.projectName, selection: actuals.selection }
        : null,
    moisClotures: closed.length,
    derniereCloture: lastClosedAt ?? null,
    caRealisePositif: closed.some((p) => isNumber(p.values['ca']) && p.values['ca']! > 0),
    documentsRetenus: revenue.entries.length,
    documentsExclus: { ...revenue.excluded },
    premiereVente: firstSale,
    clientsDistincts12Mois: [...byCustomer(revenue.entries, months12).values()].filter(
      (v) => v.amount > 0n,
    ).length,
    dernierMoisComplet: lastMonth,
  };

  return { growVersion: GROW_VERSION, asOf, indicateurs: out, faits };
}
