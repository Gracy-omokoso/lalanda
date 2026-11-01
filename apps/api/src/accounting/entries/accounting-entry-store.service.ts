// Persistance des écritures : validation (numéro, chaînage), attente de taux, lecture
// (ADR-0049 § 2.6, § 2.7). ADR-0049 — K5.
//
// - Numéro attribué À LA VALIDATION, séquentiel SANS TROU par organisation, journal et
//   exercice (`accounting_counters`) ; chaînage par organisation (`accounting_journal_heads`,
//   `seq`, `prevHash`, `hash`) avec l'algorithme du journal des ventes (ADR-0023
//   § S25e.12 : `hash = sha256(prevHash + "\n" + JSON canonique)`, genèse « 0 » × 64).
//   Les deux incréments et l'écriture vivent dans UNE transaction : deux validations
//   simultanées se heurtent sur la tête, la seconde est rejouée et prend le rang suivant ;
//   un échec annule les incréments — aucun trou.
// - L'empreinte couvre tout ce qui fait l'écriture, SAUF le code de lettrage (§ 6.11, qui
//   vit à côté) et le lien `reversedBy` (posé sur l'origine quand elle est contre-passée).
// - Une écriture `posted` n'est JAMAIS modifiée ni supprimée par ce service.

import {
  type JournalKind,
  type ProposedEntry,
  type ReportingEntry,
  toReportingEntry,
} from '@lalanda/engine';
import type {
  AccountingSourceKind,
  AccountingEntryLineView,
  AccountingEntryView,
  AccountingJournalKind,
} from '@lalanda/shared/accounting';
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';

import { JOURNAL_GENESIS_HASH, journalHash } from '../../sales/invoices/canonical.js';
import { conflict, isDuplicateKey, toIso } from '../accounting.common.js';
import {
  AccountingJournal,
  type AccountingJournalLean,
} from '../journals/accounting-journal.schema.js';
import { AccountingPeriod, type AccountingPeriodLean } from '../periods/accounting-period.schema.js';
import {
  AccountingCounter,
  AccountingEntry,
  AccountingJournalHead,
  type AccountingCounterLean,
  type AccountingEntryLean,
  type AccountingJournalHeadLean,
  type StoredEntryLine,
} from './accounting-entry.schema.js';

/** Écriture prête à être enregistrée (sans les champs de persistance). */
export type NewEntryDoc = Omit<
  AccountingEntryLean,
  | '_id'
  | 'revision'
  | '_schemaVersion'
  | 'createdAt'
  | 'updatedAt'
  | 'fiscalYear'
  | 'number'
  | 'seq'
  | 'prevHash'
  | 'hash'
  | 'postedAt'
  | 'postedBy'
  | 'reversedBy'
>;

/** Champs couverts par l'empreinte d'une écriture validée (ordre sans effet : JSON canonique). */
export function accountingEntryHashPayload(
  e: Pick<
    AccountingEntryLean,
    | 'organizationId'
    | 'seq'
    | 'journalCode'
    | 'fiscalYear'
    | 'number'
    | 'date'
    | 'bookCurrency'
    | 'label'
    | 'source'
    | 'sourceKey'
    | 'lines'
    | 'reversalOf'
    | 'reversalOfKey'
    | 'reversalReason'
    | 'generation'
    | 'manual'
    | 'postedAt'
    | 'postedBy'
  >,
): Record<string, unknown> {
  return {
    organizationId: e.organizationId,
    seq: e.seq,
    journalCode: e.journalCode,
    fiscalYear: e.fiscalYear,
    number: e.number,
    date: e.date,
    bookCurrency: e.bookCurrency,
    label: e.label,
    source: e.source,
    sourceKey: e.sourceKey,
    lines: e.lines.map(({ letteringCode: _l, ...rest }) => rest),
    reversalOf: e.reversalOf,
    reversalOfKey: e.reversalOfKey,
    reversalReason: e.reversalReason,
    generation: e.generation,
    manual: e.manual,
    postedAt: e.postedAt === null ? null : new Date(e.postedAt).toISOString(),
    postedBy: e.postedBy,
  };
}

