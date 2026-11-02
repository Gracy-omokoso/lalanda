// ─────────────────────────────────────────────────────────────────────────────
// ANNONCES DE LA PLATEFORME (ADR-0053 § 6.6 — lot P6)
//
// Circuit : brouillon → aperçu (nombre de destinataires, jamais la liste) → soumission →
// approbation par une AUTRE personne (`broadcastApprovalDecision`, exception de
// l'approbateur unique marquée) → envoi, qui exige de RETAPER le nombre approuvé ; le
// nombre est recalculé à l'envoi et un écart de plus de 10 % renvoie à l'approbation
// (`announcementSendDecision`). Annulation possible jusqu'à l'envoi.
//
// Livraison : IN-APP SEULEMENT (décision ouverte n° 9). L'envoi pose un accusé par
// destinataire (`platform_announcement_receipts`, unique par personne) ; la bannière
// et la cloche le lisent par `/me/announcements`. Ce service n'injecte AUCUN service
// d'e-mail : aucun envoi de masse externe n'est possible depuis ici.
//
// Journal : chaque étape écrit un événement au journal PLATEFORME (acteur réel, rôles
// relus). Une annonce ne touche aucune organisation en particulier : pas de miroir.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import type { Connection, Model } from 'mongoose';

import {
  PLATFORM_LIMITS,
  type AudienceFilter,
  type PlatformAction,
} from '@lalanda/shared/platform';

import {
  announcementSendDecision,
  broadcastApprovalDecision,
  platformActionHolders,
} from '../../authz/platform-actions.js';
import {
  PlatformRoleAssignment,
  type PlatformRoleAssignmentDocument,
} from '../../authz/platform-role-assignment.schema.js';
import { effectivePlanAt } from '../../billing/subscription-lifecycle.js';
import { Subscription, type SubscriptionDocument } from '../../billing/subscription.schema.js';
import { PlatformAuditService } from '../../integrations/platform-audit.service.js';
import { Membership, type MembershipDocument } from '../../organizations/membership.schema.js';
import {
  Organization,
  type OrganizationDocument,
} from '../../organizations/organization.schema.js';
import type { AdminActor } from '../admin.service.js';
import {
  ANNOUNCEMENT_SCHEMA_VERSION,
  PlatformAnnouncement,
  PlatformAnnouncementReceipt,
  type PlatformAnnouncementDocument,
  type PlatformAnnouncementReceiptDocument,
} from './announcement.schema.js';
import {
  audienceRoles,
  isAllAudience,
  selectAudience,
  unknownOrgRoles,
  type AudienceOrganization,
} from './audience.js';

const DAY_MS = 86_400_000;
const LIST_MAX = 200;

// ── Vues ─────────────────────────────────────────────────────────────────────

/** Vue CONSOLE : la catégorie et les nombres, jamais la liste des destinataires. */
export interface AdminAnnouncementView {
  id: string;
  title: string;
  body: string;
  channel: 'in_app';
  audience: AudienceFilter;
  status: PlatformAnnouncementDocument['status'];
  previewCount: number | null;
  previewedAt: string | null;
  audienceCountAtApproval: number | null;
  createdBy: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  soleApprover: boolean;
  sentBy: string | null;
  sentAt: string | null;
  recipientCount: number | null;
  expiresAt: string | null;
  canceledAt: string | null;
  createdAt: string;
}

/**
 * Vue DESTINATAIRE : le texte et les dates, rien d'autre — ni la catégorie, ni le
 * nombre de destinataires, ni l'auteur (le ciblage ne révèle aucune autre organisation).
 */
export interface MyAnnouncementView {
  id: string;
  kind: 'platform.announcement';
  title: string;
  body: string;
  startsAt: string;
  expiresAt: string;
  readAt: string | null;
  dismissedAt: string | null;
}

export interface AnnouncementDraftInput {
  title: string;
  body: string;
  audience: AudienceFilter;
  expiresAt?: string;
}

@Injectable()
export class PlatformAnnouncementsService {
  constructor(
    @InjectModel(PlatformAnnouncement.name)
    private readonly announcements: Model<PlatformAnnouncementDocument>,
    @InjectModel(PlatformAnnouncementReceipt.name)
    private readonly receipts: Model<PlatformAnnouncementReceiptDocument>,
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(PlatformRoleAssignment.name)
    private readonly platformRoles: Model<PlatformRoleAssignmentDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
  ) {}

  // ── Console ────────────────────────────────────────────────────────────────

  async list(limit?: number): Promise<AdminAnnouncementView[]> {
    const docs = await this.announcements
      .find({})
      .sort({ createdAt: -1 })
      .limit(clamp(limit))
      .exec();
    return docs.map(toAdminView);
  }

