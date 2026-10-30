// Branchements « argent » des projets du RUN — ADR-0039 (lot L4a).
//
// Critères d'acceptation couverts : 2 (404 entre organisations, y compris
// `quoteId`, `invoiceId`, `workProjectId` d'une dépense forgés), 12 (devis →
// projet sans montant, double création 409, devis envoyé 409), 13 (jalon →
// brouillon `FV` sans numéro, aux prix du devis, jamais normalisé ; seconde
// préparation 409), 14 (marge multi-devises exacte, temps sans taux signalé,
// `actual_periods` et plans inchangés), 15 (détail par membre réservé à
// `treasury.manage`).
//
// ADR-0040 — C7 (critère 15) : opportunité gagnée → projet (création, 409 en
// double, refus si non gagnée, isolation, droits), suggestion `CREATE_PROJECT`
// et notification `crm.opportunity_won` au seul responsable, idempotente.
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

import 'reflect-metadata';

import { createHash, randomBytes } from 'node:crypto';
import { describe, beforeAll, expect, it, vi } from 'vitest';

import { ObjectId } from 'mongodb';

import { CrmNotifier } from '../crm/crm-notifier.js';
import { CRM_OPPORTUNITY_EVENTS, type CrmOpportunityEvents } from '../crm/opportunity-events.js';
import type { NotificationInput } from '../notifications/notifications.port.js';
import { SALES_INVOICE_NORMALIZER } from '../sales/invoices/normalization.port.js';
import { kinshasaDayOf } from '../sales/receipts/kinshasa-day.js';
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

/** Ligne libre au groupe B (16 %). */
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

