// « Inviter sur Lalanda » depuis une fiche collaborateur (ADR-0068 § 1).
//
// (a) l'e-mail professionnel est celui d'un compte MEMBRE de l'organisation → la fiche
//     est reliée tout de suite (unicité `{ organizationId, userId }` respectée) ;
// (b) sinon → l'invitation d'ADR-0041 (`InvitationsService.create`, rôle par défaut
//     Salarié, même courriel) portant `employeeId` ; la fiche est reliée à l'acceptation.
//
// NON-ÉNUMÉRATION : en (b), la réponse est la même que l'adresse ait un compte dans une
// autre organisation ou non. Un compte d'une autre organisation n'est JAMAIS relié sans
// acceptation. Sans `members.invite`, rien n'est envoyé (`not_sent_permission`).

import type {
  EmployeeAccountView,
  EmployeeInvitationResult,
  EmployeeInviteOutcome,
} from '@lalanda/shared/hr';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { ORG_ROLE_LABELS } from '../../authz/permissions.js';
import { invitationUrl } from '../../mail/mail.links.js';
import { MailService } from '../../mail/mail.service.js';
import type { InvitationDocument } from '../../organizations/invitation.schema.js';
import { InvitationsService } from '../../organizations/invitations.service.js';
import { Membership, type MembershipDocument } from '../../organizations/membership.schema.js';
import { OrganizationsService } from '../../organizations/organizations.service.js';
import { conflict, isDuplicateKey } from '../../sales/sales.errors.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { Employee, type EmployeeDocument, type EmployeeLean } from './employee.schema.js';
import { HrEmployeesService } from './hr-employees.service.js';

/** Acteur d'une invitation : son nom figure dans le courriel ; `canInvite` = `members.invite`. */
export interface HrInviteActor extends HrActor {
  name: string | null;
  canInvite: boolean;
}

const result = (
  outcome: EmployeeInviteOutcome,
  emailDelivered: boolean | null = null,
): EmployeeInvitationResult => ({ outcome, emailDelivered });

function invitationNotFound(): never {
  throw new NotFoundException({
    code: 'INVITATION_NOT_FOUND',
    message: 'Aucune invitation en cours pour ce collaborateur.',
  });
}

