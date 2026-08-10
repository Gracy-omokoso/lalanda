// Redirections déclarées par apps/web/next.config.mjs — ADR-0016 §3.
//
// Pourquoi ce fichier existe : `/members` est une URL PUBLIÉE. Elle a été
// partagée, mise en favori, collée dans des messages. La supprimer sans
// redirection produirait un 404 pour des gens qui n'ont rien fait de mal, et le
// symptôme n'apparaîtrait que chez eux — jamais dans un test de rendu, jamais en
// revue. Le seul endroit où cette garantie peut vivre est la configuration, donc
// le seul endroit où elle peut se tester aussi.
//
// Même approche que `csp.test.ts` : on charge la configuration réelle et on lit
// ce qu'elle déclare, plutôt que de réécrire la règle dans le test.

import { describe, expect, it } from 'vitest';

interface RegleRedirection {
  source: string;
  destination: string;
  permanent?: boolean;
  statusCode?: number;
}

async function redirections(): Promise<RegleRedirection[]> {
  const { default: config } = await import('../../next.config.mjs');
  // Garde explicite : si `redirects()` disparaissait de la configuration, le
  // test doit dire CELA, pas échouer sur un `undefined is not a function`.
  if (typeof config.redirects !== 'function') {
    throw new Error('next.config.mjs ne déclare aucun bloc redirects()');
  }
  return (await config.redirects()) as RegleRedirection[];
}

/** Applique les règles à un chemin, comme le ferait Next : première correspondance. */
function resoudre(regles: readonly RegleRedirection[], chemin: string): RegleRedirection | null {
  return regles.find((r) => r.source === chemin) ?? null;
}

describe('/members → /organisation/membres (ADR-0016 §3)', () => {
  it('redirige l’ancienne URL vers la nouvelle', async () => {
    const regle = resoudre(await redirections(), '/members');
    expect(regle).not.toBeNull();
    expect(regle?.destination).toBe('/organisation/membres');
  });

  it('répond en 308 et non en 301', async () => {
    // `permanent: true` ⇒ 308 chez Next. Le 301 autorise historiquement les
    // navigateurs à retourner un POST en GET : une soumission disparaîtrait au
    // lieu d'être déplacée.
    const regle = resoudre(await redirections(), '/members');
    expect(regle?.permanent).toBe(true);
    expect(regle?.statusCode).toBeUndefined();
  });

  it('ne capture pas les chemins qui commencent par le même mot', async () => {
    // Un `source` transformé en préfixe happerait des routes étrangères et les
    // enverrait toutes sur la page des membres.
    const regles = await redirections();
    for (const chemin of ['/members-archive', '/membres', '/members/x', '/projects']) {
      expect(resoudre(regles, chemin)).toBeNull();
    }
  });

  it('ne redirige pas la destination sur elle-même', async () => {
    // Une règle dont la source vaut la destination produit une boucle infinie
    // que le navigateur signale bien plus tard que ce test.
    const regles = await redirections();
    for (const regle of regles) {
      expect(regle.source).not.toBe(regle.destination);
      expect(resoudre(regles, regle.destination)).toBeNull();
    }
  });
});