/** Empreinte d'une écriture validée, chaînée à la précédente. */
export function accountingEntryHash(
  prevHash: string,
  e: Parameters<typeof accountingEntryHashPayload>[0],
): string {
  return journalHash(prevHash, accountingEntryHashPayload(e));
}

export const ACCOUNTING_GENESIS_HASH = JOURNAL_GENESIS_HASH;

export interface PeriodInfo {
  fiscalYear: number;
  status: 'open' | 'closed';
  start: string;
  end: string;
}

/** Vue K2 (`ProposedEntry`) d'une écriture enregistrée : comparaison et contre-passation. */
export function proposedOf(d: AccountingEntryLean): ProposedEntry {
  return {
    sourceKey: d.sourceKey,
    status: d.status === 'awaiting_rate' ? 'awaiting_rate' : 'ready',
    journal: {
      kind: d.journalKind,
      treasuryAccountId: null,
    },
    date: d.date,
    bookCurrency: d.bookCurrency,
    label: d.label ?? '',
    source: {
      kind: (d.source?.kind ?? 'sales_invoice') as ProposedEntry['source']['kind'],
      id: d.source?.id ?? '',
      event: d.source?.event ?? '',
      number: d.source?.number ?? null,
      date: d.source?.date ?? d.date,
      partyName: d.source?.partyName ?? null,
    },
    lines: d.lines.map((l) => ({ ...l })),
    reversalOf: d.reversalOfKey,
    reversalReason: d.reversalReason,
    generation: d.generation ?? { ruleSetVersion: null, chartPack: null, engineVersion: '' },
    suspense: d.suspense,
  };
}

/** Écriture enregistrée, ou calculée en simulation (`_id` = clé de source). */
export type EntryLike = NewEntryDoc &
  Partial<Pick<AccountingEntryLean, 'fiscalYear' | 'number' | 'reversedBy' | 'hash' | 'postedAt'>> & {
    _id: unknown;
  };

/** Vue de restitution (K3) d'une écriture, pour le lettrage et la restitution (K6). */
export function reportingOf(d: EntryLike): ReportingEntry {
  const r = toReportingEntry(proposedOf(d as unknown as AccountingEntryLean), {
    id: String(d._id),
    journalCode: d.journalCode,
    fiscalYear: d.fiscalYear ?? null,
    number: d.number ?? null,
    status: d.status,
    postedOn: d.postedAt ? new Date(d.postedAt).toISOString().slice(0, 10) : null,
    reversalOf: d.reversalOf ?? null,
    reversedBy: d.reversedBy ?? null,
    manual: d.manual
      ? { authorId: d.manual.authorId, validatorId: d.manual.validatorId, reason: d.manual.reason }
      : null,
    hash: d.hash ?? null,
  });
  return {
    ...r,
    source: d.source
      ? {
          kind: d.source.kind,
          id: d.source.id,
          number: d.source.number,
          date: d.source.date,
          partyName: d.source.partyName,
        }
      : null,
    generation: d.generation ?? null,
  };
}

