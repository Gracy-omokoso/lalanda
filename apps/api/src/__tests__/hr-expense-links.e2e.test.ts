// Liens du second volet RH contre la vraie application (ADR-0051 § 7.3, § 7.5, § 7.6,
// § 7.8 ; critères 6, 15, 16). ADR-0051 — H14.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard → contrôleurs →
// MongoDB. Les notes passent par le vrai circuit (soumission, deux étapes, remboursement) :
//
//   A (Analyste) manager de B (Lecteur). B déclare une note : 15,00 USD de taxi imputés au
//   projet P et marqués « refacturables », 7,50 USD de photocopies.
//
// Couvre : « Mes tâches » (note à valider chez A, à rembourser chez le Comptable, jamais
// chez B ni chez l'approbateur de l'étape finance), R19 et R20 et leurs gardes, aucun
// montant ni « sur salaire » ; marge 1.4.0 (`pendingExpenseClaims` avant remboursement,
// montant de la marge inchangé ; la dépense après, sans double comptage) ; frais
// refacturables (sans nom, isolation) ; correction de pointage à décider ; colonne
// « présence » de la feuille de temps.

import 'reflect-metadata';

import { kinshasaDayOf } from '@lalanda/shared/work';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { code, hrFixture, ok, type HrAccount, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');

vi.setConfig({ testTimeout: 120_000 });

const today = kinshasaDayOf(new Date());
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

interface Fact {
  id: string;
  status: string;
  value: string | null;
}
interface Brief {
  facts: Fact[];
  alerts: { ruleId: string; rank: number; actionPath: string; message: string }[];
  rulesSkipped: { ruleId: string; reason: string }[];
}
interface Item {
  source: string;
  kind: string;
  id: string;
  label?: string;
  href?: string;
}

e2eSuite('RH — liens des frais, avances et présences (ADR-0051 H14)', () => {
  let fx: HrFixture;
  let db: Db;
  const emp = { A: '', B: '' };
  let projetP = '';
  let banque = '';
  let note = '';

  const empRev = async (id: string) =>
    (await db.collection('hr_employees').findOne({ _id: new ObjectId(id) }))!['revision'] as number;
  const revOf = async (id: string) =>
    (await db.collection('hr_expense_reports').findOne({ _id: new ObjectId(id) }))![
      'revision'
    ] as number;
  const brief = async (who: HrAccount) => ok(await fx.get(who, '/morning-brief'))['brief'] as Brief;
  const fact = (b: Brief, id: string) => b.facts.find((f) => f.id === id)!;
  const hrItems = async (who: HrAccount): Promise<Item[]> => {
    const v = ok(await fx.get(who, '/work/my-tasks'));
    return (
      [...v['overdue'], ...v['today'], ...v['next7Days'], ...v['later'], ...v['noDate']] as Item[]
    ).filter(
      (i) => i.source === 'hr' && i.kind !== 'leave_approval' && i.kind !== 'checklist_item',
    );
  };

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-liens2');
    db = fx.db;
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
        expectedRevision: await empRev(emp.B),
        managerEmployeeId: emp.A,
      }),
    );
    banque = ok(
      await fx.post('owner', '/treasury/accounts', {
        name: 'Caisse USD',
        kind: 'cash',
        currency: 'USD',
        openingBalance: '1000.00',
        openingDate: '2026-01-01',
      }),
      201,
    )['id'];
    projetP = ok(
      await fx.post('owner', '/work/projects', { name: 'Projet P', kind: 'internal' }),
      201,
    )['id'];
  }, 900_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  describe('note soumise : à valider chez le manager (critère 15)', () => {
    it('B soumet ; A voit « Note de frais NF… » sans montant ; B rien ; R19 chez A', async () => {
      const n = ok(
        await fx.post('viewer', '/hr/expense-reports', {
          title: 'Mission client',
          currency: 'USD',
          lines: [
            {
              spentOn: addDays(today, -2),
              category: 'transport',
              label: 'Taxi client',
              amount: '15.00',
              merchant: 'Taxi Gombe',
              workProjectId: projetP,
              rebillable: true,
              missingReceiptReason: 'Ticket perdu',
            },
            {
              spentOn: addDays(today, -2),
              category: 'charges_diverses',
              label: 'Photocopies',
              amount: '7.50',
              missingReceiptReason: 'Ticket perdu',
            },
          ],
        }),
        201,
      );
      note = n['id'];
      ok(
        await fx.post('viewer', `/hr/expense-reports/${note}/submit`, {
          expectedRevision: n['revision'],
        }),
      );

      const chezA = await hrItems('analyst');
      const item = chezA.find((i) => i.id === `hr:expense_approval:${note}`)!;
      expect(item).toMatchObject({
        kind: 'expense_approval',
        href: '/rh/frais?vue=a-valider',
        kindLabel: 'Frais à valider',
      });
      expect(item.label).toMatch(/^Note de frais NF\d{4}-\d{6}$/);
      const texte = JSON.stringify(chezA);
      expect(texte).not.toMatch(/15\.00|22\.50|salaire/);
      expect((await hrItems('viewer')).map((i) => i.id)).not.toContain(
        `hr:expense_approval:${note}`,
      );
      // Ni manager ni validateur : rien.
      expect(await hrItems('sales_rep')).toEqual([]);

      const b = await brief('analyst');
      expect(fact(b, 'mes_validations_frais.en_attente')).toMatchObject({
        status: 'known',
        value: '1',
      });
      expect(b.alerts.find((a) => a.ruleId === 'validations_frais_en_attente')).toMatchObject({
        rank: 19,
        actionPath: '/rh/frais?vue=a-valider',
      });
      // B ne valide rien, ne paie rien : faits masqués, règles non évaluées.
      const bb = await brief('viewer');
      expect(fact(bb, 'mes_validations_frais.en_attente').status).toBe('hidden');
      expect(fact(bb, 'rh.remboursements_a_payer').status).toBe('hidden');
      expect(bb.rulesSkipped).toContainEqual({
        ruleId: 'remboursements_personnel_a_payer',
        reason: 'hidden',
      });
    });

    it('isolation : l’organisation B ne voit rien', async () => {
      expect(await hrItems('ownerB')).toEqual([]);
      expect(fact(await brief('ownerB'), 'mes_validations_frais.en_attente').value).toBe('0');
    });
  });

  describe('note approuvée : à rembourser chez le payeur, marge informative (critères 6, 15)', () => {
    it('A puis la Directrice financière valident ; la note passe chez le Comptable, pas chez elle', async () => {
      ok(
        await fx.post('analyst', `/hr/expense-reports/${note}/approve`, {
          expectedRevision: await revOf(note),
        }),
      );
      expect((await hrItems('analyst')).map((i) => i.id)).not.toContain(
        `hr:expense_approval:${note}`,
      );
      ok(
        await fx.post('finance_director', `/hr/expense-reports/${note}/approve`, {
          expectedRevision: await revOf(note),
        }),
      );
      const chezC = await hrItems('accountant');
      expect(chezC.find((i) => i.id === `hr:expense_to_pay:${note}`)).toMatchObject({
        kind: 'expense_to_pay',
        href: '/rh/frais?vue=a-payer',
        kindLabel: 'À rembourser',
      });
      // L'approbatrice de l'étape finance ne paie pas : un autre payeur existe.
      expect((await hrItems('finance_director')).map((i) => i.id)).not.toContain(
        `hr:expense_to_pay:${note}`,
      );
      const b = await brief('accountant');
      expect(fact(b, 'rh.remboursements_a_payer')).toMatchObject({ status: 'known', value: '1' });
      expect(b.alerts.find((a) => a.ruleId === 'remboursements_personnel_a_payer')).toMatchObject({
        rank: 20,
        actionPath: '/rh/frais?vue=a-payer',
      });
      // La Responsable RH ne paie pas : fait masqué.
      expect(fact(await brief('hr_manager'), 'rh.remboursements_a_payer').status).toBe('hidden');
    });

    it('avant remboursement : ligne en attente, MONTANT DE LA MARGE INCHANGÉ', async () => {
      const m = ok(await fx.get('owner', `/work/projects/${projetP}/margin`));
      expect(m['version']).toBe('1.4.0');
      expect(m['pendingExpenseClaims']).toEqual([
        { currency: 'USD', amount: '15.00', lineCount: 1 },
      ]);
      expect(m['currencies']).toEqual([]);
      expect(ok(await fx.get('owner', `/work/projects/${projetP}/rebillable-expenses`))).toEqual({
        projectId: projetP,
        items: [],
        truncated: false,
      });
    });

    it('après remboursement : la dépense entre dans la marge, plus rien en attente, ni chez le payeur', async () => {
      ok(
        await fx.post('accountant', `/hr/expense-reports/${note}/reimburse`, {
          expectedRevision: await revOf(note),
          paidOn: today,
          accountId: banque,
          method: 'cash',
        }),
      );
      const m = ok(await fx.get('owner', `/work/projects/${projetP}/margin`));
      expect(m['currencies']).toEqual([
        expect.objectContaining({ currency: 'USD', expenses: '15.00', margin: '-15.00' }),
      ]);
      expect(m['pendingExpenseClaims']).toEqual([]);
      expect((await hrItems('accountant')).map((i) => i.id)).not.toContain(
        `hr:expense_to_pay:${note}`,
      );
      expect(fact(await brief('accountant'), 'rh.remboursements_a_payer').value).toBe('0');
    });
  });

  describe('frais refacturables (§ 7.3, critère 16)', () => {
    it('la ligne remboursée marquée « refacturable », sans nom ; droits ; isolation', async () => {
      const r = ok(await fx.get('owner', `/work/projects/${projetP}/rebillable-expenses`));
      expect(r['items']).toHaveLength(1);
      expect(r['items'][0]).toMatchObject({
        reportId: note,
        lineIndex: 0,
        category: 'transport',
        currency: 'USD',
        amount: '15.00',
        merchant: 'Taxi Gombe',
      });
      expect(r['items'][0]['label']).toMatch(/^Frais NF\d{4}-\d{6} — Taxi client$/);
      expect(JSON.stringify(r)).not.toMatch(/Bea|Membre|viewer/);
      // La Responsable RH ne lit ni la trésorerie ni les ventes : 403.
      code(
        await fx.get('hr_manager', `/work/projects/${projetP}/rebillable-expenses`),
        403,
        'FORBIDDEN',
      );
      // Projet d'une autre organisation : 404.
      expect((await fx.get('ownerB', `/work/projects/${projetP}/rebillable-expenses`)).status).toBe(
        404,
      );
      expect(
        (
          await fx.get(
            'owner',
            `/work/projects/${new ObjectId().toHexString()}/rebillable-expenses`,
          )
        ).status,
      ).toBe(404);
    });
  });

  describe('présences (§ 7.5, § 7.8)', () => {
    it('pointage éteint : ni correction, ni colonne « présence »', async () => {
      const t = ok(await fx.get('viewer', '/work/timesheets'));
      expect(
        (t['days'] as { attendanceMinutes?: number | null }[]).every(
          (d) => d.attendanceMinutes === undefined,
        ),
      ).toBe(true);
    });

    it('activé : B demande une correction, A la voit à décider, pas B ; la feuille montre la présence', async () => {
      const rev = ok(await fx.get('hr_manager', '/hr/attendance/settings'))['revision'] as number;
      ok(
        await fx.put('hr_manager', '/hr/attendance/settings', {
          expectedRevision: rev,
          attendance: { enabled: true },
        }),
      );
      const veille = addDays(today, -1);
      const c = ok(
        await fx.post('viewer', '/hr/attendance/corrections', {
          date: veille,
          proposed: [
            { kind: 'in', at: `${veille}T07:02:00Z` },
            { kind: 'out', at: `${veille}T16:10:00Z` },
          ],
          voidEventIds: [],
          reason: 'Oubli de pointage',
        }),
        201,
      );
      const chezA = await hrItems('analyst');
      expect(chezA.find((i) => i.id === `hr:attendance_correction:${c['id']}`)).toMatchObject({
        kind: 'attendance_correction',
        href: '/rh/presences',
      });
      expect((await hrItems('viewer')).map((i) => i.kind)).not.toContain('attendance_correction');
      ok(await fx.post('analyst', `/hr/attendance/corrections/${c['id']}/approve`, {}));
      expect((await hrItems('analyst')).map((i) => i.id)).not.toContain(
        `hr:attendance_correction:${c['id']}`,
      );

      // 08:02 → 17:10 à Kinshasa : 548 minutes (moteur `attendanceDay`).
      const monday = (d: string) => {
        const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
        return addDays(d, -((wd + 6) % 7));
      };
      const week = monday(veille);
      const t = ok(await fx.get('viewer', `/work/timesheets?week=${week}`));
      const jour = (t['days'] as { date: string; attendanceMinutes?: number }[]).find(
        (d) => d.date === veille,
      )!;
      expect(jour.attendanceMinutes).toBe(548);
      // Le manager la voit aussi ; un membre de l'organisation B : 404.
      const q = `/work/timesheets?userId=${fx.userIds['viewer']}&week=${week}`;
      const parA = ok(await fx.get('analyst', q));
      expect(
        (parA['days'] as { date: string; attendanceMinutes?: number }[]).find(
          (d) => d.date === veille,
        )!.attendanceMinutes,
      ).toBe(548);
      expect((await fx.get('ownerB', q)).status).toBe(404);
    });
  });
});
