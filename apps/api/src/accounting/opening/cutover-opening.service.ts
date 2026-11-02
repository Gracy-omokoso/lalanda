// Reprise de l'existant : à-nouveaux de reprise à la bascule (ADR-0049 § 3.2, § 6.9, § 11).
// ADR-0049 — K7.
//
// 1. PROPOSITION (`accounting.read`, simulation ou actif ; rien n'est enregistré) : le moteur
//    `proposeCutoverOpening` reçoit les sorties des moteurs existants, jamais un calcul
//    parallèle :
//    - soldes des comptes de trésorerie au DÉBUT du jour de bascule (`computeAccountBalances`
//      sur le grand livre de la trésorerie, `TreasuryAccountsService.ledger`, mouvements
//      datés d'avant la bascule) ;
//    - restes à encaisser par facture (`computeSettlement`, avoirs et encaissements
//      antérieurs à la bascule) ;
//    - restes à payer par facture fournisseur (`payableSettlement`, ADR-0044, R3).
//    Ce qui ne se classe pas (compte de trésorerie non rattaché, collectif inconnu) va au
//    compte d'attente, avec son motif. Capitaux propres, immobilisations, emprunts, stocks,
//    dettes fiscales et sociales ne sont PAS proposés.
// 2. SAISIE (`accounting.post`, mode actif) : brouillon dans le journal `AN`, daté du jour de
//    bascule : lignes proposées (montants du moteur, une ligne écartée se retire, elle ne se
//    corrige pas) + contrepartie saisie. Équilibre exigé en monnaie de tenue ET dans chaque
//    devise (`checkEntry`) ; montants de tenue par `applyRate` (taux saisi du jour de bascule,
//    jamais un autre). Les créances et dettes reprises portent la pièce (`matchRef`) : un
//    encaissement ou un paiement postérieur se lettre avec elles (critère 13).
// 3. VALIDATION (`accounting.post`, séparation des tâches `manualEntryDecision`) : refusée si
//    un montant repris ne correspond plus aux moteurs (`OPENING_PROPOSAL_CHANGED`) ; numéro et
//    chaînage par `AccountingEntryStore.post` ; lettrage automatique ; audit strict.
//
// Aucune écriture dans les modules sources ni dans le réalisé : tout est LU.

import {
  ACCOUNTING_VERSION,
  applyRate,
  checkEntry,
  computeAccountBalances,
  computeSettlement,
  payableSettlement,
  proposeCutoverOpening,
  type AccountingCurrency,
  type CutoverDocument,
  type CutoverLine,
  type CutoverOpening,
  type DraftEntry,
  type DraftLine,
  type EntryLine,
  type ProposedEntry,
  type SuspenseReason,
} from '@lalanda/engine';
import {
  ACCOUNTING_DEFAULT_JOURNALS,
  type AccountingBookCurrency,
  type AccountingOpeningLaterAccountView,
  type AccountingOpeningProposalLineView,
  type AccountingOpeningProposalView,
  type AccountingOpeningStatusView,
  type CreateAccountingOpeningBody,
  type ValidateAccountingOpeningBody,
} from '@lalanda/shared/accounting';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { AuthzService } from '../../authz/authz.service.js';
import { manualEntryDecision } from '../../authz/permissions.js';
import { TreasuryAccountsService } from '../../treasury/treasury-accounts.service.js';
import {
  conflict,
  isDuplicateKey,
  notFound,
  staleRevision,
  type AccountingActor,
} from '../accounting.common.js';
import {
  AccountingAccount,
  type AccountingAccountLean,
} from '../chart/accounting-account.schema.js';
import { AccountingAccountsService } from '../chart/accounting-accounts.service.js';
import type { AccountingEntryLean, StoredEntryLine } from '../entries/accounting-entry.schema.js';
import {
  AccountingEntryStore,
  entryView,
  journalCodeOf,
  proposedOf,
  type NewEntryDoc,
} from '../entries/accounting-entry-store.service.js';
import { AccountingLetteringService } from '../lettering/accounting-lettering.service.js';
import { AccountingSettingsService } from '../settings/accounting-settings.service.js';
import type { AccountingSettingsLean } from '../settings/accounting-settings.schema.js';
import {
  ACCOUNTING_SUSPENSE_ACCOUNT,
  AccountingSyncService,
  type PostingState,
} from '../sync/accounting-sync.service.js';
import { OpeningSourcesReader } from './opening-sources.js';