  async create(input: AnnouncementDraftInput, actor: AdminActor): Promise<AdminAnnouncementView> {
    assertAudience(input.audience);
    const expiresAt = futureDate(input.expiresAt);
    const doc = await this.announcements.create({
      title: input.title,
      body: input.body,
      channel: 'in_app',
      audience: input.audience,
      status: 'draft',
      expiresAt,
      createdBy: actor.userId,
      _schemaVersion: ANNOUNCEMENT_SCHEMA_VERSION,
    });
    await this.record(actor, 'platform.announcement.drafted', doc, {
      title: input.title,
      audience: JSON.stringify(input.audience),
    });
    return toAdminView(doc);
  }

  /** Brouillon seulement, par son auteur ; l'aperçu précédent ne vaut plus. */
  async update(
    id: string,
    input: AnnouncementDraftInput,
    actor: AdminActor,
  ): Promise<AdminAnnouncementView> {
    const doc = await this.load(id);
    if (doc.status !== 'draft') throw wrongStatus(doc.status, 'Seul un brouillon se modifie.');
    if (doc.createdBy !== actor.userId) {
      throw new ForbiddenException({
        code: 'ANNOUNCEMENT_NOT_AUTHOR',
        message: 'Seul l’auteur modifie son brouillon : la seconde personne l’approuve.',
      });
    }
    assertAudience(input.audience);
    doc.title = input.title;
    doc.body = input.body;
    doc.audience = input.audience;
    doc.markModified('audience');
    doc.expiresAt = futureDate(input.expiresAt);
    doc.previewCount = null;
    doc.previewedAt = null;
    await doc.save();
    await this.record(actor, 'platform.announcement.updated', doc, {
      audience: JSON.stringify(input.audience),
    });
    return toAdminView(doc);
  }

  /** Aperçu : le NOMBRE de destinataires, jamais leurs adresses. */
  async preview(id: string, actor: AdminActor): Promise<AdminAnnouncementView> {
    const doc = await this.load(id);
    if (doc.status === 'sent' || doc.status === 'canceled') {
      throw wrongStatus(doc.status, 'Annonce déjà envoyée ou annulée.');
    }
    const count = (await this.resolveAudience(doc.audience)).length;
    doc.previewCount = count;
    doc.previewedAt = new Date();
    await doc.save();
    await this.record(actor, 'platform.announcement.previewed', doc, { audienceCount: count });
    return toAdminView(doc);
  }

  async submit(id: string, actor: AdminActor): Promise<AdminAnnouncementView> {
    const doc = await this.load(id);
    if (doc.status !== 'draft') throw wrongStatus(doc.status, 'Seul un brouillon se soumet.');
    if (doc.previewCount === null) {
      throw new ConflictException({
        code: 'PREVIEW_REQUIRED',
        message: 'Affichez l’aperçu (texte et nombre de destinataires) avant de soumettre.',
      });
    }
    doc.status = 'pending_approval';
    doc.submittedBy = actor.userId;
    doc.submittedAt = new Date();
    await doc.save();
    await this.record(actor, 'platform.announcement.submitted', doc, {
      audienceCount: doc.previewCount,
    });
    return toAdminView(doc);
  }

  /** Seconde personne (§ 5.3) : l'auteur ou le soumetteur n'approuve pas, sauf détenteur unique. */
  async approve(id: string, actor: AdminActor): Promise<AdminAnnouncementView> {
    const doc = await this.load(id);
    if (doc.status !== 'pending_approval') {
      throw wrongStatus(doc.status, 'Seule une annonce soumise s’approuve.');
    }
    const decision = broadcastApprovalDecision({
      approverUserId: actor.userId,
      createdBy: doc.createdBy,
      submittedBy: doc.submittedBy,
      holdersCount: await this.effectiveHoldersCount('platform.announcements.approve'),
    });
    if (!decision.ok) {
      throw new ConflictException({
        code: decision.code,
        message: 'Vous avez préparé cette annonce : une autre personne doit l’approuver.',
      });
    }
    await this.assertSingleActiveAll(doc);
    const count = (await this.resolveAudience(doc.audience)).length;
    doc.status = 'approved';
    doc.approvedBy = actor.userId;
    doc.approvedAt = new Date();
    doc.soleApprover = decision.soleApprover;
    doc.audienceCountAtApproval = count;
    await doc.save();
    await this.record(actor, 'platform.announcement.approved', doc, {
      audienceCount: count,
      soleApprover: decision.soleApprover,
    });
    return toAdminView(doc);
  }

