// ─────────────────────────────────────────────────────────────────────────────
// TRADUCTION DES ÉVÉNEMENTS FOURNISSEUR (S22b)
//
// Ces tests portent sur la partie qui décide, à partir d'un rappel authentifié,
// CE QUI ARRIVE À L'ABONNEMENT. Les charges sont des extraits réels de la
// documentation de chaque fournisseur, réduits aux champs consommés.
//
// Aucun appel réseau : les fournisseurs reçoivent un client HTTP simulé, et les
// fonctions de traduction sont exportées pour être testées seules.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpResponse } from './http.js';
import { WebhookSignatureError } from './payment-provider.js';
import { EnvPaymentSecrets } from './payment-secrets.js';
import {
  decodeCustomId,
  encodeCustomId,
  isAllowedCertUrl,
  mapPayPalEvent,
  PayPalProvider,
  paypalPlanSecretName,
} from './paypal.provider.js';
import { mapStripeEvent, StripeProvider } from './stripe.provider.js';

function jsonResponse(body: unknown, status = 200): HttpResponse {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
}

// ── Stripe ───────────────────────────────────────────────────────────────────

describe('traduction des événements Stripe', () => {
  it('une facture payée devient `payment.succeeded` et porte l’organisation', () => {
    const event = mapStripeEvent({
      id: 'evt_1',
      type: 'invoice.paid',
      created: 1786000000,
      data: {
        object: {
          customer: 'cus_1',
          subscription: 'sub_1',
          period_start: 1786000000,
          period_end: 1788592000,
          subscription_details: {
            metadata: { organizationId: 'org_A', plan: 'pro', interval: 'month' },
          },
        },
      },
    });
    expect(event.event).toBe('payment.succeeded');
    expect(event.organizationId).toBe('org_A');
    expect(event.plan).toBe('pro');
    expect(event.interval).toBe('month');
    expect(event.providerSubscriptionId).toBe('sub_1');
    // `period_end` = 1788592000 s → borne de fin de période facturée.
    expect(event.currentPeriodEnd?.toISOString()).toBe('2026-09-05T07:06:40.000Z');
  });

  it('un échec de facture devient `payment.failed`', () => {
    const event = mapStripeEvent({
      id: 'evt_2',
      type: 'invoice.payment_failed',
      created: 1786000000,
      data: { object: { customer: 'cus_1', metadata: { organizationId: 'org_A' } } },
    });
    expect(event.event).toBe('payment.failed');
  });

  it("une session « completed » NON PAYÉE n'active rien", () => {
    // Stripe marque la session complète dès la fin du tunnel, y compris quand
    // le paiement reste en attente. La traiter comme un encaissement activerait
    // un abonnement non payé.
    const event = mapStripeEvent({
      id: 'evt_3',
      type: 'checkout.session.completed',
      created: 1786000000,
      data: { object: { payment_status: 'unpaid', metadata: { organizationId: 'org_A' } } },
    });
    expect(event.event).toBeNull();
  });

  it('une session « completed » PAYÉE active bien l’abonnement', () => {
    const event = mapStripeEvent({
      id: 'evt_4',
      type: 'checkout.session.completed',
      created: 1786000000,
      data: {
        object: {
          payment_status: 'paid',
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { organizationId: 'org_A', plan: 'business', interval: 'month' },
        },
      },
    });
    expect(event.event).toBe('payment.succeeded');
    expect(event.plan).toBe('business');
  });

  it('un abonnement passé en `unpaid` déclenche la période de grâce', () => {
    // Seul signal disponible côté Stripe pour « j'ai épuisé mes relances ».
    const event = mapStripeEvent({
      id: 'evt_5',
      type: 'customer.subscription.updated',
      created: 1786000000,
      data: { object: { id: 'sub_1', status: 'unpaid', metadata: { organizationId: 'org_A' } } },
    });
    expect(event.event).toBe('dunning.exhausted');
    expect(event.providerSubscriptionId).toBe('sub_1');
  });

  it("une mise à jour d'abonnement anodine reste sans effet", () => {
    const event = mapStripeEvent({
      id: 'evt_6',
      type: 'customer.subscription.updated',
      created: 1786000000,
      data: { object: { id: 'sub_1', status: 'active', metadata: { organizationId: 'org_A' } } },
    });
    expect(event.event).toBeNull();
  });

  it('une suppression d’abonnement devient `subscription.canceled`', () => {
    const event = mapStripeEvent({
      id: 'evt_7',
      type: 'customer.subscription.deleted',
      created: 1786000000,
      data: { object: { id: 'sub_1', metadata: { organizationId: 'org_A' } } },
    });
    expect(event.event).toBe('subscription.canceled');
  });

  it('un plan inconnu dans les métadonnées est ignoré, jamais accepté', () => {
    // Les métadonnées sont éditables depuis la console Stripe : un `plan`
    // fantaisiste ne doit pas se retrouver dans la base.
    const event = mapStripeEvent({
      id: 'evt_8',
      type: 'invoice.paid',
      created: 1786000000,
      data: { object: { metadata: { organizationId: 'org_A', plan: 'enterprise' } } },
    });
    expect(event.plan).toBeNull();
  });

  it('un événement sans `id` ou sans `type` est rejeté', () => {
    expect(() => mapStripeEvent({ type: 'invoice.paid' })).toThrow(WebhookSignatureError);
    expect(() => mapStripeEvent({ id: 'evt_9' })).toThrow(WebhookSignatureError);
  });
});

