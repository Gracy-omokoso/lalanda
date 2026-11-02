// ADR-0047 — FACTURES DES ABONNEMENTS LALANDA (décision de la dirigeante du 3 nov. 2026).
//
// Chaîne complète contre la vraie application : tunnel de souscription (HT + TVA 16 %),
// confirmation d'un dépôt manuel dans la console, pont paiement → facture émise par
// l'organisation VENDEUSE avec le circuit des ventes (sans normalisation), espace de
// l'abonné, rattrapage console des paiements sans facture, avoir à deux personnes.
//
// Critères prouvés :
//  1. Un paiement donne UNE facture et une seule — confirmation rejouée, appel du pont
//     rejoué, bouton « émettre » recliqué, rappel Stripe réémis.
//  2. Sans organisation vendeuse désignée, rien n'est inventé : le paiement prolonge
//     l'abonnement, la facture reste « en échec » et paraît dans la liste à émettre.
//  3. Facture ordinaire (non normalisée), en USD, groupe B, total = somme encaissée,
//     base HT = prix de la grille ; identité du vendeur = sa fiche fiscale.
//  4. Données de l'abonné : raison sociale et NIF de sa fiche de facturation.
//  5. L'abonné voit et télécharge SES factures ; une autre organisation obtient 404.
//  6. Avoir : motif obligatoire, deux personnes, numéro de la série des avoirs.

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import 'reflect-metadata';

import { subscriptionAmounts } from '@lalanda/engine';
import { priceCents } from '@lalanda/shared/pricing';

import type { PlatformRole } from '../authz/permissions.js';
import { hmacSha256Hex } from '../payments/webhook-signature.js';
import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { SubscriptionInvoicingService } from '../subscription-invoices/subscription-invoicing.service.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

const WEBHOOK_SECRET = 'whsec_e2e_adr0047_secret_de_test';
process.env['LALANDA_STRIPE_RESTRICTED_KEY'] = 'rk_test_e2e_adr0047';
process.env['LALANDA_STRIPE_WEBHOOK_SECRET'] = WEBHOOK_SECRET;

vi.setConfig({ testTimeout: 120_000 });

const FICHE_VENDEUR = {
  legalName: 'Go freelance SARLU',
  tradeName: null,
  legalForm: 'sarlu',
  legalFormOther: null,
  nif: 'A1234567Z',
  rccm: null,
  nationalId: null,
  vatRegistered: true,
  headOffice: {
    line1: '1, avenue Exemple',
    line2: null,
    commune: 'Gombe',
    city: 'Kinshasa',
    province: 'Kinshasa',
  },
  phone: '+243 800 000 001',
  email: 'facturation@exemple.cd',
};

