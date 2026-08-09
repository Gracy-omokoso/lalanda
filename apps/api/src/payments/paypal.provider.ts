// ─────────────────────────────────────────────────────────────────────────────
// FOURNISSEUR PAYPAL (S22b) — diaspora
//
// PayPal est là pour une raison précise et pas pour faire nombre : une partie
// des payeurs d'un outil congolais vit hors de RDC, et la carte bancaire
// internationale y est souvent adossée à un compte PayPal plutôt qu'à une carte
// utilisable en ligne.
//
// ── La différence importante avec Stripe ─────────────────────────────────────
//
// La vérification de signature PayPal est EN LIGNE. Stripe signe par HMAC : on
// vérifie hors ligne, avec un secret partagé, sans dépendre de personne. PayPal
// signe par certificat et documente une seule méthode d'usage courant :
// rappeler `POST /v1/notifications/verify-webhook-signature` avec les en-têtes
// reçus, et croire la réponse.
//
// Ce que cela implique, et qui doit être su avant de mettre PayPal en
// production :
//
//   - un rappel PayPal ne peut pas être vérifié si l'API PayPal est
//     indisponible. Le comportement retenu est de REFUSER (503), jamais
//     d'accepter par défaut. Un rappel refusé est réémis par PayPal pendant
//     trois jours ; un rappel accepté à tort est irréversible;
//   - la vérification renvoie le corps à PayPal, donc re-sérialisé. C'est la
//     méthode documentée par PayPal lui-même, et elle ne dépend pas de l'ordre
//     des clés — mais elle interdit toute optimisation qui court-circuiterait
//     l'appel;
//   - la latence d'un rappel double.
//
// Une vérification hors ligne (chaîne de certificats + RSA) existe
// techniquement. Elle n'est pas écrite ici : elle suppose de récupérer et de
// valider un certificat depuis une URL fournie DANS LA REQUÊTE À VÉRIFIER, ce
// qui est un excellent moyen d'écrire une faille si l'on se trompe d'un cran
// sur la validation du domaine. Le compromis est assumé et écrit.
//
// ── Ce qui exige un compte marchand ──────────────────────────────────────────
//
// Tout, sauf la logique. PayPal refuse un abonnement à tarif défini à la volée :
// il faut un `plan_id` créé dans le catalogue du marchand. Ces identifiants
// arrivent par les secrets ; sans eux le fournisseur est indisponible et le
// moyen de paiement n'apparaît pas dans l'interface.
// ─────────────────────────────────────────────────────────────────────────────

import type { Plan } from '../billing/entitlements.js';
import { PLANS } from '../billing/entitlements.js';
import { isBillingInterval, type BillingInterval } from '../billing/pricing-catalog.js';
import type { SubscriptionEvent } from '../billing/subscription-state.js';
import { readJson, type HttpClient } from './http.js';
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
import { REQUIRED_SECRETS, resolveAll, type PaymentSecretsResolver } from './payment-secrets.js';

const PAYPAL_HOSTS = {
  live: 'https://api-m.paypal.com',
  sandbox: 'https://api-m.sandbox.paypal.com',
} as const;

/**
 * En-têtes de signature. Tous OBLIGATOIRES : un rappel auquel il en manque un
 * ne peut pas être vérifié, donc il est refusé — on ne complète jamais un
 * en-tête absent par une valeur par défaut.
 */
const SIGNATURE_HEADERS = [
  'paypal-auth-algo',
  'paypal-cert-url',
  'paypal-transmission-id',
  'paypal-transmission-sig',
  'paypal-transmission-time',
] as const;

/**
 * Domaines dont un certificat de signature peut provenir.
 *
 * `cert_url` arrive DANS la requête à vérifier : c'est une valeur contrôlée par
 * l'émetteur, y compris un émetteur hostile. Elle est renvoyée à PayPal et non
 * récupérée par nous, mais la contrôler ici coûte trois lignes et ferme la
 * question définitivement — y compris si quelqu'un ajoute plus tard une
 * vérification hors ligne qui, elle, irait chercher l'URL.
 */
const ALLOWED_CERT_HOSTS = ['api.paypal.com', 'api.sandbox.paypal.com'] as const;

const EVENT_MAP: Readonly<Record<string, SubscriptionEvent>> = {
  'BILLING.SUBSCRIPTION.ACTIVATED': 'payment.succeeded',
  'PAYMENT.SALE.COMPLETED': 'payment.succeeded',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED': 'payment.failed',
  'PAYMENT.SALE.DENIED': 'payment.failed',
  // PayPal suspend un abonnement après ses propres relances : c'est l'exact
  // équivalent d'`unpaid` chez Stripe.
  'BILLING.SUBSCRIPTION.SUSPENDED': 'dunning.exhausted',
  'BILLING.SUBSCRIPTION.CANCELLED': 'subscription.canceled',
  'BILLING.SUBSCRIPTION.EXPIRED': 'subscription.canceled',
};

