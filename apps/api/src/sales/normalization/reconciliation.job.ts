// Rattrapage des normalisations incertaines — ADR-0024 § 4.2.
//
// Tâche récurrente `sales.normalization.reconcile`, toutes les 30 s, 10
// documents au plus par passage. Elle ne prend que les documents `uncertain`
// dont la vérification est échue (dernier appel DGI + 150 s : la demande en
// attente a EXPIRÉ, l'état DGI est stable), les `needs_review` à revérifier, et
// les phases « en vol » dont la prise en main a expiré (processus arrêté).
//
// Elle LIT la DGI et peut ANNULER une demande qu'elle reconnaît comme la nôtre.
// Elle n'envoie JAMAIS de `POST` ni de `confirm` (test de lecture des sources).
// Idempotente : la prise en main ne revient qu'à une instance, chaque écriture
// est conditionnée par la phase, la tentative et la prise en main.

import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import type { EdefSecurityElements } from '../../edef/edef-invoice.types.js';
import type { EdefCallContext, EdefFailure } from '../../edef/edef.types.js';
import { EdefClient } from '../../edef/edef.client.js';
import { PointsOfSaleService } from '../../fiscal/points-of-sale.service.js';
import {
  DGI_PLATFORM_CONFIG,
  type DgiPlatformConfig,
  type EdefEnvironment,
} from '../../platform-config/dgi-platform.config.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import type { InvoiceLean } from '../invoices/invoice.types.js';
import type {
  NormalizationPhase,
  NormalizationUncertainStep,
  NormalizeNowOutcome,
} from '../invoices/normalization.port.js';
import { DgiCallGuard } from './dgi-call-guard.js';
import { NormalizationAlertsService } from './normalization-alerts.service.js';
import { NORMALIZATION_CLAIM_MS, isOurRequest, outcomeOf } from './edef-normalizer.js';
import {
  confirmDeadlineExceeded,
  notNormalizedAfterCheck,
  reviewRequired,
  totalsMismatch,
} from './normalization-errors.js';
import {
  NormalizationRecorder,
  REVIEW_RECHECK_DAILY_AFTER_MS,
  REVIEW_RECHECK_DAILY_MS,
  REVIEW_RECHECK_MS,
  type AttemptRef,
} from './normalization-recorder.js';
import { EDEF_RECONCILIATION_EVIDENCE } from './reconciliation-evidence.js';

export const RECONCILE_JOB = 'sales.normalization.reconcile';
export const RECONCILE_EVERY_MS = 30_000;
export const RECONCILE_BATCH = 10;
/** DGI injoignable : nouvel essai à +2 min. */
export const RECONCILE_RETRY_MS = 2 * 60_000;
/** Écart minimal entre deux documents traités (débit DGI, § 6). */
export const RECONCILE_SPACING_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Lecture d'une phase « en vol » après un arrêt (§ 4.1). */
export function stepOfPhase(
  phase: NormalizationPhase,
  uncertainStep: NormalizationUncertainStep | null,
): NormalizationUncertainStep {
  switch (phase) {
    case 'confirming':
      return 'confirm';
    case 'cancelling':
      return 'cancel';
    case 'submitting':
    case 'comparing':
      return 'submit';
    default:
      return uncertainStep ?? 'submit';
  }
}

@Injectable()
export class NormalizationReconciliationJob implements OnModuleInit {
  private readonly logger = new Logger('Normalisation');
  /** Écart entre deux documents ; les tests le ramènent à 0. */
  spacingMs = RECONCILE_SPACING_MS;

  constructor(
    @Inject(NormalizationRecorder) private readonly recorder: NormalizationRecorder,
    @Inject(EdefClient) private readonly edef: EdefClient,
    @Inject(PointsOfSaleService) private readonly pointsOfSale: PointsOfSaleService,
    @Inject(DgiCallGuard) private readonly guard: DgiCallGuard,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(DGI_PLATFORM_CONFIG) private readonly config: DgiPlatformConfig,
    @Inject(NormalizationAlertsService) private readonly alerts: NormalizationAlertsService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(RECONCILE_JOB, RECONCILE_EVERY_MS, async (_payload, ctx) => {
      await this.run(ctx.now);
    });
  }

