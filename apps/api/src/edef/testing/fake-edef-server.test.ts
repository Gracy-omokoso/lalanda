// Le faux serveur e-MCF lui-même — ADR-0024, « Faux serveur e-MCF enrichi ».
//
// F2 et F4 codent contre ce serveur : ces tests verrouillent ce qu'il simule
// (totaux par le moteur sous une politique choisie, expiration, file d'attente,
// doublons, compteurs, enregistrement des requêtes), pour qu'un test de F2 ou
// F4 qui passe prouve quelque chose.

import {
  DGI_ROUNDING_POLICY,
  DGI_ROUNDING_POLICY_2026_1,
  compareWithEdefResponse,
  computeInvoiceTotals,
  decimalToJsonNumber,
  usdCounterValue,
} from '@lalanda/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Secret } from '../../integrations/secret-value.js';
import {
  DEFAULT_NORMALIZATION_TIMINGS,
  type DgiPlatformConfig,
} from '../../platform-config/dgi-platform.config.js';
import type { EdefInvoiceCallContext, EdefInvoiceRequest } from '../edef-invoice.types.js';
import { EdefClient } from '../edef.client.js';
import type { EdefCallContext } from '../edef.types.js';
import {
  FAKE_VALIDATION_ERROR_CODE,
  startFakeEdefServer,
  type FakeEdefServer,
} from './fake-edef-server.js';
import { MemoryEdefExchangeJournal } from './memory-edef-journal.js';

const JETON = 'jeton-faux-serveur-0123456789abcdef';
const AUTRE_JETON = 'jeton-autre-emcf-0123456789abcdef';
const NIM = 'XX01000002-1';
const TTL_MS = 120_000;
const MAX_PENDING = 3;

let n = 0;
const rnSuivant = (): string => `TEST-2026-${String(++n).padStart(6, '0')}`;

/** 3 × 10,01 TTC en B (16 %) : TVA exacte 4,142… → 4,15 (centime supérieur) ou 4,14 (au plus proche). */
function corps(rn: string, extra: Partial<EdefInvoiceRequest> = {}): EdefInvoiceRequest {
  return {
    nif: 'A0000000X',
    rn,
    mode: 'ttc',
    isf: 'TST-LAL-01',
    type: 'FV',
    items: [{ code: null, name: 'Article', type: 'BIE', price: 10.01, quantity: 3, taxGroup: 'B' }],
    client: { type: 'PP' },
    operator: { name: 'Opératrice' },
    payment: [{ name: 'ESPECES', amount: 30.03 }],
    ...extra,
  };
}

function nos(): ReturnType<typeof computeInvoiceTotals> {
  return computeInvoiceTotals({
    priceMode: 'ttc',
    lines: [
      { unitPrice: '10.01', quantity: '3', taxGroup: 'B', itemType: 'BIE', specificTax: null },
    ],
    rates: { B: '16' },
  });
}

