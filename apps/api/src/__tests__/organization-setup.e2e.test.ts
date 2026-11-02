// Statut de complétude de la mise en route — ADR-0052, lot O0 (critères 1 à 8).
//
// `GET /organizations/current/setup` est LU, jamais écrit : chaque étape se déduit des
// données des modules propriétaires, et les `missing[]` des trois actes sont ceux que
// le serveur renverrait au même instant (critères 3 à 5, comparés au vrai 409).
//
// Alice possède A et crée B. Bruno (Lecteur) et Chloé (Administratrice) sont invités
// dans A. A est configurée pas à pas ; B reste vide : son statut ne reflète jamais A,
// et le lire ne crée aucun document (critère 9 préservé).
//
// Données inventées.

import { OrganizationSetupViewSchema } from '@lalanda/shared/organization-setup';
import type { INestApplication } from '@nestjs/common';
import type { Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const tag = randomBytes(4).toString('hex');
const MOT_DE_PASSE = 'Passw0rd!setup';
const NIF = `S${tag.toUpperCase()}X`;
const RAISON_SOCIALE = `Mise En Route ${tag} SARL`;

const fiche = {
  legalName: RAISON_SOCIALE,
  tradeName: null,
  legalForm: 'sarl',
  legalFormOther: null,
  nif: NIF,
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
};

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

type Qui = 'alice' | 'bruno' | 'chloe';
type View = ReturnType<typeof OrganizationSetupViewSchema.parse>;

e2eSuite('mise en route — statut de complétude (ADR-0052 — O0)', () => {
  let app: INestApplication;
  let db: Db;
  const emails = {} as Record<Qui, string>;
  const cookies = {} as Record<Qui, string[]>;
  const org = { A: '', B: '' };
  const envAvant = process.env['MEMBER_PERMISSIONS_ENABLED'];

  const server = () => app.getHttpServer();
  const as = (qui: Qui, o: 'A' | 'B') => [...cookies[qui], `active_org_id=${org[o]}`];
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
  const ok = (res: request.Response, status = 200): Record<string, any> => {
    expect(res.status, `${res.req?.method} ${res.req?.path} ${JSON.stringify(res.body)}`).toBe(
      status,
    );
    return res.body as Record<string, any>;
  };

  async function statut(c: string[]): Promise<View> {
    return OrganizationSetupViewSchema.parse(ok(await get(c, '/organizations/current/setup')));
  }
  const etape = (v: View, id: string) => v.steps.find((s) => s.id === id)!;
  const reauth = async (c: string[]) => ok(await post(c, '/me/reauth', { password: MOT_DE_PASSE }));

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    for (const qui of ['alice', 'bruno', 'chloe'] as const) {
      emails[qui] = `setup-${qui}-${tag}@lalanda-test.local`;
    }
    const compte = (qui: Qui) => ({ email: emails[qui], password: MOT_DE_PASSE, name: qui });
    cookies.alice = await registerAndLogin(app, compte('alice'));
    org.A = (
      ok(await get(cookies.alice, '/organizations'))['organizations'] as { id: string }[]
    )[0]!.id;
    org.B = ok(await post(cookies.alice, '/organizations', { name: `Société B ${tag}` }), 201)[
      'id'
    ] as string;
    expect(typeof org.B).toBe('string');

    // Groupes de taxation DGI (référentiel de plateforme, sans organisation) : sans eux,
    // un brouillon n'a pas de total. Posé seulement s'il manque, comme `invoices.e2e`.
    if (
      (await db
        .collection('edef_reference_snapshots')
        .countDocuments({ environment: 'test', list: 'taxGroups' })) === 0
    ) {
      await db.collection('edef_reference_snapshots').insertOne({
        environment: 'test',
        list: 'taxGroups',
        sha256: randomBytes(32).toString('hex'),
        payload: {
          a: 0,
          b: 16,
          c: 5,
          d: 0,
          e: 0,
          f: 16,
          g: 5,
          h: 0,
          i: 0,
          j: 0,
          k: 0,
          l: 0,
          m: 0,
          n: 0,
          o: 1,
          p: 1,
          q: 8,
          r: 8,
          s: 0,
        },
        fetchedAt: new Date(),
        _schemaVersion: 1,
      });
    }

    // Ventes accessibles (émettre une facture) ; le statut ne dépend pas de l'offre.
    const { BillingService } = await import('../billing/billing.service.js');
    for (const o of [org.A, org.B]) await app.get(BillingService).setPlan(o, 'business');

    for (const [qui, role] of [
      ['bruno', 'viewer'],
      ['chloe', 'admin'],
    ] as const) {
      const inv = ok(
        await post(as('alice', 'A'), `/organizations/${org.A}/invitations`, {
          email: emails[qui],
          role,
        }),
        201,
      );
      cookies[qui] = await registerAndLogin(app, compte(qui));
      ok(await post(cookies[qui], '/invitations/accept', { token: inv['token'] }), 201);
    }
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (envAvant === undefined) delete process.env['MEMBER_PERMISSIONS_ENABLED'];
    else process.env['MEMBER_PERMISSIONS_ENABLED'] = envAvant;
    await teardown(app, Object.values(emails));
  }, E2E_HOOK_TIMEOUT_MS);

  it('critère 1 — 401 sans session', async () => {
    const res = await request(server()).get('/organizations/current/setup');
    expect(res.status).toBe(401);
  });

  it('critère 1 — tout membre lit le statut de l’organisation active : neuf étapes, trois actes', async () => {
    for (const qui of ['alice', 'bruno', 'chloe'] as const) {
      const v = await statut(as(qui, 'A'));
      expect(v.organizationId, qui).toBe(org.A);
      expect(v.steps.map((s) => s.id)).toEqual([
        'societe',
        'fiscal',
        'devises',
        'identite',
        'normalisation',
        'tresorerie',
        'comptabilite',
        'equipe',
        'modules',
      ]);
      expect(Object.keys(v.capabilities).sort()).toEqual([
        'accounting_active',
        'invoice',
        'normalize',
      ]);
    }
  });

  it('critère 8 — `canAct` suit les droits : le Lecteur ne peut rien, sauf ranger ses modules', async () => {
    const v = await statut(as('bruno', 'A'));
    for (const s of v.steps) expect(s.canAct, s.id).toBe(s.id === 'modules');
    const proprio = await statut(as('alice', 'A'));
    expect(proprio.steps.every((s) => s.canAct)).toBe(true);
  });

  it('critère 3 — émettre : la fiche fiscale seule, et le statut dit ce que le verrou dit', async () => {
    const c = as('alice', 'A');
    const avant = await statut(c);
    expect(avant.capabilities.invoice).toEqual({ ready: false, missing: ['fiscal_profile'] });
    expect(etape(avant, 'fiscal')).toMatchObject({
      state: 'todo',
      level: 'blocking',
      requiredFor: ['invoice', 'normalize'],
      missing: ['fiscal_profile'],
    });
    // Aucune autre étape n'est bloquante (décision ouverte n° 2, défaut).
    expect(avant.steps.filter((s) => s.level === 'blocking').map((s) => s.id)).toEqual(['fiscal']);

    const client = ok(
      await post(c, '/sales/customers', { type: 'PM', name: 'Client Exemple', nif: `C${tag}01` }),
      201,
    );
    const corps = {
      type: 'FV',
      currency: 'USD',
      priceMode: 'ht',
      customer: { customerId: client['id'], printContactDetails: false },
      pointOfSaleId: null,
      lines: [LIGNE],
      payments: [],
      comments: { A: null, C: null },
      creditNote: null,
      showUsdCounterValue: false,
    };
    const brouillon = ok(await post(c, '/sales/invoices', corps), 201);
    // Le verrou de la fiche est contrôlé avant tout calcul (gel, étape 3).
    const refus = await post(c, `/sales/invoices/${brouillon['id']}/issue`, {
      expectedRevision: brouillon['revision'],
    });
    expect(refus.status, JSON.stringify(refus.body)).toBe(409);
    expect(refus.body.code).toBe('FISCAL_PROFILE_REQUIRED');

    ok(await put(c, '/organizations/current/fiscal-profile', fiche));
    const apres = await statut(c);
    expect(apres.capabilities.invoice).toEqual({ ready: true, missing: [] });
    expect(etape(apres, 'fiscal')).toMatchObject({ state: 'done', missing: [] });

    const relu = ok(await get(c, `/sales/invoices/${brouillon['id']}`));
    const pret = ok(
      await put(c, `/sales/invoices/${brouillon['id']}`, {
        ...corps,
        payments: [
          { method: 'VIREMENT', amount: relu['documentAmounts'].calculation.totals.total },
        ],
        expectedRevision: relu['revision'],
      }),
    );
    ok(
      await post(c, `/sales/invoices/${pret['id']}/issue`, { expectedRevision: pret['revision'] }),
    );
  }, 60_000);

  it('critère 2 — aucune valeur dans la réponse (NIF, raison sociale, nom, courriel)', async () => {
    for (const qui of ['alice', 'bruno'] as const) {
      const texte = JSON.stringify(ok(await get(as(qui, 'A'), '/organizations/current/setup')));
      for (const valeur of [NIF, RAISON_SOCIALE, 'Gombe', 'facturation@', emails.bruno, 'alice']) {
        expect(texte.includes(valeur), `${qui} : ${valeur}`).toBe(false);
      }
    }
  });

  it('critère 4 — `normalize.missing` égale la liste du 409 NORMALIZED_INVOICING_PREREQUISITES', async () => {
    const c = as('alice', 'A');
    const v = await statut(c);
    expect(v.capabilities.normalize.enabled).toBe(false);
    expect(v.capabilities.normalize.ready).toBe(false);
    expect(etape(v, 'normalisation')).toMatchObject({ state: 'todo', level: 'optional' });
    await reauth(cookies.alice.concat(`active_org_id=${org.A}`));
    const refus = await post(c, '/organizations/current/normalized-invoicing/activate', {
      environment: 'test',
    });
    expect(refus.status, JSON.stringify(refus.body)).toBe(409);
    expect(refus.body.code).toBe('NORMALIZED_INVOICING_PREREQUISITES');
    expect(v.capabilities.normalize.missing).toEqual(refus.body.details.missing);
    expect(v.capabilities.normalize.missing).toEqual(['active_point_of_sale']);
  });

  it('critère 5 — `accounting_active.missing` égale `details.missing` du 409 ACCOUNTING_ACTIVATION_PRECONDITION', async () => {
    const c = as('alice', 'A');
    const v = await statut(c);
    expect(v.capabilities.accounting_active).toMatchObject({ ready: false, active: false });
    expect(etape(v, 'comptabilite')).toMatchObject({
      state: 'todo',
      level: 'optional',
      requiredFor: ['accounting_active'],
    });
    const reglages = ok(await get(c, '/accounting/settings'));
    const refus = await post(c, '/accounting/activate', {
      expectedRevision: reglages['revision'],
    });
    expect(refus.status, JSON.stringify(refus.body)).toBe(409);
    expect(refus.body.code).toBe('ACCOUNTING_ACTIVATION_PRECONDITION');
    expect(v.capabilities.accounting_active.missing).toEqual(refus.body.details.missing);
    expect(v.capabilities.accounting_active.missing.length).toBeGreaterThan(0);
  });

  it('critère 6 — une étape passe « faite » dès que sa donnée existe, et redevient « à faire » si elle disparaît', async () => {
    const c = as('alice', 'A');
    const avant = await statut(c);
    for (const id of ['devises', 'identite', 'tresorerie'] as const) {
      expect(etape(avant, id).state, id).toBe('todo');
    }
    // Deux invitations envoyées au montage : l'équipe est faite.
    expect(etape(avant, 'equipe').state).toBe('done');

    ok(
      await put(c, '/organizations/current/settings', {
        name: 'Société A',
        pays: 'CD',
        deviseAffichage: 'CDF',
      }),
    );
    const marque = ok(await get(c, '/organizations/current/brand'));
    ok(
      await put(c, '/organizations/current/brand/identity', {
        primaryColor: '#1A4D8F',
        secondaryColor: null,
        font: null,
        expectedRevision: marque['revision'],
      }),
    );
    const compte = ok(
      await post(c, '/treasury/accounts', {
        name: 'Caisse',
        kind: 'cash',
        currency: 'USD',
        openingBalance: '0.00',
        openingDate: '2026-01-01',
      }),
      201,
    );
    const pendant = await statut(c);
    for (const id of ['devises', 'identite', 'tresorerie'] as const) {
      expect(etape(pendant, id), id).toMatchObject({ state: 'done', missing: [] });
    }

    // Dernier compte archivé : l'étape redevient à faire.
    ok(
      await put(c, `/treasury/accounts/${compte['id']}`, {
        expectedRevision: compte['revision'],
        name: 'Caisse',
        kind: 'cash',
        institution: null,
        openingBalance: '0.00',
        active: false,
      }),
    );
    const apres = await statut(c);
    expect(etape(apres, 'tresorerie')).toMatchObject({
      state: 'todo',
      missing: ['treasury_account'],
    });

    // `simulation` fait l'étape comptable, sans rendre la comptabilité active.
    const reglages = ok(await get(c, '/accounting/settings'));
    ok(
      await put(c, '/accounting/settings', {
        expectedRevision: reglages['revision'],
        mode: 'simulation',
      }),
    );
    const simu = await statut(c);
    expect(etape(simu, 'comptabilite').state).toBe('done');
    expect(simu.capabilities.accounting_active.active).toBe(false);
  }, 60_000);

  it('critère 8 — droits effectifs : l’Administratrice ne fait pas la fiche, sauf par ajout', async () => {
    const sans = await statut(as('chloe', 'A'));
    expect(etape(sans, 'fiscal').canAct).toBe(false);
    expect(etape(sans, 'normalisation').canAct).toBe(false);
    expect(etape(sans, 'societe').canAct).toBe(true);

    process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
    const membre = await db
      .collection('memberships')
      .updateOne(
        { organizationId: org.A, role: 'admin' },
        { $set: { grants: ['fiscal.manage'] }, $inc: { permissionsRevision: 1 } },
      );
    expect(membre.matchedCount).toBe(1);
    const avec = await statut(as('chloe', 'A'));
    expect(etape(avec, 'fiscal').canAct).toBe(true);
    expect(etape(avec, 'normalisation').canAct).toBe(true);
  });

  it('isolation — le statut de B ne reflète jamais A, et le lire ne crée rien', async () => {
    const a = await statut(as('alice', 'A'));
    expect(a.capabilities.invoice.ready).toBe(true);

    const b = await statut(as('alice', 'B'));
    expect(b.organizationId).toBe(org.B);
    expect(b.steps.map((s) => [s.id, s.state])).toEqual(b.steps.map((s) => [s.id, 'todo']));
    expect(b.capabilities.invoice).toEqual({ ready: false, missing: ['fiscal_profile'] });
    expect(b.capabilities.normalize.missing).toEqual([
      'fiscal_profile',
      'country_cd',
      'active_point_of_sale',
    ]);
    expect(b.capabilities.accounting_active.active).toBe(false);

    // Lecture pure : aucun document de réglages n'est né dans B.
    for (const collection of [
      'accounting_settings',
      'organization_settings',
      'organization_brands',
      'normalized_invoicing_settings',
      'organization_fiscal_profiles',
      'treasury_accounts',
    ]) {
      expect(
        await db.collection(collection).countDocuments({ organizationId: org.B }),
        collection,
      ).toBe(0);
    }

    // Un membre de A seulement ne lit jamais B par le cookie : `AuthGuard` ignore un
    // cookie hors appartenance et sert son organisation principale.
    const intrus = await statut(as('bruno', 'B'));
    expect(intrus.organizationId).not.toBe(org.B);
  });
});
