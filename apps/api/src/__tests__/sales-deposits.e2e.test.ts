// Acomptes des commandes et des contrats — ADR-0050, lot V4.
//
// Critères d'acceptation couverts :
// - 12 (acompte) : `prepare-deposit` sans `taxGroup` → 400 ; avec le groupe choisi, un
//   brouillon `FT` à UNE ligne libre de ce groupe sur une commande confirmée (et un
//   contrat signé) ; émission par le circuit existant ; la facture finale préparée ensuite
//   porte en ligne C le numéro de la `FT` ; aucune ligne négative, aucun paiement
//   prérempli ; `DEPOSIT_NOT_RESOLVED` jusqu'au geste « traité ».
// - 13 (raccords inchangés) : une `FT` préparée depuis une commande puis émise et la même
//   `FT` saisie à la main donnent la même pièce, les mêmes écritures (`sale.deposit.*`, au
//   compte d'attente sans règle), le même (non-)réalisé et le même règlement.
// Plus : permissions (critère 1 pour `prepare-deposit`), révision attendue, isolation
// (critère 17), aucune émission ni normalisation automatique.
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

import 'reflect-metadata';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aggregateRevenueByMonth,
  entriesForSalesInvoice,
  type PostingContext,
  type RevenueDocumentInput,
} from '@lalanda/engine';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { salesInvoiceView } from '../accounting/sources/source-views.js';
import type { SourceDoc } from '../accounting/sources/accounting-sources.service.js';
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

const PDF = Buffer.from('%PDF-1.4\n% contrat signé\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');

const SIGNATAIRES = [
  { name: 'Client Signataire', title: 'Directeur', side: 'customer' },
  { name: 'Gérant', title: null, side: 'organization' },
];

