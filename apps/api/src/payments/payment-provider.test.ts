// Contrat des fournisseurs de paiement (S22b).
//
// Ce fichier surveille une duplication ASSUMÉE : `SUBSCRIPTION_PROVIDERS`
// (billing) et `PAYMENT_PROVIDERS` (payments) listent les mêmes valeurs. Elles
// ne peuvent pas être une seule constante — `payments/` dépend de `billing/`,
// et l'inverse créerait un cycle de modules Nest. La duplication est donc
// surveillée plutôt que subie : si l'une des deux change, ce test rougit.

import { describe, expect, it, vi } from 'vitest';

import { SUBSCRIPTION_PROVIDERS } from '../billing/subscription.schema.js';
import { ManualProvider, buildInstructions, parseManualAccounts } from './manual.provider.js';
import { forbiddenHttpClient, encodeFormNested } from './http.js';
import {
  headerValue,
  isPaymentMethod,
  isPaymentProviderId,
  METHOD_PROVIDER,
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  ProviderUnavailableError,
  WebhookSignatureError,
} from './payment-provider.js';
import { EnvPaymentSecrets, REQUIRED_SECRETS, resolveAll } from './payment-secrets.js';
import { PayPalProvider } from './paypal.provider.js';
import { StripeProvider } from './stripe.provider.js';

describe('cohérence des listes de fournisseurs', () => {
  it('billing et payments déclarent exactement les mêmes fournisseurs', () => {
    expect([...PAYMENT_PROVIDERS].sort()).toEqual([...SUBSCRIPTION_PROVIDERS].sort());
  });

  it("chaque moyen de paiement est rattaché à un fournisseur déclaré", () => {
    for (const method of PAYMENT_METHODS) {
      const provider = METHOD_PROVIDER[method];
      expect(PAYMENT_PROVIDERS, `moyen « ${method} »`).toContain(provider);
    }
  });

  it('chaque fournisseur déclare la liste de ses secrets requis', () => {
    for (const provider of PAYMENT_PROVIDERS) {
      expect(REQUIRED_SECRETS[provider]).toBeDefined();
    }
  });

  it('les gardes de type refusent les valeurs étrangères', () => {
    expect(isPaymentProviderId('stripe')).toBe(true);
    expect(isPaymentProviderId('pawapay')).toBe(false);
    expect(isPaymentMethod('mobile_money')).toBe(true);
    expect(isPaymentMethod('crypto')).toBe(false);
  });

  it('le mobile money est servi par le fournisseur manuel — et c’est assumé', () => {
    // Aucun agrégateur mobile money n'est intégrable sans compte marchand ; le
    // dépôt confirmé par un administrateur est ce qui fonctionne réellement.
    expect(METHOD_PROVIDER.mobile_money).toBe('manual');
    expect(METHOD_PROVIDER.bank_transfer).toBe('manual');
  });
});

describe('lecture des en-têtes', () => {
  it('trouve un en-tête quelle que soit la casse', () => {
    expect(headerValue({ 'Stripe-Signature': 'abc' }, 'stripe-signature')).toBe('abc');
    expect(headerValue({ 'stripe-signature': 'abc' }, 'Stripe-Signature')).toBe('abc');
  });

  it('prend la première valeur d’un en-tête répété', () => {
    expect(headerValue({ 'x-test': ['a', 'b'] }, 'x-test')).toBe('a');
  });

  it('renvoie `undefined` quand l’en-tête est absent', () => {
    expect(headerValue({}, 'stripe-signature')).toBeUndefined();
  });
});

describe('résolution des secrets', () => {
  it("traite une variable vide comme non configurée", () => {
    // Une variable déclarée mais laissée vide dans un `.env` d'exemple ne doit
    // pas passer pour une clé : le fournisseur répondrait 401 sans explication.
    const secrets = new EnvPaymentSecrets({ LALANDA_STRIPE_RESTRICTED_KEY: '   ' });
    return expect(secrets.resolve('stripe', 'restrictedKey')).resolves.toBeNull();
  });

  it('rapporte TOUS les secrets manquants, pas seulement le premier', async () => {
    const secrets = new EnvPaymentSecrets({});
    const { missing } = await resolveAll(secrets, 'stripe', REQUIRED_SECRETS.stripe);
    expect(missing).toEqual(['restrictedKey', 'webhookSecret']);
  });

  it('rapporte la source de la valeur trouvée', async () => {
    const secrets = new EnvPaymentSecrets({
      LALANDA_STRIPE_RESTRICTED_KEY: 'rk_test_x',
      LALANDA_STRIPE_WEBHOOK_SECRET: 'whsec_x',
    });
    const { missing, source, values } = await resolveAll(secrets, 'stripe', REQUIRED_SECRETS.stripe);
    expect(missing).toEqual([]);
    expect(source).toBe('env');
    expect(values['restrictedKey']).toBe('rk_test_x');
  });
});

