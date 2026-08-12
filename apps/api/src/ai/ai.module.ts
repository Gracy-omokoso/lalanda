// Module IA (S14a — agent D). Actions correctives sur les ratios rouges/oranges.
//
// Le SDK `openai` est importé dynamiquement au boot (un échec d'import se rabat
// sur `null` → fallback déterministe). La CLÉ, elle, est résolue à chaque appel
// par `SecretsService` : base d'abord, environnement en secours (S21b —
// ADR-0013 option C, « chemin de migration borné »). Le fallback déterministe
// reste le comportement quand aucune source ne fournit de clé.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccountModule } from '../account/account.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { BillingService } from '../billing/billing.service.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SecretsService } from '../integrations/secrets.service.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { AiActionsController } from './ai-actions.controller.js';
import { AiActionsService, type OpenAIChatClient } from './ai-actions.service.js';
import { AiQuotaService } from './ai-quota.service.js';
import { LalaVocalController } from './lala-vocal.controller.js';
import { LalaVocalService } from './lala-vocal.service.js';
import { LalaVocalUsageService } from './lala-vocal-usage.service.js';
import { LalaVocalSession, LalaVocalSessionSchema } from './lala-vocal-usage.schema.js';
import { LalaController } from './lala.controller.js';
import { LalaService } from './lala.service.js';
import { createOpenAIClient } from './openai-client.js';

export const OPENAI_CHAT_CLIENT = Symbol('OPENAI_CHAT_CLIENT');

@Module({
  // OrganizationsModule : requis pour instancier AuthGuard (dépend d'OrganizationsService)
  // dans le contexte de ce module (S16a — /ai devient authentifié).
  // AccountModule : `LalaController` lit la langue dans les préférences de
  // l'utilisateur plutôt que dans le corps de la requête (S24a).
  //
  // BillingModule : `AiQuotaService` a besoin du plan et des entitlements de
  // l'organisation pour connaître SA limite. Aucun cycle — `billing/` ne connaît
  // pas `ai/`, et la règle de quota elle-même (`billing/ai-quota.ts`) est pure.
  //
  // `MongooseModule.forFeature` : les minutes vocales vivent dans LEUR collection
  // (`lala_vocal_sessions`). Les écrire dans `ai_usage_events` ferait décompter
  // un message texte par appel vocal — voir `lala-vocal-quota.ts`.
  imports: [
    OrganizationsModule,
    IntegrationsModule,
    AdminModule,
    AccountModule,
    BillingModule,
    MongooseModule.forFeature([{ name: LalaVocalSession.name, schema: LalaVocalSessionSchema }]),
  ],
  controllers: [AiActionsController, LalaController, LalaVocalController],
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
    {
      // Même client, même politique de repli : Lala et les actions correctives
      // ne doivent pas pouvoir diverger sur « l'IA est-elle disponible ? ».
      provide: LalaService,
      useFactory: (client: OpenAIChatClient | null) => new LalaService(client),
      inject: [OPENAI_CHAT_CLIENT],
    },
    AiQuotaService,
    LalaVocalUsageService,
    // Fabrique explicite plutôt qu'injection par décorateur : `LalaVocalService`
    // porte deux paramètres à valeur par défaut (le client HTTP et
    // l'environnement) que les tests remplacent. Les déclarer ici, une fois,
    // évite d'avoir à décorer des paramètres qui n'ont pas de jeton Nest.
    {
      provide: LalaVocalService,
      useFactory: (
        secrets: SecretsService,
        billing: BillingService,
        usage: LalaVocalUsageService,
      ) => new LalaVocalService(secrets, billing, usage),
      inject: [SecretsService, BillingService, LalaVocalUsageService],
    },
  ],
  // `AiQuotaService` est exporté : c'est le point d'entrée que tout nouvel usage
  // de l'IA (assistant, interprétations, chat) doit appeler au lieu d'écrire sa
  // propre limite. Voir l'encadré en tête de `ai-quota.service.ts`.
  exports: [AiActionsService, LalaService, AiQuotaService, LalaVocalService],
})
export class AiModule {}
