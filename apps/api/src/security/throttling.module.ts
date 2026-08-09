// Module de rate limiting (S16a, docs/17-SECURITE.md « limitation de débit et quotas »).
//
// - Guard global (APP_GUARD ClientIpThrottlerGuard) : 100 req/min par IP CLIENTE
//   sur toutes les routes Nest. « Cliente » et non « vue par l'API » : derrière
//   Caddy les deux diffèrent, et c'était tout le finding F-03 (S22f) — le seau
//   était de fait partagé par tous les clients. Voir `trusted-proxy.ts` pour la
//   chaîne de confiance qui rend cette distinction possible.
//   NB : les routes better-auth (/auth/*) sont montées en middleware Express dans main.ts
//   et ne passent PAS par ce guard — better-auth a sa propre limitation de tentatives.
// - UserThrottlerGuard : exporté pour les quotas par utilisateur au niveau route
//   (ex. POST /ai/corrective-actions, endpoint facturé OpenAI — ADR-0008).
//
// @Global : expose UserThrottlerGuard et les providers du ThrottlerModule à tous les
// modules sans réimport (même patron que AuthModule pour AuthGuard).

import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { ClientIpThrottlerGuard } from './client-ip-throttler.guard.js';
import { GLOBAL_THROTTLE } from './throttling.js';
import { UserThrottlerGuard } from './user-throttler.guard.js';

@Global()
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ...GLOBAL_THROTTLE }])],
  providers: [{ provide: APP_GUARD, useClass: ClientIpThrottlerGuard }, UserThrottlerGuard],
  exports: [UserThrottlerGuard, ThrottlerModule],
})
export class ThrottlingModule {}
