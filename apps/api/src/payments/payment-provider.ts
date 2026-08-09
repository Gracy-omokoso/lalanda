// ─────────────────────────────────────────────────────────────────────────────
// CONTRAT DES FOURNISSEURS DE PAIEMENT (S22b)
//
// `billing/` décide de l'ÉTAT d'un abonnement ; `payments/` décide de la MANIÈRE
// dont l'argent arrive. La frontière est ici, et elle est étroite exprès : un
// fournisseur ne sait rien des plans, des entitlements ni de la machine d'état.
// Il sait ouvrir un encaissement et traduire ses propres notifications en
// événements métier normalisés (`payment.succeeded`, `payment.failed`, …).
//
// Deux conséquences directes :
//
//   1. Ajouter un agrégateur mobile money (pawaPay, Flutterwave, MaxiCash) ne
//      touche NI `billing/`, NI la machine d'état, NI l'interface web. On écrit
//      une classe qui implémente `PaymentProvider`, on l'enregistre, c'est tout.
//   2. Tout est testable sans réseau : `createCheckout` et `verifyAndParse`
//      reçoivent leurs dépendances (HTTP, secrets) par injection.
//
// ── Pourquoi trois fournisseurs et pas quatre ────────────────────────────────
//
// La page /pricing promet « carte bancaire et mobile money (RDC, CI, SN) ».
// Carte bancaire : Stripe. Diaspora : PayPal. Mobile money : AUCUN agrégateur
// n'est intégrable de bout en bout sans compte marchand — ni les identifiants,
// ni le schéma de signature des rappels, ni le format exact des statuts ne sont
// vérifiables depuis un dépôt. Écrire un « fournisseur pawaPay » sur la foi
// d'une documentation non éprouvée produirait du code qui a l'air de marcher,
// qui passe des tests écrits contre ses propres suppositions, et qui échoue au
// premier vrai paiement — ou pire, accepte un rappel non authentique.
//
// Le mobile money est donc servi par le fournisseur `manual` : le client reçoit
// des instructions de dépôt (M-Pesa, Orange Money, Airtel Money, virement), et
// un administrateur plateforme confirme la réception. C'est manuel, c'est écrit
// tel quel dans l'interface, et c'est ce qui fonctionne RÉELLEMENT aujourd'hui.
// ─────────────────────────────────────────────────────────────────────────────

import type { Plan } from '../billing/entitlements.js';
import type { BillingInterval } from '../billing/pricing-catalog.js';
import type { SubscriptionEvent } from '../billing/subscription-state.js';

/**
 * Fournisseurs déclarés. DOIT rester identique à `SUBSCRIPTION_PROVIDERS`
 * (`billing/subscription.schema.ts`) — `payment-provider.test.ts` le vérifie.
 */
