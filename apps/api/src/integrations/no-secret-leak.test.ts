// ─────────────────────────────────────────────────────────────────────────────
// TEST ANTI-FUITE — ADR-0013 §4 (troisième barrière) et § Plan de validation
//
// « Un test qui sérialise un document complet et échoue si la chaîne produite
//   contient l'une des valeurs en clair ou l'un des noms de champ interdits.
//   Test étendu aux corps d'erreur des cinq routes. »
//
// C'est le test le plus important du lot, et sa valeur tient à une propriété
// simple : il ne vérifie pas que le code FAIT quelque chose, il vérifie qu'une
// chaîne de caractères précise n'apparaît NULLE PART dans ce que l'API produit.
// Il est donc indifférent à la manière dont la fuite arriverait — un `...doc`
// ajouté dans un contrôleur, un champ ajouté au schéma, un message d'erreur Zod
// qui recopie la valeur reçue, une trace de pile sérialisée, un `lastTest.detail`
// dans lequel le fournisseur a renvoyé la clé. Les trois barrières d'ADR-0013 §4
// sont des mécanismes; ce test est la propriété qu'elles servent.
//
// ── Ce qui est balayé ─────────────────────────────────────────────────────────
//
//   - les 5 routes d'`IntegrationsController`, en succès;
//   - leurs corps d'ERREUR : fournisseur inconnu (400), clé hors liste blanche
//     (400), corps invalide (400), test de connexion en échec (422);
//   - `POST /admin/reauth`, dont le corps porte un mot de passe;
//   - le document Mongoose lui-même via `JSON.stringify` (barrière n°2);
//   - les entrées d'audit (ADR-0013 §6 : « Jamais la valeur »).
//
// ── Pourquoi ce test ne peut pas devenir vert pour la mauvaise raison ─────────
//
// Trois gardes, parce qu'un test anti-fuite qui ne sérialise rien passe :
//   1. `le détecteur détecte` — on lui soumet une charge délibérément fuyante et
//      on exige qu'il échoue;
//   2. `la campagne a réellement balayé des charges` — le compteur de charges
//      inspectées est asserté non trivial;
//   3. `last4 est bien présent` — preuve que les vues renvoyées ne sont pas
//      vides, ce qui rendrait l'absence de secret triviale.
//
// AUCUNE VRAIE CLÉ ICI. Les valeurs sont des littéraux inventés, préfixés
// `ANTIFUITE_`, et la clé maîtresse est tirée aléatoirement à l'exécution.
// ─────────────────────────────────────────────────────────────────────────────

import 'reflect-metadata';

