// Soumissions publiques du formulaire de prospects — ADR-0048 § 3, § 6 et § 7.
//
// AUCUNE session : le jeton désigne le formulaire, donc l'organisation, et
// RIEN d'autre n'est lisible. Jeton inconnu, formulaire désactivé ou jeton
// remplacé rendent le même 404. La page publique ne reçoit que ce qu'elle
// affiche (titre, libellés, consentement, logo signé et couleur si choisis).
//
// Une soumission acceptée crée — dans l'organisation du jeton seulement — un
// prospect et un contact (ou réutilise le contact de même e-mail sans rien
// réécrire), une activité « à traiter » assignée au responsable (notifié par
// `crm.activity_assigned`), jamais d'opportunité sauf réglage explicite, puis la
// preuve du consentement. L'IP n'est jamais écrite : seulement son empreinte.

import {
  LEAD_FORM_ACCOUNT_ORIGIN,
  LEAD_FORM_DEFAULT_LABELS,
  LEAD_FORM_FIELD_MAX,
  LEAD_FORM_HONEYPOT_FIELD,
  PublicLeadSubmissionBody,
  validateLeadSubmission,
  type LeadSubmissionValues,
  type PublicLeadFormView,
  type PublicLeadSubmissionResult,
} from '@lalanda/shared/crm';
import { kinshasaDayOf } from '@lalanda/shared/work';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { brandAssetUrlFor } from '../../branding/brand-asset-url.js';
import { BrandingService } from '../../branding/branding.service.js';
import { invalidRequest, invalidRequestOf } from '../../sales/sales.errors.js';
import { HEX_COLOR } from '../../sales/documents/templates/template.contract.js';
import { WorkMembersService } from '../../work/work-members.service.js';
import { CrmAccountsService } from '../accounts/crm-accounts.service.js';
import { ActivitiesService } from '../activities.service.js';
import { ContactsService } from '../contacts.service.js';
import type { CrmActor } from '../crm-settings.service.js';
import { CrmActivity, type CrmActivityDocument } from '../crm.schemas.js';
import { OpportunitiesService } from '../opportunities.service.js';
import { leadFormNotFound } from './crm-lead-forms.service.js';
import { checkLeadFormTicket, isLeadFormToken, mintLeadFormTicket } from './lead-form-crypto.js';
import {
  CrmLeadForm,
  CrmLeadSubmission,
  LEAD_FORM_SYSTEM_ACTOR,
  type CrmLeadFormDocument,
  type CrmLeadFormLean,
  type CrmLeadSubmissionDocument,
} from './lead-form.schema.js';

const ACTOR: CrmActor = { userId: LEAD_FORM_SYSTEM_ACTOR, role: 'public' };

