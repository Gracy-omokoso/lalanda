// Canal Slack d'un projet — ADR-0064 § 3.
//
// Facultatif. Réglé par un gestionnaire (`work.manage`) qui VOIT le projet (garde de
// visibilité du module `work`, en amont). Un projet PRIVÉ ne publie dans un canal que
// si le gestionnaire l'a confirmé explicitement : tout le canal verra les événements.
// La confirmation est relue à CHAQUE envoi (`SlackNotifier`) : un projet passé en privé
// après coup cesse de publier tant que personne ne reconfirme.

import type {
  PutWorkProjectSlackChannelBody,
  WorkProjectSlackChannelView,
} from '@lalanda/shared/work';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../authz/audit.service.js';
import { SlackConnectionsService } from './slack-connections.service.js';
import type { SlackProjectChannelLean } from './slack.schemas.js';

export interface SlackProjectRef {
  organizationId: string;
  projectId: string;
  visibility: 'organization' | 'private';
}

@Injectable()
export class SlackProjectChannelsService {
  constructor(
    @Inject(SlackConnectionsService) private readonly connections: SlackConnectionsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async get(project: SlackProjectRef, canManage: boolean): Promise<WorkProjectSlackChannelView> {
    const [connected, doc] = await Promise.all([
      this.connections.isActive(project.organizationId),
      this.connections.channelModel
        .findOne({ organizationId: project.organizationId, projectId: project.projectId })
        .lean<SlackProjectChannelLean>()
        .exec(),
    ]);
    const projectPrivate = project.visibility === 'private';
    return {
      connected,
      projectPrivate,
      channel: doc
        ? {
            id: doc.channelId,
            name: doc.channelName,
            privateConfirmed: doc.privateConfirmed,
            setAt: doc.setAt.toISOString(),
          }
        : null,
      publishing: connected && doc !== null && (!projectPrivate || doc.privateConfirmed),
      canManage,
    };
  }

  async put(
    project: SlackProjectRef,
    body: PutWorkProjectSlackChannelBody,
    actor: { userId: string; role: string },
  ): Promise<WorkProjectSlackChannelView> {
    const { organizationId, projectId } = project;
    if (body.channelId === null) {
      const res = await this.connections.channelModel
        .deleteOne({ organizationId, projectId })
        .exec();
      if (res.deletedCount > 0) {
        await this.audit.record({
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'slack.project_channel_removed',
          targetType: 'work_project',
          targetId: projectId,
        });
      }
      return this.get(project, true);
    }
    if (!(await this.connections.isActive(organizationId))) {
      throw new ConflictException({
        code: 'SLACK_NOT_CONNECTED',
        message:
          'Connectez d’abord l’espace Slack de l’organisation (Projets › Paramètres › Slack).',
      });
    }
    const projectPrivate = project.visibility === 'private';
    if (projectPrivate && body.confirmPrivate !== true) {
      throw new BadRequestException({
        code: 'SLACK_PRIVATE_PROJECT_CONFIRMATION_REQUIRED',
        message: 'Ce projet est privé : confirmez que tout le canal Slack verra ses événements.',
      });
    }
    const channelName = body.channelName?.replace(/^#/, '').trim() || null;
    await this.connections.channelModel
      .updateOne(
        { organizationId, projectId },
        {
          $set: {
            channelId: body.channelId,
            channelName,
            privateConfirmed: projectPrivate && body.confirmPrivate === true,
            setByUserId: actor.userId,
            setAt: new Date(),
          },
        },
        { upsert: true },
      )
      .exec();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'slack.project_channel_set',
      targetType: 'work_project',
      targetId: projectId,
      metadata: {
        channelId: body.channelId,
        privateConfirmed: projectPrivate && body.confirmPrivate === true,
      },
    });
    return this.get(project, true);
  }
}