  /**
   * Envoi : nombre retapé, recompte, écart borné. Pose un accusé par destinataire,
   * de façon idempotente (index unique, `upsert`), puis passe l'annonce à `sent`.
   */
  async send(
    id: string,
    confirmedAudienceCount: number,
    actor: AdminActor,
    now: Date = new Date(),
  ): Promise<AdminAnnouncementView> {
    const doc = await this.load(id);
    if (doc.status !== 'approved') {
      throw wrongStatus(doc.status, 'Seule une annonce approuvée s’envoie.');
    }
    const recipients = await this.resolveAudience(doc.audience);
    const decision = announcementSendDecision({
      confirmedAudienceCount,
      audienceCountAtApproval: doc.audienceCountAtApproval ?? -1,
      recountedAudienceCount: recipients.length,
    });
    if (!decision.ok && decision.code === 'AUDIENCE_COUNT_MISMATCH') {
      await this.record(actor, 'platform.announcement.send_refused', doc, {
        code: decision.code,
        confirmedAudienceCount,
      });
      throw new ConflictException({
        code: decision.code,
        message: 'Le nombre retapé ne correspond pas au nombre de destinataires approuvé.',
      });
    }
    if (!decision.ok) {
      // L'audience a bougé de plus de 10 % : retour à l'approbation (§ 6.6).
      doc.status = 'pending_approval';
      doc.approvedBy = null;
      doc.approvedAt = null;
      doc.soleApprover = false;
      doc.audienceCountAtApproval = null;
      await doc.save();
      await this.record(actor, 'platform.announcement.reapproval_required', doc, {
        recountedAudienceCount: recipients.length,
      });
      throw new ConflictException({
        code: decision.code,
        message:
          'Le nombre de destinataires a changé de plus de 10 % depuis l’approbation : nouvelle approbation requise.',
      });
    }
    const expiresAt =
      doc.expiresAt ??
      new Date(now.getTime() + PLATFORM_LIMITS.announcementDefaultExpiryDays * DAY_MS);
    if (expiresAt.getTime() <= now.getTime()) {
      throw new ConflictException({
        code: 'ANNOUNCEMENT_EXPIRED',
        message: 'La date de fin est passée : annulez et préparez une nouvelle annonce.',
      });
    }
    await this.assertSingleActiveAll(doc, now);

    // Réservation : une seule transition `approved → sent`, même rejouée.
    const claimed = await this.announcements
      .findOneAndUpdate(
        { _id: doc._id, status: 'approved' },
        { $set: { status: 'sent', sentBy: actor.userId, sentAt: now, expiresAt } },
        { new: true },
      )
      .exec();
    if (!claimed) throw wrongStatus('sent', 'Annonce déjà envoyée.');
    try {
      await this.deliver(String(claimed._id), recipients, now, expiresAt);
    } catch (err) {
      await this.announcements
        .updateOne(
          { _id: claimed._id },
          { $set: { status: 'approved', sentBy: null, sentAt: null } },
        )
        .exec();
      throw err;
    }
    claimed.recipientCount = recipients.length;
    await claimed.save();
    await this.record(actor, 'platform.announcement.sent', claimed, {
      recipientCount: recipients.length,
      expiresAt: expiresAt.toISOString(),
      channel: 'in_app',
    });
    return toAdminView(claimed);
  }

  async cancel(id: string, reason: string, actor: AdminActor): Promise<AdminAnnouncementView> {
    const doc = await this.load(id);
    if (doc.status === 'sent' || doc.status === 'canceled') {
      throw wrongStatus(doc.status, 'Une annonce envoyée ou annulée ne s’annule plus.');
    }
    const from = doc.status;
    doc.status = 'canceled';
    doc.canceledBy = actor.userId;
    doc.canceledAt = new Date();
    await doc.save();
    await this.record(actor, 'platform.announcement.canceled', doc, {
      from,
      internalNote: reason,
    });
    return toAdminView(doc);
  }

  // ── Destinataire ───────────────────────────────────────────────────────────

  /** Ses annonces en cours, quelle que soit l'organisation active. */
  async mine(userId: string, now: Date = new Date()): Promise<MyAnnouncementView[]> {
    const receipts = await this.receipts
      .find({ userId, expiresAt: { $gt: now } })
      .sort({ deliveredAt: -1 })
      .limit(50)
      .exec();
    if (receipts.length === 0) return [];
    const ids = receipts.map((r) => r.announcementId).filter((i) => ObjectId.isValid(i));
    const docs = await this.announcements
      .find({ _id: { $in: ids }, status: 'sent' })
      .select({ title: 1, body: 1, sentAt: 1, expiresAt: 1 })
      .exec();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    return receipts.flatMap((r) => {
      const a = byId.get(r.announcementId);
      if (!a || !a.sentAt) return [];
      return [
        {
          id: r.announcementId,
          kind: 'platform.announcement' as const,
          title: a.title,
          body: a.body,
          startsAt: a.sentAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          readAt: iso(r.readAt),
          dismissedAt: iso(r.dismissedAt),
        },
      ];
    });
  }