export const PAYMENT_PROVIDERS = ['stripe', 'paypal', 'manual'] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export function isPaymentProviderId(value: unknown): value is PaymentProviderId {
  return typeof value === 'string' && (PAYMENT_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Moyens de paiement présentés au client. Distincts des FOURNISSEURS : le
 * mobile money et le virement passent tous deux par `manual`, mais ne se
 * présentent pas de la même façon et n'ont pas les mêmes instructions.
 */
export const PAYMENT_METHODS = ['card', 'paypal', 'mobile_money', 'bank_transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Quel fournisseur sert quel moyen de paiement. */
export const METHOD_PROVIDER: Readonly<Record<PaymentMethod, PaymentProviderId>> = {
  card: 'stripe',
  paypal: 'paypal',
  mobile_money: 'manual',
  bank_transfer: 'manual',
};

/**
 * Disponibilité RÉELLE d'un fournisseur à l'exécution.
 *
 * Jamais un booléen seul : l'interface doit pouvoir dire POURQUOI un moyen de
 * paiement n'apparaît pas, et l'exploitation doit pouvoir constater d'où vient
 * la clé (ADR-0013 §C : « la source effective est affichée dans /admin et
 * journalisée au démarrage »).
 */
export type ProviderAvailability =
  | { available: true; source: 'db' | 'env'; mode: 'live' | 'test' | 'n/a' }
  | { available: false; reason: string; missingSecrets: readonly string[] };

/** Demande d'encaissement adressée à un fournisseur. */
export interface CheckoutRequest {
  organizationId: string;
  plan: Plan;
  interval: BillingInterval;
  method: PaymentMethod;
  /** Montant à percevoir MAINTENANT, en centimes (prorata déjà appliqué). */
  amountDueCents: number;
  currency: 'USD';
  customerEmail: string;
  /** Référence interne unique — sert de clé d'idempotence côté fournisseur. */
  reference: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Instructions affichées au client quand l'encaissement n'est pas automatisé.
 * Volontairement des données et non du HTML : l'interface les met en forme,
 * l'API décide du contenu (docs/26 — aucune règle métier dans l'UI).
 */
export interface PaymentInstructions {
  title: string;
  /** Lignes « quoi faire », dans l'ordre. */
  steps: readonly string[];
  /** Coordonnées de dépôt, si l'exploitation en a configuré. */
  accounts: readonly { label: string; value: string }[];
  /** Délai annoncé avant confirmation, en heures. */
  expectedDelayHours: number;
}

export interface CheckoutResult {
  provider: PaymentProviderId;
  /**
   * `redirect` : le client part chez le fournisseur (Stripe, PayPal).
   * `instructions` : le client paie hors ligne, un humain confirme.
   */
  mode: 'redirect' | 'instructions';
  reference: string;
  redirectUrl?: string;
  instructions?: PaymentInstructions;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
}

/** Requête de rappel (webhook) telle que reçue, corps NON PARSÉ. */
export interface WebhookRequest {
  /**
   * Octets EXACTS du corps. Jamais un objet déjà parsé : une signature porte
   * sur des octets, et `JSON.stringify(JSON.parse(x))` n'est pas `x` (ordre des
   * clés, espaces, échappement unicode). Re-sérialiser pour vérifier une
   * signature, c'est ne rien vérifier du tout.
   */
  rawBody: Buffer;
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * Événement de paiement normalisé.
 *
 * `event: null` signifie « rappel authentique, mais sans effet sur
 * l'abonnement » (un `customer.updated` de Stripe, par exemple). Ce n'est PAS
 * une erreur : il est journalisé et dédupliqué comme les autres, simplement il
 * ne déclenche aucune transition.
 */
export interface NormalizedWebhookEvent {
  provider: PaymentProviderId;
  /** Identifiant du fournisseur — clé d'idempotence. Jamais généré localement. */
  eventId: string;
  /** Type brut du fournisseur, conservé pour l'audit et le support. */
  rawType: string;
  event: SubscriptionEvent | null;
  occurredAt: Date;
  /** Résolu depuis les métadonnées du fournisseur ; `null` si absent. */
  organizationId: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  plan: Plan | null;
  interval: BillingInterval | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  /** Code d'échec normalisé (jamais un message brut non assaini). */
  failureCode: string | null;
}

/**
 * Rejet de signature. Classe DÉDIÉE et non une `Error` générique : le
 * contrôleur doit répondre 400 sans jamais confondre « signature invalide »
 * avec « corps mal formé » — le premier est une tentative d'intrusion à
 * journaliser, le second un bug d'intégration.
 */
export class WebhookSignatureError extends Error {
  readonly code = 'WEBHOOK_SIGNATURE_INVALID';

  constructor(
    readonly provider: PaymentProviderId,
    reason: string,
  ) {
    super(`Signature de rappel « ${provider} » invalide : ${reason}`);
    this.name = 'WebhookSignatureError';
  }
}

/** Le fournisseur n'est pas configuré (aucune clé) — 503, pas 500. */
export class ProviderUnavailableError extends Error {
  readonly code = 'PAYMENT_PROVIDER_UNAVAILABLE';

  constructor(
    readonly provider: PaymentProviderId,
    readonly missingSecrets: readonly string[],
  ) {
    super(
      `Fournisseur « ${provider} » non configuré — secrets manquants : ` +
        `${missingSecrets.join(', ') || 'aucun détail'}.`,
    );
    this.name = 'ProviderUnavailableError';
  }
}

/**
 * Ce que tout fournisseur doit savoir faire. Trois méthodes, pas une de plus.
 *
 * `verifyAndParse` fait les deux en UNE fois, délibérément : séparer
 * « vérifier » de « parser » laisse exister un chemin de code qui parse sans
 * avoir vérifié. Ici, on ne peut pas obtenir l'objet sans avoir prouvé la
 * signature — l'oubli n'est pas représentable.
 */
export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly methods: readonly PaymentMethod[];

  availability(): Promise<ProviderAvailability>;
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  verifyAndParse(request: WebhookRequest): Promise<NormalizedWebhookEvent>;
}

/** Premier en-tête portant ce nom, insensible à la casse. */
export function headerValue(headers: WebhookRequest['headers'], name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/**
 * Corps JSON d'un rappel DÉJÀ authentifié.
 *
 * Ne jamais appeler avant vérification de signature — c'est la seule raison
 * pour laquelle cette fonction n'est pas exportée publiquement au-delà de
 * `payments/` : parser d'abord et vérifier ensuite est l'erreur classique.
 */
export function parseVerifiedBody(raw: Buffer, provider: PaymentProviderId): unknown {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new WebhookSignatureError(provider, 'corps JSON illisible après vérification');
  }
}
