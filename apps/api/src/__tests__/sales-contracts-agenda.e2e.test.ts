// Alertes des engagements clients : « Mes tâches » et cloche — ADR-0050, lot V6.
//
// Sur un vrai serveur et une vraie base :
//
//  · critère 15 — un Propriétaire voit « Contrat à approuver » soumis par un Commercial ;
//    le Commercial ne le voit pas ; un `accountant` voit « Brouillons d'échéance à
//    émettre » ; un retrait de `sales.invoice` par écart (ADR-0041) fait disparaître
//    l'élément ;
//  · critère 7 — contrat du 15 janv. 2027, 12 mois, préavis 30 jours, reconduction
//    tacite : élément « préavis » du responsable à partir du 15 nov. 2027, échéance
//    15 déc. 2027 ; « reconduction à constater » pour les approbateurs ;
//  · échéance bloquée (`RENEWAL_NOT_RECORDED`) pour le responsable ; acompte émis non
//    « traité » alors qu'une facture finale existe, pour `sales.manage` ;
//  · notifications in-app, sans doublon : soumis → approbateurs (pas le soumetteur),
//    approuvé → soumetteur ; préavis et fin de terme → responsable, une fois par date ;
//    brouillons prêts → détenteurs de `sales.invoice`, une fois par jour ;
//  · isolation : l'organisation B ne voit rien de A.
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

import 'reflect-metadata';

import { randomBytes } from 'node:crypto';

