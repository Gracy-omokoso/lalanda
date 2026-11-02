// Référentiel et réglages de la comptabilité (ADR-0049, lot K4) — e2e.
//
// Critère 2 : sans pack approuvé, `POST /accounting/activate` → 409
// `ACCOUNTING_ACTIVATION_PRECONDITION` avec `CHART_PACK_NOT_APPROVED` ; un Comptable (sans
// `fiscal.manage`) → 403 ; le mode simulation fonctionne avec le pack `draft` et ne
// persiste AUCUNE écriture. Plus : mode `off` par défaut, chargement et cycle du pack
// réservés à la plateforme (double validation, pack `to_confirm` jamais approuvable),
// plan de l'organisation, règles (clés fermées, séparation des tâches, déclaration de
// relecture, immuabilité), journaux, taux saisis, exercices (structure), isolation.

import type { INestApplication } from '@nestjs/common';
import type { Db } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';
// ADR-0053 — P8 : les gestionnaires plateforme s'enrôlent avant la console.
import { enrolerDeuxFacteurs } from './platform-2fa-e2e.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const ROLES = [
  'admin',
  'finance_director',
  'accountant',
  'external_accountant',
  'sales_rep',
] as const;
type Account = 'owner' | (typeof ROLES)[number] | 'ownerB' | 'packA' | 'packB';

const PACK = { slug: 'syscohada-revise-2017-cd', version: 1 } as const;
const PACK_PATH = `/accounting/chart-packs/${PACK.slug}/${PACK.version}`;
const PLATFORM = '/accounting/platform/chart-packs';

