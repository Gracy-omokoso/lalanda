// ─────────────────────────────────────────────────────────────────────────────
// SERVICE ABONNEMENTS (S16b → S22b)
//
// Le seul endroit qui ÉCRIT dans `subscriptions`. Toute écriture de `status`
// passe par `applyEvent()` (`subscription-state.ts`) : il n'existe pas de
// chemin qui pose un statut à la main. C'est ce qui rend la machine d'état
// utile plutôt que décorative — une table de transitions qu'un service peut
// contourner ne protège rien.
//
// ── Répartition des responsabilités ──────────────────────────────────────────
//
//   subscription-state.ts      quel état suit quel état (pur)
//   subscription-lifecycle.ts  quel plan s'applique, quels événements sont échus (pur)
//   proration.ts               combien coûte un changement (pur)
//   billing.service.ts         lit, écrit, journalise                    ← ici
//   payments/                  d'où vient l'argent et si l'événement est authentique
//
// ── Le point non évident : la mise à jour paresseuse ─────────────────────────
//
// L'application n'a AUCUN ordonnanceur (ADR-0009, S16a : pas de worker, pas de
// `@nestjs/schedule`). Un essai qui n'expirerait qu'au passage d'un cron
// inexistant n'expirerait jamais — le client garderait Pro à vie. Les
// transitions temporelles sont donc appliquées À LA LECTURE : `getSnapshot()`
// consulte `dueEvents()` et applique ce qui est échu avant de répondre.
//
// Conséquence assumée : une organisation que personne ne consulte reste en base
// dans un état périmé. Ce n'est pas un problème de correction — personne ne
// consomme un accès qu'il ne demande pas — mais c'en est un pour les rapports
// d'exploitation. D'où `sweep()`, exposé en route d'administration, qui fait le
// même travail en lot. Le balayage est une COMMODITÉ, jamais la source de
// vérité : si on l'oublie, rien n'est faux.
// ─────────────────────────────────────────────────────────────────────────────

import { ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import {
  PLAN_ENTITLEMENTS,
  PRICING_VERSION,
  resolveEntitlements,
  type Entitlements,
  type Plan,
} from './entitlements.js';
import {
  GRACE_DAYS,
  TRIAL_DAYS,
  isSellable,
  priceCents,
  type BillingInterval,
} from './pricing-catalog.js';
import { addDays, computeProration, nextPeriodEnd, type ProrationResult } from './proration.js';
import {
  daysUntil,
  dueEvents,
  effectivePlan,
  hasUsedTrial,
  isPendingPlanDue,
  statusNotice,
  type SubscriptionSnapshot,
} from './subscription-lifecycle.js';
import {
  applyEvent,
  canApply,
  grantsPaidAccess,
  InvalidTransitionError,
  type SubscriptionEvent,
  type SubscriptionStatus,
} from './subscription-state.js';
import {
  STATUS_HISTORY_MAX,
  Subscription,
  SUBSCRIPTION_SCHEMA_VERSION,
  type SubscriptionDocument,
  type SubscriptionProvider,
} from './subscription.schema.js';

/** Détails accompagnant un événement — tous facultatifs. */
export interface ApplyEventInput {
  organizationId: string;
  event: SubscriptionEvent;
  /** Origine : `webhook:stripe`, `admin:manual`, `system:sweep`, `user`… */
  source: string;
  /** Utilisateur à l'origine, ou `null` pour un événement système. */
  actorUserId?: string | null;
  actorRole?: string;
  plan?: Plan | null;
  interval?: BillingInterval | null;
  provider?: SubscriptionProvider | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  failureCode?: string | null;
  now?: Date;
}

/** Vue complète servie à l'interface et aux tests. */
export interface SubscriptionState {
  organizationId: string;
  /** Plan SOUSCRIT (ce que le client paie). */
  plan: Plan;
  /** Plan APPLIQUÉ (ce à quoi il a droit aujourd'hui). Diffèrent si suspendu ou en essai. */
  effectivePlan: Plan;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  entitlements: Entitlements;
  paidAccess: boolean;
  trialEndsAt: Date | null;
  trialDaysLeft: number | null;
  trialUsed: boolean;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
  graceDaysLeft: number | null;
  pendingPlan: Plan | null;
  pendingInterval: BillingInterval | null;
  pendingPlanEffectiveAt: Date | null;
  provider: SubscriptionProvider | null;
  lastFailureCode: string | null;
  notice: { level: 'info' | 'warning' | 'critical'; message: string } | null;
}

/** Refus métier distinct d'une transition interdite (409 côté HTTP). */
export class BillingRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BillingRuleError';
  }
}

