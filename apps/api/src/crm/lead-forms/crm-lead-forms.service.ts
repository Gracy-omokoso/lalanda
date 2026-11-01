// Réglages du formulaire public de prospects — ADR-0048 § 2 et § 5.1.
//
// Un formulaire par organisation, créé DÉSACTIVÉ. Activer exige une politique
// de confidentialité, un texte de consentement et un responsable des demandes
// qui détient EFFECTIVEMENT `crm.manage` (ADR-0041). Remplacer le jeton rend
// l'ancien lien inopérant à l'instant (404 public).

import {
  defaultLeadFormFields,
  leadFormPublicPath,
  LEAD_FORM_DEFAULT_SUCCESS,
  type CreateLeadFormBody,
  type CrmLeadFormView,
  type UpdateLeadFormBody,
} from '@lalanda/shared/crm';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import {
  conflict,
  invalidRequestOf,
  isDuplicateKey,
  staleRevision,
} from '../../sales/sales.errors.js';
import { WorkMembersService } from '../../work/work-members.service.js';
import type { CrmActor } from '../crm-settings.service.js';
import { newLeadFormToken } from './lead-form-crypto.js';
import {
  CrmLeadForm,
  CrmLeadSubmission,
  type CrmLeadFormDocument,
  type CrmLeadFormLean,
  type CrmLeadSubmissionDocument,
} from './lead-form.schema.js';

export function leadFormNotFound(): never {
  throw new NotFoundException({
    code: 'LEAD_FORM_NOT_FOUND',
    message: 'Ce formulaire n’existe pas ou n’est plus actif.',
  });
}

@Injectable()
export class CrmLeadFormsService {
  constructor(
    @InjectModel(CrmLeadForm.name) private readonly forms: Model<CrmLeadFormDocument>,
    @InjectModel(CrmLeadSubmission.name)
    private readonly submissions: Model<CrmLeadSubmissionDocument>,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async get(organizationId: string): Promise<CrmLeadFormView | null> {
    const doc = await this.forms.findOne({ organizationId }).lean<CrmLeadFormLean>().exec();
    return doc ? this.view(doc) : null;
  }

  private async view(d: CrmLeadFormLean): Promise<CrmLeadFormView> {
    const formId = String(d._id);
    const [count, last] = await Promise.all([
      this.submissions.countDocuments({ organizationId: d.organizationId, formId }).exec(),
      this.submissions
        .findOne({ organizationId: d.organizationId, formId }, { createdAt: 1 })
        .sort({ createdAt: -1 })
        .lean<{ createdAt: Date }>()
        .exec(),
    ]);
    return {
      id: formId,
      enabled: d.enabled,
      token: d.token,
      publicPath: leadFormPublicPath(d.token),
      tokenRotatedAt: d.tokenRotatedAt ? new Date(d.tokenRotatedAt).toISOString() : null,
      title: d.title,
      intro: d.intro ?? null,
      fields: d.fields.map((f) => ({
        key: f.key,
        enabled: f.enabled,
        required: f.required,
        label: f.label ?? null,
      })),
      consentText: d.consentText,
      privacyPolicyUrl: d.privacyPolicyUrl ?? null,
      successMessage: d.successMessage,
      assigneeUserId: d.assigneeUserId ?? null,
      createOpportunity: d.createOpportunity,
      opportunityCurrency: d.opportunityCurrency,
      showBranding: d.showBranding,
      stats: {
        submissions: count,
        lastSubmissionAt: last ? new Date(last.createdAt).toISOString() : null,
      },
      revision: d.revision,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    };
  }

  async create(
    organizationId: string,
    body: CreateLeadFormBody,
    actor: CrmActor,
  ): Promise<CrmLeadFormView> {
    if (body.assigneeUserId !== null)
      await this.assertAssignee(organizationId, body.assigneeUserId);
    let created: CrmLeadFormDocument;
    try {
      created = await this.forms.create({
        organizationId,
        token: newLeadFormToken(),
        tokenRotatedAt: null,
        enabled: false,
        title: body.title,
        intro: null,
        fields: defaultLeadFormFields(),
        consentText: body.consentText,
        privacyPolicyUrl: body.privacyPolicyUrl,
        successMessage: LEAD_FORM_DEFAULT_SUCCESS,
        assigneeUserId: body.assigneeUserId,
        createOpportunity: false,
        opportunityCurrency: 'USD',
        showBranding: true,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (isDuplicateKey(err)) {
        conflict('LEAD_FORM_EXISTS', 'Votre organisation a déjà un formulaire public.');
      }
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'crm.lead_form.created',
      targetType: 'crm_lead_form',
      targetId: String(created._id),
    });
    return this.view(created.toObject() as CrmLeadFormLean);
  }

  async update(
    organizationId: string,
    body: UpdateLeadFormBody,
    actor: CrmActor,
  ): Promise<CrmLeadFormView> {
    const current = await this.requireOwn(organizationId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    // Le responsable est revérifié à chaque enregistrement qui le désigne.
    if (body.assigneeUserId !== null)
      await this.assertAssignee(organizationId, body.assigneeUserId);
    const { expectedRevision, ...set } = body;
    const updated = await this.forms
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision },
        { $set: { ...set, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<CrmLeadFormLean>()
      .exec();
    if (!updated) staleRevision((await this.requireOwn(organizationId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'crm.lead_form.updated',
      targetType: 'crm_lead_form',
      targetId: String(current._id),
      metadata: {
        enabled: body.enabled,
        wasEnabled: current.enabled,
        createOpportunity: body.createOpportunity,
        fields: body.fields.filter((f) => f.enabled).map((f) => f.key),
      },
    });
    return this.view(updated);
  }

  async rotateToken(
    organizationId: string,
    expectedRevision: number,
    actor: CrmActor,
  ): Promise<CrmLeadFormView> {
    const current = await this.requireOwn(organizationId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const updated = await this.forms
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision },
        {
          $set: { token: newLeadFormToken(), tokenRotatedAt: new Date(), updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<CrmLeadFormLean>()
      .exec();
    if (!updated) staleRevision((await this.requireOwn(organizationId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'crm.lead_form.token_rotated',
      targetType: 'crm_lead_form',
      targetId: String(current._id),
    });
    return this.view(updated);
  }

  private async requireOwn(organizationId: string): Promise<CrmLeadFormLean> {
    const doc = await this.forms.findOne({ organizationId }).lean<CrmLeadFormLean>().exec();
    if (!doc) leadFormNotFound();
    return doc;
  }

  /** Membre de l'organisation (404) détenant effectivement `crm.manage` (400). */
  private async assertAssignee(organizationId: string, userId: string): Promise<void> {
    const m = await this.members.permissionsOf(organizationId, userId);
    if (m === undefined) {
      throw new NotFoundException({
        code: 'CRM_MEMBER_NOT_FOUND',
        message: 'Membre introuvable dans cette organisation.',
      });
    }
    if (!(await this.members.holds(organizationId, userId, 'crm.manage'))) {
      invalidRequestOf([
        {
          path: 'assigneeUserId',
          code: 'CRM_ASSIGNEE_NOT_ELIGIBLE',
          message: 'Ce membre ne gère pas le CRM : il ne peut pas recevoir les demandes.',
        },
      ]);
    }
  }
}
