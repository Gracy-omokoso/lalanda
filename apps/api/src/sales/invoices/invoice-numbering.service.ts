// Numérotation des documents de vente — ADR-0023 § S25e.3, O1, O2, O3.
//
// SEUL ÉCRIVAIN de `sales_invoice_counters` (test de lecture des sources).
//
// Garanties :
//   - le compteur est incrémenté DANS la transaction de l'appelant, qui écrit le
//     numéro sur le document dans la même transaction : un échec annule
//     l'incrément, aucun numéro n'est consommé ;
//   - deux transactions concurrentes écrivent le même compteur : la seconde subit
//     un conflit d'écriture, `withTransaction` la rejoue et elle prend le numéro
//     suivant — ni trou ni doublon ;
//   - `issuedAt` ne recule jamais : il est borné par `lastIssuedAt` du compteur ;
//   - en mode normalisé, un BAIL par organisation, série et année : une seule
//     facture à la fois entre réservation et issue DGI, ce qui permet de RENDRE
//     un numéro refusé sans laisser de trou.
//
// Année de gestion : année civile au fuseau Africa/Kinshasa (UTC+1, sans heure
// d'été) — à confirmer par l'expert-comptable (ADR-0023, décision ouverte n° 2).

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Model } from 'mongoose';

import { isObjectIdHex } from '../search.js';
import {
  SalesInvoiceCounter,
  type SalesInvoiceCounterDocument,
} from './invoice-counter.schema.js';
import { invoiceSearchKey } from './invoice-search.js';
import { SalesInvoice, type SalesInvoiceDocument } from './invoice.schema.js';
import type { InvoiceLean } from './invoice.types.js';
import { invoiceConflict, invoiceNotFound } from './invoices.errors.js';

/** Durée du bail de normalisation (≤ 3 min, § S25e.3). */
export const NORMALIZATION_LEASE_MS = 3 * 60 * 1000;

const KINSHASA_YEAR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Kinshasa',
  year: 'numeric',
});

/** Année de gestion d'un instant : année civile à Kinshasa. */
export function fiscalYearOf(at: Date): number {
  return Number.parseInt(KINSHASA_YEAR.format(at), 10);
}

type Series = 'real' | 'test' | 'proforma';

const PREFIX: Record<Series, string> = { real: '', test: 'TEST-', proforma: 'PF-' };

/** `AAAA-NNNNNN`, `TEST-AAAA-NNNNNN`, `PF-AAAA-NNNNNN` ; au-delà de 999 999, le nombre s'allonge. */
export function formatInvoiceNumber(series: Series, year: number, seq: number): string {
  return `${PREFIX[series]}${year}-${String(seq).padStart(6, '0')}`;
}

/** Lecture inverse de `formatInvoiceNumber` ; `null` si la forme est inconnue. */
export function parseInvoiceNumber(
  value: string,
): { series: Series; year: number; seq: number } | null {
  const m = /^(?:(TEST|PF)-)?(\d{4})-(\d{6,})$/.exec(value);
  if (!m) return null;
  const series: Series = m[1] === 'TEST' ? 'test' : m[1] === 'PF' ? 'proforma' : 'real';
  return { series, year: Number.parseInt(m[2]!, 10), seq: Number.parseInt(m[3]!, 10) };
}

type CounterLean = SalesInvoiceCounter & { _id: Types.ObjectId };

@Injectable()
export class InvoiceNumberingService {
  constructor(
    @InjectModel(SalesInvoiceCounter.name)
    private readonly counters: Model<SalesInvoiceCounterDocument>,
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoiceDocument>,
  ) {}

