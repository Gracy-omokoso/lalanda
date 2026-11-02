// Commandes clients et liens — ADR-0050, lot V2.
//
// Critères d'acceptation couverts : 1 (permissions des commandes : Commercial,
// Comptable, Administrateur, Lecteur, Analyste, Conseiller), 3 (devis → commande aux
// prix du devis, deuxième commande vivante 409, devis égal octet pour octet), 4 (reste
// à facturer : 10 commandées, 6 puis 4, « Clore » proposé, `UNMATCHED_LINE`), 16 (pièces
// PDF : 422 au-delà de 10 Mio ou hors PDF, téléchargement `attachment`, ajout seul),
// 17 (isolation : 404 hors organisation). Règle absolue : la commande prépare un
// BROUILLON ; rien n'est émis ni normalisé par ce module (l'organisation n'a même pas de
// facturation normalisée : aucun appel e-MCF possible).
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

import 'reflect-metadata';

import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { e2eSuite, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { useWorkFixture, type WorkAccount } from './work-e2e-fixtures.js';

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
  unit: 'unité',
  quantity,
  unitPrice,
  specificTax: null,
  discount: null,
});

const PDF = Buffer.from('%PDF-1.4\n% bon de commande\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');

e2eSuite('commandes clients et liens (ADR-0050, V2)', () => {
  const f = useWorkFixture('sorders');
  let customer = '';
  let customerB = '';
  let item = '';
  let repCookies: string[] = [];

  const ok = (res: { status: number; body: unknown }, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const code = (res: { status: number; body: any }, status: number, c: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code, JSON.stringify(res.body)).toBe(c);
  };
  const asRep = () => [...repCookies, `active_org_id=${f.orgId()}`];
  const rep = {
    get: (path: string) => request(f.app().getHttpServer()).get(path).set('Cookie', asRep()),
    post: (path: string, body?: unknown) =>
      request(f.app().getHttpServer())
        .post(path)
        .set('Cookie', asRep())
        .send((body ?? {}) as object),
    postRaw: (path: string) => request(f.app().getHttpServer()).post(path).set('Cookie', asRep()),
  };

  const corpsCommande = (extra: Record<string, unknown> = {}) => ({
    orderedOn: '2026-11-01',
    customerReference: 'BC-CLIENT-42',
    currency: 'USD',
    priceMode: 'ht',
    customer: { customerId: customer, printContactDetails: false },
    lines: [ligne('Licence annuelle', '10', '120.00'), ligne('Installation', '1', '300.00')],
    ...extra,
  });

  async function devis(
    who: WorkAccount,
    body: Record<string, unknown>,
    until: 'sent' | 'accepted',
  ): Promise<Record<string, any>> {
    const d = ok(await f.post(who, '/sales/quotes', body), 201);
    const s = ok(await f.post(who, `/sales/quotes/${d.id}/send`, { expectedRevision: d.revision }));
    if (until === 'sent') return s;
    return ok(await f.post(who, `/sales/quotes/${d.id}/accept`, { expectedRevision: s.revision }));
  }

  const corpsDevis = (c: string | null) => ({
    currency: 'CDF',
    priceMode: 'ht',
    customer: c
      ? { customerId: c, printContactDetails: false }
      : { customerId: null, walkIn: { name: 'Client de passage' } },
    lines: [
      ...(c === customerB
        ? []
        : [
            {
              source: 'catalog',
              catalogItemId: item,
              quantity: '3',
              unitPrice: null,
              discount: null,
            },
          ]),
      ligne('Conseil (heure)', '2', '40000.00'),
    ],
    title: 'Audit et conseil',
  });

  /** Commande confirmée (POST puis confirm). */
  async function commandeConfirmee(extra: Record<string, unknown> = {}) {
    const c = ok(await f.post('owner', '/sales/orders', corpsCommande(extra)), 201);
    return ok(
      await f.post('owner', `/sales/orders/${c.id}/confirm`, { expectedRevision: c.revision }),
    );
  }

  /** Émission par le circuit EXISTANT des factures (route `sales.invoice`), à crédit. */
  async function emettre(invoiceId: string): Promise<Record<string, any>> {
    const d = ok(await f.get('owner', `/sales/invoices/${invoiceId}`));
    const body = {
      type: d.type,
      currency: d.currency,
      priceMode: d.priceMode,
      customer: { customerId: d.customer.customerId, printContactDetails: false },
      pointOfSaleId: null,
      lines: d.lines.map((l: Record<string, any>) => ({
        source: 'free',
        code: l.code,
        name: l.name,
        itemType: l.itemType,
        taxGroup: l.taxGroup,
        outOfScope: l.outOfScope,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        specificTax: null,
        discount: null,
      })),
      payments: [{ method: 'CREDIT', amount: d.documentAmounts.calculation.totals.total }],
      comments: { A: d.comments.A ?? null, C: d.comments.C ?? null },
      creditNote: null,
      showUsdCounterValue: false,
    };
    const p = ok(
      await f.put('owner', `/sales/invoices/${invoiceId}`, {
        ...body,
        expectedRevision: d.revision,
      }),
    );
    return ok(
      await f.post('owner', `/sales/invoices/${invoiceId}/issue`, { expectedRevision: p.revision }),
    );
  }

  /**
   * Avoir `FA` gelé sur la première ligne d'une facture émise (circuit EXISTANT des
   * avoirs, ADR-0023 § S25e.5) — ADR-0054 : il réduit le facturé de la commande.
   */
  async function avoir(originId: string, quantity: string): Promise<Record<string, any>> {
    const o = ok(await f.get('owner', `/sales/invoices/${originId}`));
    const body = {
      type: 'FA',
      currency: o.currency,
      priceMode: o.priceMode,
      customer: { customerId: o.customer.customerId, printContactDetails: false },
      pointOfSaleId: null,
      lines: [{ source: 'origin', originLineIndex: 0, quantity }],
      payments: [],
      comments: { A: null, C: null },
      creditNote: { nature: 'RAM', originInvoiceId: originId },
      showUsdCounterValue: false,
    };
    const d = ok(await f.post('owner', '/sales/invoices', body), 201);
    const p = ok(
      await f.put('owner', `/sales/invoices/${d.id}`, {
        ...body,
        payments: [{ method: 'CREDIT', amount: d.documentAmounts.calculation.totals.total }],
        expectedRevision: d.revision,
      }),
    );
    return ok(
      await f.post('owner', `/sales/invoices/${d.id}/issue`, { expectedRevision: p.revision }),
    );
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
    customerB = ok(
      await f.post('ownerB', '/sales/customers', {
        type: 'PM',
        name: 'Client B',
        nif: `T${tag}02`,
      }),
      201,
    ).id;
    item = ok(
      await f.post('owner', '/sales/catalog-items', {
        code: 'AUDIT-J',
        name: 'Audit (jour)',
        itemType: 'SER',
        taxGroup: 'B',
        outOfScope: false,
        unitPrice: '150000',
        priceMode: 'ht',
        currency: 'CDF',
        unit: 'jour',
        specificTax: null,
      }),
      201,
    ).id;

    // Un Commercial (`sales_rep`) : prépare, ne prépare pas de facture.
    const email = `sorders-rep-${tag.toLowerCase()}@lalanda-test.local`;
    const inv = await f.post('owner', `/organizations/${f.orgId()}/invitations`, {
      email,
      role: 'sales_rep',
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    repCookies = await registerAndLogin(f.app(), {
      email,
      password: 'Passw0rd!commercial',
      name: 'Commercial',
    });
    const acc = await request(f.app().getHttpServer())
      .post('/invitations/accept')
      .set('Cookie', repCookies)
      .send({ token: inv.body.token });
    expect(acc.status).toBe(201);
  }, E2E_HOOK_TIMEOUT_MS);

  // ── Permissions (critère 1) ──────────────────────────────────────────────

  describe('permissions (critère 1)', () => {
    it('Commercial et Administrateur préparent ; Lecteur et Analyste lisent seulement ; Conseiller refusé', async () => {
      const parRep = ok(await rep.post('/sales/orders', corpsCommande()), 201);
      expect(parRep.number).toMatch(/^CC\d{4}-\d{6}$/);
      expect(parRep.status).toBe('draft');
      ok(await f.post('admin', '/sales/orders', corpsCommande()), 201);
      ok(await f.post('accountant', '/sales/orders', corpsCommande()), 201);
      for (const who of ['viewer', 'analyst'] as const) {
        ok(await f.get(who, '/sales/orders'));
        ok(await f.get(who, `/sales/orders/${parRep.id}`));
        const w = await f.post(who, '/sales/orders', corpsCommande());
        expect(w.status, who).toBe(403);
        expect(w.body).toMatchObject({ code: 'FORBIDDEN', action: 'sales.contract' });
      }
      const conseiller = await f.get('advisor', '/sales/orders');
      expect(conseiller.status).toBe(403);
      expect(conseiller.body).toMatchObject({ code: 'FORBIDDEN', action: 'sales.read' });
    });

    it('le Commercial confirme mais ne prépare pas la facture (sales.manage) ; le Comptable la prépare', async () => {
      const c = ok(await rep.post('/sales/orders', corpsCommande()), 201);
      const conf = ok(
        await rep.post(`/sales/orders/${c.id}/confirm`, { expectedRevision: c.revision }),
      );
      const refus = await rep.post(`/sales/orders/${c.id}/prepare-invoice`, {
        expectedRevision: conf.revision,
      });
      expect(refus.status).toBe(403);
      expect(refus.body).toMatchObject({ code: 'FORBIDDEN', action: 'sales.manage' });
      const p = ok(
        await f.post('accountant', `/sales/orders/${c.id}/prepare-invoice`, {
          expectedRevision: conf.revision,
        }),
      );
      expect(p.invoiceId).toMatch(/^[0-9a-f]{24}$/);
    });
  });

  // ── Cycle de vie ─────────────────────────────────────────────────────────

  describe('cycle de vie', () => {
    it('client exigé (400 CUSTOMER_REQUIRED), corps strict, brouillon modifiable seul, révision attendue', async () => {
      const sansClient = await f.post(
        'owner',
        '/sales/orders',
        corpsCommande({ customer: { customerId: null, walkIn: { name: 'Passant' } } }),
      );
      expect(sansClient.status).toBe(400);
      expect(f.issueCodes(sansClient)).toContain('CUSTOMER_REQUIRED');
      const inconnu = await f.post('owner', '/sales/orders', corpsCommande({ remise: '5' }));
      expect(inconnu.status).toBe(400);
      expect(f.issueCodes(inconnu)).toContain('UNKNOWN_FIELD');

      const c = ok(await f.post('owner', '/sales/orders', corpsCommande()), 201);
      expect(c.lines.map((l: { lineRef: string }) => l.lineRef)).toEqual(['L1', 'L2']);
      expect(c.total).toBe(c.documentAmounts.calculation.totals.total);
      const stale = await f.put('owner', `/sales/orders/${c.id}`, {
        ...corpsCommande({ notes: 'Livraison en deux fois' }),
        expectedRevision: c.revision + 5,
      });
      code(stale, 409, 'STALE_REVISION');
      const m = ok(
        await f.put('owner', `/sales/orders/${c.id}`, {
          ...corpsCommande({ notes: 'Livraison en deux fois' }),
          expectedRevision: c.revision,
        }),
      );
      expect(m.notes).toBe('Livraison en deux fois');
      const conf = ok(
        await f.post('owner', `/sales/orders/${c.id}/confirm`, { expectedRevision: m.revision }),
      );
      expect(conf.status).toBe('confirmed');
      expect(conf.invoicing).toMatchObject({ status: 'not_invoiced', closeSuggested: false });
      code(
        await f.put('owner', `/sales/orders/${c.id}`, {
          ...corpsCommande(),
          expectedRevision: conf.revision,
        }),
        409,
        'ORDER_NOT_DRAFT',
      );
      code(await f.del('owner', `/sales/orders/${c.id}`), 409, 'ORDER_NOT_DRAFT');
      const annule = ok(
        await f.post('owner', `/sales/orders/${c.id}/cancel`, {
          expectedRevision: conf.revision,
          reason: 'Le client a renoncé',
        }),
      );
      expect(annule).toMatchObject({
        status: 'cancelled',
        cancellation: { reason: 'Le client a renoncé' },
      });

      const brouillon = ok(await f.post('owner', '/sales/orders', corpsCommande()), 201);
      expect((await f.del('owner', `/sales/orders/${brouillon.id}`)).status).toBe(204);
      code(await f.get('owner', `/sales/orders/${brouillon.id}`), 404, 'SALES_ORDER_NOT_FOUND');
    });

    it('liste filtrée par statut et par client, pagination par curseur', async () => {
      const confirmees = ok(await f.get('owner', '/sales/orders?status=confirmed'));
      expect(confirmees.items.length).toBeGreaterThan(0);
      expect(confirmees.items.every((o: { status: string }) => o.status === 'confirmed')).toBe(
        true,
      );
      const page = ok(await f.get('owner', '/sales/orders?limit=1'));
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toEqual(expect.any(String));
      const suite = ok(await f.get('owner', `/sales/orders?limit=1&cursor=${page.nextCursor}`));
      expect(suite.items[0].id).not.toBe(page.items[0].id);
      const parClient = ok(await f.get('owner', `/sales/orders?customerId=${customer}`));
      expect(parClient.items.length).toBeGreaterThan(0);
      code(await f.get('owner', '/sales/orders?cursor=%%%'), 400, 'INVALID_CURSOR');
    });
  });

  // ── Devis → commande (critère 3) ─────────────────────────────────────────

  describe('devis accepté → commande (critère 3)', () => {
    it('aux prix du devis même si le catalogue change ; devis inchangé ; une seule commande vivante', async () => {
      const d = await devis('owner', corpsDevis(customer), 'accepted');
      const avant = await f
        .db()
        .collection('sales_quotes')
        .findOne({ _id: new ObjectId(d.id) });
      await f
        .db()
        .collection('catalog_items')
        .updateOne({ _id: new ObjectId(item) }, { $set: { unitPrice: '200000' } });

      const res = ok(
        await rep.post(`/sales/quotes/${d.id}/to-order`, {
          orderedOn: '2026-10-30',
          customerReference: 'PO-778',
        }),
        201,
      );
      expect(res.warnings).toEqual([]);
      const o = res.order;
      expect(o).toMatchObject({
        status: 'draft',
        customerId: customer,
        customerReference: 'PO-778',
        orderedOn: '2026-10-30',
        source: { kind: 'quote', quoteId: d.id, quoteVersion: d.version },
        currency: 'CDF',
        priceMode: 'ht',
      });
      expect(
        o.lines.map((l: Record<string, string>) => [l.lineRef, l.quantity, l.unitPrice]),
      ).toEqual(
        d.lines.map((l: Record<string, string>, i: number) => [
          `L${i + 1}`,
          l.quantity,
          l.unitPrice,
        ]),
      );
      expect(o.lines[0].unitPrice).toBe('150000.00');
      expect(o.total).toBe(d.total);

      const apres = await f
        .db()
        .collection('sales_quotes')
        .findOne({ _id: new ObjectId(d.id) });
      expect(JSON.stringify(apres)).toBe(JSON.stringify(avant));

      const double = await f.post('owner', `/sales/quotes/${d.id}/to-order`, {});
      code(double, 409, 'ORDER_EXISTS_FOR_QUOTE');
      expect(double.body.details.orderId).toBe(o.id);
      const parDevis = ok(await f.get('owner', `/sales/orders?quoteId=${d.id}`));
      expect(parDevis.items.map((x: { id: string }) => x.id)).toEqual([o.id]);

      // Annulée, la commande libère le devis.
      ok(
        await f.post('owner', `/sales/orders/${o.id}/cancel`, {
          expectedRevision: o.revision,
          reason: 'Erreur de saisie',
        }),
      );
      const seconde = ok(await f.post('owner', `/sales/quotes/${d.id}/to-order`, {}), 201);
      expect(seconde.order.id).not.toBe(o.id);
      await f
        .db()
        .collection('catalog_items')
        .updateOne({ _id: new ObjectId(item) }, { $set: { unitPrice: '150000' } });
    });

    it('devis envoyé 409, client de passage 409, autre organisation 404, conversion signalée sans refus', async () => {
      const envoye = await devis('owner', corpsDevis(customer), 'sent');
      code(
        await f.post('owner', `/sales/quotes/${envoye.id}/to-order`, {}),
        409,
        'QUOTE_NOT_ACCEPTED',
      );
      const passage = await devis('owner', corpsDevis(null), 'accepted');
      code(
        await f.post('owner', `/sales/quotes/${passage.id}/to-order`, {}),
        409,
        'CUSTOMER_REQUIRED',
      );
      const autre = await devis('ownerB', corpsDevis(customerB), 'accepted');
      code(await f.post('owner', `/sales/quotes/${autre.id}/to-order`, {}), 404, 'QUOTE_NOT_FOUND');
      code(
        await f.post('owner', `/sales/quotes/${new ObjectId().toHexString()}/to-order`, {}),
        404,
        'QUOTE_NOT_FOUND',
      );

      const converti = await devis('owner', corpsDevis(customer), 'accepted');
      const conv = ok(
        await f.post('owner', `/sales/quotes/${converti.id}/convert`, {
          expectedRevision: converti.revision,
        }),
      );
      const res = ok(await f.post('owner', `/sales/quotes/${converti.id}/to-order`, {}), 201);
      expect(res.warnings).toEqual([
        expect.objectContaining({
          code: 'QUOTE_ALREADY_CONVERTED',
          details: { invoiceId: conv.invoiceId },
        }),
      ]);
      expect(res.order.status).toBe('draft');
    });
  });

  // ── Reste à facturer (critère 4) ─────────────────────────────────────────

  describe('reste à facturer (critère 4)', () => {
    it('10 commandées, 6 préparées et émises, reste 4 ; la seconde préparation propose 4 ; puis « Clore » proposé', async () => {
      const c = await commandeConfirmee({
        lines: [ligne('Licence annuelle', '10', '120.00')],
      });
      const p1 = ok(
        await f.post('owner', `/sales/orders/${c.id}/prepare-invoice`, {
          expectedRevision: c.revision,
          lines: [{ lineRef: 'L1', quantity: '6' }],
        }),
      );
      expect(p1.warnings).toEqual([]);
      const brouillon = ok(await f.get('owner', `/sales/invoices/${p1.invoiceId}`));
      expect(brouillon).toMatchObject({
        status: 'draft',
        type: 'FV',
        number: null,
        currency: 'USD',
      });
      expect(brouillon.lines.map((l: Record<string, string>) => [l.quantity, l.unitPrice])).toEqual(
        [['6', '120.00']],
      );
      expect(brouillon.comments.C).toBe(`Commande ${c.number} — réf. client BC-CLIENT-42`);
      expect(p1.order.invoicing.lines[0]).toMatchObject({
        ordered: '10',
        invoiced: '0',
        inDraft: '6',
        remainingToInvoice: '10',
        remainingToPrepare: '4',
      });
      expect(p1.order.invoices).toEqual([
        expect.objectContaining({ invoiceId: p1.invoiceId, kind: 'order_invoice', state: 'draft' }),
      ]);

      const trop = await f.post('owner', `/sales/orders/${c.id}/prepare-invoice`, {
        expectedRevision: p1.order.revision,
        lines: [{ lineRef: 'L1', quantity: '5' }],
      });
      code(trop, 409, 'ORDER_QUANTITY_EXCEEDS_REMAINING');
      const inconnue = await f.post('owner', `/sales/orders/${c.id}/prepare-invoice`, {
        expectedRevision: p1.order.revision,
        lines: [{ lineRef: 'L9', quantity: '1' }],
      });
      expect(inconnue.status).toBe(400);
      expect(f.issueCodes(inconnue)).toContain('UNKNOWN_LINE_REF');

      await emettre(p1.invoiceId);
      const v1 = ok(await f.get('owner', `/sales/orders/${c.id}`));
      expect(v1.invoicing).toMatchObject({ status: 'partially_invoiced', closeSuggested: false });
      expect(v1.invoicing.lines[0]).toMatchObject({
        invoiced: '6',
        inDraft: '0',
        remainingToInvoice: '4',
        remainingToPrepare: '4',
      });
      expect(v1.invoicingStatus).toBe('partially_invoiced');
      code(
        await f.post('owner', `/sales/orders/${c.id}/cancel`, {
          expectedRevision: v1.revision,
          reason: 'Abandon',
        }),
        409,
        'ORDER_HAS_ISSUED_INVOICE',
      );

      const p2 = ok(
        await f.post('owner', `/sales/orders/${c.id}/prepare-invoice`, {
          expectedRevision: v1.revision,
        }),
      );
      const second = ok(await f.get('owner', `/sales/invoices/${p2.invoiceId}`));
      expect(second.lines.map((l: Record<string, string>) => l.quantity)).toEqual(['4']);
      await emettre(p2.invoiceId);
      const v2 = ok(await f.get('owner', `/sales/orders/${c.id}`));
      expect(v2.invoicing).toMatchObject({ status: 'invoiced', closeSuggested: true });
      expect(v2.actions).toMatchObject({
        closeSuggested: true,
        close: true,
        prepareInvoice: false,
        cancel: false,
      });
      code(
        await f.post('owner', `/sales/orders/${c.id}/prepare-invoice`, {
          expectedRevision: v2.revision,
        }),
        409,
        'ORDER_NOTHING_TO_INVOICE',
      );
      const close = ok(
        await f.post('owner', `/sales/orders/${c.id}/close`, {
          expectedRevision: v2.revision,
          reason: 'Tout est facturé',
        }),
      );
      expect(close).toMatchObject({ status: 'closed', closure: { reason: 'Tout est facturé' } });
      code(
        await f.post('owner', `/sales/orders/${c.id}/prepare-invoice`, {
          expectedRevision: close.revision,
        }),
        409,
        'ORDER_NOT_CONFIRMED',
      );
    });

    it('ADR-0054 : un avoir gelé sur une facture de la commande réduit le facturé ; la commande se refacture', async () => {
      const c = await commandeConfirmee({ lines: [ligne('Licence annuelle', '10', '120.00')] });
      const p1 = ok(
        await f.post('owner', `/sales/orders/${c.id}/prepare-invoice`, {
          expectedRevision: c.revision,
        }),
      );
      const facture = await emettre(p1.invoiceId);
      const v1 = ok(await f.get('owner', `/sales/orders/${c.id}`));
      expect(v1.invoicing).toMatchObject({ status: 'invoiced', closeSuggested: true });
      expect(v1.invoicing.lines[0]).toMatchObject({ invoiced: '10', credited: '0' });

      const a = await avoir(facture.id ?? p1.invoiceId, '3');
      expect(a).toMatchObject({ type: 'FA', status: 'issued' });
      const v2 = ok(await f.get('owner', `/sales/orders/${c.id}`));
      expect(v2.invoicing).toMatchObject({ status: 'partially_invoiced', closeSuggested: false });
      expect(v2.invoicing.lines[0]).toMatchObject({
        invoiced: '7',
        credited: '3',
        remainingToInvoice: '3',
        remainingToPrepare: '3',
      });
      // L'avoir n'est pas lui-même une facture de la commande : aucun lien posé.
      expect(v2.invoices.map((i: { invoiceId: string }) => i.invoiceId)).toEqual([p1.invoiceId]);

      const p2 = ok(
        await f.post('owner', `/sales/orders/${c.id}/prepare-invoice`, {
          expectedRevision: v2.revision,
        }),
      );
      const second = ok(await f.get('owner', `/sales/invoices/${p2.invoiceId}`));
      expect(second.lines.map((l: Record<string, string>) => l.quantity)).toEqual(['3']);
    });

    it('une ligne de brouillon modifiée (autre prix) → UNMATCHED_LINE, reste inchangé ; brouillon supprimé → échéance libérée', async () => {
      const c = await commandeConfirmee({ lines: [ligne('Licence annuelle', '10', '120.00')] });
      const p = ok(
        await f.post('owner', `/sales/orders/${c.id}/prepare-invoice`, {
          expectedRevision: c.revision,
        }),
      );
      const d = ok(await f.get('owner', `/sales/invoices/${p.invoiceId}`));
      ok(
        await f.put('owner', `/sales/invoices/${p.invoiceId}`, {
          type: 'FV',
          currency: 'USD',
          priceMode: 'ht',
          customer: { customerId: customer, printContactDetails: false },
          pointOfSaleId: null,
          lines: [ligne('Licence annuelle', '10', '99.00')],
          payments: [],
          comments: { A: d.comments.A ?? null, C: d.comments.C ?? null },
          creditNote: null,
          showUsdCounterValue: false,
          expectedRevision: d.revision,
        }),
      );
      const v = ok(await f.get('owner', `/sales/orders/${c.id}`));
      expect(v.warnings.map((w: { code: string }) => w.code)).toEqual(['UNMATCHED_LINE']);
      expect(v.invoicing.issues).toEqual([
        expect.objectContaining({ code: 'UNMATCHED_LINE', invoiceId: p.invoiceId, lineRef: 'L1' }),
      ]);
      expect(v.invoicing.lines[0]).toMatchObject({ inDraft: '0', remainingToPrepare: '10' });

      expect((await f.del('owner', `/sales/invoices/${p.invoiceId}`)).status).toBe(204);
      const apres = ok(await f.get('owner', `/sales/orders/${c.id}`));
      expect(apres.invoices).toEqual([]);
      expect(apres.warnings).toEqual([]);
      expect(
        await f.db().collection('sales_document_links').countDocuments({ invoiceId: p.invoiceId }),
      ).toBe(0);
    });

    it('jamais d’émission automatique : chaque facture préparée est un brouillon sans numéro', async () => {
      const links = await f.db().collection('sales_document_links').find({}).toArray();
      expect(links.length).toBeGreaterThan(0);
      const audit = await f
        .db()
        .collection('audit_events')
        .find({ action: 'sales_order.invoice_prepared' })
        .toArray();
      expect(audit.length).toBeGreaterThan(0);
      // Seules les factures émises À LA MAIN par `emettre` (route `sales.invoice`) sont
      // sorties du brouillon ; aucune n'est normalisée ni en attente de normalisation.
      const finales = await f
        .db()
        .collection('sales_invoices')
        .find({ status: { $in: ['pending_normalization', 'normalized', 'normalization_failed'] } })
        .toArray();
      expect(finales).toEqual([]);
    });
  });

  // ── Pièces du client (critère 16) ────────────────────────────────────────

  describe('pièces du client (critère 16)', () => {
    it('PDF seul, 10 Mio au plus (422), téléchargement inerte, ajout seul', async () => {
      const c = ok(await f.post('owner', '/sales/orders', corpsCommande()), 201);
      const up = await rep
        .postRaw(`/sales/orders/${c.id}/files`)
        .set('Content-Type', 'application/octet-stream')
        .set('X-File-Name', encodeURIComponent('bon de commande.pdf'))
        .send(PDF);
      const meta = ok(up, 201);
      expect(meta).toMatchObject({
        kind: 'customer_order',
        fileName: 'bon de commande.pdf',
        contentType: 'application/pdf',
        size: PDF.length,
      });
      const second = ok(
        await f
          .postRaw('owner', `/sales/orders/${c.id}/files`)
          .set('Content-Type', 'application/octet-stream')
          .set('X-File-Name', 'v2.pdf')
          .send(PDF),
        201,
      );
      const v = ok(await f.get('viewer', `/sales/orders/${c.id}`));
      expect(v.files.map((x: { id: string }) => x.id)).toEqual([meta.id, second.id]);

      const html = await f
        .postRaw('owner', `/sales/orders/${c.id}/files`)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('<html><script>alert(1)</script></html>'));
      code(html, 422, 'FILE_NOT_PDF');
      const gros = await f
        .postRaw('owner', `/sales/orders/${c.id}/files`)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]));
      code(gros, 422, 'FILE_TOO_LARGE');
      const lecteur = await f
        .postRaw('viewer', `/sales/orders/${c.id}/files`)
        .set('Content-Type', 'application/octet-stream')
        .send(PDF);
      expect(lecteur.status).toBe(403);

      const dl = await f.get('viewer', `/sales/orders/${c.id}/files/${meta.id}`);
      expect(dl.status).toBe(200);
      expect(dl.headers['content-type']).toBe('application/pdf');
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      expect(dl.headers['content-security-policy']).toContain('sandbox');
      expect([...f.objects.keys()].some((k) => k.includes('sales-contract-files/'))).toBe(true);

      const autre = ok(await f.post('owner', '/sales/orders', corpsCommande()), 201);
      code(
        await f.get('viewer', `/sales/orders/${autre.id}/files/${meta.id}`),
        404,
        'SALES_CONTRACT_FILE_NOT_FOUND',
      );
      code(
        await f.get('ownerB', `/sales/orders/${c.id}/files/${meta.id}`),
        404,
        'SALES_ORDER_NOT_FOUND',
      );
    });
  });

  // ── Isolation (critère 17) ───────────────────────────────────────────────

  describe('isolation (critère 17)', () => {
    it('toute commande d’une autre organisation répond 404, en lecture comme en écriture', async () => {
      const c = await commandeConfirmee();
      for (const res of [
        await f.get('ownerB', `/sales/orders/${c.id}`),
        await f.put('ownerB', `/sales/orders/${c.id}`, { ...corpsCommande(), expectedRevision: 1 }),
        await f.del('ownerB', `/sales/orders/${c.id}`),
        await f.post('ownerB', `/sales/orders/${c.id}/confirm`, { expectedRevision: c.revision }),
        await f.post('ownerB', `/sales/orders/${c.id}/cancel`, {
          expectedRevision: c.revision,
          reason: 'x',
        }),
        await f.post('ownerB', `/sales/orders/${c.id}/prepare-invoice`, {
          expectedRevision: c.revision,
        }),
      ]) {
        code(res, 404, 'SALES_ORDER_NOT_FOUND');
      }
      const listeB = ok(await f.get('ownerB', '/sales/orders'));
      expect(listeB.items.map((x: { id: string }) => x.id)).not.toContain(c.id);
      // Un client d'une autre organisation : 404 par la composition des factures.
      const clientB = await f.post(
        'owner',
        '/sales/orders',
        corpsCommande({ customer: { customerId: customerB, printContactDetails: false } }),
      );
      expect(clientB.status).toBe(404);
      // Le lien ne vise jamais une facture d'une autre organisation.
      const ids = (await f.db().collection('sales_document_links').find({}).toArray()).map(
        (l) => new ObjectId(l['invoiceId'] as string),
      );
      const invoices = await f
        .db()
        .collection('sales_invoices')
        .find({ _id: { $in: ids } })
        .toArray();
      expect(invoices.every((i) => i['organizationId'] === f.orgId())).toBe(true);
    });
  });
});
