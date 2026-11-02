// Campagnes et évaluations (ADR-0051 § 2.6, § 3.5, § 4). ADR-0051 — H15.
//
// - Campagne : trame et échelle SAISIES par l'organisation (`checkReviewTemplate` du
//   moteur) ; l'ouvrir crée une évaluation par collaborateur listé, avec pour évaluateur
//   le compte de son manager direct à cette date, sinon un détenteur de `hr.manage`
//   choisi par l'auteur ; jamais le collaborateur lui-même (`409 REVIEWER_IS_EMPLOYEE`).
// - Contenu : quatre sections CHIFFRÉES (`hr-review-crypto.ts`), écrites par leur seul
//   auteur (soi, évaluateur, `performance.read` pour `hrNote`) avec un audit STRICT
//   `hr.review.changed` (la section, jamais la valeur) dans la même transaction.
// - Lecture : `reveal` seulement, au plus 30 par heure et par utilisateur, audit STRICT
//   `hr.review.revealed` écrit AVANT tout déchiffrement (`503 HR_AUDIT_UNAVAILABLE`
//   sinon). Les listes ne portent que des statuts.
// - Notes : CHOISIES par l'évaluateur dans l'échelle de la section (`checkRating`) ;
//   `overall` facultatif, choisi, jamais calculé. Le moteur n'agrège que des statuts
//   (`reviewProgress`). Aucun effet automatique d'une évaluation.
// - Clôture : garde `hr.manage` + `performance.read`, puis `reviewCloseDecision` (ni
//   l'évalué ni l'évaluateur, sauf détenteur unique marqué) ; une évaluation partagée non
//   signée se clôt avec la mention « non signée », jamais un consentement présumé.

import {
  checkRating,
  checkReviewTemplate,
  reviewProgress,
  reviewTransition,
} from '@lalanda/engine';
import {
  CreateReviewCycleBody,
  HR_PERFORMANCE_AUDIT_EVENTS,
  HrId,
  PERFORMANCE_LIMITS,
  type ListReviewsQuery,
  type ReassignReviewBody,
  type ReviewListItemView,
  type ReviewSection,
  type ReviewStatus,
  type WriteReviewSectionBody,
} from '@lalanda/shared/hr';
import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import { z } from 'zod';

import { AuditEvent, type AuditEventDocument } from '../../authz/audit-event.schema.js';
import { AuditService } from '../../authz/audit.service.js';
import { AuthzService } from '../../authz/authz.service.js';
import { reviewCloseDecision } from '../../authz/permissions.js';
import { MASTER_KEYRING } from '../../integrations/keyring.provider.js';
import type { EncryptedValue, MasterKeyring } from '../../integrations/secrets-crypto.js';
import {
  conflict,
  invalidRequest,
  isDuplicateKey,
  staleRevision,
} from '../../sales/sales.errors.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import {
  auditUnavailable,
  employeeNotFound,
  inHrTransaction,
  revealRateLimited,
  secretsNotConfigured,
} from '../scope/hr-errors.js';
import { HrSettingsService } from '../settings/hr-settings.service.js';
import {
  HrPerformanceAccess,
  directManagerUserId,
  reviewCycleNotFound,
  reviewNotFound,
  type PerformanceViewer,
} from './hr-performance-access.js';
import { HrPerformanceNotifier } from './hr-performance-notifier.js';
import {
  decryptReviewSection,
  encryptReviewSection,
  type ReviewSectionContent,
} from './hr-review-crypto.js';
import {
  Goal,
  Review,
  ReviewCycle,
  type GoalDocument,
  type GoalLean,
  type ReviewCycleDocument,
  type ReviewCycleLean,
  type ReviewDocument,
  type ReviewGoalSnapshot,
  type ReviewLean,
  type ReviewTemplateSection,
} from './performance.schemas.js';

const HOUR_MS = 3_600_000;
const [REVEALED, CHANGED, REASSIGNED, CLOSED] = HR_PERFORMANCE_AUDIT_EVENTS;

// ── Corps propres à l'API (les autres sont dans `@lalanda/shared/hr`) ─────────

const ExpectedRevision = z.number().int().min(1);

/** `POST …/submit-self` · `…/submit-manager` · `…/share` · `…/acknowledge` · `…/close`. */
export const ReviewStepBody = z.object({ expectedRevision: ExpectedRevision }).strict();
export type ReviewStepBody = z.output<typeof ReviewStepBody>;

/** `POST /hr/review-cycles/:id/open` — évaluateur de repli pour un collaborateur sans manager. */
export const OpenReviewCycleBody = z
  .object({
    expectedRevision: ExpectedRevision,
    fallbackReviewerUserId: z.string().min(1).max(64).optional(),
  })
  .strict();
export type OpenReviewCycleBody = z.output<typeof OpenReviewCycleBody>;

/** `POST /hr/review-cycles/:id/close`. */
export const CloseReviewCycleBody = z.object({ expectedRevision: ExpectedRevision }).strict();
export type CloseReviewCycleBody = z.output<typeof CloseReviewCycleBody>;