@Injectable()
export class BillingService {
  constructor(
    @InjectModel(Subscription.name) private readonly model: Model<SubscriptionDocument>,
    // `@Optional` : `AuthzModule` est global, mais les tests unitaires
    // construisent parfois le service seul. Une trace d'audit manquante ne doit
    // pas empêcher un abonnement de fonctionner — c'est déjà la position
    // d'`AuditService.record()` lui-même.
    @Optional() @Inject(AuditService) private readonly audit?: AuditService,
  ) {}

  // ── Lecture ────────────────────────────────────────────────────────────────

  /**
   * État courant, transitions temporelles échues APPLIQUÉES.
   *
   * Une organisation sans document reçoit un état `free`/`canceled` synthétique
   * — sans écrire en base. Créer un document à la première lecture remplirait la
   * collection d'abonnements vides pour toutes les organisations qui ne paieront
   * jamais.
   */
  async getState(organizationId: string, now: Date = new Date()): Promise<SubscriptionState> {
    const doc = await this.model.findOne({ organizationId }).exec();
    if (!doc) return this.freeState(organizationId);

    const settled = await this.settle(doc, now);
    return this.toState(settled, now);
  }

  /** Plan EFFECTIF — remplace la lecture S16b `status === 'active'`. */
  async getPlan(organizationId: string, now: Date = new Date()): Promise<Plan> {
    return (await this.getState(organizationId, now)).effectivePlan;
  }

  /** Plan + entitlements, en une lecture. Consommé par `projects/` et `reports/`. */
  async getPlanEntitlements(
    organizationId: string,
  ): Promise<{ plan: Plan; entitlements: Entitlements }> {
    const state = await this.getState(organizationId);
    return { plan: state.effectivePlan, entitlements: state.entitlements };
  }

  /**
   * Organisation propriétaire d'un abonnement CHEZ LE FOURNISSEUR, ou `null`.
   *
   * Sert au rattachement d'un rappel dépourvu de métadonnées (abonnement créé
   * hors tunnel, reprise depuis la console du fournisseur). Le couple
   * (fournisseur, identifiant d'abonnement) est la SEULE clé acceptée : un
   * rapprochement plus souple — par email, ou « le dernier client connu de ce
   * fournisseur » — attribuerait l'abonnement d'un inconnu à une organisation
   * arbitraire. Mieux vaut un rappel orphelin visible qu'un plan Business
   * silencieusement offert au mauvais client.
   *
   * `providerSubscriptionId` est indexé (voir `subscription.schema.ts`).
   */
  async findOrganizationByProviderSubscription(
    provider: SubscriptionProvider,
    providerSubscriptionId: string,
  ): Promise<string | null> {
    if (!providerSubscriptionId) return null;
    const doc = await this.model
      .findOne({ provider, providerSubscriptionId })
      .select({ organizationId: 1 })
      .exec();
    return doc?.organizationId ?? null;
  }

  // ── Écriture ───────────────────────────────────────────────────────────────

  /**
   * Force un plan actif. INTERNE (seed, support, tests) — hérité de S16b et
   * conservé tel quel : quatre suites e2e s'appuient dessus.
   *
   * Ne passe volontairement PAS par la machine d'état : c'est une porte de
   * service assumée, réservée à du code de confiance, et jamais exposée par un
   * contrôleur. La rendre « propre » en la faisant transiter par
   * `payment.succeeded` mentirait sur l'origine de l'abonnement dans l'audit.
   */
  async setPlan(organizationId: string, plan: Plan): Promise<SubscriptionDocument> {
    const now = new Date();
    return this.model
      .findOneAndUpdate(
        { organizationId },
        {
          $set: {
            plan,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: nextPeriodEnd(now, 'month'),
            _schemaVersion: SUBSCRIPTION_SCHEMA_VERSION,
          },
          // `$setOnInsert` et non `$set` : un abonnement QUI EXISTE DÉJÀ garde sa
          // version de grille. Le poser à chaque écriture ferait basculer un
          // abonné historique sur la nouvelle grille au premier changement de
          // plan, c'est-à-dire lui retirer sans le dire une promesse déjà
          // vendue — précisément la décision qui n'est pas la nôtre.
          $setOnInsert: { pricingVersion: PRICING_VERSION },
        },
        { new: true, upsert: true },
      )
      .exec();
  }

