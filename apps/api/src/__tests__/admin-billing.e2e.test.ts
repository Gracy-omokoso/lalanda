// ADR-0053 — P3 : ABONNEMENTS ET PAIEMENTS MANUELS DE LA CONSOLE (`/admin/billing/**`).
//
// Critère 10 : confirmer un dépôt manuel écrit au journal PLATEFORME les rôles RÉELS de
//              l'acteur (jamais `platform_billing` codé en dur) ; le refus est journalisé.
// Critère 11 : côté client, seul le miroir « Équipe Lalanda » paraît — aucun identifiant,
//              suffixe d'identifiant ni rôle d'opérateur dans `GET /audit-events`.
// Critère 13 : opérateur membre de l'organisation, autre détenteur existant → 409
//              PLATFORM_SELF_DEALING (confirmation, octroi) ; seul détenteur → permis, marqué.
// Critère 14 : sans ré-authentification, toute écriture motivée → 401 REAUTH_REQUIRED.
// Critère 15 (volet P3) : `platform_admin` → 403 sur la confirmation ; `platform_billing`
//              ouvre la console ; le Support ne lit pas les abonnements.
// Critère 17 : octroi sans motif → 400 ; Expert par une personne, autre détenteur → en
//              attente ; l'auteur n'approuve pas ; la seconde personne l'active ; l'abonnement
//              porte `plan.granted`, jamais un `payment.succeeded` ; retrait → offre souscrite.
// Plus : anciennes routes `/payments/manual/*` → 410 ; aucun encaissement ni pièce émise.

