// Pièces de trésorerie possédées par les RH — ADR-0051 lot H11 (§ 7.1, § 7.2),
// contre la vraie application et MongoDB (replica set, transactions).
//
// Le module RH (lot H10) n'existe pas encore : ce test appelle les deux méthodes
// exportées par la trésorerie DANS UNE TRANSACTION, comme le fera le service RH,
// puis vérifie l'effet par les routes HTTP de la trésorerie.
//
// Exigences testées :
//  1. Remboursement d'une note de deux lignes (transport 15,00 USD projet P ;
//     charges_diverses 7,50 USD) : deux dépenses possédées (`expense_report`),
//     solde −22,50, libellé « Frais NF… — … » sans nom ; `PUT`, `cancel` et pièce
//     jointe par la trésorerie → 409 `EXPENSE_OWNED_BY_HR` ; un second
//     enregistrement des mêmes lignes est refusé (index unique) ; l'annulation par
//     les RH annule les deux et rend le solde.
//  2. Avance : versement `other_out` possédé (solde −100, aucune dépense, libellé
//     neutre) ; annulation par la trésorerie → 409 `MOVEMENT_OWNED_BY_HR` ; note
//     liée → dépenses SANS compte (solde inchangé, charge +80) ; retour en espèces
//     `other_in` ; complément (`top_up`) : charge entière une seule fois.
//  3. Prévision 1.2.0 : dépenses soldées par une avance exclues du constat
//     `EXPENSES_WITHOUT_ACCOUNT` ; fournisseur des RH relié (lot H10) : plus de
//     `HR_PAYABLES_NOT_INTEGRATED`.
//  4. Compatibilité achats : une dépense RH ne devient pas un paiement fournisseur.
//  5. Isolation : compte, projet, avance et dépense d'une autre organisation.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { TREASURY_VERSION } from '@lalanda/engine';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { Connection } from 'mongoose';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  TreasuryExpensesService,
  type HrExpenseReportInput,
} from '../treasury/treasury-expenses.service.js';
import {
  TreasuryMovementsService,
  type HrAdvanceMovementInput,
} from '../treasury/treasury-movements.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_treso_hr_${tag}`;

vi.setConfig({ testTimeout: 90_000 });

const MOT_DE_PASSE = 'Passw0rd!tresorerieRH';

/** Jour civil de Kinshasa (UTC+1), comme l'API. */
function kinshasaToday(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}
function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Code métier d'une exception Nest levée hors HTTP (appel direct du service). */
function codeOf(err: unknown): string | undefined {
  const res = (err as { getResponse?: () => unknown }).getResponse?.();
  return (res as { code?: string } | undefined)?.code;
}