function bounded(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

@Injectable()
export class LeadIntakeService {
  private readonly logger = new Logger('LeadIntake');

  constructor(
    @InjectModel(CrmLeadForm.name) private readonly forms: Model<CrmLeadFormDocument>,
    @InjectModel(CrmLeadSubmission.name)
    private readonly submissions: Model<CrmLeadSubmissionDocument>,
    @InjectModel(CrmActivity.name) private readonly activityModel: Model<CrmActivityDocument>,
    @Inject(CrmAccountsService) private readonly accounts: CrmAccountsService,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
    @Inject(OpportunitiesService) private readonly opportunities: OpportunitiesService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(BrandingService) private readonly branding: BrandingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Formulaire ACTIF désigné par le jeton, ou 404 (même réponse dans tous les cas). */
  private async active(token: string): Promise<CrmLeadFormLean> {
    if (!isLeadFormToken(token)) leadFormNotFound();
    const form = await this.forms.findOne({ token, enabled: true }).lean<CrmLeadFormLean>().exec();
    if (!form) leadFormNotFound();
    return form;
  }

  async config(token: string, nowMs: number = Date.now()): Promise<PublicLeadFormView> {
    const form = await this.active(token);
    return {
      title: form.title,
      intro: form.intro ?? null,
      fields: form.fields
        .filter((f) => f.enabled)
        .map((f) => ({
          key: f.key,
          label: f.label ?? LEAD_FORM_DEFAULT_LABELS[f.key],
          required: f.required,
          maxLength: LEAD_FORM_FIELD_MAX[f.key],
        })),
      consent: { text: form.consentText, policyUrl: form.privacyPolicyUrl ?? null },
      successMessage: form.successMessage,
      branding: form.showBranding ? await this.brandingOf(form.organizationId) : null,
      ticket: mintLeadFormTicket(String(form._id), nowMs),
    };
  }

  /** Logo signé (24 h) et couleur principale, seulement s'il y a un logo. */
  private async brandingOf(
    organizationId: string,
  ): Promise<{ logoUrl: string | null; color: string | null } | null> {
    try {
      const state = await this.branding.state(organizationId);
      const logo = state.logos.primary ?? state.logos.horizontal ?? state.logos.symbol;
      if (!logo) return null;
      const color =
        state.primaryColor && HEX_COLOR.test(state.primaryColor) ? state.primaryColor : null;
      return { logoUrl: brandAssetUrlFor(logo.assetId), color };
    } catch {
      return null;
    }
  }

  async submit(
    token: string,
    rawBody: unknown,
    ipHash: string,
    nowMs: number = Date.now(),
  ): Promise<PublicLeadSubmissionResult> {
    const form = await this.active(token);
    const formId = String(form._id);
    const received: PublicLeadSubmissionResult = {
      status: 'received',
      message: form.successMessage,
    };
    const parsed = PublicLeadSubmissionBody.safeParse(rawBody);
    if (!parsed.success) invalidRequest(parsed.error);
    const body = parsed.data;

    // Champ piège : réponse identique à un succès, rien n'est créé.
    if ((body[LEAD_FORM_HONEYPOT_FIELD] ?? '').trim() !== '') {
      this.reject('honeypot', formId, ipHash);
      return received;
    }
    const ticket = checkLeadFormTicket(body.ticket, formId, nowMs);
    if (ticket === 'invalid') {
      this.reject('ticket_invalid', formId, ipHash);
      throw new BadRequestException({
        code: 'LEAD_FORM_TICKET_INVALID',
        message: 'Le formulaire a expiré : rechargez la page puis renvoyez votre demande.',
      });
    }
    if (ticket === 'too_fast') {
      this.reject('too_fast', formId, ipHash);
      throw new BadRequestException({
        code: 'LEAD_FORM_TOO_FAST',
        message: 'Merci de patienter quelques secondes avant d’envoyer.',
      });
    }
    const { values, issues } = validateLeadSubmission(
      form.fields.filter((f) => f.enabled),
      body,
    );
    if (issues.length > 0) invalidRequestOf(issues);

    return this.intake(form, values, ipHash, new Date(nowMs)).then(() => received);
  }

  private reject(reason: string, formId: string, ipHash: string): void {
    // Aucune donnée saisie, aucune IP : l'empreinte et le formulaire seulement.
    this.logger.warn(`Soumission refusée (${reason}) formulaire=${formId} ip=${ipHash}`);
  }

  private async intake(
    form: CrmLeadFormLean,
    values: LeadSubmissionValues,
    ipHash: string,
    now: Date,
  ): Promise<void> {
    const organizationId = form.organizationId;
    const name = values.name!;
    const assignee =
      form.assigneeUserId &&
      (await this.members.holds(organizationId, form.assigneeUserId, 'crm.manage'))
        ? form.assigneeUserId
        : null;

    // 1. Doublon par e-mail : contact et compte réutilisés, rien de réécrit.
    const existing = values.email
      ? await this.contacts.findByEmail(organizationId, values.email)
      : null;
    let contactId: string;
    let accountId: string | null;
    let customerId: string | null;
    if (existing) {
      contactId = String(existing._id);
      accountId = existing.accountId ?? null;
      customerId = existing.customerId ?? null;
    } else {
      // 2. Prospect nommé d'après l'entreprise, à défaut d'après la personne.
      const { account } = await this.accounts.create(
        organizationId,
        {
          name: bounded(values.company ?? name, 200),
          origin: LEAD_FORM_ACCOUNT_ORIGIN,
          ownerId: assignee,
        },
        ACTOR,
      );
      const contact = await this.contacts.create(
        organizationId,
        {
          name,
          jobTitle: null,
          email: values.email,
          phone: values.phone,
          accountId: account.id,
          customerId: null,
          companyName: null,
          notes: `Arrivé par le formulaire public le ${kinshasaDayOf(now)}.`,
        },
        ACTOR,
      );
      contactId = contact.id;
      accountId = account.id;
      customerId = null;
    }

    // 4. Opportunité : seulement sur réglage explicite, et avec un responsable éligible.
    let opportunityId: string | null = null;
    if (form.createOpportunity && assignee) {
      const opp = await this.opportunities.create(
        organizationId,
        null,
        {
          title: bounded(`Demande de ${values.company ?? name}`, 200),
          customerId: null,
          prospectName: null,
          contactId,
          amount: null,
          currency: form.opportunityCurrency,
          expectedCloseDate: null,
          ...(accountId ? { accountId } : {}),
          ownerId: assignee,
        },
        ACTOR,
      );
      opportunityId = opp.id;
    }

    // 3. Activité « à traiter » : échéance = réception, assignée au responsable.
    const notes = [
      existing ? 'Nouvelle demande d’un contact déjà connu (même adresse e-mail).' : null,
      values.message ? `Message : ${values.message}` : null,
      values.source ? `Source : ${values.source}` : null,
      values.phone && existing ? `Téléphone indiqué : ${values.phone}` : null,
      values.company && existing ? `Entreprise indiquée : ${values.company}` : null,
    ]
      .filter((x): x is string => x !== null)
      .join('\n');
    const activity = await this.activities.create(
      organizationId,
      {
        kind: 'follow_up',
        subject: bounded(`Demande reçue par le formulaire : ${name}`, 200),
        notes: notes === '' ? null : bounded(notes, 2000),
        dueAt: assignee ? now : null,
        opportunityId,
        contactId,
        customerId,
        assigneeUserId: assignee,
      },
      ACTOR,
    );
    if (accountId) {
      // Fil du compte (ADR-0040 § 2.4) : le compte est posé dans la même suite d'écritures.
      await this.activityModel
        .updateOne(
          { _id: new Types.ObjectId(activity.id), organizationId },
          { $set: { accountId } },
        )
        .exec();
    }

    // 5. Preuve du consentement, puis audit (aucune donnée saisie).
    const submission = await this.submissions.create({
      organizationId,
      formId: String(form._id),
      contactId,
      accountId,
      activityId: activity.id,
      opportunityId,
      duplicate: existing !== null,
      consent: {
        text: form.consentText,
        policyUrl: form.privacyPolicyUrl ?? null,
        acceptedAt: now,
      },
      ipHash,
      _schemaVersion: 1,
    });
    await this.audit.record({
      organizationId,
      actorUserId: LEAD_FORM_SYSTEM_ACTOR,
      actorRole: 'public',
      action: 'crm.lead_form.submission_accepted',
      targetType: 'crm_lead_submission',
      targetId: String(submission._id),
      metadata: { formId: String(form._id), duplicate: existing !== null, ipHash },
    });
  }
}