  /**
   * Mode ordinaire : numéro définitif de la série réelle, dans la transaction de
   * l'appelant. `opts.now` sert aux tests du passage d'année.
   */
  async assignOnIssue(
    organizationId: string,
    opts: { session: ClientSession; now?: Date },
  ): Promise<{ number: string; series: 'real'; fiscalYear: number; issuedAt: Date }> {
    const now = opts.now ?? new Date();
    const year = fiscalYearOf(now);
    const counter = await this.counters
      .findOneAndUpdate(
        { organizationId, series: 'real', year },
        {
          $inc: { last: 1 },
          $setOnInsert: { lastIssuedAt: null, inFlight: null, _schemaVersion: 1 },
        },
        { upsert: true, new: true, session: opts.session },
      )
      .lean<CounterLean>()
      .exec();
    // Lu APRÈS l'incrément : un numéro plus grand n'a jamais une date plus ancienne.
    const last = counter.lastIssuedAt ? new Date(counter.lastIssuedAt) : null;
    const issuedAt = last && last > now ? last : now;
    await this.counters
      .updateOne({ _id: counter._id }, { $set: { lastIssuedAt: issuedAt } }, { session: opts.session })
      .exec();
    return {
      number: formatInvoiceNumber('real', year, counter.last),
      series: 'real',
      fiscalYear: year,
      issuedAt,
    };
  }

  /** Référence de pro forma `PF-AAAA-NNNNNN` : hors série fiscale, trous admis. */
  async nextProformaRef(
    organizationId: string,
    opts: { session?: ClientSession; now?: Date } = {},
  ): Promise<string> {
    const year = fiscalYearOf(opts.now ?? new Date());
    const bump = () =>
      this.counters
        .findOneAndUpdate(
          { organizationId, series: 'proforma', year },
          {
            $inc: { last: 1 },
            $setOnInsert: { lastIssuedAt: null, inFlight: null, _schemaVersion: 1 },
          },
          { upsert: true, new: true, ...(opts.session ? { session: opts.session } : {}) },
        )
        .lean<CounterLean>()
        .exec();
    let counter: CounterLean;
    try {
      counter = await bump();
    } catch (err) {
      // Première création concurrente du compteur : la seconde bute sur l'index unique.
      if ((err as { code?: number }).code !== 11000 || opts.session) throw err;
      counter = await bump();
    }
    return formatInvoiceNumber('proforma', year, counter.last);
  }

  /**
   * Mode normalisé. Pose le bail (durée ≤ 3 min) et incrémente le compteur, dans
   * la transaction de l'appelant, qui écrit le numéro dans
   * `normalization.reservedNumber`. 409 NORMALIZATION_IN_PROGRESS si un bail non
   * expiré est tenu par une autre facture. Rejouée pour une facture qui détient
   * déjà un numéro réservé : renvoie le même.
   */
  async reserve(
    organizationId: string,
    invoiceId: string,
    series: 'real' | 'test',
    opts: { session: ClientSession; now?: Date },
  ): Promise<{ number: string; fiscalYear: number }> {
    const invoice = await this.requireInvoice(organizationId, invoiceId, opts.session);
    const already = invoice.normalization?.reservedNumber ?? null;
    if (already !== null) {
      const parsed = parseInvoiceNumber(already);
      if (parsed === null) throw new Error(`Numéro réservé illisible : ${already}`);
      return { number: already, fiscalYear: parsed.year };
    }

    const now = opts.now ?? new Date();
    const year = fiscalYearOf(now);
    const until = new Date(now.getTime() + NORMALIZATION_LEASE_MS);
    await this.counters
      .updateOne(
        { organizationId, series, year },
        { $setOnInsert: { last: 0, lastIssuedAt: null, inFlight: null, _schemaVersion: 1 } },
        { upsert: true, session: opts.session },
      )
      .exec();
    const counter = await this.counters
      .findOneAndUpdate(
        {
          organizationId,
          series,
          year,
          $or: [
            { inFlight: null },
            { 'inFlight.until': { $lte: now } },
            { 'inFlight.invoiceId': invoiceId },
          ],
        },
        { $inc: { last: 1 }, $set: { inFlight: { invoiceId, until } } },
        { new: true, session: opts.session },
      )
      .lean<CounterLean>()
      .exec();
    if (!counter) {
      invoiceConflict(
        'NORMALIZATION_IN_PROGRESS',
        'Une autre facture est en cours de normalisation : réessayez dans quelques instants.',
      );
    }
    return { number: formatInvoiceNumber(series, year, counter.last), fiscalYear: year };
  }

