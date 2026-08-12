import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { PLANS, type Plan } from './entitlements.js';
import { BILLING_INTERVALS, type BillingInterval } from './pricing-catalog.js';
import {
  SUBSCRIPTION_EVENTS,
  SUBSCRIPTION_STATUSES,
  type SubscriptionEvent,
  type SubscriptionStatus,
} from './subscription-state.js';

/** Version de schéma courante (ADR-0004 §8). S16b = 1, S22b = 2. */
export const SUBSCRIPTION_SCHEMA_VERSION = 2;

/**
 * Identifiants des fournisseurs de paiement, dupliqués ici volontairement.
 *
 * `payments/` dépend de `billing/` (il pilote l'abonnement) ; l'inverse
 * créerait un cycle de modules Nest. Le test `payments/payment-provider.test.ts`
 * vérifie que les deux listes restent identiques — la duplication est donc
 * surveillée, pas subie.
 *
 * Trois valeurs et pas quatre : le mobile money est servi par `manual` (dépôt
 * confirmé par un administrateur), faute d'agrégateur intégrable sans compte
 * marchand. Le raisonnement complet est dans `payments/payment-provider.ts`.
 */
export const SUBSCRIPTION_PROVIDERS = ['stripe', 'paypal', 'manual'] as const;
export type SubscriptionProvider = (typeof SUBSCRIPTION_PROVIDERS)[number];

/** Une transition d'état, conservée pour l'assistance et le support client. */
@Schema({ _id: false })
export class SubscriptionTransition {
  @Prop({ type: String, required: true, enum: SUBSCRIPTION_STATUSES as unknown as string[] })
  from!: SubscriptionStatus;

  @Prop({ type: String, required: true, enum: SUBSCRIPTION_STATUSES as unknown as string[] })
  to!: SubscriptionStatus;

  @Prop({ type: String, required: true, enum: SUBSCRIPTION_EVENTS as unknown as string[] })
  event!: SubscriptionEvent;

  @Prop({ type: Date, required: true })
  at!: Date;

  /** Origine : `webhook:stripe`, `admin`, `system:trial-expiry`, `user`… */
  @Prop({ type: String, required: true })
  source!: string;
}

export const SubscriptionTransitionSchema = SchemaFactory.createForClass(SubscriptionTransition);

/**
 * Abonnement d'une organisation.
 *
 * S16b : `plan` + `status: 'active'`, aucun paiement.
 * S22b : cycle de vie complet (docs/13), essai 14 jours, références fournisseur.
 *
 * Une organisation SANS document reste en plan `free` — inchangé. Un document
 * est créé au démarrage de l'essai ou à la première tentative de souscription.
 *
 * COMPATIBILITÉ ASCENDANTE : les documents `_schemaVersion: 1` n'ont ni
 * `trialEndsAt`, ni `billingInterval`, ni `statusHistory`. Ils portent
 * `status: 'active'`, valeur toujours présente dans l'énumération élargie, et
 * les lectures passent par `normalizeSubscription()` qui comble les absents.
 * Aucune migration de données n'est donc requise pour que S22b démarre — c'est
 * un choix : une migration obligatoire sur la collection qui porte l'argent est
 * un risque disproportionné pour des champs tous optionnels.
 */
@Schema({ collection: 'subscriptions', timestamps: true, strict: true })
export class Subscription {
  /** Une seule subscription par organisation. */
  @Prop({ type: String, required: true, unique: true, index: true })
  organizationId!: string;

  /** Plan SOUSCRIT. Le plan EFFECTIF dépend aussi du statut — voir `effectivePlan()`. */
  @Prop({ type: String, required: true, enum: PLANS as unknown as string[], default: 'free' })
  plan!: Plan;

  @Prop({
    type: String,
    required: true,
    enum: SUBSCRIPTION_STATUSES as unknown as string[],
    default: 'canceled',
    index: true,
  })
  status!: SubscriptionStatus;

  @Prop({
    type: String,
    required: true,
    enum: BILLING_INTERVALS as unknown as string[],
    default: 'month',
  })
  billingInterval!: BillingInterval;

  // ── Essai (docs/13 § Essai) ────────────────────────────────────────────────

  /**
   * Date de démarrage de l'essai. Ne redevient JAMAIS `null` : c'est elle qui
   * garantit « une seule période d'essai par organisation ». Un essai consommé
   * reste consommé après résiliation.
   */
  @Prop({ type: Date, default: null })
  trialStartedAt!: Date | null;

