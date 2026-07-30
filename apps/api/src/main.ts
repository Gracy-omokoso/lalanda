// Bootstrap NestJS. Valide l'env AVANT tout démarrage (brief §9-4, ADR-0002).

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ApiEnvSchema, parseEnv } from '@lalanda/shared';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const env = parseEnv(ApiEnvSchema, process.env);

  const app = await NestFactory.create(AppModule, {
    // Logger géré par nestjs-pino (voir AppModule).
    bufferLogs: true,
  });

  await app.listen(env.API_PORT, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`✅ API Lalanda écoute sur ${env.API_URL}`);
}

void bootstrap();
