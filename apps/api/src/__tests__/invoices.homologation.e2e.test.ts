// Campagne d'homologation DGI contre la vraie application (ADR-0026, S25h).
//
// Les 29 cas de facture officiels (cas de test du SFE v1.2), chacun en TTC puis
// en HT : 58 normalisations, dans l'ordre qui respecte les enchaînements
// 1 → 10, 3 → 11, 6 → 12 et 15 → 16 (l'avoir porte le code DEF/DGI de sa
// facture d'origine). Définitions : `edef/homologation/homologation-cases.ts`.
//
// Chaîne complète : cookie → better-auth → gardes → contrôleurs → MongoDB
// (transactions) → moteur → VRAI client e-MCF → FAUX serveur e-MCF local. AUCUN
// appel à la DGI réelle. Pour chaque cas : normalisation réussie, requête envoyée
// conforme au cas, totaux identiques à ceux du faux serveur, mentions du PDF
// (rendu Chromium remplacé par un double qui renvoie le HTML imprimé, comme dans
// `invoice-documents.e2e.test.ts`).
//
// BASE DÉDIÉE, supprimée à la fin. Vendeur, clients, NIF et jeton FICTIFS,
// marqués TEST (le jeton aussi ANTIFUITE).

import 'reflect-metadata';

import { compareWithEdefResponse, type InvoiceTotals, type TaxRateTable } from '@lalanda/engine';
import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HOMOLOGATION_CASES,
  HOMOLOGATION_CUSTOMERS,
  HOMOLOGATION_PRICE_MODES,
  HOMOLOGATION_WALK_IN_NAME,
  homologationCase,
  homologationDraftBody,
  homologationPayments,
  type HomologationCase,
} from '../edef/homologation/homologation-cases.js';
import { startFakeEdefServer, type FakeEdefServer } from '../edef/testing/fake-edef-server.js';
import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { TEST_BANNER } from '../sales/documents/invoice-document.model.js';
import { qrCodeSvg } from '../sales/documents/invoice-qr.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_homologation_${tag}`;
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';
process.env['DGI_ISF_TEST'] = process.env['DGI_ISF_TEST'] || 'ISF-TEST-E2E';
process.env['DGI_HTTP_TIMEOUT_MS'] = '10000';
delete process.env['DGI_PRODUCTION_ENABLED'];

vi.setConfig({ testTimeout: 600_000 });

const MOT_DE_PASSE = 'Passw0rd!homologation';
const NOM_OPERATEUR = 'Opératrice TEST';
const NIF_VENDEUR = 'TESTSFE0001';
const NIM = 'TS01000001-1';
const JETON = `ANTIFUITE-homologation-${tag}-0123456789abcdef`;

/** Taux FICTIFS, identiques dans l'instantané et dans le faux serveur. */
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
const TAUX: TaxRateTable = Object.fromEntries(
  Object.entries(GROUPES).map(([g, r]) => [g.toUpperCase(), String(r)]),
);

const LIBELLES_CLIENT: Record<string, string> = {
  PP: 'Client PP (fictif)',
  PM: 'Client PM (fictif)',
  PC: 'Client PC (fictif)',
  PL: 'Client PL (fictif)',
  AO: 'Client AO (fictif)',
};
const LIBELLES_NATURE: Record<string, string> = {
  COR: 'Correction (fictif)',
  RAN: 'Annulation (fictif)',
  RAM: 'Reprise (fictif)',
  RRR: 'Remise (fictif)',
};

/** Même échappement que `invoice-document-html.ts`. */
const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Mise en forme d'un montant imprimé (séparateur U+00A0, virgule), cf. `formatAmount`. */
const imprime = (v: string) => {
  const [i, f] = v.split('.');
  const int = i!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return f !== undefined ? `${int},${f}` : int;
};

type Vue = Record<string, any>;