/** `PUT /hr/review-cycles/:id` — brouillon seulement ; contrôlé comme une création. */
export const UpdateReviewCycleBody = z
  .object({
    expectedRevision: ExpectedRevision,
    label: z.unknown().optional(),
    period: z.unknown().optional(),
    template: z.unknown().optional(),
    includesSelfAssessment: z.unknown().optional(),
    openOn: z.unknown().optional(),
    dueOn: z.unknown().optional(),
    employeeIds: z.unknown().optional(),
  })
  .strict();

// ── Vues ────────────────────────────────────────────────────────────────────

export interface ReviewCycleView {
  id: string;
  label: string;
  period: { from: string; to: string };
  template: { sections: ReviewTemplateSection[] };
  includesSelfAssessment: boolean;
  openOn: string;
  dueOn: string;
  status: ReviewCycle['status'];
  employeeIds: string[];
  /** Décompte des STATUTS (moteur) ; jamais une note agrégée. */
  progress: ReturnType<typeof reviewProgress> | null;
  revision: number;
}

export interface ReviewRevealView {
  reviewId: string;
  cycleId: string;
  employeeId: string;
  status: ReviewStatus;
  revealedAt: string;
  template: { sections: ReviewTemplateSection[] };
  goalSnapshot: ReviewGoalSnapshot[] | null;
  closedUnsigned: boolean;
  sections: Partial<Record<ReviewSection, ReviewSectionContent | null>>;
}

export function reviewListItemOf(r: ReviewLean): ReviewListItemView {
  return {
    id: String(r._id),
    cycleId: r.cycleId,
    employeeId: r.employeeId,
    reviewerUserId: r.reviewerUserId,
    status: r.status,
    revision: r.revision,
  };
}

// ── Qui lit et qui écrit chaque section (§ 4) ─────────────────────────────────

interface ReviewRoles {
  self: boolean;
  reviewer: boolean;
  chain: boolean;
  perf: boolean;
}

type Rule = 'ok' | 'status' | 'forbidden';

const AFTER_SELF: readonly ReviewStatus[] = [
  'self_submitted',
  'manager_submitted',
  'shared',
  'acknowledged',
  'closed',
];
const AFTER_MANAGER: readonly ReviewStatus[] = [
  'manager_submitted',
  'shared',
  'acknowledged',
  'closed',
];
const AFTER_SHARE: readonly ReviewStatus[] = ['shared', 'acknowledged', 'closed'];
const AFTER_ACK: readonly ReviewStatus[] = ['acknowledged', 'closed'];

function readRule(section: ReviewSection, roles: ReviewRoles, status: ReviewStatus): Rule {
  const rules: Rule[] = [];
  const gate = (allowed: readonly ReviewStatus[]): Rule =>
    allowed.includes(status) ? 'ok' : 'status';
  if (roles.perf) rules.push('ok');
  switch (section) {
    case 'selfAssessment':
      if (roles.self) rules.push('ok');
      if (roles.reviewer || roles.chain) rules.push(gate(AFTER_SELF));
      break;
    case 'managerAssessment':
      if (roles.reviewer) rules.push('ok');
      if (roles.chain) rules.push(gate(AFTER_MANAGER));
      if (roles.self) rules.push(gate(AFTER_SHARE));
      break;
    case 'employeeComment':
      if (roles.self) rules.push('ok');
      if (roles.reviewer || roles.chain) rules.push(gate(AFTER_ACK));
      break;
    case 'hrNote':
      // `performance.read` seul (déjà poussé ci-dessus).
      break;
  }
  if (rules.includes('ok')) return 'ok';
  return rules.includes('status') ? 'status' : 'forbidden';
}

function writeRule(
  section: ReviewSection,
  roles: ReviewRoles,
  status: ReviewStatus,
  includesSelf: boolean,
): Rule {
  const gate = (allowed: readonly ReviewStatus[]): Rule =>
    allowed.includes(status) ? 'ok' : 'status';
  switch (section) {
    case 'selfAssessment':
      if (!roles.self) return 'forbidden';
      return includesSelf ? gate(['not_started']) : 'status';
    case 'managerAssessment':
      return roles.reviewer ? gate(['not_started', 'self_submitted']) : 'forbidden';
    case 'employeeComment':
      return roles.self ? gate(['shared']) : 'forbidden';
    case 'hrNote':
      return roles.perf
        ? gate(['not_started', 'self_submitted', 'manager_submitted', 'shared', 'acknowledged'])
        : 'forbidden';
  }
}

function sectionNotYours(): never {
  throw new ForbiddenException({
    code: 'REVIEW_SECTION_NOT_YOURS',
    message: 'Cette partie de l’évaluation ne vous revient pas.',
  });
}

function wrongStatus(status: ReviewStatus): never {
  conflict(
    'REVIEW_WRONG_STATUS',
    'Cette étape n’est pas possible dans le statut actuel de l’évaluation.',
    { status },
  );
}

function sectionMissing(section: ReviewSection): never {
  conflict('REVIEW_SECTION_MISSING', 'Rédigez cette partie avant de la remettre.', { section });
}

function invalidContent(code: string, message: string, details?: Record<string, unknown>): never {
  throw new UnprocessableEntityException({ code, message, ...(details ? { details } : {}) });
}