@Injectable()
export class AccountingEntryStore {
  constructor(
    @InjectModel(AccountingEntry.name) readonly entries: Model<AccountingEntryLean>,
    @InjectModel(AccountingJournalHead.name)
    private readonly heads: Model<AccountingJournalHeadLean>,
    @InjectModel(AccountingCounter.name) private readonly counters: Model<AccountingCounterLean>,
    @InjectModel(AccountingPeriod.name) private readonly periods: Model<AccountingPeriodLean>,
    @InjectModel(AccountingJournal.name) private readonly journals: Model<AccountingJournalLean>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // ── Périodes ─────────────────────────────────────────────────────────────

  /** Période (mois d'exercice) contenant `day`, `null` hors de tout exercice. */
  async periodOf(organizationId: string, day: string): Promise<PeriodInfo | null> {
    const p = await this.periods
      .findOne({ organizationId, start: { $lte: day }, end: { $gte: day } })
      .lean<AccountingPeriodLean>()
      .exec();
    return p ? { fiscalYear: p.fiscalYear, status: p.status, start: p.start, end: p.end } : null;
  }

  /** Premier jour ouvert APRÈS le mois de `day` (contre-passation d'une pièce changée, § 4). */
  async firstOpenDayAfter(organizationId: string, day: string): Promise<string | null> {
    const p = await this.periods
      .findOne({ organizationId, status: 'open', start: { $gt: day } })
      .sort({ start: 1 })
      .lean<AccountingPeriodLean>()
      .exec();
    return p?.start ?? null;
  }

  // ── Journaux ─────────────────────────────────────────────────────────────

  async journalsOf(organizationId: string): Promise<AccountingJournalLean[]> {
    return this.journals.find({ organizationId }).sort({ code: 1 }).lean<AccountingJournalLean[]>().exec();
  }

  /**
   * Un journal de trésorerie par compte de trésorerie d'ADR-0034 (§ 2.5), code proposé
   * `T01`, `T02`… (modifiable en libellé). Idempotent : un compte déjà pourvu n'en reçoit
   * pas d'autre.
   */
  async ensureTreasuryJournals(
    organizationId: string,
    accounts: readonly { id: string; name: string }[],
    actorUserId: string,
  ): Promise<void> {
    const existing = await this.journalsOf(organizationId);
    const linked = new Set(existing.map((j) => j.treasuryAccountId).filter((v) => v !== null));
    const codes = new Set(existing.map((j) => j.code));
    let n = 0;
    for (const a of accounts) {
      if (linked.has(a.id)) continue;
      let code: string;
      do {
        n += 1;
        code = `T${String(n).padStart(2, '0')}`;
      } while (codes.has(code));
      try {
        await this.journals.create({
          organizationId,
          code,
          label: `Trésorerie — ${a.name}`.slice(0, 80),
          kind: 'treasury',
          treasuryAccountId: a.id,
          active: true,
          revision: 1,
          createdBy: actorUserId,
          updatedBy: actorUserId,
          _schemaVersion: 1,
        });
        codes.add(code);
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        codes.add(code);
      }
    }
  }

  // ── Écriture et validation ───────────────────────────────────────────────

  private async inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => {
        out = await fn(session);
      });
      return out;
    } finally {
      await session.endSession();
    }
  }

  /** Têtes et compteurs créés hors transaction (une insertion concurrente n'y avorte rien). */
  private async ensureChain(organizationId: string, counterKey: string): Promise<void> {
    const ignoreDup = (err: unknown): void => {
      if (!isDuplicateKey(err)) throw err;
    };
    await this.heads
      .updateOne(
        { organizationId },
        { $setOnInsert: { organizationId, seq: 0, lastHash: null, _schemaVersion: 1 } },
        { upsert: true },
      )
      .exec()
      .catch(ignoreDup);
    await this.counters
      .updateOne(
        { organizationId, key: counterKey },
        { $setOnInsert: { organizationId, key: counterKey, seq: 0, _schemaVersion: 1 } },
        { upsert: true },
      )
      .exec()
      .catch(ignoreDup);
  }

  /**
   * Valide une écriture : neuve (`doc`) ou existante (`existingId`, statut non `posted`,
   * révision attendue). Numéro, rang et empreinte sont posés dans une transaction.
   * `null` si la clé de source existe déjà (idempotence : une autre synchronisation l'a
   * écrite entre-temps).
   */
  async post(
    organizationId: string,
    input:
      | { doc: NewEntryDoc }
      | { existingId: string; expectedRevision: number; patch: Partial<NewEntryDoc> },
    fiscalYear: number,
    actorUserId: string,
  ): Promise<AccountingEntryLean | null> {
    const base =
      'doc' in input
        ? input.doc
        : await this.entries
            .findOne({ _id: input.existingId, organizationId })
            .lean<AccountingEntryLean>()
            .exec();
    if (!base) return null;
    const merged = { ...base, ...('patch' in input ? input.patch : {}) } as NewEntryDoc;
    const counterKey = `entry:${merged.journalCode}:${fiscalYear}`;
    await this.ensureChain(organizationId, counterKey);
    try {
      return await this.inTransaction(async (session) => {
        const head = await this.heads
          .findOneAndUpdate({ organizationId }, { $inc: { seq: 1 } }, { new: true, session })
          .lean<AccountingJournalHeadLean>()
          .exec();
        const counter = await this.counters
          .findOneAndUpdate(
            { organizationId, key: counterKey },
            { $inc: { seq: 1 } },
            { new: true, session },
          )
          .lean<AccountingCounterLean>()
          .exec();
        if (!head || !counter) throw new Error('Tête de chaîne ou compteur introuvable.');
        const prevHash = head.lastHash ?? ACCOUNTING_GENESIS_HASH;
        const postedAt = new Date();
        const sealed = {
          ...merged,
          organizationId,
          status: 'posted' as const,
          fiscalYear,
          number: counter.seq,
          seq: head.seq,
          prevHash,
          postedAt,
          postedBy: actorUserId,
        };
        const hash = accountingEntryHash(prevHash, sealed);
        await this.heads
          .updateOne({ organizationId }, { $set: { lastHash: hash } }, { session })
          .exec();
        if ('doc' in input) {
          const [created] = await this.entries.create(
            [{ ...sealed, hash, reversedBy: null, revision: 1, _schemaVersion: 1 }],
            { session },
          );
          return created!.toObject() as unknown as AccountingEntryLean;
        }
        const updated = await this.entries
          .findOneAndUpdate(
            {
              _id: input.existingId,
              organizationId,
              status: { $ne: 'posted' },
              revision: input.expectedRevision,
            },
            {
              $set: {
                ...('patch' in input ? input.patch : {}),
                status: 'posted',
                fiscalYear,
                number: counter.seq,
                seq: head.seq,
                prevHash,
                hash,
                postedAt,
                postedBy: actorUserId,
                updatedBy: actorUserId,
              },
              $inc: { revision: 1 },
            },
            { new: true, session },
          )
          .lean<AccountingEntryLean>()
          .exec();
        if (!updated) {
          conflict(
            'STALE_REVISION',
            'Cette écriture a été modifiée ou validée entre-temps : rechargez-la.',
          );
        }
        return updated;
      });
    } catch (err) {
      if (isDuplicateKey(err) && 'doc' in input) return null;
      throw err;
    }
  }

  /** Enregistre une écriture non validée (`awaiting_rate`, ou brouillon). `null` si la clé existe. */
  async insertUnposted(
    organizationId: string,
    doc: NewEntryDoc,
  ): Promise<AccountingEntryLean | null> {
    try {
      const created = await this.entries.create({
        ...doc,
        organizationId,
        fiscalYear: null,
        number: null,
        seq: null,
        prevHash: null,
        hash: null,
        postedAt: null,
        postedBy: null,
        reversedBy: null,
        revision: 1,
        _schemaVersion: 1,
      });
      return created.toObject() as unknown as AccountingEntryLean;
    } catch (err) {
      if (isDuplicateKey(err)) return null;
      throw err;
    }
  }

  /** Lien de contre-passation sur l'origine (hors empreinte). */
  async markReversed(organizationId: string, originalId: string, reversalId: string): Promise<void> {
    await this.entries
      .updateOne({ _id: originalId, organizationId, reversedBy: null }, { $set: { reversedBy: reversalId } })
      .exec();
  }

  /**
   * Chaîne intacte de bout en bout : rangs 1, 2, 3… sans trou, chaque `prevHash` égal au
   * `hash` précédent, chaque `hash` recalculé à l'identique, tête cohérente.
   */
  async verifyChain(organizationId: string): Promise<{ ok: boolean; count: number; brokenAt: number | null }> {
    const docs = await this.entries
      .find({ organizationId, seq: { $type: 'number' } })
      .sort({ seq: 1 })
      .lean<AccountingEntryLean[]>()
      .exec();
    let prev = ACCOUNTING_GENESIS_HASH;
    let expected = 1;
    for (const d of docs) {
      if (d.seq !== expected || d.prevHash !== prev || accountingEntryHash(prev, d) !== d.hash) {
        return { ok: false, count: docs.length, brokenAt: expected };
      }
      prev = d.hash!;
      expected += 1;
    }
    const head = await this.heads.findOne({ organizationId }).lean<AccountingJournalHeadLean>().exec();
    const headOk = (head?.seq ?? 0) === docs.length && (head?.lastHash ?? ACCOUNTING_GENESIS_HASH) === prev;
    return { ok: headOk, count: docs.length, brokenAt: headOk ? null : expected };
  }

  /** Code de lettrage suivant (`L000001`…), par organisation. */
  async nextLetteringCode(organizationId: string): Promise<string> {
    const doc = await this.counters
      .findOneAndUpdate(
        { organizationId, key: 'lettering' },
        { $inc: { seq: 1 }, $setOnInsert: { _schemaVersion: 1 } },
        { upsert: true, new: true },
      )
      .lean<AccountingCounterLean>()
      .exec();
    return `L${String(doc!.seq).padStart(6, '0')}`;
  }

  /** Rang suivant d'un compteur nommé (comptes auxiliaires). */
  async nextCounter(organizationId: string, key: string): Promise<number> {
    const doc = await this.counters
      .findOneAndUpdate(
        { organizationId, key },
        { $inc: { seq: 1 }, $setOnInsert: { _schemaVersion: 1 } },
        { upsert: true, new: true },
      )
      .lean<AccountingCounterLean>()
      .exec();
    return doc!.seq;
  }
}

