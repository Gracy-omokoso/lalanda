// Isolation entre organisations d'une MÊME personne — ADR-0052 critère 16 (lot O6).
//
// `isolation.e2e.test.ts` couvre deux personnes de deux sociétés et, pour une même
// personne, les projets seulement. Ici, Alice possède A et B : tout ce qu'elle écrit
// dans A (BUILD, RUN, GROW) doit rester invisible quand son cookie `active_org_id`
// désigne B — listes sans trace de A, lecture et suppression d'un identifiant de A
// en 404 — et inversement. Carole, membre invitée de A, possède sa propre société C :
// ses données de C ne passent pas dans A, celles de A ne passent pas dans C, et
// Alice, qui n'est pas membre de C, ne peut pas s'y placer par le cookie.
//
// Méthode de contrôle des listes : chaque libellé écrit porte un marqueur propre à
// son organisation (`ALPHA…`, `BRAVO…`, `CHARLIE…`), et la réponse ENTIÈRE est
// cherchée pour ce marqueur et pour les identifiants créés. Le contrôle ne dépend
// donc pas de la forme de chaque réponse : un champ imbriqué qui fuirait se verrait.
//
// Données inventées.

import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import 'reflect-metadata';

import { e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const tag = randomBytes(4).toString('hex');
const MARQUE = { A: `ALPHA${tag}`, B: `BRAVO${tag}`, C: `CHARLIE${tag}` } as const;
type Org = keyof typeof MARQUE;

const fiscal = (nif: string) => ({
  legalName: 'Exemple SARL',
  tradeName: null,
  legalForm: 'sarl',
  legalFormOther: null,
  nif,
  rccm: null,
  nationalId: null,
  vatRegistered: true,
  headOffice: {
    line1: '1, avenue Exemple',
    line2: null,
    commune: 'Gombe',
    city: 'Kinshasa',
    province: 'Kinshasa',
  },
  phone: '+243 800 000 000',
  email: 'facturation@exemple.cd',
});

const LIGNE = {
  source: 'free',
  code: 'CONSEIL-H',
  name: 'Conseil (heure)',
  itemType: 'SER',
  taxGroup: 'B',
  outOfScope: false,
  unit: 'heure',
  quantity: '2',
  unitPrice: '40.00',
  specificTax: null,
  discount: null,
};

/** Listes contrôlées dans chaque organisation : BUILD, RUN, GROW et transverses. */
const LISTES = [
  '/projects',
  '/idea-lab/ideas',
  '/sales/customers',
  '/sales/invoices',
  '/treasury/accounts',
  '/treasury/expenses',
  '/work/projects',
  '/work/tasks',
  '/work/my-tasks',
  '/stock/items',
  '/crm/accounts',
  '/crm/opportunities',
  '/hr/employees',
  '/grow/profile',
  '/grow/indicators',
  '/grow/health',
  '/notifications',
  '/morning-brief',
] as const;

/** Ce qu'une organisation a écrit : identifiants par famille. */
interface Ecrits {
  project: string;
  idea: string;
  customer: string;
  invoice: string;
  treasuryAccount: string;
  expense: string;
  workProject: string;
  task: string;
  stockItem: string;
  crmAccount: string;
  opportunity: string;
  employee: string;
}

e2eSuite('isolation — même utilisateur, plusieurs organisations (ADR-0052 critère 16)', () => {
  let app: INestApplication;
  const comptes = {
    alice: {
      email: `iso-alice-${tag}@lalanda-test.local`,
      password: 'Passw0rd!alice',
      name: 'Alice',
    },
    carole: {
      email: `iso-carole-${tag}@lalanda-test.local`,
      password: 'Passw0rd!carole',
      name: 'Carole',
    },
  };
  const cookies = { alice: [] as string[], carole: [] as string[] };
  const org = { A: '', B: '', C: '' };
  const aliceId = { value: '' };
  const ecrits = {} as Record<'A' | 'B', Ecrits>;
  let customerC = '';

  const server = () => app.getHttpServer();
  const as = (qui: 'alice' | 'carole', o: Org) => [...cookies[qui], `active_org_id=${org[o]}`];
  const get = (c: string[], path: string) => request(server()).get(path).set('Cookie', c);
  const post = (c: string[], path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', c)
      .send((body ?? {}) as object);
  const put = (c: string[], path: string, body: unknown) =>
    request(server())
      .put(path)
      .set('Cookie', c)
      .send(body as object);
  const del = (c: string[], path: string) => request(server()).delete(path).set('Cookie', c);

  const ok = (res: request.Response, status = 200): Record<string, any> => {
    expect(res.status, `${res.req?.method} ${res.req?.path} ${JSON.stringify(res.body)}`).toBe(
      status,
    );
    return res.body as Record<string, any>;
  };
  const idOf = (body: Record<string, any>): string => {
    const id =
      body['id'] ?? body['account']?.['id'] ?? body['opportunity']?.['id'] ?? body['task']?.['id'];
    expect(typeof id, JSON.stringify(body)).toBe('string');
    return id as string;
  };
  const clearThrottle = async () => {
    const { ThrottlerStorage } = await import('@nestjs/throttler');
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };

  /** Écrit une donnée de chaque famille dans l'organisation active de `c`. */
  async function ecrire(c: string[], o: 'A' | 'B'): Promise<Ecrits> {
    const m = MARQUE[o];
    ok(await put(c, '/organizations/current/fiscal-profile', fiscal(`${o}1111111X`)));

    // BUILD : initiative du laboratoire d'idées, projet et plan approuvé.
    const idea = idOf(
      ok(
        await post(c, '/idea-lab/ideas', {
          title: `Idée ${m}`,
          problem: 'Les commerçantes perdent leurs invendus.',
          target: 'Commerçantes du marché',
          solution: 'Casiers réfrigérés à la journée.',
          alternatives: [{ name: 'Glacières', description: 'Glace du matin', source: null }],
          revenueModel: 'Location à la journée',
          country: 'CD',
          market: 'Marchés de Kinshasa',
          hypotheses: [{ id: 'h1', text: 'Elles paieront chaque jour', status: 'a_tester' }],
        }),
        201,
      ),
    );
    const project = idOf(
      ok(await post(c, '/projects', { name: `Projet ${m}`, templateSlug: 'hello-world' }), 201),
    );
    ok(await post(c, `/projects/${project}/plans`, {}), 201);

    // GROW : fiche de l'organisation, rattachée au projet de référence.
    ok(
      await put(c, '/grow/profile', {
        referenceProjectId: project,
        declaredStage: null,
        recurringCatalogItemIds: [],
      }),
    );

    // RUN : client, facture brouillon, compte et dépense, projet et tâche de travail,
    // article de stock, prospect et opportunité CRM, salarié.
    const customer = idOf(
      ok(
        await post(c, '/sales/customers', { type: 'PM', name: `Client ${m}`, nif: `${o}${tag}01` }),
        201,
      ),
    );
    const invoice = idOf(
      ok(
        await post(c, '/sales/invoices', {
          type: 'FV',
          currency: 'USD',
          priceMode: 'ht',
          customer: { customerId: customer, printContactDetails: false },
          pointOfSaleId: null,
          lines: [{ ...LIGNE, name: `Conseil ${m}` }],
          payments: [],
          comments: { A: null, C: null },
          creditNote: null,
          showUsdCounterValue: false,
        }),
        201,
      ),
    );
    const treasuryAccount = idOf(
      ok(
        await post(c, '/treasury/accounts', {
          name: `Banque ${m}`,
          kind: 'bank',
          currency: 'USD',
          openingBalance: '1000.00',
          openingDate: '2026-01-01',
        }),
        201,
      ),
    );
    const expense = idOf(
      ok(
        await post(c, '/treasury/expenses', {
          currency: 'USD',
          category: 'loyer',
          label: `Loyer ${m}`,
          spentOn: '2026-03-05',
          amount: '120.50',
          accountId: treasuryAccount,
        }),
        201,
      ),
    );
    const workProject = idOf(
      ok(await post(c, '/work/projects', { name: `Chantier ${m}`, kind: 'internal' }), 201),
    );
    const task = idOf(
      ok(
        await post(c, `/work/projects/${workProject}/tasks`, {
          title: `Tâche ${m}`,
          assigneeUserId: aliceId.value,
        }),
        201,
      ),
    );
    const stockItem = idOf(
      ok(await post(c, '/stock/items', { name: `Ciment ${m}`, unit: 'sac' }), 201),
    );
    const crmAccount = idOf(ok(await post(c, '/crm/accounts', { name: `Prospect ${m}` }), 201));
    const opportunity = idOf(
      ok(
        await post(c, '/crm/opportunities', {
          title: `Affaire ${m}`,
          prospectName: `Prospect ${m}`,
          currency: 'USD',
        }),
        201,
      ),
    );
    const employee = idOf(
      ok(
        await post(c, '/hr/employees', {
          firstName: 'Test',
          lastName: `Salarié ${m}`,
          jobTitle: 'Agent',
          contractType: 'permanent',
          startDate: '2026-01-05',
        }),
        201,
      ),
    );
    return {
      project,
      idea,
      customer,
      invoice,
      treasuryAccount,
      expense,
      workProject,
      task,
      stockItem,
      crmAccount,
      opportunity,
      employee,
    };
  }

  /** Détails lus (GET) par famille : chemin à partir des identifiants. */
  const details = (e: Ecrits): [string, string][] => [
    ['projet', `/projects/${e.project}`],
    ['plans du projet', `/projects/${e.project}/plans`],
    ['idée', `/idea-lab/ideas/${e.idea}`],
    ['client', `/sales/customers/${e.customer}`],
    ['facture', `/sales/invoices/${e.invoice}`],
    ['compte de trésorerie', `/treasury/accounts/${e.treasuryAccount}`],
    ['dépense', `/treasury/expenses/${e.expense}`],
    ['projet de travail', `/work/projects/${e.workProject}`],
    ['tâches du projet', `/work/projects/${e.workProject}/tasks`],
    ['tâche', `/work/tasks/${e.task}`],
    ['article de stock', `/stock/items/${e.stockItem}`],
    ['prospect', `/crm/accounts/${e.crmAccount}`],
    ['opportunité', `/crm/opportunities/${e.opportunity}`],
    ['salarié', `/hr/employees/${e.employee}`],
  ];

  /** Suppressions tentées depuis l'autre organisation : toutes doivent répondre 404. */
  const suppressions = (e: Ecrits): [string, string][] => [
    ['client', `/sales/customers/${e.customer}`],
    ['facture', `/sales/invoices/${e.invoice}`],
    ['projet de travail', `/work/projects/${e.workProject}`],
    ['tâche', `/work/tasks/${e.task}`],
    ['prospect', `/crm/accounts/${e.crmAccount}`],
    ['opportunité', `/crm/opportunities/${e.opportunity}`],
  ];

  /** Aucune liste de l'organisation active de `c` ne mentionne `marque` ni `ids`. */
  async function aucuneTrace(c: string[], marque: string, ids: string[], ou: string) {
    for (const liste of LISTES) {
      await clearThrottle();
      const res = await get(c, liste);
      expect(res.status, `${ou} ${liste} ${JSON.stringify(res.body)}`).toBe(200);
      const texte = JSON.stringify(res.body);
      expect(texte.includes(marque), `${ou} : ${liste} montre ${marque}`).toBe(false);
      for (const id of ids) {
        expect(texte.includes(id), `${ou} : ${liste} montre l’identifiant ${id}`).toBe(false);
      }
    }
  }

  beforeAll(async () => {
    app = await makeE2EApp();
    cookies.alice = await registerAndLogin(app, comptes.alice);
    cookies.carole = await registerAndLogin(app, comptes.carole);
    const session = await get(cookies.alice, '/auth/get-session');
    aliceId.value = String(session.body?.user?.id ?? '');
    expect(aliceId.value).not.toBe('');

    org.A = (
      ok(await get(cookies.alice, '/organizations'))['organizations'] as { id: string }[]
    )[0]!.id;
    org.B = idOf(
      ok(await post(cookies.alice, '/organizations', { name: `Société ${MARQUE.B}` }), 201),
    );
    org.C = (
      ok(await get(cookies.carole, '/organizations'))['organizations'] as { id: string }[]
    )[0]!.id;

    // Plan payant : GROW et plusieurs projets ; l'isolation ne dépend pas du plan.
    const { BillingService } = await import('../billing/billing.service.js');
    for (const o of [org.A, org.B, org.C]) await app.get(BillingService).setPlan(o, 'business');

    // Carole rejoint A comme Administratrice (vrai parcours d'invitation).
    const inv = ok(
      await post(as('alice', 'A'), `/organizations/${org.A}/invitations`, {
        email: comptes.carole.email,
        role: 'admin',
      }),
      201,
    );
    ok(await post(cookies.carole, '/invitations/accept', { token: inv['token'] }), 201);

    ecrits.A = await ecrire(as('alice', 'A'), 'A');
    await clearThrottle();
    ecrits.B = await ecrire(as('alice', 'B'), 'B');
    await clearThrottle();
    customerC = idOf(
      ok(
        await post(as('carole', 'C'), '/sales/customers', {
          type: 'PM',
          name: `Client ${MARQUE.C}`,
          nif: `C${tag}01`,
        }),
        201,
      ),
    );
  }, E2E_HOOK_TIMEOUT_MS * 2);

  afterAll(async () => {
    await teardown(app, [comptes.alice.email, comptes.carole.email]);
  }, E2E_HOOK_TIMEOUT_MS);

  const idsDe = (e: Ecrits) => Object.values(e);

  describe('Alice possède A et B', () => {
    it('témoin : chaque organisation retrouve ce qu’elle a écrit', async () => {
      for (const o of ['A', 'B'] as const) {
        for (const [famille, chemin] of details(ecrits[o])) {
          await clearThrottle();
          const res = await get(as('alice', o), chemin);
          expect(res.status, `${o} ${famille} ${JSON.stringify(res.body)}`).toBe(200);
        }
        for (const liste of [
          '/projects',
          '/idea-lab/ideas',
          '/sales/customers',
          '/sales/invoices',
          '/treasury/expenses',
          '/work/projects',
          '/work/my-tasks',
          '/stock/items',
          '/crm/accounts',
          '/crm/opportunities',
          '/hr/employees',
        ]) {
          await clearThrottle();
          const texte = JSON.stringify(ok(await get(as('alice', o), liste)));
          expect(texte.includes(MARQUE[o]), `${o} ${liste} sans ${MARQUE[o]}`).toBe(true);
        }
        const profil = ok(await get(as('alice', o), '/grow/profile'));
        expect(JSON.stringify(profil)).toContain(ecrits[o].project);
      }
    });

    for (const [ici, la] of [
      ['B', 'A'],
      ['A', 'B'],
    ] as const) {
      it(`cookie sur ${ici} : aucune liste ne montre ${la}`, async () => {
        await aucuneTrace(as('alice', ici), MARQUE[la], idsDe(ecrits[la]), `cookie ${ici}`);
      });

      it(`cookie sur ${ici} : chaque identifiant de ${la} lu ou supprimé répond 404`, async () => {
        for (const [famille, chemin] of details(ecrits[la])) {
          await clearThrottle();
          const res = await get(as('alice', ici), chemin);
          expect(res.status, `GET ${famille} de ${la} via ${ici}`).toBe(404);
          expect(JSON.stringify(res.body)).not.toContain(MARQUE[la]);
        }
        for (const [famille, chemin] of suppressions(ecrits[la])) {
          await clearThrottle();
          const res = await del(as('alice', ici), chemin);
          expect(res.status, `DELETE ${famille} de ${la} via ${ici}`).toBe(404);
        }
        // Rattacher la fiche GROW d'ici au projet de là : refusé, 404.
        await clearThrottle();
        const grow = await put(as('alice', ici), '/grow/profile', {
          referenceProjectId: ecrits[la].project,
          declaredStage: null,
          recurringCatalogItemIds: [],
        });
        expect(grow.status).toBe(404);
        // Facturer ici le client de là : refusé, sans rien révéler de lui.
        const facture = await post(as('alice', ici), '/sales/invoices', {
          type: 'FV',
          currency: 'USD',
          priceMode: 'ht',
          customer: { customerId: ecrits[la].customer, printContactDetails: false },
          pointOfSaleId: null,
          lines: [LIGNE],
          payments: [],
          comments: { A: null, C: null },
          creditNote: null,
          showUsdCounterValue: false,
        });
        expect(facture.status, JSON.stringify(facture.body)).toBeGreaterThanOrEqual(400);
        expect(facture.status).toBeLessThan(500);
        expect(JSON.stringify(facture.body)).not.toContain(MARQUE[la]);
      });
    }

    it('les tentatives depuis l’autre organisation n’ont rien supprimé', async () => {
      for (const o of ['A', 'B'] as const) {
        for (const [famille, chemin] of suppressions(ecrits[o])) {
          await clearThrottle();
          const res = await get(as('alice', o), chemin);
          expect(res.status, `${o} ${famille} toujours là`).toBe(200);
        }
      }
    });
  });

  describe('Carole, membre invitée de A, possède C', () => {
    it('cookie sur C : rien de A ; cookie sur A : rien de C, mais les données de A', async () => {
      await aucuneTrace(as('carole', 'C'), MARQUE.A, idsDe(ecrits.A), 'Carole sur C');
      await aucuneTrace(as('carole', 'A'), MARQUE.C, [customerC], 'Carole sur A');
      await clearThrottle();
      expect(JSON.stringify(ok(await get(as('carole', 'C'), '/sales/customers')))).toContain(
        customerC,
      );
      expect(JSON.stringify(ok(await get(as('carole', 'A'), '/sales/customers')))).toContain(
        ecrits.A.customer,
      );
      await clearThrottle();
      expect((await get(as('carole', 'A'), `/sales/customers/${customerC}`)).status).toBe(404);
      expect((await get(as('carole', 'C'), `/sales/customers/${ecrits.A.customer}`)).status).toBe(
        404,
      );
      // Elle n'est pas membre de B : un cookie sur B ne lui ouvre rien de B.
      await aucuneTrace(as('carole', 'B'), MARQUE.B, idsDe(ecrits.B), 'Carole, cookie B');
    });

    it('Alice, non membre de C, ne peut pas s’y placer par le cookie', async () => {
      await aucuneTrace(as('alice', 'C'), MARQUE.C, [customerC], 'Alice, cookie C');
      await clearThrottle();
      expect((await get(as('alice', 'C'), `/sales/customers/${customerC}`)).status).toBe(404);
    });
  });
});