import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import mongoose, { type Model } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  ConnectionTester,
  ConnectionTestInput,
  ConnectionTestResult,
} from './connection-tests.js';
import {
  FORBIDDEN_OUTPUT_FIELDS,
  IntegrationSchema,
  type IntegrationDocument,
} from './integration.schema.js';
import { IntegrationsController, ReauthController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import type { PlatformAuditInput, PlatformAuditService } from './platform-audit.service.js';
import { INTEGRATION_PROVIDERS, PROVIDER_SPECS, type IntegrationProvider } from './providers.js';
import type { ReauthService } from './reauth.service.js';
import { MasterKeyring } from './secrets-crypto.js';
import { SecretsService } from './secrets.service.js';

// ── Valeurs sentinelles ──────────────────────────────────────────────────────

/**
 * Un secret par fournisseur, inventé, long (≥ 12 caractères pour que `last4`
 * existe) et sans sous-chaîne commune avec les autres — sans quoi un test vert
 * pourrait masquer la fuite d'un fournisseur détectée sur un autre.
 */
const SECRETS_SENTINELLES: Record<IntegrationProvider, Record<string, string>> = {
  openai: { apiKey: 'ANTIFUITE-openai-3f7a91c4d2e8' },
  stripe: {
    restrictedKey: 'ANTIFUITE-stripe-rk-8b1e50a9c7d3',
    webhookSecret: 'ANTIFUITE-stripe-whsec-4d6f2a8e1b95',
  },
  paypal: { clientSecret: 'ANTIFUITE-paypal-0c5d93b7e421' },
  smtp: { password: 'ANTIFUITE-smtp-6e2b47f0a8d1' },
  // `r2` et non `s3` : la clé DOIT être celle d'`INTEGRATION_PROVIDERS`. Une clé
  // périmée ne produit aucune erreur visible ici — `SECRETS_SENTINELLES[provider]`
  // vaut alors `undefined`, `amorcerLeParc` enregistre le fournisseur SANS secret,
  // et la campagne anti-fuite le traverse sans rien avoir à trouver. Le test reste
  // vert en ne testant plus rien : c'est le mode de panne à surveiller dans ce
  // fichier.
  r2: { secretKey: 'ANTIFUITE-r2-9a4c81d5f37b' },
  elevenlabs: { apiKey: 'ANTIFUITE-elevenlabs-2b7e40f1a6c8' },
  zeptomail: { sendMailToken: 'ANTIFUITE-zeptomail-7d3f62a0c94e' },
};

/** `config` valide au regard de la liste blanche de chaque fournisseur. */
const CONFIG_SENTINELLE: Record<IntegrationProvider, Record<string, string | number | boolean>> = {
  openai: { modelLite: 'gpt-4o-mini' },
  stripe: { publishableKey: 'pk_test_visible_par_conception' },
  paypal: { clientId: 'client-id-public', environment: 'sandbox' },
  smtp: { host: 'smtp.exemple.test', port: 587, user: 'expediteur@exemple.test' },
  r2: { endpoint: 'https://exemple.test', bucketExports: 'exports' },
  elevenlabs: { baseUrl: 'https://exemple.test' },
  // ZeptoMail ne déclare qu'`apiUrl` (ADR-0014) : le centre de données Zoho.
  // Rien d'autre n'est non secret dans cette fiche.
  zeptomail: { apiUrl: 'https://api.zeptomail.exemple.test/v1.1/email' },
};

/** Toutes les valeurs en clair du parc — la liste que rien ne doit contenir. */
const TOUS_LES_SECRETS: string[] = Object.values(SECRETS_SENTINELLES).flatMap((s) =>
  Object.values(s),
);

/** Mot de passe soumis à `POST /admin/reauth` — un secret comme un autre. */
const MOT_DE_PASSE = 'ANTIFUITE-motdepasse-2c7e10b46f89';

// ── Détecteur ────────────────────────────────────────────────────────────────

/**
 * Sérialisation TOTALE d'une charge, y compris les formes que `JSON.stringify`
 * laisse tomber.
 *
 * `JSON.stringify` d'une `Error` renvoie `{}` : s'arrêter là déclarerait propre
 * tout corps d'erreur, c'est-à-dire précisément la moitié du périmètre que
 * l'ADR demande de couvrir. On concatène donc `inspect()` (qui énumère les
 * champs non énumérables et suit les prototypes) au JSON.
 */
function serialiserCompletement(payload: unknown): string {
  const morceaux: string[] = [];
  try {
    morceaux.push(JSON.stringify(payload) ?? 'undefined');
  } catch {
    morceaux.push('[non sérialisable en JSON]');
  }
  morceaux.push(inspect(payload, { depth: 12, showHidden: true, getters: true }));
  if (payload instanceof Error) {
    morceaux.push(payload.message, payload.stack ?? '', String(payload));
    const cause = (payload as Error & { cause?: unknown }).cause;
    if (cause !== undefined) morceaux.push(inspect(cause, { depth: 6 }));
    const reponse = (payload as { getResponse?: () => unknown }).getResponse;
    if (typeof reponse === 'function') {
      morceaux.push(inspect(reponse.call(payload), { depth: 12 }));
    }
  }
  return morceaux.join('\n');
}

interface Fuite {
  genre: 'valeur en clair' | 'champ interdit';
  detail: string;
}

/** Cherche les fuites d'une charge. Retourne la liste — vide si tout va bien. */
function fuitesDe(payload: unknown, secrets: readonly string[]): Fuite[] {
  const texte = serialiserCompletement(payload);
  const fuites: Fuite[] = [];
  for (const secret of secrets) {
    if (texte.includes(secret)) fuites.push({ genre: 'valeur en clair', detail: secret });
  }
  for (const champ of FORBIDDEN_OUTPUT_FIELDS) {
    // Forme de CLÉ (`"iv":`, `iv:`) et non simple sous-chaîne : « salt » et « iv »
    // apparaissent dans des mots français ordinaires, et un détecteur qui
    // rougirait sur « privé » finirait par être désactivé.
    if (new RegExp(`["']?\\b${champ}\\b["']?\\s*:`).test(texte)) {
      fuites.push({ genre: 'champ interdit', detail: champ });
    }
  }
  return fuites;
}

/** Charges inspectées — sert la garde « la campagne n'a pas tourné à vide ». */
let chargesInspectees = 0;

function exigerAucuneFuite(label: string, payload: unknown): void {
  chargesInspectees += 1;
  const fuites = fuitesDe(payload, TOUS_LES_SECRETS);
  expect(
    fuites,
    `FUITE DE SECRET — ${label}\n` +
      fuites.map((f) => `  · ${f.genre} : ${f.detail}`).join('\n') +
      '\n\nADR-0013 §4 : aucune route ne renvoie de valeur déchiffrée, et ' +
      'ciphertext/iv/salt/authTag/keyId ne sortent jamais.',
  ).toEqual([]);
}

// ── Doublures ────────────────────────────────────────────────────────────────

/**
 * Modèle Mongoose en mémoire.
 *
 * Le schéma est le VRAI (`IntegrationSchema`) : c'est indispensable, puisque la
 * deuxième barrière anti-fuite est la transformation `toJSON` qu'il porte. Un
 * faux document littéral testerait le test et non le code.
 */
// Compilé UNE fois : `mongoose.model()` refuse d'enregistrer deux fois le même
// nom, et le contexte est remonté à chaque test.
const ModeleBase = mongoose.model<IntegrationDocument>('IntegrationAntiFuite', IntegrationSchema);

function modeleEnMemoire(store: Map<string, IntegrationDocument>): Model<IntegrationDocument> {
  const Base = ModeleBase;

  const Fake = function (init: Record<string, unknown>): IntegrationDocument {
    const doc = new Base(init) as IntegrationDocument;
    brancherSave(doc, store);
    return doc;
  } as unknown as Model<IntegrationDocument>;

  Object.assign(Fake, {
    find: () => ({ exec: async () => [...store.values()] }),
    findOne: (filtre: { provider?: string }) => ({
      exec: async () => store.get(String(filtre.provider)) ?? null,
    }),
  });
  return Fake;
}

function brancherSave(doc: IntegrationDocument, store: Map<string, IntegrationDocument>): void {
  (doc as unknown as { save: () => Promise<unknown> }).save = async () => {
    // `timestamps: true` est posé par Mongo à l'écriture réelle; la doublure doit
    // le faire aussi, sinon `toIntegrationView` lirait un `updatedAt` absent.
    (doc as unknown as Record<string, unknown>)['createdAt'] ??= new Date();
    (doc as unknown as Record<string, unknown>)['updatedAt'] = new Date();
    store.set(doc.provider, doc);
    return doc;
  };
}

/** Testeur de connexion pilotable — le vrai sortirait sur le réseau. */
class TesteurPilotable implements ConnectionTester {
  mode: 'ok' | 'echec' | 'echec-bavard' = 'ok';
  derniereEntree: ConnectionTestInput | null = null;

  async test(input: ConnectionTestInput): Promise<ConnectionTestResult> {
    this.derniereEntree = input;
    if (this.mode === 'ok') {
      return { ok: true, latencyMs: 3, detail: 'compte accessible' };
    }
    if (this.mode === 'echec-bavard') {
      // Le cas réel qu'ADR-0013 §4 vise nommément : « les API renvoient parfois
      // la clé dans le message ». Stripe le fait. Le testeur ne rédige rien ici
      // EXPRÈS — c'est `sanitizeProviderMessage`, côté service, qui doit rattraper.
      const valeurs = Object.values(input.secrets);
      return {
        ok: false,
        latencyMs: 4,
        detail: `Invalid API Key provided: ${valeurs.join(' / ')}`,
      };
    }
    return { ok: false, latencyMs: 4, detail: 'identifiants refusés' };
  }
}

interface Contexte {
  controller: IntegrationsController;
  reauthController: ReauthController;
  service: IntegrationsService;
  store: Map<string, IntegrationDocument>;
  testeur: TesteurPilotable;
  audit: PlatformAuditInput[];
}

const REQUETE = {
  user: { id: 'super-admin-1' },
  ip: '203.0.113.7',
  headers: { cookie: 'session=abc', 'user-agent': 'vitest' },
} as never;

function monterContexte(): Contexte {
  const store = new Map<string, IntegrationDocument>();
  const model = modeleEnMemoire(store);

  // Clé maîtresse tirée à l'exécution : rien de commitable, et deux exécutions
  // ne partagent aucun matériel cryptographique.
  const keyring = MasterKeyring.of([{ keyId: 'k-test', key: randomBytes(32) }], 'k-test');

  const secrets = new SecretsService(model, keyring);

  const audit: PlatformAuditInput[] = [];
  const auditService = {
    record: async (input: PlatformAuditInput) => {
      audit.push(input);
    },
  } as unknown as PlatformAuditService;

  const testeur = new TesteurPilotable();

  // `startSession` refusée : `inTransaction` retombe sur le chemin sans session,
  // exactement comme sur un `mongod` autonome (voir le commentaire du service).
  const connection = {
    startSession: () => Promise.reject(new Error('pas de replica set en test unitaire')),
  } as never;

  const service = new IntegrationsService(
    model,
    connection,
    keyring,
    secrets,
    auditService,
    testeur,
  );

  const reauth = {
    assertRecent: async () => undefined,
    statusOf: async () => ({ active: true, expiresAt: null }),
    confirm: async () => ({ expiresAt: new Date('2030-01-01T00:00:00.000Z') }),
  } as unknown as ReauthService;

  return {
    controller: new IntegrationsController(service, reauth),
    reauthController: new ReauthController(reauth),
    service,
    store,
    testeur,
    audit,
  };
}

// ── Campagne ─────────────────────────────────────────────────────────────────

let ctx: Contexte;
const envSauvegarde: Record<string, string | undefined> = {};

beforeAll(() => {
  // Les variables de secours (ADR-0013 §8) changeraient `source` et `configured`
  // dans la vue. Elles sont neutralisées pour que la campagne soit déterministe,
  // et restaurées ensuite : un test qui laisse l'environnement modifié contamine
  // les fichiers suivants.
  for (const nom of ['OPENAI_API_KEY', 'S3_SECRET_KEY']) {
    envSauvegarde[nom] = process.env[nom];
    delete process.env[nom];
  }
});

afterAll(() => {
  for (const [nom, valeur] of Object.entries(envSauvegarde)) {
    if (valeur === undefined) delete process.env[nom];
    else process.env[nom] = valeur;
  }
});

beforeEach(() => {
  ctx = monterContexte();
});

/** Enregistre les cinq fournisseurs avec leurs secrets sentinelles. */
async function amorcerLeParc(): Promise<void> {
  ctx.testeur.mode = 'ok';
  for (const provider of INTEGRATION_PROVIDERS) {
    await ctx.controller.update(
      REQUETE,
      provider,
      {
        enabled: true,
        config: CONFIG_SENTINELLE[provider],
        secrets: SECRETS_SENTINELLES[provider],
      },
      undefined,
    );
  }
}

describe('le détecteur lui-même', () => {
  it('détecte une valeur en clair (sans quoi toute la campagne serait vaine)', () => {
    const fuyant = { secrets: { apiKey: { value: SECRETS_SENTINELLES.openai['apiKey'] } } };
    expect(fuitesDe(fuyant, TOUS_LES_SECRETS)).toContainEqual({
      genre: 'valeur en clair',
      detail: SECRETS_SENTINELLES.openai['apiKey'],
    });
  });

  it('détecte un champ interdit', () => {
    const fuyant = { secrets: { apiKey: { ciphertext: 'AAAA', iv: 'BBBB' } } };
    const genres = fuitesDe(fuyant, TOUS_LES_SECRETS).map((f) => f.detail);
    expect(genres).toContain('ciphertext');
    expect(genres).toContain('iv');
  });

  it("voit à travers une Error, que JSON.stringify réduit à '{}'", () => {
    const err = new Error(`clé refusée : ${SECRETS_SENTINELLES.smtp['password']}`);
    expect(JSON.stringify(err)).toBe('{}');
    expect(fuitesDe(err, TOUS_LES_SECRETS)).toHaveLength(1);
  });

  it('ne rougit pas sur un texte français contenant « sel » ou « privé »', () => {
    const sain = { message: 'La valeur est salée et privée, iv compris dans la phrase.' };
    expect(fuitesDe(sain, TOUS_LES_SECRETS)).toEqual([]);
  });
});

describe("aucune réponse d'API d'intégration ne contient de secret", () => {
  it('les cinq routes en succès, pour les cinq fournisseurs', async () => {
    await amorcerLeParc();

    exigerAucuneFuite('GET /admin/integrations', await ctx.controller.list());

    for (const provider of INTEGRATION_PROVIDERS) {
      exigerAucuneFuite(
        `GET /admin/integrations/${provider}`,
        await ctx.controller.detail(provider),
      );

      exigerAucuneFuite(
        `POST /admin/integrations/${provider}/test`,
        await ctx.controller.test(REQUETE, provider),
      );

      // Ré-écriture d'un secret : la réponse du PUT est la vue de lecture.
      exigerAucuneFuite(
        `PUT /admin/integrations/${provider}`,
        await ctx.controller.update(
          REQUETE,
          provider,
          { secrets: SECRETS_SENTINELLES[provider] },
          undefined,
        ),
      );

      const nom = PROVIDER_SPECS[provider].secrets[0]!;
      exigerAucuneFuite(
        `DELETE /admin/integrations/${provider}/secrets/${nom}`,
        await ctx.controller.deleteSecret(REQUETE, provider, nom),
      );
    }
  });

  it('les corps d’ERREUR des routes — ADR-0013 § Plan de validation', async () => {
    await amorcerLeParc();

    // 400 — fournisseur inconnu.
    exigerAucuneFuite(
      '400 UNKNOWN_PROVIDER',
      await capturer(() => ctx.controller.detail('fournisseur-inexistant')),
    );

    // 400 — clé hors liste blanche. Le secret est glissé dans `config`, donc
    // présent dans le CORPS DE LA REQUÊTE : c'est le cas où un message d'erreur
    // trop bavard recopierait la valeur reçue.
    exigerAucuneFuite(
      '400 UNKNOWN_FIELD (secret glissé dans config)',
      await capturer(() =>
        ctx.controller.update(
          REQUETE,
          'stripe',
          { config: { cleSecrete: SECRETS_SENTINELLES.stripe['restrictedKey']! } },
          undefined,
        ),
      ),
    );

    // 400 — corps invalide au sens Zod, avec la valeur dans le corps. Zod recopie
    // volontiers la donnée reçue dans ses `issues`; le contrôleur ne renvoie donc
    // que les CHEMINS, jamais `parsed.error` tel quel.
    exigerAucuneFuite(
      '400 VALIDATION_ERROR (valeur dans un champ mal typé)',
      await capturer(() =>
        ctx.controller.update(
          REQUETE,
          'openai',
          { secrets: { apiKey: { valeur: SECRETS_SENTINELLES.openai['apiKey'] } } },
          undefined,
        ),
      ),
    );

    // 422 — test de connexion en échec, le fournisseur renvoyant la clé dans son
    // message. C'est le scénario nommé par ADR-0013 §4.
    ctx.testeur.mode = 'echec-bavard';
    exigerAucuneFuite(
      '422 INTEGRATION_TEST_FAILED (message fournisseur bavard)',
      await capturer(() =>
        ctx.controller.update(
          REQUETE,
          'stripe',
          { secrets: SECRETS_SENTINELLES.stripe },
          undefined,
        ),
      ),
    );

    // 400 — secret inconnu à la suppression.
    exigerAucuneFuite(
      '400 UNKNOWN_FIELD (suppression d’un secret inexistant)',
      await capturer(() => ctx.controller.deleteSecret(REQUETE, 'smtp', 'motDePasse')),
    );
  });

  it("un test en échec bavard n'écrit pas la clé dans lastTest.detail", async () => {
    await amorcerLeParc();
    ctx.testeur.mode = 'echec-bavard';

    // Le test à la demande, lui, PERSISTE `lastTest` (aucun secret n'est écrit).
    // C'est donc le chemin par lequel un message bavard atteindrait la base.
    await ctx.controller.test(REQUETE, 'stripe');
    const vue = await ctx.controller.detail('stripe');

    expect(vue.lastTest?.status).toBe('failed');
    expect(vue.lastTest?.detail).toContain('[redacted]');
    exigerAucuneFuite('lastTest.detail après échec bavard', vue);
    exigerAucuneFuite('document après échec bavard', ctx.store.get('stripe'));
  });

  it('POST /admin/reauth ne renvoie pas le mot de passe soumis', async () => {
    exigerAucuneFuite(
      'POST /admin/reauth',
      await ctx.reauthController.confirm(REQUETE, { password: MOT_DE_PASSE }),
    );
    exigerAucuneFuite(
      'POST /admin/reauth — corps invalide',
      await capturer(() => ctx.reauthController.confirm(REQUETE, { motDePasse: MOT_DE_PASSE })),
    );
  });
});

describe('deuxième barrière — sérialisation du document Mongoose', () => {
  it('JSON.stringify du document ne contient ni valeur ni matériel cryptographique', async () => {
    await amorcerLeParc();

    for (const provider of INTEGRATION_PROVIDERS) {
      const doc = ctx.store.get(provider);
      expect(doc, `document ${provider} absent — l'amorçage n'a pas eu lieu`).toBeDefined();

      // C'est le `return doc` accidentel d'un futur contrôleur qui est simulé ici.
      exigerAucuneFuite(`JSON.stringify(doc ${provider})`, JSON.parse(JSON.stringify(doc)));
      exigerAucuneFuite(`String(doc ${provider})`, String(doc));
    }
  });

  it('la transformation toJSON réduit `secrets` à des booléens', async () => {
    await amorcerLeParc();
    const brut = JSON.parse(JSON.stringify(ctx.store.get('stripe'))) as {
      secrets: Record<string, unknown>;
    };
    expect(brut.secrets).toEqual({ restrictedKey: true, webhookSecret: true });
  });

  it('le document EN BASE porte bien le matériel chiffré (le coffre n’est pas vide)', async () => {
    await amorcerLeParc();
    // Contre-épreuve indispensable : si le document ne contenait rien, l'absence
    // de `ciphertext` dans les sorties ne prouverait rien du tout.
    const doc = ctx.store.get('openai')!;
    const brut = (doc as unknown as { secrets: Record<string, { ciphertext?: string }> }).secrets;
    expect(brut['apiKey']?.ciphertext).toBeTypeOf('string');
    expect(brut['apiKey']?.ciphertext).not.toContain(SECRETS_SENTINELLES.openai['apiKey']);
  });
});

describe("l'audit ne porte jamais la valeur — ADR-0013 §6", () => {
  it('aucune entrée d’audit ne contient de secret', async () => {
    await amorcerLeParc();
    ctx.testeur.mode = 'ok';
    await ctx.controller.deleteSecret(REQUETE, 'smtp', 'password');
    await ctx.controller.test(REQUETE, 'openai');

    expect(ctx.audit.length).toBeGreaterThan(5);
    exigerAucuneFuite("journal d'audit complet", ctx.audit);
  });

  it('last4After est un SUFFIXE de 4 caractères, jamais un préfixe', async () => {
    await amorcerLeParc();
    // `amorcerLeParc` traite les fournisseurs dans l'ordre d'INTEGRATION_PROVIDERS :
    // la première écriture de secret est donc `openai.apiKey`.
    const entree = ctx.audit.find((e) => e.action === 'integration.secret.updated');
    expect(entree).toBeDefined();
    const last4 = String(entree!.metadata?.['last4After']);
    const valeur = SECRETS_SENTINELLES.openai['apiKey']!;

    expect(last4).toHaveLength(4);
    expect(last4).toBe(valeur.slice(-4));
    // ADR-0013 §4 : « Jamais un préfixe » — un préfixe révélerait le mode et le
    // type d'une clé Stripe (`sk_live_` / `rk_test_`).
    expect(valeur.startsWith(last4)).toBe(false);
  });
});

describe('gardes anti-vacuité', () => {
  it('la vue expose bien last4 — les réponses ne sont pas vides', async () => {
    await amorcerLeParc();
    const vue = await ctx.controller.detail('openai');
    const attendu = SECRETS_SENTINELLES.openai['apiKey']!.slice(-4);
    expect(vue.secrets['apiKey']?.configured).toBe(true);
    expect(vue.secrets['apiKey']?.last4).toBe(attendu);
    expect(vue.secrets['apiKey']?.source).toBe('db');
  });

  it('`configFields` ne désigne jamais un secret', async () => {
    // `configFields` est servi pour que `/admin/integrations` puisse proposer un
    // champ de configuration encore vide. Un nom de secret qui s'y glisserait
    // ferait rendre ce secret par l'interface dans un `<input type="text">`,
    // stocké en clair et affiché à l'écran — la fuite ne viendrait pas d'une
    // valeur échappée mais d'un champ MAL CLASSÉ. La disjonction est garantie par
    // `providers.ts`; ce test la vérifie sur la réponse réellement servie.
    for (const provider of INTEGRATION_PROVIDERS) {
      const vue = await ctx.controller.detail(provider);
      const secrets = new Set(PROVIDER_SPECS[provider].secrets);
      for (const cle of vue.configFields) {
        expect(secrets.has(cle)).toBe(false);
      }
      expect(vue.configFields.length).toBeGreaterThan(0);
      expect(vue.requiredConfig.every((c) => vue.configFields.includes(c))).toBe(true);
    }
  });

  it('la campagne a réellement inspecté un nombre substantiel de charges', () => {
    // 5 routes × 5 fournisseurs + erreurs + documents + audit. Un effondrement de
    // ce compteur signalerait des assertions devenues inatteignables.
    expect(chargesInspectees).toBeGreaterThan(30);
  });
});

/**
 * Exécute et retourne l'erreur levée — ou échoue si rien n'est levé.
 *
 * L'échec est prononcé HORS du `catch` : à l'intérieur, `expect.fail` serait
 * lui-même rattrapé et le test passerait au vert en ayant prouvé le contraire de
 * ce qu'il annonce.
 */
async function capturer(fn: () => Promise<unknown>): Promise<unknown> {
  let resultat: unknown;
  try {
    resultat = await fn();
  } catch (err) {
    return err;
  }
  expect.fail(`Aucune erreur levée — la charge a répondu : ${JSON.stringify(resultat)}`);
}
