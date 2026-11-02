// Journal plateforme et événements de sécurité de la console (ADR-0053 § 6.5 — lot P5).
//
// Importé par `AdminModule` (un bloc, à la fin). Relève les événements de sécurité sur
// TOUTES les réponses Nest (`SecurityEventsMiddleware`) : la classification ne retient
// que la console, les deux routes de ré-authentification et le refus `ACCOUNT_BLOCKED`.

import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { PlatformAuditExportThrottlerGuard } from './audit-export-throttler.guard.js';
import {
  PlatformSecurityCounter,
  PlatformSecurityCounterSchema,
} from './security-counter.schema.js';
import { SecurityEventsMiddleware } from './security-events.middleware.js';
import { SecurityEventsService } from './security-events.service.js';

@Module({
  imports: [
    // `PlatformAuditService` (journal partagé) et `ReauthService`.
    IntegrationsModule,
    MongooseModule.forFeature([
      { name: PlatformSecurityCounter.name, schema: PlatformSecurityCounterSchema },
    ]),
  ],
  controllers: [AdminAuditController],
  providers: [SecurityEventsService, SecurityEventsMiddleware, PlatformAuditExportThrottlerGuard],
})
export class AdminAuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityEventsMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
