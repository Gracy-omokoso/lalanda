// ADR-0041 — A4 : routes de gestion des autorisations par membre, BOUT EN BOUT.
//
//   PATCH /organizations/:orgId/members/:userId/permissions  (ajouts et retraits)
//   PATCH /organizations/:orgId/members/:userId/role         (titre, effacement, nouvel écart)
//   PATCH /organizations/:orgId/members/:userId/close-right  (G2)
//
// Critères d'acceptation 2 à 7, 9, 10, 12, 13 et 16 (le 8 et le 11 vivent dans
// `critical-rules.e2e` et `invitations.e2e`), plus l'interrupteur
// `MEMBER_PERMISSIONS_ENABLED` (éteint : refus explicite `409 MEMBER_PERMISSIONS_DISABLED`)
// et la notification « Vos autorisations ont changé ».

import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import 'reflect-metadata';

import type { Action, OrgRole } from '../authz/permissions.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

e2eSuite('ADR-0041 A4 — routes de gestion des autorisations par membre', () => {
  let app: INestApplication;
  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];
  const INTERRUPTEUR = process.env['MEMBER_PERMISSIONS_ENABLED'];

  interface Compte {
    email: string;
    cookies: string[];
    userId: string;
    orgId: string;
  }
  const comptes: Record<string, Compte> = {};

  const serveur = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();
  const dans = (cle: string, orgId: string): string[] => [
    ...comptes[cle]!.cookies,
    `active_org_id=${orgId}`,
  ];
  const id = (cle: string): string => comptes[cle]!.userId;

  function allumer(): void {
    process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
  }
  function eteindre(): void {
    delete process.env['MEMBER_PERMISSIONS_ENABLED'];
  }

  async function inscrire(cle: string): Promise<Compte> {
    const email = `a4-${cle}-${tag}@lalanda-test.local`.toLowerCase();
    emails.push(email);
    const cookies = await registerAndLogin(app, {
      email,
      password: `Passw0rd!${cle}`,
      name: `A4 ${cle}`,
    });
    const db = await dbOf(app);
    const doc = await db.collection('user').findOne({ email });
    if (!doc) throw new Error(`Utilisateur ${email} introuvable.`);
    const orgs = await request(serveur()).get('/organizations').set('Cookie', cookies);
    const compte: Compte = {
      email,
      cookies,
      userId: String(doc._id),
      orgId: (orgs.body.organizations as { id: string }[])[0]?.id ?? '',
    };
    comptes[cle] = compte;
    return compte;
  }

  async function rejoindre(hote: string, orgId: string, cle: string, role: OrgRole): Promise<void> {
    const invitation = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', comptes[hote]!.cookies)
      .send({ email: comptes[cle]!.email, role });
    expect(invitation.status, JSON.stringify(invitation.body)).toBe(201);
    const acceptation = await request(serveur())
      .post('/invitations/accept')
      .set('Cookie', comptes[cle]!.cookies)
      .send({ token: invitation.body.token });
    expect(acceptation.status, JSON.stringify(acceptation.body)).toBe(201);
  }

  async function planPro(orgId: string): Promise<void> {
    const { BillingService } = await import('../billing/billing.service.js');
    await app.get(BillingService).setPlan(orgId, 'pro');
  }

  async function revision(acteur: string, orgId: string, cible: string): Promise<number> {
    const res = await request(serveur())
      .get(`/organizations/${orgId}/members`)
      .set('Cookie', dans(acteur, orgId));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ligne = (res.body.members as { userId: string; permissionsRevision: number }[]).find(
      (m) => m.userId === id(cible),
    );
    if (!ligne) throw new Error(`${cible} absent de la liste`);
    return ligne.permissionsRevision;
  }

  /** PATCH …/permissions avec la révision courante de la cible (lue par le Propriétaire). */
  async function ecart(
    acteur: string,
    orgId: string,
    cible: string,
    body: { grants?: Action[]; revokes?: Action[]; reason?: string },
  ): Promise<request.Response> {
    const expectedRevision = await revision('owner', orgId, cible);
    return request(serveur())
      .patch(`/organizations/${orgId}/members/${id(cible)}/permissions`)
      .set('Cookie', dans(acteur, orgId))
      .send({ grants: [], revokes: [], ...body, expectedRevision });
  }

  async function membership(orgId: string, cle: string): Promise<Record<string, unknown>> {
    const db = await dbOf(app);
    const doc = await db
      .collection('memberships')
      .findOne({ organizationId: orgId, userId: id(cle) });
    if (!doc) throw new Error(`appartenance ${cle} introuvable`);
    return doc as Record<string, unknown>;
  }

  async function audits(orgId: string, cle: string, action: string): Promise<unknown[]> {
    const db = await dbOf(app);
    return db
      .collection('audit_events')
      .find({ organizationId: orgId, targetId: id(cle), action })
      .sort({ createdAt: 1 })
      .toArray();
  }

  // `equipe` — owner + admin + commercial + lecteur + comptable + analyste + conseiller.
  let org = '';
  // `autre`  — organisation d'un tiers (isolation, critère 16).
  let autre = '';

  beforeAll(async () => {
    app = await makeE2EApp();
    org = (await inscrire('owner')).orgId;
    for (const cle of ['admin', 'commercial', 'lecteur', 'comptable', 'comptable2', 'analyste']) {
      await inscrire(cle);
    }
    await inscrire('conseiller');
    await planPro(org);
    await rejoindre('owner', org, 'admin', 'admin');
    await rejoindre('owner', org, 'commercial', 'sales_rep');
    await rejoindre('owner', org, 'lecteur', 'viewer');
    await rejoindre('owner', org, 'comptable', 'accountant');
    await rejoindre('owner', org, 'comptable2', 'accountant');
    await rejoindre('owner', org, 'analyste', 'analyst');
    await rejoindre('owner', org, 'conseiller', 'advisor');

    autre = (await inscrire('tiers')).orgId;
    await inscrire('tiersMembre');
    await rejoindre('tiers', autre, 'tiersMembre', 'viewer');
  }, E2E_HOOK_TIMEOUT_MS);

  afterEach(() => {
    eteindre();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (INTERRUPTEUR === undefined) eteindre();
    else process.env['MEMBER_PERMISSIONS_ENABLED'] = INTERRUPTEUR;
    await teardown(app, emails);
  }, E2E_HOOK_TIMEOUT_MS);

  // ── Interrupteur éteint ─────────────────────────────────────────────────────

  describe('interrupteur éteint (défaut)', () => {
    it('PATCH …/permissions → 409 MEMBER_PERMISSIONS_DISABLED, rien n’est écrit', async () => {
      const res = await ecart('owner', org, 'commercial', { grants: ['treasury.read'] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MEMBER_PERMISSIONS_DISABLED');
      expect((await membership(org, 'commercial'))['grants'] ?? []).toEqual([]);
    }, 60_000);

    it('PATCH …/role avec un écart → 409 ; sans écart, comme avant', async () => {
      const refus = await request(serveur())
        .patch(`/organizations/${org}/members/${id('conseiller')}/role`)
        .set('Cookie', dans('owner', org))
        .send({ role: 'viewer', grants: ['crm.manage'] });
      expect(refus.status).toBe(409);
      expect(refus.body.code).toBe('MEMBER_PERMISSIONS_DISABLED');

      const vide = await request(serveur())
        .patch(`/organizations/${org}/members/${id('conseiller')}/role`)
        .set('Cookie', dans('owner', org))
        .send({ role: 'advisor', grants: [], revokes: [] });
      expect(vide.status, JSON.stringify(vide.body)).toBe(200);
    }, 60_000);

    it('la liste des membres expose les champs nouveaux, écart vide', async () => {
      const res = await request(serveur())
        .get(`/organizations/${org}/members`)
        .set('Cookie', dans('owner', org));
      expect(res.status).toBe(200);
      const commercial = (res.body.members as Record<string, unknown>[]).find(
        (m) => m['userId'] === id('commercial'),
      );
      expect(commercial).toMatchObject({
        role: 'sales_rep',
        grants: [],
        revokes: [],
        customized: false,
        manageable: true,
      });
      expect(typeof commercial!['permissionsRevision']).toBe('number');
    }, 60_000);
  });

  // ── Critères 2 et 3 : effet à la requête suivante, sans reconnexion ─────────

  it('critère 2 — `treasury.read` ajouté à un Commercial : 403 → 200, /me le montre, notification', async () => {
    allumer();
    const avant = await request(serveur())
      .get('/treasury/accounts')
      .set('Cookie', dans('commercial', org));
    expect(avant.status).toBe(403);

    const res = await ecart('owner', org, 'commercial', {
      grants: ['treasury.read'],
      reason: 'Suivi des encaissements',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.member).toMatchObject({
      grants: ['treasury.read'],
      revokes: [],
      customized: true,
    });
    expect(res.body.member.effective).toContain('treasury.read');

    const apres = await request(serveur())
      .get('/treasury/accounts')
      .set('Cookie', dans('commercial', org));
    expect(apres.status, JSON.stringify(apres.body)).toBe(200);

    const moi = await request(serveur())
      .get('/me/permissions')
      .set('Cookie', dans('commercial', org));
    expect(moi.body.actions).toContain('treasury.read');
    expect(moi.body.grants).toEqual(['treasury.read']);
    expect(moi.body.customized).toBe(true);

    // G8 / décision n° 10 : « Vos autorisations ont changé », sans détail.
    const notes = await request(serveur())
      .get('/notifications')
      .set('Cookie', dans('commercial', org));
    expect(notes.status, JSON.stringify(notes.body)).toBe(200);
    const note = (notes.body.items as { kind: string; title: string; href: string }[]).find(
      (n) => n.kind === 'organization.permissions_changed',
    );
    expect(note).toMatchObject({ title: 'Vos autorisations ont changé', href: '/compte' });

    // L'auteur n'est pas notifié de son propre geste.
    const notesOwner = await request(serveur())
      .get('/notifications')
      .set('Cookie', dans('owner', org));
    expect(
      (notesOwner.body.items as { kind: string }[]).some(
        (n) => n.kind === 'organization.permissions_changed',
      ),
    ).toBe(false);
  }, 60_000);

  it('critère 3 — `sales.invoice` retiré à un Comptable : 403 customized à la requête suivante', async () => {
    allumer();
    const res = await ecart('owner', org, 'comptable', { revokes: ['sales.invoice'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const refus = await request(serveur())
      .post('/sales/invoices/000000000000000000000000/issue')
      .set('Cookie', dans('comptable', org))
      .send({});
    expect(refus.status).toBe(403);
    expect(refus.body).toMatchObject({
      code: 'FORBIDDEN',
      action: 'sales.invoice',
      customized: true,
    });
  }, 60_000);

  // ── Critère 4 : G1 ──────────────────────────────────────────────────────────

  it('critère 4 — un Administrateur : `crm.manage` à un Lecteur oui ; `sales.invoice`, `plan.approve`, un Comptable non', async () => {
    allumer();
    const ok = await ecart('admin', org, 'lecteur', { grants: ['crm.manage'] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.member.grants).toEqual(['crm.manage']);

    for (const action of ['sales.invoice', 'plan.approve'] as Action[]) {
      const refus = await ecart('admin', org, 'lecteur', { grants: ['crm.manage', action] });
      expect(refus.status, action).toBe(403);
      expect(refus.body.code).toBe('PERMISSION_ESCALATION');
      expect(refus.body.actions).toContain(action);
    }

    const plusFort = await ecart('admin', org, 'comptable2', { grants: ['work.manage'] });
    expect(plusFort.status).toBe(403);
    expect(plusFort.body.code).toBe('PERMISSION_ESCALATION');

    // `manageable` suit G1 : le Comptable n'est pas gérable par l'Administrateur.
    const liste = await request(serveur())
      .get(`/organizations/${org}/members`)
      .set('Cookie', dans('admin', org));
    const lignes = liste.body.members as { userId: string; manageable: boolean }[];
    expect(lignes.find((m) => m.userId === id('comptable2'))!.manageable).toBe(false);
    expect(lignes.find((m) => m.userId === id('lecteur'))!.manageable).toBe(true);
  }, 60_000);

  // ── Critère 5 : G2 ──────────────────────────────────────────────────────────

  it('critère 5 — viser ses propres autorisations ou son droit de clôture : 403 SELF_PERMISSIONS_FORBIDDEN', async () => {
    allumer();
    const soi = await request(serveur())
      .patch(`/organizations/${org}/members/${id('admin')}/permissions`)
      .set('Cookie', dans('admin', org))
      .send({ grants: [], revokes: ['audit.read'], expectedRevision: 0 });
    expect(soi.status).toBe(403);
    expect(soi.body.code).toBe('SELF_PERMISSIONS_FORBIDDEN');

    const cloture = await request(serveur())
      .patch(`/organizations/${org}/members/${id('owner')}/close-right`)
      .set('Cookie', dans('owner', org))
      .send({ value: false });
    expect(cloture.status).toBe(403);
    expect(cloture.body.code).toBe('SELF_PERMISSIONS_FORBIDDEN');

    // Interrupteur éteint aussi : G2 protège la route historique.
    eteindre();
    const clotureEteint = await request(serveur())
      .patch(`/organizations/${org}/members/${id('owner')}/close-right`)
      .set('Cookie', dans('owner', org))
      .send({ value: true });
    expect(clotureEteint.status).toBe(403);
    expect(clotureEteint.body.code).toBe('SELF_PERMISSIONS_FORBIDDEN');
  }, 60_000);

  // ── Critère 6 : G3 ──────────────────────────────────────────────────────────

  it('critère 6 — `billing.manage` non délégable ; Propriétaire non personnalisable ; transfert réservé', async () => {
    allumer();
    const billing = await ecart('owner', org, 'admin', { grants: ['billing.manage'] });
    expect(billing.status).toBe(400);
    expect(billing.body.code).toBe('PERMISSION_NOT_DELEGABLE');

    const proprietaire = await request(serveur())
      .patch(`/organizations/${org}/members/${id('owner')}/permissions`)
      .set('Cookie', dans('admin', org))
      .send({ grants: [], revokes: ['audit.read'], expectedRevision: 0 });
    expect(proprietaire.status).toBe(409);
    expect(proprietaire.body.code).toBe('OWNER_PERMISSIONS_FIXED');

    const inconnue = await request(serveur())
      .patch(`/organizations/${org}/members/${id('admin')}/permissions`)
      .set('Cookie', dans('owner', org))
      .send({ grants: ['transfer'], revokes: [], expectedRevision: 0 });
    expect(inconnue.status).toBe(400);
    expect(inconnue.body.code).toBe('INVALID_REQUEST');

    const transfert = await request(serveur())
      .post(`/organizations/${org}/transfer-ownership`)
      .set('Cookie', dans('admin', org))
      .send({ userId: id('lecteur') });
    expect(transfert.status).toBe(403);
    expect(transfert.body.code).toBe('OWNER_ROLE_REQUIRED');
  }, 60_000);

  // ── Critère 7 : G4 ──────────────────────────────────────────────────────────

  it('critère 7 — paires de séparation des tâches ; `fiscal.manage` à un Comptable accepté', async () => {
    allumer();
    const analyste = await ecart('owner', org, 'analyste', { grants: ['plan.approve'] });
    expect(analyste.status).toBe(409);
    expect(analyste.body).toMatchObject({
      code: 'SOD_CONFLICT',
      pair: ['inputs.update', 'plan.approve'],
    });

    const comptable = await ecart('owner', org, 'comptable2', { grants: ['plan.approve'] });
    expect(comptable.status).toBe(409);
    expect(comptable.body).toMatchObject({
      code: 'SOD_CONFLICT',
      pair: ['period.close', 'plan.approve'],
    });

    const fiscal = await ecart('owner', org, 'comptable2', { grants: ['fiscal.manage'] });
    expect(fiscal.status, JSON.stringify(fiscal.body)).toBe(200);
    expect(fiscal.body.member.grants).toEqual(['fiscal.manage']);
  }, 60_000);

  // ── Critère 9 : dépendances ─────────────────────────────────────────────────

  it('critère 9 — dépendances manquantes refusées, jamais complétées en silence', async () => {
    allumer();
    const sansLecture = await ecart('owner', org, 'conseiller', { grants: ['sales.manage'] });
    expect(sansLecture.status).toBe(400);
    expect(sansLecture.body).toMatchObject({
      code: 'PERMISSION_DEPENDENCY_MISSING',
      missing: ['sales.read'],
    });

    const retraitLecture = await ecart('owner', org, 'comptable2', { revokes: ['sales.read'] });
    expect(retraitLecture.status).toBe(400);
    expect(retraitLecture.body.code).toBe('PERMISSION_DEPENDENCY_MISSING');

    const socle = await ecart('owner', org, 'conseiller', { revokes: ['analytics.read'] });
    expect(socle.status).toBe(400);
    expect(socle.body.code).toBe('PERMISSION_DEPENDENCY_MISSING');

    const redondant = await ecart('owner', org, 'conseiller', { grants: ['project.read'] });
    expect(redondant.status).toBe(400);
    expect(redondant.body.code).toBe('PERMISSION_OVERRIDE_REDUNDANT');
  }, 60_000);

  // ── Case ⚙ du Comptable par la route des autorisations ──────────────────────

  it('§ 1 — pour un Comptable, `period.close` dans l’écart écrit `canClosePeriods`', async () => {
    allumer();
    const accord = await ecart('owner', org, 'comptable', {
      grants: ['period.close'],
      revokes: ['sales.invoice'],
    });
    expect(accord.status, JSON.stringify(accord.body)).toBe(200);
    expect(accord.body.member).toMatchObject({
      canClosePeriods: true,
      grants: [],
      revokes: ['sales.invoice'],
    });
    const doc = await membership(org, 'comptable');
    expect(doc['grants']).toEqual([]);
    expect(doc['canClosePeriods']).toBe(true);
  }, 60_000);

  // ── Critère 10 : changement de titre ────────────────────────────────────────

  it('critère 10 — le changement de titre efface l’écart ; un nouvel écart s’écrit atomiquement', async () => {
    allumer();
    const prepa = await ecart('owner', org, 'comptable', {
      grants: ['work.manage', 'period.close'],
      revokes: ['sales.invoice'],
    });
    expect(prepa.status, JSON.stringify(prepa.body)).toBe(200);
    const rev = prepa.body.member.permissionsRevision as number;

    const analyste = await request(serveur())
      .patch(`/organizations/${org}/members/${id('comptable')}/role`)
      .set('Cookie', dans('owner', org))
      .send({ role: 'analyst', expectedRevision: rev });
    expect(analyste.status, JSON.stringify(analyste.body)).toBe(200);
    expect(analyste.body.member).toMatchObject({
      role: 'analyst',
      grants: [],
      revokes: [],
      canClosePeriods: false,
      customized: false,
      permissionsRevision: rev + 1,
    });
    const roleChanged = (await audits(org, 'comptable', 'member.role_changed')).at(-1) as {
      metadata: Record<string, unknown>;
    };
    expect(roleChanged.metadata).toMatchObject({
      from: 'accountant',
      to: 'analyst',
      droppedOverrides: {
        grants: ['work.manage'],
        revokes: ['sales.invoice'],
        canClosePeriods: true,
      },
    });

    // Révision périmée : refus.
    const perime = await request(serveur())
      .patch(`/organizations/${org}/members/${id('comptable')}/role`)
      .set('Cookie', dans('owner', org))
      .send({ role: 'accountant', expectedRevision: rev });
    expect(perime.status).toBe(409);
    expect(perime.body.code).toBe('STALE_REVISION');

    const retour = await request(serveur())
      .patch(`/organizations/${org}/members/${id('comptable')}/role`)
      .set('Cookie', dans('owner', org))
      .send({ role: 'accountant' });
    expect(retour.status).toBe(200);
    const avecEcart = await request(serveur())
      .patch(`/organizations/${org}/members/${id('comptable')}/role`)
      .set('Cookie', dans('owner', org))
      .send({ role: 'analyst', grants: ['crm.manage'] });
    expect(avecEcart.status, JSON.stringify(avecEcart.body)).toBe(200);
    expect(avecEcart.body.member).toMatchObject({ role: 'analyst', grants: ['crm.manage'] });
    const doc = await membership(org, 'comptable');
    expect(doc['role']).toBe('analyst');
    expect(doc['grants']).toEqual(['crm.manage']);

    // Un nouvel écart incohérent avec le nouveau titre est refusé, titre compris.
    const sod = await request(serveur())
      .patch(`/organizations/${org}/members/${id('comptable')}/role`)
      .set('Cookie', dans('owner', org))
      .send({ role: 'viewer', grants: ['plan.approve', 'inputs.update'] });
    expect(sod.status).toBe(409);
    expect(sod.body.code).toBe('SOD_CONFLICT');
    expect((await membership(org, 'comptable'))['role']).toBe('analyst');
  }, 60_000);

  // ── Critère 12 : audit strict, dans la même transaction ─────────────────────

  it('critère 12 — `member.permissions_changed` avant/après ; audit en panne ⇒ rien d’appliqué', async () => {
    allumer();
    const res = await ecart('owner', org, 'lecteur', {
      grants: ['crm.manage', 'work.update'],
      reason: 'Relances terrain',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const evt = (await audits(org, 'lecteur', 'member.permissions_changed')).at(-1) as {
      actorUserId: string;
      actorRole: string;
      metadata: Record<string, Record<string, unknown>>;
    };
    expect(evt.actorUserId).toBe(id('owner'));
    expect(evt.actorRole).toBe('owner');
    expect(evt.metadata['after']).toMatchObject({
      role: 'viewer',
      grants: ['crm.manage', 'work.update'],
      revokes: [],
      canClosePeriods: false,
    });
    expect(evt.metadata['after']!['effective']).toContain('work.update');
    expect(evt.metadata['before']).toMatchObject({ role: 'viewer' });
    expect(evt.metadata['reason']).toBe('Relances terrain');

    const avant = await membership(org, 'lecteur');
    const { AuditService } = await import('../authz/audit.service.js');
    vi.spyOn(app.get(AuditService), 'recordStrict').mockRejectedValueOnce(
      new Error('audit en panne (simulée)'),
    );
    const panne = await ecart('owner', org, 'lecteur', { grants: [] });
    expect(panne.status).toBe(500);
    const apres = await membership(org, 'lecteur');
    expect(apres['grants']).toEqual(avant['grants']);
    expect(apres['permissionsRevision']).toBe(avant['permissionsRevision']);
  }, 60_000);

  // ── Critère 13 : concurrence ────────────────────────────────────────────────

  it('critère 13 — deux écritures sur la même révision : 200 et 409 STALE_REVISION', async () => {
    allumer();
    const rev = await revision('owner', org, 'analyste');
    const envoyer = (grants: Action[]): Promise<request.Response> =>
      Promise.resolve(
        request(serveur())
          .patch(`/organizations/${org}/members/${id('analyste')}/permissions`)
          .set('Cookie', dans('owner', org))
          .send({ grants, revokes: [], expectedRevision: rev }),
      );
    const [a, b] = await Promise.all([envoyer(['crm.manage']), envoyer(['work.manage'])]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.code).toBe('STALE_REVISION');
    expect(await revision('owner', org, 'analyste')).toBe(rev + 1);
  }, 60_000);

  // ── Critère 16 : isolation ──────────────────────────────────────────────────

  it("critère 16 — membre d'une autre organisation → 404 ; non-membre → 404", async () => {
    allumer();
    const ailleurs = await request(serveur())
      .patch(`/organizations/${org}/members/${id('tiersMembre')}/permissions`)
      .set('Cookie', dans('owner', org))
      .send({ grants: ['crm.manage'], revokes: [], expectedRevision: 0 });
    expect(ailleurs.status).toBe(404);
    expect(ailleurs.body.code).toBe('MEMBER_NOT_FOUND');

    const intrus = await request(serveur())
      .patch(`/organizations/${autre}/members/${id('tiersMembre')}/permissions`)
      .set('Cookie', dans('owner', autre))
      .send({ grants: ['crm.manage'], revokes: [], expectedRevision: 0 });
    expect(intrus.status).toBe(404);
    expect((await membership(autre, 'tiersMembre'))['grants'] ?? []).toEqual([]);
  }, 60_000);
});
