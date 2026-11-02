// Notes de frais contre la vraie application (ADR-0051 § 2.1, § 3.1, § 4, § 6.1, § 7.1 ;
// critères 1, 3, 4, 5, 16, 17). ADR-0051 — H10.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard → contrôleurs →
// MongoDB (transactions) → trésorerie. Couvre : brouillon, justificatif chiffré, contrôles
// du moteur (catégorie refusée, date future, motif sans justificatif), circuit à deux
// étapes, séparation des tâches (bénéficiaire, auteur d'une saisie pour autrui, deux étapes
// deux personnes, approbateur qui ne paie pas), approbateur unique marqué, remboursement
// en dépenses possédées par les RH et son annulation, `hr.read` sans justificatif,
// résumé, « à payer », prévision de trésorerie, réglages, isolation.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { HrExpenseReportsService } from '../hr/expenses/hr-expense-reports.service.js';
import { HrExpensesNotifier } from '../hr/expenses/hr-expenses-notifier.js';
import { Integration, type IntegrationDocument } from '../integrations/integration.schema.js';
import {
  OrganizationSecret,
  type OrganizationSecretDocument,
} from '../integrations/organization-secret.schema.js';
import { PlatformAuditService } from '../integrations/platform-audit.service.js';
import { RewrapService } from '../integrations/rewrap.js';
import { MasterKeyring } from '../integrations/secrets-crypto.js';
import { SecretsService } from '../integrations/secrets.service.js';
import type { NotificationInput } from '../notifications/notifications.port.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrAccount, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');
const CLE_K1 = randomBytes(32);
process.env['SECRETS_MASTER_KEY'] = CLE_K1.toString('base64');
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

const PDF = Buffer.from('%PDF-1.4\n% justificatif de taxi\n1 0 obj << >> endobj\n%%EOF\n');

