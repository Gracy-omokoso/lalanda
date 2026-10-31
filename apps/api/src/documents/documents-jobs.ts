// Tâches de la bibliothèque (ADR-0046 § 4.2, § 6.7). ADR-0046 — S6.
//
// `documents.reminders` (toutes les heures, à partir de 7 h à Kinshasa, motif de
// `hr.reminders`) : un document actif qui expire sous son délai de rappel (ou déjà
// expiré) donne UNE notification `documents.expiring` à son auteur et aux détenteurs
// EFFECTIFS de `docs.manage` — à condition que chacun PUISSE LE LIRE (dossier et liens,
// droits effectifs). Réclamation par insertion sous index unique
// (`document_reminder_claims`), puis `dedupeKey` identique au port : rejouer n'envoie
// rien de plus ; déplacer la date rouvre le rappel. Le titre de la notification ne
// porte JAMAIS le titre du document (une donnée) : une nature et une date.
//
// `documents.purge` (quotidienne) : effacement des objets des documents supprimés
// depuis 30 jours (`LibraryDocumentsService.purge`). Aucune durée de conservation n'est
// appliquée (décision ouverte n° 16).

import { DOCUMENT_LIMITS } from '@lalanda/shared/documents';
import { NOTIFICATION_LIMITS } from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Connection, HydratedDocument, Model } from 'mongoose';

import { holdersFilter, memberPermissionsOf } from '../authz/authz.service.js';
import { effectiveActions } from '../authz/permissions.js';
import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../notifications/notifications.port.js';
import { kinshasaDayOf } from '../sales/receipts/kinshasa-day.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { documentsActorFrom } from './document-access.js';
import { DocumentFoldersService } from './document-folders.service.js';
import {
  LibraryDocument,
  type LibraryDocumentDocument,
  type LibraryDocumentLean,
} from './document.schemas.js';
import { LibraryDocumentsService, documentExpiry } from './library-documents.service.js';

export const DOCUMENTS_REMINDERS_JOB = 'documents.reminders';
export const DOCUMENTS_PURGE_JOB = 'documents.purge';
const HOUR_MS = 60 * 60_000;
export const DOCUMENTS_REMINDERS_HOUR = 7;

const NATURE_LABELS: Record<string, string> = {
  contract: 'Un contrat',
  certificate: 'Une attestation',
  license: 'Une licence',
  insurance: 'Une police d’assurance',
  legal: 'Une pièce juridique',
  policy: 'Une politique interne',
  technical: 'Un document technique',
  other: 'Un document',
};

@Schema({ collection: 'document_reminder_claims', timestamps: false, strict: true })
export class DocumentReminderClaim {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  dedupeKey!: string;

  @Prop({ type: Date, required: true })
  claimedAt!: Date;
}
export type DocumentReminderClaimDocument = HydratedDocument<DocumentReminderClaim>;
export const DocumentReminderClaimSchema = SchemaFactory.createForClass(DocumentReminderClaim);
DocumentReminderClaimSchema.index(
  { organizationId: 1, dedupeKey: 1 },
  { unique: true, name: 'document_reminder_claim_unique' },
);

export interface DocumentsRemindersReport {
  organizations: number;
  claimed: number;
  notified: number;
}

function kinshasaHour(now: Date): number {
  return new Date(now.getTime() + 3_600_000).getUTCHours();
}

@Injectable()
export class DocumentsJobs implements OnModuleInit {
  private readonly logger = new Logger('DocumentsTaches');
  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(
    @InjectModel(LibraryDocument.name) private readonly documents: Model<LibraryDocumentDocument>,
    @InjectModel(DocumentReminderClaim.name)
    private readonly claims: Model<DocumentReminderClaimDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(DocumentFoldersService) private readonly folders: DocumentFoldersService,
    @Inject(LibraryDocumentsService) private readonly library: LibraryDocumentsService,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
  ) {
    this.port = port ?? noNotifications;
  }