  /**
   * Démarre l'essai de 14 jours (docs/13 § Essai) — sans carte.
   *
   * Deux refus, tous deux volontairement en 409 et non en 400 : ce n'est pas la
   * requête qui est mauvaise, c'est l'état.
   *
   * - `TRIAL_ALREADY_USED` : `trialStartedAt` est renseigné. Il ne redevient
   *   jamais `null`, donc résilier ne « libère » pas un second essai — c'est
   *   exactement la fraude que docs/13 vise avec « une seule période d'essai par
   *   organisation ».
   * - `SUBSCRIPTION_ACTIVE` : un abonné qui démarrerait un essai perdrait son
   *   plan payé pour deux semaines de Pro. La machine refuse déjà la transition
   *   (`active` n'accepte pas `trial.started`) ; le message explicite évite au
   *   support de deviner.
   */
  async startTrial(input: {
    organizationId: string;
    actorUserId: string;
    actorRole: string;
    now?: Date;
  }): Promise<SubscriptionState> {
    const now = input.now ?? new Date();
    const existing = await this.model.findOne({ organizationId: input.organizationId }).exec();

    if (existing && hasUsedTrial(existing)) {
      throw new BillingRuleError(
        'TRIAL_ALREADY_USED',
        "Cette organisation a déjà bénéficié de sa période d'essai.",
      );
    }
    if (existing && !canApply(existing.status, 'trial.started')) {
      throw new BillingRuleError(
        'SUBSCRIPTION_ACTIVE',
        "Un abonnement est déjà en cours : l'essai ne s'applique pas.",
      );
    }

    const doc =
      existing ??
      new this.model({
        organizationId: input.organizationId,
        plan: 'free',
        status: 'canceled',
        // Document CRÉÉ maintenant : l'organisation n'a jamais rien souscrit,
        // elle n'a donc aucune promesse antérieure à conserver et relève de la
        // grille courante.
        pricingVersion: PRICING_VERSION,
        _schemaVersion: SUBSCRIPTION_SCHEMA_VERSION,
      });

    return this.transition(doc, {
      organizationId: input.organizationId,
      event: 'trial.started',
      source: 'user',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      now,
    });
  }

  /**
   * Applique un événement de paiement VÉRIFIÉ.
   *
   * Appelé par `payments/` après authentification du rappel et déduplication.
   * Ce service ne vérifie AUCUNE signature — il ne saurait pas, et la
   * duplication de cette responsabilité produirait fatalement deux règles
   * divergentes.
   *
   * Lève `InvalidTransitionError` sur une transition non déclarée. L'appelant
   * doit alors journaliser et répondre 200 : un `payment.succeeded` arrivé après
   * un `subscription.canceled` réémis n'est pas une erreur du fournisseur, et le
   * faire retenter trois jours ne changera rien.
   */
  async applyPaymentEvent(input: ApplyEventInput): Promise<SubscriptionState> {
    const now = input.now ?? new Date();
    const doc =
      (await this.model.findOne({ organizationId: input.organizationId }).exec()) ??
      new this.model({
        organizationId: input.organizationId,
        plan: 'free',
        status: 'canceled',
        // Document CRÉÉ maintenant : l'organisation n'a jamais rien souscrit,
        // elle n'a donc aucune promesse antérieure à conserver et relève de la
        // grille courante.
        pricingVersion: PRICING_VERSION,
        _schemaVersion: SUBSCRIPTION_SCHEMA_VERSION,
      });

    // Les transitions temporelles échues sont réglées AVANT l'événement reçu :
    // un paiement qui arrive le lendemain de l'expiration d'un essai doit voir
    // `canceled`, pas `trialing`. Sans cela, la période de facturation serait
    // calculée depuis une date d'essai périmée.
    await this.settle(doc, now);
    return this.transition(doc, { ...input, now });
  }

