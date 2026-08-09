// Chaîne de confiance du reverse proxy (S22f — finding F-03 de
// docs/29-AUDIT-SECURITE-S22e.md, doctrine docs/17-SECURITE.md).
//
// POURQUOI CE FICHIER EXISTE
//
// Derrière Caddy, toutes les requêtes arrivent à l'API depuis l'adresse du
// conteneur caddy. Sans configuration, `req.ip` vaut cette adresse pour TOUT le
// monde : le seau de 100 req/min du ThrottlerGuard devient un compteur global et
// 100 requêtes d'un seul attaquant renvoient 429 à tous les utilisateurs.
//
// POURQUOI UN NOMBRE ET PAS `true`
//
// `app.set('trust proxy', true)` fait confiance à la totalité de la chaîne
// `X-Forwarded-For`, y compris à la partie que le CLIENT a écrite. Express
// retiendrait alors l'adresse la plus à gauche de l'en-tête — celle que
// l'attaquant contrôle — et il lui suffirait de changer cette valeur à chaque
// requête pour se voir attribuer un seau neuf : la limite disparaîtrait au lieu
// d'être réparée. Un nombre borne explicitement ce qui est cru.
//
// LA CHAÎNE, RANG PAR RANG (docker-compose.prod.yml + Caddyfile)
//
//   client ─── Internet ───▶ caddy:443 ───▶ api:3001
//
//   1. Le client peut envoyer n'importe quel `X-Forwarded-For` : c'est une
//      donnée hostile, jamais une identité.
//   2. Caddy (`reverse_proxy`, Caddyfile) APPEND l'adresse du pair TCP qu'il
//      observe réellement à cet en-tête. La chaîne transmise à l'API est donc
//      « <ce que le client a écrit>, <IP réelle vue par Caddy> » : la valeur
//      posée par Caddy est TOUJOURS la dernière, et elle est la seule que le
//      client ne puisse pas falsifier.
//   3. L'API est le service final. Aucun autre proxy ne s'intercale : le réseau
//      `edge` de docker-compose.prod.yml ne publie que les ports de caddy, et
//      le conteneur api n'est joignable que par lui.
//
// D'où UN seul rang de confiance. Avec `trust proxy = 1`, Express (proxy-addr)
// tronque la chaîne au premier maillon non fiable et retient l'adresse posée par
// Caddy — c'est-à-dire l'IP cliente réelle. Tout ce que le client avait préfixé
// est ignoré.
//
// SI LA TOPOLOGIE CHANGE — un CDN ou un load balancer devant Caddy — ce nombre
// doit augmenter d'autant, sinon l'IP retenue devient celle du CDN et le seau
// redevient partagé. C'est la raison pour laquelle la valeur vit ici, avec sa
// justification, et non en littéral dans `main.ts`.

/**
 * Nombre de proxys de confiance entre le client et l'API.
 * 1 = Caddy, et rien d'autre (voir la chaîne détaillée ci-dessus).
 */
export const TRUSTED_PROXY_HOPS = 1;

/** Sous-ensemble d'Express dont on a besoin ici (évite un import de type lourd). */
export interface ExpressSettableApp {
  set(setting: string, value: unknown): unknown;
}

/**
 * Applique la chaîne de confiance à l'application Express sous-jacente.
 *
 * Factorisé pour que `main.ts` et les tests de non-régression
 * (`trusted-proxy.test.ts`) configurent rigoureusement la même chose : un test
 * qui poserait sa propre valeur ne prouverait rien sur la production.
 */
export function applyTrustedProxy(expressApp: ExpressSettableApp): void {
  expressApp.set('trust proxy', TRUSTED_PROXY_HOPS);
}
