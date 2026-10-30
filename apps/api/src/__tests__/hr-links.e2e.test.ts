// Liens des RH avec le brief, les projets, le temps et la marge, contre la vraie
// application (ADR-0045 § 6.2, § 6.3, § 6.5 ; critères 10, 16, 17). ADR-0045 — H5.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard → contrôleurs →
// MongoDB. Les absences passent par le vrai circuit (demande, validation) :
//
//   A (Analyste) manager de B (Commercial), C (Comptable) et D (Lecteur).
//   B : « Maladie » (type confidentiel) aujourd'hui → validée par la Responsable RH.
//   C : « Absence autorisée » aujourd'hui → validée par A.
//   D : demande future en attente → à valider par A.
//
// Couvre : faits R13 à R15 et leurs gardes, ANTI-FUITE du brief (ni nom, ni type
// confidentiel, ni motif), e-mail ; badge « Absent » et constat
// `ASSIGNEE_ABSENT_ON_DUE_DATE` sur un projet et dans « Mes tâches » du créateur ;
// feuille de temps en lecture (`TIME_ON_LEAVE_DAY`, portée, isolation) ; constat de
// marge `PERSONNEL_EXPENSES_AND_TIME_COST`, montant de la marge inchangé.

import 'reflect-metadata';

import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { emailContent } from '../morning-brief/morning-brief-email.job.js';
import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrAccount, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');

vi.setConfig({ testTimeout: 120_000 });

const TODAY = kinshasaDayOf(new Date());
const IN_6 = addDays(TODAY, 6);
const full = (date: string) => ({ date, half: 'full' as const });
const MOTIF_SECRET = 'Consultation cardiologue confidentielle';

interface Fact {
  id: string;
  status: string;
  value: string | null;
  source: { module: string };
}
interface Brief {
  version: string;
  facts: Fact[];
  alerts: { ruleId: string; message: string }[];
  recommendations: { ruleId: string; message: string; actionPath: string }[];
  rulesSkipped: { ruleId: string; reason: string }[];
}

function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return addDays(day, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
}

