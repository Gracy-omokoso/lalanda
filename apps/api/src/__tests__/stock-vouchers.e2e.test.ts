// Bons, stock négatif, transferts, idempotence, « À traiter » et concurrence contre la
// vraie application (ADR-0046 § 2.3, § 2.4, § 2.6, O4 ; critères 8, 9). ADR-0046 — S3.

import 'reflect-metadata';

import { stockSourceKey } from '@lalanda/shared/stock';
import { randomBytes } from 'node:crypto';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

import { inTransaction } from '../stock/stock.common.js';
import { StockMovementsService } from '../stock/stock-movements.service.js';
import { StockPendingService } from '../stock/stock-pending.service.js';
import { e2eSuite } from './e2e-utils.js';
import { kinshasaToday, useStockFixture } from './stock-e2e-fixtures.js';

vi.setConfig({ testTimeout: 180_000 });

e2eSuite('Stocks — bons et grand livre (ADR-0046 S3)', () => {
  const f = useStockFixture(randomBytes(4).toString('hex'));
  let loc = '';
  let site = '';
  let itemId = '';

  const level = async (item: string, location: string): Promise<string> => {
    const res = f.ok(await f.get('owner', `/stock/levels?itemId=${item}`));
    return res['levels'].find((l: any) => l.locationId === location)?.quantity ?? '0.000';
  };
  const adjIn = (id: string, quantity: string, unitCost = '2.00') => ({
    kind: 'adjustment',
    fromLocationId: loc,
    reason: { key: 'other', note: 'Stock initial' },
    lines: [{ itemId: id, quantity, direction: 'in', unitCost }],
  });
  const issue = (id: string, quantity: string, from = loc) => ({
    kind: 'issue',
    fromLocationId: from,
    lines: [{ itemId: id, quantity }],
  });

  it('prépare deux emplacements et un article à 3 en stock', async () => {
    loc = await f.defaultLocation();
    site = f.ok(await f.post('owner', '/stock/locations', { name: 'Chantier', kind: 'site' }), 201)[
      'id'
    ];
    itemId = (await f.item('Câble', { costCurrency: 'USD' }))['id'];
    f.ok((await f.voucher('owner', adjIn(itemId, '3'))).posted);
    expect(await level(itemId, loc)).toBe('3.000');
  });

  describe('stock négatif (critère 8, O4)', () => {
    it('bon de sortie de 5 avec 3 en stock → 409 STOCK_INSUFFICIENT, rien n’est écrit', async () => {
      const { created, posted } = await f.voucher('storekeeper', issue(itemId, '5'));
      f.code(posted, 409, 'STOCK_INSUFFICIENT');
      expect(posted.body.details.shortfalls[0]).toMatchObject({
        available: '3',
        requested: '5',
        shortfall: '2',
      });
      expect(await level(itemId, loc)).toBe('3.000');
      const v = f.ok(await f.get('storekeeper', `/stock/vouchers/${created['id']}`));
      expect(v).toMatchObject({
        status: 'draft',
        number: expect.stringMatching(/^BS\d{4}-\d{6}$/),
      });
    });

    it('avec `allowNegativeManualMoves` → 200, stock −2 et alerte `wentNegative`', async () => {
      const s = f.ok(await f.get('owner', '/stock/settings'));
      f.ok(
        await f.put('owner', '/stock/settings', {
          allowNegativeManualMoves: true,
          expectedRevision: s['revision'],
        }),
      );
      const { posted } = await f.voucher('storekeeper', issue(itemId, '5'));
      expect(f.ok(posted)).toMatchObject({ status: 'posted', wentNegative: true });
      expect(await level(itemId, loc)).toBe('-2.000');
      const s2 = f.ok(await f.get('owner', '/stock/settings'));
      f.ok(
        await f.put('owner', '/stock/settings', {
          allowNegativeManualMoves: false,
          expectedRevision: s2['revision'],
        }),
      );
      f.ok((await f.voucher('owner', adjIn(itemId, '12', '2.00'))).posted);
      expect(await level(itemId, loc)).toBe('10.000');
    });

    it('le Magasinier ne fait pas d’ajustement (stock.manage) ; date future refusée', async () => {
      const denied = await f.post('storekeeper', '/stock/vouchers', {
        ...adjIn(itemId, '1'),
        postedOn: kinshasaToday(),
      });
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ code: 'FORBIDDEN', action: 'stock.manage' });
      f.code(
        await f.post('storekeeper', '/stock/vouchers', {
          ...issue(itemId, '1'),
          postedOn: '2999-01-01',
        }),
        400,
        'STOCK_DATE_IN_FUTURE',
      );
      f.code(
        await f.post('owner', '/stock/vouchers', {
          ...adjIn(itemId, '1'),
          reason: { key: 'inconnu' },
          postedOn: kinshasaToday(),
        }),
        400,
        'UNKNOWN_ADJUSTMENT_REASON',
      );
    });
  });

  describe('transfert (critère 9)', () => {
    it('4 du magasin au chantier : deux mouvements appariés, coût moyen inchangé', async () => {
      const before = f.ok(await f.get('owner', `/stock/items/${itemId}`));
      const { created, posted } = await f.voucher('storekeeper', {
        kind: 'transfer',
        fromLocationId: loc,
        toLocationId: site,
        lines: [{ itemId, quantity: '4' }],
      });
      expect(f.ok(posted)['number']).toMatch(/^BT/);
      expect(await level(itemId, loc)).toBe('6.000');
      expect(await level(itemId, site)).toBe('4.000');
      const after = f.ok(await f.get('owner', `/stock/items/${itemId}`));
      expect(after['averageUnitCost']).toBe(before['averageUnitCost']);
      expect(after['value']).toBe(before['value']);
      const moves = await f
        .db()
        .collection('stock_movements')
        .find({ 'source.voucherId': created['id'] })
        .toArray();
      expect(moves.map((m) => [m['kind'], m['quantity']]).sort()).toEqual([
        ['transfer_in', '4.000'],
        ['transfer_out', '-4.000'],
      ]);
      expect(moves[0]!['transferId']).toBe(moves[1]!['transferId']);

      // Annulation : deux contre-mouvements, quantités rétablies.
      const cancelled = f.ok(
        await f.post('storekeeper', `/stock/vouchers/${created['id']}/cancel`, {
          reason: 'Erreur de destination',
          expectedRevision: 2,
        }),
      );
      expect(cancelled['status']).toBe('cancelled');
      expect(await level(itemId, loc)).toBe('10.000');
      expect(await level(itemId, site)).toBe('0.000');
      const all = await f
        .db()
        .collection('stock_movements')
        .find({ 'source.voucherId': created['id'] })
        .toArray();
      expect(all).toHaveLength(4);
      expect(all.filter((m) => m['reversalOf'] !== null)).toHaveLength(2);
      f.code(
        await f.post('storekeeper', `/stock/vouchers/${created['id']}/post`, {
          expectedRevision: 3,
        }),
        409,
        'STOCK_VOUCHER_NOT_DRAFT',
      );
    });
  });

  describe('idempotence par `sourceKey` (point d’extension du lot S4)', () => {
    it('rejouer la même clé n’écrit rien deux fois', async () => {
      const ledger = f.app().get(StockMovementsService);
      const connection = f.app().get<Connection>(getConnectionToken());
      const draft = {
        itemId,
        locationId: loc,
        kind: 'sale_issue' as const,
        quantity: '-1.000',
        occurredOn: kinshasaToday(),
        unitCost: null,
        costStatus: 'not_applicable' as const,
        source: { kind: 'invoice' as const, invoiceId: 'facture-1', lineIndex: 0 },
        sourceKey: stockSourceKey.invoice('facture-1', 0),
      };
      const run = () =>
        inTransaction(connection, (session) =>
          ledger.record(f.orgId(), [draft], { mode: 'observed', actorUserId: 'system', session }),
        );
      const first = await run();
      const second = await run();
      expect(first.written).toHaveLength(1);
      expect(second.written).toHaveLength(0);
      expect(second.skipped).toEqual([draft.sourceKey]);
      expect(await level(itemId, loc)).toBe('9.000');
      expect(
        await f
          .db()
          .collection('stock_movements')
          .countDocuments({ organizationId: f.orgId(), sourceKey: draft.sourceKey }),
      ).toBe(1);
    });
  });

  describe('« À traiter » (§ 2.6)', () => {
    it('ligne inconnue : rattachée à un article, entrée valorisée par le moteur, clé reprise', async () => {
      const pending = f.app().get(StockPendingService);
      const boxed = await f.item('Gobelets', {
        costCurrency: 'USD',
        unitConversions: [{ unit: 'carton', factor: '12' }],
      });
      const input = {
        reason: 'unknown_item' as const,
        sourceKey: 'reception:r1:l1:unknown_item',
        proposal: {
          movementKind: 'purchase_receipt' as const,
          movementSourceKey: stockSourceKey.receptionIn('r1', 'l1'),
          source: { kind: 'reception' as const, receptionId: 'r1', orderLineId: 'l1' },
          itemId: null,
          itemRef: 'GOB-12',
          label: 'Gobelets',
          quantity: '6',
          unit: 'carton',
          occurredOn: kinshasaToday(),
          locationId: null,
          unitPrice: '12.00',
          discountPercent: null,
          currency: 'USD' as const,
          workProjectId: null,
          orderId: 'commande-1',
          movementId: null,
          maxQuantity: null,
          invoicedUnitCost: null,
        },
      };
      const opened = await pending.open(f.orgId(), input);
      expect(opened.created).toBe(true);
      expect((await pending.open(f.orgId(), input)).created).toBe(false);
      const list = f.ok(await f.get('storekeeper', '/stock/pending'));
      expect(list['items']).toHaveLength(1);
      expect(list['items'][0]['proposal']['unitPrice']).toBeNull();
      const resolved = f.ok(
        await f.post('storekeeper', `/stock/pending/${opened.id}/resolve`, {
          itemId: boxed['id'],
          expectedRevision: 1,
        }),
      );
      expect(resolved['status']).toBe('resolved');
      const item = f.ok(await f.get('owner', `/stock/items/${boxed['id']}`));
      expect(item).toMatchObject({ quantity: '72', averageUnitCost: '1.000000', value: '72.00' });
      const m = await f
        .db()
        .collection('stock_movements')
        .findOne({ sourceKey: stockSourceKey.receptionIn('r1', 'l1') });
      expect(m).toMatchObject({
        kind: 'purchase_receipt',
        quantity: '72.000',
        unitCost: '1.000000',
      });
      expect(await pending.resolvedItemFor(f.orgId(), 'commande-1', 'GOB-12')).toBe(boxed['id']);

      // Coût en attente : seul `stock.manage` le résout.
      const cost = await pending.open(f.orgId(), {
        reason: 'pending_cost',
        sourceKey: `pending_cost:${String(m!['_id'])}`,
        proposal: { ...input.proposal, itemId: boxed['id'], movementId: String(m!['_id']) },
      });
      const denied = await f.post('storekeeper', `/stock/pending/${cost.id}/resolve`, {
        unitCost: '1.10',
        expectedRevision: 1,
      });
      expect(denied.status).toBe(403);
      expect(denied.body.action).toBe('stock.manage');
      f.ok(
        await f.post('accountant', `/stock/pending/${cost.id}/resolve`, {
          unitCost: '1.10',
          expectedRevision: 1,
        }),
      );
      const revalued = f.ok(await f.get('owner', `/stock/items/${boxed['id']}`));
      expect(revalued['value']).toBe('79.20');
      f.code(
        await f.get('ownerB', `/stock/vouchers/${String(m!['_id'])}`),
        404,
        'STOCK_VOUCHER_NOT_FOUND',
      );
      f.code(
        await f.post('ownerB', `/stock/pending/${opened.id}/dismiss`, {
          reason: 'x',
          expectedRevision: 2,
        }),
        404,
        'STOCK_PENDING_NOT_FOUND',
      );
    });
  });

  describe('concurrence', () => {
    it('cinq sorties de 2 simultanées sur un stock de 5 : deux passent, le niveau reste juste', async () => {
      const item = (await f.item('Disjoncteurs', { costCurrency: 'USD' }))['id'];
      f.ok((await f.voucher('owner', adjIn(item, '5', '10.00'))).posted);
      const drafts = [];
      for (let i = 0; i < 5; i += 1) {
        drafts.push(
          f.ok(
            await f.post('storekeeper', '/stock/vouchers', {
              ...issue(item, '2'),
              postedOn: kinshasaToday(),
            }),
            201,
          ),
        );
      }
      const results = await Promise.all(
        drafts.map((d) =>
          f.post('storekeeper', `/stock/vouchers/${d['id']}/post`, { expectedRevision: 1 }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses, JSON.stringify(results.map((r) => r.body))).toEqual([
        200, 200, 409, 409, 409,
      ]);
      expect(await level(item, loc)).toBe('1.000');
      const rebuilt = f.ok(await f.post('owner', '/stock/levels/rebuild'));
      expect(rebuilt).toMatchObject({ ok: true });
    });

    it('dix entrées simultanées au même niveau : aucune perdue', async () => {
      const item = (await f.item('Fusibles'))['id'];
      const ledger = f.app().get(StockMovementsService);
      const connection = f.app().get<Connection>(getConnectionToken());
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          inTransaction(connection, (session) =>
            ledger.record(
              f.orgId(),
              [
                {
                  itemId: item,
                  locationId: loc,
                  kind: 'purchase_receipt',
                  quantity: '1.000',
                  occurredOn: kinshasaToday(),
                  unitCost: '1.00',
                  costStatus: 'valued',
                  source: { kind: 'reception', receptionId: `rc${i}`, orderLineId: 'l' },
                  sourceKey: stockSourceKey.receptionIn(`rc${i}`, 'l'),
                },
              ],
              { mode: 'observed', actorUserId: 'system', session },
            ),
          ),
        ),
      );
      expect(await level(item, loc)).toBe('10.000');
    });
  });
});