// ── Vues ────────────────────────────────────────────────────────────────────

/** Code du journal d'une écriture du moteur (`VE`, `AC`, `OD`, `T01`…). */
export function journalCodeOf(
  journals: readonly AccountingJournalLean[],
  ref: { kind: JournalKind; treasuryAccountId: string | null },
): { code: string; kind: AccountingJournalKind } | null {
  if (ref.kind === 'treasury') {
    const j = journals.find((x) => x.kind === 'treasury' && x.treasuryAccountId === ref.treasuryAccountId);
    return j ? { code: j.code, kind: 'treasury' } : null;
  }
  const candidates = journals.filter((x) => x.kind === ref.kind && x.treasuryAccountId === null);
  const preferred = { sales: 'VE', purchases: 'AC', misc: 'OD', opening: 'AN' }[ref.kind];
  const j =
    candidates.find((x) => x.code === preferred && x.active) ??
    candidates.find((x) => x.active) ??
    candidates[0];
  return j ? { code: j.code, kind: j.kind } : null;
}

/** Vue d'API d'une ligne (côté inactif `null`, comme la restitution). */
export function lineView(
  entryId: string,
  index: number,
  l: StoredEntryLine,
  labels: ReadonlyMap<string, string>,
): AccountingEntryLineView {
  const posted = l.bookAmount !== null;
  return {
    ref: `${entryId}#${index}`,
    accountNumber: l.accountNumber,
    accountLabel: labels.get(l.accountNumber) ?? null,
    auxiliaryAccountNumber: l.auxiliaryAccountNumber,
    label: l.label,
    debit: posted && l.side === 'debit' ? l.bookAmount : null,
    credit: posted && l.side === 'credit' ? l.bookAmount : null,
    currency: l.currency,
    amount: l.amount,
    rate: l.rate,
    rateSource: l.rateSource,
    rateRef: l.rateRef,
    letteringCode: l.letteringCode,
    operationKey: l.operationKey,
    suspenseReason: l.suspenseReason,
    exchangeDifference: l.exchangeDifference,
  };
}

/** Vue d'API d'une écriture enregistrée. */
export function entryView(d: AccountingEntryLean, labels: ReadonlyMap<string, string>): AccountingEntryView {
  const id = String(d._id);
  return {
    id,
    journalCode: d.journalCode,
    journalKind: d.journalKind,
    fiscalYear: d.fiscalYear,
    number: d.number,
    date: d.date,
    status: d.status,
    bookCurrency: d.bookCurrency,
    label: d.label,
    source: d.source
      ? {
          kind: d.source.kind as AccountingSourceKind,
          id: d.source.id,
          event: d.source.event,
          number: d.source.number,
          date: d.source.date,
          partyName: d.source.partyName,
        }
      : null,
    sourceKey: d.sourceKey,
    lines: d.lines.map((l, i) => lineView(id, i, l, labels)),
    reversalOf: d.reversalOf,
    reversedBy: d.reversedBy,
    reversalReason: d.reversalReason,
    generation: d.generation,
    manual: d.manual,
    suspense: d.suspense,
    seq: d.seq,
    hash: d.hash,
    postedAt: toIso(d.postedAt),
    simulation: false,
    revision: d.revision,
  };
}
