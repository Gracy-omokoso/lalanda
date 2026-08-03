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
import { ApiEnvSchema, parseEnv } from '@lalanda/shared';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const env = parseEnv(ApiEnvSchema, process.env);

  // Logs visibles dès le démarrage — évite les silent-hangs (ex : Mongo IP non whitelistée).
  const app = await NestFactory.create(AppModule);

  // CORS pour permettre à apps/web de :3000 d'appeler l'API sur :3001.
  app.enableCors({
    origin: [env.WEB_URL ?? 'http://localhost:3000'],
    credentials: true,
  });

  await app.listen(env.API_PORT, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`✅ API Lalanda écoute sur ${env.API_URL}`);
}

void bootstrap();
