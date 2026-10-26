// Normalisation DGI contre la vraie application (ADR-0024, critères « F2 »).
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleurs → MongoDB (transactions, replica set) → moteur → VRAI client
// e-MCF (F1) → FAUX serveur e-MCF local enrichi (F1) : scénarios par `rn`,
// expiration, horloge avançable, compte des appels reçus. Aucun appel à la DGI
// réelle.
//
// BASE DÉDIÉE, supprimée à la fin. NIF et jetons inventés (marqués ANTIFUITE).

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  startFakeEdefServer,
  type FakeEdefScenarioInput,
  type FakeEdefServer,
} from '../edef/testing/fake-edef-server.js';
import { PointsOfSaleService } from '../fiscal/points-of-sale.service.js';
import { IndexesService } from '../database/indexes.service.js';
import { MailTransport } from '../mail/mail.transport.js';
import type { MailMessage } from '../mail/mail.types.js';
import { fiscalPeriodOf, formatInvoiceNumber } from '../sales/invoices/invoice-numbering.js';
import { NormalizationAlertsJob } from '../sales/normalization/alerts.job.js';
import { EdefSalesInvoiceNormalizer } from '../sales/normalization/edef-normalizer.js';
import { NormalizationConsistencyJob } from '../sales/normalization/consistency.job.js';
import { NormalizationRecorder } from '../sales/normalization/normalization-recorder.js';
import { NormalizationReconciliationJob } from '../sales/normalization/reconciliation.job.js';
import { ReferenceRefreshJob } from '../sales/normalization/reference-refresh.job.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_normalisation_${tag}`;
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';
process.env['DGI_ISF_TEST'] = process.env['DGI_ISF_TEST'] || 'ISF-TEST-E2E';
// Délai minimal admis (10 s) : les scénarios « ne répond pas » en dépendent.
process.env['DGI_HTTP_TIMEOUT_MS'] = '10000';
delete process.env['DGI_PRODUCTION_ENABLED'];

const DELAI_TEST_MS = 600_000;
vi.setConfig({ testTimeout: DELAI_TEST_MS });

const MOT_DE_PASSE = 'Passw0rd!normalisation';
const NIF_N = 'A0000000X';
const NIF_B = 'B0000000X';
const NIM = 'XX01000001-1';
const NIM_B = 'XX01000002-1';
const NIM_N2 = 'XX01000003-1';
const JETON = `ANTIFUITE-normalisation-${tag}-0123456789abcdef`;
const JETON_B = `ANTIFUITE-normalisation-b-${tag}-0123456789abcdef`;
const JETON_N2 = `ANTIFUITE-normalisation-n2-${tag}-0123456789abcdef`;
const MINUTE = 60_000;

/** Taux de test, identiques dans l'instantané et dans le faux serveur (valeurs fictives). */
const GROUPES: Record<string, number> = {
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
};

const ROLES = ['admin', 'finance_director', 'accountant', 'analyst', 'viewer'] as const;
type Role = 'owner' | (typeof ROLES)[number];
type Compte = Role | 'ownerB';

/** 2 h de conseil à 40,00 USD, groupe B. */
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

