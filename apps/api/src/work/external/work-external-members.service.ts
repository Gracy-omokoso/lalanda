// Membres externes d'un projet, côté ERP — ADR-0078 § 1, § 2 et § 3.
//
//   - invitation d'un contact client (fiche client DU projet `kind: client`, compte CRM
//     facultatif relié à la même fiche) ou d'un consultant (fiche fournisseur active,
//     référent interne) par la gestion du projet (chef, adjoint, `work.manage`) ;
//   - « peut ouvrir le projet » d'un consultant, retrait (accès fermé, sessions révoquées
//     s'il n'a plus d'autre accès) ;
//   - comptes : liste, nom, référent, fermeture manuelle ;
//   - taux d'achat d'un consultant (rangés dans `work_member_rates`) et récapitulatif
//     temps × taux par mois (moteur `consultantTimeRecap`), base de sa facture
//     fournisseur — aucune pièce comptable n'est créée ;
//   - réglages externes d'une tâche (visible par le client, validation client requise,
//     consultants) ; conversion manuelle d'un Invité externe.
//
// Lit les fiches clients, fournisseurs, comptes CRM et organisations en LECTURE seule par
// la connexion (sans importer leurs modules, motif du CRM). Audit : identifiants seulement.

import { consultantTimeRecap } from '@lalanda/engine';
import {
  WORK_EXTERNAL_KIND_LABELS,
  WORK_EXTERNAL_LIMITS,
  type ConsultantRecapQuery,
  type ConsultantRecapView,
  type ConvertGuestBody,
  type InviteExternalMemberBody,
  type PutTaskExternalSettingsBody,
  type ResetClientApprovalBody,
  type SetConsultantRateBody,
  type SupplierConsultantsView,
  type UpdateExternalAccountBody,
  type UpdateExternalMemberBody,
  type WorkExternalAccountView,
  type WorkExternalCloseReason,
  type WorkExternalMemberView,
  type WorkExternalMembersView,
  type WorkMemberRateView,
  type WorkTaskExternalView,
} from '@lalanda/shared/work';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { can } from '../../authz/permissions.js';
import { MailService } from '../../mail/mail.service.js';
import { isDuplicateKey } from '../../sales/sales.errors.js';
import { toCsv } from '../../crm/crm-csv.js';
import {
  inScope,
  isLeadEligibleRole,
  isProjectScopedRole,
  type WorkProjectScope,
} from '../work-access.js';
import { WorkAccessService } from '../work-access.service.js';
import { WorkActivityService } from '../work-activity.service.js';
import { WorkMembersService } from '../work-members.service.js';
import { WorkProjectsService } from '../work-projects.service.js';
import { WorkTasksService } from '../work-tasks.service.js';
import {
  actorCan,
  conflict,
  invalid,
  isWorkId,
  memberNotFound,
  notFound,
  oid,
  projectArchived,
  rateNotFound,
  staleRevision,
  type WorkActor,
} from '../work.common.js';
import {
  WorkMemberRate,
  WorkProject,
  WorkTask,
  type WorkMemberRateDocument,
  type WorkMemberRateLean,
  type WorkProjectDocument,
  type WorkProjectLean,
  type WorkTaskDocument,
  type WorkTaskLean,
} from '../work.schemas.js';
import { WorkExternalLifecycle } from './work-external-lifecycle.js';
import {
  WorkExternalAccount,
  WorkExternalMembership,
  type WorkExternalAccountDocument,
  type WorkExternalAccountLean,
  type WorkExternalMembershipDocument,
  type WorkExternalMembershipLean,
} from './work-external.schemas.js';

export function externalAccountNotFound(): never {
  notFound('WORK_EXTERNAL_ACCOUNT_NOT_FOUND', 'Compte externe introuvable.');
}

function auditActor(actor: WorkActor): { userId: string; role: string } {
  return { userId: actor.userId, role: actor.role ?? 'unknown' };
}

@Injectable()
export class WorkExternalMembersService {
  private readonly logger = new Logger('WorkExternalMembers');

