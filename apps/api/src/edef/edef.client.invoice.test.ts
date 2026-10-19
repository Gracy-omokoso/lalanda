// Client e-MCF, routes de facturation, contre le faux serveur — ADR-0024 § 2,
// § 6 et critères « F1 ».
//
// Aucun appel à la DGI réelle : le faux serveur écoute sur 127.0.0.1, port
// éphémère. Le journal est la doublure en mémoire ; la suite e2e de F2 vérifie
// l'écriture en base.

import { compareWithEdefResponse, computeInvoiceTotals } from '@lalanda/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Secret } from '../integrations/secret-value.js';
import {
  DEFAULT_NORMALIZATION_TIMINGS,
  type DgiPlatformConfig,
} from '../platform-config/dgi-platform.config.js';
import type { EdefInvoiceCallContext, EdefInvoiceRequest } from './edef-invoice.types.js';
import { EDEF_MAX_CONCURRENT_CALLS, EdefClient, EdefJournalWriteError } from './edef.client.js';
import type { EdefCallContext, EdefFailureKind, EdefOutcome } from './edef.types.js';
import {
  startFakeEdefServer,
  type FakeEdefScenarioInput,
  type FakeEdefServer,
} from './testing/fake-edef-server.js';
import { MemoryEdefExchangeJournal } from './testing/memory-edef-journal.js';

const FUTUR = '2027-01-31T00:00:00';
const NIF = 'A0000000X';
const NIM = 'XX01000001-1';
const JETONS = {
  ok: 'jeton-facture-ok-0123456789abcdef',
  unauthorized: 'jeton-facture-refuse-0123456789ab',
  server: 'jeton-facture-500-0123456789abcde',
  slow: 'jeton-facture-lent-0123456789abcd',
  malformed: 'jeton-facture-casse-0123456789abc',
  business: 'jeton-facture-metier-0123456789ab',
  oversized: 'jeton-facture-enorme-0123456789ab',
};
const TOUS_LES_JETONS = Object.values(JETONS);

/** Délai du client : assez long pour qu'une réponse normale n'y touche jamais
 *  (machine chargée), assez court pour garder la suite rapide. La production
 *  attend 15 s. Le serveur « lent » répond à 6 s : le délai est toujours dépassé. */
const TIMEOUT_MS = 2_000;
const SLOW_MS = 6_000;

let compteurRn = 0;
function nouveauRn(): string {
  compteurRn += 1;
  return `TEST-2026-${String(compteurRn).padStart(6, '0')}`;
}

/** Corps conforme : 2 × 116 en TTC, groupe B (16 % chez le faux serveur). */
function corps(rn: string, extra: Partial<EdefInvoiceRequest> = {}): EdefInvoiceRequest {
  return {
    nif: NIF,
    rn,
    mode: 'ttc',
    isf: 'TST-LAL-01',
    type: 'FV',
    items: [
      { code: null, name: 'Article de test', type: 'BIE', price: 116, quantity: 2, taxGroup: 'B' },
    ],
    client: { type: 'PP', typeDesc: 'Particulier (test)' },
    operator: { name: 'Opératrice de test' },
    payment: [{ name: 'ESPECES', amount: 232 }],
    ...extra,
  };
}

