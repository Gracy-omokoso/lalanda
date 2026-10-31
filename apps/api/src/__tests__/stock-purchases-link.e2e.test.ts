// Stocks ↔ achats (ADR-0046 § 6.1, critères 3, 4, 5, 11, 19). ADR-0046 — S4.
//
// Le port `PURCHASE_RECEPTION_SINK` de R3 est servi par `StockReceptionSink` : une
// réception enregistrée crée une entrée au coût de la commande (moteur `entryUnitCost`),
// une réception annulée la contre-passe ; un appel perdu est rattrapé par
// `stock.purchase-sync` (ici `POST /stock/sync`) ; rejouer n'écrit rien deux fois. Les
// commandes sont créées par les vraies routes de R3 (demande, approbation, envoi).

import 'reflect-metadata';

import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

import {
  PURCHASE_RECEPTION_SINK,
  type PurchaseReceptionSink,
} from '../purchases/stock-sink.port.js';
import { StockSyncService } from '../stock/links/stock-sync.service.js';
import { StockReceptionSink } from '../stock/purchases/stock-reception.sink.js';
import { e2eSuite } from './e2e-utils.js';
import { useP4Fixture, type P4Account } from './purchases-p4-e2e-fixtures.js';

vi.setConfig({ testTimeout: 180_000 });

const kinshasaToday = (): string => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

