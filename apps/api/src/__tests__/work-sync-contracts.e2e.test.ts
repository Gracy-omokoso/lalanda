// Contrat signé → projet — ADR-0077 § 1.
//
// Couvre : droits, contrat non signé (409), contrat d'une autre organisation (404),
// création (une tâche par ligne sans montant, un jalon par échéance), idempotence (second
// appel et appels concurrents → un seul projet), projet du devis relié plutôt que
// doublonné, un projet ne suit qu'un contrat (index unique partiel), réciproque
// `from-quote`, préparation par jalon refusée quand le contrat facture lui-même, marge
// qui lit les factures du contrat sans doublon. Aucune facture n'est émise par ce lot ;
// le contrat signé est posé directement en base (son circuit est couvert par
// `sales-contracts.e2e`).
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

import 'reflect-metadata';

import { randomBytes } from 'node:crypto';

import { ObjectId } from 'mongodb';
import { beforeAll, describe, expect, it } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
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

const ligne = (name: string, quantity: string, unitPrice: string, unit = 'heure') => ({
  source: 'free',
  code: null,
  name,
  itemType: 'SER',
  taxGroup: 'B',
  outOfScope: false,
  unit,
  quantity,
  unitPrice,
  specificTax: null,
  discount: null,
});

e2eSuite('contrat signé → projet (ADR-0077 § 1)', () => {
  const f = useWorkFixture('wsyncct');
  let customer = '';
  let customerB = '';
  let accepted: Record<string, any> = {};

  const ok = (res: { status: number; body: unknown }, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const code = (res: { status: number; body: any }, status: number, c: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code, JSON.stringify(res.body)).toBe(c);
  };

  /** Contrat posé en base (circuit de signature couvert ailleurs). */
  async function contrat(
    more: Record<string, unknown> = {},
    org: 'A' | 'B' = 'A',
  ): Promise<string> {
    const id = new ObjectId();
    await f
      .db()
      .collection('sales_contracts')
      .insertOne({
        _id: id,
        organizationId: org === 'A' ? f.orgId() : f.orgB(),
        number: `CT2611-${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`,
        version: 1,
        title: 'Maintenance du parc',
        status: 'signed',
        customerId: org === 'A' ? customer : customerB,
        opportunityId: null,
        source: null,
        ownerUserId: f.userId('owner'),
        currency: 'USD',
        priceMode: 'ht',
        customer: { customerId: customer, name: 'Client Gombe SARL' },
        lines: [
          {
            name: 'Maintenance mensuelle',
            quantity: '12',
            unit: 'mois',
            unitPrice: '500.00',
            lineRef: 'L1',
          },
          { name: 'Formation', quantity: '2', unit: 'jour', unitPrice: '300.00', lineRef: 'L2' },
        ],
        documentAmounts: {},
        startDate: '2026-11-01',
        initialTermMonths: 12,
        renewal: { mode: 'none', periodMonths: null, maxRenewals: null },
        noticeDays: 30,
        billing: {
          kind: 'schedule',
          items: [
            {
              itemRef: 'E1',
              dueDate: '2026-12-15',
              label: 'Installation',
              lines: [],
              documentAmounts: {},
            },
            {
              itemRef: 'E2',
              dueDate: '2027-03-15',
              label: 'Recette',
              lines: [],
              documentAmounts: {},
            },
          ],
        },
        clauses: null,
        approvals: [],
        signature: null,
        renewals: [],
        termination: null,
        cancellation: null,
        projectId: null,
        previousVersions: [],
        contentSha256: 'x'.repeat(64),
        searchKey: 'maintenance',
        revision: 4,
        createdBy: f.userId('owner'),
        updatedBy: f.userId('owner'),
        createdAt: new Date(),
        updatedAt: new Date(),
        _schemaVersion: 1,
        ...more,
      });
    return String(id);
  }

  async function devisAccepte(who: WorkAccount): Promise<Record<string, any>> {
    const d = ok(
      await f.post(who, '/sales/quotes', {
        currency: 'USD',
        priceMode: 'ht',
        customer: { customerId: customer, printContactDetails: false },
        lines: [ligne('Câblage', '10', '20.00', 'm')],
        title: 'Câblage du siège',
        notes: null,
      }),
      201,
    );
    const s = ok(await f.post(who, `/sales/quotes/${d.id}/send`, { expectedRevision: d.revision }));
    return ok(await f.post(who, `/sales/quotes/${d.id}/accept`, { expectedRevision: s.revision }));
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
    accepted = await devisAccepte('owner');
  }, E2E_HOOK_TIMEOUT_MS);

  describe('création, idempotence, isolation', () => {
    it('droits : Lecteur et Conseiller refusés', async () => {
      const id = await contrat();
      for (const who of ['viewer', 'advisor'] as const) {
        expect(
          (await f.post(who, '/work/projects/from-contract', { contractId: id })).status,
          who,
        ).toBe(403);
      }
    });

    it('contrat non signé : 409 ; autre organisation : 404', async () => {
      const brouillon = await contrat({ status: 'draft' });
      code(
        await f.post('owner', '/work/projects/from-contract', { contractId: brouillon }),
        409,
        'WORK_CONTRACT_NOT_SIGNED',
      );
      const resilie = await contrat({ status: 'terminated' });
      code(
        await f.post('owner', '/work/projects/from-contract', { contractId: resilie }),
        409,
        'WORK_CONTRACT_NOT_SIGNED',
      );
      const autre = await contrat({}, 'B');
      code(
        await f.post('owner', '/work/projects/from-contract', { contractId: autre }),
        404,
        'CONTRACT_NOT_FOUND',
      );
      expect((await f.get('owner', `/work/contracts/${autre}/project`)).status).toBe(404);
    });

    it('crée le projet : une tâche par ligne sans montant, un jalon par échéance ; second appel 409', async () => {
      const id = await contrat();
      const r = ok(await f.post('owner', '/work/projects/from-contract', { contractId: id }), 201);
      expect(r.outcome).toBe('created');
      expect(r.project).toMatchObject({
        name: 'Maintenance du parc',
        kind: 'client',
        source: null,
      });
      const tasks = ok(await f.get('viewer', `/work/projects/${r.project.id}/tasks`))
        .items as Record<string, any>[];
      expect(tasks.map((t) => [t.title, t.isMilestone, t.dueDate])).toEqual([
        ['Maintenance mensuelle', false, null],
        ['Formation', false, null],
        ['Installation', true, '2026-12-15'],
        ['Recette', true, '2027-03-15'],
      ]);
      // Aucun montant recopié.
      expect(JSON.stringify(tasks)).not.toMatch(/500|300\.00/);
      const doc = await f
        .db()
        .collection('sales_contracts')
        .findOne({ _id: new ObjectId(id) });
      expect(doc?.['projectId']).toBe(r.project.id);
      expect(doc?.['revision']).toBe(4);
      expect(ok(await f.get('viewer', `/work/contracts/${id}/project`))).toEqual({
        projectId: r.project.id,
      });
      const view = ok(await f.get('viewer', `/work/projects/${r.project.id}/contract`));
      expect(view.contract).toMatchObject({
        contractId: id,
        title: 'Maintenance du parc',
        status: 'signed',
        customerName: 'Client Gombe SARL',
        billingKind: 'schedule',
        scheduleItemCount: 2,
      });
      expect(JSON.stringify(view)).not.toMatch(/500\.00/);
      const again = await f.post('owner', '/work/projects/from-contract', { contractId: id });
      code(again, 409, 'WORK_PROJECT_EXISTS_FOR_CONTRACT');
      expect(again.body.details).toEqual({ projectId: r.project.id });
    });

    it('sans jalons sur demande ; lignes choisies', async () => {
      const id = await contrat();
      const r = ok(
        await f.post('owner', '/work/projects/from-contract', {
          contractId: id,
          scheduleMilestones: false,
          lineIndexes: [1],
        }),
        201,
      );
      const tasks = ok(await f.get('viewer', `/work/projects/${r.project.id}/tasks`))
        .items as Record<string, any>[];
      expect(tasks.map((t) => t.title)).toEqual(['Formation']);
    });

    it('appels concurrents : un seul projet', async () => {
      const id = await contrat();
      const results = await Promise.all(
        [0, 1, 2].map(() => f.post('owner', '/work/projects/from-contract', { contractId: id })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409).map((r) => r.body.code)).toEqual([
        'WORK_PROJECT_EXISTS_FOR_CONTRACT',
        'WORK_PROJECT_EXISTS_FOR_CONTRACT',
      ]);
      const n = await f
        .db()
        .collection('work_projects')
        .countDocuments({ organizationId: f.orgId(), name: 'Maintenance du parc' });
      const linked = await f
        .db()
        .collection('sales_contracts')
        .countDocuments({ organizationId: f.orgId(), projectId: { $type: 'string' } });
      expect(n).toBe(linked);
    });

    it('projet supprimé : le lien est retiré et le projet peut renaître', async () => {
      const id = await contrat({ billing: { kind: 'none' } });
      const r = ok(await f.post('owner', '/work/projects/from-contract', { contractId: id }), 201);
      expect((await f.del('owner', `/work/projects/${r.project.id}`)).status).toBe(204);
      expect(ok(await f.get('owner', `/work/contracts/${id}/project`))).toEqual({
        projectId: null,
      });
      ok(await f.post('owner', '/work/projects/from-contract', { contractId: id }), 201);
    });
  });

  describe('devis et opportunité : relier plutôt que doublonner', () => {
    it('le projet du devis d’origine est relié ; un second contrat du même devis : 409', async () => {
      const p = ok(
        await f.post('owner', '/work/projects/from-quote', { quoteId: accepted.id }),
        201,
      );
      const id = await contrat({
        source: { kind: 'quote', quoteId: accepted.id, quoteVersion: 1 },
      });
      const r = ok(await f.post('owner', '/work/projects/from-contract', { contractId: id }), 201);
      expect(r.outcome).toBe('linked');
      expect(r.project.id).toBe(p.id);
      // Aucune tâche ajoutée au projet du devis.
      const tasks = ok(await f.get('viewer', `/work/projects/${p.id}/tasks`)).items as unknown[];
      expect(tasks).toHaveLength(1);
      const second = await contrat({
        source: { kind: 'quote', quoteId: accepted.id, quoteVersion: 1 },
      });
      code(
        await f.post('owner', '/work/projects/from-contract', { contractId: second }),
        409,
        'WORK_PROJECT_HAS_CONTRACT',
      );
    });

    it('réciproque : un contrat du devis a son projet → from-quote 409 et lien rendu', async () => {
      const q = await devisAccepte('owner');
      const id = await contrat({ source: { kind: 'quote', quoteId: q.id, quoteVersion: 1 } });
      const r = ok(await f.post('owner', '/work/projects/from-contract', { contractId: id }), 201);
      expect(r.outcome).toBe('created');
      expect(r.project.links.quotes.map((x: { quoteId: string }) => x.quoteId)).toEqual([q.id]);
      const dup = await f.post('owner', '/work/projects/from-quote', { quoteId: q.id });
      code(dup, 409, 'WORK_PROJECT_EXISTS_FOR_QUOTE');
      expect(dup.body.details).toEqual({ projectId: r.project.id });
      expect(ok(await f.get('owner', `/work/quotes/${q.id}/project`))).toEqual({
        projectId: r.project.id,
      });
    });
  });

  describe('facturation et marge', () => {
    it('jalon d’un projet sous contrat à échéancier : 409 WORK_CONTRACT_BILLS_ITSELF', async () => {
      const id = await contrat();
      const r = ok(await f.post('owner', '/work/projects/from-contract', { contractId: id }), 201);
      const tasks = ok(await f.get('viewer', `/work/projects/${r.project.id}/tasks`))
        .items as Record<string, any>[];
      const jalon = tasks.find((t) => t.isMilestone)!;
      ok(
        await f.post('owner', `/work/tasks/${jalon.id}/complete`, {
          expectedRevision: jalon.revision,
        }),
      );
      const res = await f.post('owner', `/work/tasks/${jalon.id}/prepare-invoice`, {
        source: 'empty',
      });
      code(res, 409, 'WORK_CONTRACT_BILLS_ITSELF');
      expect(res.body.details).toEqual({ contractId: id });
    });

    it('la marge compte les factures du contrat, sans doublon avec un lien manuel', async () => {
      const id = await contrat({ billing: { kind: 'none' } });
      const r = ok(await f.post('owner', '/work/projects/from-contract', { contractId: id }), 201);
      const body = {
        type: 'FV',
        currency: 'USD',
        priceMode: 'ht',
        customer: { customerId: customer, printContactDetails: false },
        pointOfSaleId: null,
        lines: [ligne('Maintenance', '1', '100.00')],
        payments: [],
        comments: { A: null, C: null },
        creditNote: null,
        showUsdCounterValue: false,
      };
      const d = ok(await f.post('owner', '/sales/invoices', body), 201);
      const total = d.documentAmounts.calculation.totals.total as string;
      const p = ok(
        await f.put('owner', `/sales/invoices/${d.id}`, {
          ...body,
          payments: [{ method: 'MOBILEMONEY', amount: total }],
          expectedRevision: d.revision,
        }),
      );
      ok(await f.post('owner', `/sales/invoices/${d.id}/issue`, { expectedRevision: p.revision }));
      await f
        .db()
        .collection('sales_document_links')
        .insertOne({
          organizationId: f.orgId(),
          invoiceId: d.id,
          kind: 'contract_invoice',
          orderId: null,
          contractId: id,
          itemRef: null,
          occurrenceDate: null,
          lineMap: [],
          requestedAmount: null,
          linkedAt: new Date(),
          linkedBy: f.userId('owner'),
          _schemaVersion: 1,
        });
      const m1 = ok(await f.get('owner', `/work/projects/${r.project.id}/margin`));
      const usd1 = (m1.currencies as Record<string, any>[]).find((c) => c.currency === 'USD');
      expect(usd1).toMatchObject({ invoiceCount: 1, invoicedExclTax: '100.00' });
      // Lien manuel de la même facture : toujours une seule facture comptée.
      ok(
        await f.post('owner', `/work/projects/${r.project.id}/invoices`, { invoiceId: d.id }),
        201,
      );
      const m2 = ok(await f.get('owner', `/work/projects/${r.project.id}/margin`));
      const usd2 = (m2.currencies as Record<string, any>[]).find((c) => c.currency === 'USD');
      expect(usd2).toMatchObject({ invoiceCount: 1, invoicedExclTax: '100.00' });
    });
  });
});
