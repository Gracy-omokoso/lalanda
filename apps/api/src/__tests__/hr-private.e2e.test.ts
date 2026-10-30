// Données sensibles du personnel contre la vraie application (ADR-0045 § 2.4 ;
// critères 1, 6, 7, 20). ADR-0045 — H2.
//
// Couvre : chiffrement (ni IBAN ni numéro de passeport dans le document Mongo, les
// réponses de liste et de fiche, le journal d'audit, les notifications), formes
// masquées, écriture réservée à `hr.manage` + `hr.sensitive.read`, lecture en clair
// (`reveal`) par le Responsable RH ou par le salarié lui-même, journalisée AVANT la
// réponse (audit en échec ⇒ 503, rien de révélé), 30 lectures par heure au plus
// (429), chiffré recopié vers une autre fiche indéchiffrable, alerte et bandeau de
// changement bancaire, refus de l'Administrateur, du manager, du Comptable, d'une
// autre organisation et de la plateforme.
//
// Coordonnées et pièces inventées.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../authz/audit.service.js';
import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';

vi.setConfig({ testTimeout: 180_000 });

const COMPTE = `00011${tag.replace(/[a-f]/g, '7')}94521`;
const IBAN = `CD08${COMPTE}`;
const PASSEPORT = `OP${tag.replace(/[a-f]/g, '4')}77`;
const SALAIRE = '987654.00';
const NOUVEAU_COMPTE = `99911${tag.replace(/[a-f]/g, '3')}12345`;

