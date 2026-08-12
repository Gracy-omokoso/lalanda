// Tests de connexion R2 et ElevenLabs — ADR-0013 §5.
//
// ── Ce que ces tests prouvent, et ce qu'ils ne prouvent PAS ───────────────────
//
// Ils ne prouvent RIEN sur l'acceptation par Cloudflare ou ElevenLabs : aucun
// compte R2 ni clé ElevenLabs n'existe à ce stade, et un test qui prétendrait le
// contraire mentirait. Ce qui est vérifiable sans identifiants, et qui est
// vérifié ici, c'est la REQUÊTE ÉMISE — méthode, chemin, en-têtes, absence de
// corps — donc la propriété qui compte pour la facture : le test ne peut pas
// coûter d'argent.
//
// « Sans coût » est une affirmation sur la requête sortante, pas sur la réponse.
// C'est donc exactement ce qu'un test hors ligne peut établir, et il l'établit
// pour de bon.
//
// ── Pourquoi un vrai serveur HTTP local plutôt qu'un `fetch` simulé ──────────
//
// Un `fetch` remplacé enregistre ce que le code CROIT envoyer. Il ne dit pas si
// la requête part réellement : `undici` refuse certains en-têtes, et `host` —
// que la signature SigV4 impose — est de ceux qui sont interdits côté
// navigateur. Un serveur local sur `127.0.0.1` lève le doute, puisque la requête
// traverse la pile HTTP pour de vrai.
//
// Le `fetch` simulé n'est gardé que là où un serveur local ne peut rien : la
// région déduite de l'HÔTE, qui exige de paraître être
// `<compte>.r2.cloudflarestorage.com` sans le joindre.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { HttpConnectionTester, type ConnectionTestInput } from './connection-tests.js';

