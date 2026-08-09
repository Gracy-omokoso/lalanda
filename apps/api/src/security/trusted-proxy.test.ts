// Tests de la chaîne de confiance du reverse proxy (S22f — finding F-03).
//
// CE QUE CES TESTS PROTÈGENT, ET QU'AUCUNE ASSERTION SUR UNE CONSTANTE NE VOIT
//
// Le correctif de F-03 n'est pas une valeur, c'est un COMPORTEMENT à trois
// maillons : `trust proxy` côté Express, la troncature de `X-Forwarded-For` par
// proxy-addr, et le tracker du guard. Vérifier `TRUSTED_PROXY_HOPS === 1` ne
// prouverait rien — c'est exactement l'assertion qui reste verte si l'un des
// deux autres maillons casse. On monte donc de vraies applications Nest et on
// leur envoie de vraies requêtes.
//
// Les trois propriétés vérifiées ici sont les trois façons dont ce correctif
// peut être faux :
//   1. les seaux ne sont PAS séparés (le bug d'origine : DoS à 100 requêtes) ;
//   2. les seaux sont séparés mais par une valeur que le client contrôle
//      (régression inverse : la limite disparaît, un attaquant forge une IP par
//      requête) ;
//   3. le quota par UTILISATEUR de `POST /ai/corrective-actions` (S16a) se met à
//      compter par IP au passage.
//
// Le dernier bloc monte volontairement une application SANS `applyTrustedProxy`
// pour démontrer que ces tests échoueraient sans le correctif : sans ce
// témoin, une suite verte ne dirait pas si elle teste le correctif ou le hasard.

import 'reflect-metadata';

import { Controller, Get, Module, UseGuards, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ClientIpThrottlerGuard } from './client-ip-throttler.guard.js';
import { applyTrustedProxy, TRUSTED_PROXY_HOPS } from './trusted-proxy.js';
import { UserThrottlerGuard } from './user-throttler.guard.js';

/**
 * Limite réduite : on teste le mécanisme de séparation des seaux, pas la valeur
 * de production (100 req/min, couverte par `throttling.test.ts`). Trois requêtes
 * suffisent à observer un franchissement et gardent la suite instantanée.
 */
const LIMITE = 3;
const THROTTLE_TEST = { ttl: 60_000, limit: LIMITE } as const;

/** IP réelle telle que Caddy la voit et l'appose en fin de chaîne. */
const IP_REELLE = '203.0.113.10';
const AUTRE_IP_REELLE = '198.51.100.20';

/**
 * Reproduit ce que l'API reçoit en production : le client écrit ce qu'il veut,
 * Caddy APPEND derrière l'adresse du pair TCP qu'il a réellement observée.
 * C'est la seule forme d'en-tête qui a un sens dans ces tests — un
 * `X-Forwarded-For` sans suffixe posé par le proxy ne peut pas arriver à l'API
 * dans la topologie de docker-compose.prod.yml.
 */
function chaine(ipReelle: string, prefixeForgeParLeClient?: string): string {
  return prefixeForgeParLeClient ? `${prefixeForgeParLeClient}, ${ipReelle}` : ipReelle;
}

@Controller('sonde')
class SondeController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ...THROTTLE_TEST }])],
  controllers: [SondeController],
  providers: [{ provide: APP_GUARD, useClass: ClientIpThrottlerGuard }],
})
class ModuleParIp {}

/**
 * Route portant le quota par utilisateur, câblée comme
 * `ai-actions.controller.ts`. Le guard global n'est délibérément PAS enregistré
 * ici : on isole ce que le quota par utilisateur compte, sans qu'un 429 émis par
 * le seau par IP puisse se faire passer pour lui.
 */
@Controller('sonde-utilisateur')
class SondeUtilisateurController {
  @Get()
  @Throttle({ default: THROTTLE_TEST })
  @UseGuards(UserThrottlerGuard)
  ping(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ...THROTTLE_TEST }])],
  controllers: [SondeUtilisateurController],
})
class ModuleParUtilisateur {}

/**
 * Monte une application Nest de test et applique (ou non) la chaîne de confiance.
 *
 * `NestFactory` plutôt que `@nestjs/testing` : la fabrique de production est
 * déjà une dépendance de l'API, et c'est elle qui construit l'adaptateur Express
 * réel — celui dont on veut précisément observer le comportement.
 */
async function monter(module: unknown, avecProxyDeConfiance: boolean): Promise<INestApplication> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = await NestFactory.create(module as any, { logger: false });
  if (avecProxyDeConfiance) {
    applyTrustedProxy(
      app.getHttpAdapter().getInstance() as { set(setting: string, value: unknown): unknown },
    );
  }
  // Tient lieu d'AuthGuard : `UserThrottlerGuard` lit `req.user`, posé en amont
  // dans la chaîne réelle. L'en-tête n'existe que dans ces tests.
  app.use((req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const headers = req['headers'] as Record<string, string | undefined>;
    const id = headers['x-test-user'];
    if (id) req['user'] = { id };
    next();
  });
  await app.init();
  return app;
}

