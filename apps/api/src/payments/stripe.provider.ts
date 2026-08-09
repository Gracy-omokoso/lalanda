// ─────────────────────────────────────────────────────────────────────────────
// FOURNISSEUR STRIPE (S22b) — carte bancaire, abonnements récurrents
//
// Ce qui MARCHE réellement sans compte marchand : la vérification de signature
// des rappels (cryptographie standard, testée ici contre des charges construites
// à la main) et la traduction des événements Stripe en événements métier.
//
// Ce qui EXIGE un compte : la création de session Checkout, qui est un appel
// HTTP authentifié. Le code est écrit et testé contre un client HTTP simulé ;
// il n'a jamais parlé à api.stripe.com. C'est écrit tel quel dans la PR.
//
// ── Deux choix structurants ──────────────────────────────────────────────────
//
// 1. CHECKOUT HÉBERGÉ, pas d'Elements ni de PaymentIntent monté côté web.
//    Conséquence directe : aucun numéro de carte ne traverse jamais un serveur
//    ni un formulaire de Lalanda. La conformité PCI reste au niveau SAQ-A, le
//    plus léger. Un formulaire de carte maison, même correct, ferait basculer
//    tout le périmètre dans un régime que cette équipe ne peut pas tenir.
//
// 2. `price_data` EN LIGNE plutôt que des `price_…` pré-créés. La grille vit
//    dans `pricing-catalog.ts`, dérivée de la page publique ; synchroniser à la
//    main des identifiants de prix Stripe créerait une seconde source de vérité
//    des montants — celle qui finit par diverger, et qui facture le mauvais
//    prix. Un identifiant de prix explicite reste possible via les secrets
//    (`priceIdProMonth`, …) pour le jour où la comptabilité l'exigera.
// ─────────────────────────────────────────────────────────────────────────────

import type { Plan } from '../billing/entitlements.js';
import { isBillingInterval, type BillingInterval } from '../billing/pricing-catalog.js';
import { PLANS } from '../billing/entitlements.js';
import type { SubscriptionEvent } from '../billing/subscription-state.js';
import { encodeFormNested, readJson, type HttpClient } from './http.js';
import {
  headerValue,
  parseVerifiedBody,
  ProviderUnavailableError,
  WebhookSignatureError,
  type CheckoutRequest,
  type CheckoutResult,
  type NormalizedWebhookEvent,
  type PaymentMethod,
  type PaymentProvider,
  type ProviderAvailability,
  type WebhookRequest,
} from './payment-provider.js';
import {
  REQUIRED_SECRETS,
  resolveAll,
  stripeKeyMode,
  type PaymentSecretsResolver,
} from './payment-secrets.js';
import { verifyStripeSignature } from './webhook-signature.js';

const STRIPE_API = 'https://api.stripe.com/v1';
const STRIPE_API_VERSION = '2024-06-20';

/**
 * Traduction des types Stripe en événements métier.
 *
 * `null` = rappel authentique mais sans effet. Il est journalisé et dédupliqué
 * comme les autres — c'est important : un `customer.updated` rejoué ne doit pas
 * plus être traité deux fois qu'un paiement.
 *
 * Le point délicat est `customer.subscription.updated` : Stripe l'émet à chaque
 * changement, y compris `status: 'unpaid'` qui signifie « j'ai épuisé mes
 * relances ». C'est exactement `dunning.exhausted`, et c'est la seule source
 * fiable de cet événement — il n'existe pas de type dédié. La correspondance se
 * fait donc sur le CONTENU, pas seulement sur le type (voir `mapEvent`).
 */
const DIRECT_EVENT_MAP: Readonly<Record<string, SubscriptionEvent>> = {
  'invoice.paid': 'payment.succeeded',
  'invoice.payment_succeeded': 'payment.succeeded',
  'invoice.payment_failed': 'payment.failed',
  'customer.subscription.deleted': 'subscription.canceled',
};

/** Lecture défensive d'un champ imbriqué. Les rappels sont du JSON non typé. */
function pick(source: unknown, ...path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Horodatage Stripe (secondes UNIX) → `Date`, ou `null`. */
function asDate(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000);
}

function asPlan(value: unknown): Plan | null {
  return typeof value === 'string' && (PLANS as readonly string[]).includes(value)
    ? (value as Plan)
    : null;
}

function asInterval(value: unknown): BillingInterval | null {
  return isBillingInterval(value) ? value : null;
}

