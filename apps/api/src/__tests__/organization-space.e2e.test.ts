// ESPACE ORGANISATION BOUT EN BOUT (S21a).
//
// ── Ce que ce fichier prouve, et que rien d'autre ne prouve ──────────────────
//
// `dashboard.test.ts` vérifie que les agrégations pures masquent les bons blocs.
// `routes-coverage.test.ts` vérifie que les quatre routes déclarent une
// permission. Aucun des deux ne prouve que le SERVEUR refuse vraiment, ni — c'est
// le point le plus important ici — que la réponse envoyée à un Lecteur ne
// contient pas, quelque part dans le JSON, un chiffre réservé au Propriétaire.
//
// Ce fichier ouvre sept sessions HTTP réellement authentifiées dans UNE
// organisation peuplée (projet, plan validé, réalisé saisi) et lit ce qui sort
// du réseau. Les assertions portent sur le CORPS DE LA RÉPONSE, pas seulement sur
// le code de statut : un 200 qui fuit est pire qu'un 403.
//
// Isolation inter-organisations : un membre d'une autre organisation qui force le
// cookie `active_org_id` sur celle-ci ne doit jamais en voir le contenu. Le
// comportement attendu n'est pas un 404 mais un REPLI sur sa propre organisation
// (`AuthGuard` ignore un cookie dont l'utilisateur n'est pas membre) — le test
// vérifie donc l'identité de l'organisation servie ET l'absence des noms de
// projets de la voisine.

