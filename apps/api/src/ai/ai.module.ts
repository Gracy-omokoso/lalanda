// Module IA (S14a — agent D). Actions correctives sur les ratios rouges/oranges.
//
// Le SDK `openai` est importé dynamiquement au boot (un échec d'import se rabat
// sur `null` → fallback déterministe). La CLÉ, elle, est résolue à chaque appel
// par `SecretsService` : base d'abord, environnement en secours (S21b —
// ADR-0013 option C, « chemin de migration borné »). Le fallback déterministe
// reste le comportement quand aucune source ne fournit de clé.

import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SecretsService } from '../integrations/secrets.service.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { AiActionsController } from './ai-actions.controller.js';
import { AiActionsService, type OpenAIChatClient } from './ai-actions.service.js';
import { createOpenAIClient } from './openai-client.js';

export const OPENAI_CHAT_CLIENT = Symbol('OPENAI_CHAT_CLIENT');

@Module({
  // OrganizationsModule : requis pour instancier AuthGuard (dépend d'OrganizationsService)
  // dans le contexte de ce module (S16a — /ai devient authentifié).
  imports: [OrganizationsModule, IntegrationsModule, AdminModule],
  controllers: [AiActionsController],
  providers: [
    {
      provide: OPENAI_CHAT_CLIENT,
      useFactory: async (secrets: SecretsService): Promise<OpenAIChatClient | null> =>
        createOpenAIClient(async () => {
          const resolved = await secrets.resolve('openai', 'apiKey');
          // `expose()` est le seul chemin légitime hors de l'enveloppe `Secret` :
          // la valeur part directement au SDK, qui a besoin d'une chaîne.
          return resolved ? resolved.secret.expose() : null;
        }),
      inject: [SecretsService],
    },
    {
      provide: AiActionsService,
      useFactory: (client: OpenAIChatClient | null) => new AiActionsService(client),
      inject: [OPENAI_CHAT_CLIENT],
    },
  ],
  exports: [AiActionsService],
})
export class AiModule {}