import { ThrottlerStorage } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import { type Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { PLAN_ENTITLEMENTS } from '@lalanda/shared/pricing';
import { PLATFORM_MIRROR_ACTOR_ID } from '@lalanda/shared/platform';

import type { PlatformRole } from '../authz/permissions.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

e2eSuite('ADR-0053 — P3 : abonnements, paiements manuels et octrois de la console', () => {
  let app: INestApplication;
  let db: Db;
  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  let orgC = '';

  const serveur = () => app.getHttpServer();
  const compte = (cle: string) => {
    const email = `p3-${cle.toLowerCase()}-${tag}@lalanda-test.local`;
    if (!emails.includes(email)) emails.push(email);
    return { email, password: `Passw0rd!${cle}`, name: `P3 ${cle}` };
  };
  const viderLimiteur = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const t of store.timeoutIds.values()) t.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };
  const idDeSession = async (c: string[]): Promise<string> => {
    const s = await request(serveur()).get('/auth/get-session').set('Cookie', c);
    return String(s.body?.user?.id ?? '');
  };
  const poserRole = (userId: string, role: PlatformRole) =>
    db.collection('platform_roles').insertOne({
      userId,
      role,
      grantedBy: null,
      reason: `suite e2e P3 ${tag}`,
      expiresAt: null,
      revokedAt: null,
      _schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  const reauth = async (cle: string) => {
    viderLimiteur();
    const res = await request(serveur())
      .post('/admin/reauth')
      .set('Cookie', cookies[cle]!)
      .send({ password: compte(cle).password });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  };
  const journalOrg = async () =>
    request(serveur())
      .get('/audit-events?limit=500')
      .set('Cookie', [...cookies['client']!, `active_org_id=${orgC}`]);
  const journalPlateforme = async (action: string) =>
    request(serveur())
      .get(`/admin/audit-events?action=${encodeURIComponent(action)}`)
      .set('Cookie', cookies['sa']!);
  const abonnementClient = async () =>
    request(serveur())
      .get('/organizations/current/subscription')
      .set('Cookie', [...cookies['client']!, `active_org_id=${orgC}`]);
  /** Le client ouvre une demande de paiement manuel (aucun réseau, aucun encaissement). */
  const demande = async (plan: string): Promise<string> => {
    viderLimiteur();
    const res = await request(serveur())
      .post('/payments/checkout')
      .set('Cookie', [...cookies['client']!, `active_org_id=${orgC}`])
      .send({ plan, interval: 'month', method: 'mobile_money' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return String(res.body.reference);
  };
  const poster = (cle: string, chemin: string, corps: object = {}) =>
    request(serveur()).post(chemin).set('Cookie', cookies[cle]!).send(corps);

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    // Base propre à ce fichier : les détenteurs d'actions sont exactement les nôtres.
    await db.collection('platform_roles').deleteMany({});
    await db.collection('platform_plan_grants').deleteMany({});

    // Client : Propriétaire de C (son organisation personnelle).
    cookies['client'] = await registerAndLogin(app, compte('client'));
    ids['client'] = await idDeSession(cookies['client']);
    const orgs = await request(serveur()).get('/organizations').set('Cookie', cookies['client']);
    orgC = (orgs.body.organizations as { id: string }[])[0]!.id;

    // Opérateurs sans organisation, et un opérateur finance MEMBRE de C.
    for (const [cle, role] of [
      ['sa', 'platform_super_admin'],
      ['fac', 'platform_billing'],
      ['fac2', 'platform_billing'],
      ['pa', 'platform_admin'],
      ['sup', 'platform_support'],
      ['membre', 'platform_billing'],
    ] as const) {
      cookies[cle] = await registerAndLogin(app, compte(cle));
      ids[cle] = await idDeSession(cookies[cle]);
      if (cle !== 'membre') await db.collection('memberships').deleteMany({ userId: ids[cle] });
      await poserRole(ids[cle]!, role);
    }
    await db.collection('memberships').insertOne({
      userId: ids['membre'],
      organizationId: orgC,
      role: 'viewer',
      canClosePeriods: false,
      grants: [],
      revokes: [],
      permissionsRevision: 0,
      acceptedAt: new Date(),
      _schemaVersion: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (db) {
      await db.collection('platform_roles').deleteMany({ reason: `suite e2e P3 ${tag}` });
      await db.collection('platform_plan_grants').deleteMany({});
      await db.collection('manual_payment_requests').deleteMany({});
      await db.collection('payment_events').deleteMany({});
      await db.collection('platform_console_activity').deleteMany({});
    }
    await teardown(app, emails);
  }, E2E_HOOK_TIMEOUT_MS);

  // ── Accès (critère 15, volet P3) ────────────────────────────────────────────

  it('la finance ouvre la console et lit la file ; le Support ne lit pas les abonnements', async () => {
    viderLimiteur();
    const tableau = await request(serveur()).get('/admin/overview').set('Cookie', cookies['fac']!);
    expect(tableau.status).toBe(200);
    for (const chemin of [
      '/admin/billing/subscriptions',
      '/admin/billing/manual-payments',
      '/admin/billing/grants',
    ]) {
      expect((await request(serveur()).get(chemin).set('Cookie', cookies['fac']!)).status).toBe(
        200,
      );
      const sup = await request(serveur()).get(chemin).set('Cookie', cookies['sup']!);
      expect(sup.status, chemin).toBe(403);
      expect(sup.body).toMatchObject({ code: 'FORBIDDEN', action: 'platform.billing.read' });
    }
    // Le Propriétaire de C n'y a pas accès non plus.
    const client = await request(serveur())
      .get('/admin/billing/manual-payments')
      .set('Cookie', cookies['client']!);
    expect(client.status).toBe(403);
  });

  // ── Ré-authentification (critère 14) ────────────────────────────────────────

  it('critère 14 — sans ré-authentification, chaque écriture motivée → 401 REAUTH_REQUIRED', async () => {
    viderLimiteur();
    const factice = '0123456789abcdef01234567';
    for (const [verbe, chemin] of [
      ['post', '/admin/billing/manual-payments/LLD-X/confirm'],
      ['post', '/admin/billing/manual-payments/LLD-X/reject'],
      ['post', '/admin/billing/grants'],
      ['post', `/admin/billing/grants/${factice}/approve`],
      ['delete', `/admin/billing/grants/${factice}`],
    ] as const) {
      const res = await request(serveur())[verbe](chemin).set('Cookie', cookies['sa']!).send({});
      expect(res.status, `${verbe} ${chemin}`).toBe(401);
      expect(res.body.code).toBe('REAUTH_REQUIRED');
    }
  });

  it('tout opérateur concerné se ré-authentifie', async () => {
    for (const cle of ['sa', 'fac', 'fac2', 'pa', 'membre']) await reauth(cle);
  });

  // ── Paiements manuels (critères 10, 11, 13, 15) ─────────────────────────────

  it('critère 15 — `platform_admin` ne confirme plus un dépôt manuel (403)', async () => {
    const ref = await demande('pro');
    const res = await poster('pa', `/admin/billing/manual-payments/${ref}/confirm`, {
      note: 'Dépôt constaté sur le relevé.',
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN', action: 'platform.billing.confirm' });
  });

  it('critère 13 — l’opérateur membre de C ne confirme pas son paiement (409)', async () => {
    const file = await request(serveur())
      .get('/admin/billing/manual-payments?status=pending')
      .set('Cookie', cookies['fac']!);
    const ref = (file.body.requests as { reference: string }[])[0]!.reference;
    const res = await poster('membre', `/admin/billing/manual-payments/${ref}/confirm`, {
      note: 'Dépôt constaté sur le relevé.',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLATFORM_SELF_DEALING');
  });

  it('critère 10 — confirmation sans note → 400 ; avec, rôles RÉELS au journal plateforme', async () => {
    viderLimiteur();
    const file = await request(serveur())
      .get('/admin/billing/manual-payments?status=pending')
      .set('Cookie', cookies['sa']!);
    expect(file.status).toBe(200);
    const ligne = (
      file.body.requests as { reference: string; organizationId: string; amountDueCents: number }[]
    )[0]!;
    expect(ligne.organizationId).toBe(orgC);

    const sans = await poster('sa', `/admin/billing/manual-payments/${ligne.reference}/confirm`);
    expect(sans.status).toBe(400);
    expect(sans.body.code).toBe('REASON_REQUIRED');

    const ok = await poster('sa', `/admin/billing/manual-payments/${ligne.reference}/confirm`, {
      note: 'Dépôt M-Pesa TX-0001 constaté.',
      clientMessage: 'Votre paiement a bien été reçu.',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ confirmed: true, organizationId: orgC, plan: 'pro' });

    const etat = await abonnementClient();
    expect(etat.body.plan).toBe('pro');
    expect(etat.body.entitlements).toEqual(PLAN_ENTITLEMENTS.pro);

    const evts = await journalPlateforme('billing.manual_payment.confirmed');
    const evt = (
      evts.body.events as {
        actorUserId: string;
        actorRole: string;
        metadata: Record<string, unknown>;
      }[]
    ).find((e) => e.metadata['reference'] === ligne.reference);
    expect(evt?.actorUserId).toBe(ids['sa']);
    expect(evt?.actorRole).toBe('platform_super_admin');
    expect(evt?.metadata['internalNote']).toBe('Dépôt M-Pesa TX-0001 constaté.');
  });

  it('critère 10 — le refus est journalisé des deux côtés', async () => {
    const ref = await demande('business');
    const sans = await poster('fac', `/admin/billing/manual-payments/${ref}/reject`, {});
    expect(sans.status).toBe(400);
    expect(sans.body.code).toBe('REASON_REQUIRED');
    const ok = await poster('fac', `/admin/billing/manual-payments/${ref}/reject`, {
      reason: 'Aucun virement reçu sous sept jours.',
      clientMessage: 'Nous n’avons pas reçu votre virement.',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const evts = await journalPlateforme('billing.manual_payment.rejected');
    const evt = (
      evts.body.events as {
        actorUserId: string;
        actorRole: string;
        metadata: Record<string, unknown>;
      }[]
    ).find((e) => e.metadata['reference'] === ref);
    expect(evt?.actorUserId).toBe(ids['fac']);
    expect(evt?.actorRole).toBe('platform_billing');
    const client = await journalOrg();
    const miroir = (
      client.body.events as {
        action: string;
        actorUserId: string;
        metadata: Record<string, unknown>;
      }[]
    ).find(
      (e) =>
        e.action === 'platform.billing.manual_payment_rejected' && e.metadata['reference'] === ref,
    );
    expect(miroir?.actorUserId).toBe(PLATFORM_MIRROR_ACTOR_ID);
    expect(miroir?.metadata['clientMessage']).toBe('Nous n’avons pas reçu votre virement.');
  });

  it('les anciennes routes `/payments/manual/*` répondent 410 et ne décident plus rien', async () => {
    const ref = await demande('business');
    const res = await request(serveur())
      .post(`/payments/manual/${ref}/confirm`)
      .set('Cookie', cookies['sa']!)
      .send({ note: 'Tentative par l’ancienne route.' });
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      code: 'ROUTE_GONE',
      replacement: '/admin/billing/manual-payments/:reference/confirm',
    });
    const file = await request(serveur())
      .get('/admin/billing/manual-payments?status=pending')
      .set('Cookie', cookies['fac']!);
    expect((file.body.requests as { reference: string }[]).map((r) => r.reference)).toContain(ref);
  });

  it('critère 13 — seul détenteur, l’opérateur membre confirme : permis et marqué', async () => {
    const ref = await demande('business');
    const autres = [ids['sa'], ids['fac'], ids['fac2']];
    await db
      .collection('platform_roles')
      .updateMany({ userId: { $in: autres } }, { $set: { revokedAt: new Date() } });
    try {
      const res = await poster('membre', `/admin/billing/manual-payments/${ref}/confirm`, {
        note: 'Dépôt constaté, seule opératrice.',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    } finally {
      await db
        .collection('platform_roles')
        .updateMany({ userId: { $in: autres } }, { $set: { revokedAt: null } });
    }
    const evts = await journalPlateforme('billing.manual_payment.confirmed');
    const evt = (evts.body.events as { metadata: Record<string, unknown> }[]).find(
      (e) => e.metadata['reference'] === ref,
    );
    expect(evt?.metadata['soleOperator']).toBe(true);
    const client = await journalOrg();
    const miroir = (
      client.body.events as { action: string; metadata: Record<string, unknown> }[]
    ).find(
      (e) =>
        e.action === 'platform.billing.manual_payment_confirmed' && e.metadata['reference'] === ref,
    );
    expect(miroir?.metadata['soleOperator']).toBe(true);
  });

  // ── Octrois (critère 17) ────────────────────────────────────────────────────

  it('critère 17 — octroi sans motif → 400 ; `free` n’est pas un octroi', async () => {
    viderLimiteur();
    const sans = await poster('fac', '/admin/billing/grants', {
      targetOrganizationId: orgC,
      plan: 'expert',
    });
    expect(sans.status).toBe(400);
    expect(sans.body.code).toBe('REASON_REQUIRED');
    const gratuit = await poster('fac', '/admin/billing/grants', {
      targetOrganizationId: orgC,
      plan: 'free',
      reasonCategory: 'request',
      clientMessage: 'Retour au gratuit.',
      internalNote: 'Demande du client.',
    });
    expect(gratuit.status).toBe(400);
    expect(gratuit.body.code).toBe('GRANT_PLAN_INVALID');
    const membre = await poster('membre', '/admin/billing/grants', {
      targetOrganizationId: orgC,
      plan: 'business',
      reasonCategory: 'request',
      clientMessage: 'Offre accordée.',
      internalNote: 'Geste commercial validé.',
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(membre.status).toBe(409);
    expect(membre.body.code).toBe('PLATFORM_SELF_DEALING');
  });

  let octroiExpert = '';

  it('critère 17 — Expert par une personne : en attente ; l’auteur n’approuve pas ; la seconde l’active', async () => {
    viderLimiteur();
    const cree = await poster('fac', '/admin/billing/grants', {
      targetOrganizationId: orgC,
      plan: 'expert',
      reasonCategory: 'request',
      clientMessage: 'Offre Expert accordée par l’équipe.',
      internalNote: 'Accord commercial du 2 novembre.',
    });
    expect(cree.status, JSON.stringify(cree.body)).toBe(201);
    expect(cree.body).toMatchObject({ plan: 'expert', status: 'pending_approval' });
    octroiExpert = String(cree.body.id);
    // En attente : rien n'a touché le client.
    expect((await abonnementClient()).body.plan).toBe('business');

    // Un second octroi ne s'empile pas sur une demande en attente.
    const double = await poster('fac2', '/admin/billing/grants', {
      targetOrganizationId: orgC,
      plan: 'pro',
      reasonCategory: 'request',
      clientMessage: 'Offre accordée.',
      internalNote: 'Doublon involontaire.',
      endsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    });
    expect(double.status).toBe(409);
    expect(double.body.code).toBe('GRANT_ALREADY_OPEN');

    const soiMeme = await poster('fac', `/admin/billing/grants/${octroiExpert}/approve`);
    expect(soiMeme.status).toBe(409);
    expect(soiMeme.body.code).toBe('SELF_APPROVAL_FORBIDDEN');

    const approuve = await poster('fac2', `/admin/billing/grants/${octroiExpert}/approve`, {
      internalNote: 'Accord vérifié.',
    });
    expect(approuve.status, JSON.stringify(approuve.body)).toBe(200);
    expect(approuve.body).toMatchObject({ status: 'active', phase: 'active', soleApprover: false });

    const etat = await abonnementClient();
    // Le plan SOUSCRIT ne change pas ; le plan applicable est l'offre accordée.
    expect(etat.body.entitlements).toEqual(PLAN_ENTITLEMENTS.expert);
    expect(etat.body.notice?.message).toContain('Expert');
    expect(etat.body.notice?.message).toContain('Lalanda');

    const doc = await db.collection('subscriptions').findOne({ organizationId: orgC });
    const historique = (doc?.['statusHistory'] ?? []) as { event: string; source: string }[];
    expect(historique.some((h) => h.event === 'plan.granted')).toBe(true);
    // Un octroi ne simule aucun paiement : les seuls `payment.succeeded` sont les deux
    // dépôts réellement confirmés plus haut.
    expect(historique.filter((h) => h.event === 'payment.succeeded')).toHaveLength(2);
    const paiements = await db
      .collection('payment_events')
      .countDocuments({ mappedEvent: 'payment.succeeded' });
    expect(paiements).toBe(2);
  });

  it('critère 17 — un octroi court (≤ 90 jours, hors Expert) est actif tout de suite', async () => {
    // Un retrait d'abord (motif et message client obligatoires).
    const sans = await request(serveur())
      .delete(`/admin/billing/grants/${octroiExpert}`)
      .set('Cookie', cookies['sa']!)
      .send({});
    expect(sans.status).toBe(400);
    const retire = await request(serveur())
      .delete(`/admin/billing/grants/${octroiExpert}`)
      .set('Cookie', cookies['sa']!)
      .send({
        internalNote: 'Fin de l’accord commercial.',
        clientMessage: 'Fin de l’offre Expert.',
      });
    expect(retire.status, JSON.stringify(retire.body)).toBe(200);
    expect(retire.body.status).toBe('revoked');
    expect((await abonnementClient()).body.entitlements).toEqual(PLAN_ENTITLEMENTS.business);

    const court = await poster('fac2', '/admin/billing/grants', {
      targetOrganizationId: orgC,
      plan: 'pro',
      reasonCategory: 'other',
      clientMessage: 'Essai prolongé de trente jours.',
      internalNote: 'Geste commercial après incident.',
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(court.status, JSON.stringify(court.body)).toBe(201);
    expect(court.body).toMatchObject({ status: 'active', soleApprover: false });
    // Expiré (horloge avancée en base) : l'offre souscrite reprend, sans écriture.
    await db
      .collection('subscriptions')
      .updateOne({ organizationId: orgC }, { $set: { grantEndsAt: new Date(Date.now() - 1000) } });
    expect((await abonnementClient()).body.entitlements).toEqual(PLAN_ENTITLEMENTS.business);
  });

  // ── Miroir (critère 11) ─────────────────────────────────────────────────────

  it('critère 11 — le client ne voit jamais un opérateur : ni identifiant, ni suffixe, ni rôle', async () => {
    viderLimiteur();
    const res = await journalOrg();
    expect(res.status).toBe(200);
    const evts = res.body.events as {
      action: string;
      actorUserId: string;
      actorRole: string;
      metadata: Record<string, unknown>;
    }[];
    for (const action of [
      'platform.billing.manual_payment_confirmed',
      'platform.billing.manual_payment_rejected',
      'platform.billing.plan_granted',
      'platform.billing.plan_grant_revoked',
    ]) {
      const e = evts.find((x) => x.action === action);
      expect(e, action).toBeDefined();
      expect(e!.actorUserId).toBe(PLATFORM_MIRROR_ACTOR_ID);
      expect(typeof e!.metadata['platformEventRef']).toBe('string');
    }
    // La transition d'abonnement née d'une confirmation porte elle aussi le pseudonyme.
    const paiement = evts.find((x) => x.action === 'subscription.payment.succeeded');
    expect(paiement?.actorUserId).toBe(PLATFORM_MIRROR_ACTOR_ID);
    expect(paiement?.metadata['source']).toBe('admin:manual');

    const texte = JSON.stringify(res.body);
    for (const cle of ['sa', 'fac', 'fac2', 'pa', 'membre']) {
      expect(texte, cle).not.toContain(ids[cle]!);
      expect(texte, `${cle} (suffixe)`).not.toContain(ids[cle]!.slice(-8));
    }
    for (const fuite of [
      'platform_billing',
      'platform_super_admin',
      'platform_admin',
      'Dépôt M-Pesa TX-0001',
      'Accord commercial du 2 novembre',
      'Aucun virement reçu sous sept jours',
    ]) {
      expect(texte, fuite).not.toContain(fuite);
    }
  });

  it('le tableau des abonnements ne sert que des métadonnées (aucun montant)', async () => {
    const res = await request(serveur())
      .get('/admin/billing/subscriptions')
      .set('Cookie', cookies['fac']!);
    expect(res.status).toBe(200);
    const ligne = (res.body.subscriptions as Record<string, unknown>[]).find(
      (s) => s['organizationId'] === orgC,
    );
    expect(Object.keys(ligne!).sort()).toEqual(
      [
        'billingInterval',
        'currentPeriodEnd',
        'effectivePlan',
        'grant',
        'graceEndsAt',
        'organizationId',
        'organizationName',
        'plan',
        'provider',
        'status',
        'trialEndsAt',
        'updatedAt',
      ].sort(),
    );
    const filtre = await request(serveur())
      .get('/admin/billing/subscriptions?status=inconnu')
      .set('Cookie', cookies['fac']!);
    expect(filtre.status).toBe(400);
  });
});
