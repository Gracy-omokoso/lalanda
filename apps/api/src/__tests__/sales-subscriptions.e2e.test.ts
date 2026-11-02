// Échéancier et abonnements — ADR-0050, lot V5.
//
// Critères d'acceptation couverts : 8 (reconduction tacite non constatée : aucune
// échéance du terme suivant ; constatée : la tâche la prépare ; `maxRenewals` atteint),
// 9 (abonnement mensuel ancré le 31 janv. : 31 janv., 28 févr., 31 mars ; tâche rejouée
// et concurrente : un brouillon par échéance ; brouillons pro forma sans numéro fiscal),
// 10 (jamais d'émission automatique : journal et statuts), 11 (brouillon supprimé :
// l'échéance redevient « à préparer », la tâche la prépare de nouveau), 13 (raccords :
// le brouillon préparé est une facture ordinaire, identique à la même facture saisie à
// la main, émise par un humain). En plus : blocages (résiliation, avenant non signé,
// client désactivé), `autoPrepare`, échéancier à dates fixes, « Préparer maintenant »
// (permissions), isolation.
//
// Les contrats « relatifs » sont datés par rapport au jour réel de Kinshasa : la
// constatation d'une reconduction lit l'horloge (lot V3). La tâche, elle, reçoit sa
// date (`run(now)`).
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

import 'reflect-metadata';

import { randomBytes } from 'node:crypto';

import { ObjectId } from 'mongodb';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { addDays, kinshasaDay } from '../crm/crm-model.js';
import { SalesSubscriptionsJob } from '../sales/contracts/subscriptions/sales-subscriptions.job.js';
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

/** Ligne libre au groupe B. */
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

const SYSTEME = 'system:subscriptions';

type Actor = 'owner' | 'admin' | 'accountant' | 'viewer' | 'ownerB' | 'rep' | 'dir';