  /** Lue (cloche). Idempotent ; `404` à qui n'en est pas destinataire. */
  async markRead(userId: string, id: string, now: Date = new Date()): Promise<MyAnnouncementView> {
    await this.touch(userId, id, { readAt: now }, now);
    return this.one(userId, id, now);
  }

  /** Fermée (bannière) : vaut aussi lecture. Idempotent. */
  async dismiss(userId: string, id: string, now: Date = new Date()): Promise<MyAnnouncementView> {
    await this.touch(userId, id, { dismissedAt: now, readAt: now }, now);
    return this.one(userId, id, now);
  }

  // ── Interne ────────────────────────────────────────────────────────────────

  private async touch(
    userId: string,
    id: string,
    fields: { readAt?: Date; dismissedAt?: Date },
    now: Date,
  ): Promise<void> {
    const receipt = await this.receipts
      .findOne({ announcementId: id, userId, expiresAt: { $gt: now } })
      .exec();
    if (!receipt) throw notFound();
    // Première date seulement : rejouer ne réécrit rien.
    if (fields.readAt && !receipt.readAt) receipt.readAt = fields.readAt;
    if (fields.dismissedAt && !receipt.dismissedAt) receipt.dismissedAt = fields.dismissedAt;
    if (receipt.isModified()) await receipt.save();
  }

  private async one(userId: string, id: string, now: Date): Promise<MyAnnouncementView> {
    const view = (await this.mine(userId, now)).find((a) => a.id === id);
    if (!view) throw notFound();
    return view;
  }

