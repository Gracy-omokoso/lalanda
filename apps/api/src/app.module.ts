import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';

import { AccountModule } from './account/account.module.js';
import { ActualsModule } from './actuals/actuals.module.js';
import { AiModule } from './ai/ai.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthzModule } from './authz/authz.module.js';
import { BillingModule } from './billing/billing.module.js';
import { CanvasModule } from './canvas/canvas.module.js';
import { EvaluateController } from './evaluate/evaluate.controller.js';
import { HealthController } from './health/health.controller.js';
import { ObjectivesModule } from './objectives/objectives.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { ParameterPacksModule } from './parameter-packs/parameter-packs.module.js';
import { PlansModule } from './plans/plans.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ThrottlingModule } from './security/throttling.module.js';

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
        autoIndex: process.env['NODE_ENV'] !== 'production',
        serverSelectionTimeoutMS: 8000,
        bufferCommands: false,
      }),
    }),
    ThrottlingModule,
    OrganizationsModule,
    AuthModule,
    AccountModule,
    AuthzModule,
    BillingModule,
    ParameterPacksModule,
    ProjectsModule,
    PlansModule,
    ActualsModule,
    CanvasModule,
    ObjectivesModule,
    ReportsModule,
    AiModule,
  ],
  controllers: [HealthController, EvaluateController],
})
export class AppModule {}
