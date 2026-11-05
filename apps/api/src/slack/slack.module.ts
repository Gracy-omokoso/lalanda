// Module Slack — ADR-0064.
//
// Exporte `SlackNotifier` (sous le jeton `SLACK_NOTIFIER`, consommé en FACULTATIF par
// `WorkNotifier`) et `SlackProjectChannelsService` (réglage du canal d'un projet, routé
// par le module `work` sous sa garde de visibilité). Ne dépend pas du module `work` :
// il lit le nom et la visibilité d'un projet en lecture seule par la connexion.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { IntegrationsModule } from '../integrations/integrations.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { SlackApi } from './slack-api.js';
import { SlackConnectionsService } from './slack-connections.service.js';
import { SLACK_NOTIFIER, SlackNotifier } from './slack-notifier.service.js';
import { SlackProjectChannelsService } from './slack-project-channels.service.js';
import { SlackController } from './slack.controller.js';
import { WorkSlackController } from './work-slack.controller.js';
import {
  SlackConnection,
  SlackConnectionSchema,
  SlackProjectChannel,
  SlackProjectChannelSchema,
  SlackUserLink,
  SlackUserLinkSchema,
} from './slack.schemas.js';

@Module({
  imports: [
    OrganizationsModule,
    IntegrationsModule,
    MongooseModule.forFeature([
      { name: SlackConnection.name, schema: SlackConnectionSchema },
      { name: SlackUserLink.name, schema: SlackUserLinkSchema },
      { name: SlackProjectChannel.name, schema: SlackProjectChannelSchema },
    ]),
  ],
  controllers: [WorkSlackController, SlackController],
  providers: [
    SlackApi,
    SlackConnectionsService,
    SlackNotifier,
    { provide: SLACK_NOTIFIER, useExisting: SlackNotifier },
    SlackProjectChannelsService,
  ],
  exports: [SLACK_NOTIFIER, SlackNotifier, SlackProjectChannelsService, SlackApi],
})
export class SlackModule {}