/** Requête telle qu'elle est PARVENUE au serveur, après traversée de la pile HTTP. */
interface RequeteRecue {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface ServeurLocal {
  origin: string;
  recues: RequeteRecue[];
  fermer: () => Promise<void>;
}

/** Serveur jetable qui enregistre tout ce qu'il reçoit et répond ce qu'on lui dit. */
async function serveurLocal(
  repondre: (req: IncomingMessage) => { status: number; body?: string },
): Promise<ServeurLocal> {
  const recues: RequeteRecue[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      recues.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body,
      });
      const { status, body: corps } = repondre(req);
      res.writeHead(status, { 'content-type': 'application/json' });
      // Une réponse à un HEAD ne porte pas de corps : `res.end(corps)` sur un
      // HEAD serait ignoré par Node, on ne l'écrit donc que pour les autres.
      res.end(req.method === 'HEAD' ? undefined : (corps ?? '{}'));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    recues,
    fermer: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const tester = new HttpConnectionTester();

const CLE_SECRETE = 'secret-r2-de-test-ne-servant-a-rien';

function entreeR2(
  origin: string,
  config: Record<string, string> = {},
): ConnectionTestInput {
  return {
    provider: 'r2',
    config: {
      endpoint: origin,
      accessKey: 'cle-acces-de-test',
      bucketExports: 'lalanda-exports',
      ...config,
    },
    secrets: { secretKey: CLE_SECRETE },
  };
}

/** Le scope de signature, extrait de l'en-tête `authorization`. */
function scopeDeSignature(headers: Record<string, string | string[] | undefined>): string {
  const auth = String(headers['authorization'] ?? '');
  return /Credential=[^/]+\/(\S+?),/.exec(auth)?.[1] ?? '';
}

// ─── R2 / MinIO : HeadBucket ─────────────────────────────────────────────────

describe('test de connexion R2 — la requête émise ne peut rien coûter', () => {
  it('émet un HEAD sur le bucket, sans corps et sans lire le moindre objet', async () => {
    const srv = await serveurLocal(() => ({ status: 200 }));
    try {
      const res = await tester.test(entreeR2(srv.origin));

      expect(res.ok, res.detail).toBe(true);
      expect(srv.recues).toHaveLength(1);
      const req = srv.recues[0]!;

      // HEAD, et rien d'autre : ni GET (qui lirait), ni PUT (qui écrirait).
      expect(req.method).toBe('HEAD');
      // Le chemin s'arrête au BUCKET. Une clé d'objet ici transformerait le test
      // en lecture facturée — et, pire, en lecture d'une donnée cliente.
      expect(req.url).toBe('/lalanda-exports');
      expect(req.body).toBe('');
    } finally {
      await srv.fermer();
    }
  });

  it('signe réellement : `host` et l’empreinte du corps vide arrivent au serveur', async () => {
    // Ce cas est la raison d'être du serveur local. `host` est un en-tête interdit
    // côté navigateur et la signature SigV4 l'exige : s'il était filtré en
    // chemin, la signature ne couvrirait pas ce que le serveur reçoit et tout
    // appel réel finirait en 403 — panne invisible pour un `fetch` simulé.
    const srv = await serveurLocal(() => ({ status: 200 }));
    try {
      await tester.test(entreeR2(srv.origin));
      const { headers } = srv.recues[0]!;

      const empreinteCorpsVide =
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      expect(headers['x-amz-content-sha256']).toBe(empreinteCorpsVide);
      expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
      expect(String(headers['authorization'])).toMatch(/^AWS4-HMAC-SHA256 Credential=/);
      expect(String(headers['authorization'])).toContain(
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date',
      );
    } finally {
      await srv.fermer();
    }
  });

  it('ne fait JAMAIS voyager la clé secrète — seule la signature part', async () => {
    const srv = await serveurLocal(() => ({ status: 200 }));
    try {
      const res = await tester.test(entreeR2(srv.origin));
      const brut = JSON.stringify(srv.recues[0]);
      expect(brut).not.toContain(CLE_SECRETE);
      expect(res.detail).not.toContain(CLE_SECRETE);
    } finally {
      await srv.fermer();
    }
  });

  it('signe en `us-east-1` pour un hôte non-R2 — non-régression MinIO', async () => {
    // MinIO tourne en production et porte de vraies photos de profil. Ce cas est
    // celui qui interdit de basculer son défaut de région par mégarde.
    const srv = await serveurLocal(() => ({ status: 200 }));
    try {
      await tester.test(entreeR2(srv.origin));
      expect(scopeDeSignature(srv.recues[0]!.headers)).toMatch(
        /^\d{8}\/us-east-1\/s3\/aws4_request$/,
      );
    } finally {
      await srv.fermer();
    }
  });

  it('laisse toujours gagner une région explicite', async () => {
    // `ams3` sur Spaces, par exemple : le défaut ne comble que le silence, il ne
    // doit pas rendre impossible de signer pour une région imposée.
    const srv = await serveurLocal(() => ({ status: 200 }));
    try {
      await tester.test(entreeR2(srv.origin, { region: 'ams3' }));
      expect(scopeDeSignature(srv.recues[0]!.headers)).toMatch(/\/ams3\/s3\/aws4_request$/);
    } finally {
      await srv.fermer();
    }
  });

  it('traduit un 403 en pointant la région signée, pas seulement les identifiants', async () => {
    // Une région erronée produit un 403 dont le message d'origine accuse les
    // identifiants. Sans ce rappel, l'opératrice cherche du mauvais côté.
    const srv = await serveurLocal(() => ({ status: 403 }));
    try {
      const res = await tester.test(entreeR2(srv.origin));
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('403');
      expect(res.detail).toContain('us-east-1');
      expect(res.detail).toContain('auto');
    } finally {
      await srv.fermer();
    }
  });

  it('nomme le bucket introuvable sur un 404', async () => {
    const srv = await serveurLocal(() => ({ status: 404 }));
    try {
      const res = await tester.test(entreeR2(srv.origin));
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('lalanda-exports');
    } finally {
      await srv.fermer();
    }
  });

  it('nomme la configuration manquante sans rien deviner', async () => {
    for (const [champ, attendu] of [
      ['endpoint', '`endpoint`'],
      ['accessKey', '`accessKey`'],
      ['bucketExports', '`bucketExports`'],
    ] as const) {
      const entree = entreeR2('http://127.0.0.1:1');
      delete (entree.config as Record<string, unknown>)[champ];
      const res = await tester.test(entree);
      expect(res.ok, champ).toBe(false);
      expect(res.detail, champ).toContain(attendu);
    }
  });

  it('refuse un endpoint qui n’est pas une URL, sans tenter d’appel', async () => {
    const res = await tester.test(entreeR2('pas-une-url'));
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('URL');
  });

  it('exige la clé secrète avant toute requête', async () => {
    const entree = entreeR2('http://127.0.0.1:1');
    entree.secrets = {};
    const res = await tester.test(entree);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('secretKey');
  });
});

// ─── R2 : région déduite de l'hôte ───────────────────────────────────────────

describe('région déduite de l’hôte R2', () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  /** Intercepte l'appel sortant : paraître être R2 sans joindre Cloudflare. */
  function interceptor(): { vu: () => Request } {
    let capturee: Request | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturee = new Request(typeof input === 'string' ? input : String(input), init);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    return {
      vu: () => {
        if (!capturee) throw new Error('aucune requête émise');
        return capturee;
      },
    };
  }

  it('signe en `auto` pour un endpoint R2 — SigV4 exige un jeton de région', async () => {
    // R2 n'a pas de région au sens AWS, mais il n'existe pas de signature sans
    // jeton de région : Cloudflare attend le littéral `auto`.
    const i = interceptor();
    const res = await tester.test(entreeR2('https://compte-test.r2.cloudflarestorage.com'));
    expect(res.ok, res.detail).toBe(true);

    const auth = i.vu().headers.get('authorization') ?? '';
    expect(auth).toMatch(/Credential=[^/]+\/\d{8}\/auto\/s3\/aws4_request,/);
    // Le nom de service reste `s3` : c'est ce qui rend la signature identique
    // d'un fournisseur à l'autre et laisse `sigv4.ts` inchangé.
    expect(auth).toContain('/s3/aws4_request');
  });

  it('compare sur le SUFFIXE : un bucket MinIO homonyme ne bascule pas en `auto`', async () => {
    // Même arbitrage que `flavorOfHost` côté stockage : un `includes` ferait
    // basculer les défauts d'un serveur qui n'est pas R2.
    const i = interceptor();
    await tester.test(entreeR2('https://r2.cloudflarestorage.com.interne.test'));
    expect(i.vu().headers.get('authorization')).toContain('/us-east-1/s3/aws4_request');
  });

  it('laisse la région explicite gagner même sur un endpoint R2', async () => {
    const i = interceptor();
    await tester.test(
      entreeR2('https://compte-test.r2.cloudflarestorage.com', { region: 'us-east-1' }),
    );
    expect(i.vu().headers.get('authorization')).toContain('/us-east-1/s3/aws4_request');
  });

  it('met le bucket dans l’HÔTE, et le chemin à `/`, si `forcePathStyle` est `false`', async () => {
    // Vérifié par interception plutôt que sur un serveur local : le style hôte
    // virtuel fabrique un sous-domaine, et faire dépendre le cas d'un échec de
    // résolution DNS le rendrait tributaire du résolveur de la machine.
    const i = interceptor();
    await tester.test(
      entreeR2('https://compte-test.r2.cloudflarestorage.com', { forcePathStyle: 'false' }),
    );
    const url = new URL(i.vu().url);
    expect(url.host).toBe('lalanda-exports.compte-test.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/');
    // L'hôte signé doit être celui réellement visé, sans quoi la signature ne
    // couvrirait pas la requête reçue et R2 répondrait 403.
    expect(i.vu().headers.get('authorization')).toContain('SignedHeaders=host;');
  });

  it('conserve le style chemin par défaut — MinIO ne sert pas l’hôte virtuel', async () => {
    // Défaut `true` : MinIO n'expose pas les buckets en sous-domaine sans DNS
    // générique. Le passage à R2 ne demande donc PAS de toucher à cette variable.
    const i = interceptor();
    await tester.test(entreeR2('https://compte-test.r2.cloudflarestorage.com'));
    const url = new URL(i.vu().url);
    expect(url.host).toBe('compte-test.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/lalanda-exports');
  });
});

