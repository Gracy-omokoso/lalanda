// Synchronisation `accounting.sync` (ADR-0049 O3, § 3.1, § 4, § 6). ADR-0049 — K5.
//
// Lecture APRÈS COUP des pièces du RUN, en lecture seule, et génération des écritures par
// le moteur (`entriesFor…`, `syncSourceEntries`), IDEMPOTENTE par clé de source :
//
// - `off`        : rien n'est lu, rien n'est calculé, rien n'est écrit ;
// - `simulation` : tout est calculé à la volée, RIEN n'est enregistré (ni écriture, ni
//                  numéro, ni « À comptabiliser », ni compte auxiliaire) ;
// - `active`     : écritures enregistrées, validées (numéro, chaînage) sous les règles
//                  validées, ou `awaiting_rate` sans taux ; « À comptabiliser » tenu.
//
// Une clé déjà présente n'est jamais réécrite : rejouer ne crée rien de plus (critère 3),
// et changer une règle n'altère aucune écriture passée (§ 2.4). Une pièce annulée ou
// révisée voit son écriture contre-passée ; si le mois de l'écriture d'origine est clos,
// la contre-passation va au premier jour ouvert, avec le motif
// `SOURCE_CHANGED_IN_CLOSED_PERIOD` (§ 4, décision ouverte n° 10). Tout ce qu'aucune
// règle validée ne classe va au compte d'attente, avec son motif (§ 6.0).

import {
  entriesForExpense,
  entriesForReceipt,
  entriesForSalesInvoice,
  entriesForSupplierInvoice,
  entriesForSupplierPayment,
  entriesForTreasuryMovement,
  reverseEntry,
  syncSourceEntries,
  type AccountingCurrency,
  type AuxiliaryAccount,
  type EnteredRate,
  type MappingRuleSet,
  type PostingContext,
  type PostingResult,
  type ProposedEntry,
  type SettlementAllocationView,
  type SourceKind,
} from '@lalanda/engine';
import {
  ACCOUNTING_SIMULATION_SUSPENSE_ACCOUNT,
  ACCOUNTING_SYNC_SOURCES,
  type AccountingBookCurrency,
  type AccountingMode,
  type AccountingPendingReason,
  type AccountingRegenerationView,
  type AccountingSyncResult,
  type AccountingSyncSource,
  type AccountingTreasuryLinkView,
  type PutAccountingTreasuryLinkBody,
} from '@lalanda/shared/accounting';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
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
import type { AccountingEntryLean } from '../entries/accounting-entry.schema.js';
import {
  AccountingEntryStore,
  journalCodeOf,
  proposedOf,
  type NewEntryDoc,
} from '../entries/accounting-entry-store.service.js';
import type { AccountingJournalLean } from '../journals/accounting-journal.schema.js';
import { AccountingLetteringService } from '../lettering/accounting-lettering.service.js';
import {
  AccountingPendingService,
  pendingReasonOf,
  type PendingSource,
} from '../pending/accounting-pending.service.js';
import { AccountingPeriod, type AccountingPeriodLean } from '../periods/accounting-period.schema.js';
import {
  AccountingExchangeRate,
  type AccountingExchangeRateLean,
} from '../rates/accounting-exchange-rate.schema.js';
import {
  AccountingRuleSet,
  type AccountingRuleSetLean,
} from '../rules/accounting-rule-set.schema.js';
import { AccountingSettingsService } from '../settings/accounting-settings.service.js';
import {
  AccountingSettings,
  type AccountingSettingsLean,
} from '../settings/accounting-settings.schema.js';
import {
  AccountingSourcesService,
  type SourceDoc,
  type SourceScope,
} from '../sources/accounting-sources.service.js';
import {
  expenseView,
  receiptView,
  salesInvoiceView,
  supplierInvoiceView,
  supplierPaymentView,
  treasuryMovementView,
} from '../sources/source-views.js';
import {
  AccountingSyncCheckpoint,
  AccountingTreasuryLink,
  type AccountingSyncCheckpointLean,
  type AccountingTreasuryLinkLean,
} from './accounting-sync.schema.js';

/**
 * Compte d'attente (§ 6.0). Le pack ne désigne pas encore « le » compte de la classe 47
 * (numéro à fournir par l'expert, ADR-0049 § 2.1.1) : le compte technique `ATTENTE` est
 * employé, signalé comme tel, dans les deux modes, jusqu'à ce que le pack le désigne.
 */
export const ACCOUNTING_SUSPENSE_ACCOUNT = ACCOUNTING_SIMULATION_SUSPENSE_ACCOUNT;

/**
 * Taux saisi (dix décimales au plus, K4) → forme lue par le moteur (huit au plus, K2) :
 * zéros de queue retirés, sans arrondi. Un taux plus précis que le moteur ne le lit est
 * écarté (l'écriture reste en attente de taux) plutôt qu'arrondi en silence.
 */
export function engineRate(stored: string): string | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(stored);
  if (m === null) return null;
  const fraction = (m[2] ?? '').replace(/0+$/, '');
  if (fraction.length > 8 || m[1]!.length > 12) return null;
  return fraction === '' ? m[1]! : `${m[1]}.${fraction}`;
}

/** Chevauchement de relecture d'un point de lecture (l'idempotence rend la relecture inerte). */
const CHECKPOINT_OVERLAP_MS = 5 * 60_000;