/** Secret portant l'identifiant de plan PayPal, par couple (plan, périodicité). */
export function paypalPlanSecretName(plan: Plan, interval: BillingInterval): string | null {
  if (plan === 'pro') return interval === 'month' ? 'planIdProMonth' : 'planIdProYear';
  if (plan === 'business') return interval === 'month' ? 'planIdBusinessMonth' : null;
  return null;
}

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

function asDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `custom_id` PayPal : `org:<id>|plan:<plan>|int:<interval>|ref:<reference>`. */
export function encodeCustomId(fields: {
  organizationId: string;
  plan: Plan;
  interval: BillingInterval;
  reference: string;
}): string {
  return [
    `org:${fields.organizationId}`,
    `plan:${fields.plan}`,
    `int:${fields.interval}`,
    `ref:${fields.reference}`,
  ].join('|');
}

/**
 * Décode un `custom_id`. Tolérant par nécessité : PayPal recopie ce champ à des
 * endroits variables selon le type d'événement, et un champ absent ne doit pas
 * faire échouer la lecture d'un rappel par ailleurs authentique.
 */
export function decodeCustomId(raw: unknown): {
  organizationId: string | null;
  plan: Plan | null;
  interval: BillingInterval | null;
} {
  const empty = { organizationId: null, plan: null, interval: null };
  if (typeof raw !== 'string' || raw.length === 0) return empty;

  const parts = new Map<string, string>();
  for (const chunk of raw.split('|')) {
    const sep = chunk.indexOf(':');
    if (sep > 0) parts.set(chunk.slice(0, sep), chunk.slice(sep + 1));
  }

  const plan = parts.get('plan');
  const interval = parts.get('int');
  return {
    organizationId: parts.get('org') ?? null,
    plan: plan && (PLANS as readonly string[]).includes(plan) ? (plan as Plan) : null,
    interval: isBillingInterval(interval) ? interval : null,
  };
}

export class PayPalProvider implements PaymentProvider {
  readonly id = 'paypal' as const;
  readonly methods: readonly PaymentMethod[] = ['paypal'];

  constructor(
    private readonly secrets: PaymentSecretsResolver,
    private readonly http: HttpClient,
  ) {}

  private async host(): Promise<string> {
    const env = await this.secrets.resolve('paypal', 'environment');
    // Défaut `sandbox` et non `live` : se tromper vers le bac à sable ne coûte
    // qu'un paiement de test raté ; se tromper vers la production encaisse.
    return env?.value === 'live' ? PAYPAL_HOSTS.live : PAYPAL_HOSTS.sandbox;
  }

  async availability(): Promise<ProviderAvailability> {
    const { missing, source } = await resolveAll(this.secrets, 'paypal', REQUIRED_SECRETS.paypal);
    if (missing.length > 0) {
      return {
        available: false,
        reason: 'Identifiants PayPal ou identifiant de rappel absents — PayPal indisponible.',
        missingSecrets: missing,
      };
    }
    const env = await this.secrets.resolve('paypal', 'environment');
    return {
      available: true,
      source: source ?? 'env',
      mode: env?.value === 'live' ? 'live' : 'test',
    };
  }