e2eSuite('acomptes des commandes et des contrats (ADR-0050, V4)', () => {
  const f = useWorkFixture('sdeposits');
  let customer = '';
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
    post: (path: string, body?: unknown) =>
      request(f.app().getHttpServer())
        .post(path)
        .set('Cookie', asRep())
        .send((body ?? {}) as object),
  };

  const corpsCommande = (extra: Record<string, unknown> = {}) => ({
    orderedOn: '2026-11-01',
    customerReference: 'BC-CLIENT-7',
    currency: 'USD',
    priceMode: 'ht',
    customer: { customerId: customer, printContactDetails: false },
    lines: [ligne('Licence annuelle', '10', '120.00'), ligne('Installation', '1', '300.00')],
    ...extra,
  });

  async function commandeConfirmee(extra: Record<string, unknown> = {}) {
    const c = ok(await f.post('owner', '/sales/orders', corpsCommande(extra)), 201);
    return ok(
      await f.post('owner', `/sales/orders/${c.id}/confirm`, { expectedRevision: c.revision }),
    );
  }

  /** Préparé, soumis, approuvé (approbateur unique), copie signée, signé. */
  async function contratSigne(): Promise<Record<string, any>> {
    const c = ok(
      await f.post('owner', '/sales/contracts', {
        title: 'Maintenance du parc',
        startDate: '2027-01-15',
        initialTermMonths: 12,
        renewal: { mode: 'none', periodMonths: null, maxRenewals: null },
        noticeDays: 30,
        billing: { kind: 'none' },
        currency: 'USD',
        priceMode: 'ht',
        customer: { customerId: customer, printContactDetails: false },
        lines: [ligne('Maintenance mensuelle', '12', '500.00')],
      }),
      201,
    );
    const s = ok(
      await f.post('owner', `/sales/contracts/${c.id}/submit`, { expectedRevision: c.revision }),
    );
    const a = ok(
      await f.post('owner', `/sales/contracts/${c.id}/approve`, { expectedRevision: s.revision }),
    );
    const file = ok(
      await f
        .postRaw('owner', `/sales/contracts/${c.id}/files?kind=signed_copy`)
        .set('Content-Type', 'application/octet-stream')
        .set('X-File-Name', 'contrat-signe.pdf')
        .send(PDF),
      201,
    );
    return ok(
      await f.post('owner', `/sales/contracts/${c.id}/signature`, {
        expectedRevision: a.revision,
        signedOn: '2027-01-10',
        signatories: SIGNATAIRES,
        fileId: file.id,
      }),
    );
  }

  /** Corps de facture d'après un brouillon lu (lignes libres, paiement à crédit). */
  function corpsFacture(d: Record<string, any>) {
    return {
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
  }

  /** Émission par le circuit EXISTANT des factures (route `sales.invoice`), à crédit. */
  async function emettre(invoiceId: string): Promise<Record<string, any>> {
    const d = ok(await f.get('owner', `/sales/invoices/${invoiceId}`));
    const p = ok(
      await f.put('owner', `/sales/invoices/${invoiceId}`, {
        ...corpsFacture(d),
        expectedRevision: d.revision,
      }),
    );
    return ok(
      await f.post('owner', `/sales/invoices/${invoiceId}/issue`, { expectedRevision: p.revision }),
    );
  }

  const revisionOf = async (path: string): Promise<number> =>
    ok(await f.get('owner', path)).revision as number;

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

    // Un Commercial (`sales_rep`) : prépare la commande, pas la facture d'acompte.
    const email = `sdeposits-rep-${tag.toLowerCase()}@lalanda-test.local`;
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

  // ── Permissions et corps ─────────────────────────────────────────────────

  describe('permissions et corps (critères 1 et 12)', () => {
    it('Commercial, Lecteur, Analyste : 403 ; Comptable : 200 ; Conseiller : 403 en lecture', async () => {
      const c = await commandeConfirmee();
      const body = {
        expectedRevision: c.revision,
        type: 'FT',
        requestedAmount: '100.00',
        taxGroup: 'B',
      };
      const refus = await rep.post(`/sales/orders/${c.id}/prepare-deposit`, body);
      expect(refus.status, JSON.stringify(refus.body)).toBe(403);
      for (const who of ['viewer', 'analyst'] as WorkAccount[]) {
        expect((await f.post(who, `/sales/orders/${c.id}/prepare-deposit`, body)).status).toBe(403);
        ok(await f.get(who, `/sales/orders/${c.id}/deposits`));
      }
      expect((await f.get('advisor', `/sales/orders/${c.id}/deposits`)).status).toBe(403);
      const prep = ok(await f.post('accountant', `/sales/orders/${c.id}/prepare-deposit`, body));
      expect(prep.invoiceId).toEqual(expect.any(String));
    });

    it('sans groupe de taxation → 400 TAX_GROUP_REQUIRED ; aucun pourcentage ; révision exigée', async () => {
      const c = await commandeConfirmee();
      const sans = await f.post('owner', `/sales/orders/${c.id}/prepare-deposit`, {
        expectedRevision: c.revision,
        type: 'FT',
        requestedAmount: '100.00',
      });
      expect(sans.status).toBe(400);
      expect(f.issueCodes(sans)).toContain('TAX_GROUP_REQUIRED');
      const pourcentage = await f.post('owner', `/sales/orders/${c.id}/prepare-deposit`, {
        expectedRevision: c.revision,
        type: 'FT',
        requestedAmount: '100.00',
        taxGroup: 'B',
        percent: '30',
      });
      expect(pourcentage.status).toBe(400);
      const sansRevision = await f.post('owner', `/sales/orders/${c.id}/prepare-deposit`, {
        type: 'FT',
        requestedAmount: '100.00',
        taxGroup: 'B',
      });
      expect(sansRevision.status).toBe(400);
      expect(f.issueCodes(sansRevision)).toContain('FIELD_REQUIRED');
      expect(
        (
          await f.post('owner', `/sales/orders/${c.id}/prepare-deposit`, {
            expectedRevision: c.revision,
            type: 'FV',
            requestedAmount: '100.00',
            taxGroup: 'B',
          })
        ).status,
      ).toBe(400);
      code(
        await f.post('owner', `/sales/orders/${c.id}/prepare-deposit`, {
          expectedRevision: c.revision + 5,
          type: 'FT',
          requestedAmount: '100.00',
          taxGroup: 'B',
        }),
        409,
        'STALE_REVISION',
      );
      // Rien n'a été créé par les refus.
      expect(ok(await f.get('owner', `/sales/orders/${c.id}/deposits`)).deposits).toEqual([]);
    });

    it('commande en brouillon → 409 ORDER_NOT_CONFIRMED ; contrat non signé → 409 CONTRACT_NOT_SIGNED', async () => {
      const brouillon = ok(await f.post('owner', '/sales/orders', corpsCommande()), 201);
      code(
        await f.post('owner', `/sales/orders/${brouillon.id}/prepare-deposit`, {
          expectedRevision: brouillon.revision,
          type: 'FT',
          requestedAmount: '100.00',
          taxGroup: 'B',
        }),
        409,
        'ORDER_NOT_CONFIRMED',
      );
      const contrat = ok(
        await f.post('owner', '/sales/contracts', {
          title: 'Contrat non signé',
          startDate: '2027-01-15',
          initialTermMonths: 12,
          renewal: { mode: 'none', periodMonths: null, maxRenewals: null },
          noticeDays: 30,
          billing: { kind: 'none' },
          currency: 'USD',
          priceMode: 'ht',
          customer: { customerId: customer, printContactDetails: false },
          lines: [ligne('Maintenance', '1', '500.00')],
        }),
        201,
      );
      code(
        await f.post('owner', `/sales/contracts/${contrat.id}/prepare-deposit`, {
          expectedRevision: contrat.revision,
          type: 'FT',
          requestedAmount: '100.00',
          taxGroup: 'B',
        }),
        409,
        'CONTRACT_NOT_SIGNED',
      );
    });
  });

  // ── Critère 12 ───────────────────────────────────────────────────────────

  describe('acompte, facture finale et geste « traité » (critère 12)', () => {
    it('commande : FT brouillon à une ligne du groupe choisi ; émise ; rappel en ligne C ; DEPOSIT_NOT_RESOLVED jusqu’à « traité »', async () => {
      const c = await commandeConfirmee();
      const prep = ok(
        await f.post('owner', `/sales/orders/${c.id}/prepare-deposit`, {
          expectedRevision: c.revision,
          type: 'FT',
          requestedAmount: '500.00',
          taxGroup: 'B',
        }),
      );
      // Mode HT : le moteur ajoute la TVA ; l'écart est SIGNALÉ, jamais corrigé.
      expect(prep.warnings.map((w: { code: string }) => w.code)).toEqual([
        'DEPOSIT_AMOUNT_MISMATCH',
      ]);
      const ft = ok(await f.get('owner', `/sales/invoices/${prep.invoiceId}`));
      expect(ft).toMatchObject({ status: 'draft', type: 'FT', number: null, currency: 'USD' });
      expect(ft.lines).toHaveLength(1);
      expect(ft.lines[0]).toMatchObject({
        source: 'free',
        taxGroup: 'B',
        itemType: 'SER',
        quantity: '1',
        unitPrice: '500.00',
        name: `Acompte — commande ${c.number}`,
      });
      expect(ft.documentAmounts.payments).toEqual([]);
      expect(ft.comments.C).toBe(`Commande ${c.number} — réf. client BC-CLIENT-7`);

      // L'acompte n'entre pas dans le reste à facturer de la commande.
      const avant = ok(await f.get('owner', `/sales/orders/${c.id}`));
      expect(
        avant.invoicing.lines.map((l: Record<string, string>) => l.remainingToPrepare),
      ).toEqual(['10', '1']);

      const brouillonVue = ok(await f.get('owner', `/sales/orders/${c.id}/deposits`));
      expect(brouillonVue.deposits).toEqual([
        expect.objectContaining({
          invoiceId: prep.invoiceId,
          state: 'draft',
          recallCode: null,
          requestedAmount: '500.00',
          gapToRequested: '80.00',
        }),
      ]);
      expect(brouillonVue.warning).toMatch(/expert-comptable/);

      const emise = await emettre(prep.invoiceId);
      expect(emise.status).toBe('issued');
      expect(emise.number).toEqual(expect.any(String));

      const sansFinale = ok(await f.get('owner', `/sales/orders/${c.id}/deposits`));
      expect(sansFinale.deposits[0]).toMatchObject({
        state: 'issued',
        recallCode: emise.number,
        resolved: false,
      });
      expect(sansFinale.unresolved).toEqual([]);

      // Facture finale : rappel du code en ligne C, AUCUNE imputation.
      const finale = ok(
        await f.post('owner', `/sales/orders/${c.id}/prepare-invoice`, {
          expectedRevision: await revisionOf(`/sales/orders/${c.id}`),
        }),
      );
      expect(finale.warnings.map((w: { code: string }) => w.code)).toContain(
        'DEPOSIT_NOT_RESOLVED',
      );
      const fv = ok(await f.get('owner', `/sales/invoices/${finale.invoiceId}`));
      expect(fv.type).toBe('FV');
      expect(fv.comments.C).toBe(
        `Acompte ${emise.number} — Commande ${c.number} — réf. client BC-CLIENT-7`,
      );
      expect(fv.documentAmounts.payments).toEqual([]);
      expect(fv.lines.map((l: Record<string, string>) => [l.quantity, l.unitPrice])).toEqual([
        ['10', '120.00'],
        ['1', '300.00'],
      ]);
      for (const l of fv.lines as Record<string, string>[]) {
        expect(l.unitPrice.startsWith('-')).toBe(false);
        expect(l.quantity.startsWith('-')).toBe(false);
      }
      expect(fv.documentAmounts.calculation.totals.total).toBe('1740.00');

      const nonTraite = ok(await f.get('owner', `/sales/orders/${c.id}/deposits`));
      expect(nonTraite.unresolved).toEqual([prep.invoiceId]);
      expect(nonTraite.issues).toEqual([
        { code: 'DEPOSIT_NOT_RESOLVED', invoiceIds: [prep.invoiceId] },
      ]);
      expect(nonTraite.finals).toEqual([
        expect.objectContaining({ invoiceId: finale.invoiceId, kind: 'order_invoice' }),
      ]);

      // Un brouillon d'acompte ne se marque pas « traité ».
      const second = ok(
        await f.post('owner', `/sales/orders/${c.id}/prepare-deposit`, {
          expectedRevision: await revisionOf(`/sales/orders/${c.id}`),
          type: 'FT',
          requestedAmount: '100.00',
          taxGroup: 'B',
          label: 'Second acompte',
        }),
      );
      code(
        await f.post('owner', `/sales/orders/${c.id}/deposits/${second.invoiceId}/resolved`, {
          expectedRevision: await revisionOf(`/sales/orders/${c.id}`),
          reason: 'Essai',
        }),
        409,
        'DEPOSIT_NOT_ISSUED',
      );
      // Le Commercial (sans `sales.manage`) ne marque rien.
      expect(
        (
          await rep.post(`/sales/orders/${c.id}/deposits/${prep.invoiceId}/resolved`, {
            expectedRevision: await revisionOf(`/sales/orders/${c.id}`),
            reason: 'Essai',
          })
        ).status,
      ).toBe(403);
      code(
        await f.post('owner', `/sales/orders/${c.id}/deposits/${prep.invoiceId}/resolved`, {
          expectedRevision: 1,
          reason: 'Essai',
        }),
        409,
        'STALE_REVISION',
      );
      const traite = ok(
        await f.post('owner', `/sales/orders/${c.id}/deposits/${prep.invoiceId}/resolved`, {
          expectedRevision: await revisionOf(`/sales/orders/${c.id}`),
          reason: 'Facture finale pour le total, selon l’expert-comptable',
        }),
      );
      expect(traite.unresolved).toEqual([]);
      expect(traite.issues).toEqual([]);
      expect(traite.deposits.find((d: any) => d.invoiceId === prep.invoiceId)).toMatchObject({
        resolved: true,
        resolution: {
          reason: 'Facture finale pour le total, selon l’expert-comptable',
          resolvedBy: f.userId('owner'),
        },
      });
      code(
        await f.post('owner', `/sales/orders/${c.id}/deposits/${prep.invoiceId}/resolved`, {
          expectedRevision: await revisionOf(`/sales/orders/${c.id}`),
          reason: 'Encore',
        }),
        409,
        'DEPOSIT_ALREADY_RESOLVED',
      );
      // Le geste ne touche à aucune facture.
      const fvApres = ok(await f.get('owner', `/sales/invoices/${finale.invoiceId}`));
      expect(fvApres.revision).toBe(fv.revision);

      const audit = await f
        .db()
        .collection('audit_events')
        .find({
          organizationId: f.orgId(),
          action: { $in: ['sales_order.deposit_prepared', 'sales_order.deposit_resolved'] },
          targetId: c.id,
        })
        .toArray();
      expect(audit.map((a) => a['action']).sort()).toEqual([
        'sales_order.deposit_prepared',
        'sales_order.deposit_prepared',
        'sales_order.deposit_resolved',
      ]);
    });

    it('contrat signé : FT brouillon « Acompte — contrat CT… », ligne C « Contrat CT… », lien contract_deposit', async () => {
      const c = await contratSigne();
      expect(c.status).toBe('signed');
      const prep = ok(
        await f.post('owner', `/sales/contracts/${c.id}/prepare-deposit`, {
          expectedRevision: c.revision,
          type: 'FT',
          requestedAmount: '1000.00',
          taxGroup: 'B',
        }),
      );
      const ft = ok(await f.get('owner', `/sales/invoices/${prep.invoiceId}`));
      expect(ft).toMatchObject({ status: 'draft', type: 'FT', currency: 'USD' });
      expect(ft.lines).toHaveLength(1);
      expect(ft.lines[0]).toMatchObject({
        taxGroup: 'B',
        quantity: '1',
        unitPrice: '1000.00',
        name: `Acompte — contrat ${c.number}`,
      });
      expect(ft.comments.C).toBe(`Contrat ${c.number}`);
      const link = await f
        .db()
        .collection('sales_document_links')
        .findOne({ organizationId: f.orgId(), invoiceId: prep.invoiceId });
      expect(link).toMatchObject({
        kind: 'contract_deposit',
        contractId: c.id,
        requestedAmount: '1000.00',
      });
      // Le contrat signé reste immuable : seule sa révision avance.
      const apres = ok(await f.get('owner', `/sales/contracts/${c.id}`));
      expect(apres.contentSha256).toBe(c.contentSha256);
      expect(apres.revision).toBe(c.revision + 1);
      const vue = ok(await f.get('viewer', `/sales/contracts/${c.id}/deposits`));
      expect(vue.owner).toMatchObject({ kind: 'contract', number: c.number });
      expect(vue.deposits).toHaveLength(1);
    });

    it('jamais d’émission automatique : un acompte préparé reste un brouillon sans numéro', async () => {
      const links = await f
        .db()
        .collection('sales_document_links')
        .find({ organizationId: f.orgId(), kind: { $in: ['order_deposit', 'contract_deposit'] } })
        .toArray();
      expect(links.length).toBeGreaterThan(0);
      const normalisees = await f
        .db()
        .collection('sales_invoices')
        .find({ status: { $in: ['pending_normalization', 'normalized', 'normalization_failed'] } })
        .toArray();
      expect(normalisees).toEqual([]);
    });
  });

  // ── Critère 13 ───────────────────────────────────────────────────────────

  describe('raccords inchangés (critère 13)', () => {
    it('FT préparée puis émise ≡ FT saisie à la main : pièce, écritures, réalisé, règlement', async () => {
      const c = await commandeConfirmee({ priceMode: 'ttc' });
      const prep = ok(
        await f.post('owner', `/sales/orders/${c.id}/prepare-deposit`, {
          expectedRevision: c.revision,
          type: 'FT',
          requestedAmount: '232.00',
          taxGroup: 'B',
        }),
      );
      expect(prep.warnings).toEqual([]);
      const draft = ok(await f.get('owner', `/sales/invoices/${prep.invoiceId}`));
      // La même facture, saisie à la main par la route existante.
      const manuelle = ok(await f.post('owner', '/sales/invoices', corpsFacture(draft)), 201);
      const a = await emettre(prep.invoiceId);
      const b = await emettre(manuelle.id);

      const docs = await f
        .db()
        .collection('sales_invoices')
        .find({ _id: { $in: [new ObjectId(a.id), new ObjectId(b.id)] } })
        .toArray();
      const [da, db] = [a.id, b.id].map((id) => docs.find((d) => String(d._id) === id)!);
      const IDENTITE = [
        '_id',
        'number',
        'proformaRef',
        'fiscalSeq',
        'createdAt',
        'updatedAt',
        'issuedAt',
        'frozenAt',
        'contentSha256',
        'createdBy',
        'updatedBy',
        'issuedBy',
        'searchKey',
        'journal',
        'revision',
        'sortAt',
      ];
      const sansIdentite = (d: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(d).filter(([k]) => !IDENTITE.includes(k)));
      expect(JSON.parse(JSON.stringify(sansIdentite(da!)))).toEqual(
        JSON.parse(JSON.stringify(sansIdentite(db!))),
      );

      // Comptabilité (ADR-0049) : mêmes écritures, `sale.deposit.*`, au compte d'attente.
      const ctx: PostingContext = {
        ruleSet: null,
        suspenseAccount: 'ATTENTE',
        bookCurrency: 'USD',
        cutoverDate: '2000-01-01',
        enteredRates: [],
        chartPack: null,
        customerAccounts: {},
        supplierAccounts: {},
        treasuryAccounts: {},
        vatRegistered: true,
        stockPosting: 'off',
      };
      const neutre = (d: Record<string, unknown>) => {
        const v = salesInvoiceView(d as SourceDoc)!;
        expect(v).not.toBeNull();
        return { ...v, id: 'X', number: 'N' };
      };
      const [va, vb] = [neutre(da!), neutre(db!)];
      expect(va).toEqual(vb);
      const [ea, eb] = [entriesForSalesInvoice(va, ctx), entriesForSalesInvoice(vb, ctx)];
      expect(ea).toEqual(eb);
      expect(ea.skipped).toBeNull();
      expect(ea.entries.length).toBeGreaterThan(0);
      const json = JSON.stringify(ea.entries);
      expect(json).toContain('sale.deposit.receivable');
      expect(json).not.toContain('sale.invoice');
      for (const e of ea.entries) {
        for (const l of e.lines as unknown as { accountNumber: string }[]) {
          expect(l.accountNumber).toBe('ATTENTE');
        }
      }

      // Réalisé (ADR-0031) : un acompte est exclu, qu'il vienne d'une commande ou non.
      const revenu = (d: Record<string, any>, id: string): RevenueDocumentInput => ({
        id,
        issuedOn: '2026-11-02',
        kind: 'deposit',
        document: { currency: d.currency, groups: d.documentAmounts.calculation.totals.groups },
        normalized: null,
      });
      const ra = aggregateRevenueByMonth([revenu(da!, 'X')], 'USD');
      const rb = aggregateRevenueByMonth([revenu(db!, 'X')], 'USD');
      expect(ra).toEqual(rb);

      // Trésorerie et encaissements (ADR-0031, ADR-0034) : même créance, même règlement.
      const reglements = ok(await f.get('owner', `/sales/settlements?invoiceIds=${a.id},${b.id}`));
      const items = (Array.isArray(reglements) ? reglements : reglements.items) as Record<
        string,
        any
      >[];
      const [sa, sb] = [a.id, b.id].map((id) => items.find((s) => s.invoiceId === id)!);
      expect({ ...sa, invoiceId: 'X', number: 'N' }).toEqual({
        ...sb,
        invoiceId: 'X',
        number: 'N',
      });
    });

    it('ni la comptabilité, ni le réalisé, ni la trésorerie ne lisent les liens ou les marques « traité »', () => {
      const racine = join(fileURLToPath(new URL('.', import.meta.url)), '..');
      const sources = (dir: string): string[] =>
        readdirSync(dir).flatMap((n) => {
          const p = join(dir, n);
          if (statSync(p).isDirectory()) return sources(p);
          return p.endsWith('.ts') && !p.includes('.test.') ? [p] : [];
        });
      for (const module of ['accounting', 'actuals', 'treasury']) {
        for (const fichier of sources(join(racine, module))) {
          const texte = readFileSync(fichier, 'utf8');
          expect(texte, fichier).not.toMatch(/sales_document_links|sales_deposit_resolutions/);
          expect(texte, fichier).not.toMatch(/sales\/contracts\//);
        }
      }
    });
  });

  // ── Isolation (critère 17) ───────────────────────────────────────────────

  describe('isolation (critère 17)', () => {
    it('toute commande, tout contrat ou toute facture d’une autre organisation répond 404', async () => {
      const c = await commandeConfirmee();
      const body = {
        expectedRevision: c.revision,
        type: 'FT',
        requestedAmount: '100.00',
        taxGroup: 'B',
      };
      expect((await f.get('ownerB', `/sales/orders/${c.id}/deposits`)).status).toBe(404);
      expect((await f.post('ownerB', `/sales/orders/${c.id}/prepare-deposit`, body)).status).toBe(
        404,
      );
      const prep = ok(await f.post('owner', `/sales/orders/${c.id}/prepare-deposit`, body));
      expect(
        (
          await f.post('ownerB', `/sales/orders/${c.id}/deposits/${prep.invoiceId}/resolved`, {
            expectedRevision: 1,
            reason: 'Essai',
          })
        ).status,
      ).toBe(404);
      // Une facture qui n'est pas un acompte de CETTE commande : 404.
      const autre = await commandeConfirmee();
      code(
        await f.post('owner', `/sales/orders/${autre.id}/deposits/${prep.invoiceId}/resolved`, {
          expectedRevision: autre.revision,
          reason: 'Essai',
        }),
        404,
        'SALES_DEPOSIT_NOT_FOUND',
      );
      code(
        await f.post(
          'owner',
          `/sales/orders/${c.id}/deposits/${new ObjectId().toHexString()}/resolved`,
          { expectedRevision: 1, reason: 'Essai' },
        ),
        404,
        'SALES_DEPOSIT_NOT_FOUND',
      );
      expect(
        (await f.get('ownerB', `/sales/contracts/${new ObjectId().toHexString()}/deposits`)).status,
      ).toBe(404);
    });
  });
});