/** Tout ce que la génération lit avant d'appeler le moteur. */
export interface PostingState {
  organizationId: string;
  mode: AccountingMode;
  bookCurrency: AccountingBookCurrency;
  cutoverDate: string;
  ruleSet: MappingRuleSet | null;
  chartPack: { slug: string; version: number } | null;
  rates: EnteredRate[];
  links: Record<string, string>;
  vatRegistered: boolean;
  stockPosting: 'off' | 'perpetual';
  collectives: { customer: string | null; supplier: string | null };
  usesToken: { customer: boolean; supplier: boolean };
  treasuryAccounts: { id: string; name: string; kind: string; currency: AccountingCurrency }[];
}

/** Pièce lue et son résultat ; `result: null` = pièce illisible (`UNSUPPORTED_SOURCE`). */
export interface SourceOutcome {
  source: PendingSource & { kind: SourceKind };
  result: PostingResult | null;
}

type Scope = { all: true } | { since: Partial<Record<AccountingSyncSource, Date | null>>; ids: Partial<Record<SourceKind, string[]>> };

type Pin = SettlementAllocationView['invoiceBookRate'];

interface Counts {
  created: number;
  posted: number;
  awaitingRate: number;
  reversed: number;
  unchanged: number;
  skipped: number;
  pending: number;
}

const zeroCounts = (): Counts => ({
  created: 0,
  posted: 0,
  awaitingRate: 0,
  reversed: 0,
  unchanged: 0,
  skipped: 0,
  pending: 0,
});

/** Écriture du moteur → document à enregistrer. */
export function newEntryDoc(
  organizationId: string,
  e: ProposedEntry,
  journal: { code: string; kind: NewEntryDoc['journalKind'] },
  actorUserId: string,
  extra: Partial<NewEntryDoc> = {},
): NewEntryDoc {
  return {
    organizationId,
    journalCode: journal.code,
    journalKind: journal.kind,
    date: e.date,
    status: e.status === 'awaiting_rate' ? 'awaiting_rate' : 'posted',
    bookCurrency: e.bookCurrency,
    label: e.label,
    source: { ...e.source, event: e.source.event || null },
    sourceKey: e.sourceKey,
    keyed: true,
    lines: e.lines.map((l) => ({ ...l })),
    reversalOf: null,
    reversalOfKey: e.reversalOf,
    reversalReason: e.reversalReason,
    generation: e.generation,
    manual: null,
    regeneration: null,
    suspense: e.suspense,
    createdBy: actorUserId,
    updatedBy: actorUserId,
    ...extra,
  };
}

@Injectable()
export class AccountingSyncService {
  constructor(
    @Inject(AccountingSettingsService) private readonly settings: AccountingSettingsService,
    @Inject(AccountingAccountsService) private readonly accountsService: AccountingAccountsService,
    @Inject(AccountingSourcesService) private readonly sources: AccountingSourcesService,
    @Inject(AccountingEntryStore) private readonly store: AccountingEntryStore,
    @Inject(AccountingPendingService) private readonly pending: AccountingPendingService,
    @Inject(AccountingLetteringService) private readonly lettering: AccountingLetteringService,
    @Inject(AuditService) private readonly audit: AuditService,
    @InjectModel(AccountingRuleSet.name) private readonly ruleSets: Model<AccountingRuleSetLean>,
    @InjectModel(AccountingExchangeRate.name)
    private readonly rates: Model<AccountingExchangeRateLean>,
    @InjectModel(AccountingAccount.name) private readonly accounts: Model<AccountingAccountLean>,
    @InjectModel(AccountingPeriod.name) private readonly periods: Model<AccountingPeriodLean>,
    @InjectModel(AccountingSyncCheckpoint.name)
    private readonly checkpoints: Model<AccountingSyncCheckpointLean>,
    @InjectModel(AccountingTreasuryLink.name)
    private readonly links: Model<AccountingTreasuryLinkLean>,
    @InjectModel(AccountingSettings.name)
    private readonly settingsModel: Model<AccountingSettingsLean>,
  ) {}

  // ── État ─────────────────────────────────────────────────────────────────

