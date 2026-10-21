// Limite de débit de la normalisation (ADR-0024 § 6, amendement du 21 oct. 2026).
//
// De vraies requêtes contre une petite application Nest câblée comme l'API :
// guard global par IP (ClientIpThrottlerGuard, 100 par minute), puis les guards
// de normalisation au niveau des routes. On vérifie les VALEURS de production
// (60 par heure) : 61 requêtes restent instantanées.

import 'reflect-metadata';

import {
  Controller,
  HttpCode,
  Module,
  Post,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InvoicesController } from '../sales/invoices/invoices.controller.js';
import { NormalizationController } from '../sales/normalization/normalization.controller.js';
import { ClientIpThrottlerGuard } from './client-ip-throttler.guard.js';
import {
  NORMALIZATION_RATE_LIMITED,
  OrgNormalizationThrottlerGuard,
  rateLimitMessage,
  UserNormalizationThrottlerGuard,
  waitMinutes,
} from './normalization-throttler.guard.js';
import {
  GLOBAL_THROTTLE,
  INVOICE_NORMALIZE_ORG_THROTTLE,
  INVOICE_NORMALIZE_THROTTLE,
} from './throttling.js';

@Controller('sonde')
class SondeController {
  @Post('normalize')
  @HttpCode(200)
  @UseGuards(OrgNormalizationThrottlerGuard, UserNormalizationThrottlerGuard)
  normalize(): { ok: true } {
    return { ok: true };
  }

  @Post('retry')
  @HttpCode(200)
  @UseGuards(OrgNormalizationThrottlerGuard, UserNormalizationThrottlerGuard)
  retry(): { ok: true } {
    return { ok: true };
  }

  @Post('check')
  @HttpCode(200)
  @UseGuards(UserNormalizationThrottlerGuard)
  check(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ...GLOBAL_THROTTLE }])],
  controllers: [SondeController],
  providers: [
    { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
    OrgNormalizationThrottlerGuard,
    UserNormalizationThrottlerGuard,
  ],
})
class ModuleSonde {}

const LIMITE = INVOICE_NORMALIZE_ORG_THROTTLE.limit;

