// Référentiel, valorisation, droits, isolation et cache des stocks contre la vraie
// application (ADR-0046 § 2.1, § 2.2, § 2.3.1, § 2.5, § 5 ; critères 1, 6, 12, 19).
// ADR-0046 — S3.

import 'reflect-metadata';

import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import { StockLevelsCheckJob } from '../stock/stock-levels-check.job.js';
import { e2eSuite } from './e2e-utils.js';
import { kinshasaToday, useStockFixture } from './stock-e2e-fixtures.js';

vi.setConfig({ testTimeout: 120_000 });

e2eSuite('Stocks — référentiel et valorisation (ADR-0046 S3)', () => {
  const f = useStockFixture(randomBytes(4).toString('hex'));
  let loc = '';
  let itemId = '';
  const adjIn = (id: string, quantity: string, unitCost?: string) => ({
    kind: 'adjustment',
    fromLocationId: loc,
    reason: { key: 'entry_error', note: 'Stock initial' },
    lines: [{ itemId: id, quantity, direction: 'in', ...(unitCost ? { unitCost } : {}) }],
  });

  describe('activation, articles et emplacements', () => {
    it('le premier accès crée « Magasin principal » et les réglages par défaut', async () => {
      const list = f.ok(await f.get('owner', '/stock/locations'));
      expect(list['items']).toEqual([
        expect.objectContaining({ name: 'Magasin principal', isDefault: true, active: true }),
      ]);
      loc = list['items'][0]['id'];
      const settings = f.ok(await f.get('storekeeper', '/stock/settings'));
      expect(settings).toMatchObject({
        salesIssueMode: 'automatic',
        allowNegativeManualMoves: false,
        defaultCostCurrency: 'CDF',
        defaultLocationId: loc,
      });
      expect(settings['adjustmentReasons']).toHaveLength(7);
    });

    it('crée un article ; code unique ; conversions ; devise par défaut des réglages', async () => {
      const item = await f.item('Ciment 50 kg', {
        code: 'cim 50',
        unit: 'sac',
        unitConversions: [{ unit: 'palette', factor: '40' }],
        costCurrency: 'USD',
      });
      itemId = item['id'];
      expect(item).toMatchObject({
        code: 'cim 50',
        unit: 'sac',
        costCurrency: 'USD',
        quantity: '0',
        hasMovements: false,
        valuesHidden: false,
      });
      f.code(
        await f.post('owner', '/stock/items', { name: 'Autre', unit: 'sac', code: 'CIM50' }),
        409,
        'STOCK_ITEM_CODE_EXISTS',
      );
      const cdf = await f.item('Gants');
      expect(cdf['costCurrency']).toBe('CDF');
      f.code(
        await f.post('owner', '/stock/items', {
          name: 'X',
          unit: 'sac',
          unitConversions: [{ unit: 'Sac', factor: '1' }],
        }),
        400,
        'UNIT_CONVERSION_IS_STOCK_UNIT',
      );
    });

    it('lien au catalogue : BIE seulement, une seule fois, dans l’organisation', async () => {
      const cat = f.db().collection('catalog_items');
      const ser = await cat.insertOne({ organizationId: f.orgId(), itemType: 'SER', name: 's' });
      const bie = await cat.insertOne({ organizationId: f.orgId(), itemType: 'BIE', name: 'b' });
      const other = await cat.insertOne({
        organizationId: f.orgId('ownerB'),
        itemType: 'BIE',
        name: 'b',
      });
      f.code(
        await f.post('owner', '/stock/items', {
          name: 'Service',
          unit: 'h',
          catalogItemId: String(ser.insertedId),
        }),
        422,
        'CATALOG_ITEM_NOT_STOCKABLE',
      );
      await f.item('Lié', { catalogItemId: String(bie.insertedId) });
      f.code(
        await f.post('owner', '/stock/items', {
          name: 'Lié 2',
          unit: 'u',
          catalogItemId: String(bie.insertedId),
        }),
        409,
        'CATALOG_ITEM_ALREADY_STOCKED',
      );
      f.code(
        await f.post('owner', '/stock/items', {
          name: 'Forgé',
          unit: 'u',
          catalogItemId: String(other.insertedId),
        }),
        404,
        'CATALOG_ITEM_NOT_FOUND',
      );
    });

    it('emplacements : nom unique, défaut non archivable, archivage refusé si non vide', async () => {
      const site = f.ok(
        await f.post('admin', '/stock/locations', { name: 'Chantier Gombe', kind: 'site' }),
        201,
      );
      f.code(
        await f.post('admin', '/stock/locations', { name: 'chantier  gombe' }),
        409,
        'STOCK_LOCATION_NAME_EXISTS',
      );
      f.code(
        await f.post('owner', `/stock/locations/${loc}/archive`, { expectedRevision: 1 }),
        409,
        'STOCK_LOCATION_IS_DEFAULT',
      );
      const archived = f.ok(
        await f.post('owner', `/stock/locations/${site['id']}/archive`, { expectedRevision: 1 }),
      );
      expect(archived['active']).toBe(false);
    });
  });

  describe('coût moyen pondéré (critère 6)', () => {
    let firstEntry = '';

    it('10 à 2,00 puis 10 à 3,00 → 2,50 ; sortie de 5 → 37,50 ; 5 à 4,00 → 2,875', async () => {
      f.ok((await f.voucher('owner', adjIn(itemId, '10', '2.00'))).posted);
      f.ok((await f.voucher('owner', adjIn(itemId, '10', '3.00'))).posted);
      let item = f.ok(await f.get('owner', `/stock/items/${itemId}`));
      expect(item).toMatchObject({ quantity: '20', averageUnitCost: '2.500000', value: '50.00' });
      f.ok(
        (
          await f.voucher('storekeeper', {
            kind: 'issue',
            fromLocationId: loc,
            lines: [{ itemId, quantity: '5' }],
          })
        ).posted,
      );
      item = f.ok(await f.get('owner', `/stock/items/${itemId}`));
      expect(item).toMatchObject({ quantity: '15', value: '37.50' });
      f.ok((await f.voucher('owner', adjIn(itemId, '5', '4.00'))).posted);
      item = f.ok(await f.get('owner', `/stock/items/${itemId}`));
      expect(item).toMatchObject({ quantity: '20', averageUnitCost: '2.875000', value: '57.50' });
      expect(item['levels']).toEqual([
        { locationId: loc, locationName: 'Magasin principal', quantity: '20.000' },
      ]);
      expect(item['hasMovements']).toBe(true);

      const movements = f.ok(await f.get('owner', `/stock/items/${itemId}/movements?limit=10`));
      expect(movements['items']).toHaveLength(4);
      const exit = movements['items'].find((m: any) => m.kind === 'issue');
      expect(exit).toMatchObject({
        quantity: '-5.000',
        value: '12.50',
        costStatus: 'not_applicable',
      });
      firstEntry = movements['items'][movements['items'].length - 1]['id'];
    });

    it('corriger après coup la première entrée à 2,20 recalcule par rejeu ; audit strict', async () => {
      f.code(
        await f.put('storekeeper', `/stock/movements/${firstEntry}/cost`, {
          unitCost: '2.20',
          reason: 'Facture',
          expectedRevision: 1,
        }),
        403,
        'FORBIDDEN',
      );
      const corrected = f.ok(
        await f.put('accountant', `/stock/movements/${firstEntry}/cost`, {
          unitCost: '2.20',
          reason: 'Prix de la facture fournisseur',
          expectedRevision: 1,
        }),
      );
      expect(corrected).toMatchObject({ unitCost: '2.200000', costStatus: 'valued', revision: 2 });
      const item = f.ok(await f.get('owner', `/stock/items/${itemId}`));
      // Entrées 22 + 30 = 52 (CMUP 2,60) ; sortie 5 → 13 ; reste 39 + 20 = 59 pour 20.
      expect(item).toMatchObject({ quantity: '20', averageUnitCost: '2.950000', value: '59.00' });
      const audit = await f
        .db()
        .collection('audit_events')
        .findOne({ action: 'stock.entry_cost_changed', targetId: firstEntry });
      expect(audit?.['metadata']).toMatchObject({
        before: { unitCost: '2.000000' },
        after: { unitCost: '2.200000' },
      });
      f.code(
        await f.put('accountant', `/stock/movements/${firstEntry}/cost`, {
          unitCost: '2.30',
          reason: 'x',
          expectedRevision: 1,
        }),
        409,
        'STALE_REVISION',
      );
    });

    it('valorisation à une date, par devise, sans total toutes devises', async () => {
      const val = f.ok(await f.get('finance_director', `/stock/valuation?on=${kinshasaToday()}`));
      expect(val['byCurrency']).toEqual([
        { currency: 'USD', value: '59.00', itemCount: 1, complete: true },
      ]);
      f.code(await f.get('storekeeper', '/stock/valuation'), 403, 'FORBIDDEN');
      const report = f.ok(
        await f.get('owner', `/stock/reports?from=2026-01-01&to=${kinshasaToday()}`),
      );
      expect(report['valuesHidden']).toBe(false);
      expect(report['byCurrency'][0]).toMatchObject({ currency: 'USD', closingValue: '59.00' });
    });

    it('unité verrouillée après un mouvement ; archivage refusé si la quantité n’est pas nulle', async () => {
      const item = f.ok(await f.get('owner', `/stock/items/${itemId}`));
      f.code(
        await f.put('owner', `/stock/items/${itemId}`, {
          unit: 'kg',
          expectedRevision: item['revision'],
        }),
        409,
        'STOCK_ITEM_UNIT_LOCKED',
      );
      f.code(
        await f.post('owner', `/stock/items/${itemId}/archive`, {
          expectedRevision: item['revision'],
        }),
        409,
        'STOCK_ITEM_NOT_EMPTY',
      );
    });
  });

  describe('droits effectifs (critère 1)', () => {
    it('le Magasinier lit les quantités sans valeurs et ne gère pas le référentiel', async () => {
      const item = f.ok(await f.get('storekeeper', `/stock/items/${itemId}`));
      expect(item).toMatchObject({
        quantity: '20',
        valuesHidden: true,
        value: null,
        averageUnitCost: null,
        valuationComplete: null,
      });
      const moves = f.ok(await f.get('storekeeper', `/stock/items/${itemId}/movements`));
      expect(moves['valuesHidden']).toBe(true);
      for (const m of moves['items']) {
        expect(m.unitCost).toBeNull();
        expect(m.value).toBeNull();
      }
      const denied = await f.post('storekeeper', '/stock/items', { name: 'X', unit: 'u' });
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ action: 'stock.manage', role: 'storekeeper' });
      const report = f.ok(
        await f.get('storekeeper', `/stock/reports?from=2026-01-01&to=${kinshasaToday()}`),
      );
      expect(report['valuesHidden']).toBe(true);
      expect(report['byCurrency'][0]['closingValue']).toBeNull();
    });

    it('Commercial : quantités sans valeur ; RH et Conseiller : 403', async () => {
      const list = f.ok(await f.get('sales_rep', '/stock/items'));
      expect(list['valuesHidden']).toBe(true);
      expect(list['items'].every((i: any) => i.value === null)).toBe(true);
      expect((await f.get('hr_manager', '/stock/items')).status).toBe(403);
      expect((await f.get('advisor', '/stock/items')).status).toBe(403);
      expect((await f.get('advisor', '/stock/levels')).status).toBe(403);
    });
  });

  describe('isolation entre organisations (critère 19)', () => {
    it('toute ressource d’une autre organisation répond 404, y compris par corps forgé', async () => {
      f.code(await f.get('ownerB', `/stock/items/${itemId}`), 404, 'STOCK_ITEM_NOT_FOUND');
      f.code(
        await f.get('ownerB', `/stock/items/${itemId}/movements`),
        404,
        'STOCK_ITEM_NOT_FOUND',
      );
      f.code(
        await f.put('ownerB', `/stock/items/${itemId}`, { name: 'x', expectedRevision: 1 }),
        404,
        'STOCK_ITEM_NOT_FOUND',
      );
      const locB = await f.defaultLocation('ownerB');
      expect(locB).not.toBe(loc);
      // Article de N dans un bon de B.
      f.code(
        await f.post('ownerB', '/stock/vouchers', {
          kind: 'issue',
          fromLocationId: locB,
          postedOn: kinshasaToday(),
          lines: [{ itemId, quantity: '1' }],
        }),
        404,
        'STOCK_ITEM_NOT_FOUND',
      );
      // Emplacement de N dans un bon et un article de B.
      const itemB = await f.item('Article B', {}, 'ownerB');
      f.code(
        await f.post('ownerB', '/stock/vouchers', {
          kind: 'issue',
          fromLocationId: loc,
          postedOn: kinshasaToday(),
          lines: [{ itemId: itemB['id'], quantity: '1' }],
        }),
        404,
        'STOCK_LOCATION_NOT_FOUND',
      );
      f.code(
        await f.post('ownerB', '/stock/items', { name: 'Y', unit: 'u', defaultLocationId: loc }),
        404,
        'STOCK_LOCATION_NOT_FOUND',
      );
      const moves = f.ok(await f.get('owner', `/stock/items/${itemId}/movements`));
      f.code(
        await f.put('ownerB', `/stock/movements/${moves['items'][0]['id']}/cost`, {
          unitCost: '1',
          reason: 'x',
          expectedRevision: 1,
        }),
        404,
        'STOCK_MOVEMENT_NOT_FOUND',
      );
      f.code(
        await f.post('ownerB', '/stock/counts', { locationId: loc }),
        404,
        'STOCK_LOCATION_NOT_FOUND',
      );
      const levelsB = f.ok(await f.get('ownerB', '/stock/levels'));
      expect(levelsB['levels'].some((l: any) => l.itemId === itemId)).toBe(false);
      const projectB = await f
        .db()
        .collection('work_projects')
        .insertOne({
          organizationId: f.orgId('ownerB'),
          name: 'P',
        });
      f.code(
        await f.post('owner', '/stock/locations', {
          name: 'Forgé',
          workProjectId: String(projectB.insertedId),
        }),
        404,
        'WORK_PROJECT_NOT_FOUND',
      );
    });
  });

  describe('seuils et cache (critères 11 et 12)', () => {
    it('seuil 10, cible 30, disponible 4 → suggestion 26, aucune écriture', async () => {
      const item = await f.item('Vis', {
        discreteUnit: true,
        reorder: { minQuantity: '10', targetQuantity: '30', locationId: null },
      });
      f.ok((await f.voucher('owner', adjIn(item['id'], '4', '1.00'))).posted);
      const repl = f.ok(await f.get('storekeeper', '/stock/replenishment'));
      expect(repl['suggestions']).toEqual([
        expect.objectContaining({
          itemId: item['id'],
          available: '4',
          suggestedQuantity: '26',
          itemName: 'Vis',
        }),
      ]);
      const below = f.ok(await f.get('sales_rep', '/stock/levels?below=reorder'));
      expect(below['belowReorder']).toHaveLength(1);
      expect(below['levels'].map((l: any) => l.itemId)).toEqual([item['id']]);
      expect(await f.db().collection('purchase_orders').countDocuments({})).toBe(0);
    });

    it('cache altéré : la tâche signale STOCK_LEVEL_DRIFT, `rebuild` rétablit le grand livre', async () => {
      await f
        .db()
        .collection('stock_levels')
        .updateOne(
          { organizationId: f.orgId(), itemId, locationId: loc },
          { $set: { quantity: new (await import('mongodb')).Decimal128('999.000') } },
        );
      const check = await f.app().get(StockLevelsCheckJob).run();
      expect(check.drifts).toBeGreaterThanOrEqual(1);
      f.code(await f.post('storekeeper', '/stock/levels/rebuild'), 403, 'FORBIDDEN');
      const rebuilt = f.ok(await f.post('owner', '/stock/levels/rebuild'));
      expect(rebuilt).toMatchObject({ ok: false, rebuilt: 1 });
      expect(rebuilt['drifts'][0]).toMatchObject({
        code: 'STOCK_LEVEL_DRIFT',
        itemId,
        cached: '999',
        ledger: '20',
      });
      const again = f.ok(await f.post('owner', '/stock/levels/rebuild'));
      expect(again).toMatchObject({ ok: true, rebuilt: 0 });
      const item = f.ok(await f.get('owner', `/stock/items/${itemId}`));
      expect(item['levels'][0]['quantity']).toBe('20.000');
      expect(ObjectId.isValid(itemId)).toBe(true);
    });
  });
});
