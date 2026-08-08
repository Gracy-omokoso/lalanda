// RÈGLES CRITIQUES DE docs/12 — PREUVE BOUT-EN-BOUT (S20a, ADR-0012 §6).
//
// ── Ce que cette suite ajoute aux trois autres ──────────────────────────────────
//
// `permissions.test.ts` prouve la matrice DÉCLARÉE, `routes-coverage.test.ts` que
// chaque route déclare une permission, `rbac-matrix.e2e.test.ts` que le serveur
// refuse réellement rôle par rôle. Aucune des trois ne touche aux règles qui ne
// s'expriment PAS comme une case de matrice — celles qui dépendent de l'état de
// l'organisation ou de la ressource visée :
//
//   R1 — une organisation garde en permanence au moins un propriétaire;
//   R2 — l'approbateur n'est pas le dernier auteur des hypothèses, SAUF s'il est
//        le seul habilité — auquel cas le plan porte la marque `soleApprover`;
//   R4 — tout export réussi laisse une trace dans `audit_events`;
//   révocation immédiate — un membre révoqué perd l'accès à la requête SUIVANTE;
//   invitation expirée — un token périmé ne crée aucune membership;
//   isolation — 403 dans sa propre organisation, 404 dans celle d'un autre.
//
// R3 (double permission clôture/réouverture) et R7 (pas d'escalade à l'invitation)
// sont couvertes par `rbac-matrix.e2e.test.ts`, où elles prolongent naturellement
// les sondes ⚙ et l'attribution de rôle.
//
// ── Une organisation par règle ─────────────────────────────────────────────────
//
// R1 et la révocation MUTENT la composition de l'organisation qu'elles testent
// (transfert de propriété, suppression de membership). Les faire cohabiter dans
// une organisation partagée rendrait chaque assertion dépendante de l'ordre
// d'exécution des `it` — et le premier échec en cascaderait cinq autres, dont on
// ne saurait plus lesquels sont de vrais bugs. Chaque bloc a donc son
// organisation, ses comptes, et ne présuppose rien des autres.

import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