// ─── ElevenLabs : liste des voix ─────────────────────────────────────────────

describe('test de connexion ElevenLabs — aucune synthèse, aucun crédit', () => {
  function entree(origin: string): ConnectionTestInput {
    return {
      provider: 'elevenlabs',
      config: { baseUrl: origin },
      secrets: { apiKey: 'cle-elevenlabs-de-test' },
    };
  }

  it('lit la liste des voix : GET, sans corps, sur aucun point de génération', async () => {
    const srv = await serveurLocal(() => ({
      status: 200,
      body: JSON.stringify({ voices: [{ voice_id: 'a' }, { voice_id: 'b' }] }),
    }));
    try {
      const res = await tester.test(entree(srv.origin));
      expect(res.ok, res.detail).toBe(true);
      expect(res.detail).toContain('2 voix');

      expect(srv.recues).toHaveLength(1);
      const req = srv.recues[0]!;
      expect(req.method).toBe('GET');
      expect(req.url).toBe('/v2/voices');
      expect(req.body).toBe('');
      // Le point de synthèse est facturé au caractère : un bouton « Tester »
      // branché dessus coûterait de l'argent à chaque clic.
      expect(req.url).not.toContain('text-to-speech');
    } finally {
      await srv.fermer();
    }
  });

  it('authentifie par `xi-api-key`, jamais par `Authorization: Bearer`', async () => {
    // L'écart le plus facile à manquer en recopiant le test d'OpenAI juste
    // au-dessus, et il est silencieux : un Bearer donne un 401 qu'on lit comme
    // « la clé est mauvaise ».
    const srv = await serveurLocal(() => ({ status: 200, body: '{"voices":[]}' }));
    try {
      await tester.test(entree(srv.origin));
      const { headers } = srv.recues[0]!;
      expect(headers['xi-api-key']).toBe('cle-elevenlabs-de-test');
      expect(headers['authorization']).toBeUndefined();
    } finally {
      await srv.fermer();
    }
  });

  it('tolère une `baseUrl` terminée par des barres obliques', async () => {
    const srv = await serveurLocal(() => ({ status: 200, body: '{"voices":[]}' }));
    try {
      const res = await tester.test({
        provider: 'elevenlabs',
        config: { baseUrl: `${srv.origin}//` },
        secrets: { apiKey: 'cle-elevenlabs-de-test' },
      });
      expect(res.ok, res.detail).toBe(true);
      expect(srv.recues[0]!.url).toBe('/v2/voices');
    } finally {
      await srv.fermer();
    }
  });

  it('distingue une clé refusée d’une autre panne', async () => {
    const srv = await serveurLocal(() => ({ status: 401, body: '{}' }));
    try {
      const res = await tester.test(entree(srv.origin));
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('401');
    } finally {
      await srv.fermer();
    }
  });

  it('exige la clé avant toute requête', async () => {
    const res = await tester.test({
      provider: 'elevenlabs',
      config: {},
      secrets: {},
    });
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('apiKey');
  });

  it('ne fait pas fuiter la clé dans le message de retour', async () => {
    const srv = await serveurLocal(() => ({ status: 401, body: '{}' }));
    try {
      const res = await tester.test(entree(srv.origin));
      expect(res.detail).not.toContain('cle-elevenlabs-de-test');
    } finally {
      await srv.fermer();
    }
  });
});