  /**
   * Chiffre un changement de plan, sans rien encaisser ni rien modifier.
   *
   * Rendu séparément de l'exécution parce que le client doit VOIR le montant
   * avant de payer — et parce qu'une baisse de gamme, elle, s'applique
   * réellement ici : elle ne coûte rien et ne peut pas échouer.
   */
  async quotePlanChange(input: {
    organizationId: string;
    targetPlan: Plan;
    targetInterval: BillingInterval;
    now?: Date;
  }): Promise<{ state: SubscriptionState; proration: ProrationResult; amountDueCents: number }> {
    const now = input.now ?? new Date();
    const state = await this.getState(input.organizationId, now);

    if (!isSellable(input.targetPlan, input.targetInterval)) {
      throw new BillingRuleError(
        'PLAN_NOT_SELLABLE',
        `L'offre « ${input.targetPlan} » n'est pas commercialisée en « ${input.targetInterval} ».`,
      );
    }

    const proration = computeProration({
      // Le plan de RÉFÉRENCE est le plan effectif : un client en essai part de
      // Pro offert, pas de son `plan` stocké qui vaut encore `free`. Facturer un
      // prorata depuis `free` reviendrait à lui faire payer une période entière
      // alors qu'il lui restait des jours d'essai.
      currentPlan: state.effectivePlan,
      targetPlan: input.targetPlan,
      currentInterval: state.billingInterval,
      targetInterval: input.targetInterval,
      currentPeriodEnd: state.currentPeriodEnd,
      now,
    });

    // Un plan sans période payée en cours (essai, résilié, suspendu) se souscrit
    // au tarif plein : il n'y a rien à créditer.
    const full = priceCents(input.targetPlan, input.targetInterval) ?? 0;
    const amountDueCents =
      proration.effect === 'immediate' && state.currentPeriodEnd
        ? proration.amountDueCents
        : proration.effect === 'immediate'
          ? full
          : 0;

    return { state, proration, amountDueCents };
  }

