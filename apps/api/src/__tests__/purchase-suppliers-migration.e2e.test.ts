// Migration `20261031-0001-suppliers-from-expenses` (ADR-0044 § 2.9, critère 16).
// ADR-0044 — P2.
//
// Jeu « v1 » écrit directement en base (dépenses et règles telles que l'API
// d'ADR-0034 les écrivait : aucun `supplierId`), migration jouée DEUX fois : le
// second passage ne crée rien et ne change rien. Base dédiée, supprimée à la fin ;
// l'application n'est pas démarrée (la migration n'utilise que le pilote `mongodb`).

import { MongoClient, ObjectId, type Db, type Document } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { normalizeForSearch, searchKeyOf } from '../sales/search.js';
import { e2eSuite } from './e2e-utils.js';

interface Migration {
  up(
    db: Db,
    options?: { now?: Date; quiet?: boolean },
  ): Promise<{
    organizations: number;
    reports: number;
    suppliersCreated: number;
    expensesLinked: number;
    recurringLinked: number;
  }>;
  down(db: Db): Promise<void>;
  normalizeName(v: string): string;
  searchKeyOf(parts: Array<string | null | undefined>): string;
  SYSTEM_ACTOR: string;
}

const tag = randomBytes(4).toString('hex');
const ORG_A = `org-a-${tag}`;
const ORG_B = `org-b-${tag}`;
const NOW = new Date('2026-10-31T06:00:00Z');
const d = (iso: string) => new Date(iso);