e2eSuite('Stocks — branchement des achats (ADR-0046 S4)', () => {
  const f = useP4Fixture('stkpur');
  let supplierId = '';
  let gobelet: Record<string, any> = {};
  let sink: PurchaseReceptionSink;

  /** Commande créée par les routes R3 (avec `itemRef`), approuvée puis envoyée. */
  const order = async (
    lines: {
      quantity: string;
      unitPrice: string;
      unit?: string | null;
      itemRef?: string | null;
      discountPercent?: string | null;
      kind?: 'goods' | 'service';
    }[],
    currency: 'CDF' | 'USD' = 'USD',
    who: P4Account = 'owner',
    supplier = supplierId,
  ): Promise<{ id: string; lines: string[] }> => {
    const approver: P4Account = who === 'ownerB' ? 'ownerB' : 'finance_director';
    const created = f.ok(
      await f.post(who, '/purchases/orders', {
        title: 'Réassort',
        supplierId: supplier,
        currency,
        lines: lines.map((l, i) => ({
          label: `Ligne ${i + 1}`,
          quantity: l.quantity,
          unit: l.unit === undefined ? 'carton' : l.unit,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent ?? null,
          kind: l.kind ?? 'goods',
          category: 'achats',
          workProjectId: null,
          itemRef: l.itemRef ?? null,
        })),
      }),
      201,
    );
    const id = created['id'] as string;
    let o = f.ok(
      await f.post(who, `/purchases/orders/${id}/submit`, {
        expectedRevision: created['revision'],
      }),
    );
    if (o['status'] === 'submitted') {
      o = f.ok(
        await f.post(approver, `/purchases/orders/${id}/approve`, {
          expectedRevision: o['revision'],
        }),
      );
    }
    f.ok(
      await f.post(who, `/purchases/orders/${id}/mark-sent`, { expectedRevision: o['revision'] }),
    );
    return { id, lines: (created['lines'] as { id: string }[]).map((l) => l.id) };
  };

  const receive = async (
    o: { id: string; lines: string[] },
    quantities: string[],
    who: P4Account = 'owner',
  ): Promise<string> =>
    f.ok(
      await f.post(who, '/purchases/receptions', {
        orderId: o.id,
        receivedOn: kinshasaToday(),
        lines: quantities.map((quantity, i) => ({ orderLineId: o.lines[i], quantity })),
      }),
      201,
    )['reception']['id'] as string;

  const movements = async (itemId: string, who: P4Account = 'owner') =>
    f.ok(await f.get(who, `/stock/items/${itemId}/movements`))['items'] as Record<string, any>[];
  const quantity = async (itemId: string) =>
    f.ok(await f.get('owner', `/stock/items/${itemId}`))['quantity'] as string;
  const pending = async (who: P4Account = 'owner') =>
    f.ok(await f.get(who, '/stock/pending?limit=100'))['items'] as Record<string, any>[];
  const sync = async (who: P4Account = 'owner') => f.ok(await f.post(who, '/stock/sync'));

  it('branche le port des achats sur les stocks ; active les stocks de N', async () => {
    // Le fixture des achats remplace la méthode du port par un enregistreur : on rend
    // au fournisseur des stocks son comportement réel.
    sink = f.app().get<PurchaseReceptionSink>(PURCHASE_RECEPTION_SINK);
    expect(sink).toBeInstanceOf(StockReceptionSink);
    delete (sink as unknown as Record<string, unknown>)['onReceptionChanged'];

    f.ok(await f.get('owner', '/stock/settings'));
    supplierId = await f.supplier('owner', 'Plastiques', { defaultCurrency: 'USD' });
    gobelet = f.ok(
      await f.post('owner', '/stock/items', {
        code: 'GOB-1',
        name: 'Gobelet',
        kind: 'goods',
        unit: 'pièce',
        unitConversions: [{ unit: 'carton', factor: '12' }],
        costCurrency: 'USD',
        tracked: true,
        discreteUnit: true,
      }),
      201,
    );
  });

  let firstReception = '';
  it('critère 3 : 6 cartons reçus sur 10 à 12,00 USD → +72 pièces au coût 1,000000 USD', async () => {
    const o = await order([
      { quantity: '10', unitPrice: '12.00', itemRef: `stk:${gobelet['id']}` },
    ]);
    firstReception = await receive(o, ['6']);
    const ms = await movements(gobelet['id']);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({
      kind: 'purchase_receipt',
      quantity: '72.000',
      unitCost: '1.000000',
      costStatus: 'valued',
      occurredOn: kinshasaToday(),
      sourceKey: `reception:${firstReception}:${o.lines[0]}:in`,
      source: { kind: 'reception', receptionId: firstReception, orderLineId: o.lines[0] },
    });
    expect(await quantity(gobelet['id'])).toBe('72');
  });

  it('rejouer le port et le rattrapage n’écrit rien de plus (idempotence)', async () => {
    await sink.onReceptionChanged({
      organizationId: f.orgId(),
      receptionId: firstReception,
      status: 'recorded',
      lines: [],
    });
    const r = await sync();
    expect(r['purchases']['read']).toBeGreaterThanOrEqual(1);
    expect(r['purchases']['written']).toBe(0);
    await f.app().get(StockSyncService).runAll('purchases');
    expect(await movements(gobelet['id'])).toHaveLength(1);
    expect(await quantity(gobelet['id'])).toBe('72');
  });

  it('annuler la réception → −72 (`purchase_receipt_reversal`) même si le stock devient négatif', async () => {
    const loc = f.ok(await f.get('owner', '/stock/settings'))['defaultLocationId'];
    const issue = f.ok(
      await f.post('owner', '/stock/vouchers', {
        kind: 'issue',
        fromLocationId: loc,
        postedOn: kinshasaToday(),
        lines: [{ itemId: gobelet['id'], quantity: '10' }],
      }),
      201,
    );
    f.ok(
      await f.post('owner', `/stock/vouchers/${issue['id']}/post`, {
        expectedRevision: issue['revision'],
      }),
    );
    f.ok(
      await f.post('owner', `/purchases/receptions/${firstReception}/cancel`, {
        reason: 'Livraison refusée',
        expectedRevision: 1,
      }),
    );
    const ms = await movements(gobelet['id']);
    const reversal = ms.find((m) => m.kind === 'purchase_receipt_reversal');
    expect(reversal).toMatchObject({
      quantity: '-72.000',
      costStatus: 'not_applicable',
      sourceKey: `reception:${firstReception}:${ms.find((m) => m.kind === 'purchase_receipt')['source']['orderLineId']}:reversal`,
    });
    expect(await quantity(gobelet['id'])).toBe('-10');
    const fiche = f.ok(await f.get('owner', `/stock/items/${gobelet['id']}`));
    expect(fiche['findings'].map((x: { code: string }) => x.code)).toContain('NEGATIVE_STOCK');
    // Rejouer l'annulation : rien de plus.
    await sync();
    expect((await movements(gobelet['id'])).length).toBe(ms.length);
  });

  it('critère 4 : appel du port perdu → R3 enregistre ; le rattrapage crée l’entrée', async () => {
    const real = Object.getPrototypeOf(sink).onReceptionChanged;
    (sink as unknown as Record<string, unknown>)['onReceptionChanged'] = async () => {
      throw new Error('panne simulée du port de stock');
    };
    try {
      const o = await order([{ quantity: '2', unitPrice: '12.00', itemRef: 'GOB-1' }]);
      await receive(o, ['2']);
    } finally {
      delete (sink as unknown as Record<string, unknown>)['onReceptionChanged'];
    }
    expect(typeof real).toBe('function');
    expect(await quantity(gobelet['id'])).toBe('-10');
    const r = await sync();
    expect(r['purchases']['written']).toBe(1);
    // Résolu par le CODE de l'article (`itemRef = GOB-1`) ; 2 cartons = 24 pièces.
    expect(await quantity(gobelet['id'])).toBe('14');
  });

  it('une ligne de service n’entre jamais en stock', async () => {
    const before = (await movements(gobelet['id'])).length;
    const o = await order([
      { quantity: '1', unitPrice: '30.00', itemRef: `stk:${gobelet['id']}`, kind: 'service' },
    ]);
    await receive(o, ['1']).catch(() => undefined);
    expect((await movements(gobelet['id'])).length).toBe(before);
  });

  describe('critère 5 : ligne inconnue, devise différente', () => {
    let seau: Record<string, any> = {};
    it('`itemRef` libre non reconnu → « À traiter » `unknown_item`, aucun mouvement', async () => {
      seau = f.ok(
        await f.post('owner', '/stock/items', {
          name: 'Seau',
          kind: 'goods',
          unit: 'pièce',
          costCurrency: 'USD',
          tracked: true,
          discreteUnit: true,
        }),
        201,
      );
      const o = await order(
        [{ quantity: '5', unitPrice: '3.00', unit: 'pièce', itemRef: 'SEAU BLEU 10L' }],
        'USD',
      );
      const rec = await receive(o, ['2']);
      const line = (await pending()).find((p) => p.reason === 'unknown_item');
      expect(line).toMatchObject({
        status: 'open',
        proposal: {
          movementKind: 'purchase_receipt',
          movementSourceKey: `reception:${rec}:${o.lines[0]}:in`,
          itemId: null,
          itemRef: 'SEAU BLEU 10L',
          quantity: '2',
          unit: 'pièce',
          unitPrice: '3.00',
          currency: 'USD',
          orderId: o.id,
        },
      });
      expect(await movements(seau['id'])).toHaveLength(0);
      // Rejouer : la même ligne, pas une deuxième.
      await sync();
      expect((await pending()).filter((p) => p.reason === 'unknown_item')).toHaveLength(1);

      // Rattachée : l'entrée est créée au coût de la commande…
      f.ok(
        await f.post('owner', `/stock/pending/${line!['id']}/resolve`, {
          itemId: seau['id'],
          expectedRevision: line!['revision'],
        }),
      );
      expect(await movements(seau['id'])).toMatchObject([
        { kind: 'purchase_receipt', quantity: '2.000', unitCost: '3.000000' },
      ]);
      // … et le rattachement sert à la réception suivante de la même commande.
      await receive(o, ['3']);
      expect(await quantity(seau['id'])).toBe('5');
      expect((await pending()).filter((p) => p.reason === 'unknown_item')).toHaveLength(0);
      await sync();
      expect(await quantity(seau['id'])).toBe('5');
    });

    it('commande en CDF pour un article en USD → `pending_cost`, valorisation incomplète, aucun taux', async () => {
      const o = await order(
        [{ quantity: '4', unitPrice: '2800.00', unit: 'pièce', itemRef: `stk:${seau['id']}` }],
        'CDF',
      );
      await receive(o, ['4']);
      const entry = (await movements(seau['id'])).find((m) => m.costStatus === 'pending_cost');
      expect(entry).toMatchObject({ quantity: '4.000', unitCost: null });
      const fiche = f.ok(await f.get('owner', `/stock/items/${seau['id']}`));
      expect(fiche['valuationComplete']).toBe(false);
      const costLine = (await pending()).find((p) => p.reason === 'pending_cost');
      expect(costLine).toMatchObject({ proposal: { movementId: entry!['id'], currency: 'CDF' } });
      // Le coût saisi DANS LA DEVISE DE L'ARTICLE rétablit la valeur.
      f.ok(
        await f.post('owner', `/stock/pending/${costLine!['id']}/resolve`, {
          unitCost: '1.000000',
          expectedRevision: costLine!['revision'],
        }),
      );
      const after = f.ok(await f.get('owner', `/stock/items/${seau['id']}`));
      expect(after['valuationComplete']).toBe(true);
      // 2 × 3 + 3 × 3 + 4 × 1 = 19,00 USD pour 9 pièces.
      expect(after['value']).toBe('19.00');
    });
  });

  it('critère 11 : seuil 10, cible 30, disponible 4, 8 commandés non reçus → suggestion 18', async () => {
    const pelle = f.ok(
      await f.post('owner', '/stock/items', {
        name: 'Pelle',
        kind: 'material',
        unit: 'pièce',
        costCurrency: 'USD',
        tracked: true,
        discreteUnit: true,
        reorder: { minQuantity: '10', targetQuantity: '30', locationId: null },
        preferredSupplierId: supplierId,
      }),
      201,
    );
    const ref = `stk:${pelle['id']}`;
    const a = await order([{ quantity: '4', unitPrice: '9.00', unit: 'pièce', itemRef: ref }]);
    await receive(a, ['4']);
    await order([{ quantity: '8', unitPrice: '9.00', unit: 'pièce', itemRef: ref }]);
    const ordersBefore = await f.db().collection('purchase_orders').countDocuments();
    const res = f.ok(await f.get('owner', '/stock/replenishment'));
    const s = res['suggestions'].find((x: { itemId: string }) => x.itemId === pelle['id']);
    expect(s).toMatchObject({
      available: '4',
      minQuantity: '10',
      targetQuantity: '30',
      onOrder: '8',
      suggestedQuantity: '18',
      preferredSupplierId: supplierId,
    });
    // Aucune écriture dans les achats.
    expect(await f.db().collection('purchase_orders').countDocuments()).toBe(ordersBefore);
  });

  describe('critère 19 : isolation ; réceptions antérieures à l’activation', () => {
    it('B : une réception antérieure à l’activation n’est pas rejouée', async () => {
      const supB = await f.supplier('ownerB', 'Fournisseur B', { defaultCurrency: 'USD' });
      const o = await order(
        [{ quantity: '3', unitPrice: '1.00', unit: 'pièce', itemRef: 'B-1' }],
        'USD',
        'ownerB',
        supB,
      );
      await receive(o, ['3'], 'ownerB');
      // Activation APRÈS la réception, puis un article qui porterait cette référence.
      f.ok(await f.get('ownerB', '/stock/settings'));
      const itemB = f.ok(
        await f.post('ownerB', '/stock/items', {
          code: 'B-1',
          name: 'Article B',
          kind: 'goods',
          unit: 'pièce',
          costCurrency: 'USD',
          tracked: true,
          discreteUnit: true,
        }),
        201,
      );
      const r = await sync('ownerB');
      expect(r['purchases']['written']).toBe(0);
      expect(await movements(itemB['id'], 'ownerB')).toHaveLength(0);
      expect(await pending('ownerB')).toHaveLength(0);

      // Une référence `stk:` vers un article de N, dans une commande de B : non reconnue.
      const o2 = await order(
        [{ quantity: '1', unitPrice: '1.00', unit: 'pièce', itemRef: `stk:${gobelet['id']}` }],
        'USD',
        'ownerB',
        supB,
      );
      await receive(o2, ['1'], 'ownerB');
      expect((await pending('ownerB')).map((p) => p.reason)).toEqual(['unknown_item']);
      // Rien n'a bougé dans N ; N ne voit ni l'article ni les lignes de B.
      expect(await quantity(gobelet['id'])).toBe('14');
      expect((await f.get('owner', `/stock/items/${itemB['id']}`)).status).toBe(404);
      expect((await pending()).some((p) => p.proposal.orderId === o2.id)).toBe(false);
    });

    it('le rattrapage de N ne lit que les réceptions de N', async () => {
      const service = f.app().get(StockSyncService);
      const conn = f.app().get<Connection>(getConnectionToken());
      const before = await conn.collection('stock_movements').countDocuments({
        organizationId: f.orgId('ownerB'),
      });
      await service.syncOrganization(f.orgId());
      expect(
        await conn
          .collection('stock_movements')
          .countDocuments({ organizationId: f.orgId('ownerB') }),
      ).toBe(before);
    });

    it('`POST /stock/sync` exige `stock.manage`', async () => {
      expect((await f.post('viewer', '/stock/sync')).status).toBe(403);
      expect((await f.post('sales_rep', '/stock/sync')).status).toBe(403);
    });
  });
});
