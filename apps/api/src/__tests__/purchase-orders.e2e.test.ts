// Demandes d'achat et bons de commande contre la vraie application (ADR-0044 § 2.2,
// § 2.3, § 3.2, § 3.3, § 6.5 ; critères 1 à 6, 15 et 17). ADR-0044 — P3.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleurs → MongoDB → moteur (`computeOrderTotals`, `requiredApprovals`) →
// `purchaseApprovalDecision` → audit → notifications → « Mes tâches ». Le PDF passe
// par le vrai modèle et le vrai rendu HTML ; Chromium est remplacé par
// `%PDF-FAKE` + HTML. AUCUN ENVOI RÉEL : `MailTransport.send` est un espion, les
// variables ZeptoMail et SMTP sont retirées avant le démarrage.
//
// Organisations : N (deux approbateurs : Propriétaire et Directeur financier, et un
// membre de chaque autre rôle), S (un seul approbateur), B (isolation). BASE DÉDIÉE,
// supprimée à la fin.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../authz/audit.service.js';
import { MailTransport } from '../mail/mail.transport.js';
import type { MailDeliveryResult, MailMessage } from '../mail/mail.types.js';
import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { DOCUMENT_EMAIL_USER_THROTTLE } from '../security/throttling.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

for (const v of ['ZEPTOMAIL_TOKEN', 'ZEPTOMAIL_API_URL', 'SMTP_HOST']) delete process.env[v];

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_commandes_${tag}`;
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!commandes';
const ROLES = [
  'finance_director',
  'admin',
  'accountant',
  'analyst',
  'viewer',
  'sales_rep',
  'advisor',
] as const;
type Role = 'owner' | (typeof ROLES)[number];
type Compte = Role | 'ownerS' | 'analystS' | 'ownerB';

const COMPTE_BANCAIRE = `00011${tag.replace(/[a-f]/g, '7')}94521`;
const CONTACT = `achats-${tag}@fournisseur.test`;
const NUMERO = /^(DA|BC)\d{2}(0[1-9]|1[0-2])-\d{6}$/;

e2eSuite('Demandes et bons de commande (ADR-0044 P3)', () => {
  let app: INestApplication;
  let db: Db;
  let orgN = '';
  let orgS = '';
  let orgB = '';
  let supplierN = '';
  let supplierS = '';
  let supplierB = '';
  let projetN = '';
  let projetB = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;
  const userIds = {} as Record<Compte, string>;
  const envoyes: MailMessage[] = [];
  let reponse: MailDeliveryResult = { delivered: true };

  const server = () => app.getHttpServer();
  const as = (c: Compte) => {
    const org = c === 'ownerS' || c === 'analystS' ? orgS : c === 'ownerB' ? orgB : orgN;
    return [...cookies[c], `active_org_id=${org}`];
  };
  const get = (c: Compte, path: string) => request(server()).get(path).set('Cookie', as(c));
  const post = (c: Compte, path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', as(c))
      .send(body ?? {});
  const put = (c: Compte, path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', as(c)).send(body);
  const del = (c: Compte, path: string) => request(server()).delete(path).set('Cookie', as(c));
  const ok = (res: request.Response, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const code = (res: request.Response, status: number, expected: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code).toBe(expected);
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
    db
      .collection('audit_events')
      .find({ targetId, targetType: 'purchase_order' })
      .sort({ _id: 1 })
      .toArray();
  const notifications = (orderId: string) =>
    db.collection('notifications').find({ 'source.entityId': orderId }).sort({ _id: 1 }).toArray();

  const ligne = (over: Record<string, unknown> = {}) => ({
    label: 'Ramettes A4',
    quantity: '10',
    unit: 'carton',
    unitPrice: '5.00',
    kind: 'goods',
    ...over,
  });

  async function demande(
    c: Compte,
    over: Record<string, unknown> = {},
  ): Promise<Record<string, any>> {
    const supplierId =
      c === 'ownerS' || c === 'analystS' ? supplierS : c === 'ownerB' ? supplierB : supplierN;
    return ok(
      await post(c, '/purchases/orders', {
        title: 'Fournitures de bureau',
        currency: 'USD',
        supplierId,
        lines: [ligne()],
        ...over,
      }),
      201,
    );
  }
  async function soumise(c: Compte, over: Record<string, unknown> = {}) {
    const d = await demande(c, over);
    return ok(await post(c, `/purchases/orders/${d['id']}/submit`, { expectedRevision: 1 }));
  }
  const approuver = (c: Compte, o: Record<string, any>, comment?: string) =>
    post(c, `/purchases/orders/${o['id']}/approve`, {
      expectedRevision: o['revision'],
      ...(comment ? { comment } : {}),
    });
  async function reglerPaliers(
    c: Compte,
    USD: unknown,
    CDF: unknown = [{ from: '0', approvals: 1 }],
  ) {
    const s = ok(await get(c, '/purchases/settings'));
    return ok(
      await put(c, '/purchases/settings', {
        approvalTiers: { CDF, USD },
        expectedRevision: s['revision'],
      }),
    );
  }
  const mesTaches = async (c: Compte) => {
    const v = ok(await get(c, '/work/my-tasks'));
    return [...v['overdue'], ...v['today'], ...v['next7Days'], ...v['later'], ...v['noDate']] as {
      source: string;
      orderId?: string;
    }[];
  };

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));
    vi.spyOn(app.get(PdfRenderingService), 'render').mockImplementation(async (html) =>
      Buffer.from(`%PDF-FAKE\n${html}`, 'utf8'),
    );
    vi.spyOn(app.get(MailTransport), 'send').mockImplementation(async (m: MailMessage) => {
      envoyes.push(m);
      return reponse;
    });

    const all: Compte[] = ['owner', ...ROLES, 'ownerS', 'analystS', 'ownerB'];
    for (const c of all) emails[c] = `commandes-${c}-${tag}@lalanda-test.local`;
    const compte = (c: Compte) => ({
      email: emails[c],
      password: MOT_DE_PASSE,
      name: `Achats ${c}`,
    });
    const orgDe = async (c: Compte) => {
      cookies[c] = await registerAndLogin(app, compte(c));
      const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
      return (orgs.body.organizations as { id: string }[])[0]!.id;
    };
    const inviter = async (org: string, owner: Compte, c: Compte, role: string) => {
      const inv = await request(server())
        .post(`/organizations/${org}/invitations`)
        .set('Cookie', cookies[owner])
        .send({ email: emails[c], role });
      expect(inv.status, `invitation ${c} ${JSON.stringify(inv.body)}`).toBe(201);
      cookies[c] = await registerAndLogin(app, compte(c));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[c])
        .send({ token: inv.body.token });
      expect(acc.status).toBe(201);
    };
    orgN = await orgDe('owner');
    for (const role of ROLES) await inviter(orgN, 'owner', role, role);
    orgS = await orgDe('ownerS');
    await inviter(orgS, 'ownerS', 'analystS', 'analyst');
    orgB = await orgDe('ownerB');
    for (const m of await db.collection('memberships').find({}).toArray()) {
      const org = m['organizationId'] as string;
      const role = m['role'] as string;
      const who: Compte | undefined =
        org === orgN
          ? (role as Role)
          : org === orgS
            ? role === 'owner'
              ? 'ownerS'
              : 'analystS'
            : org === orgB
              ? 'ownerB'
              : undefined;
      if (who) userIds[who] = m['userId'] as string;
    }

    const f = (c: Compte, body: Record<string, unknown>) =>
      post(c, '/purchases/suppliers', body).then((r) => ok(r, 201)['supplier']['id'] as string);
    supplierN = await f('owner', {
      name: 'Socimex SARL',
      nif: `N${tag.toUpperCase()}01`,
      address: '12, avenue du Commerce, Gombe, Kinshasa',
      email: `contact-${tag}@fournisseur.test`,
      defaultCategory: 'achats',
      paymentTerms: { kind: 'end_of_month', days: 30 },
      contacts: [{ name: 'Mme Kabila', email: CONTACT, isPrimary: true }],
    });
    // Coordonnées bancaires : elles ne doivent JAMAIS figurer sur le bon de commande.
    ok(
      await post('owner', `/purchases/suppliers/${supplierN}/payment-methods`, {
        kind: 'bank',
        label: 'Compte principal',
        details: { bankName: 'Rawbank', accountHolder: 'Socimex', accountNumber: COMPTE_BANCAIRE },
        expectedRevision: 1,
      }),
      201,
    );
    supplierS = await f('ownerS', { name: 'Fournisseur S' });
    supplierB = await f('ownerB', { name: 'Fournisseur B' });
    projetN = ok(
      await post('owner', '/work/projects', { name: `Projet N ${tag}`, kind: 'internal' }),
      201,
    )['id'];
    projetB = ok(
      await post('ownerB', '/work/projects', { name: `Projet B ${tag}`, kind: 'internal' }),
      201,
    )['id'];
  }, 300_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, 60_000);

  // ── Critère 1 : permissions ─────────────────────────────────────────────────

  describe('permissions (critère 1)', () => {
    it('un analyste crée et soumet, mais n’approuve pas', async () => {
      const o = await soumise('analyst');
      expect(o).toMatchObject({ status: 'submitted', requestedBy: userIds['analyst'] });
      expect(o['requestNumber']).toMatch(NUMERO);
      const r = await approuver('analyst', o);
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ code: 'FORBIDDEN', action: 'purchase.approve' });
    });

    it('administrateur et comptable : 403 sur approve ; lecteur : lecture seule', async () => {
      const o = await soumise('analyst');
      expect((await approuver('admin', o)).status).toBe(403);
      expect((await approuver('accountant', o)).status).toBe(403);
      ok(await get('viewer', `/purchases/orders/${o['id']}`));
      ok(await get('viewer', '/purchases/orders'));
      expect((await post('viewer', '/purchases/orders', { title: 'x' })).status).toBe(403);
      expect((await post('viewer', `/purchases/orders/${o['id']}/cancel`, {})).status).toBe(403);
      expect((await get('viewer', `/purchases/orders/${o['id']}/email`)).status).toBe(403);
    });

    it('commercial et conseiller : 403 sur la liste', async () => {
      expect((await get('sales_rep', '/purchases/orders')).status).toBe(403);
      expect((await get('advisor', '/purchases/orders')).status).toBe(403);
      expect((await get('sales_rep', '/purchases/settings')).status).toBe(403);
    });

    it('`purchase.request` couvre SA demande en brouillon ; le reste exige `purchase.manage`', async () => {
      const d = await demande('analyst');
      const autre = await demande('admin');
      const r = await put('analyst', `/purchases/orders/${autre['id']}`, {
        title: 'Détournée',
        currency: 'USD',
        lines: [ligne()],
        expectedRevision: 1,
      });
      expect(r.status).toBe(403);
      expect(r.body.action).toBe('purchase.manage');
      expect((await del('analyst', `/purchases/orders/${autre['id']}`)).status).toBe(403);
      // Sa propre demande soumise : seul `purchase.manage` la modifie.
      const s = ok(
        await post('analyst', `/purchases/orders/${d['id']}/submit`, { expectedRevision: 1 }),
      );
      expect(
        (
          await put('analyst', `/purchases/orders/${d['id']}`, {
            title: 'Modifiée',
            currency: 'USD',
            supplierId: supplierN,
            lines: [ligne()],
            expectedRevision: s['revision'],
          })
        ).status,
      ).toBe(403);
      // Demander pour un autre membre : `purchase.manage` seulement.
      expect(
        (
          await post('analyst', '/purchases/orders', {
            title: 'Pour un autre',
            currency: 'USD',
            lines: [ligne()],
            requestedBy: userIds['viewer'],
          })
        ).status,
      ).toBe(403);
      // L'administrateur le peut, pour un membre qui détient `purchase.request`…
      const pour = ok(
        await post('admin', '/purchases/orders', {
          title: 'Pour l’analyste',
          currency: 'USD',
          lines: [ligne()],
          requestedBy: userIds['analyst'],
        }),
        201,
      );
      expect(pour).toMatchObject({ requestedBy: userIds['analyst'], createdBy: userIds['admin'] });
      // … pas pour un lecteur (sans `purchase.request`).
      code(
        await post('admin', '/purchases/orders', {
          title: 'Pour le lecteur',
          currency: 'USD',
          lines: [ligne()],
          requestedBy: userIds['viewer'],
        }),
        400,
        'PURCHASE_ORDER_REQUESTER_INELIGIBLE',
      );
    });
  });

  // ── Cycle complet, totaux du moteur, notifications, « Mes tâches » ────────

  describe('cycle demande → bon de commande', () => {
    it('brouillon, soumission (DA), approbation (BC), envoi manuel, clôture interdite', async () => {
      const d = await demande('analyst', {
        lines: [
          ligne({ quantity: '3', unitPrice: '10.01', discountPercent: '10' }),
          ligne({ label: 'Installation', kind: 'service', quantity: '1', unitPrice: '50.00' }),
        ],
        declaredTaxes: [{ label: 'TVA 16 %', amount: '12.32' }],
        justification: 'Rentrée',
      });
      // Totaux du moteur : 3 × 10,01 × 0,9 = 27,027 → 27,03 ; + 50,00 ; taxes déclarées.
      expect(d).toMatchObject({
        phase: 'request',
        status: 'draft',
        requestNumber: null,
        requiredApprovals: null,
        totals: { subtotal: '77.03', taxes: '12.32', total: '89.35' },
        supplierName: 'Socimex SARL',
      });
      expect(d['lines'][0]).toMatchObject({
        amount: '27.03',
        receivable: true,
        category: 'achats',
      });
      expect(d['lines'][1]).toMatchObject({ amount: '50.00', receivable: false });

      const s = ok(
        await post('analyst', `/purchases/orders/${d['id']}/submit`, { expectedRevision: 1 }),
      );
      expect(s).toMatchObject({ status: 'submitted', requiredApprovals: 1, orderNumber: null });
      expect(s['requestNumber']).toMatch(/^DA\d{4}-\d{6}$/);

      // Approbateurs éligibles notifiés, pas le demandeur.
      const notes = await notifications(d['id']);
      const destinataires = notes
        .filter((n) => n['kind'] === 'purchases.approval_requested')
        .map((n) => n['recipientUserId'])
        .sort();
      expect(destinataires).toEqual([userIds['owner'], userIds['finance_director']].sort());

      // « Mes tâches » : chez le Directeur financier, pas chez le demandeur.
      const fd = await mesTaches('finance_director');
      expect(fd.find((e) => e.orderId === d['id'])).toMatchObject({
        source: 'purchases',
        id: `purchases:${d['id']}`,
        kindLabel: 'Approbation',
        total: '89.35',
        currency: 'USD',
        href: `/achats/commandes/${d['id']}`,
      });
      expect((await mesTaches('analyst')).some((e) => e.orderId === d['id'])).toBe(false);
      const pending = ok(await get('finance_director', '/purchases/approvals/pending'));
      expect(pending['items'].map((o: { id: string }) => o.id)).toContain(d['id']);

      const a = ok(await approuver('finance_director', s, 'D’accord'));
      expect(a).toMatchObject({
        phase: 'order',
        status: 'approved',
        approvedTotal: '89.35',
        requestNumber: s['requestNumber'],
      });
      expect(a['orderNumber']).toMatch(/^BC\d{4}-\d{6}$/);
      expect(a['approvals']).toEqual([
        expect.objectContaining({
          userId: userIds['finance_director'],
          decision: 'approved',
          comment: 'D’accord',
          soleApprover: false,
        }),
      ]);
      // Approuvée : elle disparaît de « Mes tâches » ; le demandeur est notifié.
      expect((await mesTaches('finance_director')).some((e) => e.orderId === d['id'])).toBe(false);
      expect(
        (await notifications(d['id'])).some(
          (n) =>
            n['kind'] === 'purchases.request_approved' &&
            n['recipientUserId'] === userIds['analyst'],
        ),
      ).toBe(true);

      const sent = ok(
        await post('admin', `/purchases/orders/${d['id']}/mark-sent`, {
          expectedRevision: a['revision'],
        }),
      );
      expect(sent).toMatchObject({ status: 'sent', sentVia: 'manual' });
      code(
        await post('admin', `/purchases/orders/${d['id']}/close`, {
          expectedRevision: sent['revision'],
        }),
        409,
        'PURCHASE_ORDER_STATUS',
      );
      const actions = (await audits(d['id'])).map((e) => e['action']);
      expect(actions).toEqual(
        expect.arrayContaining([
          'purchase_order.created',
          'purchase_order.submitted',
          'purchase_order.approved',
          'purchase_order.sent',
        ]),
      );
    });

    it('refus motivé : clos, le demandeur notifié ; dupliquer pour resoumettre', async () => {
      const s = await soumise('analyst');
      code(
        await post('owner', `/purchases/orders/${s['id']}/reject`, {
          expectedRevision: s['revision'],
        }),
        400,
        'INVALID_REQUEST',
      );
      const r = ok(
        await post('owner', `/purchases/orders/${s['id']}/reject`, {
          comment: 'Trop cher',
          expectedRevision: s['revision'],
        }),
      );
      expect(r).toMatchObject({ status: 'rejected', phase: 'request', orderNumber: null });
      expect(r['approvals'][0]).toMatchObject({ decision: 'rejected', comment: 'Trop cher' });
      code(await approuver('finance_director', r), 409, 'PURCHASE_ORDER_STATUS');
      expect(
        (await notifications(s['id'])).some((n) => n['kind'] === 'purchases.request_rejected'),
      ).toBe(true);
      const copie = ok(await post('analyst', `/purchases/orders/${s['id']}/duplicate`), 201);
      expect(copie).toMatchObject({
        status: 'draft',
        requestNumber: null,
        title: s['title'],
        supplierId: supplierN,
        totals: s['totals'],
        requestedBy: userIds['analyst'],
      });
      expect(copie['id']).not.toBe(s['id']);
    });

    it('annulation motivée ; brouillon supprimé ; écriture concurrente refusée', async () => {
      const s = await soumise('analyst');
      code(
        await post('admin', `/purchases/orders/${s['id']}/cancel`, {
          expectedRevision: s['revision'],
        }),
        400,
        'INVALID_REQUEST',
      );
      code(
        await post('admin', `/purchases/orders/${s['id']}/cancel`, {
          reason: 'Plus utile',
          expectedRevision: s['revision'] - 1,
        }),
        409,
        'STALE_REVISION',
      );
      const c = ok(
        await post('admin', `/purchases/orders/${s['id']}/cancel`, {
          reason: 'Plus utile',
          expectedRevision: s['revision'],
        }),
      );
      expect(c).toMatchObject({ status: 'cancelled', cancellation: { reason: 'Plus utile' } });
      code(
        await post('admin', `/purchases/orders/${s['id']}/cancel`, {
          reason: 'Encore',
          expectedRevision: c['revision'],
        }),
        409,
        'PURCHASE_ORDER_STATUS',
      );
      // Une demande annulée sort aussi de « Mes tâches ».
      expect((await mesTaches('finance_director')).some((e) => e.orderId === s['id'])).toBe(false);

      const d = await demande('analyst');
      expect((await del('analyst', `/purchases/orders/${d['id']}`)).status).toBe(204);
      code(await get('analyst', `/purchases/orders/${d['id']}`), 404, 'PURCHASE_ORDER_NOT_FOUND');
      code(await del('analyst', `/purchases/orders/${s['id']}`), 409, 'PURCHASE_ORDER_STATUS');
    });

    it('une facture validée qui vise la commande empêche l’annulation', async () => {
      const s = await soumise('analyst');
      const a = ok(await approuver('owner', s));
      await db.collection('supplier_invoices').insertOne({
        organizationId: orgN,
        orderIds: [a['id']],
        status: 'validated',
      });
      code(
        await post('admin', `/purchases/orders/${a['id']}/cancel`, {
          reason: 'Trop tard',
          expectedRevision: a['revision'],
        }),
        409,
        'PURCHASE_ORDER_INVOICED',
      );
    });

    it('soumission : fournisseur requis, actif ; projet de l’organisation non archivé', async () => {
      const d = await demande('analyst', { supplierId: null });
      code(
        await post('analyst', `/purchases/orders/${d['id']}/submit`, { expectedRevision: 1 }),
        409,
        'PURCHASE_ORDER_SUPPLIER_REQUIRED',
      );
      const archive = ok(
        await post('owner', '/purchases/suppliers', { name: `Archivé ${tag}` }),
        201,
      )['supplier'];
      ok(
        await post('owner', `/purchases/suppliers/${archive['id']}/archive`, {
          expectedRevision: archive['revision'],
        }),
      );
      code(
        await post('analyst', '/purchases/orders', {
          title: 'x',
          currency: 'USD',
          supplierId: archive['id'],
          lines: [ligne()],
        }),
        409,
        'PURCHASE_ORDER_SUPPLIER_INACTIVE',
      );
      const avecProjet = await demande('analyst', { lines: [ligne({ workProjectId: projetN })] });
      expect(avecProjet['lines'][0]['workProjectId']).toBe(projetN);
      const liste = ok(await get('viewer', `/purchases/orders?workProjectId=${projetN}`));
      expect(liste['items'].map((o: { id: string }) => o.id)).toContain(avecProjet['id']);
      code(
        await post('analyst', '/purchases/orders', {
          title: 'x',
          currency: 'USD',
          lines: [ligne({ category: 'inconnue' })],
        }),
        400,
        'INVALID_REQUEST',
      );
    });

    it('liste : filtres et curseur', async () => {
      const mine = ok(await get('analyst', '/purchases/orders?requestedBy=me&limit=2'));
      expect(mine['items']).toHaveLength(2);
      expect(
        mine['items'].every((o: { requestedBy: string }) => o.requestedBy === userIds['analyst']),
      ).toBe(true);
      expect(mine['nextCursor']).toEqual(expect.any(String));
      const suite = ok(
        await get(
          'analyst',
          `/purchases/orders?requestedBy=me&limit=2&cursor=${mine['nextCursor']}`,
        ),
      );
      expect(suite['items'][0]['id']).not.toBe(mine['items'][0]['id']);
      code(await get('analyst', '/purchases/orders?cursor=%21%21'), 400, 'INVALID_CURSOR');
      const orders = ok(await get('viewer', '/purchases/orders?phase=order'));
      expect(orders['items'].every((o: { phase: string }) => o.phase === 'order')).toBe(true);
    });
  });

  // ── Critère 2 : séparation des tâches ───────────────────────────────────────

  describe('séparation des tâches (critère 2)', () => {
    it('le Propriétaire qui demande n’approuve pas ; le Directeur financier le peut', async () => {
      const s = await soumise('owner');
      code(await approuver('owner', s), 409, 'SELF_APPROVAL_FORBIDDEN');
      // Ni dans « Mes tâches », ni dans les approbations en attente du demandeur.
      expect((await mesTaches('owner')).some((e) => e.orderId === s['id'])).toBe(false);
      const p = ok(await get('owner', '/purchases/approvals/pending'));
      expect(p['items'].some((o: { id: string }) => o.id === s['id'])).toBe(false);
      ok(await approuver('finance_director', s));
    });

    it('le créateur (pour un autre demandeur) n’approuve pas non plus', async () => {
      const d = ok(
        await post('finance_director', '/purchases/orders', {
          title: 'Créée pour l’analyste',
          currency: 'USD',
          supplierId: supplierN,
          lines: [ligne()],
          requestedBy: userIds['analyst'],
        }),
        201,
      );
      const s = ok(
        await post('finance_director', `/purchases/orders/${d['id']}/submit`, {
          expectedRevision: 1,
        }),
      );
      code(await approuver('finance_director', s), 409, 'SELF_APPROVAL_FORBIDDEN');
      ok(await approuver('owner', s));
    });

    it('palier à deux : deux personnes distinctes', async () => {
      await reglerPaliers('owner', [
        { from: '0', approvals: 1 },
        { from: '1000', approvals: 2 },
      ]);
      try {
        const s = await soumise('analyst', { lines: [ligne({ quantity: '200' })] });
        expect(s).toMatchObject({ requiredApprovals: 2, totals: { total: '1000.00' } });
        const un = ok(await approuver('owner', s));
        expect(un).toMatchObject({ status: 'submitted', phase: 'request', orderNumber: null });
        code(await approuver('owner', un), 409, 'APPROVER_ALREADY_APPROVED');
        // Déjà approuvée par lui : elle sort de SES tâches, reste dans celles de l'autre.
        expect((await mesTaches('owner')).some((e) => e.orderId === s['id'])).toBe(false);
        expect((await mesTaches('finance_director')).some((e) => e.orderId === s['id'])).toBe(true);
        const deux = ok(await approuver('finance_director', un));
        expect(deux).toMatchObject({ status: 'approved', phase: 'order' });
        expect(deux['approvals']).toHaveLength(2);
      } finally {
        await reglerPaliers('owner', [{ from: '0', approvals: 1 }]);
      }
    });
  });

  // ── Approbateur unique ──────────────────────────────────────────────────────

  describe('approbateur unique (§ 2.3)', () => {
    it('il approuve sa propre demande, marquée `soleApprover`, palier réduit à 1, audité', async () => {
      await reglerPaliers('ownerS', [
        { from: '0', approvals: 1 },
        { from: '100', approvals: 2 },
      ]);
      const s = await soumise('ownerS');
      expect(s['requiredApprovals']).toBe(1);
      // Visible dans SES tâches : il est le seul à pouvoir approuver.
      expect((await mesTaches('ownerS')).some((e) => e.orderId === s['id'])).toBe(true);
      const a = ok(await approuver('ownerS', s));
      expect(a).toMatchObject({ status: 'approved', phase: 'order' });
      expect(a['approvals'][0]).toMatchObject({ userId: userIds['ownerS'], soleApprover: true });

      // Palier à deux : réduit à une approbation, marquée.
      const big = await soumise('analystS', { lines: [ligne({ quantity: '100' })] });
      expect(big['requiredApprovals']).toBe(2);
      const b = ok(await approuver('ownerS', big));
      expect(b).toMatchObject({ status: 'approved' });
      expect(b['approvals'][0]['soleApprover']).toBe(true);
      const audit = (await audits(b['id'])).find((e) => e['action'] === 'purchase_order.approved');
      expect(audit?.['metadata']).toMatchObject({
        soleApprover: true,
        requiredApprovals: 2,
        effectiveRequired: 1,
        complete: true,
      });
    });

    it('échappatoire coupée par le réglage : l’auto-approbation est refusée', async () => {
      const s0 = ok(await get('ownerS', '/purchases/settings'));
      ok(
        await put('ownerS', '/purchases/settings', {
          allowSoleApprover: false,
          expectedRevision: s0['revision'],
        }),
      );
      try {
        const s = await soumise('ownerS');
        code(await approuver('ownerS', s), 409, 'SELF_APPROVAL_FORBIDDEN');
      } finally {
        const s1 = ok(await get('ownerS', '/purchases/settings'));
        ok(
          await put('ownerS', '/purchases/settings', {
            allowSoleApprover: true,
            expectedRevision: s1['revision'],
          }),
        );
      }
    });
  });

  // ── Critère 3 : paliers par devise ──────────────────────────────────────────

  describe('paliers (critère 3)', () => {
    it('USD [0 → 0, 500 → 1, 5000 → 2] ; le CDF suit ses propres paliers', async () => {
      await reglerPaliers(
        'owner',
        [
          { from: '0', approvals: 0 },
          { from: '500', approvals: 1 },
          { from: '5000', approvals: 2 },
        ],
        [{ from: '0', approvals: 1 }],
      );
      try {
        const petit = await soumise('analyst', {
          lines: [ligne({ quantity: '1', unitPrice: '499.99' })],
        });
        expect(petit).toMatchObject({
          status: 'approved',
          phase: 'order',
          requiredApprovals: 0,
          approvals: [],
          approvedTotal: '499.99',
        });
        expect(petit['orderNumber']).toMatch(/^BC/);
        const auto = (await audits(petit['id'])).find(
          (e) => e['action'] === 'purchase_order.approved',
        );
        expect(auto?.['metadata']).toMatchObject({ autoApproved: true });

        const moyen = await soumise('analyst', {
          lines: [ligne({ quantity: '1', unitPrice: '500.00' })],
        });
        expect(moyen).toMatchObject({ status: 'submitted', requiredApprovals: 1 });
        const grand = await soumise('analyst', {
          lines: [ligne({ quantity: '1', unitPrice: '5000.00' })],
        });
        expect(grand).toMatchObject({ status: 'submitted', requiredApprovals: 2 });
        const cdf = await soumise('analyst', {
          currency: 'CDF',
          lines: [ligne({ quantity: '1', unitPrice: '100.00' })],
        });
        expect(cdf).toMatchObject({ status: 'submitted', requiredApprovals: 1 });
      } finally {
        await reglerPaliers('owner', [{ from: '0', approvals: 1 }]);
      }
    });

    it('réglages : lecture par défaut, écriture réservée à manage + approve, paliers vérifiés', async () => {
      const s = ok(await get('viewer', '/purchases/settings'));
      expect(s).toMatchObject({
        allowSoleApprover: true,
        dueSoonDays: 7,
        requireOrderForInvoice: false,
      });
      expect(s['approvalTiers']['CDF'][0]).toMatchObject({ approvals: 1 });
      const r = await put('admin', '/purchases/settings', {
        dueSoonDays: 10,
        expectedRevision: s['revision'],
      });
      expect(r.status).toBe(403);
      expect(r.body.action).toBe('purchase.approve');
      expect(
        (
          await put('finance_director', '/purchases/settings', {
            dueSoonDays: 10,
            expectedRevision: 0,
          })
        ).status,
      ).toBe(409);
      code(
        await put('owner', '/purchases/settings', {
          approvalTiers: {
            CDF: [{ from: '10', approvals: 1 }],
            USD: [
              { from: '0', approvals: 1 },
              { from: '0', approvals: 2 },
            ],
          },
          expectedRevision: s['revision'],
        }),
        400,
        'INVALID_REQUEST',
      );
      const audit = await db
        .collection('audit_events')
        .findOne({ organizationId: orgN, action: 'purchase_settings.updated' });
      expect(audit).not.toBeNull();
    });
  });

  // ── Critère 4 : modification après approbation ──────────────────────────────

  describe('modification après approbation (critère 4)', () => {
    it('efface les approbations et remet à `submitted` ; une commande envoyée : 409', async () => {
      const s = await soumise('analyst');
      const a = ok(await approuver('owner', s));
      const corps = (rev: number, over: Record<string, unknown> = {}) => ({
        title: a['title'],
        currency: 'USD',
        supplierId: supplierN,
        lines: [{ ...ligne({ quantity: '12' }), id: a['lines'][0]['id'] }],
        expectedRevision: rev,
        ...over,
      });
      code(
        await put(
          'admin',
          `/purchases/orders/${a['id']}`,
          corps(a['revision'], { currency: 'CDF' }),
        ),
        409,
        'PURCHASE_ORDER_CURRENCY_LOCKED',
      );
      const m = ok(await put('admin', `/purchases/orders/${a['id']}`, corps(a['revision'])));
      expect(m).toMatchObject({
        status: 'submitted',
        phase: 'request',
        approvals: [],
        approvedTotal: null,
        requiredApprovals: 1,
        totals: { total: '60.00' },
        orderNumber: a['orderNumber'],
        requestNumber: a['requestNumber'],
      });
      // Identifiant de ligne conservé (les réceptions et factures s'y rattachent).
      expect(m['lines'][0]['id']).toBe(a['lines'][0]['id']);
      // De retour dans « Mes tâches » des approbateurs.
      expect((await mesTaches('finance_director')).some((e) => e.orderId === a['id'])).toBe(true);
      const audit = (await audits(a['id'])).find((e) => e['action'] === 'purchase_order.updated');
      expect(audit?.['metadata']).toMatchObject({ approvalsCleared: 1, status: 'submitted' });

      const re = ok(await approuver('finance_director', m));
      // Réapprouvée : même numéro de bon de commande, pas de trou inutile.
      expect(re['orderNumber']).toBe(a['orderNumber']);
      const sent = ok(
        await post('admin', `/purchases/orders/${a['id']}/mark-sent`, {
          expectedRevision: re['revision'],
        }),
      );
      code(
        await put('admin', `/purchases/orders/${a['id']}`, corps(sent['revision'])),
        409,
        'PURCHASE_ORDER_NOT_EDITABLE',
      );
    });
  });

  // ── Critère 5 : numérotation ────────────────────────────────────────────────

  describe('numérotation (critère 5)', () => {
    it('DA à la soumission, BC à l’approbation complète, compteurs annuels, trous admis', async () => {
      const un = await soumise('analyst');
      // Un brouillon supprimé ne consomme aucun numéro ; une demande annulée garde le sien.
      const brouillon = await demande('analyst');
      expect((await del('analyst', `/purchases/orders/${brouillon['id']}`)).status).toBe(204);
      const deux = await soumise('analyst');
      const n = (s: string) => Number(s.slice(-6));
      expect(n(deux['requestNumber'])).toBe(n(un['requestNumber']) + 1);
      expect(deux['requestNumber'].slice(0, 6)).toBe(un['requestNumber'].slice(0, 6));
      const a = ok(await approuver('owner', un));
      const b = ok(await approuver('owner', deux));
      expect(n(b['orderNumber'])).toBe(n(a['orderNumber']) + 1);
      const counters = await db
        .collection('purchase_counters')
        .find({ organizationId: orgN })
        .toArray();
      expect(counters.map((c) => c['kind']).sort()).toEqual(['order', 'request']);
      expect(counters.every((c) => Number.isInteger(c['year']))).toBe(true);
      // Organisation S : ses propres compteurs.
      const s = await soumise('analystS');
      expect(n(s['requestNumber'])).toBeLessThan(n(un['requestNumber']));
    });
  });

  // ── Critère 6 : PDF et envoi ────────────────────────────────────────────────

  describe('bon de commande PDF et envoi (critère 6)', () => {
    async function commande() {
      const s = await soumise('analyst', {
        declaredTaxes: [{ label: 'TVA', amount: '8.00' }],
        deliveryAddress: 'Entrepôt de Limete',
        expectedOn: '2030-01-15',
      });
      return ok(await approuver('owner', s));
    }

    it('PDF : mention fixe, aucun QR ni coordonnée bancaire ; pas de PDF pour une demande', async () => {
      const s = await soumise('analyst');
      code(await get('viewer', `/purchases/orders/${s['id']}/pdf`), 409, 'DOCUMENT_NOT_PRINTABLE');
      const a = await commande();
      const res = await get('viewer', `/purchases/orders/${a['id']}/pdf`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain(`${a['orderNumber']}.pdf`);
      const html = (res.body as Buffer).toString('utf8');
      expect(html.startsWith('%PDF-FAKE')).toBe(true);
      expect(html).toContain('Bon de commande — ce document n’est pas une facture');
      expect(html).toContain(a['orderNumber']);
      expect(html).toContain('Socimex SARL');
      expect(html).toContain('Entrepôt de Limete');
      expect(html).toContain('fin de mois + 30 jours');
      expect(html).not.toContain(COMPTE_BANCAIRE);
      expect(html).not.toContain('Rawbank');
      expect(html.toLowerCase()).not.toContain('<svg');
      const audit = (await audits(a['id'])).find(
        (e) => e['action'] === 'purchase_order.pdf_exported',
      );
      expect(audit?.['metadata']).toMatchObject({ orderNumber: a['orderNumber'] });
    });

    it('envoi : brouillon prérempli, audit strict avant, transport de test, passe à `sent`', async () => {
      const a = await commande();
      const draft = ok(await get('admin', `/purchases/orders/${a['id']}/email`));
      expect(draft).toMatchObject({
        sendable: true,
        nature: 'purchase_order',
        to: CONTACT,
        attachmentName: `${a['orderNumber']}.pdf`,
      });
      expect(draft['subject']).toContain(`Bon de commande ${a['orderNumber']}`);
      const avant = envoyes.length;
      const r = ok(
        await post('admin', `/purchases/orders/${a['id']}/email`, {
          to: CONTACT,
          cc: [],
          subject: draft['subject'],
          message: draft['message'],
        }),
      );
      expect(r).toMatchObject({ delivered: true, to: CONTACT });
      expect(envoyes.length).toBe(avant + 1);
      const m = envoyes[envoyes.length - 1]!;
      expect(m.to).toBe(CONTACT);
      expect(m.attachments?.[0]).toMatchObject({
        filename: `${a['orderNumber']}.pdf`,
        contentType: 'application/pdf',
      });
      expect(m.text ?? '').toContain('ce document n’est pas une facture');
      const actions = (await audits(a['id'])).map((e) => e['action']);
      const i = actions.indexOf('purchase_order.email_requested');
      expect(i).toBeGreaterThanOrEqual(0);
      expect(actions.indexOf('purchase_order.emailed')).toBeGreaterThan(i);
      const apres = ok(await get('viewer', `/purchases/orders/${a['id']}`));
      expect(apres).toMatchObject({ status: 'sent', sentVia: 'email' });
      // Déjà envoyée : renvoyable, reste `sent`.
      ok(
        await post('admin', `/purchases/orders/${a['id']}/email`, {
          to: CONTACT,
          cc: [],
          subject: 'Relance',
          message: 'Bonjour',
        }),
      );
    });

    it('échec de l’audit strict : rien ne part, la commande reste `approved`', async () => {
      const a = await commande();
      const audit = app.get(AuditService);
      const spy = vi.spyOn(audit, 'recordStrict').mockImplementationOnce(async () => {
        throw new Error('journal indisponible');
      });
      const avant = envoyes.length;
      try {
        const r = await post('admin', `/purchases/orders/${a['id']}/email`, {
          to: CONTACT,
          cc: [],
          subject: 'Bon de commande',
          message: 'Bonjour',
        });
        expect(r.status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      expect(envoyes.length).toBe(avant);
      expect(ok(await get('viewer', `/purchases/orders/${a['id']}`))['status']).toBe('approved');
    });

    it('transport en échec : non délivré, la commande n’est pas marquée envoyée', async () => {
      const a = await commande();
      reponse = { delivered: false, reason: 'ZEPTOMAIL_ERROR' };
      try {
        const r = ok(
          await post('admin', `/purchases/orders/${a['id']}/email`, {
            to: CONTACT,
            cc: [],
            subject: 'Bon de commande',
            message: 'Bonjour',
          }),
        );
        expect(r).toMatchObject({ delivered: false, reason: 'ZEPTOMAIL_ERROR' });
      } finally {
        reponse = { delivered: true };
      }
      expect(ok(await get('viewer', `/purchases/orders/${a['id']}`))['status']).toBe('approved');
    });

    it('une demande ou une commande annulée ne part pas : 409 DOCUMENT_NOT_SENDABLE', async () => {
      const s = await soumise('analyst');
      const d = ok(await get('admin', `/purchases/orders/${s['id']}/email`));
      expect(d).toMatchObject({ sendable: false, nature: null });
      code(
        await post('admin', `/purchases/orders/${s['id']}/email`, {
          to: CONTACT,
          cc: [],
          subject: 'x',
          message: 'y',
        }),
        409,
        'DOCUMENT_NOT_SENDABLE',
      );
      const a = await commande();
      const c = ok(
        await post('admin', `/purchases/orders/${a['id']}/cancel`, {
          reason: 'Erreur',
          expectedRevision: a['revision'],
        }),
      );
      code(
        await post('admin', `/purchases/orders/${c['id']}/email`, {
          to: CONTACT,
          cc: [],
          subject: 'x',
          message: 'y',
        }),
        409,
        'DOCUMENT_NOT_SENDABLE',
      );
    });

    it('le 21e envoi d’un utilisateur dans l’heure : 429 DOCUMENT_EMAIL_RATE_LIMITED', async () => {
      const a = await commande();
      const envoi = () =>
        post('owner', `/purchases/orders/${a['id']}/email`, {
          to: CONTACT,
          cc: [],
          subject: 'Bon de commande',
          message: 'Bonjour',
        });
      for (let i = 0; i < DOCUMENT_EMAIL_USER_THROTTLE.limit; i++) ok(await envoi());
      code(await envoi(), 429, 'DOCUMENT_EMAIL_RATE_LIMITED');
    });
  });

  // ── Critère 17 : isolation ──────────────────────────────────────────────────

  describe('isolation (critère 17)', () => {
    it('toute route rend 404 pour une demande d’une autre organisation', async () => {
      const s = await soumise('analyst');
      const id = s['id'] as string;
      code(await get('ownerB', `/purchases/orders/${id}`), 404, 'PURCHASE_ORDER_NOT_FOUND');
      code(await approuver('ownerB', s), 404, 'PURCHASE_ORDER_NOT_FOUND');
      code(
        await post('ownerB', `/purchases/orders/${id}/reject`, {
          comment: 'x',
          expectedRevision: s['revision'],
        }),
        404,
        'PURCHASE_ORDER_NOT_FOUND',
      );
      code(
        await post('ownerB', `/purchases/orders/${id}/duplicate`),
        404,
        'PURCHASE_ORDER_NOT_FOUND',
      );
      code(
        await post('ownerB', `/purchases/orders/${id}/cancel`, {
          reason: 'x',
          expectedRevision: s['revision'],
        }),
        404,
        'PURCHASE_ORDER_NOT_FOUND',
      );
      code(await get('ownerB', `/purchases/orders/${id}/pdf`), 404, 'PURCHASE_ORDER_NOT_FOUND');
      code(await get('ownerB', `/purchases/orders/${id}/email`), 404, 'PURCHASE_ORDER_NOT_FOUND');
      code(
        await put('ownerB', `/purchases/orders/${id}`, {
          title: 'x',
          currency: 'USD',
          lines: [ligne()],
          expectedRevision: s['revision'],
        }),
        404,
        'PURCHASE_ORDER_NOT_FOUND',
      );
      expect((await del('ownerB', `/purchases/orders/${id}`)).status).toBe(404);
      const listeB = ok(await get('ownerB', '/purchases/orders'));
      expect(listeB['items'].some((o: { id: string }) => o.id === id)).toBe(false);
      expect(
        ok(await get('ownerB', '/purchases/approvals/pending'))['items'].some(
          (o: { id: string }) => o.id === id,
        ),
      ).toBe(false);
      expect((await mesTaches('ownerB')).some((e) => e.orderId === id)).toBe(false);
    });

    it('identifiants forgés dans un corps : fournisseur, projet, demandeur d’une autre organisation', async () => {
      code(
        await post('ownerB', '/purchases/orders', {
          title: 'x',
          currency: 'USD',
          supplierId: supplierN,
          lines: [ligne()],
        }),
        404,
        'SUPPLIER_NOT_FOUND',
      );
      code(
        await post('ownerB', '/purchases/orders', {
          title: 'x',
          currency: 'USD',
          lines: [ligne({ workProjectId: projetN })],
        }),
        404,
        'PURCHASE_WORK_PROJECT_UNKNOWN',
      );
      code(
        await post('owner', '/purchases/orders', {
          title: 'x',
          currency: 'USD',
          lines: [ligne({ workProjectId: projetB })],
        }),
        404,
        'PURCHASE_WORK_PROJECT_UNKNOWN',
      );
      code(
        await post('ownerB', '/purchases/orders', {
          title: 'x',
          currency: 'USD',
          lines: [ligne()],
          requestedBy: userIds['analyst'],
        }),
        400,
        'PURCHASE_ORDER_REQUESTER_INELIGIBLE',
      );
      code(await get('owner', '/purchases/orders/not-an-id'), 404, 'PURCHASE_ORDER_NOT_FOUND');
    });

    it('les réglages d’une organisation n’affectent pas l’autre', async () => {
      const b = ok(await get('ownerB', '/purchases/settings'));
      expect(b['revision']).toBe(0);
    });
  });
});
