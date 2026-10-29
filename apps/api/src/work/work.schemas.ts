// Collections du gestionnaire de projets et de tâches du RUN — ADR-0039 § 2.
//
// Toutes portent `organizationId` (isolation : chaque requête le porte ; une
// ressource d'une autre organisation est introuvable, 404). Les règles d'entrée
// vivent dans `@lalanda/shared/work` (schémas zod) et dans les services ; les
// schémas Mongoose ne gardent que la forme. Les références vers d'autres
// documents sont des chaînes hexadécimales, comme dans le CRM.
//
// `work_invoice_links` appartient au lot L4a (`work/billing/**`) : ce lot ne le
// déclare pas, il le LIT par la connexion quand il doit refuser une suppression.

import {
  DEFAULT_WORK_COLUMNS,
  WORK_ACTIVITY_KINDS,
  WORK_COLUMN_CATEGORIES,
  WORK_LABEL_COLORS,
  WORK_PRIORITIES,
  WORK_PROJECT_KINDS,
  WORK_PROJECT_STATUSES,
  WORK_RATE_CURRENCIES,
  type WorkActivityKind,
  type WorkColumn,
  type WorkLabel,
  type WorkPriority,
  type WorkProjectKind,
  type WorkProjectStatus,
  type WorkRateCurrency,
} from '@lalanda/shared/work';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

const list = (values: readonly string[]): string[] => [...values];

// ── Sous-documents ──────────────────────────────────────────────────────────

@Schema({ _id: false, strict: true })
export class WorkColumnDoc {
  @Prop({ type: String, required: true })
  key!: string;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, required: true, enum: list(WORK_COLUMN_CATEGORIES) })
  category!: WorkColumn['category'];
}
const WorkColumnDocSchema = SchemaFactory.createForClass(WorkColumnDoc);

@Schema({ _id: false, strict: true })
export class WorkLabelDoc {
  @Prop({ type: String, required: true })
  key!: string;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, required: true, enum: list(WORK_LABEL_COLORS) })
  color!: WorkLabel['color'];
}
const WorkLabelDocSchema = SchemaFactory.createForClass(WorkLabelDoc);

// ── Réglages (un document par organisation) ─────────────────────────────────

@Schema({ collection: 'work_settings', timestamps: true, strict: true })
export class WorkSettings {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: [WorkLabelDocSchema], default: [] })
  labels!: WorkLabel[];

  @Prop({ type: [WorkColumnDocSchema], default: () => DEFAULT_WORK_COLUMNS.map((c) => ({ ...c })) })
  defaultColumns!: WorkColumn[];

  @Prop({ type: Number, required: true })
  dueSoonDays!: number;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkSettingsDocument = HydratedDocument<WorkSettings>;
export const WorkSettingsSchema = SchemaFactory.createForClass(WorkSettings);
WorkSettingsSchema.index({ organizationId: 1 }, { unique: true });

// ── Projets ─────────────────────────────────────────────────────────────────

@Schema({ _id: false, strict: true })
export class WorkProjectLinks {
  @Prop({ type: String, default: null })
  customerId!: string | null;

  @Prop({ type: String, default: null })
  opportunityId!: string | null;

  @Prop({ type: [String], default: [] })
  quoteIds!: string[];
}
const WorkProjectLinksSchema = SchemaFactory.createForClass(WorkProjectLinks);

@Schema({ _id: false, strict: true })
export class WorkProjectSourceDoc {
  @Prop({ type: String, required: true, enum: ['quote'] })
  kind!: 'quote';

  @Prop({ type: String, required: true })
  quoteId!: string;

  @Prop({ type: Number, required: true })
  quoteVersion!: number;

  @Prop({ type: Date, required: true })
  createdAt!: Date;
}
const WorkProjectSourceSchema = SchemaFactory.createForClass(WorkProjectSourceDoc);