@Injectable()
export class HrEmployeeInvitationsService {
  constructor(
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(HrEmployeesService) private readonly fiches: HrEmployeesService,
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** État du compte de la fiche (`hr.read`). */
  async account(organizationId: string, employeeId: string): Promise<EmployeeAccountView> {
    const e = await this.fiches.requireOwn(organizationId, employeeId);
    if (e.userId) return { state: 'linked', userId: e.userId, invitation: null };
    const inv = await this.invitations.openForEmployee(organizationId, employeeId);
    if (!inv) return { state: 'none', userId: null, invitation: null };
    return {
      state: inv.expiresAt.getTime() > Date.now() ? 'invitation_pending' : 'invitation_expired',
      userId: null,
      invitation: {
        id: String(inv._id),
        email: inv.email,
        expiresAt: inv.expiresAt.toISOString(),
        createdAt: (inv as unknown as { createdAt: Date }).createdAt.toISOString(),
      },
    };
  }

  /** « Inviter sur Lalanda ». */
  async invite(
    organizationId: string,
    employeeId: string,
    actor: HrInviteActor,
  ): Promise<EmployeeInvitationResult> {
    const e = await this.fiches.requireOwn(organizationId, employeeId);
    if (e.status === 'anonymized') {
      conflict('EMPLOYEE_ANONYMIZED', 'Ce dossier a été anonymisé : il ne se modifie plus.');
    }
    if (e.userId) return result('already_linked');
    if (!e.workEmail) return result('not_sent_no_email');
    if (!actor.canInvite) return result('not_sent_permission');
    const email = e.workEmail.trim().toLowerCase();

    // (a) Compte MEMBRE de cette organisation : relié tout de suite. L'existence d'un
    // compte HORS de l'organisation n'influe sur rien de ce qui est répondu.
    const memberUserId = await this.memberWithEmail(organizationId, email);
    if (memberUserId) return this.linkMember(organizationId, e, memberUserId, actor);

    // (b) Invitation d'ADR-0041 portant la fiche.
    const pending = await this.invitations.pendingForEmail(organizationId, email);
    if (pending) {
      if (pending.expiresAt.getTime() > Date.now()) {
        if (!pending.employeeId) {
          pending.employeeId = employeeId;
          await pending.save();
        }
        return result('invitation_pending');
      }
      await this.invitations.revoke(actor.userId, organizationId, String(pending._id));
    }
    return this.send(organizationId, employeeId, email, actor);
  }

  /** Renvoyer : l'invitation en cours est révoquée, une nouvelle part (nouveau lien, 7 jours). */
  async resend(
    organizationId: string,
    employeeId: string,
    actor: HrInviteActor,
  ): Promise<EmployeeInvitationResult> {
    const e = await this.fiches.requireOwn(organizationId, employeeId);
    if (e.userId) return result('already_linked');
    const open = await this.invitations.openForEmployee(organizationId, employeeId);
    if (!open) invitationNotFound();
    await this.invitations.revoke(actor.userId, organizationId, String(open._id));
    return this.invite(organizationId, employeeId, actor);
  }

  async cancel(organizationId: string, employeeId: string, actor: HrActor): Promise<void> {
    await this.fiches.requireOwn(organizationId, employeeId);
    const open = await this.invitations.openForEmployee(organizationId, employeeId);
    if (!open) invitationNotFound();
    await this.invitations.revoke(actor.userId, organizationId, String(open._id));
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.employee.invitation_cancelled',
      targetType: 'employee',
      targetId: employeeId,
      metadata: { invitationId: String(open._id) },
    });
  }

  /**
   * Amendement du 8 nov. 2026 : l'e-mail professionnel de la fiche a changé (ou a été
   * effacé). Toute invitation ouverte liée à la fiche qui vise une AUTRE adresse est
   * révoquée et tracée. `hr.manage` suffit : on retire un accès, on n'en donne aucun.
   * Renvoie le nombre d'invitations révoquées.
   */
  async revokeForChangedEmail(
    organizationId: string,
    employeeId: string,
    actor: HrActor,
  ): Promise<number> {
    const e = await this.fiches.requireOwn(organizationId, employeeId);
    const email = e.workEmail ? e.workEmail.trim().toLowerCase() : null;
    const open = await this.invitations.allOpenForEmployee(organizationId, employeeId);
    let revoked = 0;
    for (const inv of open) {
      if (email !== null && inv.email === email) continue;
      await this.invitations.revoke(actor.userId, organizationId, String(inv._id));
      revoked += 1;
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'hr.employee.invitation_revoked',
        targetType: 'employee',
        targetId: employeeId,
        metadata: { invitationId: String(inv._id), reason: 'work_email_changed' },
      });
    }
    return revoked;
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  /** Identifiant du compte MEMBRE de l'organisation qui porte cette adresse, sinon `null`. */
  private async memberWithEmail(organizationId: string, email: string): Promise<string | null> {
    const user = await this.connection
      .collection('user')
      .findOne({ email }, { projection: { _id: 1 } });
    if (!user) return null;
    const userId = String(user['_id']);
    const member = await this.memberships.exists({ organizationId, userId }).exec();
    return member ? userId : null;
  }

  private async linkMember(
    organizationId: string,
    e: EmployeeLean,
    userId: string,
    actor: HrActor,
  ): Promise<EmployeeInvitationResult> {
    const other = await this.employees
      .exists({ organizationId, userId, _id: { $ne: e._id } })
      .exec();
    if (other) return result('member_already_linked');
    try {
      const res = await this.employees
        .updateOne(
          { _id: e._id, organizationId, userId: null },
          { $set: { userId, updatedBy: actor.userId }, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) return result('already_linked');
    } catch (err) {
      if (isDuplicateKey(err)) return result('member_already_linked');
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.employee.account_linked',
      targetType: 'employee',
      targetId: String(e._id),
      metadata: { via: 'member' },
    });
    return result('linked');
  }

  private async send(
    organizationId: string,
    employeeId: string,
    email: string,
    actor: HrInviteActor,
  ): Promise<EmployeeInvitationResult> {
    let inv: InvitationDocument;
    try {
      inv = await this.invitations.create({
        organizationId,
        invitedBy: actor.userId,
        email,
        employeeId,
      });
    } catch (err) {
      // Course : une autre invitation vient d'être créée pour cette adresse.
      const code = (err as { response?: { code?: string } }).response?.code;
      if (err instanceof BadRequestException && code === 'INVITATION_ALREADY_PENDING') {
        return result('invitation_pending');
      }
      throw err;
    }
    const org = await this.organizations.findOrgById(organizationId);
    // `MailService` ne lève jamais : il rapporte. Sans chemin d'envoi configuré (tests,
    // développement), rien ne part et `delivered` vaut `false`.
    const delivery = await this.mail.sendInvitation({
      to: inv.email,
      url: invitationUrl(inv.token),
      organizationName: org.name,
      roleLabel: ORG_ROLE_LABELS[inv.role] ?? inv.role,
      inviterName: actor.name,
      expiresAt: inv.expiresAt,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.employee.invited',
      targetType: 'employee',
      targetId: employeeId,
      metadata: { invitationId: String(inv._id) },
    });
    return result('invitation_sent', delivery.delivered);
  }
}