const SUSPENSE_LABEL = 'Compte d’attente (technique, à désigner par l’expert-comptable)';
/** Clé de source d'une reprise : `opening:<bascule>:<rang>` (unique : l'idempotence). */
const OPENING_KEY = /^opening:\d{4}-\d{2}-\d{2}:\d+$/;
const OPENING_PREFIX = '^opening:';
const DEFAULT_OPENING_JOURNAL =
  ACCOUNTING_DEFAULT_JOURNALS.find((j) => j.kind === 'opening')?.code ?? 'AN';

/** Clé d'opération d'une ligne de reprise (jamais une clé de règle : aucun compte choisi). */
const KEY = {
  treasury: (accountId: string) => `opening.treasury.${accountId}`,
  receivable: 'opening.receivable',
  payable: 'opening.payable',
  counterpart: 'opening.counterpart',
} as const;

/** Motif d'attente du moteur de reprise → motif d'attente d'une ligne d'écriture. */
function suspenseOf(reason: CutoverLine['suspenseReason']): SuspenseReason | null {
  if (reason === 'NO_TREASURY_ACCOUNT') return 'NO_TREASURY_ACCOUNT';
  if (reason === 'NO_COLLECTIVE_ACCOUNT') return 'PARTY_ACCOUNT_UNKNOWN';
  return null;
}

/** Référence stable d'une ligne proposée (et de la ligne qu'elle devient). */
function refOf(line: Pick<CutoverLine, 'kind' | 'sourceId'>): string {
  return line.kind === 'treasury' ? `treasury:${line.sourceId}` : line.sourceId;
}
function storedRefOf(l: StoredEntryLine): string | null {
  if (l.operationKey.startsWith('opening.treasury.')) {
    return `treasury:${l.operationKey.slice('opening.treasury.'.length)}`;
  }
  if (l.operationKey === KEY.receivable || l.operationKey === KEY.payable) return l.matchRef;
  return null;
}

interface Computed {
  state: PostingState;
  settings: AccountingSettingsLean;
  journalCode: string;
  opening: CutoverOpening;
  provisional: Set<string>;
  names: Map<string, string>;
  later: AccountingOpeningLaterAccountView[];
  partyNames: Map<string, { name: string | null; number: string | null }>;
}

@Injectable()
export class CutoverOpeningService {
  constructor(
    @Inject(AccountingSettingsService) private readonly settings: AccountingSettingsService,
    @Inject(AccountingSyncService) private readonly sync: AccountingSyncService,
    @Inject(AccountingEntryStore) private readonly store: AccountingEntryStore,
    @Inject(AccountingAccountsService) private readonly accountsService: AccountingAccountsService,
    @Inject(AccountingLetteringService) private readonly lettering: AccountingLetteringService,
    @Inject(TreasuryAccountsService) private readonly treasury: TreasuryAccountsService,
    @Inject(OpeningSourcesReader) private readonly reader: OpeningSourcesReader,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(AuditService) private readonly audit: AuditService,
    @InjectModel(AccountingAccount.name) private readonly accounts: Model<AccountingAccountLean>,
  ) {}

  // ── Proposition ──────────────────────────────────────────────────────────