export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe' as const;
  readonly methods: readonly PaymentMethod[] = ['card'];

  constructor(
    private readonly secrets: PaymentSecretsResolver,
    private readonly http: HttpClient,
  ) {}

  async availability(): Promise<ProviderAvailability> {
    const { values, missing, source } = await resolveAll(
      this.secrets,
      'stripe',
      REQUIRED_SECRETS.stripe,
    );
    if (missing.length > 0) {
      return {
        available: false,
        reason: 'Clé Stripe ou secret de rappel absent — paiement par carte indisponible.',
        missingSecrets: missing,
      };
    }
    return {
      available: true,
      source: source ?? 'env',
      mode: stripeKeyMode(values['restrictedKey'] ?? ''),
    };
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const { values, missing } = await resolveAll(this.secrets, 'stripe', ['restrictedKey']);
    if (missing.length > 0) throw new ProviderUnavailableError('stripe', missing);
    const key = values['restrictedKey']!;

    // Les métadonnées sont posées à DEUX endroits : sur la session (lisible dans
    // `checkout.session.completed`) et sur l'abonnement créé (lisible dans tous
    // les `invoice.*` ultérieurs). Sans le second, le renouvellement du mois
    // suivant arriverait sans `organizationId` et ne serait rattachable à rien.
    const metadata = {
      organizationId: request.organizationId,
      plan: request.plan,
      interval: request.interval,
      reference: request.reference,
    };

    const body = encodeFormNested({
      mode: 'subscription',
      currency: request.currency.toLowerCase(),
      customer_email: request.customerEmail,
      client_reference_id: request.reference,
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: request.currency.toLowerCase(),
            unit_amount: request.amountDueCents,
            recurring: { interval: request.interval },
            product_data: { name: `Lalanda ${request.plan}` },
          },
        },
      ],
      metadata,
      subscription_data: { metadata },
    });

    const res = await this.http(`${STRIPE_API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_API_VERSION,
        // Idempotence CÔTÉ STRIPE : un double clic sur « Payer » ne crée pas
        // deux sessions, donc pas deux abonnements. La clé est notre référence
        // interne, stable pour une tentative de souscription donnée.
        'Idempotency-Key': request.reference,
      },
      body,
    });

    const json = await readJson(res, 'Création de session Stripe Checkout');
    const url = asString(pick(json, 'url'));
    if (!url) {
      throw new Error("Stripe n'a pas renvoyé d'URL de paiement — session inexploitable.");
    }

    return {
      provider: 'stripe',
      mode: 'redirect',
      reference: request.reference,
      redirectUrl: url,
      providerCustomerId: asString(pick(json, 'customer')),
      providerSubscriptionId: asString(pick(json, 'subscription')),
    };
  }

  async verifyAndParse(request: WebhookRequest): Promise<NormalizedWebhookEvent> {
    const { values, missing } = await resolveAll(this.secrets, 'stripe', ['webhookSecret']);
    // Pas de secret ⇒ REFUS, jamais acceptation. Un déploiement dont le secret
    // de rappel n'est pas renseigné doit rejeter les rappels, pas les gober.
    if (missing.length > 0) throw new ProviderUnavailableError('stripe', missing);

    const check = verifyStripeSignature({
      rawBody: request.rawBody,
      header: headerValue(request.headers, 'stripe-signature'),
      secret: values['webhookSecret']!,
    });
    if (!check.valid) throw new WebhookSignatureError('stripe', check.reason);

    return mapStripeEvent(parseVerifiedBody(request.rawBody, 'stripe'));
  }
}

/**
 * Traduit un événement Stripe VÉRIFIÉ en événement normalisé.
 *
 * Exportée pour être testée sans construire de fournisseur ni de signature :
 * la vérification et la traduction sont deux responsabilités, chacune a ses
 * cas limites.
 */
export function mapStripeEvent(payload: unknown): NormalizedWebhookEvent {
  const eventId = asString(pick(payload, 'id'));
  const rawType = asString(pick(payload, 'type'));
  if (!eventId || !rawType) {
    throw new WebhookSignatureError('stripe', 'événement sans `id` ou sans `type`');
  }

  const object = pick(payload, 'data', 'object');
  const created = asDate(pick(payload, 'created')) ?? new Date();

  // Les métadonnées sont cherchées sur l'objet lui-même puis sur ses parents
  // usuels. Une facture porte `subscription_details.metadata` (recopie des
  // métadonnées de l'abonnement), une session porte `metadata` directement.
  const metadata =
    (pick(object, 'metadata') as Record<string, unknown> | undefined) ??
    (pick(object, 'subscription_details', 'metadata') as Record<string, unknown> | undefined) ??
    {};

  const event = mapEvent(rawType, object);

  const subscriptionId =
    asString(pick(object, 'subscription')) ??
    // Sur `customer.subscription.*`, l'objet EST l'abonnement.
    (rawType.startsWith('customer.subscription.') ? asString(pick(object, 'id')) : null);

  return {
    provider: 'stripe',
    eventId,
    rawType,
    event,
    occurredAt: created,
    organizationId: asString(metadata['organizationId']),
    providerCustomerId: asString(pick(object, 'customer')),
    providerSubscriptionId: subscriptionId,
    plan: asPlan(metadata['plan']),
    interval: asInterval(metadata['interval']),
    currentPeriodStart:
      asDate(pick(object, 'current_period_start')) ?? asDate(pick(object, 'period_start')),
    currentPeriodEnd:
      asDate(pick(object, 'current_period_end')) ?? asDate(pick(object, 'period_end')),
    failureCode:
      asString(pick(object, 'last_payment_error', 'code')) ??
      asString(pick(object, 'last_finalization_error', 'code')),
  };
}

function mapEvent(rawType: string, object: unknown): SubscriptionEvent | null {
  const direct = DIRECT_EVENT_MAP[rawType];
  if (direct) return direct;

  if (rawType === 'checkout.session.completed') {
    // Une session « completed » n'est PAS une session payée : Stripe la marque
    // complète dès que le client a terminé le tunnel, y compris quand le
    // paiement reste en attente (prélèvement bancaire, virement). Traiter la
    // complétion comme un encaissement activerait un abonnement non payé.
    return asString(pick(object, 'payment_status')) === 'paid' ? 'payment.succeeded' : null;
  }

  if (rawType === 'customer.subscription.updated') {
    const status = asString(pick(object, 'status'));
    // `unpaid` = Stripe a épuisé son cycle de relance. Seul signal disponible.
    if (status === 'unpaid') return 'dunning.exhausted';
    if (status === 'canceled') return 'subscription.canceled';
    return null;
  }

  return null;
}
