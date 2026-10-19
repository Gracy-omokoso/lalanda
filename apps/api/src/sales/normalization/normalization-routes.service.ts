// Actions humaines sur une normalisation — ADR-0024 § 9.1.
//
// `retry` refait l'étape 1 avec le MÊME contenu figé ; `check` lance tout de
// suite le rattrapage quand il est dû ; `declare-not-normalized` conclut un
// `needs_review` après vérification auprès de la DGI. Un refus de la DGI n'est
// pas une erreur HTTP : ces routes rendent la vue du document (200).

import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type {
  DgiExchangePage,
  DgiExchangeView,
  InvoiceView,
} from '../invoices/invoice.contract.js';
import { InvoiceDraftsService } from '../invoices/invoice-drafts.service.js';
import type { InvoiceActor } from '../invoices/invoice.types.js';
import { invoiceConflict, invoiceNotFound } from '../invoices/invoices.errors.js';
import type { NormalizationPhase } from '../invoices/normalization.port.js';
import { EdefSalesInvoiceNormalizer } from './edef-normalizer.js';
import { NormalizationRecorder } from './normalization-recorder.js';
import { NormalizationReconciliationJob } from './reconciliation.job.js';

/** Plafond défensif d'une page d'échanges (≈ six entrées par tentative). */
const MAX_EXCHANGES = 500;

const VIEW_PHASE: Readonly<Record<NormalizationPhase, string>> = {
  queued: 'queued',
  submitting: 'in_progress',
  comparing: 'in_progress',
  cancelling: 'in_progress',
  confirming: 'in_progress',
  uncertain: 'uncertain',
  needs_review: 'needs_review',
  done: 'done',
  failed: 'failed',
};

interface ExchangeDoc {
  _id: unknown;
  at: Date;
  exchangeId?: string | null;
  entry?: 'request' | 'response' | 'complete' | null;
  method: string;
  path: string;
  httpStatus?: number | null;
  durationMs?: number | null;
  outcome?: string | null;
  dgiErrorCode?: string | null;
  requestBody?: string | null;
  responseBody?: string | null;
}

@Injectable()
export class NormalizationRoutesService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(NormalizationRecorder) private readonly recorder: NormalizationRecorder,
    @Inject(EdefSalesInvoiceNormalizer) private readonly normalizer: EdefSalesInvoiceNormalizer,
    @Inject(NormalizationReconciliationJob)
    private readonly reconciliation: NormalizationReconciliationJob,
    @Inject(InvoiceDraftsService) private readonly drafts: InvoiceDraftsService,
  ) {}

  async retry(
    organizationId: string,
    invoiceId: string,
    actor: InvoiceActor,
  ): Promise<InvoiceView> {
    const doc = await this.recorder.load(organizationId, invoiceId);
    if (!doc) invoiceNotFound();
    const phase = (doc.normalization?.phase ?? 'queued') as NormalizationPhase;
    const retryableFailure =
      doc.status === 'normalization_failed' &&
      phase === 'failed' &&
      doc.normalization?.lastError?.retryable === true;
    const queued = doc.status === 'pending_normalization' && phase === 'queued';
    if (!retryableFailure && !queued) {
      invoiceConflict(
        'NORMALIZATION_NOT_RETRYABLE',
        'Cette normalisation ne se relance pas dans son état actuel.',
        { phase: doc.normalization ? VIEW_PHASE[phase] : null, status: doc.status },
      );
    }
    if (retryableFailure) await this.recorder.requeue(organizationId, invoiceId);
    await this.normalizer.run(organizationId, invoiceId, actor);
    return this.drafts.view(organizationId, invoiceId);
  }

  async check(organizationId: string, invoiceId: string): Promise<InvoiceView> {
    const doc = await this.recorder.load(organizationId, invoiceId);
    if (!doc) invoiceNotFound();
    const n = doc.normalization;
    const now = this.normalizer.clock();
    if (doc.status === 'pending_normalization' && n) {
      const due =
        n.phase === 'uncertain' &&
        (n.reconcileAfter === null ||
          n.reconcileAfter === undefined ||
          new Date(n.reconcileAfter).getTime() <= now.getTime());
      if (due || n.phase === 'needs_review') {
        await this.reconciliation.reconcileOne(
          organizationId,
          invoiceId,
          now,
          n.phase === 'needs_review',
        );
      }
    }
    return this.drafts.view(organizationId, invoiceId);
  }

  async declareNotNormalized(
    organizationId: string,
    invoiceId: string,
    reason: string,
    actor: InvoiceActor,
  ): Promise<InvoiceView> {
    const doc = await this.recorder.load(organizationId, invoiceId);
    if (!doc) invoiceNotFound();
    const result = await this.recorder.declareNotNormalized(
      organizationId,
      invoiceId,
      reason,
      actor,
    );
    if (result === 'not_under_review') {
      invoiceConflict(
        'NORMALIZATION_NOT_UNDER_REVIEW',
        'Seule une facture en « vérification nécessaire » peut être déclarée non normalisée.',
        { phase: doc.normalization ? VIEW_PHASE[doc.normalization.phase ?? 'queued'] : null },
      );
    }
    return this.drafts.view(organizationId, invoiceId);
  }

  /**
   * Échanges DGI d'un document, ordre chronologique. Corps rédigés à
   * l'écriture (client e-MCF) ; JAMAIS d'en-tête — le journal n'en contient pas.
   */
  async exchanges(organizationId: string, invoiceId: string): Promise<DgiExchangePage> {
    const doc = await this.recorder.load(organizationId, invoiceId);
    if (!doc) invoiceNotFound();
    const rows = await this.connection
      .collection<ExchangeDoc>('edef_exchanges')
      .find(
        { organizationId, invoiceId },
        {
          projection: {
            at: 1,
            exchangeId: 1,
            entry: 1,
            method: 1,
            path: 1,
            httpStatus: 1,
            durationMs: 1,
            outcome: 1,
            dgiErrorCode: 1,
            requestBody: 1,
            responseBody: 1,
          },
        },
      )
      .sort({ at: 1, _id: 1 })
      .limit(MAX_EXCHANGES)
      .toArray();
    const items: DgiExchangeView[] = rows.map((r) => {
      const entry = r.entry ?? 'complete';
      return {
        at: new Date(r.at).toISOString(),
        exchangeId: r.exchangeId ?? String(r._id),
        entry,
        method: r.method,
        path: r.path,
        httpStatus: r.httpStatus ?? null,
        durationMs: entry === 'request' ? null : (r.durationMs ?? null),
        outcome: entry === 'request' ? null : (r.outcome ?? null),
        dgiErrorCode: r.dgiErrorCode ?? null,
        body:
          entry === 'request'
            ? (r.requestBody ?? null)
            : entry === 'response'
              ? (r.responseBody ?? null)
              : (r.responseBody ?? r.requestBody ?? null),
      };
    });
    return { items };
  }
}
