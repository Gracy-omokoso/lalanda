// RH lot 1 contre la vraie application (ADR-0068 ; critères 1 à 9).
//
// Couvre : réglage des matricules, attribution automatique, numéro manuel compatible
// qui fait repartir le compteur, verrou du matricule, correction par le droit RH
// administrateur (motif, audit strict), réservation gardée à l'anonymisation ;
// postes (nouveau, sortie = vacant, remplacement poste pour poste, refus d'un poste
// pourvu, numéro jamais réutilisé) ; « Inviter sur Lalanda » (membre relié, adresse
// inconnue ET compte d'une autre organisation : même réponse, liaison à
// l'acceptation, sans `members.invite` rien ne part, renvoyer, annuler) ; import CSV ;
// jours fériés de la RDC proposés ; isolation entre organisations. Aucun courriel réel :
// sans `ZEPTOMAIL_TOKEN` ni `SMTP_HOST`, le transport n'envoie rien.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';
delete process.env['ZEPTOMAIL_TOKEN'];
delete process.env['SMTP_HOST'];

vi.setConfig({ testTimeout: 600_000, hookTimeout: 1_200_000 });

const PREFIX = 'rh-lot1';
const emailOf = (c: string) => `${PREFIX}-${c}-${tag}@lalanda-test.local`;

