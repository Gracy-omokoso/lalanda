import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';

import { EvaluateController } from './evaluate/evaluate.controller.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['LOG_LEVEL'] ?? 'info',
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          censor: '[REDACTED]',
        },
        transport:
          process.env['NODE_ENV'] === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'HH:MM:ss.l',
                  ignore: 'pid,hostname,req.headers',
                },
              },
      },
    }),
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/lalanda',
        dbName: process.env['MONGODB_DB'] ?? 'lalanda',
        // Discipline MongoDB — ADR-0004.
        autoIndex: process.env['NODE_ENV'] !== 'production',
        // Fast-fail : évite les hangs silencieux en cas d'IP non whitelistée
        // ou de réseau bloqué. 8 s < 30 s par défaut = feedback rapide en dev.
        serverSelectionTimeoutMS: 8000,
        // Ne pas mettre en file les commandes en attente de connexion : renvoie
        // une erreur immédiate côté HTTP au lieu de laisser pendre la requête.
        bufferCommands: false,
      }),
    }),
  ],
  controllers: [HealthController, EvaluateController],
})
export class AppModule {}
