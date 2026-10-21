// ─────────────────────────────────────────────────────────────────────────────
// Brief du matin — faits et règles déterministes (ADR-0033 § 2 et § 3)
//
// Deux étapes, deux fonctions pures :
//
//   buildMorningBriefFacts   documents lus par l'API  → faits sourcés
//   evaluateMorningBriefRules faits                   → alertes et recommandations
//
// `buildMorningBrief` enchaîne les deux. Rien ici ne lit une horloge, une base
// ou un réseau ; rien ici ne dépend d'un modèle de langue. Les seuils sont des
// constantes nommées, citées par chaque règle qui les applique : un seuil qui
// change se voit dans le brief, pas seulement dans le code.
//
// Arithmétique : virgule fixe `bigint` d'`invoice-totals` (non modifiée).
// ─────────────────────────────────────────────────────────────────────────────

import { formatAmount, parseFixed } from '../invoice-totals/decimal.js';
import {
  BRIEF_CURRENCIES,
  MORNING_BRIEF_VERSION,
  type BriefCurrency,
  type BriefFact,
  type BriefInvoiceInput,
  type BriefRuleOutcome,
  type BriefSeverity,
  type BriefSkippedRule,
  type BriefSource,
  type BriefThreshold,
  type MorningBrief,
  type MorningBriefInput,
} from './types.js';

// ── Seuils (ADR-0033 § 3) — paramètres produit à valider par la dirigeante ───

export const MORNING_BRIEF_THRESHOLDS = Object.freeze({
  S1: threshold('S1', 0, 'facture', 'Aucune facture en anomalie tolérée'),
  S2: threshold('S2', 24, 'heures', 'Attente de normalisation au-delà de 24 heures'),
  S4: threshold('S4', 30, 'jours', 'Créance déclarée depuis plus de 30 jours'),
  S5: threshold('S5', 14, 'jours', 'Pro forma non modifiée depuis plus de 14 jours'),
  S6: threshold('S6', 10, 'jour_du_mois', 'Aucune facture émise à partir du 10ᵉ jour du mois'),
} as const);

/** Nombre d'alertes et de recommandations affichées (brief § 8). */
export const MORNING_BRIEF_TOP = 3;

function threshold(
  id: string,
  value: number,
  unit: BriefThreshold['unit'],
  label: string,
): BriefThreshold {
  return Object.freeze({ id, value, unit, label, nature: 'parametre_produit_a_valider' as const });
}

// ── Règles de lecture des documents ─────────────────────────────────────────

/** Groupes qui ne forment pas un chiffre d'affaires (ADR-0023 § S25e.13). */
export const NON_REVENUE_TAX_GROUPS: readonly string[] = Object.freeze(['H', 'I', 'J', 'L', 'N']);
const SALE_TYPES = new Set(['FV', 'EV']);
const DEPOSIT_TYPES = new Set(['FT', 'ET']);
const CREDIT_NOTE_TYPES = new Set(['FA', 'EA']);
const FINAL_STATUSES = new Set(['issued', 'normalized']);
const PHASES_TO_CHECK = new Set(['uncertain', 'needs_review']);

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Kinshasa : UTC+1 toute l'année, sans heure d'été (ADR-0027 `fiscalPeriodOf`). */
const KINSHASA_OFFSET_MS = HOUR_MS;

const SALES_SOURCE_REF = 'ADR-0023 § S25e.13, ADR-0033 § 2';

// ── Outils ───────────────────────────────────────────────────────────────────