  onModuleInit(): void {
    this.scheduler.every(DOCUMENTS_REMINDERS_JOB, HOUR_MS, async (_p, ctx) => {
      await this.reminders(ctx.now);
    });
    this.scheduler.every(DOCUMENTS_PURGE_JOB, 24 * HOUR_MS, async (_p, ctx) => {
      await this.library.purge(ctx.now);
    });
  }

  async reminders(now: Date = new Date()): Promise<DocumentsRemindersReport> {
    const report: DocumentsRemindersReport = { organizations: 0, claimed: 0, notified: 0 };
    if (kinshasaHour(now) < DOCUMENTS_REMINDERS_HOUR) return report;
    const today = kinshasaDayOf(now);
    const horizon = new Date(`${today}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + DOCUMENT_LIMITS.reminderDaysMax);
    const orgs = (await this.documents.distinct('organizationId', {
      deletedAt: null,
      status: 'active',
      expiresOn: { $type: 'string', $lte: horizon.toISOString().slice(0, 10) },
    })) as string[];
    for (const organizationId of orgs.sort()) {
      try {
        await this.remindOrg(organizationId, today, now, report);
        report.organizations += 1;
      } catch (err) {
        this.logger.warn(
          `Rappels des documents non émis (organisation ${organizationId}) : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return report;
  }

  private async remindOrg(
    organizationId: string,
    today: string,
    now: Date,
    report: DocumentsRemindersReport,
  ): Promise<void> {
    const rows = await this.documents
      .find({ organizationId, deletedAt: null, status: 'active', expiresOn: { $type: 'string' } })
      .lean<LibraryDocumentLean[]>()
      .exec();
    const due = rows.filter((d) => {
      const s = documentExpiry(d.expiresOn, d.reminderDays, today);
      return s === 'due_soon' || s === 'expired';
    });
    if (due.length === 0) return;
    const managers = await this.connection
      .collection('memberships')
      .find(holdersFilter(organizationId, 'docs.manage'))
      .toArray();
    const members = new Map<string, Record<string, unknown>>();
    for (const m of managers) members.set(String(m['userId']), m);
    const authors = [...new Set(due.map((d) => d.createdBy))].filter((u) => !members.has(u));
    if (authors.length > 0) {
      for (const m of await this.connection
        .collection('memberships')
        .find({ organizationId, userId: { $in: authors } })
        .toArray()) {
        members.set(String(m['userId']), m);
      }
    }
    // Index des dossiers par destinataire (droits EFFECTIFS, personnes).
    const indexes = new Map<string, Awaited<ReturnType<DocumentFoldersService['index']>>>();
    for (const [userId, m] of members) {
      const perms = memberPermissionsOf(m as never);
      if (!perms) continue;
      const actor = documentsActorFrom(
        userId,
        perms.role,
        effectiveActions(perms.role, perms.context),
      );
      indexes.set(userId, await this.folders.index(organizationId, actor));
    }
    const managerIds = new Set(managers.map((m) => String(m['userId'])));

    for (const d of due) {
      const documentId = String(d._id);
      const dedupeKey = `documents.expiring:${documentId}:${d.expiresOn}`.slice(
        0,
        NOTIFICATION_LIMITS.dedupeKeyMax,
      );
      try {
        await this.claims.create({ organizationId, dedupeKey, claimedAt: now });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) continue;
        throw err;
      }
      report.claimed += 1;
      const recipients = [...new Set([d.createdBy, ...managerIds])].sort();
      const verb = d.expiresOn! < today ? 'a expiré le' : 'expire le';
      const title = `${NATURE_LABELS[d.nature] ?? 'Un document'} ${verb} ${d.expiresOn}`;
      for (const userId of recipients) {
        const index = indexes.get(userId);
        if (!index || !index.canRead(d)) continue;
        try {
          await this.port.notify({
            organizationId,
            recipientUserId: userId,
            kind: 'documents.expiring',
            requiredAction: 'docs.read',
            source: { module: 'documents', entityType: 'library_document', entityId: documentId },
            title,
            href: '/documents/echeances',
            actorUserId: null,
            dedupeKey,
          });
          report.notified += 1;
        } catch (err) {
          this.logger.warn(
            `Notification de document non émise (organisation ${organizationId}) : ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  }
}