e2eSuite('règles critiques docs/12 appliquées bout en bout (S20a)', () => {
  let app: INestApplication;

  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];

  interface Compte {
    email: string;
    password: string;
    name: string;
    cookies: string[];
    userId: string;
    /** Organisation auto-provisionnée à l'inscription, si le compte en est propriétaire. */
    orgId: string;
  }

  const comptes: Record<string, Compte> = {};

  function serveur(): ReturnType<INestApplication['getHttpServer']> {
    return app.getHttpServer();
  }

  /** Cookies de session + organisation active forcée. */
  function dans(cle: string, orgId: string): string[] {
    return [...comptes[cle]!.cookies, `active_org_id=${orgId}`];
  }

  /**
   * Inscrit un compte et mémorise son id utilisateur.
   *
   * L'id vient de la collection `user` de better-auth : aucune route ne l'expose
   * (`/me/permissions` renvoie le rôle, pas l'identité), et les assertions R2 en
   * ont besoin pour vérifier que `inputsAuthor` désigne la BONNE personne — pas
   * seulement « une chaîne non vide », qui passerait aussi avec l'id de quelqu'un
   * d'autre.
   */
  async function inscrire(cle: string): Promise<Compte> {
    // Minuscules imposées : better-auth normalise l'adresse avant de la stocker,
    // et les clés de ce scénario sont en camelCase (`duoOwner`). Sans ce
    // `toLowerCase()`, la relecture du document `user` — et surtout la purge du
    // `afterAll`, qui filtre sur `email` — manqueraient la moitié des comptes.
    const email = `crit-${cle}-${tag}@lalanda-test.local`.toLowerCase();
    emails.push(email);
    const identite = { email, password: `Passw0rd!${cle}`, name: `Crit ${cle}` };
    const cookies = await registerAndLogin(app, identite);

    const db = await dbOf(app);
    const doc = await db.collection('user').findOne({ email });
    if (!doc) throw new Error(`Utilisateur ${email} introuvable après inscription.`);

    const orgs = await request(serveur()).get('/organizations').set('Cookie', cookies);
    expect(orgs.status).toBe(200);

    const compte: Compte = {
      ...identite,
      cookies,
      userId: String(doc._id),
      orgId: (orgs.body.organizations as { id: string }[])[0]?.id ?? '',
    };
    comptes[cle] = compte;
    return compte;
  }

  /** Invite `cle` au rôle demandé dans `orgId`, puis fait accepter l'invitation. */
  async function rejoindre(hote: string, orgId: string, cle: string, role: string): Promise<void> {
    const invitation = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', comptes[hote]!.cookies)
      .send({ email: comptes[cle]!.email, role });
    expect(
      invitation.status,
      `invitation ${cle}=${role} : ${invitation.status} ${JSON.stringify(invitation.body)}`,
    ).toBe(201);

    const acceptation = await request(serveur())
      .post('/invitations/accept')
      .set('Cookie', comptes[cle]!.cookies)
      .send({ token: invitation.body.token });
    expect(
      acceptation.status,
      `acceptation ${cle} : ${acceptation.status} ${JSON.stringify(acceptation.body)}`,
    ).toBe(201);
  }

  /** Projet `hello-world` créé par `cle` dans `orgId`. Renvoie son id. */
  async function creerProjet(cle: string, orgId: string, nom: string): Promise<string> {
    const res = await request(serveur())
      .post('/projects')
      .set('Cookie', dans(cle, orgId))
      .send({
        name: `${nom} ${tag}`,
        templateSlug: 'hello-world',
        driverValues: { prix_unitaire: 10, quantite_mois: 100 },
      });
    expect(res.status, `création projet « ${nom} » : ${JSON.stringify(res.body)}`).toBe(201);
    return res.body.id as string;
  }

  /** Saisie d'hypothèses — c'est elle qui positionne `driversUpdatedBy` (R2). */
  async function saisirHypotheses(
    cle: string,
    orgId: string,
    projetId: string,
    valeurs: Record<string, number>,
  ): Promise<void> {
    const res = await request(serveur())
      .post(`/projects/${projetId}/drivers`)
      .set('Cookie', dans(cle, orgId))
      .send({ driverValues: valeurs });
    expect(res.status, `saisie par ${cle} : ${JSON.stringify(res.body)}`).toBe(201);
  }

  /** Le plan `free` plafonne à un projet (S16b) — sans rapport avec l'autorisation. */
  async function planPro(orgId: string): Promise<void> {
    const { BillingService } = await import('../billing/billing.service.js');
    await app.get(BillingService).setPlan(orgId, 'pro');
  }

  // ── Organisations du scénario ────────────────────────────────────────────────
  //
  // `solo`   — entrepreneur seul, UNIQUE membre `owner`. Jamais rejointe.
  // `duo`    — `duoOwner` (owner) + `duoApprover` (finance_director) + `duoViewer`.
  // `r1`     — `r1Owner` (owner) + `r1Admin` (admin), pour le dernier propriétaire.
  // `revoc`  — `revOwner` (owner) + `revMembre` (finance_director), pour la révocation.
  let orgSolo = '';
  let orgDuo = '';
  let orgR1 = '';
  let orgRevoc = '';

  let projetSolo = '';
  let projetDuo = '';
  let projetRevoc = '';

  beforeAll(async () => {
    app = await makeE2EApp();

    // ── L'entrepreneur seul ───────────────────────────────────────────────────
    // Aucune invitation : son organisation auto-provisionnée le compte pour seul
    // membre, et il en est `owner`. C'est exactement la situation de production
    // majoritaire en RDC, et c'est ce qui rend `countApprovers() === 1`.
    orgSolo = (await inscrire('solo')).orgId;
    await planPro(orgSolo);
    projetSolo = await creerProjet('solo', orgSolo, 'Boutique Kinshasa');

    // ── L'organisation à deux approbateurs ────────────────────────────────────
    orgDuo = (await inscrire('duoOwner')).orgId;
    await inscrire('duoApprover');
    await inscrire('duoViewer');
    await planPro(orgDuo);
    await rejoindre('duoOwner', orgDuo, 'duoApprover', 'finance_director');
    await rejoindre('duoOwner', orgDuo, 'duoViewer', 'viewer');
    projetDuo = await creerProjet('duoOwner', orgDuo, 'Coopérative Goma');

    // ── R1 — dernier propriétaire ─────────────────────────────────────────────
    orgR1 = (await inscrire('r1Owner')).orgId;
    await inscrire('r1Admin');
    await rejoindre('r1Owner', orgR1, 'r1Admin', 'admin');

    // ── Révocation immédiate ──────────────────────────────────────────────────
    orgRevoc = (await inscrire('revOwner')).orgId;
    await inscrire('revMembre');
    await planPro(orgRevoc);
    await rejoindre('revOwner', orgRevoc, 'revMembre', 'finance_director');
    projetRevoc = await creerProjet('revOwner', orgRevoc, 'Transport Lubumbashi');
  }, 180_000);

  afterAll(async () => {
    await teardown(app, emails);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // R2 — PARCOURS ENTREPRENEUR SEUL
  //
  // La règle bloquante du lot. Sans l'échappatoire `soleApprover`, un compte solo
  // ne pourrait JAMAIS valider son plan : il est nécessairement l'auteur de ses
  // propres hypothèses, donc éternellement refusé par la séparation des tâches.
  // Le produit serait inutilisable pour son utilisateur type.
  // ═══════════════════════════════════════════════════════════════════════════

  it("R2 — l'entrepreneur seul saisit SES hypothèses et valide SON plan (201)", async () => {
    const solo = comptes['solo']!;

    // Il saisit lui-même : après cette écriture, `driversUpdatedBy` porte SON id.
    // C'est la configuration que la séparation des tâches refuse pour tout le
    // monde sauf lui.
    await saisirHypotheses('solo', orgSolo, projetSolo, {
      prix_unitaire: 15,
      quantite_mois: 120,
    });

    const validation = await request(serveur())
      .post(`/projects/${projetSolo}/plans`)
      .set('Cookie', dans('solo', orgSolo))
      .send({});

    expect(
      validation.status,
      `l'entrepreneur seul DOIT pouvoir valider son plan — reçu ${validation.status} ` +
        `${JSON.stringify(validation.body)}`,
    ).toBe(201);
    expect(validation.body.version).toBe(1);

    // La marque, et pas seulement le succès : un 201 sans `soleApprover: true`
    // signifierait que la séparation des tâches a été contournée en silence.
    expect(validation.body.approval).toEqual({
      soleApprover: true,
      inputsAuthor: solo.userId,
    });
  }, 60_000);

  it('R2 — la marque `soleApprover` survit à la relecture du snapshot', async () => {
    const solo = comptes['solo']!;

    // « Information de bancabilité, pas un détail technique » (ADR-0012 §6) : elle
    // doit être lisible par qui consulte le plan — l'entrepreneur, son mentor, son
    // banquier — et pas seulement présente dans la réponse à la validation.
    const detail = await request(serveur())
      .get(`/projects/${projetSolo}/plans/1`)
      .set('Cookie', dans('solo', orgSolo));
    expect(detail.status).toBe(200);
    expect(detail.body.approval).toEqual({ soleApprover: true, inputsAuthor: solo.userId });

    const liste = await request(serveur())
      .get(`/projects/${projetSolo}/plans`)
      .set('Cookie', dans('solo', orgSolo));
    expect(liste.status).toBe(200);
    const v1 = (liste.body.plans as { version: number; approval: unknown }[]).find(
      (p) => p.version === 1,
    );
    expect(v1?.approval).toEqual({ soleApprover: true, inputsAuthor: solo.userId });
  }, 30_000);

  it("R2 — l'auto-approbation de l'entrepreneur seul est tracée dans `audit_events`", async () => {
    const solo = comptes['solo']!;

    const journal = await request(serveur())
      .get('/audit-events')
      .set('Cookie', dans('solo', orgSolo));
    expect(journal.status).toBe(200);

    const events = journal.body.events as {
      action: string;
      actorUserId: string;
      metadata: Record<string, unknown>;
    }[];
    const approbation = events.find(
      (e) => e.action === 'plan.approve' && e.metadata['projectId'] === projetSolo,
    );

    expect(
      approbation,
      'ADR-0012 §6 R2 : la marque `soleApprover` va dans le snapshot ET dans le journal.',
    ).toBeDefined();
    expect(approbation!.actorUserId).toBe(solo.userId);
    expect(approbation!.metadata['soleApprover']).toBe(true);
    expect(approbation!.metadata['inputsAuthor']).toBe(solo.userId);
    expect(approbation!.metadata['version']).toBe(1);
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // R2 — DÈS QU'UN SECOND APPROBATEUR EXISTE, L'ÉCHAPPATOIRE SE REFERME
  // ═══════════════════════════════════════════════════════════════════════════

  it('R2 — avec deux approbateurs, le saisisseur ne valide plus (409 SELF_APPROVAL_FORBIDDEN)', async () => {
    // Même geste que l'entrepreneur seul — saisir puis valider — dans une
    // organisation qui compte un second `plan.approve`. C'est le comptage des
    // approbateurs, et rien d'autre, qui fait basculer la décision.
    await saisirHypotheses('duoOwner', orgDuo, projetDuo, {
      prix_unitaire: 21,
      quantite_mois: 140,
    });

    const refus = await request(serveur())
      .post(`/projects/${projetDuo}/plans`)
      .set('Cookie', dans('duoOwner', orgDuo))
      .send({});

    expect(refus.status, JSON.stringify(refus.body)).toBe(409);
    expect(refus.body.code ?? refus.body.message?.code).toBe('SELF_APPROVAL_FORBIDDEN');

    // Le refus ne doit rien avoir figé : une version créée puis « annulée » par
    // une exception laisserait un plan fantôme dans l'historique bancable.
    const liste = await request(serveur())
      .get(`/projects/${projetDuo}/plans`)
      .set('Cookie', dans('duoOwner', orgDuo));
    expect(liste.status).toBe(200);
    expect(liste.body.plans).toHaveLength(0);
  }, 60_000);

  it("R2 — l'autre approbateur valide le même plan, sans marque d'auto-approbation", async () => {
    const duoOwner = comptes['duoOwner']!;

    const validation = await request(serveur())
      .post(`/projects/${projetDuo}/plans`)
      .set('Cookie', dans('duoApprover', orgDuo))
      .send({});

    expect(validation.status, JSON.stringify(validation.body)).toBe(201);
    // Séparation effective : l'auteur des hypothèses reste nommé — la traçabilité
    // ne disparaît pas quand la règle est respectée — mais la marque tombe.
    expect(validation.body.approval).toEqual({
      soleApprover: false,
      inputsAuthor: duoOwner.userId,
    });
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // R1 — DERNIER PROPRIÉTAIRE
  // ═══════════════════════════════════════════════════════════════════════════

  it('R1 — le dernier propriétaire est signalé comme tel dans la liste des membres', async () => {
    const r1Owner = comptes['r1Owner']!;

    const membres = await request(serveur())
      .get(`/organizations/${orgR1}/members`)
      .set('Cookie', dans('r1Owner', orgR1));
    expect(membres.status).toBe(200);

    const lignes = membres.body.members as { userId: string; role: string; isLastOwner: boolean }[];
    const proprietaire = lignes.find((m) => m.userId === r1Owner.userId);
    expect(proprietaire?.role).toBe('owner');
    // L'UI a besoin de cette information pour ne pas proposer un bouton qui
    // échouera. Le serveur refuse de toute façon — voir les deux tests suivants.
    expect(proprietaire?.isLastOwner).toBe(true);
    expect(lignes.find((m) => m.userId === comptes['r1Admin']!.userId)?.isLastOwner).toBe(false);
  }, 30_000);

  it('R1 — le dernier propriétaire ne peut pas se rétrograder (409 LAST_OWNER)', async () => {
    const r1Owner = comptes['r1Owner']!;

    const refus = await request(serveur())
      .patch(`/organizations/${orgR1}/members/${r1Owner.userId}/role`)
      .set('Cookie', dans('r1Owner', orgR1))
      .send({ role: 'admin' });

    expect(refus.status, JSON.stringify(refus.body)).toBe(409);
    expect(refus.body.code ?? refus.body.message?.code).toBe('LAST_OWNER');

    // La transaction a bien été annulée : le rôle en base est intact. Sans cette
    // vérification, un 409 levé APRÈS une écriture non annulée passerait au vert.
    const membres = await request(serveur())
      .get(`/organizations/${orgR1}/members`)
      .set('Cookie', dans('r1Owner', orgR1));
    const lignes = membres.body.members as { userId: string; role: string }[];
    expect(lignes.find((m) => m.userId === r1Owner.userId)?.role).toBe('owner');
  }, 30_000);

  it('R1 — le dernier propriétaire ne peut pas être révoqué (409 LAST_OWNER)', async () => {
    const r1Owner = comptes['r1Owner']!;

    const refus = await request(serveur())
      .delete(`/organizations/${orgR1}/members/${r1Owner.userId}`)
      .set('Cookie', dans('r1Owner', orgR1));

    expect(refus.status, JSON.stringify(refus.body)).toBe(409);
    expect(refus.body.code ?? refus.body.message?.code).toBe('LAST_OWNER');

    const membres = await request(serveur())
      .get(`/organizations/${orgR1}/members`)
      .set('Cookie', dans('r1Owner', orgR1));
    expect((membres.body.members as { userId: string }[]).map((m) => m.userId)).toContain(
      r1Owner.userId,
    );
  }, 30_000);

  it("R1 — un `admin` ne peut pas rétrograder l'`owner` (403 ROLE_ESCALATION)", async () => {
    // R7 appliqué à la rétrogradation : ce qu'on n'a pas pu nommer, on ne doit pas
    // pouvoir le défaire. Sans ce contrôle, R1 se contournerait en deux temps —
    // rétrograder l'owner, puis se promouvoir.
    const refus = await request(serveur())
      .patch(`/organizations/${orgR1}/members/${comptes['r1Owner']!.userId}/role`)
      .set('Cookie', dans('r1Admin', orgR1))
      .send({ role: 'viewer' });

    expect(refus.status, JSON.stringify(refus.body)).toBe(403);
    expect(refus.body.code ?? refus.body.message?.code).toBe('ROLE_ESCALATION');
  }, 30_000);

  it('R1 — le transfert de propriété est le seul chemin, et il est atomique', async () => {
    const r1Owner = comptes['r1Owner']!;
    const r1Admin = comptes['r1Admin']!;

    const transfert = await request(serveur())
      .post(`/organizations/${orgR1}/transfer-ownership`)
      .set('Cookie', dans('r1Owner', orgR1))
      .send({ userId: r1Admin.userId });

    expect(transfert.status, JSON.stringify(transfert.body)).toBe(201);
    expect(transfert.body.newOwner.userId).toBe(r1Admin.userId);
    expect(transfert.body.newOwner.role).toBe('owner');
    // L'ancien propriétaire devient `admin` : il garde membres et projets, il perd
    // l'abonnement et la validation. Jamais deux appels — la promotion et la
    // rétrogradation partagent la même transaction, donc jamais zéro propriétaire.
    expect(transfert.body.previousOwner.role).toBe('admin');

    const membres = await request(serveur())
      .get(`/organizations/${orgR1}/members`)
      .set('Cookie', dans('r1Admin', orgR1));
    const lignes = membres.body.members as { userId: string; role: string; isLastOwner: boolean }[];
    expect(lignes.filter((m) => m.role === 'owner')).toHaveLength(1);
    expect(lignes.find((m) => m.userId === r1Admin.userId)?.isLastOwner).toBe(true);
    expect(lignes.find((m) => m.userId === r1Owner.userId)?.role).toBe('admin');
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // RÉVOCATION IMMÉDIATE
  // ═══════════════════════════════════════════════════════════════════════════

  it('révocation immédiate — le membre perd l’accès dès la requête suivante', async () => {
    const revMembre = comptes['revMembre']!;

    // Avant : la session lit le projet de l'organisation.
    const avant = await request(serveur())
      .get(`/projects/${projetRevoc}`)
      .set('Cookie', dans('revMembre', orgRevoc));
    expect(avant.status, JSON.stringify(avant.body)).toBe(200);

    const revocation = await request(serveur())
      .delete(`/organizations/${orgRevoc}/members/${revMembre.userId}`)
      .set('Cookie', dans('revOwner', orgRevoc));
    expect(revocation.status, JSON.stringify(revocation.body)).toBe(200);

    // Après : MÊME session, MÊMES cookies, aucune reconnexion. Le contrôle
    // d'appartenance est refait à chaque requête — il n'y a pas de rôle mis en
    // cache dans le cookie qui survivrait à la révocation.
    const apres = await request(serveur())
      .get(`/projects/${projetRevoc}`)
      .set('Cookie', dans('revMembre', orgRevoc));
    expect(
      apres.status,
      `un membre révoqué doit perdre l'accès immédiatement — reçu ${apres.status}`,
    ).toBe(404);

    // Et l'organisation disparaît de sa liste : le cookie `active_org_id` pointant
    // vers une org dont il n'est plus membre est ignoré, pas honoré.
    const orgs = await request(serveur()).get('/organizations').set('Cookie', revMembre.cookies);
    expect(orgs.status).toBe(200);
    expect((orgs.body.organizations as { id: string }[]).map((o) => o.id)).not.toContain(orgRevoc);
  }, 60_000);

  it('révocation immédiate — la révocation elle-même est journalisée', async () => {
    const journal = await request(serveur())
      .get('/audit-events')
      .set('Cookie', dans('revOwner', orgRevoc));
    expect(journal.status).toBe(200);

    const evenement = (journal.body.events as { action: string; targetId: string }[]).find(
      (e) => e.action === 'member.revoked' && e.targetId === comptes['revMembre']!.userId,
    );
    expect(evenement).toBeDefined();
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // INVITATION EXPIRÉE
  // ═══════════════════════════════════════════════════════════════════════════

  it("invitation expirée — le token périmé ne crée aucune membership (400 INVITATION_EXPIRED)", async () => {
    await inscrire('invitePerime');
    const invite = comptes['invitePerime']!;

    const invitation = await request(serveur())
      .post(`/organizations/${orgDuo}/invitations`)
      .set('Cookie', comptes['duoOwner']!.cookies)
      .send({ email: invite.email, role: 'viewer' });
    expect(invitation.status, JSON.stringify(invitation.body)).toBe(201);

    // On force l'expiration en base plutôt que d'attendre sept jours. C'est la
    // seule écriture directe de la suite, et elle ne contourne aucune règle : elle
    // fabrique l'ÉTAT « invitation périmée », que le code de production produirait
    // par simple écoulement du temps.
    const db = await dbOf(app);
    const { ObjectId } = await import('mongodb');
    const maj = await db
      .collection('invitations')
      .updateOne(
        { _id: new ObjectId(invitation.body.invitation.id as string) },
        { $set: { expiresAt: new Date(Date.now() - 60_000) } },
      );
    expect(maj.matchedCount).toBe(1);

    const refus = await request(serveur())
      .post('/invitations/accept')
      .set('Cookie', invite.cookies)
      .send({ token: invitation.body.token });

    expect(refus.status, JSON.stringify(refus.body)).toBe(400);
    expect(refus.body.code ?? refus.body.message?.code).toBe('INVITATION_EXPIRED');

    // Aucune membership n'a été créée — le refus n'est pas qu'un code de retour.
    const membres = await request(serveur())
      .get(`/organizations/${orgDuo}/members`)
      .set('Cookie', comptes['duoOwner']!.cookies);
    expect((membres.body.members as { userId: string }[]).map((m) => m.userId)).not.toContain(
      invite.userId,
    );
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // R4 — EXPORTS JOURNALISÉS
  // ═══════════════════════════════════════════════════════════════════════════

  it('R4 — un export réussi écrit sa trace dans `audit_events`', async () => {
    const duoApprover = comptes['duoApprover']!;

    const avant = await request(serveur())
      .get('/audit-events')
      .set('Cookie', dans('duoOwner', orgDuo));
    const exportsAvant = (avant.body.events as { action: string }[]).filter(
      (e) => e.action === 'report.export',
    ).length;

    const xlsx = await request(serveur())
      .get(`/projects/${projetDuo}/report/xlsx`)
      .set('Cookie', dans('duoApprover', orgDuo));
    expect(xlsx.status, `export xlsx : ${xlsx.status}`).toBe(200);

    const apres = await request(serveur())
      .get('/audit-events')
      .set('Cookie', dans('duoOwner', orgDuo));
    const traces = (
      apres.body.events as {
        action: string;
        actorUserId: string;
        actorRole: string;
        targetId: string;
        metadata: Record<string, unknown>;
      }[]
    ).filter((e) => e.action === 'report.export');

    expect(traces.length).toBe(exportsAvant + 1);
    const trace = traces[0]!;
    expect(trace.actorUserId).toBe(duoApprover.userId);
    expect(trace.actorRole).toBe('finance_director');
    expect(trace.targetId).toBe(projetDuo);
    expect(trace.metadata['format']).toBe('xlsx');
    // Le journal dit QUI a exporté QUOI, jamais les montants (docs/17 §Journalisation).
    expect(typeof trace.metadata['bytes']).toBe('number');
    expect(trace.metadata['bytes']).toBeGreaterThan(0);
  }, 90_000);

  it("R4 — un export REFUSÉ ne laisse aucune trace (le Conseiller n'exporte pas)", async () => {
    // Le `viewer` n'a pas `report.export` : le guard refuse avant le contrôleur,
    // donc avant `journaliserExport`. Une trace ici signifierait que le journal
    // enregistre des exports qui n'ont pas eu lieu — un journal qui ment sur des
    // fichiers sortis de l'organisation est pire qu'un journal absent.
    const refus = await request(serveur())
      .get(`/projects/${projetDuo}/report/xlsx`)
      .set('Cookie', dans('duoViewer', orgDuo));
    expect(refus.status, JSON.stringify(refus.body)).toBe(403);

    const journal = await request(serveur())
      .get('/audit-events')
      .set('Cookie', dans('duoOwner', orgDuo));
    const parLecteur = (journal.body.events as { action: string; actorUserId: string }[]).filter(
      (e) => e.action === 'report.export' && e.actorUserId === comptes['duoViewer']!.userId,
    );
    expect(parLecteur).toHaveLength(0);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // ISOLATION — 403 CHEZ SOI, 404 AILLEURS
  // ═══════════════════════════════════════════════════════════════════════════

  it('isolation — rôle insuffisant DANS SA PROPRE organisation → 403 nommant l’action', async () => {
    // Le `viewer` est bien membre : lui répondre 404 lui cacherait une ressource
    // dont il connaît déjà l'existence, et transformerait un refus explicable en
    // énigme (ADR-0012 §8).
    const refus = await request(serveur())
      .get(`/organizations/${orgDuo}/members`)
      .set('Cookie', dans('duoViewer', orgDuo));

    expect(refus.status, JSON.stringify(refus.body)).toBe(403);
    const corps = refus.body.code ? refus.body : refus.body.message;
    expect(corps.code).toBe('FORBIDDEN');
    expect(corps.action).toBe('organization.manage');
    expect(corps.role).toBe('viewer');
  }, 30_000);

  it("isolation — organisation d'un tiers → 404, jamais 403", async () => {
    // Un 403 confirmerait l'existence de l'organisation `solo` à quelqu'un qui n'y
    // a rien à faire. Le propriétaire est pourtant tout-puissant CHEZ LUI : c'est
    // la preuve que le guard évalue le rôle dans l'organisation VISÉE par la route,
    // et non dans l'organisation active de l'appelant.
    const refus = await request(serveur())
      .get(`/organizations/${orgSolo}/members`)
      .set('Cookie', comptes['duoOwner']!.cookies);

    expect(refus.status, JSON.stringify(refus.body)).toBe(404);
    expect(refus.body.code ?? refus.body.message?.code).toBe('ORG_NOT_FOUND');
  }, 30_000);

  it("isolation — le plan validé d'une autre organisation reste invisible (404)", async () => {
    const fuite = await request(serveur())
      .get(`/projects/${projetSolo}/plans/1`)
      .set('Cookie', dans('duoOwner', orgDuo));
    expect(fuite.status).toBe(404);

    // Et le journal d'audit ne franchit pas la frontière non plus : `duoOwner` ne
    // doit voir aucun événement portant sur l'organisation `solo`.
    const journal = await request(serveur())
      .get('/audit-events')
      .set('Cookie', dans('duoOwner', orgDuo));
    expect(journal.status).toBe(200);
    const fuites = (journal.body.events as { metadata: Record<string, unknown> }[]).filter(
      (e) => e.metadata['projectId'] === projetSolo,
    );
    expect(fuites).toHaveLength(0);
  }, 30_000);
});
