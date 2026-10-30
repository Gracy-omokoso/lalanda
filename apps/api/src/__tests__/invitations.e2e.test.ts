// Tests e2e S5d — invitations : création, acceptation, révocation, isolation.
// Nécessite MONGODB_URI (Atlas ou local) — sinon suite skippée comme isolation.e2e.
//
// Chaque `it()` utilise un tag unique pour ses emails et son org : les tests sont donc
// strictement indépendants et peuvent s'exécuter dans n'importe quel ordre.

import type { INestApplication } from '@nestjs/common';
import { LEGAL_VERSION } from '@lalanda/shared/legal';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import 'reflect-metadata';

import { dbOf, e2eSuite, teardown } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

async function makeApp(): Promise<INestApplication> {
  const { AppModule } = await import('../app.module.js');
  const { getAuth } = await import('../auth/auth.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableCors({
    origin: [process.env['WEB_URL'] ?? 'http://localhost:3000'],
    credentials: true,
  });
  const expressApp = app.getHttpAdapter().getInstance() as {
    all: (path: string, ...handlers: unknown[]) => void;
  };
  expressApp.all('/auth/*', toNodeHandler(getAuth()));
  await app.init();
  return app;
}

e2eSuite('invitations (brief §6, docs/12-ROLES-PERMISSIONS.md)', () => {
  let app: INestApplication;
  const allTestEmails: string[] = [];

  function uniqueTag(): string {
    return randomBytes(4).toString('hex');
  }

  function makeUser(
    prefix: string,
    tag: string,
  ): { email: string; password: string; name: string } {
    const email = `${prefix}-${tag}@lalanda-test.local`;
    allTestEmails.push(email);
    return { email, password: `Passw0rd!${prefix}`, name: prefix };
  }

  beforeAll(async () => {
    app = await makeApp();
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await teardown(app, allTestEmails);
  }, E2E_HOOK_TIMEOUT_MS);

  async function registerAndLogin(user: {
    email: string;
    password: string;
    name: string;
  }): Promise<string[]> {
    const server = app.getHttpServer();
    let res = await request(server).post('/auth/sign-up/email').send({
      email: user.email,
      password: user.password,
      name: user.name,
      termsVersion: LEGAL_VERSION,
    });
    if (res.status >= 400) {
      res = await request(server)
        .post('/auth/sign-in/email')
        .send({ email: user.email, password: user.password });
    }
    expect(res.status).toBeLessThan(400);
    const rawCookies = res.headers['set-cookie'];
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    expect(cookies.length).toBeGreaterThan(0);
    return cookies.map((c: string) => c.split(';')[0]!);
  }

  async function getPrimaryOrgId(cookies: string[]): Promise<string> {
    const res = await request(app.getHttpServer()).get('/organizations').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.organizations.length).toBeGreaterThan(0);
    return res.body.organizations[0].id;
  }

  it('owner peut inviter un email, récupère le token dans la réponse', async () => {
    const tag = uniqueTag();
    const owner = makeUser('owner', tag);
    const invitee = makeUser('invitee', tag);

    const ownerCookies = await registerAndLogin(owner);
    const ownerOrgId = await getPrimaryOrgId(ownerCookies);

    const res = await request(app.getHttpServer())
      .post(`/organizations/${ownerOrgId}/invitations`)
      .set('Cookie', ownerCookies)
      .send({ email: invitee.email });

    expect(res.status).toBe(201);
    expect(res.body.invitation.email).toBe(invitee.email.toLowerCase());
    // S20a : le rôle par défaut d'une invitation passe de `member` à `viewer`.
    // Changement VOULU (ADR-0012 §7) — moindre privilège : inviter sans préciser
    // de rôle ne doit accorder aucun droit d'écriture.
    expect(res.body.invitation.role).toBe('viewer');
    expect(res.body.invitation.acceptedAt).toBeNull();
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);

  it("owner ne peut pas s'inviter lui-même (CANNOT_INVITE_SELF)", async () => {
    const tag = uniqueTag();
    const owner = makeUser('owner', tag);

    const ownerCookies = await registerAndLogin(owner);
    const ownerOrgId = await getPrimaryOrgId(ownerCookies);

    const res = await request(app.getHttpServer())
      .post(`/organizations/${ownerOrgId}/invitations`)
      .set('Cookie', ownerCookies)
      .send({ email: owner.email });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CANNOT_INVITE_SELF');
  }, 30_000);

  it('un non-owner ne peut pas inviter dans une org (403/404)', async () => {
    const tag = uniqueTag();
    const owner = makeUser('owner', tag);
    const outsider = makeUser('outsider', tag);

    const ownerCookies = await registerAndLogin(owner);
    const ownerOrgId = await getPrimaryOrgId(ownerCookies);
    const outsiderCookies = await registerAndLogin(outsider);

    const res = await request(app.getHttpServer())
      .post(`/organizations/${ownerOrgId}/invitations`)
      .set('Cookie', outsiderCookies)
      .send({ email: 'somebody@example.com' });

    // Outsider n'a pas de membership → NotFound (ne révèle pas l'existence de l'org).
    expect([403, 404]).toContain(res.status);
  }, 30_000);

  it("invitee voit l'invitation dans /invitations/pending et peut l'accepter", async () => {
    const tag = uniqueTag();
    const owner = makeUser('owner', tag);
    const invitee = makeUser('invitee', tag);

    const ownerCookies = await registerAndLogin(owner);
    const ownerOrgId = await getPrimaryOrgId(ownerCookies);

    const created = await request(app.getHttpServer())
      .post(`/organizations/${ownerOrgId}/invitations`)
      .set('Cookie', ownerCookies)
      .send({ email: invitee.email });
    expect(created.status).toBe(201);
    const token = created.body.token as string;

    const inviteeCookies = await registerAndLogin(invitee);

    const pending = await request(app.getHttpServer())
      .get('/invitations/pending')
      .set('Cookie', inviteeCookies);
    expect(pending.status).toBe(200);
    const mine = pending.body.invitations as { token: string; organizationId: string }[];
    expect(mine.find((i) => i.token === token)).toBeDefined();

    const accept = await request(app.getHttpServer())
      .post('/invitations/accept')
      .set('Cookie', inviteeCookies)
      .send({ token });
    expect(accept.status).toBe(201);
    expect(accept.body.organizationId).toBe(ownerOrgId);

    // Invitee est maintenant membre : /organizations l'inclut.
    const orgs = await request(app.getHttpServer())
      .get('/organizations')
      .set('Cookie', inviteeCookies);
    expect(orgs.status).toBe(200);
    const found = (orgs.body.organizations as { id: string; role: string }[]).find(
      (o) => o.id === ownerOrgId,
    );
    expect(found).toBeDefined();
    // Idem : l'invitation sans rôle explicite crée désormais un `viewer`.
    expect(found?.role).toBe('viewer');

    // Pending vide (pour ce token) après acceptation.
    const after = await request(app.getHttpServer())
      .get('/invitations/pending')
      .set('Cookie', inviteeCookies);
    const stillPending = (after.body.invitations as { token: string }[]).find(
      (i) => i.token === token,
    );
    expect(stillPending).toBeUndefined();
  }, 60_000);

  it('un tiers ne peut pas accepter une invitation destinée à un autre email (403)', async () => {
    const tag = uniqueTag();
    const owner = makeUser('owner', tag);
    const invitee = makeUser('invitee', tag);
    const outsider = makeUser('outsider', tag);

    const ownerCookies = await registerAndLogin(owner);
    const ownerOrgId = await getPrimaryOrgId(ownerCookies);

    const created = await request(app.getHttpServer())
      .post(`/organizations/${ownerOrgId}/invitations`)
      .set('Cookie', ownerCookies)
      .send({ email: invitee.email });
    expect(created.status).toBe(201);
    const token = created.body.token as string;

    const outsiderCookies = await registerAndLogin(outsider);
    const attempt = await request(app.getHttpServer())
      .post('/invitations/accept')
      .set('Cookie', outsiderCookies)
      .send({ token });
    expect(attempt.status).toBe(403);
    expect(attempt.body.code).toBe('INVITATION_EMAIL_MISMATCH');
  }, 30_000);

  it('owner peut révoquer une invitation pending, elle disparaît des listings', async () => {
    const tag = uniqueTag();
    const owner = makeUser('owner', tag);
    const revokeTarget = `revoke-${tag}@lalanda-test.local`;
    allTestEmails.push(revokeTarget);

    const ownerCookies = await registerAndLogin(owner);
    const ownerOrgId = await getPrimaryOrgId(ownerCookies);

    const created = await request(app.getHttpServer())
      .post(`/organizations/${ownerOrgId}/invitations`)
      .set('Cookie', ownerCookies)
      .send({ email: revokeTarget });
    expect(created.status).toBe(201);
    const invId = created.body.invitation.id as string;
    const token = created.body.token as string;

    const revoked = await request(app.getHttpServer())
      .delete(`/organizations/${ownerOrgId}/invitations/${invId}`)
      .set('Cookie', ownerCookies);
    expect(revoked.status).toBe(200);
    expect(revoked.body.invitation.revokedAt).not.toBeNull();

    const list = await request(app.getHttpServer())
      .get(`/organizations/${ownerOrgId}/invitations`)
      .set('Cookie', ownerCookies);
    expect(list.status).toBe(200);
    // Filtre sur l'id créé — le test devient tolérant à d'autres invitations parallèles.
    const stillListed = (list.body.invitations as { id: string }[]).find((i) => i.id === invId);
    expect(stillListed).toBeUndefined();

    // Accepter un token révoqué → 400 INVITATION_REVOKED (owner tape lui-même, mais peu importe :
    // le check REVOKED précède le check EMAIL_MISMATCH dans le service).
    const attempt = await request(app.getHttpServer())
      .post('/invitations/accept')
      .set('Cookie', ownerCookies)
      .send({ token });
    expect(attempt.status).toBe(400);
    expect(attempt.body.code).toBe('INVITATION_REVOKED');
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // ADR-0041 — A4 : l'invitation porte un écart (critère 11)
  //
  // Validé À L'ENVOI contre les droits effectifs de l'invitant, puis REVALIDÉ À
  // L'ACCEPTATION contre ses droits effectifs du moment. Interrupteur
  // `MEMBER_PERMISSIONS_ENABLED` éteint : une invitation n'accepte pas d'écart.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('ADR-0041 — A4 : invitation avec écart', () => {
    const INTERRUPTEUR = process.env['MEMBER_PERMISSIONS_ENABLED'];
    const server = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();

    afterEach(() => {
      if (INTERRUPTEUR === undefined) delete process.env['MEMBER_PERMISSIONS_ENABLED'];
      else process.env['MEMBER_PERMISSIONS_ENABLED'] = INTERRUPTEUR;
    });

    async function userIdOf(email: string): Promise<string> {
      const db = await dbOf(app);
      const doc = await db.collection('user').findOne({ email: email.toLowerCase() });
      if (!doc) throw new Error(`${email} introuvable`);
      return String(doc._id);
    }

    /** Propriétaire + Administrateur (invité, accepté) dans l'organisation du premier. */
    async function equipe(tag: string): Promise<{
      orgId: string;
      ownerCookies: string[];
      adminCookies: string[];
      adminId: string;
    }> {
      const owner = makeUser('a4owner', tag);
      const admin = makeUser('a4admin', tag);
      const ownerCookies = await registerAndLogin(owner);
      const adminCookies = await registerAndLogin(admin);
      const orgId = await getPrimaryOrgId(ownerCookies);
      const inv = await request(server())
        .post(`/organizations/${orgId}/invitations`)
        .set('Cookie', ownerCookies)
        .send({ email: admin.email, role: 'admin' });
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', adminCookies)
        .send({ token: inv.body.token });
      expect(acc.status).toBe(201);
      return { orgId, ownerCookies, adminCookies, adminId: await userIdOf(admin.email) };
    }

    it('interrupteur éteint : une invitation avec écart → 409 MEMBER_PERMISSIONS_DISABLED', async () => {
      delete process.env['MEMBER_PERMISSIONS_ENABLED'];
      const tag = uniqueTag();
      const owner = makeUser('a4off', tag);
      const invitee = makeUser('a4offinv', tag);
      const cookies = await registerAndLogin(owner);
      const orgId = await getPrimaryOrgId(cookies);
      const res = await request(server())
        .post(`/organizations/${orgId}/invitations`)
        .set('Cookie', cookies)
        .send({ email: invitee.email, role: 'viewer', grants: ['crm.manage'] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MEMBER_PERMISSIONS_DISABLED');
    }, 60_000);

    it('critère 11 — « Lecteur + crm.manage » par un Administrateur : appartenance avec cet écart', async () => {
      process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
      const tag = uniqueTag();
      const { orgId, adminCookies } = await equipe(tag);
      const invitee = makeUser('a4lect', tag);
      const inviteeCookies = await registerAndLogin(invitee);

      // Validé à l'envoi : l'Administrateur n'a pas `sales.invoice`.
      const escalade = await request(server())
        .post(`/organizations/${orgId}/invitations`)
        .set('Cookie', adminCookies)
        .send({ email: invitee.email, role: 'viewer', grants: ['crm.manage', 'sales.invoice'] });
      expect(escalade.status).toBe(403);
      expect(escalade.body.code).toBe('PERMISSION_ESCALATION');

      const inv = await request(server())
        .post(`/organizations/${orgId}/invitations`)
        .set('Cookie', adminCookies)
        .send({ email: invitee.email, role: 'viewer', grants: ['crm.manage'] });
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);
      expect(inv.body.invitation).toMatchObject({ grants: ['crm.manage'], revokes: [] });

      // L'invitation listée affiche son écart.
      const liste = await request(server())
        .get(`/organizations/${orgId}/invitations`)
        .set('Cookie', adminCookies);
      expect(
        (liste.body.invitations as { id: string; grants: string[] }[]).find(
          (i) => i.id === inv.body.invitation.id,
        )?.grants,
      ).toEqual(['crm.manage']);

      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', inviteeCookies)
        .send({ token: inv.body.token });
      expect(acc.status, JSON.stringify(acc.body)).toBe(201);

      const db = await dbOf(app);
      const inviteeId = await userIdOf(invitee.email);
      const m = await db
        .collection('memberships')
        .findOne({ organizationId: orgId, userId: inviteeId });
      expect(m?.['role']).toBe('viewer');
      expect(m?.['grants']).toEqual(['crm.manage']);
      const trace = await db.collection('audit_events').findOne({
        organizationId: orgId,
        action: 'member.permissions_changed',
        targetId: inviteeId,
      });
      expect(trace?.['metadata']).toMatchObject({
        stage: 'acceptance',
        after: { role: 'viewer', grants: ['crm.manage'] },
      });

      const moi = await request(server())
        .get('/me/permissions')
        .set('Cookie', [...inviteeCookies, `active_org_id=${orgId}`]);
      expect(moi.body.actions).toContain('crm.manage');
      expect(moi.body.customized).toBe(true);
    }, 90_000);

    it("critère 11 — l'Administrateur a perdu `crm.manage` entre-temps : 403, aucune appartenance", async () => {
      process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
      const tag = uniqueTag();
      const { orgId, ownerCookies, adminCookies, adminId } = await equipe(tag);
      const invitee = makeUser('a4lect2', tag);
      const inviteeCookies = await registerAndLogin(invitee);

      const inv = await request(server())
        .post(`/organizations/${orgId}/invitations`)
        .set('Cookie', adminCookies)
        .send({ email: invitee.email, role: 'viewer', grants: ['crm.manage'] });
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);

      const retrait = await request(server())
        .patch(`/organizations/${orgId}/members/${adminId}/permissions`)
        .set('Cookie', ownerCookies)
        .send({ grants: [], revokes: ['crm.manage'], expectedRevision: 0 });
      expect(retrait.status, JSON.stringify(retrait.body)).toBe(200);

      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', inviteeCookies)
        .send({ token: inv.body.token });
      expect(acc.status).toBe(403);
      expect(acc.body.code).toBe('INVITATION_INVITER_NO_LONGER_AUTHORIZED');

      const db = await dbOf(app);
      const m = await db
        .collection('memberships')
        .findOne({ organizationId: orgId, userId: await userIdOf(invitee.email) });
      expect(m).toBeNull();
    }, 90_000);

    it("une invitation avec écart créée allumé n'est pas acceptée interrupteur éteint", async () => {
      process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
      const tag = uniqueTag();
      const owner = makeUser('a4bascule', tag);
      const invitee = makeUser('a4basculeinv', tag);
      const cookies = await registerAndLogin(owner);
      const inviteeCookies = await registerAndLogin(invitee);
      const orgId = await getPrimaryOrgId(cookies);
      const inv = await request(server())
        .post(`/organizations/${orgId}/invitations`)
        .set('Cookie', cookies)
        .send({ email: invitee.email, role: 'viewer', revokes: ['treasury.read'] });
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);

      delete process.env['MEMBER_PERMISSIONS_ENABLED'];
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', inviteeCookies)
        .send({ token: inv.body.token });
      expect(acc.status).toBe(409);
      expect(acc.body.code).toBe('MEMBER_PERMISSIONS_DISABLED');
    }, 90_000);
  });
});
