// Échéances RH, tâche `hr.reminders` et tâche `hr.retention` contre la vraie
// application (ADR-0045 § 6.4, § 2.2 ; critères 14, 21). ADR-0045 — H4.
//
// Couvre : un CDD qui finit dans 30 jours, une fin d'essai dans 15, un passeport qui
// expire dans 30 → trois rappels, une seule fois chacun (tâche rejouée deux fois) ;
// destinataires = détenteurs effectifs de `hr.manage` (+ manager pour essai et
// contrat) ; aucun titre ne porte un numéro ; rien avant 7 h à Kinshasa ; une échéance
// hors délai n'est pas rappelée ; `GET /hr/deadlines` (moteur `hrDeadlines`, nature
// de la pièce réservée à `hr.sensitive.read`, `within`) ; `hr.retention` ne fait RIEN
// tant que la conservation n'est pas réglée, puis purge les données sensibles d'un
// ancien salarié quand l'organisation l'a réglée elle-même.

import 'reflect-metadata';

import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HrRemindersJob } from '../hr/reminders/hr-reminders.job.js';
import { HrRetentionJob } from '../hr/retention/hr-retention.job.js';
import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';

vi.setConfig({ testTimeout: 180_000 });

const PASSEPORT = `OP${tag.replace(/[a-f]/g, '6')}31`;

