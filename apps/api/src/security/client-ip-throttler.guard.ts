// Guard de throttling par IP CLIENTE RÉELLE (S22f — finding F-03).
//
// Le `ThrottlerGuard` de `@nestjs/throttler` clé sur `req.ip` / `req.ips`, deux
// valeurs qu'Express ne calcule correctement QUE si `trust proxy` est réglé (voir
// `trusted-proxy.ts`). Les deux moitiés du correctif sont indissociables : ce
// guard sans le réglage compte l'IP de Caddy pour tout le monde ; le réglage sans
// un tracker explicite marcherait par le seul effet du défaut de la librairie,
// que rien dans ce dépôt ne verrouille.
//
// D'où un `getTracker` écrit à la main : il rend la clé lisible, préfixée
// (`ip:` — même convention que `UserThrottlerGuard`, pour qu'un seau par IP et
// un seau par utilisateur ne puissent jamais collisionner dans le stockage), et
// surtout testable directement.
//
// `req.ips[0]` plutôt que `req.ip` : les deux valent la même chose une fois la
// chaîne tronquée par proxy-addr au nombre de rangs de confiance, mais `ips`
// exprime que l'on prend le maillon le plus en amont de ce que l'on CROIT — et
// non « l'adresse » au singulier, formulation qui laisse croire à tort que
// l'en-tête n'a pas joué.

import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const { ips, ip } = req as unknown as { ips?: string[]; ip?: string };
    // `ips` est vide quand aucun `X-Forwarded-For` fiable n'est présent
    // (appel direct en développement) : on retombe sur l'adresse du socket.
    const client = ips?.length ? ips[0] : ip;
    // Jamais de compteur sans clé : sans adresse exploitable, tous les appelants
    // anonymes partagent un seau plutôt que d'échapper à la limite.
    return `ip:${client ?? 'unknown'}`;
  }
}
