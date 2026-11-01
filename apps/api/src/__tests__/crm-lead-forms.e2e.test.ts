// Formulaire public de prospects contre la vraie application (ADR-0048,
// critères 1 à 10).
//
// Chaîne complète : réglages sous session (cookie → AuthGuard →
// PermissionsGuard), puis routes PUBLIQUES sans cookie (jeton, champ piège,
// ticket de remplissage, limites de débit par empreinte d'IP et par
// formulaire), jusqu'à MongoDB. La chaîne de confiance du proxy de production
// (`applyTrustedProxy`) est posée pour que `X-Forwarded-For` désigne l'IP
// cliente, comme derrière Caddy.
//
// BASE DÉDIÉE, supprimée à la fin.

import 'reflect-metadata';

import { defaultLeadFormFields, LEAD_FORM_DEFAULT_CONSENT } from '@lalanda/shared/crm';
import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { mintLeadFormTicket } from '../crm/lead-forms/lead-form-crypto.js';
import { applyTrustedProxy, type ExpressSettableApp } from '../security/trusted-proxy.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_crm_leadforms_${tag}`;
// Ticket et empreinte dérivent d'`AUTH_SECRET` (obligatoire en production) ;
// le test en fournit un si l'environnement local n'en a pas.
process.env['AUTH_SECRET'] ||= `secret-e2e-formulaire-${'x'.repeat(32)}`;

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!crm-formulaire';
const ROLES = ['sales_rep', 'viewer'] as const;
type Role = 'owner' | (typeof ROLES)[number];
type Compte = Role | 'ownerB';
const POLICY = 'https://exemple.cd/confidentialite';