e2eSuite('RH — liens avec le brief, les projets, le temps et la marge (ADR-0045 H5)', () => {
  let fx: HrFixture;
  const emp = { A: '', B: '', C: '', D: '' };
  const type = { maladie: '', autorisee: '' };
  let projectId = '';
  const task = { c: '', b: '', libre: '' };

  const brief = async (who: HrAccount): Promise<Brief> =>
    ok(await fx.get(who, '/morning-brief'))['brief'] as Brief;
  const fact = (b: Brief, id: string): Fact => {
    const f = b.facts.find((x) => x.id === id);
    expect(f, id).toBeDefined();
    return f!;
  };

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-liens');
    const u = fx.userIds;
    const res = ok(
      await fx.post('hr_manager', '/hr/employees/from-members', {
        userIds: [u['analyst'], u['sales_rep'], u['accountant'], u['viewer']],
      }),
      201,
    );
    const byUser = (id: string) =>
      res['items'].find((e: { userId: string }) => e.userId === id)['id'] as string;
    emp.A = byUser(u['analyst']);
    emp.B = byUser(u['sales_rep']);
    emp.C = byUser(u['accountant']);
    emp.D = byUser(u['viewer']);
    for (const id of [emp.B, emp.C, emp.D]) {
      const rev = (await fx.db.collection('hr_employees').findOne({ _id: new ObjectId(id) }))![
        'revision'
      ] as number;
      ok(
        await fx.put('hr_manager', `/hr/employees/${id}`, {
          expectedRevision: rev,
          managerEmployeeId: emp.A,
        }),
      );
    }
    const types = ok(await fx.get('hr_manager', '/hr/leave-types'))['items'] as {
      id: string;
      key: string;
    }[];
    type.maladie = types.find((t) => t.key === 'sick_leave')!.id;
    type.autorisee = types.find((t) => t.key === 'authorized_absence')!.id;

    // B : « Maladie » aujourd'hui, étape RH seule.
    const b = ok(
      await fx.post('sales_rep', '/hr/leave-requests', {
        typeId: type.maladie,
        start: full(TODAY),
        end: full(IN_6),
        reason: MOTIF_SECRET,
      }),
      201,
    );
    expect(b['steps']).toEqual(['hr']);
    ok(
      await fx.post('hr_manager', `/hr/leave-requests/${b['id']}/approve`, { expectedRevision: 1 }),
    );
    // C : « Absence autorisée » aujourd'hui, validée par son manager A.
    const c = ok(
      await fx.post('accountant', '/hr/leave-requests', {
        typeId: type.autorisee,
        start: full(TODAY),
        end: full(IN_6),
      }),
      201,
    );
    ok(await fx.post('analyst', `/hr/leave-requests/${c['id']}/approve`, { expectedRevision: 1 }));
    // D : demande future, en attente de A.
    ok(
      await fx.post('viewer', '/hr/leave-requests', {
        typeId: type.autorisee,
        start: full(addDays(TODAY, 40)),
        end: full(addDays(TODAY, 44)),
      }),
      201,
    );
    // Échéances : un chauffeur sans compte, fin d'essai dans 5 jours, fin de CDD dans 10.
    ok(
      await fx.post(
        'hr_manager',
        '/hr/employees',
        fiche('Chauffeur', {
          startDate: addDays(TODAY, -60),
          contractType: 'fixed_term',
          probationEndDate: addDays(TODAY, 5),
          contractEndDate: addDays(TODAY, 10),
        }),
      ),
      201,
    );
  }, 300_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  describe('brief du matin (§ 6.5, critère 16)', () => {
    it('A (manager) : deux absents dans son équipe → R13 ; une demande à valider → R14', async () => {
      const b = await brief('analyst');
      expect(b.version).toBe('1.4.0');
      expect(fact(b, 'rh.absents_aujourdhui')).toMatchObject({ status: 'known', value: '2' });
      expect(fact(b, 'mes_validations_absence.en_attente')).toMatchObject({
        status: 'known',
        value: '1',
      });
      // Sans `hr.read` : pas d'échéances.
      expect(fact(b, 'rh.echeances')).toMatchObject({ status: 'hidden', value: null });
      // R13 (information) est évaluée et déclenchée ; la coupe à trois peut la laisser
      // derrière des alertes : son texte est vérifié par le moteur.
      expect(b.rulesSkipped.map((r) => r.ruleId)).not.toContain('absences_du_jour');
      const r13 = b.recommendations.find((r) => r.ruleId === 'absences_du_jour');
      if (r13) expect(r13.message).toBe('2 personnes de votre équipe sont absentes aujourd’hui.');
      expect(b.alerts.map((a) => a.ruleId)).toContain('validations_absence_en_attente');
    });

    it('anti-fuite : ni type confidentiel, ni motif, ni nom, ni identifiant de fiche', async () => {
      for (const who of ['analyst', 'hr_manager', 'owner', 'viewer'] as const) {
        const text = JSON.stringify(await brief(who));
        expect(text, who).not.toContain('Maladie');
        expect(text, who).not.toContain(MOTIF_SECRET);
        expect(text, who).not.toContain('sales_rep');
        for (const id of Object.values(emp)) expect(text, who).not.toContain(id);
      }
    });

    it('Responsable RH : l’organisation entière et les échéances (R15)', async () => {
      const b = await brief('hr_manager');
      expect(fact(b, 'rh.absents_aujourdhui').value).toBe('2');
      expect(fact(b, 'rh.echeances')).toMatchObject({ status: 'known', value: '2' });
      expect(b.alerts.find((a) => a.ruleId === 'echeances_rh_proches')?.message).toBe(
        '2 échéances RH dans les prochains jours (fin d’essai, fin de contrat, document).',
      );
    });

    it('D (sans équipe, sans validation, sans hr.read) : faits masqués ; l’e-mail n’en dit rien', async () => {
      const b = await brief('viewer');
      for (const id of [
        'rh.absents_aujourdhui',
        'mes_validations_absence.en_attente',
        'rh.echeances',
      ])
        expect(fact(b, id)).toMatchObject({ status: 'hidden', value: null });
      expect(b.rulesSkipped).toContainEqual({ ruleId: 'absences_du_jour', reason: 'hidden' });
      const mail = emailContent(b as never, 'Org');
      expect(mail.facts.join('\n')).not.toMatch(/absent|absence|RH/i);
      // A, lui, reçoit ses nombres par e-mail.
      const mailA = emailContent((await brief('analyst')) as never, 'Org');
      expect(mailA.facts).toContain('Personnes absentes aujourd’hui : 2');
    });

    it('isolation : l’organisation B ne voit aucune absence de N', async () => {
      const b = await brief('ownerB');
      expect(fact(b, 'rh.absents_aujourdhui')).toMatchObject({ status: 'known', value: '0' });
      expect(fact(b, 'rh.echeances').value).toBe('0');
    });
  });

  describe('projets : badge « Absent » et constat d’échéance (§ 6.2, critère 17)', () => {
    it('prépare un projet et trois tâches', async () => {
      const p = ok(
        await fx.post('owner', '/work/projects', { name: 'Chantier', kind: 'internal' }),
        201,
      );
      projectId = p['id'];
      const mk = async (title: string, assigneeUserId: string, dueDate: string) =>
        ok(
          await fx.post('owner', `/work/projects/${projectId}/tasks`, {
            title,
            assigneeUserId,
            dueDate,
          }),
          201,
        )['task']['id'] as string;
      task.c = await mk('Bilan', fx.userIds['accountant'], addDays(TODAY, 2));
      task.b = await mk('Relance', fx.userIds['sales_rep'], addDays(TODAY, 3));
      task.libre = await mk('Plus tard', fx.userIds['accountant'], addDays(TODAY, 20));
    });

    it('tout détenteur de work.read voit « absent du … au … », jamais le type', async () => {
      const res = await fx.get('viewer', `/work/projects/${projectId}/tasks`);
      const items = ok(res)['items'] as Record<string, unknown>[];
      const byId = (id: string) => items.find((t) => t['id'] === id)!;
      const span = { from: TODAY, to: IN_6 };
      expect(byId(task.c)).toMatchObject({ assigneeAbsence: span, dueDateAbsence: span });
      expect(byId(task.b)).toMatchObject({ assigneeAbsence: span, dueDateAbsence: span });
      // Échéance après le retour : badge, pas de constat.
      expect(byId(task.libre)).toMatchObject({ assigneeAbsence: span, dueDateAbsence: null });
      expect(res.text).not.toContain('Maladie');
      expect(res.text).not.toContain(MOTIF_SECRET);
      expect(res.text).not.toContain('Absence autorisée');
    });

    it('« Mes tâches » du créateur porte les constats ; celles de l’assigné, le badge', async () => {
      const mine = ok(await fx.get('owner', '/work/my-tasks'));
      const findings = mine['absenceFindings'] as {
        taskId: string;
        code: string;
        absence: unknown;
      }[];
      expect(findings.map((f) => f.taskId).sort()).toEqual([task.b, task.c].sort());
      expect(findings[0]).toMatchObject({
        code: 'ASSIGNEE_ABSENT_ON_DUE_DATE',
        absence: { from: TODAY, to: IN_6 },
      });
      expect(JSON.stringify(mine)).not.toContain('Maladie');
      // C n'a rien créé : aucun constat chez lui.
      expect(ok(await fx.get('accountant', '/work/my-tasks'))['absenceFindings']).toEqual([]);
    });
  });

  describe('feuille de temps en lecture (§ 6.3, critère 17)', () => {
    const week = mondayOf(TODAY);

    it('120 minutes saisies par C un jour d’absence → TIME_ON_LEAVE_DAY', async () => {
      ok(
        await fx.post('accountant', `/work/tasks/${task.c}/time-entries`, {
          workedOn: TODAY,
          minutes: 120,
        }),
        201,
      );
      const t = ok(await fx.get('accountant', '/work/timesheets'));
      expect(t).toMatchObject({ week, employeeLinked: true, totalMinutes: 120 });
      expect(t['findings']).toContainEqual({
        code: 'TIME_ON_LEAVE_DAY',
        date: TODAY,
        minutes: 120,
      });
      const day = (t['days'] as { date: string; absence: string | null }[]).find(
        (d) => d.date === TODAY,
      );
      expect(day?.absence).toBe('full');
      expect(t['projects']).toEqual([
        expect.objectContaining({ projectId, projectName: 'Chantier', totalMinutes: 120 }),
      ]);
      // Aucune écriture : rien n'a changé dans les saisies.
      expect(
        await fx.db.collection('work_time_entries').countDocuments({ organizationId: fx.orgN }),
      ).toBe(1);
    });

    it('autrui : le manager et work.manage oui ; un collègue, l’autre organisation : 404', async () => {
      const q = `/work/timesheets?userId=${fx.userIds['accountant']}&week=${week}`;
      expect(ok(await fx.get('analyst', q))['totalMinutes']).toBe(120);
      expect(ok(await fx.get('owner', q))['totalMinutes']).toBe(120);
      code(await fx.get('viewer', q), 404, 'WORK_MEMBER_NOT_FOUND');
      code(await fx.get('ownerB', q), 404, 'WORK_MEMBER_NOT_FOUND');
      // La feuille de B (« Maladie ») vue par son manager : demi-journées, jamais le type.
      const tb = await fx.get('analyst', `/work/timesheets?userId=${fx.userIds['sales_rep']}`);
      expect(tb.status).toBe(200);
      expect(tb.text).not.toContain('Maladie');
      expect(tb.text).not.toContain(MOTIF_SECRET);
    });

    it('semaine qui ne commence pas un lundi : 400 ; sans work.read : 403', async () => {
      expect((await fx.get('owner', `/work/timesheets?week=${addDays(week, 1)}`)).status).toBe(400);
      expect((await fx.get('advisor', '/work/timesheets')).status).toBe(403);
    });
  });

  describe('marge 1.2.0 : salaire rattaché et temps valorisé (§ 6.3, critère 17)', () => {
    it('constat levé, montant de la marge inchangé', async () => {
      ok(
        await fx.post('owner', '/work/rates', {
          userId: fx.userIds['accountant'],
          currency: 'USD',
          hourlyCost: '10.00',
          effectiveFrom: '2026-01-01',
        }),
        201,
      );
      const depense = (category: string) => ({
        spentOn: TODAY,
        amount: '300.00',
        currency: 'USD',
        category,
        label: 'Dépense',
        supplierName: null,
        accountId: null,
        deductibleVat: null,
        reference: null,
        workProjectId: projectId,
      });
      const autre = ok(await fx.post('owner', '/treasury/expenses', depense('achats')), 201);
      const avant = ok(await fx.get('owner', `/work/projects/${projectId}/margin`));
      expect(avant['version']).toBe('1.2.0');
      expect((avant['findings'] as { code: string }[]).map((f) => f.code)).not.toContain(
        'PERSONNEL_EXPENSES_AND_TIME_COST',
      );
      // Même montant, catégorie `personnel` : la marge ne bouge pas, le constat apparaît.
      ok(
        await fx.post('owner', `/treasury/expenses/${autre['id']}/cancel`, { reason: 'Reclassée' }),
      );
      ok(await fx.post('owner', '/treasury/expenses', depense('personnel')), 201);
      const apres = ok(await fx.get('owner', `/work/projects/${projectId}/margin`));
      expect(apres['currencies']).toEqual(avant['currencies']);
      expect(apres['findings']).toContainEqual({
        code: 'PERSONNEL_EXPENSES_AND_TIME_COST',
        currency: 'USD',
        count: 1,
      });
    });
  });
});
