// Conditions en vigueur, termes, date limite de préavis et comparaison du
// préavis (ADR-0050 § 2.3, § 2.5, § 5.3, § 7).
//
// Conventions de date (fixées par les tests et rappelées à l'écran ; leur
// valeur juridique reste la question JU1) :
// - fin d'un terme = VEILLE de l'anniversaire : un contrat du 15 janv. 2027 de
//   12 mois finit le 14 janv. 2028 ; l'anniversaire garde le quantième du début,
//   ramené au dernier jour du mois (règle d'`occurrencesOf`, ADR-0034 § 3) ;
// - date limite de préavis = fin du terme − `noticeDays` jours civils ;
// - date d'effet d'une résiliation = dernier jour couvert (inclus).
//
// La reconduction tacite est seulement PROPOSÉE : un humain la constate
// (`renewals`) ; sans ce constat, rien n'est facturable au-delà du terme.

import {
  addDays,
  anniversary,
  checkDay,
  checkInt,
  compareDays,
  dayNumber,
  dayOfMonth,
  minDay,
} from './common.js';
import {
  CONTRACTS_VERSION,
  RENEWAL_MODES,
  type AmendmentInput,
  type ContractDay,
  type ContractDerivedStatus,
  type ContractInput,
  type ContractTerm,
  type ContractTermsContent,
  type ContractTermsIssue,
  type ContractTermsOptions,
  type ContractTermsResult,
  type NoticeCheckResult,
  type RecordedRenewal,
  type TermsAtResult,
  type TerminationInput,
} from './types.js';

const MODIFIABLE_FIELDS = [
  'lines',
  'billing',
  'initialTermMonths',
  'renewal',
  'noticeDays',
  'clauses',
] as const satisfies readonly (keyof ContractTermsContent)[];

function contentOf<L>(contract: ContractInput<L>): ContractTermsContent<L> {
  return {
    lines: contract.lines,
    billing: contract.billing,
    initialTermMonths: contract.initialTermMonths,
    renewal: contract.renewal,
    noticeDays: contract.noticeDays,
    clauses: contract.clauses,
  };
}

/**
 * Conditions en vigueur à `date` (§ 2.5) : le contrat, puis chaque avenant
 * `signed` dont la date d'effet est atteinte, DANS L'ORDRE DES INDEX (pas des
 * dates). Un avenant non signé n'a aucun effet.
 */
export function termsAt<L>(
  contract: ContractInput<L>,
  amendments: readonly AmendmentInput<L>[],
  date: ContractDay,
): TermsAtResult<L> {
  checkDay(date, 'Date');
  checkDay(contract.startDate, 'Début du contrat');
  const seen = new Set<number>();
  for (const a of amendments) {
    checkInt(a.index, 1, Number.MAX_SAFE_INTEGER, 'Index d’avenant');
    if (seen.has(a.index)) throw new RangeError(`Avenant n° ${a.index} en double`);
    seen.add(a.index);
    checkDay(a.effectiveDate, `Avenant n° ${a.index} : date d’effet`);
  }
  const ordered = [...amendments].sort((a, b) => a.index - b.index);
  const terms = contentOf(contract);
  const applied: number[] = [];
  const pending: number[] = [];
  for (const a of ordered) {
    if (compareDays(a.effectiveDate, date) > 0) continue;
    if (a.status === 'signed') {
      for (const field of MODIFIABLE_FIELDS) {
        if (a.changes[field] !== undefined) {
          (terms as unknown as Record<string, unknown>)[field] = a.changes[field];
        }
      }
      applied.push(a.index);
    } else if (a.status !== 'cancelled') {
      pending.push(a.index);
    }
  }
  return {
    version: CONTRACTS_VERSION,
    date,
    terms,
    appliedAmendments: applied,
    pendingAmendments: pending,
  };
}

/** Dernier jour d'un terme de `months` mois commençant à `from` (veille de l'anniversaire). */
function termEnd(from: ContractDay, months: number, anchorDay: number): ContractDay {
  return addDays(anniversary(from, months, anchorDay), -1);
}

/**
 * Terme en cours, fin, date limite de préavis, statut dérivé et terme suivant
 * proposé (§ 7). Les clauses de durée, de reconduction et de préavis sont celles
 * EN VIGUEUR à `today` (`termsAt`).
 */