describe('création de session Stripe Checkout', () => {
  const secrets = new EnvPaymentSecrets({
    LALANDA_STRIPE_RESTRICTED_KEY: 'rk_test_abc',
    LALANDA_STRIPE_WEBHOOK_SECRET: 'whsec_abc',
  });

  it('envoie le montant, les métadonnées et une clé d’idempotence', async () => {
    const http = vi.fn<HttpClient>(async () =>
      jsonResponse({
        id: 'cs_1',
        url: 'https://checkout.stripe.com/c/pay/cs_1',
        customer: 'cus_1',
      }),
    );
    const provider = new StripeProvider(secrets, http);
    const result = await provider.createCheckout({
      organizationId: 'org_A',
      plan: 'pro',
      interval: 'month',
      method: 'card',
      amountDueCents: 900,
      currency: 'USD',
      customerEmail: 'client@example.test',
      reference: 'LLD-ORG-A1',
      successUrl: 'https://app.test/ok',
      cancelUrl: 'https://app.test/ko',
    });

    expect(result.redirectUrl).toBe('https://checkout.stripe.com/c/pay/cs_1');
    const [url, init] = http.mock.calls[0]!;
    expect(url).toContain('/checkout/sessions');
    expect(init.headers['Idempotency-Key']).toBe('LLD-ORG-A1');
    expect(init.headers['Authorization']).toBe('Bearer rk_test_abc');
    expect(init.body).toContain('unit_amount%5D=900');
    // Les métadonnées sont posées DEUX fois : sur la session et sur
    // l'abonnement. Sans la seconde, le renouvellement du mois suivant
    // arriverait sans `organizationId` et ne serait rattachable à rien.
    expect(init.body).toContain('metadata%5BorganizationId%5D=org_A');
    expect(init.body).toContain('subscription_data%5Bmetadata%5D%5BorganizationId%5D=org_A');
  });

  it("échoue clairement si Stripe ne renvoie pas d'URL", async () => {
    const http: HttpClient = async () => jsonResponse({ id: 'cs_1' });
    const provider = new StripeProvider(secrets, http);
    await expect(
      provider.createCheckout({
        organizationId: 'org_A',
        plan: 'pro',
        interval: 'month',
        method: 'card',
        amountDueCents: 900,
        currency: 'USD',
        customerEmail: 'a@b.c',
        reference: 'R',
        successUrl: 'https://x/ok',
        cancelUrl: 'https://x/ko',
      }),
    ).rejects.toThrow(/URL de paiement/);
  });

  it("n'expose jamais la réponse brute du fournisseur en cas d'erreur", async () => {
    // ADR-0013 §4 : les messages fournisseur sont assainis — ils contiennent
    // régulièrement la clé d'API en écho.
    const http: HttpClient = async () => ({
      status: 401,
      ok: false,
      text: async () => JSON.stringify({ error: { message: 'Invalid key rk_test_abc' } }),
    });
    const provider = new StripeProvider(secrets, http);
    await expect(
      provider.createCheckout({
        organizationId: 'org_A',
        plan: 'pro',
        interval: 'month',
        method: 'card',
        amountDueCents: 900,
        currency: 'USD',
        customerEmail: 'a@b.c',
        reference: 'R',
        successUrl: 'https://x/ok',
        cancelUrl: 'https://x/ko',
      }),
    ).rejects.toThrow(/réponse 401/);
  });
});