e2eSuite('comptabilité — référentiel et réglages (ADR-0049, K4)', () => {
  let app: INestApplication;
  let db: Db;
  let orgN = '';
  let orgB = '';
  const tag = Math.random().toString(16).slice(2, 10);
  const cookies = {} as Record<Account, string[]>;
  const userIds = {} as Record<Account, string>;
  const server = () => app.getHttpServer();
  const ownOrgs = {} as Record<Account, string>;
  const orgOf = (who: Account) =>
    who === 'packA' || who === 'packB' ? ownOrgs[who] : who === 'ownerB' ? orgB : orgN;
  const as = (who: Account): string[] => [...cookies[who], `active_org_id=${orgOf(who)}`];
  const compte = (c: Account) => ({
    email: `cpta-${c}-${tag}@lalanda-test.local`,
    password: 'Passw0rd!compta-k4',
    name: `Membre ${c} ${tag}`,
  });

  const get = (who: Account, path: string) => request(server()).get(path).set('Cookie', as(who));
  const post = (who: Account, path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', as(who))
      .send((body ?? {}) as object);
  const put = (who: Account, path: string, body: unknown) =>
    request(server())
      .put(path)
      .set('Cookie', as(who))
      .send(body as object);
  const ok = (res: request.Response, status = 200): Record<string, any> => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const code = (res: request.Response, status: number, expected: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code).toBe(expected);
  };
  const settingsOf = async (who: Account) => ok(await get(who, '/accounting/settings'));

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    const firstOrg = async (c: Account) => {
      cookies[c] = await registerAndLogin(app, compte(c));
      const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
      return (orgs.body.organizations as { id: string }[])[0]!.id;
    };
    const sessionUserId = async (c: Account) => {
      const s = await request(server()).get('/auth/get-session').set('Cookie', cookies[c]);
      return String(s.body?.user?.id ?? '');
    };
    orgN = await firstOrg('owner');
    userIds.owner = await sessionUserId('owner');
    for (const role of ROLES) {
      const inv = await request(server())
        .post(`/organizations/${orgN}/invitations`)
        .set('Cookie', cookies.owner)
        .send({ email: compte(role).email, role });
      expect(inv.status, `invitation ${role} ${JSON.stringify(inv.body)}`).toBe(201);
      cookies[role] = await registerAndLogin(app, compte(role));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: inv.body.token });
      expect(acc.status).toBe(201);
      userIds[role] = await sessionUserId(role);
    }
    orgB = await firstOrg('ownerB');
    userIds.ownerB = await sessionUserId('ownerB');
    // Deux gestionnaires comptables et fiscaux de la plateforme (double validation).
    for (const who of ['packA', 'packB'] as const) {
      ownOrgs[who] = await firstOrg(who);
      userIds[who] = await sessionUserId(who);
      await db.collection('platform_roles').insertOne({
        userId: userIds[who],
        role: 'platform_country_pack_manager',
        grantedBy: null,
        reason: 'e2e comptabilité K4',
        expiresAt: null,
        revokedAt: null,
        _schemaVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await enrolerDeuxFacteurs(app, cookies[who]!, 'Passw0rd!compta-k4');
    }
    // Pack chargé par un autre essai sur la même base : on repart du chargement.
    await db.collection('accounting_chart_packs').deleteMany({ slug: PACK.slug });
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  }, E2E_HOOK_TIMEOUT_MS);

  it('mode off par défaut : ni monnaie de tenue, ni bascule, aucun bandeau', async () => {
    const s = await settingsOf('owner');
    expect(s).toMatchObject({
      mode: 'off',
      banner: null,
      chartPack: null,
      bookCurrency: null,
      cutoverDate: null,
      fiscalYearStartMonth: 1,
      stockPosting: 'off',
      depreciationPosting: 'off',
      ruleSetVersion: null,
      revision: 1,
    });
    expect(s['activation'].possible).toBe(false);
    expect(s['activation'].missing).toEqual([
      'CHART_PACK_NOT_APPROVED',
      'BOOK_CURRENCY_REQUIRED',
      'CUTOVER_DATE_REQUIRED',
      'RULE_SET_NOT_VALIDATED',
      'FISCAL_YEAR_NOT_OPEN',
    ]);
  });

  it('droits : l’Expert-comptable et l’Administrateur lisent sans écrire ; le Commercial ne voit rien', async () => {
    ok(await get('external_accountant', '/accounting/settings'));
    ok(await get('admin', '/accounting/settings'));
    for (const who of ['external_accountant', 'admin'] as const) {
      const res = await put(who, '/accounting/settings', {
        expectedRevision: 1,
        mode: 'simulation',
      });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', action: 'accounting.manage' });
    }
    const commercial = await get('sales_rep', '/accounting/settings');
    expect(commercial.status).toBe(403);
    expect(commercial.body).toMatchObject({ code: 'FORBIDDEN', action: 'accounting.read' });
  });

  it('le chargement d’un pack est réservé à la plateforme ; le pack v1 arrive en brouillon, tout « à confirmer »', async () => {
    const refus = await post('owner', PLATFORM, PACK);
    expect(refus.status).toBe(403);

    code(
      await post('packA', PLATFORM, { slug: PACK.slug, version: 99 }),
      404,
      'CHART_PACK_FILE_NOT_FOUND',
    );
    code(await post('packA', PLATFORM, { slug: '../etc', version: 1 }), 400, 'INVALID_REQUEST');

    const loaded = ok(await post('packA', PLATFORM, PACK));
    expect(loaded['created']).toBe(true);
    expect(loaded['pack']).toMatchObject({ ...PACK, status: 'draft', activatable: false });
    expect(loaded['pack'].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const accounts = loaded['pack'].accounts as { confirmation: string; mention: string | null }[];
    expect(accounts.length).toBeGreaterThan(0);
    for (const a of accounts) {
      expect(a.confirmation).toBe('to_confirm');
      expect(a.mention).toBe('À confirmer par l’expert-comptable');
    }
    expect(loaded['pack'].proposedRules).toEqual([]);

    // Rejouer ne change rien (même empreinte).
    const again = ok(await post('packB', PLATFORM, PACK));
    expect(again).toMatchObject({ created: false, changed: false });
    expect(again['pack'].revision).toBe(1);

    // Trace dans l'espace plateforme du journal, jamais dans celui d'un client.
    const trace = await db
      .collection('audit_events')
      .findOne({ action: 'accounting.chart_pack.loaded', actorUserId: userIds.packA });
    expect(trace?.['organizationId']).toBe('platform');
  });

  it('cycle du pack : relecture possible, approbation refusée tant que tout est « à confirmer »', async () => {
    const draft = ok(await get('owner', PACK_PATH));
    // Une organisation ne fait pas avancer un pack.
    expect(
      (
        await post('owner', `${PLATFORM}/${PACK.slug}/1/transition`, {
          to: 'review',
          expectedRevision: 1,
        })
      ).status,
    ).toBe(403);
    code(
      await post('packA', `${PLATFORM}/${PACK.slug}/1/transition`, {
        to: 'approved',
        expectedRevision: draft['revision'],
      }),
      409,
      'CHART_PACK_TRANSITION_FORBIDDEN',
    );
    const review = ok(
      await post('packA', `${PLATFORM}/${PACK.slug}/1/transition`, {
        to: 'review',
        expectedRevision: draft['revision'],
      }),
    );
    expect(review['status']).toBe('review');
    // Une seconde personne de la plateforme non plus : le pack n'est pas relu.
    const refused = await post('packB', `${PLATFORM}/${PACK.slug}/1/transition`, {
      to: 'approved',
      expectedRevision: review['revision'],
    });
    code(refused, 409, 'CHART_PACK_NOT_APPROVABLE');
    expect(refused.body.details.total).toBeGreaterThan(0);
    // Retour au brouillon pour la suite.
    const back = ok(
      await post('packA', `${PLATFORM}/${PACK.slug}/1/transition`, {
        to: 'draft',
        expectedRevision: review['revision'],
      }),
    );
    expect(back['status']).toBe('draft');

    const list = ok(await get('external_accountant', '/accounting/chart-packs'));
    expect(list['items']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ...PACK, status: 'draft', activatable: false }),
      ]),
    );
  });

  it('plan de l’organisation : sans pack, aucun compte propre', async () => {
    code(
      await post('ownerB', '/accounting/accounts', { number: '4111', label: 'Client A' }),
      409,
      'ACCOUNT_OUTSIDE_PACK',
    );
    expect(ok(await get('ownerB', '/accounting/accounts'))['items']).toEqual([]);
  });

  it('simulation avec le pack brouillon : bandeau, journaux par défaut, rien de persisté en écritures', async () => {
    const s0 = await settingsOf('owner');
    code(
      await put('owner', '/accounting/settings', {
        expectedRevision: s0['revision'],
        mode: 'active',
      }),
      400,
      'INVALID_REQUEST',
    );
    code(
      await put('owner', '/accounting/settings', {
        expectedRevision: s0['revision'],
        chartPack: { slug: PACK.slug, version: 42 },
      }),
      404,
      'CHART_PACK_NOT_FOUND',
    );
    const s1 = ok(
      await put('owner', '/accounting/settings', {
        expectedRevision: s0['revision'],
        mode: 'simulation',
        chartPack: PACK,
      }),
    );
    expect(s1).toMatchObject({ mode: 'simulation', chartPack: { ...PACK, status: 'draft' } });
    expect(s1['banner']).toContain('Simulation');
    expect(s1['chartPack'].warnings.length).toBeGreaterThan(0);
    code(
      await put('owner', '/accounting/settings', { expectedRevision: s0['revision'], mode: 'off' }),
      409,
      'STALE_REVISION',
    );
    const journals = ok(await get('accountant', '/accounting/journals'))['items'] as {
      code: string;
    }[];
    expect(journals.map((j) => j.code).sort()).toEqual(['AC', 'AN', 'OD', 'VE']);
    expect(await db.collection('accounting_entries').countDocuments({ organizationId: orgN })).toBe(
      0,
    );
  });

  it('options : écritures de stock refusées tant que l’expert n’a pas validé ; amortissements éteints', async () => {
    const s = await settingsOf('owner');
    code(
      await put('owner', '/accounting/settings', {
        expectedRevision: s['revision'],
        stockPosting: 'perpetual',
      }),
      409,
      'STOCK_POSTING_NOT_VALIDATED',
    );
    code(
      await put('owner', '/accounting/settings', {
        expectedRevision: s['revision'],
        depreciationPosting: 'linear',
      }),
      400,
      'INVALID_REQUEST',
    );
  });

  it('plan : comptes propres sous un compte du pack, précision de libellé, archivage protégé', async () => {
    const items = ok(await get('owner', '/accounting/accounts'))['items'] as Record<string, any>[];
    const collective = items.find((a) => a['auxiliaryKind'] === 'customer')!;
    expect(collective).toMatchObject({
      origin: 'pack',
      confirmation: 'to_confirm',
      revision: null,
    });

    const own = ok(
      await post('finance_director', '/accounting/accounts', {
        number: `${collective['number']}1`,
        label: 'Clients — grands comptes',
      }),
      201,
    );
    expect(own).toMatchObject({
      origin: 'organization',
      parent: collective['number'],
      confirmation: 'to_confirm',
      active: true,
    });
    code(
      await post('owner', '/accounting/accounts', { number: own['number'], label: 'Doublon' }),
      409,
      'ACCOUNT_NUMBER_EXISTS',
    );
    code(
      await post('owner', '/accounting/accounts', { number: '0001', label: 'Hors pack' }),
      409,
      'ACCOUNT_OUTSIDE_PACK',
    );
    code(
      await post('owner', '/accounting/accounts', { number: '41A', label: 'Lettres' }),
      400,
      'INVALID_REQUEST',
    );

    const precise = ok(
      await put('owner', `/accounting/accounts/${collective['number']}`, {
        expectedRevision: null,
        label: 'Clients (précision de l’organisation)',
      }),
    );
    expect(precise).toMatchObject({
      label: 'Clients (précision de l’organisation)',
      packLabel: collective['packLabel'],
      revision: 1,
    });
    code(
      await post('owner', `/accounting/accounts/${collective['number']}/archive`, {
        expectedRevision: 1,
      }),
      409,
      'ACCOUNT_IN_USE',
    );
    const archived = ok(
      await post('owner', `/accounting/accounts/${own['number']}/archive`, { expectedRevision: 1 }),
    );
    expect(archived['active']).toBe(false);
    code(
      await put('owner', '/accounting/accounts/123456', { expectedRevision: null, label: 'x' }),
      404,
      'ACCOUNT_NOT_FOUND',
    );
  });

  it('règles : brouillon vide né du pack, clés fermées, comptes du plan, jetons', async () => {
    code(await get('owner', '/accounting/rule-sets/1'), 404, 'RULE_SET_NOT_FOUND');
    const draft = ok(await post('accountant', '/accounting/rule-sets', {}), 201);
    expect(draft).toMatchObject({
      version: 1,
      status: 'draft',
      rules: [],
      basedOn: { packSlug: PACK.slug, packVersion: PACK.version },
      validation: null,
    });
    code(await post('owner', '/accounting/rule-sets', {}), 409, 'RULE_SET_DRAFT_EXISTS');

    const unknown = await put('accountant', '/accounting/rule-sets/1', {
      expectedRevision: 1,
      rules: [
        { key: 'sale.invented.thing', debit: ['{customer}'], credit: [], requiresReview: false },
      ],
    });
    code(unknown, 400, 'UNKNOWN_OPERATION_KEY');
    code(
      await put('accountant', '/accounting/rule-sets/1', {
        expectedRevision: 1,
        rules: [
          { key: 'sale.invoice.receivable', debit: ['999999'], credit: [], requiresReview: false },
        ],
      }),
      400,
      'RULE_ACCOUNT_NOT_IN_CHART',
    );
    const saved = ok(
      await put('accountant', '/accounting/rule-sets/1', {
        expectedRevision: 1,
        rules: [
          {
            key: 'sale.invoice.receivable',
            debit: ['{customer}'],
            credit: [],
            requiresReview: true,
          },
        ],
      }),
    );
    expect(saved).toMatchObject({ revision: 2, updatedBy: userIds.accountant });
  });

  it('validation des règles : séparation des tâches et déclaration de relecture exigée', async () => {
    const declaration = {
      declared: true,
      name: 'Cabinet Exemple',
      date: '2026-10-30',
      note: null,
    };
    // Le dernier auteur (Comptable) ne valide pas : d'autres détenteurs existent.
    code(
      await post('accountant', '/accounting/rule-sets/1/validate', {
        expectedRevision: 2,
        expertReview: declaration,
      }),
      409,
      'SELF_APPROVAL_FORBIDDEN',
    );
    code(
      await post('finance_director', '/accounting/rule-sets/1/validate', {
        expectedRevision: 2,
        expertReview: { declared: false },
      }),
      409,
      'EXPERT_REVIEW_DECLARATION_REQUIRED',
    );
    code(
      await post('finance_director', '/accounting/rule-sets/1/validate', {
        expectedRevision: 2,
        expertReview: { declared: true, name: 'Cabinet Exemple' },
      }),
      409,
      'EXPERT_REVIEW_DECLARATION_REQUIRED',
    );
    expect(
      (
        await post('external_accountant', '/accounting/rule-sets/1/validate', {
          expectedRevision: 2,
          expertReview: declaration,
        })
      ).status,
    ).toBe(403);
    const validated = ok(
      await post('finance_director', '/accounting/rule-sets/1/validate', {
        expectedRevision: 2,
        expertReview: declaration,
      }),
    );
    expect(validated).toMatchObject({
      status: 'validated',
      validation: {
        by: userIds.finance_director,
        soleApprover: false,
        expertReview: { declared: true, name: 'Cabinet Exemple', date: '2026-10-30' },
      },
    });
    // La règle `requiresReview` reste stockée telle quelle : le moteur ne l'applique jamais.
    expect(validated['rules'][0].requiresReview).toBe(true);
    expect((await settingsOf('owner'))['ruleSetVersion']).toBe(1);

    code(
      await put('owner', '/accounting/rule-sets/1', { expectedRevision: 3, rules: [] }),
      409,
      'RULE_SET_IMMUTABLE',
    );
    code(
      await post('owner', '/accounting/rule-sets/1/validate', {
        expectedRevision: 3,
        expertReview: declaration,
      }),
      409,
      'RULE_SET_IMMUTABLE',
    );
    // Un compte visé par les règles validées ne s'archive pas — ici aucun numéro direct.
    const next = ok(await post('owner', '/accounting/rule-sets', {}), 201);
    expect(next).toMatchObject({ version: 2, status: 'draft' });
    expect(next['rules']).toEqual(validated['rules']);

    const audit = await db
      .collection('audit_events')
      .findOne({ organizationId: orgN, action: 'accounting.rule_set_validated' });
    expect(audit?.['metadata']).toMatchObject({ version: 1, soleApprover: false });
  });

  it('approbateur unique : le Propriétaire seul valide ses propres règles, marqué', async () => {
    const s = await settingsOf('ownerB');
    ok(
      await put('ownerB', '/accounting/settings', {
        expectedRevision: s['revision'],
        chartPack: PACK,
      }),
    );
    ok(await post('ownerB', '/accounting/rule-sets', {}), 201);
    const v = ok(
      await post('ownerB', '/accounting/rule-sets/1/validate', {
        expectedRevision: 1,
        expertReview: { declared: true, name: 'Cabinet B', date: '2026-10-31' },
      }),
    );
    expect(v['validation']).toMatchObject({ soleApprover: true, by: userIds.ownerB });
  });

  it('exercices : structure de douze mois ouverts ; le mois de début se verrouille', async () => {
    code(await post('admin', '/accounting/fiscal-years', { year: 2026 }), 403, 'FORBIDDEN');
    const fy = ok(await post('accountant', '/accounting/fiscal-years', { year: 2026 }), 201);
    expect(fy).toMatchObject({
      year: 2026,
      start: '2026-01-01',
      end: '2026-12-31',
      status: 'open',
    });
    expect(fy['periods']).toHaveLength(12);
    expect(fy['periods'][1]).toMatchObject({
      year: 2026,
      month: 2,
      end: '2026-02-28',
      status: 'open',
    });
    code(
      await post('owner', '/accounting/fiscal-years', { year: 2026 }),
      409,
      'FISCAL_YEAR_EXISTS',
    );
    const s = await settingsOf('owner');
    expect(s['locks'].fiscalYearStartMonth).toBe(true);
    code(
      await put('owner', '/accounting/settings', {
        expectedRevision: s['revision'],
        fiscalYearStartMonth: 7,
      }),
      409,
      'FISCAL_YEAR_START_LOCKED',
    );
    ok(await get('external_accountant', '/accounting/fiscal-years'));
  });

  it('taux SAISIS : source déclarée, chaîne décimale, révision', async () => {
    const path = '/accounting/exchange-rates/2026-03-10/USD/CDF';
    code(
      await put('accountant', path, { rate: 2850.5, sourceText: 'BCC', expectedRevision: null }),
      400,
      'INVALID_REQUEST',
    );
    code(
      await put('accountant', '/accounting/exchange-rates/2026-03-10/USD/USD', {
        rate: '1',
        sourceText: 'x',
        expectedRevision: null,
      }),
      400,
      'RATE_SAME_CURRENCY',
    );
    const created = ok(
      await put('accountant', path, {
        rate: '2850.5',
        sourceText: 'Cours indicatif BCC du jour',
        expectedRevision: null,
      }),
      201,
    );
    expect(created).toMatchObject({
      date: '2026-03-10',
      from: 'USD',
      to: 'CDF',
      rate: '2850.5000000000',
      enteredBy: userIds.accountant,
      revision: 1,
    });
    code(
      await put('owner', path, { rate: '2900', sourceText: 'x', expectedRevision: null }),
      409,
      'STALE_REVISION',
    );
    const changed = ok(
      await put('owner', path, { rate: '2860', sourceText: 'Correction', expectedRevision: 1 }),
    );
    expect(changed).toMatchObject({ rate: '2860.0000000000', revision: 2 });
    expect(
      (await put('admin', path, { rate: '1', sourceText: 'x', expectedRevision: 2 })).status,
    ).toBe(403);
    expect(
      ok(await get('external_accountant', '/accounting/exchange-rates'))['items'],
    ).toHaveLength(1);
    // Isolation : l'autre organisation ne voit rien.
    expect(ok(await get('ownerB', '/accounting/exchange-rates'))['items']).toEqual([]);
  });

  it('journaux : création, code unique, pas de journal de trésorerie à la main', async () => {
    const j = ok(
      await post('owner', '/accounting/journals', {
        code: 'OD2',
        label: 'OD de l’expert',
        kind: 'misc',
      }),
      201,
    );
    expect(j).toMatchObject({ code: 'OD2', kind: 'misc', active: true, revision: 1 });
    code(
      await post('owner', '/accounting/journals', { code: 'VE', label: 'Doublon', kind: 'sales' }),
      409,
      'JOURNAL_CODE_EXISTS',
    );
    code(
      await post('owner', '/accounting/journals', {
        code: 'T09',
        label: 'Caisse',
        kind: 'treasury',
      }),
      400,
      'INVALID_REQUEST',
    );
    const renamed = ok(
      await put('owner', '/accounting/journals/OD2', { expectedRevision: 1, label: 'OD expert' }),
    );
    expect(renamed).toMatchObject({ label: 'OD expert', revision: 2 });
    code(
      await put('ownerB', '/accounting/journals/OD2', { expectedRevision: 1, active: false }),
      404,
      'JOURNAL_NOT_FOUND',
    );
  });

  it('critère 2 — activation : 403 sans fiscal.manage ; 409 tant que le pack n’est pas approuvé', async () => {
    const before = await settingsOf('owner');
    const comptable = await post('accountant', '/accounting/activate', {
      expectedRevision: before['revision'],
    });
    expect(comptable.status).toBe(403);
    expect(comptable.body).toMatchObject({ code: 'FORBIDDEN', action: 'fiscal.manage' });

    const s = ok(
      await put('owner', '/accounting/settings', {
        expectedRevision: before['revision'],
        bookCurrency: 'CDF',
        cutoverDate: '2026-11-01',
      }),
    );
    expect(s['activation'].missing).toEqual(['CHART_PACK_NOT_APPROVED']);

    const refused = await post('owner', '/accounting/activate', {
      expectedRevision: s['revision'],
    });
    code(refused, 409, 'ACCOUNTING_ACTIVATION_PRECONDITION');
    expect(refused.body.details.missing).toEqual(['CHART_PACK_NOT_APPROVED']);
    const after = await settingsOf('owner');
    expect(after).toMatchObject({ mode: 'simulation', activatedAt: null, revision: s['revision'] });
    // Rien n'est écrit en écritures, ni dans le réalisé.
    expect(await db.collection('accounting_entries').countDocuments({ organizationId: orgN })).toBe(
      0,
    );
  });

  it('désactivation : retour à off, journalisé ; rien n’est effacé', async () => {
    const s = await settingsOf('owner');
    const off = ok(
      await post('owner', '/accounting/deactivate', { expectedRevision: s['revision'] }),
    );
    expect(off).toMatchObject({
      mode: 'off',
      banner: null,
      bookCurrency: 'CDF',
      ruleSetVersion: 1,
    });
    expect(ok(await get('owner', '/accounting/journals'))['items'].length).toBeGreaterThanOrEqual(
      5,
    );
    const trace = await db
      .collection('audit_events')
      .findOne({ organizationId: orgN, action: 'accounting.deactivated' });
    expect(trace?.['metadata']).toMatchObject({ from: 'simulation' });
  });
});