/** Contrôle d'un contenu de section contre la trame ; rend la forme stockée (chiffrée ensuite). */
export function reviewContentOf(
  section: ReviewSection,
  body: WriteReviewSectionBody,
  template: readonly ReviewTemplateSection[],
): ReviewSectionContent {
  const ids = new Set(template.map((s) => s.id));
  const allowedKeys =
    section === 'selfAssessment' || section === 'managerAssessment' ? ids : new Set(['comment']);
  for (const key of Object.keys(body.answers)) {
    if (!allowedKeys.has(key)) {
      invalidContent(
        'REVIEW_ANSWER_UNKNOWN_SECTION',
        'Réponse à une section inconnue de la trame.',
        {
          key,
        },
      );
    }
  }
  const content: ReviewSectionContent = { answers: { ...body.answers } };
  const hasRatings = body.ratings !== undefined && Object.keys(body.ratings).length > 0;
  const hasOverall = body.overall !== undefined && body.overall !== null;
  if (section !== 'managerAssessment') {
    if (hasRatings || hasOverall) {
      invalidContent(
        'REVIEW_RATINGS_NOT_ALLOWED',
        'Seule l’appréciation de l’évaluateur porte des notes.',
      );
    }
    return content;
  }
  const scales = template.filter((s) => s.kind === 'scale');
  if (hasRatings) {
    for (const [key, value] of Object.entries(body.ratings!)) {
      const s = template.find((t) => t.id === key);
      if (!s || !checkRating(s, value)) {
        invalidContent(
          'REVIEW_RATING_OUT_OF_SCALE',
          'Note hors de l’échelle de la section, ou section non notée.',
          { key },
        );
      }
    }
    content.ratings = { ...body.ratings! };
  }
  if (hasOverall) {
    // Choisie par l'évaluateur, jamais calculée : bornée par les échelles de la trame.
    const min = Math.min(...scales.map((s) => s.scale!.min));
    const max = Math.max(...scales.map((s) => s.scale!.max));
    const v = body.overall!;
    if (scales.length === 0 || !Number.isInteger(v) || v < min || v > max) {
      invalidContent(
        'REVIEW_RATING_OUT_OF_SCALE',
        'Appréciation générale hors des échelles de la trame (ou trame sans section notée).',
        { key: 'overall' },
      );
    }
    content.overall = v;
  }
  return content;
}

