// Envoi des documents de vente par e-mail contre la vraie application (ADR-0042).
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard → débit
// → contrôleur → MongoDB → modèle du document → rendu → audit → MailService →
// transport. AUCUN ENVOI RÉEL : `MailTransport.send` est un espion qui enregistre
// le message, et les variables ZeptoMail/SMTP sont retirées avant le démarrage.
// Le rendu Chromium est remplacé par `%PDF-FAKE` + HTML (comme les autres suites).
//
// Organisation A ordinaire (sans facture normalisée), organisation B pour
// l'isolation. BASE DÉDIÉE, supprimée à la fin.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { MailTransport } from '../mail/mail.transport.js';
import type { MailDeliveryResult, MailMessage } from '../mail/mail.types.js';
import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { DOCUMENT_EMAIL_USER_THROTTLE } from '../security/throttling.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

// Jamais de vrai chemin d'envoi dans cette suite, même si `.env` en déclare un.
for (const v of ['ZEPTOMAIL_TOKEN', 'ZEPTOMAIL_API_URL', 'SMTP_HOST']) delete process.env[v];

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_document_email_${tag}`;
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';
delete process.env['DGI_PRODUCTION_ENABLED'];

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!envoi-mail';
const EMAIL_CLIENT = `client-${tag}@exemple-client.test`;

const GROUPES: Record<string, number> = {
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
};

const LIGNE = {
  source: 'free',
  code: 'CONSEIL-H',
  name: 'Conseil (heure)',
  itemType: 'SER',
  taxGroup: 'B',
  outOfScope: false,
  unit: 'heure',
  quantity: '2',
  unitPrice: '40.00',
  specificTax: null,
  discount: null,
};

type Compte = 'owner' | 'sales_rep' | 'viewer' | 'ownerB';

e2eSuite('envoi des documents de vente par e-mail (ADR-0042)', () => {
  let app: INestApplication;
  let db: Db;
  let orgA = '';
  let orgB = '';
  let customerA = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;
  const envoyes: MailMessage[] = [];
  let reponse: MailDeliveryResult = { delivered: true };

  const server = () => app.getHttpServer();
  const asA = (c: Exclude<Compte, 'ownerB'> = 'owner') => [...cookies[c], `active_org_id=${orgA}`];
  const asB = () => [...cookies['ownerB'], `active_org_id=${orgB}`];
  const post = (c: string[], path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', c)
      .send(body ?? {});
  const put = (c: string[], path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', c).send(body);
  const get = (c: string[], path: string) => request(server()).get(path).set('Cookie', c);
  const ok = (res: request.Response, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const clearThrottle = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };
  const audits = (targetId: string) =>
    db.collection('audit_events').find({ targetId, action: /email/ }).sort({ _id: 1 }).toArray();

  const corps = () => ({
    type: 'FV',
    currency: 'USD',
    priceMode: 'ht',
    customer: { customerId: customerA, printContactDetails: false },
    pointOfSaleId: null,
    lines: [LIGNE],
    payments: [],
    comments: { A: null, C: null },
    creditNote: null,
    showUsdCounterValue: false,
  });

  async function brouillonPret() {
    const body = corps();
    const d = ok(await post(asA(), '/sales/invoices', body), 201);
    const total = d['documentAmounts'].calculation.totals.total as string;
    return ok(
      await put(asA(), `/sales/invoices/${d['id']}`, {
        ...body,
        payments: [{ method: 'VIREMENT', amount: total }],
        expectedRevision: d['revision'],
      }),
    );
  }

  async function emise() {
    const d = await brouillonPret();
    return ok(
      await post(asA(), `/sales/invoices/${d['id']}/issue`, { expectedRevision: d['revision'] }),
    );
  }

  async function devis(envoye = true) {
    const d = ok(
      await post(asA(), '/sales/quotes', {
        currency: 'CDF',
        priceMode: 'ht',
        customer: { customerId: customerA, printContactDetails: false },
        lines: [{ ...LIGNE, unitPrice: '40000.00' }],
        title: 'Accompagnement',
        notes: null,
      }),
      201,
    );
    if (!envoye) return d;
    return ok(
      await post(asA(), `/sales/quotes/${d['id']}/send`, { expectedRevision: d['revision'] }),
    );
  }

  const envoi = (over: Record<string, unknown> = {}) => ({
    to: EMAIL_CLIENT,
    cc: [`compta-${tag}@exemple-client.test`],
    subject: 'Votre document',
    message: 'Bonjour,\n\nVeuillez trouver le document ci-joint.\n\nCordialement',
    ...over,
  });

  async function instantane(list: string, payload: unknown) {
    await db.collection('edef_reference_snapshots').insertOne({
      environment: 'test',
      list,
      sha256: randomBytes(32).toString('hex'),
      payload,
      fetchedAt: new Date(),
      _schemaVersion: 1,
    });
  }

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));
    vi.spyOn(app.get(PdfRenderingService), 'render').mockImplementation(async (html) =>
      Buffer.from(`%PDF-FAKE\n${html}`, 'utf8'),
    );
    // Le transport de test : rien ne quitte le processus.
    vi.spyOn(app.get(MailTransport), 'send').mockImplementation(async (m: MailMessage) => {
      envoyes.push(m);
      return reponse;
    });

    for (const c of ['owner', 'sales_rep', 'viewer', 'ownerB'] as const) {
      emails[c] = `envoi-mail-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({ email: emails[c], password: MOT_DE_PASSE, name: `Env ${c}` });
    const orgDe = async (c: Compte) => {
      cookies[c] = await registerAndLogin(app, compte(c));
      const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
      return (orgs.body.organizations as { id: string }[])[0]!.id;
    };
    orgA = await orgDe('owner');
    orgB = await orgDe('ownerB');
    for (const role of ['sales_rep', 'viewer'] as const) {
      const inv = ok(
        await request(server())
          .post(`/organizations/${orgA}/invitations`)
          .set('Cookie', cookies['owner'])
          .send({ email: emails[role], role }),
        201,
      );
      cookies[role] = await registerAndLogin(app, compte(role));
      ok(
        await request(server())
          .post('/invitations/accept')
          .set('Cookie', cookies[role])
          .send({ token: inv['token'] }),
        201,
      );
    }

    ok(
      await put(asA(), '/organizations/current/fiscal-profile', {
        legalName: 'Exemple SARL',
        tradeName: null,
        legalForm: 'sarl',
        legalFormOther: null,
        nif: 'S0000000X',
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
        phone: '+243 800 000 000',
        email: 'contact@exemple.cd',
      }),
    );
    await instantane('taxGroups', GROUPES);
    await instantane('clientTypes', [{ type: 'PM', description: 'Personne morale (fictif)' }]);
    await instantane('referenceTypes', [{ type: 'RRR', description: 'Remise (fictif)' }]);

    customerA = ok(
      await post(asA(), '/sales/customers', {
        type: 'PM',
        name: 'Client Exemple SARL',
        nif: `S${tag.toUpperCase()}01`,
        email: EMAIL_CLIENT,
      }),
      201,
    )['id'];
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, E2E_HOOK_TIMEOUT_MS);

  beforeEach(() => {
    clearThrottle();
    envoyes.length = 0;
    reponse = { delivered: true };
  });

  it('facture émise : préremplissage, envoi, PDF joint, réponse à l’expéditeur, audit', async () => {
    const f = await emise();
    const brouillon = ok(await get(asA(), `/sales/invoices/${f['id']}/email`));
    expect(brouillon).toMatchObject({ sendable: true, nature: 'invoice', to: EMAIL_CLIENT });
    expect(brouillon['subject']).toContain(f['number']);
    expect(brouillon['subject']).toContain('Exemple SARL');
    expect(brouillon['message']).toContain('Env owner');
    expect(envoyes).toHaveLength(0);

    const r = ok(await post(asA(), `/sales/invoices/${f['id']}/email`, envoi()));
    expect(r).toEqual({
      delivered: true,
      reason: null,
      to: EMAIL_CLIENT,
      cc: [`compta-${tag}@exemple-client.test`],
    });
    expect(envoyes).toHaveLength(1);
    const m = envoyes[0]!;
    expect(m.to).toBe(EMAIL_CLIENT);
    expect(m.cc).toEqual([`compta-${tag}@exemple-client.test`]);
    expect(m.subject).toBe('Votre document');
    expect(m.replyTo).toEqual({ address: emails['owner'], name: 'Env owner' });
    expect(m.fromName).toBe('Exemple SARL via Lalanda');
    expect(m.redactInLogs).toBe(true);
    expect(m.attachments).toHaveLength(1);
    const pdf = Buffer.from(m.attachments![0]!.contentBase64, 'base64').toString('utf8');
    expect(pdf.startsWith('%PDF-FAKE')).toBe(true);
    expect(pdf).toContain(f['number'] as string);
    expect(m.attachments![0]!.filename).toMatch(/\.pdf$/);
    expect(m.text).not.toContain('pas une facture');

    const evts = await audits(f['id'] as string);
    const actions = evts.map((e) => e['action']);
    expect(actions).toEqual(['sales_invoice.email_requested', 'sales_invoice.emailed']);
    expect(actions).not.toContain('sales_invoice.pdf_exported');
    expect(evts[0]!['organizationId']).toBe(orgA);
    expect(evts[0]!['metadata']).toMatchObject({
      to: EMAIL_CLIENT,
      nature: 'invoice',
      status: 'issued',
    });
    // Ni l'objet ni le message n'entrent au journal : seulement leurs longueurs.
    expect(JSON.stringify(evts)).not.toContain('Veuillez trouver');
    expect(evts[1]!['metadata']).toMatchObject({ delivered: true, reason: null });
  });

  it('brouillon : part comme pro forma, avec la mention fixe hors du texte modifiable', async () => {
    const d = await brouillonPret();
    const b = ok(await get(asA(), `/sales/invoices/${d['id']}/email`));
    expect(b).toMatchObject({ sendable: true, nature: 'proforma' });
    ok(await post(asA(), `/sales/invoices/${d['id']}/email`, envoi({ message: 'Ci-joint.' })));
    expect(envoyes[0]!.text).toContain('Pro forma — ce document n’est pas une facture.');
    const pdf = Buffer.from(envoyes[0]!.attachments![0]!.contentBase64, 'base64').toString('utf8');
    expect(pdf).toContain('PRO FORMA — non valable comme facture');
  });

  it('document non envoyable : 409 DOCUMENT_NOT_SENDABLE, rien ne part, rien au journal', async () => {
    const d = await brouillonPret();
    await db
      .collection('sales_invoices')
      .updateOne(
        { _id: new ObjectId(d['id'] as string) },
        { $set: { status: 'normalization_failed' } },
      );
    const b = ok(await get(asA(), `/sales/invoices/${d['id']}/email`));
    expect(b['sendable']).toBe(false);
    expect(b['reason']).toMatch(/normalisation/i);
    const r = await post(asA(), `/sales/invoices/${d['id']}/email`, envoi());
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DOCUMENT_NOT_SENDABLE');

    const q = await devis(false);
    const rq = await post(asA(), `/sales/quotes/${q['id']}/email`, envoi());
    expect(rq.status).toBe(409);
    expect(rq.body.code).toBe('DOCUMENT_NOT_SENDABLE');
    expect(envoyes).toHaveLength(0);
    expect(await audits(d['id'] as string)).toHaveLength(0);
  });

  it('destinataire invalide, objet multiligne, champ inconnu : 400, rien ne part', async () => {
    const f = await emise();
    for (const over of [
      { to: 'pas-une-adresse' },
      { cc: ['x@y'] },
      { subject: 'Facture\r\nBcc: espion@exemple.test' },
      { bcc: ['espion@exemple.test'] },
    ]) {
      const r = await post(asA(), `/sales/invoices/${f['id']}/email`, envoi(over));
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(r.body.code).toBe('INVALID_REQUEST');
    }
    expect(envoyes).toHaveLength(0);
    expect(await audits(f['id'] as string)).toHaveLength(0);
  });

  it('RBAC : facture en `sales.invoice`, devis en `sales.quote`', async () => {
    const f = await emise();
    const q = await devis();
    // Commercial : devis oui, facture non.
    const r1 = await post(asA('sales_rep'), `/sales/invoices/${f['id']}/email`, envoi());
    expect(r1.status).toBe(403);
    expect(r1.body.action).toBe('sales.invoice');
    expect((await get(asA('sales_rep'), `/sales/invoices/${f['id']}/email`)).status).toBe(403);
    const r2 = ok(await post(asA('sales_rep'), `/sales/quotes/${q['id']}/email`, envoi()));
    expect(r2['delivered']).toBe(true);
    expect(envoyes[0]!.replyTo?.address).toBe(emails['sales_rep']);
    expect(envoyes[0]!.text).toContain('Devis — ce document n’est pas une facture.');
    // Lecteur : ni l'un ni l'autre.
    expect((await post(asA('viewer'), `/sales/quotes/${q['id']}/email`, envoi())).status).toBe(403);
    expect((await post(asA('viewer'), `/sales/invoices/${f['id']}/email`, envoi())).status).toBe(
      403,
    );
    expect(envoyes).toHaveLength(1);
    const evts = await audits(q['id'] as string);
    expect(evts.map((e) => e['action'])).toEqual([
      'sales_quote.email_requested',
      'sales_quote.emailed',
    ]);
  });

  it('isolation : un document d’une autre organisation répond 404, rien ne part', async () => {
    const f = await emise();
    const q = await devis();
    expect((await post(asB(), `/sales/invoices/${f['id']}/email`, envoi())).status).toBe(404);
    expect((await get(asB(), `/sales/invoices/${f['id']}/email`)).status).toBe(404);
    expect((await post(asB(), `/sales/quotes/${q['id']}/email`, envoi())).status).toBe(404);
    expect(envoyes).toHaveLength(0);
    expect(await audits(f['id'] as string)).toHaveLength(0);
  });

  it('envoi non configuré : 200 delivered=false, motif au journal', async () => {
    reponse = { delivered: false, reason: 'MAIL_NOT_CONFIGURED' };
    const f = await emise();
    const r = ok(await post(asA(), `/sales/invoices/${f['id']}/email`, envoi({ cc: [] })));
    expect(r).toMatchObject({ delivered: false, reason: 'MAIL_NOT_CONFIGURED', cc: [] });
    const evts = await audits(f['id'] as string);
    expect(evts.at(-1)!['metadata']).toMatchObject({
      delivered: false,
      reason: 'MAIL_NOT_CONFIGURED',
    });
  });

  it('débit : seau commun aux factures et aux devis, 429 en français au-delà', async () => {
    const z = '000000000000000000000000';
    const limite = DOCUMENT_EMAIL_USER_THROTTLE.limit;
    for (let i = 0; i < limite; i += 1) {
      const path = i % 2 === 0 ? `/sales/invoices/${z}/email` : `/sales/quotes/${z}/email`;
      expect((await post(asA(), path, envoi())).status).toBe(404);
    }
    const r = await post(asA(), `/sales/quotes/${z}/email`, envoi());
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('DOCUMENT_EMAIL_RATE_LIMITED');
    expect(r.body.message).toMatch(/Réessayez dans/);
    // Le préremplissage n'est pas compté.
    expect((await get(asA(), `/sales/quotes/${z}/email`)).status).toBe(404);
    clearThrottle();
  });
});
