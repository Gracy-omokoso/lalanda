// ADR-0041 — A2 : écarts (ajouts et retraits) lus par la garde, `/me/permissions` et
// le comptage des approbateurs, PREUVE BOUT EN BOUT.
//
// Aucune route d'écriture des écarts n'existe encore (lot A4) : ce fichier les écrit
// DIRECTEMENT dans `memberships`, comme le ferait une future instance, puis vérifie :
//
//   - interrupteur ÉTEINT (défaut) : un écart stocké est sans effet — l'application se
//     comporte exactement comme avant ADR-0041 ;
//   - interrupteur ALLUMÉ : un retrait ferme la route (403 qui nomme l'action, avec
//     `customized: true`), un ajout l'ouvre, `/me/permissions` reflète l'écart à la
//     requête suivante, sans reconnexion ;
//   - critère 1 : sans écart, `/me/permissions` = la ligne de la matrice ;
//   - critère 8 : `countApprovers` compte les détenteurs EFFECTIFS de `plan.approve` ;
//   - critère 17 : une appartenance sans les champs nouveaux vaut exactement le titre ;
//   - `GET /authz/catalog` : authentifié, sans permission.

import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { actionsOf, type Action, type OrgRole } from '../authz/permissions.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

e2eSuite('ADR-0041 A2 — écarts lus par la garde et /me/permissions', () => {
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

  function allumer(): void {
    process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
  }
  function eteindre(): void {
    delete process.env['MEMBER_PERMISSIONS_ENABLED'];
  }

  async function inscrire(cle: string): Promise<Compte> {
    const email = `a2-${cle}-${tag}@lalanda-test.local`.toLowerCase();
    emails.push(email);
    const cookies = await registerAndLogin(app, {
      email,
      password: `Passw0rd!${cle}`,
      name: `A2 ${cle}`,
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

  /** Écrit l'écart directement en base — aucune route d'écriture avant A4. */
  async function ecrireEcart(
    cle: string,
    orgId: string,
    ecart: { grants?: Action[]; revokes?: Action[] },
  ): Promise<void> {
    const db = await dbOf(app);
    const res = await db
      .collection('memberships')
      .updateOne(
        { userId: comptes[cle]!.userId, organizationId: orgId },
        { $set: { grants: ecart.grants ?? [], revokes: ecart.revokes ?? [] } },
      );
    expect(res.matchedCount).toBe(1);
  }

  async function planPro(orgId: string): Promise<void> {
    const { BillingService } = await import('../billing/billing.service.js');
    await app.get(BillingService).setPlan(orgId, 'pro');
  }

  // `equipe`   — owner + sales_rep + viewer + accountant : routes et /me/permissions.
  // `duoFd`    — owner + finance_director privé de `plan.approve` (critère 8).
  // `duoLect`  — owner + viewer ayant reçu `plan.approve` (critère 8).
  let orgEquipe = '';
  let orgDuoFd = '';
  let orgDuoLect = '';

  beforeAll(async () => {
    app = await makeE2EApp();

    orgEquipe = (await inscrire('owner')).orgId;
    await inscrire('commercial');
    await inscrire('lecteur');
    await inscrire('comptable');
    await planPro(orgEquipe);
    await rejoindre('owner', orgEquipe, 'commercial', 'sales_rep');
    await rejoindre('owner', orgEquipe, 'lecteur', 'viewer');
    await rejoindre('owner', orgEquipe, 'comptable', 'accountant');

    orgDuoFd = (await inscrire('fdOwner')).orgId;
    await inscrire('fd');
    await planPro(orgDuoFd);
    await rejoindre('fdOwner', orgDuoFd, 'fd', 'finance_director');

    orgDuoLect = (await inscrire('lectOwner')).orgId;
    await inscrire('lectApprobateur');
    await planPro(orgDuoLect);
    await rejoindre('lectOwner', orgDuoLect, 'lectApprobateur', 'viewer');
  }, E2E_HOOK_TIMEOUT_MS);

  afterEach(() => {
    eteindre();
  });

  afterAll(async () => {
    if (INTERRUPTEUR === undefined) eteindre();
    else process.env['MEMBER_PERMISSIONS_ENABLED'] = INTERRUPTEUR;
    await teardown(app, emails);
  }, E2E_HOOK_TIMEOUT_MS);

  // ── Critères 1 et 17 : sans écart, exactement le titre ──────────────────────

  it('critères 1 et 17 — sans écart (champs absents), /me/permissions = ligne du rôle', async () => {
    allumer();
    const db = await dbOf(app);
    // Appartenance « d'avant ADR-0041 » : les champs nouveaux n'existent pas du tout.
    await db
      .collection('memberships')
      .updateOne(
        { userId: comptes['comptable']!.userId, organizationId: orgEquipe },
        { $unset: { grants: '', revokes: '', permissionsRevision: '' } },
      );
    const roles: Record<string, OrgRole> = {
      owner: 'owner',
      commercial: 'sales_rep',
      lecteur: 'viewer',
      comptable: 'accountant',
    };
    for (const [cle, role] of Object.entries(roles)) {
      const res = await request(serveur())
        .get('/me/permissions')
        .set('Cookie', dans(cle, orgEquipe));
      expect(res.status, cle).toBe(200);
      const ligne = actionsOf(role, { canClosePeriods: false });
      expect(res.body.role).toBe(role);
      expect(res.body.actions, cle).toEqual(ligne);
      expect(res.body.roleActions, cle).toEqual(ligne);
      expect(res.body.grants).toEqual([]);
      expect(res.body.revokes).toEqual([]);
      expect(res.body.customized).toBe(false);
      expect(res.body.permissionsRevision).toBe(0);
      expect(res.body.grantableActions).not.toContain('billing.manage');
    }
  }, 60_000);

  // ── Un ajout ouvre la route ──────────────────────────────────────────────────

  it('ajout `treasury.read` à un Commercial : sans effet interrupteur éteint, 200 allumé', async () => {
    const avant = await request(serveur())
      .get('/treasury/accounts')
      .set('Cookie', dans('commercial', orgEquipe));
    expect(avant.status).toBe(403);
    expect(avant.body.action).toBe('treasury.read');
    expect(avant.body.customized).toBe(false);

    await ecrireEcart('commercial', orgEquipe, { grants: ['treasury.read'] });

    // Éteint : l'écart stocké est ignoré, comme avant ADR-0041.
    const eteint = await request(serveur())
      .get('/treasury/accounts')
      .set('Cookie', dans('commercial', orgEquipe));
    expect(eteint.status).toBe(403);
    const moiEteint = await request(serveur())
      .get('/me/permissions')
      .set('Cookie', dans('commercial', orgEquipe));
    expect(moiEteint.body.actions).not.toContain('treasury.read');
    expect(moiEteint.body.grants).toEqual([]);
    expect(moiEteint.body.customized).toBe(false);

    // Allumé : la requête suivante, sans reconnexion, est autorisée.
    allumer();
    const apres = await request(serveur())
      .get('/treasury/accounts')
      .set('Cookie', dans('commercial', orgEquipe));
    expect(apres.status, JSON.stringify(apres.body)).toBe(200);

    const moi = await request(serveur())
      .get('/me/permissions')
      .set('Cookie', dans('commercial', orgEquipe));
    expect(moi.body.actions).toContain('treasury.read');
    expect(moi.body.roleActions).not.toContain('treasury.read');
    expect(moi.body.grants).toEqual(['treasury.read']);
    expect(moi.body.revokes).toEqual([]);
    expect(moi.body.customized).toBe(true);
    expect(moi.body.grantableActions).toContain('treasury.read');
  }, 60_000);

  // ── Un retrait ferme la route ────────────────────────────────────────────────

  it('retrait `treasury.read` à un Lecteur : 403 qui nomme l’action, `customized: true`', async () => {
    const avant = await request(serveur())
      .get('/treasury/accounts')
      .set('Cookie', dans('lecteur', orgEquipe));
    expect(avant.status).toBe(200);

    await ecrireEcart('lecteur', orgEquipe, { revokes: ['treasury.read'] });

    const eteint = await request(serveur())
      .get('/treasury/accounts')
      .set('Cookie', dans('lecteur', orgEquipe));
    expect(eteint.status).toBe(200);

    allumer();
    const refus = await request(serveur())
      .get('/treasury/accounts')
      .set('Cookie', dans('lecteur', orgEquipe));
    expect(refus.status).toBe(403);
    expect(refus.body).toMatchObject({
      code: 'FORBIDDEN',
      action: 'treasury.read',
      role: 'viewer',
      customized: true,
    });

    // Les autres droits du titre restent intacts.
    const ventes = await request(serveur())
      .get('/sales/customers')
      .set('Cookie', dans('lecteur', orgEquipe));
    expect(ventes.status, JSON.stringify(ventes.body)).not.toBe(403);

    const moi = await request(serveur())
      .get('/me/permissions')
      .set('Cookie', dans('lecteur', orgEquipe));
    expect(moi.body.actions).not.toContain('treasury.read');
    expect(moi.body.roleActions).toContain('treasury.read');
    expect(moi.body.revokes).toEqual(['treasury.read']);
    expect(moi.body.customized).toBe(true);
  }, 60_000);

  // ── Critère 8 : séparation des tâches dynamique sur les détenteurs effectifs ──

  async function saisirEtValider(cle: string, orgId: string, nom: string) {
    const projet = await request(serveur())
      .post('/projects')
      .set('Cookie', dans(cle, orgId))
      .send({
        name: `${nom} ${tag}`,
        templateSlug: 'hello-world',
        driverValues: { prix_unitaire: 10, quantite_mois: 100 },
      });
    expect(projet.status, JSON.stringify(projet.body)).toBe(201);
    const id = projet.body.id as string;
    const saisie = await request(serveur())
      .post(`/projects/${id}/drivers`)
      .set('Cookie', dans(cle, orgId))
      .send({ driverValues: { prix_unitaire: 12, quantite_mois: 110 } });
    expect(saisie.status, JSON.stringify(saisie.body)).toBe(201);
    return {
      id,
      valider: () =>
        request(serveur()).post(`/projects/${id}/plans`).set('Cookie', dans(cle, orgId)).send({}),
    };
  }

  it('critère 8 — Propriétaire + Directeur financier privé de `plan.approve` : auto-approbation marquée', async () => {
    await ecrireEcart('fd', orgDuoFd, { revokes: ['plan.approve'] });
    const { valider } = await saisirEtValider('fdOwner', orgDuoFd, 'Duo FD');

    // Éteint : deux approbateurs par rôle, l'auto-approbation est refusée (comme avant).
    const eteint = await valider();
    expect(eteint.status, JSON.stringify(eteint.body)).toBe(409);
    expect(eteint.body.code ?? eteint.body.message?.code).toBe('SELF_APPROVAL_FORBIDDEN');

    // Allumé : le Directeur financier ne détient plus `plan.approve` — approbateur unique.
    allumer();
    const ok = await valider();
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.approval).toEqual({
      soleApprover: true,
      inputsAuthor: comptes['fdOwner']!.userId,
    });
  }, 90_000);

  it('critère 8 — Propriétaire + Lecteur ayant reçu `plan.approve` : 409 SELF_APPROVAL_FORBIDDEN', async () => {
    await ecrireEcart('lectApprobateur', orgDuoLect, { grants: ['plan.approve'] });
    allumer();
    const { valider } = await saisirEtValider('lectOwner', orgDuoLect, 'Duo Lecteur');
    const refus = await valider();
    expect(refus.status, JSON.stringify(refus.body)).toBe(409);
    expect(refus.body.code ?? refus.body.message?.code).toBe('SELF_APPROVAL_FORBIDDEN');
  }, 90_000);

  // ── Isolation : l'écart appartient à UNE appartenance ─────────────────────────

  it('l’écart d’une organisation ne s’applique pas dans une autre', async () => {
    allumer();
    // Le Commercial a reçu `treasury.read` dans `equipe` ; dans sa propre organisation
    // (dont il est propriétaire), son appartenance n'a aucun écart.
    const moi = await request(serveur())
      .get('/me/permissions')
      .set('Cookie', dans('commercial', comptes['commercial']!.orgId));
    expect(moi.body.role).toBe('owner');
    expect(moi.body.grants).toEqual([]);
  }, 60_000);

  // ── Catalogue ────────────────────────────────────────────────────────────────

  it('GET /authz/catalog : 401 sans session, 200 pour tout membre (sans permission)', async () => {
    const anonyme = await request(serveur()).get('/authz/catalog');
    expect(anonyme.status).toBe(401);

    const res = await request(serveur())
      .get('/authz/catalog')
      .set('Cookie', dans('lecteur', orgEquipe));
    expect(res.status).toBe(200);
    // ADR-0044 § 4.3 : huitième domaine (achats) et troisième paire ; ADR-0045 § 4.5 :
    // neuvième domaine (RH), aucune paire nouvelle.
    expect(res.body.domains).toHaveLength(9);
    expect(res.body.nonDelegable).toEqual(['billing.manage']);
    expect(res.body.sodPairs).toHaveLength(3);
    expect(res.body.labels['sales.invoice']).toBe(
      'Émettre et normaliser les factures et les avoirs',
    );
    expect((res.body.roleMatrix as { role: string }[]).map((r) => r.role)).not.toContain(
      'project_manager',
    );
    // ADR-0045 § 4.2 : le Responsable RH est un titre attribuable (par le Propriétaire).
    const rh = (res.body.roleMatrix as { role: string; label: string; actions: string[] }[]).find(
      (r) => r.role === 'hr_manager',
    );
    expect(rh?.label).toBe('Responsable RH');
    expect(rh?.actions).toHaveLength(8);
  }, 30_000);
});