/** Date civile de Kinshasa d'un instant. */
export function kinshasaDay(iso: string): { year: number; month: number; day: number } {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw new RangeError(`Instant illisible : ${JSON.stringify(iso)}`);
  const d = new Date(t + KINSHASA_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Montant signé au centime → décimal canonique (« -12.50 »). */
export function formatSigned(value: bigint): string {
  return value < 0n ? `-${formatAmount(-value)}` : formatAmount(value);
}

/** Montant stocké → virgule fixe ; un décimal illisible lève (les documents sont figés et contrôlés). */
function amountOf(value: string | null): bigint {
  if (value === null) return 0n;
  const fixed = parseFixed(value);
  if (fixed === null) throw new RangeError(`Montant illisible : ${JSON.stringify(value)}`);
  return fixed;
}

/** Rendu français d'un décimal canonique : « 1 234 567,50 ». Espace insécable en milliers. */
export function formatFr(decimal: string): string {
  const negative = decimal.startsWith('-');
  const [int = '0', frac = ''] = (negative ? decimal.slice(1) : decimal).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negative ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

function perCurrency(): Record<BriefCurrency, bigint> {
  return { CDF: 0n, USD: 0n };
}

function salesSource(rule: string): BriefSource {
  return { module: 'run.sales', collection: 'sales_invoices', rule, reference: SALES_SOURCE_REF };
}

function revenueBase(inv: BriefInvoiceInput): bigint {
  let sum = 0n;
  for (const g of inv.groups ?? []) {
    if (NON_REVENUE_TAX_GROUPS.includes(g.group)) continue;
    sum += amountOf(g.ht);
  }
  return sum;
}

// ── Faits ────────────────────────────────────────────────────────────────────

export function buildMorningBriefFacts(input: MorningBriefInput): BriefFact[] {
  const nowMs = Date.parse(input.now);
  const today = kinshasaDay(input.now);
  const facts: BriefFact[] = [];

  if (input.sales === 'hidden') {
    for (const f of SALES_FACT_SKELETON) {
      facts.push({ ...f, status: 'hidden', value: null });
    }
  } else {
    facts.push(...salesFacts(input.sales.invoices, nowMs, today));
  }

  // Trésorerie (ADR-0034 à venir).
  const cashSource: BriefSource = {
    module: 'treasury',
    collection: null,
    rule:
      input.cash.status === 'known'
        ? input.cash.sourceLabel
        : 'Aucune trésorerie réelle enregistrée dans Lalanda',
    reference: 'ADR-0033 § 2, ADR-0034',
  };
  if (input.cash.status === 'known') {
    for (const c of BRIEF_CURRENCIES) {
      const a = input.cash.amounts.find((x) => x.currency === c);
      if (!a) continue;
      facts.push({
        id: `tresorerie.${c}`,
        label: `Trésorerie disponible (${c})`,
        kind: 'amount',
        status: 'known',
        value: formatSigned(amountOfSigned(a.amount)),
        currency: c,
        source: cashSource,
      });
    }
  } else {
    facts.push({
      id: 'tresorerie',
      label: 'Trésorerie disponible',
      kind: 'status',
      status: 'to_fill',
      value: null,
      currency: null,
      source: cashSource,
    });
  }

  // Échéances (ADR-0031).
  facts.push({
    id: 'echeances.depassees',
    label: 'Factures dont l’échéance est dépassée',
    kind: 'count',
    status: input.dueDates.status === 'known' ? 'known' : 'unavailable',
    value: input.dueDates.status === 'known' ? String(input.dueDates.overdueCount) : null,
    currency: null,
    source: {
      module: 'run.receivables',
      collection: 'sales_invoice_settlements',
      rule: 'Échéance renseignée et dépassée, reste à encaisser positif',
      reference: 'ADR-0031 § 2',
    },
  });

  // Indicateurs du brief § 8 que Lalanda ne calcule pas encore.
  for (const [id, label, reference] of [
    ['pipeline', 'Pipeline commercial', 'ADR-0035'],
    ['taches_en_retard', 'Tâches en retard', 'brief stratégique § 5.6'],
    ['projets_a_risque', 'Projets à risque', 'brief stratégique § 5.6'],
  ] as const) {
    facts.push({
      id,
      label,
      kind: 'status',
      status: 'unavailable',
      value: null,
      currency: null,
      source: { module: 'non_livre', collection: null, rule: 'Module non livré', reference },
    });
  }

  return facts;
}

function amountOfSigned(value: string): bigint {
  return value.startsWith('-') ? -amountOf(value.slice(1)) : amountOf(value);
}

/** Squelette des faits de ventes : mêmes identifiants, qu'ils soient connus ou masqués. */
const SALES_FACT_SKELETON: readonly Omit<BriefFact, 'status' | 'value'>[] = Object.freeze([
  ...BRIEF_CURRENCIES.map((c) => ({
    id: `ca_mois.${c}`,
    label: `Chiffre d’affaires HT du mois (${c})`,
    kind: 'amount' as const,
    currency: c,
    source: salesSource(
      'Bases HT hors groupes H, I, J, L, N des factures finales FV/EV de la série réelle émises ce mois (Kinshasa), moins celles des avoirs FA/EA',
    ),
  })),
  {
    id: 'factures_mois.nombre',
    label: 'Factures émises ce mois',
    kind: 'count',
    currency: null,
    source: salesSource('Factures finales FV/EV de la série réelle émises ce mois'),
  },
  {
    id: 'avoirs_mois.nombre',
    label: 'Avoirs émis ce mois',
    kind: 'count',
    currency: null,
    source: salesSource('Avoirs finaux FA/EA de la série réelle émis ce mois'),
  },
  {
    id: 'acomptes_mois.nombre',
    label: 'Factures d’acompte émises ce mois (hors chiffre d’affaires)',
    kind: 'count',
    currency: null,
    source: salesSource('Factures finales FT/ET ; exclues du chiffre d’affaires (ADR-0031 n° 1)'),
  },
  ...BRIEF_CURRENCIES.map((c) => ({
    id: `creances.${c}`,
    label: `Créances à encaisser déclarées (${c})`,
    kind: 'amount' as const,
    currency: c,
    source: salesSource(
      'Part à crédit déclarée à l’émission, moins les avoirs à crédit imputés ; encaissements ultérieurs non suivis (ADR-0031)',
    ),
  })),
  {
    id: 'creances_anciennes.nombre',
    label: 'Factures à crédit émises depuis plus de 30 jours',
    kind: 'count',
    currency: null,
    source: salesSource('Factures dont la créance déclarée est positive, émises depuis plus de S4'),
  },
  ...BRIEF_CURRENCIES.map((c) => ({
    id: `creances_anciennes.${c}`,
    label: `Créances déclarées de plus de 30 jours (${c})`,
    kind: 'amount' as const,
    currency: c,
    source: salesSource('Même règle que les créances, factures émises depuis plus de S4'),
  })),
  {
    id: 'normalisation.echec',
    label: 'Factures en échec de normalisation',
    kind: 'count',
    currency: null,
    source: salesSource('Statut normalization_failed (ADR-0024)'),
  },
  {
    id: 'normalisation.a_verifier',
    label: 'Factures normalisées à vérifier',
    kind: 'count',
    currency: null,
    source: salesSource(
      'En attente de normalisation, phase uncertain ou needs_review (ADR-0024 § 4.1)',
    ),
  },
  {
    id: 'normalisation.attente_longue',
    label: 'Factures en attente de normalisation depuis plus de 24 h',
    kind: 'count',
    currency: null,
    source: salesSource('En attente de normalisation, gelées depuis plus de S2'),
  },
  {
    id: 'proformas_anciennes.nombre',
    label: 'Pro forma non modifiées depuis plus de 14 jours',
    kind: 'count',
    currency: null,
    source: salesSource('Brouillons dont la dernière modification dépasse S5'),
  },
]);

function salesFacts(
  invoices: readonly BriefInvoiceInput[],
  nowMs: number,
  today: { year: number; month: number },
): BriefFact[] {
  const revenue = perCurrency();
  let salesCount = 0;
  let creditNoteCount = 0;
  let depositCount = 0;

  // Parts à crédit des avoirs finaux, par facture d'origine.
  const creditByOrigin = new Map<string, bigint>();
  for (const inv of invoices) {
    if (inv.testSeries || !FINAL_STATUSES.has(inv.status)) continue;
    if (!CREDIT_NOTE_TYPES.has(inv.type) || inv.creditNoteOriginId === null) continue;
    const prev = creditByOrigin.get(inv.creditNoteOriginId) ?? 0n;
    creditByOrigin.set(inv.creditNoteOriginId, prev + amountOf(inv.amountOnCredit));
  }

  const receivables = perCurrency();
  const oldReceivables = perCurrency();
  let oldReceivableCount = 0;
  let failed = 0;
  let toCheck = 0;
  let longPending = 0;
  let oldDrafts = 0;

  const ageS2 = MORNING_BRIEF_THRESHOLDS.S2.value * HOUR_MS;
  const ageS4 = MORNING_BRIEF_THRESHOLDS.S4.value * DAY_MS;
  const ageS5 = MORNING_BRIEF_THRESHOLDS.S5.value * DAY_MS;

  for (const inv of invoices) {
    if (inv.testSeries) continue;

    if (inv.status === 'draft') {
      if (nowMs - Date.parse(inv.updatedAt) > ageS5) oldDrafts += 1;
      continue;
    }
    if (inv.status === 'normalization_failed') {
      failed += 1;
      continue;
    }
    if (inv.status === 'pending_normalization') {
      if (inv.normalizationPhase !== null && PHASES_TO_CHECK.has(inv.normalizationPhase)) {
        toCheck += 1;
      } else if (inv.frozenAt !== null && nowMs - Date.parse(inv.frozenAt) > ageS2) {
        longPending += 1;
      }
      continue;
    }
    if (!FINAL_STATUSES.has(inv.status) || inv.issuedAt === null) continue;

    const issued = kinshasaDay(inv.issuedAt);
    const thisMonth = issued.year === today.year && issued.month === today.month;

    if (SALE_TYPES.has(inv.type)) {
      if (thisMonth) {
        revenue[inv.currency] += revenueBase(inv);
        salesCount += 1;
      }
    } else if (CREDIT_NOTE_TYPES.has(inv.type)) {
      if (thisMonth) {
        revenue[inv.currency] -= revenueBase(inv);
        creditNoteCount += 1;
      }
      continue; // un avoir n'est pas une créance
    } else if (DEPOSIT_TYPES.has(inv.type)) {
      if (thisMonth) depositCount += 1;
    } else {
      continue;
    }

    // Créance déclarée : facture de vente ou d'acompte.
    const due = amountOf(inv.amountOnCredit) - (creditByOrigin.get(inv.id) ?? 0n);
    if (due <= 0n) continue;
    receivables[inv.currency] += due;
    if (nowMs - Date.parse(inv.issuedAt) > ageS4) {
      oldReceivables[inv.currency] += due;
      oldReceivableCount += 1;
    }
  }

  const values: Record<string, string> = {
    'factures_mois.nombre': String(salesCount),
    'avoirs_mois.nombre': String(creditNoteCount),
    'acomptes_mois.nombre': String(depositCount),
    'creances_anciennes.nombre': String(oldReceivableCount),
    'normalisation.echec': String(failed),
    'normalisation.a_verifier': String(toCheck),
    'normalisation.attente_longue': String(longPending),
    'proformas_anciennes.nombre': String(oldDrafts),
  };
  for (const c of BRIEF_CURRENCIES) {
    values[`ca_mois.${c}`] = formatSigned(revenue[c]);
    values[`creances.${c}`] = formatSigned(receivables[c]);
    values[`creances_anciennes.${c}`] = formatSigned(oldReceivables[c]);
  }

  return SALES_FACT_SKELETON.map((f) => ({
    ...f,
    status: 'known' as const,
    value: values[f.id] ?? null,
  }));
}

// ── Règles ───────────────────────────────────────────────────────────────────

interface RuleContext {
  fact(id: string): BriefFact | undefined;
  count(id: string): number;
  day: number;
}

interface RuleDefinition {
  id: string;
  rank: number;
  severity: BriefSeverity;
  /** Faits sans lesquels la règle ne peut pas être évaluée. */
  requires: readonly string[];
  threshold: BriefThreshold | null;
  evaluate(
    ctx: RuleContext,
  ): Omit<BriefRuleOutcome, 'ruleId' | 'rank' | 'severity' | 'threshold'> | null;
}

function plural(n: number, one: string, many: string): string {
  return n > 1 ? many : one;
}

/** Montants non nuls d'un fait par devise, rendus « 1 200,00 CDF et 50,00 USD ». */
function amountsText(ctx: RuleContext, prefix: string): { text: string; ids: string[] } {
  const parts: string[] = [];
  const ids: string[] = [];
  for (const c of BRIEF_CURRENCIES) {
    const f = ctx.fact(`${prefix}.${c}`);
    if (!f || f.value === null || /^-?0+(\.0+)?$/.test(f.value)) continue;
    parts.push(`${formatFr(f.value)} ${c}`);
    ids.push(f.id);
  }
  return { text: parts.join(' et '), ids };
}

export const MORNING_BRIEF_RULES: readonly RuleDefinition[] = Object.freeze([
  {
    id: 'normalisation_echec',
    rank: 1,
    severity: 'critique',
    requires: ['normalisation.echec'],
    threshold: MORNING_BRIEF_THRESHOLDS.S1,
    evaluate(ctx) {
      const n = ctx.count('normalisation.echec');
      if (n <= MORNING_BRIEF_THRESHOLDS.S1.value) return null;
      return {
        title: 'Factures en échec de normalisation',
        message: `${n} ${plural(n, 'facture est en échec', 'factures sont en échec')} de normalisation DGI.`,
        recommendation:
          'Ouvrir chaque facture en échec, lire le motif, la reprendre en brouillon, la corriger puis la normaliser de nouveau.',
        actionPath: '/ventes/factures?statut=normalization_failed',
        factIds: ['normalisation.echec'],
      };
    },
  },
  {
    id: 'normalisation_a_verifier',
    rank: 2,
    severity: 'critique',
    requires: ['normalisation.a_verifier'],
    threshold: MORNING_BRIEF_THRESHOLDS.S1,
    evaluate(ctx) {
      const n = ctx.count('normalisation.a_verifier');
      if (n <= MORNING_BRIEF_THRESHOLDS.S1.value) return null;
      return {
        title: 'Normalisations à vérifier',
        message: `${n} ${plural(n, 'facture attend', 'factures attendent')} une vérification de son état auprès de la DGI.`,
        recommendation:
          'Lancer « Vérifier » sur chaque facture concernée avant d’en émettre d’autres au même client.',
        actionPath: '/ventes/factures?statut=pending_normalization',
        factIds: ['normalisation.a_verifier'],
      };
    },
  },
  {
    id: 'normalisation_attente_longue',
    rank: 3,
    severity: 'attention',
    requires: ['normalisation.attente_longue'],
    threshold: MORNING_BRIEF_THRESHOLDS.S2,
    evaluate(ctx) {
      const n = ctx.count('normalisation.attente_longue');
      if (n <= 0) return null;
      return {
        title: 'Normalisations en attente',
        message: `${n} ${plural(n, 'facture attend', 'factures attendent')} sa normalisation depuis plus de ${MORNING_BRIEF_THRESHOLDS.S2.value} heures.`,
        recommendation: 'Relancer la normalisation des factures en attente.',
        actionPath: '/ventes/factures?statut=pending_normalization',
        factIds: ['normalisation.attente_longue'],
      };
    },
  },
  {
    id: 'creances_anciennes',
    rank: 4,
    severity: 'attention',
    requires: ['creances_anciennes.nombre'],
    threshold: MORNING_BRIEF_THRESHOLDS.S4,
    evaluate(ctx) {
      const n = ctx.count('creances_anciennes.nombre');
      if (n <= 0) return null;
      const amounts = amountsText(ctx, 'creances_anciennes');
      return {
        title: 'Créances anciennes',
        message:
          `${n} ${plural(n, 'facture à crédit a été émise', 'factures à crédit ont été émises')} il y a plus de ${MORNING_BRIEF_THRESHOLDS.S4.value} jours` +
          (amounts.text ? ` : ${amounts.text} déclarés à crédit.` : '.'),
        recommendation:
          'Relancer les clients concernés et noter les règlements déjà reçus (le suivi des encaissements arrive avec ADR-0031).',
        actionPath: '/ventes/factures?statut=final',
        factIds: ['creances_anciennes.nombre', ...amounts.ids],
      };
    },
  },
  {
    id: 'aucune_facture_du_mois',
    rank: 5,
    severity: 'attention',
    requires: ['factures_mois.nombre'],
    threshold: MORNING_BRIEF_THRESHOLDS.S6,
    evaluate(ctx) {
      if (ctx.count('factures_mois.nombre') > 0) return null;
      if (ctx.day < MORNING_BRIEF_THRESHOLDS.S6.value) return null;
      return {
        title: 'Aucune facture ce mois-ci',
        message: `Aucune facture de vente n’a été émise ce mois-ci, et le ${MORNING_BRIEF_THRESHOLDS.S6.value}ᵉ jour est passé.`,
        recommendation: 'Émettre les factures des ventes du mois.',
        actionPath: '/ventes/factures',
        factIds: ['factures_mois.nombre'],
      };
    },
  },
  {
    id: 'proformas_anciennes',
    rank: 6,
    severity: 'info',
    requires: ['proformas_anciennes.nombre'],
    threshold: MORNING_BRIEF_THRESHOLDS.S5,
    evaluate(ctx) {
      const n = ctx.count('proformas_anciennes.nombre');
      if (n <= 0) return null;
      return {
        title: 'Pro forma oubliées',
        message: `${n} ${plural(n, 'pro forma n’a pas été modifiée', 'pro forma n’ont pas été modifiées')} depuis plus de ${MORNING_BRIEF_THRESHOLDS.S5.value} jours.`,
        recommendation: 'Émettre ou supprimer les pro forma anciennes.',
        actionPath: '/ventes/factures?statut=draft',
        factIds: ['proformas_anciennes.nombre'],
      };
    },
  },
  {
    id: 'tresorerie_a_renseigner',
    rank: 7,
    severity: 'info',
    requires: [],
    threshold: null,
    evaluate(ctx) {
      if (ctx.fact('tresorerie')?.status !== 'to_fill') return null;
      return {
        title: 'Trésorerie inconnue',
        message: 'La trésorerie disponible n’est pas renseignée dans Lalanda.',
        recommendation:
          'Noter le solde de vos comptes et caisses : sans lui, Lalanda ne peut pas signaler un risque de trésorerie.',
        actionPath: '/organisation/brief',
        factIds: ['tresorerie'],
      };
    },
  },
] satisfies RuleDefinition[]);

const SEVERITY_ORDER: Record<BriefSeverity, number> = { critique: 0, attention: 1, info: 2 };

export function evaluateMorningBriefRules(
  facts: readonly BriefFact[],
  now: string,
): {
  triggered: BriefRuleOutcome[];
  skipped: BriefSkippedRule[];
} {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const ctx: RuleContext = {
    fact: (id) => byId.get(id),
    count: (id) => {
      const v = byId.get(id)?.value;
      return v === null || v === undefined ? 0 : Number.parseInt(v, 10);
    },
    day: kinshasaDay(now).day,
  };

  const triggered: BriefRuleOutcome[] = [];
  const skipped: BriefSkippedRule[] = [];
  for (const rule of MORNING_BRIEF_RULES) {
    const missing = rule.requires
      .map((id) => byId.get(id))
      .find((f) => f === undefined || f.status !== 'known');
    if (rule.requires.length > 0 && missing !== undefined) {
      skipped.push({
        ruleId: rule.id,
        reason: missing?.status === 'hidden' ? 'hidden' : 'unavailable',
      });
      continue;
    }
    const out = rule.evaluate(ctx);
    if (out === null) continue;
    triggered.push({
      ...out,
      ruleId: rule.id,
      rank: rule.rank,
      severity: rule.severity,
      threshold: rule.threshold,
    });
  }

  triggered.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.rank - b.rank,
  );
  return { triggered, skipped };
}

/** Faits, puis règles, puis coupe à trois (ADR-0033). */
export function buildMorningBrief(input: MorningBriefInput): MorningBrief {
  const facts = buildMorningBriefFacts(input);
  const { triggered, skipped } = evaluateMorningBriefRules(facts, input.now);
  const alerts = triggered.filter((r) => r.severity !== 'info');
  return {
    version: MORNING_BRIEF_VERSION,
    now: input.now,
    period: kinshasaDay(input.now),
    facts,
    alerts: alerts.slice(0, MORNING_BRIEF_TOP),
    recommendations: triggered.slice(0, MORNING_BRIEF_TOP),
    triggeredCount: triggered.length,
    alertCount: alerts.length,
    rulesSkipped: skipped,
    predictions: [],
    truncated: input.sales !== 'hidden' && input.sales.truncated,
  };
}