e2eSuite('RH — échéances, rappels et conservation (ADR-0045 H4)', () => {
  let fx: HrFixture;
  let db: Db;
  const today = kinshasaDayOf(new Date());
  /** 10 h à Kinshasa (UTC+1), jour civil `today`. */
  const dix = new Date(`${today}T09:00:00Z`);
  const id = { A: '', cdd: '', essai: '', passeport: '', loin: '', ancien: '' };
  const hrHolders = () =>
    ['owner', 'admin', 'finance_director', 'hr_manager'].map((c) => fx.userIds[c as 'owner']);

  const identite = (expiresOn: string) => ({
    expectedRevision: 0,
    data: { idDocuments: [{ kind: 'passport', number: PASSEPORT, expiresOn }] },
  });

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-rappels');
    db = fx.db;
    const res = ok(
      await fx.post('owner', '/hr/employees/from-members', { userIds: [fx.userIds['analyst']] }),
      201,
    );
    id.A = res['items'][0]['id'];
    id.cdd = ok(
      await fx.post(
        'owner',
        '/hr/employees',
        fiche(`Cdd ${tag}`, {
          contractType: 'fixed_term',
          contractEndDate: addDays(today, 30),
          managerEmployeeId: id.A,
        }),
      ),
      201,
    )['id'];
    id.essai = ok(
      await fx.post(
        'owner',
        '/hr/employees',
        fiche(`Essai ${tag}`, { probationEndDate: addDays(today, 15) }),
      ),
      201,
    )['id'];
    id.passeport = ok(await fx.post('owner', '/hr/employees', fiche(`Passeport ${tag}`)), 201)[
      'id'
    ];
    ok(
      await fx.put(
        'hr_manager',
        `/hr/employees/${id.passeport}/private/identity`,
        identite(addDays(today, 30)),
      ),
    );
    // Hors délai : fin de contrat dans 31 jours, fin d'essai dans 16.
    id.loin = ok(
      await fx.post(
        'owner',
        '/hr/employees',
        fiche(`Loin ${tag}`, {
          contractType: 'fixed_term',
          contractEndDate: addDays(today, 31),
          probationEndDate: addDays(today, 16),
        }),
      ),
      201,
    )['id'];
    // Ancien salarié, sorti il y a 90 jours, avec des données sensibles.
    id.ancien = ok(await fx.post('owner', '/hr/employees', fiche(`Ancien ${tag}`)), 201)['id'];
    ok(
      await fx.put(
        'hr_manager',
        `/hr/employees/${id.ancien}/private/identity`,
        identite('2031-01-01'),
      ),
    );
    const a = await db.collection('hr_employees').findOne({ _id: new ObjectId(id.ancien) });
    ok(
      await fx.post('owner', `/hr/employees/${id.ancien}/exit`, {
        endDate: addDays(today, -90),
        exitCategory: 'end_of_contract',
        expectedRevision: a!['revision'],
      }),
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

  describe('GET /hr/deadlines', () => {
    it('trois échéances sous les délais par défaut (15, 30, 30 jours)', async () => {
      const v = ok(await fx.get('hr_manager', '/hr/deadlines'));
      expect(v['horizons']).toEqual({ probationEnd: 15, contractEnd: 30, documentExpiry: 30 });
      expect(v['total']).toBe(3);
      expect(v['counts']).toEqual({
        probation_end: 1,
        contract_end: 1,
        document_expiry: 0,
        id_expiry: 1,
      });
      const parNature = Object.fromEntries(
        v['items'].map((x: { kind: string }) => [x.kind, x]),
      ) as Record<string, Record<string, unknown>>;
      expect(parNature['probation_end']).toMatchObject({
        employeeId: id.essai,
        date: addDays(today, 15),
        daysLeft: 15,
      });
      expect(parNature['contract_end']).toMatchObject({ employeeId: id.cdd, daysLeft: 30 });
      expect(parNature['id_expiry']).toMatchObject({
        employeeId: id.passeport,
        idKind: 'passport',
      });
      expect(JSON.stringify(v)).not.toContain(PASSEPORT);
      // L'Administrateur (hr.read sans le sensible) : la nature de la pièce est masquée.
      const admin = ok(await fx.get('admin', '/hr/deadlines'));
      expect(admin['total']).toBe(3);
      for (const x of admin['items']) expect(x['idKind']).toBeNull();
      // `within` remplace les trois délais.
      expect(ok(await fx.get('hr_manager', '/hr/deadlines?within=15'))['total']).toBe(1);
      expect(ok(await fx.get('hr_manager', '/hr/deadlines?within=0'))['total']).toBe(0);
      expect(ok(await fx.get('hr_manager', '/hr/deadlines?within=31'))['total']).toBe(5);
      code(await fx.get('hr_manager', '/hr/deadlines?within=121'), 400, 'INVALID_REQUEST');
      // Droits et isolation.
      for (const c of ['analyst', 'accountant', 'viewer', 'sales_rep'] as const) {
        expect((await fx.get(c, '/hr/deadlines')).status, c).toBe(403);
      }
      expect(ok(await fx.get('ownerB', '/hr/deadlines'))['total']).toBe(0);
    });
  });

  describe('tâche hr.reminders', () => {
    it('rien avant 7 h à Kinshasa', async () => {
      const job = fx.app.get(HrRemindersJob);
      const report = await job.run(new Date(`${today}T05:00:00Z`));
      expect(report).toEqual({ organizations: 0, claimed: 0, notified: 0 });
    });

    it('trois rappels, une seule fois chacun, tâche rejouée deux fois', async () => {
      const job = fx.app.get(HrRemindersJob);
      const premier = await job.run(dix);
      expect(premier.claimed).toBe(3);
      // 4 détenteurs de `hr.manage` par échéance, plus le manager pour la fin de contrat.
      expect(premier.notified).toBe(4 * 3 + 1);
      const second = await job.run(dix);
      expect(second.claimed).toBe(0);
      expect(second.notified).toBe(0);
      expect(await job.run(new Date(dix.getTime() + 3_600_000))).toMatchObject({ claimed: 0 });

      const notifs = await db
        .collection('notifications')
        .find({
          organizationId: fx.orgN,
          kind: { $in: ['hr.probation_ending', 'hr.contract_ending', 'hr.document_expiring'] },
        })
        .toArray();
      expect(notifs).toHaveLength(13);
      const par = (kind: string) =>
        notifs
          .filter((n) => n['kind'] === kind)
          .map((n) => n['recipientUserId'])
          .sort();
      expect(par('hr.contract_ending')).toEqual([...hrHolders(), fx.userIds['analyst']].sort());
      expect(par('hr.probation_ending')).toEqual(hrHolders().sort());
      expect(par('hr.document_expiring')).toEqual(hrHolders().sort());
      // Une clé par échéance ; aucun numéro, aucun rappel hors délai.
      expect(new Set(notifs.map((n) => n['dedupeKey'])).size).toBe(3);
      expect(JSON.stringify(notifs)).not.toContain(PASSEPORT);
      expect(JSON.stringify(notifs)).not.toContain(id.loin);
      for (const n of notifs) expect(n['actorUserId']).toBeNull();
      const managerNotif = notifs.find((n) => n['recipientUserId'] === fx.userIds['analyst']);
      expect(managerNotif!['href']).toBe('/rh/equipe');
      expect(managerNotif!['title']).toContain('Fin de contrat');
      expect(
        await db.collection('hr_reminder_claims').countDocuments({ organizationId: fx.orgN }),
      ).toBe(3);
    });
  });

  describe('tâche hr.retention', () => {
    it('éteinte par défaut : ne fait rien', async () => {
      const job = fx.app.get(HrRetentionJob);
      const report = await job.run(dix);
      expect(report).toEqual({ organizations: 0, purged: 0, anonymized: 0 });
      expect(
        await db.collection('hr_employee_private').countDocuments({ employeeId: id.ancien }),
      ).toBe(1);
      const settings = ok(await fx.get('hr_manager', '/hr/settings'));
      expect(settings['retention']).toEqual({
        privateDataMonthsAfterExit: null,
        anonymizeYearsAfterExit: null,
      });
    });

    it('réglée par l’organisation : purge les données sensibles de l’ancien salarié seulement', async () => {
      await db
        .collection('hr_settings')
        .updateOne(
          { organizationId: fx.orgN },
          { $set: { retention: { privateDataMonthsAfterExit: 1, anonymizeYearsAfterExit: null } } },
          { upsert: true },
        );
      const job = fx.app.get(HrRetentionJob);
      const report = await job.run(dix);
      expect(report).toEqual({ organizations: 1, purged: 1, anonymized: 0 });
      expect(
        await db.collection('hr_employee_private').countDocuments({ employeeId: id.ancien }),
      ).toBe(0);
      // Les salariés actifs gardent leurs données ; l'ancien n'est pas anonymisé.
      expect(
        await db.collection('hr_employee_private').countDocuments({ employeeId: id.passeport }),
      ).toBe(1);
      const ancien = await db.collection('hr_employees').findOne({ _id: new ObjectId(id.ancien) });
      expect(ancien!['status']).toBe('exited');
      expect(
        await db
          .collection('audit_events')
          .countDocuments({ action: 'hr.retention.private_purged', targetId: id.ancien }),
      ).toBe(1);
      // Rejouée : plus rien à purger.
      expect(await job.run(dix)).toEqual({ organizations: 1, purged: 0, anonymized: 0 });
    });
  });
});
