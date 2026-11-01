// Proposition d'à-nouveaux de reprise à la bascule (ADR-0049 § 3.2, § 12
// `proposeCutoverOpening`).
//
// Lalanda PROPOSE, ne valide rien : soldes des comptes de trésorerie (sortie
// du moteur `treasury`, `computeAccountBalances` au jour qui précède la
// bascule), restes à encaisser par facture (moteur `receivables`), restes à
// payer par facture fournisseur. Capitaux propres, immobilisations, emprunts,
// stocks, dettes fiscales et sociales NE SONT PAS proposés : la proposition est
// donc déséquilibrée par nature, et le dit ; aucune ligne d'équilibre n'est
// inventée.
//
// Monnaie de tenue : même devise → taux 1 ; sinon taux SAISI pour le jour de
// la bascule exactement (jamais la veille, jamais une moyenne) ; sans taux, la
// ligne attend (`awaiting_rate`).

import { byString, centsOf, checkCurrency, checkDay, formatCents } from '../ledger/money.js';
import {
  ACCOUNTING_REPORTING_VERSION,
  type ReportingCurrency,
  type ReportingDay,
} from '../ledger/types.js';

export interface CutoverRate {
  date: ReportingDay;
  from: ReportingCurrency;
  to: ReportingCurrency;
  /** Décimal positif, dix décimales au plus : 1 `from` = `rate` `to`. */
  rate: string;
}

export interface CutoverOpeningInput {
  cutoverDate: ReportingDay;
  bookCurrency: ReportingCurrency;
  journalCode: string;
  suspenseAccountNumber: string;
  treasury: {
    /** Sortie de `computeAccountBalances` (champs lus : `accountId`, `currency`, `balance`). */
    balances: readonly { accountId: string; currency: string; balance: string }[];
    /** Compte de trésorerie → compte du plan (règle `{treasuryAccount}`), `null` si inconnu. */
    accountNumbers: Readonly<Record<string, string | null>>;
  };
  /** Restes à encaisser par facture (sortie `computeSettlement.outstanding`). */
  receivables: readonly CutoverDocument[];
  /** Restes à payer par facture fournisseur (`payableSettlement`). */
  payables: readonly CutoverDocument[];
  /** Comptes collectifs résolus par les règles ; `null` → compte d'attente. */
  collectiveAccounts: { customer: string | null; supplier: string | null };
  rates?: readonly CutoverRate[];
}

export interface CutoverDocument {
  documentId: string;
  documentNumber: string | null;
  partyName: string | null;
  /** Compte auxiliaire du tiers (créé à la première écriture qui le vise). */
  auxiliaryAccountNumber: string | null;
  currency: string;
  /** Reste dû, positif ; un reste nul n'est pas proposé. */
  outstanding: string;
}

export interface CutoverLine {
  kind: 'treasury' | 'receivable' | 'payable';
  accountNumber: string;
  auxiliaryAccountNumber: string | null;
  label: string;
  side: 'debit' | 'credit';
  currency: ReportingCurrency;
  /** Montant en devise de la pièce, positif. */
  amount: string;
  /** Montant en monnaie de tenue, `null` tant qu'aucun taux n'existe. */
  bookAmount: string | null;
  rate: string | null;
  rateSource: 'same_currency' | 'entered' | null;
  status: 'proposed' | 'awaiting_rate';
  documentRef: string | null;
  suspenseReason: 'NO_TREASURY_ACCOUNT' | 'NO_COLLECTIVE_ACCOUNT' | null;
  sourceId: string;
}

export interface CutoverOpening {
  version: string;
  proposal: true;
  journalCode: string;
  date: ReportingDay;
  lines: CutoverLine[];
  /** Débit − crédit des lignes chiffrées en monnaie de tenue. */
  bookImbalance: string;
  awaitingRateCount: number;
  /** Ce que Lalanda ne connaît pas et ne propose pas : vient de la dernière balance de l'expert. */
  notProposed: readonly string[];
  /** Toujours vrai : la contrepartie (capitaux propres…) est saisie par l'organisation. */
  counterpartRequired: true;
}

const NOT_PROPOSED = [
  'capitaux_propres',
  'immobilisations',
  'emprunts',
  'stocks',
  'dettes_fiscales_et_sociales',
] as const;

const RATE = /^(\d{1,12})(?:\.(\d{1,10}))?$/;
const RATE_SCALE = 10n ** 10n;

function rateOf(value: string): bigint {
  const m = RATE.exec(value);
  if (m === null) throw new RangeError(`Taux illisible ${JSON.stringify(value)}`);
  const r = BigInt(m[1] ?? '0') * RATE_SCALE + BigInt((m[2] ?? '').padEnd(10, '0'));
  if (r <= 0n) throw new RangeError('Taux strictement positif attendu');
  return r;
}

