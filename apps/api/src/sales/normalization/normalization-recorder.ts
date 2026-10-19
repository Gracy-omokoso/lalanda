// Écritures de la normalisation DGI — ADR-0024 § 3, § 4.1, § 4.3, § 4.4.
//
// SEUL fichier de `sales/normalization/` qui écrit `sales_invoices`, et SEUL
// ÉCRIVAIN du statut « facture normalisée » de toute l'API (test de lecture des
// sources) : `recordNormalized`, appelé par la requête de l'utilisateur ET par
// le rattrapage.
//
// Règles tenues ici :
//  - chaque écriture est conditionnée par la phase lue, l'`attemptId` de la
//    tentative et la prise en main (`claim`) : une écriture rejouée, ou faite
//    par une instance qui a perdu la main, ne change rien ;
//  - chaque transition s'écrit avec son entrée de journal électronique et son
//    numéro (réservé, rendu, abandonné, confirmé) dans UNE transaction ;
//  - aucune facture normalisée sans les CINQ éléments de sécurité, tels que
//    reçus de la DGI : un élément vide est une erreur de programmation.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import type { EdefSecurityElements } from '../../edef/edef-invoice.types.js';
import { inFiscalTransaction } from '../../fiscal/fiscal-transaction.js';
import type { NormalizationTimings } from '../../platform-config/dgi-platform.config.js';
import { isObjectIdHex } from '../search.js';
import {
  InvoiceJournalService,
  type JournalAppendInput,
} from '../invoices/invoice-journal.service.js';
import {
  InvoiceNumberingService,
  NORMALIZATION_LEASE_MS,
  parseInvoiceNumber,
} from '../invoices/invoice-numbering.service.js';
import type { JournalEvent, NormalizationErrorCategory } from '../invoices/invoice.contract.js';
import { SalesInvoice, type SalesInvoiceDocument } from '../invoices/invoice.schema.js';
import type { InvoiceLean } from '../invoices/invoice.types.js';
import type {
  InvoiceNormalizationState,
  NormalizationPhase,
  NormalizationUncertainStep,
} from '../invoices/normalization.port.js';
import type { BuiltEdefRequest } from './request-builder.js';

/** Phases « en vol » : un appel DGI peut être parti (§ 4.1). */
export const IN_FLIGHT_PHASES: readonly NormalizationPhase[] = [
  'submitting',
  'comparing',
  'cancelling',
  'confirming',
];

/** Revérification d'un document `needs_review` : toutes les 15 min pendant 7 jours, puis chaque jour. */
export const REVIEW_RECHECK_MS = 15 * 60_000;
export const REVIEW_RECHECK_DAILY_AFTER_MS = 7 * 24 * 3600_000;
export const REVIEW_RECHECK_DAILY_MS = 24 * 3600_000;

/** Tentative en cours : document, tentative et prise en main qui conditionnent chaque écriture. */
export interface AttemptRef {
  organizationId: string;
  invoiceId: string;
  attemptId: string;
  /** `normalization.claim.attemptId` posé par celui qui tient la main. */
  claimId: string;
}

export interface NormalizationError {
  code: string;
  message: string;
  category: NormalizationErrorCategory;
  dgiErrorCode?: string | null;
  dgiMessage?: string | null;
  retryable: boolean;
}

/** Auteur : une personne (requête), ou `null` pour l'ordonnanceur. */
export interface RecorderActor {
  userId: string;
  name: string;
  role: string;
}

const SCHEDULER_AUDIT_ACTOR = { actorUserId: 'system:scheduler', actorRole: 'system' } as const;

export type ClaimForSubmission =
  | {
      kind: 'claimed';
      ref: AttemptRef;
      doc: InvoiceLean;
      rn: string;
      request: BuiltEdefRequest;
    }
  /** Une autre requête tient la main, ou le document n'est plus `queued`. */
  | { kind: 'not_queued'; doc: InvoiceLean | null }
  /** Bail de numérotation tenu par une autre facture. */
  | { kind: 'lease_busy' }
  /** Prérequis manquant découvert à la construction du corps (aucun numéro consommé). */
  | { kind: 'build_failed'; error: unknown };

