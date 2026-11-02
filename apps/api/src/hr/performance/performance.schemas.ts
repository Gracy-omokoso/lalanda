// Objectifs individuels, campagnes et évaluations (ADR-0051 § 2.5, § 2.6). ADR-0051 — H15.
//
// - `hr_goals` : objectif d'un collaborateur sur une période ; déclarations d'avancement
//   en ajout seul ; AUCUN avancement calculé.
// - `hr_review_cycles` : campagne, trame et échelle SAISIES par l'organisation.
// - `hr_reviews` : une évaluation par collaborateur listé à l'ouverture. Les quatre
//   sections (`selfAssessment`, `managerAssessment`, `employeeComment`, `hrNote`) valent
//   `{ cipher, changedAt, changedBy } | null` : `cipher` est le JSON du clair chiffré par
//   `hr-review-crypto.ts` (AAD = organisation + évaluation + section). Les notes choisies
//   (`ratings`, `overall`) sont DANS `managerAssessment`, donc chiffrées ; aucun champ en
//   clair ne porte une appréciation, une note ni un commentaire.
//
// Sérialisation : `toJSON` et `toObject` remplacent tout chiffré par `[redacted]`.

import type {
  GoalStatus,
  ReviewCycleStatus,
  ReviewSection,
  ReviewSectionKind,
  ReviewStatus,
} from '@lalanda/shared/hr';
import { REVIEW_SECTIONS } from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import { REDACTED } from '../../integrations/secret-value.js';
import type { EncryptedValue } from '../../integrations/secrets-crypto.js';

// ── Objectifs ───────────────────────────────────────────────────────────────

export interface GoalProgressEntry {
  at: Date;
  by: string;
  percent: number | null;
  note: string;
}

export type GoalTarget =
  { kind: 'text'; value: string } | { kind: 'number'; value: string; unit: string | null };

@Schema({ collection: 'hr_goals', timestamps: true, strict: true })
export class Goal {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  employeeId!: string;

  @Prop({ type: Object, required: true })
  period!: { from: string; to: string };

  @Prop({ type: String, default: null })
  reviewCycleId!: string | null;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, default: null })
  description!: string | null;

  @Prop({ type: String, default: null })
  measure!: string | null;

  @Prop({ type: Object, default: null })
  target!: GoalTarget | null;

  @Prop({ type: Number, default: null })
  weight!: number | null;

  @Prop({ type: String, default: null })
  workProjectId!: string | null;

  @Prop({ type: String, required: true })
  status!: GoalStatus;

  /** Qui a proposé ou posé l'objectif. */
  @Prop({ type: String, required: true })
  proposedBy!: string;

  @Prop({ type: String, default: null })
  agreedBy!: string | null;

  @Prop({ type: Date, default: null })
  agreedAt!: Date | null;

  /** Statut final posé par une personne, avec son commentaire. */
  @Prop({ type: String, default: null })
  closedBy!: string | null;

  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  @Prop({ type: String, default: null })
  closeComment!: string | null;

  @Prop({ type: [Object], default: [] })
  progress!: GoalProgressEntry[];

  @Prop({ type: String, required: true, default: 'private' })
  visibility!: 'private';

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type GoalDocument = HydratedDocument<Goal>;
export type GoalLean = Goal & { _id: Types.ObjectId };
export const GoalSchema = SchemaFactory.createForClass(Goal);
GoalSchema.index({ organizationId: 1, employeeId: 1, 'period.to': 1 });

// ── Campagnes ───────────────────────────────────────────────────────────────

export interface ReviewTemplateSection {
  id: string;
  title: string;
  kind: ReviewSectionKind;
  scale?: { min: number; max: number; labels: string[] };
}