  constructor(
    @InjectModel(WorkExternalAccount.name)
    private readonly accounts: Model<WorkExternalAccountDocument>,
    @InjectModel(WorkExternalMembership.name)
    private readonly memberships: Model<WorkExternalMembershipDocument>,
    @InjectModel(WorkMemberRate.name) private readonly rates: Model<WorkMemberRateDocument>,
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
    @InjectModel(WorkProject.name) private readonly projectModel: Model<WorkProjectDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkTasksService) private readonly taskService: WorkTasksService,
    @Inject(WorkAccessService) private readonly access: WorkAccessService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(WorkExternalLifecycle) private readonly lifecycle: WorkExternalLifecycle,
  ) {}

  // ── Lectures ─────────────────────────────────────────────────────────────

  async requireAccount(
    organizationId: string,
    accountId: string,
  ): Promise<WorkExternalAccountLean> {
    if (!isWorkId(accountId)) externalAccountNotFound();
    const doc = await this.accounts
      .findOne({ _id: oid(accountId), organizationId })
      .lean<WorkExternalAccountLean>()
      .exec();
    if (!doc) externalAccountNotFound();
    return doc;
  }

  private async namesOf(
    collection: string,
    organizationId: string,
    ids: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const valid = [...new Set(ids.filter((i): i is string => !!i && isWorkId(i)))];
    if (valid.length === 0) return new Map();
    const docs = await this.connection
      .collection(collection)
      .find({ organizationId, _id: { $in: valid.map(oid) } }, { projection: { name: 1 } })
      .toArray();
    return new Map(docs.map((d) => [String(d['_id']), String(d['name'] ?? '')]));
  }

  async accountViews(
    organizationId: string,
    docs: readonly WorkExternalAccountLean[],
  ): Promise<WorkExternalAccountView[]> {
    if (docs.length === 0) return [];
    const ids = docs.map((d) => String(d._id));
    const [customers, suppliers, refs, open] = await Promise.all([
      this.namesOf(
        'customers',
        organizationId,
        docs.map((d) => d.customerId),
      ),
      this.namesOf(
        'suppliers',
        organizationId,
        docs.map((d) => d.supplierId),
      ),
      this.members.refs(
        docs.map((d) => d.referentUserId),
        organizationId,
      ),
      this.memberships
        .find(
          { organizationId, accountId: { $in: ids }, status: 'active' },
          { accountId: 1, projectId: 1 },
        )
        .lean<{ accountId: string; projectId: string }[]>()
        .exec(),
    ]);
    const openProjects = new Set(
      await this.lifecycle.openProjectIds(
        organizationId,
        open.map((o) => o.projectId),
      ),
    );
    const counts = new Map<string, number>();
    for (const o of open) {
      if (!openProjects.has(o.projectId)) continue;
      counts.set(o.accountId, (counts.get(o.accountId) ?? 0) + 1);
    }
    return docs.map((d) => {
      const id = String(d._id);
      return {
        id,
        kind: d.kind,
        email: d.email,
        name: d.name,
        status: d.status,
        closedAt: d.closedAt ? new Date(d.closedAt).toISOString() : null,
        closedReason: (d.closedReason ?? null) as WorkExternalCloseReason | null,
        customerId: d.customerId ?? null,
        customerName: d.customerId ? (customers.get(d.customerId) ?? null) : null,
        crmAccountId: d.crmAccountId ?? null,
        supplierId: d.supplierId ?? null,
        supplierName: d.supplierId ? (suppliers.get(d.supplierId) ?? null) : null,
        referent: d.referentUserId ? WorkMembersService.refOf(refs, d.referentUserId) : null,
        projectCount: counts.get(id) ?? 0,
        lastLoginAt: d.lastLoginAt ? new Date(d.lastLoginAt).toISOString() : null,
        revision: d.revision,
        createdAt: new Date(d.createdAt).toISOString(),
      };
    });
  }

  private async memberViews(
    organizationId: string,
    rows: readonly WorkExternalMembershipLean[],
  ): Promise<WorkExternalMemberView[]> {
    if (rows.length === 0) return [];
    const accounts = await this.accounts
      .find({ organizationId, _id: { $in: rows.map((r) => oid(r.accountId)) } })
      .lean<WorkExternalAccountLean[]>()
      .exec();
    const views = new Map(
      (await this.accountViews(organizationId, accounts)).map((v) => [v.id, v]),
    );
    const refs = await this.members.refs(
      rows.map((r) => r.invitedBy),
      organizationId,
    );
    return rows
      .filter((r) => views.has(r.accountId))
      .map((r) => ({
        account: views.get(r.accountId)!,
        projectId: r.projectId,
        status: r.status,
        closedReason: (r.closedReason ?? null) as WorkExternalCloseReason | null,
        canOpenProject: r.canOpenProject,
        invitedAt: new Date(r.invitedAt).toISOString(),
        invitedBy: WorkMembersService.refOf(refs, r.invitedBy),
      }));
  }

  /** `GET /work/projects/:projectId/external-members`. */
  async listForProject(
    organizationId: string,
    projectId: string,
    actor: WorkActor,
  ): Promise<WorkExternalMembersView> {
    const project = await this.projects.requireOwn(organizationId, projectId);
    const rights = await this.access.rightsOn(organizationId, project, actor);
    const rows = await this.memberships
      .find({ organizationId, projectId: String(project._id) })
      .sort({ status: 1, invitedAt: 1 })
      .lean<WorkExternalMembershipLean[]>()
      .exec();
    return {
      projectId: String(project._id),
      canInviteClient: project.kind === 'client' && !!project.links?.customerId,
      canManage: rights.canManage,
      customerId: project.links?.customerId ?? null,
      members: await this.memberViews(organizationId, rows),
    };
  }

  /** `GET /work/external-accounts` (gestion). */
  async listAccounts(organizationId: string): Promise<{ items: WorkExternalAccountView[] }> {
    const docs = await this.accounts
      .find({ organizationId })
      .sort({ status: 1, name: 1 })
      .limit(500)
      .lean<WorkExternalAccountLean[]>()
      .exec();
    return { items: await this.accountViews(organizationId, docs) };
  }

  // ── Vérifications de fiches ──────────────────────────────────────────────

  private async requireRecord(
    collection: 'customers' | 'suppliers' | 'crm_accounts',
    organizationId: string,
    id: string,
    path: string,
  ): Promise<Record<string, unknown>> {
    const doc = await this.connection
      .collection(collection)
      .findOne({ _id: new Types.ObjectId(id), organizationId });
    if (!doc) {
      notFound(
        collection === 'customers'
          ? 'CUSTOMER_NOT_FOUND'
          : collection === 'suppliers'
            ? 'SUPPLIER_NOT_FOUND'
            : 'CRM_ACCOUNT_NOT_FOUND',
        'Fiche introuvable dans cette organisation.',
      );
    }
    if (collection !== 'crm_accounts' && (doc['active'] === false || doc['mergedInto'])) {
      conflict('WORK_EXTERNAL_RECORD_INACTIVE', 'Cette fiche est archivée ou fusionnée.', {
        path,
      });
    }
    return doc;
  }

  /** Référent interne : membre, `work.update`, rôle interne (ni Invité, ni Stagiaire). */
  private async requireReferent(organizationId: string, userId: string): Promise<void> {
    const m = await this.members.permissionsOf(organizationId, userId);
    if (m === undefined) memberNotFound();
    if (!can(m.role, 'work.update', m.context) || !isLeadEligibleRole(m.role)) {
      invalid(
        'referentUserId',
        'WORK_EXTERNAL_REFERENT_NOT_ELIGIBLE',
        'Le référent est un membre interne qui peut modifier les tâches (ni Invité externe, ni Stagiaire).',
      );
    }
  }

  private async organizationName(organizationId: string): Promise<string> {
    if (!isWorkId(organizationId)) return '';
    const doc = await this.connection
      .collection('organizations')
      .findOne({ _id: oid(organizationId) }, { projection: { name: 1 } });
    return String(doc?.['name'] ?? '');
  }

  // ── Invitation ───────────────────────────────────────────────────────────

  /**
   * Compte de l'adresse dans l'organisation : réutilisé (même genre, même fiche) ou créé.
   *
   * Revue de sécurité (M1) : une invitation par la gestion d'UN projet ne touche pas au
   * compte pour toute l'organisation. Un compte FERMÉ ne se rouvre qu'avec `work.manage`
   * (`409 WORK_EXTERNAL_ACCOUNT_CLOSED` sinon) ; le référent d'un compte existant ne change
   * qu'avec `work.manage` ; avec `projectId`, l'accès déjà ouvert et les bornes sont
   * vérifiés AVANT toute écriture (une invitation refusée ne laisse aucune trace).
   */
  private async ensureAccount(
    organizationId: string,
    input: {
      kind: 'client' | 'consultant';
      email: string;
      name: string;
      customerId: string | null;
      crmAccountId: string | null;
      supplierId: string | null;
      referentUserId: string | null;
      convertedFromUserId?: string | null;
    },
    actor: WorkActor,
    projectId?: string,
  ): Promise<WorkExternalAccountLean> {
    const existing = await this.accounts
      .findOne({ organizationId, email: input.email })
      .lean<WorkExternalAccountLean>()
      .exec();
    const manager = actorCan(actor, 'work.manage');
    if (projectId) await this.precheckMembership(organizationId, existing, projectId);
    if (existing) {
      if (existing.kind !== input.kind) {
        conflict(
          'WORK_EXTERNAL_KIND_CONFLICT',
          'Cette adresse a déjà un compte externe d’un autre genre dans l’organisation.',
          { accountId: String(existing._id), kind: existing.kind },
        );
      }
      if (input.kind === 'client' && existing.customerId !== input.customerId) {
        conflict(
          'WORK_EXTERNAL_RECORD_CONFLICT',
          'Ce contact est déjà relié à une autre fiche client.',
          { accountId: String(existing._id) },
        );
      }
      if (input.kind === 'consultant' && existing.supplierId !== input.supplierId) {
        conflict(
          'WORK_EXTERNAL_RECORD_CONFLICT',
          'Ce consultant est déjà relié à une autre fiche fournisseur.',
          { accountId: String(existing._id) },
        );
      }
      if (existing.status === 'closed' && !manager) {
        conflict(
          'WORK_EXTERNAL_ACCOUNT_CLOSED',
          'Le compte externe de cette adresse est fermé : seul un gestionnaire des projets le rouvre.',
          { accountId: String(existing._id) },
        );
      }
      const set: Record<string, unknown> = {};
      if (existing.status === 'closed') {
        Object.assign(set, { status: 'active', closedAt: null, closedReason: null });
      }
      if (manager && input.referentUserId && input.referentUserId !== existing.referentUserId) {
        set['referentUserId'] = input.referentUserId;
      }
      if (input.crmAccountId && !existing.crmAccountId) set['crmAccountId'] = input.crmAccountId;
      if (Object.keys(set).length === 0) return existing;
      set['updatedBy'] = actor.userId;
      const updated = await this.accounts
        .findOneAndUpdate(
          { _id: existing._id, organizationId },
          { $set: set, $inc: { revision: 1 } },
          { new: true },
        )
        .lean<WorkExternalAccountLean>()
        .exec();
      if (existing.status === 'closed') {
        await this.audit.record({
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role ?? 'unknown',
          action: 'work.external.reactivated',
          targetType: 'work_external_account',
          targetId: String(existing._id),
          metadata: { kind: existing.kind },
        });
      }
      return updated!;
    }
    try {
      const created = await this.accounts.create({
        organizationId,
        kind: input.kind,
        email: input.email,
        name: input.name,
        status: 'active',
        closedAt: null,
        closedReason: null,
        customerId: input.customerId,
        crmAccountId: input.crmAccountId,
        supplierId: input.supplierId,
        referentUserId: input.referentUserId,
        convertedFromUserId: input.convertedFromUserId ?? null,
        lastLoginAt: null,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role ?? 'unknown',
        action: 'work.external.account_created',
        targetType: 'work_external_account',
        targetId: String(created._id),
        metadata: {
          kind: input.kind,
          customerId: input.customerId,
          supplierId: input.supplierId,
          ...(input.convertedFromUserId ? { convertedFromUserId: input.convertedFromUserId } : {}),
        },
      });
      return created.toObject() as WorkExternalAccountLean;
    } catch (err) {
      if (isDuplicateKey(err)) {
        conflict(
          'WORK_EXTERNAL_ACCOUNT_EXISTS',
          'Un compte externe vient d’être créé pour cette adresse : réessayez.',
        );
      }
      throw err;
    }
  }

  /** Accès déjà ouvert et bornes, vérifiés AVANT toute écriture (M1). */
  private async precheckMembership(
    organizationId: string,
    account: WorkExternalAccountLean | null,
    projectId: string,
  ): Promise<void> {
    const memberCount = await this.memberships
      .countDocuments({ organizationId, projectId, status: 'active' })
      .exec();
    if (memberCount >= WORK_EXTERNAL_LIMITS.membersPerProjectMax) {
      conflict('WORK_EXTERNAL_LIMIT', 'Ce projet a déjà le nombre maximal de membres externes.');
    }
    if (!account) return;
    const accountId = String(account._id);
    const active = await this.memberships
      .countDocuments({ organizationId, accountId, projectId, status: 'active' })
      .exec();
    if (active > 0) {
      conflict('WORK_EXTERNAL_ALREADY_MEMBER', 'Cette personne a déjà accès à ce projet.');
    }
    if (
      (await this.lifecycle.openProjectsOf(organizationId, accountId)).length >=
      WORK_EXTERNAL_LIMITS.projectsPerAccountMax
    ) {
      conflict(
        'WORK_EXTERNAL_LIMIT',
        'Ce compte externe a déjà le nombre maximal de projets ouverts.',
      );
    }
  }

  /** Ouvre (ou rouvre) l'accès d'un compte à un projet ; 409 s'il est déjà ouvert. */
  private async openMembership(
    organizationId: string,
    account: WorkExternalAccountLean,
    projectId: string,
    canOpenProject: boolean,
    actor: WorkActor,
  ): Promise<void> {
    const accountId = String(account._id);
    const [projectCount, memberCount] = await Promise.all([
      this.lifecycle.openProjectsOf(organizationId, accountId).then((p) => p.length),
      this.memberships.countDocuments({ organizationId, projectId, status: 'active' }).exec(),
    ]);
    if (projectCount >= WORK_EXTERNAL_LIMITS.projectsPerAccountMax) {
      conflict(
        'WORK_EXTERNAL_LIMIT',
        'Ce compte externe a déjà le nombre maximal de projets ouverts.',
      );
    }
    if (memberCount >= WORK_EXTERNAL_LIMITS.membersPerProjectMax) {
      conflict('WORK_EXTERNAL_LIMIT', 'Ce projet a déjà le nombre maximal de membres externes.');
    }
    const existing = await this.memberships
      .findOne({ organizationId, accountId, projectId })
      .lean<WorkExternalMembershipLean>()
      .exec();
    if (existing?.status === 'active') {
      conflict('WORK_EXTERNAL_ALREADY_MEMBER', 'Cette personne a déjà accès à ce projet.');
    }
    const open = account.kind === 'consultant' && canOpenProject;
    if (existing) {
      await this.memberships
        .updateOne(
          { _id: existing._id, organizationId },
          {
            $set: {
              status: 'active',
              canOpenProject: open,
              invitedBy: actor.userId,
              invitedAt: new Date(),
              closedAt: null,
              closedReason: null,
            },
            $inc: { revision: 1 },
          },
        )
        .exec();
    } else {
      try {
        await this.memberships.create({
          organizationId,
          accountId,
          projectId,
          kind: account.kind,
          status: 'active',
          canOpenProject: open,
          invitedBy: actor.userId,
          invitedAt: new Date(),
          closedAt: null,
          closedReason: null,
          revision: 1,
          _schemaVersion: 1,
        });
      } catch (err) {
        if (isDuplicateKey(err)) {
          conflict('WORK_EXTERNAL_ALREADY_MEMBER', 'Cette personne a déjà accès à ce projet.');
        }
        throw err;
      }
    }
    await this.activity.record(organizationId, {
      projectId,
      actorUserId: actor.userId,
      kind: 'project.external_member_added',
      data: { accountId, kind: account.kind },
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role ?? 'unknown',
      action: 'work.external.invited',
      targetType: 'work_external_membership',
      targetId: accountId,
      metadata: { accountId, projectId, kind: account.kind, canOpenProject: open },
    });
  }

  private async requireManagedProject(
    organizationId: string,
    projectId: string,
    actor: WorkActor,
  ): Promise<WorkProjectLean> {
    const project = await this.projects.requireOwn(organizationId, projectId);
    await this.access.assertManage(organizationId, project, actor);
    return project;
  }

  /** Règles de fiche d'une invitation (client : fiche DU projet ; consultant : fournisseur). */
  private async checkInvitationRecords(
    organizationId: string,
    project: WorkProjectLean,
    input: {
      kind: 'client' | 'consultant';
      customerId?: string | undefined;
      crmAccountId?: string | null | undefined;
      supplierId?: string | undefined;
      referentUserId?: string | undefined;
    },
  ): Promise<void> {
    if (input.kind === 'client') {
      if (project.kind !== 'client') {
        conflict(
          'WORK_EXTERNAL_PROJECT_NOT_CLIENT',
          'Un contact client ne s’invite que sur un projet client.',
        );
      }
      if (!project.links?.customerId || project.links.customerId !== input.customerId) {
        invalid(
          'customerId',
          'WORK_EXTERNAL_CUSTOMER_MISMATCH',
          'Le contact doit être relié à la fiche client de ce projet.',
        );
      }
      await this.requireRecord('customers', organizationId, input.customerId!, 'customerId');
      if (input.crmAccountId) {
        const crm = await this.requireRecord(
          'crm_accounts',
          organizationId,
          input.crmAccountId,
          'crmAccountId',
        );
        if (crm['customerId'] !== input.customerId) {
          invalid(
            'crmAccountId',
            'WORK_EXTERNAL_CRM_MISMATCH',
            'Ce compte CRM n’est pas relié à la fiche client du projet.',
          );
        }
      }
    } else {
      await this.requireRecord('suppliers', organizationId, input.supplierId!, 'supplierId');
      await this.requireReferent(organizationId, input.referentUserId!);
    }
  }

  /** `POST /work/projects/:projectId/external-members`. */
  async invite(
    organizationId: string,
    projectId: string,
    body: InviteExternalMemberBody,
    actor: WorkActor,
  ): Promise<WorkExternalMemberView> {
    const project = await this.requireManagedProject(organizationId, projectId, actor);
    if (project.status === 'archived') projectArchived();
    await this.checkInvitationRecords(organizationId, project, body);
    const account = await this.ensureAccount(
      organizationId,
      {
        kind: body.kind,
        email: body.email,
        name: body.name,
        customerId: body.kind === 'client' ? body.customerId! : null,
        crmAccountId: body.kind === 'client' ? (body.crmAccountId ?? null) : null,
        supplierId: body.kind === 'consultant' ? body.supplierId! : null,
        referentUserId: body.kind === 'consultant' ? body.referentUserId! : null,
      },
      actor,
      String(project._id),
    );
    const id = String(project._id);
    await this.openMembership(organizationId, account, id, body.canOpenProject === true, actor);
    // L'invitation reste valable même si l'e-mail ne part pas (`MailService` ne lève pas).
    await this.mail.sendExternalInvitation({
      to: account.email,
      organizationName: await this.organizationName(organizationId),
      projectName: project.name,
      kindLabel: WORK_EXTERNAL_KIND_LABELS[account.kind],
      name: account.name,
    });
    const row = await this.memberships
      .findOne({ organizationId, accountId: String(account._id), projectId: id })
      .lean<WorkExternalMembershipLean>()
      .exec();
    return (await this.memberViews(organizationId, [row!]))[0]!;
  }

  /** `PUT /work/projects/:projectId/external-members/:accountId` — consultant seulement. */
  async updateMember(
    organizationId: string,
    projectId: string,
    accountId: string,
    body: UpdateExternalMemberBody,
    actor: WorkActor,
  ): Promise<WorkExternalMemberView> {
    const project = await this.requireManagedProject(organizationId, projectId, actor);
    if (project.status === 'archived') projectArchived();
    const account = await this.requireAccount(organizationId, accountId);
    if (account.kind !== 'consultant') {
      invalid(
        'canOpenProject',
        'WORK_EXTERNAL_NOT_CONSULTANT',
        'Seul un consultant peut ouvrir la vue du projet.',
      );
    }
    const row = await this.memberships
      .findOneAndUpdate(
        { organizationId, accountId, projectId: String(project._id), status: 'active' },
        { $set: { canOpenProject: body.canOpenProject }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<WorkExternalMembershipLean>()
      .exec();
    if (!row) externalAccountNotFound();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role ?? 'unknown',
      action: 'work.external.access_changed',
      targetType: 'work_external_membership',
      targetId: accountId,
      metadata: { accountId, projectId: String(project._id), canOpenProject: body.canOpenProject },
    });
    return (await this.memberViews(organizationId, [row]))[0]!;
  }

  /** `DELETE /work/projects/:projectId/external-members/:accountId`. */
  async removeMember(
    organizationId: string,
    projectId: string,
    accountId: string,
    actor: WorkActor,
  ): Promise<void> {
    const project = await this.requireManagedProject(organizationId, projectId, actor);
    await this.requireAccount(organizationId, accountId);
    const closed = await this.lifecycle.closeMembership(
      organizationId,
      accountId,
      String(project._id),
      'member_removed',
      auditActor(actor),
    );
    if (!closed) externalAccountNotFound();
    await this.activity.record(organizationId, {
      projectId: String(project._id),
      actorUserId: actor.userId,
      kind: 'project.external_member_removed',
      data: { accountId },
    });
  }

  // ── Comptes ──────────────────────────────────────────────────────────────

  async updateAccount(
    organizationId: string,
    accountId: string,
    body: UpdateExternalAccountBody,
    actor: WorkActor,
  ): Promise<WorkExternalAccountView> {
    const account = await this.requireAccount(organizationId, accountId);
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    if (body.name !== undefined) set['name'] = body.name;
    if (body.referentUserId !== undefined) {
      if (account.kind !== 'consultant') {
        invalid(
          'referentUserId',
          'WORK_EXTERNAL_NOT_CONSULTANT',
          'Seul un consultant a un référent.',
        );
      }
      await this.requireReferent(organizationId, body.referentUserId);
      set['referentUserId'] = body.referentUserId;
    }
    const updated = await this.accounts
      .findOneAndUpdate(
        { _id: account._id, organizationId },
        { $set: set, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<WorkExternalAccountLean>()
      .exec();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role ?? 'unknown',
      action: 'work.external.account_updated',
      targetType: 'work_external_account',
      targetId: accountId,
      metadata: {
        fields: Object.keys(set).filter((k) => k !== 'updatedBy'),
        ...(body.referentUserId ? { referentUserId: body.referentUserId } : {}),
      },
    });
    return (await this.accountViews(organizationId, [updated!]))[0]!;
  }

  async closeAccount(
    organizationId: string,
    accountId: string,
    actor: WorkActor,
  ): Promise<WorkExternalAccountView> {
    const account = await this.requireAccount(organizationId, accountId);
    if (account.status === 'active') {
      await this.lifecycle.closeAccount(account, 'manual', auditActor(actor));
    }
    return (
      await this.accountViews(organizationId, [
        await this.requireAccount(organizationId, accountId),
      ])
    )[0]!;
  }

  // ── Taux d'achat et récapitulatif (consultant) ───────────────────────────

  private async requireConsultant(
    organizationId: string,
    accountId: string,
  ): Promise<WorkExternalAccountLean> {
    const account = await this.requireAccount(organizationId, accountId);
    if (account.kind !== 'consultant') {
      invalid('accountId', 'WORK_EXTERNAL_NOT_CONSULTANT', 'Ce compte n’est pas un consultant.');
    }
    return account;
  }

  private rateView(d: WorkMemberRateLean, account: WorkExternalAccountLean): WorkMemberRateView {
    return {
      id: String(d._id),
      user: { userId: String(account._id), name: account.name, external: 'consultant' },
      currency: d.currency,
      hourlyCost: d.hourlyCost,
      effectiveFrom: d.effectiveFrom,
      createdBy: d.createdBy,
      createdAt: new Date(d.createdAt).toISOString(),
    };
  }

  async listRates(
    organizationId: string,
    accountId: string,
  ): Promise<{ items: WorkMemberRateView[] }> {
    const account = await this.requireConsultant(organizationId, accountId);
    const docs = await this.rates
      .find({ organizationId, userId: accountId })
      .sort({ effectiveFrom: -1 })
      .lean<WorkMemberRateLean[]>()
      .exec();
    return { items: docs.map((d) => this.rateView(d, account)) };
  }

  async setRate(
    organizationId: string,
    accountId: string,
    body: SetConsultantRateBody,
    actor: WorkActor,
  ): Promise<WorkMemberRateView> {
    const account = await this.requireConsultant(organizationId, accountId);
    let id: string;
    try {
      const created = await this.rates.create({
        organizationId,
        userId: accountId,
        currency: body.currency,
        hourlyCost: body.hourlyRate,
        effectiveFrom: body.effectiveFrom,
        createdBy: actor.userId,
        _schemaVersion: 1,
      });
      id = String(created._id);
    } catch (err) {
      if (isDuplicateKey(err)) {
        conflict(
          'WORK_RATE_DUPLICATE',
          'Un taux existe déjà pour ce consultant à cette date : supprimez-le avant d’en poser un autre.',
        );
      }
      throw err;
    }
    // Le montant n'est pas journalisé (motif des taux des membres).
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role ?? 'unknown',
      action: 'work.external.rate_set',
      targetType: 'work_member_rate',
      targetId: id,
      metadata: { accountId, currency: body.currency, effectiveFrom: body.effectiveFrom },
    });
    const doc = await this.rates.findById(id).lean<WorkMemberRateLean>().exec();
    return this.rateView(doc!, account);
  }

  async removeRate(
    organizationId: string,
    accountId: string,
    rateId: string,
    actor: WorkActor,
  ): Promise<void> {
    await this.requireConsultant(organizationId, accountId);
    if (!isWorkId(rateId)) rateNotFound();
    const doc = await this.rates
      .findOneAndDelete({ _id: oid(rateId), organizationId, userId: accountId })
      .lean<WorkMemberRateLean>()
      .exec();
    if (!doc) rateNotFound();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role ?? 'unknown',
      action: 'work.external.rate_removed',
      targetType: 'work_member_rate',
      targetId: rateId,
      metadata: { accountId, currency: doc.currency, effectiveFrom: doc.effectiveFrom },
    });
  }

  /**
   * Récapitulatif temps × taux d'achat par mois et par projet (moteur). Revue de sécurité
   * (B7) : seuls les projets que l'APPELANT voit sont détaillés ; le temps des autres est
   * compté à part (`hiddenMinutes`), jamais nommé ni valorisé.
   */
  async recap(
    organizationId: string,
    accountId: string,
    query: ConsultantRecapQuery,
    actor: WorkActor,
  ): Promise<ConsultantRecapView> {
    const account = await this.requireConsultant(organizationId, accountId);
    const scope = await this.access.scopeOf(organizationId, actor);
    return this.recapOf(organizationId, account, query, scope);
  }

  private async recapOf(
    organizationId: string,
    account: WorkExternalAccountLean,
    query: ConsultantRecapQuery,
    scope: WorkProjectScope,
  ): Promise<ConsultantRecapView> {
    const accountId = String(account._id);
    const and: Record<string, unknown>[] = [{ organizationId, userId: accountId, deletedAt: null }];
    if (query.from) and.push({ workedOn: { $gte: query.from } });
    if (query.to) and.push({ workedOn: { $lte: query.to } });
    const [entries, rates, suppliers] = await Promise.all([
      this.connection
        .collection('work_time_entries')
        .find({ $and: and }, { projection: { projectId: 1, workedOn: 1, minutes: 1 } })
        .toArray(),
      this.rates
        .find(
          { organizationId, userId: accountId },
          { userId: 1, currency: 1, hourlyCost: 1, effectiveFrom: 1 },
        )
        .lean<
          { userId: string; currency: 'CDF' | 'USD'; hourlyCost: string; effectiveFrom: string }[]
        >()
        .exec(),
      this.namesOf('suppliers', organizationId, [account.supplierId]),
    ]);
    let hiddenMinutes = 0;
    const visible = entries.filter((e) => {
      if (inScope(scope, String(e['projectId']))) return true;
      hiddenMinutes += Number(e['minutes']);
      return false;
    });
    const result = consultantTimeRecap({
      entries: visible.map((e) => ({
        userId: accountId,
        projectId: String(e['projectId']),
        workedOn: String(e['workedOn']),
        minutes: Number(e['minutes']),
      })),
      rates,
      from: query.from ?? null,
      to: query.to ?? null,
    });
    const names = await this.projects.namesOf(
      organizationId,
      result.rows.map((r) => r.projectId),
    );
    return {
      account: {
        id: accountId,
        name: account.name,
        supplierId: account.supplierId ?? null,
        supplierName: account.supplierId ? (suppliers.get(account.supplierId) ?? null) : null,
      },
      from: result.from,
      to: result.to,
      rows: result.rows.map((r) => ({ ...r, projectName: names.get(r.projectId) ?? '' })),
      totals: result.totals,
      minutesWithoutRate: result.minutesWithoutRate,
      hiddenMinutes,
      version: result.version,
    };
  }

  /**
   * Récapitulatif en CSV (« ; », UTF-8 avec BOM) par l'utilitaire du dépôt (`toCsv`) : une
   * cellule qui commence par = + - @, une tabulation ou un retour chariot est neutralisée (B7).
   */
  async recapCsv(
    organizationId: string,
    accountId: string,
    query: ConsultantRecapQuery,
    actor: WorkActor,
  ): Promise<string> {
    const recap = await this.recap(organizationId, accountId, query, actor);
    return toCsv(
      ['Mois', 'Projet', 'Minutes', 'Heures', 'Devise', 'Montant HT'],
      [
        ...recap.rows.map((r) => [
          r.period,
          r.projectName,
          String(r.minutes),
          (r.minutes / 60).toFixed(2),
          r.currency ?? '',
          r.amount ?? 'sans taux',
        ]),
        ...recap.totals.map((t) => [
          'Total',
          '',
          String(t.minutes),
          (t.minutes / 60).toFixed(2),
          t.currency,
          t.amount,
        ]),
        ...(recap.hiddenMinutes > 0
          ? [['Autres projets (non visibles)', '', String(recap.hiddenMinutes), '', '', '']]
          : []),
      ],
    );
  }

  /** `GET /work/suppliers/:supplierId/consultants` — fiche fournisseur (projets visibles). */
  async supplierConsultants(
    organizationId: string,
    supplierId: string,
    query: ConsultantRecapQuery,
    actor: WorkActor,
  ): Promise<SupplierConsultantsView> {
    if (!isWorkId(supplierId)) notFound('SUPPLIER_NOT_FOUND', 'Fiche introuvable.');
    const scope = await this.access.scopeOf(organizationId, actor);
    const accounts = await this.accounts
      .find({ organizationId, kind: 'consultant', supplierId })
      .sort({ name: 1 })
      .limit(100)
      .lean<WorkExternalAccountLean[]>()
      .exec();
    const views = await this.accountViews(organizationId, accounts);
    const out: SupplierConsultantsView['consultants'] = [];
    for (const [i, account] of accounts.entries()) {
      const rows = (
        await this.memberships
          .find({ organizationId, accountId: String(account._id) })
          .lean<WorkExternalMembershipLean[]>()
          .exec()
      ).filter((r) => inScope(scope, r.projectId));
      const names = await this.projects.namesOf(
        organizationId,
        rows.map((r) => r.projectId),
      );
      out.push({
        account: views[i]!,
        projects: rows.map((r) => ({
          projectId: r.projectId,
          projectName: names.get(r.projectId) ?? '',
          status: r.status,
        })),
        recap: await this.recapOf(organizationId, account, query, scope),
      });
    }
    return { supplierId, consultants: out };
  }

  // ── Réglages externes d'une tâche ────────────────────────────────────────

  private async activeConsultants(organizationId: string, projectId: string): Promise<string[]> {
    const rows = await this.memberships
      .find({ organizationId, projectId, status: 'active', kind: 'consultant' }, { accountId: 1 })
      .lean<{ accountId: string }[]>()
      .exec();
    return rows.map((r) => r.accountId);
  }

  async taskExternal(
    organizationId: string,
    taskId: string,
    actor: WorkActor,
  ): Promise<WorkTaskExternalView> {
    const task = await this.taskService.requireOwn(organizationId, taskId);
    const project = await this.projects.requireOwn(organizationId, task.projectId);
    return this.taskExternalView(organizationId, task, project, actor);
  }

  private async taskExternalView(
    organizationId: string,
    task: WorkTaskLean,
    project: WorkProjectLean,
    actor: WorkActor,
  ): Promise<WorkTaskExternalView> {
    const rights = await this.access.rightsOn(organizationId, project, actor);
    const consultants = await this.activeConsultants(organizationId, task.projectId);
    const ca = task.clientApproval ?? null;
    const refs = await this.members.refs(
      [
        ...consultants,
        task.consultantAssigneeId ?? null,
        ...(task.consultantCollaboratorIds ?? []),
        ca?.decidedBy ?? null,
      ],
      organizationId,
    );
    const ref = (id: string) => WorkMembersService.refOf(refs, id);
    return {
      taskId: String(task._id),
      revision: task.revision,
      clientVisible: task.clientVisible === true,
      clientApproval: {
        required: ca?.required === true,
        state: ca?.required ? ca.state : 'none',
        decidedAt: ca?.decidedAt ? new Date(ca.decidedAt).toISOString() : null,
        decidedBy: ca?.decidedBy ? ref(ca.decidedBy) : null,
        reason: ca?.reason ?? null,
      },
      consultantAssignee: task.consultantAssigneeId ? ref(task.consultantAssigneeId) : null,
      consultantCollaborators: (task.consultantCollaboratorIds ?? []).map(ref),
      consultants: consultants.map(ref),
      canManage: rights.canManage,
    };
  }

  /** `PUT /work/tasks/:taskId/client-settings` — gestion du projet seulement. */
  async putTaskExternal(
    organizationId: string,
    taskId: string,
    body: PutTaskExternalSettingsBody,
    actor: WorkActor,
  ): Promise<WorkTaskExternalView> {
    const { task, project } = await this.taskService.requireWritable(organizationId, taskId);
    await this.access.assertManage(organizationId, project, actor);
    if (task.revision !== body.expectedRevision) staleRevision(task.revision);
    const visible = body.clientVisible ?? task.clientVisible === true;
    const currentRequired = task.clientApproval?.required === true;
    const required = body.clientApprovalRequired ?? currentRequired;
    if ((visible || required) && project.kind !== 'client') {
      conflict(
        'WORK_EXTERNAL_PROJECT_NOT_CLIENT',
        'Seules les tâches d’un projet client se montrent au client.',
      );
    }
    if (required && !visible) {
      invalid(
        'clientApprovalRequired',
        'WORK_CLIENT_APPROVAL_NEEDS_VISIBLE',
        'Une validation client exige une tâche visible par le client.',
      );
    }
    const consultants = new Set(await this.activeConsultants(organizationId, task.projectId));
    const chosen = [
      ...(body.consultantAssigneeId ? [body.consultantAssigneeId] : []),
      ...(body.consultantCollaboratorIds ?? []),
    ];
    if (chosen.some((id) => !consultants.has(id))) {
      invalid(
        body.consultantAssigneeId && !consultants.has(body.consultantAssigneeId)
          ? 'consultantAssigneeId'
          : 'consultantCollaboratorIds',
        'WORK_EXTERNAL_NOT_PROJECT_CONSULTANT',
        'Cette personne n’est pas consultant de ce projet : invitez-la d’abord.',
      );
    }
    // B4 : retirer une validation client en cours sur un jalon facturable exige un motif.
    const fromState = task.clientApproval?.required ? task.clientApproval.state : 'none';
    const removing = currentRequired && !required;
    if (
      removing &&
      task.isMilestone &&
      (fromState === 'pending' || fromState === 'changes_requested') &&
      !body.reason
    ) {
      invalid(
        'reason',
        'WORK_CLIENT_APPROVAL_REASON_REQUIRED',
        'Indiquez pourquoi la validation du client est retirée de ce jalon.',
      );
    }
    const set: Record<string, unknown> = { clientVisible: visible, updatedBy: actor.userId };
    if (required !== currentRequired) {
      set['clientApproval'] = required
        ? { required: true, state: 'pending', decidedBy: null, decidedAt: null, reason: null }
        : { required: false, state: 'none', decidedBy: null, decidedAt: null, reason: null };
    }
    if (body.consultantAssigneeId !== undefined)
      set['consultantAssigneeId'] = body.consultantAssigneeId;
    if (body.consultantCollaboratorIds !== undefined) {
      set['consultantCollaboratorIds'] = [...new Set(body.consultantCollaboratorIds)].filter(
        (id) => id !== (body.consultantAssigneeId ?? task.consultantAssigneeId),
      );
    }
    const res = await this.tasks
      .updateOne(
        { _id: task._id, organizationId, revision: body.expectedRevision },
        { $set: set, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1)
      staleRevision((await this.taskService.requireOwn(organizationId, taskId)).revision);
    if (required !== currentRequired) {
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role ?? 'unknown',
        action: removing
          ? 'work.external.client_approval_removed'
          : 'work.external.client_approval_required',
        targetType: 'work_task',
        targetId: String(task._id),
        metadata: {
          projectId: task.projectId,
          fromState,
          isMilestone: task.isMilestone,
          ...(body.reason ? { reason: body.reason.slice(0, 500) } : {}),
        },
      });
    }
    await this.activity.record(organizationId, {
      projectId: task.projectId,
      taskId: String(task._id),
      actorUserId: actor.userId,
      kind: 'task.external_settings_changed',
      data: {
        clientVisible: visible,
        clientApprovalRequired: required,
        ...(body.consultantAssigneeId !== undefined
          ? { consultantAssigneeId: body.consultantAssigneeId }
          : {}),
        ...(body.consultantCollaboratorIds !== undefined
          ? { consultantCollaborators: body.consultantCollaboratorIds.length }
          : {}),
      },
    });
    const fresh = await this.taskService.requireOwn(organizationId, taskId);
    return this.taskExternalView(organizationId, fresh, project, actor);
  }

  /** `POST /work/tasks/:taskId/client-approval/reset` — remet « en attente du client ». */
  async resetClientApproval(
    organizationId: string,
    taskId: string,
    body: ResetClientApprovalBody,
    actor: WorkActor,
  ): Promise<WorkTaskExternalView> {
    const { task, project } = await this.taskService.requireWritable(organizationId, taskId);
    await this.access.assertManage(organizationId, project, actor);
    if (!task.clientApproval?.required) {
      conflict(
        'WORK_CLIENT_APPROVAL_NOT_REQUIRED',
        'Cette tâche n’attend pas de validation du client.',
      );
    }
    if (task.clientApproval.state === 'pending') {
      return this.taskExternalView(organizationId, task, project, actor);
    }
    const res = await this.tasks
      .updateOne(
        { _id: task._id, organizationId, revision: body.expectedRevision },
        {
          $set: {
            clientApproval: {
              required: true,
              state: 'pending',
              decidedBy: null,
              decidedAt: null,
              reason: null,
            },
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(task.revision);
    await this.activity.record(organizationId, {
      projectId: task.projectId,
      taskId: String(task._id),
      actorUserId: actor.userId,
      kind: 'task.client_approval_reset',
      data: { from: task.clientApproval.state },
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role ?? 'unknown',
      action: 'work.external.client_approval_reset',
      targetType: 'work_task',
      targetId: String(task._id),
      metadata: { projectId: task.projectId, fromState: task.clientApproval.state },
    });
    return this.taskExternalView(
      organizationId,
      await this.taskService.requireOwn(organizationId, taskId),
      project,
      actor,
    );
  }

  // ── Conversion d'un Invité externe (ADR-0078 § 3.4) ──────────────────────

  /**
   * Conversion MANUELLE : crée le compte externe à l'adresse de l'invité, lui ouvre les
   * projets choisis (où il était membre) et l'en retire comme membre interne. Le rôle
   * `guest` et l'appartenance à l'organisation ne sont PAS touchés : le retrait de
   * l'organisation reste un geste de l'écran Membres (`organization.manage`).
   */
  async convertGuest(
    organizationId: string,
    guestUserId: string,
    body: ConvertGuestBody,
    actor: WorkActor,
  ): Promise<WorkExternalAccountView> {
    const perms = await this.members.permissionsOf(organizationId, guestUserId);
    if (perms === undefined) memberNotFound();
    if (!isProjectScopedRole(perms.role)) {
      invalid(
        'userId',
        'WORK_EXTERNAL_NOT_GUEST',
        'Seul un membre au rôle « Invité externe » se convertit en membre externe.',
      );
    }
    const identity = (await this.members.refs([guestUserId], organizationId)).get(guestUserId);
    const emailDoc = await this.connection
      .collection('user')
      .findOne(
        { _id: isWorkId(guestUserId) ? new Types.ObjectId(guestUserId) : (guestUserId as never) },
        { projection: { email: 1 } },
      );
    const email = String(emailDoc?.['email'] ?? '')
      .trim()
      .toLowerCase();
    if (!email) memberNotFound();
    const projects = await this.projectModel
      .find({ organizationId, _id: { $in: [...new Set(body.projectIds)].map(oid) } })
      .lean<WorkProjectLean[]>()
      .exec();
    if (projects.length !== new Set(body.projectIds).size) {
      notFound('WORK_PROJECT_NOT_FOUND', 'Projet introuvable.');
    }
    for (const p of projects) {
      if (!(p.memberUserIds ?? []).includes(guestUserId)) {
        invalid(
          'projectIds',
          'WORK_EXTERNAL_GUEST_NOT_MEMBER',
          `L’invité n’est pas membre du projet « ${p.name} ».`,
        );
      }
      if (p.status === 'archived') projectArchived();
      await this.checkInvitationRecords(organizationId, p, body);
    }
    const account = await this.ensureAccount(
      organizationId,
      {
        kind: body.kind,
        email,
        name: identity?.name ?? email,
        customerId: body.kind === 'client' ? body.customerId! : null,
        crmAccountId: null,
        supplierId: body.kind === 'consultant' ? body.supplierId! : null,
        referentUserId: body.kind === 'consultant' ? body.referentUserId! : null,
        convertedFromUserId: guestUserId,
      },
      actor,
    );
    for (const p of projects) {
      const pid = String(p._id);
      const already = await this.memberships
        .findOne({
          organizationId,
          accountId: String(account._id),
          projectId: pid,
          status: 'active',
        })
        .lean()
        .exec();
      if (!already) {
        await this.openMembership(
          organizationId,
          account,
          pid,
          body.canOpenProject === true,
          actor,
        );
      }
      await this.projectModel
        .updateOne(
          { _id: p._id, organizationId },
          {
            $pull: { memberUserIds: guestUserId, memberRoles: { kind: 'user', id: guestUserId } },
            $inc: { revision: 1 },
          },
        )
        .exec();
      await this.activity.record(organizationId, {
        projectId: pid,
        actorUserId: actor.userId,
        kind: 'project.member_removed',
        data: { userId: guestUserId, convertedTo: String(account._id) },
      });
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role ?? 'unknown',
      action: 'work.external.guest_converted',
      targetType: 'work_external_account',
      targetId: String(account._id),
      metadata: { guestUserId, kind: body.kind, projects: projects.length },
    });
    this.logger.debug(`Invité converti en compte externe ${String(account._id)}`);
    return (
      await this.accountViews(organizationId, [
        await this.requireAccount(organizationId, String(account._id)),
      ])
    )[0]!;
  }

  /** Projets dont l'invité est membre (écran de conversion). */
  async guestProjects(
    organizationId: string,
    guestUserId: string,
  ): Promise<{
    items: { projectId: string; name: string; kind: string; customerId: string | null }[];
  }> {
    const perms = await this.members.permissionsOf(organizationId, guestUserId);
    if (perms === undefined) memberNotFound();
    const docs = await this.projectModel
      .find(
        { organizationId, memberUserIds: guestUserId, status: { $ne: 'archived' } },
        { name: 1, kind: 1, 'links.customerId': 1 },
      )
      .lean<WorkProjectLean[]>()
      .exec();
    return {
      items: docs.map((d) => ({
        projectId: String(d._id),
        name: d.name,
        kind: d.kind,
        customerId: d.links?.customerId ?? null,
      })),
    };
  }
}
