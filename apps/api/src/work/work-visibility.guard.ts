// Garde de visibilité des projets — ADR-0060 § 5.
//
// Posé APRÈS `AuthGuard` et `PermissionsGuard` sur tous les contrôleurs du module
// « work » (`@UseGuards(AuthGuard, PermissionsGuard, WorkVisibilityGuard)`). Il lit
// les identifiants de la route et de la requête — `projectId`, `taskId`, `commentId`,
// `attachmentId`, `entryId` — et répond 404 (jamais 403) quand la ressource appartient
// à un projet hors de la portée de l'appelant : un projet privé n'existe pas pour qui
// n'en est pas membre. Les LISTES (projets, portefeuille, tâches, Mes tâches, temps)
// appliquent en plus la portée dans leur service.

import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { NO_OVERRIDES } from '../authz/permissions.js';
import {
  attachmentNotFound,
  commentNotFound,
  timeEntryNotFound,
  type WorkActor,
} from './work.common.js';
import { WorkAccessService } from './work-access.service.js';

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v.toLowerCase() : null;
}

@Injectable()
export class WorkVisibilityGuard implements CanActivate {
  constructor(@Inject(WorkAccessService) private readonly access: WorkAccessService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const orgId = req.orgId;
    const userId = req.user?.id;
    if (!orgId || !userId) return true; // AuthGuard a déjà refusé
    const actor: WorkActor = {
      userId,
      role: req.orgRole,
      context: req.orgRoleContext ?? NO_OVERRIDES,
    };
    const params = (req.params ?? {}) as Record<string, unknown>;
    const query = (req.query ?? {}) as Record<string, unknown>;

    const projectIds = [str(params['projectId']), str(query['projectId'])];
    for (const id of projectIds) if (id) await this.access.assertProject(orgId, id, actor);
    const taskIds = [str(params['taskId']), str(query['taskId'])];
    for (const id of taskIds) if (id) await this.access.assertTask(orgId, id, actor);
    const commentId = str(params['commentId']);
    if (commentId) {
      await this.access.assertAttached('comment', orgId, commentId, actor, commentNotFound);
    }
    const attachmentId = str(params['attachmentId']);
    if (attachmentId) {
      await this.access.assertAttached('attachment', orgId, attachmentId, actor, attachmentNotFound);
    }
    const entryId = str(params['entryId']);
    if (entryId) {
      await this.access.assertAttached('timeEntry', orgId, entryId, actor, timeEntryNotFound);
    }
    return true;
  }
}