  /** Un passage : au plus 10 documents. Renvoie le nombre de documents pris en main. */
  async run(now: Date = new Date()): Promise<number> {
    const due = await this.recorder.findDue(now, RECONCILE_BATCH);
    let handled = 0;
    for (const doc of due) {
      try {
        const outcome = await this.reconcileOne(doc.organizationId, String(doc._id), now, false);
        if (outcome !== null) handled += 1;
      } catch (err) {
        // Un document en échec n'arrête pas le passage ; il sera repris.
        this.logger.error(
          `Rattrapage du document ${String(doc._id)} interrompu : ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (this.spacingMs > 0) await sleep(this.spacingMs);
    }
    return handled;
  }

  /**
   * Rattrapage d'un document, s'il est dû (ou forcé par la route `check` pour un
   * `needs_review`). `null` si une autre instance tient la main ou s'il n'y a
   * rien à faire.
   */
  async reconcileOne(
    organizationId: string,
    invoiceId: string,
    now: Date,
    force: boolean,
  ): Promise<NormalizeNowOutcome | null> {
    const claimed = await this.recorder.claimForReconciliation(organizationId, invoiceId, {
      now,
      claimId: randomUUID(),
      claimMs: NORMALIZATION_CLAIM_MS,
      force,
    });
    if (!claimed) return null;
    const { ref, doc } = claimed;
    const n = doc.normalization!;
    const phase = (n.phase ?? 'queued') as NormalizationPhase;
    const step = stepOfPhase(phase, n.uncertainStep ?? null);

    const resolved = await this.pointsOfSale.resolveTokenForReconciliation(
      organizationId,
      n.pointOfSaleId,
    );
    const ctx: EdefCallContext | null = resolved
      ? {
          environment: resolved.environment as EdefEnvironment,
          token: resolved.token,
          organizationId,
          pointOfSaleId: n.pointOfSaleId,
        }
      : null;

    if (phase === 'needs_review') return this.recheckReview(ref, doc, ctx, now);
    if (ctx === null) return this.unreachable(ref, doc, step, now, null);

    if (step === 'confirm') return this.checkConfirm(ref, doc, ctx, now);
    return this.checkPending(ref, doc, step, ctx, now);
  }

  /** `confirm` : la facture a-t-elle été finalisée ? Seuls des éléments de sécurité le prouvent. */
  private async checkConfirm(
    ref: AttemptRef,
    doc: InvoiceLean,
    ctx: EdefCallContext,
    now: Date,
  ): Promise<NormalizeNowOutcome> {
    const n = doc.normalization!;
    const from = [n.phase];
    const uid = n.uid ?? null;
    if (uid === null) return this.checkPending(ref, doc, 'submit', ctx, now);
    const details = await this.guard.run(() => this.edef.getInvoiceDetails(uid, ctx));
    if (!details.ok) {
      if (details.error.kind === 'unauthorized') return this.tokenDead(ref, doc, now);
      return this.unreachable(ref, doc, 'confirm', now, details.error);
    }
    const rn = n.reservedNumber ?? '';
    if (details.data.security && isOurRequest(doc, rn, details.data)) {
      return this.record(ref, doc, details.data.security, now);
    }
    if (
      !details.data.security &&
      EDEF_RECONCILIATION_EVIDENCE.detailsWithoutSecurityMeansNotNormalized
    ) {
      return this.concludeNotNormalized(ref, doc, 'confirm', ctx, now);
    }
    await this.recorder.recordNeedsReview(ref, {
      from,
      reason:
        'La DGI ne permet pas d’établir si la confirmation de cette facture a abouti (aucun élément de sécurité lisible).',
      error: reviewRequired(
        'Lalanda ne sait pas si la DGI a normalisé cette facture. Ne la refaites pas : vérifiez auprès de la DGI, ou attendez la revérification automatique.',
      ),
      now,
    });
    return this.reload(ref);
  }

  /** `submit` et `cancel` : aucune confirmation acceptée — on annule ce qui est à nous et on conclut. */
  private async checkPending(
    ref: AttemptRef,
    doc: InvoiceLean,
    step: 'submit' | 'cancel' | 'confirm',
    ctx: EdefCallContext,
    now: Date,
  ): Promise<NormalizeNowOutcome> {
    const pending = await this.guard.run(() => this.edef.getPendingRequests(ctx));
    if (!pending.ok) {
      if (pending.error.kind === 'unauthorized') return this.tokenDead(ref, doc, now);
      return this.unreachable(ref, doc, step, now, pending.error);
    }
    return this.concludeNotNormalized(ref, doc, step, ctx, now, pending.data.list);
  }

  private async concludeNotNormalized(
    ref: AttemptRef,
    doc: InvoiceLean,
    step: 'submit' | 'cancel' | 'confirm',
    ctx: EdefCallContext,
    now: Date,
    pendingList?: readonly { uid: string }[],
  ): Promise<NormalizeNowOutcome> {
    const n = doc.normalization!;
    const rn = n.reservedNumber ?? '';
    const list = pendingList ?? [];
    for (const p of list) {
      // Seulement ce que Lalanda reconnaît (O3) : même `rn`, même NIF, même contenu.
      if (n.uid && p.uid !== n.uid && list.some((q) => q.uid === n.uid)) continue;
      const details = await this.guard.run(() => this.edef.getInvoiceDetails(p.uid, ctx));
      if (!details.ok) continue;
      // L'`uid` rendu par NOTRE `POST` désigne notre demande, même si ses totaux
      // diffèrent des nôtres (c'est le cas d'un écart) : `rn` et NIF suffisent.
      // Sinon, l'empreinte du contenu (total et TVA) doit aussi coïncider.
      const ours =
        p.uid === n.uid
          ? isOurRequest(doc, rn, { ...details.data, totals: null })
          : isOurRequest(doc, rn, details.data);
      if (!ours) continue;
      const cancelled = await this.guard.run(() =>
        this.edef.cancelInvoice(p.uid, { ...ctx, invoiceId: ref.invoiceId, rn }),
      );
      if (!cancelled.ok) {
        this.logger.warn(
          `Rattrapage : annulation de la demande ${p.uid} sans réponse sûre (${cancelled.error.kind}) ; elle expirera.`,
        );
      }
    }
    const error =
      step === 'cancel'
        ? n.differences !== null && n.differences !== undefined
          ? totalsMismatch(null)
          : confirmDeadlineExceeded()
        : notNormalizedAfterCheck();
    await this.recorder.recordFailed(ref, { from: [n.phase], error, actor: null });
    return this.reload(ref);
  }

  /** `needs_review` : revérification en lecture seule ; seuls des éléments de sécurité concluent. */
  private async recheckReview(
    ref: AttemptRef,
    doc: InvoiceLean,
    ctx: EdefCallContext | null,
    now: Date,
  ): Promise<NormalizeNowOutcome> {
    const n = doc.normalization!;
    if (ctx !== null && n.uid) {
      const uid = n.uid;
      const details = await this.guard.run(() => this.edef.getInvoiceDetails(uid, ctx));
      if (
        details.ok &&
        details.data.security &&
        isOurRequest(doc, n.reservedNumber ?? '', details.data)
      ) {
        return this.record(ref, doc, details.data.security, now);
      }
    }
    const since = n.review?.since ? new Date(n.review.since).getTime() : now.getTime();
    const every =
      now.getTime() - since >= REVIEW_RECHECK_DAILY_AFTER_MS
        ? REVIEW_RECHECK_DAILY_MS
        : REVIEW_RECHECK_MS;
    await this.recorder.postpone(ref, {
      from: ['needs_review'],
      nextAt: new Date(now.getTime() + every),
      error: null,
    });
    return this.reload(ref);
  }

  private async record(
    ref: AttemptRef,
    doc: InvoiceLean,
    security: EdefSecurityElements,
    now: Date,
  ): Promise<NormalizeNowOutcome> {
    const view = await this.pointsOfSale
      .view(ref.organizationId, doc.normalization!.pointOfSaleId)
      .catch(() => null);
    await this.recorder.recordNormalized(ref, {
      from: [doc.normalization!.phase],
      security,
      actor: null,
      now,
      expectedNim: view?.dgi?.nim ?? null,
    });
    return this.reload(ref);
  }

  /** Jeton refusé : sans jeton valide, plus aucune vérification n'est possible. */
  private async tokenDead(
    ref: AttemptRef,
    doc: InvoiceLean,
    now: Date,
  ): Promise<NormalizeNowOutcome> {
    // E-mail aux administrateurs fiscaux (au plus un par heure et par point de vente).
    const pointOfSaleId = doc.normalization?.pointOfSaleId ?? doc.pointOfSaleId ?? null;
    if (pointOfSaleId) void this.alerts.tokenRejected(ref.organizationId, pointOfSaleId, now);
    await this.recorder.recordNeedsReview(ref, {
      from: [doc.normalization!.phase],
      reason: 'La DGI a refusé le jeton du point de vente pendant la vérification.',
      error: reviewRequired(
        'La DGI a refusé le jeton du point de vente : renouvelez le jeton du point de vente pour que Lalanda puisse vérifier cette facture.',
      ),
      now,
    });
    return this.reload(ref);
  }

  /** DGI injoignable : nouvel essai à +2 min ; au-delà de 30 min d'incertitude, une personne. */
  private async unreachable(
    ref: AttemptRef,
    doc: InvoiceLean,
    step: NormalizationUncertainStep,
    now: Date,
    failure: EdefFailure | null,
  ): Promise<NormalizeNowOutcome> {
    const n = doc.normalization!;
    const since = new Date(n.uncertainSince ?? n.lastAttemptAt ?? now).getTime();
    if (now.getTime() - since >= this.config.normalizationTimings.uncertaintyCapMs) {
      await this.recorder.recordNeedsReview(ref, {
        from: [n.phase],
        reason: `La DGI n’a pas permis de conclure pendant plus de ${Math.round(
          this.config.normalizationTimings.uncertaintyCapMs / 60_000,
        )} minutes.`,
        error: reviewRequired(
          'La DGI est restée injoignable : Lalanda ne sait pas encore si cette facture est normalisée. Ne la refaites pas.',
        ),
        now,
      });
      return this.reload(ref);
    }
    this.logger.warn(
      `Rattrapage du document ${ref.invoiceId} reporté (${failure?.kind ?? 'jeton indisponible'}).`,
    );
    await this.recorder.postpone(ref, {
      from: [n.phase],
      nextAt: new Date(now.getTime() + RECONCILE_RETRY_MS),
      error: null,
      step,
      now,
    });
    return this.reload(ref);
  }

  private async reload(ref: AttemptRef): Promise<NormalizeNowOutcome> {
    return outcomeOf(await this.recorder.load(ref.organizationId, ref.invoiceId));
  }
}
