// Bootstrap NestJS. Valide l'env AVANT tout démarrage (brief §9-4, ADR-0002).

// dotenv d'abord (accepte les commentaires unicode, contrairement à --env-file de Node).
// Chemin explicite : le .env vit à la racine du monorepo, on démarre depuis apps/api.
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
loadDotenv({ path: envPath });

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import helmet from 'helmet';
import { ApiEnvSchema, parseEnv } from '@lalanda/shared';

import { AppModule } from './app.module.js';
import { getAuth } from './auth/auth.js';

async function bootstrap(): Promise<void> {
  const env = parseEnv(ApiEnvSchema, process.env);

  const app = await NestFactory.create(AppModule);

  // Headers de sécurité (S16a, docs/17-SECURITE.md) — défauts helmet :
  // X-Content-Type-Options, X-Frame-Options/frame-ancestors via CSP, HSTS, etc.
  // Les réponses JSON de l'API ne servent aucun document HTML : les défauts suffisent,
  // et les fetch CORS du front (mode 'cors' + credentials) ne sont pas affectés.
  app.use(helmet());

  // CORS — apps/web (:3000) doit pouvoir envoyer cookies (credentials: true).
  app.enableCors({
    origin: [env.WEB_URL],
    credentials: true,
  });

  // Monte better-auth : `.all('/auth/*', ...)` sur l'app Express sous-jacente
  // préserve `req.url` (contrairement à `app.use('/auth', ...)` qui strippe le prefix
  // et empêche better-auth de matcher son basePath).
  const expressApp = app.getHttpAdapter().getInstance() as {
    all: (path: string, ...handlers: unknown[]) => void;
  };
  expressApp.all('/auth/*', toNodeHandler(getAuth()));

  await app.listen(env.API_PORT, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`✅ API Lalanda écoute sur ${env.API_URL}`);
}

void bootstrap();
