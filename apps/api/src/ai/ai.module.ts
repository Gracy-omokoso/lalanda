// Module IA (S14a — agent D). Actions correctives sur les ratios rouges/oranges.
//
// Le client OpenAI est fabriqué de façon paresseuse au boot :
// - si OPENAI_API_KEY est absente → provider = null → fallback déterministe;
// - sinon, le SDK `openai` est importé dynamiquement (l'échec d'import se rabat aussi sur null).

import { Module } from '@nestjs/common';

import { AiActionsController } from './ai-actions.controller.js';
import { AiActionsService, type OpenAIChatClient } from './ai-actions.service.js';
import { createOpenAIClient } from './openai-client.js';

export const OPENAI_CHAT_CLIENT = Symbol('OPENAI_CHAT_CLIENT');

@Module({
  controllers: [AiActionsController],
  providers: [
    {
      provide: OPENAI_CHAT_CLIENT,
      useFactory: async (): Promise<OpenAIChatClient | null> => createOpenAIClient(),
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
