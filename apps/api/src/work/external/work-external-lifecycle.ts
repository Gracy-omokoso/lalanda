// Cycle de vie des accès externes — ADR-0078 § 3.1.
//
// Un accès externe se ferme AUTOMATIQUEMENT :
//   - à l'archivage (ou à la suppression) du projet → `project_archived` ;
//   - au retrait du membre externe → `member_removed` (service des membres externes) ;
//   - à la désactivation de la fiche client ou fournisseur → constaté à chaque requête de
//     l'espace externe et à chaque demande de code (`customer_inactive`, `supplier_inactive`).
// Un compte qui n'a plus aucun accès ouvert voit ses sessions RÉVOQUÉES. Tout est audité,
// avec des identifiants seulement (aucun nom, aucune adresse).
//
// Fourni par `WorkModule` (l'archivage y vit) ; aucune dépendance vers le module des
// membres externes, qui l'utilise lui aussi.

import type { WorkExternalCloseReason } from '@lalanda/shared/work';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import {
  WorkExternalAccount,
  WorkExternalMembership,
  WorkExternalSession,
  type WorkExternalAccountDocument,
  type WorkExternalAccountLean,
  type WorkExternalMembershipDocument,
  type WorkExternalSessionDocument,
} from './work-external.schemas.js';

/** Rôle inscrit dans l'audit pour un acte d'un compte externe. */
export function externalAuditRole(kind: 'client' | 'consultant'): string {
  return kind === 'client' ? 'external_client' : 'external_consultant';
}

@Injectable()
export class WorkExternalLifecycle {
  constructor(
    @InjectModel(WorkExternalAccount.name)
    private readonly accounts: Model<WorkExternalAccountDocument>,
    @InjectModel(WorkExternalMembership.name)
    private readonly memberships: Model<WorkExternalMembershipDocument>,
    @InjectModel(WorkExternalSession.name)
    private readonly sessions: Model<WorkExternalSessionDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Projets non archivés (et existants) parmi ces identifiants. */
  async openProjectIds(organizationId: string, projectIds: readonly string[]): Promise<string[]> {
    const valid = [...new Set(projectIds)].filter((id) => /^[0-9a-f]{24}$/i.test(id));
    if (valid.length === 0) return [];
    const docs = await this.connection
      .collection('work_projects')
      .find(
        {
          organizationId,
          _id: { $in: valid.map((id) => new Types.ObjectId(id)) },
          status: { $ne: 'archived' },
        },
        { projection: { _id: 1 } },
      )
      .toArray();
    return docs.map((d) => String(d['_id']));
  }

  /** Accès ouverts d'un compte : adhésions actives sur un projet non archivé. */
  async openProjectsOf(organizationId: string, accountId: string): Promise<string[]> {
    const rows = await this.memberships
      .find({ organizationId, accountId, status: 'active' }, { projectId: 1 })
      .lean<{ projectId: string }[]>()
      .exec();
    return this.openProjectIds(
      organizationId,
      rows.map((r) => r.projectId),
    );
  }

  /** Révoque toutes les sessions ouvertes d'un compte ; audité s'il y en avait. */
  async revokeSessions(
    organizationId: string,
    accountId: string,
    reason: WorkExternalCloseReason | 'logout' | 'no_access',
    actor: { userId: string; role: string },
  ): Promise<number> {
    const res = await this.sessions
      .updateMany(
        { organizationId, accountId, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: reason } },
      )
      .exec();
    if (res.modifiedCount > 0 && reason !== 'logout') {
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'work.external.sessions_revoked',
        targetType: 'work_external_account',
        targetId: accountId,
        metadata: { reason, sessions: res.modifiedCount },
      });
    }
    return res.modifiedCount;
  }

  /** Sans plus aucun accès ouvert : sessions révoquées. */
  async revokeIfNoAccess(
    organizationId: string,
    accountId: string,
    actor: { userId: string; role: string },
  ): Promise<void> {
    if ((await this.openProjectsOf(organizationId, accountId)).length > 0) return;
    await this.revokeSessions(organizationId, accountId, 'no_access', actor);
  }

  /** Ferme une adhésion (retrait, archivage) et audite. */
  async closeMembership(
    organizationId: string,
    accountId: string,
    projectId: string,
    reason: WorkExternalCloseReason,
    actor: { userId: string; role: string },
  ): Promise<boolean> {
    const res = await this.memberships
      .updateOne(
        { organizationId, accountId, projectId, status: 'active' },
        {
          $set: { status: 'closed', closedAt: new Date(), closedReason: reason },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.modifiedCount !== 1) return false;
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'work.external.access_closed',
      targetType: 'work_external_membership',
      targetId: accountId,
      metadata: { accountId, projectId, reason },
    });
    await this.revokeIfNoAccess(organizationId, accountId, actor);
    return true;
  }

  /** Archivage ou suppression d'un projet : tous ses accès externes se ferment. */
  async closeProject(
    organizationId: string,
    projectId: string,
    actor: { userId: string; role: string },
  ): Promise<void> {
    const rows = await this.memberships
      .find({ organizationId, projectId, status: 'active' }, { accountId: 1 })
      .lean<{ accountId: string }[]>()
      .exec();
    for (const r of rows) {
      await this.closeMembership(organizationId, r.accountId, projectId, 'project_archived', actor);
    }
  }

  /** Ferme un compte entier (manuel, fiche désactivée, conversion) : accès et sessions. */
  async closeAccount(
    account: WorkExternalAccountLean,
    reason: WorkExternalCloseReason,
    actor: { userId: string; role: string },
  ): Promise<void> {
    const organizationId = account.organizationId;
    const accountId = String(account._id);
    const res = await this.accounts
      .updateOne(
        { _id: account._id, organizationId, status: 'active' },
        {
          $set: {
            status: 'closed',
            closedAt: new Date(),
            closedReason: reason,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    await this.memberships
      .updateMany(
        { organizationId, accountId, status: 'active' },
        {
          $set: { status: 'closed', closedAt: new Date(), closedReason: reason },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.modifiedCount === 1) {
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'work.external.closed',
        targetType: 'work_external_account',
        targetId: accountId,
        metadata: { kind: account.kind, reason },
      });
    }
    await this.revokeSessions(organizationId, accountId, reason, actor);
  }

  /**
   * Fiche liée encore active ? Contact client : fiche client `active` ; consultant : fiche
   * fournisseur `active` et non fusionnée. Fiche absente : inactive.
   */
  async linkedRecordActive(account: WorkExternalAccountLean): Promise<boolean> {
    const id = account.kind === 'client' ? account.customerId : account.supplierId;
    if (!id || !/^[0-9a-f]{24}$/i.test(id)) return false;
    const doc = await this.connection
      .collection(account.kind === 'client' ? 'customers' : 'suppliers')
      .findOne(
        { _id: new Types.ObjectId(id), organizationId: account.organizationId },
        { projection: { active: 1, mergedInto: 1 } },
      );
    if (!doc) return false;
    return doc['active'] !== false && !doc['mergedInto'];
  }

  /**
   * Contrôle d'un compte à l'entrée (demande de code, chaque requête) : fiche désactivée →
   * compte fermé (audité, sessions révoquées) et `false`.
   */
  async ensureUsable(account: WorkExternalAccountLean): Promise<boolean> {
    if (account.status !== 'active') return false;
    if (await this.linkedRecordActive(account)) return true;
    await this.closeAccount(
      account,
      account.kind === 'client' ? 'customer_inactive' : 'supplier_inactive',
      { userId: 'system', role: 'system' },
    );
    return false;
  }
}