@Schema({ collection: 'work_projects', timestamps: true, strict: true, minimize: false })
export class WorkProject {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, default: null })
  description!: string | null;

  @Prop({ type: String, required: true, enum: list(WORK_PROJECT_KINDS) })
  kind!: WorkProjectKind;

  @Prop({ type: String, required: true, enum: list(WORK_PROJECT_STATUSES), default: 'active' })
  status!: WorkProjectStatus;

  @Prop({ type: String, default: null })
  ownerUserId!: string | null;

  @Prop({ type: String, default: null })
  startDate!: string | null;

  @Prop({ type: String, default: null })
  dueDate!: string | null;

  @Prop({ type: WorkProjectLinksSchema, default: () => ({}) })
  links!: WorkProjectLinks;

  /** Écrit par le lot L4a (`POST /work/projects/from-quote`). */
  @Prop({ type: WorkProjectSourceSchema, default: null })
  source!: WorkProjectSourceDoc | null;

  @Prop({ type: [WorkColumnDocSchema], required: true })
  columns!: WorkColumn[];

  @Prop({ type: String, required: true, enum: ['organization'], default: 'organization' })
  visibility!: 'organization';

  /** Compteur des numéros de tâche (`$inc` atomique) ; jamais décrémenté. */
  @Prop({ type: Number, required: true, default: 0 })
  taskSeq!: number;

  /** Minuscules sans accents du nom (recherche `q`). */
  @Prop({ type: String, required: true })
  searchKey!: string;

  @Prop({ type: Date, default: null })
  archivedAt!: Date | null;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkProjectDocument = HydratedDocument<WorkProject>;
export type WorkProjectLean = WorkProject & { _id: Types.ObjectId };
export const WorkProjectSchema = SchemaFactory.createForClass(WorkProject);
WorkProjectSchema.index({ organizationId: 1, status: 1, updatedAt: -1 });
WorkProjectSchema.index({ organizationId: 1, 'links.customerId': 1 });
WorkProjectSchema.index({ organizationId: 1, 'links.opportunityId': 1 });
WorkProjectSchema.index(
  { organizationId: 1, 'source.quoteId': 1 },
  { unique: true, partialFilterExpression: { 'source.kind': 'quote' } },
);

// ── Tâches ──────────────────────────────────────────────────────────────────

@Schema({ _id: false, strict: true })
export class WorkDependencyDoc {
  @Prop({ type: String, required: true })
  taskId!: string;

  @Prop({ type: String, required: true, enum: ['finish_to_start'], default: 'finish_to_start' })
  type!: 'finish_to_start';
}
const WorkDependencyDocSchema = SchemaFactory.createForClass(WorkDependencyDoc);

@Schema({ _id: false, strict: true })
export class WorkTaskSourceDoc {
  @Prop({ type: String, required: true, enum: ['quote_line'] })
  kind!: 'quote_line';

  @Prop({ type: String, required: true })
  quoteId!: string;

  @Prop({ type: Number, required: true })
  lineIndex!: number;
}
const WorkTaskSourceSchema = SchemaFactory.createForClass(WorkTaskSourceDoc);

@Schema({ _id: false, strict: true })
export class WorkTaskBillingDoc {
  @Prop({ type: String, required: true })
  invoiceId!: string;

  @Prop({ type: Date, required: true })
  preparedAt!: Date;

  @Prop({ type: String, required: true })
  preparedBy!: string;
}
const WorkTaskBillingSchema = SchemaFactory.createForClass(WorkTaskBillingDoc);

/**
 * Rappels d'échéance déjà émis : l'échéance pour laquelle chacun est parti.
 * Changer l'échéance rouvre le rappel (ADR-0039 § 6.6) ; la tâche récurrente ne
 * reprend jamais une tâche déjà servie pour la même échéance.
 */
@Schema({ _id: false, strict: true })
export class WorkTaskReminders {
  @Prop({ type: String, default: null })
  dueSoonFor!: string | null;

  @Prop({ type: String, default: null })
  overdueFor!: string | null;
}
const WorkTaskRemindersSchema = SchemaFactory.createForClass(WorkTaskReminders);

@Schema({ collection: 'work_tasks', timestamps: true, strict: true, minimize: false })
export class WorkTask {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  @Prop({ type: Number, required: true })
  number!: number;

