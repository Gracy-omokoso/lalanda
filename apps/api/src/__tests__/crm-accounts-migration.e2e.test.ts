// Migration `20261030-0001-crm-accounts` (ADR-0040 § 2.7, critère 17). ADR-0040 — C1.
//
// Jeu « v1 » écrit directement en base (documents tels que l'API d'ADR-0035 les
// écrivait : aucun `accountId`), migration jouée DEUX fois : le second passage ne
// crée rien et ne change rien. Base dédiée, supprimée à la fin ; l'application
// n'est pas démarrée (la migration n'utilise que le pilote `mongodb`).

import { MongoClient, ObjectId, type Db, type Document } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { e2eSuite } from './e2e-utils.js';

interface Migration {
  up(
    db: Db,
    options?: { now?: Date; quiet?: boolean },
  ): Promise<{
    organizations: number;
    reports: number;
    accountsCreated: { customer: number; prospect: number };
  }>;
  down(db: Db): Promise<void>;
  SYSTEM_ACTOR: string;
}

const tag = randomBytes(4).toString('hex');
const ORG_A = `org-a-${tag}`;
const ORG_B = `org-b-${tag}`;
const NOW = new Date('2026-10-30T06:00:00Z');
const d = (iso: string) => new Date(iso);
const id = () => new ObjectId();