  private async deliver(
    announcementId: string,
    recipients: readonly string[],
    now: Date,
    expiresAt: Date,
  ): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < recipients.length; i += CHUNK) {
      await this.receipts.bulkWrite(
        recipients.slice(i, i + CHUNK).map((userId) => ({
          updateOne: {
            filter: { announcementId, userId },
            update: {
              $setOnInsert: {
                announcementId,
                userId,
                deliveredAt: now,
                expiresAt,
                readAt: null,
                dismissedAt: null,
                _schemaVersion: ANNOUNCEMENT_SCHEMA_VERSION,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }
  }

  /** Personnes visées par une catégorie, lues sur des MÉTADONNÉES seulement. */
  async resolveAudience(filter: AudienceFilter, now: Date = new Date()): Promise<string[]> {
    assertAudience(filter);
    const orgQuery = filter.countries ? { pays: { $in: filter.countries } } : {};
    const orgDocs = await this.orgs.find(orgQuery).select({ _id: 1, pays: 1 }).lean().exec();
    const orgIds = orgDocs.map((o) => String(o._id));
    const plans = new Map<string, { plan: string; status: string }>();
    if (filter.plans || filter.subscriptionStatuses) {
      const subs = await this.subscriptions.find({ organizationId: { $in: orgIds } }).exec();
      for (const s of subs) {
        plans.set(s.organizationId, { plan: effectivePlanAt(s, now), status: s.status });
      }
    }
    const organizations: AudienceOrganization[] = orgDocs.map((o) => ({
      id: String(o._id),
      pays: String(o.pays ?? ''),
      plan: plans.get(String(o._id))?.plan ?? 'free',
      status: plans.get(String(o._id))?.status ?? 'canceled',
    }));
    const roles = audienceRoles(filter);
    const memberships = await this.memberships
      .find({
        organizationId: { $in: orgIds },
        ...(roles !== null ? { role: { $in: roles } } : {}),
      })
      .select({ userId: 1, organizationId: 1, role: 1 })
      .lean()
      .exec();
    const userIds = [...new Set(memberships.map((m) => m.userId))].filter((u) =>
      ObjectId.isValid(u),
    );
    const db = this.connection.db;
    const users =
      db && userIds.length > 0
        ? await db
            .collection('user')
            .find(
              { _id: { $in: userIds.map((u) => new ObjectId(u)) } },
              { projection: { _id: 1, createdAt: 1, disabledAt: 1 } },
            )
            .toArray()
        : [];
    return selectAudience({
      filter,
      organizations,
      memberships: memberships.map((m) => ({
        userId: m.userId,
        organizationId: m.organizationId,
        role: String(m.role),
      })),
      users: users.map((u) => ({
        id: String(u._id),
        createdAt: u['createdAt'] instanceof Date ? u['createdAt'] : null,
        disabledAt: u['disabledAt'] instanceof Date ? u['disabledAt'] : null,
      })),
    });
  }

  /** § 6.6 : au plus UNE annonce active pour la catégorie « tous ». */
  private async assertSingleActiveAll(
    doc: PlatformAnnouncementDocument,
    now: Date = new Date(),
  ): Promise<void> {
    if (!isAllAudience(doc.audience)) return;
    const active = await this.announcements
      .find({ _id: { $ne: doc._id }, status: 'sent', expiresAt: { $gt: now } })
      .select({ audience: 1 })
      .exec();
    if (active.some((a) => isAllAudience(a.audience))) {
      throw new ConflictException({
        code: 'ANNOUNCEMENT_ALL_ACTIVE',
        message: 'Une annonce à tous les comptes est déjà en cours : attendez son échéance.',
      });
    }
  }

  /** Détenteurs EFFECTIFS : rôle non révoqué, non expiré, compte non bloqué. */
  private async effectiveHoldersCount(action: PlatformAction): Promise<number> {
    const now = new Date();
    const userIds: string[] = await this.platformRoles
      .distinct('userId', {
        role: { $in: platformActionHolders(action) },
        revokedAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      })
      .exec();
    const db = this.connection.db;
    if (!db || userIds.length === 0) return userIds.length;
    const oids = userIds.filter((u) => ObjectId.isValid(u)).map((u) => new ObjectId(u));
    const blocked = await db
      .collection('user')
      .countDocuments({ _id: { $in: oids }, disabledAt: { $ne: null } });
    return userIds.length - blocked;
  }

  private async load(id: string): Promise<PlatformAnnouncementDocument> {
    if (!ObjectId.isValid(id)) throw notFound();
    const doc = await this.announcements.findById(id).exec();
    if (!doc) throw notFound();
    return doc;
  }

  private async record(
    actor: AdminActor,
    action: string,
    doc: PlatformAnnouncementDocument,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action,
      targetType: 'announcement',
      targetId: String(doc._id),
      metadata: { status: doc.status, ...metadata },
    });
  }
}

// ── Fonctions locales ────────────────────────────────────────────────────────

function assertAudience(filter: AudienceFilter): void {
  const unknown = unknownOrgRoles(filter);
  if (unknown.length > 0) {
    throw new BadRequestException({
      code: 'AUDIENCE_INVALID',
      message: `Rôle d’organisation inconnu : ${unknown.join(', ')}.`,
    });
  }
  if (
    filter.signedUpAfter &&
    filter.signedUpBefore &&
    new Date(filter.signedUpAfter) >= new Date(filter.signedUpBefore)
  ) {
    throw new BadRequestException({
      code: 'AUDIENCE_INVALID',
      message: 'La période d’inscription est vide.',
    });
  }
}

function futureDate(raw: string | undefined): Date | null {
  if (raw === undefined) return null;
  const date = new Date(raw);
  if (date.getTime() <= Date.now()) {
    throw new BadRequestException({
      code: 'ANNOUNCEMENT_EXPIRED',
      message: 'La date de fin doit être dans le futur.',
    });
  }
  return date;
}

function wrongStatus(status: string, message: string): ConflictException {
  return new ConflictException({ code: 'ANNOUNCEMENT_WRONG_STATUS', status, message });
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: 'ANNOUNCEMENT_NOT_FOUND', message: 'Annonce introuvable.' });
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function clamp(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 100;
  return Math.min(Math.max(Math.trunc(limit), 1), LIST_MAX);
}

function toAdminView(d: PlatformAnnouncementDocument): AdminAnnouncementView {
  return {
    id: String(d._id),
    title: d.title,
    body: d.body,
    channel: 'in_app',
    audience: d.audience ?? {},
    status: d.status,
    previewCount: d.previewCount ?? null,
    previewedAt: iso(d.previewedAt),
    audienceCountAtApproval: d.audienceCountAtApproval ?? null,
    createdBy: d.createdBy,
    submittedBy: d.submittedBy ?? null,
    submittedAt: iso(d.submittedAt),
    approvedBy: d.approvedBy ?? null,
    approvedAt: iso(d.approvedAt),
    soleApprover: d.soleApprover === true,
    sentBy: d.sentBy ?? null,
    sentAt: iso(d.sentAt),
    recipientCount: d.recipientCount ?? null,
    expiresAt: iso(d.expiresAt),
    canceledAt: iso(d.canceledAt),
    createdAt: d.createdAt.toISOString(),
  };
}