describe('disponibilité des fournisseurs sans configuration', () => {
  it('Stripe est INDISPONIBLE et dit ce qui manque', async () => {
    const provider = new StripeProvider(new EnvPaymentSecrets({}), forbiddenHttpClient);
    const availability = await provider.availability();
    expect(availability.available).toBe(false);
    if (!availability.available) {
      expect(availability.missingSecrets).toContain('restrictedKey');
      expect(availability.missingSecrets).toContain('webhookSecret');
    }
  });

  it('PayPal est INDISPONIBLE sans identifiants', async () => {
    const provider = new PayPalProvider(new EnvPaymentSecrets({}), forbiddenHttpClient);
    const availability = await provider.availability();
    expect(availability.available).toBe(false);
  });

  it('le fournisseur manuel reste disponible — c’est le filet', async () => {
    const provider = new ManualProvider(new EnvPaymentSecrets({}));
    const availability = await provider.availability();
    expect(availability.available).toBe(true);
  });

  it("un rappel Stripe est REFUSÉ quand aucun secret n'est configuré", async () => {
    // Le point le plus important de ce fichier : sans secret, on refuse. Un
    // repli « on accepte puisqu'on ne peut pas vérifier » transformerait un
    // oubli de configuration en porte ouverte.
    const provider = new StripeProvider(new EnvPaymentSecrets({}), forbiddenHttpClient);
    await expect(
      provider.verifyAndParse({ rawBody: Buffer.from('{}'), headers: {} }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('aucun appel réseau n’est tenté pendant ces vérifications', async () => {
    const http = vi.fn(forbiddenHttpClient);
    const provider = new StripeProvider(new EnvPaymentSecrets({}), http);
    await provider.availability();
    expect(http).not.toHaveBeenCalled();
  });
});

describe('fournisseur manuel', () => {
  const secrets = new EnvPaymentSecrets({
    LALANDA_MANUAL_PAYMENT_ACCOUNTS: 'M-Pesa|+243 970 000 000;Banque|CD12 3456',
  });

  it('décode les coordonnées de dépôt et ignore les entrées malformées', () => {
    expect(parseManualAccounts('A|1;;B|2;sans-separateur')).toEqual([
      { label: 'A', value: '1' },
      { label: 'B', value: '2' },
    ]);
    expect(parseManualAccounts(null)).toEqual([]);
  });

  it('produit des instructions portant le montant et la référence', async () => {
    const provider = new ManualProvider(secrets);
    const result = await provider.createCheckout({
      organizationId: 'org1',
      plan: 'pro',
      interval: 'month',
      method: 'mobile_money',
      amountDueCents: 900,
      currency: 'USD',
      customerEmail: 'a@b.c',
      reference: 'LLD-ABC-XYZ',
      successUrl: 'https://x/ok',
      cancelUrl: 'https://x/ko',
    });
    expect(result.mode).toBe('instructions');
    expect(result.redirectUrl).toBeUndefined();
    expect(result.instructions?.steps.join(' ')).toContain('LLD-ABC-XYZ');
    expect(result.instructions?.steps.join(' ')).toContain('9,00 USD');
    expect(result.instructions?.accounts).toHaveLength(2);
  });

  it("n'invente AUCUNE coordonnée quand rien n'est configuré", async () => {
    // Afficher un numéro plausible enverrait de l'argent réel à un inconnu.
    const provider = new ManualProvider(new EnvPaymentSecrets({}));
    const result = await provider.createCheckout({
      organizationId: 'org1',
      plan: 'pro',
      interval: 'month',
      method: 'mobile_money',
      amountDueCents: 900,
      currency: 'USD',
      customerEmail: 'a@b.c',
      reference: 'LLD-ABC-XYZ',
      successUrl: 'https://x/ok',
      cancelUrl: 'https://x/ko',
    });
    expect(result.instructions?.accounts).toEqual([]);
    expect(result.instructions?.steps[0]).toMatch(/support/i);
  });

  it('REFUSE tout rappel externe — il n’a pas de webhook', async () => {
    const provider = new ManualProvider(secrets);
    await expect(
      provider.verifyAndParse({ rawBody: Buffer.from('{}'), headers: {} }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('formate correctement un montant à centimes non ronds', () => {
    const instructions = buildInstructions({
      method: 'bank_transfer',
      amountDueCents: 2045,
      currency: 'USD',
      reference: 'R1',
      accounts: [{ label: 'B', value: '1' }],
    });
    expect(instructions.steps[0]).toContain('20,45 USD');
  });
});

describe('encodage de formulaire imbriqué', () => {
  it('indexe les tableaux à la manière de Stripe', () => {
    const encoded = encodeFormNested({
      mode: 'subscription',
      line_items: [{ quantity: 1, price_data: { currency: 'usd' } }],
    });
    expect(encoded).toContain('line_items%5B0%5D%5Bquantity%5D=1');
    expect(encoded).toContain('line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=usd');
  });

  it('omet les valeurs nulles plutôt que d’envoyer « null »', () => {
    expect(encodeFormNested({ a: null, b: undefined, c: 'x' })).toBe('c=x');
  });
});