import { ObjectId } from 'mongodb';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import type { NotificationInput } from '../notifications/notifications.port.js';
import { SalesContractsAlertsJob } from '../sales/contracts/agenda/contracts-alerts.job.js';
import { SalesContractsNotifier } from '../sales/contracts/agenda/contracts-notifier.js';
import { SalesSubscriptionsJob } from '../sales/contracts/subscriptions/sales-subscriptions.job.js';
import { WorkTasksService } from '../work/work-tasks.service.js';
import { e2eSuite, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

const fiche = (nif: string) => ({
  legalName: 'Exemple SARL',
  tradeName: null,
  legalForm: 'sarl',
  legalFormOther: null,
  nif,
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
  email: 'facturation@exemple.cd',
});

const ligne = (name: string, quantity: string, unitPrice: string) => ({
  source: 'free',
  code: null,
  name,
  itemType: 'SER',
  taxGroup: 'B',
  outOfScope: false,
  unit: 'mois',
  quantity,
  unitPrice,
  specificTax: null,
  discount: null,
});

const PDF = Buffer.from('%PDF-1.4\n% contrat signé\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');

const SIGNATAIRES = [
  { name: 'Client Signataire', title: 'Directeur', side: 'customer' },
  { name: 'Gérant', title: null, side: 'organization' },
];

type Actor = 'owner' | 'accountant' | 'viewer' | 'ownerB' | 'rep' | 'dir';

interface Entry {
  id: string;
  source: string;
  kind?: string;
  title?: string;
  dueDate?: string | null;
  count?: number;
  href?: string;
}

type Groups = Record<'overdue' | 'today' | 'next7Days' | 'later' | 'noDate', Entry[]>;

const flat = (g: Groups): Entry[] => [
  ...g.overdue,
  ...g.today,
  ...g.next7Days,
  ...g.later,
  ...g.noDate,
];

e2eSuite('contrats — alertes dans Mes tâches et la cloche (ADR-0050, V6)', () => {
  const f = useWorkFixture('sctag');
  let customer = '';
  const extra: Record<'rep' | 'dir', string[]> = { rep: [], dir: [] };
  const ids: Record<'rep' | 'dir', string> = { rep: '', dir: '' };
  const sent: NotificationInput[] = [];

  const ok = (res: { status: number; body: unknown }, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const cookies = (who: Actor) =>
    who === 'rep' || who === 'dir' ? [...extra[who], `active_org_id=${f.orgId()}`] : f.as(who);
  const srv = () => request(f.app().getHttpServer());
  const get = (who: Actor, path: string) => srv().get(path).set('Cookie', cookies(who));
  const post = (who: Actor, path: string, body?: unknown) =>
    srv()
      .post(path)
      .set('Cookie', cookies(who))
      .send((body ?? {}) as object);
  const upload = (who: Actor, path: string) =>
    srv()
      .post(path)
      .set('Cookie', cookies(who))
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'contrat-signe.pdf')
      .send(PDF);

  /** Éléments `sales_contracts` de « Mes tâches » (route HTTP, jour réel). */
  async function mine(who: Actor): Promise<Entry[]> {
    const g = ok(await get(who, '/work/my-tasks')) as unknown as Groups;
    return flat(g).filter((e) => e.source === 'sales_contracts');
  }

  /** Même lecture, à une date fixée (le service reçoit l'instant). */
  async function mineAt(who: 'owner' | 'rep' | 'viewer' | 'dir', at: string): Promise<Entry[]> {
    const role =
      who === 'rep'
        ? 'sales_rep'
        : who === 'dir'
          ? 'finance_director'
          : (who as 'owner' | 'viewer');
    const userId = who === 'rep' || who === 'dir' ? ids[who] : f.userId(who);
    const view = await f
      .app()
      .get(WorkTasksService, { strict: false })
      .myTasks(f.orgId(), { userId, role, context: {} }, new Date(`${at}T12:00:00Z`));
    return flat(view as unknown as Groups).filter((e) => e.source === 'sales_contracts');
  }

  const corps = (more: Record<string, unknown> = {}) => ({
    title: 'Maintenance annuelle',
    startDate: '2027-01-15',
    initialTermMonths: 12,
    renewal: { mode: 'tacit', periodMonths: 12, maxRenewals: null },
    noticeDays: 30,
    billing: { kind: 'none' },
    currency: 'USD',
    priceMode: 'ht',
    customer: { customerId: customer, printContactDetails: false },
    lines: [ligne('Maintenance', '1', '500.00')],
    ...more,
  });

  async function soumis(more: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const c = ok(await post('rep', '/sales/contracts', corps(more)), 201);
    return ok(
      await post('rep', `/sales/contracts/${c.id}/submit`, { expectedRevision: c.revision }),
    );
  }

  async function signe(more: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const s = await soumis(more);
    const a = ok(
      await post('owner', `/sales/contracts/${s.id}/approve`, { expectedRevision: s.revision }),
    );
    const file = ok(await upload('rep', `/sales/contracts/${s.id}/files?kind=signed_copy`), 201);
    return ok(
      await post('rep', `/sales/contracts/${s.id}/signature`, {
        expectedRevision: a.revision,
        signedOn: '2027-01-10',
        signatories: SIGNATAIRES,
        fileId: file.id,
      }),
    );
  }

  const stored = (kind: string) =>
    f.db().collection('notifications').find({ organizationId: f.orgId(), kind }).toArray();

  async function inviter(role: 'sales_rep' | 'finance_director', key: 'rep' | 'dir', tag: string) {
    const email = `sctag-${key}-${tag}@lalanda-test.local`;
    const inv = await f.post('owner', `/organizations/${f.orgId()}/invitations`, { email, role });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    extra[key] = await registerAndLogin(f.app(), {
      email,
      password: 'Passw0rd!alertes',
      name: key === 'rep' ? 'Commercial' : 'Directeur financier',
    });
    const acc = await srv()
      .post('/invitations/accept')
      .set('Cookie', extra[key])
      .send({ token: inv.body.token });
    expect(acc.status).toBe(201);
  }

  beforeAll(async () => {
    ok(await f.put('owner', '/organizations/current/fiscal-profile', fiche('A1111111X')));
    ok(await f.put('ownerB', '/organizations/current/fiscal-profile', fiche('B2222222X')));
    await f
      .db()
      .collection('edef_reference_snapshots')
      .insertOne({
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
    const tag = randomBytes(3).toString('hex').toUpperCase();
    customer = ok(
      await f.post('owner', '/sales/customers', {
        type: 'PM',
        name: 'Client Gombe SARL',
        nif: `T${tag}01`,
      }),
      201,
    ).id;
    await inviter('sales_rep', 'rep', tag.toLowerCase());
    await inviter('finance_director', 'dir', tag.toLowerCase());
    const members = ok(await f.get('owner', `/organizations/${f.orgId()}/members`));
    for (const m of members.members as { userId: string; role: string }[]) {
      if (m.role === 'sales_rep') ids.rep = m.userId;
      if (m.role === 'finance_director') ids.dir = m.userId;
    }
    // Enregistreur autour du port réel (motif de `crm-agenda.e2e`).
    const notifier = f.app().get(SalesContractsNotifier, { strict: false });
    const inner = notifier.port;
    notifier.port = {
      notify: async (input) => {
        sent.push(input);
        await inner.notify(input);
      },
    };
  }, E2E_HOOK_TIMEOUT_MS);

  describe('contrat à approuver (critère 15)', () => {
    it('le Propriétaire et le Directeur financier le voient ; ni le Commercial, ni le Comptable, ni le Lecteur', async () => {
      sent.length = 0;
      const c = await soumis();
      const id = `sct:contract_to_approve:${c.id}`;
      for (const who of ['owner', 'dir'] as const) {
        const item = (await mine(who)).find((e) => e.id === id);
        expect(item, who).toMatchObject({
          kind: 'contract_to_approve',
          href: `/ventes/contrats/${c.id}`,
        });
        expect(item!.title).toContain(c.number);
      }
      for (const who of ['rep', 'accountant', 'viewer'] as const) {
        expect(
          (await mine(who)).some((e) => e.id === id),
          who,
        ).toBe(false);
      }
      // Notification : les approbateurs effectifs, jamais le soumetteur.
      const submitted = sent.filter((n) => n.kind === 'sales.contract_submitted');
      expect(submitted.map((n) => n.recipientUserId).sort()).toEqual(
        [f.userId('owner'), ids.dir].sort(),
      );
      expect(submitted[0]).toMatchObject({
        requiredAction: 'sales.contract.approve',
        source: { module: 'sales', entityType: 'sales_contract', entityId: c.id },
        href: `/ventes/contrats/${c.id}`,
        actorUserId: ids.rep,
      });

      // Approuvé : l'élément disparaît ; le soumetteur (responsable) est notifié.
      sent.length = 0;
      ok(await post('owner', `/sales/contracts/${c.id}/approve`, { expectedRevision: c.revision }));
      expect((await mine('owner')).some((e) => e.id === id)).toBe(false);
      expect((await mine('dir')).some((e) => e.id === id)).toBe(false);
      expect(sent.map((n) => [n.kind, n.recipientUserId])).toEqual([
        ['sales.contract_approved', ids.rep],
      ]);
      expect((await stored('sales.contract_approved')).length).toBe(1);
    });

    it('un geste refusé (403) ne notifie personne', async () => {
      const c = await soumis();
      sent.length = 0;
      const res = await post('rep', `/sales/contracts/${c.id}/approve`, {
        expectedRevision: c.revision,
      });
      expect(res.status).toBe(403);
      expect(sent).toHaveLength(0);
    });
  });

  describe('préavis, fin de terme, reconduction (critère 7)', () => {
    let contrat: Record<string, any>;

    beforeAll(async () => {
      contrat = await signe();
    }, E2E_HOOK_TIMEOUT_MS);

    it('le responsable voit le préavis à partir du 15 nov. 2027, échéance 15 déc. 2027', async () => {
      const id = `sct:notice_deadline:${contrat.id}:0`;
      expect((await mineAt('rep', '2027-11-14')).some((e) => e.id === id)).toBe(false);
      const item = (await mineAt('rep', '2027-11-15')).find((e) => e.id === id);
      expect(item).toMatchObject({ kind: 'notice_deadline', dueDate: '2027-12-15' });
      expect(item!.title).toBe(`Date limite de préavis le 15/12/2027 — contrat ${contrat.number}`);
      // Ni le Lecteur, ni un approbateur qui n'est pas responsable.
      expect((await mineAt('viewer', '2027-11-20')).some((e) => e.id === id)).toBe(false);
      expect((await mineAt('owner', '2027-11-20')).some((e) => e.id === id)).toBe(false);
    });

    it('reconduction tacite à constater : pour les approbateurs, pas pour le responsable', async () => {
      const id = `sct:renewal_to_record:${contrat.id}:1`;
      const item = (await mineAt('owner', '2027-11-20')).find((e) => e.id === id);
      expect(item).toMatchObject({ kind: 'renewal_to_record', dueDate: '2028-01-14' });
      expect((await mineAt('dir', '2027-11-20')).some((e) => e.id === id)).toBe(true);
      expect((await mineAt('rep', '2027-11-20')).some((e) => e.id === id)).toBe(false);
      for (const e of await mineAt('owner', '2027-11-20')) {
        expect(`${e.title}`.toLowerCase()).not.toMatch(
          /conforme|valable|reconduit automatiquement/,
        );
      }
    });

    it('tâche quotidienne : préavis et fin de terme notifiés au responsable, une seule fois', async () => {
      const fin = await signe({ renewal: { mode: 'none', periodMonths: null, maxRenewals: null } });
      const job = f.app().get(SalesContractsAlertsJob, { strict: false });
      const at = new Date('2027-11-20T12:00:00Z');
      const r1 = await job.run(at);
      expect(r1.failed).toBe(0);
      await job.run(at);
      await job.run(new Date('2027-11-21T12:00:00Z'));
      const notices = (await stored('sales.contract_notice_due')).filter(
        (n) => n['source']?.entityId === contrat.id,
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ recipientUserId: ids.rep });
      const terms = (await stored('sales.contract_term_ending')).filter(
        (n) => n['source']?.entityId === fin.id,
      );
      expect(terms).toHaveLength(1);
      expect(terms[0]).toMatchObject({ recipientUserId: ids.rep });
    });
  });

  describe('échéancier : brouillons à émettre et échéance bloquée', () => {
    let abonnement: Record<string, any>;

    beforeAll(async () => {
      abonnement = await signe({
        title: 'Abonnement mensuel',
        startDate: '2027-01-31',
        renewal: { mode: 'tacit', periodMonths: 12, maxRenewals: null },
        billing: {
          kind: 'recurring',
          frequency: 'monthly',
          anchorDate: '2027-01-31',
          timing: 'in_advance',
          autoPrepare: true,
        },
      });
    }, E2E_HOOK_TIMEOUT_MS);

    it('un `accountant` voit « brouillons à émettre » (agrégé) ; le Lecteur non ; notifié une fois par jour', async () => {
      sent.length = 0;
      const job = f.app().get(SalesSubscriptionsJob, { strict: false });
      const at = new Date('2027-03-31T12:00:00Z');
      expect((await job.run(at)).prepared).toBeGreaterThanOrEqual(3);
      await job.run(at);
      const item = (await mine('accountant')).find(
        (e) => e.id === 'sct:subscription_drafts_to_issue',
      );
      expect(item).toMatchObject({
        kind: 'subscription_drafts_to_issue',
        dueDate: '2027-01-31',
        href: '/ventes/factures',
      });
      expect(item!.count).toBeGreaterThanOrEqual(3);
      expect((await mine('viewer')).some((e) => e.kind === 'subscription_drafts_to_issue')).toBe(
        false,
      );
      // Cloche : détenteurs de `sales.invoice`, une notification par jour.
      const ready = await stored('sales.subscription_drafts_ready');
      const recipients = ready.map((n) => String(n['recipientUserId']));
      expect(new Set(recipients).size).toBe(recipients.length);
      expect(recipients).toEqual(
        expect.arrayContaining([f.userId('owner'), f.userId('accountant')]),
      );
      expect(recipients).not.toContain(f.userId('viewer'));
      expect(recipients).not.toContain(ids.rep);
      expect(ready.every((n) => n['requiredAction'] === 'sales.invoice')).toBe(true);
    });

    it('retrait de `sales.invoice` par écart (ADR-0041) : l’élément disparaît', async () => {
      const memberships = f.db().collection('memberships');
      // Interrupteur d'ADR-0041 (lu à chaque requête), rétabli à la fin.
      const before = process.env['MEMBER_PERMISSIONS_ENABLED'];
      process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
      await memberships.updateOne(
        { userId: f.userId('accountant'), organizationId: f.orgId() },
        { $set: { revokes: ['sales.invoice'] } },
      );
      try {
        expect(
          (await mine('accountant')).some((e) => e.kind === 'subscription_drafts_to_issue'),
        ).toBe(false);
        // Le Propriétaire, sans écart, le voit toujours.
        expect((await mine('owner')).some((e) => e.kind === 'subscription_drafts_to_issue')).toBe(
          true,
        );
      } finally {
        if (before === undefined) delete process.env['MEMBER_PERMISSIONS_ENABLED'];
        else process.env['MEMBER_PERMISSIONS_ENABLED'] = before;
        await memberships.updateOne(
          { userId: f.userId('accountant'), organizationId: f.orgId() },
          { $unset: { revokes: '' } },
        );
      }
    });

    it('échéance bloquée au-delà du terme non constaté : pour le responsable seulement', async () => {
      const id = `sct:occurrence_blocked:${abonnement.id}:2028-01-31`;
      const item = (await mineAt('rep', '2028-02-05')).find((e) => e.id === id);
      expect(item).toMatchObject({ kind: 'occurrence_blocked', dueDate: '2028-01-31' });
      expect((await mineAt('owner', '2028-02-05')).some((e) => e.id === id)).toBe(false);
    });
  });

  describe('acompte émis non « traité » (§ 5.2)', () => {
    it('visible pour `sales.manage` tant qu’une facture finale coexiste ; disparaît une fois « traité »', async () => {
      const db = f.db();
      const orgId = f.orgId();
      const orderId = new ObjectId();
      const deposit = new ObjectId();
      const final = new ObjectId();
      // Fixture minimale en base : une commande, une `FT` émise, une facture finale.
      await db.collection('sales_orders').insertOne({
        _id: orderId,
        organizationId: orgId,
        number: 'CC2701-990001',
        status: 'confirmed',
      });
      await db.collection('sales_invoices').insertMany([
        {
          _id: deposit,
          organizationId: orgId,
          type: 'FT',
          status: 'issued',
          series: 'real',
          number: 'FT-ESSAI-1',
          proformaRef: 'PF-ESSAI-1',
          currency: 'USD',
          lines: [],
          documentAmounts: { calculation: { totals: { total: '100.00' } } },
        },
        {
          _id: final,
          organizationId: orgId,
          type: 'FV',
          status: 'draft',
          number: null,
          proformaRef: 'PF-ESSAI-2',
          currency: 'USD',
          lines: [],
          documentAmounts: { calculation: { totals: { total: '500.00' } } },
        },
      ]);
      const link = (invoiceId: ObjectId, kind: string) => ({
        organizationId: orgId,
        invoiceId: String(invoiceId),
        kind,
        orderId: String(orderId),
        contractId: null,
        itemRef: null,
        occurrenceDate: null,
        lineMap: [],
        requestedAmount: null,
        linkedAt: new Date(),
        linkedBy: f.userId('owner'),
        _schemaVersion: 1,
      });
      await db
        .collection('sales_document_links')
        .insertMany([link(deposit, 'order_deposit'), link(final, 'order_invoice')]);
      const id = `sct:deposit_not_resolved:order:${String(orderId)}`;
      const item = (await mine('owner')).find((e) => e.id === id);
      expect(item).toMatchObject({
        kind: 'deposit_not_resolved',
        href: `/ventes/commandes/${String(orderId)}`,
        dueDate: null,
      });
      expect(item!.title).toContain('FT-ESSAI-1');
      expect(item!.title).toContain('CC2701-990001');
      // Le Lecteur (sans `sales.manage`) ne le voit pas.
      expect((await mine('viewer')).some((e) => e.id === id)).toBe(false);
      // « Traité » : l'élément disparaît.
      await db.collection('sales_deposit_resolutions').insertOne({
        organizationId: orgId,
        invoiceId: String(deposit),
        orderId: String(orderId),
        contractId: null,
        reason: 'Choix fait avec l’expert-comptable',
        resolvedBy: f.userId('owner'),
        resolvedAt: new Date(),
        revision: 1,
        _schemaVersion: 1,
      });
      expect((await mine('owner')).some((e) => e.id === id)).toBe(false);
    });
  });

  describe('isolation', () => {
    it('l’organisation B ne voit aucun élément de A', async () => {
      expect(await mine('ownerB')).toEqual([]);
      const view = await f
        .app()
        .get(WorkTasksService, { strict: false })
        .myTasks(
          f.orgB(),
          { userId: f.userId('ownerB'), role: 'owner', context: {} },
          new Date('2027-11-20T12:00:00Z'),
        );
      expect(flat(view as unknown as Groups).filter((e) => e.source === 'sales_contracts')).toEqual(
        [],
      );
    });
  });
});
