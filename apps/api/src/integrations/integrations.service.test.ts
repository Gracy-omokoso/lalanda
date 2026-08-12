// ─────────────────────────────────────────────────────────────────────────────
// CONTRAT D'ÉCRITURE SEULE — ADR-0013 §4, §5, §6
//
// Trois propriétés, dans l'ordre où elles cassent en production :
//
//   1. TEST AVANT ÉCRITURE (§5). Un test en échec → 422 et RIEN n'est persisté,
//      pas même `lastTest`. « Une clé invalide n'entre jamais en base — c'est ce
//      qui évite de découvrir la panne au premier paiement client. »
//   2. REMPLACEMENT SEULEMENT (§4). Absent = inchangé, `null` = supprimé,
//      chaîne = remplace. Il n'y a pas de modification partielle.
//   3. AUDIT SANS VALEUR (§6). Une écriture produit ses traces, et elles ne
//      portent que `last4Before` / `last4After`.
//
// Le harnais en mémoire est volontairement recopié ici plutôt que partagé avec
// `no-secret-leak.test.ts` : celui-là instrumente la sérialisation, celui-ci
// instrumente les écritures. Un harnais commun devrait servir les deux et
// finirait par n'éclairer ni l'un ni l'autre.
// ─────────────────────────────────────────────────────────────────────────────

import 'reflect-metadata';

import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import mongoose, { type Model } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  ConnectionTester,
  ConnectionTestInput,
  ConnectionTestResult,
} from './connection-tests.js';
import { IntegrationSchema, type IntegrationDocument } from './integration.schema.js';
import { IntegrationsService, type ActorContext } from './integrations.service.js';
import type { PlatformAuditInput, PlatformAuditService } from './platform-audit.service.js';
import { MasterKeyring } from './secrets-crypto.js';
import { SecretsService } from './secrets.service.js';

const ACTEUR: ActorContext = {
  userId: 'super-admin-1',
  platformRole: 'platform_super_admin',
  ip: '203.0.113.7',
  userAgent: 'vitest',
};

const CLE_VALIDE = 'valeur-valide-4d6f2a8e1b95';
const CLE_REMPLACANTE = 'valeur-remplacante-7c3b19e0';
const CLE_REFUSEE = 'valeur-refusee-0a5d93b7e421';

const ModeleBase = mongoose.model<IntegrationDocument>('IntegrationContrat', IntegrationSchema);

class TesteurPilotable implements ConnectionTester {
  mode: 'ok' | 'echec' = 'ok';
  appels: ConnectionTestInput[] = [];

  async test(input: ConnectionTestInput): Promise<ConnectionTestResult> {
    this.appels.push({ ...input, secrets: { ...input.secrets } });
    return this.mode === 'ok'
      ? { ok: true, latencyMs: 2, detail: 'compte accessible' }
      : { ok: false, latencyMs: 2, detail: 'identifiants refusés' };
  }
}

interface Contexte {
  service: IntegrationsService;
  store: Map<string, IntegrationDocument>;
  testeur: TesteurPilotable;
  audit: PlatformAuditInput[];
}

function monter(): Contexte {
  const store = new Map<string, IntegrationDocument>();

  const model = function (init: Record<string, unknown>): IntegrationDocument {
    const doc = new ModeleBase(init) as IntegrationDocument;
    (doc as unknown as { save: () => Promise<unknown> }).save = async () => {
      (doc as unknown as Record<string, unknown>)['createdAt'] ??= new Date();
      (doc as unknown as Record<string, unknown>)['updatedAt'] = new Date();
      store.set(doc.provider, doc);
      return doc;
    };
    return doc;
  } as unknown as Model<IntegrationDocument>;

  Object.assign(model, {
    find: () => ({ exec: async () => [...store.values()] }),
    findOne: (filtre: { provider?: string }) => ({
      exec: async () => store.get(String(filtre.provider)) ?? null,
    }),
  });

  const keyring = MasterKeyring.of([{ keyId: 'k-test', key: randomBytes(32) }], 'k-test');
  const secrets = new SecretsService(model, keyring);
  const audit: PlatformAuditInput[] = [];
  const testeur = new TesteurPilotable();

  const service = new IntegrationsService(
    model,
    { startSession: () => Promise.reject(new Error('mongod autonome')) } as never,
    keyring,
    secrets,
    {
      record: async (input: PlatformAuditInput) => {
        audit.push(input);
      },
    } as unknown as PlatformAuditService,
    testeur,
  );

  return { service, store, testeur, audit };
}