e2eSuite('migration 20261031-0001 — fournisseurs depuis les dépenses', () => {
  let client: MongoClient;
  let db: Db;
  let m: Migration;

  const E = {
    socimexMaj: new ObjectId(),
    socimexMin: new ObjectId(),
    socimexMin2: new ObjectId(),
    sarl: new ObjectId(),
    sansFournisseur: new ObjectId(),
    deB: new ObjectId(),
    dejaRattachee: new ObjectId(),
  };
  const R = { loyer: new ObjectId() };

  const expense = (
    _id: ObjectId,
    organizationId: string,
    supplierName: string | null,
    extra: Record<string, unknown> = {},
  ) => ({
    _id,
    organizationId,
    spentOn: '2026-05-01',
    amount: '10.00',
    currency: 'USD',
    category: 'achats',
    label: 'Achat',
    supplierName,
    supplierKey: supplierName === null ? null : normalizeForSearch(supplierName),
    accountId: null,
    status: 'recorded',
    revision: 1,
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: d('2026-05-01T00:00:00Z'),
    updatedAt: d('2026-05-01T00:00:00Z'),
    _schemaVersion: 1,
    ...extra,
  });

  async function snapshot(): Promise<Record<string, Document[]>> {
    const out: Record<string, Document[]> = {};
    for (const col of ['suppliers', 'treasury_expenses', 'treasury_recurring_expenses']) {
      out[col] = await db.collection(col).find({}).sort({ _id: 1 }).toArray();
    }
    return out;
  }
  const supplierOf = (organizationId: string, sortName: string) =>
    db.collection('suppliers').findOne({ organizationId, sortName });

  beforeAll(async () => {
    client = await MongoClient.connect(process.env['MONGODB_URI']!);
    db = client.db(`lalanda_e2e_suppliers_migration_${tag}`);
    await db.dropDatabase();
    m = (await import(
      new URL('../../migrations/20261031-0001-suppliers-from-expenses.mjs', import.meta.url).href
    )) as Migration;

    await db.collection('treasury_expenses').insertMany([
      expense(E.socimexMaj, ORG_A, 'SOCIMEX', { createdAt: d('2026-04-01T00:00:00Z') }),
      expense(E.socimexMin, ORG_A, 'Socimex', { currency: 'CDF', category: 'transport' }),
      expense(E.socimexMin2, ORG_A, 'Socimex', { currency: 'CDF', category: 'transport' }),
      expense(E.sarl, ORG_A, 'Socimex SARL'),
      expense(E.sansFournisseur, ORG_A, null),
      expense(E.deB, ORG_B, 'socimex'),
      // Écrite par la nouvelle API : `supplierId` présent (même nul) → ignorée.
      expense(E.dejaRattachee, ORG_A, 'Kin Express', { supplierId: null }),
    ]);
    await db.collection('treasury_recurring_expenses').insertOne({
      _id: R.loyer,
      organizationId: ORG_A,
      label: 'Loyer',
      amount: '100.00',
      currency: 'USD',
      category: 'loyer',
      supplierName: 'socimex  ',
      accountId: null,
      frequency: 'monthly',
      startDate: '2026-01-01',
      endDate: null,
      active: true,
      revision: 1,
      createdBy: 'u1',
      updatedBy: 'u1',
      createdAt: d('2026-01-01T00:00:00Z'),
      updatedAt: d('2026-01-01T00:00:00Z'),
      _schemaVersion: 1,
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  });

  it('la normalisation de la migration est celle de l’application', () => {
    for (const v of ['SOCIMEX', '  Élevé   SARL ', 'Kin-Énergie', 'ÇA\tva']) {
      expect(m.normalizeName(v)).toBe(normalizeForSearch(v));
    }
    expect(m.searchKeyOf(['Socimex', null, ' NIF '])).toBe(searchKeyOf(['Socimex', null, ' NIF ']));
  });

  describe('premier passage', () => {
    let first: Awaited<ReturnType<Migration['up']>>;
    beforeAll(async () => {
      first = await m.up(db, { now: NOW, quiet: true });
    });

    it('« SOCIMEX » et « Socimex » : une fiche ; « Socimex SARL » : une autre', async () => {
      expect(first).toEqual({
        organizations: 2,
        reports: 2,
        suppliersCreated: 3,
        expensesLinked: 5,
        recurringLinked: 1,
      });
      expect(await db.collection('suppliers').countDocuments({ organizationId: ORG_A })).toBe(2);
      const socimex = await supplierOf(ORG_A, 'socimex');
      // Graphie la plus fréquente : « Socimex » (2 dépenses ; la règle « socimex » à part) ;
      // devise : CDF (2) contre USD (1 + la règle) → égalité tranchée par l'ordre
      // alphabétique ; catégorie : `transport` (2).
      expect(socimex).toMatchObject({
        name: 'Socimex',
        legacyKeys: ['socimex'],
        paymentTerms: { kind: 'immediate' },
        defaultCurrency: 'CDF',
        defaultCategory: 'transport',
        active: true,
        mergedInto: null,
        nif: null,
        paymentMethods: [],
        revision: 1,
        createdBy: m.SYSTEM_ACTOR,
      });
      const sarl = await supplierOf(ORG_A, 'socimex sarl');
      expect(sarl).toMatchObject({ name: 'Socimex SARL', legacyKeys: ['socimex sarl'] });
    });

    it('supplierId posé sur les dépenses et la règle ; supplierName inchangé', async () => {
      const socimex = String((await supplierOf(ORG_A, 'socimex'))!._id);
      const sarl = String((await supplierOf(ORG_A, 'socimex sarl'))!._id);
      const exp = async (id: ObjectId) => db.collection('treasury_expenses').findOne({ _id: id });
      expect(await exp(E.socimexMaj)).toMatchObject({
        supplierId: socimex,
        supplierName: 'SOCIMEX',
      });
      expect(await exp(E.socimexMin)).toMatchObject({ supplierId: socimex });
      expect(await exp(E.sarl)).toMatchObject({ supplierId: sarl });
      expect(await exp(E.sansFournisseur)).not.toHaveProperty('supplierId');
      expect(await exp(E.dejaRattachee)).toMatchObject({ supplierId: null });
      expect(
        await db.collection('treasury_recurring_expenses').findOne({ _id: R.loyer }),
      ).toMatchObject({ supplierId: socimex, supplierName: 'socimex  ' });
    });

    it('isolation : le même nom dans une autre organisation donne une autre fiche', async () => {
      const a = await supplierOf(ORG_A, 'socimex');
      const b = await supplierOf(ORG_B, 'socimex');
      expect(b).not.toBeNull();
      expect(String(b!._id)).not.toBe(String(a!._id));
      expect(
        (await db.collection('treasury_expenses').findOne({ _id: E.deB }))!['supplierId'],
      ).toBe(String(b!._id));
    });

    it('rapport à relire : fiches, graphies, dépenses rattachées', async () => {
      const report = await db
        .collection('supplier_migration_reports')
        .findOne({ organizationId: ORG_A });
      const socimex = String((await supplierOf(ORG_A, 'socimex'))!._id);
      expect(report).toMatchObject({
        migration: '20261031-0001-suppliers-from-expenses',
        suppliersCreated: 2,
        expensesLinked: 4,
        recurringLinked: 1,
      });
      expect(report!['suppliers']).toEqual(
        expect.arrayContaining([
          {
            supplierId: socimex,
            name: 'Socimex',
            spellings: ['Socimex', 'socimex', 'SOCIMEX'],
            expenses: 3,
          },
        ]),
      );
      expect(
        await db
          .collection('_migrations')
          .findOne({ name: '20261031-0001-suppliers-from-expenses' }),
      ).not.toBeNull();
    });
  });

  describe('second passage', () => {
    it('rejouée, la migration produit exactement le même état et aucun rapport', async () => {
      const before = await snapshot();
      const reports = await db.collection('supplier_migration_reports').countDocuments();
      const second = await m.up(db, { now: new Date('2026-11-01T06:00:00Z'), quiet: true });
      expect(second).toEqual({
        organizations: 2,
        reports: 0,
        suppliersCreated: 0,
        expensesLinked: 0,
        recurringLinked: 0,
      });
      expect(await snapshot()).toEqual(before);
      expect(await db.collection('supplier_migration_reports').countDocuments()).toBe(reports);
    });

    it('une dépense écrite entre-temps par une ancienne instance est rattrapée, sans nouvelle fiche', async () => {
      const late = new ObjectId();
      await db.collection('treasury_expenses').insertOne(expense(late, ORG_A, 'SoCiMeX'));
      const third = await m.up(db, { now: new Date('2026-11-02T06:00:00Z'), quiet: true });
      expect(third.suppliersCreated).toBe(0);
      expect(third.expensesLinked).toBe(1);
      const socimex = String((await supplierOf(ORG_A, 'socimex'))!._id);
      expect((await db.collection('treasury_expenses').findOne({ _id: late }))!['supplierId']).toBe(
        socimex,
      );
    });

    it('down retire la trace et les rapports, jamais les données', async () => {
      const before = await snapshot();
      await m.down(db);
      expect(await db.collection('supplier_migration_reports').countDocuments()).toBe(0);
      expect(await db.collection('_migrations').countDocuments()).toBe(0);
      expect(await snapshot()).toEqual(before);
    });
  });
});