  @Prop({ type: Date, default: null, index: true })
  trialEndsAt!: Date | null;

  // ── Période de facturation ─────────────────────────────────────────────────

  @Prop({ type: Date, default: null })
  currentPeriodStart!: Date | null;

  @Prop({ type: Date, default: null })
  currentPeriodEnd!: Date | null;

  /** Fin de la période de grâce après épuisement des tentatives de paiement. */
  @Prop({ type: Date, default: null, index: true })
  graceEndsAt!: Date | null;

  @Prop({ type: Date, default: null })
  canceledAt!: Date | null;

  // ── Changement de plan différé (docs/13 : « baisse à la prochaine échéance ») ──

  @Prop({ type: String, enum: [...PLANS, null] as unknown as string[], default: null })
  pendingPlan!: Plan | null;

  @Prop({
    type: String,
    enum: [...BILLING_INTERVALS, null] as unknown as string[],
    default: null,
  })
  pendingInterval!: BillingInterval | null;

  @Prop({ type: Date, default: null })
  pendingPlanEffectiveAt!: Date | null;

  // ── Fournisseur de paiement ────────────────────────────────────────────────

  @Prop({
    type: String,
    enum: [...SUBSCRIPTION_PROVIDERS, null] as unknown as string[],
    default: null,
  })
  provider!: SubscriptionProvider | null;

  /**
   * Identifiants CÔTÉ FOURNISSEUR (client, abonnement). Ce ne sont pas des
   * secrets — ce sont des références opaques, indispensables au support. Aucune
   * donnée de carte, aucun jeton de paiement n'est jamais stocké ici : Lalanda
   * ne voit jamais un numéro de carte (voir ADR-0014, choix de Checkout).
   */
  @Prop({ type: String, default: null })
  providerCustomerId!: string | null;

  @Prop({ type: String, default: null, index: true })
  providerSubscriptionId!: string | null;

  @Prop({ type: Date, default: null })
  lastPaymentAt!: Date | null;

  @Prop({ type: Date, default: null })
  lastPaymentFailureAt!: Date | null;

  /** Code d'échec normalisé du fournisseur (jamais un message brut non assaini). */
  @Prop({ type: String, default: null })
  lastFailureCode!: string | null;

  /**
   * Historique borné des transitions (les 50 dernières).
   *
   * Borné parce qu'un abonnement mensuel de cinq ans produit 60 renouvellements
   * et autant d'échecs possibles : un tableau non borné dans un document qu'on
   * lit à CHAQUE création de projet finirait par coûter cher en lecture. Le
   * journal faisant foi est `audit_events`, append-only ; ceci n'en est qu'un
   * résumé de confort.
   */
  @Prop({ type: [SubscriptionTransitionSchema], default: [] })
  statusHistory!: SubscriptionTransition[];

  /**
   * Version de la GRILLE TARIFAIRE acceptée par cet abonnement.
   *
   * À ne pas confondre avec `_schemaVersion`, qui décrit la forme du document.
   * Celui-ci décrit une PROMESSE COMMERCIALE : un abonnement souscrit sous
   * l'ancienne grille (« projets illimités en Pro ») n'a jamais accepté la
   * nouvelle, et `resolveEntitlements()` continue de le servir à l'ancienne.
   *
   * `null` = antérieur à la grille à cinq paliers. C'est la valeur des documents
   * déjà en base, qu'aucune migration ne touche — voir `entitlements.ts` §
   * ANTÉRIORITÉ, et docs/13 § Antériorité des comptes déjà inscrits. La décision
   * de basculer ces comptes appartient au décideur, pas au code.
   */
  @Prop({ type: Number, default: null })
  pricingVersion!: number | null;

  @Prop({ type: Number, required: true, default: SUBSCRIPTION_SCHEMA_VERSION })
  _schemaVersion!: number;

  // Champs auto-ajoutés par `timestamps: true` (Mongoose). Déclarés pour le typage.
  createdAt!: Date;
  updatedAt!: Date;
}

export type SubscriptionDocument = HydratedDocument<Subscription>;
export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

/** Nombre maximal de transitions conservées dans `statusHistory`. */
export const STATUS_HISTORY_MAX = 50;

// Balayage des essais et des grâces échus : un index sur la date évite un scan
// complet de la collection à chaque passage du balayage.
SubscriptionSchema.index({ status: 1, trialEndsAt: 1 });
SubscriptionSchema.index({ status: 1, graceEndsAt: 1 });
