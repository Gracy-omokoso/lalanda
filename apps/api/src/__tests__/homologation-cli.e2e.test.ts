// Ligne de commande `edef:homologation` de bout en bout (ADR-0026 § 7).
//
// La VRAIE commande (`main`, contexte Nest complet, vrais services, vraie base)
// contre le FAUX serveur e-MCF local : jamais la DGI. L'organisation est préparée
// comme le ferait la dirigeante (inscription, fiche fiscale, point de vente de
// TEST avec jeton, activation), par l'API HTTP d'une application de test.
//
// Prouve : refus si la production DGI est ouverte ou si l'organisation n'est pas
// en TEST, `--dry-run` n'écrit rien, arrêt simulé juste après la normalisation du
// cas 12 (TTC) puis reprise SANS renormaliser, 58 PDF et rapports sans jeton,
// relance idempotente.
//
// BASE DÉDIÉE, supprimée à la fin. Vendeur, NIF et jeton FICTIFS.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import type { Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  REPORT_JSON,
  REPORT_MD,
  STATE_FILE,
  type CampaignReport,
  type CampaignState,
} from '../edef/homologation/campaign-plan.js';
import { HOMOLOGATION_CUSTOMERS } from '../edef/homologation/homologation-cases.js';
import { main, type HomologationIo } from '../edef/homologation/homologation.js';
import { startFakeEdefServer, type FakeEdefServer } from '../edef/testing/fake-edef-server.js';
import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_homologation_cli_${tag}`;
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';
process.env['DGI_ISF_TEST'] = process.env['DGI_ISF_TEST'] || 'ISF-TEST-E2E';
process.env['DGI_HTTP_TIMEOUT_MS'] = '10000';
delete process.env['DGI_PRODUCTION_ENABLED'];

vi.setConfig({ testTimeout: 600_000 });

const MOT_DE_PASSE = 'Passw0rd!homologation-cli';
const NOM_OPERATEUR = 'Opératrice TEST CLI';
const NIF_VENDEUR = 'TESTSFE0002';
const NIM = 'TS01000002-1';
const JETON = `ANTIFUITE-cli-${tag}-0123456789abcdef`;
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
};

function sink(): PassThrough & { text: () => string } {
  const stream = new PassThrough() as PassThrough & { text: () => string };
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
  });
  stream.text = () => buffer;
  return stream;
}

function io(overrides: Partial<HomologationIo> = {}) {
  const stdout = sink();
  const stderr = sink();
  const value: HomologationIo = {
    stdin: new PassThrough(),
    stdout,
    stderr,
    env: { ...process.env },
    requireTty: false,
    spacingMs: 0,
    originSettleMs: 0,
    ...overrides,
  };
  return { io: value, stdout, stderr };
}

e2eSuite('ligne de commande edef:homologation — campagne réelle (ADR-0026 § 7)', () => {
  let app: INestApplication;
  let db: Db;
  let fake: FakeEdefServer;
  let org = '';
  let operator = '';
  let out = '';
  let cookies: string[] = [];

  const server = () => app.getHttpServer();
  const as = () => [...cookies, `active_org_id=${org}`];
  const post = (path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', as())
      .send(body ?? {});
  const put = (path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', as()).send(body);
  const args = (...extra: string[]) => ['--org', org, '--operator', operator, ...extra];
  const invoicesCount = () =>
    db.collection('sales_invoices').countDocuments({ organizationId: org });

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

  beforeAll(async () => {
    fake = await startFakeEdefServer({
      tokens: { [JETON]: { nif: NIF_VENDEUR, nim: NIM, tokenValid: '2099-01-31T00:00:00' } },
      taxGroups: GROUPES,
    });
    process.env['DGI_EDEF_TEST_URL'] = fake.baseUrl;
    process.env['DGI_EDEF_PRODUCTION_URL'] = 'https://edef.invalid';
    // Double du rendu Chromium, pour l'application de test ET le contexte de la commande.
    vi.spyOn(PdfRenderingService.prototype, 'render').mockImplementation(async (html: string) =>
      Buffer.from(`%PDF-FAKE\n${html}`, 'utf8'),
    );
    app = await makeE2EApp();
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));
    out = mkdtempSync(join(tmpdir(), 'lalanda-homologation-cli-'));

    const email = `homologation-cli-${tag}@lalanda-test.local`;
    cookies = await registerAndLogin(app, { email, password: MOT_DE_PASSE, name: NOM_OPERATEUR });
    const orgs = await request(server()).get('/organizations').set('Cookie', cookies);
    org = (orgs.body.organizations as { id: string }[])[0]!.id;
    operator = String((await db.collection('user').findOne({ email }))!['_id']);

    const fiche = await put('/organizations/current/fiscal-profile', {
      legalName: 'Vendeur TEST Homologation CLI SARL',
      tradeName: null,
      legalForm: 'sarl',
      legalFormOther: null,
      nif: NIF_VENDEUR,
      rccm: null,
      nationalId: null,
      vatRegistered: true,
      headOffice: {
        line1: '1, avenue TEST',
        line2: null,
        commune: 'Gombe',
        city: 'Kinshasa',
        province: 'Kinshasa',
      },
      phone: '+243 800 000 000',
      email: 'facturation-test@lalanda-test.local',
    });
    expect(fiche.status, JSON.stringify(fiche.body)).toBe(200);
    const reauth = async () =>
      expect((await post('/me/reauth', { password: MOT_DE_PASSE })).status).toBe(200);
    await reauth();
    const pos = await post('/organizations/current/normalized-invoicing/points-of-sale', {
      label: 'Point de vente TEST',
      environment: 'test',
      expectedNim: null,
      token: JETON,
    });
    expect(pos.status, JSON.stringify(pos.body)).toBe(201);
    await reauth();
    const act = await post('/organizations/current/normalized-invoicing/activate', {
      environment: 'test',
    });
    expect(act.status, JSON.stringify(act.body)).toBe(200);

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
      { type: 'PP', description: 'Client PP (fictif)' },
      { type: 'PM', description: 'Client PM (fictif)' },
      { type: 'PC', description: 'Client PC (fictif)' },
      { type: 'PL', description: 'Client PL (fictif)' },
      { type: 'AO', description: 'Client AO (fictif)' },
    ]);
    await instantane('referenceTypes', [
      { type: 'COR', description: 'Correction (fictif)' },
      { type: 'RAN', description: 'Annulation (fictif)' },
      { type: 'RAM', description: 'Reprise (fictif)' },
      { type: 'RRR', description: 'Remise (fictif)' },
    ]);
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
      await fake?.close();
      if (out) rmSync(out, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  }, E2E_HOOK_TIMEOUT_MS);

  describe('refus avant tout brouillon', () => {
    it('DGI_PRODUCTION_ENABLED vrai → refus, aucun contexte démarré', async () => {
      const createContext = vi.fn();
      const { io: value, stderr } = io({
        env: { ...process.env, DGI_PRODUCTION_ENABLED: 'true' },
        createContext,
      });
      expect(await main(args('--out', out, '--yes'), value)).toBe(1);
      expect(stderr.text()).toContain('DGI_PRODUCTION_ENABLED');
      expect(createContext).not.toHaveBeenCalled();
      expect(existsSync(join(out, STATE_FILE))).toBe(false);
    });

    it('environnement DGI de l’organisation ≠ test → refus, rien n’est créé', async () => {
      const settings = db.collection('normalized_invoicing_settings');
      await settings.updateOne({ organizationId: org }, { $set: { environment: 'production' } });
      try {
        const { io: value, stderr } = io();
        expect(await main(args('--out', out, '--yes'), value)).toBe(1);
        expect(stderr.text()).toContain('« production »');
        expect(stderr.text()).toContain('TEST');
      } finally {
        await settings.updateOne({ organizationId: org }, { $set: { environment: 'test' } });
      }
      expect(await invoicesCount()).toBe(0);
      expect(fake.callsTo('submit')).toHaveLength(0);
      expect(existsSync(join(out, STATE_FILE))).toBe(false);
    });

    it('opérateur non membre → refus', async () => {
      const { io: value, stderr } = io();
      const stranger = '0123456789abcdef01234567';
      expect(await main(['--org', org, '--operator', stranger, '--out', out, '--yes'], value)).toBe(
        1,
      );
      expect(stderr.text()).toContain('n’est pas membre');
    });

    it('sans --yes ni terminal → refus', async () => {
      const { io: value, stderr } = io({ requireTty: true });
      expect(await main(args('--out', out), value)).toBe(1);
      expect(stderr.text()).toContain('terminal interactif');
    });
  });

  it('--dry-run : affiche le plan des 58 normalisations, n’écrit rien', async () => {
    const dry = join(out, 'jamais-cree');
    const { io: value, stdout } = io();
    expect(await main(args('--out', dry, '--dry-run'), value)).toBe(0);
    const text = stdout.text();
    expect(text).toContain('58 prévues, 0 déjà faites, 58 à faire');
    expect(text).toContain('Environnement DGI : TEST');
    expect(text).toContain('cas 10 TTC FA');
    expect(text).toContain('(avoir du cas 1)');
    expect(text).toContain('PM à créer');
    expect(existsSync(dry)).toBe(false);
    expect(await invoicesCount()).toBe(0);
    expect(await db.collection('customers').countDocuments({ organizationId: org })).toBe(0);
    expect(fake.callsTo('submit')).toHaveLength(0);
  });

  it('arrêt simulé au cas 12 (TTC), puis reprise sans renormaliser : 58 PDF et rapports', async () => {
    // 1. Arrêt brutal juste APRÈS la normalisation du cas 12 TTC, avant l'état.
    const first = io({
      hooks: {
        afterNormalize: (step) => {
          if (step.key === 'ttc-12') throw new Error('arrêt simulé du processus');
        },
      },
    });
    expect(await main(args('--out', out, '--yes'), first.io)).toBe(1);
    expect(first.stderr.text()).toContain('arrêt simulé');
    const interrupted = JSON.parse(readFileSync(join(out, STATE_FILE), 'utf8')) as CampaignState;
    expect(Object.keys(interrupted.entries).sort()).toEqual(
      Array.from({ length: 11 }, (_, i) => `ttc-${String(i + 1).padStart(2, '0')}`),
    );
    expect(fake.callsTo('submit')).toHaveLength(12);
    expect(
      await db
        .collection('sales_invoices')
        .countDocuments({ organizationId: org, status: 'normalized', 'campaign.caseNumber': 12 }),
    ).toBe(1);
    // Clients fictifs créés une fois.
    expect(await db.collection('customers').countDocuments({ organizationId: org })).toBe(
      HOMOLOGATION_CUSTOMERS.length,
    );

    // 2. Relance : le cas 12 est retrouvé en base, la campagne va jusqu'au bout.
    const second = io();
    expect(await main(args('--out', out, '--yes'), second.io)).toBe(0);
    expect(second.stdout.text()).toContain('retrouvé normalisé en base');
    expect(fake.callsTo('submit')).toHaveLength(58);
    const rns = fake.invoices().map((r) => r.request['rn'] as string);
    expect(new Set(rns).size).toBe(58);
    expect(fake.invoices().every((r) => r.status === 'confirmed')).toBe(true);
    expect(await db.collection('customers').countDocuments({ organizationId: org })).toBe(
      HOMOLOGATION_CUSTOMERS.length,
    );

    const state = JSON.parse(readFileSync(join(out, STATE_FILE), 'utf8')) as CampaignState;
    expect(Object.keys(state.entries)).toHaveLength(58);
    expect(state.entries['ttc-12']).toMatchObject({
      recoveredFromDatabase: true,
      durationMs: null,
    });
    expect(state.entries['ttc-13']).toMatchObject({ recoveredFromDatabase: false });

    // Un PDF par facture, nommé d'après le numéro lu du document.
    const pdfs = readdirSync(out).filter((f) => f.endsWith('.pdf'));
    expect(pdfs).toHaveLength(58);
    for (const e of Object.values(state.entries)) {
      const mode = e!.mode;
      expect(e!.pdfFile).toMatch(
        new RegExp(`^cas-${String(e!.caseNumber).padStart(2, '0')}-${mode}-`),
      );
      expect(e!.pdfFile).toContain(e!.number.replace(/[^A-Za-z0-9_-]/g, '_'));
      const pdf = readFileSync(join(out, e!.pdfFile!), 'utf8');
      expect(pdf.startsWith('%PDF-FAKE')).toBe(true);
      expect(pdf).toContain(e!.number);
      // Le numéro, le Code DEF/DGI et l'uid sont ceux de la DGI (faux serveur).
      const rec = fake.invoicesByRn(e!.number);
      expect(rec).toHaveLength(1);
      expect(e).toMatchObject({
        uid: rec[0]!.uid,
        codeDefDgi: rec[0]!.security!.codeDEFDGI,
        nim: rec[0]!.security!.nim,
        counters: rec[0]!.security!.counters,
      });
      expect(e!.totals.identical).toBe(true);
      // Reçu tel quel de la DGI (« 892500 ») ; même valeur que Lalanda (« 892500.00 »).
      expect(Number(e!.totals.dgi.total)).toBe(Number(e!.totals.lalanda.total));
    }
    // L'avoir du cas 12 porte le code de la facture du cas 6 (même mode).
    const avoir12 = fake.invoicesByRn(state.entries['ht-12']!.number)[0]!;
    expect(avoir12.request['reference']).toBe(state.entries['ht-06']!.codeDefDgi);

    const report = JSON.parse(readFileSync(join(out, REPORT_JSON), 'utf8')) as CampaignReport;
    expect(report).toMatchObject({
      planned: 58,
      normalized: 58,
      complete: true,
      environment: 'test',
    });
    const md = readFileSync(join(out, REPORT_MD), 'utf8');
    expect(md.split('\n').filter((l) => /^\| \d+ \| (TTC|HT) \|/.test(l))).toHaveLength(58);
    expect(md).toContain('58 / 58 (complet)');

    // Aucun jeton dans aucune sortie.
    for (const f of readdirSync(out)) {
      expect(readFileSync(join(out, f), 'utf8'), f).not.toContain(JETON);
    }
    expect(first.stdout.text() + first.stderr.text() + second.stdout.text()).not.toContain(JETON);

    // 3. Relance idempotente : rien n'est renvoyé à la DGI.
    const third = io();
    expect(await main(args('--out', out, '--yes'), third.io)).toBe(0);
    expect(third.stdout.text()).toContain('0 à faire');
    expect(fake.callsTo('submit')).toHaveLength(58);
    expect(await invoicesCount()).toBe(58);
  });
});