e2eSuite('ADR-0047 — factures des abonnements Lalanda', () => {
  let app: INestApplication;
  let db: Db;
  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  let orgVendeur = '';
  let orgClient = '';
  let orgAutre = '';

  const serveur = () => app.getHttpServer();
  const compte = (cle: string) => {
    const email = `adr47-${cle.toLowerCase()}-${tag}@lalanda-test.local`;
    if (!emails.includes(email)) emails.push(email);
    return { email, password: `Passw0rd!${cle}`, name: `ADR47 ${cle}` };
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
  const orgDe = async (c: string[]): Promise<string> => {
    const orgs = await request(serveur()).get('/organizations').set('Cookie', c);
    return (orgs.body.organizations as { id: string }[])[0]!.id;
  };
  const poserRole = (userId: string, role: PlatformRole) =>
    db.collection('platform_roles').insertOne({
      userId,
      role,
      grantedBy: null,
      reason: `suite e2e ADR-0047 ${tag}`,
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
  const client = () => [...cookies['client']!, `active_org_id=${orgClient}`];
  const autre = () => [...cookies['autre']!, `active_org_id=${orgAutre}`];
  const poster = (cle: string, chemin: string, corps: object = {}) =>
    request(serveur()).post(chemin).set('Cookie', cookies[cle]!).send(corps);
  const lire = (cle: string, chemin: string) =>
    request(serveur()).get(chemin).set('Cookie', cookies[cle]!);

  /** Le client ouvre une demande de dépôt mobile money. */
  const demande = async (plan = 'pro') => {
    viderLimiteur();
    const res = await request(serveur())
      .post('/payments/checkout')
      .set('Cookie', client())
      .send({ plan, interval: 'month', method: 'mobile_money' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as {
      reference: string;
      amountDueCents: number;
      taxCents: number;
      totalDueCents: number;
    };
  };
  const confirmer = async (cle: string, reference: string) => {
    await reauth(cle);
    return poster(cle, `/admin/billing/manual-payments/${reference}/confirm`, {
      note: 'Dépôt M-Pesa reçu, référence opérateur 0001',
    });
  };
  const facturesVendeur = () =>
    db.collection('sales_invoices').find({ organizationId: orgVendeur }).toArray();

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    await db.collection('platform_roles').deleteMany({});
    vi.spyOn(app.get(PdfRenderingService), 'render').mockResolvedValue(Buffer.from('%PDF-1.4 e2e'));

    // Vendeur : l'organisation de Go freelance SARLU, avec sa fiche fiscale.
    cookies['vendeur'] = await registerAndLogin(app, compte('vendeur'));
    orgVendeur = await orgDe(cookies['vendeur']);
    const fiche = await request(serveur())
      .put('/organizations/current/fiscal-profile')
      .set('Cookie', cookies['vendeur'])
      .send(FICHE_VENDEUR);
    expect(fiche.status, JSON.stringify(fiche.body)).toBe(200);
    // Taux DGI relevés (instantané de l'environnement de test, forme réelle).
    await db.collection('edef_reference_snapshots').insertOne({
      environment: 'test',
      list: 'taxGroups',
      sha256: randomBytes(32).toString('hex'),
      payload: {
        a: 0,
        b: 16,
        c: 5,
        d: 0,
        e: 0,
        f: 16,
        g: 5,
        h: 0,
        i: 0,
        j: 0,
        k: 0,
        l: 0,
        m: 0,
        n: 0,
        o: 1,
        p: 1,
      },
      fetchedAt: new Date(),
      _schemaVersion: 1,
    });

    cookies['client'] = await registerAndLogin(app, compte('client'));
    orgClient = await orgDe(cookies['client']);
    cookies['autre'] = await registerAndLogin(app, compte('autre'));
    orgAutre = await orgDe(cookies['autre']);

    for (const [cle, role] of [
      ['sa', 'platform_super_admin'],
      ['fac', 'platform_billing'],
      ['fac2', 'platform_billing'],
    ] as const) {
      cookies[cle] = await registerAndLogin(app, compte(cle));
      ids[cle] = await idDeSession(cookies[cle]);
      await db.collection('memberships').deleteMany({ userId: ids[cle] });
      await poserRole(ids[cle]!, role);
    }
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await teardown(app, emails);
  }, E2E_HOOK_TIMEOUT_MS);

  let referenceSansVendeur = '';

  it('chiffrage : prix HT de la grille, TVA 16 % ajoutée, montant à verser TTC', async () => {
    viderLimiteur();
    const q = await request(serveur())
      .get('/organizations/current/subscription/quote?plan=pro&interval=month')
      .set('Cookie', client());
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const attendu = subscriptionAmounts({ cents: priceCents('pro', 'month')!, mode: 'ht' });
    expect(q.body).toMatchObject({
      amountDueCents: priceCents('pro', 'month'),
      taxIncluded: false,
      taxCents: attendu.taxCents,
      totalDueCents: attendu.totalCents,
      tax: { group: 'B', ratePercent: '16' },
    });
  });

  it('sans organisation vendeuse : le paiement vaut, la facture attend la console', async () => {
    const d = await demande();
    referenceSansVendeur = d.reference;
    expect(d.amountDueCents).toBe(priceCents('pro', 'month'));
    expect(d.totalDueCents).toBe(d.amountDueCents + d.taxCents);
    const req = await db.collection('manual_payment_requests').findOne({ reference: d.reference });
    expect(req).toMatchObject({
      amountDueCents: d.totalDueCents,
      amountExclTaxCents: d.amountDueCents,
      taxCents: d.taxCents,
    });

    const ok = await confirmer('fac', d.reference);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const sub = await request(serveur())
      .get('/organizations/current/subscription')
      .set('Cookie', client());
    expect(sub.body.subscribedPlan).toBe('pro');

    const lien = await db
      .collection('subscription_invoices')
      .findOne({ paymentKey: `manual:manual:${d.reference}` });
    expect(lien).toMatchObject({ status: 'failed', lastError: { code: 'SELLER_NOT_DESIGNATED' } });
    expect(await facturesVendeur()).toHaveLength(0);

    const liste = await lire('fac', '/admin/billing/subscription-invoices/uninvoiced');
    expect(liste.status).toBe(200);
    expect(liste.body.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: `manual:${d.reference}`,
          organizationId: orgClient,
          amountCents: d.totalDueCents,
          attempt: expect.objectContaining({ status: 'failed' }),
        }),
      ]),
    );
  });

  it('désignation du vendeur : motif et ré-authentification ; ni le Support ni un client', async () => {
    const sansReauth = await request(serveur())
      .put('/admin/billing/subscription-invoices/seller')
      .set('Cookie', cookies['sa']!)
      .send({ organizationId: orgVendeur, reason: 'Organisation de Go freelance SARLU' });
    expect([401, 403]).toContain(sansReauth.status);

    await reauth('sa');
    const sansMotif = await request(serveur())
      .put('/admin/billing/subscription-invoices/seller')
      .set('Cookie', cookies['sa']!)
      .send({ organizationId: orgVendeur });
    expect(sansMotif.status).toBe(400);

    const inconnue = await request(serveur())
      .put('/admin/billing/subscription-invoices/seller')
      .set('Cookie', cookies['sa']!)
      .send({
        organizationId: new ObjectId().toHexString(),
        reason: 'Organisation inexistante ici',
      });
    expect(inconnue.status).toBe(404);

    const res = await request(serveur())
      .put('/admin/billing/subscription-invoices/seller')
      .set('Cookie', cookies['sa']!)
      .send({ organizationId: orgVendeur, reason: 'Organisation de Go freelance SARLU' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      sellerOrganizationId: orgVendeur,
      readiness: { ready: true, blockers: [] },
    });

    const parClient = await request(serveur())
      .get('/admin/billing/subscription-invoices/seller')
      .set('Cookie', client());
    expect(parClient.status).toBe(403);
  });

  it('paiement passé : « émettre la facture » avec motif, une seule fois', async () => {
    await reauth('fac');
    const sansMotif = await poster('fac', '/admin/billing/subscription-invoices/emit', {
      provider: 'manual',
      eventId: `manual:${referenceSansVendeur}`,
    });
    expect(sansMotif.status).toBe(400);

    const corps = {
      provider: 'manual',
      eventId: `manual:${referenceSansVendeur}`,
      reason: 'Régularisation du dépôt confirmé avant la désignation du vendeur',
    };
    const res = await poster('fac', '/admin/billing/subscription-invoices/emit', corps);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.alreadyIssued).toBe(false);
    expect(res.body.invoice).toMatchObject({ status: 'issued', origin: 'console' });
    expect(res.body.invoice.invoiceNumber).toMatch(/^IN\d{4}-\d{6}$/);

    const encore = await poster('fac', '/admin/billing/subscription-invoices/emit', corps);
    expect(encore.status).toBe(200);
    expect(encore.body.alreadyIssued).toBe(true);
    expect(encore.body.invoice.invoiceNumber).toBe(res.body.invoice.invoiceNumber);
    expect(await facturesVendeur()).toHaveLength(1);

    const reste = await lire('fac', '/admin/billing/subscription-invoices/uninvoiced');
    expect(
      (reste.body.payments as { eventId: string }[]).some(
        (p) => p.eventId === `manual:${referenceSansVendeur}`,
      ),
    ).toBe(false);
  });

  let numeroAuto = '';
  let lienAuto = '';

  it('fiche de facturation : raison sociale obligatoire, NIF contrôlé', async () => {
    const vide = await request(serveur())
      .put('/organizations/current/subscription/billing-profile')
      .set('Cookie', client())
      .send({ legalName: '  ', nif: null, address: null });
    expect(vide.status).toBe(400);
    const nifFaux = await request(serveur())
      .put('/organizations/current/subscription/billing-profile')
      .set('Cookie', client())
      .send({ legalName: 'Client Exemple SARL', nif: '!!', address: null });
    expect(nifFaux.status).toBe(400);
    const ok = await request(serveur())
      .put('/organizations/current/subscription/billing-profile')
      .set('Cookie', client())
      .send({ legalName: 'Client Exemple SARL', nif: 'b 98765 43', address: 'Lubumbashi' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.effective).toMatchObject({
      legalName: 'Client Exemple SARL',
      nif: 'B9876543',
      address: 'Lubumbashi',
      source: 'billing_profile',
    });
  });

  it('à l’encaissement confirmé : une facture ordinaire, groupe B, total = somme reçue', async () => {
    // Montée en gamme (Pro → Cabinet) : montant HT au prorata, TVA 16 % en sus.
    const d = await demande('cabinet');
    const ok = await confirmer('fac', d.reference);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const lien = await db
      .collection('subscription_invoices')
      .findOne({ paymentKey: `manual:manual:${d.reference}` });
    expect(lien, JSON.stringify(lien)).toMatchObject({ status: 'issued', origin: 'automatic' });
    numeroAuto = String(lien!['invoiceNumber']);
    lienAuto = String(lien!['_id']);

    const facture = await db
      .collection('sales_invoices')
      .findOne({ _id: new ObjectId(String(lien!['invoiceId'])), organizationId: orgVendeur });
    expect(facture).toMatchObject({
      status: 'issued',
      emissionMode: 'standard',
      normalization: null,
      type: 'FV',
      currency: 'USD',
      number: numeroAuto,
      seller: { legalName: 'Go freelance SARLU', nif: 'A1234567Z', vatRegistered: true },
      customer: { type: 'PM', name: 'Client Exemple SARL', nif: 'B9876543' },
    });
    const totals = facture!['documentAmounts'].calculation.totals;
    expect(totals.total).toBe((d.totalDueCents / 100).toFixed(2));
    expect(totals.vatTotal).toBe((d.taxCents / 100).toFixed(2));
    expect(totals.groups).toEqual([
      expect.objectContaining({
        group: 'B',
        ratePercent: '16',
        ht: (d.amountDueCents / 100).toFixed(2),
      }),
    ]);
    expect(facture!['lines'][0]).toMatchObject({ taxGroup: 'B', itemType: 'SER' });
    expect(facture!['comments'].C).toContain(d.reference);
  });

  it('idempotence : confirmation rejouée, pont rejoué, rappel Stripe réémis → aucune seconde facture', async () => {
    const avant = (await facturesVendeur()).length;
    const lien = await db
      .collection('subscription_invoices')
      .findOne({ _id: new ObjectId(lienAuto) });
    const reference = String(lien!['reference']);

    const rejeu = await confirmer('fac', reference);
    expect(rejeu.status).toBeGreaterThanOrEqual(400);
    expect(rejeu.body.code).toBe('MANUAL_REQUEST_CLOSED');

    // Rejeu direct du pont, comme le ferait une reprise après incident.
    const service = app.get(SubscriptionInvoicingService);
    const fait = {
      provider: 'manual' as const,
      eventId: `manual:${reference}`,
      organizationId: orgClient,
      plan: 'pro' as const,
      interval: 'month' as const,
      amountCents: Number(lien!['amountCents']),
      currency: 'USD',
      method: 'mobile_money',
      reference,
      paidAt: new Date(),
    };
    const [a, b] = await Promise.all([
      service.invoiceForPayment(fait, { origin: 'automatic' }),
      service.invoiceForPayment(fait, { origin: 'automatic' }),
    ]);
    expect(a.invoiceNumber).toBe(numeroAuto);
    expect(b.invoiceNumber === numeroAuto || b.status !== 'issued').toBe(true);
    expect((await facturesVendeur()).length).toBe(avant);

    // Rappel Stripe signé, réémis deux fois : une facture.
    const eventId = `evt_e2e_adr47_${tag}`;
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      id: eventId,
      type: 'invoice.paid',
      created: now,
      data: {
        object: {
          customer: 'cus_e2e_adr47',
          subscription: `sub_e2e_adr47_${tag}`,
          amount_paid: fait.amountCents,
          currency: 'usd',
          period_start: now,
          period_end: now + 30 * 24 * 3600,
          subscription_details: {
            metadata: { organizationId: orgClient, plan: 'pro', interval: 'month' },
          },
        },
      },
    };
    const body = JSON.stringify(payload);
    const signature = hmacSha256Hex(WEBHOOK_SECRET, `${now}.${body}`);
    for (let i = 0; i < 2; i += 1) {
      const res = await request(serveur())
        .post('/payments/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', `t=${now},v1=${signature}`)
        .send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const liensStripe = await db
      .collection('subscription_invoices')
      .find({ paymentKey: `stripe:${eventId}` })
      .toArray();
    expect(liensStripe).toHaveLength(1);
    expect(liensStripe[0]).toMatchObject({ status: 'issued', method: 'card' });
    expect((await facturesVendeur()).length).toBe(avant + 1);
  });

  it('espace de l’abonné : ses factures et leur PDF ; une autre organisation n’y accède pas', async () => {
    const liste = await request(serveur())
      .get('/organizations/current/subscription/invoices')
      .set('Cookie', client());
    expect(liste.status).toBe(200);
    const factures = liste.body.invoices as {
      id: string;
      number: string;
      kind: string;
      normalized: boolean;
      totalCents: number;
    }[];
    expect(factures.length).toBeGreaterThanOrEqual(3);
    const auto = factures.find((f) => f.number === numeroAuto)!;
    expect(auto).toMatchObject({ kind: 'invoice', normalized: false, currency: 'USD' });

    const pdf = await request(serveur())
      .get(`/organizations/current/subscription/invoices/${auto.id}/pdf`)
      .set('Cookie', client());
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    const intrus = await request(serveur())
      .get(`/organizations/current/subscription/invoices/${auto.id}/pdf`)
      .set('Cookie', autre());
    expect(intrus.status).toBe(404);
    const sienne = await request(serveur())
      .get('/organizations/current/subscription/invoices')
      .set('Cookie', autre());
    expect(sienne.body.invoices).toEqual([]);

    // Le journal du vendeur ne reçoit aucun identifiant d'utilisateur de l'abonné.
    const idClient = await idDeSession(cookies['client']!);
    const chezVendeur = await db
      .collection('audit_events')
      .countDocuments({ organizationId: orgVendeur, actorUserId: idClient });
    expect(chezVendeur).toBe(0);
    const chezClient = await db.collection('audit_events').countDocuments({
      organizationId: orgClient,
      actorUserId: idClient,
      action: 'subscription.invoice_downloaded',
    });
    expect(chezClient).toBe(1);
  });

  it('avoir sur remboursement : motif, deux personnes, série des avoirs', async () => {
    await reauth('fac');
    const sansMotif = await poster(
      'fac',
      `/admin/billing/subscription-invoices/${lienAuto}/credit-note`,
      {},
    );
    expect(sansMotif.status).toBe(400);
    const demandeAvoir = await poster(
      'fac',
      `/admin/billing/subscription-invoices/${lienAuto}/credit-note`,
      { reason: 'Remboursement accordé : double paiement constaté' },
    );
    expect(demandeAvoir.status, JSON.stringify(demandeAvoir.body)).toBe(200);
    expect(demandeAvoir.body.creditNote).toMatchObject({ status: 'requested', approvedBy: null });

    const doublon = await poster(
      'fac',
      `/admin/billing/subscription-invoices/${lienAuto}/credit-note`,
      { reason: 'Remboursement accordé : double paiement constaté' },
    );
    expect(doublon.status).toBe(409);

    const parAuteur = await poster(
      'fac',
      `/admin/billing/subscription-invoices/${lienAuto}/credit-note/approve`,
    );
    expect(parAuteur.status).toBe(409);
    expect(parAuteur.body.code).toBe('SELF_APPROVAL_FORBIDDEN');

    await reauth('fac2');
    const approuve = await poster(
      'fac2',
      `/admin/billing/subscription-invoices/${lienAuto}/credit-note/approve`,
    );
    expect(approuve.status, JSON.stringify(approuve.body)).toBe(200);
    expect(approuve.body.creditNote).toMatchObject({
      status: 'issued',
      approvedBy: ids['fac2'],
      soleApprover: false,
    });
    expect(approuve.body.creditNote.number).toMatch(/^AV\d{4}-\d{6}$/);

    const avoir = await db
      .collection('sales_invoices')
      .findOne({ organizationId: orgVendeur, number: approuve.body.creditNote.number });
    expect(avoir).toMatchObject({ type: 'FA', status: 'issued', creditNote: { nature: 'RAN' } });

    const liste = await request(serveur())
      .get('/organizations/current/subscription/invoices')
      .set('Cookie', client());
    expect(
      (liste.body.invoices as { kind: string; number: string }[]).some(
        (f) => f.kind === 'credit_note' && f.number === approuve.body.creditNote.number,
      ),
    ).toBe(true);

    const encore = await poster(
      'fac2',
      `/admin/billing/subscription-invoices/${lienAuto}/credit-note`,
      { reason: 'Deuxième demande pour la même facture' },
    );
    expect(encore.status).toBe(409);
  });

  it('console : liste par état et PDF ; un client n’ouvre aucune route de la console', async () => {
    const liste = await lire('fac', '/admin/billing/subscription-invoices?status=issued');
    expect(liste.status).toBe(200);
    expect((liste.body.invoices as unknown[]).length).toBeGreaterThanOrEqual(3);
    const pdf = await lire(
      'fac',
      `/admin/billing/subscription-invoices/${lienAuto}/pdf?kind=credit_note`,
    );
    expect(pdf.status).toBe(200);
    for (const chemin of [
      '/admin/billing/subscription-invoices',
      '/admin/billing/subscription-invoices/uninvoiced',
    ]) {
      const res = await request(serveur()).get(chemin).set('Cookie', client());
      expect(res.status, chemin).toBe(403);
    }
  });
});
