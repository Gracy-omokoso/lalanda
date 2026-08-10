// Tests de la CSP servie par apps/web/next.config.mjs.
//
// Pourquoi ce fichier existe : la CSP de S22e (bfdbc95) posait
// `script-src 'self' 'unsafe-inline'` sans `'unsafe-eval'`. En développement,
// `next dev` enveloppe chaque module client dans un `eval()` (devtool
// `eval-source-map`) — tout le bundle client levait donc une EvalError et React
// n'hydratait jamais. La page s'affichait normalement (HTML rendu côté serveur)
// mais aucun formulaire ne fonctionnait, connexion comprise. Aucun test ne
// couvrait la CSP : la régression est passée en revue sans être vue.
//
// Les deux sens sont vérifiés, parce qu'ils échouent différemment : sans
// `'unsafe-eval'` en dev, l'application est morte; avec `'unsafe-eval'` en
// production, on rouvre au navigateur l'exécution de chaînes de caractères,
// c'est-à-dire l'essentiel de ce que la CSP sert à fermer.

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Recharge next.config.mjs sous un NODE_ENV donné et rend la valeur de l'en-tête
 * `Content-Security-Policy`. Le `resetModules` est indispensable : la CSP est
 * calculée à l'évaluation du module, pas à chaque appel de `headers()`.
 */
async function cspFor(nodeEnv: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);

  const { default: config } = await import('../../next.config.mjs');
  // Garde explicite : `headers` est optionnel dans le type `NextConfig`, et sans
  // elle `pnpm typecheck` échoue sur ce fichier (deux erreurs préexistantes à
  // l'ADR-0016). Si le bloc disparaissait de la configuration, le test doit dire
  // CELA plutôt que buter sur un appel d'`undefined`.
  if (typeof config.headers !== 'function') {
    throw new Error('next.config.mjs ne déclare aucun bloc headers()');
  }
  const groups = await config.headers();
  const header = groups
    .flatMap((group: { headers: { key: string; value: string }[] }) => group.headers)
    .find((h: { key: string }) => h.key === 'Content-Security-Policy');

  if (!header) throw new Error('Aucun en-tête Content-Security-Policy servi');
  return header.value;
}

/** Extrait une directive de la politique, sans dépendre de son rang. */
function directive(csp: string, name: string): string {
  const found = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));

  if (!found) throw new Error(`Directive « ${name} » absente de la CSP`);
  return found;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('script-src selon l’environnement', () => {
  it('autorise `unsafe-eval` en développement, sinon `next dev` n’hydrate pas', async () => {
    expect(directive(await cspFor('development'), 'script-src')).toContain("'unsafe-eval'");
  });

  it('refuse `unsafe-eval` en production, où aucun `eval` n’est produit', async () => {
    expect(directive(await cspFor('production'), 'script-src')).not.toContain("'unsafe-eval'");
  });

  it('ne s’ouvre jamais au-delà de l’origine, dans les deux environnements', async () => {
    // `'unsafe-eval'` est une tolérance sur la forme du code, pas sur sa
    // provenance : aucun hôte tiers ne doit pouvoir livrer un script.
    for (const env of ['development', 'production']) {
      const scriptSrc = directive(await cspFor(env), 'script-src');
      expect(scriptSrc).toBe(
        env === 'development'
          ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
          : "script-src 'self' 'unsafe-inline'",
      );
    }
  });
});

describe('bornes de destination', () => {
  it('laisse le navigateur joindre l’API, et elle seule', async () => {
    // `connect-src 'self'` seul bloquerait toutes les requêtes de données :
    // l'API vit sur une autre origine.
    expect(directive(await cspFor('production'), 'connect-src')).toBe(
      "connect-src 'self' http://localhost:3001",
    );
  });

  it('garde fermés les vecteurs passifs quel que soit l’environnement', async () => {
    for (const env of ['development', 'production']) {
      const csp = await cspFor(env);
      expect(directive(csp, 'object-src')).toBe("object-src 'none'");
      expect(directive(csp, 'base-uri')).toBe("base-uri 'none'");
      expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
      expect(directive(csp, 'form-action')).toBe("form-action 'self'");
    }
  });
});

describe('images de profil (ADR-0016 §7, E4)', () => {
  it('autorise l’origine de l’API dans img-src, sinon la photo est bloquée', async () => {
    // Les photos sont servies par l'API derrière un jeton signé, pas par
    // l'origine web : `img-src 'self'` seul les bloque. Le symptôme n'apparaît
    // qu'en console du navigateur — aucun test de rendu ne le verrait.
    expect(directive(await cspFor('production'), 'img-src')).toBe(
      "img-src 'self' data: blob: http://localhost:3001",
    );
  });

  it('n’ouvre img-src à aucun autre hôte, dans les deux environnements', async () => {
    for (const env of ['development', 'production']) {
      const imgSrc = directive(await cspFor(env), 'img-src');
      expect(imgSrc).not.toContain('*');
      expect(imgSrc).not.toContain('https:');
    }
  });
});