describe('limite de débit de la normalisation (ADR-0024 § 6)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(ModuleSonde, { logger: false });
    // Tient lieu d'AuthGuard : pose `req.user` et `req.orgId`.
    app.use((req: Record<string, unknown>, _res: unknown, next: () => void) => {
      const headers = req['headers'] as Record<string, string | undefined>;
      if (headers['x-user']) req['user'] = { id: headers['x-user'] };
      if (headers['x-org']) req['orgId'] = headers['x-org'];
      next();
    });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    (app.get(ThrottlerStorage) as unknown as { storage: Map<string, unknown> }).storage.clear();
  });

  // Le guard global (100 par minute et par IP) reste câblé : chaque test reste
  // sous 100 requêtes (compteurs vidés entre les tests), il ne répond donc
  // jamais 429 à la place des guards de normalisation.
  const appel = (route: string, org: string, user: string): request.Test =>
    request(app.getHttpServer() as never)
      .post(`/sonde/${route}`)
      .set('x-org', org)
      .set('x-user', user);

  it('les constantes : 60 par heure, par organisation et par utilisateur', () => {
    expect(INVOICE_NORMALIZE_ORG_THROTTLE).toEqual({ ttl: 3_600_000, limit: 60 });
    expect(INVOICE_NORMALIZE_THROTTLE).toEqual({ ttl: 3_600_000, limit: 60 });
  });

  it('61ᵉ envoi d’une organisation dans l’heure : 429 en français, code et délai', async () => {
    // Trois personnes : le plafond est celui de l'organisation, pas le leur.
    for (let i = 0; i < LIMITE; i += 1) await appel('normalize', 'org-a', `u${i % 3}`).expect(200);
    const res = await appel('normalize', 'org-a', 'u-nouveau').expect(429);
    expect(res.body).toMatchObject({
      code: NORMALIZATION_RATE_LIMITED,
      details: { scope: 'organization', limit: 60 },
    });
    expect(res.body.message).toMatch(
      /^Votre organisation a atteint la limite de 60 normalisations par heure auprès de la DGI\. Réessayez dans \d+ minutes?\.$/,
    );
    expect(res.body.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.headers['retry-after-normalization']).toBeDefined();
  });

  it('« Réessayer » consomme le même seau que « Normaliser »', async () => {
    for (let i = 0; i < LIMITE / 2; i += 1)
      await appel('normalize', 'org-b', `u${i % 3}`).expect(200);
    for (let i = 0; i < LIMITE / 2; i += 1) await appel('retry', 'org-b', `v${i % 3}`).expect(200);
    await appel('retry', 'org-b', 'w').expect(429);
    await appel('normalize', 'org-b', 'w').expect(429);
  });

  it('une organisation au plafond ne gêne pas les autres', async () => {
    for (let i = 0; i < LIMITE; i += 1) await appel('normalize', 'org-c', `u${i % 3}`).expect(200);
    await appel('normalize', 'org-c', 'u0').expect(429);
    await appel('normalize', 'org-d', 'u0').expect(200);
  });

  it('la vérification (check) n’entame pas le seau de l’organisation', async () => {
    for (let i = 0; i < LIMITE; i += 1) await appel('check', 'org-e', 'u0').expect(200);
    await appel('normalize', 'org-e', 'u1').expect(200);
  });

  it('plafond par personne : 61ᵉ vérification d’un même utilisateur → 429 « Vous avez… »', async () => {
    for (let i = 0; i < INVOICE_NORMALIZE_THROTTLE.limit; i += 1) {
      // Organisations différentes : seul le seau de l'utilisateur se remplit.
      await appel('check', `org-f${i}`, 'u-pressé').expect(200);
    }
    const res = await appel('check', 'org-g', 'u-pressé').expect(429);
    expect(res.body).toMatchObject({
      code: NORMALIZATION_RATE_LIMITED,
      details: { scope: 'user', limit: 60 },
    });
    expect(res.body.message).toMatch(
      /^Vous avez atteint la limite de 60 demandes de normalisation/,
    );
    await appel('check', 'org-g', 'u-calme').expect(200);
  });

  it('message : minutes arrondies au-dessus, au moins une, accord du pluriel', () => {
    expect(waitMinutes(0)).toBe(1);
    expect(waitMinutes(61)).toBe(2);
    expect(rateLimitMessage('organization', 30)).toMatch(/Réessayez dans 1 minute\.$/);
    expect(rateLimitMessage('user', 3600)).toMatch(/Réessayez dans 60 minutes\.$/);
  });
});

describe('câblage des routes réelles', () => {
  const guardsOf = (target: object, method: string): unknown[] =>
    (Reflect.getMetadata(
      '__guards__',
      (target as Record<string, unknown>)[method] as object,
    ) as unknown[]) ?? [];

  it('POST …/normalize et …/normalization/retry : organisation puis utilisateur', () => {
    for (const [proto, method] of [
      [InvoicesController.prototype, 'normalize'],
      [NormalizationController.prototype, 'retry'],
    ] as const) {
      expect(guardsOf(proto, method), method).toEqual([
        OrgNormalizationThrottlerGuard,
        UserNormalizationThrottlerGuard,
      ]);
    }
  });

  it('POST …/normalization/check : utilisateur seulement', () => {
    expect(guardsOf(NormalizationController.prototype, 'check')).toEqual([
      UserNormalizationThrottlerGuard,
    ]);
  });

  it('aucun @Throttle sur ces routes : le guard global par IP garde sa règle', () => {
    for (const [proto, method] of [
      [InvoicesController.prototype, 'normalize'],
      [NormalizationController.prototype, 'retry'],
      [NormalizationController.prototype, 'check'],
    ] as const) {
      const handler = (proto as unknown as Record<string, object>)[method]!;
      const keys = Reflect.getMetadataKeys(handler) as string[];
      expect(
        keys.filter((k) => String(k).startsWith('THROTTLER:')),
        method,
      ).toEqual([]);
    }
  });
});