@Injectable()
export class HrReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    @InjectModel(ReviewCycle.name) private readonly cycles: Model<ReviewCycleDocument>,
    @InjectModel(Goal.name) private readonly goals: Model<GoalDocument>,
    @InjectModel(AuditEvent.name) private readonly auditEvents: Model<AuditEventDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(HrPerformanceAccess) private readonly access: HrPerformanceAccess,
    @Inject(HrPerformanceNotifier) private readonly notifier: HrPerformanceNotifier,
    @Inject(HrSettingsService) private readonly hrSettings: HrSettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
  ) {}

  // ── Campagnes (`performance.read` + `hr.manage`, vérifiés au guard) ────────

  async listCycles(organizationId: string): Promise<ReviewCycleView[]> {
    const cycles = await this.cycles
      .find({ organizationId })
      .sort({ 'period.to': -1, _id: 1 })
      .limit(200)
      .lean<ReviewCycleLean[]>()
      .exec();
    const ids = cycles.map((c) => String(c._id));
    const rows = await this.reviews
      .find({ organizationId, cycleId: { $in: ids } }, { _id: 1, cycleId: 1, status: 1 })
      .lean<Pick<ReviewLean, '_id' | 'cycleId' | 'status'>[]>()
      .exec();
    return cycles.map((c) => {
      const mine = rows
        .filter((r) => r.cycleId === String(c._id))
        .map((r) => ({ id: String(r._id), status: r.status }));
      return this.cycleView(c, c.status === 'draft' ? null : reviewProgress(mine, c));
    });
  }

  async createCycle(
    organizationId: string,
    pv: PerformanceViewer,
    body: CreateReviewCycleBody,
  ): Promise<ReviewCycleView> {
    this.checkTemplate(body.template.sections);
    const employeeIds = this.checkEmployees(pv, body.employeeIds);
    const [created] = await this.cycles.create([
      {
        organizationId,
        label: body.label,
        period: { from: body.period.from, to: body.period.to },
        template: { sections: body.template.sections.map(sectionOf) },
        includesSelfAssessment: body.includesSelfAssessment,
        openOn: body.openOn,
        dueOn: body.dueOn,
        status: 'draft',
        employeeIds,
        revision: 1,
        createdBy: pv.userId,
        updatedBy: pv.userId,
        _schemaVersion: 1,
      },
    ]);
    return this.cycleView(created!.toObject() as unknown as ReviewCycleLean, null);
  }

  async updateCycle(
    organizationId: string,
    pv: PerformanceViewer,
    cycleId: string,
    raw: unknown,
  ): Promise<ReviewCycleView> {
    const head = UpdateReviewCycleBody.safeParse(raw);
    if (!head.success) invalidRequest(head.error);
    const cycle = await this.requireCycle(organizationId, cycleId);
    if (cycle.revision !== head.data.expectedRevision) staleRevision(cycle.revision);
    if (cycle.status !== 'draft') {
      conflict('REVIEW_WRONG_STATUS', 'Seule une campagne en brouillon se modifie.', {
        status: cycle.status,
      });
    }
    const { expectedRevision: _r, ...patch } = raw as Record<string, unknown>;
    const merged = CreateReviewCycleBody.safeParse({
      label: cycle.label,
      period: cycle.period,
      template: cycle.template,
      includesSelfAssessment: cycle.includesSelfAssessment,
      openOn: cycle.openOn,
      dueOn: cycle.dueOn,
      employeeIds: cycle.employeeIds,
      ...patch,
    });
    if (!merged.success) invalidRequest(merged.error);
    const b = merged.data;
    this.checkTemplate(b.template.sections);
    const employeeIds = this.checkEmployees(pv, b.employeeIds);
    const res = await this.cycles
      .updateOne(
        { _id: cycle._id, organizationId, revision: cycle.revision, status: 'draft' },
        {
          $set: {
            label: b.label,
            period: { from: b.period.from, to: b.period.to },
            template: { sections: b.template.sections.map(sectionOf) },
            includesSelfAssessment: b.includesSelfAssessment,
            openOn: b.openOn,
            dueOn: b.dueOn,
            employeeIds,
            updatedBy: pv.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(cycle.revision + 1);
    return this.cycleView((await this.requireCycle(organizationId, cycleId))!, null);
  }

  async openCycle(
    organizationId: string,
    pv: PerformanceViewer,
    cycleId: string,
    body: OpenReviewCycleBody,
  ): Promise<ReviewCycleView> {
    const cycle = await this.requireCycle(organizationId, cycleId);
    if (cycle.revision !== body.expectedRevision) staleRevision(cycle.revision);
    if (cycle.status !== 'draft') {
      conflict('REVIEW_WRONG_STATUS', 'Seule une campagne en brouillon s’ouvre.', {
        status: cycle.status,
      });
    }
    if (cycle.employeeIds.length === 0) {
      conflict(
        'REVIEW_CYCLE_EMPTY',
        'Listez au moins un collaborateur avant d’ouvrir la campagne.',
      );
    }
    const members = new Set(
      (
        await this.connection
          .collection('memberships')
          .find({ organizationId }, { projection: { userId: 1 } })
          .toArray()
      ).map((m) => String(m['userId'])),
    );
    const hrManagers = new Set(await this.authz.holdersOf(organizationId, 'hr.manage'));
    const fallback = body.fallbackReviewerUserId ?? null;
    if (fallback !== null && !hrManagers.has(fallback)) {
      // Repli : un détenteur EFFECTIF de `hr.manage` de l'organisation (sinon 404).
      throw new UnprocessableEntityException({
        code: 'REVIEWER_NOT_ELIGIBLE',
        message: 'L’évaluateur de repli doit être un membre qui gère les RH.',
      });
    }
    const assignments: { employeeId: string; reviewerUserId: string }[] = [];
    const missing: string[] = [];
    for (const employeeId of cycle.employeeIds) {
      const e = pv.viewer.byId.get(employeeId);
      if (!e || e.status === 'anonymized') employeeNotFound();
      if (e.status !== 'active') {
        conflict(
          'REVIEW_EMPLOYEE_NOT_ACTIVE',
          'Un collaborateur listé n’est plus en poste : retirez-le de la campagne.',
          { employeeId },
        );
      }
      const own = e.userId ?? null;
      const manager = directManagerUserId(pv.viewer.byId, employeeId);
      let reviewer: string | null =
        manager !== null && manager !== own && members.has(manager) ? manager : null;
      if (reviewer === null && fallback !== null) {
        if (fallback === own) {
          conflict('REVIEWER_IS_EMPLOYEE', 'Un collaborateur ne s’évalue pas lui-même.', {
            employeeId,
          });
        }
        reviewer = fallback;
      }
      if (reviewer === null) missing.push(employeeId);
      else assignments.push({ employeeId, reviewerUserId: reviewer });
    }
    if (missing.length > 0) {
      throw new UnprocessableEntityException({
        code: 'REVIEWER_REQUIRED',
        message:
          'Des collaborateurs n’ont pas de manager avec un compte : choisissez un évaluateur de repli parmi les RH.',
        details: { employeeIds: missing },
      });
    }

    const now = new Date();
    let created: ReviewLean[] = [];
    await inHrTransaction(this.connection, async (session) => {
      const res = await this.cycles
        .updateOne(
          { _id: cycle._id, organizationId, revision: cycle.revision, status: 'draft' },
          {
            $set: { status: 'open', openedAt: now, openedBy: pv.userId, updatedBy: pv.userId },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(cycle.revision + 1);
      try {
        const docs = await this.reviews.create(
          assignments.map((a) => ({
            organizationId,
            cycleId: String(cycle._id),
            employeeId: a.employeeId,
            reviewerUserId: a.reviewerUserId,
            status: 'not_started',
            revision: 1,
            createdBy: pv.userId,
            updatedBy: pv.userId,
            _schemaVersion: 1,
          })),
          { session, ordered: true },
        );
        created = docs.map((d) => d.toObject() as unknown as ReviewLean);
      } catch (err) {
        if (isDuplicateKey(err)) staleRevision(cycle.revision + 1);
        throw err;
      }
      await this.audit.record(
        {
          organizationId,
          actorUserId: pv.userId,
          actorRole: pv.role,
          action: 'hr.review_cycle.opened',
          targetType: 'hr_review_cycle',
          targetId: String(cycle._id),
          metadata: { reviews: assignments.length },
        },
        { session },
      );
    });

    for (const r of created) {
      const e = pv.viewer.byId.get(r.employeeId)!;
      await this.notifier.send({
        organizationId,
        kind: 'hr.review_step',
        entityType: 'review',
        entityId: String(r._id),
        recipients: cycle.includesSelfAssessment ? [e.userId ?? null] : [r.reviewerUserId],
        title: cycle.includesSelfAssessment
          ? 'Votre auto-évaluation est attendue'
          : 'Une évaluation est à rédiger',
        href: '/rh/evaluations',
        actorUserId: pv.userId,
      });
    }
    const after = (await this.requireCycle(organizationId, cycleId))!;
    return this.cycleView(
      after,
      reviewProgress(
        created.map((r) => ({ id: String(r._id), status: r.status })),
        after,
      ),
    );
  }

  /** Clore une campagne : plus aucune évaluation n'y est créée ; aucun effet sur les évaluations. */
  async closeCycle(
    organizationId: string,
    pv: PerformanceViewer,
    cycleId: string,
    body: CloseReviewCycleBody,
  ): Promise<ReviewCycleView> {
    const cycle = await this.requireCycle(organizationId, cycleId);
    if (cycle.revision !== body.expectedRevision) staleRevision(cycle.revision);
    if (cycle.status !== 'open') {
      conflict('REVIEW_WRONG_STATUS', 'Seule une campagne ouverte se clôt.', {
        status: cycle.status,
      });
    }
    const res = await this.cycles
      .updateOne(
        { _id: cycle._id, organizationId, revision: cycle.revision },
        {
          $set: {
            status: 'closed',
            closedAt: new Date(),
            closedBy: pv.userId,
            updatedBy: pv.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(cycle.revision + 1);
    return (await this.listCycles(organizationId)).find((c) => c.id === cycleId)!;
  }

  // ── Évaluations ────────────────────────────────────────────────────────────

  /** Statuts SEULEMENT, jamais de contenu. */
  async list(
    organizationId: string,
    pv: PerformanceViewer,
    q: ListReviewsQuery,
  ): Promise<{ items: ReviewListItemView[] }> {
    const filter: Record<string, unknown> = { organizationId };
    if (q.cycleId !== undefined) filter['cycleId'] = q.cycleId;
    if (q.mine === 'true') {
      if (pv.selfEmployeeId === null) return { items: [] };
      filter['employeeId'] = pv.selfEmployeeId;
    } else if (!pv.perf) {
      const visible = this.access.visibleEmployeeIds(pv) as string[];
      filter['$or'] = [{ reviewerUserId: pv.userId }, { employeeId: { $in: visible } }];
    }
    let rows = await this.reviews
      .find(filter, {
        _id: 1,
        cycleId: 1,
        employeeId: 1,
        reviewerUserId: 1,
        status: 1,
        revision: 1,
      })
      .sort({ _id: 1 })
      .limit(1_000)
      .lean<ReviewLean[]>()
      .exec();
    if (q.toWrite === 'true') {
      const cycles = await this.cyclesById(
        organizationId,
        rows.map((r) => r.cycleId),
      );
      rows = rows.filter((r) => {
        const self = pv.selfEmployeeId === r.employeeId;
        const reviewer = r.reviewerUserId === pv.userId;
        const includesSelf = cycles.get(r.cycleId)?.includesSelfAssessment ?? true;
        if (self && ((r.status === 'not_started' && includesSelf) || r.status === 'shared')) {
          return true;
        }
        if (!reviewer) return false;
        return (
          r.status === 'self_submitted' ||
          r.status === 'manager_submitted' ||
          (r.status === 'not_started' && !includesSelf)
        );
      });
    }
    return { items: rows.map(reviewListItemOf) };
  }

  async writeSection(
    organizationId: string,
    pv: PerformanceViewer,
    reviewId: string,
    section: ReviewSection,
    body: WriteReviewSectionBody,
  ): Promise<ReviewListItemView> {
    const { review, roles, cycle } = await this.readable(organizationId, pv, reviewId);
    const rule = writeRule(section, roles, review.status, cycle.includesSelfAssessment);
    if (rule === 'forbidden') sectionNotYours();
    if (rule === 'status') wrongStatus(review.status);
    if (review.revision !== body.expectedRevision) staleRevision(review.revision);
    const content = reviewContentOf(section, body, cycle.template.sections);
    const keyring = this.requireKeyring();
    const now = new Date();
    const doc = {
      cipher: encryptReviewSection(
        { organizationId, reviewId: String(review._id), section },
        content,
        keyring,
        pv.userId,
      ),
      changedAt: now,
      changedBy: pv.userId,
    };
    await inHrTransaction(this.connection, async (session) => {
      const res = await this.reviews
        .updateOne(
          { _id: review._id, organizationId, revision: review.revision, status: review.status },
          { $set: { [section]: doc, updatedBy: pv.userId }, $inc: { revision: 1 } },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(review.revision + 1);
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: pv.userId,
          actorRole: pv.role,
          action: CHANGED,
          targetType: 'hr_review',
          targetId: String(review._id),
          // La section, jamais une valeur ni une note.
          metadata: { section, change: review[section] ? 'updated' : 'added' },
        },
        { session },
      );
    });
    return reviewListItemOf((await this.reviews.findById(review._id).lean<ReviewLean>().exec())!);
  }

  async reveal(
    organizationId: string,
    pv: PerformanceViewer,
    reviewId: string,
    sections: readonly ReviewSection[],
  ): Promise<ReviewRevealView> {
    const { review, roles, cycle } = await this.readable(organizationId, pv, reviewId);
    const wanted = [...new Set(sections)];
    for (const section of wanted) {
      const rule = readRule(section, roles, review.status);
      if (rule === 'forbidden') sectionNotYours();
      if (rule === 'status') wrongStatus(review.status);
    }
    const since = new Date(Date.now() - HOUR_MS);
    const recent = await this.auditEvents
      .countDocuments({ actorUserId: pv.userId, action: REVEALED, createdAt: { $gte: since } })
      .exec();
    if (recent >= PERFORMANCE_LIMITS.revealsPerHour) {
      revealRateLimited(PERFORMANCE_LIMITS.revealsPerHour);
    }
    if (wanted.some((s) => review[s])) this.requireKeyring();

    try {
      await this.audit.recordStrict({
        organizationId,
        actorUserId: pv.userId,
        actorRole: pv.role,
        action: REVEALED,
        targetType: 'hr_review',
        targetId: String(review._id),
        // Les sections, jamais une valeur.
        metadata: { sections: wanted, self: roles.self },
      });
    } catch {
      auditUnavailable();
    }

    const out: ReviewRevealView['sections'] = {};
    for (const section of wanted) {
      const f = review[section];
      if (!f) {
        out[section] = null;
        continue;
      }
      try {
        out[section] = decryptReviewSection(
          { organizationId, reviewId: String(review._id), section },
          f.cipher as EncryptedValue,
          this.keyring!,
        );
      } catch {
        throw new InternalServerErrorException({
          code: 'HR_REVIEW_UNREADABLE',
          message: 'Cette évaluation ne peut pas être déchiffrée.',
        });
      }
    }
    return {
      reviewId: String(review._id),
      cycleId: review.cycleId,
      employeeId: review.employeeId,
      status: review.status,
      revealedAt: new Date().toISOString(),
      template: { sections: cycle.template.sections },
      goalSnapshot: review.goalSnapshot ?? null,
      closedUnsigned: review.closedUnsigned ?? false,
      sections: out,
    };
  }

  async submitSelf(
    organizationId: string,
    pv: PerformanceViewer,
    reviewId: string,
    body: ReviewStepBody,
  ): Promise<ReviewListItemView> {
    const { review, roles, cycle } = await this.readable(organizationId, pv, reviewId);
    if (!roles.self) sectionNotYours();
    this.transition(review, 'self_submitted', cycle);
    if (!review.selfAssessment) sectionMissing('selfAssessment');
    const view = await this.step(organizationId, review, body.expectedRevision, pv, {
      status: 'self_submitted',
      selfSubmittedAt: new Date(),
    });
    await this.notifyStep(
      organizationId,
      review,
      [review.reviewerUserId],
      pv,
      'Une évaluation est à rédiger',
    );
    return view;
  }

  async submitManager(
    organizationId: string,
    pv: PerformanceViewer,
    reviewId: string,
    body: ReviewStepBody,
  ): Promise<ReviewListItemView> {
    const { review, roles, cycle } = await this.readable(organizationId, pv, reviewId);
    if (!roles.reviewer) sectionNotYours();
    this.transition(review, 'manager_submitted', cycle);
    if (!review.managerAssessment) sectionMissing('managerAssessment');
    // Instantané des objectifs de la période : titres et statuts, jamais un avancement.
    const goals = await this.goals
      .find({
        organizationId,
        employeeId: review.employeeId,
        $or: [
          { reviewCycleId: review.cycleId },
          { 'period.from': { $lte: cycle.period.to }, 'period.to': { $gte: cycle.period.from } },
        ],
      })
      .sort({ 'period.from': 1, _id: 1 })
      .limit(100)
      .lean<GoalLean[]>()
      .exec();
    return this.step(organizationId, review, body.expectedRevision, pv, {
      status: 'manager_submitted',
      managerSubmittedAt: new Date(),
      goalSnapshot: goals.map((g) => ({ goalId: String(g._id), title: g.title, status: g.status })),
    });
  }

  async share(
    organizationId: string,
    pv: PerformanceViewer,
    reviewId: string,
    body: ReviewStepBody,
  ): Promise<ReviewListItemView> {
    const { review, roles, cycle } = await this.readable(organizationId, pv, reviewId);
    if (!roles.reviewer) sectionNotYours();
    this.transition(review, 'shared', cycle);
    const view = await this.step(organizationId, review, body.expectedRevision, pv, {
      status: 'shared',
      sharedAt: new Date(),
    });
    const e = pv.viewer.byId.get(review.employeeId);
    await this.notifyStep(
      organizationId,
      review,
      [e?.userId ?? null],
      pv,
      'Votre évaluation est partagée : prenez-en connaissance',
    );
    return view;
  }

  /** Prise de connaissance : ce n'est PAS un accord ; aucun autre champ ne change. */
  async acknowledge(
    organizationId: string,
    pv: PerformanceViewer,
    reviewId: string,
    body: ReviewStepBody,
  ): Promise<ReviewListItemView> {
    const { review, roles, cycle } = await this.readable(organizationId, pv, reviewId);
    if (!roles.self) sectionNotYours();
    this.transition(review, 'acknowledged', cycle);
    return this.step(organizationId, review, body.expectedRevision, pv, {
      status: 'acknowledged',
      acknowledgedAt: new Date(),
      acknowledgedBy: pv.userId,
    });
  }

  /** Étape RH : garde `hr.manage` + `performance.read`, puis `reviewCloseDecision`. */
  async close(
    organizationId: string,
    pv: PerformanceViewer,
    reviewId: string,
    body: ReviewStepBody,
  ): Promise<ReviewListItemView & { soleApprover: boolean; unsigned: boolean }> {
    const { review, cycle } = await this.readable(organizationId, pv, reviewId);
    const t = this.transition(review, 'closed', cycle);
    if (review.revision !== body.expectedRevision) staleRevision(review.revision);
    const employee = pv.viewer.byId.get(review.employeeId);
    const [managers, readers, settings] = await Promise.all([
      this.authz.holdersOf(organizationId, 'hr.manage'),
      this.authz.holdersOf(organizationId, 'performance.read'),
      this.hrSettings.view(organizationId),
    ]);
    const readerSet = new Set(readers);
    const decision = reviewCloseDecision({
      closerUserId: pv.userId,
      employeeUserId:
        employee && employee.status !== 'anonymized' ? (employee.userId ?? null) : null,
      reviewerUserId: review.reviewerUserId,
      closerCountInOrg: new Set(managers.filter((u) => readerSet.has(u))).size,
      allowSoleApprover: settings.allowSoleApprover,
    });
    if (!decision.ok) {
      conflict(
        'REVIEW_CLOSE_FORBIDDEN',
        'L’évalué et l’évaluateur ne clôturent pas l’évaluation : une autre personne des RH le fait.',
      );
    }
    await inHrTransaction(this.connection, async (session) => {
      const res = await this.reviews
        .updateOne(
          { _id: review._id, organizationId, revision: review.revision, status: review.status },
          {
            $set: {
              status: 'closed',
              closedAt: new Date(),
              closedBy: pv.userId,
              closedUnsigned: t.unsigned,
              closedBySoleApprover: decision.soleApprover,
              updatedBy: pv.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(review.revision + 1);
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: pv.userId,
          actorRole: pv.role,
          action: CLOSED,
          targetType: 'hr_review',
          targetId: String(review._id),
          metadata: { soleApprover: decision.soleApprover, unsigned: t.unsigned },
        },
        { session },
      );
    });
    const after = (await this.reviews.findById(review._id).lean<ReviewLean>().exec())!;
    return {
      ...reviewListItemOf(after),
      soleApprover: decision.soleApprover,
      unsigned: t.unsigned,
    };
  }

  /** Changer d'évaluateur : garde `hr.manage` + `performance.read`, motif, audit strict. */
  async reassign(
    organizationId: string,
    pv: PerformanceViewer,
    reviewId: string,
    body: ReassignReviewBody,
  ): Promise<ReviewListItemView> {
    const { review } = await this.readable(organizationId, pv, reviewId);
    if (review.revision !== body.expectedRevision) staleRevision(review.revision);
    if (review.status !== 'not_started' && review.status !== 'self_submitted') {
      wrongStatus(review.status);
    }
    const member = await this.connection
      .collection('memberships')
      .findOne({ organizationId, userId: body.reviewerUserId }, { projection: { _id: 1 } });
    if (!member) {
      throw new UnprocessableEntityException({
        code: 'REVIEWER_NOT_ELIGIBLE',
        message: 'Le nouvel évaluateur doit être membre de l’organisation.',
      });
    }
    const employee = pv.viewer.byId.get(review.employeeId);
    if (employee?.userId && employee.userId === body.reviewerUserId) {
      conflict('REVIEWER_IS_EMPLOYEE', 'Un collaborateur ne s’évalue pas lui-même.');
    }
    await inHrTransaction(this.connection, async (session) => {
      const res = await this.reviews
        .updateOne(
          { _id: review._id, organizationId, revision: review.revision, status: review.status },
          // L'appréciation en cours, rédigée par l'ancien évaluateur, reste chiffrée en place.
          {
            $set: { reviewerUserId: body.reviewerUserId, updatedBy: pv.userId },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(review.revision + 1);
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: pv.userId,
          actorRole: pv.role,
          action: REASSIGNED,
          targetType: 'hr_review',
          targetId: String(review._id),
          metadata: { from: review.reviewerUserId, to: body.reviewerUserId, reason: body.reason },
        },
        { session },
      );
    });
    await this.notifyStep(
      organizationId,
      review,
      [body.reviewerUserId],
      pv,
      'Une évaluation est à rédiger',
    );
    return reviewListItemOf((await this.reviews.findById(review._id).lean<ReviewLean>().exec())!);
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private async readable(
    organizationId: string,
    pv: PerformanceViewer,
    reviewId: string,
  ): Promise<{ review: ReviewLean; roles: ReviewRoles; cycle: ReviewCycleLean }> {
    const id = HrId.safeParse(reviewId);
    if (!id.success) reviewNotFound();
    const review = await this.reviews
      .findOne({ _id: new Types.ObjectId(id.data), organizationId })
      .lean<ReviewLean>()
      .exec();
    if (!review) reviewNotFound();
    const employee: EmployeeLean | undefined = pv.viewer.byId.get(review.employeeId);
    const gone = !employee || employee.status === 'anonymized';
    const rel = gone ? null : this.access.relationTo(pv, review.employeeId);
    const roles: ReviewRoles = {
      self: rel?.self ?? false,
      reviewer: !gone && review.reviewerUserId === pv.userId,
      chain: rel?.chain ?? false,
      perf: pv.perf,
    };
    if (!roles.self && !roles.reviewer && !roles.chain && !roles.perf) reviewNotFound();
    const cycle = await this.cycles
      .findOne({ _id: new Types.ObjectId(review.cycleId), organizationId })
      .lean<ReviewCycleLean>()
      .exec();
    if (!cycle) reviewNotFound();
    return { review, roles, cycle };
  }

  private transition(
    review: ReviewLean,
    to: ReviewStatus,
    cycle: ReviewCycleLean,
  ): { unsigned: boolean } {
    const t = reviewTransition(review.status, to, cycle);
    if (!t.ok) wrongStatus(review.status);
    return t;
  }

  private async step(
    organizationId: string,
    review: ReviewLean,
    expectedRevision: number,
    pv: PerformanceViewer,
    set: Record<string, unknown>,
  ): Promise<ReviewListItemView> {
    if (review.revision !== expectedRevision) staleRevision(review.revision);
    const res = await this.reviews
      .updateOne(
        { _id: review._id, organizationId, revision: review.revision, status: review.status },
        { $set: { ...set, updatedBy: pv.userId }, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(review.revision + 1);
    return reviewListItemOf((await this.reviews.findById(review._id).lean<ReviewLean>().exec())!);
  }

  private async notifyStep(
    organizationId: string,
    review: ReviewLean,
    recipients: (string | null)[],
    pv: PerformanceViewer,
    title: string,
  ): Promise<void> {
    await this.notifier.send({
      organizationId,
      kind: 'hr.review_step',
      entityType: 'review',
      entityId: String(review._id),
      recipients,
      title,
      href: '/rh/evaluations',
      actorUserId: pv.userId,
    });
  }

  private async requireCycle(organizationId: string, cycleId: string): Promise<ReviewCycleLean> {
    const id = HrId.safeParse(cycleId);
    if (!id.success) reviewCycleNotFound();
    const cycle = await this.cycles
      .findOne({ _id: new Types.ObjectId(id.data), organizationId })
      .lean<ReviewCycleLean>()
      .exec();
    if (!cycle) reviewCycleNotFound();
    return cycle;
  }

  private async cyclesById(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, ReviewCycleLean>> {
    const unique = [...new Set(ids)].filter((i) => Types.ObjectId.isValid(i));
    const rows = await this.cycles
      .find({ organizationId, _id: { $in: unique.map((i) => new Types.ObjectId(i)) } })
      .lean<ReviewCycleLean[]>()
      .exec();
    return new Map(rows.map((c) => [String(c._id), c]));
  }

  private checkTemplate(sections: readonly ReviewTemplateSection[]): void {
    const check = checkReviewTemplate({ sections: sections.map(sectionOf) });
    if (!check.ok) {
      throw new UnprocessableEntityException({
        code: 'REVIEW_TEMPLATE_INVALID',
        message: 'La trame saisie est incomplète ou incohérente.',
        details: { issues: check.issues },
      });
    }
  }

  /** Collaborateurs de l'organisation, non anonymisés ; doublons retirés. */
  private checkEmployees(pv: PerformanceViewer, ids: readonly string[]): string[] {
    const unique = [...new Set(ids)];
    for (const id of unique) {
      const e = pv.viewer.byId.get(id);
      if (!e || e.status === 'anonymized') employeeNotFound();
    }
    return unique;
  }

  private cycleView(c: ReviewCycleLean, progress: ReviewCycleView['progress']): ReviewCycleView {
    return {
      id: String(c._id),
      label: c.label,
      period: { from: c.period.from, to: c.period.to },
      template: { sections: c.template.sections },
      includesSelfAssessment: c.includesSelfAssessment,
      openOn: c.openOn,
      dueOn: c.dueOn,
      status: c.status,
      employeeIds: c.employeeIds,
      progress,
      revision: c.revision,
    };
  }

  private requireKeyring(): MasterKeyring {
    if (!this.keyring) secretsNotConfigured();
    return this.keyring;
  }
}

function sectionOf(s: {
  id: string;
  title: string;
  kind: ReviewTemplateSection['kind'];
  scale?: { min: number; max: number; labels: string[] } | undefined;
}): ReviewTemplateSection {
  return s.scale === undefined
    ? { id: s.id, title: s.title, kind: s.kind }
    : {
        id: s.id,
        title: s.title,
        kind: s.kind,
        scale: { min: s.scale.min, max: s.scale.max, labels: [...s.scale.labels] },
      };
}
