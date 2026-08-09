// ─────────────────────────────────────────────────────────────────────────────
// ROUTES DE PAIEMENT (S22b)
//
// Ce contrôleur mélange délibérément trois régimes d'accès, et c'est la seule
// raison pour laquelle il n'a PAS de `@UseGuards` de classe :
//
//   /payments/webhooks/*   PUBLIC — authentifié par SIGNATURE, pas par session.
//   /payments/methods      PUBLIC — dit quels moyens de paiement existent.
//   /payments/manual/*     RÔLE PLATEFORME — un humain confirme de l'argent reçu.
//   /payments/maintenance  RÔLE PLATEFORME — balayage d'exploitation.
//
// Un guard de classe forcerait à en désactiver un par exception sur les
// webhooks, et une exception est exactement ce qu'on finit par appliquer au
// mauvais endroit. Ici, chaque route déclare son régime, visible sur sa
// première ligne.
//
// ── Pourquoi un webhook n'est pas « une route publique de plus » ─────────────
//
// Il accorde des abonnements. Sans vérification de signature, l'URL est un
// formulaire ouvert : `curl -d '{"type":"invoice.paid",…}'` et l'organisation
// visée passe en Business. La signature est donc vérifiée AVANT toute lecture
// du corps, dans le fournisseur, et l'absence de secret configuré provoque un
// 503 — jamais une acceptation.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';

import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermission, RequirePlatformRole } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { BillingRuleError, BillingService } from '../billing/billing.service.js';
import { PLANS, type Plan } from '../billing/entitlements.js';
import { isBillingInterval } from '../billing/pricing-catalog.js';
import {
  isPaymentMethod,
  isPaymentProviderId,
  ProviderUnavailableError,
  WebhookSignatureError,
  type PaymentProviderId,
} from './payment-provider.js';
import { PaymentsService, type MethodAvailability } from './payments.service.js';

interface ManualDecisionBody {
  note?: unknown;
}

interface CheckoutBody {
  plan?: unknown;
  interval?: unknown;
  method?: unknown;
}

function asPlan(value: unknown): Plan | null {
  return typeof value === 'string' && (PLANS as readonly string[]).includes(value)
    ? (value as Plan)
    : null;
}

/**
 * Origine du front, pour les URL de retour du fournisseur.
 *
 * Lue dans l'environnement et JAMAIS dans la requête : une `successUrl` fournie
 * par le client permettrait de renvoyer un payeur vers un site tiers après un
 * paiement réel — une redirection ouverte adossée à une transaction.
 */
function webUrl(): string {
  return process.env['WEB_URL'] ?? 'http://localhost:3000';
}

/** Corps de réponse d'un rappel — volontairement pauvre (aucune fuite d'état). */
interface WebhookAck {
  received: true;
  status: string;
}

