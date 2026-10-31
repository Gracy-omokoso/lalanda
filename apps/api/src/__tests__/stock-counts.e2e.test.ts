// Inventaires contre la vraie application : comptage à l'aveugle, théorique à l'instant
// du comptage, séparation des tâches, approbateur unique, stock initial (ADR-0046 § 2.7 ;
// critères 1, 2, 10). ADR-0046 — S3.

import 'reflect-metadata';

import { randomBytes } from 'node:crypto';
import { expect, it, vi } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { kinshasaToday, useStockFixture, type StockAccount } from './stock-e2e-fixtures.js';

vi.setConfig({ testTimeout: 120_000 });

e2eSuite('Stocks — inventaires (ADR-0046 S3)', () => {
  const f = useStockFixture(randomBytes(4).toString('hex'));
  let loc = '';
  let itemId = '';

  const adjIn = (id: string, quantity: string, location: string) => ({
    kind: 'adjustment',
    fromLocationId: location,
    reason: { key: 'other', note: 'Stock initial' },
    lines: [{ itemId: id, quantity, direction: 'in', unitCost: '2.00' }],
  });
  const openCount = async (who: StockAccount, location: string, itemIds: string[]) => {
    const created = f.ok(
      await f.post(who, '/stock/counts', { locationId: location, scope: 'items', itemIds }),
      201,
    );
    expect(created).toMatchObject({ status: 'draft', blind: true });
    expect(created['number']).toMatch(/^IV\d{4}-\d{6}$/);
    return f.ok(await f.post(who, `/stock/counts/${created['id']}/start`, { expectedRevision: 1 }));
  };

  it('prépare 20 unités à 2,00', async () => {
    loc = await f.defaultLocation();
    itemId = (await f.item('Peinture', { costCurrency: 'USD' }))['id'];
    f.ok((await f.voucher('owner', adjIn(itemId, '20', loc))).posted);
  });

  it('théorique 20, 3 sortis avant le comptage, compté 16 → écart −1 ; validation → −1', async () => {
    const count = await openCount('owner', loc, [itemId]);
    expect(count['status']).toBe('counting');
    const lineId = count['lines'][0]['id'];

    // Le Magasinier ne crée ni n'ouvre d'inventaire.
    expect((await f.post('storekeeper', '/stock/counts', { locationId: loc })).status).toBe(403);

    // 3 vendus avant le comptage de la ligne : aucun gel du magasin.
    f.ok(
      (
        await f.voucher('storekeeper', {
          kind: 'issue',
          fromLocationId: loc,
          lines: [{ itemId, quantity: '3' }],
        })
      ).posted,
    );
    const counted = f.ok(
      await f.put('storekeeper', `/stock/counts/${count['id']}/lines/${lineId}`, {
        countedQuantity: '16',
      }),
    );
    // Comptage à l'aveugle : le compteur ne reçoit pas la quantité théorique.
    expect(counted['theoreticalHidden']).toBe(true);
    expect(counted['lines'][0]).toMatchObject({
      countedQuantity: '16.000',
      countedBy: f.userId('storekeeper'),
      theoretical: null,
      variance: null,
    });
    // Le coût saisi (stock initial) exige `stock.manage`.
    const denied = await f.put('storekeeper', `/stock/counts/${count['id']}/lines/${lineId}`, {
      countedQuantity: '16',
      unitCost: '2.00',
    });
    expect(denied.status).toBe(403);

    // Un mouvement APRÈS le comptage ne change pas l'écart de la ligne.
    f.ok(
      (
        await f.voucher('storekeeper', {
          kind: 'issue',
          fromLocationId: loc,
          lines: [{ itemId, quantity: '1' }],
        })
      ).posted,
    );
    const submitted = f.ok(
      await f.post('storekeeper', `/stock/counts/${count['id']}/submit`, {
        expectedRevision: counted['revision'],
      }),
    );
    expect(submitted['status']).toBe('submitted');

    // Le Magasinier ne valide pas d'écart.
    const v403 = await f.post('storekeeper', `/stock/counts/${count['id']}/validate`, {
      expectedRevision: submitted['revision'],
    });
    expect(v403.status).toBe(403);
    expect(v403.body).toMatchObject({ action: 'stock.manage', role: 'storekeeper' });
    expect(
      f.ok(await f.get('storekeeper', `/stock/counts/${count['id']}`))['theoreticalHidden'],
    ).toBe(true);

    // Le gestionnaire voit le théorique à l'instant du comptage (17) et l'écart −1.
    const seen = f.ok(await f.get('accountant', `/stock/counts/${count['id']}`));
    expect(seen['lines'][0]).toMatchObject({
      theoretical: '17',
      variance: '-1',
      valuedVariance: '-2.00',
    });

    const validated = f.ok(
      await f.post('owner', `/stock/counts/${count['id']}/validate`, {
        comment: 'RAS',
        expectedRevision: submitted['revision'],
      }),
    );
    expect(validated).toMatchObject({
      status: 'validated',
      validation: { by: f.userId('owner'), soleApprover: false, comment: 'RAS' },
    });
    const adj = await f
      .db()
      .collection('stock_movements')
      .findOne({ sourceKey: `count:${count['id']}:${lineId}` });
    expect(adj).toMatchObject({
      kind: 'count_adjustment',
      quantity: '-1.000',
      occurredOn: kinshasaToday(),
    });
    // 20 − 3 − 1 − 1 = 15.
    const item = f.ok(await f.get('owner', `/stock/items/${itemId}`));
    expect(item['quantity']).toBe('15');
    // Rejouer la validation : déjà validé.
    f.code(
      await f.post('owner', `/stock/counts/${count['id']}/validate`, {
        expectedRevision: validated['revision'],
      }),
      409,
      'STOCK_COUNT_NOT_SUBMITTED',
    );
  });

  it('celui qui a compté une ligne ne valide pas (deux détenteurs et plus) : 409', async () => {
    const count = await openCount('admin', loc, [itemId]);
    const lineId = count['lines'][0]['id'];
    const counted = f.ok(
      await f.put('admin', `/stock/counts/${count['id']}/lines/${lineId}`, {
        countedQuantity: '15',
      }),
    );
    // Recompté par le Magasinier : l'administrateur reste un compteur (historique).
    const recount = f.ok(
      await f.put('storekeeper', `/stock/counts/${count['id']}/lines/${lineId}`, {
        countedQuantity: '15',
      }),
    );
    expect(recount['lines'][0]['recounts']).toHaveLength(1);
    expect(recount['revision']).toBe(counted['revision'] + 1);
    const submitted = f.ok(
      await f.post('admin', `/stock/counts/${count['id']}/submit`, {
        expectedRevision: recount['revision'],
      }),
    );
    f.code(
      await f.post('admin', `/stock/counts/${count['id']}/validate`, {
        expectedRevision: submitted['revision'],
      }),
      409,
      'COUNT_SELF_VALIDATION',
    );
    const ok = f.ok(
      await f.post('finance_director', `/stock/counts/${count['id']}/validate`, {
        expectedRevision: submitted['revision'],
      }),
    );
    expect(ok['validation']['soleApprover']).toBe(false);
    // Aucun écart : aucun mouvement.
    expect(
      await f.db().collection('stock_movements').countDocuments({ 'source.countId': count['id'] }),
    ).toBe(0);
  });

  it('approbateur unique : il valide son propre comptage, marqué et journalisé', async () => {
    const locB = await f.defaultLocation('ownerB');
    const itemB = (await f.item('Article B', { costCurrency: 'USD' }, 'ownerB'))['id'];
    f.ok((await f.voucher('ownerB', adjIn(itemB, '10', locB))).posted);
    const count = await openCount('ownerB', locB, [itemB]);
    const counted = f.ok(
      await f.put('ownerB', `/stock/counts/${count['id']}/lines/${count['lines'][0]['id']}`, {
        countedQuantity: '12',
      }),
    );
    const submitted = f.ok(
      await f.post('ownerB', `/stock/counts/${count['id']}/submit`, {
        expectedRevision: counted['revision'],
      }),
    );
    const validated = f.ok(
      await f.post('ownerB', `/stock/counts/${count['id']}/validate`, {
        expectedRevision: submitted['revision'],
      }),
    );
    expect(validated['validation']['soleApprover']).toBe(true);
    const audit = await f
      .db()
      .collection('audit_events')
      .findOne({ action: 'stock.count_validated', targetId: count['id'] });
    expect(audit?.['metadata']).toMatchObject({ soleApprover: true, adjustments: 1 });
    // Isolation : l'inventaire de B est invisible de N.
    f.code(await f.get('owner', `/stock/counts/${count['id']}`), 404, 'STOCK_COUNT_NOT_FOUND');
  });

  it('stock initial par inventaire : coût saisi valorise l’écart ; sans coût → « À traiter »', async () => {
    const valued = (await f.item('Enduit', { costCurrency: 'USD' }))['id'];
    const unvalued = (await f.item('Colle', { costCurrency: 'USD' }))['id'];
    const count = await openCount('owner', loc, [valued, unvalued]);
    const [l1, l2] = count['lines'];
    f.ok(
      await f.put('owner', `/stock/counts/${count['id']}/lines/${l1['id']}`, {
        countedQuantity: '8',
        unitCost: '5.00',
      }),
    );
    const last = f.ok(
      await f.put('accountant', `/stock/counts/${count['id']}/lines/${l2['id']}`, {
        countedQuantity: '4',
      }),
    );
    const submitted = f.ok(
      await f.post('accountant', `/stock/counts/${count['id']}/submit`, {
        expectedRevision: last['revision'],
      }),
    );
    f.ok(
      await f.post('finance_director', `/stock/counts/${count['id']}/validate`, {
        expectedRevision: submitted['revision'],
      }),
    );
    expect(f.ok(await f.get('owner', `/stock/items/${valued}`))).toMatchObject({
      quantity: '8',
      value: '40.00',
      valuationComplete: true,
    });
    expect(f.ok(await f.get('owner', `/stock/items/${unvalued}`))).toMatchObject({
      quantity: '4',
      valuationComplete: false,
    });
    const pending = f.ok(await f.get('owner', '/stock/pending?reason=pending_cost'));
    expect(pending['items']).toHaveLength(1);
    expect(pending['items'][0]['proposal']).toMatchObject({ itemId: unvalued, quantity: '4.000' });
  });

  it('inventaire incomplet : soumission refusée ; annulation par un compteur', async () => {
    const count = await openCount('owner', loc, [itemId]);
    f.code(
      await f.post('storekeeper', `/stock/counts/${count['id']}/submit`, {
        expectedRevision: count['revision'],
      }),
      409,
      'STOCK_COUNT_INCOMPLETE',
    );
    const cancelled = f.ok(
      await f.post('storekeeper', `/stock/counts/${count['id']}/cancel`, {
        reason: 'Reporté',
        expectedRevision: count['revision'],
      }),
    );
    expect(cancelled['status']).toBe('cancelled');
  });
});