e2eSuite('Formulaire public de prospects (ADR-0048)', () => {
  let app: INestApplication;
  let db: Db;
  let orgN = '';
  let orgB = '';
  let ipSeq = 10;
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;
  const userIds = {} as Record<Compte, string>;

  const server = () => app.getHttpServer();
  const asN = (role: Role = 'owner') => [...cookies[role], `active_org_id=${orgN}`];
  const asB = () => [...cookies['ownerB'], `active_org_id=${orgB}`];
  const get = (c: string[], path: string) => request(server()).get(path).set('Cookie', c);
  const post = (c: string[], path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', c)
      .send(body ?? {});
  const put = (c: string[], path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', c).send(body);
  const freshIp = () => `198.51.100.${ipSeq++}`;
  const clearThrottle = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };
  const ok = (res: request.Response, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const code = (res: request.Response, status: number, expected: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code).toBe(expected);
  };
  const issueCodes = (res: request.Response) =>
    ((res.body?.details?.issues ?? []) as { code: string }[]).map((i) => i.code);

  /** Réglages complets à partir de la vue (PUT). */
  const settingsOf = (form: Record<string, any>, over: Record<string, unknown> = {}) => ({
    expectedRevision: form['revision'],
    enabled: form['enabled'],
    title: form['title'],
    intro: form['intro'] ?? '',
    fields: form['fields'],
    consentText: form['consentText'],
    privacyPolicyUrl: form['privacyPolicyUrl'] ?? '',
    successMessage: form['successMessage'],
    assigneeUserId: form['assigneeUserId'],
    createOpportunity: form['createOpportunity'],
    opportunityCurrency: form['opportunityCurrency'],
    showBranding: form['showBranding'],
    ...over,
  });

  const formOf = async (c: string[]) =>
    ok(await get(c, '/crm/lead-form')).form as Record<string, any>;

  /** Formulaire de l'organisation, créé puis activé, responsable : le Commercial. */
  async function activeForm(c: string[], assignee: string, over: Record<string, unknown> = {}) {
    let form = (await formOf(c)) ?? ok(await post(c, '/crm/lead-form', {}), 201);
    form = ok(
      await put(
        c,
        '/crm/lead-form',
        settingsOf(form, {
          enabled: true,
          privacyPolicyUrl: POLICY,
          assigneeUserId: assignee,
          ...over,
        }),
      ),
    );
    return form;
  }

  const publicGet = (token: string, ip = freshIp()) =>
    request(server()).get(`/public/lead-forms/${token}`).set('X-Forwarded-For', ip);
  const publicPost = (token: string, body: unknown, ip = freshIp()) =>
    request(server())
      .post(`/public/lead-forms/${token}/submissions`)
      .set('X-Forwarded-For', ip)
      .send(body);

  /** Ticket émis il y a 10 s (le délai minimal est dépassé sans attendre). */
  const ticketFor = (form: Record<string, any>) =>
    mintLeadFormTicket(form['id'], Date.now() - 10_000);
  const submission = (form: Record<string, any>, over: Record<string, unknown> = {}) => ({
    ticket: ticketFor(form),
    consent: true,
    name: 'Awa Mbuyi',
    email: `awa-${randomBytes(3).toString('hex')}@exemple.cd`,
    ...over,
  });

  const counts = async (org: string) => ({
    accounts: await db.collection('crm_accounts').countDocuments({ organizationId: org }),
    contacts: await db.collection('crm_contacts').countDocuments({ organizationId: org }),
    activities: await db.collection('crm_activities').countDocuments({ organizationId: org }),
    opportunities: await db.collection('crm_opportunities').countDocuments({ organizationId: org }),
    submissions: await db
      .collection('crm_lead_submissions')
      .countDocuments({ organizationId: org }),
  });

  beforeAll(async () => {
    app = await makeE2EApp();
    applyTrustedProxy(app.getHttpAdapter().getInstance() as ExpressSettableApp);
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    for (const c of ['owner', ...ROLES, 'ownerB'] as const) {
      emails[c] = `crm-formulaire-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({
      email: emails[c],
      password: MOT_DE_PASSE,
      name: `Formulaire ${c}`,
    });
    const orgDe = async (c: Compte) => {
      cookies[c] = await registerAndLogin(app, compte(c));
      const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
      return (orgs.body.organizations as { id: string }[])[0]!.id;
    };
    orgN = await orgDe('owner');
    for (const role of ROLES) {
      const inv = await request(server())
        .post(`/organizations/${orgN}/invitations`)
        .set('Cookie', cookies['owner'])
        .send({ email: emails[role], role });
      expect(inv.status, `invitation ${role} ${JSON.stringify(inv.body)}`).toBe(201);
      cookies[role] = await registerAndLogin(app, compte(role));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: inv.body.token });
      expect(acc.status).toBe(201);
    }
    orgB = await orgDe('ownerB');
    for (const m of await db.collection('memberships').find({}).toArray()) {
      const who = (Object.keys(emails) as Compte[]).find(
        (c) =>
          (c === 'ownerB' ? m['organizationId'] === orgB : m['organizationId'] === orgN) &&
          m['role'] === (c === 'ownerB' ? 'owner' : c),
      );
      if (who) userIds[who] = m['userId'] as string;
    }
    expect(Object.keys(userIds).sort()).toEqual(['owner', 'ownerB', 'sales_rep', 'viewer']);
  }, 300_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, 60_000);

  // ── Réglages et droits ───────────────────────────────────────────────────

  describe('réglages', () => {
    it('sans formulaire : `null` ; un `crm.read` sans `crm.manage` ne crée rien (403)', async () => {
      expect(await formOf(asN('viewer'))).toBeNull();
      code(await post(asN('viewer'), '/crm/lead-form', {}), 403, 'FORBIDDEN');
    });

    it('création : désactivé par défaut, jeton non devinable, six champs ; une seule fois', async () => {
      const form = ok(
        await post(asN('sales_rep'), '/crm/lead-form', { title: 'Parlons de votre projet' }),
        201,
      );
      expect(form).toMatchObject({
        enabled: false,
        title: 'Parlons de votre projet',
        consentText: LEAD_FORM_DEFAULT_CONSENT,
        privacyPolicyUrl: null,
        assigneeUserId: null,
        createOpportunity: false,
        showBranding: true,
        stats: { submissions: 0, lastSubmissionAt: null },
        revision: 1,
      });
      expect(form['token']).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(form['publicPath']).toBe(`/f/${form['token']}`);
      expect(form['fields']).toEqual(defaultLeadFormFields());
      code(await post(asN(), '/crm/lead-form', {}), 409, 'LEAD_FORM_EXISTS');
      // Désactivé : la page publique n'existe pas (critère 1).
      code(await publicGet(form['token']), 404, 'LEAD_FORM_NOT_FOUND');
      code(
        await publicPost(form['token'], { ticket: 'x', consent: true, name: 'A' }),
        404,
        'LEAD_FORM_NOT_FOUND',
      );
    });

    it('lecture sous `crm.read` ; modifier, activer, remplacer le lien : 403 sans `crm.manage`', async () => {
      const form = await formOf(asN('viewer'));
      expect(form['id']).toBeTruthy();
      code(await put(asN('viewer'), '/crm/lead-form', settingsOf(form)), 403, 'FORBIDDEN');
      code(
        await post(asN('viewer'), '/crm/lead-form/rotate-token', { expectedRevision: 1 }),
        403,
        'FORBIDDEN',
      );
    });

    it('activer exige la politique, le responsable, un responsable éligible (critère 9)', async () => {
      const form = await formOf(asN());
      const sansPolitique = await put(asN(), '/crm/lead-form', settingsOf(form, { enabled: true }));
      expect(sansPolitique.status).toBe(400);
      expect(issueCodes(sansPolitique)).toEqual(
        expect.arrayContaining(['LEAD_FORM_POLICY_REQUIRED', 'LEAD_FORM_ASSIGNEE_REQUIRED']),
      );
      const ineligible = await put(
        asN(),
        '/crm/lead-form',
        settingsOf(form, {
          enabled: true,
          privacyPolicyUrl: POLICY,
          assigneeUserId: userIds['viewer'],
        }),
      );
      expect(ineligible.status).toBe(400);
      expect(issueCodes(ineligible)).toContain('CRM_ASSIGNEE_NOT_ELIGIBLE');
      code(
        await put(asN(), '/crm/lead-form', settingsOf(form, { assigneeUserId: userIds['ownerB'] })),
        404,
        'CRM_MEMBER_NOT_FOUND',
      );
      const champs = await put(
        asN(),
        '/crm/lead-form',
        settingsOf(form, {
          fields: (form['fields'] as any[]).map((f) =>
            f.key === 'email' ? { ...f, required: false } : f,
          ),
        }),
      );
      expect(issueCodes(champs)).toContain('LEAD_FORM_CONTACT_REQUIRED');
      code(
        await put(asN(), '/crm/lead-form', settingsOf(form, { expectedRevision: 99 })),
        409,
        'STALE_REVISION',
      );
    });
  });

  // ── Page publique ────────────────────────────────────────────────────────

  describe('page publique', () => {
    it('active : ne rend que ce qui s’affiche, sans cookie, sans donnée d’organisation', async () => {
      const form = await activeForm(asN(), userIds['sales_rep']);
      const res = await publicGet(form['token']);
      const view = ok(res);
      expect(Object.keys(view).sort()).toEqual(
        ['branding', 'consent', 'fields', 'intro', 'successMessage', 'ticket', 'title'].sort(),
      );
      expect(view['consent']).toEqual({ text: LEAD_FORM_DEFAULT_CONSENT, policyUrl: POLICY });
      expect((view['fields'] as any[]).map((f) => f.key)).toEqual([
        'name',
        'company',
        'email',
        'phone',
        'message',
      ]);
      expect(view['branding']).toBeNull(); // aucun logo
      const raw = JSON.stringify(view);
      expect(raw).not.toContain(orgN);
      expect(raw).not.toContain(userIds['sales_rep']);
      expect(raw).not.toContain('Formulaire owner');
      expect(res.headers['cache-control']).toBe('no-store');
      code(await publicGet('court'), 404, 'LEAD_FORM_NOT_FOUND');
      code(await publicGet('A'.repeat(32)), 404, 'LEAD_FORM_NOT_FOUND');
    });

    it('jeton remplacé : l’ancien lien répond 404, le nouveau répond (critère 2)', async () => {
      const form = await formOf(asN());
      const rotated = ok(
        await post(asN(), '/crm/lead-form/rotate-token', { expectedRevision: form['revision'] }),
        201,
      );
      expect(rotated['token']).not.toBe(form['token']);
      expect(rotated['tokenRotatedAt']).not.toBeNull();
      code(await publicGet(form['token']), 404, 'LEAD_FORM_NOT_FOUND');
      code(await publicPost(form['token'], submission(form)), 404, 'LEAD_FORM_NOT_FOUND');
      ok(await publicGet(rotated['token']));
    });
  });

  // ── Anti-abus ────────────────────────────────────────────────────────────

  describe('anti-abus', () => {
    it('champ piège rempli : 201 identique, rien n’est créé (critère 3)', async () => {
      const form = await formOf(asN());
      const before = await counts(orgN);
      const res = ok(
        await publicPost(form['token'], submission(form, { website: 'http://spam.example' })),
        201,
      );
      expect(res).toEqual({ status: 'received', message: form['successMessage'] });
      expect(await counts(orgN)).toEqual(before);
    });

    it('délai minimal et ticket : trop tôt 400, forgé ou d’un autre formulaire 400 (critère 4)', async () => {
      const form = await formOf(asN());
      const before = await counts(orgN);
      // Ticket réellement émis par la page, envoyé aussitôt.
      const view = ok(await publicGet(form['token']));
      code(
        await publicPost(form['token'], submission(form, { ticket: view['ticket'] })),
        400,
        'LEAD_FORM_TOO_FAST',
      );
      const [id, at] = (view['ticket'] as string).split('.');
      code(
        await publicPost(
          form['token'],
          submission(form, { ticket: `${id}.${Number(at) - 60_000}.faux` }),
        ),
        400,
        'LEAD_FORM_TICKET_INVALID',
      );
      code(
        await publicPost(
          form['token'],
          submission(form, {
            ticket: mintLeadFormTicket(new ObjectId().toHexString(), Date.now() - 10_000),
          }),
        ),
        400,
        'LEAD_FORM_TICKET_INVALID',
      );
      expect(await counts(orgN)).toEqual(before);
    });

    it('validation : consentement, obligatoires, champ masqué, clé inconnue, taille', async () => {
      const form = await formOf(asN());
      const sansAccord = await publicPost(form['token'], submission(form, { consent: false }));
      expect(sansAccord.status).toBe(400);
      expect(issueCodes(sansAccord)).toContain('LEAD_FORM_CONSENT_REQUIRED');
      const sansEmail = await publicPost(form['token'], submission(form, { email: '' }));
      expect(issueCodes(sansEmail)).toContain('FIELD_REQUIRED');
      const masque = await publicPost(form['token'], submission(form, { source: 'salon' }));
      expect(issueCodes(masque)).toContain('LEAD_FORM_FIELD_NOT_ENABLED');
      code(
        await publicPost(form['token'], submission(form, { attachment: 'base64…' })),
        400,
        'INVALID_REQUEST',
      );
      code(
        await publicPost(form['token'], submission(form, { message: 'x'.repeat(2001) })),
        400,
        'INVALID_REQUEST',
      );
    });

    it('limite par IP : le sixième envoi en 10 minutes est refusé, une autre IP passe (critère 5)', async () => {
      const form = await formOf(asN());
      const ip = freshIp();
      for (let i = 0; i < 5; i++) {
        // Même refusés (piège), les envois comptent.
        ok(await publicPost(form['token'], submission(form, { website: 'x' }), ip), 201);
      }
      code(
        await publicPost(form['token'], submission(form, { website: 'x' }), ip),
        429,
        'LEAD_FORM_RATE_LIMITED',
      );
      ok(await publicPost(form['token'], submission(form, { website: 'x' }), freshIp()), 201);
      // Le seau est indexé par l'empreinte, jamais par l'adresse.
      const store = app.get(ThrottlerStorage) as unknown as { storage: Map<string, unknown> };
      const keys = [...store.storage.keys()].join(' ');
      expect(keys).not.toContain(ip);
    });

    it('limite par formulaire : 60 envois par heure, toutes IP confondues', async () => {
      const form = await formOf(asN());
      for (let i = 0; i < 60; i++) {
        ok(await publicPost(form['token'], submission(form, { website: 'x' }), freshIp()), 201);
      }
      code(
        await publicPost(form['token'], submission(form, { website: 'x' }), freshIp()),
        429,
        'LEAD_FORM_RATE_LIMITED',
      );
    });
  });

  // ── Ce que crée une soumission ───────────────────────────────────────────

  describe('soumission acceptée', () => {
    it('prospect, contact, activité assignée et notifiée, preuve sans IP, aucune opportunité (critères 6, 10)', async () => {
      const form = await formOf(asN());
      const before = await counts(orgN);
      const ip = freshIp();
      const email = `kin-${tag}@exemple.cd`;
      const res = ok(
        await publicPost(
          form['token'],
          submission(form, {
            name: 'Jean Kabila',
            company: 'Kin Transports',
            email: email.toUpperCase(),
            phone: '+243 81 000 0000',
            message: 'Devis pour 3 camions',
          }),
          ip,
        ),
        201,
      );
      expect(res['status']).toBe('received');
      const after = await counts(orgN);
      expect(after).toEqual({
        ...before,
        accounts: before.accounts + 1,
        contacts: before.contacts + 1,
        activities: before.activities + 1,
        submissions: before.submissions + 1,
      });
      const account = await db
        .collection('crm_accounts')
        .findOne({ organizationId: orgN, name: 'Kin Transports' });
      expect(account).toMatchObject({
        kind: 'prospect',
        origin: 'formulaire',
        ownerId: userIds['sales_rep'],
      });
      const contact = await db.collection('crm_contacts').findOne({ organizationId: orgN, email });
      expect(contact).toMatchObject({ name: 'Jean Kabila', accountId: String(account!._id) });
      const activity = await db
        .collection('crm_activities')
        .findOne({ organizationId: orgN, contactId: String(contact!._id) });
      expect(activity).toMatchObject({
        kind: 'follow_up',
        done: false,
        assigneeUserId: userIds['sales_rep'],
        accountId: String(account!._id),
        subject: 'Demande reçue par le formulaire : Jean Kabila',
      });
      expect(activity!['notes']).toContain('Devis pour 3 camions');
      expect(activity!['dueAt']).not.toBeNull();
      const notif = await db.collection('notifications').findOne({
        organizationId: orgN,
        recipientUserId: userIds['sales_rep'],
        kind: 'crm.activity_assigned',
        'source.entityId': String(activity!._id),
      });
      expect(notif).not.toBeNull();
      const proof = await db
        .collection('crm_lead_submissions')
        .findOne({ organizationId: orgN, contactId: String(contact!._id) });
      expect(proof).toMatchObject({
        duplicate: false,
        opportunityId: null,
        consent: { text: LEAD_FORM_DEFAULT_CONSENT, policyUrl: POLICY },
      });
      expect(proof!['ipHash']).toMatch(/^[0-9a-f]{32}$/);
      // Aucune IP en clair dans la base (critère 10).
      const proofs = JSON.stringify(await db.collection('crm_lead_submissions').find().toArray());
      const audits = JSON.stringify(await db.collection('audit_events').find().toArray());
      expect(proofs).not.toContain(ip);
      expect(audits).not.toContain(ip);
      expect(audits).toContain('crm.lead_form.submission_accepted');
      // Statistiques des réglages.
      const view = await formOf(asN());
      expect(view['stats']['submissions']).toBe(after.submissions);
      expect(view['stats']['lastSubmissionAt']).not.toBeNull();
    });

    it('doublon par e-mail (casse différente) : rien de réécrit, une activité de plus', async () => {
      const form = await formOf(asN());
      const email = `kin-${tag}@exemple.cd`;
      const before = await counts(orgN);
      ok(
        await publicPost(
          form['token'],
          submission(form, {
            name: 'Usurpateur',
            company: 'Autre SA',
            email: `Kin-${tag}@Exemple.cd`,
          }),
        ),
        201,
      );
      expect(await counts(orgN)).toEqual({
        ...before,
        activities: before.activities + 1,
        submissions: before.submissions + 1,
      });
      const contact = await db.collection('crm_contacts').findOne({ organizationId: orgN, email });
      expect(contact!['name']).toBe('Jean Kabila');
      const last = await db
        .collection('crm_lead_submissions')
        .find({ organizationId: orgN })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
      expect(last).toMatchObject({ duplicate: true, contactId: String(contact!._id) });
    });

    it('opportunité automatique seulement sur réglage explicite : ouverte, sans montant', async () => {
      const form = await formOf(asN());
      ok(
        await put(
          asN(),
          '/crm/lead-form',
          settingsOf(form, { createOpportunity: true, opportunityCurrency: 'CDF' }),
        ),
      );
      const before = await counts(orgN);
      ok(
        await publicPost(
          form['token'],
          submission(form, { name: 'Marie Ilunga', company: 'Ilunga Agro' }),
        ),
        201,
      );
      const after = await counts(orgN);
      expect(after.opportunities).toBe(before.opportunities + 1);
      const opp = await db
        .collection('crm_opportunities')
        .findOne({ organizationId: orgN, title: 'Demande de Ilunga Agro' });
      expect(opp).toMatchObject({
        status: 'open',
        amount: null,
        currency: 'CDF',
        ownerId: userIds['sales_rep'],
      });
      const now = await formOf(asN());
      ok(await put(asN(), '/crm/lead-form', settingsOf(now, { createOpportunity: false })));
    });

    it('responsable devenu inéligible : la demande est gardée, sans échéance ni assigné', async () => {
      const form = await formOf(asN());
      await db
        .collection('memberships')
        .updateOne(
          { organizationId: orgN, userId: userIds['sales_rep'] },
          { $set: { role: 'viewer' } },
        );
      try {
        ok(await publicPost(form['token'], submission(form, { name: 'Paul Tshibanda' })), 201);
        const act = await db.collection('crm_activities').findOne({
          organizationId: orgN,
          subject: 'Demande reçue par le formulaire : Paul Tshibanda',
        });
        expect(act).toMatchObject({ assigneeUserId: null, dueAt: null, done: false });
      } finally {
        await db
          .collection('memberships')
          .updateOne(
            { organizationId: orgN, userId: userIds['sales_rep'] },
            { $set: { role: 'sales_rep' } },
          );
      }
    });
  });

  // ── Isolation entre organisations ────────────────────────────────────────

  describe('isolation', () => {
    it('la demande arrive dans l’organisation du jeton seulement ; un e-mail de B n’est pas réutilisé (critère 7)', async () => {
      const shared = `partage-${tag}@exemple.cd`;
      ok(
        await post(asB(), '/crm/contacts', {
          name: 'Contact de B',
          email: shared,
          accountId: null,
        }),
        201,
      );
      // B ne voit pas le formulaire de N.
      expect(await formOf(asB())).toBeNull();
      const formN = await formOf(asN());
      const beforeB = await counts(orgB);
      const beforeN = await counts(orgN);
      ok(
        await publicPost(formN['token'], submission(formN, { name: 'Nouveau N', email: shared })),
        201,
      );
      expect(await counts(orgB)).toEqual(beforeB);
      const afterN = await counts(orgN);
      expect(afterN.contacts).toBe(beforeN.contacts + 1);
      const last = await db
        .collection('crm_lead_submissions')
        .find({ organizationId: orgN })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
      expect(last!['duplicate']).toBe(false);
      // B a son propre formulaire ; son jeton n'écrit que chez B.
      const formB = await activeForm(asB(), userIds['ownerB']);
      expect(formB['token']).not.toBe(formN['token']);
      ok(await publicPost(formB['token'], submission(formB, { name: 'Prospect B' })), 201);
      expect((await counts(orgN)).contacts).toBe(afterN.contacts);
      expect((await counts(orgB)).contacts).toBe(beforeB.contacts + 1);
    });
  });
});
