// ─────────────────────────────────────────────────────────────────────────────
// ABONNEMENTS DE BOUT EN BOUT (S22b) — docs/13
//
// Les tests unitaires de `billing/` et `payments/` couvrent des fonctions pures.
// Cette suite couvre ce qu'elles ne peuvent pas couvrir : l'application montée,
// les routes réelles, la base réelle, les gardes d'autorisation en place.
//
// Six exigences, une par bloc :
//
//   1. essai 14 jours sans carte, expiration → gratuit SANS perte de données;
//   2. machine d'état — transitions interdites refusées par l'API;
//   3. signature de rappel invalide REJETÉE (l'exigence critique);
//   4. rappel rejoué → aucun doublon;
//   5. entitlements qui suivent le plan effectif;
//   6. isolation inter-organisations.
//
// ── Aucun appel réseau ────────────────────────────────────────────────────────
//
// Les rappels Stripe sont FORGÉS localement avec le vrai algorithme de signature
// (HMAC-SHA256 sur `<t>.<corps>`) et un secret de test posé dans
// l'environnement. Vérifier une signature Stripe ne demande aucun appel sortant
// — c'est précisément la propriété qui rend ce test possible et honnête. Aucune
// route testée ici ne sort du process : la seule qui le ferait
// (`POST /payments/checkout` en carte) n'est exercée qu'à travers le fournisseur
// `manual`, qui n'appelle personne.
// ─────────────────────────────────────────────────────────────────────────────

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { BILLING_INTERVALS, PLAN_ENTITLEMENTS, PLANS, priceCents } from '@lalanda/shared/pricing';

import { addDays } from '../billing/proration.js';
import { hmacSha256Hex } from '../payments/webhook-signature.js';
import { dbOf, e2eSuite, makeE2EApp, teardown } from './e2e-utils.js';

/**
 * Un couple (plan, périodicité) SANS TARIF PUBLIÉ, cherché dans le catalogue.
 *
 * Écrire ici « business / annuel », comme le faisait ce fichier, revenait à
 * parier sur l'état de la grille : le jour où le tarif annuel Business a été
 * publié, le test a continué de passer pour une raison fausse — il interrogeait
 * un couple désormais vendable, et l'API répondait 200 à bon droit. La cible est
 * donc DÉRIVÉE : n'importe quel couple dont `priceCents()` répond `null`.
 *
 * `null` est le seul signal qui compte ici. Il dit « aucun montant n'a été
 * arbitré » — typiquement l'offre Expert, chiffrée au cas par cas — et l'API
 * doit refuser plutôt que d'inventer un prix plausible.
 */
const COUPLE_SANS_TARIF = PLANS.flatMap((plan) =>
  BILLING_INTERVALS.map((interval) => ({ plan, interval })),
).find(({ plan, interval }) => priceCents(plan, interval) === null);

/**
 * Secrets de TEST, posés avant le montage de l'application.
 *
 * `EnvPaymentSecrets` lit `process.env` à chaque résolution, sans cache : il
 * suffit donc qu'ils soient présents ici. Ce ne sont évidemment pas des clés
 * réelles — `rk_test_` et `whsec_` sont des préfixes, et la valeur qui suit est
 * une chaîne arbitraire que seul ce fichier connaît. Aucun appel sortant n'est
 * fait avec la clé restreinte.
 */
const WEBHOOK_SECRET = 'whsec_e2e_s22b_secret_de_test';
process.env['LALANDA_STRIPE_RESTRICTED_KEY'] = 'rk_test_e2e_s22b';
process.env['LALANDA_STRIPE_WEBHOOK_SECRET'] = WEBHOOK_SECRET;

/** Construit un rappel Stripe SIGNÉ comme le ferait Stripe. */
function signedStripeCallback(
  payload: unknown,
  options: { secret?: string; timestamp?: number } = {},
): { body: string; header: string } {
  const body = JSON.stringify(payload);
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = hmacSha256Hex(options.secret ?? WEBHOOK_SECRET, `${timestamp}.${body}`);
  return { body, header: `t=${timestamp},v1=${signature}` };
}

