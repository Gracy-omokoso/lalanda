// Stocks ↔ ventes (ADR-0046 § 6.2, O3, critères 7, 19, 20) et compléments des écrans S8
// (grand livre de tous les articles, `canValidate` des inventaires). ADR-0046 — S4.
//
// Les factures FINALES sont posées en base dans la forme figée que le circuit de
// facturation écrit (statut, type, lignes, `issuedAt`, `contentSha256`) : le test porte
// sur la LECTURE par `stock.sales-sync`, et vérifie par une EMPREINTE (sha-256 du BSON
// de chaque document, trié) que ni `sales_invoices`, ni son journal, ni ses compteurs,
// ni la normalisation ne changent d'un octet.

import 'reflect-metadata';

import { ThrottlerStorage } from '@nestjs/throttler';
import { BSON, ObjectId, type Db } from 'mongodb';
import { createHash, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { kinshasaToday, useStockFixture, type StockAccount } from './stock-e2e-fixtures.js';

vi.setConfig({ testTimeout: 180_000 });

/** Collections du circuit de facturation et de la normalisation DGI. */
const SALES_COLLECTIONS = [
  'sales_invoices',
  'sales_invoice_journal',
  'sales_invoice_counters',
  'sales_journal_heads',
  'sales_invoice_settlements',
  'normalization_alerts',
];

async function salesFingerprint(db: Db): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of SALES_COLLECTIONS) {
    const docs = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
    const h = createHash('sha256');
    for (const d of docs) h.update(BSON.serialize(d));
    out[name] = `${docs.length}:${h.digest('hex')}`;
  }
  return out;
}