  @Prop({ type: String, default: null })
  parentTaskId!: string | null;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, default: null })
  description!: string | null;

  @Prop({ type: String, required: true })
  columnKey!: string;

  /** Dénormalisé de la catégorie de la colonne, écrit dans la même mise à jour. */
  @Prop({ type: Boolean, required: true, default: false })
  done!: boolean;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  @Prop({ type: String, default: null })
  completedBy!: string | null;

  @Prop({ type: String, required: true })
  rank!: string;

  @Prop({ type: String, default: null })
  assigneeUserId!: string | null;

  @Prop({ type: [String], default: [] })
  followerUserIds!: string[];

  @Prop({ type: String, required: true, enum: list(WORK_PRIORITIES), default: 'none' })
  priority!: WorkPriority;

  @Prop({ type: [String], default: [] })
  labelKeys!: string[];

  @Prop({ type: String, default: null })
  startDate!: string | null;

  @Prop({ type: String, default: null })
  dueDate!: string | null;

  @Prop({ type: Boolean, required: true, default: false })
  isMilestone!: boolean;

  @Prop({ type: [WorkDependencyDocSchema], default: [] })
  blockedBy!: WorkDependencyDoc[];

  /** Cache de la somme des saisies non supprimées (`$inc` transactionnel). */
  @Prop({ type: Number, required: true, default: 0 })
  loggedMinutes!: number;

  @Prop({ type: Number, default: null })
  estimateMinutes!: number | null;

  @Prop({ type: WorkTaskSourceSchema, default: null })
  source!: WorkTaskSourceDoc | null;

  /** Jalon seulement ; écrit par le lot L4a (brouillon de facture préparé). */
  @Prop({ type: WorkTaskBillingSchema, default: null })
  billing!: WorkTaskBillingDoc | null;

  @Prop({ type: WorkTaskRemindersSchema, default: () => ({}) })
  reminders!: WorkTaskReminders;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkTaskDocument = HydratedDocument<WorkTask>;
export type WorkTaskLean = WorkTask & { _id: Types.ObjectId };
export const WorkTaskSchema = SchemaFactory.createForClass(WorkTask);
WorkTaskSchema.index({ organizationId: 1, projectId: 1, number: 1 }, { unique: true });
WorkTaskSchema.index({ organizationId: 1, projectId: 1, columnKey: 1, rank: 1 });
WorkTaskSchema.index({ organizationId: 1, projectId: 1, parentTaskId: 1 });
WorkTaskSchema.index({ organizationId: 1, assigneeUserId: 1, done: 1, dueDate: 1 });
WorkTaskSchema.index({ organizationId: 1, done: 1, dueDate: 1 });
WorkTaskSchema.index({ organizationId: 1, projectId: 1, startDate: 1, dueDate: 1 });
WorkTaskSchema.index({ organizationId: 1, 'blockedBy.taskId': 1 });

// ── Commentaires ────────────────────────────────────────────────────────────

@Schema({ collection: 'work_comments', timestamps: true, strict: true, minimize: false })
export class WorkComment {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  @Prop({ type: String, required: true })
  taskId!: string;

  @Prop({ type: String, required: true })
  authorUserId!: string;

  /** Texte brut ; vidé à la suppression logique. */
  @Prop({ type: String, default: '' })
  body!: string;

  @Prop({ type: [String], default: [] })
  mentionedUserIds!: string[];

  @Prop({ type: [String], default: [] })
  attachmentIds!: string[];

  @Prop({ type: Date, default: null })
  editedAt!: Date | null;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkCommentDocument = HydratedDocument<WorkComment>;
export type WorkCommentLean = WorkComment & { _id: Types.ObjectId };
export const WorkCommentSchema = SchemaFactory.createForClass(WorkComment);
WorkCommentSchema.index({ organizationId: 1, taskId: 1, createdAt: 1 });

// ── Pièces jointes ──────────────────────────────────────────────────────────

export const WORK_ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;
export type WorkAttachmentType = (typeof WORK_ATTACHMENT_TYPES)[number];

@Schema({ collection: 'work_attachments', timestamps: true, strict: true })
export class WorkAttachment {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  @Prop({ type: String, required: true })
  taskId!: string;

  @Prop({ type: String, default: null })
  commentId!: string | null;