/** Arrondi au centime, demi vers le haut, du produit montant × taux. */
function convert(cents: bigint, rate: bigint): bigint {
  const num = cents * rate;
  const q = num / RATE_SCALE;
  return (num % RATE_SCALE) * 2n >= RATE_SCALE ? q + 1n : q;
}

export function proposeCutoverOpening(input: CutoverOpeningInput): CutoverOpening {
  checkDay(input.cutoverDate, 'Date de bascule');
  checkCurrency(input.bookCurrency, 'Monnaie de tenue');
  const rates = new Map<string, string>();
  for (const r of input.rates ?? []) {
    if (r.date !== input.cutoverDate || r.to !== input.bookCurrency) continue;
    rates.set(checkCurrency(r.from, 'Taux, devise'), r.rate);
  }
  const lines: CutoverLine[] = [];
  let imbalance = 0n;
  let awaiting = 0;

  const push = (
    base: Omit<CutoverLine, 'bookAmount' | 'rate' | 'rateSource' | 'status' | 'amount'>,
    cents: bigint,
  ): void => {
    let bookAmount: bigint | null = null;
    let rate: string | null = null;
    let rateSource: CutoverLine['rateSource'] = null;
    if (base.currency === input.bookCurrency) {
      bookAmount = cents;
      rate = '1';
      rateSource = 'same_currency';
    } else {
      const entered = rates.get(base.currency);
      if (entered !== undefined) {
        bookAmount = convert(cents, rateOf(entered));
        rate = entered;
        rateSource = 'entered';
      }
    }
    if (bookAmount === null) awaiting += 1;
    else imbalance += base.side === 'debit' ? bookAmount : -bookAmount;
    lines.push({
      ...base,
      amount: formatCents(cents),
      bookAmount: bookAmount === null ? null : formatCents(bookAmount),
      rate,
      rateSource,
      status: bookAmount === null ? 'awaiting_rate' : 'proposed',
    });
  };

  const balances = [...input.treasury.balances].sort((a, b) => byString(a.accountId, b.accountId));
  for (const b of balances) {
    const currency = checkCurrency(b.currency, `Trésorerie ${b.accountId}, devise`);
    const negative = b.balance.startsWith('-');
    const cents = centsOf(negative ? b.balance.slice(1) : b.balance, `Trésorerie ${b.accountId}`);
    if (cents === 0n) continue;
    const mapped = input.treasury.accountNumbers[b.accountId] ?? null;
    push(
      {
        kind: 'treasury',
        accountNumber: mapped ?? input.suspenseAccountNumber,
        auxiliaryAccountNumber: null,
        label: `Reprise — solde du compte de trésorerie ${b.accountId}`,
        side: negative ? 'credit' : 'debit',
        currency,
        documentRef: null,
        suspenseReason: mapped === null ? 'NO_TREASURY_ACCOUNT' : null,
        sourceId: b.accountId,
      },
      cents,
    );
  }

  const third = (
    kind: 'receivable' | 'payable',
    docs: readonly CutoverDocument[],
    collective: string | null,
  ): void => {
    for (const d of [...docs].sort((a, b) => byString(a.documentId, b.documentId))) {
      const currency = checkCurrency(d.currency, `Pièce ${d.documentId}, devise`);
      const cents = centsOf(d.outstanding, `Pièce ${d.documentId}, reste`);
      if (cents === 0n) continue;
      const ref = d.documentNumber ?? d.documentId;
      push(
        {
          kind,
          accountNumber: collective ?? input.suspenseAccountNumber,
          auxiliaryAccountNumber: collective === null ? null : d.auxiliaryAccountNumber,
          label:
            kind === 'receivable'
              ? `Reprise — reste à encaisser, facture ${ref}${d.partyName ? `, ${d.partyName}` : ''}`
              : `Reprise — reste à payer, facture ${ref}${d.partyName ? `, ${d.partyName}` : ''}`,
          side: kind === 'receivable' ? 'debit' : 'credit',
          currency,
          documentRef: d.documentId,
          suspenseReason: collective === null ? 'NO_COLLECTIVE_ACCOUNT' : null,
          sourceId: d.documentId,
        },
        cents,
      );
    }
  };
  third('receivable', input.receivables, input.collectiveAccounts.customer);
  third('payable', input.payables, input.collectiveAccounts.supplier);

  return {
    version: ACCOUNTING_REPORTING_VERSION,
    proposal: true,
    journalCode: input.journalCode,
    date: input.cutoverDate,
    lines,
    bookImbalance: formatCents(imbalance),
    awaitingRateCount: awaiting,
    notProposed: NOT_PROPOSED,
    counterpartRequired: true,
  };
}