@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  /**
   * Moyens de paiement disponibles. PUBLIC : la page tarifs l'appelle sans
   * session pour n'annoncer que ce qui marche vraiment.
   *
   * Ne renvoie JAMAIS `missingSecrets` ni les motifs détaillés : « clé Stripe
   * absente » est une information d'exploitation, pas une information client.
   */
  @Get('methods')
  async methods(): Promise<{ methods: { method: string; available: boolean }[] }> {
    const all = await this.payments.availableMethods();
    return {
      methods: all.map((m: MethodAvailability) => ({ method: m.method, available: m.available })),
    };
  }

  /**
   * Rappel fournisseur. PUBLIC — l'authentification est la signature.
   *
   * `@HttpCode(200)` sur un POST : Nest répondrait 201, ce qui est correct en
   * HTTP mais que certains fournisseurs traitent comme inattendu. 200 est ce
   * qu'ils attendent, et un statut inattendu déclenche des réémissions.
   */
  @Post('webhooks/:provider')
  @HttpCode(200)
  async webhook(
    @Param('provider') providerParam: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<WebhookAck> {
    if (!isPaymentProviderId(providerParam) || providerParam === 'manual') {
      // `manual` n'a pas de rappel : accepter cette route reviendrait à offrir
      // un point d'entrée non authentifié capable d'activer un abonnement.
      throw new NotFoundException({ code: 'UNKNOWN_WEBHOOK_PROVIDER' });
    }
    const provider: PaymentProviderId = providerParam;

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      // Sans corps brut, aucune signature n'est vérifiable. Refuser est la seule
      // option : accepter « puisqu'on ne peut pas vérifier » est précisément la
      // faille. Cause probable : `rawBody: true` absent du bootstrap.
      throw new BadRequestException({ code: 'WEBHOOK_RAW_BODY_MISSING' });
    }

    try {
      const outcome = await this.payments.handleWebhook(provider, {
        rawBody,
        headers: req.headers,
      });
      return { received: true, status: outcome.status };
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        // 400 et non 401 : il n'y a pas d'identité à contester, la charge est
        // invalide. Le détail ne sort pas — dire « horodatage périmé » plutôt
        // que « signature fausse » guiderait un attaquant.
        throw new BadRequestException({ code: error.code });
      }
      if (error instanceof ProviderUnavailableError) {
        throw new ServiceUnavailableException({ code: error.code });
      }
      throw error;
    }
  }

  /**
   * Ouvre un encaissement pour une montée en gamme ou une première souscription.
   *
   * Vit ici et non dans `BillingController` pour éviter un cycle de modules
   * (`PaymentsModule` importe `BillingModule`). La permission reste celle de
   * docs/12 : `billing.manage`.
   *
   * Le MONTANT n'est jamais lu depuis la requête — il est recalculé côté API à
   * partir du catalogue et du prorata. Le corps ne porte que l'intention.
   */
  @Post('checkout')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('billing.manage')
  @HttpCode(200)
  async checkout(
    @Body() body: CheckoutBody,
    @Req() req: AuthenticatedRequest,
  ): Promise<{
    provider: string;
    mode: string;
    reference: string;
    amountDueCents: number;
    redirectUrl?: string;
    instructions?: unknown;
  }> {
    const plan = asPlan(body?.plan);
    const interval = isBillingInterval(body?.interval) ? body.interval : 'month';
    const method = isPaymentMethod(body?.method) ? body.method : null;
    if (!plan || !method) throw new BadRequestException({ code: 'INVALID_CHECKOUT_REQUEST' });

    const orgId = req.orgId;
    if (!orgId) throw new BadRequestException({ code: 'NO_ORGANIZATION' });

    try {
      const result = await this.payments.startCheckout({
        organizationId: orgId,
        userId: req.user?.id ?? 'unknown',
        userEmail: req.user?.email ?? '',
        plan,
        interval,
        method,
        successUrl: `${webUrl()}/souscription/retour?statut=succes`,
        cancelUrl: `${webUrl()}/souscription/retour?statut=annule`,
      });
      return {
        provider: result.provider,
        mode: result.mode,
        reference: result.reference,
        amountDueCents: result.amountDueCents,
        ...(result.redirectUrl ? { redirectUrl: result.redirectUrl } : {}),
        ...(result.instructions ? { instructions: result.instructions } : {}),
      };
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        // 503 et non 400 : la demande du client est valide, c'est Lalanda qui
        // n'est pas en mesure de l'encaisser. La distinction compte pour le
        // support, qui ne doit pas chercher l'erreur côté client.
        throw new ServiceUnavailableException({ code: error.code });
      }
      throw toHttp(error);
    }
  }

  // ── Administration plateforme ──────────────────────────────────────────────

  /** Demandes de paiement manuel en attente de confirmation. */
  @Get('manual/pending')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePlatformRole('platform_billing', 'platform_admin', 'platform_super_admin')
  async pendingManual(): Promise<{
    requests: {
      reference: string;
      organizationId: string;
      plan: string;
      interval: string;
      amountDueCents: number;
      method: string;
      createdAt: string;
      expiresAt: string;
    }[];
  }> {
    const rows = await this.payments.listPendingManualRequests();
    return {
      requests: rows.map((r) => ({
        reference: r.reference,
        organizationId: r.organizationId,
        plan: r.plan,
        interval: r.interval,
        amountDueCents: r.amountDueCents,
        method: r.method,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
      })),
    };
  }

  /**
   * Confirme un dépôt reçu. Rôle PLATEFORME exigé, jamais un rôle
   * d'organisation : `billing.manage` appartient au propriétaire de
   * l'organisation, qui s'accorderait alors ses propres abonnements.
   */
  @Post('manual/:reference/confirm')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePlatformRole('platform_billing', 'platform_admin', 'platform_super_admin')
  @HttpCode(200)
  async confirmManual(
    @Param('reference') reference: string,
    @Body() body: ManualDecisionBody,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ confirmed: true; organizationId: string; plan: string }> {
    try {
      const result = await this.payments.confirmManualPayment({
        reference,
        adminUserId: req.user?.id ?? 'unknown',
        adminRole: 'platform_billing',
        note: typeof body?.note === 'string' ? body.note.slice(0, 500) : undefined,
      });
      return { confirmed: true, organizationId: result.organizationId, plan: result.plan };
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Post('manual/:reference/reject')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePlatformRole('platform_billing', 'platform_admin', 'platform_super_admin')
  @HttpCode(200)
  async rejectManual(
    @Param('reference') reference: string,
    @Body() body: ManualDecisionBody,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ rejected: true }> {
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (note.length === 0) {
      // Un refus sans motif est un refus qu'on ne saura pas expliquer au client
      // qui a réellement envoyé l'argent.
      throw new BadRequestException({ code: 'REJECTION_NOTE_REQUIRED' });
    }
    try {
      await this.payments.rejectManualPayment({
        reference,
        adminUserId: req.user?.id ?? 'unknown',
        note: note.slice(0, 500),
      });
      return { rejected: true };
    } catch (error) {
      throw toHttp(error);
    }
  }

  /**
   * Balayage des essais et grâces échus.
   *
   * COMMODITÉ, jamais source de vérité : `BillingService.getState()` applique
   * déjà les transitions échues à la lecture (aucun ordonnanceur — ADR-0009).
   * Cette route sert à ce que les tableaux d'exploitation ne montrent pas des
   * essais expirés encore marqués « en cours ».
   */
  @Post('maintenance/sweep')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePlatformRole('platform_billing', 'platform_admin', 'platform_super_admin')
  @HttpCode(200)
  async sweep(): Promise<{ scanned: number; changed: number }> {
    return this.billing.sweep();
  }
}

/** Traduit les refus métier en réponses HTTP stables. */
function toHttp(error: unknown): unknown {
  if (error instanceof BillingRuleError) {
    if (error.code === 'MANUAL_REQUEST_NOT_FOUND') {
      return new NotFoundException({ code: error.code, message: error.message });
    }
    return new BadRequestException({ code: error.code, message: error.message });
  }
  return error;
}