  /** 32 hexadécimaux tirés au hasard (`newObjectId()`), clé `work-attachments/<objectId>`. */
  @Prop({ type: String, required: true })
  objectId!: string;

  @Prop({ type: String, required: true })
  fileName!: string;

  /** Déduit du CONTENU, jamais de l'annonce du client. */
  @Prop({ type: String, required: true, enum: list(WORK_ATTACHMENT_TYPES) })
  contentType!: WorkAttachmentType;

  @Prop({ type: Number, required: true })
  size!: number;

  @Prop({ type: String, required: true })
  sha256!: string;

  @Prop({ type: String, required: true })
  uploadedBy!: string;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkAttachmentDocument = HydratedDocument<WorkAttachment>;
export type WorkAttachmentLean = WorkAttachment & { _id: Types.ObjectId };
export const WorkAttachmentSchema = SchemaFactory.createForClass(WorkAttachment);
WorkAttachmentSchema.index({ organizationId: 1, taskId: 1, createdAt: 1 });
WorkAttachmentSchema.index({ organizationId: 1, deletedAt: 1 });

// ── Temps passé ─────────────────────────────────────────────────────────────

@Schema({ collection: 'work_time_entries', timestamps: true, strict: true })
export class WorkTimeEntry {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  @Prop({ type: String, required: true })
  taskId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true })
  workedOn!: string;

  @Prop({ type: Number, required: true })
  minutes!: number;

  @Prop({ type: String, default: null })
  note!: string | null;

  /** Suppression logique : le coût passé d'un projet ne disparaît pas sans trace. */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkTimeEntryDocument = HydratedDocument<WorkTimeEntry>;
export type WorkTimeEntryLean = WorkTimeEntry & { _id: Types.ObjectId };
export const WorkTimeEntrySchema = SchemaFactory.createForClass(WorkTimeEntry);
WorkTimeEntrySchema.index({ organizationId: 1, projectId: 1, workedOn: 1 });
WorkTimeEntrySchema.index({ organizationId: 1, userId: 1, workedOn: 1 });
WorkTimeEntrySchema.index({ organizationId: 1, taskId: 1 });

// ── Coût horaire d'un membre (donnée salariale) ─────────────────────────────

@Schema({ collection: 'work_member_rates', timestamps: true, strict: true })
export class WorkMemberRate {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true, enum: list(WORK_RATE_CURRENCIES) })
  currency!: WorkRateCurrency;

  /** Chaîne décimale canonique (`"12.50"`), jamais un `number`. */
  @Prop({ type: String, required: true })
  hourlyCost!: string;

  @Prop({ type: String, required: true })
  effectiveFrom!: string;

  @Prop({ type: String, required: true })
  createdBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkMemberRateDocument = HydratedDocument<WorkMemberRate>;
export type WorkMemberRateLean = WorkMemberRate & { _id: Types.ObjectId };
export const WorkMemberRateSchema = SchemaFactory.createForClass(WorkMemberRate);
WorkMemberRateSchema.index({ organizationId: 1, userId: 1, effectiveFrom: 1 }, { unique: true });

// ── Historique (append-only) ────────────────────────────────────────────────

@Schema({ collection: 'work_activity', strict: true, minimize: false })
export class WorkActivity {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  @Prop({ type: String, default: null })
  taskId!: string | null;

  @Prop({ type: String, required: true })
  actorUserId!: string;

  @Prop({ type: String, required: true, enum: list(WORK_ACTIVITY_KINDS) })
  kind!: WorkActivityKind;

  /** Petit différentiel `{ from, to }`, ≤ 2 Kio, jamais de texte de commentaire. */
  @Prop({ type: Object, default: {} })
  data!: Record<string, unknown>;

  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkActivityDocument = HydratedDocument<WorkActivity>;
export type WorkActivityLean = WorkActivity & { _id: Types.ObjectId };
export const WorkActivitySchema = SchemaFactory.createForClass(WorkActivity);
WorkActivitySchema.index({ organizationId: 1, taskId: 1, at: -1 });
WorkActivitySchema.index({ organizationId: 1, projectId: 1, at: -1 });
