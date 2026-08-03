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

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  await app.listen(env.API_PORT, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`✅ API Lalanda écoute sur ${env.API_URL}`);
}

void bootstrap();