function oid(invoiceId: string): Types.ObjectId {
  return new Types.ObjectId(invoiceId);
}

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * `dateTime` de la DGI → instant. Sans fuseau, la date est lue à l'heure de
 * Kinshasa (UTC+1, ADR-0024 § 4.3 ; format exact : question DGI n° 5).
 * `null` si illisible : l'appelant prend alors l'heure du serveur.
 */
export function parseDgiDateTime(raw: string): Date | null {
  const s = raw.trim();
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) iso = s;
  else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
    iso = `${s.replace(' ', 'T')}+01:00`;
  } else {
    const m = /^(\d{2})[/.-](\d{2})[/.-](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (m) iso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+01:00`;
  }
  if (iso === null) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Injectable()
export class NormalizationRecorder {
  private readonly logger = new Logger('Normalisation');

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoiceDocument>,
    @Inject(InvoiceNumberingService) private readonly numbering: InvoiceNumberingService,
    @Inject(InvoiceJournalService) private readonly journal: InvoiceJournalService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Lectures ───────────────────────────────────────────────────────────────

  async load(organizationId: string, invoiceId: string): Promise<InvoiceLean | null> {
    if (!isObjectIdHex(invoiceId)) return null;
    return this.invoices
      .findOne({ _id: oid(invoiceId), organizationId })
      .lean<InvoiceLean>()
      .exec();
  }

  /**
   * Documents que le rattrapage doit reprendre (§ 4.2) : `uncertain` ou
   * `needs_review` dont la vérification est échue, ou une phase « en vol » dont
   * la prise en main a expiré (processus arrêté). Aucune prise en main vivante.
   */
  async findDue(now: Date, limit: number): Promise<InvoiceLean[]> {
    return this.invoices
      .find({
        status: 'pending_normalization',
        $and: [
          {
            $or: [
              {
                'normalization.phase': { $in: ['uncertain', 'needs_review'] },
                'normalization.reconcileAfter': { $lte: now },
              },
              {
                'normalization.phase': { $in: IN_FLIGHT_PHASES },
                'normalization.claim.until': { $lte: now },
              },
            ],
          },
          {
            $or: [{ 'normalization.claim': null }, { 'normalization.claim.until': { $lte: now } }],
          },
        ],
      })
      .sort({ 'normalization.reconcileAfter': 1, _id: 1 })
      .limit(limit)
      .lean<InvoiceLean[]>()
      .exec();
  }

  // ── Requête de l'utilisateur ──────────────────────────────────────────────

  /**
   * Prise en main (transaction T1, § 3.1) : document `queued` sans prise en main
   * vivante → `submitting`, numéro réservé sous bail, corps construit et son
   * empreinte figée, `number_reserved` journalisé si le numéro est nouveau.
   */
  async claimForSubmission(
    organizationId: string,
    invoiceId: string,
    input: {
      now: Date;
      attemptId: string;
      claimMs: number;
      series: 'real' | 'test';
      build: (doc: InvoiceLean, rn: string) => BuiltEdefRequest;
      actor: RecorderActor | null;
    },
  ): Promise<ClaimForSubmission> {
    const { now, attemptId } = input;
    try {
      return await inFiscalTransaction(this.connection, async (session) => {
        const doc = await this.invoices
          .findOne({ _id: oid(invoiceId), organizationId }, null, { session })
          .lean<InvoiceLean>()
          .exec();
        if (!doc || doc.status !== 'pending_normalization' || !doc.normalization) {
          return { kind: 'not_queued', doc } as const;
        }
        const n = doc.normalization;
        if ((n.phase ?? 'queued') !== 'queued') return { kind: 'not_queued', doc } as const;
        if (n.claim && new Date(n.claim.until).getTime() > now.getTime()) {
          return { kind: 'not_queued', doc } as const;
        }
        const before = n.reservedNumber ?? null;
        const reserved = await this.numbering.reserve(organizationId, invoiceId, input.series, {
          session,
          now,
        });
        const request = input.build(doc, reserved.number);
        const res = await this.invoices
          .updateOne(
            {
              _id: doc._id,
              organizationId,
              status: 'pending_normalization',
              $or: [{ 'normalization.phase': 'queued' }, { 'normalization.phase': null }],
            },
            {
              $set: {
                'normalization.phase': 'submitting',
                'normalization.attemptId': attemptId,
                'normalization.claim': {
                  attemptId,
                  until: new Date(now.getTime() + input.claimMs),
                },
                'normalization.lastAttemptAt': now,
                'normalization.reservedNumber': reserved.number,
                'normalization.requestSha256': request.sha256,
                'normalization.uncertainStep': null,
                'normalization.uid': null,
                'normalization.dgiTotals': null,
                'normalization.lastError': null,
                'normalization.differences': null,
                'normalization.submittedAt': null,
                'normalization.confirmStartedAt': null,
                'normalization.reconcileAfter': null,
                'normalization.uncertainSince': null,
                'normalization.review': null,
              },
              $inc: { 'normalization.attempts': 1 },
            },
            { session },
          )
          .exec();
        if (res.matchedCount !== 1) return { kind: 'not_queued', doc } as const;
        if (before === null) {
          await this.appendJournal(
            organizationId,
            doc,
            'number_reserved',
            { number: reserved.number },
            input.actor,
            session,
          );
        }
        return {
          kind: 'claimed',
          ref: { organizationId, invoiceId, attemptId, claimId: attemptId },
          doc,
          rn: reserved.number,
          request,
        } as const;
      });
    } catch (err) {
      if (
        err instanceof ConflictException &&
        (err.getResponse() as { code?: string }).code === 'NORMALIZATION_IN_PROGRESS'
      ) {
        return { kind: 'lease_busy' };
      }
      if (err instanceof Error && err.name === 'NormalizationPreconditionError') {
        return { kind: 'build_failed', error: err };
      }
      throw err;
    }
  }

  /** Bail tenu ailleurs : le document reste `queued`, avec la raison (§ 3.1). */
  async markQueuedBlocked(
    organizationId: string,
    invoiceId: string,
    error: NormalizationError,
  ): Promise<void> {
    await this.invoices
      .updateOne(
        {
          _id: oid(invoiceId),
          organizationId,
          status: 'pending_normalization',
          $or: [{ 'normalization.phase': 'queued' }, { 'normalization.phase': null }],
        },
        { $set: { 'normalization.phase': 'queued', 'normalization.lastError': error } },
      )
      .exec();
  }

  /** Prérequis manquant AVANT la prise en main : `failed`, aucun numéro consommé (§ 3.2). */
  async failQueued(
    organizationId: string,
    invoiceId: string,
    error: NormalizationError,
    actor: RecorderActor | null,
  ): Promise<boolean> {
    return inFiscalTransaction(this.connection, async (session) => {
      const doc = await this.invoices
        .findOne({ _id: oid(invoiceId), organizationId }, null, { session })
        .lean<InvoiceLean>()
        .exec();
      if (!doc || doc.status !== 'pending_normalization') return false;
      if ((doc.normalization?.phase ?? 'queued') !== 'queued') return false;
      await this.settleFailure(doc, error, null, actor, session, {
        $or: [{ 'normalization.phase': 'queued' }, { 'normalization.phase': null }],
      });
      return true;
    });
  }

  async toComparing(
    ref: AttemptRef,
    input: { uid: string; dgiTotals: Record<string, string>; submittedAt: Date },
  ): Promise<boolean> {
    return this.transition(ref, ['submitting'], {
      'normalization.phase': 'comparing',
      'normalization.uid': input.uid,
      'normalization.dgiTotals': input.dgiTotals,
      'normalization.submittedAt': input.submittedAt,
    });
  }

  /** Avant l'annulation : `differences` non nul = écart de totaux (cause non réessayable). */
  async toCancelling(
    ref: AttemptRef,
    differences: InvoiceNormalizationState['differences'],
  ): Promise<boolean> {
    return this.transition(ref, ['comparing', 'confirming'], {
      'normalization.phase': 'cancelling',
      'normalization.differences': differences,
    });
  }

  async toConfirming(ref: AttemptRef, now: Date): Promise<boolean> {
    return this.transition(ref, ['comparing'], {
      'normalization.phase': 'confirming',
      'normalization.confirmStartedAt': now,
    });
  }

  /**
   * Étape restée sans réponse sûre → `uncertain` (§ 4.1). Le bail du numéro est
   * PROLONGÉ jusqu'au rattrapage + 3 min. `normalization_uncertain` est
   * journalisé à l'entrée seulement.
   */
  async recordUncertain(
    ref: AttemptRef,
    input: {
      from: readonly NormalizationPhase[];
      step: NormalizationUncertainStep;
      error: NormalizationError;
      now: Date;
      timings: NormalizationTimings;
      actor: RecorderActor | null;
    },
  ): Promise<boolean> {
    const reconcileAfter = new Date(input.now.getTime() + input.timings.reconcileDelayMs);
    return inFiscalTransaction(this.connection, async (session) => {
      const doc = await this.findLive(ref, input.from, session);
      if (!doc) return false;
      const n = doc.normalization!;
      await this.invoices
        .updateOne(this.liveFilter(ref, input.from), {
          $set: {
            'normalization.phase': 'uncertain',
            'normalization.uncertainStep': input.step,
            'normalization.uncertainSince': n.uncertainSince ?? input.now,
            'normalization.reconcileAfter': reconcileAfter,
            'normalization.claim': null,
            'normalization.lastError': input.error,
          },
        })
        .session(session)
        .exec();
      await this.numbering.holdLease(
        ref.organizationId,
        ref.invoiceId,
        new Date(reconcileAfter.getTime() + NORMALIZATION_LEASE_MS),
        { session },
      );
      if (n.phase !== 'uncertain') {
        await this.appendJournal(
          ref.organizationId,
          doc,
          'normalization_uncertain',
          { number: n.reservedNumber ?? null },
          input.actor,
          session,
        );
      }
      return true;
    });
  }

  /**
   * Refus SÛR → `normalization_failed` (§ 3, § 4.2) : numéro rendu (ou, s'il ne
   * peut plus l'être, abandonné et tracé), journal, audit.
   */
  async recordFailed(
    ref: AttemptRef,
    input: {
      from: readonly NormalizationPhase[];
      error: NormalizationError;
      differences?: InvoiceNormalizationState['differences'];
      actor: RecorderActor | null;
    },
  ): Promise<boolean> {
    return inFiscalTransaction(this.connection, async (session) => {
      const doc = await this.findLive(ref, input.from, session);
      if (!doc) return false;
      await this.settleFailure(
        doc,
        input.error,
        input.differences === undefined
          ? (doc.normalization?.differences ?? null)
          : input.differences,
        input.actor,
        session,
        this.liveConditions(ref, input.from),
      );
      return true;
    });
  }

  /**
   * « Vérification nécessaire » (§ 4.4) : Lalanda ne sait pas si la DGI a
   * normalisé. Bail RELÂCHÉ, numéro gardé ; revérification automatique.
   */
  async recordNeedsReview(
    ref: AttemptRef,
    input: {
      from: readonly NormalizationPhase[];
      reason: string;
      error: NormalizationError;
      now: Date;
    },
  ): Promise<boolean> {
    return inFiscalTransaction(this.connection, async (session) => {
      const doc = await this.findLive(ref, input.from, session);
      if (!doc) return false;
      const n = doc.normalization!;
      await this.invoices
        .updateOne(this.liveFilter(ref, input.from), {
          $set: {
            'normalization.phase': 'needs_review',
            'normalization.review': { since: input.now, reason: input.reason },
            'normalization.reconcileAfter': new Date(input.now.getTime() + REVIEW_RECHECK_MS),
            'normalization.claim': null,
            'normalization.lastError': input.error,
          },
        })
        .session(session)
        .exec();
      await this.numbering.dropLease(ref.organizationId, ref.invoiceId, { session });
      await this.appendJournal(
        ref.organizationId,
        doc,
        'normalization_review_required',
        { number: n.reservedNumber ?? null },
        null,
        session,
      );
      await this.audit.record(
        {
          organizationId: ref.organizationId,
          ...SCHEDULER_AUDIT_ACTOR,
          action: 'sales_invoice.normalization_review_required',
          targetType: 'sales_invoice',
          targetId: ref.invoiceId,
          metadata: { reason: input.reason, uid: n.uid ?? null },
        },
        { session },
      );
      return true;
    });
  }

  /**
   * DGI injoignable pendant le rattrapage : la main est rendue, la phase reste,
   * prochaine vérification à `nextAt` ; en incertitude, le bail suit.
   */
  async postpone(
    ref: AttemptRef,
    input: {
      from: readonly NormalizationPhase[];
      nextAt: Date;
      error: NormalizationError | null;
      /** Phase « en vol » reprise après un arrêt : elle se lit désormais `uncertain(step)`. */
      step?: NormalizationUncertainStep;
      now?: Date;
    },
  ): Promise<boolean> {
    return inFiscalTransaction(this.connection, async (session) => {
      const doc = await this.findLive(ref, input.from, session);
      if (!doc) return false;
      const n = doc.normalization!;
      const set: Record<string, unknown> = {
        'normalization.reconcileAfter': input.nextAt,
        'normalization.claim': null,
      };
      if (input.error) set['normalization.lastError'] = input.error;
      const inFlight = IN_FLIGHT_PHASES.includes(n.phase);
      if (inFlight && input.step) {
        set['normalization.phase'] = 'uncertain';
        set['normalization.uncertainStep'] = input.step;
        set['normalization.uncertainSince'] = n.uncertainSince ?? input.now ?? new Date();
      }
      await this.invoices
        .updateOne(this.liveFilter(ref, input.from), { $set: set })
        .session(session)
        .exec();
      if (n.phase === 'uncertain' || (inFlight && input.step)) {
        await this.numbering.holdLease(
          ref.organizationId,
          ref.invoiceId,
          new Date(input.nextAt.getTime() + NORMALIZATION_LEASE_MS),
          { session },
        );
      }
      return true;
    });
  }

  /**
   * LE VERROU (§ 4.3) — seul chemin vers « facture normalisée ».
   *
   * Dans une transaction : les cinq éléments de sécurité non vides (sinon erreur
   * de programmation), numéro réservé confirmé à la date DGI, statut
   * `normalized` et éléments TELS QUE REÇUS, journal `normalized`, audit.
   * Rejoué sur un document déjà enregistré avec les mêmes éléments : sans effet.
   */
  async recordNormalized(
    ref: AttemptRef,
    input: {
      from: readonly NormalizationPhase[];
      security: EdefSecurityElements;
      actor: RecorderActor | null;
      now: Date;
      /** NIM du point de vente : un NIM reçu différent est une alerte, pas un refus. */
      expectedNim: string | null;
    },
  ): Promise<'recorded' | 'already' | 'lost'> {
    const s = input.security;
    if (
      !nonEmpty(s.codeDefDgi) ||
      !nonEmpty(s.nim) ||
      !nonEmpty(s.counters) ||
      !nonEmpty(s.dateTime) ||
      !nonEmpty(s.qrCode)
    ) {
      throw new Error(
        'Enregistrement d’une normalisation sans les cinq éléments de sécurité : refusé (erreur de programmation).',
      );
    }
    const outcome = await inFiscalTransaction(this.connection, async (session) => {
      const current = await this.invoices
        .findOne({ _id: oid(ref.invoiceId), organizationId: ref.organizationId }, null, { session })
        .lean<InvoiceLean>()
        .exec();
      if (!current) return 'lost' as const;
      if (current.status === 'normalized') {
        return current.normalization?.codeDefDgi === s.codeDefDgi
          ? ('already' as const)
          : ('lost' as const);
      }
      const doc = await this.findLive(ref, input.from, session);
      if (!doc) return 'lost' as const;
      const issuedAt = parseDgiDateTime(s.dateTime) ?? input.now;
      // Numéro réservé → définitif (`number`, `issuedAt` borné par `lastIssuedAt`).
      await this.numbering.confirm(ref.organizationId, ref.invoiceId, issuedAt, { session });
      const res = await this.invoices
        .updateOne(
          {
            _id: doc._id,
            organizationId: ref.organizationId,
            status: 'pending_normalization',
            'normalization.attemptId': ref.attemptId,
          },
          {
            $set: {
              status: 'normalized',
              'normalization.phase': 'done',
              'normalization.codeDefDgi': s.codeDefDgi,
              'normalization.nim': s.nim,
              'normalization.counters': s.counters,
              'normalization.dgiDateTime': s.dateTime,
              'normalization.qrCode': s.qrCode,
              'normalization.normalizedAt': input.now,
              'normalization.claim': null,
              'normalization.lastError': null,
              'normalization.uncertainStep': null,
              'normalization.reconcileAfter': null,
              'normalization.review': null,
            },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1)
        throw new Error('Normalisation perdue en cours d’enregistrement.');
      await this.appendJournal(
        ref.organizationId,
        doc,
        'normalized',
        {
          number: doc.normalization?.reservedNumber ?? null,
          codeDefDgi: s.codeDefDgi,
          nim: s.nim,
          counters: s.counters,
        },
        input.actor,
        session,
      );
      await this.audit.record(
        {
          organizationId: ref.organizationId,
          ...(input.actor
            ? { actorUserId: input.actor.userId, actorRole: input.actor.role }
            : SCHEDULER_AUDIT_ACTOR),
          action: 'sales_invoice.normalized',
          targetType: 'sales_invoice',
          targetId: ref.invoiceId,
          metadata: {
            number: doc.normalization?.reservedNumber ?? null,
            codeDefDgi: s.codeDefDgi,
            nim: s.nim,
            type: doc.type,
          },
        },
        { session },
      );
      return 'recorded' as const;
    });
    if (outcome === 'recorded' && input.expectedNim !== null && input.expectedNim !== s.nim) {
      this.logger.error(
        `ALERTE EDEF_NIM_MISMATCH : facture ${ref.invoiceId} normalisée par un NIM (${s.nim}) différent de celui du point de vente (${input.expectedNim}).`,
      );
      await this.audit.record({
        organizationId: ref.organizationId,
        ...SCHEDULER_AUDIT_ACTOR,
        action: 'sales_invoice.nim_mismatch',
        targetType: 'sales_invoice',
        targetId: ref.invoiceId,
        metadata: { received: s.nim, expected: input.expectedNim },
      });
    }
    return outcome;
  }

  // ── Actions humaines ──────────────────────────────────────────────────────

  /** `retry` depuis `failed` réessayable : retour en `queued`, même contenu figé. */
  async requeue(organizationId: string, invoiceId: string): Promise<boolean> {
    const res = await this.invoices
      .updateOne(
        {
          _id: oid(invoiceId),
          organizationId,
          status: 'normalization_failed',
          'normalization.phase': 'failed',
          'normalization.lastError.retryable': true,
        },
        {
          $set: {
            status: 'pending_normalization',
            'normalization.phase': 'queued',
            'normalization.lastError': null,
            'normalization.differences': null,
            'normalization.claim': null,
            'normalization.uncertainStep': null,
            'normalization.uid': null,
            'normalization.dgiTotals': null,
          },
        },
      )
      .exec();
    return res.matchedCount === 1;
  }

  /**
   * « Déclarer non normalisée » (§ 4.4) : seulement depuis `needs_review`.
   * Numéro rendu s'il est encore le dernier, sinon ABANDONNÉ (seul trou de la
   * série, tracé `number_abandoned`). Audit STRICT avec le motif.
   */
  async declareNotNormalized(
    organizationId: string,
    invoiceId: string,
    reason: string,
    actor: RecorderActor,
  ): Promise<'declared' | 'not_under_review'> {
    return inFiscalTransaction(this.connection, async (session) => {
      const doc = await this.invoices
        .findOne({ _id: oid(invoiceId), organizationId }, null, { session })
        .lean<InvoiceLean>()
        .exec();
      if (
        !doc ||
        doc.status !== 'pending_normalization' ||
        doc.normalization?.phase !== 'needs_review'
      ) {
        return 'not_under_review' as const;
      }
      await this.settleFailure(
        doc,
        {
          code: 'DECLARED_NOT_NORMALIZED',
          category: 'precondition',
          message:
            'Déclarée non normalisée après vérification auprès de la DGI : vous pouvez relancer la normalisation.',
          retryable: true,
        },
        doc.normalization.differences ?? null,
        actor,
        session,
        { 'normalization.phase': 'needs_review' },
        reason,
      );
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'sales_invoice.declared_not_normalized',
          targetType: 'sales_invoice',
          targetId: invoiceId,
          metadata: {
            reason,
            number: doc.normalization.reservedNumber ?? null,
            uid: doc.normalization.uid ?? null,
          },
        },
        { session },
      );
      return 'declared' as const;
    });
  }

  // ── Rattrapage ────────────────────────────────────────────────────────────

  /**
   * Prise en main par le rattrapage (§ 4.2) : une seule instance l'obtient.
   * `force` (route `check`) ignore l'échéance d'un document `needs_review`.
   */
  async claimForReconciliation(
    organizationId: string,
    invoiceId: string,
    input: { now: Date; claimId: string; claimMs: number; force: boolean },
  ): Promise<{ ref: AttemptRef; doc: InvoiceLean } | null> {
    const { now } = input;
    const due = input.force
      ? [{ 'normalization.phase': { $in: ['uncertain', 'needs_review'] } }]
      : [
          {
            'normalization.phase': { $in: ['uncertain', 'needs_review'] },
            'normalization.reconcileAfter': { $lte: now },
          },
        ];
    const doc = await this.invoices
      .findOneAndUpdate(
        {
          _id: oid(invoiceId),
          organizationId,
          status: 'pending_normalization',
          'normalization.attemptId': { $type: 'string' },
          $and: [
            {
              $or: [
                ...due,
                {
                  'normalization.phase': { $in: IN_FLIGHT_PHASES },
                  'normalization.claim.until': { $lte: now },
                },
              ],
            },
            {
              $or: [
                { 'normalization.claim': null },
                { 'normalization.claim.until': { $lte: now } },
              ],
            },
          ],
        },
        {
          $set: {
            'normalization.claim': {
              attemptId: input.claimId,
              until: new Date(now.getTime() + input.claimMs),
            },
          },
        },
        { new: true },
      )
      .lean<InvoiceLean>()
      .exec();
    if (!doc || !doc.normalization?.attemptId) return null;
    return {
      ref: {
        organizationId,
        invoiceId,
        attemptId: doc.normalization.attemptId,
        claimId: input.claimId,
      },
      doc,
    };
  }

  // ── Cohérence (tâche quotidienne, § 4.3) ──────────────────────────────────

  async findNormalizedWithoutSecurity(limit: number): Promise<InvoiceLean[]> {
    const missing = (field: string) => ({
      $or: [{ [field]: null }, { [field]: '' }, { [field]: { $exists: false } }],
    });
    return this.invoices
      .find({
        status: { $in: ['normalized'] },
        $or: [
          missing('normalization.codeDefDgi'),
          missing('normalization.qrCode'),
          missing('normalization.nim'),
          missing('normalization.counters'),
          missing('normalization.dgiDateTime'),
        ],
      })
      .limit(limit)
      .lean<InvoiceLean[]>()
      .exec();
  }

  async findReservedSince(cutoff: Date, limit: number): Promise<InvoiceLean[]> {
    return this.invoices
      .find({
        status: 'pending_normalization',
        'normalization.reservedNumber': { $type: 'string' },
        'normalization.lastAttemptAt': { $lte: cutoff },
      })
      .limit(limit)
      .lean<InvoiceLean[]>()
      .exec();
  }

  async findIssuedAfter(
    organizationId: string,
    since: Date,
    limit: number,
  ): Promise<InvoiceLean[]> {
    return this.invoices
      .find({ organizationId, status: { $in: ['issued'] }, issuedAt: { $gt: since } })
      .limit(limit)
      .lean<InvoiceLean[]>()
      .exec();
  }

  // ── Internes ──────────────────────────────────────────────────────────────

  private liveConditions(ref: AttemptRef, phases: readonly NormalizationPhase[]) {
    return {
      'normalization.attemptId': ref.attemptId,
      'normalization.claim.attemptId': ref.claimId,
      'normalization.phase': { $in: [...phases] },
    };
  }

  private liveFilter(ref: AttemptRef, phases: readonly NormalizationPhase[]) {
    return {
      _id: oid(ref.invoiceId),
      organizationId: ref.organizationId,
      status: 'pending_normalization',
      ...this.liveConditions(ref, phases),
    };
  }

  private async findLive(
    ref: AttemptRef,
    phases: readonly NormalizationPhase[],
    session: ClientSession,
  ): Promise<InvoiceLean | null> {
    return this.invoices
      .findOne(this.liveFilter(ref, phases), null, { session })
      .lean<InvoiceLean>()
      .exec();
  }

  private async transition(
    ref: AttemptRef,
    from: readonly NormalizationPhase[],
    set: Record<string, unknown>,
  ): Promise<boolean> {
    const res = await this.invoices.updateOne(this.liveFilter(ref, from), { $set: set }).exec();
    return res.matchedCount === 1;
  }

  /** `failed` + numéro rendu ou abandonné, dans la transaction de l'appelant. */
  private async settleFailure(
    doc: InvoiceLean,
    error: NormalizationError,
    differences: InvoiceNormalizationState['differences'],
    actor: RecorderActor | null,
    session: ClientSession,
    conditions: Record<string, unknown>,
    abandonReason?: string,
  ): Promise<void> {
    const organizationId = doc.organizationId;
    const invoiceId = String(doc._id);
    const reserved = doc.normalization?.reservedNumber ?? null;
    let numberEvent: 'number_released' | 'number_abandoned' | null = null;
    if (reserved !== null) {
      const { released } = await this.numbering.release(organizationId, invoiceId, { session });
      if (released) numberEvent = 'number_released';
      else {
        await this.numbering.abandon(
          organizationId,
          invoiceId,
          abandonReason ?? `Normalisation refusée (${error.code}) ; numéro suivant déjà pris.`,
          { session },
        );
        numberEvent = 'number_abandoned';
      }
    }
    const res = await this.invoices
      .updateOne(
        { _id: doc._id, organizationId, status: 'pending_normalization', ...conditions },
        {
          $set: {
            status: 'normalization_failed',
            'normalization.phase': 'failed',
            'normalization.lastError': error,
            'normalization.differences': differences,
            'normalization.claim': null,
            'normalization.uncertainStep': null,
            'normalization.reconcileAfter': null,
            'normalization.review': null,
            'normalization.reservedNumber': null,
          },
        },
        { session },
      )
      .exec();
    if (res.matchedCount !== 1)
      throw new Error('Échec de normalisation perdu en cours d’écriture.');
    await this.appendJournal(
      organizationId,
      doc,
      'normalization_failed',
      { number: null },
      actor,
      session,
    );
    if (numberEvent !== null) {
      await this.appendJournal(
        organizationId,
        doc,
        numberEvent,
        { number: reserved },
        actor,
        session,
      );
    }
    if (numberEvent === 'number_abandoned') {
      this.logger.warn(
        `Numéro ${reserved} abandonné (trou tracé dans la série) pour le document ${invoiceId}.`,
      );
    }
    await this.audit.record(
      {
        organizationId,
        ...(actor ? { actorUserId: actor.userId, actorRole: actor.role } : SCHEDULER_AUDIT_ACTOR),
        action: 'sales_invoice.normalization_failed',
        targetType: 'sales_invoice',
        targetId: invoiceId,
        metadata: {
          code: error.code,
          category: error.category,
          dgiErrorCode: error.dgiErrorCode ?? null,
          retryable: error.retryable,
          number: reserved,
          numberOutcome: numberEvent,
          ...(abandonReason && numberEvent === 'number_abandoned' ? { reason: abandonReason } : {}),
        },
      },
      { session },
    );
  }

  private async appendJournal(
    organizationId: string,
    doc: InvoiceLean,
    event: JournalEvent,
    extra: { number: string | null; codeDefDgi?: string; nim?: string; counters?: string },
    actor: RecorderActor | null,
    session: ClientSession,
  ): Promise<void> {
    const totals = doc.documentAmounts.calculation.totals;
    const n = doc.normalizedAmounts;
    const parsed = extra.number ? parseInvoiceNumber(extra.number) : null;
    const input: JournalAppendInput = {
      event,
      invoiceId: String(doc._id),
      proformaRef: doc.proformaRef,
      number: extra.number,
      series: parsed && parsed.series !== 'proforma' ? parsed.series : null,
      type: doc.type,
      creditNature: doc.creditNote?.nature ?? null,
      originNumber: doc.creditNote?.originNumber ?? null,
      documentTotals: totals
        ? { currency: doc.currency, total: totals.total, vatTotal: totals.vatTotal }
        : null,
      normalizedTotals: n
        ? {
            total: n.calculation.total,
            vatTotal: n.calculation.vatTotal,
            specificTax: n.calculation.specificTax,
          }
        : null,
      conversion: doc.conversion
        ? {
            rate: doc.conversion.rate,
            rateDate: doc.conversion.rateDate,
            rateSource: doc.conversion.rateSource,
          }
        : null,
      contentSha256: doc.contentSha256 ?? null,
      codeDefDgi: extra.codeDefDgi ?? null,
      nim: extra.nim ?? null,
      counters: extra.counters ?? null,
      actor: actor ? { userId: actor.userId, name: actor.name } : null,
    };
    await this.journal.append(organizationId, input, { session });
  }
}
