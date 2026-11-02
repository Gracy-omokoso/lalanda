// PREUVE BOUT-EN-BOUT DE LA MATRICE RBAC (S20a — ADR-0012 § Plan de validation,
// docs/12 § Tests obligatoires « matrice rôle/action »).
//
// ── Pourquoi ce fichier existe, alors que `permissions.test.ts` teste déjà 420 cases ──
//
// `permissions.test.ts` prouve que la matrice est correctement DÉCLARÉE : il
// appelle `can()` en mémoire et compare à une transcription littérale d'ADR-0012.
// `routes-coverage.test.ts` prouve que chaque route DÉCLARE une permission.
// Ni l'un ni l'autre ne prouve que le serveur REFUSE réellement : les deux
// passeraient au vert si `PermissionsGuard` était retiré des contrôleurs, si
// `AuthGuard` résolvait le mauvais rôle, ou si le guard lisait la métadonnée
// d'un autre handler.
//
// Ce fichier ferme le trou. Dix sessions HTTP réellement authentifiées, une par
// rôle d'organisation attribuable, dans UNE SEULE organisation, contre une route
// représentative par action. C'est la seule des trois suites qui exerce la chaîne
// complète : cookie → better-auth → AuthGuard → membership Mongo → PermissionsGuard
// → matrice → contrôleur.
//
// ── Ce qui est asserté ──
//
//   refusé  → 403 EXACTEMENT, `code: 'FORBIDDEN'`, et le corps NOMME l'action
//             refusée et le rôle. Un 404, un 401 ou un 500 ne comptent pas : ils
//             pourraient masquer une route cassée plutôt qu'un refus délibéré.
//   autorisé → le statut appartient aux statuts documentés de la route. Jamais
//             403 : la preuve que le guard a laissé passer, c'est que la requête
//             a atteint le handler.
//
// ── Rôles non couverts, et pourquoi ──
//
//   `project_manager` n'est pas attribuable en S20a (ADR-0012 §7 : ses 15 cases
//   sont `allow_project` et les `project_assignments` n'existent pas). Il ne peut
//   donc pas exister de session portant ce rôle. Le test le vérifie explicitement
//   par le refus `409 ROLE_NOT_ASSIGNABLE` à l'invitation — c'est l'énoncé
//   end-to-end correct pour cette ligne de la matrice.
//
// Les rôles plateforme ne sont pas exercés ici : aucune route ne porte encore
// `@RequirePermission` côté plateforme (`/admin` est un chantier ultérieur,
// ADR-0012 §9). Leur matrice reste couverte par `permissions.test.ts`.

import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { PLANS, PLAN_CATALOG, type Plan } from '@lalanda/shared/pricing';