e2eSuite('normalisation DGI (ADR-0024 chantier F2)', () => {
  let app: INestApplication;
  let db: Db;
  let fake: FakeEdefServer;
  let orgN = '';
  let orgB = '';
  let customer = '';
  let customerB = '';
  let posN = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;

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
  const clearThrottle = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };
  const normalizer = () => app.get(EdefSalesInvoiceNormalizer);
  const reconciliation = () => app.get(NormalizationReconciliationJob);
  const recorder = () => app.get(NormalizationRecorder);
  const enBase = (id: string) => db.collection('sales_invoices').findOne({ _id: new ObjectId(id) });
  const journal = async (id: string) =>
    (
      await db
        .collection('sales_invoice_journal')
        .find({ invoiceId: id })
        .sort({ seq: 1 })
        .toArray()
    ).map((e) => e['event'] as string);
  const posts = () => fake.callsTo('submit').length;
  const confirms = () => fake.callsTo('confirm').length;
  const cancels = () => fake.callsTo('cancel').length;

  const corps = (extra: Record<string, unknown> = {}) => ({
    type: 'FV',
    currency: 'USD',
    priceMode: 'ht',
    customer: { customerId: customer, printContactDetails: false },
    pointOfSaleId: null,
    lines: [LIGNE],
    payments: [],
    comments: { A: null, C: null },
    creditNote: null,
    showUsdCounterValue: false,
    ...extra,
  });

  /** Brouillon prêt (paiement = total du moteur). */
  async function brouillonPret(c: string[] = asN(), body: Record<string, unknown> = corps()) {
    const d = await post(c, '/sales/invoices', body);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const total = d.body.documentAmounts.calculation.totals.total as string;
    const res = await put(c, `/sales/invoices/${d.body.id}`, {
      ...body,
      payments: [{ method: 'VIREMENT', amount: total }],
      expectedRevision: d.body.revision,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Record<string, any>;
  }

  /** Prochain numéro de la série test de l'organisation (lecture du compteur). */
  async function prochainNumero(org = orgN): Promise<string> {
    const counter = await db
      .collection('sales_invoice_counters')
      .findOne({ organizationId: org, series: 'test' });
    const next = ((counter?.['last'] as number | undefined) ?? 0) + 1;
    // ADR-0027 : TEST-IN{AA}{MM}-NNNNNN (les cas de ce fichier sont des factures).
    return formatInvoiceNumber('test', 'IN', fiscalPeriodOf(new Date()), next);
  }

  /** Normalise un brouillon prêt, avec un scénario du faux serveur pour SON numéro. */
  async function normaliser(
    scenario: FakeEdefScenarioInput | null = null,
    body: Record<string, unknown> = corps(),
    c: string[] = asN(),
    org: string = orgN,
  ) {
    const d = await brouillonPret(c, body);
    const rn = await prochainNumero(org);
    // Un numéro rendu est repris par la facture suivante : un scénario ne
    // survit pas à la normalisation suivante.
    effacerScenarios();
    if (scenario) scenarioPour(rn, scenario);
    const res = await post(c, `/sales/invoices/${d.id}/normalize`, {
      expectedRevision: d.revision,
      exchangeRate: null,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { view: res.body as Record<string, any>, rn, draft: d };
  }

  const scenarios = new Set<string>();
  function scenarioPour(rn: string, scenario: FakeEdefScenarioInput | null): void {
    fake.setInvoiceScenario(rn, scenario);
    if (scenario) scenarios.add(rn);
    else scenarios.delete(rn);
  }
  function effacerScenarios(): void {
    for (const rn of scenarios) fake.setInvoiceScenario(rn, null);
    scenarios.clear();
  }

  /** Gèle SANS normaliser (le normaliseur est court-circuité une fois). */
  async function gelerSansNormaliser(body: Record<string, unknown> = corps()) {
    const spy = vi.spyOn(normalizer(), 'normalizeNow').mockResolvedValueOnce('deferred');
    const d = await brouillonPret(asN(), body);
    const res = await post(asN(), `/sales/invoices/${d.id}/normalize`, {
      expectedRevision: d.revision,
      exchangeRate: null,
    });
    spy.mockRestore();
    expect(res.status).toBe(200);
    return res.body as Record<string, any>;
  }

  async function instantane(list: string, payload: unknown) {
    await db.collection('edef_reference_snapshots').insertOne({
      environment: 'test',
      list,
      sha256: randomBytes(32).toString('hex'),
      payload,
      fetchedAt: new Date(),
      _schemaVersion: 1,
    });
  }

  const reauth = async (c: Compte) => {
    const r = await post(cookies[c], '/me/reauth', { password: MOT_DE_PASSE });
    expect(r.status).toBe(200);
  };

  /** Rattrapage d'un document à `delaiMs` dans le futur (horloge du faux serveur alignée). */
  async function rattraper(id: string, delaiMs = 151_000, org = orgN) {
    return reconciliation().reconcileOne(org, id, new Date(Date.now() + delaiMs), false);
  }

  beforeAll(async () => {
    fake = await startFakeEdefServer({
      tokens: {
        [JETON]: { nif: NIF_N, nim: NIM, tokenValid: '2099-01-31T00:00:00' },
        [JETON_B]: { nif: NIF_B, nim: NIM_B, tokenValid: '2099-01-31T00:00:00' },
        [JETON_N2]: { nif: NIF_N, nim: NIM_N2, tokenValid: '2099-01-31T00:00:00' },
      },
      taxGroups: GROUPES,
    });
    process.env['DGI_EDEF_TEST_URL'] = fake.baseUrl;
    process.env['DGI_EDEF_PRODUCTION_URL'] = 'https://edef.invalid';
    app = await makeE2EApp();
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));
    reconciliation().spacingMs = 0;
    app.get(ReferenceRefreshJob).spacingMs = 0;

    for (const c of ['owner', ...ROLES, 'ownerB'] as const) {
      emails[c] = `normalisation-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({ email: emails[c], password: MOT_DE_PASSE, name: `Norm ${c}` });
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
      expect(inv.status, `invitation ${role}`).toBe(201);
      cookies[role] = await registerAndLogin(app, compte(role));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: inv.body.token });
      expect(acc.status).toBe(201);
    }
    orgB = await orgDe('ownerB');

    const fiche = (nif: string) => ({
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
    for (const [c, owner, nif, jeton] of [
      [asN(), 'owner', NIF_N, JETON],
      [asB(), 'ownerB', NIF_B, JETON_B],
    ] as const) {
      const f = await put(c, '/organizations/current/fiscal-profile', fiche(nif));
      expect(f.status, JSON.stringify(f.body)).toBe(200);
      await reauth(owner);
      const pos = await post(c, '/organizations/current/normalized-invoicing/points-of-sale', {
        label: 'Boutique',
        environment: 'test',
        expectedNim: null,
        token: jeton,
      });
      expect(pos.status, JSON.stringify(pos.body)).toBe(201);
      if (owner === 'owner') posN = pos.body.id;
      await reauth(owner);
      const act = await post(c, '/organizations/current/normalized-invoicing/activate', {
        environment: 'test',
      });
      expect(act.status, JSON.stringify(act.body)).toBe(200);
    }

    await instantane('taxGroups', GROUPES);
    await instantane('currencyRates', [
      {
        type: 'USD',
        description: 'Dollar (fictif)',
        date: '2026-10-19T00:00:00+01:00',
        rate: 2262.32,
      },
    ]);
    await instantane('clientTypes', [
      { type: 'PM', description: 'Personne morale (fictif)' },
      { type: 'PP', description: 'Personne physique (fictif)' },
    ]);
    await instantane('referenceTypes', [{ type: 'RRR', description: 'Remise (fictif)' }]);

    const client = await post(asN(), '/sales/customers', {
      type: 'PM',
      name: 'Client Exemple SARL',
      nif: `T${tag.toUpperCase()}01`,
    });
    expect(client.status, JSON.stringify(client.body)).toBe(201);
    customer = client.body.id;
    const clientB = await post(asB(), '/sales/customers', {
      type: 'PM',
      name: 'Client B SARL',
      nif: `B${tag.toUpperCase()}02`,
    });
    expect(clientB.status, JSON.stringify(clientB.body)).toBe(201);
    customerB = clientB.body.id;
  }, E2E_HOOK_TIMEOUT_MS);

  beforeEach(() => {
    clearThrottle();
    effacerScenarios();
  });

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
      await fake?.close();
    }
  }, E2E_HOOK_TIMEOUT_MS);

  // ── Nominal ─────────────────────────────────────────────────────────────

  describe('nominal', () => {
    it('normalize → facture normalisée : éléments tels que reçus, numéro réservé confirmé, journal', async () => {
      const avant = { p: posts(), c: confirms() };
      const { view, rn } = await normaliser();
      expect(view).toMatchObject({
        status: 'normalized',
        documentKind: 'invoice',
        documentLabel: 'Facture normalisée',
        number: rn,
        series: 'test',
      });
      expect(posts() - avant.p).toBe(1);
      expect(confirms() - avant.c).toBe(1);
      const rec = fake.invoicesByRn(rn)[0]!;
      expect(view.normalization).toMatchObject({
        phase: 'done',
        codeDefDgi: rec.security!.codeDEFDGI,
        nim: rec.security!.nim,
        counters: rec.security!.counters,
        dgiDateTime: rec.security!.dateTime,
        qrCode: rec.security!.qrCode,
        dgiRequestId: rec.uid,
        reservedNumber: rn,
        actions: { retry: false, check: false, declareNotNormalized: false, backToDraft: false },
      });
      // ADR-0027, amendement du 21 oct. 2026 : rang de la série d'essai stocké.
      expect(await enBase(view.id)).toMatchObject({
        fiscalSeq: Number(rn.slice(-6)),
        fiscalYear: 2000 + Number(rn.slice(7, 9)),
      });
      // Date DGI (heure de Kinshasa) → issuedAt.
      const [d, m, y, hh, mm, ss] = rec.security!.dateTime.split(/[/ :]/);
      expect(view.issuedAt).toBe(new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}+01:00`).toISOString());
      // Le `confirm` porte NOS total et vtotal.
      const confirm = fake.callsTo('confirm').at(-1)!;
      expect(JSON.parse(confirm.body!)).toEqual({
        total: Number(view.normalizedAmounts.calculation.total),
        vtotal: Number(view.normalizedAmounts.calculation.vatTotal),
      });
      // Corps envoyé : CDF, contre-valeur USD seule, pas de coordonnées client.
      const sent = JSON.parse(fake.callsTo('submit').at(-1)!.body!);
      expect(sent).toMatchObject({ rn, nif: NIF_N, mode: 'ht', type: 'FV', curCode: 'USD' });
      expect(sent.items[0].price).toBe(Number(view.normalizedAmounts.lines[0].unitPrice));
      expect(sent.client).toEqual({
        type: 'PM',
        typeDesc: 'Personne morale (fictif)',
        name: 'Client Exemple SARL',
        nif: `T${tag.toUpperCase()}01`,
      });
      expect(sent.operator).toEqual({ name: 'Norm owner' });
      const events = await journal(view.id);
      expect(events).toEqual(['submitted', 'number_reserved', 'normalized']);
      const base = await enBase(view.id);
      expect(base?.['normalization']?.['requestSha256']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('dgi-exchanges : requêtes et réponses liées, ordre chronologique, sans jeton', async () => {
      const { view } = await normaliser();
      const res = await get(asN('viewer'), `/sales/invoices/${view.id}/dgi-exchanges`);
      expect(res.status).toBe(200);
      const items = res.body.items as Record<string, any>[];
      expect(items.map((i) => `${i.method} ${i.entry}`)).toEqual([
        'POST request',
        'POST response',
        'PUT request',
        'PUT response',
      ]);
      expect(items[0]!.exchangeId).toBe(items[1]!.exchangeId);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(JETON);
      expect(text).not.toMatch(/authorization|bearer/i);
    });
  });

  // ── Refus ───────────────────────────────────────────────────────────────

  describe('refus et écarts', () => {
    it('écart de totaux → annulation, AUCUN confirm, numéro rendu et repris', async () => {
      const avant = { c: confirms(), x: cancels() };
      const { view, rn } = await normaliser('totals_offset:vab');
      expect(view).toMatchObject({ status: 'normalization_failed', documentKind: 'proforma' });
      expect(view.normalization).toMatchObject({
        phase: 'failed',
        reservedNumber: null,
        lastError: { category: 'totals_mismatch', retryable: false },
        actions: { retry: false, backToDraft: true },
      });
      expect(view.normalization.differences.map((d: { field: string }) => d.field)).toContain(
        'vab',
      );
      expect(confirms() - avant.c).toBe(0);
      expect(cancels() - avant.x).toBe(1);
      expect(fake.invoicesByRn(rn)[0]!.status).toBe('cancelled');
      expect(await journal(view.id)).toEqual([
        'submitted',
        'number_reserved',
        'normalization_failed',
        'number_released',
      ]);
      const suivante = await normaliser();
      expect(suivante.view.number).toBe(rn);
    });

    it('erreur 50 au confirm → annulation, totals_mismatch', async () => {
      const { view } = await normaliser('confirm_error:50');
      expect(view.normalization.lastError).toMatchObject({
        category: 'totals_mismatch',
        dgiErrorCode: '50',
      });
      expect(view.status).toBe('normalization_failed');
    });

    it('refus métier : data non réessayable, capacity réessayable ; code DGI conservé', async () => {
      const data = await normaliser('post_business_error:3');
      expect(data.view.normalization.lastError).toMatchObject({
        category: 'data',
        retryable: false,
        dgiErrorCode: '3',
      });
      expect(data.view.normalization.lastError.dgiMessage).toBeTruthy();
      const capacity = await normaliser('pending_full');
      expect(capacity.view.normalization).toMatchObject({
        lastError: { category: 'capacity', retryable: true, dgiErrorCode: '1' },
        actions: { retry: true },
      });
      expect(capacity.rn).toBe(data.rn);
      // Relance : même contenu figé, nouveau numéro réservé (celui rendu).
      scenarioPour(capacity.rn, null);
      const relance = await post(asN(), `/sales/invoices/${capacity.view.id}/normalization/retry`);
      expect(relance.status).toBe(200);
      expect(relance.body).toMatchObject({ status: 'normalized', number: capacity.rn });
      expect(relance.body.normalization.attempts).toBe(2);
    });

    it('retry hors état réessayable → 409 NORMALIZATION_NOT_RETRYABLE', async () => {
      const { view } = await normaliser('post_business_error:3');
      const res = await post(asN(), `/sales/invoices/${view.id}/normalization/retry`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'NORMALIZATION_NOT_RETRYABLE',
        details: { phase: 'failed' },
      });
    });

    it('garde de délai : réponse du POST vieille de plus de 90 s → annulation, pas de confirm', async () => {
      const avant = confirms();
      const base = Date.now();
      let calls = 0;
      normalizer().clock = () => new Date(base + (calls++ >= 2 ? 95_000 : 0));
      try {
        const { view } = await normaliser();
        expect(view.normalization.lastError).toMatchObject({
          code: 'EDEF_CONFIRM_DEADLINE',
          retryable: true,
        });
      } finally {
        normalizer().clock = () => new Date();
      }
      expect(confirms()).toBe(avant);
    });
  });

  // ── Coupures ────────────────────────────────────────────────────────────

  describe('coupures et rattrapage', () => {
    it('POST sans réponse → incertain ; autre facture en attente ; rattrapage annule, aucun second POST', async () => {
      const { view, rn } = await normaliser('post_timeout_after_create');
      expect(view.normalization).toMatchObject({
        phase: 'uncertain',
        lastError: { code: 'EDEF_NO_RESPONSE' },
      });
      expect(view.documentKind).toBe('proforma');
      expect(view.normalization.nextCheckAt).not.toBeNull();
      // Le bail est tenu : une autre facture attend.
      const autre = await normaliser();
      expect(autre.view.normalization).toMatchObject({
        phase: 'queued',
        lastError: { code: 'NORMALIZATION_IN_PROGRESS' },
        actions: { retry: true },
      });
      const postsAvant = posts();
      // Rattrapage (la demande est encore en attente chez la DGI) → annulée.
      expect(await rattraper(view.id)).toBe('failed');
      expect(posts()).toBe(postsAvant);
      expect(fake.invoicesByRn(rn)[0]!.status).toBe('cancelled');
      const apres = (await get(asN(), `/sales/invoices/${view.id}`)).body;
      expect(apres.normalization).toMatchObject({
        phase: 'failed',
        lastError: { code: 'EDEF_NOT_NORMALIZED', retryable: true },
        actions: { retry: true },
      });
      // L'autre facture passe et reprend le numéro rendu.
      const r = await post(asN(), `/sales/invoices/${autre.view.id}/normalization/retry`);
      expect(r.body).toMatchObject({ status: 'normalized', number: rn });
    });

    it('confirm sans réponse après finalisation → vérification immédiate → normalisée dans la requête', async () => {
      const avant = { c: confirms(), p: posts() };
      const { view } = await normaliser('confirm_timeout_after_finalize');
      expect(view.status).toBe('normalized');
      expect(confirms() - avant.c).toBe(1);
      expect(posts() - avant.p).toBe(1);
    });

    it('confirm sans réponse avant finalisation, demande en attente → second confirm sur le même uid', async () => {
      const avant = confirms();
      const { view, rn } = await normaliser('confirm_timeout_before_finalize');
      expect(view.status).toBe('normalized');
      const uid = fake.invoicesByRn(rn)[0]!.uid;
      const recus = fake.callsTo('confirm').slice(avant);
      expect(recus.map((r) => r.path)).toEqual([
        `/api/invoice/${uid}/confirm`,
        `/api/invoice/${uid}/confirm`,
      ]);
    });

    it('confirm incertain sans éléments lisibles → needs_review ; bail relâché ; déclaration → numéro abandonné', async () => {
      const { view, rn } = await normaliser([
        'confirm_timeout_after_finalize',
        'details_without_security',
      ]);
      expect(view.normalization).toMatchObject({ phase: 'uncertain' });
      expect(view.documentKind).toBe('proforma');
      expect(await rattraper(view.id)).toBe('uncertain');
      const revue = (await get(asN(), `/sales/invoices/${view.id}`)).body;
      expect(revue.normalization).toMatchObject({
        phase: 'needs_review',
        actions: { declareNotNormalized: true, check: true, retry: false },
      });
      expect(revue.normalization.review.reason).toBeTruthy();
      expect(revue.documentKind).toBe('proforma');
      // Accountant : peut vérifier, pas déclarer.
      expect(
        (await get(asN('accountant'), `/sales/invoices/${view.id}`)).body.normalization.actions,
      ).toMatchObject({ check: true, declareNotNormalized: false });
      // Bail relâché : une autre facture prend le numéro suivant.
      const suivante = await normaliser();
      expect(suivante.view.status).toBe('normalized');
      expect(suivante.view.number).not.toBe(rn);
      // Déclaration : ré-authentification exigée, Propriétaire ou DAF seulement.
      const motif = {
        reason: 'Vérifié auprès de l’assistance DGI le 19 octobre : non normalisée.',
      };
      const path = `/sales/invoices/${view.id}/normalization/declare-not-normalized`;
      expect((await post(asN('accountant'), path, motif)).status).toBe(403);
      expect((await post(asN('admin'), path, motif)).status).toBe(403);
      const sansReauth = await post(asN('finance_director'), path, motif);
      expect(sansReauth.status).toBe(401);
      expect(sansReauth.body.code).toBe('REAUTH_REQUIRED');
      await reauth('finance_director');
      expect((await post(asN('finance_director'), path, { reason: 'trop court' })).status).toBe(
        400,
      );
      const declare = await post(asN('finance_director'), path, motif);
      expect(declare.status, JSON.stringify(declare.body)).toBe(200);
      expect(declare.body.normalization).toMatchObject({
        phase: 'failed',
        reservedNumber: null,
        lastError: { code: 'DECLARED_NOT_NORMALIZED', retryable: true },
      });
      expect(await journal(view.id)).toContain('number_abandoned');
      const audit = await db
        .collection('audit_events')
        .findOne({ action: 'sales_invoice.declared_not_normalized', targetId: view.id });
      expect(audit?.['metadata']?.['reason']).toBe(motif.reason);
      // Rejouer la déclaration → 409.
      const encore = await post(asN('finance_director'), path, motif);
      expect(encore.status).toBe(409);
      expect(encore.body.code).toBe('NORMALIZATION_NOT_UNDER_REVIEW');
    });

    it('needs_review : une revérification qui trouve les éléments de sécurité → done sans intervention', async () => {
      const { view, rn } = await normaliser([
        'confirm_timeout_after_finalize',
        'details_without_security',
      ]);
      await rattraper(view.id);
      expect((await enBase(view.id))?.['normalization']?.['phase']).toBe('needs_review');
      scenarioPour(rn, null);
      const check = await post(asN('accountant'), `/sales/invoices/${view.id}/normalization/check`);
      expect(check.status).toBe(200);
      expect(check.body).toMatchObject({
        status: 'normalized',
        documentKind: 'invoice',
        number: rn,
      });
    });

    it('annulation sans réponse → incertain(cancel) → failed totals_mismatch', async () => {
      const { view } = await normaliser(['totals_offset:total', 'cancel_timeout']);
      expect(view.normalization.phase).toBe('uncertain');
      expect(await rattraper(view.id)).toBe('failed');
      expect((await enBase(view.id))?.['normalization']?.['lastError']?.['category']).toBe(
        'totals_mismatch',
      );
    });

    it('arrêt du processus dans chaque phase en vol → interprétation du § 4.1', async () => {
      const cas: { phase: string; attendu: string }[] = [
        { phase: 'submitting', attendu: 'normalization_failed' },
        { phase: 'comparing', attendu: 'normalization_failed' },
        { phase: 'cancelling', attendu: 'normalization_failed' },
        { phase: 'confirming', attendu: 'normalized' },
      ];
      for (const { phase, attendu } of cas) {
        const doc = await gelerSansNormaliser();
        const rn = await prochainNumero();
        // La requête de l'utilisateur prend la main puis le processus « meurt »
        // après avoir envoyé (et, pour `confirming`, confirmé) sans enregistrer.
        const p = fake.callsTo('submit').length;
        const doNothing = vi
          .spyOn(app.get(NormalizationRecorder), 'toComparing')
          .mockImplementationOnce(async () => {
            throw new Error('arrêt simulé');
          });
        await normalizer()
          .run(orgN, doc.id, null)
          .catch(() => undefined);
        doNothing.mockRestore();
        expect(fake.callsTo('submit').length).toBe(p + 1);
        const uid = fake.invoicesByRn(rn).at(-1)!.uid;
        const arrete = (await enBase(doc.id))?.['normalization'];
        expect(arrete?.['phase'], JSON.stringify(arrete)).toBe('submitting');
        const set: Record<string, unknown> = {
          'normalization.phase': phase,
          'normalization.claim': {
            attemptId: arrete?.['attemptId'],
            until: new Date(Date.now() - 1000),
          },
        };
        if (phase !== 'submitting') set['normalization.uid'] = uid;
        await db
          .collection('sales_invoices')
          .updateOne({ _id: new ObjectId(doc.id) }, { $set: set });
        if (phase === 'confirming') {
          const amounts = fake.invoicesByRn(rn).at(-1)!.totals;
          const r = await fetch(`${fake.baseUrl}/api/invoice/${uid}/confirm`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${JETON}`, 'content-type': 'application/json' },
            body: JSON.stringify({ total: amounts['total'], vtotal: amounts['vtotal'] }),
          });
          expect(r.status).toBe(200);
        }
        const postsAvant = posts();
        const confirmsAvant = confirms();
        await reconciliation().reconcileOne(orgN, doc.id, new Date(), false);
        expect((await enBase(doc.id))?.['status'], phase).toBe(attendu);
        // L'ordonnanceur n'envoie jamais de POST ni de confirm.
        expect(posts()).toBe(postsAvant);
        expect(confirms()).toBe(confirmsAvant);
      }
    });

    it('DGI injoignable 30 min → needs_review ; aucun document ne devient facture', async () => {
      const { view } = await normaliser('post_timeout_after_create');
      const profil = { nif: NIF_N, nim: NIM, tokenValid: '2099-01-31T00:00:00' };
      // Toutes les routes du jeton répondent 500 : la DGI est injoignable.
      fake.setToken(JETON, { ...profil, behaviour: 'server_error' });
      try {
        expect(await rattraper(view.id)).toBe('uncertain');
        expect((await enBase(view.id))?.['normalization']?.['phase']).toBe('uncertain');
        expect(await rattraper(view.id, 31 * MINUTE)).toBe('uncertain');
        const doc = await enBase(view.id);
        expect(doc?.['normalization']?.['phase']).toBe('needs_review');
        expect(doc?.['status']).toBe('pending_normalization');
        expect(doc?.['number'] ?? null).toBeNull();
      } finally {
        fake.setToken(JETON, profil);
      }
      // Nettoyage : la demande a expiré chez la DGI, on conclut par déclaration.
      fake.advanceClock(121_000);
      await reauth('owner');
      const d = await post(
        asN(),
        `/sales/invoices/${view.id}/normalization/declare-not-normalized`,
        { reason: 'DGI injoignable puis vérifiée : facture non normalisée.' },
      );
      expect(d.status).toBe(200);
    });
  });

  // ── Concurrence, verrou ─────────────────────────────────────────────────

  describe('concurrence et verrou', () => {
    it('trois POST normalize concurrents (navigateur qui renvoie) → un seul envoi, un seul numéro', async () => {
      const d = await brouillonPret();
      const avant = posts();
      const res = await Promise.all(
        [0, 1, 2].map(() =>
          post(asN(), `/sales/invoices/${d.id}/normalize`, {
            expectedRevision: d.revision,
            exchangeRate: null,
          }),
        ),
      );
      expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(posts() - avant).toBe(1);
      const events = await journal(d.id);
      expect(events.filter((e) => e === 'submitted')).toHaveLength(1);
      expect(events.filter((e) => e === 'number_reserved')).toHaveLength(1);
      expect((await get(asN(), `/sales/invoices/${d.id}`)).body.status).toBe('normalized');
    });

    it('deux rattrapages simultanés → une seule prise en main ; enregistrement rejoué → sans effet', async () => {
      const { view } = await normaliser('post_timeout_after_create');
      const now = new Date(Date.now() + 151_000);
      const [a, b] = await Promise.all([
        reconciliation().reconcileOne(orgN, view.id, now, false),
        reconciliation().reconcileOne(orgN, view.id, now, false),
      ]);
      expect([a, b].filter((o) => o !== null)).toHaveLength(1);

      const ok = await normaliser();
      const doc = await enBase(ok.view.id);
      const n = doc!['normalization'];
      const replay = await recorder().recordNormalized(
        {
          organizationId: orgN,
          invoiceId: ok.view.id,
          attemptId: n.attemptId,
          claimId: n.attemptId,
        },
        {
          from: ['confirming'],
          security: {
            codeDefDgi: n.codeDefDgi,
            nim: n.nim,
            counters: n.counters,
            dateTime: n.dgiDateTime,
            qrCode: n.qrCode,
          },
          actor: null,
          now: new Date(),
          expectedNim: NIM,
        },
      );
      expect(replay).toBe('already');
      expect((await journal(ok.view.id)).filter((e) => e === 'normalized')).toHaveLength(1);
    });

    it('recordNormalized refuse un élément de sécurité vide', async () => {
      await expect(
        recorder().recordNormalized(
          {
            organizationId: orgN,
            invoiceId: new ObjectId().toHexString(),
            attemptId: 'x',
            claimId: 'x',
          },
          {
            from: ['confirming'],
            security: { codeDefDgi: 'X', nim: NIM, counters: '1/1 FV', dateTime: 'x', qrCode: '' },
            actor: null,
            now: new Date(),
            expectedNim: null,
          },
        ),
      ).rejects.toThrow(/cinq éléments/);
    });

    it('document normalized sans QR code (impossible par construction) → Pro forma', async () => {
      const { view } = await normaliser();
      await db
        .collection('sales_invoices')
        .updateOne({ _id: new ObjectId(view.id) }, { $set: { 'normalization.qrCode': '' } });
      const vue = (await get(asN(), `/sales/invoices/${view.id}`)).body;
      expect(vue).toMatchObject({ documentKind: 'proforma', number: null });
      const report = await app.get(NormalizationConsistencyJob).run();
      expect(report.normalizedWithoutSecurity).toContain(view.id);
    });

    it('série sans trou ni doublon sous 50 normalisations concurrentes avec coupures', async () => {
      // Borne de temps du diagnostic : dériver du délai du test, avec une minute
      // de marge pour l'état et les assertions finales. Une borne fixe (240 s)
      // expirait sous charge alors que chaque tour progressait : c'était le
      // délai, pas un blocage. Le blocage, lui, est détecté par l'absence de
      // progrès (`sansProgres`), indépendante de la vitesse de la machine.
      const finDuDiagnostic = Date.now() + DELAI_TEST_MS - 60_000;
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        if (i % 20 === 0) clearThrottle();
        ids.push((await gelerSansNormaliser()).id);
      }
      // Quelques coupures et refus injectés sur les numéros à venir.
      const base = await prochainNumero();
      const [prefix, seq] = [base.slice(0, -6), Number(base.slice(-6))];
      const num = (k: number) => `${prefix}${String(seq + k).padStart(6, '0')}`;
      // Chaque scénario ne sert qu'une fois : effacé dès qu'un POST portant ce numéro est reçu.
      const injected = new Map<string, FakeEdefScenarioInput>([
        [num(3), 'post_business_error:3'],
        [num(7), 'totals_offset:vab'],
        [num(9), 'post_timeout_after_create'],
        [num(11), 'post_business_error:1'],
      ]);
      for (const [rn, sc] of injected) scenarioPour(rn, sc);
      const consume = () => {
        const sent = new Set(
          fake.callsTo('submit').map((r) => JSON.parse(r.body ?? '{}').rn as string),
        );
        for (const rn of [...injected.keys()]) {
          if (sent.has(rn)) {
            scenarioPour(rn, null);
            injected.delete(rn);
          }
        }
      };
      const postsAvant = posts();
      let decale = 0;
      // Diagnostic : un passage qui ne conclut aucun document est un blocage.
      // On échoue VITE (borne de tours, borne de temps, tours sans progrès)
      // avec l'état des documents restants et du bail de numérotation.
      const journalDesTours: string[] = [];
      const declarations: string[] = [];
      const debut = Date.now();
      let sansProgres = 0;
      let restantsAvant = Number.POSITIVE_INFINITY;
      const etat = async (): Promise<string> => {
        const restants = await db
          .collection('sales_invoices')
          .find({ _id: { $in: ids.map((i) => new ObjectId(i)) }, status: 'pending_normalization' })
          .toArray();
        const compteur = await db
          .collection('sales_invoice_counters')
          .findOne({ organizationId: orgN, series: 'test' });
        return JSON.stringify(
          {
            bail: compteur?.['inFlight'] ?? null,
            dernier: compteur?.['last'] ?? null,
            restants: restants.map((d) => ({
              id: String(d['_id']),
              phase: d['normalization']?.['phase'],
              etape: d['normalization']?.['uncertainStep'] ?? null,
              numero: d['normalization']?.['reservedNumber'] ?? null,
              erreur: d['normalization']?.['lastError']?.['code'] ?? null,
              claim: d['normalization']?.['claim'] ?? null,
              reconcileAfter: d['normalization']?.['reconcileAfter'] ?? null,
            })),
            tours: journalDesTours.slice(-15),
          },
          null,
          1,
        );
      };
      for (let round = 0; ; round++) {
        const pending = await db
          .collection('sales_invoices')
          .find({ _id: { $in: ids.map((i) => new ObjectId(i)) }, status: 'pending_normalization' })
          .toArray();
        if (pending.length === 0) break;
        if (pending.length < restantsAvant) sansProgres = 0;
        else sansProgres += 1;
        restantsAvant = pending.length;
        if (round >= 150 || sansProgres >= 15 || Date.now() > finDuDiagnostic) {
          throw new Error(`Normalisations bloquées au tour ${round} : ${await etat()}`);
        }
        const t0 = Date.now();
        const issues = await Promise.all(
          pending.map((d) => normalizer().run(orgN, String(d._id), null)),
        );
        consume();
        decale += 151_000;
        const rattrapes = await reconciliation().run(new Date(Date.now() + decale));
        const histo: Record<string, number> = {};
        for (const o of issues) histo[o] = (histo[o] ?? 0) + 1;
        journalDesTours.push(
          `tour ${round} : ${pending.length} en attente, ${JSON.stringify(histo)}, rattrapés ${rattrapes}, ${Date.now() - t0} ms`,
        );
        // Ce que ferait une personne : relancer les refus réessayables, et
        // déclarer « non normalisée » une facture en vérification nécessaire
        // (la DGI simulée ne l'a pas finalisée : aucun confirm accepté).
        await db.collection('sales_invoices').updateMany(
          {
            _id: { $in: ids.map((i) => new ObjectId(i)) },
            status: 'normalization_failed',
            'normalization.lastError.retryable': true,
          },
          {
            $set: {
              status: 'pending_normalization',
              'normalization.phase': 'queued',
              'normalization.lastError': null,
            },
          },
        );
        const enRevue = await db
          .collection('sales_invoices')
          .find({
            _id: { $in: ids.map((i) => new ObjectId(i)) },
            'normalization.phase': 'needs_review',
          })
          .toArray();
        for (const d of enRevue) {
          declarations.push(
            `${String(d['_id'])} (${d['normalization']?.['review']?.['reason'] ?? '?'})`,
          );
          await recorder().declareNotNormalized(
            orgN,
            String(d['_id']),
            'Vérifié auprès de la DGI simulée : non normalisée.',
            { userId: 'test', name: 'Test', role: 'owner' },
          );
        }
      }
      console.info(
        `[50 normalisations] ${journalDesTours.length} tours, ${Date.now() - debut} ms, déclarations : ${JSON.stringify(declarations)}`,
      );
      // Jamais deux POST pour un même numéro sans conclusion entre-temps.
      expect(posts() - postsAvant).toBeGreaterThanOrEqual(50);
      const docs = await db
        .collection('sales_invoices')
        .find({ _id: { $in: ids.map((i) => new ObjectId(i)) } })
        .toArray();
      expect(docs.every((d) => d['status'] !== 'pending_normalization')).toBe(true);
      const numbers = docs
        .filter((d) => d['status'] === 'normalized')
        .map((d) => d['number'] as string)
        .sort();
      expect(new Set(numbers).size).toBe(numbers.length);
      // Toute la série de l'organisation : contiguë depuis 1.
      const all = (
        await db
          .collection('sales_invoices')
          .find({ organizationId: orgN, status: 'normalized', series: 'test' })
          .toArray()
      )
        .map((d) => Number((d['number'] as string).slice(-6)))
        .sort((a, b) => a - b);
      const abandoned = (
        await db
          .collection('sales_invoice_journal')
          .find({ organizationId: orgN, event: 'number_abandoned' })
          .toArray()
      ).map((e) => Number((e['number'] as string).slice(-6)));
      const series = [...all, ...abandoned].sort((a, b) => a - b);
      expect(series).toEqual(series.map((_, i) => i + 1));
      for (const d of docs.filter((x) => x['status'] === 'normalization_failed')) {
        expect(d['number']).toBeNull();
      }
    });
  });

  // ── Points de vente, production ────────────────────────────────────────

  describe('point de vente et production', () => {
    it('désactivation avec une normalisation non soldée → 409 ; jeton de rattrapage même expiré', async () => {
      const { view } = await normaliser('post_timeout_after_create');
      await reauth('owner');
      const res = await post(
        asN(),
        `/organizations/current/normalized-invoicing/points-of-sale/${posN}/disable`,
        { reason: 'Changement de caisse enregistreuse prévu ce mois-ci.' },
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('POINT_OF_SALE_HAS_PENDING_NORMALIZATIONS');
      const pos = app.get(PointsOfSaleService);
      const avant = await db.collection('emcf_points_of_sale').findOne({ _id: new ObjectId(posN) });
      try {
        await db
          .collection('emcf_points_of_sale')
          .updateOne({ _id: new ObjectId(posN) }, { $set: { 'dgi.tokenValidUntil': new Date(0) } });
        expect(await pos.resolveActiveToken(orgN, posN)).toBeNull();
        expect(await pos.resolveTokenForReconciliation(orgN, posN)).not.toBeNull();
        expect(await rattraper(view.id)).toBe('failed');
      } finally {
        await db
          .collection('emcf_points_of_sale')
          .updateOne(
            { _id: new ObjectId(posN) },
            { $set: { 'dgi.tokenValidUntil': avant?.['dgi']?.['tokenValidUntil'] } },
          );
      }
    });

    it('deux points de vente actifs : choix obligatoire, message clair, normalisation par le point choisi (ADR-0026 C6)', async () => {
      await reauth('owner');
      const second = await post(
        asN(),
        '/organizations/current/normalized-invoicing/points-of-sale',
        { label: 'Dépôt', environment: 'test', expectedNim: null, token: JETON_N2 },
      );
      expect(second.status, JSON.stringify(second.body)).toBe(201);
      const pos2 = second.body.id as string;
      try {
        // Liste proposable : lisible par le Lecteur, sans jeton ni état technique.
        const liste = await get(asN('viewer'), '/sales/points-of-sale');
        expect(liste.status).toBe(200);
        expect(liste.body).toMatchObject({ emissionMode: 'normalized', environment: 'test' });
        expect(liste.body.items.map((p: { id: string }) => p.id).sort()).toEqual(
          [posN, pos2].sort(),
        );
        expect(liste.body.items.find((p: { id: string }) => p.id === pos2)).toEqual({
          id: pos2,
          label: 'Dépôt',
          nim: NIM_N2,
          shopName: expect.anything(),
        });
        expect(JSON.stringify(liste.body)).not.toContain('ANTIFUITE');

        // Sans choix : brouillon enregistré mais bloqué, message qui dit quoi faire.
        const d = await brouillonPret();
        expect(d.pointOfSaleId).toBeNull();
        expect(d.readiness.ready).toBe(false);
        const bloquant = d.readiness.blockers.find(
          (b: { code: string }) => b.code === 'POINT_OF_SALE_REQUIRED',
        );
        expect(bloquant.message).toMatch(/Plusieurs points de vente/);
        const refus = await post(asN(), `/sales/invoices/${d.id}/normalize`, {
          expectedRevision: d.revision,
          exchangeRate: null,
        });
        expect(refus.status).toBe(409);
        expect(refus.body.code).toBe('POINT_OF_SALE_REQUIRED');
        expect(refus.body.message).toMatch(/choisissez/);

        // Point de vente d'une autre organisation → 404 ; choix du second → normalisé par lui.
        const autre = await put(asN(), `/sales/invoices/${d.id}`, {
          ...corps({ pointOfSaleId: new ObjectId().toHexString() }),
          payments: [{ method: 'VIREMENT', amount: d.documentAmounts.calculation.totals.total }],
          expectedRevision: d.revision,
        });
        expect(autre.status).toBe(404);
        expect(autre.body.code).toBe('POINT_OF_SALE_NOT_FOUND');
        const choisi = await put(asN(), `/sales/invoices/${d.id}`, {
          ...corps({ pointOfSaleId: pos2 }),
          payments: [{ method: 'VIREMENT', amount: d.documentAmounts.calculation.totals.total }],
          expectedRevision: d.revision,
        });
        expect(choisi.status, JSON.stringify(choisi.body)).toBe(200);
        expect(choisi.body.pointOfSaleId).toBe(pos2);
        expect(choisi.body.readiness.ready).toBe(true);
        const rn = await prochainNumero();
        const ok = await post(asN(), `/sales/invoices/${d.id}/normalize`, {
          expectedRevision: choisi.body.revision,
          exchangeRate: null,
        });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        expect(ok.body.number).toBe(rn);
        expect(ok.body.normalization.nim).toBe(NIM_N2);
      } finally {
        // Retour à un seul point de vente actif pour la suite.
        await reauth('owner');
        const off = await post(
          asN(),
          `/organizations/current/normalized-invoicing/points-of-sale/${pos2}/disable`,
          { reason: 'Fin du scénario à deux points de vente (test).' },
        );
        expect(off.status, JSON.stringify(off.body)).toBe(200);
      }
      // Choix retiré : le brouillon qui le portait est bloqué avec un message clair.
      const d2 = await brouillonPret(asN(), corps({ pointOfSaleId: pos2 }));
      expect(d2.readiness.blockers.map((b: { code: string }) => b.code)).toContain(
        'POINT_OF_SALE_NOT_ACTIVE',
      );
      await request(server()).delete(`/sales/invoices/${d2.id}`).set('Cookie', asN());
    });

    it('organisation forcée en production → failed DGI_PRODUCTION_UNAVAILABLE, aucune requête', async () => {
      const doc = await gelerSansNormaliser();
      await db
        .collection('sales_invoices')
        .updateOne({ _id: new ObjectId(doc.id) }, { $set: { environment: 'production' } });
      const avant = fake.requests.length;
      expect(await normalizer().run(orgN, doc.id, null)).toBe('failed');
      expect(fake.requests.length).toBe(avant);
      expect((await enBase(doc.id))?.['normalization']?.['lastError']?.['code']).toBe(
        'DGI_PRODUCTION_UNAVAILABLE',
      );
    });
  });

  // ── Export du journal pour les vérificateurs (ADR-0026 § 6.3) ──────────

  describe('export du journal électronique', () => {
    const jour = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kinshasa',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const url = (q: string) => `/sales/journal/export?from=${jour}&to=${jour}${q}`;

    it('JSON : factures figées avec lignes, groupes, éléments DGI ; chaîne recalculable ; échanges sans jeton', async () => {
      const { view, rn } = await normaliser();
      const res = await get(asN(), url('&format=json'));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="journal-ventes_${jour}_${jour}.json"`,
      );
      const exp = res.body as Record<string, any>;
      expect(exp).toMatchObject({
        format: 'lalanda.sales-journal',
        formatVersion: 1,
        organization: { id: orgN, nif: NIF_N },
        period: { from: jour, to: jour, timeZone: 'Africa/Kinshasa' },
        chain: { valid: true },
      });
      const inv = (exp.invoices as Record<string, any>[]).find((i) => i.number === rn)!;
      expect(inv).toMatchObject({
        id: view.id,
        type: 'FV',
        status: 'normalized',
        currency: 'CDF',
        amountsSource: 'normalized_cdf',
        customer: { type: 'PM', name: 'Client Exemple SARL' },
        totals: { total: view.normalizedAmounts.calculation.total },
        dgi: {
          codeDefDgi: view.normalization.codeDefDgi,
          nim: view.normalization.nim,
          counters: view.normalization.counters,
        },
        contentIntact: true,
      });
      expect(inv.lines[0]).toMatchObject({
        code: 'CONSEIL-H',
        name: 'Conseil (heure)',
        group: 'B',
        quantity: '2',
        unitPrice: view.normalizedAmounts.lines[0].unitPrice,
      });
      expect(inv.groups[0]).toMatchObject({ group: 'B' });
      expect(inv.journal.map((j: { event: string }) => j.event)).toEqual(
        expect.arrayContaining(['submitted', 'normalized']),
      );
      // Toute entrée de la période se recalcule avec ce que l'export contient.
      const { journalHash } = await import('../sales/invoices/canonical.js');
      for (const e of exp.journal as Record<string, any>[]) {
        const { hash, prevHash, ...champs } = e;
        expect(journalHash(prevHash, { organizationId: orgN, ...champs })).toBe(hash);
      }
      const seqs = (exp.journal as { seq: number }[]).map((e) => e.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(exp.chain.lastSeq).toBe(seqs.at(-1));
      // Échanges e-MCF de la période : requête et réponse de cette facture, sans jeton.
      const echanges = (exp.dgiExchanges as Record<string, any>[]).filter(
        (x) => x.invoiceId === view.id,
      );
      expect(echanges.map((x) => x.entry)).toEqual(expect.arrayContaining(['request', 'response']));
      expect(JSON.stringify(exp)).not.toContain('ANTIFUITE');
      // Isolation : rien de l'organisation N dans l'export de B.
      const b = await get(asB(), url(''));
      expect(b.status).toBe(200);
      expect(JSON.stringify(b.body)).not.toContain(rn);
      expect(b.body.organization.id).toBe(orgB);
      // Trace d'audit.
      const trace = await db
        .collection('audit_events')
        .findOne({ organizationId: orgN, action: 'sales_journal.exported' });
      expect(trace?.['metadata']).toMatchObject({ from: jour, to: jour, format: 'json' });
    });

    it('CSV : ventes (lignes et groupes) et échanges ; période invalide → 400', async () => {
      const ventes = await get(asN(), url('&format=csv'));
      expect(ventes.status).toBe(200);
      expect(ventes.headers['content-type']).toMatch(/text\/csv/);
      const rows = ventes.text
        .replace(/^\uFEFF/, '')
        .trimEnd()
        .split('\r\n');
      expect(rows[0]).toMatch(/^enregistrement;numero;type;/);
      expect(rows.some((r) => r.startsWith('ligne;TEST-'))).toBe(true);
      expect(rows.some((r) => r.startsWith('groupe;TEST-'))).toBe(true);
      const echanges = await get(asN(), url('&format=csv&dataset=echanges'));
      expect(echanges.status).toBe(200);
      expect(echanges.headers['content-disposition']).toContain('echanges-dgi_');
      expect(echanges.text).toContain('POST');
      expect(echanges.text).not.toContain('ANTIFUITE');

      for (const q of [
        `?from=${jour}`,
        `?from=2026-10-31&to=2026-10-01`,
        `?from=2026-02-30&to=2026-03-01`,
        `?from=2025-01-01&to=2026-10-31`,
        `?from=${jour}&to=${jour}&format=xml`,
      ]) {
        const r = await get(asN(), `/sales/journal/export${q}`);
        expect(r.status, q).toBe(400);
        expect(r.body.code, q).toBe('INVALID_REQUEST');
      }
    });

    it('fiscal.manage : Propriétaire et DAF 200 ; Administrateur, Comptable, Analyste, Lecteur 403', async () => {
      const attendu: Record<Role, number> = {
        owner: 200,
        finance_director: 200,
        admin: 403,
        accountant: 403,
        analyst: 403,
        viewer: 403,
      };
      for (const [role, statut] of Object.entries(attendu) as [Role, number][]) {
        const r = await get(asN(role), url(''));
        expect(r.status, role).toBe(statut);
      }
    });
  });

  // ── RBAC et isolation ──────────────────────────────────────────────────

  describe('permissions et isolation', () => {
    it('retry/check : Propriétaire, DAF, Comptable 200 ; Administrateur, Analyste, Lecteur 403', async () => {
      const { view } = await normaliser('post_business_error:1');
      for (const role of ['owner', 'finance_director', 'accountant'] as const) {
        scenarioPour(await prochainNumero(), 'post_business_error:1');
        const r = await post(asN(role), `/sales/invoices/${view.id}/normalization/retry`);
        expect(r.status, role).toBe(200);
        const c = await post(asN(role), `/sales/invoices/${view.id}/normalization/check`);
        expect(c.status, role).toBe(200);
      }
      for (const role of ['admin', 'analyst', 'viewer'] as const) {
        expect(
          (await post(asN(role), `/sales/invoices/${view.id}/normalization/retry`)).status,
        ).toBe(403);
        expect(
          (await post(asN(role), `/sales/invoices/${view.id}/normalization/check`)).status,
        ).toBe(403);
      }
      const vue = (await get(asN('viewer'), `/sales/invoices/${view.id}`)).body;
      expect(vue.normalization.actions).toEqual({
        retry: false,
        check: false,
        declareNotNormalized: false,
        backToDraft: false,
      });
    });

    it('autre organisation → 404 sur les quatre routes', async () => {
      const { view } = await normaliser();
      for (const [method, path] of [
        ['post', 'normalization/retry'],
        ['post', 'normalization/check'],
        ['post', 'normalization/declare-not-normalized'],
        ['get', 'dgi-exchanges'],
      ] as const) {
        if (path.endsWith('declare-not-normalized')) await reauth('ownerB');
        const url = `/sales/invoices/${view.id}/${path}`;
        const res =
          method === 'get'
            ? await get(asB(), url)
            : await post(asB(), url, { reason: 'Motif suffisamment long pour passer.' });
        expect(res.status, path).toBe(404);
      }
    });
  });

  // ── Alertes e-mail (ADR-0024, décision ouverte n° 3, amendement du 21 oct. 2026) ──

  describe('alertes e-mail aux administrateurs fiscaux', () => {
    const envoyes: MailMessage[] = [];
    const alertesJob = () => app.get(NormalizationAlertsJob);
    /** Messages reçus par `to` dont le sujet contient `motif`. */
    const recus = (motif: string) => envoyes.filter((m) => m.subject.includes(motif));
    const destinataires = (motif: string) =>
      recus(motif)
        .map((m) => m.to)
        .sort();

    beforeAll(async () => {
      // Le dédoublonnage repose sur l'index unique de `normalization_alerts` :
      // on attend qu'il existe (construction en arrière-plan sur une base neuve).
      await app.get(IndexesService).ensureAll();
      // Faux transport : rien ne part, tout est retenu pour les assertions.
      vi.spyOn(app.get(MailTransport), 'send').mockImplementation(async (m: MailMessage) => {
        envoyes.push(m);
        return { delivered: true };
      });
    });
    afterAll(() => {
      vi.restoreAllMocks();
    });
    beforeEach(() => {
      envoyes.length = 0;
    });

    it('jeton refusé (401) : Propriétaire et DAF prévenus, une seule fois dans l’heure', async () => {
      fake.setToken(JETON, {
        nif: NIF_N,
        nim: NIM,
        tokenValid: '2099-01-31T00:00:00',
        behaviour: 'unauthorized',
      });
      try {
        const premier = await normaliser();
        expect(premier.view.normalization.lastError).toMatchObject({
          category: 'token_rejected',
        });
        await vi.waitFor(() => expect(recus('jeton e-MCF refusé')).toHaveLength(2));
        expect(destinataires('jeton e-MCF refusé')).toEqual(
          [emails['owner'], emails['finance_director']].sort(),
        );
        const mail = recus('jeton e-MCF refusé')[0]!;
        expect(mail.subject).toBe('Lalanda — jeton e-MCF refusé par la DGI (Boutique)');
        expect(mail.text).toContain('/organisation/fiscalite');
        // Aucun secret, aucun identifiant fiscal dans le message.
        expect(mail.text).not.toContain(JETON);
        expect(mail.text).not.toContain(NIF_N);
        expect(mail.html).toContain('cid:logo-lalanda');

        // Second refus dans l'heure : pas de nouveau message.
        await normaliser();
        await new Promise((r) => setTimeout(r, 300));
        expect(recus('jeton e-MCF refusé')).toHaveLength(2);
        const lignes = await db
          .collection('normalization_alerts')
          .find({ organizationId: orgN, cause: 'token_rejected' })
          .toArray();
        expect(lignes).toHaveLength(1);
        expect(lignes[0]).toMatchObject({ subjectId: posN, recipients: 2, delivered: 2 });
      } finally {
        fake.setToken(JETON, { nif: NIF_N, nim: NIM, tokenValid: '2099-01-31T00:00:00' });
      }
    });

    it('normalisation incertaine au-delà de 15 min, puis numéro abandonné : une alerte chacun', async () => {
      const { view, rn } = await normaliser([
        'confirm_timeout_after_finalize',
        'details_without_security',
      ]);
      expect(view.normalization).toMatchObject({ phase: 'uncertain' });
      // 5 minutes : trop tôt.
      await alertesJob().run(new Date(Date.now() + 5 * MINUTE));
      expect(recus(rn)).toHaveLength(0);
      // 16 minutes : une alerte à chaque administrateur fiscal…
      await alertesJob().run(new Date(Date.now() + 16 * MINUTE));
      expect(destinataires(`normalisation incertaine pour ${rn}`)).toEqual(
        [emails['owner'], emails['finance_director']].sort(),
      );
      const mail = recus(`normalisation incertaine pour ${rn}`)[0]!;
      expect(mail.text).toContain(`/ventes/factures/${view.id}`);
      // … et une seule par épisode, même en « vérification nécessaire » ensuite.
      expect(await rattraper(view.id)).toBe('uncertain');
      await alertesJob().run(new Date(Date.now() + 50 * MINUTE));
      await alertesJob().run(new Date(Date.now() + 3 * 3600_000));
      expect(recus(`normalisation incertaine pour ${rn}`)).toHaveLength(2);

      // Numéro abandonné : une autre facture prend le suivant, puis déclaration.
      expect((await normaliser()).view.status).toBe('normalized');
      await reauth('finance_director');
      const declare = await post(
        asN('finance_director'),
        `/sales/invoices/${view.id}/normalization/declare-not-normalized`,
        { reason: 'Vérifié auprès de l’assistance DGI : non normalisée (test).' },
      );
      expect(declare.status, JSON.stringify(declare.body)).toBe(200);
      expect(await journal(view.id)).toContain('number_abandoned');
      envoyes.length = 0;
      await alertesJob().run();
      await alertesJob().run();
      expect(destinataires(`numéro de facture abandonné (${rn})`)).toEqual(
        [emails['owner'], emails['finance_director']].sort(),
      );
      expect(recus(`numéro de facture abandonné (${rn})`)[0]!.text).toContain(rn);
      const lignes = await db
        .collection('normalization_alerts')
        .find({ organizationId: orgN, subjectId: view.id })
        .toArray();
      expect(lignes.map((l) => l['cause']).sort()).toEqual([
        'normalization_uncertain',
        'number_abandoned',
      ]);
    });

    it('jeton expiré : une alerte par échéance', async () => {
      const pos = { _id: new ObjectId(posN) };
      const avant = await db.collection('emcf_points_of_sale').findOne(pos);
      const echeance = new Date(Date.now() - 3600_000);
      await db
        .collection('emcf_points_of_sale')
        .updateOne(pos, { $set: { 'dgi.tokenValidUntil': echeance } });
      try {
        await alertesJob().run();
        await alertesJob().run();
        expect(destinataires('jeton e-MCF expiré (Boutique)')).toEqual(
          [emails['owner'], emails['finance_director']].sort(),
        );
      } finally {
        await db
          .collection('emcf_points_of_sale')
          .updateOne(pos, { $set: { 'dgi.tokenValidUntil': avant?.['dgi']?.['tokenValidUntil'] } });
      }
    });
  });

  it('client B : isolation des numéros entre organisations', async () => {
    const { view } = await normaliser(
      null,
      corps({ customer: { customerId: customerB, printContactDetails: false } }),
      asB(),
      orgB,
    );
    expect(view.status).toBe('normalized');
    expect(view.number).toMatch(/000001$/);
  });

  // ── Rafraîchissement des listes ────────────────────────────────────────

  describe('rafraîchissement des listes de référence', () => {
    it('instantané au changement seulement ; Q, R, S conservés bruts ; taux A–P changé → alerte ; une organisation en panne n’arrête pas les autres', async () => {
      const job = app.get(ReferenceRefreshJob);
      const count = () =>
        db.collection('edef_reference_snapshots').countDocuments({ list: 'taxGroups' });
      await job.run({ full: false });
      const n1 = await count();
      await job.run({ full: false });
      expect(await count()).toBe(n1);

      fake.setTaxGroups({ ...GROUPES, b: 18 });
      fake.setToken(JETON_B, {
        nif: NIF_B,
        nim: NIM_B,
        tokenValid: '2099-01-31T00:00:00',
        behaviour: 'server_error',
      });
      const report = await job.run({ full: false });
      expect(report.get(orgN)?.ok).toContain('taxGroups');
      expect(report.get(orgB)?.failed).toContain('taxGroups');
      expect(await count()).toBe(n1 + 1);
      const latest = await db
        .collection('edef_reference_snapshots')
        .find({ list: 'taxGroups' })
        .sort({ fetchedAt: -1, _id: -1 })
        .limit(1)
        .next();
      expect(latest?.['payload']).toMatchObject({ b: 18, q: 8, r: 8, s: 0 });
      const alerte = await db
        .collection('audit_events')
        .findOne({ action: 'edef.alert.tax_rate_changed', organizationId: orgN });
      expect(alerte?.['metadata']?.['groups']).toBe('B');
      // Les taux figés d'un nouveau document n'ont que A–P.
      // Contenu nouveau (un retour à un contenu déjà vu ne crée pas d'instantané).
      fake.setTaxGroups({ ...GROUPES, q: 9 });
      fake.setToken(JETON_B, { nif: NIF_B, nim: NIM_B, tokenValid: '2099-01-31T00:00:00' });
      await job.run({ full: false });
      const doc = await gelerSansNormaliser();
      const rates = (await enBase(doc.id))?.['taxRates']?.['rates'] as Record<string, string>;
      expect(Object.keys(rates)).not.toContain('Q');
      expect(rates['B']).toBe('16');
    });
  });
});
