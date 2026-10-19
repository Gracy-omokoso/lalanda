// Journal électronique des documents de vente — ADR-0023 § S25e.12.
//
// SEUL ÉCRIVAIN de `sales_invoice_journal` et de `sales_journal_heads` (test de
// lecture des sources). Ajout seul : aucune méthode ne modifie ni ne supprime
// une entrée. Chaque transition s'écrit avec son entrée DANS LA MÊME
// TRANSACTION (`append` exige une session) ; `seq` part de 1 par organisation,
// sans trou, et `hash` = sha256(prevHash + forme canonique) chaîne les entrées.
//
// Exporté : S25f l'appelle pour ses propres transitions (`number_reserved`,
// `normalized`, `normalization_failed`, `number_released`).

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';

import { invalidCursor } from '../sales.errors.js';
import { JOURNAL_GENESIS_HASH, journalHash } from './canonical.js';
import type {
  ConversionRateSource,
  CreditNoteNature,
  DocumentCurrency,
  InvoiceSeries,
  InvoiceType,
  JournalEntryView,
  JournalEvent,
  JournalPage,
} from './invoice.contract.js';
import {
  SalesInvoiceJournalEntry,
  type SalesInvoiceJournalEntryDocument,
} from './invoice-journal.schema.js';
import { SalesJournalHead, type SalesJournalHeadDocument } from './journal-head.schema.js';

/** Ce que l'appelant fournit ; `seq`, `at`, `prevHash` et `hash` sont posés ici. */
export interface JournalAppendInput {
  event: JournalEvent;
  invoiceId: string | null;
  proformaRef: string | null;
  number: string | null;
  series: InvoiceSeries | null;
  type: InvoiceType | null;
  creditNature: CreditNoteNature | null;
  originNumber: string | null;
  documentTotals: { currency: DocumentCurrency; total: string; vatTotal: string } | null;
  normalizedTotals: { total: string; vatTotal: string; specificTax: string } | null;
  conversion: { rate: string; rateDate: string; rateSource: ConversionRateSource } | null;
  contentSha256: string | null;
  codeDefDgi: string | null;
  nim: string | null;
  counters: string | null;
  /** `null` pour l'ordonnanceur. */
  actor: { userId: string; name: string } | null;
}

/** Champs couverts par le hachage, dans une forme indépendante du stockage. */
function hashedFields(e: {
  organizationId: string;
  seq: number;
  at: Date;
} & JournalAppendInput): Record<string, unknown> {
  return {
    organizationId: e.organizationId,
    seq: e.seq,
    at: e.at.toISOString(),
    event: e.event,
    invoiceId: e.invoiceId,
    proformaRef: e.proformaRef,
    number: e.number,
    series: e.series,
    type: e.type,
    creditNature: e.creditNature,
    originNumber: e.originNumber,
    documentTotals: e.documentTotals,
    normalizedTotals: e.normalizedTotals,
    conversion: e.conversion,
    contentSha256: e.contentSha256,
    codeDefDgi: e.codeDefDgi,
    nim: e.nim,
    counters: e.counters,
    actor: e.actor,
  };
}

type EntryLean = SalesInvoiceJournalEntry;

function inputOf(doc: EntryLean): JournalAppendInput {
  return {
    event: doc.event,
    invoiceId: doc.invoiceId ?? null,
    proformaRef: doc.proformaRef ?? null,
    number: doc.number ?? null,
    series: (doc.series as InvoiceSeries | null) ?? null,
    type: (doc.type as InvoiceType | null) ?? null,
    creditNature: (doc.creditNature as CreditNoteNature | null) ?? null,
    originNumber: doc.originNumber ?? null,
    documentTotals:
      (doc.documentTotals as JournalAppendInput['documentTotals'] | null | undefined) ?? null,
    normalizedTotals: doc.normalizedTotals ?? null,
    conversion: (doc.conversion as JournalAppendInput['conversion'] | null | undefined) ?? null,
    contentSha256: doc.contentSha256 ?? null,
    codeDefDgi: doc.codeDefDgi ?? null,
    nim: doc.nim ?? null,
    counters: doc.counters ?? null,
    actor: doc.actor ?? null,
  };
}

