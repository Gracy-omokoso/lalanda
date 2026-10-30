// Factures fournisseurs et rapprochement contre la vraie application (ADR-0044
// § 2.5, § 2.7, § 3.5, § 5 ; critères 7, 8, 9, 17). ADR-0044 — P4.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleurs → MongoDB. Couvre : facture sans commande (numéro FF, échéance déduite
// des conditions, reste dû sur la fiche, archivage refusé), contrôles d'addition et
// d'imputation, doublon de référence normalisée, trois voies (écart, refus de
// validation, notification aux approbateurs, forçage motivé et séparation des tâches,
// audit strict), litige puis correction, deux voies et tolérance de prix, réception
// qui recalcule un brouillon, préremplissage depuis une commande, avoir, paiement
// (lot P5) lu pour le reste à payer et l'annulation, approbateur unique, pièce PDF
// inerte, droits et isolation.
//
// Les commandes sont créées par les routes du lot P3 (fixture).

import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { useP4Fixture } from './purchases-p4-e2e-fixtures.js';

vi.setConfig({ testTimeout: 120_000 });

const kinshasaToday = (): string => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

e2eSuite('Factures fournisseurs et rapprochement (ADR-0044 P4)', () => {
  const f = useP4Fixture('achfact');
  let supplierId = '';
  let otherSupplierId = '';
  let ref = 0;
  const nextRef = () => `FA-${++ref}`;

  /** Facture sans commande, à une imputation. */
  const plain = (extra: Record<string, unknown> = {}) => ({
    supplierId,
    supplierReference: nextRef(),
    invoiceDate: kinshasaToday(),
    currency: 'USD',
    subtotal: '100.00',
    taxes: [{ label: 'TVA 16 %', amount: '16.00' }],
    total: '116.00',
    ...extra,
  });

  it('prépare deux fournisseurs (net 30, catégorie « achats »)', async () => {
    supplierId = await f.supplier('owner', 'Socimex', {
      defaultCurrency: 'USD',
      defaultCategory: 'achats',
      paymentTerms: { kind: 'net', days: 30 },
    });
    otherSupplierId = await f.supplier('owner', 'Batiplus', { defaultCategory: 'achats' });
  });

  describe('facture sans commande', () => {
    it('brouillon FF, non rapprochée, échéance déduite ; validée, elle devient une dette', async () => {
      const draft = f.ok(await f.post('admin', '/purchases/invoices', plain()), 201);
      expect(draft).toMatchObject({
        internalNumber: expect.stringMatching(/^FF\d{4}-\d{6}$/),
        status: 'draft',
        kind: 'invoice',
        matchingMode: 'none',
        matchingStatus: 'not_applicable',
        dueDate: addDays(kinshasaToday(), 30),
        subtotal: '100.00',
        total: '116.00',
        remaining: '0.00',
        costAllocations: [{ category: 'achats', workProjectId: null, amount: '116.00' }],
        deductibleVat: null,
        revision: 1,
      });
      const valid = f.ok(
        await f.post('admin', `/purchases/invoices/${draft['id']}/validate`, {
          expectedRevision: 1,
        }),
      );
      expect(valid).toMatchObject({
        status: 'validated',
        validatedBy: f.userId('admin'),
        remaining: '116.00',
        settlementStatus: 'unpaid',
        revision: 2,
      });
      f.code(
        await f.post('admin', `/purchases/invoices/${draft['id']}/validate`, {
          expectedRevision: 2,
        }),
        409,
        'SUPPLIER_INVOICE_NOT_DRAFT',
      );

      // Reste dû sur la fiche (port SUPPLIER_PAYABLES_SOURCE), archivage refusé.
      const list = f.ok(await f.get('owner', '/purchases/suppliers?q=Socimex'));
      const row = list['items'].find((s: { id: string }) => s.id === supplierId);
      expect(row['remainingByCurrency']).toEqual({ USD: '116.00' });
      const sup = f.ok(await f.get('owner', `/purchases/suppliers/${supplierId}`));
      f.code(
        await f.post('owner', `/purchases/suppliers/${supplierId}/archive`, {
          expectedRevision: sup['revision'],
        }),
        409,
        'SUPPLIER_HAS_OPEN_PAYABLES',
      );
    });

    it('addition, imputations, dates et TVA déductible contrôlées', async () => {
      const total = await f.post('admin', '/purchases/invoices', plain({ total: '117.00' }));
      f.code(total, 400, 'SUPPLIER_INVOICE_TOTAL_MISMATCH');
      expect(total.body.details).toMatchObject({
        expected: '116.00',
        actual: '117.00',
        difference: '1.00',
      });
      f.code(
        await f.post(
          'admin',
          '/purchases/invoices',
          plain({ costAllocations: [{ category: 'achats', amount: '100.00' }] }),
        ),
        400,
        'SUPPLIER_INVOICE_ALLOCATION_MISMATCH',
      );
      f.code(
        await f.post(
          'admin',
          '/purchases/invoices',
          plain({ costAllocations: [{ category: 'inconnue', amount: '116.00' }] }),
        ),
        400,
        'CATEGORY_UNKNOWN',
      );
      f.code(
        await f.post(
          'admin',
          '/purchases/invoices',
          plain({ invoiceDate: addDays(kinshasaToday(), 3) }),
        ),
        400,
        'PURCHASE_DATE_IN_FUTURE',
      );
      f.code(
        await f.post(
          'admin',
          '/purchases/invoices',
          plain({ dueDate: addDays(kinshasaToday(), -1) }),
        ),
        400,
        'SUPPLIER_INVOICE_DUE_BEFORE_INVOICE',
      );
      f.code(
        await f.post('admin', '/purchases/invoices', plain({ deductibleVat: '16.01' })),
        400,
        'SUPPLIER_INVOICE_DEDUCTIBLE_VAT_ABOVE_TAXES',
      );
      const { subtotal: _s, ...noSubtotal } = plain();
      f.code(
        await f.post('admin', '/purchases/invoices', noSubtotal),
        400,
        'SUPPLIER_INVOICE_SUBTOTAL_REQUIRED',
      );
      f.code(
        await f.post('admin', '/purchases/invoices', plain({ total: 116 })),
        400,
        'INVALID_REQUEST',
      );
      // Déclarée, conservée, jamais calculée.
      const ok = f.ok(
        await f.post('admin', '/purchases/invoices', plain({ deductibleVat: '16.00' })),
        201,
      );
      expect(ok['deductibleVat']).toBe('16.00');
    });

    it('doublon : « fa-001 » quand « FA 001 » existe → 409 (critère 9) ; autre fournisseur permis', async () => {
      const first = f.ok(
        await f.post('admin', '/purchases/invoices', plain({ supplierReference: 'FA 001' })),
        201,
      );
      const dup = await f.post(
        'admin',
        '/purchases/invoices',
        plain({ supplierReference: 'fa-001' }),
      );
      f.code(dup, 409, 'SUPPLIER_INVOICE_DUPLICATE');
      expect(dup.body.details).toEqual({ invoiceId: first['id'] });
      f.ok(
        await f.post(
          'admin',
          '/purchases/invoices',
          plain({ supplierId: otherSupplierId, supplierReference: 'FA-001' }),
        ),
        201,
      );
      // Annulée, la référence se libère.
      f.ok(
        await f.post('admin', `/purchases/invoices/${first['id']}/cancel`, {
          reason: 'Saisie erronée',
          expectedRevision: 1,
        }),
      );
      f.ok(
        await f.post('admin', '/purchases/invoices', plain({ supplierReference: 'fa 001' })),
        201,
      );
    });
  });

  describe('trois voies (critère 7)', () => {
    let order: { id: string; line: Record<string, string> };

    it('commande de 10 à 5,00 USD, réception de 6 ; facture de 10 → QUANTITY_ABOVE_RECEIVED', async () => {
      order = await f.seedOrder({
        supplierId,
        lines: [{ id: 'g', quantity: '10', unitPrice: '5.00' }],
      });
      f.ok(
        await f.post('admin', '/purchases/receptions', {
          orderId: order.id,
          receivedOn: kinshasaToday(),
          lines: [{ orderLineId: order.line['g'], quantity: '6' }],
        }),
        201,
      );
      f.notifications.length = 0;
      const inv = f.ok(
        await f.post('admin', '/purchases/invoices', {
          supplierId,
          supplierReference: nextRef(),
          invoiceDate: kinshasaToday(),
          currency: 'USD',
          orderIds: [order.id],
          lines: [{ orderLineId: order.line['g'], quantity: '10', unitPrice: '5.00' }],
          total: '50.00',
        }),
        201,
      );
      expect(inv).toMatchObject({
        matchingMode: 'three_way',
        matchingStatus: 'variance',
        lines: [{ label: 'Ligne g', amount: '50.00' }],
      });
      const codes = inv['matching']['variances'].map((v: { code: string }) => v.code);
      expect(codes).toContain('QUANTITY_ABOVE_RECEIVED');
      expect(inv['matching']['lines'][0]).toMatchObject({
        mode: 'three_way',
        ordered: '10',
        received: '6',
        invoicedCumulative: '10',
      });
      // Notification aux détenteurs de `purchase.approve`, pas à l'auteur ni à l'admin.
      const to = f.notifications
        .filter((n) => n.kind === 'purchases.invoice_variance')
        .map((n) => n.recipientUserId)
        .sort();
      expect(to).toEqual([f.userId('owner'), f.userId('finance_director')].sort());

      const refused = await f.post('admin', `/purchases/invoices/${inv['id']}/validate`, {
        expectedRevision: 1,
      });
      f.code(refused, 409, 'SUPPLIER_INVOICE_VARIANCE');
      expect(refused.body.details.variances[0].code).toBe('QUANTITY_ABOVE_RECEIVED');

      // Forçage : pas l'administrateur (403), pas sans motif (400), un approbateur oui.
      expect(
        (
          await f.post('admin', `/purchases/invoices/${inv['id']}/force-validate`, {
            reason: 'Livré',
            expectedRevision: 1,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await f.post('accountant', `/purchases/invoices/${inv['id']}/force-validate`, {
            reason: 'Livré',
            expectedRevision: 1,
          })
        ).status,
      ).toBe(403);
      f.code(
        await f.post('owner', `/purchases/invoices/${inv['id']}/force-validate`, {
          expectedRevision: 1,
        }),
        400,
        'INVALID_REQUEST',
      );
      const forced = f.ok(
        await f.post('owner', `/purchases/invoices/${inv['id']}/force-validate`, {
          reason: 'Reste livré hier, bon de livraison en route',
          expectedRevision: 1,
        }),
      );
      expect(forced).toMatchObject({
        status: 'validated',
        forced: true,
        matchingStatus: 'variance',
        forcedValidation: {
          by: f.userId('owner'),
          reason: 'Reste livré hier, bon de livraison en route',
          soleApprover: false,
        },
      });
      const audit = await f
        .db()
        .collection('audit_events')
        .findOne({ action: 'supplier_invoice.force_validated', targetId: inv['id'] });
      expect(audit?.['metadata']).toMatchObject({
        reason: 'Reste livré hier, bon de livraison en route',
        variances: [expect.objectContaining({ code: 'QUANTITY_ABOVE_RECEIVED' })],
      });

      // La commande facturée ne s'annule plus (P3 lit les factures validées).
      const o = await f.order(order.id);
      f.code(
        await f.post('owner', `/purchases/orders/${order.id}/cancel`, {
          reason: 'x',
          expectedRevision: o['revision'],
        }),
        409,
        'PURCHASE_ORDER_INVOICED',
      );
      // Fiche de la commande : la facture y figure.
      const view = f.ok(await f.get('viewer', `/purchases/orders/${order.id}`));
      expect(view['invoices'].map((i: { id: string }) => i.id)).toEqual([inv['id']]);
      expect(view['receptions']).toHaveLength(1);
    });

    it('le créateur ne force pas sa propre facture (deux approbateurs dans l’organisation)', async () => {
      const o = await f.seedOrder({
        supplierId,
        lines: [{ id: 'g', quantity: '2', unitPrice: '10.00' }],
      });
      const inv = f.ok(
        await f.post('owner', '/purchases/invoices', {
          supplierId,
          supplierReference: nextRef(),
          invoiceDate: kinshasaToday(),
          currency: 'USD',
          orderIds: [o.id],
          lines: [{ orderLineId: o.line['g'], quantity: '2', unitPrice: '10.00' }],
          total: '20.00',
        }),
        201,
      );
      expect(inv['matchingStatus']).toBe('variance'); // rien reçu
      f.code(
        await f.post('owner', `/purchases/invoices/${inv['id']}/force-validate`, {
          reason: 'Moi-même',
          expectedRevision: 1,
        }),
        409,
        'SELF_APPROVAL_FORBIDDEN',
      );
      f.ok(
        await f.post('finance_director', `/purchases/invoices/${inv['id']}/force-validate`, {
          reason: 'Service rendu sur place',
          expectedRevision: 1,
        }),
      );
    });

    it('litige, correction à 6, levée, validation sans écart ; réception qui recalcule un brouillon', async () => {
      const o = await f.seedOrder({
        supplierId,
        lines: [{ id: 'g', quantity: '10', unitPrice: '5.00' }],
      });
      const line = o.line['g'];
      f.ok(
        await f.post('owner', '/purchases/receptions', {
          orderId: o.id,
          receivedOn: kinshasaToday(),
          lines: [{ orderLineId: line, quantity: '6' }],
        }),
        201,
      );
      const body = (quantity: string, total: string) => ({
        supplierId,
        supplierReference: 'LIT-1',
        invoiceDate: kinshasaToday(),
        currency: 'USD',
        orderIds: [o.id],
        lines: [{ orderLineId: line, quantity, unitPrice: '5.00' }],
        total,
      });
      const inv = f.ok(await f.post('admin', '/purchases/invoices', body('10', '50.00')), 201);
      const disputed = f.ok(
        await f.post('admin', `/purchases/invoices/${inv['id']}/dispute`, {
          reason: 'Le fournisseur refait sa facture',
          expectedRevision: 1,
        }),
      );
      expect(disputed).toMatchObject({
        disputed: true,
        dispute: { reason: 'Le fournisseur refait sa facture' },
      });
      f.code(
        await f.post('admin', `/purchases/invoices/${inv['id']}/dispute`, {
          reason: 'Encore',
          expectedRevision: 2,
        }),
        409,
        'SUPPLIER_INVOICE_DISPUTED',
      );
      const fixed = f.ok(
        await f.put('admin', `/purchases/invoices/${inv['id']}`, {
          ...body('6', '30.00'),
          expectedRevision: 2,
        }),
      );
      expect(fixed['matchingStatus']).toBe('matched');
      f.code(
        await f.post('admin', `/purchases/invoices/${inv['id']}/validate`, { expectedRevision: 3 }),
        409,
        'SUPPLIER_INVOICE_DISPUTED',
      );
      f.ok(
        await f.post('admin', `/purchases/invoices/${inv['id']}/resolve-dispute`, {
          expectedRevision: 3,
        }),
      );
      const valid = f.ok(
        await f.post('admin', `/purchases/invoices/${inv['id']}/validate`, { expectedRevision: 4 }),
      );
      expect(valid).toMatchObject({
        status: 'validated',
        matchingStatus: 'matched',
        forced: false,
      });

      // Brouillon des 4 restantes : en écart tant que rien n'est reçu, puis rapproché.
      const rest = f.ok(
        await f.post('admin', '/purchases/invoices', {
          ...body('4', '20.00'),
          supplierReference: 'LIT-2',
        }),
        201,
      );
      expect(rest['matchingStatus']).toBe('variance');
      expect(rest['matching']['lines'][0]).toMatchObject({ invoicedBefore: '6', received: '6' });
      f.ok(
        await f.post('owner', '/purchases/receptions', {
          orderId: o.id,
          receivedOn: kinshasaToday(),
          lines: [{ orderLineId: line, quantity: '4' }],
        }),
        201,
      );
      const after = f.ok(await f.get('viewer', `/purchases/invoices/${rest['id']}`));
      expect(after).toMatchObject({ matchingStatus: 'matched', revision: 1 });

      // Préremplissage : plus rien à facturer une fois les 4 validées.
      const prefill = f.ok(
        await f.post('admin', '/purchases/invoices/from-order', { orderId: o.id }),
      );
      expect(prefill).toMatchObject({
        supplierId,
        currency: 'USD',
        orderIds: [o.id],
        lines: [{ orderLineId: line, quantity: '4', unitPrice: '5.00', label: 'Ligne g' }],
        subtotal: '20.00',
        remainingToInvoice: '20.00',
        costAllocations: [{ category: 'achats', workProjectId: null, amount: '20.00' }],
      });
    });
  });

  describe('deux voies (critère 8)', () => {
    it('service à 100,00 facturé 110,00 : PRICE_ABOVE_ORDER à 0 % ; rapproché à 10 %', async () => {
      const o = await f.seedOrder({
        supplierId,
        lines: [{ id: 's', quantity: '1', unitPrice: '100.00', kind: 'service' }],
      });
      const body = {
        supplierId,
        supplierReference: nextRef(),
        invoiceDate: kinshasaToday(),
        currency: 'USD',
        orderIds: [o.id],
        lines: [{ orderLineId: o.line['s'], quantity: '1', unitPrice: '110.00' }],
        total: '110.00',
      };
      const inv = f.ok(await f.post('admin', '/purchases/invoices', body), 201);
      expect(inv['matchingMode']).toBe('two_way');
      const codes = inv['matching']['variances'].map((v: { code: string }) => v.code);
      expect(codes).toContain('PRICE_ABOVE_ORDER');
      expect(inv['matching']['variances'][0]).toMatchObject({
        unit: 'unit_price',
        expected: '100.00',
        actual: '110.00',
      });

      const settings = f.ok(await f.get('owner', '/purchases/settings'));
      const put = (pricePercent: string, amount: string, rev: number) =>
        f.put('owner', '/purchases/settings', {
          matchingTolerances: { pricePercent, amountAbsolute: { CDF: '0', USD: amount } },
          expectedRevision: rev,
        });
      const saved = f.ok(await put('10', '10.00', settings['revision']));
      const again = f.ok(
        await f.put('admin', `/purchases/invoices/${inv['id']}`, { ...body, expectedRevision: 1 }),
      );
      expect(again['matchingStatus']).toBe('matched');
      f.ok(await put('0', '0', saved['revision']));
    });
  });

  describe('avoir et paiement (lot P5, lu par la connexion)', () => {
    it('un avoir validé et un paiement diminuent le reste ; l’annulation est refusée une fois payée', async () => {
      const inv = f.ok(await f.post('admin', '/purchases/invoices', plain()), 201);
      f.ok(
        await f.post('admin', `/purchases/invoices/${inv['id']}/validate`, { expectedRevision: 1 }),
      );
      const credit = f.ok(
        await f.post('admin', '/purchases/invoices', {
          ...plain({ subtotal: '10.00', taxes: [], total: '10.00' }),
          kind: 'credit_note',
          creditedInvoiceId: inv['id'],
        }),
        201,
      );
      expect(credit['matchingStatus']).toBe('not_applicable');
      f.ok(
        await f.post('admin', `/purchases/invoices/${credit['id']}/validate`, {
          expectedRevision: 1,
        }),
      );
      await f
        .db()
        .collection('supplier_payments')
        .insertOne({
          organizationId: f.orgId(),
          supplierId,
          currency: 'USD',
          amount: '50.00',
          status: 'recorded',
          allocations: [{ invoiceId: inv['id'], amount: '50.00' }],
        });
      const view = f.ok(await f.get('viewer', `/purchases/invoices/${inv['id']}`));
      expect(view['settlement']).toMatchObject({
        status: 'partially_paid',
        paid: '50.00',
        credited: '10.00',
        remaining: '56.00',
      });
      f.code(
        await f.post('admin', `/purchases/invoices/${inv['id']}/cancel`, {
          reason: 'x',
          expectedRevision: view['revision'],
        }),
        409,
        'SUPPLIER_INVOICE_PAID',
      );
      f.code(
        await f.post('admin', '/purchases/invoices', {
          ...plain(),
          kind: 'credit_note',
          creditedInvoiceId: inv['id'],
          currency: 'CDF',
        }),
        409,
        'SUPPLIER_CREDIT_NOTE_TARGET_MISMATCH',
      );
    });
  });

  describe('approbateur unique (organisation B)', () => {
    it('le seul approbateur force sa propre facture, marquée `soleApprover`', async () => {
      const sup = await f.supplier('ownerB', 'Solo', { defaultCategory: 'achats' });
      const o = await f.seedOrder({
        who: 'ownerB',
        supplierId: sup,
        lines: [{ id: 'g', quantity: '3', unitPrice: '2.00' }],
      });
      const inv = f.ok(
        await f.post('ownerB', '/purchases/invoices', {
          supplierId: sup,
          supplierReference: 'SOLO-1',
          invoiceDate: kinshasaToday(),
          currency: 'USD',
          orderIds: [o.id],
          lines: [{ orderLineId: o.line['g'], quantity: '3', unitPrice: '2.00' }],
          total: '6.00',
        }),
        201,
      );
      const forced = f.ok(
        await f.post('ownerB', `/purchases/invoices/${inv['id']}/force-validate`, {
          reason: 'Seul approbateur',
          expectedRevision: 1,
        }),
      );
      expect(forced['forcedValidation']).toMatchObject({ soleApprover: true });
    });
  });

  describe('pièce jointe (§ 2.7)', () => {
    it('PDF inerte en téléchargement ; HTML refusé 415 ; lecture par le Lecteur', async () => {
      const inv = f.ok(await f.post('admin', '/purchases/invoices', plain()), 201);
      const up = await f
        .postRaw('admin', `/purchases/invoices/${inv['id']}/attachment`)
        .set('Content-Type', 'application/octet-stream')
        .set('X-File-Name', encodeURIComponent('facture scannée.pdf'))
        .send(PDF);
      const view = f.ok(up, 201);
      expect(view).toMatchObject({
        hasAttachment: true,
        attachment: { fileName: 'facture scannée.pdf', contentType: 'application/pdf' },
      });
      const dl = await f.get('viewer', `/purchases/invoices/${inv['id']}/attachment`);
      expect(dl.status).toBe(200);
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
      expect(dl.headers['content-security-policy']).toContain('sandbox');
      f.code(
        await f
          .postRaw('admin', `/purchases/invoices/${inv['id']}/attachment`)
          .set('Content-Type', 'application/octet-stream')
          .send(Buffer.from('<svg onload="alert(1)"></svg>')),
        415,
        'PURCHASE_ATTACHMENT_TYPE',
      );
      expect(
        (
          await f
            .postRaw('viewer', `/purchases/invoices/${inv['id']}/attachment`)
            .set('Content-Type', 'application/octet-stream')
            .send(PDF)
        ).status,
      ).toBe(403);
    });
  });

  describe('liste', () => {
    it('filtres par statut, rapprochement, litige et commande ; pagination', async () => {
      const validated = f.ok(await f.get('viewer', '/purchases/invoices?status=validated'));
      expect(validated['items'].every((i: { status: string }) => i.status === 'validated')).toBe(
        true,
      );
      const variance = f.ok(await f.get('viewer', '/purchases/invoices?matching=variance'));
      expect(
        variance['items'].every((i: { matchingStatus: string }) => i.matchingStatus === 'variance'),
      ).toBe(true);
      const page = f.ok(await f.get('viewer', '/purchases/invoices?limit=2'));
      expect(page['items']).toHaveLength(2);
      const next = f.ok(
        await f.get('viewer', `/purchases/invoices?limit=2&cursor=${page['nextCursor']}`),
      );
      const ids = [...page['items'], ...next['items']].map((i: { id: string }) => i.id);
      expect(new Set(ids).size).toBe(4);
      expect(page['items'][0]).toEqual(
        expect.objectContaining({
          internalNumber: expect.any(String),
          supplierName: expect.any(String),
          remaining: expect.any(String),
          disputed: expect.any(Boolean),
        }),
      );
      const overdue = f.ok(await f.get('viewer', '/purchases/invoices?due=overdue'));
      expect(overdue['items']).toEqual([]);
      f.code(await f.get('viewer', '/purchases/invoices?status=paid'), 400, 'INVALID_REQUEST');
    });
  });

  describe('droits (§ 4.1, critère 1) et isolation (critère 17)', () => {
    it('Analyste et Lecteur : 403 en écriture ; Commercial : 403 en lecture', async () => {
      for (const who of ['analyst', 'viewer'] as const) {
        expect((await f.post(who, '/purchases/invoices', plain())).status).toBe(403);
        f.ok(await f.get(who, '/purchases/invoices'));
      }
      expect((await f.get('sales_rep', '/purchases/invoices')).status).toBe(403);
      // Le Comptable saisit et valide (purchase.manage).
      f.ok(await f.post('accountant', '/purchases/invoices', plain()), 201);
    });

    it('identifiants forgés d’une autre organisation : 404', async () => {
      const mine = f.ok(await f.post('admin', '/purchases/invoices', plain()), 201);
      const o = await f.seedOrder({
        supplierId,
        lines: [{ id: 'g', quantity: '1', unitPrice: '1.00' }],
      });
      const supB = await f.supplier('ownerB', 'Isole', { defaultCategory: 'achats' });
      const base = {
        supplierId: supB,
        supplierReference: 'ISO-1',
        invoiceDate: kinshasaToday(),
        currency: 'USD',
        subtotal: '1.00',
        total: '1.00',
      };
      f.code(
        await f.get('ownerB', `/purchases/invoices/${mine['id']}`),
        404,
        'SUPPLIER_INVOICE_NOT_FOUND',
      );
      f.code(
        await f.post('ownerB', `/purchases/invoices/${mine['id']}/validate`, {
          expectedRevision: 1,
        }),
        404,
        'SUPPLIER_INVOICE_NOT_FOUND',
      );
      f.code(
        await f.post('ownerB', '/purchases/invoices', { ...base, supplierId }),
        404,
        'SUPPLIER_NOT_FOUND',
      );
      f.code(
        await f.post('ownerB', '/purchases/invoices', {
          ...base,
          orderIds: [o.id],
          lines: [{ orderLineId: o.line['g'], quantity: '1', unitPrice: '1.00' }],
          subtotal: undefined,
        }),
        404,
        'PURCHASE_ORDER_NOT_FOUND',
      );
      f.code(
        await f.post('ownerB', '/purchases/invoices', {
          ...base,
          kind: 'credit_note',
          creditedInvoiceId: mine['id'],
        }),
        404,
        'SUPPLIER_INVOICE_NOT_FOUND',
      );
      const projectN = f.ok(
        await f.post('owner', '/work/projects', { name: 'Chantier N', kind: 'internal' }),
        201,
      );
      f.code(
        await f.post('ownerB', '/purchases/invoices', {
          ...base,
          costAllocations: [{ category: 'achats', workProjectId: projectN['id'], amount: '1.00' }],
        }),
        404,
        'PURCHASE_WORK_PROJECT_UNKNOWN',
      );
      f.code(
        await f.post('admin', '/purchases/invoices', {
          ...plain(),
          orderIds: [o.id],
          lines: [{ orderLineId: 'forgee', quantity: '1', unitPrice: '1.00' }],
          subtotal: undefined,
          taxes: [],
          total: '1.00',
        }),
        404,
        'PURCHASE_ORDER_LINE_NOT_FOUND',
      );
      f.code(
        await f.post('admin', '/purchases/invoices/from-order', { orderId: '0'.repeat(24) }),
        404,
        'PURCHASE_ORDER_NOT_FOUND',
      );
      // Projet de l'organisation : accepté et recopié.
      const withProject = f.ok(
        await f.post('admin', '/purchases/invoices', {
          ...plain(),
          costAllocations: [
            { category: 'achats', workProjectId: projectN['id'], amount: '60.00' },
            { category: 'services_exterieurs', amount: '56.00' },
          ],
        }),
        201,
      );
      expect(withProject['costAllocations']).toEqual([
        { category: 'achats', workProjectId: projectN['id'], amount: '60.00' },
        { category: 'services_exterieurs', workProjectId: null, amount: '56.00' },
      ]);
    });
  });
});