  /**
   * Programme une baisse de gamme à l'échéance (docs/13 : « baisse à la
   * prochaine échéance »).
   *
   * Aucune donnée n'est supprimée et aucun projet n'est fermé — docs/13 :
   * « aucune suppression automatique de projet ». La limite du plan inférieur
   * s'appliquera aux CRÉATIONS futures, ce que `projects/` fait déjà.
   */
  async schedulePlanChange(input: {
    organizationId: string;
    targetPlan: Plan;
    targetInterval: BillingInterval;
    actorUserId: string;
    actorRole: string;
    now?: Date;
  }): Promise<SubscriptionState> {
    const now = input.now ?? new Date();
    const doc = await this.model.findOne({ organizationId: input.organizationId }).exec();
    if (!doc) {
      throw new BillingRuleError('NO_SUBSCRIPTION', 'Aucun abonnement à modifier.');
    }
    await this.settle(doc, now);

    doc.pendingPlan = input.targetPlan;
    doc.pendingInterval = input.targetInterval;
    // Sans période en cours, la baisse prend effet tout de suite : il n'y a
    // aucune échéance à attendre.
    doc.pendingPlanEffectiveAt = doc.currentPeriodEnd ?? now;
    await doc.save();

    await this.audit?.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'subscription.plan_change_scheduled',
      targetType: 'subscription',
      targetId: input.organizationId,
      metadata: {
        targetPlan: input.targetPlan,
        targetInterval: input.targetInterval,
        effectiveAt: doc.pendingPlanEffectiveAt.toISOString(),
      },
    });

    // Relecture par `settle` : si l'échéance est déjà passée, le changement est
    // appliqué immédiatement plutôt que laissé en attente.
    const settled = await this.settle(doc, now);
    return this.toState(settled, now);
  }

  /** Résiliation. Les données restent intactes (docs/13 § Essai). */
  async cancel(input: {
    organizationId: string;
    actorUserId: string;
    actorRole: string;
    now?: Date;
  }): Promise<SubscriptionState> {
    const now = input.now ?? new Date();
    const doc = await this.model.findOne({ organizationId: input.organizationId }).exec();
    if (!doc) throw new BillingRuleError('NO_SUBSCRIPTION', 'Aucun abonnement à résilier.');

    await this.settle(doc, now);
    if (!canApply(doc.status, 'subscription.canceled')) {
      throw new BillingRuleError('ALREADY_CANCELED', 'Cet abonnement est déjà clos.');
    }

    return this.transition(doc, {
      organizationId: input.organizationId,
      event: 'subscription.canceled',
      source: 'user',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      now,
    });
  }

  /**
   * Balayage des essais et grâces échus. Commodité d'exploitation.
   *
   * Borné (`limit`) et sélectif par index : `{ status, trialEndsAt }` et
   * `{ status, graceEndsAt }` évitent un parcours complet d'une collection qui
   * grandit avec le nombre de clients.
   */
  async sweep(now: Date = new Date(), limit = 200): Promise<{ scanned: number; changed: number }> {
    const candidates = await this.model
      .find({
        $or: [
          { status: 'trialing', trialEndsAt: { $lte: now } },
          { status: 'grace', graceEndsAt: { $lte: now } },
          { pendingPlanEffectiveAt: { $lte: now }, pendingPlan: { $ne: null } },
        ],
      })
      .limit(Math.min(Math.max(limit, 1), 1000))
      .exec();

    let changed = 0;
    for (const doc of candidates) {
      const before = `${doc.status}:${doc.plan}`;
      await this.settle(doc, now);
      if (`${doc.status}:${doc.plan}` !== before) changed += 1;
    }
    return { scanned: candidates.length, changed };
  }

  // ── Interne ────────────────────────────────────────────────────────────────

  /**
   * Applique tout ce qui est ÉCHU sur un document : expiration d'essai, fin de
   * grâce, baisse de gamme différée. Persiste et renvoie le document.
   *
   * La boucle est bornée à quatre passages. `dueEvents()` ne renvoie qu'un
   * événement à la fois et aucune chaîne connue n'en enchaîne plus de deux ;
   * la borne existe pour qu'une future transition mal déclarée provoque un état
   * incomplet plutôt qu'une boucle infinie dans une requête HTTP.
   */
  private async settle(doc: SubscriptionDocument, now: Date): Promise<SubscriptionDocument> {
    let dirty = false;

    for (let pass = 0; pass < 4; pass += 1) {
      const [next] = dueEvents(doc, now);
      if (!next) break;
      this.mutate(doc, { organizationId: doc.organizationId, event: next, source: 'system', now });
      dirty = true;
      await this.audit?.record({
        organizationId: doc.organizationId,
        actorUserId: 'system',
        actorRole: 'system',
        action: `subscription.${next}`,
        targetType: 'subscription',
        targetId: doc.organizationId,
        metadata: { status: doc.status, plan: doc.plan },
      });
    }

    if (isPendingPlanDue(doc, now)) {
      doc.plan = doc.pendingPlan!;
      doc.billingInterval = doc.pendingInterval ?? doc.billingInterval;
      doc.pendingPlan = null;
      doc.pendingInterval = null;
      doc.pendingPlanEffectiveAt = null;
      dirty = true;
    }

    if (dirty) await doc.save();
    return doc;
  }

  /** Transition + persistance + audit, en un point unique. */
  private async transition(
    doc: SubscriptionDocument,
    input: ApplyEventInput,
  ): Promise<SubscriptionState> {
    const now = input.now ?? new Date();
    const from = doc.status;
    this.mutate(doc, { ...input, now });
    await doc.save();

    await this.audit?.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? 'system',
      actorRole: input.actorRole ?? 'system',
      action: `subscription.${input.event}`,
      targetType: 'subscription',
      targetId: input.organizationId,
      metadata: {
        from,
        to: doc.status,
        plan: doc.plan,
        source: input.source,
        provider: input.provider ?? null,
      },
    });

    return this.toState(doc, now);
  }

  /**
   * Effets d'un événement sur le document. PAS de persistance ici.
   *
   * `applyEvent` d'abord : si la transition est interdite, rien n'est modifié.
   * L'ordre inverse laisserait un document à moitié écrit sur un refus.
   */
  private mutate(doc: SubscriptionDocument, input: ApplyEventInput): void {
    const now = input.now ?? new Date();
    const from = doc.status;
    const to = applyEvent(from, input.event);

    switch (input.event) {
      case 'trial.started':
        doc.trialStartedAt = now;
        doc.trialEndsAt = addDays(now, TRIAL_DAYS);
        break;

      case 'trial.expired':
        // Ni `plan` ni aucune donnée ne changent : le retour au gratuit passe par
        // `effectivePlan()`, qui répond `free` sur `canceled`. Écraser `plan`
        // ferait perdre l'information « ce client voulait Pro », précieuse pour
        // la relance commerciale.
        break;

      case 'payment.succeeded': {
        // Un paiement matérialise le plan payé : celui porté par l'événement
        // (métadonnées du fournisseur), à défaut le changement en attente, à
        // défaut le plan courant.
        doc.plan = input.plan ?? doc.pendingPlan ?? doc.plan;
        doc.billingInterval = input.interval ?? doc.pendingInterval ?? doc.billingInterval;
        doc.pendingPlan = null;
        doc.pendingInterval = null;
        doc.pendingPlanEffectiveAt = null;
        doc.currentPeriodStart = input.currentPeriodStart ?? now;
        doc.currentPeriodEnd =
          input.currentPeriodEnd ?? nextPeriodEnd(doc.currentPeriodStart, doc.billingInterval);
        doc.lastPaymentAt = now;
        // L'échec précédent est effacé : le laisser afficherait « paiement en
        // échec » à un client à jour.
        doc.lastFailureCode = null;
        doc.graceEndsAt = null;
        doc.canceledAt = null;
        break;
      }

      case 'payment.failed':
        doc.lastPaymentFailureAt = now;
        doc.lastFailureCode = input.failureCode ?? 'unknown';
        break;

      case 'dunning.exhausted':
        doc.graceEndsAt = addDays(now, GRACE_DAYS);
        break;

      case 'grace.expired':
        doc.graceEndsAt = null;
        break;

      case 'subscription.canceled':
        doc.canceledAt = now;
        doc.pendingPlan = null;
        doc.pendingInterval = null;
        doc.pendingPlanEffectiveAt = null;
        break;
    }

    if (input.provider !== undefined && input.provider !== null) doc.provider = input.provider;
    if (input.providerCustomerId) doc.providerCustomerId = input.providerCustomerId;
    if (input.providerSubscriptionId) doc.providerSubscriptionId = input.providerSubscriptionId;

    doc.status = to;
    doc._schemaVersion = SUBSCRIPTION_SCHEMA_VERSION;

    doc.statusHistory.push({ from, to, event: input.event, at: now, source: input.source });
    if (doc.statusHistory.length > STATUS_HISTORY_MAX) {
      doc.statusHistory.splice(0, doc.statusHistory.length - STATUS_HISTORY_MAX);
    }
  }

  /** Document → vue. Aucune écriture. */
  private toState(doc: SubscriptionDocument, now: Date): SubscriptionState {
    const snapshot: SubscriptionSnapshot = doc;
    const effective = effectivePlan(snapshot);

    return {
      organizationId: doc.organizationId,
      plan: doc.plan,
      effectivePlan: effective,
      status: doc.status,
      billingInterval: doc.billingInterval ?? 'month',
      // `resolveEntitlements` et non `PLAN_ENTITLEMENTS[…]` : un abonnement
      // souscrit sous l'ancienne grille garde ce qui lui a été VENDU tant que le
      // décideur n'a pas tranché la bascule (voir `entitlements.ts` §
      // ANTÉRIORITÉ). Un document sans `pricingVersion` est antérieur.
      entitlements: resolveEntitlements(effective, doc.pricingVersion),
      paidAccess: grantsPaidAccess(doc.status),
      trialEndsAt: doc.trialEndsAt ?? null,
      trialDaysLeft: doc.status === 'trialing' ? daysUntil(doc.trialEndsAt, now) : null,
      trialUsed: hasUsedTrial(snapshot),
      currentPeriodEnd: doc.currentPeriodEnd ?? null,
      graceEndsAt: doc.graceEndsAt ?? null,
      graceDaysLeft: doc.status === 'grace' ? daysUntil(doc.graceEndsAt, now) : null,
      pendingPlan: doc.pendingPlan ?? null,
      pendingInterval: doc.pendingInterval ?? null,
      pendingPlanEffectiveAt: doc.pendingPlanEffectiveAt ?? null,
      provider: doc.provider ?? null,
      lastFailureCode: doc.lastFailureCode ?? null,
      notice: statusNotice(snapshot, now),
    };
  }

  /** État d'une organisation sans document — jamais persisté. */
  private freeState(organizationId: string): SubscriptionState {
    return {
      organizationId,
      plan: 'free',
      effectivePlan: 'free',
      status: 'canceled',
      billingInterval: 'month',
      entitlements: PLAN_ENTITLEMENTS.free,
      paidAccess: false,
      trialEndsAt: null,
      trialDaysLeft: null,
      trialUsed: false,
      currentPeriodEnd: null,
      graceEndsAt: null,
      graceDaysLeft: null,
      pendingPlan: null,
      pendingInterval: null,
      pendingPlanEffectiveAt: null,
      provider: null,
      lastFailureCode: null,
      notice: null,
    };
  }
}

/** Réexporté pour que `payments/` n'ait pas à connaître `subscription-state.js`. */
export { InvalidTransitionError };

/** Assure la conversion d'une erreur de transition en réponse HTTP stable. */
export function toConflict(error: unknown): ConflictException | null {
  if (error instanceof InvalidTransitionError) {
    return new ConflictException({
      code: error.code,
      from: error.from,
      event: error.event,
    });
  }
  if (error instanceof BillingRuleError) {
    return new ConflictException({ code: error.code, message: error.message });
  }
  return null;
}
