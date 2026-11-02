// ─────────────────────────────────────────────────────────────────────────────
// ROUTES DE PAIEMENT (S22b)
//
// Ce contrôleur mélange délibérément trois régimes d'accès, et c'est la seule
// raison pour laquelle il n'a PAS de `@UseGuards` de classe :
//
//   /payments/webhooks/*   PUBLIC — authentifié par SIGNATURE, pas par session.
//   /payments/methods      PUBLIC — dit quels moyens de paiement existent.
//   /payments/manual/*     RETIRÉES (410) — remplacées par `/admin/billing/**` (ADR-0053 P3).
//   /payments/maintenance  RETIRÉE (410) — idem.
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
  GoneException,
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
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { BillingRuleError } from '../billing/billing.service.js';
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
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

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

  // ── Administration plateforme : routes RETIRÉES (ADR-0053 — P3) ────────────
  //
  // La file des paiements manuels et le balayage vivent désormais sous
  // `/admin/billing/**`, derrière la garde de console (`PlatformAuthGuard`), avec motif,
  // ré-authentification, rôle RÉEL au journal plateforme et miroir « Équipe Lalanda »
  // côté client (`admin/billing/platform-billing.controller.ts`). Les anciens chemins
  // répondent `410 ROUTE_GONE` à TOUS, sans session : ils n'agissent plus et ne disent
  // rien d'autre que l'adresse de remplacement (compatibilité N-1 close, § 7).

  @Get('manual/pending')
  pendingManual(): never {
    throw gone('/admin/billing/manual-payments');
  }

  @Post('manual/:reference/confirm')
  confirmManual(): never {
    throw gone('/admin/billing/manual-payments/:reference/confirm');
  }

  @Post('manual/:reference/reject')
  rejectManual(): never {
    throw gone('/admin/billing/manual-payments/:reference/reject');
  }

  @Post('maintenance/sweep')
  sweep(): never {
    throw gone('/admin/billing/sweep');
  }
}

/** `410` d'une route plateforme retirée, avec sa remplaçante. */
function gone(replacement: string): GoneException {
  return new GoneException({
    code: 'ROUTE_GONE',
    message: 'Route retirée : la console Lalanda la remplace.',
    replacement,
  });
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
