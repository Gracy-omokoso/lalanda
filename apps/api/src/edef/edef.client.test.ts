// Client e-MCF contre le faux serveur — ADR-0021 §6 et §13 (« Client »).
//
// Aucun appel à la DGI réelle : le faux serveur écoute sur 127.0.0.1, port
// éphémère. Le journal des échanges est une doublure en mémoire : ce fichier
// vérifie CE QUI est journalisé, la suite e2e vérifie qu'il atterrit en base.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Secret } from '../integrations/secret-value.js';
import type { DgiPlatformConfig } from '../platform-config/dgi-platform.config.js';
import { EdefExchangeJournal, type EdefExchangeEntry } from './edef-exchange.journal.js';
import { EdefClient } from './edef.client.js';
import type { EdefCallContext, EdefFailureKind } from './edef.types.js';
import { startFakeEdefServer, type FakeEdefServer } from './testing/fake-edef-server.js';

const FUTUR = '2027-01-31T00:00:00';
const JETONS = {
  ok: 'jeton-ok-0123456789abcdefXYZ',
  unauthorized: 'jeton-refuse-0123456789abcdef',
  server: 'jeton-500-0123456789abcdefgh',
  slow: 'jeton-lent-0123456789abcdefgh',
  malformed: 'jeton-casse-0123456789abcdef',
  business: 'jeton-metier-0123456789abcde',
  oversized: 'jeton-enorme-0123456789abcde',
};

class MemoryJournal extends EdefExchangeJournal {
  entries: EdefExchangeEntry[] = [];
  async append(entry: EdefExchangeEntry): Promise<void> {
    this.entries.push(entry);
  }
}

describe('EdefClient', () => {
  let fake: FakeEdefServer;
  let journal: MemoryJournal;
  let client: EdefClient;
  let config: DgiPlatformConfig;

  const profil = { nif: 'A0000000X', nim: 'XX01000001-1', tokenValid: FUTUR };

  beforeAll(async () => {
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
      slowMs: 2_000,
    });
    config = {
      baseUrl: { test: fake.baseUrl, production: fake.baseUrl },
      isf: { test: null, production: null },
      productionEnabled: false,
      // Délai court : la validation à 10 s minimum porte sur l'environnement, ce
      // test construit la configuration à la main pour rester rapide.
      httpTimeoutMs: 300,
    };
    journal = new MemoryJournal();
    client = new EdefClient(config, journal);
  });

  afterAll(async () => {
    await fake.close();
  });

  function ctx(token: string, environment: 'test' | 'production' = 'test'): EdefCallContext {
    return { environment, token: new Secret(token), organizationId: 'org-1', pointOfSaleId: null };
  }

  it('lit le statut et envoie le jeton en Bearer', async () => {
    const out = await client.getStatus(ctx(JETONS.ok));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data).toMatchObject({ status: true, nif: 'A0000000X', nim: 'XX01000001-1' });
    expect(out.data.emcfList[0]?.status).toBe('Actif');
    const recue = fake.requests.at(-1)!;
    expect(recue.path).toBe('/api/info/status');
    expect(recue.authorization).toBe(`Bearer ${JETONS.ok}`);
  });

  const cas: Array<[string, string, EdefFailureKind, number | null]> = [
    ['401', JETONS.unauthorized, 'unauthorized', 401],
    ['5xx', JETONS.server, 'server', 500],
    ['délai dépassé', JETONS.slow, 'timeout', null],
    ['JSON illisible', JETONS.malformed, 'invalid_response', 200],
    ['erreur métier', JETONS.business, 'business', 200],
    ['réponse > 1 Mio', JETONS.oversized, 'invalid_response', 200],
    ['jeton inconnu', 'jeton-inconnu-0123456789abcd', 'unauthorized', 401],
  ];
  for (const [libelle, jeton, kind, http] of cas) {
    it(`${libelle} → ${kind}, sans lever, sans jeton dans le message`, async () => {
      const out = await client.getStatus(ctx(jeton));
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error.kind).toBe(kind);
      expect(out.error.httpStatus).toBe(http);
      expect(out.error.message).not.toContain(jeton);
      expect(out.error.message.length).toBeGreaterThan(10);
    });
  }

  it('erreur métier : le code DGI est remonté', async () => {
    const out = await client.getStatus(ctx(JETONS.business));
    expect(!out.ok && out.error.dgiErrorCode).toBe('FAKE-1');
  });

  it('délai dépassé : rend la main en moins du délai + 1 s', async () => {
    const debut = Date.now();
    await client.getStatus(ctx(JETONS.slow));
    expect(Date.now() - debut).toBeLessThan(config.httpTimeoutMs + 1_000);
  });

  it('serveur injoignable → network', async () => {
    const mort = new EdefClient(
      { ...config, baseUrl: { test: 'http://127.0.0.1:1', production: 'http://127.0.0.1:1' } },
      journal,
    );
    const out = await mort.getStatus(ctx(JETONS.ok));
    expect(!out.ok && out.error.kind).toBe('network');
  });

  it('production fermée → production_disabled, AUCUNE requête, aucun journal', async () => {
    const avantRequetes = fake.requests.length;
    const avantJournal = journal.entries.length;
    const out = await client.getStatus(ctx(JETONS.ok, 'production'));
    expect(!out.ok && out.error.kind).toBe('production_disabled');
    expect(fake.requests.length).toBe(avantRequetes);
    expect(journal.entries.length).toBe(avantJournal);
  });

  it('un journal par appel réel, sans en-tête ni jeton', async () => {
    const avant = journal.entries.length;
    await client.getStatus(ctx(JETONS.ok));
    await client.getStatus(ctx(JETONS.unauthorized));
    const nouveaux = journal.entries.slice(avant);
    expect(nouveaux).toHaveLength(2);
    expect(nouveaux.map((e) => e.outcome)).toEqual(['ok', 'unauthorized']);
    for (const e of nouveaux) {
      expect(e.method).toBe('GET');
      expect(e.requestBody).toBeNull();
      expect(Object.keys(e)).not.toContain('headers');
      expect(JSON.stringify(e)).not.toContain(JETONS.ok);
      expect(JSON.stringify(e)).not.toContain(JETONS.unauthorized);
      expect(JSON.stringify(e)).not.toMatch(/Bearer/);
    }
  });

  it('taxGroups : valeurs entières et décimales acceptées, clés hors lettre ignorées', async () => {
    fake.setTaxGroups({ a: 0, b: 16, c: 5.5, o: 1, extra_field: 3 } as Record<string, number>);
    const out = await client.getReferenceList('taxGroups', ctx(JETONS.ok));
    expect(out.ok && out.data).toEqual({ a: 0, b: 16, c: 5.5, o: 1 });
  });

  it('taxGroups : une valeur non numérique rend la réponse non conforme', async () => {
    fake.setTaxGroups({ b: 'seize' } as unknown as Record<string, number>);
    const out = await client.getReferenceList('taxGroups', ctx(JETONS.ok));
    expect(!out.ok && out.error.kind).toBe('invalid_response');
    fake.setTaxGroups({ a: 0, b: 16, c: 5, o: 1 });
  });

  it('lit les six autres listes', async () => {
    for (const list of [
      'invoiceTypes',
      'paymentTypes',
      'clientTypes',
      'referenceTypes',
      'itemTypes',
      'currencyRates',
    ] as const) {
      const out = await client.getReferenceList(list, ctx(JETONS.ok));
      expect(out.ok, list).toBe(true);
      expect(fake.requests.at(-1)!.path).toBe(`/api/info/${list}`);
    }
  });
});