// ── PayPal ───────────────────────────────────────────────────────────────────

describe('identification de plan PayPal', () => {
  it('associe chaque couple vendu à un secret, et refuse Business annuel', () => {
    expect(paypalPlanSecretName('pro', 'month')).toBe('planIdProMonth');
    expect(paypalPlanSecretName('pro', 'year')).toBe('planIdProYear');
    expect(paypalPlanSecretName('business', 'month')).toBe('planIdBusinessMonth');
    // Aucun tarif annuel Business n'est publié — on ne devine pas un prix.
    expect(paypalPlanSecretName('business', 'year')).toBeNull();
    expect(paypalPlanSecretName('free', 'month')).toBeNull();
  });
});

describe('custom_id PayPal', () => {
  it('fait un aller-retour sans perte', () => {
    const encoded = encodeCustomId({
      organizationId: 'org_A',
      plan: 'business',
      interval: 'month',
      reference: 'LLD-X',
    });
    expect(decodeCustomId(encoded)).toEqual({
      organizationId: 'org_A',
      plan: 'business',
      interval: 'month',
    });
  });

  it('reste tolérant à un champ manquant ou absurde', () => {
    expect(decodeCustomId('org:org_A')).toEqual({
      organizationId: 'org_A',
      plan: null,
      interval: null,
    });
    expect(decodeCustomId('org:org_A|plan:enterprise')).toMatchObject({ plan: null });
    expect(decodeCustomId(null)).toEqual({ organizationId: null, plan: null, interval: null });
  });
});

describe('domaine de certificat PayPal', () => {
  it('accepte les hôtes PayPal en HTTPS', () => {
    expect(isAllowedCertUrl('https://api.paypal.com/v1/notifications/certs/CERT')).toBe(true);
    expect(isAllowedCertUrl('https://api.sandbox.paypal.com/v1/certs/CERT')).toBe(true);
  });

  it('REFUSE un hôte qui se termine seulement par paypal.com', () => {
    // `endsWith('paypal.com')` accepterait `api.paypal.com.attaquant.net`.
    expect(isAllowedCertUrl('https://api.paypal.com.attaquant.net/cert')).toBe(false);
    expect(isAllowedCertUrl('http://api.paypal.com/cert')).toBe(false);
    expect(isAllowedCertUrl('pas-une-url')).toBe(false);
  });
});

describe('traduction des événements PayPal', () => {
  it('une vente aboutie devient `payment.succeeded`', () => {
    const event = mapPayPalEvent({
      id: 'WH-1',
      event_type: 'PAYMENT.SALE.COMPLETED',
      create_time: '2026-08-09T12:00:00Z',
      resource: { id: 'I-1', custom_id: 'org:org_B|plan:pro|int:month|ref:R' },
    });
    expect(event.event).toBe('payment.succeeded');
    expect(event.organizationId).toBe('org_B');
    expect(event.plan).toBe('pro');
  });

  it('une suspension PayPal ouvre la période de grâce', () => {
    const event = mapPayPalEvent({
      id: 'WH-2',
      event_type: 'BILLING.SUBSCRIPTION.SUSPENDED',
      create_time: '2026-08-09T12:00:00Z',
      resource: { id: 'I-1', custom_id: 'org:org_B|plan:pro|int:month|ref:R' },
    });
    expect(event.event).toBe('dunning.exhausted');
  });

  it('une annulation et une expiration ferment l’abonnement', () => {
    for (const type of ['BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.EXPIRED']) {
      const event = mapPayPalEvent({
        id: `WH-${type}`,
        event_type: type,
        create_time: '2026-08-09T12:00:00Z',
        resource: { id: 'I-1', custom_id: 'org:org_B' },
      });
      expect(event.event).toBe('subscription.canceled');
    }
  });

  it('un type inconnu reste sans effet', () => {
    const event = mapPayPalEvent({
      id: 'WH-3',
      event_type: 'CUSTOMER.MERCHANT-INTEGRATION.CAPABILITY-UPDATED',
      create_time: '2026-08-09T12:00:00Z',
      resource: {},
    });
    expect(event.event).toBeNull();
  });
});