@Schema({ collection: 'hr_review_cycles', timestamps: true, strict: true })
export class ReviewCycle {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: Object, required: true })
  period!: { from: string; to: string };

  @Prop({ type: Object, required: true })
  template!: { sections: ReviewTemplateSection[] };

  @Prop({ type: Boolean, required: true, default: true })
  includesSelfAssessment!: boolean;

  @Prop({ type: String, required: true })
  openOn!: string;

  @Prop({ type: String, required: true })
  dueOn!: string;

  @Prop({ type: String, required: true, default: 'draft' })
  status!: ReviewCycleStatus;

  @Prop({ type: [String], default: [] })
  employeeIds!: string[];

  @Prop({ type: Date, default: null })
  openedAt!: Date | null;

  @Prop({ type: String, default: null })
  openedBy!: string | null;

  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  @Prop({ type: String, default: null })
  closedBy!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ReviewCycleDocument = HydratedDocument<ReviewCycle>;
export type ReviewCycleLean = ReviewCycle & { _id: Types.ObjectId };
export const ReviewCycleSchema = SchemaFactory.createForClass(ReviewCycle);
ReviewCycleSchema.index({ organizationId: 1, status: 1, 'period.to': -1 });

// ── Évaluations ─────────────────────────────────────────────────────────────

export interface ReviewSectionDoc {
  cipher: EncryptedValue;
  changedAt: Date;
  changedBy: string;
}

/** Instantané des objectifs de la période à `manager_submitted` : titres et statuts. */
export interface ReviewGoalSnapshot {
  goalId: string;
  title: string;
  status: GoalStatus;
}

@Schema({ collection: 'hr_reviews', timestamps: true, strict: true })
export class Review {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  cycleId!: string;

  @Prop({ type: String, required: true })
  employeeId!: string;

  @Prop({ type: String, required: true })
  reviewerUserId!: string;

  @Prop({ type: String, required: true, default: 'not_started' })
  status!: ReviewStatus;

  @Prop({ type: Object, default: null })
  selfAssessment!: ReviewSectionDoc | null;

  @Prop({ type: Object, default: null })
  managerAssessment!: ReviewSectionDoc | null;

  @Prop({ type: Object, default: null })
  employeeComment!: ReviewSectionDoc | null;

  @Prop({ type: Object, default: null })
  hrNote!: ReviewSectionDoc | null;

  @Prop({ type: [Object], default: null })
  goalSnapshot!: ReviewGoalSnapshot[] | null;

  @Prop({ type: Date, default: null })
  selfSubmittedAt!: Date | null;

  @Prop({ type: Date, default: null })
  managerSubmittedAt!: Date | null;

  @Prop({ type: Date, default: null })
  sharedAt!: Date | null;

  @Prop({ type: Date, default: null })
  acknowledgedAt!: Date | null;

  @Prop({ type: String, default: null })
  acknowledgedBy!: string | null;

  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  @Prop({ type: String, default: null })
  closedBy!: string | null;

  /** Clôture d'une évaluation partagée non signée : jamais un consentement présumé. */
  @Prop({ type: Boolean, default: false })
  closedUnsigned!: boolean;

  @Prop({ type: Boolean, default: false })
  closedBySoleApprover!: boolean;

  /** Anonymisation du collaborateur : contenu effacé (ADR-0051 § 4). */
  @Prop({ type: Date, default: null })
  erasedAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ReviewDocument = HydratedDocument<Review>;
export type ReviewLean = Review & { _id: Types.ObjectId };
export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ organizationId: 1, cycleId: 1, status: 1 });
ReviewSchema.index({ organizationId: 1, employeeId: 1 });
ReviewSchema.index({ organizationId: 1, reviewerUserId: 1, status: 1 });
ReviewSchema.index({ organizationId: 1, cycleId: 1, employeeId: 1 }, { unique: true });

/** Remplace chaque chiffré par `[redacted]`. Idempotente. */
function amputerLesChiffres(_doc: unknown, ret: unknown): unknown {
  const bag = ret as Record<string, unknown>;
  for (const key of REVIEW_SECTIONS as readonly ReviewSection[]) {
    const field = bag[key];
    if (field !== null && typeof field === 'object') {
      bag[key] = { ...(field as object), cipher: REDACTED };
    }
  }
  return bag;
}
ReviewSchema.set('toJSON', { transform: amputerLesChiffres });
ReviewSchema.set('toObject', { transform: amputerLesChiffres });