import { ACTIONS, ORG_PERMISSION_MATRIX, type Action, type OrgRole } from '../authz/permissions.js';
// ADR-0053 — P0
import { PLATFORM_ACTIONS, type PlatformAction } from '../authz/platform-actions.js';
// ADR-0052 — O0
import {
  ORGANIZATION_SETUP_STEPS,
  type OrganizationSetupStepId,
} from '@lalanda/shared/organization-setup';
import { e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

/**
 * Offre posée sur l'organisation de test : la PREMIÈRE du catalogue dont les
 * projets sont illimités (`maxProjects === null`).
 *
 * Ce n'est pas un détail de confort. Cette suite mesure la MATRICE DE
 * PERMISSIONS, et son montage crée beaucoup de projets : un projet de sondage,
 * un projet d'approbation par rôle, puis un projet par rôle autorisé à
 * `project.create`. Sous une offre plafonnée, le quota se serait épuisé en
 * cours de route et le 403 `PLAN_LIMIT_PROJECTS` qui en découle est
 * indiscernable, à l'œil, du 403 d'un rôle insuffisant : la suite se serait mise
 * à rougir sur des cases pourtant correctes, ou pire, à verdir un refus de rôle
 * manquant qu'un quota aurait masqué.
 *
 * La limite commerciale n'a rien à voir avec l'autorisation. On la neutralise
 * donc à la source plutôt que d'affaiblir une assertion de permission — une
 * sonde `project.create` dont on tolérerait le 403 ne vérifierait plus rien.
 *
 * Dérivé du catalogue et non écrit en dur : le jour où l'offre illimitée change
 * de nom, ce montage suit sans qu'on ait à s'en souvenir.
 */
const PLAN_PROJETS_ILLIMITES: Plan | undefined = PLANS.find(
  (plan) => PLAN_CATALOG[plan].entitlements.maxProjects === null,
);

/**
 * Les onze rôles réellement attribuables — `project_manager` exclu (voir en-tête).
 * `sales_rep` (Commercial, ADR-0040 § 4.2), `hr_manager` (Responsable RH, ADR-0045
 * § 4.2), `storekeeper` (Magasinier, ADR-0046 § 8.2) puis `external_accountant`
 * (Expert-comptable externe, ADR-0049 § 8.2) sont les derniers.
 *
 * L'ordre importe : `owner` d'abord, parce que c'est lui qui invite tous les
 * autres. Il n'est pas invité, il est propriétaire de son organisation
 * auto-provisionnée.
 */
const ROLES_TESTES = [
  'owner',
  'admin',
  'finance_director',
  'accountant',
  'analyst',
  'advisor',
  'viewer',
  // ADR-0040 — C0.
  'sales_rep',
  // ADR-0045 — H0 : invité par le Propriétaire, seul à pouvoir l'attribuer.
  'hr_manager',
  // ADR-0046 — S0 : invité par le Propriétaire (l'Administrateur le peut aussi, R7).
  'storekeeper',
  // ADR-0049 — K0 : invité par le Propriétaire, seul à pouvoir l'attribuer.
  'external_accountant',
] as const satisfies readonly OrgRole[];

type RoleTeste = (typeof ROLES_TESTES)[number];

/**
 * Actions sans route en S20a — donc non exerçables end-to-end.
 *
 * Ce n'est pas une dispense : le test « toute action a une sonde ou une
 * justification » ci-dessous compare cette liste aux sondes déclarées. Le jour où
 * quelqu'un ajoute `PATCH /projects/:id` ou une mutation d'abonnement, il devra
 * retirer la ligne d'ici et écrire la sonde — sinon la CI rougit.
 */
const ACTIONS_SANS_ROUTE: Record<string, string> = {
  'billing.manage':
    "Aucune route de mutation d'abonnement en S20a : le plan est posé par " +
    '`BillingService.setPlan()`, appelé en interne (S16b). La seule route de ' +
    "billing est la LECTURE de l'abonnement, gardée par `analytics.read`.",
  'project.update':
    'Aucune route de modification de projet en S20a : `POST /projects/:id/drivers` ' +
    'relève de `inputs.update`, et il n’existe ni `PATCH /projects/:id` ni ' +
    'renommage. L’action est déclarée par docs/12 et attend son endpoint.',
  // ADR-0044 — P0 : actions déclarées avant leurs routes. P3 a retiré
  // `purchase.request` et `purchase.approve` (sondes en fin de liste).
  // ADR-0045 — H0 : actions déclarées avant leurs routes (module `hr`, lots H2 et H3).
  // H2 a retiré `hr.read`, `hr.manage` et `hr.sensitive.read` ; H3 a retiré
  // `leave.request` et `leave.approve` (sondes en fin de liste).
  // ADR-0046 — S0 : actions déclarées avant leurs routes (modules `stock`, `assets`,
  // `documents`, lots S3, S5 et S6). Chaque lot retire sa ligne et écrit sa sonde ; la
  // matrice est déjà couverte case par case par `permissions.test.ts`, et le rôle
  // `storekeeper` est exercé ici sur toutes les autres sondes. S3 a retiré les quatre
  // actions `stock.*`, S5 `assets.*` et S6 `docs.*` (sondes en fin de liste).
  //
  // ADR-0049 — K0 : actions déclarées avant leurs routes (module `accounting`, lots K4 à
  // K6). Chaque lot retire sa ligne et écrit sa sonde ; la matrice est déjà couverte case
  // par case par `permissions.test.ts`, et le rôle `external_accountant` est exercé ici
  // sur toutes les autres sondes (refus de `sales.read`, `treasury.read`, `purchase.read`).
  // K4 a retiré `accounting.read`, `accounting.manage`, `accounting.post` (taux saisis) et
  // `accounting.close` (création d'exercice) ; K6 a retiré `accounting.export` (exports pour
  // l'expert-comptable) : sondes en fin de liste.
  //
  // ADR-0050 — V0 : actions déclarées avant leurs routes (module `sales/contracts`, lots V2
  // et V3). Chaque lot retire sa ligne et écrit sa sonde ; la matrice est déjà couverte case
  // par case par `permissions.test.ts`, et `/me/permissions` est vérifié ci-dessous.
  // V2 a retiré `sales.contract` (sonde `POST /sales/orders` en fin de liste).
  // V3 a retiré `sales.contract.approve` (sonde `PUT /sales/contract-settings` en fin de liste).
  //
  // ADR-0051 — H8 : actions déclarées avant leurs routes (lots H10, H12 et H15). Chaque lot
  // retire sa ligne et écrit sa sonde ; la matrice est couverte case par case par
  // `permissions.test.ts`, et `/me/permissions` est vérifié ci-dessous.
  // H10 a retiré `expenses.claim` et `expenses.approve` (sondes `POST /hr/expense-reports`
  // et `PUT /hr/settings/advances` en fin de liste).
  // H12 a retiré `attendance.clock` (sonde `POST /hr/attendance/clock` en fin de liste).
  // H15 a retiré `performance.read` (sonde `GET /hr/review-cycles` en fin de liste).
};

/** Une sonde HTTP : la route qui matérialise une action, et ses statuts légitimes. */
interface Sonde {
  action: Action;
  /** Décrit la route pour le message d'échec. */
  libelle: string;
  /**
   * Statuts prouvant que le guard a LAISSÉ PASSER. Presque toujours un seul.
   * Une liste plus large est toujours accompagnée d'une justification : elle
   * affaiblit l'assertion, et cet affaiblissement doit être un choix visible.
   */
  statutsAutorises: number[];
  envoyer: (cookies: string[], role: RoleTeste) => Promise<request.Response>;
}

e2eSuite('matrice rôle × action réellement appliquée par les guards (S20a)', () => {
  let app: INestApplication;

  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];

  /** Un compte par rôle. Les cookies sont portés par `cookiesDe`. */
  const comptes = {} as Record<RoleTeste, { email: string; password: string; name: string }>;
  const cookies = {} as Record<RoleTeste, string[]>;

  let orgId = '';
  /** Projet de sondage : plan validé, périodes réalisées ouvertes, canvas. */
  let projetSonde = '';
  /**
   * Un projet dédié à `plan.approve` PAR RÔLE. Deux raisons, toutes deux
   * nécessaires pour que la sonde mesure la matrice et rien d'autre :
   *
   * 1. Leurs hypothèses sont saisies par l'ANALYSTE, jamais par l'approbateur.
   *    Sur un projet dont l'owner aurait lui-même saisi les hypothèses, sa sonde
   *    répondrait 409 SELF_APPROVAL_FORBIDDEN (R2 dynamique) — un refus
   *    légitime, mais pas celui qu'on mesure ici.
   * 2. Un projet par rôle, car l'approbation est IDEMPOTENTE : le deuxième rôle
   *    autorisé à approuver le même projet inchangé recevrait 409 PLAN_UNCHANGED.
   *    Le test mesurerait alors l'ordre d'exécution, pas la permission.
   */
  const projetsApprobation = {} as Record<RoleTeste, string>;

  /**
   * Mois de `period.close` attribué à chaque rôle. Chaque sonde ferme SON mois :
   * deux rôles autorisés qui viseraient le même mois verraient le second échouer
   * en 409 PERIOD_CLOSED, et le test mesurerait alors l'ordre d'exécution au lieu
   * de la matrice.
   */
  const moisDeCloture: Record<RoleTeste, number> = {
    owner: 1,
    admin: 2,
    finance_director: 3,
    accountant: 4,
    analyst: 5,
    advisor: 6,
    viewer: 7,
    sales_rep: 8,
    hr_manager: 9,
    storekeeper: 10,
    // ADR-0049 — K0 : le mois 11 est pris par le test ⚙ du Comptable ; l'Expert-comptable
    // n'a pas `period.close`, sa sonde ne ferme rien.
    external_accountant: 12,
  };

  function creerCompte(role: RoleTeste): { email: string; password: string; name: string } {
    const email = `rbac-${role}-${tag}@lalanda-test.local`;
    emails.push(email);
    return { email, password: `Passw0rd!${role}`, name: `RBAC ${role}` };
  }

  /** Cookies de session + org active forcée sur l'organisation partagée. */
  function cookiesDe(role: RoleTeste): string[] {
    return [...cookies[role], `active_org_id=${orgId}`];
  }

  function serveur(): ReturnType<INestApplication['getHttpServer']> {
    return app.getHttpServer();
  }

  beforeAll(async () => {
    app = await makeE2EApp();

    // ── 1. L'owner et son organisation auto-provisionnée ──────────────────────
    for (const role of ROLES_TESTES) comptes[role] = creerCompte(role);
    cookies['owner'] = await registerAndLogin(app, comptes['owner']);

    const orgs = await request(serveur()).get('/organizations').set('Cookie', cookies['owner']);
    expect(orgs.status).toBe(200);
    orgId = (orgs.body.organizations as { id: string }[])[0]!.id;

    // Offre à projets illimités — voir PLAN_PROJETS_ILLIMITES : sans elle, le
    // quota de projets se confondrait avec un refus de la matrice.
    expect(
      PLAN_PROJETS_ILLIMITES,
      'Aucune offre du catalogue ne propose de projets illimités : le montage de ' +
        'cette suite ne peut plus neutraliser le quota, et ses 403 deviendraient ' +
        'ambigus. Réviser le montage avant de toucher aux assertions.',
    ).toBeDefined();
    const { BillingService } = await import('../billing/billing.service.js');
    await app.get(BillingService).setPlan(orgId, PLAN_PROJETS_ILLIMITES!);

    // ── 2. Un membre par rôle, par le VRAI parcours invitation → acceptation ──
    //
    // Insérer les memberships directement en base irait plus vite, mais le test
    // ne prouverait plus que le rôle attribué à l'invitation est bien celui que
    // le guard lira ensuite. C'est précisément le maillon qu'on veut vérifier.
    for (const role of ROLES_TESTES) {
      if (role === 'owner') continue;
      const invitation = await request(serveur())
        .post(`/organizations/${orgId}/invitations`)
        .set('Cookie', cookies['owner'])
        .send({ email: comptes[role].email, role });
      expect(
        invitation.status,
        `invitation ${role} : ${invitation.status} ${JSON.stringify(invitation.body)}`,
      ).toBe(201);
      expect(invitation.body.invitation.role).toBe(role);

      cookies[role] = await registerAndLogin(app, comptes[role]);
      const acceptation = await request(serveur())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: invitation.body.token });
      expect(
        acceptation.status,
        `acceptation ${role} : ${acceptation.status} ${JSON.stringify(acceptation.body)}`,
      ).toBe(201);
    }

    // ── 3. Projet de sondage : plan validé + périodes ouvertes ────────────────
    const projet = await request(serveur())
      .post('/projects')
      .set('Cookie', cookiesDe('owner'))
      .send({
        name: `Sonde RBAC ${tag}`,
        templateSlug: 'hello-world',
        driverValues: { prix_unitaire: 10, quantite_mois: 100 },
      });
    expect(projet.status).toBe(201);
    projetSonde = projet.body.id;

    // Un plan validé est le préalable de toute saisie de réalisé et de tout
    // calcul d'écart (docs/08). Sans lui, `actuals.import` et `period.close`
    // répondraient 409 NO_APPROVED_PLAN pour tout le monde, autorisés compris.
    const plan = await request(serveur())
      .post(`/projects/${projetSonde}/plans`)
      .set('Cookie', cookiesDe('owner'))
      .send({});
    expect(plan.status, `plan de sondage : ${JSON.stringify(plan.body)}`).toBe(201);

    // Une période ouverte par rôle, pour la sonde `period.close`.
    for (const mois of Object.values(moisDeCloture)) {
      const periode = await request(serveur())
        .put(`/projects/${projetSonde}/actual-periods/1/${mois}`)
        .set('Cookie', cookiesDe('owner'))
        .send({ values: { ca: 1_000, cout_variable: 400 } });
      expect(periode.status, `période 1/${mois}`).toBe(200);
    }

    // ── 4. Un projet d'approbation par rôle, hypothèses saisies par l'analyste ─
    for (const [index, role] of ROLES_TESTES.entries()) {
      const projetB = await request(serveur())
        .post('/projects')
        .set('Cookie', cookiesDe('owner'))
        .send({
          name: `Approbation ${role} ${tag}`,
          templateSlug: 'hello-world',
          driverValues: { prix_unitaire: 12, quantite_mois: 80 },
        });
      expect(projetB.status, `projet d'approbation ${role}`).toBe(201);
      projetsApprobation[role] = projetB.body.id;

      // Hypothèses distinctes par projet : deux empreintes identiques ne
      // gêneraient pas (les plans sont scopés par projet), mais des chiffres
      // différents rendent un éventuel mélange de projets visible en échec.
      const saisie = await request(serveur())
        .post(`/projects/${projetB.body.id}/drivers`)
        .set('Cookie', cookiesDe('analyst'))
        .send({ driverValues: { prix_unitaire: 13 + index, quantite_mois: 90 + index } });
      expect(saisie.status, `saisie analyste ${role} : ${JSON.stringify(saisie.body)}`).toBe(201);
    }
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await teardown(app, emails);
  }, E2E_HOOK_TIMEOUT_MS);

  // ───────────────────────────────────────────────────────────────────────────
  // Les sondes — une route représentative par action
  // ───────────────────────────────────────────────────────────────────────────

  /** Corps d'un canvas complet : les neuf blocs sont requis (canvas.dto.ts). */
  function corpsCanvas(role: RoleTeste): Record<string, unknown[]> {
    const blocs = [
      'segments_clients',
      'proposition_valeur',
      'canaux',
      'relations_clients',
      'revenus',
      'ressources_cles',
      'activites_cles',
      'partenaires_cles',
      'couts',
    ];
    const out: Record<string, unknown[]> = {};
    for (const b of blocs) out[b] = [];
    out['segments_clients'] = [{ id: `c-${role}`, texte: `Segment ${role}`, ordre: 0 }];
    return out;
  }

  const SONDES: Sonde[] = [
    {
      action: 'organization.manage',
      libelle: 'GET /organizations/:orgId/members',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get(`/organizations/${orgId}/members`).set('Cookie', c),
    },
    {
      action: 'members.invite',
      libelle: 'GET /organizations/:orgId/invitations',
      statutsAutorises: [200],
      envoyer: (c) =>
        request(serveur()).get(`/organizations/${orgId}/invitations`).set('Cookie', c),
    },
    {
      action: 'project.create',
      libelle: 'POST /projects',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post('/projects')
          .set('Cookie', c)
          .send({ name: `Sonde create ${role} ${tag}`, templateSlug: 'hello-world' }),
    },
    {
      action: 'project.read',
      libelle: 'GET /projects/:id',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get(`/projects/${projetSonde}`).set('Cookie', c),
    },
    {
      action: 'canvas.update',
      libelle: 'PUT /projects/:id/canvas',
      statutsAutorises: [200],
      envoyer: (c, role) =>
        request(serveur())
          .put(`/projects/${projetSonde}/canvas`)
          .set('Cookie', c)
          .send(corpsCanvas(role)),
    },
    {
      action: 'inputs.update',
      libelle: 'POST /projects/:id/drivers',
      statutsAutorises: [201],
      envoyer: (c) =>
        request(serveur())
          .post(`/projects/${projetSonde}/drivers`)
          .set('Cookie', c)
          .send({ driverValues: { prix_unitaire: 10, quantite_mois: 100 } }),
    },
    {
      action: 'plan.calculate',
      libelle: 'POST /projects/:id/evaluate',
      statutsAutorises: [201],
      envoyer: (c) =>
        request(serveur()).post(`/projects/${projetSonde}/evaluate`).set('Cookie', c).send({}),
    },
    {
      action: 'plan.approve',
      libelle: 'POST /projects/:id/plans (projet par rôle, hypothèses saisies par un tiers)',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post(`/projects/${projetsApprobation[role]}/plans`)
          .set('Cookie', c)
          .send({}),
    },
    {
      action: 'actuals.import',
      libelle: 'PUT /projects/:id/actual-periods/1/12',
      statutsAutorises: [200],
      envoyer: (c) =>
        request(serveur())
          .put(`/projects/${projetSonde}/actual-periods/1/12`)
          .set('Cookie', c)
          .send({ values: { ca: 1_100 } }),
    },
    {
      action: 'period.close',
      libelle: 'POST /projects/:id/actual-periods/1/:mois/close',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post(`/projects/${projetSonde}/actual-periods/1/${moisDeCloture[role]}/close`)
          .set('Cookie', c)
          .send({}),
    },
    {
      // ADR-0040 § 4.4 : les écarts du réalisé exigent désormais `project.read` en
      // plus ; la sonde d'`analytics.read` seule est le brief du matin.
      action: 'analytics.read',
      libelle: 'GET /morning-brief',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get('/morning-brief').set('Cookie', c),
    },
    {
      action: 'report.export',
      libelle: 'GET /projects/:id/report/xlsx',
      statutsAutorises: [200],
      envoyer: (c) =>
        request(serveur()).get(`/projects/${projetSonde}/report/xlsx`).set('Cookie', c),
    },
    {
      action: 'audit.read',
      libelle: 'GET /audit-events',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get('/audit-events').set('Cookie', c),
    },
    {
      // ADR-0021 §8 — Propriétaire et Directeur financier seulement. Lecture de la
      // fiche fiscale : 200 même sans fiche enregistrée (`profile: null`).
      action: 'fiscal.manage',
      libelle: 'GET /organizations/current/fiscal-profile',
      statutsAutorises: [200],
      envoyer: (c) =>
        request(serveur()).get('/organizations/current/fiscal-profile').set('Cookie', c),
    },
    {
      // ADR-0022 § S25c.1 — tous les rôles sauf Conseiller et Chef de projet.
      action: 'sales.read',
      libelle: 'GET /sales/customers',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get('/sales/customers').set('Cookie', c),
    },
    {
      // ADR-0022 § S25c.1 — Propriétaire, Administrateur, Directeur financier,
      // Comptable. Un client PP sans NIF : aucun doublon possible entre rôles.
      action: 'sales.manage',
      libelle: 'POST /sales/customers',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post('/sales/customers')
          .set('Cookie', c)
          .send({ type: 'PP', name: `Sonde ventes ${role} ${tag}` }),
    },
    {
      // ADR-0023 § S25e.11 — Propriétaire, Directeur financier, Comptable. Un
      // identifiant inconnu : un rôle autorisé franchit la garde et reçoit 404
      // INVOICE_NOT_FOUND ; un rôle refusé reçoit 403 AVANT toute lecture.
      action: 'sales.invoice',
      libelle: 'POST /sales/invoices/:id/issue (document inconnu)',
      statutsAutorises: [404],
      envoyer: (c) =>
        request(serveur())
          .post('/sales/invoices/000000000000000000000000/issue')
          .set('Cookie', c)
          .send({ expectedRevision: 1 }),
    },
    {
      // ADR-0031 § 4 — Propriétaire, Directeur financier, Comptable. Encaissement
      // inconnu : un rôle autorisé reçoit 404 RECEIPT_NOT_FOUND, un rôle refusé 403.
      action: 'sales.receipt',
      libelle: 'POST /sales/receipts/:id/cancel (encaissement inconnu)',
      statutsAutorises: [404],
      envoyer: (c) =>
        request(serveur())
          .post('/sales/receipts/000000000000000000000000/cancel')
          .set('Cookie', c)
          .send({ reason: 'Sonde de la matrice', expectedRevision: 1 }),
    },
    {
      // ADR-0034 § 8 — tous les rôles sauf Conseiller et Chef de projet.
      action: 'treasury.read',
      libelle: 'GET /treasury/accounts',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get('/treasury/accounts').set('Cookie', c),
    },
    {
      // ADR-0034 § 8 — Propriétaire, Directeur financier, Comptable. Une dépense
      // sans compte : aucun prérequis, aucune collision entre rôles.
      action: 'treasury.manage',
      libelle: 'POST /treasury/expenses',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post('/treasury/expenses')
          .set('Cookie', c)
          .send({
            spentOn: '2026-01-15',
            amount: '10.00',
            currency: 'USD',
            category: 'charges_diverses',
            label: `Sonde trésorerie ${role}`,
          }),
    },
    {
      // ADR-0035 § 3 — mêmes rôles que `sales.read`.
      action: 'crm.read',
      libelle: 'GET /crm/pipeline',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get('/crm/pipeline').set('Cookie', c),
    },
    {
      // ADR-0035 § 3 — mêmes rôles que `sales.manage`. Un prospect nommé par rôle.
      action: 'crm.manage',
      libelle: 'POST /crm/contacts',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post('/crm/contacts')
          .set('Cookie', c)
          .send({ name: `Sonde CRM ${role} ${tag}`, companyName: 'Sonde' }),
    },
    {
      // ADR-0040 § 4.1 — détenteurs de `sales.manage`, plus le Commercial. Un devis
      // à un client de passage : aucun prérequis de fiche client.
      action: 'sales.quote',
      libelle: 'POST /sales/quotes',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post('/sales/quotes')
          .set('Cookie', c)
          .send(corpsDevisSonde(`Sonde devis ${role} ${tag}`)),
    },
    {
      // ADR-0039 § 7 — tous les rôles sauf Conseiller et Chef de projet.
      action: 'work.read',
      libelle: 'GET /work/projects',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get('/work/projects').set('Cookie', c),
    },
    {
      // ADR-0039 § 7 — Propriétaire, Administrateur, Directeur financier,
      // Comptable, Analyste. Une tâche par rôle dans le projet de sondage.
      action: 'work.update',
      libelle: 'POST /work/projects/:id/tasks',
      statutsAutorises: [201],
      envoyer: async (c, role) =>
        request(serveur())
          .post(`/work/projects/${await projetWorkSonde()}/tasks`)
          .set('Cookie', c)
          .send({ title: `Sonde tâche ${role}` }),
    },
    {
      // ADR-0039 § 7 — Propriétaire, Administrateur, Directeur financier.
      action: 'work.manage',
      libelle: 'POST /work/projects',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post('/work/projects')
          .set('Cookie', c)
          .send({ name: `Sonde projet ${role} ${tag}`, kind: 'internal' }),
    },
    // ADR-0044 — P2 : fiches fournisseurs et coordonnées de paiement.
    {
      // ADR-0044 § 4.1 — détenteurs de `treasury.read`, sauf le Commercial.
      action: 'purchase.read',
      libelle: 'GET /purchases/suppliers',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get('/purchases/suppliers').set('Cookie', c),
    },
    {
      // ADR-0044 § 4.1 — Propriétaire, Administrateur, Directeur financier, Comptable.
      // Une fiche nommée par rôle : aucun prérequis, aucune collision.
      action: 'purchase.manage',
      libelle: 'POST /purchases/suppliers',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post('/purchases/suppliers')
          .set('Cookie', c)
          .send({ name: `Sonde fournisseur ${role} ${tag}` }),
    },
    {
      // ADR-0044 § 2.1.1 — `reveal` est la première route de `payables.pay`
      // (Propriétaire, Directeur financier, Comptable). Fiche inexistante : le 404
      // prouve que le guard a laissé passer jusqu'au service, sans rien révéler ni
      // exiger de trousseau de chiffrement dans cette suite.
      action: 'payables.pay',
      libelle: 'POST /purchases/suppliers/:id/payment-methods/:methodId/reveal',
      statutsAutorises: [404],
      envoyer: (c) =>
        request(serveur())
          .post('/purchases/suppliers/000000000000000000000000/payment-methods/x/reveal')
          .set('Cookie', c),
    },
    // ADR-0044 — P3 : demandes d'achat et approbations.
    {
      // ADR-0044 § 4.1 — tout rôle interne qui travaille (Propriétaire, Administrateur,
      // Directeur financier, Comptable, Analyste). Brouillon sans fournisseur : aucun
      // prérequis, aucune collision.
      action: 'purchase.request',
      libelle: 'POST /purchases/orders',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post('/purchases/orders')
          .set('Cookie', c)
          .send({
            title: `Sonde demande ${role}`,
            currency: 'USD',
            lines: [{ label: 'Sonde', quantity: '1', unitPrice: '1.00', kind: 'service' }],
          }),
    },
    {
      // ADR-0044 § 4.1 — autorité de dépense : Propriétaire et Directeur financier.
      // Demande inexistante : le 404 prouve que le guard a laissé passer.
      action: 'purchase.approve',
      libelle: 'POST /purchases/orders/:id/approve',
      statutsAutorises: [404],
      envoyer: (c) =>
        request(serveur())
          .post('/purchases/orders/000000000000000000000000/approve')
          .set('Cookie', c)
          .send({ expectedRevision: 1 }),
    },
    // ADR-0044 — P4 : réceptions et factures fournisseurs.
    {
      // ADR-0044 § 5.3 — forcer une facture en écart : Propriétaire et Directeur
      // financier (ⓢ). Facture inexistante : le 404 prouve que le guard a laissé passer
      // jusqu'au service, sans prérequis de commande ni de facture dans cette suite.
      action: 'purchase.approve',
      libelle: 'POST /purchases/invoices/:id/force-validate',
      statutsAutorises: [404],
      envoyer: (c) =>
        request(serveur())
          .post('/purchases/invoices/000000000000000000000000/force-validate')
          .set('Cookie', c)
          .send({ reason: 'Sonde de matrice', expectedRevision: 1 }),
    },
    // ADR-0044 — P5 : paiements fournisseurs.
    {
      // ADR-0044 § 4.1 — payer est un décaissement : Propriétaire, Directeur financier,
      // Comptable. Paiement inexistant : le 404 prouve que le guard a laissé passer
      // jusqu'au service, sans facture validée ni compte à préparer dans cette suite.
      action: 'payables.pay',
      libelle: 'POST /purchases/payments/:id/cancel',
      statutsAutorises: [404],
      envoyer: (c) =>
        request(serveur())
          .post('/purchases/payments/000000000000000000000000/cancel')
          .set('Cookie', c)
          .send({ reason: 'Sonde de matrice', expectedRevision: 1 }),
    },
    // ADR-0045 — H2 : dossiers collaborateurs et données sensibles.
    {
      // ADR-0045 § 4.1 — Propriétaire, Administrateur, Directeur financier, Responsable RH.
      action: 'hr.read',
      libelle: 'GET /hr/employees',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get('/hr/employees').set('Cookie', c),
    },
    {
      // ADR-0045 § 4.1 — mêmes rôles. Une fiche nommée par rôle : aucune collision.
      action: 'hr.manage',
      libelle: 'POST /hr/employees',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post('/hr/employees')
          .set('Cookie', c)
          .send({
            firstName: 'Sonde',
            lastName: `${role} ${tag}`,
            jobTitle: 'Sonde de matrice',
            contractType: 'permanent',
            startDate: '2026-01-05',
          }),
    },
    {
      // ADR-0045 § 4.1 — Propriétaire, Directeur financier, Responsable RH ; ni
      // l'Administrateur ni le Comptable. L'anonymisation déclare `hr.sensitive.read`
      // EN PREMIER : le 403 nomme cette action pour tout rôle refusé. Fiche inexistante :
      // le 404 prouve que le guard a laissé passer, sans trousseau dans cette suite.
      action: 'hr.sensitive.read',
      libelle: 'POST /hr/employees/:id/anonymize (fiche inconnue)',
      statutsAutorises: [404],
      envoyer: (c) =>
        request(serveur())
          .post('/hr/employees/000000000000000000000000/anonymize')
          .set('Cookie', c)
          .send({ confirm: true, expectedRevision: 1 }),
    },
    // ADR-0045 — H3 : absences et circuit de validation.
    {
      // ADR-0045 § 4.1 — tout rôle interne (le Conseiller, externe, non). Aucun compte
      // de cette suite n'est relié à une fiche : 409 EMPLOYEE_NOT_LINKED prouve que le
      // guard a laissé passer jusqu'au service.
      action: 'leave.request',
      libelle: 'POST /hr/leave-requests (sans fiche reliée)',
      statutsAutorises: [409],
      envoyer: (c) =>
        request(serveur())
          .post('/hr/leave-requests')
          .set('Cookie', c)
          .send({
            typeId: '000000000000000000000000',
            start: { date: '2027-03-01', half: 'full' },
            end: { date: '2027-03-01', half: 'full' },
          }),
    },
    {
      // ADR-0045 § 3.3, § 4.1 — changer le circuit exige d'être soi-même validateur :
      // Propriétaire, Directeur financier, Responsable RH. La route déclare
      // `leave.approve` EN PREMIER : le 403 la nomme pour tout rôle refusé. La révision
      // courante est relue juste avant (chaque rôle autorisé l'incrémente).
      action: 'leave.approve',
      libelle: 'PUT /hr/settings/approval',
      statutsAutorises: [200],
      envoyer: async (c) => {
        const lu = await request(serveur()).get('/hr/settings').set('Cookie', c);
        const revision = typeof lu.body?.revision === 'number' ? lu.body.revision : 0;
        return request(serveur())
          .put('/hr/settings/approval')
          .set('Cookie', c)
          .send({ expectedRevision: revision, allowSoleApprover: true });
      },
    },
    // ADR-0046 — S3 : stocks (référentiel, bons, inventaires).
    {
      // ADR-0046 § 8.1 — tout rôle interne sauf Chef de projet, Conseiller, Responsable RH.
      action: 'stock.read',
      libelle: 'GET /stock/items',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get('/stock/items').set('Cookie', c),
    },
    {
      // ADR-0046 § 8.1 — Propriétaire, Administrateur, Directeur financier, Magasinier.
      // Bon inexistant : le 404 prouve que le guard a laissé passer jusqu'au service.
      action: 'stock.move',
      libelle: 'POST /stock/vouchers/:id/post',
      statutsAutorises: [404],
      envoyer: (c) =>
        request(serveur())
          .post('/stock/vouchers/000000000000000000000000/post')
          .set('Cookie', c)
          .send({ expectedRevision: 1 }),
    },
    {
      // ADR-0046 § 8.1 — ceux qui sortent la marchandise et le Comptable. Inventaire
      // inexistant : 404.
      action: 'stock.count',
      libelle: 'PUT /stock/counts/:id/lines/:lineId',
      statutsAutorises: [404],
      envoyer: (c) =>
        request(serveur())
          .put('/stock/counts/000000000000000000000000/lines/sonde')
          .set('Cookie', c)
          .send({ countedQuantity: '1' }),
    },
    {
      // ADR-0046 § 8.1 — Propriétaire, Administrateur, Directeur financier, Comptable ;
      // pas le Magasinier. Un article nommé par rôle, sans code : aucune collision.
      action: 'stock.manage',
      libelle: 'POST /stock/items',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post('/stock/items')
          .set('Cookie', c)
          .send({ name: `Sonde article ${role} ${tag}`, unit: 'pièce' }),
    },
    // ADR-0046 — S5 : registre des équipements (S5 a retiré `assets.read` et
    // `assets.manage` d'ACTIONS_SANS_ROUTE).
    {
      // ADR-0046 § 8.1 — tout rôle interne qui gère ou contrôle, le Responsable RH et le
      // Magasinier ; ni le Commercial, ni le Conseiller.
      action: 'assets.read',
      libelle: 'GET /assets',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get('/assets').set('Cookie', c),
    },
    {
      // ADR-0046 § 8.1 — Propriétaire, Administrateur, Directeur financier, Comptable ;
      // ni le Responsable RH ni le Magasinier (décision ouverte n° 3). La catégorie est
      // relue avec les mêmes cookies (tout détenteur de `assets.manage` lit le registre) ;
      // un refusé envoie un identifiant forgé et reçoit 403 avant toute lecture.
      action: 'assets.manage',
      libelle: 'POST /assets',
      statutsAutorises: [201],
      envoyer: async (c, role) => {
        const cats = await request(serveur()).get('/assets/categories').set('Cookie', c);
        const categoryId =
          cats.status === 200
            ? (cats.body.items as { id: string }[])[0]!.id
            : '000000000000000000000000';
        return request(serveur())
          .post('/assets')
          .set('Cookie', c)
          .send({
            name: `Sonde ${role} ${tag}`,
            categoryId,
            acquisition: { on: '2026-01-15', cost: '100.00', currency: 'USD' },
          });
      },
    },
    // ADR-0046 — S6 : bibliothèque de documents (§ 5.3, § 8.1).
    {
      // Tout rôle interne ; ni le Conseiller (externe) ni le Chef de projet. L'arbre est
      // filtré par les droits de chaque dossier dans le service.
      action: 'docs.read',
      libelle: 'GET /documents/folders',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get('/documents/folders').set('Cookie', c),
    },
    {
      // Propriétaire, Administrateur, Directeur financier, Comptable, Responsable RH. Un
      // dossier nommé par rôle : aucune collision.
      action: 'docs.manage',
      libelle: 'POST /documents/folders',
      statutsAutorises: [201],
      envoyer: (c, role) =>
        request(serveur())
          .post('/documents/folders')
          .set('Cookie', c)
          .send({ name: `Sonde ${role} ${tag}` }),
    },
    // ADR-0049 — K4 : référentiel et réglages de la comptabilité (§ 8.1, § 11).
    {
      // PRO, ADM, DIR, CPT, ANA, LEC et l'Expert-comptable ; ni COM, ni RH, ni MAG, ni CON.
      action: 'accounting.read',
      libelle: 'GET /accounting/settings',
      statutsAutorises: [200],
      envoyer: (c) => request(serveur()).get('/accounting/settings').set('Cookie', c),
    },
    {
      // PRO, DIR, CPT. Révision forgée : le guard laisse passer, le service répond
      // 409 STALE_REVISION sans rien écrire.
      action: 'accounting.manage',
      libelle: 'PUT /accounting/settings',
      statutsAutorises: [409],
      envoyer: (c) =>
        request(serveur())
          .put('/accounting/settings')
          .set('Cookie', c)
          .send({ expectedRevision: 999_999 }),
    },
    {
      // PRO, DIR, CPT. Taux d'une devise vers elle-même : 400 RATE_SAME_CURRENCY après le
      // guard, rien n'est saisi.
      action: 'accounting.post',
      libelle: 'PUT /accounting/exchange-rates/:date/:from/:to',
      statutsAutorises: [400],
      envoyer: (c) =>
        request(serveur())
          .put('/accounting/exchange-rates/2026-01-15/USD/USD')
          .set('Cookie', c)
          .send({ rate: '1', sourceText: 'Sonde', expectedRevision: null }),
    },
    {
      // PRO, DIR, CPT. Année hors bornes : 400 après le guard, aucun exercice créé.
      action: 'accounting.close',
      libelle: 'POST /accounting/fiscal-years',
      statutsAutorises: [400],
      envoyer: (c) =>
        request(serveur()).post('/accounting/fiscal-years').set('Cookie', c).send({ year: 1999 }),
    },
    // ADR-0049 — K6 : exports pour l'expert-comptable (§ 9, § 11).
    {
      // PRO, DIR, CPT et l'Expert-comptable. Contenu inconnu : 400 après le guard, aucun
      // export préparé ni journalisé.
      action: 'accounting.export',
      libelle: 'POST /accounting/exports',
      statutsAutorises: [400],
      envoyer: (c) =>
        request(serveur())
          .post('/accounting/exports')
          .set('Cookie', c)
          .send({ kind: 'sonde', format: 'csv', from: '2026-10-01', to: '2026-10-31' }),
    },
    // ADR-0050 — V2 : commandes clients (§ 3, § 8.1).
    {
      // PRO, ADM, DIR, CPT, COM. Corps sans client : 400 CUSTOMER_REQUIRED après le guard,
      // aucune commande créée.
      action: 'sales.contract',
      libelle: 'POST /sales/orders',
      statutsAutorises: [400],
      envoyer: (c) =>
        request(serveur())
          .post('/sales/orders')
          .set('Cookie', c)
          .send({ orderedOn: '2026-11-01', currency: 'CDF', priceMode: 'ht', lines: [] }),
    },
    // ADR-0050 — V3 : réglages des contrats (§ 3, § 8.1).
    {
      // PRO, DIR. Corps incomplet : 400 INVALID_REQUEST après le guard, aucun réglage écrit.
      action: 'sales.contract.approve',
      libelle: 'PUT /sales/contract-settings',
      statutsAutorises: [400],
      envoyer: (c) =>
        request(serveur())
          .put('/sales/contract-settings')
          .set('Cookie', c)
          .send({ expectedRevision: null }),
    },
    // ADR-0051 — H12 : présences (§ 5.1, § 6.2).
    {
      // Tout rôle interne sauf Chef de projet, Conseiller et Expert-comptable externe. Le
      // pointage est éteint par défaut : 409 HR_FEATURE_DISABLED prouve que le guard a
      // laissé passer jusqu'au service, sans aucun pointage écrit.
      action: 'attendance.clock',
      libelle: 'POST /hr/attendance/clock (pointage éteint)',
      statutsAutorises: [409],
      envoyer: (c) =>
        request(serveur()).post('/hr/attendance/clock').set('Cookie', c).send({ kind: 'in' }),
    },
    // ADR-0051 — H10 : notes de frais et avances (§ 5.1, § 6.1).
    {
      // Tout rôle interne sauf Chef de projet ; ni Conseiller ni Expert-comptable externe.
      // Aucun compte de cette suite n'est relié à une fiche : 409 EMPLOYEE_NOT_LINKED
      // prouve que le guard a laissé passer jusqu'au service, aucune note créée.
      action: 'expenses.claim',
      libelle: 'POST /hr/expense-reports (sans fiche reliée)',
      statutsAutorises: [409],
      envoyer: (c) =>
        request(serveur())
          .post('/hr/expense-reports')
          .set('Cookie', c)
          .send({
            title: 'Sonde de matrice',
            currency: 'USD',
            lines: [
              {
                spentOn: '2026-01-05',
                category: 'transport',
                label: 'Taxi',
                amount: '1.00',
                missingReceiptReason: 'Sonde',
              },
            ],
          }),
    },
    {
      // PRO, DIR (ⓢ). La route déclare `expenses.approve` EN PREMIER (puis `hr.manage`) :
      // le 403 la nomme pour tout rôle refusé. Corps incomplet : 400 INVALID_REQUEST après
      // le guard, aucun réglage écrit.
      action: 'expenses.approve',
      libelle: 'PUT /hr/settings/advances',
      statutsAutorises: [400],
      envoyer: (c) =>
        request(serveur())
          .put('/hr/settings/advances')
          .set('Cookie', c)
          .send({ expectedRevision: null }),
    },
    // ADR-0051 — H15 : objectifs et évaluations (§ 5.1, § 6.3).
    {
      // Propriétaire et Responsable RH seulement (ni Administrateur ni Directeur financier,
      // qui détiennent `hr.manage`) ; la route déclare `performance.read` EN PREMIER : le
      // 403 la nomme. Évaluations éteintes par défaut : 409 HR_FEATURE_DISABLED prouve que
      // le guard a laissé passer jusqu'au service, sans rien activer dans cette suite.
      action: 'performance.read',
      libelle: 'GET /hr/review-cycles (évaluations éteintes)',
      statutsAutorises: [409],
      envoyer: (c) => request(serveur()).get('/hr/review-cycles').set('Cookie', c),
    },
  ];

  /** Devis minimal à un client de passage (ADR-0035 § 4). */
  function corpsDevisSonde(nom: string): Record<string, unknown> {
    return {
      currency: 'CDF',
      priceMode: 'ht',
      customer: { customerId: null, walkIn: { name: nom } },
      lines: [
        {
          source: 'free',
          code: 'SONDE',
          name: 'Prestation de sondage',
          itemType: 'SER',
          taxGroup: 'B',
          outOfScope: false,
          unit: 'heure',
          quantity: '1',
          unitPrice: '1000.00',
          specificTax: null,
          discount: null,
        },
      ],
      title: nom,
    };
  }

  /** Projet de RUN de sondage (`work`), créé une fois par le propriétaire. */
  let projetWork = '';
  async function projetWorkSonde(): Promise<string> {
    if (projetWork !== '') return projetWork;
    const res = await request(serveur())
      .post('/work/projects')
      .set('Cookie', cookiesDe('owner'))
      .send({ name: `Sonde RUN ${tag}`, kind: 'internal' });
    expect(res.status, `projet RUN de sondage : ${JSON.stringify(res.body)}`).toBe(201);
    projetWork = res.body.id as string;
    return projetWork;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Complétude — la sonde ne doit pas pouvoir se vider en silence
  // ───────────────────────────────────────────────────────────────────────────

  it('chaque action de la matrice a une sonde HTTP, ou une absence de route justifiée', () => {
    const sondees = new Set(SONDES.map((s) => s.action));
    const manquantes = ACTIONS.filter(
      (a) => !sondees.has(a) && ACTIONS_SANS_ROUTE[a] === undefined,
    );
    expect(
      manquantes,
      `Actions ni sondées ni justifiées :\n  ${manquantes.join('\n  ')}\n` +
        'Ajoutez une sonde dans SONDES, ou documentez l’absence de route dans ACTIONS_SANS_ROUTE.',
    ).toEqual([]);

    // Symétrique : une action justifiée « sans route » qui en aurait acquis une
    // doit sortir de la liste, sinon la dispense survit à sa raison d'être.
    for (const action of Object.keys(ACTIONS_SANS_ROUTE)) {
      expect(ACTIONS, `action inconnue dans ACTIONS_SANS_ROUTE : ${action}`).toContain(action);
      expect(
        sondees.has(action as Action),
        `${action} a désormais une sonde : retirez-la de ACTIONS_SANS_ROUTE.`,
      ).toBe(false);
      expect(ACTIONS_SANS_ROUTE[action]!.trim().length).toBeGreaterThan(30);
    }
  });

  it('les onze rôles ont une session authentifiée dans la même organisation', async () => {
    for (const role of ROLES_TESTES) {
      const res = await request(serveur()).get('/me/permissions').set('Cookie', cookiesDe(role));
      expect(res.status, `/me/permissions pour ${role}`).toBe(200);
      expect(res.body.organizationId, `org active de ${role}`).toBe(orgId);
      // Le rôle vu par le SERVEUR est bien celui attribué à l'invitation : sans
      // cette assertion, une erreur de résolution ferait passer tout le reste du
      // fichier en testant sept fois le même rôle.
      expect(res.body.role, `rôle résolu pour ${role}`).toBe(role);
    }
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────
  // Le cœur : chaque case de la matrice, vérifiée sur le réseau
  // ───────────────────────────────────────────────────────────────────────────

  for (const sonde of SONDES) {
    for (const role of ROLES_TESTES) {
      const nature = ORG_PERMISSION_MATRIX[role][sonde.action];
      // `conditional` (⚙) = refusé TANT QUE le droit explicite n'est pas accordé.
      // Le membership fraîchement créé porte `canClosePeriods: false` : la case
      // se lit donc « refusé » ici. Le cas accordé a son propre test plus bas.
      const attenduAutorise = nature !== 'deny' && nature !== 'conditional';

      it(`${sonde.action} · ${role} → ${attenduAutorise ? 'autorisé' : 'refusé'} (${sonde.libelle})`, async () => {
        const res = await sonde.envoyer(cookiesDe(role), role);

        if (attenduAutorise) {
          expect(
            res.status,
            `${role} devrait pouvoir ${sonde.action} — reçu ${res.status} ` +
              `${JSON.stringify(res.body).slice(0, 300)}`,
          ).not.toBe(403);
          expect(
            sonde.statutsAutorises,
            `${role} · ${sonde.action} : statut inattendu ${res.status} ` +
              `${JSON.stringify(res.body).slice(0, 300)}`,
          ).toContain(res.status);
          return;
        }

        expect(
          res.status,
          `${role} ne devrait PAS pouvoir ${sonde.action} — reçu ${res.status} ` +
            `${JSON.stringify(res.body).slice(0, 300)}`,
        ).toBe(403);
        // 403 et non 404 : le rôle est insuffisant DANS SA PROPRE organisation,
        // dont il connaît déjà l'existence (ADR-0012 §8). Le 404 est réservé au
        // cross-tenant — vérifié par `isolation.e2e.test.ts` et plus bas.
        expect(res.body.code, `${role} · ${sonde.action}`).toBe('FORBIDDEN');
        // Le corps nomme l'action refusée : un 403 générique ne permettrait pas
        // de distinguer « refus de la matrice » d'un refus venu d'ailleurs.
        expect(res.body.action, `${role} · ${sonde.action}`).toBe(sonde.action);
        expect(res.body.role, `${role} · ${sonde.action}`).toBe(role);
      }, 60_000);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // La case ⚙ — le seul droit conditionnel du modèle
  // ───────────────────────────────────────────────────────────────────────────

  it('⚙ le Comptable clôture UNE FOIS le droit `canClosePeriods` accordé, pas avant', async () => {
    const mois = 11;
    const seed = await request(serveur())
      .put(`/projects/${projetSonde}/actual-periods/1/${mois}`)
      .set('Cookie', cookiesDe('owner'))
      .send({ values: { ca: 900 } });
    expect(seed.status).toBe(200);

    // Avant : la case `conditional` se comporte comme un refus.
    const avant = await request(serveur())
      .post(`/projects/${projetSonde}/actual-periods/1/${mois}/close`)
      .set('Cookie', cookiesDe('accountant'))
      .send({});
    expect(avant.status).toBe(403);
    expect(avant.body.action).toBe('period.close');

    const accord = await request(serveur())
      .patch(`/organizations/${orgId}/members/${await userIdDe('accountant')}/close-right`)
      .set('Cookie', cookiesDe('owner'))
      .send({ value: true });
    expect(accord.status, JSON.stringify(accord.body)).toBe(200);
    expect(accord.body.member.canClosePeriods).toBe(true);

    const apres = await request(serveur())
      .post(`/projects/${projetSonde}/actual-periods/1/${mois}/close`)
      .set('Cookie', cookiesDe('accountant'))
      .send({});
    expect(apres.status, JSON.stringify(apres.body)).toBe(201);
    expect(apres.body.status).toBe('closed');
  }, 90_000);

  it('R3 — le Comptable qui peut clôturer ne peut PAS rouvrir (double permission)', async () => {
    // La réouverture exige `period.close` ET `plan.approve` détenues par le même
    // principal (ADR-0012 §6 R3). Le Comptable vient d'obtenir la première; il
    // n'aura jamais la seconde. C'est la conséquence VOULUE de la règle : celui
    // qui constate ne défait pas ce qu'il a figé.
    const reouverture = await request(serveur())
      .post(`/projects/${projetSonde}/actual-periods/1/11/reopen`)
      .set('Cookie', cookiesDe('accountant'))
      .send({ reason: 'Correction de saisie' });
    expect(reouverture.status).toBe(403);
    expect(reouverture.body.code).toBe('FORBIDDEN');
    expect(reouverture.body.action).toBe('plan.approve');
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────
  // La ligne inaccessible : `project_manager`
  // ───────────────────────────────────────────────────────────────────────────

  it('`project_manager` reste inattribuable (409 ROLE_NOT_ASSIGNABLE), invitation comprise', async () => {
    const cible = `rbac-pm-${tag}@lalanda-test.local`;
    emails.push(cible);

    const invitation = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookiesDe('owner'))
      .send({ email: cible, role: 'project_manager' });
    expect(invitation.status).toBe(409);
    expect(invitation.body.code).toBe('ROLE_NOT_ASSIGNABLE');

    // Même refus par changement de rôle : les deux portes mènent au même verrou.
    const changement = await request(serveur())
      .patch(`/organizations/${orgId}/members/${await userIdDe('viewer')}/role`)
      .set('Cookie', cookiesDe('owner'))
      .send({ role: 'project_manager' });
    expect(changement.status).toBe(409);
    expect(changement.body.code).toBe('ROLE_NOT_ASSIGNABLE');
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────
  // R7 — aucune invitation ni promotion au-dessus de son propre rôle
  // ───────────────────────────────────────────────────────────────────────────

  it("R7 — un `admin` ne peut inviter ni promouvoir un rôle qu'il ne détient pas", async () => {
    const cible = `rbac-esc-${tag}@lalanda-test.local`;
    emails.push(cible);

    // `finance_director` détient `plan.approve`, que l'`admin` n'a pas.
    const invitation = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookiesDe('admin'))
      .send({ email: cible, role: 'finance_director' });
    expect(invitation.status).toBe(403);
    expect(invitation.body.code).toBe('ROLE_ESCALATION');

    const promotion = await request(serveur())
      .patch(`/organizations/${orgId}/members/${await userIdDe('viewer')}/role`)
      .set('Cookie', cookiesDe('admin'))
      .send({ role: 'finance_director' });
    expect(promotion.status).toBe(403);
    expect(promotion.body.code).toBe('ROLE_ESCALATION');

    // En revanche `viewer` est bien un sous-ensemble d'`admin` : la règle
    // restreint sans paralyser. Sans cette moitié, un `grantableRoles()` qui
    // renverrait toujours vide passerait le test.
    const permise = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookiesDe('admin'))
      .send({ email: `rbac-ok-${tag}@lalanda-test.local`, role: 'viewer' });
    emails.push(`rbac-ok-${tag}@lalanda-test.local`);
    expect(permise.status, JSON.stringify(permise.body)).toBe(201);
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0040 — C0 : le Commercial, les devis et le correctif de trésorerie
  // ───────────────────────────────────────────────────────────────────────────

  it('critère 1 — le Commercial atteint le CRM, les devis et ses tâches', async () => {
    const c = cookiesDe('sales_rep');
    const s = serveur();
    expect((await request(s).get('/crm/pipeline').set('Cookie', c)).status).toBe(200);
    expect((await request(s).get('/sales/customers').set('Cookie', c)).status).toBe(200);
    expect((await request(s).get('/work/my-tasks').set('Cookie', c)).status).toBe(200);
    const devis = await request(s)
      .post('/sales/quotes')
      .set('Cookie', c)
      .send(corpsDevisSonde(`Devis du Commercial ${tag}`));
    expect(devis.status, JSON.stringify(devis.body)).toBe(201);
    // Envoyer, accepter, refuser, nouvelle version : la garde laisse passer le
    // Commercial. L'envoi d'un devis exige des taux DGI relevés (ADR-0035), hors
    // de propos ici : un brouillon non prêt rend 409 QUOTE_NOT_READY, preuve que la
    // requête a atteint le service, et un devis inconnu 404 — jamais 403.
    const envoi = await request(s)
      .post(`/sales/quotes/${devis.body.id}/send`)
      .set('Cookie', c)
      .send({ expectedRevision: devis.body.revision });
    expect(envoi.status, JSON.stringify(envoi.body)).not.toBe(403);
    expect([200, 409]).toContain(envoi.status);
    const z = '000000000000000000000000';
    for (const geste of ['accept', 'refuse', 'new-version']) {
      const res = await request(s)
        .post(`/sales/quotes/${z}/${geste}`)
        .set('Cookie', c)
        .send({ expectedRevision: 1 });
      expect(res.status, `${geste} : ${JSON.stringify(res.body)}`).not.toBe(403);
    }
    // Convertir en brouillon de facture : `sales.quote` + `sales.manage`.
    const conversion = await request(s)
      .post(`/sales/quotes/${devis.body.id}/convert`)
      .set('Cookie', c)
      .send({ expectedRevision: devis.body.revision });
    expect(conversion.status).toBe(403);
    expect(conversion.body).toMatchObject({ code: 'FORBIDDEN', action: 'sales.manage' });
  }, 90_000);

  it('critère 1 — le Commercial n’ouvre ni fiches, ni prix, ni factures, ni trésorerie, ni BUILD', async () => {
    const c = cookiesDe('sales_rep');
    const s = serveur();
    const z = '000000000000000000000000';
    const refus: [string, () => request.Test, Action][] = [
      ['POST /sales/customers', () => request(s).post('/sales/customers').send({}), 'sales.manage'],
      [
        'PUT /sales/catalog-items/:id',
        () => request(s).put(`/sales/catalog-items/${z}`).send({}),
        'sales.manage',
      ],
      [
        'POST /sales/invoices/:id/issue',
        () => request(s).post(`/sales/invoices/${z}/issue`).send({}),
        'sales.invoice',
      ],
      ['POST /sales/receipts', () => request(s).post('/sales/receipts').send({}), 'sales.receipt'],
      ['GET /treasury/accounts', () => request(s).get('/treasury/accounts'), 'treasury.read'],
      ['GET /treasury/expenses', () => request(s).get('/treasury/expenses'), 'treasury.read'],
      ['GET /projects', () => request(s).get('/projects'), 'project.read'],
      [
        'GET /projects/:id/variances',
        () => request(s).get(`/projects/${projetSonde}/variances?year=1`),
        'project.read',
      ],
      [
        'GET /projects/:id/updated-projection',
        () => request(s).get(`/projects/${projetSonde}/updated-projection?year=1`),
        'project.read',
      ],
      [
        'GET /projects/:id/objectives/attainment',
        () => request(s).get(`/projects/${projetSonde}/objectives/attainment`),
        'project.read',
      ],
    ];
    for (const [libelle, envoyer, action] of refus) {
      const res = await envoyer().set('Cookie', c);
      expect(res.status, `${libelle} : ${res.status} ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, libelle).toMatchObject({ code: 'FORBIDDEN', action, role: 'sales_rep' });
    }
  }, 90_000);

  it('§ 4.4 — les écarts du réalisé restent ouverts aux rôles qui lisent les projets', async () => {
    // Aucun rôle existant ne perd l'accès : tous les détenteurs d'`analytics.read`
    // ont `project.read`, le Commercial et le Responsable RH exceptés.
    for (const role of ROLES_TESTES) {
      const res = await request(serveur())
        .get(`/projects/${projetSonde}/variances?year=1`)
        .set('Cookie', cookiesDe(role));
      // ADR-0045 : le Responsable RH ne lit pas les projets BUILD non plus ; ADR-0046 : ni
      // le Magasinier ; ADR-0049 : ni l'Expert-comptable (externe).
      expect(res.status, `${role} : ${JSON.stringify(res.body)}`).toBe(
        role === 'sales_rep' ||
          role === 'hr_manager' ||
          role === 'storekeeper' ||
          role === 'external_accountant'
          ? 403
          : 200,
      );
    }
  }, 90_000);

  it('critère 2 — brief : trésorerie masquée sans `treasury.read`, visible pour le Lecteur', async () => {
    for (const role of ROLES_TESTES) {
      const res = await request(serveur()).get('/morning-brief').set('Cookie', cookiesDe(role));
      expect(res.status, role).toBe(200);
      const facts = res.body.brief.facts as { id: string; status: string; value: unknown }[];
      const tresorerie = facts.filter(
        (f) => f.id === 'tresorerie' || f.id.startsWith('tresorerie.'),
      );
      expect(tresorerie.length, role).toBeGreaterThan(0);
      if (ORG_PERMISSION_MATRIX[role]['treasury.read'] === 'deny') {
        expect(tresorerie, role).toEqual([
          expect.objectContaining({ id: 'tresorerie', status: 'hidden', value: null }),
        ]);
        const regles = (res.body.brief.recommendations as { ruleId: string }[]).map(
          (r) => r.ruleId,
        );
        expect(regles, role).not.toContain('tresorerie_a_renseigner');
      } else {
        for (const f of tresorerie) expect(f.status, role).not.toBe('hidden');
      }
    }
    // Les deux rôles concernés par le correctif, nommés : le Commercial et le Conseiller.
    expect(ORG_PERMISSION_MATRIX.sales_rep['treasury.read']).toBe('deny');
    expect(ORG_PERMISSION_MATRIX.advisor['treasury.read']).toBe('deny');
    expect(ORG_PERMISSION_MATRIX.viewer['treasury.read']).toBe('allow');
  }, 90_000);

  it('critère 2 — GROW : aucun fait de trésorerie sans `treasury.read`', async () => {
    // Un solde déclaré et un compte de trésorerie existent : sans le correctif,
    // l'autonomie et le profil les citeraient.
    const declare = await request(serveur())
      .put('/grow/declared-cash')
      .set('Cookie', cookiesDe('owner'))
      .send({ amount: '424242.00', currency: 'USD', asOf: '2026-10-01' });
    expect(declare.status, JSON.stringify(declare.body)).toBe(200);

    for (const role of ROLES_TESTES) {
      const c = cookiesDe(role);
      const sansTresorerie = ORG_PERMISSION_MATRIX[role]['treasury.read'] === 'deny';
      const health = await request(serveur()).get('/grow/health').set('Cookie', c);
      const indicators = await request(serveur()).get('/grow/indicators').set('Cookie', c);
      const journey = await request(serveur()).get('/grow/journey').set('Cookie', c);
      const profile = await request(serveur()).get('/grow/profile').set('Cookie', c);
      for (const res of [health, indicators, journey, profile]) {
        expect(res.status, `${role} ${JSON.stringify(res.body)}`).toBe(200);
      }
      const corps = JSON.stringify([health.body, indicators.body, journey.body, profile.body]);
      if (sansTresorerie) {
        expect(corps, role).not.toContain('424242');
        expect(corps, role).not.toContain('grow.declared_cash');
        expect(corps, role).not.toContain('treasury.accounts');
        expect(profile.body.declaredCash, role).toBeNull();
        expect(indicators.body.indicateurs.runway, role).toMatchObject({
          disponible: false,
          raison: 'TRESORERIE_MASQUEE',
        });
        const axe = (
          health.body.health.axes as { axe: string; metriques: { raison: string | null }[] }[]
        ).find((a) => a.axe === 'tresorerie');
        expect(
          axe?.metriques.map((m) => m.raison),
          role,
        ).toEqual(['TRESORERIE_MASQUEE']);
      } else {
        expect(profile.body.declaredCash, role).toMatchObject({ amount: '424242.00' });
        expect(indicators.body.indicateurs.runway.raison, role).not.toBe('TRESORERIE_MASQUEE');
      }
    }
  }, 120_000);

  it('critère 3 — l’Administrateur invite un Commercial ; le Comptable ne peut pas', async () => {
    const parAdmin = `rbac-com-admin-${tag}@lalanda-test.local`;
    const parComptable = `rbac-com-cpt-${tag}@lalanda-test.local`;
    emails.push(parAdmin, parComptable);
    const ok = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookiesDe('admin'))
      .send({ email: parAdmin, role: 'sales_rep' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.invitation.role).toBe('sales_rep');
    const refus = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookiesDe('accountant'))
      .send({ email: parComptable, role: 'sales_rep' });
    expect(refus.status).toBe(403);
    expect(refus.body).toMatchObject({ code: 'FORBIDDEN', action: 'members.invite' });
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0045 — H0 : le Responsable RH (§ 4.2), attribuable par le seul Propriétaire
  // ───────────────────────────────────────────────────────────────────────────

  it('critère 2 — l’Administrateur ne nomme pas un Responsable RH ; le Propriétaire le peut', async () => {
    const parAdmin = `rbac-rh-admin-${tag}@lalanda-test.local`;
    const parProprietaire = `rbac-rh-pro-${tag}@lalanda-test.local`;
    emails.push(parAdmin, parProprietaire);
    const refus = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookiesDe('admin'))
      .send({ email: parAdmin, role: 'hr_manager' });
    expect(refus.status, JSON.stringify(refus.body)).toBe(403);
    expect(refus.body.code).toBe('ROLE_ESCALATION');

    const promotion = await request(serveur())
      .patch(`/organizations/${orgId}/members/${await userIdDe('viewer')}/role`)
      .set('Cookie', cookiesDe('admin'))
      .send({ role: 'hr_manager' });
    expect(promotion.status, JSON.stringify(promotion.body)).toBe(403);
    expect(promotion.body.code).toBe('ROLE_ESCALATION');

    const ok = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookiesDe('owner'))
      .send({ email: parProprietaire, role: 'hr_manager' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.invitation.role).toBe('hr_manager');
  }, 60_000);

  it('critère 1 — le Responsable RH ne voit ni trésorerie, ni achats, ni ventes', async () => {
    const c = cookiesDe('hr_manager');
    const s = serveur();
    const refus: [string, string, Action][] = [
      ['GET /treasury/expenses', '/treasury/expenses', 'treasury.read'],
      ['GET /purchases/orders', '/purchases/orders', 'purchase.read'],
      ['GET /sales/invoices', '/sales/invoices', 'sales.read'],
    ];
    for (const [libelle, chemin, action] of refus) {
      const res = await request(s).get(chemin).set('Cookie', c);
      expect(res.status, `${libelle} : ${res.status} ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, libelle).toMatchObject({ code: 'FORBIDDEN', action, role: 'hr_manager' });
    }
    // Il suit les projets internes et ses tâches, comme tout membre qui travaille.
    expect((await request(s).get('/work/my-tasks').set('Cookie', c)).status).toBe(200);
    const moi = await request(s).get('/me/permissions').set('Cookie', c);
    expect(moi.status).toBe(200);
    expect(moi.body.actions).toEqual([
      'analytics.read',
      'work.read',
      'work.update',
      'hr.read',
      'hr.manage',
      'hr.sensitive.read',
      'leave.request',
      'leave.approve',
      // ADR-0046 § 8.1 : le matériel (sans coûts) et la bibliothèque.
      'assets.read',
      'docs.read',
      'docs.manage',
      // ADR-0051 § 5.1 : ses frais et son pointage ; objectifs et évaluations de tous.
      'expenses.claim',
      'attendance.clock',
      'performance.read',
    ]);
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0046 — S0 : le Magasinier (§ 8.2)
  // ───────────────────────────────────────────────────────────────────────────

  it('R7 — l’Administrateur nomme un Magasinier ; le Comptable ne peut pas inviter', async () => {
    const parAdmin = `rbac-mag-admin-${tag}@lalanda-test.local`;
    const parComptable = `rbac-mag-cpt-${tag}@lalanda-test.local`;
    emails.push(parAdmin, parComptable);
    const ok = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookiesDe('admin'))
      .send({ email: parAdmin, role: 'storekeeper' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.invitation.role).toBe('storekeeper');

    const refus = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookiesDe('accountant'))
      .send({ email: parComptable, role: 'storekeeper' });
    expect(refus.status, JSON.stringify(refus.body)).toBe(403);
    expect(refus.body).toMatchObject({ code: 'FORBIDDEN', action: 'members.invite' });
  }, 60_000);

  it('critère 1 — le Magasinier ne voit ni achats, ni trésorerie, ni ventes', async () => {
    const c = cookiesDe('storekeeper');
    const s = serveur();
    const refus: [string, string, Action][] = [
      ['GET /purchases/orders', '/purchases/orders', 'purchase.read'],
      ['GET /treasury/expenses', '/treasury/expenses', 'treasury.read'],
      ['GET /sales/invoices', '/sales/invoices', 'sales.read'],
    ];
    for (const [libelle, chemin, action] of refus) {
      const res = await request(s).get(chemin).set('Cookie', c);
      expect(res.status, `${libelle} : ${res.status} ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, libelle).toMatchObject({ code: 'FORBIDDEN', action, role: 'storekeeper' });
    }
    // Il suit ses tâches, comme tout membre qui travaille.
    expect((await request(s).get('/work/my-tasks').set('Cookie', c)).status).toBe(200);
    const moi = await request(s).get('/me/permissions').set('Cookie', c);
    expect(moi.status).toBe(200);
    expect(moi.body.actions).toEqual([
      'analytics.read',
      'work.read',
      'work.update',
      'leave.request',
      'stock.read',
      'stock.move',
      'stock.count',
      'assets.read',
      'docs.read',
      // ADR-0051 § 5.1 : ses frais et son pointage, comme `leave.request`.
      'expenses.claim',
      'attendance.clock',
    ]);
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0049 — K0 : l'Expert-comptable externe (§ 8.2), attribuable par le seul Propriétaire
  // ───────────────────────────────────────────────────────────────────────────

  it('critère 1 — ni l’Administrateur ni le Directeur financier ne nomment un Expert-comptable ; le Propriétaire le peut', async () => {
    const parAdmin = `rbac-exp-admin-${tag}@lalanda-test.local`;
    const parProprietaire = `rbac-exp-pro-${tag}@lalanda-test.local`;
    emails.push(parAdmin, parProprietaire);
    const refus = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookiesDe('admin'))
      .send({ email: parAdmin, role: 'external_accountant' });
    expect(refus.status, JSON.stringify(refus.body)).toBe(403);
    expect(refus.body.code).toBe('ROLE_ESCALATION');

    const promotion = await request(serveur())
      .patch(`/organizations/${orgId}/members/${await userIdDe('viewer')}/role`)
      .set('Cookie', cookiesDe('admin'))
      .send({ role: 'external_accountant' });
    expect(promotion.status, JSON.stringify(promotion.body)).toBe(403);
    expect(promotion.body.code).toBe('ROLE_ESCALATION');

    const ok = await request(serveur())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookiesDe('owner'))
      .send({ email: parProprietaire, role: 'external_accountant' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.invitation.role).toBe('external_accountant');
  }, 60_000);

  it('critère 1 — l’Expert-comptable ne voit ni ventes, ni trésorerie, ni achats, ni projets', async () => {
    const c = cookiesDe('external_accountant');
    const s = serveur();
    const refus: [string, string, Action][] = [
      ['GET /sales/invoices', '/sales/invoices', 'sales.read'],
      ['GET /treasury/expenses', '/treasury/expenses', 'treasury.read'],
      ['GET /purchases/orders', '/purchases/orders', 'purchase.read'],
      ['GET /work/my-tasks', '/work/my-tasks', 'work.read'],
    ];
    for (const [libelle, chemin, action] of refus) {
      const res = await request(s).get(chemin).set('Cookie', c);
      expect(res.status, `${libelle} : ${res.status} ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, libelle).toMatchObject({
        code: 'FORBIDDEN',
        action,
        role: 'external_accountant',
      });
    }
    const moi = await request(s).get('/me/permissions').set('Cookie', c);
    expect(moi.status).toBe(200);
    expect(moi.body.actions).toEqual(['analytics.read', 'accounting.read', 'accounting.export']);
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0050 — V0 : contrats et commandes clients (§ 8.1), sans route avant V2 et V3
  // ───────────────────────────────────────────────────────────────────────────

  it('critère 1 — `/me/permissions` : préparent Propriétaire, Administrateur, Directeur financier, Comptable, Commercial ; approuvent Propriétaire et Directeur financier', async () => {
    const s = serveur();
    for (const role of ROLES_TESTES) {
      const moi = await request(s).get('/me/permissions').set('Cookie', cookiesDe(role));
      expect(moi.status, role).toBe(200);
      const actions = moi.body.actions as string[];
      expect(actions.includes('sales.contract'), `${role} × sales.contract`).toBe(
        ['owner', 'admin', 'finance_director', 'accountant', 'sales_rep'].includes(role),
      );
      expect(actions.includes('sales.contract.approve'), `${role} × sales.contract.approve`).toBe(
        ['owner', 'finance_director'].includes(role),
      );
    }
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0051 — H8 : RH, second volet (§ 5.1), sans route avant H10, H12 et H15
  // ───────────────────────────────────────────────────────────────────────────

  it('ADR-0051 critère 1 — `/me/permissions` : déclarer et pointer comme `leave.request` ; valider : Propriétaire et Directeur financier ; évaluations : Propriétaire et Responsable RH', async () => {
    const s = serveur();
    for (const role of ROLES_TESTES) {
      const moi = await request(s).get('/me/permissions').set('Cookie', cookiesDe(role));
      expect(moi.status, role).toBe(200);
      const actions = moi.body.actions as string[];
      for (const action of ['expenses.claim', 'attendance.clock']) {
        expect(actions.includes(action), `${role} × ${action}`).toBe(
          actions.includes('leave.request'),
        );
      }
      expect(actions.includes('expenses.approve'), `${role} × expenses.approve`).toBe(
        ['owner', 'finance_director'].includes(role),
      );
      expect(actions.includes('performance.read'), `${role} × performance.read`).toBe(
        ['owner', 'hr_manager'].includes(role),
      );
    }
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0053 — P0 : console Lalanda (actions plateforme). Les sondes par rôle plateforme
  // et l'isolation exhaustive vivent dans `admin-platform-isolation.e2e.test.ts`.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Action plateforme → route qui la sonde, ou lot qui la posera. Une action sans l'un ni
   * l'autre fait rougir le test : la sonde suit la route.
   */
  const SONDES_PLATEFORME: Record<PlatformAction, string> = {
    'platform.console.read': 'GET /admin/overview',
    'platform.orgs.read': 'lot P2 (routes `/admin/organizations` converties en actions)',
    'platform.orgs.suspend': 'lot P2',
    'platform.users.read': 'lot P2',
    'platform.users.block': 'lot P2',
    'platform.roles.manage': 'lot P2',
    'platform.billing.read': 'lot P3 (`/admin/billing/**`)',
    'platform.billing.confirm': 'lot P3',
    'platform.billing.grant': 'lot P3',
    'platform.features.read': 'lot P4',
    'platform.features.override': 'lot P4',
    'platform.integrations.manage': 'lot P2 ou P5 (`/admin/integrations`, rôle inchangé)',
    'platform.audit.read': 'lot P5',
    'platform.audit.export': 'lot P5',
    'platform.announcements.draft': 'lot P6',
    'platform.announcements.approve': 'lot P6',
    'platform.stats.read': 'lot P7',
    'platform.finance.read': 'lot P7',
    'platform.finance.export': 'lot P7',
    'platform.packs.manage': 'lot P2 (`/accounting/platform/chart-packs`, rôle inchangé)',
    'platform.templates.manage': 'aucune route de modèles sectoriels à ce jour',
  };

  it('ADR-0053 — chaque action plateforme a une sonde ou le lot qui la posera', () => {
    expect(Object.keys(SONDES_PLATEFORME).sort()).toEqual([...PLATFORM_ACTIONS].sort());
    expect(SONDES_PLATEFORME['platform.console.read']).toBe('GET /admin/overview');
  });

  it('ADR-0053 critère 2 — aucun rôle d’organisation n’ouvre la console ni ne détient d’action plateforme', async () => {
    const s = serveur();
    for (const role of ROLES_TESTES) {
      const tableau = await request(s).get('/admin/overview').set('Cookie', cookiesDe(role));
      expect(tableau.status, `${role} : ${JSON.stringify(tableau.body)}`).toBe(403);
      expect(tableau.body).toMatchObject({ code: 'FORBIDDEN', action: 'platform.console.read' });
      const acces = await request(s).get('/me/platform-access').set('Cookie', cookiesDe(role));
      expect(acces.status, role).toBe(200);
      expect(acces.body.actions, role).toEqual([]);
      // Et `/me/permissions` ne mélange jamais les deux vocabulaires.
      const moi = await request(s).get('/me/permissions').set('Cookie', cookiesDe(role));
      for (const action of moi.body.actions as string[]) {
        expect(action.startsWith('platform.'), `${role} × ${action}`).toBe(false);
      }
    }
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0052 — O0 : statut de complétude, ouvert à tout membre (§ 7), sans action nouvelle
  // ───────────────────────────────────────────────────────────────────────────

  it('ADR-0052 critères 1 et 8 — `/organizations/current/setup` : 200 pour chaque rôle, `canAct` = droits effectifs', async () => {
    const s = serveur();
    for (const role of ROLES_TESTES) {
      const res = await request(s)
        .get('/organizations/current/setup')
        .set('Cookie', cookiesDe(role));
      expect(res.status, `${role} : ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.organizationId, role).toBe(orgId);
      const moi = await request(s).get('/me/permissions').set('Cookie', cookiesDe(role));
      const actions = moi.body.actions as string[];
      for (const etape of res.body.steps as { id: OrganizationSetupStepId; canAct: boolean }[]) {
        const action = ORGANIZATION_SETUP_STEPS[etape.id].action;
        expect(etape.canAct, `${role} × ${etape.id}`).toBe(
          action === null ? true : actions.includes(action),
        );
      }
    }
  }, 60_000);

  /** userId d'un rôle, lu depuis le trombinoscope — l'API ne l'expose pas ailleurs. */
  async function userIdDe(role: RoleTeste): Promise<string> {
    const res = await request(serveur())
      .get(`/organizations/${orgId}/members`)
      .set('Cookie', cookiesDe('owner'));
    expect(res.status).toBe(200);
    const membre = (res.body.members as { userId: string; role: OrgRole }[]).find(
      (m) => m.role === role,
    );
    expect(membre, `aucun membre au rôle ${role}`).toBeDefined();
    return membre!.userId;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0053 — P2 : routes de comptes et d'organisations de la console. Aucun rôle
  // d'organisation ne les ouvre ; le refus nomme l'action PLATEFORME, avant toute
  // ré-authentification, recherche ou motif (le 403 ne renseigne sur rien d'autre).
  // ───────────────────────────────────────────────────────────────────────────

  it('ADR-0053 P2 — aucun rôle d’organisation n’ouvre les comptes, organisations ni blocages', async () => {
    const s = serveur();
    const factice = '0123456789abcdef01234567';
    const sondes: Array<[string, string, PlatformAction]> = [
      ['get', '/admin/organizations', 'platform.orgs.read'],
      ['get', `/admin/organizations/${orgId}?reason=support`, 'platform.orgs.read'],
      ['post', `/admin/organizations/${orgId}/suspend`, 'platform.orgs.suspend'],
      ['post', `/admin/organizations/${orgId}/restore`, 'platform.orgs.suspend'],
      ['get', '/admin/users?q=abc', 'platform.users.read'],
      ['get', `/admin/users/${factice}?reason=support`, 'platform.users.read'],
      ['post', `/admin/users/${factice}/block`, 'platform.users.block'],
      ['post', `/admin/users/${factice}/unblock`, 'platform.users.block'],
      ['post', `/admin/users/${factice}/platform-roles`, 'platform.roles.manage'],
      ['get', '/admin/audit-events', 'platform.audit.read'],
    ];
    // Quota global de 100 requêtes par minute et par IP : remis à zéro par rôle.
    const { ThrottlerStorage } = await import('@nestjs/throttler');
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const role of ROLES_TESTES) {
      for (const t of store.timeoutIds.values()) t.forEach(clearTimeout);
      store.timeoutIds.clear();
      store.storage.clear();
      for (const [verbe, chemin, action] of sondes) {
        const req = request(s) as unknown as Record<string, (p: string) => request.Test>;
        const res = await req[verbe]!(chemin).set('Cookie', cookiesDe(role)).send({});
        expect(res.status, `${role} × ${verbe} ${chemin}`).toBe(403);
        expect(res.body, `${role} × ${verbe} ${chemin}`).toMatchObject({
          code: 'FORBIDDEN',
          action,
        });
      }
    }
  }, 120_000);

  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0052 — O2/O3 : déclarations de la mise en route (§ 4), action de l'étape (§ 7)
  // ───────────────────────────────────────────────────────────────────────────

  it('ADR-0052 O2/O3 — chaque déclaration suit les droits effectifs de son étape', async () => {
    const s = serveur();
    // Sondes sans effet durable : retirer un report absent est idempotent ; un corps de
    // modules invalide répond 400 à qui a le droit, 403 aux autres (le guard passe avant).
    const sondes: {
      methode: 'delete' | 'put';
      chemin: string;
      corps?: object;
      action: string;
      ok: number;
    }[] = [
      { methode: 'delete', chemin: 'deferred/normalisation', action: 'fiscal.manage', ok: 200 },
      { methode: 'delete', chemin: 'deferred/tresorerie', action: 'treasury.manage', ok: 200 },
      { methode: 'delete', chemin: 'deferred/comptabilite', action: 'accounting.manage', ok: 200 },
      { methode: 'delete', chemin: 'deferred/equipe', action: 'members.invite', ok: 200 },
      {
        methode: 'put',
        chemin: 'modules',
        corps: { modules: [] },
        action: 'organization.manage',
        ok: 400,
      },
    ];
    // Quota global de requêtes par IP : remis à zéro par rôle, comme le bloc P2.
    const { ThrottlerStorage } = await import('@nestjs/throttler');
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const role of ROLES_TESTES) {
      for (const t of store.timeoutIds.values()) t.forEach(clearTimeout);
      store.timeoutIds.clear();
      store.storage.clear();
      const moi = await request(s).get('/me/permissions').set('Cookie', cookiesDe(role));
      const actions = moi.body.actions as string[];
      for (const sonde of sondes) {
        const agent = request(s);
        const chemin = `/organizations/current/setup/${sonde.chemin}`;
        const req = (sonde.methode === 'put' ? agent.put(chemin) : agent.delete(chemin)).set(
          'Cookie',
          cookiesDe(role),
        );
        const res = await (sonde.corps ? req.send(sonde.corps) : req);
        expect(res.status, `${role} × ${sonde.chemin} : ${JSON.stringify(res.body)}`).toBe(
          actions.includes(sonde.action) ? sonde.ok : 403,
        );
      }
      // La fiche fiscale ne se reporte jamais (critère 7).
      const fiscal = await request(s)
        .put('/organizations/current/setup/deferred/fiscal')
        .set('Cookie', cookiesDe(role));
      expect(fiscal.status, role).toBe(404);
    }
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0053 — P3 : abonnements et paiements manuels de la console. Aucun rôle
  // d'organisation ne les ouvre — `billing.manage` du Propriétaire compris : il
  // s'accorderait sinon ses propres abonnements. Le refus nomme l'action PLATEFORME.
  // ───────────────────────────────────────────────────────────────────────────

  it('ADR-0053 P3 — aucun rôle d’organisation n’ouvre `/admin/billing/**`', async () => {
    const s = serveur();
    const factice = '0123456789abcdef01234567';
    const sondes: Array<[string, string, PlatformAction]> = [
      ['get', '/admin/billing/subscriptions', 'platform.billing.read'],
      ['get', '/admin/billing/manual-payments', 'platform.billing.read'],
      ['get', '/admin/billing/grants', 'platform.billing.read'],
      ['post', '/admin/billing/manual-payments/LLD-X/confirm', 'platform.billing.confirm'],
      ['post', '/admin/billing/manual-payments/LLD-X/reject', 'platform.billing.confirm'],
      ['post', '/admin/billing/sweep', 'platform.billing.confirm'],
      ['post', '/admin/billing/grants', 'platform.billing.grant'],
      ['post', `/admin/billing/grants/${factice}/approve`, 'platform.billing.grant'],
      ['delete', `/admin/billing/grants/${factice}`, 'platform.billing.grant'],
    ];
    const { ThrottlerStorage } = await import('@nestjs/throttler');
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const role of ROLES_TESTES) {
      for (const t of store.timeoutIds.values()) t.forEach(clearTimeout);
      store.timeoutIds.clear();
      store.storage.clear();
      for (const [verbe, chemin, action] of sondes) {
        const req = request(s) as unknown as Record<string, (p: string) => request.Test>;
        const res = await req[verbe]!(chemin).set('Cookie', cookiesDe(role)).send({});
        expect(res.status, `${role} × ${verbe} ${chemin}`).toBe(403);
        expect(res.body, `${role} × ${verbe} ${chemin}`).toMatchObject({
          code: 'FORBIDDEN',
          action,
        });
      }
    }
  }, 120_000);
  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0053 — P5 : journal plateforme, export et événements de sécurité. Aucun rôle
  // d'organisation ne les ouvre — Propriétaire compris, qui garde son seul journal
  // d'organisation (`/audit-events`). Le refus nomme l'action PLATEFORME, avant toute
  // validation de filtre, de motif ou de limite de débit.
  // ───────────────────────────────────────────────────────────────────────────

  it('ADR-0053 P5 — aucun rôle d’organisation n’ouvre le journal plateforme ni la sécurité', async () => {
    const s = serveur();
    const sondes: Array<[string, PlatformAction]> = [
      ['/admin/audit-events?action=user.disabled', 'platform.audit.read'],
      ['/admin/audit-events/export.csv?reason=security', 'platform.audit.export'],
      ['/admin/audit-events/export.csv', 'platform.audit.export'],
      ['/admin/security-events', 'platform.audit.read'],
    ];
    const { ThrottlerStorage } = await import('@nestjs/throttler');
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const role of ROLES_TESTES) {
      for (const t of store.timeoutIds.values()) t.forEach(clearTimeout);
      store.timeoutIds.clear();
      store.storage.clear();
      for (const [chemin, action] of sondes) {
        const res = await request(s).get(chemin).set('Cookie', cookiesDe(role));
        expect(res.status, `${role} × GET ${chemin}`).toBe(403);
        expect(res.body, `${role} × GET ${chemin}`).toMatchObject({ code: 'FORBIDDEN', action });
        expect(String(res.headers['content-type'] ?? ''), chemin).not.toContain('text/csv');
      }
    }
  }, 120_000);

  // ───────────────────────────────────────────────────────────────────────────
  // ADR-0053 — P6 : annonces de la console. Aucun rôle d'organisation — Propriétaire
  // compris — ne prépare, n'approuve ni n'envoie une annonce ; le refus nomme l'action
  // PLATEFORME. `/me/announcements` reste ouvert à chacun pour SES annonces.
  // ───────────────────────────────────────────────────────────────────────────

  it('ADR-0053 P6 — aucun rôle d’organisation ne crée ni n’envoie d’annonce', async () => {
    const s = serveur();
    const factice = '0123456789abcdef01234567';
    const sondes: Array<[string, string, PlatformAction]> = [
      ['get', '/admin/announcements', 'platform.announcements.draft'],
      ['post', '/admin/announcements', 'platform.announcements.draft'],
      ['put', `/admin/announcements/${factice}`, 'platform.announcements.draft'],
      ['post', `/admin/announcements/${factice}/preview`, 'platform.announcements.draft'],
      ['post', `/admin/announcements/${factice}/submit`, 'platform.announcements.draft'],
      ['post', `/admin/announcements/${factice}/cancel`, 'platform.announcements.draft'],
      ['post', `/admin/announcements/${factice}/approve`, 'platform.announcements.approve'],
      ['post', `/admin/announcements/${factice}/send`, 'platform.announcements.approve'],
    ];
    const { ThrottlerStorage } = await import('@nestjs/throttler');
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const role of ROLES_TESTES) {
      for (const t of store.timeoutIds.values()) t.forEach(clearTimeout);
      store.timeoutIds.clear();
      store.storage.clear();
      for (const [verbe, chemin, action] of sondes) {
        const req = request(s) as unknown as Record<string, (p: string) => request.Test>;
        const res = await req[verbe]!(chemin)
          .set('Cookie', cookiesDe(role))
          .send({ title: 'x', body: 'y', audience: {} });
        expect(res.status, `${role} × ${verbe} ${chemin}`).toBe(403);
        expect(res.body, `${role} × ${verbe} ${chemin}`).toMatchObject({
          code: 'FORBIDDEN',
          action,
        });
      }
      const mes = await request(s).get('/me/announcements').set('Cookie', cookiesDe(role));
      expect(mes.status, role).toBe(200);
      expect(Array.isArray(mes.body.announcements), role).toBe(true);
    }
  }, 120_000);
});