e2eSuite('RH lot 1 — invitation, matricules, postes, import, fériés (ADR-0068)', () => {
  let fx: HrFixture;
  let db: Db;
  const rev = async (employeeId: string) =>
    (await db.collection('hr_employees').findOne({ _id: new ObjectId(employeeId) }))![
      'revision'
    ] as number;
  const upload = (path: string, body: Buffer) =>
    request(fx.app.getHttpServer())
      .post(path)
      .set('Cookie', fx.as('owner'))
      .set('content-type', 'application/octet-stream')
      .set('x-file-name', 'personnel.csv')
      .send(body);

  beforeAll(async () => {
    fx = await hrFixture(tag, PREFIX);
    db = fx.db;
  }, 1_200_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  describe('matricules', () => {
    it('réglage, attribution automatique, manuel compatible, verrou, correction tracée', async () => {
      const d = ok(await fx.get('hr_manager', '/hr/settings/numbering'));
      expect(d).toMatchObject({ configuredPrefix: null, width: 4, revision: 0 });
      expect(d['prefix']).toMatch(/^[A-Z0-9]+-$/);
      code(
        await fx.put('analyst', '/hr/settings/numbering', {
          expectedRevision: 0,
          prefix: 'GF-',
          width: 4,
        }),
        403,
        'FORBIDDEN',
      );
      const s = ok(
        await fx.put('hr_manager', '/hr/settings/numbering', {
          expectedRevision: 0,
          prefix: 'gf-',
          width: 4,
        }),
      );
      expect(s).toMatchObject({ prefix: 'GF-', configuredPrefix: 'GF-', nextNumber: 'GF-0001' });
      // Les réglages RH gardent leur propre révision.
      expect(ok(await fx.get('hr_manager', '/hr/settings'))['revision']).toBe(0);

      const a = ok(await fx.post('hr_manager', '/hr/employees', fiche('Auto un')), 201);
      const b = ok(await fx.post('hr_manager', '/hr/employees', fiche('Auto deux')), 201);
      expect([a['employeeNumber'], b['employeeNumber']]).toEqual(['GF-0001', 'GF-0002']);
      expect(a['invitation']).toBeNull();
      const m = ok(
        await fx.post(
          'hr_manager',
          '/hr/employees',
          fiche('Manuel', { employeeNumber: 'GF-0050' }),
        ),
        201,
      );
      expect(m['employeeNumber']).toBe('GF-0050');
      ok(
        await fx.post(
          'hr_manager',
          '/hr/employees',
          fiche('Autre format', { employeeNumber: 'AB-7' }),
        ),
        201,
      );
      const c = ok(await fx.post('hr_manager', '/hr/employees', fiche('Auto trois')), 201);
      expect(c['employeeNumber']).toBe('GF-0051');

      // Verrou : la modification ordinaire ne change plus un matricule posé.
      code(
        await fx.put('hr_manager', `/hr/employees/${a['id']}`, {
          expectedRevision: a['revision'],
          employeeNumber: 'GF-0999',
        }),
        409,
        'EMPLOYEE_NUMBER_LOCKED',
      );
      // Le même numéro renvoyé n'est pas un changement.
      ok(
        await fx.put('hr_manager', `/hr/employees/${a['id']}`, {
          expectedRevision: a['revision'],
          employeeNumber: 'gf 0001',
          workLocation: 'Gombe',
        }),
      );
      // Correction : droit RH administrateur (`hr.sensitive.read` + `hr.manage`) et motif.
      const body = {
        expectedRevision: await rev(a['id']),
        employeeNumber: 'GF-0007',
        reason: 'Erreur de saisie',
      };
      code(
        await fx.put('admin', `/hr/employees/${a['id']}/employee-number`, body),
        403,
        'FORBIDDEN',
      );
      code(
        await fx.put('hr_manager', `/hr/employees/${a['id']}/employee-number`, {
          ...body,
          reason: '',
        }),
        400,
        'INVALID_REQUEST',
      );
      const fixed = ok(
        await fx.put('hr_manager', `/hr/employees/${a['id']}/employee-number`, body),
      );
      expect(fixed['employeeNumber']).toBe('GF-0007');
      const trace = await db.collection('audit_events').findOne({
        organizationId: fx.orgN,
        action: 'hr.employee.number_changed',
        targetId: a['id'],
      });
      expect(trace?.['metadata']).toMatchObject({
        before: 'GF-0001',
        after: 'GF-0007',
        reason: 'Erreur de saisie',
      });
    });

    it('jamais réutilisé : l’anonymisation garde la réservation', async () => {
      const e = ok(
        await fx.post('hr_manager', '/hr/employees', fiche('Partant', { startDate: '2025-01-06' })),
        201,
      );
      const num = e['employeeNumber'] as string;
      ok(
        await fx.post('hr_manager', `/hr/employees/${e['id']}/exit`, {
          endDate: '2026-02-01',
          exitCategory: 'resignation',
          expectedRevision: e['revision'],
        }),
      );
      const anon = ok(
        await fx.post('hr_manager', `/hr/employees/${e['id']}/anonymize`, {
          confirm: true,
          expectedRevision: await rev(e['id']),
        }),
      );
      expect(anon['employeeNumber']).toBeNull();
      code(
        await fx.post('hr_manager', '/hr/employees', fiche('Reprise', { employeeNumber: num })),
        409,
        'EMPLOYEE_NUMBER_EXISTS',
      );
      const next = ok(await fx.post('hr_manager', '/hr/employees', fiche('Suivant')), 201);
      expect(next['employeeNumber']).not.toBe(num);
      // Ancienne fiche sans matricule : attribution automatique, une seule fois.
      const legacy = await db.collection('hr_employees').insertOne({
        organizationId: fx.orgN,
        firstName: 'Ancien',
        lastName: 'Sans numéro',
        preferredName: null,
        sortName: 'sans numero ancien',
        searchKey: 'ancien sans numero',
        employeeNumber: null,
        employeeNumberKey: null,
        userId: null,
        workEmail: null,
        workPhone: null,
        jobTitle: 'Agent',
        departmentId: null,
        managerEmployeeId: null,
        contractType: 'permanent',
        startDate: '2024-01-01',
        status: 'active',
        revision: 1,
        createdBy: 'x',
        updatedBy: 'x',
        _schemaVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const lid = String(legacy.insertedId);
      const auto = ok(
        await fx.post('hr_manager', `/hr/employees/${lid}/employee-number/auto`, {
          expectedRevision: 1,
        }),
      );
      expect(auto['employeeNumber']).toMatch(/^GF-\d{4}$/);
      expect(auto['positionId']).toBeNull();
      code(
        await fx.post('hr_manager', `/hr/employees/${lid}/employee-number/auto`, {
          expectedRevision: 2,
        }),
        409,
        'EMPLOYEE_NUMBER_LOCKED',
      );
    });
  });

  describe('postes', () => {
    it('nouveau poste, sortie = vacant, remplacement poste pour poste, numéro jamais réutilisé', async () => {
      const titulaire = ok(
        await fx.post(
          'hr_manager',
          '/hr/employees',
          fiche('Titulaire', {
            jobTitle: 'Chauffeur',
            startDate: '2025-03-03',
            position: { mode: 'new' },
          }),
        ),
        201,
      );
      expect(titulaire['positionNumber']).toBe('POS-001');
      const posId = titulaire['positionId'] as string;
      expect(ok(await fx.get('hr_manager', `/hr/positions/${posId}`))).toMatchObject({
        status: 'filled',
        title: 'Chauffeur',
        holderEmployeeId: titulaire['id'],
      });
      // Un poste pourvu ne se choisit pas, ne se supprime pas.
      code(
        await fx.post(
          'hr_manager',
          '/hr/employees',
          fiche('Trop tôt', { position: { mode: 'replacement', positionId: posId } }),
        ),
        409,
        'POSITION_NOT_OPEN',
      );
      const p = ok(await fx.get('hr_manager', `/hr/positions/${posId}`));
      code(
        await fx.post('hr_manager', `/hr/positions/${posId}/delete`, {
          expectedRevision: p['revision'],
        }),
        409,
        'POSITION_FILLED',
      );
      ok(
        await fx.post('hr_manager', `/hr/employees/${titulaire['id']}/exit`, {
          endDate: '2026-10-31',
          exitCategory: 'end_of_contract',
          expectedRevision: titulaire['revision'],
        }),
      );
      const vacant = ok(await fx.get('hr_manager', `/hr/positions/${posId}`));
      expect(vacant).toMatchObject({ status: 'open', holderEmployeeId: null });
      expect(vacant['holders']).toEqual([
        expect.objectContaining({
          employeeId: titulaire['id'],
          from: '2025-03-03',
          to: '2026-10-31',
        }),
      ]);
      const remplacant = ok(
        await fx.post(
          'hr_manager',
          '/hr/employees',
          fiche('Remplaçant', {
            jobTitle: 'Chauffeur',
            startDate: '2026-11-02',
            position: { mode: 'replacement', positionId: posId },
          }),
        ),
        201,
      );
      expect(remplacant['positionNumber']).toBe('POS-001');
      expect(remplacant['employeeNumber']).not.toBe(titulaire['employeeNumber']);
      expect(ok(await fx.get('hr_manager', `/hr/positions/${posId}`))['holders']).toHaveLength(2);

      // Poste créé vacant puis supprimé : son numéro reste pris.
      const libre = ok(await fx.post('hr_manager', '/hr/positions', { title: 'Hôtesse' }), 201);
      expect(libre['positionNumber']).toBe('POS-002');
      ok(
        await fx.post('hr_manager', `/hr/positions/${libre['id']}/delete`, { expectedRevision: 1 }),
      );
      const suivant = ok(await fx.post('hr_manager', '/hr/positions', { title: 'Agent' }), 201);
      expect(suivant['positionNumber']).toBe('POS-003');
      const liste = ok(await fx.get('hr_manager', '/hr/positions'));
      expect(liste['items'].map((x: { positionNumber: string }) => x.positionNumber)).toEqual([
        'POS-001',
        'POS-003',
      ]);
      // Droits et isolation.
      code(await fx.post('analyst', '/hr/positions', { title: 'X' }), 403, 'FORBIDDEN');
      code(await fx.get('ownerB', `/hr/positions/${posId}`), 404, 'POSITION_NOT_FOUND');
      // Fiche existante sans poste : on lui en donne un.
      const sans = ok(await fx.post('hr_manager', '/hr/employees', fiche('Sans poste')), 201);
      const avec = ok(
        await fx.put('hr_manager', `/hr/employees/${sans['id']}`, {
          expectedRevision: sans['revision'],
          position: { mode: 'replacement', positionId: suivant['id'] },
        }),
      );
      expect(avec['positionNumber']).toBe('POS-003');
    });
  });

  describe('Inviter sur Lalanda', () => {
    it('(a) membre de l’organisation : relié tout de suite, sans invitation', async () => {
      const e = ok(
        await fx.post(
          'owner',
          '/hr/employees',
          fiche('Analyste', { workEmail: emailOf('analyst'), invite: true }),
        ),
        201,
      );
      expect(e['invitation']).toEqual({ outcome: 'linked', emailDelivered: null });
      expect(e['userId']).toBe(fx.userIds['analyst']);
      expect(
        await db
          .collection('invitations')
          .countDocuments({ organizationId: fx.orgN, employeeId: e['id'] }),
      ).toBe(0);
      expect(ok(await fx.get('hr_manager', `/hr/employees/${e['id']}/account`))['state']).toBe(
        'linked',
      );
    });

    it('(b) inconnu et compte d’une autre organisation : même réponse, relié à l’acceptation', async () => {
      const inconnu = ok(
        await fx.post(
          'owner',
          '/hr/employees',
          fiche('Inconnu', { workEmail: `nouveau-${tag}@lalanda-test.local`, invite: true }),
        ),
        201,
      );
      const ailleurs = ok(
        await fx.post(
          'owner',
          '/hr/employees',
          fiche('Ailleurs', { workEmail: emailOf('ownerB'), invite: true }),
        ),
        201,
      );
      // Non-énumération : réponses identiques ; aucun lien sans acceptation.
      expect(inconnu['invitation']).toEqual(ailleurs['invitation']);
      expect(ailleurs['invitation']).toEqual({ outcome: 'invitation_sent', emailDelivered: false });
      expect(ailleurs['userId']).toBeNull();
      const inv = await db
        .collection('invitations')
        .findOne({ organizationId: fx.orgN, employeeId: ailleurs['id'], revokedAt: null });
      expect(inv).toMatchObject({
        email: emailOf('ownerB').toLowerCase(),
        role: 'employee',
        acceptedAt: null,
      });
      const account = ok(await fx.get('hr_manager', `/hr/employees/${ailleurs['id']}/account`));
      expect(account).toMatchObject({ state: 'invitation_pending', userId: null });
      expect(account['invitation']['email']).toBe(emailOf('ownerB').toLowerCase());
      expect(JSON.stringify(account)).not.toContain(String(inv!['token']));

      // Acceptation par le titulaire de l'adresse : la fiche est reliée.
      const acc = await request(fx.app.getHttpServer())
        .post('/invitations/accept')
        .set('Cookie', fx.as('ownerB'))
        .send({ token: inv!['token'] });
      expect(acc.status, JSON.stringify(acc.body)).toBe(201);
      const linked = await db
        .collection('hr_employees')
        .findOne({ _id: new ObjectId(ailleurs['id']) });
      expect(linked?.['userId']).toBe(fx.userIds['ownerB']);
      // Aucune fiche de l'autre organisation n'est touchée.
      expect(
        await db
          .collection('hr_employees')
          .countDocuments({ organizationId: fx.orgB, userId: fx.userIds['ownerB'] }),
      ).toBe(0);
    });

    it('sans `members.invite` : fiche créée, rien n’est envoyé', async () => {
      const e = ok(
        await fx.post(
          'hr_manager',
          '/hr/employees',
          fiche('Sans droit', { workEmail: `sansdroit-${tag}@lalanda-test.local`, invite: true }),
        ),
        201,
      );
      expect(e['invitation']).toEqual({ outcome: 'not_sent_permission', emailDelivered: null });
      expect(
        await db
          .collection('invitations')
          .countDocuments({ organizationId: fx.orgN, employeeId: e['id'] }),
      ).toBe(0);
      code(await fx.post('hr_manager', `/hr/employees/${e['id']}/invitation`), 403, 'FORBIDDEN');
      // Un détenteur de `members.invite` l'invite depuis la fiche, puis renvoie, puis annule.
      const sent = ok(await fx.post('owner', `/hr/employees/${e['id']}/invitation`));
      expect(sent).toEqual({ outcome: 'invitation_sent', emailDelivered: false });
      const first = await db
        .collection('invitations')
        .findOne({ organizationId: fx.orgN, employeeId: e['id'], revokedAt: null });
      const again = ok(await fx.post('owner', `/hr/employees/${e['id']}/invitation`));
      expect(again['outcome']).toBe('invitation_pending');
      ok(await fx.post('owner', `/hr/employees/${e['id']}/invitation/resend`));
      const after = await db
        .collection('invitations')
        .find({ organizationId: fx.orgN, employeeId: e['id'] })
        .toArray();
      expect(after).toHaveLength(2);
      expect(
        after.find((i) => String(i['_id']) === String(first!['_id']))?.['revokedAt'],
      ).not.toBeNull();
      const res = await fx.post('owner', `/hr/employees/${e['id']}/invitation/cancel`);
      expect(res.status).toBe(204);
      expect(ok(await fx.get('hr_manager', `/hr/employees/${e['id']}/account`))['state']).toBe(
        'none',
      );
      code(
        await fx.post('owner', `/hr/employees/${e['id']}/invitation/cancel`),
        404,
        'INVITATION_NOT_FOUND',
      );
      // Isolation : fiche d'une autre organisation → 404.
      code(await fx.get('ownerB', `/hr/employees/${e['id']}/account`), 404, 'EMPLOYEE_NOT_FOUND');
    });

    it('sans e-mail : rien n’est envoyé', async () => {
      const e = ok(
        await fx.post('owner', '/hr/employees', fiche('Sans adresse', { invite: true })),
        201,
      );
      expect(e['invitation']['outcome']).toBe('not_sent_no_email');
    });
  });

  describe('import du personnel', () => {
    it('aperçu ligne par ligne, matricules conservés, lignes valides seules sur confirmation', async () => {
      const tpl = await request(fx.app.getHttpServer())
        .get('/hr/employees/import/template.csv')
        .set('Cookie', fx.as('hr_manager'));
      expect(tpl.status).toBe(200);
      expect(tpl.text).toContain('Matricule;Nom;Prénom;Poste');
      const csv = Buffer.from(
        [
          '﻿Matricule;Nom;Prénom;Poste;Service;Type de contrat;Date d’entrée;E-mail professionnel',
          'GF-0200;Kabeya;Jean;Comptable;Finances;CDI;02/03/2020;',
          ';Ilunga;Marie;Assistante;;;15/09/2022;',
          ';;Sans nom;Agent;;;01/01/2021;',
          'GF-0200;Doublon;Paul;Agent;;;01/01/2021;',
          `;Tshala;Ruth;Hôtesse;;;2023-04-10;import-${tag}@lalanda-test.local`,
        ].join('\r\n'),
        'utf8',
      );
      const preview = await upload('/hr/employees/import/preview', csv);
      const p = ok(preview);
      expect(p['counts']).toMatchObject({ total: 5, valid: 3, invalid: 2, warnings: 1 });
      expect(p['rows'][0]['issues'][0]).toMatchObject({ level: 'warning', field: 'department' });
      expect(p['rows'][2]['issues'].some((i: { field: string }) => i.field === 'lastName')).toBe(
        true,
      );
      expect(p['rows'][3]['issues'][0]['field']).toBe('employeeNumber');
      code(await upload('/hr/employees/import/apply', csv), 409, 'IMPORT_HAS_ERRORS');
      const applied = ok(
        await upload('/hr/employees/import/apply?skipInvalid=true&invite=true', csv),
        201,
      );
      expect(applied['skippedRows']).toEqual([4, 5]);
      expect(applied['created'].map((c: { employeeNumber: string }) => c.employeeNumber)).toEqual([
        'GF-0200',
        'GF-0201',
        'GF-0202',
      ]);
      expect(applied['created'].map((c: { invitation: string }) => c.invitation)).toEqual([
        'not_sent_no_email',
        'not_sent_no_email',
        'invitation_sent',
      ]);
      code(
        await request(fx.app.getHttpServer())
          .post('/hr/employees/import/preview')
          .set('Cookie', fx.as('analyst'))
          .set('content-type', 'application/octet-stream')
          .send(csv),
        403,
        'FORBIDDEN',
      );
    });
  });

  describe('jours fériés de la RDC proposés', () => {
    it('dix dates « à vérifier », sources citées, sans doublon, confirmables', async () => {
      const p = ok(await fx.get('hr_manager', '/hr/holidays/country/cd?year=2027'));
      expect(p['items']).toHaveLength(10);
      expect(p['source']['text']).toContain('23/042');
      ok(
        await fx.post('hr_manager', '/hr/holidays', { date: '2027-06-30', label: 'Indépendance' }),
        201,
      );
      const r1 = ok(await fx.post('hr_manager', '/hr/holidays/country/cd?year=2027'), 201);
      expect(r1).toEqual({ created: 9, alreadyPresent: 1 });
      const r2 = ok(await fx.post('hr_manager', '/hr/holidays/country/cd?year=2027'), 201);
      expect(r2).toEqual({ created: 0, alreadyPresent: 10 });
      const list = ok(await fx.get('hr_manager', '/hr/holidays?year=2027'));
      const kimbangu = list['items'].find((h: { date: string }) => h.date === '2027-04-06');
      expect(kimbangu).toMatchObject({ toVerify: true, recurring: false });
      expect(kimbangu['source']).toContain('23/042');
      expect(list['items'].find((h: { date: string }) => h.date === '2027-06-30')).toMatchObject({
        toVerify: false,
        source: null,
      });
      const v = ok(await fx.post('hr_manager', `/hr/holidays/${kimbangu['id']}/verify`));
      expect(v['toVerify']).toBe(false);
      code(
        await fx.post('ownerB', `/hr/holidays/${kimbangu['id']}/verify`),
        404,
        'HOLIDAY_NOT_FOUND',
      );
      code(await fx.get('analyst', '/hr/holidays/country/cd?year=2027'), 403, 'FORBIDDEN');
      code(await fx.get('hr_manager', '/hr/holidays/country/cd?year=2020'), 400, 'INVALID_REQUEST');
    });
  });
});