function binary(req: request.Test): request.Test {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

e2eSuite('campagne d’homologation DGI — 29 cas × TTC/HT (ADR-0026, S25h)', () => {
  let app: INestApplication;
  let db: Db;
  let fake: FakeEdefServer;
  let org = '';
  let cookies: string[] = [];
  const customerIds: Partial<Record<string, string>> = {};
  /** Factures normalisées par mode et par cas : origines des avoirs. */
  const normalisees: Record<string, Map<number, Vue>> = { ttc: new Map(), ht: new Map() };
  const numeros: string[] = [];
  const moyensEnvoyes = new Set<string>();

  const server = () => app.getHttpServer();
  const as = () => [...cookies, `active_org_id=${org}`];
  const post = (path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', as())
      .send(body ?? {});
  const put = (path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', as()).send(body);
  const get = (path: string) => request(server()).get(path).set('Cookie', as());
  const clearThrottle = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };

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

  /** Brouillon du cas, paiements posés pour le total du moteur, prêt à normaliser. */
  async function brouillon(c: HomologationCase, mode: 'ttc' | 'ht', body = corpsDe(c, mode)) {
    const d = await post('/sales/invoices', body);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const total = d.body.documentAmounts.calculation.totals.total as string;
    const res = await put(`/sales/invoices/${d.body.id}`, {
      ...body,
      payments: homologationPayments(c, total),
      expectedRevision: d.body.revision,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Vue;
  }

  function corpsDe(c: HomologationCase, mode: 'ttc' | 'ht') {
    return homologationDraftBody(c, mode, {
      customerIds,
      originInvoiceId: (n) => {
        const o = normalisees[mode]!.get(n);
        if (!o) throw new Error(`Cas ${n} (${mode}) non normalisé : l’avoir ne peut pas suivre.`);
        return o.id as string;
      },
      pointOfSaleId: null,
    });
  }

  async function normaliser(d: Vue) {
    return post(`/sales/invoices/${d.id}/normalize`, {
      expectedRevision: d.revision,
      exchangeRate: null,
    });
  }

  /** Joue un cas dans un mode : normalisation, requête, totaux, PDF. */
  async function jouer(c: HomologationCase, mode: 'ttc' | 'ht') {
    const d = await brouillon(c, mode);
    expect(d.readiness.blockers, JSON.stringify(d.readiness.blockers)).toEqual([]);
    if (c.expected.groups.includes('K')) {
      // Vendeur de test assujetti : K reste permis, avec un avertissement (ADR-0026, décision n° 2).
      expect(d.readiness.warnings.map((w: { code: string }) => w.code)).toContain(
        'TAX_GROUP_K_WHILE_VAT_REGISTERED',
      );
    }

    const res = await normaliser(d);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const v = res.body as Vue;
    expect(v, JSON.stringify(v.normalization?.lastError)).toMatchObject({
      status: 'normalized',
      documentKind: 'invoice',
      type: c.type,
      priceMode: mode,
      series: 'test',
    });
    numeros.push(v.number);

    // ── Requête envoyée à la DGI (faux serveur) ──
    const recs = fake.invoicesByRn(v.number);
    expect(recs).toHaveLength(1);
    const rec = recs[0]!;
    expect(rec.status).toBe('confirmed');
    const sent = rec.request as Record<string, any>;
    expect(sent).toMatchObject({
      nif: NIF_VENDEUR,
      rn: v.number,
      mode,
      type: c.type,
      isf: process.env['DGI_ISF_TEST'],
      operator: { name: NOM_OPERATEUR },
    });
    const items = sent['items'] as Record<string, any>[];
    expect(items.map((i) => i['taxGroup'])).toEqual(c.expected.groups);
    expect(items.map((i) => i['type'])).toEqual(c.expected.itemTypes);
    expect(items.map((i) => i['code'] ?? null)).toEqual(c.expected.itemCodes);
    const quantites =
      c.credit && c.credit.nature !== 'RRR'
        ? c.credit.lines.map((l) => l.quantity)
        : c.lines.map((l) => l.quantity);
    expect(items.map((i) => i['quantity'])).toEqual(quantites.map(Number));
    // Prix envoyés = prix CDF figés (« données imprimées = données échangées »).
    expect(items.map((i) => i['price'])).toEqual(
      v.normalizedAmounts.lines.map((l: { unitPrice: string }) => Number(l.unitPrice)),
    );
    c.lines.forEach((l, i) => {
      const item = items[i]!;
      if (l.specificTax) {
        // Par unité : « 250.00 » ; en pourcentage : « 10.00% » (forme `{valeur}%`).
        const value = String(item['taxSpecificValue']);
        if (l.specificTax.kind === 'percent') {
          expect(value, `cas ${c.number} ligne ${i}`).toMatch(/^\d+(\.\d+)?%$/);
          expect(Number(value.slice(0, -1))).toBe(Number(l.specificTax.rate));
        } else {
          expect(value, `cas ${c.number} ligne ${i}`).toBe(l.specificTax.amount);
        }
        expect(item['taxSpecificAmount']).toBeGreaterThan(0);
      } else {
        expect(item['taxSpecificValue']).toBeUndefined();
      }
      if (l.discount) {
        expect(item['originalPrice']).toBe(Number(l.unitPrice));
        expect(item['price']).toBeLessThan(Number(l.unitPrice));
        if (l.discount.kind === 'percent') {
          expect(item['priceModification']).toBe(`Remise ${l.discount.value} %`);
        }
      } else {
        expect(item['originalPrice']).toBeUndefined();
      }
    });

    // Client : type et libellé DGI ; nom et NIF de la fiche (PP : comptoir, sans NIF).
    const client = sent['client'] as Record<string, unknown>;
    expect(client['type']).toBe(c.customer);
    expect(client['typeDesc']).toBe(LIBELLES_CLIENT[c.customer]);
    if (c.customer === 'PP') {
      expect(client).toMatchObject({ name: HOMOLOGATION_WALK_IN_NAME });
      expect(client['nif']).toBeUndefined();
    } else {
      const fiche = HOMOLOGATION_CUSTOMERS.find((x) => x.type === c.customer)!;
      expect(client).toMatchObject({ name: fiche.name, nif: fiche.nif });
    }

    // Avoir : référence = code DEF/DGI de l'origine (même mode), ou « RRR ».
    if (c.expected.reference === 'origin' && c.credit && c.credit.nature !== 'RRR') {
      const origine = normalisees[mode]!.get(c.credit.originCase)!;
      expect(sent['reference']).toBe(origine.normalization.codeDefDgi);
      expect(sent['reference']).toHaveLength(29);
      expect(v.creditNote).toMatchObject({
        nature: c.credit.nature,
        originInvoiceId: origine.id,
        originNumber: origine.number,
        reference: origine.normalization.codeDefDgi,
      });
    } else if (c.expected.reference === 'RRR') {
      expect(sent['reference']).toBe('RRR');
    } else {
      expect(sent['reference']).toBeUndefined();
    }
    if (c.credit) {
      expect(sent['referenceType']).toBe(c.credit.nature);
      expect(sent['referenceDesc']).toBe(LIBELLES_NATURE[c.credit.nature]);
    } else {
      expect(sent['referenceType']).toBeUndefined();
    }

    // Commentaires : A seulement quand le cas l'exige ; B à H jamais.
    expect(sent['cmta']).toBe(c.expected.commentA ?? undefined);
    for (const k of ['cmtb', 'cmtc', 'cmtd', 'cmte', 'cmtf', 'cmtg', 'cmth']) {
      expect(sent[k]).toBeUndefined();
    }

    // Contre-valeur USD (cas 26) : indicative, la facture reste en CDF.
    if (c.expected.counterValue) {
      expect(sent).toMatchObject({ curCode: 'USD', curRate: 2262.32 });
      expect(typeof sent['curDate']).toBe('string');
      expect(v.normalizedAmounts.counterValueUsd).not.toBeNull();
      expect(rec.totals['curTotal']).toBe(Number(v.normalizedAmounts.counterValueUsd.amount));
    } else {
      expect(sent['curCode']).toBeUndefined();
      expect(v.normalizedAmounts.counterValueUsd).toBeNull();
    }

    // Paiements : moyens du cas, montants CDF figés.
    const paiements = sent['payment'] as { name: string; amount: number }[];
    expect(paiements.map((p) => p.name)).toEqual(c.payments.map((p) => p.method));
    expect(paiements.map((p) => p.amount)).toEqual(
      v.normalizedAmounts.payments.map((p: { amount: string }) => Number(p.amount)),
    );
    for (const p of paiements) moyensEnvoyes.add(p.name);

    // ── Totaux : les nôtres = ceux du faux serveur, champ par champ ──
    const calc = v.normalizedAmounts.calculation as InvoiceTotals;
    const cmp = compareWithEdefResponse(calc, TAUX, rec.totals);
    expect(cmp.differences).toEqual([]);
    expect(cmp.identical).toBe(true);
    const confirm = fake.callsTo('confirm').find((r) => r.path.includes(rec.uid))!;
    expect(JSON.parse(confirm.body!)).toEqual({
      total: rec.totals['total'],
      vtotal: rec.totals['vtotal'],
    });

    // Éléments de sécurité tels que reçus.
    expect(v.normalization).toMatchObject({
      phase: 'done',
      codeDefDgi: rec.security!.codeDEFDGI,
      nim: rec.security!.nim,
      counters: rec.security!.counters,
      dgiDateTime: rec.security!.dateTime,
      qrCode: rec.security!.qrCode,
    });

    // ── PDF : mentions du cas ──
    const pdf = await binary(get(`/sales/invoices/${v.id}/pdf`));
    expect(pdf.status).toBe(200);
    const t = (pdf.body as Buffer).toString('utf8');
    const avoir = c.type === 'FA' || c.type === 'EA';
    expect(t).toContain(avoir ? 'Facture d’avoir normalisée' : 'Facture normalisée');
    expect(t).toContain(`${avoir ? 'Avoir n°' : 'Facture n°'} <b>${v.number}</b>`);
    expect(t).toContain(mode === 'ttc' ? 'Prix unitaires TTC' : 'Prix unitaires HT');
    expect(t).toContain(esc(`[${c.customer}]`));
    for (const g of c.expected.groups) expect(t).toContain(`[${g}]`);
    for (const ty of c.expected.itemTypes) expect(t).toContain(`[${ty}]`);
    for (const m of c.expected.pdfMentions) expect(t, `mention « ${m} »`).toContain(esc(m));
    expect(t).toContain(esc(v.normalization.codeDefDgi));
    expect(t).toContain(esc(v.normalization.nim));
    expect(t).toContain(esc(v.normalization.counters));
    expect(t).toContain(await qrCodeSvg(v.normalization.qrCode));
    expect(t).toContain(`ISF`);
    expect(t).toContain(esc(`Établi par : ${NOM_OPERATEUR}`));
    expect(t).toContain(imprime(calc.total));
    expect(t).toContain(
      avoir ? 'Arrêtée la présente facture d’avoir' : 'Arrêtée la présente facture',
    );
    expect(t).toContain(TEST_BANNER);
    if (c.credit && c.credit.nature !== 'RRR') {
      const origine = normalisees[mode]!.get(c.credit.originCase)!;
      expect(t).toContain(esc(`Facture d’origine : n° ${origine.number}`));
      expect(t).toContain(esc(`Code DEF/DGI d’origine : ${origine.normalization.codeDefDgi}`));
    }
    if (c.customer !== 'PP') {
      const fiche = HOMOLOGATION_CUSTOMERS.find((x) => x.type === c.customer)!;
      expect(t).toContain(esc(fiche.name));
      expect(t).toContain(esc(`NIF : ${fiche.nif}`));
    }

    normalisees[mode]!.set(c.number, v);
    return v;
  }

  beforeAll(async () => {
    fake = await startFakeEdefServer({
      tokens: { [JETON]: { nif: NIF_VENDEUR, nim: NIM, tokenValid: '2099-01-31T00:00:00' } },
      taxGroups: GROUPES,
    });
    process.env['DGI_EDEF_TEST_URL'] = fake.baseUrl;
    process.env['DGI_EDEF_PRODUCTION_URL'] = 'https://edef.invalid';
    app = await makeE2EApp();
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    // Double du rendu Chromium : `%PDF-FAKE` + le HTML qui serait imprimé.
    vi.spyOn(app.get(PdfRenderingService), 'render').mockImplementation(async (html) =>
      Buffer.from(`%PDF-FAKE\n${html}`, 'utf8'),
    );

    cookies = await registerAndLogin(app, {
      email: `homologation-${tag}@lalanda-test.local`,
      password: MOT_DE_PASSE,
      name: NOM_OPERATEUR,
    });
    const orgs = await request(server()).get('/organizations').set('Cookie', cookies);
    org = (orgs.body.organizations as { id: string }[])[0]!.id;

    const fiche = await put('/organizations/current/fiscal-profile', {
      legalName: 'Vendeur TEST Homologation SARL',
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
    await instantane(
      'clientTypes',
      Object.entries(LIBELLES_CLIENT).map(([type, description]) => ({ type, description })),
    );
    await instantane(
      'referenceTypes',
      Object.entries(LIBELLES_NATURE).map(([type, description]) => ({ type, description })),
    );

    for (const c of HOMOLOGATION_CUSTOMERS) {
      const res = await post('/sales/customers', {
        type: c.type,
        name: c.name,
        nif: c.nif,
        exemptionReference: c.exemptionReference,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      customerIds[c.type] = res.body.id;
    }
  }, E2E_HOOK_TIMEOUT_MS);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
      await fake?.close();
    }
  }, E2E_HOOK_TIMEOUT_MS);

  for (const mode of HOMOLOGATION_PRICE_MODES) {
    describe(`mode ${mode.toUpperCase()}`, () => {
      for (const c of HOMOLOGATION_CASES) {
        it(`cas ${c.number} — ${c.title}`, async () => {
          await jouer(c, mode);
        });
      }
    });
  }

  describe('exigences transverses', () => {
    it('58 factures normalisées, numéros TEST- contigus sans trou (1.15)', async () => {
      expect(numeros).toHaveLength(58);
      const rangs = numeros.map((n) => {
        // ADR-0027 : TEST-IN… (factures) et TEST-AV… (avoirs), un seul compteur.
        const m = /^TEST-(?:IN|AV)(\d{4})-(\d{6})$/.exec(n);
        expect(m, n).not.toBeNull();
        return Number(m![2]);
      });
      expect(rangs).toEqual(rangs.map((_, i) => rangs[0]! + i));
      const j = await get('/sales/journal');
      expect(j.status).toBe(200);
      expect(j.body.chainValid).toBe(true);
    });

    it('six moyens de paiement envoyés, plusieurs sur une même facture (1.18)', () => {
      for (const m of [
        'ESPECES',
        'VIREMENT',
        'CARTEBANCAIRE',
        'MOBILEMONEY',
        'CHEQUES',
        'CREDIT',
      ]) {
        expect(moyensEnvoyes, m).toContain(m);
      }
      const multiples = fake
        .invoices()
        .filter((r) => ((r.request['payment'] as unknown[]) ?? []).length > 1);
      expect(multiples.length).toBeGreaterThanOrEqual(2 * 3);
    });

    it('plusieurs avoirs partiels normalisés sur la même facture, cumul plafonné (1.26, 1.27)', async () => {
      // Origine : le cas 3 en HT (2 × B, 3 × A), déjà crédité par le cas 11 (1 × B, 1 × A).
      const origine = normalisees['ht']!.get(3)!;
      const c11 = homologationCase(11);
      const avoir = (q: string): HomologationCase => ({
        ...c11,
        credit: { nature: 'RAM', originCase: 3, lines: [{ originLineIndex: 0, quantity: q }] },
      });
      const second = await brouillon(avoir('1'), 'ht');
      const ok = await normaliser(second);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.status).toBe('normalized');
      expect(fake.invoicesByRn(ok.body.number)[0]!.request['reference']).toBe(
        origine.normalization.codeDefDgi,
      );
      const vue = (await get(`/sales/invoices/${origine.id}`)).body;
      expect(vue.lines[0]).toMatchObject({ credited: '2', remaining: '0' });
      expect(vue.lines[1]).toMatchObject({ credited: '1', remaining: '2' });
      expect(
        vue.creditNotes.filter((n: { status: string }) => n.status === 'normalized'),
      ).toHaveLength(2);

      // Un troisième avoir sur la ligne B épuisée : refusé avant tout envoi.
      const posts = fake.callsTo('submit').length;
      const brouillonTrop = await post('/sales/invoices', corpsDe(avoir('1'), 'ht'));
      expect(brouillonTrop.status, JSON.stringify(brouillonTrop.body)).toBe(201);
      const total = brouillonTrop.body.documentAmounts.calculation.totals.total as string;
      const pret = await put(`/sales/invoices/${brouillonTrop.body.id}`, {
        ...corpsDe(avoir('1'), 'ht'),
        payments: [{ method: 'ESPECES', amount: total }],
        expectedRevision: brouillonTrop.body.revision,
      });
      expect(pret.status).toBe(200);
      const refus = await normaliser(pret.body);
      expect(refus.status, JSON.stringify(refus.body)).toBe(422);
      expect((refus.body.details?.issues ?? []).map((i: { code: string }) => i.code)).toContain(
        'CREDIT_NOTE_QUANTITY_EXCEEDED',
      );
      expect(fake.callsTo('submit').length).toBe(posts);
    });
  });
});