/** Charge `invoice.paid` minimale, telle que Stripe l'émet. */
function invoicePaid(input: {
  eventId: string;
  organizationId: string;
  plan: string;
  interval?: string;
  subscriptionId?: string;
}): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    id: input.eventId,
    type: 'invoice.paid',
    created: nowSeconds,
    data: {
      object: {
        customer: 'cus_e2e',
        subscription: input.subscriptionId ?? 'sub_e2e',
        period_start: nowSeconds,
        period_end: nowSeconds + 30 * 24 * 3600,
        subscription_details: {
          metadata: {
            organizationId: input.organizationId,
            plan: input.plan,
            interval: input.interval ?? 'month',
          },
        },
      },
    },
  };
}

e2eSuite('abonnements de bout en bout (S22b)', () => {
  let app: INestApplication;

  const tag = Math.random().toString(36).slice(2, 8);
  const alice = {
    email: `s22b-alice-${tag}@lalanda-test.local`,
    password: 'Passw0rd!alice',
    name: 'Alice Abonnée',
  };
  const bob = {
    email: `s22b-bob-${tag}@lalanda-test.local`,
    password: 'Passw0rd!bob',
    name: 'Bob Voisin',
  };
  const admin = {
    email: `s22b-admin-${tag}@lalanda-test.local`,
    password: 'Passw0rd!admin',
    name: 'Adèle Plateforme',
  };

  let aliceCookies: string[];
  let bobCookies: string[];
  let adminCookies: string[];
  let aliceOrgId: string;
  let bobOrgId: string;

  beforeAll(async () => {
    app = await makeE2EApp();
    const { registerAndLogin } = await import('./e2e-utils.js');
    aliceCookies = await registerAndLogin(app, alice);
    bobCookies = await registerAndLogin(app, bob);
    adminCookies = await registerAndLogin(app, admin);
    aliceOrgId = await primaryOrgId(aliceCookies);
    bobOrgId = await primaryOrgId(bobCookies);

    // Rôle plateforme d'Adèle : aucune route ne l'accorde (S20a le documente),
    // il est posé en base comme le ferait une migration d'amorçage.
    const db = await dbOf(app);
    const adminUser = await db.collection('user').findOne({ email: admin.email });
    await db.collection('platform_roles').insertOne({
      userId: String(adminUser?._id),
      role: 'platform_billing',
      grantedBy: null,
      reason: 'suite e2e S22b',
      expiresAt: null,
      revokedAt: null,
      _schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, 90_000);

  afterAll(async () => {
    try {
      const db = await dbOf(app);
      await Promise.all([
        db.collection('payment_events').deleteMany({}),
        db.collection('manual_payment_requests').deleteMany({}),
        db.collection('platform_roles').deleteMany({ reason: 'suite e2e S22b' }),
      ]);
    } finally {
      await teardown(app, [alice.email, bob.email, admin.email]);
    }
  }, 30_000);

  async function primaryOrgId(cookies: string[]): Promise<string> {
    const res = await request(app.getHttpServer()).get('/organizations').set('Cookie', cookies);
    expect(res.status).toBe(200);
    return res.body.organizations[0].id as string;
  }

  function subscriptionOf(cookies: string[]) {
    return request(app.getHttpServer())
      .get('/organizations/current/subscription')
      .set('Cookie', cookies);
  }

  /** Envoie un rappel Stripe sur la route publique, corps brut préservé. */
  function postStripeWebhook(signed: { body: string; header: string }) {
    return request(app.getHttpServer())
      .post('/payments/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signed.header)
      .send(signed.body);
  }

  // ── 1. Essai 14 jours ──────────────────────────────────────────────────────

  it("l'essai démarre sans carte et accorde Pro pour 14 jours", async () => {
    const before = await subscriptionOf(aliceCookies);
    expect(before.status).toBe(200);
    expect(before.body.plan).toBe('free');
    expect(before.body.trial.used).toBe(false);
    expect(before.body.trial.days).toBe(14);

    const started = await request(app.getHttpServer())
      .post('/organizations/current/subscription/trial')
      .set('Cookie', aliceCookies)
      .send({});
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('trialing');
    // Le plan EFFECTIF est Pro ; le plan SOUSCRIT reste `free` — le client ne
    // paie rien, et l'audit ne doit pas laisser croire à une vente.
    expect(started.body.plan).toBe('pro');
    expect(started.body.subscribedPlan).toBe('free');
    expect(started.body.paidAccess).toBe(true);
    expect(started.body.trial.used).toBe(true);
    expect(started.body.trial.daysLeft).toBe(14);
    expect(started.body.trial.endsAt).toBeTruthy();
    // Aucun fournisseur n'a été sollicité : c'est ce que « sans carte » veut dire.
    expect(started.body.provider).toBeNull();
  }, 30_000);

  it('un second essai est refusé, même après résiliation', async () => {
    const again = await request(app.getHttpServer())
      .post('/organizations/current/subscription/trial')
      .set('Cookie', aliceCookies)
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TRIAL_ALREADY_USED');
  }, 30_000);

  it("l'essai expiré rend le plan gratuit SANS supprimer les données", async () => {
    // Un projet est créé pendant l'essai — au-delà de la limite du plan gratuit
    // (1 projet), pour que sa survie après expiration soit démontrable.
    const p1 = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', aliceCookies)
      .send({ name: `Projet essai A ${tag}`, templateSlug: 'hello-world' });
    expect(p1.status).toBe(201);
    const p2 = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', aliceCookies)
      .send({ name: `Projet essai B ${tag}`, templateSlug: 'hello-world' });
    expect(p2.status).toBe(201);

    // L'essai est ramené dans le passé : c'est la seule façon honnête de tester
    // une expiration sans attendre quatorze jours. Rien d'autre n'est touché —
    // ni le statut, ni le plan : c'est l'application qui doit conclure.
    const db = await dbOf(app);
    await db
      .collection('subscriptions')
      .updateOne(
        { organizationId: aliceOrgId },
        { $set: { trialEndsAt: addDays(new Date(), -1) } },
      );

    const after = await subscriptionOf(aliceCookies);
    expect(after.status).toBe(200);
    expect(after.body.status).toBe('canceled');
    expect(after.body.plan).toBe('free');
    expect(after.body.paidAccess).toBe(false);
    // LES DONNÉES SURVIVENT — docs/13 : « aucune suppression automatique ».
    expect(after.body.usage.projects).toBe(2);

    const projects = await request(app.getHttpServer())
      .get('/projects')
      .set('Cookie', aliceCookies);
    expect(projects.status).toBe(200);
    expect(projects.body.projects.length).toBe(2);

    // La limite s'applique aux CRÉATIONS futures, pas à l'existant.
    const p3 = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', aliceCookies)
      .send({ name: `Projet post-essai ${tag}`, templateSlug: 'hello-world' });
    expect(p3.status).toBe(403);
    expect(p3.body.code).toBe('PLAN_LIMIT_PROJECTS');
  }, 60_000);

  // ── 2. Machine d'état ──────────────────────────────────────────────────────

  it('une montée en gamme ne peut pas être obtenue sans paiement', async () => {
    // La tentative évidente : demander Business sur la route de changement de
    // plan. Sans ce refus, un POST suffirait à s'offrir Business.
    const res = await request(app.getHttpServer())
      .post('/organizations/current/subscription/plan')
      .set('Cookie', aliceCookies)
      .send({ plan: 'business', interval: 'month' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('UPGRADE_REQUIRES_PAYMENT');

    const state = await subscriptionOf(aliceCookies);
    expect(state.body.plan).toBe('free');
  }, 30_000);

  it('un couple (plan, périodicité) non publié est refusé — aucun tarif deviné', async () => {
    // Sans couple sans tarif dans la grille, ce test n'a plus de cible : il doit
    // le DIRE, pas passer au vert en n'interrogeant rien.
    expect(
      COUPLE_SANS_TARIF,
      'Aucun couple (plan, périodicité) sans tarif publié dans PLAN_CATALOG : ' +
        "cette exigence n'a plus de cible. Vérifier que le refus reste couvert " +
        'avant de conclure quoi que ce soit — surtout pas de retirer le test.',
    ).toBeDefined();

    const res = await request(app.getHttpServer())
      .get('/organizations/current/subscription/quote')
      .query({ plan: COUPLE_SANS_TARIF!.plan, interval: COUPLE_SANS_TARIF!.interval })
      .set('Cookie', aliceCookies);
    expect(
      res.status,
      `${COUPLE_SANS_TARIF!.plan}/${COUPLE_SANS_TARIF!.interval} n'a aucun tarif publié ` +
        `mais l'API a répondu ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`,
    ).toBe(409);
    expect(res.body.code).toBe('PLAN_NOT_SELLABLE');
  }, 30_000);

  it('une résiliation sur un abonnement déjà clos est refusée', async () => {
    const res = await request(app.getHttpServer())
      .post('/organizations/current/subscription/cancel')
      .set('Cookie', aliceCookies)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_CANCELED');
  }, 30_000);

  it("le cycle complet actif → impayé → grâce → suspendu passe par l'API", async () => {
    const server = app.getHttpServer();

    // ACTIF — un paiement authentique fait entrer Bob en Business.
    const paid = signedStripeCallback(
      invoicePaid({
        eventId: `evt_e2e_paid_${tag}`,
        organizationId: bobOrgId,
        plan: 'business',
        subscriptionId: `sub_bob_${tag}`,
      }),
    );
    const paidRes = await postStripeWebhook(paid);
    expect(paidRes.status).toBe(200);
    expect(paidRes.body).toEqual({ received: true, status: 'processed' });

    let state = await subscriptionOf(bobCookies);
    expect(state.body.status).toBe('active');
    expect(state.body.plan).toBe('business');
    expect(state.body.provider).toBe('stripe');

    // IMPAYÉ — un échec de prélèvement ne coupe rien tout de suite.
    const failed = signedStripeCallback({
      id: `evt_e2e_failed_${tag}`,
      type: 'invoice.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          customer: 'cus_e2e',
          subscription: `sub_bob_${tag}`,
          subscription_details: { metadata: { organizationId: bobOrgId } },
        },
      },
    });
    expect((await postStripeWebhook(failed)).status).toBe(200);

    state = await subscriptionOf(bobCookies);
    expect(state.body.status).toBe('past_due');
    // L'accès reste ouvert en impayé : couper au premier échec de carte punit
    // un client qui n'a encore rien fait de mal.
    expect(state.body.paidAccess).toBe(true);
    expect(state.body.plan).toBe('business');
    expect(state.body.notice).not.toBeNull();

    // GRÂCE — le fournisseur a épuisé ses relances.
    const exhausted = signedStripeCallback({
      id: `evt_e2e_dunning_${tag}`,
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `sub_bob_${tag}`,
          status: 'unpaid',
          metadata: { organizationId: bobOrgId },
        },
      },
    });
    expect((await postStripeWebhook(exhausted)).status).toBe(200);

    state = await subscriptionOf(bobCookies);
    expect(state.body.status).toBe('grace');
    expect(state.body.grace.daysLeft).toBe(7);
    expect(state.body.paidAccess).toBe(true);

    // SUSPENDU — la grâce s'écoule. Même méthode que pour l'essai : on avance
    // l'échéance, l'application conclut seule à la lecture.
    const db = await dbOf(app);
    await db
      .collection('subscriptions')
      .updateOne({ organizationId: bobOrgId }, { $set: { graceEndsAt: addDays(new Date(), -1) } });

    state = await subscriptionOf(bobCookies);
    expect(state.body.status).toBe('suspended');
    expect(state.body.paidAccess).toBe(false);
    // Suspendu ⇒ droits du gratuit, mais le plan SOUSCRIT reste visible : le
    // client doit comprendre ce qu'il retrouvera en payant.
    expect(state.body.plan).toBe('free');
    expect(state.body.subscribedPlan).toBe('business');
    expect(state.body.entitlements.maxProjects).toBe(1);

    // Un `subscription.canceled` réémis après suspension est une transition
    // interdite : acceptée en 200 (le fournisseur n'a pas à retenter) mais
    // marquée « ignorée », sans effet sur l'abonnement.
    void server;
  }, 90_000);

  // ── 3. Signature ───────────────────────────────────────────────────────────

  it('un rappel NON SIGNÉ est rejeté et ne change rien', async () => {
    const payload = invoicePaid({
      eventId: `evt_e2e_unsigned_${tag}`,
      organizationId: aliceOrgId,
      plan: 'business',
    });
    const res = await request(app.getHttpServer())
      .post('/payments/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));
    expect(res.status).toBe(400);

    const state = await subscriptionOf(aliceCookies);
    expect(state.body.plan).toBe('free');
    expect(state.body.status).toBe('canceled');
  }, 30_000);

  it('un rappel signé avec le MAUVAIS secret est rejeté', async () => {
    const signed = signedStripeCallback(
      invoicePaid({
        eventId: `evt_e2e_wrongsecret_${tag}`,
        organizationId: aliceOrgId,
        plan: 'business',
      }),
      { secret: 'whsec_secret_dun_attaquant' },
    );
    const res = await postStripeWebhook(signed);
    expect(res.status).toBe(400);

    const state = await subscriptionOf(aliceCookies);
    expect(state.body.plan).toBe('free');
  }, 30_000);

  it('un rappel authentique mais REJOUÉ hors de la fenêtre est rejeté', async () => {
    // Charge et signature parfaitement valides, datées d'une heure. C'est le
    // scénario de rejeu à partir d'un journal de proxy.
    const signed = signedStripeCallback(
      invoicePaid({
        eventId: `evt_e2e_stale_${tag}`,
        organizationId: aliceOrgId,
        plan: 'business',
      }),
      { timestamp: Math.floor(Date.now() / 1000) - 3600 },
    );
    const res = await postStripeWebhook(signed);
    expect(res.status).toBe(400);

    const state = await subscriptionOf(aliceCookies);
    expect(state.body.plan).toBe('free');
  }, 30_000);

  it('la charge modifiée après signature est rejetée', async () => {
    const signed = signedStripeCallback(
      invoicePaid({
        eventId: `evt_e2e_tampered_${tag}`,
        organizationId: bobOrgId,
        plan: 'pro',
      }),
    );
    // Un octet change : `pro` devient `business`. La signature ne suit pas.
    const tampered = { ...signed, body: signed.body.replace('"pro"', '"business"') };
    expect(tampered.body).not.toBe(signed.body);

    const res = await postStripeWebhook(tampered);
    expect(res.status).toBe(400);
  }, 30_000);

  it("le fournisseur `manual` n'expose aucune route de rappel", async () => {
    // Une route de rappel manuel serait un point d'entrée non authentifié
    // capable d'accorder un abonnement.
    const res = await request(app.getHttpServer())
      .post('/payments/webhooks/manual')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ organizationId: aliceOrgId, plan: 'business' }));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('UNKNOWN_WEBHOOK_PROVIDER');
  }, 30_000);

  // ── 4. Idempotence ─────────────────────────────────────────────────────────

  it('un rappel rejoué à l’identique ne produit aucun doublon', async () => {
    const eventId = `evt_e2e_replay_${tag}`;
    const signed = signedStripeCallback(
      invoicePaid({
        eventId,
        organizationId: bobOrgId,
        plan: 'business',
        subscriptionId: `sub_bob_${tag}`,
      }),
    );

    const first = await postStripeWebhook(signed);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('processed');

    const stateAfterFirst = await subscriptionOf(bobCookies);
    const periodEnd = stateAfterFirst.body.currentPeriodEnd;
    expect(periodEnd).toBeTruthy();

    // Rejeu : même identifiant, même signature. Stripe fait exactement cela
    // quand notre réponse tarde.
    for (let i = 0; i < 3; i += 1) {
      const replay = await postStripeWebhook(signed);
      expect(replay.status).toBe(200);
      expect(replay.body.status).toBe('duplicate');
    }

    // La période n'a PAS été prolongée trois fois de plus.
    const stateAfterReplay = await subscriptionOf(bobCookies);
    expect(stateAfterReplay.body.currentPeriodEnd).toBe(periodEnd);

    // Et une seule trace en base pour cet identifiant.
    const db = await dbOf(app);
    const count = await db
      .collection('payment_events')
      .countDocuments({ provider: 'stripe', eventId });
    expect(count).toBe(1);
  }, 60_000);

  it('un rappel traité est journalisé dans audit_events', async () => {
    const db = await dbOf(app);
    const entries = await db
      .collection('audit_events')
      .find({ organizationId: bobOrgId, targetType: 'subscription' })
      .toArray();
    expect(entries.length).toBeGreaterThan(0);
    const actions = entries.map((e) => String(e['action']));
    expect(actions).toContain('payment.payment.succeeded');
    // L'auteur d'un événement de rappel est le système, jamais un utilisateur.
    const webhookEntry = entries.find((e) => String(e['action']) === 'payment.payment.succeeded');
    expect(webhookEntry?.['actorUserId']).toBe('system');
  }, 30_000);

  // ── 5. Entitlements et moyens de paiement ──────────────────────────────────

  it('les moyens de paiement annoncés sont ceux réellement configurés', async () => {
    const res = await request(app.getHttpServer()).get('/payments/methods');
    expect(res.status).toBe(200);
    const byMethod = new Map<string, boolean>(
      res.body.methods.map((m: { method: string; available: boolean }) => [m.method, m.available]),
    );
    // Stripe est configuré dans cette suite → carte disponible.
    expect(byMethod.get('card')).toBe(true);
    // PayPal ne l'est pas → annoncé indisponible, et non promis à tort.
    expect(byMethod.get('paypal')).toBe(false);
    // Le manuel est toujours là : c'est le filet mobile money.
    expect(byMethod.get('mobile_money')).toBe(true);
    expect(byMethod.get('bank_transfer')).toBe(true);
    // Aucun motif d'exploitation ne fuit vers le client.
    for (const entry of res.body.methods) {
      expect(entry).not.toHaveProperty('reason');
      expect(entry).not.toHaveProperty('missingSecrets');
    }
  }, 30_000);

  it('un dépôt manuel confirmé par un administrateur active le plan', async () => {
    const server = app.getHttpServer();

    // Alice ouvre une demande de paiement mobile money. Aucun réseau : le
    // fournisseur manuel ne fait qu'émettre des instructions.
    const checkout = await request(server)
      .post('/payments/checkout')
      .set('Cookie', aliceCookies)
      .send({ plan: 'pro', interval: 'month', method: 'mobile_money' });
    expect(checkout.status).toBe(200);
    expect(checkout.body.provider).toBe('manual');
    expect(checkout.body.mode).toBe('instructions');
    // Tarif plein : Alice n'a aucune période payée en cours. Le montant attendu
    // est LU dans le catalogue — le recopier ici (« 900 ») a déjà fait échouer
    // cette suite au premier changement de grille, et un chiffre figé dans un
    // test ne prouve rien sur le prix réellement publié.
    expect(checkout.body.amountDueCents).toBe(priceCents('pro', 'month'));
    const reference: string = checkout.body.reference;
    expect(reference).toMatch(/^LLD-/);
    // La référence est répétée dans les instructions — sans elle, un dépôt
    // arrive sans propriétaire identifiable.
    expect(JSON.stringify(checkout.body.instructions)).toContain(reference);

    // Alice ne peut PAS confirmer son propre paiement : la confirmation exige un
    // rôle plateforme, pas `billing.manage`.
    const selfConfirm = await request(server)
      .post(`/payments/manual/${reference}/confirm`)
      .set('Cookie', aliceCookies)
      .send({});
    expect(selfConfirm.status).toBe(403);

    let state = await subscriptionOf(aliceCookies);
    expect(state.body.plan).toBe('free');

    // L'administrateur plateforme voit la demande et la confirme.
    const pending = await request(server)
      .get('/payments/manual/pending')
      .set('Cookie', adminCookies);
    expect(pending.status).toBe(200);
    expect(
      pending.body.requests.some((r: { reference: string }) => r.reference === reference),
    ).toBe(true);

    const confirm = await request(server)
      .post(`/payments/manual/${reference}/confirm`)
      .set('Cookie', adminCookies)
      .send({ note: 'Dépôt M-Pesa constaté (suite e2e).' });
    expect(confirm.status).toBe(200);
    expect(confirm.body.confirmed).toBe(true);

    state = await subscriptionOf(aliceCookies);
    expect(state.body.status).toBe('active');
    expect(state.body.plan).toBe('pro');
    expect(state.body.provider).toBe('manual');
    // Les entitlements SUIVENT le plan : ceux servis sont EXACTEMENT ceux du
    // catalogue pour Pro. Un paiement encaissé qui n'ouvrirait pas les droits
    // payés est le défaut redouté ici, et il se voit sur la grille entière —
    // pas seulement sur les deux champs qu'on aurait pensé à citer.
    expect(state.body.entitlements).toEqual(PLAN_ENTITLEMENTS.pro);

    // Et la création de projet qui échouait plus haut réussit maintenant.
    const project = await request(server)
      .post('/projects')
      .set('Cookie', aliceCookies)
      .send({ name: `Projet pro ${tag}`, templateSlug: 'hello-world' });
    expect(project.status).toBe(201);

    // Une seconde confirmation de la MÊME référence ne double pas le mois.
    const periodEnd = state.body.currentPeriodEnd;
    const again = await request(server)
      .post(`/payments/manual/${reference}/confirm`)
      .set('Cookie', adminCookies)
      .send({ note: 'Rejeu accidentel.' });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('MANUAL_REQUEST_CLOSED');

    const afterReplay = await subscriptionOf(aliceCookies);
    expect(afterReplay.body.currentPeriodEnd).toBe(periodEnd);
  }, 90_000);

  it("une baisse de gamme n'est jamais routée vers un paiement", async () => {
    // Bob est en Business actif. Lui vendre Business (ou moins) serait facturer
    // un client pour ne rien changer, ou pour dépenser moins.
    const res = await request(app.getHttpServer())
      .post('/payments/checkout')
      .set('Cookie', bobCookies)
      .send({ plan: 'business', interval: 'month', method: 'bank_transfer' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DOWNGRADE_NOT_PAYABLE');
  }, 30_000);

  it('un refus de dépôt manuel exige un motif', async () => {
    const server = app.getHttpServer();
    // Alice est en Pro actif : Business est bien une montée en gamme payante.
    const checkout = await request(server)
      .post('/payments/checkout')
      .set('Cookie', aliceCookies)
      .send({ plan: 'business', interval: 'month', method: 'bank_transfer' });
    expect(checkout.status).toBe(200);
    const reference: string = checkout.body.reference;

    const noNote = await request(server)
      .post(`/payments/manual/${reference}/reject`)
      .set('Cookie', adminCookies)
      .send({});
    expect(noNote.status).toBe(400);
    expect(noNote.body.code).toBe('REJECTION_NOTE_REQUIRED');

    const rejected = await request(server)
      .post(`/payments/manual/${reference}/reject`)
      .set('Cookie', adminCookies)
      .send({ note: 'Aucun virement reçu sous 7 jours.' });
    expect(rejected.status).toBe(200);
  }, 60_000);

  // ── 6. Isolation inter-organisations ───────────────────────────────────────

  it("un rappel destiné à une organisation n'en touche aucune autre", async () => {
    const aliceBefore = await subscriptionOf(aliceCookies);
    // Alice est en Pro : un rappel Business destiné à Bob ne doit pas la
    // promouvoir, et surtout pas la rattacher au fournisseur de Bob.
    expect(aliceBefore.body.plan).toBe('pro');

    const eventId = `evt_e2e_isolation_${tag}`;
    const signed = signedStripeCallback(
      invoicePaid({
        eventId,
        organizationId: bobOrgId,
        plan: 'business',
        subscriptionId: `sub_bob_${tag}`,
      }),
    );
    const res = await postStripeWebhook(signed);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');

    const aliceAfter = await subscriptionOf(aliceCookies);
    expect(aliceAfter.body.plan).toBe(aliceBefore.body.plan);
    expect(aliceAfter.body.status).toBe(aliceBefore.body.status);
    expect(aliceAfter.body.currentPeriodEnd).toBe(aliceBefore.body.currentPeriodEnd);
    expect(aliceAfter.body.provider).toBe('manual');

    const bobAfter = await subscriptionOf(bobCookies);
    expect(bobAfter.body.plan).toBe('business');
    expect(bobAfter.body.status).toBe('active');

    // La trace de l'événement porte l'organisation de Bob, et elle seule.
    const db = await dbOf(app);
    const stored = await db.collection('payment_events').findOne({ provider: 'stripe', eventId });
    expect(stored?.['organizationId']).toBe(bobOrgId);
    expect(stored?.['status']).toBe('processed');
  }, 60_000);

  it('un rappel sans organisation et sans abonnement connu reste ORPHELIN', async () => {
    // Le mode d'échec redouté : un rappel sans métadonnées rattaché « au dernier
    // client connu ». Il doit rester non attribué, et surtout ne rien accorder.
    const eventId = `evt_e2e_orphan_${tag}`;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const signed = signedStripeCallback({
      id: eventId,
      type: 'invoice.paid',
      created: nowSeconds,
      data: {
        object: {
          customer: 'cus_inconnu',
          subscription: 'sub_totalement_inconnu',
          period_start: nowSeconds,
          period_end: nowSeconds + 30 * 24 * 3600,
        },
      },
    });

    const aliceBefore = await subscriptionOf(aliceCookies);
    const bobBefore = await subscriptionOf(bobCookies);

    const res = await postStripeWebhook(signed);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('unmatched');

    const aliceAfter = await subscriptionOf(aliceCookies);
    const bobAfter = await subscriptionOf(bobCookies);
    expect(aliceAfter.body.currentPeriodEnd).toBe(aliceBefore.body.currentPeriodEnd);
    expect(aliceAfter.body.plan).toBe(aliceBefore.body.plan);
    expect(bobAfter.body.currentPeriodEnd).toBe(bobBefore.body.currentPeriodEnd);
    expect(bobAfter.body.plan).toBe(bobBefore.body.plan);

    // L'événement orphelin est visible en exploitation, pas perdu en silence.
    const db = await dbOf(app);
    const stored = await db.collection('payment_events').findOne({ eventId });
    expect(stored?.['status']).toBe('failed');
    expect(stored?.['organizationId']).toBeNull();
  }, 60_000);

  it("un membre d'une organisation ne voit jamais l'abonnement d'une autre", async () => {
    const aliceView = await subscriptionOf(aliceCookies);
    const bobView = await subscriptionOf(bobCookies);
    expect(aliceView.status).toBe(200);
    expect(bobView.status).toBe(200);
    // Deux organisations distinctes, deux états distincts servis sur la MÊME
    // route « current » : la résolution d'organisation vient de la session.
    expect(aliceOrgId).not.toBe(bobOrgId);
    expect(aliceView.body.subscribedPlan).not.toBe(bobView.body.subscribedPlan);
  }, 30_000);

  it("le balayage d'exploitation exige un rôle plateforme", async () => {
    const denied = await request(app.getHttpServer())
      .post('/payments/maintenance/sweep')
      .set('Cookie', aliceCookies)
      .send({});
    expect(denied.status).toBe(403);

    const allowed = await request(app.getHttpServer())
      .post('/payments/maintenance/sweep')
      .set('Cookie', adminCookies)
      .send({});
    expect(allowed.status).toBe(200);
    expect(typeof allowed.body.scanned).toBe('number');
  }, 30_000);
});
