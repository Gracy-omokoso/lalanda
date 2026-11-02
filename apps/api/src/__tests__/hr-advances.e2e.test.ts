// Avances au personnel contre la vraie application (ADR-0051 § 2.2, § 3.2, § 3.3, § 4,
// § 7.1, § 7.2 ; critères 7, 8, 9, 16, 17). ADR-0051 — H10.
//
// Couvre : aucun plafond par défaut, plafond SAISI qui refuse au-delà ; avance de frais :
// circuit, versement (`other_out` possédé, aucune dépense), justification par une note
// (dépenses SANS compte, solde inchangé), retour d'espèces (`other_in`), complément
// (`top_up`) : charge entière une seule fois ; avance sur salaire : éteinte par défaut,
// invisible du manager et de `hr.read` seul, étape finance par `expenses.approve` ET
// `hr.sensitive.read`, motif chiffré lu par audit strict, libellé neutre, déclaration
// sur la paie éteinte puis constatée sans mouvement ; rappel d'échéance une seule fois ;
// isolation.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HrAdvanceRemindersService } from '../hr/advances/hr-advance-reminders.service.js';
import { HrExpensesNotifier } from '../hr/expenses/hr-expenses-notifier.js';
import type { NotificationInput } from '../notifications/notifications.port.js';
import { e2eSuite } from './e2e-utils.js';
import { code, hrFixture, ok, type HrAccount, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';

vi.setConfig({ testTimeout: 120_000 });

function kinshasaToday(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}
function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
const today = kinshasaToday();
const day = (n: number) => addDays(today, -n);

e2eSuite('RH — avances au personnel (ADR-0051 H10)', () => {
  let fx: HrFixture;
  let db: Db;
  const notices: NotificationInput[] = [];
  /** A (Analyste) manager de B (Lecteur). */
  const emp = { A: '', B: '' };
  let caisse = '';

  const revOf = async (collection: string, id: string) =>
    (await db.collection(collection).findOne({ _id: new ObjectId(id) }))!['revision'] as number;
  const advRev = (id: string) => revOf('hr_advances', id);
  const balance = async () =>
    (
      ok(await fx.get('owner', '/treasury/accounts'))['items'] as { id: string; balance: string }[]
    ).find((a) => a.id === caisse)!.balance;
  const chargeUsd = async () => {
    const r = ok(await fx.get('owner', '/treasury/expenses/summary'));
    return Number((r['totalsByCurrency']?.['USD'] as string | undefined) ?? '0');
  };
  const settings = async () => ok(await fx.get('owner', '/hr/settings/expenses'));

  const approveAdv = async (c: HrAccount, id: string) =>
    fx.post(c, `/hr/advances/${id}/approve`, { expectedRevision: await advRev(id) });
  const approveNote = async (c: HrAccount, id: string) =>
    fx.post(c, `/hr/expense-reports/${id}/approve`, {
      expectedRevision: await revOf('hr_expense_reports', id),
    });

  /** Avance demandée et soumise par B. */
  async function avanceSoumise(body: Record<string, unknown>) {
    const a = ok(await fx.post('viewer', '/hr/advances', body), 201);
    return ok(
      await fx.post('viewer', `/hr/advances/${a['id']}/submit`, {
        expectedRevision: a['revision'],
      }),
    );
  }

  /** Avance de frais de B, validée (A puis la Directrice financière) et versée par le Comptable. */
  async function avanceVersee(amount: string, extra: Record<string, unknown> = {}) {
    const s = await avanceSoumise({
      kind: 'expenses',
      amount,
      currency: 'USD',
      purpose: 'Mission Matadi',
      ...extra,
    });
    ok(await approveAdv('analyst', s['id']));
    ok(await approveAdv('finance_director', s['id']));
    return ok(
      await fx.post('accountant', `/hr/advances/${s['id']}/disburse`, {
        expectedRevision: await advRev(s['id']),
        paidOn: day(10),
        accountId: caisse,
        method: 'cash',
      }),
    );
  }

  /** Note de B liée à une avance, soumise puis validée aux deux étapes. */
  async function noteLiee(advanceId: string, amounts: string[]) {
    const n = ok(
      await fx.post('viewer', '/hr/expense-reports', {
        title: 'Justification',
        currency: 'USD',
        advanceId,
        lines: amounts.map((amount, i) => ({
          spentOn: day(5),
          category: i === 0 ? 'transport' : 'charges_diverses',
          label: `Ligne ${i + 1}`,
          amount,
          missingReceiptReason: 'Ticket perdu',
        })),
      }),
      201,
    );
    ok(
      await fx.post('viewer', `/hr/expense-reports/${n['id']}/submit`, {
        expectedRevision: n['revision'],
      }),
    );
    ok(await approveNote('analyst', n['id']));
    return ok(await approveNote('finance_director', n['id']));
  }

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-avances');
    db = fx.db;
    fx.app.get(HrExpensesNotifier).port = {
      notify: async (n: NotificationInput) => {
        notices.push(n);
      },
    } as never;
    const res = ok(
      await fx.post('hr_manager', '/hr/employees/from-members', {
        userIds: [fx.userIds['analyst'], fx.userIds['viewer']],
      }),
      201,
    );
    const byUser = (u: string) =>
      res['items'].find((e: { userId: string }) => e.userId === u)['id'] as string;
    emp.A = byUser(fx.userIds['analyst']);
    emp.B = byUser(fx.userIds['viewer']);
    ok(
      await fx.put('hr_manager', `/hr/employees/${emp.B}`, {
        expectedRevision: await revOf('hr_employees', emp.B),
        managerEmployeeId: emp.A,
      }),
    );
    caisse = ok(
      await fx.post('owner', '/treasury/accounts', {
        name: 'Caisse USD',
        kind: 'cash',
        currency: 'USD',
        openingBalance: '1000.00',
        openingDate: '2026-01-01',
      }),
      201,
    )['id'];
  }, 300_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  describe('aucun plafond inventé', () => {
    it('sans plafond, tout montant ; avec 200,00 USD saisi, 250,00 refusé (422)', async () => {
      const big = ok(
        await fx.post('viewer', '/hr/advances', {
          kind: 'expenses',
          amount: '99999.00',
          currency: 'USD',
        }),
        201,
      );
      expect(big).toMatchObject({ status: 'draft', kind: 'expenses', outstanding: '0.00' });
      const s = await settings();
      expect(s['advances']['maxAmount']).toEqual({ CDF: null, USD: null });
      code(
        await fx.put('hr_manager', '/hr/settings/advances', {
          expectedRevision: s['revision'],
          maxAmount: { CDF: null, USD: '200.00' },
        }),
        403,
        'FORBIDDEN',
      );
      const set = ok(
        await fx.put('owner', '/hr/settings/advances', {
          expectedRevision: s['revision'],
          maxAmount: { CDF: null, USD: '200.00' },
        }),
      );
      code(
        await fx.post('viewer', '/hr/advances', {
          kind: 'expenses',
          amount: '250.00',
          currency: 'USD',
        }),
        422,
        'ADVANCE_ABOVE_ORGANIZATION_LIMIT',
      );
      ok(
        await fx.post('viewer', '/hr/advances', {
          kind: 'expenses',
          amount: '200.00',
          currency: 'USD',
        }),
        201,
      );
      ok(
        await fx.put('owner', '/hr/settings/advances', {
          expectedRevision: set['revision'],
          maxAmount: { CDF: null, USD: null },
        }),
      );
    });
  });

  describe('avance de frais', () => {
    let avance = '';

    it('versement de 100,00 : un `other_out` possédé, solde −100, aucune dépense', async () => {
      const before = await balance();
      const chargeBefore = await chargeUsd();
      const v = await avanceVersee('100.00');
      avance = v['id'];
      expect(v['number']).toMatch(/^AV\d{4}-\d{6}$/);
      expect(v).toMatchObject({ status: 'disbursed', disbursed: '100.00', outstanding: '100.00' });
      expect(Number(await balance())).toBeCloseTo(Number(before) - 100, 2);
      expect(await chargeUsd()).toBeCloseTo(chargeBefore, 2);
      const mv = await db
        .collection('treasury_movements')
        .findOne({ organizationId: fx.orgN, 'origin.advanceId': avance });
      expect(mv).toMatchObject({ kind: 'other_out', status: 'recorded' });
      expect(String(mv!['label'])).toBe(`Avance au personnel ${v['number']}`);
      code(
        await fx.post('owner', `/treasury/movements/${String(mv!._id)}/cancel`, { reason: 'x' }),
        409,
        'MOVEMENT_OWNED_BY_HR',
      );
    });

    it('note liée de 80,00 : dépenses SANS compte (solde inchangé, charge +80), reste dû 20,00', async () => {
      const before = await balance();
      const chargeBefore = await chargeUsd();
      const n = await noteLiee(avance, ['50.00', '30.00']);
      expect(n).toMatchObject({
        status: 'settled_by_advance',
        settlement: { fromAdvance: '80.00', topUp: '0.00' },
      });
      expect(await balance()).toBe(before);
      expect(await chargeUsd()).toBeCloseTo(chargeBefore + 80, 2);
      const exp = await db
        .collection('treasury_expenses')
        .find({ 'origin.reportId': n['id'], status: 'recorded' })
        .toArray();
      expect(exp).toHaveLength(2);
      for (const e of exp) {
        expect(e['accountId']).toBeNull();
        expect(e['origin']['settledByAdvanceId']).toBe(avance);
      }
      const a = ok(await fx.get('viewer', `/hr/advances/${avance}`));
      expect(a).toMatchObject({
        status: 'partially_settled',
        outstanding: '20.00',
        settled: '80.00',
      });
    });

    it('retour en espèces : par un payeur (≠ bénéficiaire), au-delà du reste : 409 ; 20,00 : `other_in`, soldée', async () => {
      const body = async (amount: string) => ({
        expectedRevision: await advRev(avance),
        kind: 'cash_return',
        amount,
        on: day(1),
        accountId: caisse,
      });
      code(
        await fx.post('viewer', `/hr/advances/${avance}/settlements`, await body('20.00')),
        403,
        'FORBIDDEN',
      );
      code(
        await fx.post('accountant', `/hr/advances/${avance}/settlements`, await body('25.00')),
        409,
        'ADVANCE_SETTLEMENT_EXCEEDS_OUTSTANDING',
      );
      const before = await balance();
      const a = ok(
        await fx.post('accountant', `/hr/advances/${avance}/settlements`, await body('20.00')),
        201,
      );
      expect(a).toMatchObject({ status: 'settled', outstanding: '0.00' });
      expect(Number(await balance())).toBeCloseTo(Number(before) + 20, 2);
      expect(
        await db
          .collection('treasury_movements')
          .countDocuments({ 'origin.advanceId': avance, kind: 'other_in', status: 'recorded' }),
      ).toBe(1);
    });

    it('note de 130,00 sur une avance de 100,00 : 100,00 sans compte + 30,00 remboursés ; charge 130 une fois', async () => {
      const v = await avanceVersee('100.00');
      const chargeBefore = await chargeUsd();
      const balanceBefore = await balance();
      const n = await noteLiee(v['id'], ['100.00', '30.00']);
      expect(n).toMatchObject({ status: 'partially_settled', toReimburse: '30.00' });
      expect(n['settlement']).toEqual({ fromAdvance: '100.00', topUp: '30.00' });
      const r = ok(
        await fx.post('accountant', `/hr/expense-reports/${n['id']}/reimburse`, {
          expectedRevision: await revOf('hr_expense_reports', n['id']),
          paidOn: today,
          accountId: caisse,
          method: 'cash',
        }),
      );
      expect(r['status']).toBe('reimbursed');
      expect(await chargeUsd()).toBeCloseTo(chargeBefore + 130, 2);
      expect(Number(await balance())).toBeCloseTo(Number(balanceBefore) - 30, 2);
      const a = ok(await fx.get('finance_director', `/hr/advances/${v['id']}`));
      expect(a['settlements'].map((s: { kind: string }) => s.kind)).toEqual([
        'expense_report',
        'top_up',
      ]);
      expect(a).toMatchObject({ status: 'settled', outstanding: '0.00' });
    });

    it('une avance versée ne s’annule plus ; un versement annulé rend le solde', async () => {
      const v = await avanceVersee('5.00');
      code(
        await fx.post('owner', `/hr/advances/${v['id']}/cancel`, { reason: 'x' }),
        409,
        'ADVANCE_NOT_CANCELLABLE',
      );
      const before = await balance();
      const c = ok(
        await fx.post('accountant', `/hr/advances/${v['id']}/disbursement/cancel`, {
          expectedRevision: await advRev(v['id']),
          reason: 'Erreur de caisse',
        }),
      );
      expect(c).toMatchObject({ status: 'approved', disbursement: null });
      expect(Number(await balance())).toBeCloseTo(Number(before) + 5, 2);
    });

    it('abandon : `expenses.approve` avec motif, jamais le bénéficiaire ; statut « abandonnée »', async () => {
      const v = await avanceVersee('10.00');
      const body = async () => ({
        expectedRevision: await advRev(v['id']),
        kind: 'write_off',
        amount: '10.00',
        on: today,
        note: 'Créance abandonnée',
      });
      code(
        await fx.post('accountant', `/hr/advances/${v['id']}/settlements`, await body()),
        403,
        'FORBIDDEN',
      );
      const w = ok(
        await fx.post('finance_director', `/hr/advances/${v['id']}/settlements`, await body()),
        201,
      );
      expect(w).toMatchObject({ status: 'written_off', outstanding: '0.00' });
    });

    it('rappel : avance versée non régularisée après l’échéance annoncée, une seule notification', async () => {
      const v = await avanceVersee('15.00', { expectedSettlement: day(3) });
      const reminders = fx.app.get(HrAdvanceRemindersService);
      const first = await reminders.run(fx.orgN, today, new Date());
      expect(first.claimed).toBe(1);
      const sent = notices.filter(
        (n) => n.kind === 'hr.advance_overdue' && n.source.entityId === v['id'],
      );
      expect(sent.map((n) => n.recipientUserId)).toContain(fx.userIds['viewer']);
      for (const n of sent) expect(n.title).not.toMatch(/15/);
      expect((await reminders.run(fx.orgN, today, new Date())).claimed).toBe(0);
      const view = ok(await fx.get('viewer', `/hr/advances/${v['id']}`));
      expect(view['findings'].map((f: { code: string }) => f.code)).toContain('ADVANCE_OVERDUE');
    });
  });

  describe('avance sur salaire', () => {
    let avance = '';

    it('éteinte par défaut : 409 ADVANCE_KIND_DISABLED', async () => {
      code(
        await fx.post('viewer', '/hr/advances', {
          kind: 'salary',
          amount: '50.00',
          currency: 'USD',
        }),
        409,
        'ADVANCE_KIND_DISABLED',
      );
    });

    it('activée : motif chiffré, étape finance seule ; invisible du manager et de `hr.read` seul', async () => {
      const s = await settings();
      ok(
        await fx.put('owner', '/hr/settings/advances', {
          expectedRevision: s['revision'],
          enabled: { expenses: true, salary: true },
        }),
      );
      const a = await avanceSoumise({
        kind: 'salary',
        amount: '50.00',
        currency: 'USD',
        reason: 'Frais médicaux de mon enfant',
      });
      avance = a['id'];
      expect(a).toMatchObject({
        steps: ['finance'],
        kind: 'salary',
        reason: null,
        hasReason: true,
      });
      const stored = await db.collection('hr_advances').findOne({ _id: new ObjectId(avance) });
      expect(stored!['reason']).toBeNull();
      expect(JSON.stringify(stored)).not.toContain('médicaux');
      code(await fx.get('analyst', `/hr/advances/${avance}`), 404, 'ADVANCE_NOT_FOUND');
      code(await fx.get('hr_manager', `/hr/advances/${avance}`), 404, 'ADVANCE_NOT_FOUND');
      expect(
        ok(await fx.get('analyst', '/hr/advances'))['items'].some(
          (x: { id: string }) => x.id === avance,
        ),
      ).toBe(false);
      const submitted = notices.filter(
        (n) => n.kind === 'hr.advance_submitted' && n.source.entityId === avance,
      );
      expect(submitted.map((n) => n.recipientUserId)).not.toContain(fx.userIds['analyst']);
      for (const n of submitted) {
        expect(n.title).not.toMatch(/salaire/i);
        expect(n.title).not.toMatch(/50/);
      }
    });

    it('le manager n’y a aucune place ; la Directrice financière valide ; le payeur ne voit ni nature ni motif', async () => {
      code(await approveAdv('analyst', avance), 404, 'ADVANCE_NOT_FOUND');
      // Le bénéficiaire ne détient pas l'autorité : refusé avant même la séparation des tâches.
      code(await approveAdv('viewer', avance), 403, 'ADVANCE_SALARY_NOT_YOUR_STEP');
      const ok1 = ok(await approveAdv('finance_director', avance));
      expect(ok1['status']).toBe('approved');
      const payeur = ok(await fx.get('accountant', `/hr/advances/${avance}`));
      expect(payeur).toMatchObject({ kind: null, label: 'Avance', reason: null, amount: '50.00' });
      const toPay = ok(await fx.get('accountant', '/hr/expenses/to-pay'));
      const item = toPay['items'].find((x: { id: string }) => x.id === avance);
      expect(item['label']).toMatch(/^Avance AV\d{4}-\d{6}$/);
      const payers = notices.filter(
        (n) =>
          n.kind === 'hr.advance_decided' &&
          n.source.entityId === avance &&
          n.recipientUserId === fx.userIds['accountant'],
      );
      for (const n of payers) expect(n.title).not.toContain('Membre');
    });

    it('motif : bénéficiaire et validateur habilité, audit strict ; le payeur : 404', async () => {
      const lu = ok(await fx.post('finance_director', `/hr/advances/${avance}/reveal-reason`));
      expect(lu['reason']).toBe('Frais médicaux de mon enfant');
      expect(ok(await fx.post('viewer', `/hr/advances/${avance}/reveal-reason`))['reason']).toBe(
        'Frais médicaux de mon enfant',
      );
      code(
        await fx.post('accountant', `/hr/advances/${avance}/reveal-reason`),
        404,
        'ADVANCE_NOT_FOUND',
      );
      const audits = await db
        .collection('audit_events')
        .find({ targetId: avance, action: 'hr.advance.reason_revealed' })
        .toArray();
      expect(audits).toHaveLength(2);
      expect(JSON.stringify(audits)).not.toContain('médicaux');
    });

    it('versement sans nom ; déclaration sur la paie : éteinte (409), puis constat sans mouvement', async () => {
      const v = ok(
        await fx.post('accountant', `/hr/advances/${avance}/disburse`, {
          expectedRevision: await advRev(avance),
          paidOn: day(2),
          accountId: caisse,
          method: 'cash',
        }),
      );
      const mv = await db.collection('treasury_movements').findOne({ 'origin.advanceId': avance });
      expect(String(mv!['label'])).toBe(`Avance au personnel ${v['number']}`);
      const declare = async () => ({
        expectedRevision: await advRev(avance),
        kind: 'declared_payroll',
        amount: '50.00',
        on: today,
        reference: today.slice(0, 7),
      });
      code(
        await fx.post('finance_director', `/hr/advances/${avance}/settlements`, await declare()),
        409,
        'ADVANCE_DECLARED_PAYROLL_DISABLED',
      );
      const s = await settings();
      ok(
        await fx.put('owner', '/hr/settings/advances', {
          expectedRevision: s['revision'],
          allowDeclaredPayrollSettlement: true,
        }),
      );
      code(
        await fx.post('accountant', `/hr/advances/${avance}/settlements`, await declare()),
        403,
        'FORBIDDEN',
      );
      const movementsBefore = await db
        .collection('treasury_movements')
        .countDocuments({ organizationId: fx.orgN });
      const d = ok(
        await fx.post('finance_director', `/hr/advances/${avance}/settlements`, await declare()),
        201,
      );
      expect(d).toMatchObject({ status: 'settled', outstanding: '0.00' });
      expect(d['findings']).toContainEqual(
        expect.objectContaining({
          code: 'ADVANCE_SETTLED_ON_PAYROLL',
          payrollMonth: today.slice(0, 7),
        }),
      );
      expect(
        await db.collection('treasury_movements').countDocuments({ organizationId: fx.orgN }),
      ).toBe(movementsBefore);
    });
  });

  describe('isolation', () => {
    it('avance, versement et régularisation d’une autre organisation : 404', async () => {
      const mine = ok(await fx.get('viewer', '/hr/advances'));
      const id = mine['items'][0]['id'];
      code(await fx.get('ownerB', `/hr/advances/${id}`), 404, 'ADVANCE_NOT_FOUND');
      code(await approveAdv('ownerB', id), 404, 'ADVANCE_NOT_FOUND');
      code(
        await fx.post('ownerB', `/hr/advances/${id}/disburse`, {
          expectedRevision: 1,
          paidOn: today,
          accountId: caisse,
          method: 'cash',
        }),
        404,
        'ADVANCE_NOT_FOUND',
      );
      expect(ok(await fx.get('ownerB', '/hr/advances'))['items']).toEqual([]);
      // Une note de B ne peut pas justifier une avance inconnue (forgée).
      code(
        await fx.post('viewer', '/hr/expense-reports', {
          title: 'Forgée',
          currency: 'USD',
          advanceId: new ObjectId().toHexString(),
          lines: [
            {
              spentOn: day(1),
              category: 'transport',
              label: 'T',
              amount: '1.00',
              missingReceiptReason: 'x',
            },
          ],
        }),
        409,
        'ADVANCE_NOT_LINKABLE',
      );
    });
  });
});
