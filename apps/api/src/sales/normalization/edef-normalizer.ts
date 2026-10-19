// Normalisation DGI d'un document gelé — ADR-0024 § 3 (implémentation du port
// `SalesInvoiceNormalizer`, qui remplace `NoopSalesInvoiceNormalizer`).
//
// Envoi → comparaison → confirmation D'UN SEUL TENANT, dans la requête de
// l'utilisateur. Chaque phase « en vol » est écrite AVANT l'appel réseau
// qu'elle annonce (un arrêt brutal laisse une trace interprétable, § 4.1) ;
// chaque écriture est conditionnée par la phase précédente et la prise en main.
//
// Ce que ce service ne fait JAMAIS :
//  - renvoyer un `POST` : une absence de réponse mène à `uncertain`, que seul le
//    rattrapage conclut, en LISANT la DGI ;
//  - confirmer après un écart de totaux, ou plus de 90 s après la réponse du
//    `POST` (la DGI expire une demande à 120 s) ;
//  - confirmer deux fois, sauf UNE seconde confirmation sur le MÊME `uid` quand
//    une lecture vient de montrer que la demande est encore en attente (elle ne
//    peut donc pas avoir été finalisée) ;
//  - écrire « facture normalisée » ailleurs que par `NormalizationRecorder`.

import { randomUUID } from 'node:crypto';

import { decimalToJsonNumber } from '@lalanda/engine';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../../authz/audit.service.js';
import type {
  EdefInvoiceCallContext,
  EdefInvoiceRequest,
  EdefSecurityElements,
} from '../../edef/edef-invoice.types.js';
import { EdefReferenceSnapshotsService } from '../../edef/edef-reference-snapshots.service.js';
import { EdefClient, EdefJournalWriteError } from '../../edef/edef.client.js';
import type { EdefFailure, EdefTypeEntry } from '../../edef/edef.types.js';
import { normalizeNif } from '../../fiscal/fiscal.dto.js';
import { PointsOfSaleService } from '../../fiscal/points-of-sale.service.js';
import {
  DGI_PLATFORM_CONFIG,
  type DgiPlatformConfig,
  type EdefEnvironment,
} from '../../platform-config/dgi-platform.config.js';
import type { InvoiceLean } from '../invoices/invoice.types.js';
import type {
  NormalizeNowOutcome,
  SalesInvoiceNormalizer,
} from '../invoices/normalization.port.js';
import type { Secret } from '../../integrations/secret-value.js';
import { DgiCallGuard } from './dgi-call-guard.js';
import {
  compareSubmission,
  dgiTotalsAsStrings,
  sameDecimal,
  type Difference,
} from './edef-values.js';
import {
  businessRefusal,
  categoryOfDgiCode,
  isPlatformAlert,
  confirmDeadlineExceeded,
  inProgressElsewhere,
  journalUnavailable,
  noResponseError,
  precondition,
  tokenRejected,
  totalsMismatch,
} from './normalization-errors.js';
import {
  IN_FLIGHT_PHASES,
  NormalizationRecorder,
  type AttemptRef,
  type NormalizationError,
  type RecorderActor,
} from './normalization-recorder.js';
import { buildEdefInvoiceRequest, type EdefRequestRefs } from './request-builder.js';

/** Prise en main d'une tentative : bien au-delà du pire cas (quatre appels de 15 s). */
export const NORMALIZATION_CLAIM_MS = 90_000;

/** Issue d'un document lu, sans rien changer. */
export function outcomeOf(doc: InvoiceLean | null): NormalizeNowOutcome {
  if (!doc) return 'deferred';
  if (doc.status === 'normalized') return 'normalized';
  if (doc.status === 'normalization_failed') return 'failed';
  const phase = doc.normalization?.phase ?? 'queued';
  return phase === 'uncertain' || phase === 'needs_review' ? 'uncertain' : 'deferred';
}