export function contractTerms<L>(
  contract: ContractInput<L>,
  amendments: readonly AmendmentInput<L>[],
  renewals: readonly RecordedRenewal[],
  termination: TerminationInput | null,
  today: ContractDay,
  options: ContractTermsOptions = {},
): ContractTermsResult {
  const { terms } = termsAt(contract, amendments, today);
  const alertDays = checkInt(options.termEndAlertDays ?? 60, 0, 365, 'Alerte de fin de terme');
  const initial =
    terms.initialTermMonths === null
      ? null
      : checkInt(terms.initialTermMonths, 1, 120, 'Durée du premier terme');
  const noticeDays = checkInt(terms.noticeDays, 0, 365, 'Préavis');
  const { renewal } = terms;
  if (!(RENEWAL_MODES as readonly string[]).includes(renewal.mode)) {
    throw new RangeError(`Mode de reconduction inconnu ${JSON.stringify(renewal.mode)}`);
  }
  const period =
    renewal.periodMonths === null
      ? null
      : checkInt(renewal.periodMonths, 1, 60, 'Durée de reconduction');
  const maxRenewals =
    renewal.maxRenewals === null
      ? null
      : checkInt(renewal.maxRenewals, 0, Number.MAX_SAFE_INTEGER, 'Reconductions au plus');
  if (termination !== null) {
    checkDay(termination.noticeGivenOn, 'Résiliation : notification');
    checkDay(termination.effectiveOn, 'Résiliation : date d’effet');
  }

  const start = contract.startDate;
  const anchorDay = dayOfMonth(start);
  const issues: ContractTermsIssue[] = [];

  // Chaîne des termes : initial, puis reconductions enregistrées et contiguës.
  const chain: ContractTerm[] = [
    {
      index: 0,
      from: start,
      to: initial === null ? null : termEnd(start, initial, anchorDay),
      origin: 'initial',
    },
  ];
  const sorted = [...renewals].sort((a, b) => a.termIndex - b.termIndex);
  for (const r of sorted) {
    const prev = chain[chain.length - 1] as ContractTerm;
    const coherent =
      r.termIndex === prev.index + 1 &&
      prev.to !== null &&
      checkDay(r.from, 'Reconduction : début') === addDays(prev.to, 1) &&
      compareDays(checkDay(r.to, 'Reconduction : fin'), r.from) >= 0;
    if (!coherent) {
      issues.push({ code: 'RENEWAL_INCOHERENT', termIndex: r.termIndex });
      break;
    }
    chain.push({ index: r.termIndex, from: r.from, to: r.to, origin: r.mode });
  }
  const recorded = chain.length - 1;
  if (maxRenewals !== null && recorded > maxRenewals) {
    issues.push({ code: 'RENEWALS_ABOVE_MAXIMUM', termIndex: recorded });
  }
  const last = chain[chain.length - 1] as ContractTerm;

  // Terme suivant proposé : reconduction tacite seulement, jamais appliquée.
  let proposed: ContractTerm | null = null;
  if (
    renewal.mode === 'tacit' &&
    last.to !== null &&
    termination === null &&
    (maxRenewals === null || recorded < maxRenewals)
  ) {
    if (period === null) {
      issues.push({ code: 'RENEWAL_PERIOD_MISSING', termIndex: last.index + 1 });
    } else {
      const from = addDays(last.to, 1);
      proposed = {
        index: last.index + 1,
        from,
        to: termEnd(from, period, anchorDay),
        origin: 'tacit_recorded',
      };
    }
  }

  const t = dayNumber(checkDay(today, 'Date du jour'));
  const current =
    t < dayNumber(start)
      ? (chain[0] as ContractTerm)
      : (chain.find((c) => dayNumber(c.from) <= t && (c.to === null || t <= dayNumber(c.to))) ??
        last);
  const termElapsed = last.to !== null && t > dayNumber(last.to);

  let billableUntil = last.to;
  if (termination !== null) {
    billableUntil =
      billableUntil === null
        ? termination.effectiveOn
        : minDay(billableUntil, termination.effectiveOn);
  }

  const stored = contract.status ?? 'signed';
  let status: ContractDerivedStatus;
  if (stored !== 'signed') status = stored;
  else if (t < dayNumber(start)) status = 'upcoming';
  else if (termElapsed) status = proposed !== null ? 'expiring' : 'ended';
  else if (last.to !== null && dayNumber(last.to) - t <= alertDays) status = 'expiring';
  else status = 'in_force';

  return {
    version: CONTRACTS_VERSION,
    today,
    status,
    terms: chain,
    currentTerm: current,
    termElapsed,
    lastTermEnd: last.to,
    noticeDeadline: current.to === null ? null : addDays(current.to, -noticeDays),
    proposedNextTerm: proposed,
    billableUntil,
    renewalsRecorded: recorded,
    issues,
  };
}

/**
 * Compare une résiliation à la CLAUSE SAISIE (§ 2.3) : jours civils entre la
 * notification et la date d'effet, contre `noticeDays`. Jamais un refus, jamais
 * un jugement de validité juridique.
 */
export function noticeCheck(
  noticeGivenOn: ContractDay,
  effectiveOn: ContractDay,
  noticeDays: number,
): NoticeCheckResult {
  checkDay(noticeGivenOn, 'Notification');
  checkDay(effectiveOn, 'Date d’effet');
  checkInt(noticeDays, 0, 365, 'Préavis');
  const daysGiven = dayNumber(effectiveOn) - dayNumber(noticeGivenOn);
  return {
    version: CONTRACTS_VERSION,
    noticeGivenOn,
    effectiveOn,
    noticeDays,
    daysGiven,
    latestNoticeDate: addDays(effectiveOn, -noticeDays),
    result: daysGiven >= noticeDays ? 'meets_clause' : 'below_clause',
  };
}