  /**
   * Ce que la génération exige. `null` en mode `off` (rien n'est lu). Monnaie de tenue et
   * bascule n'ont AUCUN défaut : sans elles, `409 ACCOUNTING_SETTINGS_INCOMPLETE`.
   */
  async state(organizationId: string, settings?: AccountingSettingsLean): Promise<PostingState | null> {
    const s = settings ?? (await this.settings.ensure(organizationId));
    if (s.mode === 'off') return null;
    const missing = [
      ...(s.bookCurrency === null ? ['BOOK_CURRENCY_REQUIRED'] : []),
      ...(s.cutoverDate === null ? ['CUTOVER_DATE_REQUIRED'] : []),
    ];
    if (missing.length > 0 || s.bookCurrency === null || s.cutoverDate === null) {
      conflict(
        'ACCOUNTING_SETTINGS_INCOMPLETE',
        'Choisissez la monnaie de tenue et la date de bascule : aucune valeur n’est supposée.',
        { missing },
      );
    }
    const pack = await this.settings.chartPackOf(s);
    const validated = await this.ruleSets
      .findOne({ organizationId, status: 'validated' })
      .lean<AccountingRuleSetLean>()
      .exec();
    const ruleSet: MappingRuleSet | null = validated
      ? { version: validated.version, status: 'validated', rules: validated.rules }
      : null;
    const collectiveOf = (kind: 'customer' | 'supplier'): string | null => {
      const found = (pack?.content.accounts ?? []).filter(
        (a) => a.collective && a.auxiliaryKind === kind,
      );
      return found.length === 1 ? found[0]!.number : null;
    };
    const usesToken = (token: string): boolean =>
      (ruleSet?.rules ?? []).some(
        (r) => !r.requiresReview && [...r.debit, ...r.credit].includes(token),
      );
    const rates = await this.rates
      .find({ organizationId })
      .lean<AccountingExchangeRateLean[]>()
      .exec();
    const links = await this.links
      .find({ organizationId })
      .lean<AccountingTreasuryLinkLean[]>()
      .exec();
    const treasury = await this.sources.read('treasury_accounts', organizationId);
    return {
      organizationId,
      mode: s.mode,
      bookCurrency: s.bookCurrency,
      cutoverDate: s.cutoverDate,
      ruleSet,
      chartPack: s.chartPack,
      rates: rates.flatMap((r) => {
        const rate = engineRate(r.rate);
        return rate === null
          ? []
          : [{ date: r.date, from: r.from, to: r.to, rate, ref: `${r.sourceText} (saisi le ${r.date})` }];
      }),
      links: Object.fromEntries(links.map((l) => [l.treasuryAccountId, l.accountNumber])),
      vatRegistered: await this.sources.vatRegistered(organizationId),
      stockPosting: s.stockPosting,
      collectives: { customer: collectiveOf('customer'), supplier: collectiveOf('supplier') },
      usesToken: { customer: usesToken('{customer}'), supplier: usesToken('{supplier}') },
      treasuryAccounts: treasury
        .filter((t) => t['currency'] === 'CDF' || t['currency'] === 'USD')
        .map((t) => ({
          id: t._id.toHexString(),
          name: String(t['name'] ?? ''),
          kind: String(t['kind'] ?? ''),
          currency: t['currency'] as AccountingCurrency,
        })),
    };
  }

  // ── Comptes auxiliaires (§ 2.3) ──────────────────────────────────────────

  /**
   * Auxiliaire de chaque tiers, sous le collectif unique du pack pour sa nature. Créé à la
   * première écriture qui le vise (mode actif) ; en simulation, un numéro provisoire est
   * calculé et RIEN n'est enregistré. Aucun auxiliaire si aucune règle validée n'emploie
   * le jeton (`{customer}`, `{supplier}`), ou si le pack n'a pas un collectif unique.
   */
  private async auxiliaries(
    state: PostingState,
    kind: 'customer' | 'supplier',
    parties: ReadonlyMap<string, string | null>,
    persist: boolean,
    actorUserId: string,
  ): Promise<Record<string, AuxiliaryAccount>> {
    const collective = state.collectives[kind];
    const ids = [...parties.keys()].filter((id) => /^[0-9a-f]{24}$/i.test(id)).sort();
    if (collective === null || !state.usesToken[kind] || ids.length === 0) return {};
    const org = state.organizationId;
    const existing = await this.accounts
      .find({ organizationId: org, 'auxiliary.kind': kind, 'auxiliary.partyId': { $in: ids } })
      .sort({ _id: 1 })
      .lean<AccountingAccountLean[]>()
      .exec();
    const out: Record<string, AuxiliaryAccount> = {};
    for (const d of existing) {
      const party = d.auxiliary!.partyId;
      out[party] ??= { collectiveNumber: d.collectiveNumber ?? collective, auxiliaryNumber: d.number };
    }
    const missing = ids.filter((id) => out[id] === undefined);
    if (missing.length === 0) return out;
    if (!persist) {
      const taken = await this.accounts.countDocuments({ organizationId: org, collectiveNumber: collective }).exec();
      missing.forEach((id, i) => {
        out[id] = {
          collectiveNumber: collective,
          auxiliaryNumber: `${collective}${String(taken + i + 1).padStart(5, '0')}`,
        };
      });
      return out;
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
      // Deux synchronisations simultanées : le plus ancien auxiliaire fait foi.
      const first = await this.accounts
        .findOne({ organizationId: org, 'auxiliary.kind': kind, 'auxiliary.partyId': partyId })
        .sort({ _id: 1 })
        .lean<AccountingAccountLean>()
        .exec();
      if (first) out[partyId] = { collectiveNumber: collective, auxiliaryNumber: first.number };
    }
    return out;
  }

  // ── Génération (moteur) ──────────────────────────────────────────────────

  private async readScoped(
    collection: Parameters<AccountingSourcesService['read']>[0],
    org: string,
    scope: Scope,
    since: AccountingSyncSource,
    kind: SourceKind,
    extra: Record<string, unknown> = {},
  ): Promise<SourceDoc[]> {
    if ('all' in scope) return this.sources.read(collection, org, {}, extra);
    const byId = new Map<string, SourceDoc>();
    const sinceDate = scope.since[since];
    if (sinceDate !== undefined) {
      const s: SourceScope = { since: sinceDate === null ? null : new Date(sinceDate.getTime() - CHECKPOINT_OVERLAP_MS) };
      for (const d of await this.sources.read(collection, org, s, extra)) byId.set(d._id.toHexString(), d);
    }
    const ids = scope.ids[kind] ?? [];
    if (ids.length > 0) {
      for (const d of await this.sources.read(collection, org, { ids }, extra)) byId.set(d._id.toHexString(), d);
    }
    return [...byId.values()].sort((a, b) => (a._id.toHexString() < b._id.toHexString() ? -1 : 1));
  }