describe('chaîne de confiance du reverse proxy (S22f, F-03)', () => {
  it('un seul rang de confiance : Caddy, et rien entre lui et l’API', () => {
    // La valeur elle-même est une décision de topologie (voir trusted-proxy.ts).
    // Ce test ne la « vérifie » pas : il la rend impossible à changer par
    // inadvertance, puisque la faire bouger demande de toucher cette ligne.
    expect(TRUSTED_PROXY_HOPS).toBe(1);
  });

  describe('seau par IP cliente réelle', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await monter(ModuleParIp, true);
    });
    afterAll(async () => {
      await app.close();
    });

    it('deux IP clientes différentes ont des seaux indépendants', async () => {
      const http = app.getHttpServer() as never;

      for (let i = 0; i < LIMITE; i += 1) {
        await request(http).get('/sonde').set('X-Forwarded-For', chaine(IP_REELLE)).expect(200);
      }
      // Le seau de la première IP est épuisé…
      await request(http).get('/sonde').set('X-Forwarded-For', chaine(IP_REELLE)).expect(429);

      // …et celui de la seconde est intact : c'est exactement ce qui manquait
      // avant S22f, où la 101ᵉ requête d'un attaquant renvoyait 429 à tout le
      // monde.
      await request(http).get('/sonde').set('X-Forwarded-For', chaine(AUTRE_IP_REELLE)).expect(200);
    });

    it('un X-Forwarded-For forgé par le client ne crée pas de seau neuf', async () => {
      const http = app.getHttpServer() as never;
      const ip = '192.0.2.77';

      // Chaque requête annonce une IP différente en tête de chaîne : si l'API
      // croyait le client, chacune ouvrirait un seau vierge et la limite
      // n'existerait plus.
      for (let i = 0; i < LIMITE; i += 1) {
        await request(http)
          .get('/sonde')
          .set('X-Forwarded-For', chaine(ip, `10.0.0.${i + 1}`))
          .expect(200);
      }
      await request(http)
        .get('/sonde')
        .set('X-Forwarded-For', chaine(ip, '10.0.0.250'))
        .expect(429);

      // Même refus avec une chaîne forgée plus longue, et avec une IP privée
      // ou une adresse volontairement identique à une autre victime.
      await request(http)
        .get('/sonde')
        .set('X-Forwarded-For', chaine(ip, `${AUTRE_IP_REELLE}, 172.16.0.1, 8.8.8.8`))
        .expect(429);
    });
  });

  describe('quota par utilisateur (S16a) — inchangé par le passage par IP réelle', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await monter(ModuleParUtilisateur, true);
    });
    afterAll(async () => {
      await app.close();
    });

    it('deux utilisateurs derrière la MÊME IP gardent des quotas séparés', async () => {
      const http = app.getHttpServer() as never;
      const appel = (utilisateur: string): request.Test =>
        request(http)
          .get('/sonde-utilisateur')
          .set('X-Forwarded-For', chaine(IP_REELLE))
          .set('x-test-user', utilisateur);

      for (let i = 0; i < LIMITE; i += 1) await appel('u-alice').expect(200);
      await appel('u-alice').expect(429);
      // Un bureau partagé (une seule IP publique) ne doit pas faire tomber le
      // quota IA de tous ses postes parce qu'un seul l'a consommé.
      await appel('u-bob').expect(200);
    });

    it('un même utilisateur ne regagne pas de quota en changeant d’IP', async () => {
      const http = app.getHttpServer() as never;
      const appel = (ip: string): request.Test =>
        request(http)
          .get('/sonde-utilisateur')
          .set('X-Forwarded-For', chaine(ip))
          .set('x-test-user', 'u-carol');

      for (let i = 0; i < LIMITE; i += 1) await appel(IP_REELLE).expect(200);
      // Le quota est facturé (OpenAI, ADR-0008) : il suit l'utilisateur, pas le
      // réseau depuis lequel il appelle.
      await appel(AUTRE_IP_REELLE).expect(429);
    });
  });

  describe('témoin : sans la chaîne de confiance, le seau redevient global', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await monter(ModuleParIp, false);
    });
    afterAll(async () => {
      await app.close();
    });

    it('reproduit le finding F-03 : une IP jamais vue reçoit 429', async () => {
      const http = app.getHttpServer() as never;

      for (let i = 0; i < LIMITE; i += 1) {
        await request(http).get('/sonde').set('X-Forwarded-For', chaine(IP_REELLE)).expect(200);
      }
      // Sans `trust proxy`, toutes les requêtes sont comptées sur l'adresse du
      // socket : le seau est commun. Ce 429-là est le bug, pas la protection.
      await request(http).get('/sonde').set('X-Forwarded-For', chaine(AUTRE_IP_REELLE)).expect(429);
    });
  });
});