  /** Jeton OAuth client_credentials. Non mis en cache : voir la note ci-dessous. */
  private async accessToken(): Promise<string> {
    const { values, missing } = await resolveAll(this.secrets, 'paypal', [
      'clientId',
      'clientSecret',
    ]);
    if (missing.length > 0) throw new ProviderUnavailableError('paypal', missing);

    const basic = Buffer.from(`${values['clientId']}:${values['clientSecret']}`).toString('base64');
    const res = await this.http(`${await this.host()}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const json = await readJson(res, 'Jeton OAuth PayPal');
    const token = asString(pick(json, 'access_token'));
    if (!token) throw new Error("PayPal n'a pas renvoyé de jeton d'accès.");
    // Pas de cache mémoire : le jeton vaut 9 heures, mais le mettre en cache
    // demande de gérer son invalidation lors d'une rotation de secret depuis
    // /admin (ADR-0013 §2). Deux appels de plus par souscription ne pèsent rien
    // face à un jeton périmé qui ferait échouer un paiement.
    return token;
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const planSecret = paypalPlanSecretName(request.plan, request.interval);
    if (!planSecret) {
      throw new ProviderUnavailableError('paypal', [
        `plan PayPal pour ${request.plan}/${request.interval}`,
      ]);
    }
    const planId = await this.secrets.resolve('paypal', planSecret);
    if (!planId) throw new ProviderUnavailableError('paypal', [planSecret]);

    const token = await this.accessToken();
    const res = await this.http(`${await this.host()}/v1/billing/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Idempotence côté PayPal — même rôle que `Idempotency-Key` chez Stripe.
        'PayPal-Request-Id': request.reference,
      },
      body: JSON.stringify({
        plan_id: planId.value,
        custom_id: encodeCustomId({
          organizationId: request.organizationId,
          plan: request.plan,
          interval: request.interval,
          reference: request.reference,
        }),
        subscriber: { email_address: request.customerEmail },
        application_context: {
          brand_name: 'Lalanda',
          user_action: 'SUBSCRIBE_NOW',
          return_url: request.successUrl,
          cancel_url: request.cancelUrl,
        },
      }),
    });

    const json = await readJson(res, "Création d'abonnement PayPal");
    const links = pick(json, 'links');
    const approve = Array.isArray(links)
      ? links.find((l) => asString(pick(l, 'rel')) === 'approve')
      : undefined;
    const url = asString(pick(approve, 'href'));
    if (!url) throw new Error("PayPal n'a pas renvoyé de lien d'approbation.");

    return {
      provider: 'paypal',
      mode: 'redirect',
      reference: request.reference,
      redirectUrl: url,
      providerSubscriptionId: asString(pick(json, 'id')),
    };
  }

  async verifyAndParse(request: WebhookRequest): Promise<NormalizedWebhookEvent> {
    const { values, missing } = await resolveAll(this.secrets, 'paypal', REQUIRED_SECRETS.paypal);
    if (missing.length > 0) throw new ProviderUnavailableError('paypal', missing);

    const headers: Record<string, string> = {};
    for (const name of SIGNATURE_HEADERS) {
      const value = headerValue(request.headers, name);
      if (!value) throw new WebhookSignatureError('paypal', `en-tête « ${name} » absent`);
      headers[name] = value;
    }

    const certUrl = headers['paypal-cert-url']!;
    if (!isAllowedCertUrl(certUrl)) {
      throw new WebhookSignatureError('paypal', 'domaine de certificat non autorisé');
    }

    // Le corps est parsé AVANT vérification uniquement pour être renvoyé à
    // PayPal — c'est ce que sa méthode exige. Aucune donnée n'en est utilisée
    // tant que `verification_status` ne vaut pas `SUCCESS`.
    let event: unknown;
    try {
      event = JSON.parse(request.rawBody.toString('utf8'));
    } catch {
      throw new WebhookSignatureError('paypal', 'corps JSON illisible');
    }

    const token = await this.accessToken();
    const res = await this.http(`${await this.host()}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: certUrl,
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: values['webhookId'],
        webhook_event: event,
      }),
    });

    // Une réponse non 2xx est un REFUS, pas une acceptation par défaut : si l'on
    // ne peut pas prouver l'authenticité, on ne l'admet pas. PayPal réémet.
    const json = await readJson(res, 'Vérification de signature PayPal');
    if (asString(pick(json, 'verification_status')) !== 'SUCCESS') {
      throw new WebhookSignatureError('paypal', 'verification_status ≠ SUCCESS');
    }

    return mapPayPalEvent(parseVerifiedBody(request.rawBody, 'paypal'));
  }
}

/** Le certificat de signature vient-il d'un domaine PayPal connu ? */
export function isAllowedCertUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // HTTPS exigé, et comparaison sur l'hôte COMPLET : un `endsWith('paypal.com')`
  // accepterait `api.paypal.com.attaquant.net`.
  return url.protocol === 'https:' && (ALLOWED_CERT_HOSTS as readonly string[]).includes(url.host);
}

/** Traduit un événement PayPal VÉRIFIÉ en événement normalisé. */
export function mapPayPalEvent(payload: unknown): NormalizedWebhookEvent {
  const eventId = asString(pick(payload, 'id'));
  const rawType = asString(pick(payload, 'event_type'));
  if (!eventId || !rawType) {
    throw new WebhookSignatureError('paypal', 'événement sans `id` ou sans `event_type`');
  }

  const resource = pick(payload, 'resource');
  // `custom_id` est posé sur l'abonnement ; les événements de vente le recopient
  // parfois sous `billing_agreement_id`-adjacents. On regarde les deux
  // emplacements observés, sans en inventer d'autres.
  const custom = decodeCustomId(
    pick(resource, 'custom_id') ?? pick(resource, 'custom') ?? pick(payload, 'custom_id'),
  );

  return {
    provider: 'paypal',
    eventId,
    rawType,
    event: EVENT_MAP[rawType] ?? null,
    occurredAt: asDate(pick(payload, 'create_time')) ?? new Date(),
    organizationId: custom.organizationId,
    providerCustomerId: asString(pick(resource, 'subscriber', 'payer_id')),
    providerSubscriptionId:
      asString(pick(resource, 'id')) ?? asString(pick(resource, 'billing_agreement_id')),
    plan: custom.plan,
    interval: custom.interval,
    currentPeriodStart: asDate(pick(resource, 'billing_info', 'last_payment', 'time')),
    currentPeriodEnd: asDate(pick(resource, 'billing_info', 'next_billing_time')),
    failureCode: asString(pick(resource, 'status_change_note')),
  };
}