  /** Taux auquel la pièce `kind:id` a été passée (ligne de tiers qui la cite). */
  private async storedPins(org: string, keys: readonly string[]): Promise<Map<string, Pin>> {
    const out = new Map<string, Pin>();
    if (keys.length === 0) return out;
    const docs = await this.store.entries
      .find({ organizationId: org, keyed: true, sourceKey: { $in: [...keys] } })
      .lean<AccountingEntryLean[]>()
      .exec();
    for (const d of docs) {
      const ref = `${d.source?.kind}:${d.source?.id}`;
      const line = d.lines.find((l) => l.matchRef === ref && l.rate !== null);
      if (line && line.rateSource !== null) {
        out.set(ref, { rate: line.rate!, rateSource: line.rateSource, rateRef: line.rateRef });
      }
    }
    return out;
  }

  private static pinsFromResults(results: readonly PostingResult[]): Map<string, Pin> {
    const out = new Map<string, Pin>();
    for (const r of results) {
      const ref = `${r.source.kind}:${r.source.id}`;
      for (const e of r.entries) {
        const line = e.lines.find((l) => l.matchRef === ref && l.rate !== null);
        if (line && line.rateSource !== null && !out.has(ref)) {
          out.set(ref, { rate: line.rate!, rateSource: line.rateSource, rateRef: line.rateRef });
        }
      }
    }
    return out;
  }

  /** Lit les pièces (lecture seule) et rend, pour chacune, le résultat du moteur. */
  async generate(
    state: PostingState,
    scope: Scope,
    persistAuxiliaries: boolean,
    actorUserId: string,
  ): Promise<SourceOutcome[]> {
    const org = state.organizationId;
    const finalInvoices = { series: 'real', status: { $in: ['issued', 'normalized'] } };
    const invoices = await this.readScoped('sales_invoices', org, scope, 'sales_invoices', 'sales_invoice', finalInvoices);
    const receipts = await this.readScoped('sales_receipts', org, scope, 'sales_receipts', 'sales_receipt');
    const expenses = await this.readScoped('treasury_expenses', org, scope, 'treasury_expenses', 'treasury_expense');
    const supplierInvoices = await this.readScoped('supplier_invoices', org, scope, 'supplier_invoices', 'supplier_invoice', {
      status: { $in: ['validated', 'cancelled'] },
    });
    const payments = await this.readScoped('supplier_payments', org, scope, 'supplier_payments', 'supplier_payment');
    const movements = await this.readScoped('treasury_movements', org, scope, 'treasury_movements', 'treasury_movement');

    // Factures citées par les encaissements : client et taux de la pièce.
    const invoiceInfo = new Map<string, { customerId: string; customerName: string | null }>();
    const infoOf = (d: SourceDoc): void => {
      const c = d['customer'] as { customerId: string | null; name: string | null } | undefined;
      invoiceInfo.set(d._id.toHexString(), {
        customerId: c?.customerId ?? `anonymous:${d._id.toHexString()}`,
        customerName: c?.name ?? null,
      });
    };
    invoices.forEach(infoOf);
    const citedInvoices = [
      ...new Set(receipts.flatMap((r) => ((r['allocations'] as { invoiceId: string }[]) ?? []).map((a) => a.invoiceId))),
    ];
    const missingInvoices = citedInvoices.filter((id) => !invoiceInfo.has(id));
    if (missingInvoices.length > 0) {
      (await this.sources.read('sales_invoices', org, { ids: missingInvoices })).forEach(infoOf);
    }

    // Factures fournisseurs citées par les paiements : numéros.
    const supplierNumbers = new Map<string, string | null>(
      supplierInvoices.map((d) => [d._id.toHexString(), (d['internalNumber'] as string) ?? null]),
    );
    const citedSupplier = [
      ...new Set(payments.flatMap((p) => ((p['allocations'] as { invoiceId: string }[]) ?? []).map((a) => a.invoiceId))),
    ].filter((id) => !supplierNumbers.has(id));
    if (citedSupplier.length > 0) {
      for (const d of await this.sources.read('supplier_invoices', org, { ids: citedSupplier })) {
        supplierNumbers.set(d._id.toHexString(), (d['internalNumber'] as string) ?? null);
      }
    }
    const supplierIds = [
      ...supplierInvoices.map((d) => String(d['supplierId'])),
      ...payments.map((d) => String(d['supplierId'])),
    ];
    const supplierNames = await this.sources.names('suppliers', org, supplierIds);

    // Tiers → comptes auxiliaires.
    const customerParties = new Map<string, string | null>();
    for (const info of invoiceInfo.values()) customerParties.set(info.customerId, info.customerName);
    const supplierParties = new Map<string, string | null>(
      supplierIds.map((id) => [id, supplierNames.get(id) ?? null]),
    );
    const ctx: PostingContext = {
      ruleSet: state.ruleSet,
      suspenseAccount: ACCOUNTING_SUSPENSE_ACCOUNT,
      bookCurrency: state.bookCurrency,
      cutoverDate: state.cutoverDate,
      enteredRates: state.rates,
      chartPack: state.chartPack,
      customerAccounts: await this.auxiliaries(state, 'customer', customerParties, persistAuxiliaries, actorUserId),
      supplierAccounts: await this.auxiliaries(state, 'supplier', supplierParties, persistAuxiliaries, actorUserId),
      treasuryAccounts: state.links,
      vatRegistered: state.vatRegistered,
      stockPosting: state.stockPosting,
    };

    const outcomes: SourceOutcome[] = [];
    const push = (
      kind: SourceKind,
      d: SourceDoc,
      number: string | null,
      date: string | null,
      result: PostingResult | null,
    ): void => {
      outcomes.push({
        source: { kind, id: d._id.toHexString(), number, date: date ?? '', },
        result,
      });
    };

    const invoiceResults: PostingResult[] = [];
    for (const d of invoices) {
      const v = salesInvoiceView(d);
      const r = v === null ? null : entriesForSalesInvoice(v, ctx);
      if (r) invoiceResults.push(r);
      push('sales_invoice', d, v?.number ?? (d['number'] as string | null) ?? null, v?.date ?? null, r);
    }
    const supplierResults: PostingResult[] = [];
    for (const d of supplierInvoices) {
      const v = supplierInvoiceView(d, supplierNames.get(String(d['supplierId'])) ?? null);
      const r = v === null ? null : entriesForSupplierInvoice(v, ctx);
      if (r) supplierResults.push(r);
      push('supplier_invoice', d, v?.number ?? null, v?.invoiceDate ?? null, r);
    }

    const stored = await this.storedPins(org, [
      ...citedInvoices.map((id) => `sales_invoice:${id}:issue`),
      ...[...supplierNumbers.keys()].map((id) => `supplier_invoice:${id}:validate`),
    ]);
    const computed = AccountingSyncService.pinsFromResults([...invoiceResults, ...supplierResults]);
    const pinOf =
      (kind: 'sales_invoice' | 'supplier_invoice') =>
      (id: string): Pin =>
        stored.get(`${kind}:${id}`) ?? computed.get(`${kind}:${id}`) ?? null;

    for (const d of receipts) {
      const v = receiptView(d, invoiceInfo, pinOf('sales_invoice'));
      push('sales_receipt', d, v?.number ?? null, v?.receivedOn ?? (d['receivedOn'] as string) ?? null, v === null ? null : entriesForReceipt(v, ctx));
    }
    for (const d of expenses) {
      const v = expenseView(d);
      push('treasury_expense', d, v?.reference ?? null, v?.spentOn ?? null, v === null ? null : entriesForExpense(v, ctx));
    }
    for (const d of payments) {
      const v = supplierPaymentView(d, supplierNames.get(String(d['supplierId'])) ?? null, supplierNumbers, pinOf('supplier_invoice'));
      push('supplier_payment', d, v?.number ?? null, v?.paidOn ?? null, v === null ? null : entriesForSupplierPayment(v, ctx));
    }
    const currencies = new Map(state.treasuryAccounts.map((t) => [t.id, t.currency]));
    for (const d of movements) {
      const v = treasuryMovementView(d, currencies);
      push('treasury_movement', d, v?.reference ?? null, v?.date ?? null, v === null ? null : entriesForTreasuryMovement(v, ctx));
    }
    // Mouvements de stock : `stockPosting` reste `off` tant que l'expert n'a pas validé la
    // méthode (§ 6.7, `409 STOCK_POSTING_NOT_VALIDATED`) ; ils ne sont donc pas lus.
    return outcomes;
  }