e2eSuite('migration 20261030-0001 — comptes CRM', () => {
  let client: MongoClient;
  let db: Db;
  let m: Migration;

  const C1 = id();
  const C2 = id();
  const C3 = id();
  const K = {
    acme1: id(),
    acme2: id(),
    acme: id(),
    acmeSa: id(),
    client: id(),
    none: id(),
    b: id(),
  };
  const O = { acme: id(), client: id(), nouveau: id() };
  const A = { onOpp: id(), onContact: id(), onCustomer: id(), orphan: id(), done: id() };
  const existingProspect = id();

  const contact = (
    _id: ObjectId,
    organizationId: string,
    name: string,
    extra: Record<string, unknown>,
  ) => ({
    _id,
    organizationId,
    name,
    jobTitle: null,
    email: null,
    phone: null,
    customerId: null,
    companyName: null,
    notes: null,
    sortName: name.toLowerCase(),
    searchKey: name.toLowerCase(),
    revision: 1,
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: d('2026-05-01T00:00:00Z'),
    updatedAt: d('2026-05-01T00:00:00Z'),
    _schemaVersion: 1,
    ...extra,
  });
  const opportunity = (_id: ObjectId, extra: Record<string, unknown>) => ({
    _id,
    organizationId: ORG_A,
    title: 'Affaire',
    customerId: null,
    prospectName: null,
    contactId: null,
    stageKey: 'lead',
    status: 'open',
    amount: '1000.00',
    currency: 'USD',
    expectedCloseDate: null,
    lostReason: null,
    closedAt: null,
    lastActivityAt: d('2026-05-01T00:00:00Z'),
    stageHistory: [],
    searchKey: 'affaire',
    revision: 1,
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: d('2026-05-01T00:00:00Z'),
    updatedAt: d('2026-05-01T00:00:00Z'),
    _schemaVersion: 1,
    ...extra,
  });
  const activity = (_id: ObjectId, extra: Record<string, unknown>) => ({
    _id,
    organizationId: ORG_A,
    kind: 'follow_up',
    subject: 'Relancer',
    notes: null,
    dueAt: null,
    done: false,
    doneAt: null,
    opportunityId: null,
    contactId: null,
    customerId: null,
    revision: 1,
    createdBy: 'u2',
    updatedBy: 'u2',
    createdAt: d('2026-05-01T00:00:00Z'),
    updatedAt: d('2026-05-01T00:00:00Z'),
    _schemaVersion: 1,
    ...extra,
  });

  async function snapshot(): Promise<Record<string, Document[]>> {
    const out: Record<string, Document[]> = {};
    for (const c of ['crm_accounts', 'crm_contacts', 'crm_opportunities', 'crm_activities']) {
      out[c] = await db.collection(c).find({}).sort({ _id: 1 }).toArray();
    }
    return out;
  }
  const accountOf = (organizationId: string, sortName: string) =>
    db.collection('crm_accounts').findOne({ organizationId, sortName });

  beforeAll(async () => {
    client = await MongoClient.connect(process.env['MONGODB_URI']!);
    db = client.db(`lalanda_e2e_crm_migration_${tag}`);
    await db.dropDatabase();
    m = (await import(
      new URL('../../migrations/20261030-0001-crm-accounts.mjs', import.meta.url).href
    )) as Migration;

    await db.collection('memberships').insertMany([
      { organizationId: ORG_A, userId: 'u1', role: 'owner' },
      { organizationId: ORG_A, userId: 'u2', role: 'sales_rep' },
      { organizationId: ORG_B, userId: 'b1', role: 'owner' },
    ]);
    await db.collection('customers').insertMany([
      {
        _id: C1,
        organizationId: ORG_A,
        type: 'PM',
        name: 'Client Un',
        nif: 'A1234567',
        active: true,
      },
      { _id: C2, organizationId: ORG_A, type: 'PP', name: 'Client Deux', nif: null, active: false },
      { _id: C3, organizationId: ORG_B, type: 'PP', name: 'Client Trois', nif: null, active: true },
    ]);
    // Prospect déjà saisi par l'application (même nom normalisé que « Nouveau Prospect »).
    await db.collection('crm_accounts').insertOne({
      _id: existingProspect,
      organizationId: ORG_A,
      kind: 'prospect',
      customerId: null,
      name: 'Nouveau  prospect',
      sortName: 'nouveau prospect',
      searchKey: 'nouveau prospect',
      ownerId: 'u2',
      active: true,
      conversion: null,
      mergedInto: null,
      revision: 3,
      createdBy: 'u2',
      updatedBy: 'u2',
      createdAt: d('2026-10-01T00:00:00Z'),
      updatedAt: d('2026-10-01T00:00:00Z'),
      _schemaVersion: 1,
    });
    await db.collection('crm_contacts').insertMany([
      contact(K.acme1, ORG_A, 'Ali', {
        companyName: 'ACME Sarl',
        createdAt: d('2026-03-01T00:00:00Z'),
      }),
      contact(K.acme2, ORG_A, 'Béa', {
        companyName: 'acme  sarl',
        createdAt: d('2026-03-02T00:00:00Z'),
      }),
      contact(K.acme, ORG_A, 'Cy', { companyName: 'ACME' }),
      contact(K.acmeSa, ORG_A, 'Dan', { companyName: 'ACME SA' }),
      contact(K.client, ORG_A, 'Eve', { customerId: String(C1) }),
      contact(K.none, ORG_A, 'Fil', {}),
      contact(K.b, ORG_B, 'Gus', { companyName: 'ACME Sarl', createdBy: 'b1' }),
    ]);
    await db.collection('crm_opportunities').insertMany([
      opportunity(O.acme, { prospectName: 'Acme SARL', createdAt: d('2026-02-01T00:00:00Z') }),
      opportunity(O.client, { customerId: String(C1), createdBy: 'ghost' }),
      opportunity(O.nouveau, {
        prospectName: 'Nouveau Prospect',
        createdBy: 'ghost',
        lostReason: 'Trop cher',
      }),
    ]);
    await db.collection('crm_activities').insertMany([
      // Échéance hier 23 h 30 UTC = aujourd'hui à Kinshasa.
      activity(A.onOpp, { opportunityId: String(O.acme), dueAt: d('2026-10-29T23:30:00Z') }),
      activity(A.onContact, { kind: 'note', contactId: String(K.acme), done: true }),
      activity(A.onCustomer, { customerId: String(C1), dueAt: d('2026-11-02T10:00:00Z') }),
      activity(A.orphan, { kind: 'call' }),
      activity(A.done, {
        opportunityId: String(O.client),
        dueAt: d('2026-10-01T10:00:00Z'),
        done: true,
        doneAt: d('2026-10-01T11:00:00Z'),
      }),
    ]);
  }, 120_000);

  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  });

  describe('premier passage', () => {
    let first: Awaited<ReturnType<Migration['up']>>;

    beforeAll(async () => {
      first = await m.up(db, { now: NOW, quiet: true });
    });

    it('un compte client par fiche (désactivée comprise), sans responsable', async () => {
      const comptes = await db
        .collection('crm_accounts')
        .find({ kind: 'customer' })
        .sort({ organizationId: 1, name: 1 })
        .toArray();
      expect(
        comptes.map((c) => [c['organizationId'], c['customerId'], c['name'], c['active']]),
      ).toEqual([
        [ORG_A, String(C2), 'Client Deux', false],
        [ORG_A, String(C1), 'Client Un', true],
        [ORG_B, String(C3), 'Client Trois', true],
      ]);
      expect(comptes.every((c) => c['ownerId'] === null && c['createdBy'] === m.SYSTEM_ACTOR)).toBe(
        true,
      );
    });

    it('« ACME Sarl », « acme  sarl » et « Acme SARL » : un compte ; « ACME » et « ACME SA » : deux autres', async () => {
      const prospects = await db
        .collection('crm_accounts')
        .find({ organizationId: ORG_A, kind: 'prospect' })
        .sort({ sortName: 1 })
        .toArray();
      expect(prospects.map((p) => p['sortName'])).toEqual([
        'acme',
        'acme sa',
        'acme sarl',
        'nouveau prospect',
      ]);
      const sarl = prospects.find((p) => p['sortName'] === 'acme sarl')!;
      // Trois graphies à égalité (1 chacune) : la plus ancienne, celle de l'opportunité.
      expect(sarl['name']).toBe('Acme SARL');
      expect(sarl['ownerId']).toBe('u1');
      const contacts = await db
        .collection('crm_contacts')
        .find({ _id: { $in: [K.acme1, K.acme2] } })
        .toArray();
      expect(contacts.map((c) => c['accountId'])).toEqual([String(sarl._id), String(sarl._id)]);
      expect(contacts.map((c) => c['companyName'])).toEqual(['Acme SARL', 'Acme SARL']);
      expect(contacts.every((c) => c['_schemaVersion'] === 2)).toBe(true);
      const opp = await db.collection('crm_opportunities').findOne({ _id: O.acme });
      expect(opp).toMatchObject({
        accountId: String(sarl._id),
        prospectName: 'Acme SARL',
        ownerId: 'u1',
        lostReasonKey: null,
      });
    });

    it('le prospect déjà saisi est réutilisé ; un créateur parti n’est pas responsable', async () => {
      const opp = await db.collection('crm_opportunities').findOne({ _id: O.nouveau });
      expect(opp).toMatchObject({
        accountId: String(existingProspect),
        prospectName: 'Nouveau  prospect',
        ownerId: 'ghost',
        lostReason: 'Trop cher',
        lostReasonKey: null,
      });
      const existing = await db.collection('crm_accounts').findOne({ _id: existingProspect });
      expect(existing).toMatchObject({ revision: 3, ownerId: 'u2' });
    });

    it('contacts et opportunités de client : le compte du client ; contact sans entreprise : null', async () => {
      const un = await db.collection('crm_accounts').findOne({ customerId: String(C1) });
      expect(await db.collection('crm_contacts').findOne({ _id: K.client })).toMatchObject({
        accountId: String(un!._id),
        customerId: String(C1),
        companyName: null,
      });
      expect(await db.collection('crm_opportunities').findOne({ _id: O.client })).toMatchObject({
        accountId: String(un!._id),
        customerId: String(C1),
      });
      expect(await db.collection('crm_contacts').findOne({ _id: K.none })).toMatchObject({
        accountId: null,
      });
    });

    it('activités : compte déduit de l’opportunité, du contact puis du client ; assigné, jour et rappels', async () => {
      const sarl = await accountOf(ORG_A, 'acme sarl');
      const acme = await accountOf(ORG_A, 'acme');
      const un = await db.collection('crm_accounts').findOne({ customerId: String(C1) });
      const get = (x: ObjectId) => db.collection('crm_activities').findOne({ _id: x });
      expect(await get(A.onOpp)).toMatchObject({
        accountId: String(sarl!._id),
        assigneeUserId: 'u2',
        dueDay: '2026-10-30',
        reminders: { dueSoonFor: null, overdueFor: null },
      });
      expect(await get(A.onContact)).toMatchObject({
        accountId: String(acme!._id),
        assigneeUserId: null,
        dueDay: null,
      });
      expect(await get(A.onCustomer)).toMatchObject({
        accountId: String(un!._id),
        assigneeUserId: 'u2',
        dueDay: '2026-11-02',
      });
      expect(await get(A.orphan)).toMatchObject({ accountId: null, assigneeUserId: null });
      expect(await get(A.done)).toMatchObject({ accountId: String(un!._id), assigneeUserId: null });
    });

    it('isolation : le même nom dans une autre organisation donne un autre compte', async () => {
      const a = await accountOf(ORG_A, 'acme sarl');
      const b = await accountOf(ORG_B, 'acme sarl');
      expect(b).not.toBeNull();
      expect(String(b!._id)).not.toBe(String(a!._id));
      expect(await db.collection('crm_contacts').findOne({ _id: K.b })).toMatchObject({
        accountId: String(b!._id),
      });
    });

    it('rapport à relire : comptes créés, groupes et graphies, contacts sans entreprise, membres introuvables', async () => {
      expect(first).toEqual({
        organizations: 2,
        reports: 2,
        accountsCreated: { customer: 3, prospect: 4 },
      });
      const r = await db.collection('crm_migration_reports').findOne({ organizationId: ORG_A });
      expect(r).toMatchObject({
        migration: '20261030-0001-crm-accounts',
        accountsCreated: { customer: 2, prospect: 3 },
        prospectsReused: 1,
        contactsWithoutCompany: 1,
        unknownMembers: ['ghost'],
        updated: { contacts: 6, opportunities: 3, activities: 5 },
      });
      const groupes = r!['groups'] as Array<{ name: string; spellings: Array<{ name: string }> }>;
      expect(groupes.map((g) => g.name)).toEqual(['Acme SARL']);
      expect(groupes[0]!.spellings.map((s) => s.name).sort()).toEqual([
        'ACME Sarl',
        'Acme SARL',
        'acme  sarl',
      ]);
      expect(
        await db.collection('_migrations').findOne({ name: '20261030-0001-crm-accounts' }),
      ).not.toBeNull();
    });
  });

  describe('second passage', () => {
    it('rejouée, la migration produit exactement le même état et aucun rapport', async () => {
      const before = await snapshot();
      const reports = await db.collection('crm_migration_reports').countDocuments();
      const second = await m.up(db, { now: new Date('2026-10-31T06:00:00Z'), quiet: true });
      expect(second).toEqual({
        organizations: 2,
        reports: 0,
        accountsCreated: { customer: 0, prospect: 0 },
      });
      expect(await snapshot()).toEqual(before);
      expect(await db.collection('crm_migration_reports').countDocuments()).toBe(reports);
    });

    it('un document écrit entre-temps par une ancienne instance est rattrapé', async () => {
      const late = id();
      await db
        .collection('crm_contacts')
        .insertOne(contact(late, ORG_A, 'Hugo', { companyName: 'ACME  SARL' }));
      const third = await m.up(db, { now: new Date('2026-11-01T06:00:00Z'), quiet: true });
      expect(third.accountsCreated).toEqual({ customer: 0, prospect: 0 });
      const sarl = await accountOf(ORG_A, 'acme sarl');
      expect(await db.collection('crm_contacts').findOne({ _id: late })).toMatchObject({
        accountId: String(sarl!._id),
        companyName: 'Acme SARL',
      });
    });

    it('down retire la trace et les rapports, jamais les données', async () => {
      const before = await snapshot();
      await m.down(db);
      expect(await db.collection('crm_migration_reports').countDocuments()).toBe(0);
      expect(await db.collection('_migrations').countDocuments()).toBe(0);
      expect(await snapshot()).toEqual(before);
    });
  });
});
