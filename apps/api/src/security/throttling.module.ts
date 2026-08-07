// Module de rate limiting (S16a, docs/17-SECURITE.md « limitation de débit et quotas »).
//
// - Guard global (APP_GUARD ThrottlerGuard) : 100 req/min/IP sur toutes les routes Nest.
//   NB : les routes better-auth (/auth/*) sont montées en middleware Express dans main.ts
//   et ne passent PAS par ce guard — better-auth a sa propre limitation de tentatives.
// - UserThrottlerGuard : exporté pour les quotas par utilisateur au niveau route
//   (ex. POST /ai/corrective-actions, endpoint facturé OpenAI — ADR-0008).
//
// @Global : expose UserThrottlerGuard et les providers du ThrottlerModule à tous les
// modules sans réimport (même patron que AuthModule pour AuthGuard).

import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { GLOBAL_THROTTLE } from './throttling.js';
import { UserThrottlerGuard } from './user-throttler.guard.js';

@Global()
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ...GLOBAL_THROTTLE }])],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }, UserThrottlerGuard],
  exports: [UserThrottlerGuard, ThrottlerModule],
})
export class ThrottlingModule {}