  /**
   * Normalisation réussie : le numéro réservé devient définitif (`number`,
   * `issuedAt`), `lastIssuedAt` avance, le bail tombe.
   */
  async confirm(
    organizationId: string,
    invoiceId: string,
    issuedAt: Date,
    opts: { session: ClientSession },
  ): Promise<void> {
    const invoice = await this.requireInvoice(organizationId, invoiceId, opts.session);
    const reserved = invoice.normalization?.reservedNumber ?? null;
    const parsed = reserved === null ? null : parseInvoiceNumber(reserved);
    if (reserved === null || parsed === null || parsed.series === 'proforma') {
      throw new Error(`Aucun numéro réservé à confirmer pour le document ${invoiceId}.`);
    }
    const key = { organizationId, series: parsed.series, year: parsed.year };
    const counter = await this.counters
      .findOneAndUpdate(key, { $max: { lastIssuedAt: issuedAt } }, { new: true, session: opts.session })
      .lean<CounterLean>()
      .exec();
    if (!counter) throw new Error(`Compteur absent pour le numéro réservé ${reserved}.`);
    await this.counters
      .updateOne(
        { ...key, 'inFlight.invoiceId': invoiceId },
        { $set: { inFlight: null } },
        { session: opts.session },
      )
      .exec();
    const effective = counter.lastIssuedAt ? new Date(counter.lastIssuedAt) : issuedAt;
    const res = await this.invoices
      .updateOne(
        { _id: invoice._id, organizationId, status: 'pending_normalization', number: null },
        {
          $set: {
            number: reserved,
            series: parsed.series,
            fiscalYear: parsed.year,
            issuedAt: effective,
            sortAt: effective,
            searchKey: invoiceSearchKey({ ...invoice, number: reserved }),
          },
        },
        { session: opts.session },
      )
      .exec();
    if (res.matchedCount !== 1) {
      throw new Error(`Le document ${invoiceId} n'est pas en attente de normalisation.`);
    }
  }

  /**
   * Refus définitif : rend le numéro si `last` vaut encore ce numéro (décrément
   * conditionnel), sinon le laisse réservé à cette facture ; le bail tombe.
   * L'appelant (S25f) efface `normalization.reservedNumber` quand `released`.
   */
  async release(
    organizationId: string,
    invoiceId: string,
    opts: { session: ClientSession },
  ): Promise<{ released: boolean }> {
    const invoice = await this.requireInvoice(organizationId, invoiceId, opts.session);
    const reserved = invoice.normalization?.reservedNumber ?? null;
    const parsed = reserved === null ? null : parseInvoiceNumber(reserved);
    if (parsed === null || parsed.series === 'proforma') {
      await this.counters
        .updateMany(
          { organizationId, 'inFlight.invoiceId': invoiceId },
          { $set: { inFlight: null } },
          { session: opts.session },
        )
        .exec();
      return { released: false };
    }
    const key = { organizationId, series: parsed.series, year: parsed.year };
    const res = await this.counters
      .updateOne(
        { ...key, last: parsed.seq },
        { $inc: { last: -1 }, $set: { inFlight: null } },
        { session: opts.session },
      )
      .exec();
    if (res.modifiedCount === 1) return { released: true };
    await this.counters
      .updateOne(
        { ...key, 'inFlight.invoiceId': invoiceId },
        { $set: { inFlight: null } },
        { session: opts.session },
      )
      .exec();
    return { released: false };
  }

  private async requireInvoice(
    organizationId: string,
    invoiceId: string,
    session: ClientSession,
  ): Promise<InvoiceLean> {
    if (!isObjectIdHex(invoiceId)) invoiceNotFound();
    const doc = await this.invoices
      .findOne({ _id: new Types.ObjectId(invoiceId), organizationId }, null, { session })
      .lean<InvoiceLean>()
      .exec();
    if (!doc) invoiceNotFound();
    return doc;
  }
}