e2eSuite('échéancier et abonnements (ADR-0050, V5)', () => {
  const f = useWorkFixture('ssubs');
  let customer = '';
  const extra: Record<'rep' | 'dir', string[]> = { rep: [], dir: [] };
  const today = kinshasaDay(new Date());

  const ok = (res: { status: number; body: unknown }, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const code = (res: { status: number; body: any }, status: number, c: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code, JSON.stringify(res.body)).toBe(c);
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
  const job = () => f.app().get(SalesSubscriptionsJob);
  const invoices = () => f.db().collection('sales_invoices');
  const links = () => f.db().collection('sales_document_links');

  const mensuel = (anchorDate: string, autoPrepare = true) => ({
    kind: 'recurring',
    frequency: 'monthly',
    anchorDate,
    timing: 'in_advance',
    autoPrepare,
  });

  const corps = (more: Record<string, unknown> = {}) => ({
    title: 'Abonnement de maintenance',
    startDate: '2027-01-31',
    initialTermMonths: 12,
    renewal: { mode: 'none', periodMonths: null, maxRenewals: null },
    noticeDays: 30,
    billing: mensuel('2027-01-31'),
    currency: 'USD',
    priceMode: 'ht',
    customer: { customerId: customer, printContactDetails: false },
    lines: [ligne('Maintenance mensuelle', '1', '500.00')],
    ...more,
  });

  /** Préparé par le Commercial, approuvé par le Propriétaire, copie signée, signé. */
  async function contratSigne(more: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const c = ok(await post('rep', '/sales/contracts', corps(more)), 201);
    const s = ok(
      await post('rep', `/sales/contracts/${c.id}/submit`, { expectedRevision: c.revision }),
    );
    const a = ok(
      await post('owner', `/sales/contracts/${c.id}/approve`, { expectedRevision: s.revision }),
    );
    const file = ok(await upload('rep', `/sales/contracts/${c.id}/files?kind=signed_copy`), 201);
    return ok(
      await post('rep', `/sales/contracts/${c.id}/signature`, {
        expectedRevision: a.revision,
        signedOn: (more['startDate'] as string | undefined) ?? '2027-01-10',
        signatories: SIGNATAIRES,
        fileId: file.id,
      }),
    );
  }

  /** Brouillons préparés par la tâche pour un contrat (via les liens). */
  async function brouillonsDe(contractId: string) {
    const ls = await links().find({ organizationId: f.orgId(), contractId }).toArray();
    const docs = await invoices()
      .find({ _id: { $in: ls.map((l) => new ObjectId(String(l['invoiceId']))) } })
      .toArray();
    return { links: ls, invoices: docs };
  }

  const schedule = async (who: Actor, contractId: string, query = '') =>
    ok(await get(who, `/sales/contracts/${contractId}/schedule${query}`));

  async function inviter(role: 'sales_rep' | 'finance_director', key: 'rep' | 'dir', tag: string) {
    const email = `ssubs-${key}-${tag}@lalanda-test.local`;
    const inv = await f.post('owner', `/organizations/${f.orgId()}/invitations`, { email, role });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    extra[key] = await registerAndLogin(f.app(), {
      email,
      password: 'Passw0rd!abonnements',
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
  }, E2E_HOOK_TIMEOUT_MS);

  // ── Abonnement mensuel, idempotence, aucune émission (critères 9 et 10) ──

  describe('abonnement mensuel (critères 9 et 10)', () => {
    let contrat: Record<string, any>;

    it('ancré le 31 janv. : brouillons des 31 janv., 28 févr., 31 mars ; rejouée : rien de plus', async () => {
      contrat = await contratSigne();
      const fin = new Date('2027-03-31T12:00:00Z');
      const r1 = await job().run(fin);
      expect(r1.prepared).toBeGreaterThanOrEqual(3);
      const { links: ls, invoices: docs } = await brouillonsDe(contrat.id);
      expect(ls.map((l) => l['occurrenceDate']).sort()).toEqual([
        '2027-01-31',
        '2027-02-28',
        '2027-03-31',
      ]);
      for (const l of ls) {
        expect(l).toMatchObject({ kind: 'subscription_occurrence', linkedBy: SYSTEME });
        expect(l['lineMap']).toEqual([
          { invoiceLineIndex: expect.any(Number), lineRef: 'L1', quantity: expect.any(String) },
        ]);
      }
      // Pro forma : brouillon, sans numéro fiscal, créé par l'acteur système.
      expect(docs).toHaveLength(3);
      for (const d of docs) {
        expect(d).toMatchObject({ status: 'draft', number: null, type: 'FV', createdBy: SYSTEME });
        expect(d['proformaRef']).toEqual(expect.any(String));
      }
      const fevrier = docs.find((d) => String(d['comments']?.C).includes('période du 28/02/2027'));
      expect(fevrier?.['comments']?.C).toBe(
        `Abonnement ${contrat.number} — période du 28/02/2027 au 30/03/2027`,
      );

      // Rejouée deux fois le même jour, puis deux passages concurrents : rien de plus.
      expect((await job().run(fin)).prepared).toBe(0);
      expect((await job().run(new Date('2027-03-31T20:00:00Z'))).prepared).toBe(0);
      await Promise.all([job().run(fin), job().run(fin)]);
      const apres = await brouillonsDe(contrat.id);
      expect(apres.links).toHaveLength(3);
      const systeme = await invoices()
        .find({ organizationId: f.orgId(), 'comments.C': { $regex: contrat.number } })
        .toArray();
      expect(systeme).toHaveLength(3);

      // L'échéancier montre les trois brouillons, puis les échéances à venir.
      const s = await schedule('viewer', contrat.id);
      expect(s.billingKind).toBe('recurring');
      const prepared = s.entries.filter((e: any) => e.state === 'prepared');
      expect(prepared.map((e: any) => e.key)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
      expect(prepared[0].invoice).toMatchObject({ status: 'draft', type: 'FV', currency: 'USD' });
      expect(s.entries.find((e: any) => e.key === '2027-04-30')?.state).toBe('upcoming');
    });

    it('jamais d’émission automatique : aucune facture émise par ou pour l’acteur système (critère 10)', async () => {
      const finales = await invoices()
        .find({
          createdBy: SYSTEME,
          status: { $in: ['issued', 'pending_normalization', 'normalized'] },
        })
        .toArray();
      expect(finales).toEqual([]);
      const journal = await f
        .db()
        .collection('audit_events')
        .find({ actorUserId: SYSTEME })
        .toArray();
      expect(journal.length).toBeGreaterThanOrEqual(3);
      expect([...new Set(journal.map((e) => e['action']))]).toEqual([
        'sales_contract.occurrence_prepared',
      ]);
      expect(journal.every((e) => e['metadata']?.automatic === true)).toBe(true);
      // Aucune normalisation : aucun envoi DGI n'a été journalisé.
      expect(
        await f
          .db()
          .collection('audit_events')
          .countDocuments({ action: { $regex: /normaliz|issued/ }, organizationId: f.orgId() }),
      ).toBe(0);
    });

    it('raccords : le brouillon est une facture ordinaire, identique à la même saisie à la main, émise par un humain (critère 13)', async () => {
      const { invoices: docs } = await brouillonsDe(contrat.id);
      const auto = docs.find((d) => String(d['comments']?.C).includes('31/01/2027'))!;
      const main = ok(
        await f.post('owner', '/sales/invoices', {
          type: 'FV',
          currency: 'USD',
          priceMode: 'ht',
          customer: { customerId: customer, printContactDetails: false },
          pointOfSaleId: null,
          lines: [ligne('Maintenance mensuelle', '1', '500.00')],
          payments: [],
          comments: { A: null, C: auto['comments'].C },
          creditNote: null,
          showUsdCounterValue: false,
        }),
        201,
      );
      const manuelle = await invoices().findOne({ _id: new ObjectId(main.id) });
      for (const champ of ['type', 'currency', 'priceMode', 'customer', 'lines', 'comments']) {
        expect(auto[champ], champ).toEqual(manuelle![champ]);
      }
      expect(auto['documentAmounts']).toEqual(manuelle!['documentAmounts']);
      await invoices().deleteOne({ _id: new ObjectId(main.id) });

      // Émission par un humain, par la route existante des factures (`sales.invoice`).
      const id = String(auto['_id']);
      const d = ok(await f.get('owner', `/sales/invoices/${id}`));
      const p = ok(
        await f.put('owner', `/sales/invoices/${id}`, {
          type: 'FV',
          currency: 'USD',
          priceMode: 'ht',
          customer: { customerId: customer, printContactDetails: false },
          pointOfSaleId: null,
          lines: [ligne('Maintenance mensuelle', '1', '500.00')],
          payments: [{ method: 'CREDIT', amount: d.documentAmounts.calculation.totals.total }],
          comments: { A: null, C: auto['comments'].C },
          creditNote: null,
          showUsdCounterValue: false,
          expectedRevision: d.revision,
        }),
      );
      const emise = ok(
        await f.post('owner', `/sales/invoices/${id}/issue`, { expectedRevision: p.revision }),
      );
      expect(emise.status).toBe('issued');
      const emission = await f
        .db()
        .collection('audit_events')
        .findOne({ targetId: id, action: { $regex: /issued/ } });
      expect(emission?.['actorUserId']).toBe(f.userId('owner'));
      // L'échéance reste préparée (facture émise) ; la tâche ne la refait pas.
      expect((await job().run(new Date('2027-03-31T12:00:00Z'))).prepared).toBe(0);
      const s = await schedule('viewer', contrat.id);
      expect(s.entries[0]).toMatchObject({
        key: '2027-01-31',
        state: 'prepared',
        invoice: { invoiceId: id, status: 'issued' },
      });
    });
  });

  // ── Brouillon supprimé, préparation manuelle (critère 11) ────────────────

  describe('brouillon supprimé et « Préparer maintenant » (critère 11)', () => {
    it('supprimer le brouillon rend l’échéance « à préparer » ; la tâche suivante la prépare', async () => {
      const debut = addDays(today, -20);
      const c = await contratSigne({ startDate: debut, billing: mensuel(debut) });
      await job().run(new Date());
      let s = await schedule('viewer', c.id);
      expect(s.entries[0]).toMatchObject({ key: debut, state: 'prepared' });
      const premier = s.entries[0].invoice.invoiceId as string;
      ok(await srv().delete(`/sales/invoices/${premier}`).set('Cookie', f.as('owner')), 204);
      s = await schedule('viewer', c.id);
      expect(s.entries[0]).toMatchObject({ key: debut, state: 'to_prepare', invoice: null });
      await job().run(new Date());
      s = await schedule('viewer', c.id);
      expect(s.entries[0].state).toBe('prepared');
      expect(s.entries[0].invoice.invoiceId).not.toBe(premier);

      // Préparer maintenant l'échéance à venir : `sales.manage` exigé.
      const suivante = s.entries[1] as { key: string; state: string };
      expect(suivante.state).toBe('upcoming');
      const route = `/sales/contracts/${c.id}/occurrences/${suivante.key}/prepare`;
      expect((await post('rep', route)).status).toBe(403);
      expect((await post('viewer', route)).status).toBe(403);
      code(await post('accountant', route, { type: 'FT' }), 400, 'INVALID_REQUEST');
      const prep = ok(await post('accountant', route));
      expect(prep.invoiceId).toEqual(expect.any(String));
      expect(prep.occurrence).toMatchObject({ key: suivante.key, state: 'prepared' });
      const doc = await invoices().findOne({ _id: new ObjectId(prep.invoiceId) });
      expect(doc).toMatchObject({ status: 'draft', createdBy: f.userId('accountant') });
      code(await post('accountant', route), 409, 'OCCURRENCE_ALREADY_PREPARED');
      code(
        await post('accountant', `/sales/contracts/${c.id}/occurrences/2001-01-01/prepare`),
        404,
        'OCCURRENCE_NOT_FOUND',
      );
      code(
        await post('accountant', `/sales/contracts/${c.id}/occurrences/n-importe/prepare`),
        404,
        'OCCURRENCE_NOT_FOUND',
      );
    });

    it('`autoPrepare` faux : la tâche ne prépare rien, la préparation manuelle reste possible', async () => {
      const debut = addDays(today, -5);
      const c = await contratSigne({ startDate: debut, billing: mensuel(debut, false) });
      await job().run(new Date());
      const s = await schedule('viewer', c.id);
      expect(s.entries[0]).toMatchObject({ key: debut, state: 'to_prepare', autoPrepare: false });
      ok(await post('owner', `/sales/contracts/${c.id}/occurrences/${debut}/prepare`));
    });

    it('échéancier à dates fixes : lien `schedule_item` avec `itemRef` et date ; lignes de l’échéance', async () => {
      const debut = addDays(today, -3);
      const plus = addDays(today, 40);
      const c = await contratSigne({
        startDate: debut,
        billing: {
          kind: 'schedule',
          items: [
            {
              itemRef: 'E1',
              dueDate: debut,
              label: 'Démarrage',
              lines: [ligne('Mise en service', '1', '800.00')],
            },
            {
              itemRef: 'E2',
              dueDate: plus,
              label: 'Livraison',
              lines: [ligne('Recette', '2', '100.00')],
            },
          ],
        },
      });
      await job().run(new Date());
      const { links: ls, invoices: docs } = await brouillonsDe(c.id);
      expect(ls).toHaveLength(1);
      expect(ls[0]).toMatchObject({ kind: 'schedule_item', itemRef: 'E1', occurrenceDate: debut });
      expect(docs[0]!['lines'][0]).toMatchObject({ name: 'Mise en service', unitPrice: '800.00' });
      expect(docs[0]!['comments'].C).toContain('— Démarrage');
      const s = await schedule('viewer', c.id);
      expect(s.entries.map((e: any) => [e.key, e.state, e.label])).toEqual([
        ['item:E1', 'prepared', 'Démarrage'],
        ['item:E2', 'upcoming', 'Livraison'],
      ]);
      const prep = ok(await post('owner', `/sales/contracts/${c.id}/occurrences/item:E2/prepare`));
      const doc = await invoices().findOne({ _id: new ObjectId(prep.invoiceId) });
      expect(doc!['lines'][0]).toMatchObject({ name: 'Recette' });
      expect(Number(doc!['lines'][0].quantity)).toBe(2);
    });
  });

  // ── Blocages (critère 8 et § 5.3) ────────────────────────────────────────

  describe('échéances bloquées (critère 8, § 5.3)', () => {
    it('reconduction tacite non constatée : rien au-delà du terme ; constatée : préparée ; `maxRenewals` atteint', async () => {
      const debut = addDays(today, -45);
      const c = await contratSigne({
        startDate: debut,
        initialTermMonths: 1,
        renewal: { mode: 'tacit', periodMonths: 1, maxRenewals: 1 },
        billing: mensuel(debut),
      });
      const r = await job().run(new Date());
      expect(r.blocked).toBeGreaterThanOrEqual(1);
      let s = await schedule('viewer', c.id);
      expect(s.entries).toHaveLength(2);
      const [premiere, seconde] = s.entries as any[];
      expect(premiere).toMatchObject({ key: debut, state: 'prepared' });
      expect(seconde).toMatchObject({ state: 'blocked', invoice: null });
      expect(seconde.reasons.map((x: any) => x.code)).toEqual(['RENEWAL_NOT_RECORDED']);
      expect(seconde.date > s.billableUntil).toBe(true);
      code(
        await post('owner', `/sales/contracts/${c.id}/occurrences/${seconde.key}/prepare`),
        409,
        'OCCURRENCE_BLOCKED',
      );
      expect(await links().countDocuments({ contractId: c.id })).toBe(1);

      // Constat par un détenteur de `sales.contract.approve` : la tâche prépare l'échéance.
      const v = ok(await get('viewer', `/sales/contracts/${c.id}`));
      const constat = ok(
        await post('dir', `/sales/contracts/${c.id}/renewals`, { expectedRevision: v.revision }),
      );
      expect(constat.terms.proposedNextTerm).toBeNull();
      await job().run(new Date());
      s = await schedule('viewer', c.id);
      expect(s.entries.find((e: any) => e.key === seconde.key)?.state).toBe('prepared');
      // `maxRenewals` atteint : aucun terme proposé, rien au-delà du terme constaté.
      expect(s.entries.every((e: any) => e.date <= s.billableUntil)).toBe(true);
      expect(s.entries.every((e: any) => e.state !== 'blocked')).toBe(true);
    });

    it('résiliation : rien après la date d’effet (CONTRACT_TERMINATED)', async () => {
      const debut = addDays(today, -70);
      const c = await contratSigne({
        startDate: debut,
        initialTermMonths: null,
        renewal: { mode: 'none', periodMonths: null, maxRenewals: null },
        billing: mensuel(debut),
      });
      const effet = addDays(debut, 35);
      ok(
        await post('owner', `/sales/contracts/${c.id}/terminate`, {
          expectedRevision: c.revision,
          noticeGivenOn: addDays(debut, 5),
          by: 'customer',
          effectiveOn: effet,
          reason: 'Fin de la collaboration',
        }),
      );
      await job().run(new Date());
      const s = await schedule('viewer', c.id);
      expect(s.billableUntil).toBe(effet);
      const avant = s.entries.filter((e: any) => e.date <= effet);
      const apres = s.entries.filter((e: any) => e.date > effet);
      expect(avant.length).toBe(2);
      expect(avant.every((e: any) => e.state === 'prepared')).toBe(true);
      expect(apres.length).toBeGreaterThanOrEqual(1);
      for (const e of apres) {
        expect(e.state).toBe('blocked');
        expect(e.reasons.map((x: any) => x.code)).toEqual(['CONTRACT_TERMINATED']);
      }
      const { links: ls } = await brouillonsDe(c.id);
      expect(ls.every((l) => String(l['occurrenceDate']) <= effet)).toBe(true);
    });

    it('avenant non signé à sa date d’effet, client désactivé : bloquées, rien de préparé', async () => {
      const debut = addDays(today, -10);
      const c = await contratSigne({ startDate: debut, billing: mensuel(debut) });
      ok(
        await post('rep', `/sales/contracts/${c.id}/amendments`, {
          effectiveDate: debut,
          purpose: 'change',
          changes: { lines: [ligne('Maintenance mensuelle', '1', '650.00')] },
        }),
        201,
      );
      await job().run(new Date());
      let s = await schedule('viewer', c.id);
      expect(s.entries[0]).toMatchObject({ key: debut, state: 'blocked' });
      expect(s.entries[0].reasons.map((x: any) => x.code)).toEqual(['AMENDMENT_PENDING']);

      const d = addDays(today, -2);
      const autre = await contratSigne({ startDate: d, billing: mensuel(d) });
      await f
        .db()
        .collection('customers')
        .updateOne({ _id: new ObjectId(customer) }, { $set: { active: false } });
      try {
        await job().run(new Date());
        s = await schedule('viewer', autre.id);
        expect(s.entries[0].reasons.map((x: any) => x.code)).toContain('CUSTOMER_ARCHIVED');
        expect(await links().countDocuments({ contractId: autre.id })).toBe(0);
        expect(await links().countDocuments({ contractId: c.id })).toBe(0);
      } finally {
        await f
          .db()
          .collection('customers')
          .updateOne({ _id: new ObjectId(customer) }, { $set: { active: true } });
      }
      await job().run(new Date());
      expect(await links().countDocuments({ contractId: autre.id })).toBe(1);
    });
  });

  // ── Isolation et lecture ─────────────────────────────────────────────────

  describe('isolation et lecture', () => {
    it('autre organisation : 404 ; contrat non signé : aucune échéance ; fenêtre invalide : 400', async () => {
      const c = await contratSigne({
        startDate: addDays(today, -1),
        billing: mensuel(addDays(today, -1)),
      });
      code(
        await get('ownerB', `/sales/contracts/${c.id}/schedule`),
        404,
        'SALES_CONTRACT_NOT_FOUND',
      );
      code(
        await post('ownerB', `/sales/contracts/${c.id}/occurrences/${addDays(today, -1)}/prepare`),
        404,
        'SALES_CONTRACT_NOT_FOUND',
      );
      const brouillon = ok(await post('rep', '/sales/contracts', corps()), 201);
      const s = await schedule('rep', brouillon.id);
      expect(s.entries).toEqual([]);
      expect(s.warnings.map((w: any) => w.code)).toEqual(['CONTRACT_NOT_SIGNED']);
      code(
        await post('owner', `/sales/contracts/${brouillon.id}/occurrences/2027-01-31/prepare`),
        409,
        'CONTRACT_NOT_SIGNED',
      );
      code(
        await get('viewer', `/sales/contracts/${c.id}/schedule?from=2027-01-01&to=2026-01-01`),
        400,
        'INVALID_REQUEST',
      );
      code(await get('viewer', `/sales/contracts/${c.id}/schedule?jour=1`), 400, 'INVALID_REQUEST');
      expect((await f.get('advisor', `/sales/contracts/${c.id}/schedule`)).status).toBe(403);
    });
  });
});