e2eSuite('trésorerie — pièces possédées par les RH (ADR-0051, H11)', () => {
  let app: INestApplication;
  let db: Db;
  let connection: Connection;
  let expensesService: TreasuryExpensesService;
  let movementsService: TreasuryMovementsService;
  let orgId = '';
  let orgB = '';
  let ownerA: string[] = [];
  let ownerB: string[] = [];
  let actorA = { userId: '', role: 'owner' };
  let actorB = { userId: '', role: 'owner' };
  let banque = '';
  let banqueB = '';
  let projetP = '';
  const today = kinshasaToday();
  const day = (n: number) => addDays(today, -n);

  const server = () => app.getHttpServer();
  const asA = () => [...ownerA, `active_org_id=${orgId}`];
  const asB = () => [...ownerB, `active_org_id=${orgB}`];
  const get = (c: string[], path: string) => request(server()).get(path).set('Cookie', c);
  const post = (c: string[], path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', c)
      .send(body ?? {});
  const put = (c: string[], path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', c).send(body);

  /** Exécute `fn` dans une transaction, comme le service RH. */
  async function inTransaction<T>(fn: (session: import('mongoose').ClientSession) => Promise<T>) {
    const session = await connection.startSession();
    try {
      let out: T | undefined;
      await session.withTransaction(async () => {
        out = await fn(session);
      });
      return out as T;
    } finally {
      await session.endSession();
    }
  }

  async function failsWith(fn: () => Promise<unknown>): Promise<string | undefined> {
    try {
      await fn();
    } catch (err) {
      return codeOf(err) ?? (err as { code?: number }).code?.toString();
    }
    throw new Error('Appel attendu en échec.');
  }

  function report(over: Partial<HrExpenseReportInput> = {}): HrExpenseReportInput {
    return {
      organizationId: orgId,
      reportId: new ObjectId().toHexString(),
      reportNumber: 'NF2611-000001',
      currency: 'USD',
      paidOn: day(1),
      accountId: banque,
      settledByAdvanceId: null,
      reference: 'REMB-1',
      lines: [
        {
          lineIndex: 0,
          spentOn: day(3),
          amount: '15.00',
          category: 'transport',
          label: 'Taxi client',
          merchant: 'Taxi Gombe',
          workProjectId: projetP,
          deductibleVat: null,
        },
        {
          lineIndex: 1,
          spentOn: day(3),
          amount: '7.50',
          category: 'charges_diverses',
          label: 'Photocopies',
          merchant: null,
          workProjectId: null,
          deductibleVat: null,
        },
      ],
      actor: actorA,
      ...over,
    };
  }

  function advance(over: Partial<HrAdvanceMovementInput> = {}): HrAdvanceMovementInput {
    return {
      organizationId: orgId,
      kind: 'other_out',
      advanceId: new ObjectId().toHexString(),
      advanceNumber: 'AV2611-000001',
      settlementId: null,
      accountId: banque,
      currency: 'USD',
      date: day(10),
      amount: '100.00',
      reference: null,
      actor: actorA,
      ...over,
    };
  }

  async function balance(): Promise<string> {
    const res = await get(asA(), '/treasury/accounts');
    expect(res.status).toBe(200);
    return (res.body.items as { id: string; balance: string }[]).find((a) => a.id === banque)!
      .balance;
  }

  /** Total des dépenses enregistrées (charge) en USD, toutes catégories. */
  async function chargeUsd(): Promise<string> {
    const res = await get(asA(), '/treasury/expenses/summary');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.totalsByCurrency?.USD as string | undefined) ?? '0.00';
  }

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    connection = app.get<Connection>(getConnectionToken());
    expensesService = app.get(TreasuryExpensesService);
    movementsService = app.get(TreasuryMovementsService);

    const emailA = `treso-hr-a-${tag}@lalanda-test.local`;
    const emailB = `treso-hr-b-${tag}@lalanda-test.local`;
    ownerA = await registerAndLogin(app, {
      email: emailA,
      password: MOT_DE_PASSE,
      name: 'Tréso RH A',
    });
    ownerB = await registerAndLogin(app, {
      email: emailB,
      password: MOT_DE_PASSE,
      name: 'Tréso RH B',
    });
    orgId = ((await get(ownerA, '/organizations')).body.organizations as { id: string }[])[0]!.id;
    orgB = ((await get(ownerB, '/organizations')).body.organizations as { id: string }[])[0]!.id;
    const userA = await db.collection('user').findOne({ email: emailA });
    const userB = await db.collection('user').findOne({ email: emailB });
    actorA = { userId: String(userA!._id), role: 'owner' };
    actorB = { userId: String(userB!._id), role: 'owner' };

    const b = await post(asA(), '/treasury/accounts', {
      name: 'Banque USD',
      kind: 'bank',
      currency: 'USD',
      openingBalance: '1000.00',
      openingDate: '2026-01-01',
    });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    banque = b.body.id;
    const bb = await post(asB(), '/treasury/accounts', {
      name: 'Banque B',
      kind: 'bank',
      currency: 'USD',
      openingBalance: '50.00',
      openingDate: '2026-01-01',
    });
    expect(bb.status).toBe(201);
    banqueB = bb.body.id;

    // Projet du RUN, lu par la connexion (la trésorerie n'importe pas « work »).
    const p = await db
      .collection('work_projects')
      .insertOne({ organizationId: orgId, name: 'Projet P', status: 'active' });
    projetP = String(p.insertedId);
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, E2E_HOOK_TIMEOUT_MS);

  // ─── 1. Remboursement d'une note de frais ─────────────────────────────────

  describe('remboursement d’une note de frais', () => {
    const r = () => report({ reportId: reportId });
    let reportId = '';
    let ids: string[] = [];

    it('deux lignes → deux dépenses possédées, solde −22,50, libellé sans nom', async () => {
      reportId = new ObjectId().toHexString();
      const docs = await inTransaction((s) => expensesService.recordOwnedByExpenseReport(s, r()));
      ids = docs.map((d) => String(d._id));
      expect(ids).toHaveLength(2);
      expect(await balance()).toBe('977.50');

      const list = await get(asA(), '/treasury/expenses?status=all');
      expect(list.status).toBe(200);
      const mine = (list.body.items as Record<string, unknown>[]).filter((e) =>
        ids.includes(e['id'] as string),
      );
      expect(mine).toHaveLength(2);
      const taxi = mine.find((e) => e['category'] === 'transport')!;
      expect(taxi).toMatchObject({
        amount: '15.00',
        currency: 'USD',
        spentOn: day(3),
        label: 'Frais NF2611-000001 — Taxi client',
        supplierName: 'Taxi Gombe',
        supplierId: null,
        accountId: banque,
        workProjectId: projetP,
        reference: 'REMB-1',
        origin: {
          kind: 'expense_report',
          reportId,
          reportNumber: 'NF2611-000001',
          lineIndex: 0,
          settledByAdvanceId: null,
        },
      });
      // Marge du projet : la dépense est lisible par son projet (filtre de liste).
      const byProject = await get(asA(), `/treasury/expenses?workProjectId=${projetP}`);
      expect((byProject.body.items as { id: string }[]).map((e) => e.id)).toContain(taxi['id']);
    });

    it('PUT, annulation et pièce jointe par la trésorerie → 409 EXPENSE_OWNED_BY_HR', async () => {
      const id = ids[0]!;
      const putRes = await put(asA(), `/treasury/expenses/${id}`, {
        expectedRevision: 1,
        expense: {
          spentOn: day(3),
          amount: '1.00',
          currency: 'USD',
          category: 'transport',
          label: 'Détournée',
          supplierName: null,
          accountId: banque,
          deductibleVat: null,
          reference: null,
        },
      });
      expect(putRes.status, JSON.stringify(putRes.body)).toBe(409);
      expect(putRes.body.code).toBe('EXPENSE_OWNED_BY_HR');
      expect(putRes.body.details).toMatchObject({ reportId, reportNumber: 'NF2611-000001' });

      const cancel = await post(asA(), `/treasury/expenses/${id}/cancel`, { reason: 'test' });
      expect(cancel.status).toBe(409);
      expect(cancel.body.code).toBe('EXPENSE_OWNED_BY_HR');

      const detach = await request(server())
        .delete(`/treasury/expenses/${id}/attachment`)
        .set('Cookie', asA());
      expect(detach.status).toBe(409);
      expect(detach.body.code).toBe('EXPENSE_OWNED_BY_HR');
      expect(await balance()).toBe('977.50');
    });

    it('un second enregistrement des mêmes lignes est refusé (index unique), rien n’est écrit', async () => {
      const code = await failsWith(() =>
        inTransaction((s) => expensesService.recordOwnedByExpenseReport(s, r())),
      );
      expect(code).toBe('11000');
      expect(await balance()).toBe('977.50');
    });

    it('les règles de la trésorerie s’appliquent : devise, compte, date, ligne', async () => {
      const cdf = await post(asA(), '/treasury/accounts', {
        name: 'Caisse CDF',
        kind: 'cash',
        currency: 'CDF',
        openingBalance: '0',
        openingDate: '2026-01-01',
      });
      expect(cdf.status).toBe(201);
      const codes = await Promise.all([
        failsWith(() =>
          inTransaction((s) =>
            expensesService.recordOwnedByExpenseReport(s, report({ accountId: cdf.body.id })),
          ),
        ),
        failsWith(() =>
          inTransaction((s) =>
            expensesService.recordOwnedByExpenseReport(s, report({ paidOn: addDays(today, 2) })),
          ),
        ),
        failsWith(() =>
          inTransaction((s) =>
            expensesService.recordOwnedByExpenseReport(s, report({ lines: [] })),
          ),
        ),
        failsWith(() =>
          inTransaction((s) =>
            expensesService.recordOwnedByExpenseReport(
              s,
              report({ lines: [{ ...report().lines[0]!, amount: '0.00' }] }),
            ),
          ),
        ),
      ]);
      expect(codes).toEqual([
        'EXPENSE_ACCOUNT_CURRENCY_MISMATCH',
        'EXPENSE_IN_FUTURE',
        'EXPENSE_REPORT_EMPTY',
        'EXPENSE_REPORT_LINE_INVALID',
      ]);
    });

    it('une ligne antérieure à l’ouverture du compte reste permise (date de la charge)', async () => {
      const recent = await post(asA(), '/treasury/accounts', {
        name: 'Mobile récent',
        kind: 'mobile_money',
        currency: 'USD',
        openingBalance: '0',
        openingDate: day(2),
      });
      expect(recent.status).toBe(201);
      const docs = await inTransaction((s) =>
        expensesService.recordOwnedByExpenseReport(
          s,
          report({ accountId: recent.body.id, paidOn: day(1) }),
        ),
      );
      expect(docs.map((d) => d.spentOn)).toEqual([day(3), day(3)]);
      // Le décaissement, lui, doit suivre l'ouverture.
      const code = await failsWith(() =>
        inTransaction((s) =>
          expensesService.recordOwnedByExpenseReport(
            s,
            report({ accountId: recent.body.id, paidOn: day(5) }),
          ),
        ),
      );
      expect(code).toBe('EXPENSE_BEFORE_ACCOUNT_OPENING');
      await inTransaction((s) =>
        expensesService.cancelOwnedByExpenseReport(
          s,
          orgId,
          docs[0]!.origin!.kind === 'expense_report' ? docs[0]!.origin!.reportId : '',
          {},
          'Nettoyage',
          actorA,
        ),
      );
    });

    it('l’annulation par les RH annule les deux dépenses, garde `origin` et rend le solde', async () => {
      const n = await inTransaction((s) =>
        expensesService.cancelOwnedByExpenseReport(
          s,
          orgId,
          reportId,
          {},
          'Remboursement annulé',
          actorA,
        ),
      );
      expect(n).toBe(2);
      expect(await balance()).toBe('1000.00');
      const one = await get(asA(), `/treasury/expenses/${ids[0]}`);
      expect(one.body).toMatchObject({ status: 'cancelled', origin: { kind: 'expense_report' } });
      // Toujours verrouillée pour la trésorerie.
      const cancel = await post(asA(), `/treasury/expenses/${ids[0]}/cancel`, { reason: 'x' });
      expect(cancel.body.code).toBe('EXPENSE_OWNED_BY_HR');
      // Un nouveau remboursement de la même note redevient possible.
      const again = await inTransaction((s) => expensesService.recordOwnedByExpenseReport(s, r()));
      expect(again).toHaveLength(2);
      expect(await balance()).toBe('977.50');
      await inTransaction((s) =>
        expensesService.cancelOwnedByExpenseReport(s, orgId, reportId, {}, 'Fin', actorA),
      );
      expect(await balance()).toBe('1000.00');
    });
  });

  // ─── 2. Avances ────────────────────────────────────────────────────────────

  describe('avance au personnel : mouvement, jamais une charge', () => {
    const advanceId = new ObjectId().toHexString();
    let movementId = '';

    it('versement de 100,00 → un `other_out` possédé, solde −100, aucune dépense', async () => {
      const chargeBefore = await chargeUsd();
      const m = await inTransaction((s) =>
        movementsService.recordOwnedByAdvance(s, advance({ advanceId })),
      );
      movementId = m.id;
      expect(m).toMatchObject({
        kind: 'other_out',
        label: 'Avance au personnel AV2611-000001',
        fromAccountId: banque,
        amountOut: '100.00',
        origin: {
          kind: 'employee_advance',
          advanceId,
          advanceNumber: 'AV2611-000001',
          settlementId: null,
        },
      });
      expect(await balance()).toBe('900.00');
      expect(await chargeUsd()).toBe(chargeBefore);

      const ledger = await get(asA(), `/treasury/movements?accountId=${banque}`);
      const entry = (ledger.body.items as Record<string, unknown>[]).find(
        (e) => e['id'] === movementId,
      );
      expect(entry).toMatchObject({
        source: 'other_out',
        origin: { kind: 'employee_advance', advanceId },
      });
    });

    it('annulation par la trésorerie → 409 MOVEMENT_OWNED_BY_HR ; second versement refusé', async () => {
      const res = await post(asA(), `/treasury/movements/${movementId}/cancel`, { reason: 'x' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MOVEMENT_OWNED_BY_HR');
      expect(res.body.details).toMatchObject({ advanceId, advanceNumber: 'AV2611-000001' });
      const code = await failsWith(() =>
        inTransaction((s) => movementsService.recordOwnedByAdvance(s, advance({ advanceId }))),
      );
      expect(code).toBe('11000');
      expect(await balance()).toBe('900.00');
    });

    it('note liée de 80,00 → dépenses SANS compte : solde inchangé, charge +80', async () => {
      const chargeBefore = Number(await chargeUsd());
      const docs = await inTransaction((s) =>
        expensesService.recordOwnedByExpenseReport(
          s,
          report({
            reportNumber: 'NF2611-000002',
            accountId: null,
            settledByAdvanceId: advanceId,
            lines: [{ ...report().lines[0]!, amount: '80.00', workProjectId: null }],
          }),
        ),
      );
      expect(docs[0]).toMatchObject({
        accountId: null,
        origin: { kind: 'expense_report', settledByAdvanceId: advanceId },
      });
      expect(await balance()).toBe('900.00');
      expect(Number(await chargeUsd())).toBeCloseTo(chargeBefore + 80, 2);
    });

    it('une dépense soldée par une avance n’a pas de compte ; l’avance doit être versée', async () => {
      const withAccount = await failsWith(() =>
        inTransaction((s) =>
          expensesService.recordOwnedByExpenseReport(s, report({ settledByAdvanceId: advanceId })),
        ),
      );
      expect(withAccount).toBe('EXPENSE_SETTLED_BY_ADVANCE_WITH_ACCOUNT');
      const notDisbursed = await failsWith(() =>
        inTransaction((s) =>
          expensesService.recordOwnedByExpenseReport(
            s,
            report({ accountId: null, settledByAdvanceId: new ObjectId().toHexString() }),
          ),
        ),
      );
      expect(notDisbursed).toBe('ADVANCE_NOT_DISBURSED');
    });

    it('retour du reliquat de 20,00 en espèces → `other_in` possédé', async () => {
      const settlementId = new ObjectId().toHexString();
      const missing = await failsWith(() =>
        inTransaction((s) =>
          movementsService.recordOwnedByAdvance(s, advance({ advanceId, kind: 'other_in' })),
        ),
      );
      expect(missing).toBe('ADVANCE_MOVEMENT_INVALID');
      const m = await inTransaction((s) =>
        movementsService.recordOwnedByAdvance(
          s,
          advance({ advanceId, kind: 'other_in', settlementId, amount: '20.00', date: day(1) }),
        ),
      );
      expect(m).toMatchObject({
        kind: 'other_in',
        toAccountId: banque,
        amountIn: '20.00',
        label: 'Retour d’avance au personnel AV2611-000001',
        origin: { settlementId },
      });
      expect(await balance()).toBe('920.00');
    });

    it('complément : note de 130,00 sur une avance de 100,00 → 100 sans compte + 30 remboursés, charge 130 une fois', async () => {
      const av2 = new ObjectId().toHexString();
      const rep = new ObjectId().toHexString();
      await inTransaction((s) =>
        movementsService.recordOwnedByAdvance(
          s,
          advance({ advanceId: av2, advanceNumber: 'AV2611-000002' }),
        ),
      );
      expect(await balance()).toBe('820.00');
      const chargeBefore = Number(await chargeUsd());
      const line = { ...report().lines[0]!, workProjectId: null };
      await inTransaction(async (s) => {
        await expensesService.recordOwnedByExpenseReport(
          s,
          report({
            reportId: rep,
            reportNumber: 'NF2611-000003',
            accountId: null,
            settledByAdvanceId: av2,
            lines: [{ ...line, amount: '100.00' }],
          }),
        );
        await expensesService.recordOwnedByExpenseReport(
          s,
          report({
            reportId: rep,
            reportNumber: 'NF2611-000003',
            lines: [{ ...line, amount: '30.00' }],
          }),
        );
      });
      expect(await balance()).toBe('790.00');
      expect(Number(await chargeUsd())).toBeCloseTo(chargeBefore + 130, 2);

      // Annuler le seul complément laisse la part soldée par l'avance.
      const n = await inTransaction((s) =>
        expensesService.cancelOwnedByExpenseReport(
          s,
          orgId,
          rep,
          { settledByAdvanceId: null },
          'Complément annulé',
          actorA,
        ),
      );
      expect(n).toBe(1);
      expect(await balance()).toBe('820.00');
      expect(Number(await chargeUsd())).toBeCloseTo(chargeBefore + 100, 2);
    });

    it('l’annulation du versement par les RH rend le solde', async () => {
      const av3 = new ObjectId().toHexString();
      await inTransaction((s) =>
        movementsService.recordOwnedByAdvance(
          s,
          advance({ advanceId: av3, advanceNumber: 'AV2611-000003', amount: '5.00' }),
        ),
      );
      expect(await balance()).toBe('815.00');
      const n = await inTransaction((s) =>
        movementsService.cancelOwnedByAdvance(s, orgId, av3, {}, 'Versement annulé', actorA),
      );
      expect(n).toBe(1);
      expect(await balance()).toBe('820.00');
    });
  });

  // ─── 3. Prévision 1.2.0 ────────────────────────────────────────────────────

  describe('prévision 1.2.0', () => {
    it('dépenses soldées par une avance exclues de EXPENSES_WITHOUT_ACCOUNT ; remboursements RH non reliés', async () => {
      const findings = async () => {
        const res = await get(asA(), '/treasury/forecast?currency=USD');
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.version).toBe(TREASURY_VERSION);
        for (const s of res.body.scenarios as { horizons: { bySource: object }[] }[]) {
          expect(s.horizons[0]!.bySource).toMatchObject({ hr_payable: '0.00' });
        }
        return res.body.uncertainty.findings as { code: string; count: number }[];
      };
      const before = await findings();
      expect(before.map((f) => f.code)).not.toContain('EXPENSES_WITHOUT_ACCOUNT');
      // ADR-0051 — H10 : le fournisseur des RH est relié ; rien à rembourser ici.
      expect(before.map((f) => f.code)).not.toContain('HR_PAYABLES_NOT_INTEGRATED');

      const direct = await post(asA(), '/treasury/expenses', {
        spentOn: day(2),
        amount: '3.00',
        currency: 'USD',
        category: 'charges_diverses',
        label: 'Sans compte',
        supplierName: null,
        accountId: null,
        deductibleVat: null,
        reference: null,
      });
      expect(direct.status, JSON.stringify(direct.body)).toBe(201);
      const after = await findings();
      expect(after.find((f) => f.code === 'EXPENSES_WITHOUT_ACCOUNT')?.count).toBe(1);
    });
  });

  // ─── 4. Compatibilité achats ───────────────────────────────────────────────

  describe('compatibilité avec les dépenses des achats', () => {
    it('une dépense de remboursement ne devient pas un paiement fournisseur', async () => {
      const [doc] = await inTransaction((s) =>
        expensesService.recordOwnedByExpenseReport(
          s,
          report({ reportNumber: 'NF2611-000004', lines: [report().lines[1]!] }),
        ),
      );
      const res = await post(asA(), '/purchases/payments/from-expense', {
        expenseId: String(doc!._id),
        expectedRevision: 1,
        allocations: [{ invoiceId: new ObjectId().toHexString(), amount: '7.50' }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.code).toBe('EXPENSE_OWNED_BY_HR');
    });
  });

  // ─── 5. Isolation ──────────────────────────────────────────────────────────

  describe('isolation par organisation', () => {
    it('compte, projet et avance d’une autre organisation sont introuvables', async () => {
      const forB = (over: Partial<HrExpenseReportInput>) =>
        report({ organizationId: orgB, actor: actorB, accountId: banqueB, ...over });
      const codes = await Promise.all([
        failsWith(() =>
          inTransaction((s) =>
            expensesService.recordOwnedByExpenseReport(s, forB({ accountId: banque })),
          ),
        ),
        failsWith(() =>
          inTransaction((s) => expensesService.recordOwnedByExpenseReport(s, forB({}))),
        ),
        failsWith(() =>
          inTransaction((s) =>
            movementsService.recordOwnedByAdvance(
              s,
              advance({ organizationId: orgB, actor: actorB }),
            ),
          ),
        ),
      ]);
      expect(codes).toEqual([
        'TREASURY_ACCOUNT_NOT_FOUND',
        'EXPENSE_WORK_PROJECT_UNKNOWN',
        'TREASURY_ACCOUNT_NOT_FOUND',
      ]);

      // L'avance versée par A ne solde rien chez B.
      const advances = await db
        .collection('treasury_movements')
        .find({ organizationId: orgId, 'origin.kind': 'employee_advance' })
        .toArray();
      const foreign = String((advances[0]!['origin'] as { advanceId: string }).advanceId);
      const settled = await failsWith(() =>
        inTransaction((s) =>
          expensesService.recordOwnedByExpenseReport(
            s,
            forB({
              accountId: null,
              settledByAdvanceId: foreign,
              lines: [{ ...report().lines[1]! }],
            }),
          ),
        ),
      );
      expect(settled).toBe('ADVANCE_NOT_DISBURSED');
    });

    it('les pièces RH de A sont introuvables depuis B ; l’annulation RH de B ne touche rien chez A', async () => {
      const own = await db
        .collection('treasury_expenses')
        .findOne({ organizationId: orgId, 'origin.kind': 'expense_report', status: 'recorded' });
      const res = await get(asB(), `/treasury/expenses/${String(own!._id)}`);
      expect(res.status).toBe(404);
      const putRes = await put(asB(), `/treasury/expenses/${String(own!._id)}`, {
        expectedRevision: 1,
        expense: {
          spentOn: day(3),
          amount: '1.00',
          currency: 'USD',
          category: 'transport',
          label: 'Intrusion',
          supplierName: null,
          accountId: null,
          deductibleVat: null,
          reference: null,
        },
      });
      expect(putRes.status).toBe(404);
      const n = await inTransaction((s) =>
        expensesService.cancelOwnedByExpenseReport(
          s,
          orgB,
          (own!['origin'] as { reportId: string }).reportId,
          {},
          'Intrusion',
          actorB,
        ),
      );
      expect(n).toBe(0);
      const still = await get(asA(), `/treasury/expenses/${String(own!._id)}`);
      expect(still.body.status).toBe('recorded');
    });
  });
});
