import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';

import { AccountModule } from './account/account.module.js';
import { AdminModule } from './admin/admin.module.js';
import { ActualsModule } from './actuals/actuals.module.js';
import { AiModule } from './ai/ai.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthzModule } from './authz/authz.module.js';
import { BillingModule } from './billing/billing.module.js';
import { BrandingModule } from './branding/branding.module.js';
import { CanvasModule } from './canvas/canvas.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EdefModule } from './edef/edef.module.js';
import { EvaluateController } from './evaluate/evaluate.controller.js';
import { FiscalModule } from './fiscal/fiscal.module.js';
import { HealthController } from './health/health.controller.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { LegalModule } from './legal/legal.module.js';
import { MailModule } from './mail/mail.module.js';
import { ObjectivesModule } from './objectives/objectives.module.js';
import { OrganizationSpaceModule } from './organization-space/organization-space.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { ParameterPacksModule } from './parameter-packs/parameter-packs.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PlansModule } from './plans/plans.module.js';
import { PlatformConfigModule } from './platform-config/platform-config.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SalesModule } from './sales/sales.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';
import { ThrottlingModule } from './security/throttling.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TreasuryModule } from './treasury/treasury.module.js';

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
    // S25a — index de production, puis ordonnanceur (@Global) : les modules
    // métier y enregistrent leurs tâches dans leur `onModuleInit`.
    DatabaseModule,
    SchedulerModule,
    ThrottlingModule,
    // `MailModule` est @Global et sans dépendance : déclaré avant `AuthModule`,
    // dont la factory better-auth injecte `MailService` au bootstrap (S22a).
    MailModule,
    // `StorageModule` est @Global et sans dépendance, comme `MailModule` :
    // déclaré avant ses consommateurs (AccountModule pour la photo de profil ;
    // exports et instantanés plus tard — docs/24).
    StorageModule,
    // ADR-0021 §5 — paramètres plateforme DGI, @Global et sans dépendance : une
    // variable `DGI_*` invalide fait échouer le démarrage ici.
    PlatformConfigModule,
    OrganizationsModule,
    OrganizationSpaceModule,
    AuthModule,
    AccountModule,
    AuthzModule,
    BillingModule,
    PaymentsModule,
    ParameterPacksModule,
    ProjectsModule,
    PlansModule,
    ActualsModule,
    CanvasModule,
    ObjectivesModule,
    ReportsModule,
    // S21b — avant AiModule, qui consomme `SecretsService` et `AiUsageService`.
    IntegrationsModule,
    AdminModule,
    AiModule,
    LegalModule,
    // ADR-0021 — client e-MCF, puis identité fiscale et facture normalisée.
    EdefModule,
    FiscalModule,
    // ADR-0028 — identité visuelle (logos, couleurs, police), avant les ventes.
    BrandingModule,
    // ADR-0022 — clients et catalogue (lot S25c).
    SalesModule,
    // ADR-0034 : dépenses, comptes de trésorerie, prévision et report au réalisé.
    TreasuryModule,
  ],
  controllers: [HealthController, EvaluateController],
})
export class AppModule {}