function viewOf(doc: EntryLean): JournalEntryView {
  const input = inputOf(doc);
  return { seq: doc.seq, at: new Date(doc.at).toISOString(), ...input, hash: doc.hash };
}

@Injectable()
export class InvoiceJournalService {
  constructor(
    @InjectModel(SalesInvoiceJournalEntry.name)
    private readonly entries: Model<SalesInvoiceJournalEntryDocument>,
    @InjectModel(SalesJournalHead.name) private readonly heads: Model<SalesJournalHeadDocument>,
  ) {}

  /** Ajoute une entrée DANS la transaction de l'appelant ; renvoie son `seq`. */
  async append(
    organizationId: string,
    input: JournalAppendInput,
    opts: { session: ClientSession },
  ): Promise<{ seq: number; hash: string }> {
    // Incrément de la tête : deux transactions concurrentes s'y heurtent, la
    // seconde est rejouée et prend le `seq` suivant — sans trou.
    const head = await this.heads
      .findOneAndUpdate(
        { organizationId },
        { $inc: { seq: 1 }, $setOnInsert: { _schemaVersion: 1 } },
        { upsert: true, new: true, session: opts.session },
      )
      .lean<SalesJournalHead>()
      .exec();
    const prevHash = head.lastHash ?? JOURNAL_GENESIS_HASH;
    const at = new Date();
    const hash = journalHash(prevHash, hashedFields({ organizationId, seq: head.seq, at, ...input }));
    await this.heads
      .updateOne({ organizationId }, { $set: { lastHash: hash } }, { session: opts.session })
      .exec();
    await this.entries.create(
      [{ organizationId, seq: head.seq, at, ...input, prevHash, hash, _schemaVersion: 1 }],
      { session: opts.session },
    );
    return { seq: head.seq, hash };
  }

  /** Entrées, de la plus récente à la plus ancienne, avec l'état de la chaîne. */
  async list(
    organizationId: string,
    query: { limit: number; cursor?: string | undefined },
  ): Promise<JournalPage> {
    const filter: Record<string, unknown> = { organizationId };
    if (query.cursor !== undefined) {
      const before = decodeSeqCursor(query.cursor);
      if (before === null) invalidCursor();
      filter['seq'] = { $lt: before };
    }
    const docs = await this.entries
      .find(filter)
      .sort({ seq: -1 })
      .limit(query.limit + 1)
      .lean<EntryLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(viewOf),
      nextCursor: docs.length > query.limit && last ? encodeSeqCursor(last.seq) : null,
      chainValid: await this.verify(organizationId),
    };
  }

  /**
   * Chaîne intacte : `seq` 1, 2, 3… sans trou, chaque `prevHash` égal au `hash`
   * précédent, chaque `hash` recalculé à l'identique, et la tête cohérente.
   */
  async verify(organizationId: string): Promise<boolean> {
    const head = await this.heads.findOne({ organizationId }).lean<SalesJournalHead>().exec();
    let expectedSeq = 1;
    let prevHash = JOURNAL_GENESIS_HASH;
    const cursor = this.entries.find({ organizationId }).sort({ seq: 1 }).lean<EntryLean>().cursor();
    for await (const doc of cursor) {
      const entry = doc as EntryLean;
      if (entry.seq !== expectedSeq || entry.prevHash !== prevHash) return false;
      const recomputed = journalHash(
        prevHash,
        hashedFields({ organizationId, seq: entry.seq, at: new Date(entry.at), ...inputOf(entry) }),
      );
      if (recomputed !== entry.hash) return false;
      prevHash = entry.hash;
      expectedSeq += 1;
    }
    if (head === null) return expectedSeq === 1;
    return head.seq === expectedSeq - 1 && (head.lastHash ?? JOURNAL_GENESIS_HASH) === prevHash;
  }
}

function encodeSeqCursor(seq: number): string {
  return Buffer.from(JSON.stringify({ q: seq }), 'utf8').toString('base64url');
}

function decodeSeqCursor(raw: string): number | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const q = (parsed as Record<string, unknown>)['q'];
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1) return null;
    if (encodeSeqCursor(q) !== raw) return null;
    return q;
  } catch {
    return null;
  }
}