/** Contexte d'appel DGI établi par les contrôles avant envoi. */
interface Preflight {
  environment: EdefEnvironment;
  token: Secret;
  pointOfSaleId: string;
  expectedNim: string | null;
  refs: EdefRequestRefs;
}

/** Tentative en cours, après la prise en main. */
interface Attempt {
  ref: AttemptRef;
  doc: InvoiceLean;
  rn: string;
  ctx: EdefInvoiceCallContext;
  expectedNim: string | null;
  actor: RecorderActor | null;
}

function typeEntries(payload: unknown): EdefTypeEntry[] | null {
  return Array.isArray(payload) ? (payload as EdefTypeEntry[]) : null;
}

@Injectable()
export class EdefSalesInvoiceNormalizer implements SalesInvoiceNormalizer {
  private readonly logger = new Logger('Normalisation');
  /** Horloge — remplacée par les tests (garde de délai, rattrapage). */
  clock: () => Date = () => new Date();

  constructor(
    @Inject(NormalizationRecorder) private readonly recorder: NormalizationRecorder,
    @Inject(EdefClient) private readonly edef: EdefClient,
    @Inject(PointsOfSaleService) private readonly pointsOfSale: PointsOfSaleService,
    @Inject(EdefReferenceSnapshotsService)
    private readonly snapshots: EdefReferenceSnapshotsService,
    @Inject(DgiCallGuard) private readonly guard: DgiCallGuard,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DGI_PLATFORM_CONFIG) private readonly config: DgiPlatformConfig,
  ) {}

  /** Port (ADR-0023 § S25e.10) : appelé après le gel. Idempotent ; ne lève pas pour un refus DGI. */
  async normalizeNow(organizationId: string, invoiceId: string): Promise<NormalizeNowOutcome> {
    const doc = await this.recorder.load(organizationId, invoiceId);
    const operator = doc?.operator ?? null;
    return this.run(
      organizationId,
      invoiceId,
      operator ? { userId: operator.userId, name: operator.name, role: 'unknown' } : null,
    );
  }

  /** Une tentative complète. Une requête concurrente trouve la main prise et ne fait rien. */
  async run(
    organizationId: string,
    invoiceId: string,
    actor: RecorderActor | null,
  ): Promise<NormalizeNowOutcome> {
    const doc = await this.recorder.load(organizationId, invoiceId);
    if (!doc || doc.status !== 'pending_normalization' || !doc.normalization) {
      return outcomeOf(doc);
    }
    if ((doc.normalization.phase ?? 'queued') !== 'queued') return outcomeOf(doc);

    // 2. Contrôles avant envoi — avant la prise en main : aucun numéro consommé.
    const pre = await this.preflight(doc);
    if ('error' in pre) {
      if (isPlatformAlert(pre.error.category) || pre.error.code === 'ISF_NOT_CONFIGURED') {
        this.alert('EDEF_PRECONDITION', organizationId, invoiceId, { code: pre.error.code });
      }
      await this.recorder.failQueued(organizationId, invoiceId, pre.error, actor);
      return outcomeOf(await this.recorder.load(organizationId, invoiceId));
    }

    // 1. Prise en main (T1) : numéro réservé sous bail, corps et empreinte figés.
    const now = this.clock();
    const claim = await this.recorder.claimForSubmission(organizationId, invoiceId, {
      now,
      attemptId: randomUUID(),
      claimMs: NORMALIZATION_CLAIM_MS,
      series: pre.environment === 'production' ? 'real' : 'test',
      build: (d, rn) => buildEdefInvoiceRequest(d, rn, pre.refs),
      actor,
    });
    if (claim.kind === 'not_queued') return outcomeOf(claim.doc);
    if (claim.kind === 'lease_busy') {
      await this.recorder.markQueuedBlocked(organizationId, invoiceId, inProgressElsewhere());
      return 'deferred';
    }
    if (claim.kind === 'build_failed') {
      const err = claim.error as { code?: string; message?: string };
      const code = (err.code ?? 'REQUEST_NOT_BUILDABLE') as Parameters<typeof precondition>[0];
      this.alert('EDEF_PRECONDITION', organizationId, invoiceId, { code });
      await this.recorder.failQueued(
        organizationId,
        invoiceId,
        precondition(
          code,
          err.message ?? 'Requête e-MCF impossible à construire.',
          code === 'REFERENCE_LISTS_UNAVAILABLE',
        ),
        actor,
      );
      return outcomeOf(await this.recorder.load(organizationId, invoiceId));
    }

    const attempt: Attempt = {
      ref: claim.ref,
      doc: claim.doc,
      rn: claim.rn,
      actor,
      expectedNim: pre.expectedNim,
      ctx: {
        environment: pre.environment,
        token: pre.token,
        organizationId,
        pointOfSaleId: pre.pointOfSaleId,
        invoiceId,
        rn: claim.rn,
      },
    };

    try {
      return await this.exchange(attempt, claim.request.body);
    } catch (err) {
      if (!(err instanceof EdefJournalWriteError)) throw err;
      return this.afterJournalFailure(attempt);
    }
  }

  /** Étapes 3 à 7 : envoi, comparaison, garde de délai, confirmation. */
  private async exchange(attempt: Attempt, body: EdefInvoiceRequest): Promise<NormalizeNowOutcome> {
    // 3. Envoi.
    const submitted = await this.guard.run(() => this.edef.submitInvoice(body, attempt.ctx));
    if (!submitted.ok) return this.afterSubmitFailure(attempt, submitted.error);

    // 4. Réponse du `POST` : `uid` + totaux, conservés tels que reçus.
    const submittedAt = this.clock();
    const { uid, raw } = submitted.data;
    if (
      !(await this.recorder.toComparing(attempt.ref, {
        uid,
        dgiTotals: dgiTotalsAsStrings(raw),
        submittedAt,
      }))
    ) {
      return this.reload(attempt);
    }

    // 5. Comparaison par le moteur (+ `curTotal`).
    const amounts = attempt.doc.normalizedAmounts!;
    const rates = attempt.doc.taxRates?.rates ?? {};
    const comparison = compareSubmission(
      amounts.calculation,
      rates,
      raw,
      amounts.counterValueUsd?.amount ?? null,
    );
    if (!comparison.identical) {
      return this.cancelThenFail(attempt, uid, comparison.differences, totalsMismatch(null));
    }

    // 6. Garde de délai.
    if (
      this.clock().getTime() - submittedAt.getTime() >
      this.config.normalizationTimings.confirmDeadlineMs
    ) {
      return this.cancelThenFail(attempt, uid, null, confirmDeadlineExceeded());
    }

    // 7. Confirmation avec NOS montants.
    return this.confirm(attempt, uid, submittedAt);
  }

  /**
   * Le journal strict n'a pas pu écrire l'entrée « requête » : RIEN n'est parti
   * pour cet appel (ADR-0024 O4). Avant le `POST` : retour en `queued`, numéro
   * rendu. Avant un `confirm` : aucune confirmation acceptée, la demande
   * expirera — `uncertain(submit)`. Avant un `cancel` : `uncertain(cancel)`.
   */
  private async afterJournalFailure(attempt: Attempt): Promise<NormalizeNowOutcome> {
    this.logger.error(
      `ALERTE EDEF_JOURNAL_UNAVAILABLE : journal des échanges indisponible, document ${attempt.ref.invoiceId}.`,
    );
    const doc = await this.recorder.load(attempt.ref.organizationId, attempt.ref.invoiceId);
    const phase = doc?.normalization?.phase;
    const error = journalUnavailable();
    if (phase === 'submitting') {
      await this.recorder.backToQueued(attempt.ref, error, attempt.actor);
      return this.reload(attempt);
    }
    return this.uncertain(attempt, phase === 'cancelling' ? 'cancel' : 'submit', error);
  }

  // ── Étapes ────────────────────────────────────────────────────────────────

  private async preflight(doc: InvoiceLean): Promise<Preflight | { error: NormalizationError }> {
    const organizationId = doc.organizationId;
    const environment = (doc.environment ?? 'test') as EdefEnvironment;
    if (environment === 'production' && !this.config.productionEnabled) {
      return {
        error: precondition(
          'DGI_PRODUCTION_UNAVAILABLE',
          'La production DGI n’est pas ouverte : elle le sera après l’homologation de Lalanda.',
          false,
        ),
      };
    }
    const pointOfSaleId = doc.normalization?.pointOfSaleId ?? '';
    const resolved = await this.pointsOfSale.resolveActiveToken(organizationId, pointOfSaleId);
    const view = resolved
      ? await this.pointsOfSale.view(organizationId, pointOfSaleId).catch(() => null)
      : null;
    if (!resolved || !view) {
      return {
        error: precondition(
          'POINT_OF_SALE_NOT_ACTIVE',
          'Le point de vente de ce document n’est pas actif (jeton expiré, refusé ou absent) : vérifiez-le, puis relancez la normalisation.',
          true,
        ),
      };
    }
    if (resolved.environment !== environment) {
      return {
        error: precondition(
          'POINT_OF_SALE_NOT_ACTIVE',
          'Le point de vente de ce document n’est pas dans l’environnement DGI où il a été figé.',
          false,
        ),
      };
    }
    const sellerNif = doc.seller?.nif ?? '';
    if (!view.dgi?.nif || normalizeNif(view.dgi.nif) !== normalizeNif(sellerNif)) {
      return {
        error: precondition(
          'SELLER_NIF_MISMATCH',
          'Le NIF du vendeur figé sur ce document diffère de celui que la DGI associe au point de vente.',
          false,
        ),
      };
    }
    if (!doc.isf) {
      return {
        error: precondition(
          'ISF_NOT_CONFIGURED',
          'L’identifiant du logiciel (ISF) n’est pas configuré sur la plateforme : l’équipe Lalanda est prévenue.',
          false,
        ),
      };
    }
    const [clientTypes, referenceTypes] = await Promise.all([
      this.snapshots.latest(environment, 'clientTypes'),
      this.snapshots.latest(environment, 'referenceTypes'),
    ]);
    const ct = typeEntries(clientTypes?.payload);
    const rt = typeEntries(referenceTypes?.payload);
    if (ct === null || rt === null) {
      return {
        error: precondition(
          'REFERENCE_LISTS_UNAVAILABLE',
          'Les listes de référence de la DGI (types de client, natures d’avoir) n’ont pas été relevées : rafraîchissez les listes du point de vente, puis relancez.',
          true,
        ),
      };
    }
    return {
      environment,
      token: resolved.token,
      pointOfSaleId,
      expectedNim: view.dgi.nim ?? null,
      refs: { clientTypes: ct, referenceTypes: rt },
    };
  }

  /** § 3.4 : refus sûr → `failed` ; tout le reste → `uncertain(submit)`. */
  private async afterSubmitFailure(
    attempt: Attempt,
    failure: EdefFailure,
  ): Promise<NormalizeNowOutcome> {
    switch (failure.kind) {
      case 'unauthorized':
        return this.fail(attempt, tokenRejected(failure), ['submitting']);
      case 'production_disabled':
        return this.fail(
          attempt,
          precondition('DGI_PRODUCTION_UNAVAILABLE', failure.message, false),
          ['submitting'],
        );
      case 'business': {
        const category = categoryOfDgiCode(failure.dgiErrorCode);
        // Serveur, demande déjà en attente avec ce `rn`, état ambigu : une demande
        // à nous peut traîner — le rattrapage la retrouve et l'annule.
        if (category === 'server' || category === 'duplicate_pending' || category === 'state') {
          return this.uncertain(attempt, 'submit', noResponseError(failure));
        }
        const error = businessRefusal(failure);
        if (isPlatformAlert(category)) {
          this.alert('EDEF_REFUSED', attempt.ref.organizationId, attempt.ref.invoiceId, {
            category,
            dgiErrorCode: failure.dgiErrorCode,
          });
        }
        return this.fail(attempt, error, ['submitting']);
      }
      default:
        return this.uncertain(attempt, 'submit', noResponseError(failure));
    }
  }

  /** § 3.7 : confirmation, vérification immédiate unique, seconde confirmation sur le même `uid`. */
  private async confirm(
    attempt: Attempt,
    uid: string,
    submittedAt: Date,
  ): Promise<NormalizeNowOutcome> {
    if (!(await this.recorder.toConfirming(attempt.ref, this.clock()))) return this.reload(attempt);
    const calc = attempt.doc.normalizedAmounts!.calculation;
    const amounts = {
      total: decimalToJsonNumber(calc.total),
      vtotal: decimalToJsonNumber(calc.vatTotal),
    };
    const confirmed = await this.guard.run(() =>
      this.edef.confirmInvoice(uid, amounts, attempt.ctx),
    );
    if (confirmed.ok) return this.record(attempt, confirmed.data);

    const failure = confirmed.error;
    if (
      failure.kind === 'business' &&
      categoryOfDgiCode(failure.dgiErrorCode) === 'totals_mismatch'
    ) {
      return this.cancelThenFail(attempt, uid, [], totalsMismatch(failure));
    }
    if (failure.kind === 'unauthorized') {
      // La DGI n'a pas traité la confirmation : la demande expirera.
      return this.uncertain(attempt, 'submit', tokenRejected(failure));
    }

    // Délai, réseau, 5xx, erreur ambiguë : UNE vérification par lecture.
    const details = await this.guard.run(() => this.edef.getInvoiceDetails(uid, attempt.ctx));
    if (details.ok && details.data.security && this.isOurs(attempt, details.data)) {
      return this.record(attempt, details.data.security);
    }
    if (details.ok && !details.data.security) {
      const pending = await this.guard.run(() => this.edef.getPendingRequests(attempt.ctx));
      const stillPending = pending.ok && pending.data.list.some((p) => p.uid === uid);
      const inTime =
        this.clock().getTime() - submittedAt.getTime() <=
        this.config.normalizationTimings.confirmDeadlineMs;
      if (stillPending && inTime) {
        // La lecture prouve qu'aucune facture n'est finalisée pour cet `uid` :
        // une seconde confirmation, la dernière, sur le MÊME `uid`.
        const again = await this.guard.run(() =>
          this.edef.confirmInvoice(uid, amounts, attempt.ctx),
        );
        if (again.ok) return this.record(attempt, again.data);
        return this.uncertain(attempt, 'confirm', noResponseError(again.error));
      }
    }
    return this.uncertain(attempt, 'confirm', noResponseError(failure));
  }

  /** Écart ou délai dépassé : annulation, puis `failed` — jamais de confirmation. */
  private async cancelThenFail(
    attempt: Attempt,
    uid: string,
    differences: Difference[] | null,
    cause: NormalizationError,
  ): Promise<NormalizeNowOutcome> {
    if (!(await this.recorder.toCancelling(attempt.ref, differences))) return this.reload(attempt);
    if (cause.category === 'totals_mismatch') {
      this.alert('EDEF_TOTALS_MISMATCH', attempt.ref.organizationId, attempt.ref.invoiceId, {
        uid,
        fields: (differences ?? []).map((d) => d.field).join(',') || null,
        dgiErrorCode: cause.dgiErrorCode ?? null,
      });
    }
    const cancelled = await this.guard.run(() => this.edef.cancelInvoice(uid, attempt.ctx));
    const answered =
      cancelled.ok ||
      cancelled.error.kind === 'business' ||
      cancelled.error.kind === 'unauthorized';
    if (!answered) return this.uncertain(attempt, 'cancel', noResponseError(cancelled.error));
    // Aucune confirmation acceptée : la facture n'est pas normalisée.
    return this.fail(attempt, cause, ['cancelling'], differences);
  }

  private async record(
    attempt: Attempt,
    security: EdefSecurityElements,
  ): Promise<NormalizeNowOutcome> {
    try {
      const outcome = await this.recorder.recordNormalized(attempt.ref, {
        from: ['confirming'],
        security,
        actor: attempt.actor,
        now: this.clock(),
        expectedNim: attempt.expectedNim,
      });
      return outcome === 'lost' ? this.reload(attempt) : 'normalized';
    } catch (err) {
      // La DGI a confirmé mais l'enregistrement a échoué : le document reste
      // `confirming` ; le rattrapage le relira à l'expiration de la prise en main.
      this.logger.error(
        `ALERTE EDEF_RECORD_FAILED : facture ${attempt.ref.invoiceId} confirmée par la DGI (${security.codeDefDgi}) mais non enregistrée : ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'uncertain';
    }
  }

  private async uncertain(
    attempt: Attempt,
    step: 'submit' | 'confirm' | 'cancel',
    error: NormalizationError,
  ): Promise<NormalizeNowOutcome> {
    await this.recorder.recordUncertain(attempt.ref, {
      from: IN_FLIGHT_PHASES,
      step,
      error,
      now: this.clock(),
      timings: this.config.normalizationTimings,
      actor: attempt.actor,
    });
    return this.reload(attempt);
  }

  private async fail(
    attempt: Attempt,
    error: NormalizationError,
    from: ('submitting' | 'cancelling')[],
    differences?: Difference[] | null,
  ): Promise<NormalizeNowOutcome> {
    await this.recorder.recordFailed(attempt.ref, {
      from,
      error,
      ...(differences !== undefined ? { differences } : {}),
      actor: attempt.actor,
    });
    return this.reload(attempt);
  }

  private async reload(attempt: Attempt): Promise<NormalizeNowOutcome> {
    return outcomeOf(await this.recorder.load(attempt.ref.organizationId, attempt.ref.invoiceId));
  }

  /** La demande lue est-elle bien la nôtre (`rn`, NIF, total et TVA) ? */
  private isOurs(
    attempt: Attempt,
    details: {
      rn: string | null;
      nif: string | null;
      totals: Readonly<Record<string, unknown>> | null;
    },
  ): boolean {
    return isOurRequest(attempt.doc, attempt.rn, details);
  }

  private alert(
    code: string,
    organizationId: string,
    invoiceId: string,
    metadata: Record<string, string | number | boolean | null>,
  ): void {
    this.logger.error(`ALERTE ${code} : document ${invoiceId} (${JSON.stringify(metadata)})`);
    void this.audit.record({
      organizationId,
      actorUserId: 'system:normalization',
      actorRole: 'system',
      action: `sales_invoice.alert.${code.toLowerCase()}`,
      targetType: 'sales_invoice',
      targetId: invoiceId,
      metadata,
    });
  }
}

/**
 * Appartenance d'une demande lue à la DGI (§ 4.2) : même `rn` (obligatoire),
 * même NIF vendeur et mêmes `total`/`vtotal` quand la DGI les fournit.
 */
export function isOurRequest(
  doc: InvoiceLean,
  rn: string,
  details: {
    rn: string | null;
    nif: string | null;
    totals: Readonly<Record<string, unknown>> | null;
  },
): boolean {
  if (details.rn !== rn) return false;
  const sellerNif = doc.seller?.nif ?? null;
  if (
    details.nif !== null &&
    (sellerNif === null || normalizeNif(details.nif) !== normalizeNif(sellerNif))
  ) {
    return false;
  }
  const calc = doc.normalizedAmounts?.calculation;
  if (!calc) return false;
  if (details.totals !== null) {
    if (!sameDecimal(details.totals['total'], calc.total)) return false;
    if (!sameDecimal(details.totals['vtotal'], calc.vatTotal)) return false;
  }
  return true;
}