describe('faux serveur e-MCF', () => {
  let fake: FakeEdefServer;
  let client: EdefClient;

  beforeAll(async () => {
    fake = await startFakeEdefServer({
      tokens: {
        [JETON]: { nif: 'A0000000X', nim: NIM, tokenValid: '2099-01-01T00:00:00' },
        [AUTRE_JETON]: { nif: 'B0000000Y', nim: 'XX09', tokenValid: '2099-01-01T00:00:00' },
      },
      pendingTtlMs: TTL_MS,
      maxPending: MAX_PENDING,
    });
    const config: DgiPlatformConfig = {
      baseUrl: { test: fake.baseUrl, production: fake.baseUrl },
      isf: { test: 'TST-LAL-01', production: null },
      productionEnabled: false,
      httpTimeoutMs: 3_000,
      normalizationTimings: DEFAULT_NORMALIZATION_TIMINGS,
    };
    client = new EdefClient(config, new MemoryEdefExchangeJournal());
  });

  afterAll(async () => {
    await fake.close();
  });

  const ctx = (rn: string, token = JETON): EdefInvoiceCallContext => ({
    environment: 'test',
    token: new Secret(token),
    organizationId: 'org',
    pointOfSaleId: 'pdv',
    invoiceId: `doc-${rn}`,
    rn,
  });
  const lecture = (token = JETON): EdefCallContext => ({
    environment: 'test',
    token: new Secret(token),
    organizationId: 'org',
    pointOfSaleId: 'pdv',
  });

  async function soumettre(rn: string, extra: Partial<EdefInvoiceRequest> = {}) {
    const out = await client.submitInvoice(corps(rn, extra), ctx(rn));
    if (!out.ok) throw new Error(`${out.error.dgiErrorCode} ${out.error.message}`);
    return out.data;
  }

  /** Solde toutes les demandes en attente (les tests suivants repartent d'une file vide). */
  async function vider(): Promise<void> {
    for (const r of fake.invoices().filter((i) => i.status === 'pending')) {
      await client.cancelInvoice(r.uid, ctx(r.rn));
    }
  }

  describe('totaux calculés par le moteur, sous la politique choisie par le test', () => {
    it('même politique que Lalanda → aucune différence', async () => {
      fake.setRoundingPolicy(DGI_ROUNDING_POLICY);
      const ours = nos();
      if (!ours.ok) throw new Error('calcul');
      const rep = await soumettre(rnSuivant());
      expect(rep.raw['vab']).toBe(4.14);
      expect(compareWithEdefResponse(ours.totals, { B: '16' }, rep.raw).differences).toEqual([]);
      await vider();
    });

    it('autre politique (ancienne, TVA au centime supérieur) → l’écart apparaît, nommé par le moteur', async () => {
      fake.setRoundingPolicy(DGI_ROUNDING_POLICY_2026_1);
      try {
        const ours = nos();
        if (!ours.ok) throw new Error('calcul');
        const rep = await soumettre(rnSuivant());
        expect(rep.raw['vab']).toBe(4.15);
        const fields = compareWithEdefResponse(ours.totals, { B: '16' }, rep.raw).differences.map(
          (d) => d.field,
        );
        expect(fields).toContain('vab');
        expect(fields).toContain('vtotal');
      } finally {
        fake.setRoundingPolicy(DGI_ROUNDING_POLICY);
        await vider();
      }
    });

    it('contre-valeur : curTotal = total CDF / curRate, par le moteur', async () => {
      const rep = await soumettre(rnSuivant(), { curCode: 'USD', curRate: 2262.32 });
      expect(rep.raw['curTotal']).toBe(decimalToJsonNumber(usdCounterValue('30.03', '2262.32')));
      await vider();
    });

    it('les taux renvoyés sont ceux de `setTaxGroups` ; groupe inconnu → code fictif', async () => {
      const rep = await soumettre(rnSuivant());
      expect(rep.raw).toMatchObject({ ta: 0, tb: 16, tc: 5, to: 1, td: null });
      const rn = rnSuivant();
      const refus = await client.submitInvoice(
        corps(rn, {
          items: [{ code: null, name: 'x', type: 'BIE', price: 10, quantity: 1, taxGroup: 'D' }],
        }),
        ctx(rn),
      );
      expect(!refus.ok && refus.error.dgiErrorCode).toBe(FAKE_VALIDATION_ERROR_CODE);
      await vider();
    });
  });

  describe('demandes en attente', () => {
    it('expiration après pendingTtlMs (horloge avancée) : hors liste, confirm → 20, rn réutilisable', async () => {
      const rn = rnSuivant();
      const { uid } = await soumettre(rn);
      fake.advanceClock(TTL_MS - 1_000);
      expect(fake.invoiceByUid(uid)!.status).toBe('pending');
      fake.advanceClock(1_000);
      expect(fake.invoiceByUid(uid)!.status).toBe('expired');

      const liste = await client.getPendingRequests(lecture());
      expect(liste.ok && liste.data.list.map((p) => p.uid)).not.toContain(uid);
      const conf = await client.confirmInvoice(uid, { total: 30.03, vtotal: 4.14 }, ctx(rn));
      expect(!conf.ok && conf.error.dgiErrorCode).toBe('20');
      const detail = await client.getInvoiceDetails(uid, lecture());
      expect(detail.ok && detail.data).toMatchObject({ rn, security: null });

      const nouvelle = await soumettre(rn);
      expect(nouvelle.uid).not.toBe(uid);
      await vider();
    });

    it(`au plus ${MAX_PENDING} demandes en attente par jeton → erreur 1 ; une annulation libère`, async () => {
      const uids: string[] = [];
      for (let i = 0; i < MAX_PENDING; i += 1) uids.push((await soumettre(rnSuivant())).uid);
      const rn = rnSuivant();
      const plein = await client.submitInvoice(corps(rn), ctx(rn));
      expect(!plein.ok && plein.error.dgiErrorCode).toBe('1');
      // Un autre e-MCF (autre jeton) n'est pas concerné.
      const ailleurs = await client.submitInvoice(corps(rn), ctx(rn, AUTRE_JETON));
      expect(ailleurs.ok).toBe(true);

      await client.cancelInvoice(uids[0]!, ctx('x'));
      expect((await client.submitInvoice(corps(rn), ctx(rn))).ok).toBe(true);
      await vider();
    });

    it('la liste ne montre que les demandes du jeton appelant', async () => {
      const mien = (await soumettre(rnSuivant())).uid;
      const rnAutre = rnSuivant();
      const autre = await client.submitInvoice(corps(rnAutre), ctx(rnAutre, AUTRE_JETON));
      const liste = await client.getPendingRequests(lecture());
      if (!liste.ok || !autre.ok) throw new Error('liste');
      expect(liste.data.list.map((p) => p.uid)).toContain(mien);
      expect(liste.data.list.map((p) => p.uid)).not.toContain(autre.data.uid);
      // Le détail d'une demande d'un autre e-MCF est refusé comme inconnu.
      const detail = await client.getInvoiceDetails(autre.data.uid, lecture());
      expect(!detail.ok && detail.error.dgiErrorCode).toBe('20');
      await vider();
    });

    it('uid inconnu → erreur 20 sur le détail, le confirm et le cancel', async () => {
      for (const out of [
        await client.getInvoiceDetails('inconnu', lecture()),
        await client.confirmInvoice('inconnu', { total: 1, vtotal: 0 }, ctx('r')),
        await client.cancelInvoice('inconnu', ctx('r')),
      ]) {
        expect(!out.ok && out.error.dgiErrorCode).toBe('20');
      }
    });
  });

  describe('éléments de sécurité', () => {
    it('forme, NIM du profil, compteurs par type et au total', async () => {
      const a = rnSuivant();
      const b = rnSuivant();
      const c = rnSuivant();
      const ua = (await soumettre(a)).uid;
      const ub = (await soumettre(b)).uid;
      const uc = (await soumettre(c, { type: 'FT' })).uid;
      const montants = { total: 30.03, vtotal: 4.14 };
      const ea = await client.confirmInvoice(ua, montants, ctx(a));
      const eb = await client.confirmInvoice(ub, montants, ctx(b));
      const ec = await client.confirmInvoice(uc, montants, ctx(c));
      if (!ea.ok || !eb.ok || !ec.ok) throw new Error('confirmation');
      expect(ea.data.codeDefDgi).toMatch(/^FAKE(-[0-9A-F]{4}){5}$/);
      expect(ea.data.codeDefDgi).not.toBe(eb.data.codeDefDgi);
      expect(ea.data.nim).toBe(NIM);
      expect(ea.data.dateTime).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
      expect(ea.data.qrCode).toContain(ea.data.codeDefDgi);
      const [ta, tot] = ea.data.counters.split(' ')[0]!.split('/').map(Number);
      expect(eb.data.counters).toBe(`${ta! + 1}/${tot! + 1} FV`);
      expect(ec.data.counters).toMatch(new RegExp(`^\\d+/${tot! + 2} FT$`));
    });

    it('le détail d’une demande annulée ne porte aucun élément', async () => {
      const rn = rnSuivant();
      const { uid } = await soumettre(rn);
      await client.cancelInvoice(uid, ctx(rn));
      const detail = await client.getInvoiceDetails(uid, lecture());
      expect(detail.ok && detail.data.security).toBeNull();
      expect(fake.invoiceByUid(uid)!.status).toBe('cancelled');
    });
  });

  it('enregistre méthode, chemin, Authorization et corps ; callsTo classe les appels', async () => {
    const rn = rnSuivant();
    const avant = fake.requests.length;
    const { uid } = await soumettre(rn);
    await client.getInvoiceDetails(uid, lecture());
    await client.getPendingRequests(lecture());
    await client.confirmInvoice(uid, { total: 30.03, vtotal: 4.14 }, ctx(rn));
    const recues = fake.requests.slice(avant);
    expect(recues.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /api/invoice',
      `GET /api/invoice/${uid}`,
      'GET /api/invoice',
      `PUT /api/invoice/${uid}/confirm`,
    ]);
    expect(recues.every((r) => r.authorization === `Bearer ${JETON}`)).toBe(true);
    expect(JSON.parse(recues[0]!.body!)).toMatchObject({ rn });
    expect(recues[0]!.at).toBeInstanceOf(Date);
    const sub = fake.callsTo('submit').filter((r) => r.body?.includes(rn));
    expect(sub).toHaveLength(1);
    expect(fake.callsTo('confirm').some((r) => r.path.includes(uid))).toBe(true);
    expect(fake.callsTo('details').some((r) => r.path.includes(uid))).toBe(true);
    expect(fake.callsTo('pending').length).toBeGreaterThan(0);
  });

  it('un scénario par rn prime sur celui du jeton, et s’efface', async () => {
    const rn = rnSuivant();
    fake.setInvoiceScenario(rn, 'post_business_error:3');
    const refus = await client.submitInvoice(corps(rn), ctx(rn));
    expect(!refus.ok && refus.error.dgiErrorCode).toBe('3');
    fake.setInvoiceScenario(rn, null);
    expect((await client.submitInvoice(corps(rn), ctx(rn))).ok).toBe(true);
    await vider();
  });
});