e2eSuite('RH — données sensibles (ADR-0045 H2)', () => {
  let fx: HrFixture;
  let db: Db;
  /** B : fiche reliée au Lecteur ; A : son manager (Analyste) ; S : fiche sans compte. */
  const id = { A: '', B: '', S: '' };
  const privatePath = (e: string, suffix = '') => `/hr/employees/${e}/private${suffix}`;
  const privRev = async (e: string) =>
    ((await db.collection('hr_employee_private').findOne({ employeeId: e }))?.['revision'] ??
      0) as number;

  const banque = (accountNumber: string) => ({
    accounts: [
      {
        kind: 'bank',
        bankName: 'Rawbank',
        holderName: 'Bea Mbuyi',
        accountNumber,
        iban: `CD08${accountNumber}`,
        swift: 'RAWBCDKI',
      },
    ],
  });
  const identite = {
    birthDate: '1990-05-01',
    nationality: 'congolaise',
    idDocuments: [{ kind: 'passport', number: PASSEPORT, expiresOn: '2027-01-15' }],
  };

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-sensible');
    db = fx.db;
    const res = ok(
      await fx.post('owner', '/hr/employees/from-members', {
        userIds: [fx.userIds['analyst'], fx.userIds['viewer']],
      }),
      201,
    );
    const byUser = (u: string) =>
      res['items'].find((e: { userId: string }) => e.userId === u)['id'] as string;
    id.A = byUser(fx.userIds['analyst']);
    id.B = byUser(fx.userIds['viewer']);
    const b = await db.collection('hr_employees').findOne({ _id: new ObjectId(id.B) });
    ok(
      await fx.put('owner', `/hr/employees/${id.B}`, {
        expectedRevision: b!['revision'],
        managerEmployeeId: id.A,
      }),
    );
    id.S = ok(await fx.post('owner', '/hr/employees', fiche(`Chauffeur ${tag}`)), 201)['id'];
  }, 300_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  describe('écriture et chiffrement', () => {
    it('chiffrées en base, masquées partout, jamais au journal ni dans les notifications', async () => {
      const avantNotifs = await db
        .collection('notifications')
        .countDocuments({ organizationId: fx.orgN, kind: 'hr.bank_details_changed' });
      const s1 = ok(
        await fx.put('hr_manager', privatePath(id.B, '/bankDetails'), {
          expectedRevision: 0,
          data: banque(COMPTE),
        }),
      );
      expect(s1['bankDetails']['accounts']).toEqual([
        {
          kind: 'bank',
          masked: `Rawbank •••• ${COMPTE.slice(-4)}`,
          fingerprint: expect.any(String),
        },
      ]);
      expect(s1['bankDetailsAlert']).toMatchObject({ changedBy: fx.userIds['hr_manager'] });
      const s2 = ok(
        await fx.put('hr_manager', privatePath(id.B, '/identity'), {
          expectedRevision: 1,
          data: identite,
        }),
      );
      expect(s2['identity']['idDocuments']).toEqual([
        { kind: 'passport', expiresOn: '2027-01-15' },
      ]);
      const s3 = ok(
        await fx.put('hr_manager', privatePath(id.B, '/compensation'), {
          expectedRevision: 2,
          data: {
            history: [
              { effectiveFrom: '2026-01-01', amount: SALAIRE, currency: 'CDF', period: 'month' },
            ],
          },
        }),
      );
      expect(s3['compensation']).toMatchObject({ since: '2026-01-01', entries: 1 });
      expect(s3['revision']).toBe(3);
      // Révision périmée.
      code(
        await fx.put('hr_manager', privatePath(id.B, '/exitNote'), {
          expectedRevision: 1,
          data: { note: 'x' },
        }),
        409,
        'STALE_REVISION',
      );

      const secrets = [COMPTE, IBAN, PASSEPORT, SALAIRE, '987654', '1990-05-01'];
      const sansClair = (texte: string, ou: string) => {
        for (const s of secrets) expect(texte, `${ou} contient ${s}`).not.toContain(s);
      };
      // Le document Mongo…
      const brut = await db.collection('hr_employee_private').findOne({ employeeId: id.B });
      sansClair(JSON.stringify(brut), 'hr_employee_private');
      expect(brut!['bankDetails']['cipher']).toMatchObject({
        alg: 'aes-256-gcm',
        keyId: 'k1',
        last4: null,
      });
      expect(brut!['idExpiries']).toEqual([{ kind: 'passport', expiresOn: '2027-01-15' }]);
      // … la fiche, la liste, « moi », l'équipe, l'organigramme…
      for (const [c, path] of [
        ['owner', '/hr/employees?status=all'],
        ['owner', `/hr/employees/${id.B}`],
        ['viewer', '/hr/me'],
        ['analyst', '/hr/team'],
        ['owner', '/hr/org-chart?view=reporting'],
        ['hr_manager', privatePath(id.B)],
      ] as const) {
        const res = ok(await fx.get(c, path));
        sansClair(JSON.stringify(res), path);
        expect(JSON.stringify(res)).not.toContain('ciphertext');
      }
      // … le journal d'audit (avant et après masqués)…
      const journal = await db
        .collection('audit_events')
        .find({ organizationId: fx.orgN, targetId: id.B })
        .toArray();
      expect(journal.filter((e) => e['action'] === 'hr.private.changed')).toHaveLength(3);
      sansClair(JSON.stringify(journal), 'audit_events');
      // … et les notifications.
      const notifs = await db
        .collection('notifications')
        .find({ organizationId: fx.orgN, kind: 'hr.bank_details_changed' })
        .toArray();
      expect(notifs.length).toBeGreaterThan(avantNotifs);
      sansClair(JSON.stringify(notifs), 'notifications');
    });

    it('changer les coordonnées bancaires notifie le salarié et les détenteurs du sensible, sauf l’auteur', async () => {
      const avant = await db
        .collection('notifications')
        .countDocuments({ organizationId: fx.orgN, kind: 'hr.bank_details_changed' });
      ok(
        await fx.put('finance_director', privatePath(id.B, '/bankDetails'), {
          expectedRevision: await privRev(id.B),
          data: banque(NOUVEAU_COMPTE),
        }),
      );
      const nouvelles = (
        await db
          .collection('notifications')
          .find({ organizationId: fx.orgN, kind: 'hr.bank_details_changed' })
          .toArray()
      ).slice(avant);
      const destinataires = new Set(nouvelles.map((n) => n['recipientUserId']));
      expect(destinataires.has(fx.userIds['viewer'])).toBe(true);
      expect(destinataires.has(fx.userIds['owner'])).toBe(true);
      expect(destinataires.has(fx.userIds['hr_manager'])).toBe(true);
      expect(destinataires.has(fx.userIds['finance_director'])).toBe(false);
      expect(destinataires.has(fx.userIds['admin'])).toBe(false);
      expect(destinataires.has(fx.userIds['analyst'])).toBe(false);
      expect(JSON.stringify(nouvelles)).not.toContain(NOUVEAU_COMPTE);
      // Bandeau de sept jours sur la fiche, pour qui lit le sensible.
      const vue = ok(await fx.get('owner', `/hr/employees/${id.B}`));
      expect(vue['private']['bankDetailsAlert']).toMatchObject({
        changedBy: fx.userIds['finance_director'],
      });
    });

    it('écriture : Administrateur, Comptable, salarié refusés ; une autre organisation 404', async () => {
      const corps = { expectedRevision: await privRev(id.B), data: null };
      const admin = await fx.put('admin', privatePath(id.B, '/identity'), corps);
      expect(admin.status).toBe(403);
      expect(admin.body).toMatchObject({ code: 'FORBIDDEN', action: 'hr.sensitive.read' });
      for (const c of ['accountant', 'viewer', 'analyst'] as const) {
        expect((await fx.put(c, privatePath(id.B, '/identity'), corps)).status, c).toBe(403);
      }
      code(
        await fx.put('ownerB', privatePath(id.B, '/identity'), corps),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      expect((await fx.put('owner', privatePath(id.B, '/salaire'), corps)).status).toBe(400);
    });
  });

  describe('lecture en clair', () => {
    it('Responsable RH : clair des sections demandées, audit strict sans valeur', async () => {
      const avant = await db
        .collection('audit_events')
        .countDocuments({ organizationId: fx.orgN, action: 'hr.private.revealed' });
      const clair = ok(
        await fx.post('hr_manager', privatePath(id.B, '/reveal'), {
          sections: ['bankDetails', 'identity', 'personalContact'],
        }),
      );
      expect(clair['sections']['bankDetails']['accounts'][0]).toMatchObject({
        accountNumber: NOUVEAU_COMPTE,
      });
      expect(clair['sections']['identity']['idDocuments'][0]['number']).toBe(PASSEPORT);
      expect(clair['sections']['personalContact']).toBeNull();
      expect(clair['sections']).not.toHaveProperty('compensation');
      const traces = await db
        .collection('audit_events')
        .find({ organizationId: fx.orgN, action: 'hr.private.revealed' })
        .toArray();
      expect(traces).toHaveLength(avant + 1);
      expect(traces[traces.length - 1]).toMatchObject({
        actorUserId: fx.userIds['hr_manager'],
        targetId: id.B,
        metadata: { sections: ['bankDetails', 'identity', 'personalContact'], self: false },
      });
      expect(JSON.stringify(traces)).not.toContain(PASSEPORT);
      expect(JSON.stringify(traces)).not.toContain(NOUVEAU_COMPTE);
    });

    it('le salarié lit ses propres données ; ni son manager, ni l’Administrateur, ni un tiers', async () => {
      const soi = ok(await fx.get('viewer', privatePath(id.B)));
      expect(soi['identity']['idDocuments']).toEqual([
        { kind: 'passport', expiresOn: '2027-01-15' },
      ]);
      const clair = ok(
        await fx.post('viewer', privatePath(id.B, '/reveal'), { sections: ['compensation'] }),
      );
      expect(clair['sections']['compensation']['history'][0]['amount']).toBe(SALAIRE);
      const trace = await db
        .collection('audit_events')
        .find({ actorUserId: fx.userIds['viewer'], action: 'hr.private.revealed' })
        .toArray();
      expect(trace.at(-1)!['metadata']).toMatchObject({ self: true });

      // Manager (voit la fiche) et Administrateur (`hr.read`) : 403.
      for (const c of ['analyst', 'admin'] as const) {
        const r = await fx.post(c, privatePath(id.B, '/reveal'), { sections: ['identity'] });
        expect(r.status, c).toBe(403);
        expect(r.body.action).toBe('hr.sensitive.read');
        expect(JSON.stringify(r.body)).not.toContain(PASSEPORT);
        expect((await fx.get(c, privatePath(id.B))).status, c).toBe(403);
      }
      // Le salarié ne lit pas celles de son manager ; Comptable et Conseiller : hors portée.
      code(
        await fx.post('viewer', privatePath(id.A, '/reveal'), { sections: ['identity'] }),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      for (const c of ['accountant', 'advisor', 'sales_rep'] as const) {
        code(
          await fx.post(c, privatePath(id.B, '/reveal'), { sections: ['identity'] }),
          404,
          'EMPLOYEE_NOT_FOUND',
        );
      }
      // Autre organisation et plateforme : 404.
      code(
        await fx.post('ownerB', privatePath(id.B, '/reveal'), { sections: ['identity'] }),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      code(
        await fx.post('superAdmin', privatePath(id.B, '/reveal'), { sections: ['identity'] }),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      // Fiche sans compte : rien à lire pour soi, mais lisible par les RH (vide).
      expect(
        ok(await fx.post('owner', privatePath(id.S, '/reveal'), { sections: ['identity'] }))[
          'sections'
        ],
      ).toEqual({ identity: null });
    });

    it('audit en échec : 503 et rien de révélé', async () => {
      const audit = fx.app.get(AuditService);
      const spy = vi
        .spyOn(audit, 'recordStrict')
        .mockRejectedValueOnce(new Error('journal indisponible'));
      try {
        const res = await fx.post('hr_manager', privatePath(id.B, '/reveal'), {
          sections: ['identity', 'bankDetails'],
        });
        code(res, 503, 'HR_AUDIT_UNAVAILABLE');
        expect(JSON.stringify(res.body)).not.toContain(PASSEPORT);
        expect(JSON.stringify(res.body)).not.toContain(NOUVEAU_COMPTE);
      } finally {
        spy.mockRestore();
      }
    });

    it('un chiffré recopié vers une autre fiche ne se déchiffre pas', async () => {
      const source = await db.collection('hr_employee_private').findOne({ employeeId: id.B });
      await db.collection('hr_employee_private').insertOne({
        organizationId: fx.orgN,
        employeeId: id.S,
        identity: source!['identity'],
        compensation: null,
        bankDetails: null,
        personalContact: null,
        exitNote: null,
        idExpiries: [],
        revision: 1,
        createdBy: 'test',
        updatedBy: 'test',
        _schemaVersion: 1,
      });
      const res = await fx.post('owner', privatePath(id.S, '/reveal'), { sections: ['identity'] });
      code(res, 500, 'HR_PRIVATE_UNREADABLE');
      expect(JSON.stringify(res.body)).not.toContain(PASSEPORT);
    });

    it('au plus 30 lectures en clair par heure et par utilisateur : la 31e rend 429', async () => {
      const deja = await db.collection('audit_events').countDocuments({
        actorUserId: fx.userIds['finance_director'],
        action: 'hr.private.revealed',
        createdAt: { $gte: new Date(Date.now() - 3_600_000) },
      });
      for (let i = deja; i < 30; i += 1) {
        fx.clearThrottle();
        ok(
          await fx.post('finance_director', privatePath(id.B, '/reveal'), {
            sections: ['personalContact'],
          }),
        );
      }
      fx.clearThrottle();
      const trop = await fx.post('finance_director', privatePath(id.B, '/reveal'), {
        sections: ['identity'],
      });
      code(trop, 429, 'HR_REVEAL_RATE_LIMITED');
      expect(JSON.stringify(trop.body)).not.toContain(PASSEPORT);
      expect(
        await db.collection('audit_events').countDocuments({
          actorUserId: fx.userIds['finance_director'],
          action: 'hr.private.revealed',
        }),
      ).toBe(30);
      // Le débit est propre à chaque utilisateur.
      ok(await fx.post('hr_manager', privatePath(id.B, '/reveal'), { sections: ['identity'] }));
    });
  });

  describe('anonymisation', () => {
    it('efface le dossier sensible d’un collaborateur sorti', async () => {
      const e = ok(await fx.post('owner', '/hr/employees', fiche(`Ancien ${tag}`)), 201);
      ok(
        await fx.put('owner', privatePath(e['id'], '/identity'), {
          expectedRevision: 0,
          data: identite,
        }),
      );
      ok(
        await fx.post('owner', `/hr/employees/${e['id']}/exit`, {
          endDate: '2026-02-01',
          exitCategory: 'other',
          expectedRevision: 1,
        }),
      );
      ok(
        await fx.post('owner', `/hr/employees/${e['id']}/anonymize`, {
          confirm: true,
          expectedRevision: 2,
        }),
      );
      expect(
        await db.collection('hr_employee_private').countDocuments({ employeeId: e['id'] }),
      ).toBe(0);
      code(
        await fx.post('owner', privatePath(e['id'], '/reveal'), { sections: ['identity'] }),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      code(
        await fx.put('owner', privatePath(e['id'], '/identity'), {
          expectedRevision: 0,
          data: identite,
        }),
        409,
        'EMPLOYEE_ANONYMIZED',
      );
    });
  });
});