  // ── Simulation ───────────────────────────────────────────────────────────

  /** Tout, calculé à la volée ; rien n'est enregistré. */
  async simulate(organizationId: string, state: PostingState): Promise<{
    outcomes: SourceOutcome[];
    entries: (NewEntryDoc & { _id: string })[];
  }> {
    const outcomes = await this.generate(state, { all: true }, false, 'system');
    const journals = await this.store.journalsOf(organizationId);
    const entries: (NewEntryDoc & { _id: string })[] = [];
    for (const o of outcomes) {
      for (const e of o.result?.entries ?? []) {
        const journal =
          journalCodeOf(journals, e.journal) ??
          (e.journal.kind === 'treasury'
            ? { code: `T:${e.journal.treasuryAccountId ?? ''}`.slice(0, 10), kind: 'treasury' as const }
            : { code: e.journal.kind.toUpperCase().slice(0, 2), kind: e.journal.kind });
        entries.push({ ...newEntryDoc(organizationId, e, journal, 'system'), _id: e.sourceKey });
      }
    }
    return { outcomes, entries };
  }

  // ── Synchronisation (mode actif) ─────────────────────────────────────────

  /** `POST /accounting/sync` et la tâche `accounting.sync` (toutes les 5 minutes). */
  async sync(organizationId: string, actor: AccountingActor): Promise<AccountingSyncResult> {
    const settings = await this.settings.ensure(organizationId);
    const empty = (mode: AccountingMode): AccountingSyncResult => ({ mode, ...zeroCounts(), sourcesRead: 0 });
    if (settings.mode === 'off') return empty('off');
    const state = (await this.state(organizationId, settings))!;
    if (settings.mode === 'simulation') {
      const { outcomes, entries } = await this.simulate(organizationId, state);
      return {
        mode: 'simulation',
        ...zeroCounts(),
        created: entries.length,
        posted: entries.filter((e) => e.status === 'posted').length,
        awaitingRate: entries.filter((e) => e.status === 'awaiting_rate').length,
        skipped: outcomes.filter((o) => o.result?.skipped).length,
        pending: outcomes.filter((o) => o.result === null || o.result.pending.length > 0).length,
        sourcesRead: outcomes.length,
      };
    }

    const runAt = new Date();
    await this.store.ensureTreasuryJournals(organizationId, state.treasuryAccounts, actor.userId);
    const cps = await this.checkpoints
      .find({ organizationId })
      .lean<AccountingSyncCheckpointLean[]>()
      .exec();
    const since: Partial<Record<AccountingSyncSource, Date | null>> = {};
    for (const s of ACCOUNTING_SYNC_SOURCES) since[s] = cps.find((c) => c.source === s)?.lastUpdatedAt ?? null;
    const ids = await this.revisitIds(organizationId);
    const outcomes = await this.generate(state, { since, ids }, true, actor.userId);
    const counts = await this.apply(organizationId, outcomes, actor.userId, runAt);
    for (const s of ACCOUNTING_SYNC_SOURCES) {
      await this.checkpoints
        .updateOne(
          { organizationId, source: s },
          { $set: { lastUpdatedAt: runAt, lastRunAt: runAt }, $setOnInsert: { _schemaVersion: 1 } },
          { upsert: true },
        )
        .exec()
        .catch((err: unknown) => {
          if (!isDuplicateKey(err)) throw err;
        });
    }
    const out: AccountingSyncResult = { mode: 'active', ...counts, sourcesRead: outcomes.length };
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.synced',
      targetType: 'accounting_settings',
      targetId: organizationId,
      metadata: { ...counts, sourcesRead: outcomes.length },
    });
    return out;
  }

  /** Pièces à relire quoi qu'il arrive : écritures en attente de taux, « À comptabiliser » ouvert. */
  private async revisitIds(organizationId: string): Promise<Partial<Record<SourceKind, string[]>>> {
    const out: Partial<Record<SourceKind, string[]>> = {};
    const add = (kind: string, id: string): void => {
      const k = kind as SourceKind;
      (out[k] ??= []).push(id);
    };
    const awaiting = await this.store.entries
      .find({ organizationId, status: 'awaiting_rate' }, { source: 1 })
      .lean<AccountingEntryLean[]>()
      .exec();
    for (const e of awaiting) if (e.source) add(e.source.kind, e.source.id);
    for (const s of await this.pending.openSources(organizationId)) add(s.kind, s.id);
    return out;
  }

  /** Applique les résultats du moteur, pièce par pièce. */
  private async apply(
    organizationId: string,
    outcomes: readonly SourceOutcome[],
    actorUserId: string,
    now: Date,
    log: AccountingEntryLean[] = [],
  ): Promise<Counts> {
    const counts = zeroCounts();
    const journals = await this.store.journalsOf(organizationId);
    const matchRefs = new Set<string>();
    for (const o of outcomes) {
      await this.applyOne(organizationId, o, journals, actorUserId, now, counts, matchRefs, log);
    }
    await this.lettering.autoLetter(organizationId, [...matchRefs]);
    return counts;
  }

  private async applyOne(
    organizationId: string,
    o: SourceOutcome,
    journals: readonly AccountingJournalLean[],
    actorUserId: string,
    now: Date,
    counts: Counts,
    matchRefs: Set<string>,
    log: AccountingEntryLean[],
  ): Promise<void> {
    const reasons: { reason: AccountingPendingReason; entryId?: string | null }[] = [];
    const finish = async (): Promise<void> => {
      const unique = new Map(reasons.map((r) => [r.reason, r]));
      if (unique.size > 0) counts.pending += 1;
      await this.pending.reconcile(organizationId, o.source, [...unique.values()], now);
    };
    if (o.result === null) {
      reasons.push({ reason: 'UNSUPPORTED_SOURCE' });
      return finish();
    }
    const r = o.result;
    if (r.skipped !== null) counts.skipped += 1;
    for (const p of r.pending) reasons.push({ reason: pendingReasonOf(p) });

    const existing = await this.store.entries
      .find({
        organizationId,
        'source.kind': o.source.kind,
        'source.id': o.source.id,
        regeneration: null,
        status: { $ne: 'draft' },
      })
      .sort({ _id: 1 })
      .lean<AccountingEntryLean[]>()
      .exec();
    const wanted = new Map(r.entries.map((e) => [e.sourceKey, e]));

    // En attente de taux : promue dès que le taux existe ; supprimée si elle n'est plus
    // voulue (jamais validée, jamais numérotée, hors balance).
    const keep: AccountingEntryLean[] = [];
    for (const e of existing) {
      if (e.status !== 'awaiting_rate') {
        keep.push(e);
        continue;
      }
      const w = wanted.get(e.sourceKey);
      if (w === undefined) {
        await this.store.entries.deleteOne({ _id: e._id, organizationId, status: 'awaiting_rate' }).exec();
        continue;
      }
      keep.push(e);
      if (w.status !== 'ready') continue;
      const period = await this.store.periodOf(organizationId, e.date);
      if (period === null || period.status !== 'open') {
        reasons.push({ reason: 'PERIOD_CLOSED' });
        continue;
      }
      const posted = await this.store.post(
        organizationId,
        {
          existingId: String(e._id),
          expectedRevision: e.revision,
          patch: { lines: w.lines.map((l) => ({ ...l })), suspense: w.suspense, generation: w.generation, label: w.label },
        },
        period.fiscalYear,
        actorUserId,
      );
      if (posted) {
        counts.posted += 1;
        log.push(posted);
        posted.lines.forEach((l) => l.matchRef && matchRefs.add(l.matchRef));
      }
    }

    const plan = syncSourceEntries(r, keep.map(proposedOf));
    counts.unchanged += plan.unchanged.length;
    for (const c of plan.create) {
      if (c.reversalOf !== null) {
        const original = keep.find((e) => e.sourceKey === c.reversalOf);
        if (!original || original.status !== 'posted') continue;
        let date = c.date;
        let reason = c.reversalReason;
        let period = await this.store.periodOf(organizationId, date);
        let changedInClosed = false;
        if (period === null || period.status !== 'open') {
          const next = await this.store.firstOpenDayAfter(organizationId, date);
          if (next === null) {
            reasons.push({ reason: 'PERIOD_CLOSED' });
            continue;
          }
          date = next;
          reason = 'SOURCE_CHANGED_IN_CLOSED_PERIOD';
          period = await this.store.periodOf(organizationId, date);
          changedInClosed = true;
        }
        if (period === null) continue;
        const doc = newEntryDoc(
          organizationId,
          { ...c, date, reversalReason: reason },
          { code: original.journalCode, kind: original.journalKind },
          actorUserId,
          { reversalOf: String(original._id) },
        );
        const posted = await this.store.post(organizationId, { doc }, period.fiscalYear, actorUserId);
        if (!posted) continue;
        await this.store.markReversed(organizationId, String(original._id), String(posted._id));
        await this.lettering.unletterEntry(organizationId, original, 'system');
        counts.reversed += 1;
        counts.created += 1;
        if (changedInClosed) {
          reasons.push({ reason: 'SOURCE_CHANGED_IN_CLOSED_PERIOD', entryId: String(posted._id) });
        }
        continue;
      }
      const journal = journalCodeOf(journals, c.journal);
      if (journal === null) {
        reasons.push({ reason: 'UNSUPPORTED_SOURCE' });
        continue;
      }
      const doc = newEntryDoc(organizationId, c, journal, actorUserId);
      if (c.status === 'awaiting_rate') {
        const inserted = await this.store.insertUnposted(organizationId, doc);
        if (inserted) {
          counts.awaitingRate += 1;
          counts.created += 1;
          log.push(inserted);
        }
        continue;
      }
      const period = await this.store.periodOf(organizationId, c.date);
      if (period === null || period.status !== 'open') {
        reasons.push({ reason: 'PERIOD_CLOSED' });
        continue;
      }
      const posted = await this.store.post(organizationId, { doc }, period.fiscalYear, actorUserId);
      if (posted) {
        counts.posted += 1;
        counts.created += 1;
        log.push(posted);
        posted.lines.forEach((l) => l.matchRef && matchRefs.add(l.matchRef));
      } else {
        counts.unchanged += 1;
      }
    }
    await finish();
  }

  // ── Régénération contrôlée d'un mois ouvert (§ 4) ────────────────────────

  async regenerate(
    organizationId: string,
    year: number,
    month: number,
    confirm: boolean,
    actor: AccountingActor,
  ): Promise<AccountingRegenerationView> {
    const settings = await this.settings.ensure(organizationId);
    if (settings.mode !== 'active') {
      conflict(
        'ACCOUNTING_NOT_ACTIVE',
        'La régénération ne vaut qu’en mode actif : en simulation, tout est recalculé à chaque lecture.',
      );
    }
    const period = await this.periods
      .findOne({ organizationId, year, month })
      .lean<AccountingPeriodLean>()
      .exec();
    if (!period) notFound('PERIOD_NOT_FOUND', 'Ce mois n’appartient à aucun exercice.');
    if (period.status !== 'open') {
      conflict('ACCOUNTING_PERIOD_CLOSED', 'Ce mois est clos : il ne se régénère pas.');
    }
    const state = (await this.state(organizationId, settings))!;
    const targets = await this.store.entries
      .find({
        organizationId,
        keyed: true,
        status: 'posted',
        generation: { $ne: null },
        regeneration: null,
        reversalOfKey: null,
        reversedBy: null,
        date: { $gte: period.start, $lte: period.end },
      })
      .sort({ date: 1, _id: 1 })
      .lean<AccountingEntryLean[]>()
      .exec();
    const ids: Partial<Record<SourceKind, string[]>> = {};
    for (const t of targets) if (t.source) (ids[t.source.kind as SourceKind] ??= []).push(t.source.id);
    const view: AccountingRegenerationView = {
      year,
      month,
      confirmed: confirm,
      reversed: targets.map((t) => ({
        id: String(t._id),
        sourceKey: t.sourceKey,
        date: t.date,
        journalCode: t.journalCode,
      })),
      created: [],
      ruleSetVersion: state.ruleSet?.version ?? null,
    };
    const journals = await this.store.journalsOf(organizationId);
    if (!confirm) {
      const outcomes = await this.generate(state, { since: {}, ids }, false, actor.userId);
      for (const o of outcomes) {
        for (const e of o.result?.entries ?? []) {
          if (e.date < period.start || e.date > period.end) continue;
          view.created.push({
            sourceKey: e.sourceKey,
            date: e.date,
            journalCode: journalCodeOf(journals, e.journal)?.code ?? '',
            suspense: e.suspense,
          });
        }
      }
      return view;
    }

    const batchId = new Types.ObjectId().toHexString();
    for (const t of targets) {
      const rev = reverseEntry(proposedOf(t), {
        sourceKey: `${t.sourceKey}:regen:${batchId}`,
        reason: 'REGENERATION',
      });
      const doc = newEntryDoc(
        organizationId,
        rev,
        { code: t.journalCode, kind: t.journalKind },
        actor.userId,
        { reversalOf: String(t._id), regeneration: { batchId, role: 'reversal' } },
      );
      const posted = await this.store.post(organizationId, { doc }, period.fiscalYear, actor.userId);
      if (!posted) continue;
      await this.store.entries
        .updateOne(
          { _id: t._id, organizationId, reversedBy: null },
          { $set: { keyed: false, reversedBy: String(posted._id), regeneration: { batchId, role: 'reversed' } } },
        )
        .exec();
      await this.lettering.unletterEntry(organizationId, t, actor.userId);
    }
    const outcomes = await this.generate(state, { since: {}, ids }, true, actor.userId);
    const created: AccountingEntryLean[] = [];
    await this.apply(organizationId, outcomes, actor.userId, new Date(), created);
    view.created = created.map((e) => ({
      sourceKey: e.sourceKey,
      date: e.date,
      journalCode: e.journalCode,
      suspense: e.suspense,
    }));
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.period_regenerated',
      targetType: 'accounting_period',
      targetId: `${year}-${String(month).padStart(2, '0')}`,
      metadata: {
        batchId,
        reversed: view.reversed.length,
        created: view.created.length,
        ruleSetVersion: view.ruleSetVersion,
      },
    });
    return view;
  }

  // ── Comptes de trésorerie ↔ plan ─────────────────────────────────────────

  async treasuryLinks(organizationId: string): Promise<AccountingTreasuryLinkView[]> {
    const accounts = await this.sources.read('treasury_accounts', organizationId);
    const links = await this.links.find({ organizationId }).lean<AccountingTreasuryLinkLean[]>().exec();
    const journals = await this.store.journalsOf(organizationId);
    return accounts
      .filter((a) => a['currency'] === 'CDF' || a['currency'] === 'USD')
      .map((a) => {
        const id = a._id.toHexString();
        const link = links.find((l) => l.treasuryAccountId === id);
        return {
          treasuryAccountId: id,
          treasuryAccountName: String(a['name'] ?? ''),
          treasuryAccountKind: String(a['kind'] ?? ''),
          currency: a['currency'] as AccountingBookCurrency,
          journalCode: journals.find((j) => j.treasuryAccountId === id)?.code ?? null,
          accountNumber: link?.accountNumber ?? null,
          revision: link?.revision ?? null,
        };
      });
  }

  async putTreasuryLink(
    organizationId: string,
    treasuryAccountId: string,
    body: PutAccountingTreasuryLinkBody,
    actor: AccountingActor,
  ): Promise<AccountingTreasuryLinkView> {
    const [account] = await this.sources.read('treasury_accounts', organizationId, { ids: [treasuryAccountId] });
    if (!account) notFound('TREASURY_ACCOUNT_NOT_FOUND', 'Compte de trésorerie introuvable.');
    const current = await this.links
      .findOne({ organizationId, treasuryAccountId })
      .lean<AccountingTreasuryLinkLean>()
      .exec();
    if ((current?.revision ?? null) !== body.expectedRevision) staleRevision(current?.revision ?? 0);
    if (body.accountNumber === null) {
      if (current) await this.links.deleteOne({ _id: current._id, organizationId }).exec();
    } else {
      const plan = await this.accountsService.activeNumbers(organizationId);
      if (!plan.has(body.accountNumber)) {
        conflict('ACCOUNT_NOT_IN_PLAN', 'Ce compte n’est pas un compte actif du plan de l’organisation.');
      }
      if (current) {
        const updated = await this.links
          .updateOne(
            { _id: current._id, organizationId, revision: current.revision },
            { $set: { accountNumber: body.accountNumber, updatedBy: actor.userId }, $inc: { revision: 1 } },
          )
          .exec();
        if (updated.modifiedCount === 0) staleRevision(current.revision);
      } else {
        try {
          await this.links.create({
            organizationId,
            treasuryAccountId,
            accountNumber: body.accountNumber,
            revision: 1,
            createdBy: actor.userId,
            updatedBy: actor.userId,
            _schemaVersion: 1,
          });
        } catch (err) {
          if (isDuplicateKey(err)) staleRevision(1);
          throw err;
        }
      }
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.treasury_link_changed',
      targetType: 'treasury_account',
      targetId: treasuryAccountId,
      metadata: { accountNumber: body.accountNumber },
    });
    const views = await this.treasuryLinks(organizationId);
    return views.find((v) => v.treasuryAccountId === treasuryAccountId)!;
  }

  /** Organisations en mode actif (tâche planifiée). */
  async activeOrganizations(): Promise<string[]> {
    const docs = await this.settingsModel
      .find({ mode: 'active' }, { organizationId: 1 })
      .lean<AccountingSettingsLean[]>()
      .exec();
    return docs.map((d) => d.organizationId).sort();
  }
}
