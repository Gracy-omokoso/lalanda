// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATION DES PAIEMENTS (S22b)
//
// Le chemin d'un rappel, dans l'ordre, sans raccourci possible :
//
//   1. VÉRIFIER la signature      → `provider.verifyAndParse()` (403/400 sinon)
//   2. DÉDUPLIQUER                → insertion unique dans `payment_events`
//   3. RÉSOUDRE l'organisation    → métadonnées, sinon référence fournisseur
//   4. APPLIQUER la transition    → `BillingService.applyPaymentEvent()`
//   5. JOURNALISER                → `audit_events` (S20a)
//
// Les étapes 1 et 2 ne sont pas interchangeables : dédupliquer d'abord
// reviendrait à écrire en base sur commande d'un inconnu — un attaquant
// remplirait `payment_events` sans jamais présenter de signature valide, et
// pourrait surtout PRÉ-EMPTER l'identifiant d'un vrai événement pour que le
// rappel authentique soit ensuite ignoré comme doublon. C'est un déni de
// service sur l'encaissement, silencieux et difficile à diagnostiquer.
// ─────────────────────────────────────────────────────────────────────────────

import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { BillingService, BillingRuleError } from '../billing/billing.service.js';
import type { Plan } from '../billing/entitlements.js';
import { isSellable, priceCents, type BillingInterval } from '../billing/pricing-catalog.js';
import { addDays } from '../billing/proration.js';
import { InvalidTransitionError } from '../billing/subscription-state.js';
import {
  ManualPaymentRequest,
  MANUAL_REQUEST_TTL_DAYS,
  type ManualPaymentRequestDocument,
} from './manual-payment.schema.js';
import { PaymentEvent, type PaymentEventDocument } from './payment-event.schema.js';
import {
  METHOD_PROVIDER,
  ProviderUnavailableError,
  WebhookSignatureError,
  type CheckoutResult,
  type NormalizedWebhookEvent,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentProviderId,
  type ProviderAvailability,
  type WebhookRequest,
} from './payment-provider.js';

/** Jeton d'injection du registre de fournisseurs. */
export const PAYMENT_PROVIDER_REGISTRY = Symbol('PAYMENT_PROVIDER_REGISTRY');

export type ProviderRegistry = Readonly<Record<PaymentProviderId, PaymentProvider>>;

/** Résultat de la réception d'un rappel — toujours 200 sauf signature invalide. */
export interface WebhookOutcome {
  status: 'processed' | 'duplicate' | 'ignored' | 'unmatched';
  eventId: string;
  detail?: string;
}

export interface MethodAvailability {
  method: PaymentMethod;
  provider: PaymentProviderId;
  available: boolean;
  /** Motif d'indisponibilité, destiné à l'exploitation — jamais au client final. */
  reason?: string;
}