describe('vérification en ligne des rappels PayPal', () => {
  const secrets = new EnvPaymentSecrets({
    LALANDA_PAYPAL_CLIENT_ID: 'cid',
    LALANDA_PAYPAL_CLIENT_SECRET: 'csec',
    LALANDA_PAYPAL_WEBHOOK_ID: 'WH-ID',
  });

  const headers = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/certs/CERT',
    'paypal-transmission-id': 'tid',
    'paypal-transmission-sig': 'sig',
    'paypal-transmission-time': '2026-08-09T12:00:00Z',
  };

  const body = Buffer.from(
    JSON.stringify({
      id: 'WH-1',
      event_type: 'PAYMENT.SALE.COMPLETED',
      create_time: '2026-08-09T12:00:00Z',
      resource: { id: 'I-1', custom_id: 'org:org_B|plan:pro|int:month|ref:R' },
    }),
  );

  function httpWith(verification: string): HttpClient {
    return async (url) => {
      if (url.includes('/oauth2/token')) return jsonResponse({ access_token: 'tok' });
      return jsonResponse({ verification_status: verification });
    };
  }

  it('accepte un rappel que PayPal déclare authentique', async () => {
    const provider = new PayPalProvider(secrets, httpWith('SUCCESS'));
    const event = await provider.verifyAndParse({ rawBody: body, headers });
    expect(event.event).toBe('payment.succeeded');
    expect(event.organizationId).toBe('org_B');
  });

  it('REFUSE un rappel que PayPal ne confirme pas', async () => {
    const provider = new PayPalProvider(secrets, httpWith('FAILURE'));
    await expect(provider.verifyAndParse({ rawBody: body, headers })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it('REFUSE un rappel auquel il manque un en-tête de signature', async () => {
    const provider = new PayPalProvider(secrets, httpWith('SUCCESS'));
    const { 'paypal-transmission-sig': _omis, ...incomplet } = headers;
    await expect(
      provider.verifyAndParse({ rawBody: body, headers: incomplet }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('REFUSE un certificat hébergé hors des domaines PayPal', async () => {
    const provider = new PayPalProvider(secrets, httpWith('SUCCESS'));
    await expect(
      provider.verifyAndParse({
        rawBody: body,
        headers: { ...headers, 'paypal-cert-url': 'https://attaquant.net/cert' },
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("REFUSE quand PayPal est injoignable — jamais d'acceptation par défaut", async () => {
    // Si l'on ne peut pas prouver l'authenticité, on n'admet pas. PayPal réémet
    // pendant trois jours ; un rappel accepté à tort est irréversible.
    const http: HttpClient = async (url) => {
      if (url.includes('/oauth2/token')) return jsonResponse({ access_token: 'tok' });
      return { status: 503, ok: false, text: async () => 'service indisponible' };
    };
    const provider = new PayPalProvider(secrets, http);
    await expect(provider.verifyAndParse({ rawBody: body, headers })).rejects.toThrow();
  });

  it('utilise le bac à sable par défaut, jamais la production', async () => {
    // Se tromper vers le bac à sable coûte un paiement de test raté ; se tromper
    // vers la production encaisse.
    const calls: string[] = [];
    const http: HttpClient = async (url) => {
      calls.push(url);
      if (url.includes('/oauth2/token')) return jsonResponse({ access_token: 'tok' });
      return jsonResponse({ verification_status: 'SUCCESS' });
    };
    const provider = new PayPalProvider(secrets, http);
    await provider.verifyAndParse({ rawBody: body, headers });
    expect(calls.every((c) => c.includes('api-m.sandbox.paypal.com'))).toBe(true);
  });
});