e2eSuite('projets du RUN — devis, factures, dépenses, marge (ADR-0039 L4a)', () => {
  const f = useWorkFixture('wbill');
  const today = () => kinshasaDayOf(new Date());
  let customer = '';
  let customerB = '';
  let accepted: Record<string, any> = {};
  let sent: Record<string, any> = {};
  let acceptedB: Record<string, any> = {};
  let projectId = '';
  let projectB = '';
  let milestoneId = '';
  let lineTaskId = '';
  let draftId = '';
  let issued: Record<string, any> = {};

  const ok = (res: { status: number; body: unknown }, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };

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

  /** Brouillon, paiements déclarés, émission (circuit normal, sans normalisation). */
  async function emettre(
    payments: (total: string) => { method: string; amount: string }[],
  ): Promise<Record<string, any>> {
    const body = {
      type: 'FV',
      currency: 'USD',
      priceMode: 'ht',
      customer: { customerId: customer, printContactDetails: false },
      pointOfSaleId: null,
      lines: [ligne('Conseil (heure)', '2', '40.00')],
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
        payments: payments(total),
        expectedRevision: d.revision,
      }),
    );
    return ok(
      await f.post('owner', `/sales/invoices/${d.id}/issue`, { expectedRevision: p.revision }),
    );
  }

  /** Empreinte des collections du plan et du réalisé : la marge n'y écrit jamais. */
  async function planAndActualsFingerprint(): Promise<string> {
    const names = (await f.db().listCollections().toArray())
      .map((c) => c.name)
      .filter((n) => /^(actual_|plan|project|business_plan)/.test(n))
      .sort();
    const hash = createHash('sha256');
    for (const n of names) {
      const docs = await f.db().collection(n).find({}).sort({ _id: 1 }).toArray();
      hash.update(`${n}:${JSON.stringify(docs)}`);
    }
    return `${names.join(',')}#${hash.digest('hex')}`;
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
    const lignes = [
      ligne('Pose du carrelage', '12', '15.00', 'm²'),
      ligne('Peinture', '1', '250.00', 'forfait'),
      ligne('Plomberie', '3', '40.00'),
    ];
    const corps = (c: string) => ({
      currency: 'USD',
      priceMode: 'ht',
      customer: { customerId: c, printContactDetails: false },
      lines: lignes,
      title: 'Rénovation Gombe',
      notes: null,
    });
    accepted = await devis('owner', corps(customer), 'accepted');
    sent = await devis('owner', corps(customer), 'sent');
    acceptedB = await devis('ownerB', corps(customerB), 'accepted');
  }, E2E_HOOK_TIMEOUT_MS);

  describe('devis accepté → projet client (§ 6.1, critère 12)', () => {
    it('droits : Lecteur, Analyste et Conseiller refusés', async () => {
      for (const who of ['viewer', 'analyst', 'advisor'] as const) {
        const res = await f.post(who, '/work/projects/from-quote', { quoteId: accepted.id });
        expect(res.status, who).toBe(403);
      }
    });

    it('devis envoyé : 409 WORK_QUOTE_NOT_ACCEPTED ; devis d’une autre organisation : 404', async () => {
      const envoye = await f.post('owner', '/work/projects/from-quote', { quoteId: sent.id });
      expect(envoye.status).toBe(409);
      expect(envoye.body.code).toBe('WORK_QUOTE_NOT_ACCEPTED');
      const autre = await f.post('owner', '/work/projects/from-quote', { quoteId: acceptedB.id });
      expect(autre.status).toBe(404);
      expect(autre.body.code).toBe('QUOTE_NOT_FOUND');
      const horsDevis = await f.post('owner', '/work/projects/from-quote', {
        quoteId: accepted.id,
        lineIndexes: [0, 7],
      });
      expect(horsDevis.status).toBe(400);
      expect(f.issueCodes(horsDevis)).toContain('INVALID_VALUE');
    });

    it('crée le projet : une tâche par ligne retenue, sans montant, et un jalon final', async () => {
      const p = ok(
        await f.post('owner', '/work/projects/from-quote', {
          quoteId: accepted.id,
          lineIndexes: [2, 0],
          milestone: { title: 'Réception du chantier', dueDate: today() },
        }),
        201,
      );
      projectId = p.id;
      expect(p).toMatchObject({
        name: 'Rénovation Gombe',
        kind: 'client',
        status: 'active',
        links: {
          customerId: customer,
          customerName: 'Client Gombe SARL',
          quotes: [{ quoteId: accepted.id, number: accepted.number }],
        },
        source: { kind: 'quote', quoteId: accepted.id, quoteVersion: 1 },
      });
      const tasks = ok(await f.get('viewer', `/work/projects/${projectId}/tasks`));
      const items = tasks.items as Record<string, any>[];
      expect(items.map((t) => [t.number, t.title, t.isMilestone])).toEqual([
        [1, 'Pose du carrelage', false],
        [2, 'Plomberie', false],
        [3, 'Réception du chantier', true],
      ]);
      lineTaskId = items[0]!.id;
      milestoneId = items[2]!.id;
      // Origine de chaque tâche (vue détaillée) : la ligne du devis, jamais un montant.
      const sources = await Promise.all(
        items.map(async (t) => ok(await f.get('viewer', `/work/tasks/${t.id}`)).source),
      );
      expect(sources).toEqual([
        { kind: 'quote_line', quoteId: accepted.id, lineIndex: 0 },
        { kind: 'quote_line', quoteId: accepted.id, lineIndex: 2 },
        null,
      ]);
      // Aucun montant recopié : ni prix, ni total, dans les tâches stockées.
      const stored = await f.db().collection('work_tasks').find({ projectId }).toArray();
      const text = JSON.stringify(stored);
      for (const amount of ['15.00', '250.00', '40.00', accepted.total]) {
        expect(text).not.toContain(amount);
      }
      const detail = ok(await f.get('viewer', `/work/tasks/${lineTaskId}`));
      expect(detail.description).toContain('Quantité : 12 m²');
      // Une nouvelle tâche reçoit le numéro suivant (compteur posé à la création).
      const t = ok(
        await f.post('analyst', `/work/projects/${projectId}/tasks`, { title: 'Nettoyage' }),
        201,
      );
      expect(t.task.number).toBe(4);
    });

    it('une seconde fois : 409 WORK_PROJECT_EXISTS_FOR_QUOTE avec le projet existant', async () => {
      const again = await f.post('admin', '/work/projects/from-quote', { quoteId: accepted.id });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({
        code: 'WORK_PROJECT_EXISTS_FOR_QUOTE',
        details: { projectId },
      });
      const found = ok(await f.get('viewer', `/work/quotes/${accepted.id}/project`));
      expect(found).toEqual({ projectId });
      expect(ok(await f.get('viewer', `/work/quotes/${sent.id}/project`))).toEqual({
        projectId: null,
      });
      // Le devis n'a pas été modifié par le module.
      const q = ok(await f.get('owner', `/sales/quotes/${accepted.id}`));
      expect(q.revision).toBe(accepted.revision);
      projectB = ok(
        await f.post('ownerB', '/work/projects/from-quote', { quoteId: acceptedB.id }),
        201,
      ).id;
    });
  });

  describe('jalon terminé → brouillon de facture (§ 6.3, critère 13)', () => {
    it('jalon non terminé : 409 ; tâche ordinaire : 409 ; terminé : suggestion PREPARE_INVOICE', async () => {
      const early = await f.post('owner', `/work/tasks/${milestoneId}/prepare-invoice`, {
        source: 'empty',
      });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('WORK_MILESTONE_NOT_DONE');
      const plain = await f.post('owner', `/work/tasks/${lineTaskId}/prepare-invoice`, {
        source: 'empty',
      });
      expect(plain.status).toBe(409);
      expect(plain.body.code).toBe('WORK_TASK_NOT_MILESTONE');
      const m = ok(await f.get('viewer', `/work/tasks/${milestoneId}`));
      const done = ok(
        await f.post('analyst', `/work/tasks/${milestoneId}/complete`, {
          expectedRevision: m.revision,
        }),
      );
      expect(done.suggestions).toEqual([{ code: 'PREPARE_INVOICE', taskId: milestoneId }]);
    });

    it('sans sales.manage : 403 ; autre organisation : 404', async () => {
      const analyst = await f.post('analyst', `/work/tasks/${milestoneId}/prepare-invoice`, {
        source: 'empty',
      });
      expect(analyst.status).toBe(403);
      expect(analyst.body.action).toBe('sales.manage');
      const b = await f.post('ownerB', `/work/tasks/${milestoneId}/prepare-invoice`, {
        source: 'empty',
      });
      expect(b.status).toBe(404);
      const forged = await f.post('owner', `/work/tasks/${milestoneId}/prepare-invoice`, {
        source: 'quote_lines',
        quoteId: acceptedB.id,
        lineIndexes: [0],
      });
      expect(forged.status).toBe(404);
    });

    it('brouillon FV aux prix du devis, sans numéro, jamais normalisé ; seconde fois 409', async () => {
      const normalizer = f.app().get(SALES_INVOICE_NORMALIZER) as Record<string, unknown>;
      const spies = Object.keys(Object.getPrototypeOf(normalizer) ?? {})
        .concat(Object.keys(normalizer))
        .filter((k) => typeof normalizer[k] === 'function' && k !== 'constructor')
        .map((k) => vi.spyOn(normalizer as Record<string, () => unknown>, k as never));

      const res = ok(
        await f.post('accountant', `/work/tasks/${milestoneId}/prepare-invoice`, {
          source: 'quote_lines',
          quoteId: accepted.id,
          lineIndexes: [0, 1, 2],
        }),
        201,
      );
      draftId = res.invoiceId;
      expect(res.link).toMatchObject({
        invoiceId: draftId,
        number: null,
        status: 'draft',
        currency: 'USD',
        milestoneTaskId: milestoneId,
        origin: 'milestone',
      });
      expect(res.task.id).toBe(milestoneId);
      const jalon = ok(await f.get('viewer', `/work/tasks/${milestoneId}`));
      expect(jalon.billing).toMatchObject({
        invoiceId: draftId,
        preparedBy: f.userId('accountant'),
      });

      const inv = ok(await f.get('owner', `/sales/invoices/${draftId}`));
      expect(inv).toMatchObject({ status: 'draft', type: 'FV', currency: 'USD', priceMode: 'ht' });
      expect(inv.number ?? null).toBeNull();
      expect(inv.documentAmounts.calculation.totals.total).toBe(accepted.total);
      expect(inv.lines.map((l: { unitPrice: string }) => l.unitPrice)).toEqual([
        '15.00',
        '250.00',
        '40.00',
      ]);
      expect(inv.comments.C).toBe('Projet Rénovation Gombe — jalon Réception du chantier');
      const raw = await f
        .db()
        .collection('sales_invoices')
        .findOne({ proformaRef: inv.proformaRef });
      expect(raw).toMatchObject({
        status: 'draft',
        number: null,
        normalization: null,
        issuedAt: null,
      });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      vi.restoreAllMocks();

      const again = await f.post('owner', `/work/tasks/${milestoneId}/prepare-invoice`, {
        source: 'empty',
      });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('WORK_MILESTONE_ALREADY_INVOICED');
    });

    it('brouillon supprimé : le lien orphelin disparaît et le jalon se prépare de nouveau', async () => {
      ok(await f.del('owner', `/sales/invoices/${draftId}`), 204);
      const list = ok(await f.get('viewer', `/work/projects/${projectId}/invoices`));
      expect(list.items).toEqual([]);
      const res = ok(
        await f.post('owner', `/work/tasks/${milestoneId}/prepare-invoice`, { source: 'empty' }),
        201,
      );
      draftId = res.invoiceId;
      const inv = ok(await f.get('owner', `/sales/invoices/${draftId}`));
      expect(inv).toMatchObject({ status: 'draft', currency: 'USD', lines: [] });
    });
  });

  describe('liens facture ↔ projet (§ 2.9)', () => {
    it('lier une facture émise ; même facture ailleurs 409 ; facture d’une autre organisation 404', async () => {
      issued = await emettre((total) => {
        const half = (Number(total) / 2).toFixed(2);
        return [
          { method: 'MOBILEMONEY', amount: half },
          { method: 'CREDIT', amount: (Number(total) - Number(half)).toFixed(2) },
        ];
      });
      expect(issued.documentAmounts.calculation.totals.total).toBe('92.80');
      ok(
        await f.post('admin', `/work/projects/${projectId}/invoices`, { invoiceId: issued.id }),
        201,
      );
      // Relier la même facture au même projet : idempotent.
      const again = ok(
        await f.post('owner', `/work/projects/${projectId}/invoices`, { invoiceId: issued.id }),
        201,
      );
      expect(again).toMatchObject({ invoiceId: issued.id, origin: 'manual', status: 'issued' });

      const other = ok(
        await f.post('owner', '/work/projects', { name: 'Autre', kind: 'client' }),
        201,
      );
      const taken = await f.post('owner', `/work/projects/${other.id}/invoices`, {
        invoiceId: issued.id,
      });
      expect(taken.status).toBe(409);
      expect(taken.body).toMatchObject({
        code: 'WORK_INVOICE_ALREADY_LINKED',
        details: { projectId },
      });

      const forged = await f.post('ownerB', `/work/projects/${projectB}/invoices`, {
        invoiceId: issued.id,
      });
      expect(forged.status).toBe(404);
      expect((await f.get('ownerB', `/work/projects/${projectId}/invoices`)).status).toBe(404);
      expect(
        (await f.post('viewer', `/work/projects/${projectId}/invoices`, { invoiceId: issued.id }))
          .status,
      ).toBe(403);

      // Encaissement du reste (46,40) : la facture est soldée.
      ok(
        await f.post('owner', '/sales/receipts', {
          receivedOn: today(),
          amount: '46.40',
          currency: 'USD',
          method: 'ESPECES',
          reference: null,
          note: null,
          allocations: [{ invoiceId: issued.id, amount: '46.40' }],
        }),
        201,
      );
      const list = ok(await f.get('viewer', `/work/projects/${projectId}/invoices`));
      expect(list.items.map((l: { origin: string }) => l.origin).sort()).toEqual([
        'manual',
        'milestone',
      ]);
    });

    it('délier puis relier ; délier une facture non liée : 404', async () => {
      const other = ok(
        await f.post('owner', '/work/projects', { name: 'Tampon', kind: 'internal' }),
        201,
      );
      const extra = await emettre((total) => [{ method: 'CREDIT', amount: total }]);
      ok(
        await f.post('owner', `/work/projects/${other.id}/invoices`, { invoiceId: extra.id }),
        201,
      );
      ok(await f.del('admin', `/work/projects/${other.id}/invoices/${extra.id}`), 204);
      const gone = await f.del('owner', `/work/projects/${other.id}/invoices/${extra.id}`);
      expect(gone.status).toBe(404);
      expect(
        (await f.del('analyst', `/work/projects/${projectId}/invoices/${issued.id}`)).status,
      ).toBe(403);
    });
  });

  describe('dépenses rattachées (§ 2.10, § 6.4)', () => {
    const depense = (extra: Record<string, unknown>) => ({
      spentOn: today(),
      amount: '20.00',
      currency: 'USD',
      category: 'achats',
      label: 'Carreaux',
      supplierName: null,
      accountId: null,
      deductibleVat: null,
      reference: null,
      ...extra,
    });

    it('projet d’une autre organisation : 404 ; rattachement, filtre, modification sans le champ', async () => {
      const forged = await f.post(
        'owner',
        '/treasury/expenses',
        depense({ workProjectId: projectB }),
      );
      expect(forged.status).toBe(404);
      expect(forged.body.code).toBe('EXPENSE_WORK_PROJECT_UNKNOWN');

      const usd = ok(
        await f.post('owner', '/treasury/expenses', depense({ workProjectId: projectId })),
        201,
      );
      expect(usd.workProjectId).toBe(projectId);
      ok(
        await f.post(
          'accountant',
          '/treasury/expenses',
          depense({
            workProjectId: projectId,
            amount: '10000.00',
            currency: 'CDF',
            label: 'Ciment',
          }),
        ),
        201,
      );
      // Une dépense annulée ne compte pas dans la marge.
      const annulee = ok(
        await f.post(
          'owner',
          '/treasury/expenses',
          depense({ workProjectId: projectId, amount: '999.00' }),
        ),
        201,
      );
      ok(await f.post('owner', `/treasury/expenses/${annulee.id}/cancel`, { reason: 'Doublon' }));
      // Sans projet.
      ok(await f.post('owner', '/treasury/expenses', depense({ amount: '5.00' })), 201);

      const filtered = ok(await f.get('viewer', `/treasury/expenses?workProjectId=${projectId}`));
      expect(filtered.items).toHaveLength(2);

      // PUT sans le champ : rattachement inchangé ; `null` : détaché.
      const kept = ok(
        await f.put('owner', `/treasury/expenses/${usd.id}`, {
          expectedRevision: usd.revision,
          expense: depense({ label: 'Carreaux (bis)' }),
        }),
      );
      expect(kept.workProjectId).toBe(projectId);
      const archived = ok(
        await f.post('owner', '/work/projects', { name: 'Archivé', kind: 'internal' }),
        201,
      );
      ok(
        await f.post('owner', `/work/projects/${archived.id}/archive`, {
          expectedRevision: archived.revision,
        }),
      );
      const refused = await f.put('owner', `/treasury/expenses/${usd.id}`, {
        expectedRevision: kept.revision,
        expense: depense({ workProjectId: archived.id }),
      });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('WORK_PROJECT_ARCHIVED');
    });
  });

  describe('marge par projet (§ 5, critères 14 et 15)', () => {
    it('temps : 90 min à 12,50 USD/h (Administrateur) et 30 min sans taux (Analyste)', async () => {
      ok(
        await f.post('owner', '/work/rates', {
          userId: f.userId('admin'),
          currency: 'USD',
          hourlyCost: '12.50',
          effectiveFrom: '2026-01-01',
        }),
        201,
      );
      ok(
        await f.post('owner', `/work/tasks/${lineTaskId}/time-entries`, {
          userId: f.userId('admin'),
          workedOn: today(),
          minutes: 90,
        }),
        201,
      );
      ok(
        await f.post('analyst', `/work/tasks/${lineTaskId}/time-entries`, {
          workedOn: today(),
          minutes: 30,
        }),
        201,
      );
    });

    it('valeurs exactes par devise, constats, et aucune écriture dans le plan ou le réalisé', async () => {
      const before = await planAndActualsFingerprint();
      const m = ok(await f.get('owner', `/work/projects/${projectId}/margin`));
      expect(m.projectId).toBe(projectId);
      expect(m.version).toBe('1.1.0');
      expect(m.currencies).toEqual([
        {
          currency: 'CDF',
          received: '0.00',
          refunded: '0.00',
          expenses: '10000.00',
          timeCost: '0.00',
          margin: '-10000.00',
          invoicedExclTax: '0.00',
          invoiceCount: 0,
          expenseCount: 1,
          timeMinutes: 0,
        },
        {
          currency: 'USD',
          received: '92.80',
          refunded: '0.00',
          expenses: '20.00',
          timeCost: '18.75',
          margin: '54.05',
          invoicedExclTax: '80.00',
          invoiceCount: 1,
          expenseCount: 1,
          timeMinutes: 90,
        },
      ]);
      expect(m.minutesWithoutRate).toBe(30);
      expect(m.findings).toEqual([
        { code: 'MULTI_CURRENCY', count: 2 },
        { code: 'TIME_WITHOUT_RATE', minutes: 30 },
        { code: 'DRAFT_INVOICES_IGNORED', count: 1 },
        { code: 'AMOUNTS_INCLUDE_TAX' },
      ]);
      expect(m.byMember).toEqual([
        {
          user: { userId: f.userId('admin'), name: 'Membre admin' },
          currency: 'USD',
          minutes: 90,
          cost: '18.75',
        },
      ]);
      // Recalculée à chaque lecture, jamais écrite : plan et réalisé inchangés.
      ok(await f.get('owner', `/work/projects/${projectId}/margin?from=${today()}&to=${today()}`));
      expect(await planAndActualsFingerprint()).toBe(before);
      expect((await f.db().listCollections().toArray()).some((c) => /margin/i.test(c.name))).toBe(
        false,
      );
    });

    it('sans treasury.manage : pas de détail par membre ; Conseiller 403 ; autre organisation 404', async () => {
      const admin = ok(await f.get('admin', `/work/projects/${projectId}/margin`));
      expect(admin.byMember).toBeNull();
      expect(admin.currencies).toHaveLength(2);
      const viewer = ok(await f.get('viewer', `/work/projects/${projectId}/margin`));
      expect(viewer.byMember).toBeNull();
      expect((await f.get('advisor', `/work/projects/${projectId}/margin`)).status).toBe(403);
      expect((await f.get('ownerB', `/work/projects/${projectId}/margin`)).status).toBe(404);
      const bad = await f.get(
        'owner',
        `/work/projects/${projectId}/margin?from=2026-10-10&to=2026-10-01`,
      );
      expect(bad.status).toBe(400);
    });

    it('le projet porte une facture et des dépenses : suppression refusée (archiver)', async () => {
      const res = await f.del('owner', `/work/projects/${projectId}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('WORK_PROJECT_NOT_EMPTY');
    });
  });

  // ── ADR-0040 — C7 : opportunité gagnée → projet (§ 6.4, critère 15) ─────────
  describe('opportunité gagnée → projet (ADR-0040 C7, critère 15)', () => {
    const crmNotes: NotificationInput[] = [];
    let wonKey = '';
    let openKey = '';
    let accountId = '';
    let gagnee: Record<string, any> = {};
    let ouverte: Record<string, any> = {};
    let fromOpp = '';

    const moveTo = async (o: Record<string, any>, stageKey: string) =>
      ok(
        await f.post('owner', `/crm/opportunities/${o.id}/move`, {
          expectedRevision: o.revision,
          stageKey,
        }),
      );

    beforeAll(async () => {
      // Enregistreur des notifications du CRM, autour du port réel.
      const notifier = f.app().get(CrmNotifier);
      const inner = notifier.port;
      notifier.port = {
        notify: async (input) => {
          crmNotes.push(input);
          await inner.notify(input);
        },
      };
      const settings = ok(await f.get('owner', '/crm/settings'));
      const stages = settings.stages as { key: string; kind: string }[];
      wonKey = stages.find((x) => x.kind === 'won')!.key;
      openKey = stages.find((x) => x.kind === 'open')!.key;
      const acc = await f
        .db()
        .collection('crm_accounts')
        .findOne({ organizationId: f.orgId(), customerId: customer });
      accountId = String(acc!['_id']);
      const corps = (title: string) => ({
        title,
        currency: 'USD',
        accountId,
        ownerId: f.userId('accountant'),
        lines: [
          { label: 'Audit des locaux', quantity: '2', unit: 'jour', unitPrice: '300.00' },
          { label: 'Rapport final', quantity: '1', unitPrice: '150.00' },
        ],
      });
      gagnee = ok(await f.post('owner', '/crm/opportunities', corps('Audit Gombe')), 201);
      ouverte = ok(await f.post('owner', '/crm/opportunities', corps('Audit en cours')), 201);
    }, E2E_HOOK_TIMEOUT_MS);

    it('passer en gagnée ne crée aucun projet ; suggère CREATE_PROJECT ; notifie le seul responsable', async () => {
      crmNotes.length = 0;
      const before = await f.db().collection('work_projects').countDocuments();
      const won = await moveTo(gagnee, wonKey);
      gagnee = won;
      expect(won.status).toBe('won');
      expect(won.suggestions).toEqual([{ code: 'CREATE_PROJECT' }]);
      expect(await f.db().collection('work_projects').countDocuments()).toBe(before);
      const notes = crmNotes.filter((n) => n.kind === 'crm.opportunity_won');
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        recipientUserId: f.userId('accountant'),
        organizationId: f.orgId(),
        href: `/crm/opportunites/${gagnee.id}`,
        actorUserId: f.userId('owner'),
      });
      expect(notes[0]!.title).toContain('Créer le projet ?');
      expect(notes[0]!.dedupeKey).toMatch(new RegExp(`^crm\\.opportunity_won:${gagnee.id}:`));
      // Idempotent : rejouer le même passage en gagné ne crée pas de doublon.
      const events = f.app().get<CrmOpportunityEvents>(CRM_OPPORTUNITY_EVENTS);
      const doc = await f
        .db()
        .collection('crm_opportunities')
        .findOne({ _id: new ObjectId(gagnee.id) });
      const event = {
        organizationId: f.orgId(),
        opportunityId: gagnee.id,
        ownerId: f.userId('accountant'),
        actorUserId: f.userId('owner'),
        source: 'user' as const,
        quoteId: null,
        wonAt: doc!['wonAt'] as Date,
      };
      await events.onWon(event);
      await events.onWon(event);
      expect(
        await f
          .db()
          .collection('notifications')
          .countDocuments({
            organizationId: f.orgId(),
            recipientUserId: f.userId('accountant'),
            kind: 'crm.opportunity_won',
            'source.entityId': gagnee.id,
          }),
      ).toBe(1);
      // Le responsable ne reçoit rien pour son propre geste ; un autre ne reçoit rien.
      expect(crmNotes.filter((n) => n.recipientUserId !== f.userId('accountant'))).toEqual([]);
    });

    it('droits : sans work.manage (Comptable, Lecteur) ou sans crm.read (Conseiller) → 403', async () => {
      for (const who of ['accountant', 'viewer', 'advisor', 'analyst'] as const) {
        const res = await f.post(who, '/work/projects/from-opportunity', {
          opportunityId: gagnee.id,
        });
        expect(res.status, who).toBe(403);
      }
      expect((await f.get('advisor', `/work/opportunities/${gagnee.id}/project`)).status).toBe(403);
    });

    it('opportunité non gagnée : 409 WORK_OPPORTUNITY_NOT_WON ; autre organisation : 404', async () => {
      const open = await f.post('owner', '/work/projects/from-opportunity', {
        opportunityId: ouverte.id,
      });
      expect(open.status).toBe(409);
      expect(open.body.code).toBe('WORK_OPPORTUNITY_NOT_WON');
      const autre = await f.post('ownerB', '/work/projects/from-opportunity', {
        opportunityId: gagnee.id,
      });
      expect(autre.status).toBe(404);
      expect(autre.body.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
      expect((await f.get('ownerB', `/work/opportunities/${gagnee.id}/project`)).body).toEqual({
        projectId: null,
      });
      const montant = await f.post('owner', '/work/projects/from-opportunity', {
        opportunityId: gagnee.id,
        amount: '1',
      });
      expect(montant.status).toBe(400);
    });

    it('crée le projet : une tâche par ligne de l’opportunité, sans montant, client du compte', async () => {
      const p = ok(
        await f.post('admin', '/work/projects/from-opportunity', { opportunityId: gagnee.id }),
        201,
      );
      fromOpp = p.id;
      expect(p).toMatchObject({
        name: 'Audit Gombe',
        kind: 'client',
        links: { customerId: customer, opportunityId: gagnee.id, quotes: [] },
        source: { kind: 'opportunity', opportunityId: gagnee.id },
      });
      const tasks = ok(await f.get('viewer', `/work/projects/${fromOpp}/tasks`));
      expect((tasks.items as Record<string, any>[]).map((t) => [t.number, t.title])).toEqual([
        [1, 'Audit des locaux'],
        [2, 'Rapport final'],
      ]);
      const stored = JSON.stringify(
        await f.db().collection('work_tasks').find({ projectId: fromOpp }).toArray(),
      );
      expect(stored).toContain('Quantité : 2 jour');
      for (const amount of ['300.00', '150.00', '750.00']) expect(stored).not.toContain(amount);
      expect(ok(await f.get('viewer', `/work/opportunities/${gagnee.id}/project`))).toEqual({
        projectId: fromOpp,
      });
    });

    it('une seconde fois : 409 WORK_PROJECT_EXISTS_FOR_OPPORTUNITY ; plus de suggestion', async () => {
      const again = await f.post('owner', '/work/projects/from-opportunity', {
        opportunityId: gagnee.id,
      });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({
        code: 'WORK_PROJECT_EXISTS_FOR_OPPORTUNITY',
        details: { projectId: fromOpp },
      });
      // Repasser par une étape ouverte puis gagnée : aucune suggestion, projet existant.
      const reopened = await moveTo(gagnee, openKey);
      expect(reopened.suggestions).toEqual([]);
      const rewon = await moveTo(reopened, wonKey);
      expect(rewon.suggestions).toEqual([]);
      const note = crmNotes.filter((n) => n.kind === 'crm.opportunity_won').at(-1)!;
      expect(note.title).not.toContain('Créer le projet');
    });

    it('avec un devis accepté : le projet est celui de from-quote, puis from-quote rend 409', async () => {
      crmNotes.length = 0;
      const avecDevis = ok(
        await f.post('owner', '/crm/opportunities', {
          title: 'Rénovation avec devis',
          currency: 'USD',
          accountId,
          ownerId: f.userId('accountant'),
        }),
        201,
      );
      const q = await devis(
        'owner',
        {
          currency: 'USD',
          priceMode: 'ht',
          customer: { customerId: customer, printContactDetails: false },
          lines: [ligne('Démolition', '1', '500.00', 'forfait'), ligne('Maçonnerie', '4', '80.00')],
          title: 'Rénovation devisée',
          notes: null,
          opportunityId: avecDevis.id,
        },
        'accepted',
      );
      // Le devis accepté fait gagner l'opportunité : notification au responsable, sans projet.
      const won = ok(await f.get('owner', `/crm/opportunities/${avecDevis.id}`));
      expect(won.status).toBe('won');
      const notes = crmNotes.filter((n) => n.kind === 'crm.opportunity_won');
      expect(notes).toHaveLength(1);
      expect(notes[0]!.dedupeKey).toBe(`crm.opportunity_won:${avecDevis.id}:quote:${q.id}`);
      // Désigner le devis d'une autre opportunité : 400.
      const mauvais = await f.post('owner', '/work/projects/from-opportunity', {
        opportunityId: avecDevis.id,
        quoteId: accepted.id,
      });
      expect(mauvais.status).toBe(400);
      expect(f.issueCodes(mauvais)).toContain('WORK_QUOTE_NOT_OF_OPPORTUNITY');

      const p = ok(
        await f.post('owner', '/work/projects/from-opportunity', { opportunityId: avecDevis.id }),
        201,
      );
      expect(p).toMatchObject({
        name: 'Rénovation devisée',
        links: { customerId: customer, opportunityId: avecDevis.id },
        source: { kind: 'quote', quoteId: q.id },
      });
      const tasks = ok(await f.get('viewer', `/work/projects/${p.id}/tasks`));
      expect((tasks.items as Record<string, any>[]).map((t) => t.title)).toEqual([
        'Démolition',
        'Maçonnerie',
      ]);
      const fromQuote = await f.post('admin', '/work/projects/from-quote', { quoteId: q.id });
      expect(fromQuote.status).toBe(409);
      expect(fromQuote.body.code).toBe('WORK_PROJECT_EXISTS_FOR_QUOTE');
      const again = await f.post('owner', '/work/projects/from-opportunity', {
        opportunityId: avecDevis.id,
      });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({
        code: 'WORK_PROJECT_EXISTS_FOR_OPPORTUNITY',
        details: { projectId: p.id },
      });
    });
  });
});