/** Code d'erreur Mongo pour violation d'index unique. */
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENT_PROVIDER_REGISTRY) private readonly providers: ProviderRegistry,
    @Inject(BillingService) private readonly billing: BillingService,
    @InjectModel(PaymentEvent.name) private readonly events: Model<PaymentEventDocument>,
    @InjectModel(ManualPaymentRequest.name)
    private readonly manualRequests: Model<ManualPaymentRequestDocument>,
    @Optional() @Inject(AuditService) private readonly audit?: AuditService,
  ) {}

  // ── Disponibilité ──────────────────────────────────────────────────────────

  /**
   * Moyens de paiement RÉELLEMENT utilisables maintenant.
   *
   * Consommé par la page tarifs et le tunnel : la promesse affichée au client
   * est calculée à partir de la configuration, jamais écrite en dur dans un
   * composant. Une page qui promet la carte bancaire alors qu'aucune clé Stripe
   * n'est configurée transforme un défaut de configuration en client perdu.
   */
  async availableMethods(): Promise<MethodAvailability[]> {
    const cache = new Map<PaymentProviderId, ProviderAvailability>();
    const out: MethodAvailability[] = [];

    for (const [method, providerId] of Object.entries(METHOD_PROVIDER) as [
      PaymentMethod,
      PaymentProviderId,
    ][]) {
      let availability = cache.get(providerId);
      if (!availability) {
        availability = await this.providers[providerId].availability();
        cache.set(providerId, availability);
      }
      out.push({
        method,
        provider: providerId,
        available: availability.available,
        ...(availability.available ? {} : { reason: availability.reason }),
      });
    }

    return out;
  }

  // ── Souscription ───────────────────────────────────────────────────────────

  /**
   * Ouvre un encaissement pour un plan.
   *
   * Le montant vient de `BillingService.quotePlanChange()` et JAMAIS du client :
   * accepter un montant depuis la requête permettrait de souscrire Business à
   * 1 centime. C'est la même règle que pour les entitlements — « l'interface
   * explique, l'API impose » (docs/13).
   */
  async startCheckout(input: {
    organizationId: string;
    userId: string;
    userEmail: string;
    plan: Plan;
    interval: BillingInterval;
    method: PaymentMethod;
    successUrl: string;
    cancelUrl: string;
    now?: Date;
  }): Promise<CheckoutResult & { amountDueCents: number }> {
    const now = input.now ?? new Date();

    if (!isSellable(input.plan, input.interval)) {
      throw new BillingRuleError(
        'PLAN_NOT_SELLABLE',
        `L'offre « ${input.plan} » n'est pas commercialisée en « ${input.interval} ».`,
      );
    }

    const providerId = METHOD_PROVIDER[input.method];
    const provider = this.providers[providerId];
    const availability = await provider.availability();
    if (!availability.available) {
      throw new ProviderUnavailableError(providerId, availability.missingSecrets);
    }

    const quote = await this.billing.quotePlanChange({
      organizationId: input.organizationId,
      targetPlan: input.plan,
      targetInterval: input.interval,
      now,
    });

    // Une baisse de gamme ne s'encaisse pas : elle se programme. Router une
    // baisse vers un paiement ferait payer un client pour dépenser moins.
    if (quote.proration.effect === 'period_end') {
      throw new BillingRuleError(
        'DOWNGRADE_NOT_PAYABLE',
        "Une baisse de gamme prend effet à l'échéance et ne donne lieu à aucun paiement.",
      );
    }

    const amountDueCents = quote.amountDueCents || (priceCents(input.plan, input.interval) ?? 0);
    const reference = buildReference(input.organizationId, now);

    const result = await provider.createCheckout({
      organizationId: input.organizationId,
      plan: input.plan,
      interval: input.interval,
      method: input.method,
      amountDueCents,
      currency: 'USD',
      customerEmail: input.userEmail,
      reference,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });

    if (providerId === 'manual') {
      await this.manualRequests.create({
        reference,
        organizationId: input.organizationId,
        requestedBy: input.userId,
        plan: input.plan,
        interval: input.interval,
        amountDueCents,
        currency: 'USD',
        method: input.method === 'bank_transfer' ? 'bank_transfer' : 'mobile_money',
        status: 'pending',
        expiresAt: addDays(now, MANUAL_REQUEST_TTL_DAYS),
        _schemaVersion: 1,
      });
    }

    await this.audit?.record({
      organizationId: input.organizationId,
      actorUserId: input.userId,
      actorRole: 'unknown',
      action: 'subscription.checkout_started',
      targetType: 'subscription',
      targetId: input.organizationId,
      metadata: {
        provider: providerId,
        method: input.method,
        plan: input.plan,
        interval: input.interval,
        amountDueCents,
        reference,
      },
    });

    return { ...result, amountDueCents };
  }

  /** Demandes de paiement manuel en attente — file de travail de l'administration. */
  async listPendingManualRequests(limit = 100): Promise<ManualPaymentRequestDocument[]> {
    return this.manualRequests
      .find({ status: 'pending' })
      .sort({ createdAt: 1 })
      .limit(Math.min(Math.max(limit, 1), 500))
      .exec();
  }

  /**
   * Confirme un dépôt manuel — mobile money ou virement.
   *
   * C'est le seul endroit du système où un HUMAIN crée un `payment.succeeded`.
   * Les garde-fous en découlent :
   *
   * - route protégée par un rôle PLATEFORME (voir le contrôleur), jamais par un
   *   rôle d'organisation : un propriétaire ne s'auto-confirme pas un paiement;
   * - la demande doit être `pending` et non expirée — une référence rejouée ne
   *   peut pas accorder deux mois;
   * - la trace passe par `payment_events` comme un rappel, avec le même
   *   mécanisme d'idempotence : `manual:<référence>` est l'identifiant.
   */
  async confirmManualPayment(input: {
    reference: string;
    adminUserId: string;
    adminRole: string;
    note?: string;
    now?: Date;
  }): Promise<{ organizationId: string; plan: Plan }> {
    const now = input.now ?? new Date();
    const request = await this.manualRequests.findOne({ reference: input.reference }).exec();
    if (!request) {
      throw new BillingRuleError('MANUAL_REQUEST_NOT_FOUND', 'Référence de paiement inconnue.');
    }
    if (request.status !== 'pending') {
      throw new BillingRuleError(
        'MANUAL_REQUEST_CLOSED',
        `Cette demande est déjà « ${request.status} ».`,
      );
    }
    if (request.expiresAt.getTime() <= now.getTime()) {
      request.status = 'expired';
      await request.save();
      throw new BillingRuleError(
        'MANUAL_REQUEST_EXPIRED',
        'Cette demande a expiré : le client doit en ouvrir une nouvelle.',
      );
    }

    const claimed = await this.claimEvent({
      provider: 'manual',
      eventId: `manual:${request.reference}`,
      rawType: 'manual.confirmed',
      mappedEvent: 'payment.succeeded',
      organizationId: request.organizationId,
    });
    if (!claimed) {
      throw new BillingRuleError('MANUAL_REQUEST_CLOSED', 'Ce paiement a déjà été confirmé.');
    }

    await this.billing.applyPaymentEvent({
      organizationId: request.organizationId,
      event: 'payment.succeeded',
      source: `admin:manual:${input.adminUserId}`,
      actorUserId: input.adminUserId,
      actorRole: input.adminRole,
      plan: request.plan,
      interval: request.interval,
      provider: 'manual',
      now,
    });

    request.status = 'confirmed';
    request.decidedBy = input.adminUserId;
    request.decidedAt = now;
    request.decisionNote = input.note ?? null;
    await request.save();

    await this.markEvent(claimed, 'processed', null);

    return { organizationId: request.organizationId, plan: request.plan };
  }

  /** Refus d'un dépôt (montant insuffisant, dépôt jamais reçu). */
  async rejectManualPayment(input: {
    reference: string;
    adminUserId: string;
    note: string;
    now?: Date;
  }): Promise<void> {
    const request = await this.manualRequests.findOne({ reference: input.reference }).exec();
    if (!request) {
      throw new BillingRuleError('MANUAL_REQUEST_NOT_FOUND', 'Référence de paiement inconnue.');
    }
    if (request.status !== 'pending') {
      throw new BillingRuleError(
        'MANUAL_REQUEST_CLOSED',
        `Cette demande est déjà « ${request.status} ».`,
      );
    }
    request.status = 'rejected';
    request.decidedBy = input.adminUserId;
    request.decidedAt = input.now ?? new Date();
    request.decisionNote = input.note;
    await request.save();
  }

  // ── Rappels ────────────────────────────────────────────────────────────────

  /**
   * Reçoit un rappel. Lève `WebhookSignatureError` (→ 400) si la signature ne
   * tient pas ; ne lève JAMAIS pour un événement inattendu ou inapplicable.
   *
   * Cette asymétrie est délibérée. Un fournisseur retente tout ce qui n'est pas
   * 2xx : répondre 500 sur un événement qu'on ne sait pas traiter déclenche
   * trois jours de réémissions inutiles, et finit par faire désactiver le point
   * d'entrée côté fournisseur. Seule une signature invalide mérite un refus —
   * et elle n'est jamais réémise avec succès.
   */
  async handleWebhook(
    providerId: PaymentProviderId,
    request: WebhookRequest,
    now: Date = new Date(),
  ): Promise<WebhookOutcome> {
    const provider = this.providers[providerId];

    // ── 1. Signature ─────────────────────────────────────────────────────────
    const parsed = await provider.verifyAndParse(request);

    // ── 2. Idempotence ───────────────────────────────────────────────────────
    const claimed = await this.claimEvent({
      provider: providerId,
      eventId: parsed.eventId,
      rawType: parsed.rawType,
      mappedEvent: parsed.event,
      organizationId: parsed.organizationId,
    });
    if (!claimed) {
      return { status: 'duplicate', eventId: parsed.eventId };
    }

    // ── 3. Sans effet ────────────────────────────────────────────────────────
    if (parsed.event === null) {
      await this.markEvent(claimed, 'ignored', `type sans effet : ${parsed.rawType}`);
      return { status: 'ignored', eventId: parsed.eventId, detail: parsed.rawType };
    }

    // ── 4. Rattachement à une organisation ───────────────────────────────────
    const organizationId = await this.resolveOrganization(parsed);
    if (!organizationId) {
      // Non traité ET marqué `failed` : la réémission le reprendra, et
      // l'exploitation voit une file d'événements orphelins plutôt qu'un
      // paiement disparu en silence.
      await this.markEvent(claimed, 'failed', 'organisation non résolue');
      return { status: 'unmatched', eventId: parsed.eventId };
    }
    claimed.organizationId = organizationId;

    // ── 5. Transition ────────────────────────────────────────────────────────
    try {
      await this.billing.applyPaymentEvent({
        organizationId,
        event: parsed.event,
        source: `webhook:${providerId}`,
        plan: parsed.plan,
        interval: parsed.interval,
        provider: providerId,
        providerCustomerId: parsed.providerCustomerId,
        providerSubscriptionId: parsed.providerSubscriptionId,
        currentPeriodStart: parsed.currentPeriodStart,
        currentPeriodEnd: parsed.currentPeriodEnd,
        failureCode: parsed.failureCode,
        now,
      });
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        // Transition interdite : l'événement est authentique mais hors séquence.
        // Marqué `ignored` et non `failed` — le rejouer produirait le même
        // refus, il ne faut pas que la réémission le reprenne indéfiniment.
        await this.markEvent(claimed, 'ignored', `transition refusée : ${error.message}`);
        return { status: 'ignored', eventId: parsed.eventId, detail: error.code };
      }
      await this.markEvent(claimed, 'failed', 'erreur applicative');
      throw error;
    }

    await this.markEvent(claimed, 'processed', null);

    await this.audit?.record({
      organizationId,
      actorUserId: 'system',
      actorRole: 'system',
      action: `payment.${parsed.event}`,
      targetType: 'subscription',
      targetId: organizationId,
      metadata: {
        provider: providerId,
        eventId: parsed.eventId,
        rawType: parsed.rawType,
      },
    });

    return { status: 'processed', eventId: parsed.eventId };
  }

  // ── Interne ────────────────────────────────────────────────────────────────

  /**
   * Réserve un identifiant d'événement. Renvoie `null` si déjà TRAITÉ.
   *
   * L'insertion est l'arbitre : deux réceptions simultanées ne peuvent pas
   * insérer la même clé, l'index unique en refuse une. Un `findOne` préalable
   * suivi d'un `create` laisserait passer les deux — c'est l'erreur classique,
   * et elle ne se manifeste qu'en charge.
   *
   * Un enregistrement resté en `received` ou `failed` est REPRIS : le premier
   * traitement n'a pas abouti, et refuser la réémission perdrait le paiement.
   */
  private async claimEvent(input: {
    provider: PaymentProviderId;
    eventId: string;
    rawType: string;
    mappedEvent: string | null;
    organizationId: string | null;
  }): Promise<PaymentEventDocument | null> {
    try {
      return await this.events.create({
        provider: input.provider,
        eventId: input.eventId,
        rawType: input.rawType,
        mappedEvent: input.mappedEvent,
        organizationId: input.organizationId,
        status: 'received',
        _schemaVersion: 1,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;

      const existing = await this.events
        .findOne({ provider: input.provider, eventId: input.eventId })
        .exec();
      // `processed` et `ignored` sont des états DÉFINITIFS : le rejouer ne doit
      // rien produire. `received` (traitement interrompu) et `failed` sont
      // repris.
      if (!existing || existing.status === 'processed' || existing.status === 'ignored') {
        return null;
      }
      existing.status = 'received';
      existing.detail = null;
      await existing.save();
      return existing;
    }
  }

  private async markEvent(
    doc: PaymentEventDocument,
    status: PaymentEventDocument['status'],
    detail: string | null,
  ): Promise<void> {
    doc.status = status;
    doc.detail = detail;
    await doc.save();
  }

  /**
   * Retrouve l'organisation d'un événement.
   *
   * Deux sources, dans cet ordre : les métadonnées posées par nous à la
   * souscription, puis l'abonnement fournisseur DÉJÀ ENREGISTRÉ sur une
   * organisation. La seconde couvre le cas réel d'un renouvellement dont les
   * métadonnées ont été perdues, ou d'un abonnement repris depuis la console du
   * fournisseur.
   *
   * Le rattachement est une jointure EXACTE sur (fournisseur, identifiant
   * d'abonnement). Aucune correspondance par email, et surtout aucune heuristique
   * du type « le dernier événement rattaché de ce fournisseur » : deux
   * organisations peuvent partager un propriétaire, et un rapprochement approché
   * accorderait un abonnement payé à la mauvaise. Mieux vaut un événement
   * orphelin visible qu'un abonnement silencieusement attribué au mauvais client.
   */
  private async resolveOrganization(parsed: NormalizedWebhookEvent): Promise<string | null> {
    if (parsed.organizationId) return parsed.organizationId;
    if (!parsed.providerSubscriptionId) return null;
    if (parsed.provider === 'manual') return null;

    return this.billing.findOrganizationByProviderSubscription(
      parsed.provider,
      parsed.providerSubscriptionId,
    );
  }
}

/**
 * Référence de paiement lisible et unique : `LLD-<org tronqué>-<base36 du temps>`.
 *
 * Lisible parce qu'un client doit la recopier dans le motif d'un dépôt mobile
 * money, au téléphone parfois. Un UUID de 36 caractères y serait recopié faux
 * une fois sur deux, et une référence fausse est un paiement non rattachable.
 */
export function buildReference(organizationId: string, now: Date): string {
  const org = organizationId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-6)
    .toUpperCase();
  const stamp = now.getTime().toString(36).toUpperCase();
  return `LLD-${org}-${stamp}`;
}

export { WebhookSignatureError, ProviderUnavailableError };
