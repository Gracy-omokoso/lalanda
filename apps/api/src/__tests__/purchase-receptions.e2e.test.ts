// Réceptions contre la vraie application (ADR-0044 § 2.4, § 2.7, § 3.4, § 6.6 ;
// critères 7 et 17). ADR-0044 — P4.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleur → MongoDB. Couvre : statut de la commande DÉRIVÉ des réceptions par le
// moteur et dénormalisé (partielle, complète, excédent, annulation), commandes non
// réceptionnables, date future, lignes forgées, port de stock appelé, pièce jointe
// (PDF inerte, type refusé, réception annulée), liste paginée, droits et isolation.
//
// Les commandes (lot P3) sont posées dans `purchase_orders` au modèle de l'ADR.

import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { useP4Fixture } from './purchases-p4-e2e-fixtures.js';

vi.setConfig({ testTimeout: 120_000 });

const kinshasaToday = (): string => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

e2eSuite('Réceptions (ADR-0044 P4)', () => {
  const f = useP4Fixture('achrecep');
  let supplierId = '';
  let orderId = '';

  const reception = (orderLineId: string, quantity: string, id = orderId, extra = {}) => ({
    orderId: id,
    receivedOn: kinshasaToday(),
    lines: [{ orderLineId, quantity }],
    ...extra,
  });

  it('prépare un fournisseur et une commande envoyée (10 + 2, plus un service)', async () => {
    supplierId = await f.supplier('owner', 'Socimex', { defaultCurrency: 'USD' });
    orderId = await f.seedOrder({
      supplierId,
      approvedTotal: '170.00',
      lines: [
        { id: 'l1', quantity: '10', unitPrice: '5.00' },
        { id: 'l2', quantity: '2', unitPrice: '50.00' },
        { id: 's1', quantity: '1', unitPrice: '20.00', kind: 'service' },
      ],
    });
  });

  it('réception partielle : commande `partially_received`, reste à recevoir, port de stock', async () => {
    const res = f.ok(
      await f.post('admin', '/purchases/receptions', {
        ...reception('l1', '6'),
        deliveryNoteRef: 'BL-001',
        note: 'Livraison du matin',
      }),
      201,
    );
    expect(res['reception']).toMatchObject({
      orderId,
      orderNumber: expect.stringMatching(/^BC/),
      supplierId,
      status: 'recorded',
      deliveryNoteRef: 'BL-001',
      lines: [{ orderLineId: 'l1', quantity: '6', label: 'Ligne l1', unit: 'pièce' }],
      revision: 1,
    });
    expect(res['order']['status']).toBe('partially_received');
    expect(res['order']['lines'][0]).toMatchObject({
      orderLineId: 'l1',
      ordered: '10',
      received: '6',
      remaining: '4',
    });
    const order = await f.order(orderId);
    expect(order['status']).toBe('partially_received');
    expect(order['revision']).toBe(2);
    expect(f.stockChanges.at(-1)).toMatchObject({
      receptionId: res['reception']['id'],
      status: 'recorded',
      lines: [{ orderLineId: 'l1', itemRef: null, quantity: '6', unit: 'pièce' }],
    });
    const audit = await f
      .db()
      .collection('audit_events')
      .findOne({ action: 'purchase_reception.recorded', targetId: res['reception']['id'] });
    expect(audit).not.toBeNull();
  });

  it('réception complète puis excédent : `received`, excédent rendu, jamais refusé', async () => {
    const full = f.ok(
      await f.post('accountant', '/purchases/receptions', {
        orderId,
        receivedOn: kinshasaToday(),
        lines: [
          { orderLineId: 'l1', quantity: '4' },
          { orderLineId: 'l2', quantity: '2' },
        ],
      }),
      201,
    );
    expect(full['order']['status']).toBe('received');
    const over = f.ok(await f.post('owner', '/purchases/receptions', reception('l2', '1')), 201);
    expect(over['order']['status']).toBe('received');
    expect(over['order']['lines'][1]).toMatchObject({ received: '3', overReceived: '1' });

    // Annuler la réception complète : la commande redevient partiellement reçue.
    const cancelled = f.ok(
      await f.post('admin', `/purchases/receptions/${full['reception']['id']}/cancel`, {
        reason: 'Saisie en double',
        expectedRevision: 1,
      }),
    );
    expect(cancelled['reception']).toMatchObject({
      status: 'cancelled',
      cancellation: { reason: 'Saisie en double', by: f.userId('admin') },
      revision: 2,
    });
    expect(cancelled['order']['status']).toBe('partially_received');
    expect((await f.order(orderId))['status']).toBe('partially_received');
    expect(f.stockChanges.at(-1)).toMatchObject({ status: 'cancelled' });

    f.code(
      await f.post('admin', `/purchases/receptions/${full['reception']['id']}/cancel`, {
        reason: 'Encore',
        expectedRevision: 2,
      }),
      409,
      'PURCHASE_RECEPTION_CANCELLED',
    );
  });

  it('révision périmée : 409 STALE_REVISION', async () => {
    const r = f.ok(await f.post('owner', '/purchases/receptions', reception('s1', '1')), 201);
    f.code(
      await f.post('owner', `/purchases/receptions/${r['reception']['id']}/cancel`, {
        reason: 'x',
        expectedRevision: 7,
      }),
      409,
      'STALE_REVISION',
    );
  });

  it('commande approuvée non envoyée : réceptionnable (livraison sur appel)', async () => {
    const id = await f.seedOrder({
      supplierId,
      sent: false,
      approvedTotal: '10.00',
      lines: [{ id: 'a', quantity: '2', unitPrice: '5.00' }],
    });
    const res = f.ok(await f.post('owner', '/purchases/receptions', reception('a', '1', id)), 201);
    expect(res['order']['status']).toBe('partially_received');
  });

  it('commande non réceptionnable, date future, lignes forgées ou en double', async () => {
    for (const status of ['closed', 'cancelled']) {
      const id = await f.seedOrder({
        supplierId,
        status,
        lines: [{ id: 'x', quantity: '1', unitPrice: '1.00' }],
      });
      f.code(
        await f.post('owner', '/purchases/receptions', reception('x', '1', id)),
        409,
        'PURCHASE_ORDER_NOT_RECEIVABLE',
      );
    }
    const request = await f.seedOrder({
      supplierId,
      phase: 'request',
      status: 'submitted',
      lines: [{ id: 'x', quantity: '1', unitPrice: '1.00' }],
    });
    f.code(
      await f.post('owner', '/purchases/receptions', reception('x', '1', request)),
      409,
      'PURCHASE_ORDER_NOT_RECEIVABLE',
    );
    f.code(
      await f.post('owner', '/purchases/receptions', {
        ...reception('l1', '1'),
        receivedOn: addDays(kinshasaToday(), 2),
      }),
      400,
      'PURCHASE_DATE_IN_FUTURE',
    );
    f.code(
      await f.post('owner', '/purchases/receptions', reception('inconnue', '1')),
      404,
      'PURCHASE_ORDER_LINE_NOT_FOUND',
    );
    f.code(
      await f.post('owner', '/purchases/receptions', {
        orderId,
        receivedOn: kinshasaToday(),
        lines: [
          { orderLineId: 'l1', quantity: '1' },
          { orderLineId: 'l1', quantity: '1' },
        ],
      }),
      400,
      'DUPLICATE_LINE',
    );
    f.code(
      await f.post('owner', '/purchases/receptions', reception('l1', '0')),
      400,
      'INVALID_REQUEST',
    );
    f.code(
      await f.post('owner', '/purchases/receptions', { ...reception('l1', '1'), extra: 1 }),
      400,
      'INVALID_REQUEST',
    );
  });

  it('liste filtrée par commande, paginée par curseur, et fiche', async () => {
    const first = f.ok(await f.get('viewer', `/purchases/receptions?orderId=${orderId}&limit=2`));
    expect(first['items']).toHaveLength(2);
    expect(first['nextCursor']).toEqual(expect.any(String));
    const next = f.ok(
      await f.get(
        'viewer',
        `/purchases/receptions?orderId=${orderId}&limit=2&cursor=${first['nextCursor']}`,
      ),
    );
    const ids = [...first['items'], ...next['items']].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(4);
    f.code(await f.get('viewer', '/purchases/receptions?cursor=@@'), 400, 'INVALID_CURSOR');
    const one = f.ok(await f.get('viewer', `/purchases/receptions/${ids[0]}`));
    expect(one['id']).toBe(ids[0]);
  });

  it('pièce jointe : PDF servi en téléchargement inerte ; autre type 415 ; réception annulée 409', async () => {
    const r = f.ok(await f.post('owner', '/purchases/receptions', reception('l1', '1')), 201);
    const id = r['reception']['id'];
    const up = await f
      .postRaw('admin', `/purchases/receptions/${id}/attachment`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent('bon de livraison.pdf'))
      .send(PDF);
    const view = f.ok(up, 201);
    expect(view['attachment']).toMatchObject({
      fileName: 'bon de livraison.pdf',
      contentType: 'application/pdf',
      size: PDF.length,
      uploadedBy: f.userId('admin'),
    });
    expect([...f.objects.keys()].some((k) => k.includes('purchase-attachments/'))).toBe(true);
    const dl = await f.get('viewer', `/purchases/receptions/${id}/attachment`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-security-policy']).toContain('sandbox');

    const html = await f
      .postRaw('admin', `/purchases/receptions/${id}/attachment`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'facture.pdf')
      .send(Buffer.from('<html><script>alert(1)</script></html>'));
    f.code(html, 415, 'PURCHASE_ATTACHMENT_TYPE');

    f.ok(
      await f.post('owner', `/purchases/receptions/${id}/cancel`, {
        reason: 'Erreur',
        expectedRevision: 2,
      }),
    );
    const late = await f
      .postRaw('admin', `/purchases/receptions/${id}/attachment`)
      .set('Content-Type', 'application/octet-stream')
      .send(PDF);
    f.code(late, 409, 'PURCHASE_RECEPTION_CANCELLED');
    // Une réception sans pièce : 404.
    const bare = f.ok(await f.post('owner', '/purchases/receptions', reception('l2', '1')), 201);
    f.code(
      await f.get('viewer', `/purchases/receptions/${bare['reception']['id']}/attachment`),
      404,
      'PURCHASE_ATTACHMENT_NOT_FOUND',
    );
  });

  describe('droits (§ 4.1) et isolation (critère 17)', () => {
    it('lecture : Lecteur oui ; Commercial non. Écriture : Analyste et Lecteur non', async () => {
      f.ok(await f.get('viewer', '/purchases/receptions'));
      f.ok(await f.get('analyst', '/purchases/receptions'));
      expect((await f.get('sales_rep', '/purchases/receptions')).status).toBe(403);
      for (const who of ['analyst', 'viewer', 'sales_rep'] as const) {
        expect((await f.post(who, '/purchases/receptions', reception('l1', '1'))).status).toBe(
          403,
        );
      }
    });

    it('une autre organisation : commande, réception et pièce introuvables (404)', async () => {
      const mine = f.ok(await f.post('owner', '/purchases/receptions', reception('l1', '1')), 201);
      const id = mine['reception']['id'];
      f.code(
        await f.post('ownerB', '/purchases/receptions', reception('l1', '1')),
        404,
        'PURCHASE_ORDER_NOT_FOUND',
      );
      f.code(await f.get('ownerB', `/purchases/receptions/${id}`), 404, 'PURCHASE_RECEPTION_NOT_FOUND');
      f.code(
        await f.post('ownerB', `/purchases/receptions/${id}/cancel`, {
          reason: 'x',
          expectedRevision: 1,
        }),
        404,
        'PURCHASE_RECEPTION_NOT_FOUND',
      );
      f.code(
        await f.get('ownerB', `/purchases/receptions/${id}/attachment`),
        404,
        'PURCHASE_RECEPTION_NOT_FOUND',
      );
      const listB = f.ok(await f.get('ownerB', `/purchases/receptions?orderId=${orderId}`));
      expect(listB['items']).toEqual([]);
      f.code(await f.get('owner', '/purchases/receptions/zzz'), 404, 'PURCHASE_RECEPTION_NOT_FOUND');
    });
  });
});