e2eSuite('RH — notes de frais (ADR-0051 H10)', () => {
  let fx: HrFixture;
  let db: Db;
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const notices: NotificationInput[] = [];
  /** A (Analyste) manager de B (Lecteur) ; F (Directrice financière) manager de C (Commercial). */
  const emp = { A: '', B: '', C: '', F: '', D: '', OB: '' };
  let banque = '';
  let banqueB = '';
  let projetP = '';
  let projetB = '';

  const del = (c: HrAccount, path: string) =>
    request(fx.app.getHttpServer()).delete(path).set('Cookie', fx.as(c));
  const empRev = async (id: string) =>
    (await db.collection('hr_employees').findOne({ _id: new ObjectId(id) }))!['revision'] as number;
  const balance = async (c: HrAccount = 'owner', id = banque) =>
    (ok(await fx.get(c, '/treasury/accounts'))['items'] as { id: string; balance: string }[]).find(
      (a) => a.id === id,
    )!.balance;

  const lignes = () => [
    {
      spentOn: day(3),
      category: 'transport',
      label: 'Taxi client',
      amount: '15.00',
      merchant: 'Taxi Gombe',
      workProjectId: projetP,
      rebillable: true,
    },
    {
      spentOn: day(3),
      category: 'charges_diverses',
      label: 'Photocopies',
      amount: '7.50',
      missingReceiptReason: 'Ticket perdu',
    },
  ];

  const uploadReceipt = (c: HrAccount, reportId: string, lineId: string, body = PDF) =>
    request(fx.app.getHttpServer())
      .post(`/hr/expense-reports/${reportId}/lines/${lineId}/receipt`)
      .set('Cookie', fx.as(c))
      .attach('file', body, { filename: 'ticket.pdf', contentType: 'application/octet-stream' });

  /** Révision courante, lue en base (le geste testé décide, pas la lecture). */
  const revOf = async (id: string) =>
    (await db.collection('hr_expense_reports').findOne({ _id: new ObjectId(id) }))![
      'revision'
    ] as number;
  const approveAs = async (c: HrAccount, id: string) =>
    fx.post(c, `/hr/expense-reports/${id}/approve`, { expectedRevision: await revOf(id) });

  /** Brouillon puis soumission, par `c` ; rend la note soumise. */
  async function soumise(c: HrAccount, body: Record<string, unknown>) {
    const n = ok(await fx.post(c, '/hr/expense-reports', body), 201);
    return ok(
      await fx.post(c, `/hr/expense-reports/${n['id']}/submit`, {
        expectedRevision: n['revision'],
      }),
    );
  }

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-frais');
    db = fx.db;
    const storage = fx.app.get(ObjectStorageService);
    storage.uploadsBucket = () => 'rh-test';
    storage.putObject = async (bucket, key, body, contentType) => {
      objects.set(`${bucket}/${key}`, { body: Buffer.from(body), contentType });
    };
    storage.getObject = async (bucket, key) => {
      const o = objects.get(`${bucket}/${key}`);
      return o ? { body: o.body, contentType: o.contentType } : null;
    };
    storage.deleteObject = async (bucket, key) => {
      objects.delete(`${bucket}/${key}`);
    };
    const notifier = fx.app.get(HrExpensesNotifier);
    notifier.port = {
      notify: async (n: NotificationInput) => {
        notices.push(n);
      },
    } as never;

    const res = ok(
      await fx.post('hr_manager', '/hr/employees/from-members', {
        userIds: [
          fx.userIds['analyst'],
          fx.userIds['viewer'],
          fx.userIds['sales_rep'],
          fx.userIds['finance_director'],
        ],
      }),
      201,
    );
    const byUser = (u: string) =>
      res['items'].find((e: { userId: string }) => e.userId === u)['id'] as string;
    emp.A = byUser(fx.userIds['analyst']);
    emp.B = byUser(fx.userIds['viewer']);
    emp.C = byUser(fx.userIds['sales_rep']);
    emp.F = byUser(fx.userIds['finance_director']);
    ok(
      await fx.put('hr_manager', `/hr/employees/${emp.B}`, {
        expectedRevision: await empRev(emp.B),
        managerEmployeeId: emp.A,
      }),
    );
    ok(
      await fx.put('hr_manager', `/hr/employees/${emp.C}`, {
        expectedRevision: await empRev(emp.C),
        managerEmployeeId: emp.F,
      }),
    );
    emp.D = ok(await fx.post('hr_manager', '/hr/employees', fiche(`Chauffeur ${tag}`)), 201)['id'];

    const compte = ok(
      await fx.post('owner', '/treasury/accounts', {
        name: 'Caisse USD',
        kind: 'cash',
        currency: 'USD',
        openingBalance: '1000.00',
        openingDate: '2026-01-01',
      }),
      201,
    );
    banque = compte['id'];
    projetP = String(
      (
        await db
          .collection('work_projects')
          .insertOne({ organizationId: fx.orgN, name: 'Projet P', status: 'active' })
      ).insertedId,
    );
    projetB = String(
      (
        await db
          .collection('work_projects')
          .insertOne({ organizationId: fx.orgB, name: 'Projet B', status: 'active' })
      ).insertedId,
    );
    // Organisation B : la Propriétaire est seule (approbatrice et payeuse uniques).
    emp.OB = ok(
      await fx.post(
        'ownerB',
        '/hr/employees',
        fiche(`Proprio B ${tag}`, { userId: fx.userIds['ownerB'] }),
      ),
      201,
    )['id'];
    banqueB = ok(
      await fx.post('ownerB', '/treasury/accounts', {
        name: 'Caisse B',
        kind: 'cash',
        currency: 'USD',
        openingBalance: '100.00',
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

  describe('brouillon et contrôles', () => {
    it('Conseiller : 403 ; sans fiche reliée : 409 EMPLOYEE_NOT_LINKED', async () => {
      const body = { title: 'X', currency: 'USD', lines: lignes() };
      code(await fx.post('advisor', '/hr/expense-reports', body), 403, 'FORBIDDEN');
      code(await fx.post('accountant', '/hr/expense-reports', body), 409, 'EMPLOYEE_NOT_LINKED');
    });

    it('catégorie d’immobilisation : 422 ; date future : 422 ; projet d’une autre organisation : 422', async () => {
      const base = { title: 'Mission', currency: 'USD' };
      code(
        await fx.post('viewer', '/hr/expense-reports', {
          ...base,
          lines: [{ ...lignes()[1], category: 'investissement' }],
        }),
        422,
        'EXPENSE_LINE_CATEGORY_NOT_ALLOWED',
      );
      code(
        await fx.post('viewer', '/hr/expense-reports', {
          ...base,
          lines: [{ ...lignes()[1], spentOn: addDays(today, 2) }],
        }),
        422,
        'EXPENSE_IN_FUTURE',
      );
      code(
        await fx.post('viewer', '/hr/expense-reports', {
          ...base,
          lines: [{ ...lignes()[0], workProjectId: projetB }],
        }),
        422,
        'EXPENSE_WORK_PROJECT_UNKNOWN',
      );
    });

    it('saisie pour autrui : un collaborateur SANS compte, par `hr.manage` seulement', async () => {
      const body = (employeeId: string) => ({
        employeeId,
        title: 'Plein',
        currency: 'USD',
        lines: [lignes()[1]],
      });
      code(
        await fx.post('hr_manager', '/hr/expense-reports', body(emp.B)),
        409,
        'EMPLOYEE_HAS_ACCOUNT',
      );
      code(await fx.post('viewer', '/hr/expense-reports', body(emp.D)), 404, 'EMPLOYEE_NOT_FOUND');
      const n = ok(await fx.post('hr_manager', '/hr/expense-reports', body(emp.D)), 201);
      expect(n).toMatchObject({ employeeId: emp.D, status: 'draft', number: null, total: '7.50' });
    });
  });

  describe('circuit, justificatif, remboursement', () => {
    let note = '';

    it('brouillon de deux lignes : total du moteur ; justificatif chiffré au stockage', async () => {
      const n = ok(
        await fx.post('viewer', '/hr/expense-reports', {
          title: 'Mission Matadi',
          currency: 'USD',
          lines: lignes(),
        }),
        201,
      );
      note = n['id'];
      expect(n).toMatchObject({ total: '22.50', status: 'draft', currentStep: null });
      expect(n['byCategory']).toEqual([
        { category: 'transport', total: '15.00', lines: 1 },
        { category: 'charges_diverses', total: '7.50', lines: 1 },
      ]);
      // Sans motif ni justificatif, la soumission est refusée (aucun seuil de montant).
      const l0 = n['lines'][0]['id'];
      code(
        await fx.post('viewer', `/hr/expense-reports/${note}/submit`, {
          expectedRevision: n['revision'],
        }),
        422,
        'EXPENSE_RECEIPT_REASON_REQUIRED',
      );
      code(
        await uploadReceipt('viewer', note, l0, Buffer.from('MZ pas un ticket')),
        415,
        'EXPENSE_RECEIPT_TYPE',
      );
      const avec = ok(await uploadReceipt('viewer', note, l0), 201);
      expect(avec['lines'][0]).toMatchObject({ hasReceipt: true });
      expect(avec['lines'][0]['receipt']).toMatchObject({ contentType: 'application/pdf' });
      const stored = await db.collection('hr_expense_reports').findOne({ _id: new ObjectId(note) });
      const r = stored!['lines'][0]['receipt'];
      expect(r['encrypted']).toBe(true);
      const obj = objects.get(`rh-test/hr-expense-receipts/${r['objectId']}`)!;
      expect(obj.body.includes(Buffer.from('%PDF-'))).toBe(false);
      // Modifier le brouillon garde le justificatif de la ligne conservée.
      const mod = ok(
        await fx.put('viewer', `/hr/expense-reports/${note}`, {
          expectedRevision: avec['revision'],
          title: 'Mission Matadi, 3–5 nov.',
          lines: [{ ...lignes()[0], id: l0 }, lignes()[1]],
        }),
      );
      expect(mod['lines'][0]['hasReceipt']).toBe(true);
    });

    it('soumission : numéro NF…, étapes manager puis finance ; notification au manager, sans montant', async () => {
      const cur = ok(await fx.get('viewer', `/hr/expense-reports/${note}`));
      const s = ok(
        await fx.post('viewer', `/hr/expense-reports/${note}/submit`, {
          expectedRevision: cur['revision'],
        }),
      );
      expect(s['number']).toMatch(/^NF\d{4}-\d{6}$/);
      expect(s).toMatchObject({
        status: 'submitted',
        steps: ['manager', 'finance'],
        currentStep: 'manager',
      });
      const n = notices.find(
        (x) => x.kind === 'hr.expense_submitted' && x.source.entityId === note,
      );
      expect(n?.recipientUserId).toBe(fx.userIds['analyst']);
      expect(n!.title).not.toMatch(/\d+[.,]\d{2}/);
    });

    it('le bénéficiaire ne valide pas ; ni le Responsable RH ni le Comptable ne tiennent l’étape', async () => {
      code(await approveAs('viewer', note), 409, 'SELF_APPROVAL_FORBIDDEN');
      code(await approveAs('hr_manager', note), 403, 'EXPENSE_NOT_YOUR_STEP');
      code(await approveAs('accountant', note), 403, 'EXPENSE_NOT_YOUR_STEP');
      // `hr.read` : la note en liste, sans justificatif.
      const rh = ok(await fx.get('hr_manager', `/hr/expense-reports/${note}`));
      expect(rh['lines'][0]).toMatchObject({ hasReceipt: true, receipt: null });
      const l0 = rh['lines'][0]['id'];
      code(
        await fx.get('hr_manager', `/hr/expense-reports/${note}/lines/${l0}/receipt`),
        404,
        'EXPENSE_RECEIPT_NOT_FOUND',
      );
      // Un collègue sans lien : 404.
      code(
        await fx.get('sales_rep', `/hr/expense-reports/${note}`),
        404,
        'EXPENSE_REPORT_NOT_FOUND',
      );
    });

    it('A (manager) valide ; la Directrice financière valide la finance ; le manager lit le justificatif', async () => {
      const m = ok(await approveAs('analyst', note));
      expect(m).toMatchObject({ status: 'submitted', currentStep: 'finance' });
      const l0 = m['lines'][0]['id'];
      const file = await fx
        .get('analyst', `/hr/expense-reports/${note}/lines/${l0}/receipt`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (d: Buffer) => chunks.push(d));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(file.status).toBe(200);
      expect(file.headers['content-disposition']).toMatch(/^attachment/);
      expect((file.body as Buffer).equals(PDF)).toBe(true);
      const f = ok(await approveAs('finance_director', note));
      expect(f).toMatchObject({ status: 'approved', toReimburse: '22.50' });
      expect(f['approvals'].map((a: { step: string }) => a.step)).toEqual(['manager', 'finance']);
    });

    it('« à payer » et prévision : la note approuvée attend le payeur (J+1)', async () => {
      const toPay = ok(await fx.get('accountant', '/hr/expenses/to-pay'));
      expect(toPay['items']).toContainEqual(
        expect.objectContaining({ id: note, kind: 'expense_report', amount: '22.50' }),
      );
      code(await fx.get('hr_manager', '/hr/expenses/to-pay'), 403, 'FORBIDDEN');
      const fc = ok(await fx.get('owner', '/treasury/forecast?currency=USD'));
      const codes = (fc['uncertainty']['findings'] as { code: string }[]).map((x) => x.code);
      expect(codes).not.toContain('HR_PAYABLES_NOT_INTEGRATED');
    });

    it('celui qui valide ne rembourse pas ; le Comptable rembourse : deux dépenses possédées, solde −22,50', async () => {
      const cur = ok(await fx.get('accountant', `/hr/expense-reports/${note}`));
      const body = {
        expectedRevision: cur['revision'],
        paidOn: today,
        accountId: banque,
        method: 'cash',
      };
      code(
        await fx.post('viewer', `/hr/expense-reports/${note}/reimburse`, body),
        403,
        'FORBIDDEN',
      );
      code(
        await fx.post('finance_director', `/hr/expense-reports/${note}/reimburse`, body),
        409,
        'APPROVER_CANNOT_PAY',
      );
      const before = await balance();
      const r = ok(await fx.post('accountant', `/hr/expense-reports/${note}/reimburse`, body));
      expect(r).toMatchObject({ status: 'reimbursed' });
      expect(r['reimbursement']['expenseIds']).toHaveLength(2);
      expect(Number(await balance())).toBeCloseTo(Number(before) - 22.5, 2);
      const exp = await db
        .collection('treasury_expenses')
        .find({ organizationId: fx.orgN, 'origin.reportId': note, status: 'recorded' })
        .toArray();
      expect(exp.map((e) => e['amount']).sort()).toEqual(['15.00', '7.50']);
      for (const e of exp) {
        expect(e['origin']['kind']).toBe('expense_report');
        expect(String(e['label'])).toMatch(/^Frais NF\d{4}-\d{6} — /);
        expect(String(e['label'])).not.toContain('Membre');
      }
      expect(exp.find((e) => e['amount'] === '15.00')!['workProjectId']).toBe(projetP);
      const put = await fx.put('owner', `/treasury/expenses/${String(exp[0]!._id)}`, {
        expectedRevision: exp[0]!['revision'],
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
      code(put, 409, 'EXPENSE_OWNED_BY_HR');
      const notice = notices.find(
        (x) => x.kind === 'hr.expense_reimbursed' && x.source.entityId === note,
      );
      expect(notice?.recipientUserId).toBe(fx.userIds['viewer']);
    });

    it('annuler le remboursement annule les deux dépenses ; la note revient à « approuvée »', async () => {
      const before = await balance();
      const cur = ok(await fx.get('accountant', `/hr/expense-reports/${note}`));
      const c = ok(
        await fx.post('accountant', `/hr/expense-reports/${note}/reimbursement/cancel`, {
          expectedRevision: cur['revision'],
          reason: 'Mauvais compte',
        }),
      );
      expect(c).toMatchObject({ status: 'approved', reimbursement: null });
      expect(Number(await balance())).toBeCloseTo(Number(before) + 22.5, 2);
      expect(
        await db
          .collection('treasury_expenses')
          .countDocuments({ 'origin.reportId': note, status: 'recorded' }),
      ).toBe(0);
      ok(
        await fx.post('accountant', `/hr/expense-reports/${note}/reimburse`, {
          expectedRevision: c['revision'],
          paidOn: today,
          accountId: banque,
          method: 'mobile_money',
        }),
      );
    });

    it('révision attendue périmée : 409 STALE_REVISION', async () => {
      const n = ok(
        await fx.post('viewer', '/hr/expense-reports', {
          title: 'T',
          currency: 'USD',
          lines: [lignes()[1]],
        }),
        201,
      );
      code(
        await fx.put('viewer', `/hr/expense-reports/${n['id']}`, {
          expectedRevision: 9,
          title: 'U',
        }),
        409,
        'STALE_REVISION',
      );
      expect((await del('viewer', `/hr/expense-reports/${n['id']}`)).status).toBe(204);
    });
  });

  describe('deux étapes, deux personnes ; saisie pour autrui', () => {
    it('F (manager et validatrice) tient l’étape manager, puis 409 APPROVER_ALREADY_APPROVED', async () => {
      const s = await soumise('sales_rep', {
        title: 'Client',
        currency: 'USD',
        lines: [lignes()[1]],
      });
      ok(await approveAs('finance_director', s['id']));
      code(await approveAs('finance_director', s['id']), 409, 'APPROVER_ALREADY_APPROVED');
      const o = ok(await approveAs('owner', s['id']));
      expect(o['status']).toBe('approved');
    });

    it('la Propriétaire saisit pour le chauffeur, puis ne la valide pas : 409 CREATOR_APPROVAL_FORBIDDEN', async () => {
      const s = await soumise('owner', {
        employeeId: emp.D,
        title: 'Plein',
        currency: 'USD',
        lines: [lignes()[1]],
      });
      expect(s['steps']).toEqual(['finance']);
      code(await approveAs('owner', s['id']), 409, 'CREATOR_APPROVAL_FORBIDDEN');
      ok(await approveAs('finance_director', s['id']));
    });

    it('refus commenté, puis duplication en brouillon sans justificatif', async () => {
      const s = await soumise('viewer', {
        title: 'À refuser',
        currency: 'USD',
        lines: [lignes()[1]],
      });
      code(
        await fx.post('analyst', `/hr/expense-reports/${s['id']}/reject`, {}),
        400,
        'INVALID_REQUEST',
      );
      const r = ok(
        await fx.post('analyst', `/hr/expense-reports/${s['id']}/reject`, {
          comment: 'Hors mission',
        }),
      );
      expect(r['status']).toBe('rejected');
      const d = ok(await fx.post('viewer', `/hr/expense-reports/${s['id']}/duplicate`), 201);
      expect(d).toMatchObject({ status: 'draft', number: null, total: '7.50' });
    });

    it('annulation : le déclarant tant que soumise ; un validateur avec motif', async () => {
      const s = await soumise('viewer', {
        title: 'Annulée',
        currency: 'USD',
        lines: [lignes()[1]],
      });
      ok(await fx.post('viewer', `/hr/expense-reports/${s['id']}/cancel`, {}));
      const t = await soumise('viewer', {
        title: 'Annulée 2',
        currency: 'USD',
        lines: [lignes()[1]],
      });
      code(
        await fx.post('owner', `/hr/expense-reports/${t['id']}/cancel`, {}),
        422,
        'EXPENSE_CANCEL_REASON_REQUIRED',
      );
      const c = ok(
        await fx.post('owner', `/hr/expense-reports/${t['id']}/cancel`, { reason: 'Doublon' }),
      );
      expect(c).toMatchObject({ status: 'cancelled', cancelReason: 'Doublon' });
    });
  });

  describe('approbateur unique (organisation B)', () => {
    it('la Propriétaire seule valide et rembourse sa propre note ; décisions marquées et journalisées', async () => {
      const n = ok(
        await fx.post('ownerB', '/hr/expense-reports', {
          title: 'Taxi',
          currency: 'USD',
          lines: [{ ...lignes()[1] }],
        }),
        201,
      );
      const s = ok(
        await fx.post('ownerB', `/hr/expense-reports/${n['id']}/submit`, {
          expectedRevision: n['revision'],
        }),
      );
      expect(s['steps']).toEqual(['finance']);
      const a = ok(await approveAs('ownerB', n['id']));
      expect(a['approvals'][0]).toMatchObject({ soleApprover: true });
      const r = ok(
        await fx.post('ownerB', `/hr/expense-reports/${n['id']}/reimburse`, {
          expectedRevision: a['revision'],
          paidOn: today,
          accountId: banqueB,
          method: 'cash',
        }),
      );
      expect(r['reimbursement']).toMatchObject({ soleApprover: true });
      const audits = await db
        .collection('audit_events')
        .find({ organizationId: fx.orgB, targetId: n['id'] })
        .toArray();
      const approved = audits.find((x) => x['action'] === 'hr.expense_report.approved');
      expect(approved!['metadata']['soleApprover']).toBe(true);
      expect(await balance('ownerB', banqueB)).toBe('92.50');
    });
  });

  describe('rotation secrets:rewrap', () => {
    it('k1 → k2 : un justificatif écrit sous k1 se relit après le rewrap et la retraite de k1', async () => {
      const n = ok(
        await fx.post('viewer', '/hr/expense-reports', {
          title: 'Rotation',
          currency: 'USD',
          lines: [lignes()[1]],
        }),
        201,
      );
      ok(await uploadReceipt('viewer', n['id'], n['lines'][0]['id']), 201);
      const cle = async () =>
        (await db.collection('hr_expense_reports').findOne({ _id: new ObjectId(n['id']) }))![
          'lines'
        ][0]['receipt'];
      const avant = await cle();
      expect(avant['wrappedKey']['keyId']).toBe('k1');
      const objetAvant = objects.get(`rh-test/hr-expense-receipts/${avant['objectId']}`)!.body;

      const k1 = { keyId: 'k1', key: CLE_K1 };
      const k2 = { keyId: 'k2', key: randomBytes(32) };
      const rewrap = new RewrapService(
        fx.app.get<Model<IntegrationDocument>>(getModelToken(Integration.name)),
        fx.app.get<Model<OrganizationSecretDocument>>(getModelToken(OrganizationSecret.name)),
        fx.app.get<Connection>(getConnectionToken()),
        MasterKeyring.of([k2, k1], 'k2'),
        fx.app.get(PlatformAuditService),
        fx.app.get(SecretsService),
      );
      const premier = await rewrap.run('operateur-1');
      expect(premier.remainingKeyIds).toEqual([]);
      expect(premier.rewrapped).toBeGreaterThanOrEqual(1);
      expect((await cle())['wrappedKey']['keyId']).toBe('k2');
      // L'objet chiffré n'est ni relu ni réécrit : seule la clé enveloppée change.
      expect(
        objects.get(`rh-test/hr-expense-receipts/${avant['objectId']}`)!.body.equals(objetAvant),
      ).toBe(true);
      const second = await rewrap.run('operateur-1');
      expect(second.rewrapped).toBe(0);
      expect(second.remainingKeyIds).toEqual([]);

      // `_PREVIOUS` retirée : l'application ne connaît plus que k2.
      const service = fx.app.get(HrExpenseReportsService) as unknown as { keyring: MasterKeyring };
      const ancien = service.keyring;
      service.keyring = MasterKeyring.of([k2], 'k2');
      try {
        const file = await fx
          .get('viewer', `/hr/expense-reports/${n['id']}/lines/${n['lines'][0]['id']}/receipt`)
          .buffer(true)
          .parse((res, cb) => {
            const chunks: Buffer[] = [];
            res.on('data', (d: Buffer) => chunks.push(d));
            res.on('end', () => cb(null, Buffer.concat(chunks)));
          });
        expect(file.status).toBe(200);
        expect((file.body as Buffer).equals(PDF)).toBe(true);
      } finally {
        service.keyring = ancien;
      }
      const traces = await db
        .collection('audit_events')
        .find({ action: 'secret.rewrapped', targetType: 'hr_expense_receipt', targetId: n['id'] })
        .toArray();
      expect(traces).toHaveLength(1);
      expect(traces[0]!['metadata']).toEqual({ lineId: n['lines'][0]['id'], keyId: 'k2' });
    });
  });

  describe('résumés, réglages, isolation', () => {
    it('résumé par catégorie : validateurs et RH ; jamais par personne', async () => {
      const s = ok(
        await fx.get(
          'hr_manager',
          `/hr/expenses/summary?from=${day(30)}&to=${today}&groupBy=department`,
        ),
      );
      expect(s['groups'].every((g: Record<string, unknown>) => !('employeeId' in g))).toBe(true);
      const c = ok(await fx.get('owner', `/hr/expenses/summary?from=${day(30)}&to=${today}`));
      expect(c['groupBy']).toBe('category');
      code(
        await fx.get('analyst', `/hr/expenses/summary?from=${day(30)}&to=${today}`),
        403,
        'FORBIDDEN',
      );
    });

    it('circuit : changer exige `expenses.approve` ; notes éteintes : 409 HR_FEATURE_DISABLED', async () => {
      const cur = ok(await fx.get('viewer', '/hr/settings/expenses'));
      expect(cur['expenses']).toMatchObject({
        enabled: true,
        approvalFlow: 'manager_then_finance',
      });
      expect(cur['advances']['enabled']).toEqual({ expenses: true, salary: false });
      code(
        await fx.put('hr_manager', '/hr/settings/expenses', {
          expectedRevision: cur['revision'],
          approvalFlow: 'finance_only',
        }),
        403,
        'FORBIDDEN',
      );
      const off = ok(
        await fx.put('hr_manager', '/hr/settings/expenses', {
          expectedRevision: cur['revision'],
          enabled: false,
        }),
      );
      code(
        await fx.post('viewer', '/hr/expense-reports', {
          title: 'X',
          currency: 'USD',
          lines: lignes(),
        }),
        409,
        'HR_FEATURE_DISABLED',
      );
      ok(
        await fx.put('owner', '/hr/settings/expenses', {
          expectedRevision: off['revision'],
          enabled: true,
        }),
      );
    });

    it('isolation : note, remboursement, liste et compte d’une autre organisation', async () => {
      const mine = ok(await fx.get('viewer', '/hr/expense-reports'));
      const id = mine['items'][0]['id'];
      code(await fx.get('ownerB', `/hr/expense-reports/${id}`), 404, 'EXPENSE_REPORT_NOT_FOUND');
      code(await approveAs('ownerB', id), 404, 'EXPENSE_REPORT_NOT_FOUND');
      code(
        await fx.post('ownerB', `/hr/expense-reports/${id}/reimburse`, {
          expectedRevision: 1,
          paidOn: today,
          accountId: banqueB,
          method: 'cash',
        }),
        404,
        'EXPENSE_REPORT_NOT_FOUND',
      );
      const listB = ok(await fx.get('ownerB', '/hr/expense-reports'));
      expect(listB['items'].every((x: { employeeId: string }) => x.employeeId === emp.OB)).toBe(
        true,
      );
      // Compte d'une autre organisation pour rembourser une note de N.
      const s = await soumise('viewer', { title: 'Iso', currency: 'USD', lines: [lignes()[1]] });
      ok(await approveAs('analyst', s['id']));
      const f = ok(await approveAs('finance_director', s['id']));
      const res = await fx.post('accountant', `/hr/expense-reports/${s['id']}/reimburse`, {
        expectedRevision: f['revision'],
        paidOn: today,
        accountId: banqueB,
        method: 'cash',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      code(
        await fx.get('ownerB', `/hr/expense-reports?employeeId=${emp.B}`),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
    });
  });
});
