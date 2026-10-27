// Business plan narratif (ADR-0037).
//
// Lit le projet, le Canvas et le plan figé (lecture seule), réutilise l'IA
// existante (client OpenAI partagé, quota commun), le rendu PDF partagé et le
// quota d'exports. N'écrit que dans ses propres collections.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AiModule, OPENAI_CHAT_CLIENT } from '../ai/ai.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { CanvasModule } from '../canvas/canvas.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { PdfModule } from '../reports/pdf.module.js';
import { BusinessPlanAiService, BUSINESS_PLAN_CHAT_CLIENT } from './business-plan-ai.service.js';
import { BusinessPlanOrgController } from './business-plan-org.controller.js';
import { BusinessPlanOverviewService } from './business-plan-overview.service.js';
import { BusinessPlanController } from './business-plan.controller.js';
import {
  BusinessPlan,
  BusinessPlanAiLog,
  BusinessPlanAiLogSchema,
  BusinessPlanSchema,
  BusinessPlanSettings,
  BusinessPlanSettingsSchema,
  BusinessPlanVersion,
  BusinessPlanVersionSchema,
} from './business-plan.schemas.js';
import { BusinessPlanService } from './business-plan.service.js';

@Module({
  imports: [
    // `AuthGuard` dépend d'OrganizationsService.
    OrganizationsModule,
    ProjectsModule,
    PlansModule,
    CanvasModule,
    // `AiQuotaService` et le client OpenAI partagé.
    AiModule,
    // Entitlements (filigrane) et quota d'exports PDF.
    BillingModule,
    // Chromium partagé (ADR-0025 § O1).
    PdfModule,
    MongooseModule.forFeature([
      { name: BusinessPlan.name, schema: BusinessPlanSchema },
      { name: BusinessPlanVersion.name, schema: BusinessPlanVersionSchema },
      { name: BusinessPlanSettings.name, schema: BusinessPlanSettingsSchema },
      { name: BusinessPlanAiLog.name, schema: BusinessPlanAiLogSchema },
    ]),
  ],
  controllers: [BusinessPlanController, BusinessPlanOrgController],
  providers: [
    BusinessPlanService,
    BusinessPlanAiService,
    BusinessPlanOverviewService,
    { provide: BUSINESS_PLAN_CHAT_CLIENT, useExisting: OPENAI_CHAT_CLIENT },
  ],
})
export class BusinessPlanModule {}