let ctx: Contexte;
beforeEach(() => {
  ctx = monter();
  delete process.env['OPENAI_API_KEY'];
  delete process.env['S3_SECRET_KEY'];
});

/** Enregistre `stripe.restrictedKey` avec un test réussi. */
async function poserUneCle(valeur = CLE_VALIDE): Promise<void> {
  ctx.testeur.mode = 'ok';
  await ctx.service.update('stripe', { secrets: { restrictedKey: valeur } }, ACTEUR, false);
}

// ── 1. Test avant écriture ───────────────────────────────────────────────────

describe('le test de connexion précède toute écriture (ADR-0013 §5)', () => {
  it('un test en échec renvoie 422 et ne crée AUCUN document', async () => {
    ctx.testeur.mode = 'echec';

    await expect(
      ctx.service.update('stripe', { secrets: { restrictedKey: CLE_REFUSEE } }, ACTEUR, false),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    // Vérification EXPLICITE de l'absence, comme le demande le plan de validation.
    expect(ctx.store.has('stripe')).toBe(false);
    const vue = await ctx.service.get('stripe');
    expect(vue.secrets['restrictedKey']?.configured).toBe(false);
    expect(vue.lastTest).toBeNull();
  });

  it("un test en échec n'écrase pas une clé déjà valide", async () => {
    await poserUneCle();
    ctx.testeur.mode = 'echec';

    await expect(
      ctx.service.update('stripe', { secrets: { restrictedKey: CLE_REFUSEE } }, ACTEUR, false),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    const vue = await ctx.service.get('stripe');
    expect(vue.secrets['restrictedKey']?.last4).toBe(CLE_VALIDE.slice(-4));
    // `lastTest` non plus n'est pas touché : l'échec n'a rien persisté.
    expect(vue.lastTest?.status).toBe('ok');
  });

  it("un test en échec n'écrit aucune trace d'audit", async () => {
    ctx.testeur.mode = 'echec';
    await ctx.service
      .update('stripe', { secrets: { restrictedKey: CLE_REFUSEE } }, ACTEUR, false)
      .catch(() => undefined);
    expect(ctx.audit).toEqual([]);
  });

  it('le test porte sur la valeur SOUMISE, pas sur celle déjà en base', async () => {
    await poserUneCle();
    await ctx.service.update(
      'stripe',
      { secrets: { restrictedKey: CLE_REMPLACANTE } },
      ACTEUR,
      false,
    );

    const dernier = ctx.testeur.appels.at(-1)!;
    expect(dernier.secrets['restrictedKey']).toBe(CLE_REMPLACANTE);
  });

  it('le test complète avec les secrets NON soumis déjà en base', async () => {
    // Tester `webhookSecret` seul exige la `restrictedKey`, absente de la requête.
    await poserUneCle();
    await ctx.service.update(
      'stripe',
      { secrets: { webhookSecret: 'whsec-1234abcd5678' } },
      ACTEUR,
      false,
    );

    const dernier = ctx.testeur.appels.at(-1)!;
    expect(dernier.secrets['restrictedKey']).toBe(CLE_VALIDE);
    expect(dernier.secrets['webhookSecret']).toBe('whsec-1234abcd5678');
  });

  it('`?force=true` écrit malgré l’échec, et le trace comme forcé', async () => {
    ctx.testeur.mode = 'echec';
    const vue = await ctx.service.update(
      'smtp',
      { secrets: { password: 'motdepasse-derriere-pare-feu' } },
      ACTEUR,
      true,
    );

    expect(vue.secrets['password']?.configured).toBe(true);
    // « Une dérogation tracée vaut mieux qu'un contrôle qu'on finit par retirer
    // parce qu'il bloque » — mais `lastTest.status` reste `failed`.
    expect(vue.lastTest?.status).toBe('failed');
    expect(vue.lastTest?.forced).toBe(true);
    expect(ctx.audit.some((e) => e.metadata?.['forced'] === true)).toBe(true);
  });

  it('`?force=true` ne marque PAS `forced` quand le test a réussi', async () => {
    // Sinon une intégration parfaitement valide apparaîtrait en dérogation dans
    // `/admin`, et la dérogation cesserait de signaler quoi que ce soit.
    ctx.testeur.mode = 'ok';
    const vue = await ctx.service.update(
      'smtp',
      { secrets: { password: 'motdepasse-parfaitement-valide' } },
      ACTEUR,
      true,
    );
    expect(vue.lastTest?.status).toBe('ok');
    expect(vue.lastTest?.forced).toBe(false);
  });

  it('une écriture qui ne touche ni config ni secret ne déclenche pas de test', async () => {
    // Activer une intégration n'est pas une raison de solliciter un fournisseur
    // externe avec les identifiants de la plateforme.
    await poserUneCle();
    const avant = ctx.testeur.appels.length;
    await ctx.service.update('stripe', { enabled: true }, ACTEUR, false);
    expect(ctx.testeur.appels.length).toBe(avant);
  });
});

// ── 2. Écriture par remplacement ─────────────────────────────────────────────

describe('écriture par remplacement seulement (ADR-0013 §4)', () => {
  it('un secret ABSENT du corps est laissé inchangé', async () => {
    await poserUneCle();
    await ctx.service.update(
      'stripe',
      { secrets: { webhookSecret: 'whsec-abcd12345678' } },
      ACTEUR,
      false,
    );

    const vue = await ctx.service.get('stripe');
    expect(vue.secrets['restrictedKey']?.last4).toBe(CLE_VALIDE.slice(-4));
    expect(vue.secrets['webhookSecret']?.last4).toBe('5678');
  });

  it('une CHAÎNE remplace — et régénère un chiffré entièrement neuf', async () => {
    await poserUneCle();
    const avant = { ...(ctx.store.get('stripe')!.secrets['restrictedKey'] as never) } as {
      iv: string;
      salt: string;
      ciphertext: string;
    };

    await ctx.service.update(
      'stripe',
      { secrets: { restrictedKey: CLE_REMPLACANTE } },
      ACTEUR,
      false,
    );
    const apres = ctx.store.get('stripe')!.secrets['restrictedKey'] as unknown as typeof avant;

    expect(apres.iv).not.toBe(avant.iv);
    expect(apres.salt).not.toBe(avant.salt);
    expect(apres.ciphertext).not.toBe(avant.ciphertext);

    const vue = await ctx.service.get('stripe');
    expect(vue.secrets['restrictedKey']?.last4).toBe(CLE_REMPLACANTE.slice(-4));
  });

  it('`null` supprime', async () => {
    await poserUneCle();
    const vue = await ctx.service.update(
      'stripe',
      { secrets: { restrictedKey: null } },
      ACTEUR,
      false,
    );
    expect(vue.secrets['restrictedKey']?.configured).toBe(false);
    expect(vue.secrets['restrictedKey']?.last4).toBeNull();
  });

  it('`config` fusionne, il ne remplace pas le volet entier', async () => {
    await ctx.service.update('stripe', { config: { publishableKey: 'pk_test_1' } }, ACTEUR, false);
    const vue = await ctx.service.update(
      'stripe',
      { config: { accountCountry: 'CD' } },
      ACTEUR,
      false,
    );
    expect(vue.config['publishableKey']).toBe('pk_test_1');
    expect(vue.config['accountCountry']).toBe('CD');
  });

  it('une clé hors liste blanche est refusée en 400, et rien n’est écrit', async () => {
    await expect(
      ctx.service.update('stripe', { config: { cleSecrete: 'valeur' } }, ACTEUR, false),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.store.has('stripe')).toBe(false);
  });

  it('toutes les violations sont rapportées d’un coup, pas la première', async () => {
    // « Un opérateur qui corrige une clé à la fois pour découvrir la suivante
    // finit par contourner le formulaire. »
    let capture: BadRequestException | undefined;
    try {
      await ctx.service.update(
        'stripe',
        { config: { a: '1', b: '2' }, secrets: { c: 'valeur-c-123456789' } },
        ACTEUR,
        false,
      );
    } catch (err) {
      capture = err as BadRequestException;
    }
    const corps = capture!.getResponse() as { violations: Array<{ field: string; key: string }> };
    expect(corps.violations).toHaveLength(3);
  });

  it('supprimer un secret inexistant est idempotent, pas une erreur', async () => {
    // Un 404 renseignerait sur l'état de configuration à qui n'a pas déjà la vue.
    const vue = await ctx.service.deleteSecret('stripe', 'restrictedKey', ACTEUR);
    expect(vue.secrets['restrictedKey']?.configured).toBe(false);
  });

  it('supprimer un nom de secret INCONNU est refusé en 400', async () => {
    await expect(ctx.service.deleteSecret('stripe', 'secretKey', ACTEUR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

// ── 3. Vue de lecture ────────────────────────────────────────────────────────

describe('vue de lecture — la seule forme jamais renvoyée (ADR-0013 §4)', () => {
  it('liste tous les fournisseurs même non configurés — l’absence est une information', async () => {
    const vues = await ctx.service.list();
    expect(vues.map((v) => v.provider)).toEqual([
      'openai',
      'stripe',
      'paypal',
      'smtp',
      'r2',
      'elevenlabs',
      'zeptomail',
    ]);
    for (const vue of vues) {
      expect(vue.enabled).toBe(false);
      expect(vue.lastTest).toBeNull();
      for (const etat of Object.values(vue.secrets)) {
        expect(etat.configured).toBe(false);
        expect(etat.source).toBeNull();
      }
    }
  });

  it('n’expose que les champs du contrat', async () => {
    await poserUneCle();
    const vue = await ctx.service.get('stripe');
    expect(Object.keys(vue).sort()).toEqual(
      [
        'config',
        'configFields',
        'enabled',
        'label',
        'lastTest',
        'provider',
        'requiredConfig',
        'requiredSecrets',
        'secrets',
        'testDescription',
        'updatedAt',
      ].sort(),
    );
    // `configFields` et `requiredConfig` sont des NOMS de champs. Le test est
    // écrit en liste FERMÉE et non en « contient » : c'est ce qui l'a fait
    // échouer quand ces deux clés ont été ajoutées, et c'est la seule forme qui
    // signale l'apparition d'un champ que personne n'a examiné.
    expect(vue.configFields).toEqual(['publishableKey', 'webhookEndpoint', 'accountCountry']);
    expect(Object.keys(vue.secrets['restrictedKey']!).sort()).toEqual(
      ['configured', 'last4', 'source', 'updatedAt', 'updatedBy'].sort(),
    );
  });

  it('affiche `source: db` quand la valeur vient du coffre', async () => {
    await poserUneCle();
    const vue = await ctx.service.get('stripe');
    expect(vue.secrets['restrictedKey']?.source).toBe('db');
  });

  it('affiche `source: env` quand seule la variable de secours existe', async () => {
    // Garde-fou n°1 de l'option C : « la source effective est affichée dans
    // /admin ». Sans elle, « une variable d'environnement oubliée masque
    // silencieusement une clé pourtant rotée en base ».
    process.env['OPENAI_API_KEY'] = 'valeur-heritee-de-lenvironnement';
    const vue = await ctx.service.get('openai');
    expect(vue.secrets['apiKey']?.source).toBe('env');
    expect(vue.secrets['apiKey']?.configured).toBe(true);
    // Aucun `last4` : la valeur d'environnement n'a pas été chiffrée par nous, et
    // l'API ne se met pas à en extraire des fragments au passage.
    expect(vue.secrets['apiKey']?.last4).toBeNull();
    delete process.env['OPENAI_API_KEY'];
  });

  it('la base l’emporte sur l’environnement', async () => {
    process.env['OPENAI_API_KEY'] = 'valeur-heritee-de-lenvironnement';
    await ctx.service.update('openai', { secrets: { apiKey: CLE_VALIDE } }, ACTEUR, false);
    const vue = await ctx.service.get('openai');
    expect(vue.secrets['apiKey']?.source).toBe('db');
    delete process.env['OPENAI_API_KEY'];
  });

  it('filtre `config` à la SORTIE aussi, pas seulement à l’entrée', async () => {
    // Un document écrit par une version antérieure ou à la main en base pourrait
    // porter une clé qui n'est plus autorisée.
    await ctx.service.update('stripe', { config: { publishableKey: 'pk_1' } }, ACTEUR, false);
    const doc = ctx.store.get('stripe')!;
    doc.config = { ...doc.config, cleHeritee: 'valeur-douteuse' };

    const vue = await ctx.service.get('stripe');
    expect(vue.config['publishableKey']).toBe('pk_1');
    expect(vue.config['cleHeritee']).toBeUndefined();
  });
});

// ── 4. Audit ─────────────────────────────────────────────────────────────────

describe('audit — jamais la valeur (ADR-0013 §6)', () => {
  it('une écriture de secret produit `integration.secret.updated` avec les deux last4', async () => {
    await poserUneCle();
    ctx.audit.length = 0;
    await ctx.service.update(
      'stripe',
      { secrets: { restrictedKey: CLE_REMPLACANTE } },
      ACTEUR,
      false,
    );

    const entree = ctx.audit.find((e) => e.action === 'integration.secret.updated')!;
    expect(entree).toBeDefined();
    expect(entree.metadata?.['last4Before']).toBe(CLE_VALIDE.slice(-4));
    expect(entree.metadata?.['last4After']).toBe(CLE_REMPLACANTE.slice(-4));
    expect(entree.targetType).toBe('integration');
    expect(entree.targetId).toBe('stripe');
  });

  it("inscrit le rôle SOUS LEQUEL l'action a été autorisée", async () => {
    await poserUneCle();
    expect(ctx.audit.every((e) => e.actorRole === 'platform_super_admin')).toBe(true);
    expect(ctx.audit.every((e) => e.actorUserId === ACTEUR.userId)).toBe(true);
  });

  it('une suppression produit `integration.secret.deleted` avec last4After null', async () => {
    await poserUneCle();
    ctx.audit.length = 0;
    await ctx.service.deleteSecret('stripe', 'restrictedKey', ACTEUR);

    const entree = ctx.audit.find((e) => e.action === 'integration.secret.deleted')!;
    expect(entree.metadata?.['last4Before']).toBe(CLE_VALIDE.slice(-4));
    expect(entree.metadata?.['last4After']).toBeNull();
  });

  it('activer puis désactiver produit deux actions distinctes', async () => {
    await poserUneCle();
    ctx.audit.length = 0;
    await ctx.service.update('stripe', { enabled: true }, ACTEUR, false);
    await ctx.service.update('stripe', { enabled: false }, ACTEUR, false);

    expect(ctx.audit.map((e) => e.action)).toEqual(['integration.enabled', 'integration.disabled']);
  });

  it("un `enabled` qui ne change rien ne produit pas d'entrée", async () => {
    // Un journal qui enregistre des non-événements devient illisible, et on cesse
    // de le lire précisément quand il compte.
    await poserUneCle();
    ctx.audit.length = 0;
    await ctx.service.update('stripe', { enabled: false }, ACTEUR, false);
    expect(ctx.audit).toEqual([]);
  });

  it('un test à la demande est tracé même sans document à mettre à jour', async () => {
    // « Le test reste un acte à tracer : c'est une sollicitation d'un fournisseur
    // externe avec les identifiants de la plateforme. »
    await ctx.service.testStored('paypal', ACTEUR);
    expect(ctx.audit.map((e) => e.action)).toEqual(['integration.tested']);
  });

  it("l'adresse IP et l'agent sont conservés, l'agent tronqué", async () => {
    const acteurBavard: ActorContext = { ...ACTEUR, userAgent: 'A'.repeat(500) };
    await ctx.service.testStored('paypal', acteurBavard);
    const entree = ctx.audit[0]!;
    expect(entree.metadata?.['ip']).toBe('203.0.113.7');
    expect(String(entree.metadata?.['userAgent'])).toHaveLength(200);
  });
});

// ── 5. Coffre indisponible ───────────────────────────────────────────────────

describe('coffre indisponible — SECRETS_MASTER_KEY absente', () => {
  it('refuse toute écriture de secret plutôt que de stocker en clair', async () => {
    const store = new Map<string, IntegrationDocument>();
    const model = Object.assign(
      function (): IntegrationDocument {
        throw new Error('aucun document ne doit être construit');
      } as unknown as Model<IntegrationDocument>,
      {
        find: () => ({ exec: async () => [...store.values()] }),
        findOne: () => ({ exec: async () => null }),
      },
    );

    const sansCoffre = new IntegrationsService(
      model,
      { startSession: () => Promise.reject(new Error('x')) } as never,
      null,
      new SecretsService(model, null),
      { record: async () => undefined } as unknown as PlatformAuditService,
      new TesteurPilotable(),
    );

    await expect(
      sansCoffre.update('stripe', { secrets: { restrictedKey: CLE_VALIDE } }, ACTEUR, false),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