describe('EdefClient — routes de facturation', () => {
  let fake: FakeEdefServer;
  let journal: MemoryEdefExchangeJournal;
  let client: EdefClient;
  let config: DgiPlatformConfig;

  beforeAll(async () => {
    const profil = { nif: NIF, nim: NIM, tokenValid: FUTUR };
    fake = await startFakeEdefServer({
      tokens: {
        [JETONS.ok]: { ...profil },
        [JETONS.unauthorized]: { ...profil, behaviour: 'unauthorized' },
        [JETONS.server]: { ...profil, behaviour: 'server_error' },
        [JETONS.slow]: { ...profil, behaviour: 'slow' },
        [JETONS.malformed]: { ...profil, behaviour: 'malformed' },
        [JETONS.business]: { ...profil, behaviour: 'business_error' },
        [JETONS.oversized]: { ...profil, behaviour: 'oversized' },
      },
      slowMs: SLOW_MS,
      // Les tests laissent des demandes en attente : la limite de dix (erreur 1)
      // est vérifiée dans `fake-edef-server.test.ts`, pas ici.
      maxPending: 1_000,
    });
    config = {
      baseUrl: { test: fake.baseUrl, production: fake.baseUrl },
      isf: { test: 'TST-LAL-01', production: null },
      productionEnabled: false,
      httpTimeoutMs: TIMEOUT_MS,
      normalizationTimings: DEFAULT_NORMALIZATION_TIMINGS,
    };
    journal = new MemoryEdefExchangeJournal();
    client = new EdefClient(config, journal);
  });

  afterAll(async () => {
    await fake.close();
  });

  function ctx(
    rn: string,
    token = JETONS.ok,
    environment: 'test' | 'production' = 'test',
  ): EdefInvoiceCallContext {
    return {
      environment,
      token: new Secret(token),
      organizationId: 'org-1',
      pointOfSaleId: 'pdv-1',
      invoiceId: `facture-${rn}`,
      rn,
    };
  }

  function lecture(
    token = JETONS.ok,
    environment: 'test' | 'production' = 'test',
  ): EdefCallContext {
    return {
      environment,
      token: new Secret(token),
      organizationId: 'org-1',
      pointOfSaleId: 'pdv-1',
    };
  }

  function scenario(rn: string, s: FakeEdefScenarioInput): string {
    fake.setInvoiceScenario(rn, s);
    return rn;
  }

  async function soumettre(rn: string): Promise<string> {
    const out = await client.submitInvoice(corps(rn), ctx(rn));
    if (!out.ok) throw new Error(`envoi refusé : ${out.error.message}`);
    return out.data.uid;
  }

  function attendreEchec<T>(out: EdefOutcome<T>, kind: EdefFailureKind) {
    expect(out.ok, JSON.stringify(out)).toBe(false);
    if (out.ok) throw new Error('inattendu');
    expect(out.error.kind).toBe(kind);
    return out.error;
  }

  // ── Nominal ─────────────────────────────────────────────────────────────────

  describe('nominal', () => {
    it('POST : uid, réponse brute intacte, Bearer, corps envoyé tel quel, une seule requête', async () => {
      const rn = nouveauRn();
      const body = corps(rn);
      const avant = fake.requests.length;
      const out = await client.submitInvoice(body, ctx(rn));
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.data.uid).toMatch(/^[0-9a-f-]{36}$/);
      // Nombres JSON, jamais arrondis ni reconvertis : 2 × 116 TTC à 16 %.
      expect(out.data.raw).toMatchObject({ uid: out.data.uid, tab: 232, hab: 200, vab: 32 });
      expect(out.data.raw['total']).toBe(232);
      expect(out.data.raw['vtotal']).toBe(32);

      const recues = fake.requests.slice(avant);
      expect(recues).toHaveLength(1);
      expect(recues[0]).toMatchObject({
        method: 'POST',
        path: '/api/invoice',
        authorization: `Bearer ${JETONS.ok}`,
        body: JSON.stringify(body),
      });
    });

    it('la réponse du POST se compare au moteur sans écart (même politique)', async () => {
      const rn = nouveauRn();
      const out = await client.submitInvoice(corps(rn), ctx(rn));
      if (!out.ok) throw new Error(out.error.message);
      const ours = computeInvoiceTotals({
        priceMode: 'ttc',
        lines: [
          { unitPrice: '116', quantity: '2', taxGroup: 'B', itemType: 'BIE', specificTax: null },
        ],
        rates: { A: '0', B: '16', C: '5', O: '1' },
      });
      if (!ours.ok) throw new Error('calcul');
      const cmp = compareWithEdefResponse(
        ours.totals,
        { A: '0', B: '16', C: '5', O: '1' },
        out.data.raw,
      );
      expect(cmp.differences).toEqual([]);
    });

    it('confirm : nos total et vtotal envoyés, cinq éléments de sécurité tels que reçus', async () => {
      const rn = nouveauRn();
      const uid = await soumettre(rn);
      const avant = fake.requests.length;
      const out = await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn));
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const enregistre = fake.invoiceByUid(uid)!;
      expect(enregistre.status).toBe('confirmed');
      expect(out.data).toEqual({
        codeDefDgi: enregistre.security!.codeDEFDGI,
        nim: NIM,
        counters: enregistre.security!.counters,
        dateTime: enregistre.security!.dateTime,
        qrCode: enregistre.security!.qrCode,
      });
      const recues = fake.requests.slice(avant);
      expect(recues).toHaveLength(1);
      expect(recues[0]).toMatchObject({
        method: 'PUT',
        path: `/api/invoice/${uid}/confirm`,
        body: JSON.stringify({ total: 232, vtotal: 32 }),
      });
    });

    it('cancel : sans corps, demande annulée, date rendue', async () => {
      const rn = nouveauRn();
      const uid = await soumettre(rn);
      const avant = fake.requests.length;
      const out = await client.cancelInvoice(uid, ctx(rn));
      expect(out.ok).toBe(true);
      expect(out.ok && out.data.dateTime).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
      expect(fake.invoiceByUid(uid)!.status).toBe('cancelled');
      const recues = fake.requests.slice(avant);
      expect(recues).toHaveLength(1);
      expect(recues[0]).toMatchObject({
        method: 'PUT',
        path: `/api/invoice/${uid}/cancel`,
        body: null,
      });
    });

    it('GET /api/invoice : liste les demandes en attente, plus celles soldées', async () => {
      const rn = nouveauRn();
      const uid = await soumettre(rn);
      const avant = await client.getPendingRequests(lecture());
      expect(avant.ok).toBe(true);
      if (!avant.ok) return;
      expect(avant.data.list.map((p) => p.uid)).toContain(uid);
      expect(avant.data.count).toBe(avant.data.list.length);
      expect(avant.data.list.find((p) => p.uid === uid)!.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      await client.cancelInvoice(uid, ctx(rn));
      const apres = await client.getPendingRequests(lecture());
      expect(apres.ok && apres.data.list.map((p) => p.uid)).not.toContain(uid);
    });

    it('GET /api/invoice/{uid} : en attente sans éléments, finalisée avec', async () => {
      const rn = nouveauRn();
      const uid = await soumettre(rn);
      const attente = await client.getInvoiceDetails(uid, lecture());
      expect(attente.ok).toBe(true);
      if (!attente.ok) return;
      expect(attente.data).toMatchObject({ rn, nif: NIF, security: null });
      expect(attente.data.totals).toMatchObject({ total: 232, vtotal: 32 });

      const conf = await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn));
      const finale = await client.getInvoiceDetails(uid, lecture());
      expect(finale.ok && finale.data.security).toEqual(conf.ok && conf.data);
    });

    it('details_without_security : finalisée, mais security nul (la route ne prouve rien)', async () => {
      const rn = scenario(nouveauRn(), 'details_without_security');
      const uid = await soumettre(rn);
      await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn));
      expect(fake.invoiceByUid(uid)!.status).toBe('confirmed');
      const out = await client.getInvoiceDetails(uid, lecture());
      expect(out.ok && out.data.security).toBeNull();
    });
  });

  // ── Chaque défaillance, chaque route ───────────────────────────────────────

  type Route = 'submit' | 'confirm' | 'cancel' | 'pending' | 'details';
  const ROUTES: Route[] = ['submit', 'confirm', 'cancel', 'pending', 'details'];

  function appeler(
    c: EdefClient,
    route: Route,
    token: string,
    env: 'test' | 'production' = 'test',
  ): Promise<EdefOutcome<unknown>> {
    const rn = nouveauRn();
    switch (route) {
      case 'submit':
        return c.submitInvoice(corps(rn), ctx(rn, token, env));
      case 'confirm':
        return c.confirmInvoice('uid-quelconque', { total: 1, vtotal: 0 }, ctx(rn, token, env));
      case 'cancel':
        return c.cancelInvoice('uid-quelconque', ctx(rn, token, env));
      case 'pending':
        return c.getPendingRequests(lecture(token, env));
      case 'details':
        return c.getInvoiceDetails('uid-quelconque', lecture(token, env));
    }
  }

  const DEFAILLANCES: Array<[string, string, EdefFailureKind, number | null]> = [
    ['401', JETONS.unauthorized, 'unauthorized', 401],
    ['jeton inconnu', 'jeton-inconnu-facture-0123456789', 'unauthorized', 401],
    ['5xx', JETONS.server, 'server', 500],
    ['JSON illisible', JETONS.malformed, 'invalid_response', 200],
    ['errorCode dans un 200', JETONS.business, 'business', 200],
    ['réponse > 1 Mio', JETONS.oversized, 'invalid_response', 200],
    ['délai dépassé', JETONS.slow, 'timeout', null],
  ];

  for (const route of ROUTES) {
    describe(`${route} : défaillances`, () => {
      for (const [libelle, jeton, kind, http] of DEFAILLANCES) {
        it(`${libelle} → ${kind}, une seule requête reçue, aucun jeton dans le message`, async () => {
          const avant = fake.requests.length;
          const out = await appeler(client, route, jeton);
          const err = attendreEchec(out, kind);
          expect(err.httpStatus).toBe(http);
          expect(err.message).not.toContain(jeton);
          expect(err.message.length).toBeGreaterThan(10);
          // Aucun réessai : une requête reçue par appel, quelle que soit l'issue.
          expect(fake.requests.length - avant).toBe(1);
          if (kind === 'business') {
            expect(err.dgiErrorCode).toBe('FAKE-1');
            expect(err.dgiErrorDesc).toBe('Erreur métier simulée (faux serveur)');
          }
        });
      }

      it('serveur injoignable → network', async () => {
        const mort = new EdefClient(
          { ...config, baseUrl: { test: 'http://127.0.0.1:1', production: 'http://127.0.0.1:1' } },
          new MemoryEdefExchangeJournal(),
        );
        attendreEchec(await appeler(mort, route, JETONS.ok), 'network');
      });

      it('production fermée → production_disabled, AUCUNE requête, aucun journal', async () => {
        const avantRequetes = fake.requests.length;
        const avantJournal = journal.entries.length;
        const err = attendreEchec(
          await appeler(client, route, JETONS.ok, 'production'),
          'production_disabled',
        );
        expect(err.httpStatus).toBeNull();
        expect(fake.requests.length).toBe(avantRequetes);
        expect(journal.entries.length).toBe(avantJournal);
      });
    });
  }

  // ── Validation des réponses ─────────────────────────────────────────────────

  describe('validation des réponses', () => {
    it('POST avec errorCode (uid nul) → business, code et libellé DGI, rien créé', async () => {
      const rn = scenario(nouveauRn(), 'post_business_error:9');
      const err = attendreEchec(await client.submitInvoice(corps(rn), ctx(rn)), 'business');
      expect(err.dgiErrorCode).toBe('9');
      expect(err.dgiErrorDesc).toBe('Refus simulé (faux serveur).');
      expect(err.message).toContain('9');
      expect(fake.invoicesByRn(rn)).toEqual([]);
    });

    it('POST sans uid ni errorCode → invalid_response', async () => {
      const rn = scenario(nouveauRn(), 'post_without_uid');
      attendreEchec(await client.submitInvoice(corps(rn), ctx(rn)), 'invalid_response');
    });

    it('POST illisible (demande pourtant créée) → invalid_response', async () => {
      const rn = scenario(nouveauRn(), 'post_malformed');
      attendreEchec(await client.submitInvoice(corps(rn), ctx(rn)), 'invalid_response');
      expect(fake.invoicesByRn(rn).map((r) => r.status)).toEqual(['pending']);
    });

    it('confirm « réussi » sans codeDEFDGI → invalid_response, JAMAIS une normalisation', async () => {
      const rn = scenario(nouveauRn(), 'confirm_without_code');
      const uid = await soumettre(rn);
      attendreEchec(
        await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn)),
        'invalid_response',
      );
    });

    it('pending_full → business 1', async () => {
      const rn = scenario(nouveauRn(), 'pending_full');
      const err = attendreEchec(await client.submitInvoice(corps(rn), ctx(rn)), 'business');
      expect(err.dgiErrorCode).toBe('1');
    });

    it('duplicate_pending → business 63, l’uid existant dans le libellé, demande fantôme créée', async () => {
      const rn = scenario(nouveauRn(), 'duplicate_pending');
      const err = attendreEchec(await client.submitInvoice(corps(rn), ctx(rn)), 'business');
      expect(err.dgiErrorCode).toBe('63');
      const [fantome] = fake.invoicesByRn(rn);
      expect(fantome).toMatchObject({ status: 'pending', phantom: true });
      expect(err.dgiErrorDesc).toContain(fantome!.uid);
    });

    it('même rn encore en attente → business 63 avec l’uid de la première demande', async () => {
      const rn = nouveauRn();
      const uid = await soumettre(rn);
      const err = attendreEchec(await client.submitInvoice(corps(rn), ctx(rn)), 'business');
      expect(err.dgiErrorCode).toBe('63');
      expect(err.dgiErrorDesc).toContain(uid);
      expect(fake.invoicesByRn(rn)).toHaveLength(1);
    });

    it('totals_offset : la réponse brute porte l’écart, le moteur le nomme', async () => {
      const rn = scenario(nouveauRn(), 'totals_offset:vab');
      const out = await client.submitInvoice(corps(rn), ctx(rn));
      if (!out.ok) throw new Error(out.error.message);
      expect(out.data.raw['vab']).toBe(32.01);
      const ours = computeInvoiceTotals({
        priceMode: 'ttc',
        lines: [
          { unitPrice: '116', quantity: '2', taxGroup: 'B', itemType: 'BIE', specificTax: null },
        ],
        rates: { B: '16' },
      });
      if (!ours.ok) throw new Error('calcul');
      const cmp = compareWithEdefResponse(ours.totals, { B: '16' }, out.data.raw);
      expect(cmp.differences).toEqual([{ field: 'vab', ours: '32.00', dgi: '32.01' }]);
    });

    it('confirm avec un total différent de celui retenu → business 50 ; TVA → 51', async () => {
      const rn1 = scenario(nouveauRn(), 'totals_offset:total');
      const uid1 = await soumettre(rn1);
      const e50 = attendreEchec(
        await client.confirmInvoice(uid1, { total: 232, vtotal: 32 }, ctx(rn1)),
        'business',
      );
      expect(e50.dgiErrorCode).toBe('50');

      const rn2 = scenario(nouveauRn(), 'totals_offset:vtotal');
      const uid2 = await soumettre(rn2);
      const e51 = attendreEchec(
        await client.confirmInvoice(uid2, { total: 232, vtotal: 32 }, ctx(rn2)),
        'business',
      );
      expect(e51.dgiErrorCode).toBe('51');
      expect(fake.invoiceByUid(uid2)!.status).toBe('pending');
    });

    it('confirm_error:<code> → business avec ce code ; le 2e confirm aboutit', async () => {
      const rn = scenario(nouveauRn(), 'confirm_error:99');
      const uid = await soumettre(rn);
      const err = attendreEchec(
        await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn)),
        'business',
      );
      expect(err.dgiErrorCode).toBe('99');
      const second = await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn));
      expect(second.ok).toBe(true);
    });

    it('confirm d’une demande déjà finalisée → business 20 (ambigu)', async () => {
      const rn = nouveauRn();
      const uid = await soumettre(rn);
      await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn));
      const err = attendreEchec(
        await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn)),
        'business',
      );
      expect(err.dgiErrorCode).toBe('20');
      const annul = attendreEchec(await client.cancelInvoice(uid, ctx(rn)), 'business');
      expect(annul.dgiErrorCode).toBe('20');
    });

    it('server_error (scénario par rn) → server sur le POST', async () => {
      const rn = scenario(nouveauRn(), 'server_error');
      attendreEchec(await client.submitInvoice(corps(rn), ctx(rn)), 'server');
    });
  });

  // ── Coupures ────────────────────────────────────────────────────────────────

  describe('coupures (le client attend son délai, ne rejoue rien)', () => {
    it('post_timeout_before_create → timeout, rien à la DGI', async () => {
      const rn = scenario(nouveauRn(), 'post_timeout_before_create');
      attendreEchec(await client.submitInvoice(corps(rn), ctx(rn)), 'timeout');
      expect(fake.invoicesByRn(rn)).toEqual([]);
      expect(fake.callsTo('submit').filter((r) => r.body?.includes(rn))).toHaveLength(1);
    });

    it('post_timeout_after_create → timeout ; la demande se retrouve par la liste et le détail', async () => {
      const rn = scenario(nouveauRn(), 'post_timeout_after_create');
      attendreEchec(await client.submitInvoice(corps(rn), ctx(rn)), 'timeout');
      const [creee] = fake.invoicesByRn(rn);
      expect(creee?.status).toBe('pending');
      const liste = await client.getPendingRequests(lecture());
      expect(liste.ok && liste.data.list.map((p) => p.uid)).toContain(creee!.uid);
      const detail = await client.getInvoiceDetails(creee!.uid, lecture());
      expect(detail.ok && detail.data.rn).toBe(rn);
      // L'annulation solde la demande : rien n'est normalisé.
      expect((await client.cancelInvoice(creee!.uid, ctx(rn))).ok).toBe(true);
      expect(fake.callsTo('submit').filter((r) => r.body?.includes(rn))).toHaveLength(1);
    });

    it('confirm_timeout_after_finalize → timeout ; le détail montre les éléments ; un 2e confirm → 20', async () => {
      const rn = scenario(nouveauRn(), 'confirm_timeout_after_finalize');
      const uid = await soumettre(rn);
      attendreEchec(
        await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn)),
        'timeout',
      );
      expect(fake.invoiceByUid(uid)!.status).toBe('confirmed');
      const detail = await client.getInvoiceDetails(uid, lecture());
      expect(detail.ok && detail.data.security?.codeDefDgi).toBe(
        fake.invoiceByUid(uid)!.security!.codeDEFDGI,
      );
      const err = attendreEchec(
        await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn)),
        'business',
      );
      expect(err.dgiErrorCode).toBe('20');
    });

    it('confirm_timeout_before_finalize → timeout ; encore en attente ; un 2e confirm sur le même uid aboutit', async () => {
      const rn = scenario(nouveauRn(), 'confirm_timeout_before_finalize');
      const uid = await soumettre(rn);
      attendreEchec(
        await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn)),
        'timeout',
      );
      const liste = await client.getPendingRequests(lecture());
      expect(liste.ok && liste.data.list.map((p) => p.uid)).toContain(uid);
      const detail = await client.getInvoiceDetails(uid, lecture());
      expect(detail.ok && detail.data.security).toBeNull();
      const second = await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn));
      expect(second.ok).toBe(true);
      expect(fake.invoiceByUid(uid)).toMatchObject({ status: 'confirmed', confirmCalls: 2 });
    });

    it('confirm_timeout_after_finalize + details_without_security : la DGI ne permet pas de conclure', async () => {
      const rn = scenario(nouveauRn(), [
        'confirm_timeout_after_finalize',
        'details_without_security',
      ]);
      const uid = await soumettre(rn);
      attendreEchec(
        await client.confirmInvoice(uid, { total: 232, vtotal: 32 }, ctx(rn)),
        'timeout',
      );
      const detail = await client.getInvoiceDetails(uid, lecture());
      expect(detail.ok && detail.data.security).toBeNull();
      expect(fake.invoiceByUid(uid)!.status).toBe('confirmed');
    });

    it('cancel_timeout → timeout ; la demande reste en attente ; un 2e cancel aboutit', async () => {
      const rn = scenario(nouveauRn(), 'cancel_timeout');
      const uid = await soumettre(rn);
      attendreEchec(await client.cancelInvoice(uid, ctx(rn)), 'timeout');
      expect(fake.invoiceByUid(uid)!.status).toBe('pending');
      expect((await client.cancelInvoice(uid, ctx(rn))).ok).toBe(true);
      expect(fake.invoiceByUid(uid)!.status).toBe('cancelled');
    });
  });

  // ── Journal `edef_exchanges` v2 ─────────────────────────────────────────────

  describe('journal v2', () => {
    it('POST : entrée request écrite AVANT l’envoi, puis response liée par exchangeId', async () => {
      const rn = nouveauRn();
      let recuesAuMomentDeLEcriture = -1;
      const avant = fake.requests.length;
      journal.onStrict = () => {
        recuesAuMomentDeLEcriture = fake.requests.length;
      };
      const debut = journal.entries.length;
      const out = await client.submitInvoice(corps(rn), ctx(rn));
      journal.onStrict = null;
      expect(recuesAuMomentDeLEcriture).toBe(avant);

      const [req, rep, ...reste] = journal.entries.slice(debut);
      expect(reste).toEqual([]);
      expect(req).toMatchObject({
        entry: 'request',
        method: 'POST',
        path: '/api/invoice',
        invoiceId: `facture-${rn}`,
        rn,
        uid: null,
        organizationId: 'org-1',
        pointOfSaleId: 'pdv-1',
        environment: 'test',
        httpStatus: null,
        durationMs: null,
        outcome: null,
        requestBody: JSON.stringify(corps(rn)),
        responseBody: null,
      });
      expect(rep).toMatchObject({
        entry: 'response',
        exchangeId: req!.exchangeId,
        invoiceId: `facture-${rn}`,
        rn,
        uid: out.ok ? out.data.uid : 'x',
        httpStatus: 200,
        outcome: 'ok',
        requestBody: null,
      });
      expect(rep!.durationMs).toBeGreaterThanOrEqual(0);
      expect(rep!.responseBody).toContain(out.ok ? out.data.uid : 'x');
    });

    it('confirm et cancel : deux entrées liées, uid connu dès la requête ; échec métier journalisé', async () => {
      const rn = nouveauRn();
      const uid = await soumettre(rn);
      const debut = journal.entries.length;
      await client.confirmInvoice(uid, { total: 1, vtotal: 0 }, ctx(rn)); // → 50
      await client.cancelInvoice(uid, ctx(rn));
      const nouvelles = journal.entries.slice(debut);
      expect(nouvelles.map((e) => [e.entry, e.method, e.outcome, e.dgiErrorCode])).toEqual([
        ['request', 'PUT', null, null],
        ['response', 'PUT', 'business', '50'],
        ['request', 'PUT', null, null],
        ['response', 'PUT', 'ok', null],
      ]);
      expect(nouvelles[0]!.exchangeId).toBe(nouvelles[1]!.exchangeId);
      expect(nouvelles[2]!.exchangeId).toBe(nouvelles[3]!.exchangeId);
      expect(nouvelles[0]!.exchangeId).not.toBe(nouvelles[2]!.exchangeId);
      for (const e of nouvelles) expect(e.uid).toBe(uid);
      expect(nouvelles[0]!.requestBody).toBe(JSON.stringify({ total: 1, vtotal: 0 }));
      expect(nouvelles[2]!.requestBody).toBeNull();
    });

    it('lectures : une seule entrée complete, sans document', async () => {
      const debut = journal.entries.length;
      await client.getPendingRequests(lecture());
      const [e, ...reste] = journal.entries.slice(debut);
      expect(reste).toEqual([]);
      expect(e).toMatchObject({ entry: 'complete', method: 'GET', invoiceId: null, rn: null });
    });

    it('délai dépassé : la réponse est quand même journalisée (timeout, sans statut)', async () => {
      const rn = scenario(nouveauRn(), 'post_timeout_before_create');
      const debut = journal.entries.length;
      await client.submitInvoice(corps(rn), ctx(rn));
      const [req, rep] = journal.entries.slice(debut);
      expect(req!.entry).toBe('request');
      expect(rep).toMatchObject({ entry: 'response', outcome: 'timeout', httpStatus: null });
    });

    for (const route of ['submit', 'confirm', 'cancel'] as const) {
      it(`${route} : panne de l’écriture stricte → EdefJournalWriteError, AUCUNE requête reçue`, async () => {
        const avant = fake.requests.length;
        const avantJournal = journal.entries.length;
        journal.failStrict = true;
        try {
          await expect(appeler(client, route, JETONS.ok)).rejects.toBeInstanceOf(
            EdefJournalWriteError,
          );
        } finally {
          journal.failStrict = false;
        }
        expect(fake.requests.length).toBe(avant);
        expect(journal.entries.length).toBe(avantJournal);
      });
    }

    it('lectures : la panne de l’écriture stricte ne les concerne pas', async () => {
      journal.failStrict = true;
      try {
        expect((await client.getPendingRequests(lecture())).ok).toBe(true);
      } finally {
        journal.failStrict = false;
      }
    });

    it('aucun jeton ni en-tête dans AUCUNE entrée du journal', () => {
      expect(journal.entries.length).toBeGreaterThan(40);
      const corpus = JSON.stringify(journal.entries);
      for (const jeton of TOUS_LES_JETONS) expect(corpus).not.toContain(jeton);
      expect(corpus).not.toMatch(/Bearer/);
      expect(corpus).not.toMatch(/authorization/i);
      for (const e of journal.entries) expect(Object.keys(e)).not.toContain('headers');
    });
  });

  // ── Erreurs de programmation ────────────────────────────────────────────────

  describe('erreurs de programmation : le client lève, rien ne part', () => {
    async function sansRequete(f: () => unknown): Promise<void> {
      const avant = fake.requests.length;
      const avantJournal = journal.entries.length;
      expect(f).toThrow();
      expect(fake.requests.length).toBe(avant);
      expect(journal.entries.length).toBe(avantJournal);
    }

    it('corps non conforme (champ inconnu, montant non fini, null au lieu d’omettre)', async () => {
      const rn = nouveauRn();
      await sansRequete(() =>
        client.submitInvoice(
          { ...corps(rn), inconnu: 1 } as unknown as EdefInvoiceRequest,
          ctx(rn),
        ),
      );
      await sansRequete(() =>
        client.submitInvoice(
          corps(rn, {
            items: [
              { code: null, name: 'x', type: 'BIE', price: Number.NaN, quantity: 1, taxGroup: 'B' },
            ],
          }),
          ctx(rn),
        ),
      );
      await sansRequete(() =>
        client.submitInvoice(
          { ...corps(rn), cmta: null } as unknown as EdefInvoiceRequest,
          ctx(rn),
        ),
      );
    });

    it('rn du corps ≠ rn du contexte', async () => {
      await sansRequete(() => client.submitInvoice(corps(nouveauRn()), ctx(nouveauRn())));
    });

    it('uid vide, montant négatif ou non fini, contexte sans document', async () => {
      const rn = nouveauRn();
      await sansRequete(() => client.confirmInvoice('', { total: 1, vtotal: 0 }, ctx(rn)));
      await sansRequete(() => client.confirmInvoice('u', { total: -1, vtotal: 0 }, ctx(rn)));
      await sansRequete(() =>
        client.confirmInvoice('u', { total: 1, vtotal: Number.POSITIVE_INFINITY }, ctx(rn)),
      );
      await sansRequete(() => client.cancelInvoice(' ', ctx(rn)));
      await sansRequete(() => client.getInvoiceDetails('', lecture()));
      await sansRequete(() => client.cancelInvoice('u', { ...ctx(rn), invoiceId: '' }));
    });
  });

  // ── Débit ───────────────────────────────────────────────────────────────────

  it(
    `au plus ${EDEF_MAX_CONCURRENT_CALLS} appels DGI simultanés par client`,
    async () => {
      const avant = fake.requests.length;
      const appels = Array.from({ length: EDEF_MAX_CONCURRENT_CALLS + 2 }, () =>
        client.getStatus(lecture(JETONS.slow)),
      );
      // Les quatre premiers sont partis ; les deux autres attendent une place,
      // qui ne se libère qu'au délai du client (le serveur lent ne répond pas avant).
      await new Promise((r) => setTimeout(r, TIMEOUT_MS / 2));
      expect(fake.requests.length - avant).toBe(EDEF_MAX_CONCURRENT_CALLS);
      const resultats = await Promise.all(appels);
      expect(resultats.every((r) => !r.ok && r.error.kind === 'timeout')).toBe(true);
      expect(fake.requests.length - avant).toBe(EDEF_MAX_CONCURRENT_CALLS + 2);
    },
    TIMEOUT_MS * 4,
  );
});