  /**
   * Auxiliaire de chaque tiers sous le collectif unique du pack, comme la synchronisation
   * (même compteur `aux:<collectif>`, même forme de numéro) : ceux qui existent ; les
   * autres, provisoires (`persist: false`) ou créés (`persist: true`, saisie en mode actif).
   */
  private async auxiliaries(
    state: PostingState,
    kind: 'customer' | 'supplier',
    parties: ReadonlyMap<string, string | null>,
    persist: boolean,
    actorUserId: string,
  ): Promise<{ numbers: Map<string, string>; provisional: Set<string> }> {
    const numbers = new Map<string, string>();
    const provisional = new Set<string>();
    const collective = state.collectives[kind];
    const ids = [...parties.keys()].filter((id) => /^[0-9a-f]{24}$/i.test(id)).sort();
    if (collective === null || !state.usesToken[kind] || ids.length === 0) {
      return { numbers, provisional };
    }
    const org = state.organizationId;
    const existing = await this.accounts
      .find({ organizationId: org, 'auxiliary.kind': kind, 'auxiliary.partyId': { $in: ids } })
      .sort({ _id: 1 })
      .lean<AccountingAccountLean[]>()
      .exec();
    for (const d of existing) {
      if (!numbers.has(d.auxiliary!.partyId)) numbers.set(d.auxiliary!.partyId, d.number);
    }
    const missing = ids.filter((id) => !numbers.has(id));
    if (!persist) {
      const taken = await this.accounts
        .countDocuments({ organizationId: org, collectiveNumber: collective })
        .exec();
      missing.forEach((id, i) => {
        const n = `${collective}${String(taken + i + 1).padStart(5, '0')}`;
        numbers.set(id, n);
        provisional.add(n);
      });
      return { numbers, provisional };
    }
    for (const partyId of missing) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const seq = await this.store.nextCounter(org, `aux:${collective}`);
        const number = `${collective}${String(seq).padStart(5, '0')}`;
        try {
          await this.accounts.create({
            organizationId: org,
            number,
            origin: 'organization',
            packAccountNumber: collective,
            label: (parties.get(partyId) ?? partyId).slice(0, 200),
            auxiliary: { kind, partyId },
            collectiveNumber: collective,
            active: true,
            revision: 1,
            createdBy: actorUserId,
            updatedBy: actorUserId,
            _schemaVersion: 1,
          });
          break;
        } catch (err) {
          if (!isDuplicateKey(err)) throw err;
        }
      }
      // Deux saisies simultanées (ou une synchronisation) : le plus ancien fait foi.
      const first = await this.accounts
        .findOne({ organizationId: org, 'auxiliary.kind': kind, 'auxiliary.partyId': partyId })
        .sort({ _id: 1 })
        .lean<AccountingAccountLean>()
        .exec();
      if (first) numbers.set(partyId, first.number);
    }
    return { numbers, provisional };
  }

  private async compute(
    organizationId: string,
    persistAuxiliaries: false | { actorUserId: string },
  ): Promise<Computed> {
    const settings = await this.settings.ensure(organizationId);
    const state = await this.sync.state(organizationId, settings);
    if (state === null) {
      conflict(
        'ACCOUNTING_OFF',
        'La comptabilité est éteinte : passez en simulation pour voir la proposition de reprise.',
      );
    }
    const cutover = state.cutoverDate;
    const journals = await this.store.journalsOf(organizationId);
    const journal = journalCodeOf(journals, { kind: 'opening', treasuryAccountId: null });
    const journalCode = journal?.code ?? DEFAULT_OPENING_JOURNAL;

    // Trésorerie : moteur `treasury`, mouvements datés d'AVANT le jour de bascule.
    const ledger = await this.treasury.ledger(organizationId);
    const before = ledger.movements.filter((m) => m.date < cutover);
    const balances = computeAccountBalances(ledger.accounts, before, cutover);
    const names = new Map(ledger.accounts.map((a) => [a.id, a.name]));
    const later = ledger.accounts
      .filter((a) => a.openingDate > cutover)
      .map((a) => ({
        treasuryAccountId: a.id,
        name: a.name,
        currency: a.currency,
        openingDate: a.openingDate,
        openingBalance: a.openingBalance,
      }));

    // Créances : moteur `receivables`, au début du jour de bascule.
    const sales = await this.reader.salesInvoices(organizationId, cutover);
    // Dettes : moteur `purchases` (R3, ADR-0044).
    const purchases = await this.reader.supplierInvoices(organizationId, cutover);

    const persist = persistAuxiliaries !== false;
    const actor = persistAuxiliaries === false ? 'system' : persistAuxiliaries.actorUserId;
    const customers = await this.auxiliaries(
      state,
      'customer',
      new Map(sales.flatMap((s) => (s.customerId ? [[s.customerId, s.customerName]] : []))),
      persist,
      actor,
    );
    const suppliers = await this.auxiliaries(
      state,
      'supplier',
      new Map(purchases.map((p) => [p.supplierId, p.supplierName])),
      persist,
      actor,
    );
    const partyNames = new Map<string, { name: string | null; number: string | null }>();
    const receivables: CutoverDocument[] = sales.map((s) => {
      const settlement = computeSettlement({
        amountOnCredit: s.amountOnCredit,
        creditNoteCredits: s.creditNoteCredits,
        allocations: s.allocations,
        dueDate: null,
        asOf: cutover,
      });
      const documentId = `sales_invoice:${s.id}`;
      partyNames.set(documentId, { name: s.customerName, number: s.number });
      return {
        documentId,
        documentNumber: s.number,
        partyName: s.customerName,
        auxiliaryAccountNumber: s.customerId ? (customers.numbers.get(s.customerId) ?? null) : null,
        currency: s.currency,
        outstanding: settlement.outstanding,
      };
    });
    const payables: CutoverDocument[] = purchases.map((p) => {
      const settlement = payableSettlement({ total: p.total }, p.allocations, p.creditNotes);
      const documentId = `supplier_invoice:${p.id}`;
      partyNames.set(documentId, { name: p.supplierName, number: p.number });
      return {
        documentId,
        documentNumber: p.number,
        partyName: p.supplierName,
        auxiliaryAccountNumber: suppliers.numbers.get(p.supplierId) ?? null,
        currency: p.currency,
        outstanding: settlement.remaining,
      };
    });

    const opening = proposeCutoverOpening({
      cutoverDate: cutover,
      bookCurrency: state.bookCurrency,
      journalCode,
      suspenseAccountNumber: state.suspenseAccount,
      treasury: {
        balances: balances.accounts,
        accountNumbers: state.links,
      },
      receivables,
      payables,
      collectiveAccounts: state.collectives,
      rates: state.rates.map((r) => ({ date: r.date, from: r.from, to: r.to, rate: r.rate })),
    });
    // Libellé lisible : le nom du compte de trésorerie plutôt que son identifiant.
    for (const l of opening.lines) {
      if (l.kind === 'treasury') {
        l.label = `Reprise — solde du compte de trésorerie « ${names.get(l.sourceId) ?? l.sourceId} »`;
      }
    }
    return {
      state,
      settings,
      journalCode,
      opening,
      provisional: new Set([...customers.provisional, ...suppliers.provisional]),
      names,
      later,
      partyNames,
    };
  }

  private async labels(organizationId: string): Promise<Map<string, string>> {
    const list = await this.accountsService.list(organizationId);
    const out = new Map(list.map((a) => [a.number, a.label]));
    out.set(ACCOUNTING_SUSPENSE_ACCOUNT, SUSPENSE_LABEL);
    return out;
  }

  /** Lignes proposées → lignes avant conversion (montants du moteur, inchangés). */
  private static draftLines(lines: readonly CutoverLine[]): DraftLine[] {
    return lines.map((l) => ({
      operationKey:
        l.kind === 'treasury'
          ? KEY.treasury(l.sourceId)
          : l.kind === 'receivable'
            ? KEY.receivable
            : KEY.payable,
      side: l.side,
      accountNumber: l.accountNumber,
      auxiliaryAccountNumber: l.auxiliaryAccountNumber,
      label: l.label,
      currency: l.currency,
      amount: l.amount,
      matchRef: l.kind === 'treasury' ? null : l.documentRef,
      suspenseReason: suspenseOf(l.suspenseReason),
    }));
  }

  /** Écriture en attente (sans montants de tenue) : totaux par devise par le moteur. */
  private static currencyCheck(
    lines: readonly DraftLine[],
    date: string,
    bookCurrency: AccountingCurrency,
  ): ReturnType<typeof checkEntry> {
    const entry: ProposedEntry = {
      sourceKey: 'opening:check',
      status: 'awaiting_rate',
      journal: { kind: 'opening', treasuryAccountId: null },
      date,
      bookCurrency,
      label: '',
      source: { kind: 'sales_invoice', id: '', event: '', number: null, date, partyName: null },
      lines: lines.map((l) => ({
        ...l,
        bookAmount: null,
        debit: null,
        credit: null,
        rate: null,
        rateSource: null,
        rateRef: null,
        letteringCode: null,
        exchangeDifference: false,
      })),
      reversalOf: null,
      reversalReason: null,
      generation: { ruleSetVersion: null, chartPack: null, engineVersion: ACCOUNTING_VERSION },
      suspense: lines.some((l) => l.suspenseReason !== null),
    };
    return checkEntry(entry);
  }

  /** Écarts entre une écriture de reprise et la proposition recalculée. */
  private static differences(
    entry: AccountingEntryLean | null,
    opening: CutoverOpening,
  ): AccountingOpeningStatusView['differences'] {
    if (entry === null) return { changed: [], missing: [] };
    const proposed = new Map(opening.lines.map((l) => [refOf(l), l]));
    const changed: string[] = [];
    const seen = new Set<string>();
    for (const l of entry.lines) {
      const ref = storedRefOf(l);
      if (ref === null) continue;
      seen.add(ref);
      const p = proposed.get(ref);
      if (
        p === undefined ||
        p.amount !== l.amount ||
        p.currency !== l.currency ||
        p.side !== l.side ||
        p.accountNumber !== l.accountNumber ||
        p.auxiliaryAccountNumber !== l.auxiliaryAccountNumber
      ) {
        changed.push(ref);
      }
    }
    const missing = [...proposed.keys()].filter((r) => !seen.has(r));
    return { changed: changed.sort(), missing: missing.sort() };
  }

  /** Écriture de reprise en cours : la plus récente, ni contre-passée ni contre-passation. */
  private async current(organizationId: string): Promise<AccountingEntryLean | null> {
    return this.store.entries
      .findOne({
        organizationId,
        journalKind: 'opening',
        sourceKey: { $regex: OPENING_PREFIX },
        reversalOf: null,
        reversedBy: null,
      })
      .sort({ _id: -1 })
      .lean<AccountingEntryLean>()
      .exec();
  }

  private static balanced(entry: AccountingEntryLean): boolean {
    const check = checkEntry(proposedOf(entry));
    return !check.issues.some(
      (i) => i.code === 'ENTRY_UNBALANCED' || i.code === 'ENTRY_UNBALANCED_IN_CURRENCY',
    );
  }

  private statusOf(
    entry: AccountingEntryLean | null,
    opening: CutoverOpening | null,
    labels: ReadonlyMap<string, string>,
  ): AccountingOpeningStatusView {
    if (entry === null) {
      return {
        state: 'none',
        validated: false,
        balanced: false,
        entry: null,
        differences: { changed: [], missing: [] },
      };
    }
    return {
      state: entry.status === 'posted' ? 'posted' : 'draft',
      validated: entry.status === 'posted',
      balanced: CutoverOpeningService.balanced(entry),
      entry: entryView(entry, labels),
      differences:
        opening === null
          ? { changed: [], missing: [] }
          : CutoverOpeningService.differences(entry, opening),
    };
  }

  /** `GET /accounting/opening/proposal`. */
  async proposal(organizationId: string): Promise<AccountingOpeningProposalView> {
    const c = await this.compute(organizationId, false);
    const labels = await this.labels(organizationId);
    const check = CutoverOpeningService.currencyCheck(
      CutoverOpeningService.draftLines(c.opening.lines),
      c.opening.date,
      c.state.bookCurrency,
    );
    const lines: AccountingOpeningProposalLineView[] = c.opening.lines.map((l) => ({
      ref: refOf(l),
      kind: l.kind,
      accountNumber: l.accountNumber,
      accountLabel: labels.get(l.accountNumber) ?? null,
      auxiliaryAccountNumber: l.auxiliaryAccountNumber,
      auxiliaryProvisional:
        l.auxiliaryAccountNumber !== null && c.provisional.has(l.auxiliaryAccountNumber),
      label: l.label,
      side: l.side,
      currency: l.currency,
      amount: l.amount,
      bookAmount: l.bookAmount,
      rate: l.rate,
      rateSource: l.rateSource,
      status: l.status,
      documentNumber: l.kind === 'treasury' ? null : (c.partyNames.get(l.sourceId)?.number ?? null),
      partyName:
        l.kind === 'treasury'
          ? (c.names.get(l.sourceId) ?? null)
          : (c.partyNames.get(l.sourceId)?.name ?? null),
      suspenseReason: l.suspenseReason,
    }));
    const current = await this.current(organizationId);
    return {
      proposal: true,
      mode: c.state.mode,
      simulation: c.state.mode === 'simulation',
      cutoverDate: c.opening.date,
      asOfStartOf: c.opening.date,
      bookCurrency: c.state.bookCurrency,
      journalCode: c.journalCode,
      lines,
      bookImbalance: c.opening.bookImbalance,
      currencyTotals: check.currencyTotals as AccountingOpeningProposalView['currencyTotals'],
      awaitingRateCount: c.opening.awaitingRateCount,
      notProposed: c.opening.notProposed,
      counterpartRequired: true,
      laterTreasuryAccounts: c.later,
      engineVersion: c.opening.version,
      current: this.statusOf(current, c.opening, labels),
    };
  }

  /** `GET /accounting/opening` : état de la reprise (écriture en cours, écarts). */
  async status(organizationId: string): Promise<AccountingOpeningStatusView> {
    const settings = await this.settings.ensure(organizationId);
    const entry = await this.current(organizationId);
    const labels = await this.labels(organizationId);
    const opening =
      entry !== null && settings.mode !== 'off'
        ? (await this.compute(organizationId, false)).opening
        : null;
    return this.statusOf(entry, opening, labels);
  }

  /**
   * Entrée de la réserve `OPENING_INCOMPLETE` (§ 6.10, `computeReserves`) : point
   * d'extension du lot K6. Validée = écriture de reprise `posted` non contre-passée.
   */
  async reserveInput(organizationId: string): Promise<{ validated: boolean; balanced: boolean }> {
    const entry = await this.current(organizationId);
    if (entry === null) return { validated: false, balanced: false };
    return {
      validated: entry.status === 'posted',
      balanced: CutoverOpeningService.balanced(entry),
    };
  }

  // ── Saisie ───────────────────────────────────────────────────────────────

  private async activeSettings(organizationId: string): Promise<AccountingSettingsLean> {
    const s = await this.settings.ensure(organizationId);
    if (s.mode !== 'active' || s.bookCurrency === null || s.cutoverDate === null) {
      conflict(
        'ACCOUNTING_NOT_ACTIVE',
        'La reprise ne s’enregistre qu’en mode actif : en simulation, elle est seulement proposée.',
      );
    }
    return s;
  }

  /** `POST /accounting/opening` : brouillon d'à-nouveaux de reprise (journal `AN`). */
  async create(
    organizationId: string,
    body: CreateAccountingOpeningBody,
    actor: AccountingActor,
  ): Promise<AccountingOpeningStatusView> {
    await this.activeSettings(organizationId);
    const existing = await this.current(organizationId);
    if (existing !== null) {
      conflict(
        'OPENING_ALREADY_EXISTS',
        existing.status === 'posted'
          ? 'La reprise est déjà validée : contre-passez-la pour la refaire.'
          : 'Une reprise est déjà en brouillon : validez-la ou supprimez-la.',
        { entryId: String(existing._id), status: existing.status },
      );
    }
    const c = await this.compute(organizationId, { actorUserId: actor.userId });
    const journals = await this.store.journalsOf(organizationId);
    const journal = journalCodeOf(journals, { kind: 'opening', treasuryAccountId: null });
    if (!journal) notFound('JOURNAL_NOT_FOUND', 'Journal d’à-nouveaux introuvable.');
    const cutover = c.opening.date;
    const bookCurrency = c.state.bookCurrency;

    const exclude = new Set(body.exclude ?? []);
    const refs = new Set(c.opening.lines.map((l) => refOf(l)));
    const unknown = [...exclude].filter((r) => !refs.has(r));
    if (unknown.length > 0) {
      conflict('OPENING_UNKNOWN_PROPOSAL_LINE', 'Ligne proposée inconnue.', { refs: unknown });
    }
    const kept = c.opening.lines.filter((l) => !exclude.has(refOf(l)));

    // Contrepartie saisie : comptes du plan (ou compte d'attente), auxiliaire rattaché.
    const plan = await this.accountsService.activeNumbers(organizationId);
    const auxNumbers = body.lines
      .map((l) => l.auxiliaryAccountNumber)
      .filter((v): v is string => typeof v === 'string');
    const aux = await this.accounts
      .find({ organizationId, number: { $in: auxNumbers }, auxiliary: { $ne: null } })
      .lean<AccountingAccountLean[]>()
      .exec();
    const label = body.label ?? 'À-nouveaux de reprise';
    const counterpart: DraftLine[] = body.lines.map((l, i) => {
      if (l.accountNumber !== c.state.suspenseAccount && !plan.has(l.accountNumber)) {
        conflict(
          'ACCOUNT_NOT_IN_PLAN',
          `Ligne ${i + 1} : ce compte n’est pas un compte actif du plan.`,
          {
            line: i,
            accountNumber: l.accountNumber,
          },
        );
      }
      const auxNumber = l.auxiliaryAccountNumber ?? null;
      if (auxNumber !== null) {
        const a = aux.find((x) => x.number === auxNumber);
        if (!a || !a.active || a.collectiveNumber !== l.accountNumber) {
          conflict(
            'ACCOUNT_NOT_IN_PLAN',
            `Ligne ${i + 1} : ce compte auxiliaire n’est pas rattaché à ce compte collectif.`,
            { line: i, auxiliaryAccountNumber: auxNumber },
          );
        }
      }
      return {
        operationKey: KEY.counterpart,
        side: l.debit !== undefined ? 'debit' : 'credit',
        accountNumber: l.accountNumber,
        auxiliaryAccountNumber: auxNumber,
        label: l.label ?? label,
        currency: l.currency ?? bookCurrency,
        amount: (l.debit ?? l.credit)!,
        matchRef: null,
        suspenseReason: null,
      };
    });

    const drafts = [...CutoverOpeningService.draftLines(kept), ...counterpart];
    if (drafts.length === 0) {
      conflict('OPENING_EMPTY', 'Rien à reprendre : ajoutez au moins une ligne.');
    }
    // Équilibre dans chaque devise de pièce, avant toute conversion.
    const perCurrency = CutoverOpeningService.currencyCheck(drafts, cutover, bookCurrency);
    if (
      perCurrency.issues.some(
        (i) => i.code === 'ENTRY_UNBALANCED_IN_CURRENCY' || i.code === 'ENTRY_NO_LINES',
      )
    ) {
      conflict(
        'ENTRY_UNBALANCED',
        'Les débits et les crédits ne s’équilibrent pas dans chaque devise : complétez la contrepartie.',
        { currencyTotals: perCurrency.currencyTotals },
      );
    }

    // Monnaie de tenue : `applyRate` par devise (taux saisi du jour de bascule seulement).
    const generation = {
      ruleSetVersion: c.state.ruleSet?.version ?? null,
      chartPack: c.state.chartPack,
      engineVersion: ACCOUNTING_VERSION,
    };
    const converted: EntryLine[] = new Array<EntryLine>(drafts.length);
    const missingRates: AccountingBookCurrency[] = [];
    for (const currency of [...new Set(drafts.map((d) => d.currency))].sort()) {
      const indexes = drafts
        .map((d, i) => (d.currency === currency ? i : -1))
        .filter((i) => i >= 0);
      const draft: DraftEntry = {
        sourceKey: 'opening',
        journal: { kind: 'opening', treasuryAccountId: null },
        date: cutover,
        label,
        source: {
          kind: 'sales_invoice',
          id: '',
          event: '',
          number: null,
          date: cutover,
          partyName: null,
        },
        lines: indexes.map((i) => drafts[i]!),
        reversalOf: null,
        reversalReason: null,
        generation,
      };
      const out = applyRate(draft, {
        bookCurrency,
        enteredRates: c.state.rates,
        ruleSet: c.state.ruleSet,
        suspenseAccount: c.state.suspenseAccount,
      });
      if (out.status === 'awaiting_rate') {
        missingRates.push(currency);
        continue;
      }
      indexes.forEach((idx, k) => {
        converted[idx] = out.lines[k]!;
      });
    }
    if (missingRates.length > 0) {
      conflict(
        'OPENING_RATE_MISSING',
        `Saisissez le taux du ${cutover} vers ${bookCurrency} (aucun autre taux n’est employé), ou écartez ces lignes.`,
        { date: cutover, currencies: missingRates, to: bookCurrency },
      );
    }
    const lines: StoredEntryLine[] = converted.map((l) => ({ ...l }));
    const final = CutoverOpeningService.readyEntry(lines, cutover, bookCurrency, label);
    const check = checkEntry(final, {
      chartAccounts: [...plan],
      suspenseAccount: c.state.suspenseAccount,
    });
    if (!check.ok) {
      const unbalanced = check.issues.some(
        (i) => i.code === 'ENTRY_UNBALANCED' || i.code === 'ENTRY_UNBALANCED_IN_CURRENCY',
      );
      conflict(
        unbalanced ? 'ENTRY_UNBALANCED' : 'ENTRY_INVALID',
        unbalanced ? 'Les débits et les crédits ne s’équilibrent pas.' : 'Écriture invalide.',
        { issues: check.issues, totals: check.bookTotals, currencyTotals: check.currencyTotals },
      );
    }

    const rank =
      (await this.store.entries
        .countDocuments({ organizationId, sourceKey: { $regex: OPENING_KEY.source } })
        .exec()) + 1;
    const id = new Types.ObjectId();
    const doc: NewEntryDoc & { _id: Types.ObjectId } = {
      _id: id,
      organizationId,
      journalCode: journal.code,
      journalKind: 'opening',
      date: cutover,
      status: 'draft',
      bookCurrency,
      label,
      source: null,
      sourceKey: `opening:${cutover}:${rank}`,
      keyed: true,
      lines,
      reversalOf: null,
      reversalOfKey: null,
      reversalReason: null,
      generation,
      manual: {
        authorId: actor.userId,
        validatorId: null,
        soleApprover: false,
        attachmentKey: null,
        reason: body.reason,
      },
      regeneration: null,
      suspense: lines.some(
        (l) =>
          l.accountNumber === ACCOUNTING_SUSPENSE_ACCOUNT ||
          l.accountNumber === c.state.suspenseAccount,
      ),
      createdBy: actor.userId,
      updatedBy: actor.userId,
    };
    const created = await this.store.insertUnposted(organizationId, doc);
    if (created === null) {
      conflict('OPENING_ALREADY_EXISTS', 'Une reprise vient d’être saisie : rechargez.');
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.opening_drafted',
      targetType: 'accounting_entry',
      targetId: id.toHexString(),
      metadata: {
        cutoverDate: cutover,
        proposedLines: kept.length,
        excluded: exclude.size,
        counterpartLines: counterpart.length,
      },
    });
    return this.statusOf(created, c.opening, await this.labels(organizationId));
  }

  private static readyEntry(
    lines: readonly StoredEntryLine[],
    date: string,
    bookCurrency: AccountingCurrency,
    label: string,
  ): ProposedEntry {
    return {
      sourceKey: 'opening',
      status: 'ready',
      journal: { kind: 'opening', treasuryAccountId: null },
      date,
      bookCurrency,
      label,
      source: { kind: 'sales_invoice', id: '', event: '', number: null, date, partyName: null },
      lines: lines.map((l) => ({ ...l })),
      reversalOf: null,
      reversalReason: null,
      generation: { ruleSetVersion: null, chartPack: null, engineVersion: ACCOUNTING_VERSION },
      suspense: lines.some((l) => l.suspenseReason !== null),
    };
  }

  // ── Validation ───────────────────────────────────────────────────────────

  /** `POST /accounting/opening/:id/validate` : séparation des tâches, numéro, chaînage. */
  async validate(
    organizationId: string,
    id: string,
    body: ValidateAccountingOpeningBody,
    actor: AccountingActor,
  ): Promise<AccountingOpeningStatusView> {
    await this.activeSettings(organizationId);
    if (!/^[0-9a-f]{24}$/i.test(id)) notFound('OPENING_NOT_FOUND', 'Reprise introuvable.');
    const current = await this.store.entries
      .findOne({ _id: id, organizationId, sourceKey: { $regex: OPENING_PREFIX } })
      .lean<AccountingEntryLean>()
      .exec();
    if (!current || current.manual === null) {
      notFound('OPENING_NOT_FOUND', 'Reprise introuvable.');
    }
    const decision = manualEntryDecision({
      status: current.status,
      validatorUserId: actor.userId,
      authorUserId: current.manual.authorId,
      approverCountInOrg: await this.authz.countApprovers(organizationId, 'accounting.post'),
    });
    if (!decision.ok) {
      conflict(
        decision.code,
        decision.code === 'ENTRY_NOT_DRAFT'
          ? 'Cette reprise est déjà validée : elle ne se valide plus, elle se contre-passe.'
          : 'Vous avez saisi cette reprise : une autre personne autorisée doit la valider.',
      );
    }
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const period = await this.store.periodOf(organizationId, current.date);
    if (period === null || period.status !== 'open') {
      conflict('ACCOUNTING_PERIOD_CLOSED', 'Le mois du jour de bascule n’est pas ouvert.');
    }
    const c = await this.compute(organizationId, false);
    const differences = CutoverOpeningService.differences(current, c.opening);
    if (differences.changed.length > 0) {
      conflict(
        'OPENING_PROPOSAL_CHANGED',
        'Des montants repris ne correspondent plus aux pièces : supprimez ce brouillon et saisissez la reprise à nouveau.',
        { changed: differences.changed },
      );
    }
    const stored = proposedOf(current);
    // Une contrepartie saisie au compte d'attente n'a pas de motif : l'indicateur d'attente
    // enregistré (toute ligne au compte d'attente, comme les opérations diverses) n'est pas
    // celui que contrôle le moteur (lignes portant un motif).
    stored.suspense = stored.lines.some((l) => l.suspenseReason !== null);
    const check = checkEntry(stored, {
      chartAccounts: [...(await this.accountsService.activeNumbers(organizationId))],
      suspenseAccount: c.state.suspenseAccount,
    });
    if (!check.ok) {
      conflict('ENTRY_UNBALANCED', 'La reprise n’est plus valide : saisissez-la à nouveau.', {
        issues: check.issues,
      });
    }
    const posted = await this.store.post(
      organizationId,
      {
        existingId: id,
        expectedRevision: current.revision,
        patch: {
          manual: {
            ...current.manual,
            validatorId: actor.userId,
            soleApprover: decision.soleApprover,
          },
        },
      },
      period.fiscalYear,
      actor.userId,
    );
    // Un encaissement ou un paiement postérieur déjà comptabilisé se lettre maintenant.
    await this.lettering.autoLetter(
      organizationId,
      posted!.lines.map((l) => l.matchRef).filter((r): r is string => r !== null),
    );
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.opening_validated',
      targetType: 'accounting_entry',
      targetId: id,
      metadata: {
        journalCode: posted!.journalCode,
        fiscalYear: posted!.fiscalYear,
        number: posted!.number,
        soleApprover: decision.soleApprover,
        cutoverDate: posted!.date,
      },
    });
    const fresh = await this.store.entries
      .findOne({ _id: id, organizationId })
      .lean<AccountingEntryLean>()
      .exec();
    return this.statusOf(fresh, c.opening, await this.labels(organizationId));
  }
}