import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import type { OrgRole } from '../authz/permissions.js';
import { e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

/** Les sept rôles attribuables (`project_manager` ne l'est pas — ADR-0012 §7). */
const ROLES = [
  'owner',
  'admin',
  'finance_director',
  'accountant',
  'analyst',
  'advisor',
  'viewer',
] as const satisfies readonly OrgRole[];

type RoleTeste = (typeof ROLES)[number];

e2eSuite('espace organisation — tableau de bord, paramètres, facturation (S21a)', () => {
  let app: INestApplication;

  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];
  const comptes = {} as Record<RoleTeste, { email: string; password: string; name: string }>;
  const cookies = {} as Record<RoleTeste, string[]>;

  let orgId = '';
  let projetId = '';
  const NOM_PROJET = `Boulangerie ${tag}`;

  /** Organisation VOISINE, sans aucun lien avec la précédente. */
  const voisin = {
    email: `orgspace-voisin-${tag}@lalanda-test.local`,
    password: 'Passw0rd!voisin',
    name: 'Voisin',
  };
  let cookiesVoisin: string[] = [];
  let orgVoisineId = '';
  const NOM_PROJET_VOISIN = `Voisine ${tag}`;

  function serveur(): ReturnType<INestApplication['getHttpServer']> {
    return app.getHttpServer();
  }

  /** Cookies de session + organisation active forcée sur l'organisation partagée. */
  function c(role: RoleTeste): string[] {
    return [...cookies[role], `active_org_id=${orgId}`];
  }

  beforeAll(async () => {
    app = await makeE2EApp();

    for (const role of ROLES) {
      const email = `orgspace-${role}-${tag}@lalanda-test.local`;
      emails.push(email);
      comptes[role] = { email, password: `Passw0rd!${role}`, name: `OrgSpace ${role}` };
    }
    emails.push(voisin.email);

    // ── 1. Propriétaire et son organisation auto-provisionnée ────────────────
    cookies['owner'] = await registerAndLogin(app, comptes['owner']);
    const orgs = await request(serveur()).get('/organizations').set('Cookie', cookies['owner']);
    expect(orgs.status).toBe(200);
    orgId = (orgs.body.organizations as { id: string }[])[0]!.id;

    // Plan `pro` : l'offre `free` plafonne à un projet et le test en crée
    // plusieurs. La limite commerciale n'a rien à voir avec ce qu'on mesure ici.
    const { BillingService } = await import('../billing/billing.service.js');
    await app.get(BillingService).setPlan(orgId, 'pro');

    // ── 2. Un membre par rôle, par le vrai parcours invitation → acceptation ─
    for (const role of ROLES) {
      if (role === 'owner') continue;
      const invitation = await request(serveur())
        .post(`/organizations/${orgId}/invitations`)
        .set('Cookie', cookies['owner'])
        .send({ email: comptes[role].email, role });
      expect(invitation.status, `invitation ${role}`).toBe(201);

      cookies[role] = await registerAndLogin(app, comptes[role]);
      const acceptation = await request(serveur())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: invitation.body.token });
      expect(acceptation.status, `acceptation ${role}`).toBe(201);
    }

    // ── 3. Un projet peuplé : plan validé + réalisé saisi ────────────────────
    const projet = await request(serveur())
      .post('/projects')
      .set('Cookie', c('owner'))
      .send({
        name: NOM_PROJET,
        templateSlug: 'hello-world',
        driverValues: { prix_unitaire: 10, quantite_mois: 100 },
      });
    expect(projet.status, `projet : ${JSON.stringify(projet.body)}`).toBe(201);
    projetId = projet.body.id;

    const plan = await request(serveur())
      .post(`/projects/${projetId}/plans`)
      .set('Cookie', c('owner'))
      .send({});
    expect(plan.status, `plan validé : ${JSON.stringify(plan.body)}`).toBe(201);

    // Deux mois saisis et laissés ouverts : de quoi alimenter « à clôturer ».
    for (const mois of [1, 2]) {
      const periode = await request(serveur())
        .put(`/projects/${projetId}/actual-periods/1/${mois}`)
        .set('Cookie', c('owner'))
        .send({ values: { ca: 500 } });
      expect(periode.status, `période 1/${mois}`).toBe(200);
    }

    // ── 4. L'organisation voisine, avec son propre projet ────────────────────
    cookiesVoisin = await registerAndLogin(app, voisin);
    const orgsVoisin = await request(serveur()).get('/organizations').set('Cookie', cookiesVoisin);
    expect(orgsVoisin.status).toBe(200);
    orgVoisineId = (orgsVoisin.body.organizations as { id: string }[])[0]!.id;
    const projetVoisin = await request(serveur())
      .post('/projects')
      .set('Cookie', [...cookiesVoisin, `active_org_id=${orgVoisineId}`])
      .send({ name: NOM_PROJET_VOISIN, templateSlug: 'hello-world' });
    expect(projetVoisin.status).toBe(201);
  }, 180_000);

  afterAll(async () => {
    await teardown(app, emails);
  }, 60_000);

  function dashboard(role: RoleTeste): request.Test {
    return request(serveur()).get('/organizations/current/dashboard').set('Cookie', c(role));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Le tableau de bord s'ouvre à tous, mais pas au même contenu
  // ───────────────────────────────────────────────────────────────────────────

  it('sert un tableau de bord à CHACUN des sept rôles, sans exception', async () => {
    // La règle de docs/12 reprise par la mission : un Lecteur doit trouver ici un
    // espace utile, pas une page d'erreurs 403.
    for (const role of ROLES) {
      const res = await dashboard(role);
      expect(res.status, `${role} : ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.organization.id, role).toBe(orgId);
      expect(res.body.role, role).toBe(role);
      expect(res.body.roleLabel.length, role).toBeGreaterThan(0);
    }
  });

  it('le Propriétaire voit les quatre blocs', async () => {
    const { body } = await dashboard('owner').expect(200);
    expect(body.sections.gouvernance).not.toBeNull();
    expect(body.sections.validation).not.toBeNull();
    expect(body.sections.comptabilite).not.toBeNull();
    expect(body.sections.projets).not.toBeNull();
    expect(body.masque).toEqual([]);
    expect(body.lectureSeule).toBe(false);

    expect(body.sections.gouvernance.projets).toBeGreaterThanOrEqual(1);
    expect(body.sections.gouvernance.membresActifs).toBe(ROLES.length);
    expect(body.sections.gouvernance.plansValidesCeMois).toBeGreaterThanOrEqual(1);
    expect(body.sections.gouvernance.consommation.plan).toBe('pro');
    // `pro` = projets illimités : la limite doit être `null`, jamais un grand nombre.
    expect(body.sections.gouvernance.consommation.projets.limite).toBeNull();
  });

  it('LE LECTEUR NE VOIT AUCUNE DONNÉE RÉSERVÉE AU PROPRIÉTAIRE', async () => {
    const { body } = await dashboard('viewer').expect(200);

    // 1. Les trois blocs fermés sont ABSENTS, pas vides : `null` prouve que le
    //    serveur ne les a même pas chargés.
    expect(body.sections.gouvernance).toBeNull();
    expect(body.sections.validation).toBeNull();
    expect(body.sections.comptabilite).toBeNull();
    expect(body.lectureSeule).toBe(true);

    // 2. Le refus est EXPLIQUÉ, bloc par bloc — l'interface a de quoi dire ce que
    //    le rôle permet plutôt que d'afficher un trou.
    expect(body.masque.map((m: { section: string }) => m.section).sort()).toEqual([
      'comptabilite',
      'gouvernance',
      'validation',
    ]);
    for (const bloc of body.masque) {
      expect(Object.keys(bloc).sort()).toEqual(['action', 'raison', 'section', 'titre']);
      expect(bloc.raison.length).toBeGreaterThan(30);
    }

    // 3. Contrôle sur TOUTES les sections servies, pas seulement sur celles
    //    qu'on a pensé à nommer. C'est l'assertion qui attrape une fuite glissée
    //    dans un champ auquel personne n'a pensé : aucun compteur de membres,
    //    aucun plan commercial, aucun ratio, aucune période.
    //
    //    Le balayage porte sur `sections` et non sur le corps entier : `masque`
    //    contient de la PROSE explicative (« …la consommation du plan… ») qui
    //    parle de ces blocs sans en livrer la moindre valeur. Confondre les deux
    //    ferait échouer le test sur une phrase, pas sur une fuite.
    const brut = JSON.stringify(body.sections);
    for (const interdit of [
      'membresActifs',
      'plansValidesCeMois',
      'consommation',
      'ratiosRouges',
      'plansEnAttente',
      'ecartsDefavorables',
      'periodesASaisir',
      'periodesACloturer',
      'anomalies',
      'peutCloturer',
    ]) {
      expect(brut, `le tableau de bord d'un Lecteur contient « ${interdit} »`).not.toContain(
        interdit,
      );
    }

    // 4. Ce qu'il DOIT voir : ses projets. Un espace vide serait un échec produit.
    expect(body.sections.projets).not.toBeNull();
    expect(body.sections.projets.projets.map((p: { name: string }) => p.name)).toContain(
      NOM_PROJET,
    );
  });

  it('le Conseiller est traité comme le Lecteur : consultation, aucune action', async () => {
    const { body } = await dashboard('advisor').expect(200);
    expect(body.lectureSeule).toBe(true);
    expect(body.sections.gouvernance).toBeNull();
    expect(body.sections.validation).toBeNull();
    expect(body.sections.comptabilite).toBeNull();
  });

  it('l’Analyste voit ses projets sans être annoncé « lecture seule »', async () => {
    // Aucun bloc de cet espace ne s'ouvre à lui, mais il saisit et calcule dans
    // l'espace projet : lui afficher « lecture seule » serait faux.
    const { body } = await dashboard('analyst').expect(200);
    expect(body.lectureSeule).toBe(false);
    expect(body.sections.projets.projets.length).toBeGreaterThanOrEqual(1);
    expect(body.sections.gouvernance).toBeNull();
  });

  it('le Directeur financier voit la validation, jamais le pilotage', async () => {
    const { body } = await dashboard('finance_director').expect(200);
    expect(body.sections.validation).not.toBeNull();
    expect(body.sections.gouvernance).toBeNull();
    expect(Array.isArray(body.sections.validation.ratiosRouges)).toBe(true);
    expect(Array.isArray(body.sections.validation.plansEnAttente)).toBe(true);
    expect(Array.isArray(body.sections.validation.ecartsDefavorables)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('membresActifs');
  });

  it('LE COMPTABLE VOIT SES PÉRIODES, et rien de la gouvernance', async () => {
    const { body } = await dashboard('accountant').expect(200);

    expect(body.sections.comptabilite).not.toBeNull();
    expect(body.sections.gouvernance).toBeNull();
    expect(body.sections.validation).toBeNull();

    // Deux mois saisis et laissés ouverts au montage → deux périodes à clôturer.
    const aCloturer = body.sections.comptabilite.periodesACloturer as Array<{
      projectId: string;
      month: number;
    }>;
    expect(aCloturer.map((p) => p.month).sort()).toEqual([1, 2]);
    expect(aCloturer.every((p) => p.projectId === projetId)).toBe(true);

    // Le mois 3 est le premier sans document : c'est celui qu'on lui propose.
    const aSaisir = body.sections.comptabilite.periodesASaisir as Array<{ month: number }>;
    expect(aSaisir.map((p) => p.month)).toContain(3);

    // Case ⚙ : le droit de clôture est refusé par défaut (docs/12 « clôture selon
    // permission »). Le tableau de bord le dit, il ne propose pas un bouton mort.
    expect(body.sections.comptabilite.peutCloturer).toBe(false);
  });

  it('le droit conditionnel de clôture accordé se voit dans le tableau de bord', async () => {
    // Passe par la VRAIE route de gouvernance (S20a) : c'est la chaîne complète
    // qu'on veut vérifier — un droit accordé par un Propriétaire doit changer ce
    // que `can()` répond au Comptable, donc ce que son tableau de bord affiche.
    const membres = await request(serveur())
      .get(`/organizations/${orgId}/members`)
      .set('Cookie', c('owner'))
      .expect(200);
    const comptable = (
      membres.body.members as Array<{ userId: string; email: string | null }>
    ).find((m) => m.email === comptes['accountant'].email);
    expect(comptable, 'comptable introuvable dans la liste des membres').toBeDefined();

    const accorder = (value: boolean): request.Test =>
      request(serveur())
        .patch(`/organizations/${orgId}/members/${comptable!.userId}/close-right`)
        .set('Cookie', c('owner'))
        .send({ value });

    await accorder(true).expect(200);
    const avec = await dashboard('accountant').expect(200);
    expect(avec.body.sections.comptabilite.peutCloturer).toBe(true);

    // Remis dans l'état par défaut : les tests suivants ne doivent pas dépendre
    // de l'ordre d'exécution.
    await accorder(false).expect(200);
    const sans = await dashboard('accountant').expect(200);
    expect(sans.body.sections.comptabilite.peutCloturer).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Paramètres
  // ───────────────────────────────────────────────────────────────────────────

  it('les paramètres refusent tout rôle sans `organization.manage`', async () => {
    for (const role of [
      'finance_director',
      'accountant',
      'analyst',
      'advisor',
      'viewer',
    ] as const) {
      const lecture = await request(serveur())
        .get('/organizations/current/settings')
        .set('Cookie', c(role));
      expect(lecture.status, `GET settings ${role}`).toBe(403);
      expect(lecture.body.code ?? lecture.body.message?.code, role).toBe('FORBIDDEN');

      const ecriture = await request(serveur())
        .put('/organizations/current/settings')
        .set('Cookie', c(role))
        .send({
          name: 'Tentative',
          pays: 'CD',
          deviseAffichage: 'USD',
          logoUrl: null,
        });
      expect(ecriture.status, `PUT settings ${role}`).toBe(403);
    }
  });

  it('le Propriétaire lit et écrit les paramètres, et la lecture reflète l’écriture', async () => {
    const avant = await request(serveur())
      .get('/organizations/current/settings')
      .set('Cookie', c('owner'))
      .expect(200);
    expect(avant.body.id).toBe(orgId);
    // Aucun réglage écrit encore : les défauts sont servis, pas un 404.
    expect(avant.body.deviseAffichage).toBe('USD');
    expect(avant.body.logoUrl).toBeNull();
    expect(avant.body.options.currencies).toContain('CDF');

    const nouveau = `Coopérative ${tag}`;
    const apres = await request(serveur())
      .put('/organizations/current/settings')
      .set('Cookie', c('owner'))
      .send({
        name: nouveau,
        pays: 'cd',
        deviseAffichage: 'CDF',
        logoUrl: 'https://exemple.test/logo.png',
      })
      .expect(200);

    expect(apres.body.name).toBe(nouveau);
    // Le code pays est normalisé en majuscules côté serveur.
    expect(apres.body.pays).toBe('CD');
    expect(apres.body.deviseAffichage).toBe('CDF');
    expect(apres.body.logoUrl).toBe('https://exemple.test/logo.png');
    // Le slug est un identifiant stable : renommer ne le régénère pas.
    expect(apres.body.slug).toBe(avant.body.slug);

    const relu = await request(serveur())
      .get('/organizations/current/settings')
      .set('Cookie', c('owner'))
      .expect(200);
    expect(relu.body.name).toBe(nouveau);
    expect(relu.body.deviseAffichage).toBe('CDF');

    // Le tableau de bord d'un simple Lecteur reflète le nouveau nom : l'identité
    // de l'organisation n'est pas une donnée réservée.
    const vueLecteur = await dashboard('viewer').expect(200);
    expect(vueLecteur.body.organization.name).toBe(nouveau);
    expect(vueLecteur.body.organization.deviseAffichage).toBe('CDF');
  });

  it('un Administrateur écrit les paramètres (il détient `organization.manage`)', async () => {
    const res = await request(serveur())
      .put('/organizations/current/settings')
      .set('Cookie', c('admin'))
      .send({
        name: `Coopérative ${tag}`,
        pays: 'CD',
        deviseAffichage: 'CDF',
        logoUrl: null,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.logoUrl).toBeNull();
  });

  it('refuse un logo qui n’est pas une URL http(s) et un champ inconnu', async () => {
    for (const corps of [
      { name: 'X', pays: 'CD', deviseAffichage: 'USD', logoUrl: 'javascript:alert(1)' },
      { name: 'X', pays: 'CDX', deviseAffichage: 'USD', logoUrl: null },
      { name: 'X', pays: 'CD', deviseAffichage: 'BTC', logoUrl: null },
      // `.strict()` : un champ inconnu est refusé plutôt qu'ignoré en silence.
      { name: 'X', pays: 'CD', deviseAffichage: 'USD', logoUrl: null, plan: 'business' },
    ]) {
      const res = await request(serveur())
        .put('/organizations/current/settings')
        .set('Cookie', c('owner'))
        .send(corps);
      expect(res.status, JSON.stringify(corps)).toBe(400);
    }
  });

  it('journalise la modification des paramètres, filtrable par action', async () => {
    const res = await request(serveur())
      .get('/audit-events?action=organization.settings_updated')
      .set('Cookie', c('owner'))
      .expect(200);

    expect(res.body.events.length).toBeGreaterThanOrEqual(1);
    for (const e of res.body.events) {
      expect(e.action).toBe('organization.settings_updated');
      expect(e.targetType).toBe('organization');
      expect(e.targetId).toBe(orgId);
    }
    // Le vocabulaire proposé au filtre vient du serveur, pas d'une liste figée.
    expect(res.body.actions).toContain('organization.settings_updated');
  });

  it('le journal reste fermé aux rôles sans `audit.read`', async () => {
    for (const role of ['accountant', 'analyst', 'advisor', 'viewer'] as const) {
      const res = await request(serveur()).get('/audit-events').set('Cookie', c(role));
      expect(res.status, `audit ${role}`).toBe(403);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Facturation
  // ───────────────────────────────────────────────────────────────────────────

  it('la facturation est réservée au Propriétaire, Administrateur compris', async () => {
    const owner = await request(serveur())
      .get('/organizations/current/billing')
      .set('Cookie', c('owner'));
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect(owner.body.plan).toBe('pro');
    expect(owner.body.consommation.projets.utilise).toBeGreaterThanOrEqual(1);
    expect(owner.body.paiement.integre).toBe(false);
    expect(owner.body.historique.length).toBeGreaterThanOrEqual(1);

    // ADR-0012 §3 : `billing.manage` n'est détenu QUE par le Propriétaire.
    // L'Administrateur est le cas qui surprend — d'où sa place en tête.
    for (const role of [
      'admin',
      'finance_director',
      'accountant',
      'analyst',
      'advisor',
      'viewer',
    ] as const) {
      const res = await request(serveur())
        .get('/organizations/current/billing')
        .set('Cookie', c(role));
      expect(res.status, `billing ${role}`).toBe(403);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Isolation inter-organisations
  // ───────────────────────────────────────────────────────────────────────────

  it('un membre d’une autre organisation ne voit RIEN de celle-ci', async () => {
    // Le cookie force `active_org_id` sur une organisation dont il n'est pas
    // membre. `AuthGuard` l'ignore et retombe sur son organisation primaire : la
    // réponse doit donc parler de SON organisation, jamais de la voisine.
    const forge = [...cookiesVoisin, `active_org_id=${orgId}`];

    const vue = await request(serveur())
      .get('/organizations/current/dashboard')
      .set('Cookie', forge)
      .expect(200);

    expect(vue.body.organization.id).toBe(orgVoisineId);
    expect(vue.body.organization.id).not.toBe(orgId);
    const brut = JSON.stringify(vue.body);
    expect(brut).not.toContain(orgId);
    expect(brut).not.toContain(NOM_PROJET);
    expect(brut).toContain(NOM_PROJET_VOISIN);

    // Idem sur les deux routes d'écriture et de facturation : le voisin est
    // propriétaire de SON organisation, il obtient donc 200 — mais sur la sienne.
    const settings = await request(serveur())
      .get('/organizations/current/settings')
      .set('Cookie', forge)
      .expect(200);
    expect(settings.body.id).toBe(orgVoisineId);

    const billing = await request(serveur())
      .get('/organizations/current/billing')
      .set('Cookie', forge)
      .expect(200);
    // Organisation voisine jamais passée en `pro` : la lecture ne fuit pas le
    // plan commercial de l'organisation visée par le cookie forgé.
    expect(billing.body.plan).toBe('free');

    // Et le journal d'audit de la voisine ne contient pas nos événements.
    const audit = await request(serveur()).get('/audit-events').set('Cookie', forge).expect(200);
    for (const e of audit.body.events) {
      expect(e.targetId).not.toBe(orgId);
    }
  });

  it('une écriture de paramètres par un voisin ne touche pas cette organisation', async () => {
    const forge = [...cookiesVoisin, `active_org_id=${orgId}`];
    await request(serveur())
      .put('/organizations/current/settings')
      .set('Cookie', forge)
      .send({ name: 'Détournée', pays: 'FR', deviseAffichage: 'EUR', logoUrl: null })
      .expect(200);

    const inchangee = await request(serveur())
      .get('/organizations/current/settings')
      .set('Cookie', c('owner'))
      .expect(200);
    expect(inchangee.body.name).toBe(`Coopérative ${tag}`);
    expect(inchangee.body.pays).toBe('CD');
    expect(inchangee.body.deviseAffichage).toBe('CDF');
  });
});