e2eSuite('Stocks — branchement des ventes, compléments S8 (ADR-0046 S4)', () => {
  const f = useStockFixture(randomBytes(4).toString('hex'));
  let loc = '';
  let catalogId = '';
  let lait: Record<string, any> = {};
  let seq = 0;

  // `POST /stock/sync` est borné à 6 par heure et par utilisateur : chaque test repart
  // d'un compteur vide (motif du montage des achats).
  beforeEach(() => {
    const store = f.app().get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  });

  /** Facture figée, telle que le circuit de facturation l'écrit à l'émission. */
  const invoice = async (input: {
    type?: string;
    status?: string;
    lines: { catalogItemId: string | null; quantity: string; unit?: string | null }[];
    pointOfSaleId?: string | null;
    issuedAt?: Date;
    who?: StockAccount;
  }): Promise<string> => {
    seq += 1;
    const _id = new ObjectId();
    await f
      .db()
      .collection('sales_invoices')
      .insertOne({
        _id,
        organizationId: f.orgId(input.who ?? 'owner'),
        status: input.status ?? 'issued',
        proformaRef: `PF-${seq}-${randomBytes(3).toString('hex')}`,
        type: input.type ?? 'FV',
        currency: 'CDF',
        priceMode: 'ttc',
        customer: { type: 'PP', name: 'Client comptoir' },
        pointOfSaleId: input.pointOfSaleId ?? null,
        lines: input.lines.map((l, index) => ({
          index,
          source: l.catalogItemId ? 'catalog' : 'free',
          catalogItemId: l.catalogItemId,
          originLineIndex: null,
          code: null,
          edefCode: null,
          name: l.catalogItemId ? 'Lait' : 'Livraison',
          unit: l.unit === undefined ? 'pièce' : l.unit,
          itemType: l.catalogItemId ? 'BIE' : 'SER',
          taxGroup: 'B',
          outOfScope: false,
          specificTax: null,
          quantity: l.quantity,
          originalPrice: null,
          discount: null,
          unitPrice: '1160.00',
          priceModification: null,
          priceOverridden: false,
        })),
        payments: [],
        comments: { A: null, C: null },
        creditNote: null,
        number: `FV2610-${String(seq).padStart(6, '0')}`,
        issuedAt: input.issuedAt ?? new Date(),
        normalization: null,
        frozenAt: new Date(),
        contentSha256: createHash('sha256').update(`facture-${seq}`).digest('hex'),
        credited: [],
        creditRevision: 0,
        duplicateCount: 0,
        revision: 3,
        sortAt: new Date(),
        searchKey: '',
        createdBy: f.userId('owner'),
        updatedBy: f.userId('owner'),
        createdAt: new Date(),
        updatedAt: new Date(),
        _schemaVersion: 1,
      });
    return String(_id);
  };

  const ledger = async (query = '', who: StockAccount = 'owner') =>
    f.ok(await f.get(who, `/stock/movements${query}`));
  const ofInvoice = async (invoiceId: string) =>
    (await ledger(`?itemId=${lait['id']}&limit=100`))['items'].filter(
      // Par la clé d'idempotence : une sortie confirmée depuis « À traiter » a pour
      // origine la ligne à traiter, mais garde la clé de la facture.
      (m: any) => m.sourceKey.startsWith(`invoice:${invoiceId}:`),
    );
  const pendingOf = async (sourceKeyPart: string, who: StockAccount = 'owner') =>
    (f.ok(await f.get(who, '/stock/pending?limit=100'))['items'] as any[]).filter((p) =>
      p.sourceKey.includes(sourceKeyPart),
    );
  const quantity = async () => f.ok(await f.get('owner', `/stock/items/${lait['id']}`))['quantity'];
  const sync = async (who: StockAccount = 'owner') => f.ok(await f.post(who, '/stock/sync'));

  it('prépare un article du catalogue (BIE) lié à un article suivi, 3 en stock', async () => {
    loc = await f.defaultLocation();
    catalogId = f.ok(
      await f.post('owner', '/sales/catalog-items', {
        code: 'LAIT-1L',
        name: 'Lait 1 L',
        itemType: 'BIE',
        taxGroup: 'B',
        outOfScope: false,
        unitPrice: '1160.00',
        priceMode: 'ttc',
        currency: 'CDF',
        unit: 'pièce',
        specificTax: null,
      }),
      201,
    )['id'];
    lait = await f.item('Lait 1 L', {
      catalogItemId: catalogId,
      costCurrency: 'CDF',
      unitConversions: [{ unit: 'carton', factor: '12' }],
    });
    f.ok(
      (
        await f.voucher('owner', {
          kind: 'adjustment',
          fromLocationId: loc,
          reason: { key: 'other', note: 'Stock initial' },
          lines: [{ itemId: lait['id'], quantity: '3', direction: 'in', unitCost: '800' }],
        })
      ).posted,
    );
    expect(await quantity()).toBe('3');
  });

  describe('critère 7 : sorties par lecture des factures finales', () => {
    it('une `FV` émise → `sale_issue` au passage suivant ; vente de 5 avec 3 en stock → −2 ; aucune écriture côté ventes', async () => {
      const id = await invoice({
        lines: [
          { catalogItemId: catalogId, quantity: '5' },
          { catalogItemId: null, quantity: '1', unit: 'forfait' },
        ],
      });
      const before = await salesFingerprint(f.db());
      const r = await sync();
      expect(r['sales']).toMatchObject({ written: 1 });
      expect(await ofInvoice(id)).toMatchObject([
        {
          kind: 'sale_issue',
          quantity: '-5.000',
          occurredOn: kinshasaToday(),
          locationId: loc,
          costStatus: 'not_applicable',
          sourceKey: `invoice:${id}:0`,
          source: { kind: 'invoice', invoiceId: id, lineIndex: 0 },
        },
      ]);
      expect(await quantity()).toBe('-2');
      // Rejouer : rien de plus.
      await sync();
      expect(await ofInvoice(id)).toHaveLength(1);
      // Empreinte : factures, journal, compteurs, normalisation identiques octet pour octet.
      expect(await salesFingerprint(f.db())).toEqual(before);
    });

    it('`pending_normalization` → rien ; puis `normalized` → sortie', async () => {
      const id = await invoice({
        status: 'pending_normalization',
        lines: [{ catalogItemId: catalogId, quantity: '1' }],
      });
      await sync();
      expect(await ofInvoice(id)).toHaveLength(0);
      // Le circuit DGI (et lui seul) normalise la facture.
      await f
        .db()
        .collection('sales_invoices')
        .updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: 'normalized', normalization: { normalizedAt: new Date() } } },
        );
      const before = await salesFingerprint(f.db());
      await sync();
      expect(await ofInvoice(id)).toHaveLength(1);
      expect(await salesFingerprint(f.db())).toEqual(before);
    });

    it('`normalization_failed` puis retour en brouillon → jamais de sortie ; un acompte `FT` → rien', async () => {
      const failed = await invoice({
        status: 'normalization_failed',
        lines: [{ catalogItemId: catalogId, quantity: '1' }],
      });
      await sync();
      await f
        .db()
        .collection('sales_invoices')
        .updateOne({ _id: new ObjectId(failed) }, { $set: { status: 'draft', issuedAt: null } });
      await sync();
      expect(await ofInvoice(failed)).toHaveLength(0);
      const deposit = await invoice({
        type: 'FT',
        lines: [{ catalogItemId: catalogId, quantity: '2' }],
      });
      await sync();
      expect(await ofInvoice(deposit)).toHaveLength(0);
    });

    it('un avoir `FA` → `sale_return_proposed`, aucune rentrée tant qu’elle n’est pas confirmée', async () => {
      const q = await quantity();
      const credit = await invoice({
        type: 'FA',
        lines: [{ catalogItemId: catalogId, quantity: '2' }],
      });
      await sync();
      expect(await ofInvoice(credit)).toHaveLength(0);
      expect(await quantity()).toBe(q);
      const [line] = await pendingOf(`invoice:${credit}:0`);
      expect(line).toMatchObject({
        reason: 'sale_return_proposed',
        status: 'open',
        proposal: { movementKind: 'sale_return', itemId: lait['id'], maxQuantity: '2' },
      });
      // Au-delà de la quantité créditée : refusé.
      const over = await f.post('storekeeper', `/stock/pending/${line.id}/resolve`, {
        quantity: '3',
        expectedRevision: line.revision,
      });
      f.code(over, 400, 'STOCK_RETURN_EXCEEDS_CREDIT');
      // Confirmée par le Magasinier (1 seul revenu physiquement).
      f.ok(
        await f.post('storekeeper', `/stock/pending/${line.id}/resolve`, {
          quantity: '1',
          expectedRevision: line.revision,
        }),
      );
      expect(await ofInvoice(credit)).toMatchObject([{ kind: 'sale_return', quantity: '1.000' }]);
    });

    it('unité convertie (1 carton = 12) ; unité inconnue → « À traiter » `unknown_unit`', async () => {
      const carton = await invoice({
        lines: [{ catalogItemId: catalogId, quantity: '1', unit: 'carton' }],
      });
      const palette = await invoice({
        lines: [{ catalogItemId: catalogId, quantity: '1', unit: 'palette' }],
      });
      await sync();
      expect(await ofInvoice(carton)).toMatchObject([{ quantity: '-12.000' }]);
      expect(await ofInvoice(palette)).toHaveLength(0);
      expect(await pendingOf(`invoice:${palette}:0`)).toMatchObject([
        { reason: 'unknown_unit', proposal: { unit: 'palette', itemId: lait['id'] } },
      ]);
    });

    it('point de vente rattaché à un emplacement : la sortie se fait à cet emplacement', async () => {
      const shop = f.ok(
        await f.post('owner', '/stock/locations', {
          name: 'Boutique',
          kind: 'shop',
          pointOfSaleIds: ['PV-GOMBE'],
        }),
        201,
      )['id'];
      const id = await invoice({
        pointOfSaleId: 'PV-GOMBE',
        lines: [{ catalogItemId: catalogId, quantity: '1' }],
      });
      await sync();
      expect(await ofInvoice(id)).toMatchObject([{ locationId: shop, quantity: '-1.000' }]);
    });

    it('mode `proposed` : la ligne devient « À traiter » ; confirmée, elle sort', async () => {
      const s = f.ok(await f.get('owner', '/stock/settings'));
      f.ok(
        await f.put('owner', '/stock/settings', {
          salesIssueMode: 'proposed',
          expectedRevision: s['revision'],
        }),
      );
      const id = await invoice({ lines: [{ catalogItemId: catalogId, quantity: '2' }] });
      await sync();
      expect(await ofInvoice(id)).toHaveLength(0);
      const [line] = await pendingOf(`invoice:${id}:0`);
      expect(line).toMatchObject({ reason: 'sale_issue_proposed', proposal: { quantity: '2' } });
      f.ok(
        await f.post('storekeeper', `/stock/pending/${line.id}/resolve`, {
          expectedRevision: line.revision,
        }),
      );
      expect(await ofInvoice(id)).toMatchObject([{ kind: 'sale_issue', quantity: '-2.000' }]);
      const s2 = f.ok(await f.get('owner', '/stock/settings'));
      f.ok(
        await f.put('owner', '/stock/settings', {
          salesIssueMode: 'automatic',
          expectedRevision: s2['revision'],
        }),
      );
    });
  });

  describe('critère 19 : isolation ; factures antérieures à l’activation', () => {
    it('B ne sort rien d’une facture de N ; N ne lit pas les factures de B', async () => {
      // Facture de B émise AVANT l'activation des stocks de B.
      const early = await invoice({
        who: 'ownerB',
        issuedAt: new Date(Date.now() - 3_600_000),
        lines: [{ catalogItemId: catalogId, quantity: '1' }],
      });
      f.ok(await f.get('ownerB', '/stock/settings'));
      const catalogB = f.ok(
        await f.post('ownerB', '/sales/catalog-items', {
          code: 'B-ART',
          name: 'Article B',
          itemType: 'BIE',
          taxGroup: 'B',
          outOfScope: false,
          unitPrice: '10.00',
          priceMode: 'ttc',
          currency: 'CDF',
          unit: 'pièce',
          specificTax: null,
        }),
        201,
      )['id'];
      const itemB = await f.item('Article B', { catalogItemId: catalogB }, 'ownerB');
      // Lier l'article de N dans B : 404 (identifiant forgé d'une autre organisation).
      expect(
        (
          await f.post('ownerB', '/stock/items', {
            name: 'Forgé',
            unit: 'pièce',
            catalogItemId: catalogId,
          })
        ).status,
      ).toBe(404);
      // Facture de B (après activation) qui porte l'article de catalogue de N.
      const forged = await invoice({
        who: 'ownerB',
        lines: [{ catalogItemId: catalogId, quantity: '4' }],
      });
      const qN = await quantity();
      const rB = await sync('ownerB');
      expect(rB['sales']['written']).toBe(0);
      await sync();
      expect(await quantity()).toBe(qN);
      const all = await f
        .db()
        .collection('stock_movements')
        .find({ 'source.invoiceId': { $in: [early, forged] } })
        .toArray();
      expect(all).toHaveLength(0);
      expect(f.ok(await f.get('ownerB', `/stock/items/${itemB['id']}`))['quantity']).toBe('0');
    });
  });

  describe('compléments des écrans S8', () => {
    it('grand livre de tous les articles : filtres, pagination, valeurs masquées, 404 entre organisations', async () => {
      const other = await f.item('Sucre', { costCurrency: 'CDF' });
      f.ok(
        (
          await f.voucher('owner', {
            kind: 'adjustment',
            fromLocationId: loc,
            reason: { key: 'other', note: 'Stock initial' },
            lines: [{ itemId: other['id'], quantity: '7', direction: 'in', unitCost: '500' }],
          })
        ).posted,
      );
      const all = await ledger('?limit=100');
      const items = new Set(all['items'].map((m: any) => m.itemId));
      expect(items.has(lait['id']) && items.has(other['id'])).toBe(true);
      const sucre = all['items'].find((m: any) => m.itemId === other['id']);
      expect(sucre).toMatchObject({
        itemName: 'Sucre',
        unit: 'pièce',
        costCurrency: 'CDF',
        locationName: 'Magasin principal',
        quantity: '7.000',
        unitCost: '500.000000',
        value: '3500.00',
      });
      // Tri du plus récent au plus ancien ; pagination par curseur sans doublon.
      const first = await ledger('?limit=2');
      expect(first['items']).toHaveLength(2);
      const next = await ledger(`?limit=100&cursor=${first['nextCursor']}`);
      const ids = [...first['items'], ...next['items']].map((m: any) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(all['items'].length);
      // Filtres.
      const sales = await ledger('?kind=sale_issue&limit=100');
      expect(sales['items'].every((m: any) => m.kind === 'sale_issue')).toBe(true);
      expect((await ledger(`?itemId=${other['id']}`))['items']).toHaveLength(1);
      // Magasinier : quantités sans valeurs.
      const mag = await ledger('?limit=100', 'storekeeper');
      expect(mag['valuesHidden']).toBe(true);
      expect(mag['items'].every((m: any) => m.unitCost === null && m.value === null)).toBe(true);
      // Isolation : B ne voit rien de N ; un identifiant de N en filtre → 404.
      expect((await ledger('?limit=100', 'ownerB'))['items']).toHaveLength(0);
      expect((await f.get('ownerB', `/stock/movements?itemId=${lait['id']}`)).status).toBe(404);
      expect((await f.get('ownerB', `/stock/movements?locationId=${loc}`)).status).toBe(404);
      expect((await f.get('advisor', '/stock/movements')).status).toBe(403);
    });

    it('`GET /stock/vouchers/:id` : un bon par identifiant ; 404 dans une autre organisation', async () => {
      const { created } = await f.voucher('owner', {
        kind: 'issue',
        fromLocationId: loc,
        lines: [{ itemId: lait['id'], quantity: '1' }],
      });
      expect(f.ok(await f.get('storekeeper', `/stock/vouchers/${created['id']}`))).toMatchObject({
        id: created['id'],
        kind: 'issue',
      });
      expect((await f.get('ownerB', `/stock/vouchers/${created['id']}`)).status).toBe(404);
    });

    it('`canValidate` : celui qui a compté ne valide pas (deux gestionnaires), l’autre le peut ; approbateur unique', async () => {
      const count = f.ok(
        await f.post('owner', '/stock/counts', {
          locationId: loc,
          scope: 'items',
          itemIds: [lait['id']],
          blind: true,
          assignees: [f.userId('accountant')],
        }),
        201,
      );
      const started = f.ok(
        await f.post('owner', `/stock/counts/${count['id']}/start`, {
          expectedRevision: count['revision'],
        }),
      );
      expect(started['canValidate']).toBe(false);
      const counted = f.ok(
        await f.put(
          'accountant',
          `/stock/counts/${count['id']}/lines/${started['lines'][0]['id']}`,
          {
            countedQuantity: '0',
          },
        ),
      );
      const submitted = f.ok(
        await f.post('accountant', `/stock/counts/${count['id']}/submit`, {
          expectedRevision: counted['revision'],
        }),
      );
      // Le Comptable a compté : il ne valide pas (autres détenteurs de `stock.manage`).
      expect(submitted).toMatchObject({
        canValidate: false,
        validationBlockedBy: 'COUNT_SELF_VALIDATION',
      });
      const ownerView = f.ok(await f.get('owner', `/stock/counts/${count['id']}`));
      expect(ownerView).toMatchObject({
        canValidate: true,
        validationAsSoleApprover: false,
        validationBlockedBy: null,
      });
      // Le Magasinier n'a pas `stock.manage`.
      expect(f.ok(await f.get('storekeeper', `/stock/counts/${count['id']}`))['canValidate']).toBe(
        false,
      );
      // La liste porte le même jugement.
      const list = f.ok(await f.get('accountant', '/stock/counts?status=submitted'));
      expect(list['items'].find((c: any) => c.id === count['id'])['canValidate']).toBe(false);
      // L'écran ne propose que ce que l'API accepte.
      f.code(
        await f.post('accountant', `/stock/counts/${count['id']}/validate`, {
          expectedRevision: submitted['revision'],
        }),
        409,
        'COUNT_SELF_VALIDATION',
      );

      // B : un seul détenteur de `stock.manage` — il valide son propre comptage.
      const itemB = await f.item('Article unique', {}, 'ownerB');
      const locB = await f.defaultLocation('ownerB');
      const cB = f.ok(
        await f.post('ownerB', '/stock/counts', {
          locationId: locB,
          scope: 'items',
          itemIds: [itemB['id']],
        }),
        201,
      );
      const sB = f.ok(
        await f.post('ownerB', `/stock/counts/${cB['id']}/start`, {
          expectedRevision: cB['revision'],
        }),
      );
      const lB = f.ok(
        await f.put('ownerB', `/stock/counts/${cB['id']}/lines/${sB['lines'][0]['id']}`, {
          countedQuantity: '2',
          unitCost: '1.00',
        }),
      );
      const subB = f.ok(
        await f.post('ownerB', `/stock/counts/${cB['id']}/submit`, {
          expectedRevision: lB['revision'],
        }),
      );
      expect(subB).toMatchObject({
        canValidate: true,
        validationAsSoleApprover: true,
        validationBlockedBy: null,
      });
      const validated = f.ok(
        await f.post('ownerB', `/stock/counts/${cB['id']}/validate`, {
          expectedRevision: subB['revision'],
        }),
      );
      expect(validated).toMatchObject({
        status: 'validated',
        canValidate: false,
        validation: { soleApprover: true },
      });
    });
  });
});
