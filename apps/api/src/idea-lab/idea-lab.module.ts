// Idea Lab et validation d'idée (ADR-0036) — l'amont de BUILD.
//
// Réutilise : la création de projet et le Canvas existants (promotion, § 3),
// l'IA existante (client OpenAI partagé, quota commun, vérificateur de nombres,
// § 4). Exporte `IdeaLabService` pour que GROW lise les faits du parcours (§ 5).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AiModule, OPENAI_CHAT_CLIENT } from '../ai/ai.module.js';
import { CanvasModule } from '../canvas/canvas.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { IDEA_LAB_CHAT_CLIENT, IdeaLabAiService } from './idea-lab-ai.service.js';
import { IdeaLabController } from './idea-lab.controller.js';
import {
  IdeaLabAiLog,
  IdeaLabAiLogSchema,
  IdeaLabIdea,
  IdeaLabIdeaSchema,
  IdeaLabSettings,
  IdeaLabSettingsSchema,
} from './idea-lab.schemas.js';
import { IdeaLabService } from './idea-lab.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via OrganizationsService.
    OrganizationsModule,
    // `AiQuotaService` et le client OpenAI partagé.
    AiModule,
    // `ProjectsService.findScoped` (projet de l'organisation, sinon 404).
    ProjectsModule,
    // `CanvasService.replace` : version et révision comme toute écriture du Canvas.
    CanvasModule,
    MongooseModule.forFeature([
      { name: IdeaLabIdea.name, schema: IdeaLabIdeaSchema },
      { name: IdeaLabSettings.name, schema: IdeaLabSettingsSchema },
      { name: IdeaLabAiLog.name, schema: IdeaLabAiLogSchema },
    ]),
  ],
  controllers: [IdeaLabController],
  providers: [
    IdeaLabService,
    IdeaLabAiService,
    { provide: IDEA_LAB_CHAT_CLIENT, useExisting: OPENAI_CHAT_CLIENT },
  ],
  exports: [IdeaLabService],
})
export class IdeaLabModule {}
