// Idea Lab — fiches, notes, expériences, promotion (ADR-0036 § 1 à § 3).
//
// L'API stocke ce que l'utilisateur SAISIT et remet au moteur ce qu'il faut
// calculer : score de validation, taux des expériences, classement, faits du
// parcours (`packages/engine/src/idea-lab`). Aucun score n'est stocké.
//
// Concurrence : chaque écriture lit la fiche, calcule son nouvel état, puis
// l'écrit à condition que sa `version` n'ait pas bougé (verrou optimiste) ; une
// écriture concurrente reçoit 409 `IDEA_CONFLICT` au lieu d'écraser l'autre.

import { randomBytes } from 'node:crypto';

import {
  compareIdeas,
  computeValidationScore,
  CURRENT_IDEA_VALIDATION_GRID,
  experimentChecklist,
  IDEA_NOTE_LABELS,
  ideaLabJourneyFacts,
  ideaValidationGrid,
  isIdeaCriterionId,
  summarizeExperiment,
  type IdeaComparisonRow,
  type IdeaExperimentChecklistItem,
  type IdeaExperimentSummary,
  type IdeaLabJourneyFacts,
  type IdeaValidationResult,
} from '@lalanda/engine';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { CanvasService } from '../canvas/canvas.service.js';
import { emptyCanvasBlocks } from '../canvas/canvas.schema.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  MAX_EXPERIMENTS_PER_IDEA,
  MAX_IDEAS_PER_ORGANIZATION,
  type ExperimentBody,
  type IdeaFiche,
  type RatingBody,
} from './idea-lab.dto.js';
import { planPromotion, type PromotionPlan } from './idea-lab-promotion.js';
import {
  IdeaLabIdea,
  type StoredExperiment,
  type StoredHypothesis,
  type StoredMarketSize,
  type StoredRating,
  type StoredAlternative,
} from './idea-lab.schemas.js';

export interface IdeaActor {
  userId: string;
  role: string;
}

type IdeaLean = IdeaLabIdea & { _id: unknown };

export interface IdeaExperimentView {
  id: string;
  type: StoredExperiment['type'];
  title: string;
  hypothesis: string;
  targetPct: number | null;
  status: StoredExperiment['status'];
  results: StoredExperiment['results'];
  conclusion: StoredExperiment['conclusion'];
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** Calculé par le moteur (taux, seuil, écart à la conclusion). */
  summary: IdeaExperimentSummary;
}

export interface IdeaView {
  id: string;
  title: string;
  problem: string;
  target: string;
  solution: string;
  alternatives: StoredAlternative[];
  revenueModel: string;
  country: string | null;
  market: string;
  hypotheses: StoredHypothesis[];
  marketSize: StoredMarketSize | null;
  gridVersion: string;
  ratings: {
    criterionId: string;
    note: number;
    proof: string;
    experimentIds: string[];
    ratedAt: string;
  }[];
  experiments: IdeaExperimentView[];
  experimentChecklist: { version: string; points: IdeaExperimentChecklistItem[] };
  validation: IdeaValidationResult;
  archived: boolean;
  promotions: { projectId: string; at: string; cards: number }[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaSummaryView {
  id: string;
  title: string;
  problem: string;
  archived: boolean;
  validation: IdeaValidationResult['score'];
  poidsRenseigne: number;
  experiments: number;
  completedExperiments: number;
  promotions: number;
  updatedAt: string;
}

export interface IdeaListView {
  ideas: IdeaSummaryView[];
  /** Idées actives, classées par le moteur (ADR-0036 § 1). */
  comparison: IdeaComparisonRow[];
  grid: {
    version: string;
    criteres: { id: string; libelle: string; poids: number; preuveAttendue: string }[];
    notes: { note: number; libelle: string }[];
    criteresMin: number;
    couvertureMinPct: number;
  };
  limits: { ideas: number; experimentsPerIdea: number };
}

export interface PromotionView {
  idea: IdeaView;
  projectId: string;
  canvasVersion: number | null;
  added: PromotionPlan['added'];
  present: PromotionPlan['present'];
  ignored: PromotionPlan['ignored'];
  empty: PromotionPlan['empty'];
}

function iso(d: Date | string | undefined | null): string {
  return d ? new Date(d).toISOString() : new Date(0).toISOString();
}

function validationOf(doc: IdeaLean): IdeaValidationResult {
  return computeValidationScore({
    gridVersion: doc.gridVersion,
    ratings: (doc.ratings ?? []).map((r) => ({
      criterionId: r.criterionId,
      note: r.note,
      preuve: r.proof,
      experimentIds: r.experimentIds,
    })),
    marketSize: doc.marketSize ? { source: doc.marketSize.source } : null,
  });
}

function summaryOf(e: StoredExperiment): IdeaExperimentSummary {
  return summarizeExperiment({
    id: e.id,
    type: e.type,
    status: e.status,
    targetPct: e.targetPct,
    conclusion: e.conclusion,
    results: e.results ?? {},
  });
}

export function toIdeaView(doc: IdeaLean): IdeaView {
  const experiments = (doc.experiments ?? []).map((e) => ({
    id: e.id,
    type: e.type,
    title: e.title,
    hypothesis: e.hypothesis,
    targetPct: e.targetPct,
    status: e.status,
    results: e.results,
    conclusion: e.conclusion,
    notes: e.notes,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
    summary: summaryOf(e),
  }));
  return {
    id: String(doc._id),
    title: doc.title,
    problem: doc.problem ?? '',
    target: doc.target ?? '',
    solution: doc.solution ?? '',
    alternatives: doc.alternatives ?? [],
    revenueModel: doc.revenueModel ?? '',
    country: doc.country ?? null,
    market: doc.market ?? '',
    hypotheses: doc.hypotheses ?? [],
    marketSize: doc.marketSize ?? null,
    gridVersion: doc.gridVersion,
    ratings: (doc.ratings ?? []).map((r) => ({
      criterionId: r.criterionId,
      note: r.note,
      proof: r.proof,
      experimentIds: r.experimentIds ?? [],
      ratedAt: iso(r.ratedAt),
    })),
    experiments,
    experimentChecklist: experimentChecklist(experiments.map((e) => e.summary)),
    validation: validationOf(doc),
    archived: doc.archived === true,
    promotions: (doc.promotions ?? []).map((p) => ({
      projectId: p.projectId,
      at: iso(p.at),
      cards: p.cards,
    })),
    version: doc.version,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function notFound(): never {
  throw new NotFoundException({ code: 'IDEA_NOT_FOUND', message: 'Idée introuvable.' });
}

@Injectable()
export class IdeaLabService {
  constructor(
    @InjectModel(IdeaLabIdea.name) private readonly ideaModel: Model<IdeaLabIdea>,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(CanvasService) private readonly canvas: CanvasService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Lecture ────────────────────────────────────────────────────────────────

  private async load(orgId: string, id: string): Promise<IdeaLean> {
    if (!isValidObjectId(id)) notFound();
    const doc = await this.ideaModel.findOne({ _id: id, organizationId: orgId }).lean<IdeaLean>();
    if (!doc) notFound();
    return doc;
  }

  async get(orgId: string, id: string): Promise<IdeaView> {
    return toIdeaView(await this.load(orgId, id));
  }

  async list(orgId: string): Promise<IdeaListView> {
    const docs = await this.ideaModel
      .find({ organizationId: orgId })
      .sort({ archived: 1, updatedAt: -1 })
      .limit(MAX_IDEAS_PER_ORGANIZATION * 2)
      .lean<IdeaLean[]>();
    const rows = docs.map((d) => ({ doc: d, validation: validationOf(d) }));
    const grid = CURRENT_IDEA_VALIDATION_GRID;
    return {
      ideas: rows.map(({ doc, validation }) => {
        const summaries = (doc.experiments ?? []).map(summaryOf);
        return {
          id: String(doc._id),
          title: doc.title,
          problem: doc.problem ?? '',
          archived: doc.archived === true,
          validation: validation.score,
          poidsRenseigne: validation.couverture.poidsRenseigne,
          experiments: summaries.length,
          completedExperiments: summaries.filter((s) => s.termineeAvecResultat).length,
          promotions: (doc.promotions ?? []).length,
          updatedAt: iso(doc.updatedAt),
        };
      }),
      comparison: compareIdeas(
        rows
          .filter(({ doc }) => doc.archived !== true)
          .map(({ doc, validation }) => ({ id: String(doc._id), titre: doc.title, validation })),
      ),
      grid: {
        version: grid.version,
        criteres: grid.criteres.map((c) => ({
          id: c.id,
          libelle: c.libelle,
          poids: c.poids,
          preuveAttendue: c.preuveAttendue,
        })),
        notes: Object.entries(IDEA_NOTE_LABELS).map(([note, libelle]) => ({
          note: Number(note),
          libelle,
        })),
        criteresMin: grid.criteresMin,
        couvertureMinPct: grid.couvertureMinPct,
      },
      limits: { ideas: MAX_IDEAS_PER_ORGANIZATION, experimentsPerIdea: MAX_EXPERIMENTS_PER_IDEA },
    };
  }

  /** Faits remis au parcours GROW (ADR-0036 § 5) — lecture seule. */
  async journeyFacts(orgId: string): Promise<IdeaLabJourneyFacts> {
    const docs = await this.ideaModel
      .find({ organizationId: orgId, archived: { $ne: true } })
      .limit(MAX_IDEAS_PER_ORGANIZATION * 2)
      .lean<IdeaLean[]>();
    return ideaLabJourneyFacts(
      docs.map((d) => ({
        archived: d.archived === true,
        problem: d.problem ?? '',
        target: d.target ?? '',
        solution: d.solution ?? '',
        validation: validationOf(d),
        experiments: (d.experiments ?? []).map(summaryOf),
      })),
    );
  }

  // ── Écritures ──────────────────────────────────────────────────────────────

  /** Écrit `set` si la version lue n'a pas bougé ; sinon 409. */
  private async write(
    orgId: string,
    doc: IdeaLean,
    set: Partial<IdeaLabIdea>,
    actor: IdeaActor,
  ): Promise<IdeaLean> {
    const updated = await this.ideaModel
      .findOneAndUpdate(
        { _id: doc._id, organizationId: orgId, version: doc.version },
        { $set: { ...set, updatedBy: actor.userId }, $inc: { version: 1 } },
        { new: true },
      )
      .lean<IdeaLean>();
    if (!updated) {
      throw new ConflictException({
        code: 'IDEA_CONFLICT',
        message:
          'Cette idée vient d’être modifiée par ailleurs : rechargez-la avant d’enregistrer.',
      });
    }
    return updated;
  }

  private async record(
    orgId: string,
    actor: IdeaActor,
    action: string,
    ideaId: string,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await this.audit.record({
      organizationId: orgId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action,
      targetType: 'idea_lab_idea',
      targetId: ideaId,
      metadata,
    });
  }

  async create(orgId: string, fiche: IdeaFiche, actor: IdeaActor): Promise<IdeaView> {
    const count = await this.ideaModel.countDocuments({ organizationId: orgId });
    if (count >= MAX_IDEAS_PER_ORGANIZATION) {
      throw new ForbiddenException({
        code: 'IDEA_LIMIT_REACHED',
        limit: MAX_IDEAS_PER_ORGANIZATION,
        message: `Votre organisation compte déjà ${MAX_IDEAS_PER_ORGANIZATION} idées, le maximum.`,
      });
    }
    const created = await this.ideaModel.create({
      organizationId: orgId,
      ...fiche,
      gridVersion: CURRENT_IDEA_VALIDATION_GRID.version,
      ratings: [],
      experiments: [],
      archived: false,
      promotions: [],
      version: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    const id = String(created._id);
    await this.record(orgId, actor, 'idea_lab.idea.created', id, {});
    return this.get(orgId, id);
  }

  async update(orgId: string, id: string, fiche: IdeaFiche, actor: IdeaActor): Promise<IdeaView> {
    const doc = await this.load(orgId, id);
    const updated = await this.write(orgId, doc, { ...fiche }, actor);
    await this.record(orgId, actor, 'idea_lab.idea.updated', id, {
      marketSize: fiche.marketSize !== null,
      hypotheses: fiche.hypotheses.length,
    });
    return toIdeaView(updated);
  }

  async setArchived(
    orgId: string,
    id: string,
    archived: boolean,
    actor: IdeaActor,
  ): Promise<IdeaView> {
    const doc = await this.load(orgId, id);
    const updated = await this.write(orgId, doc, { archived }, actor);
    await this.record(orgId, actor, 'idea_lab.idea.archived', id, { archived });
    return toIdeaView(updated);
  }

  async rate(
    orgId: string,
    id: string,
    criterionId: string,
    body: RatingBody,
    actor: IdeaActor,
  ): Promise<IdeaView> {
    const doc = await this.load(orgId, id);
    const grid = ideaValidationGrid(doc.gridVersion);
    if (!isIdeaCriterionId(criterionId) || !grid.criteres.some((c) => c.id === criterionId)) {
      throw new NotFoundException({
        code: 'CRITERION_NOT_FOUND',
        message: 'Critère inconnu de la grille de cette idée.',
      });
    }
    const known = new Set((doc.experiments ?? []).map((e) => e.id));
    const unknown = body.experimentIds.filter((e) => !known.has(e));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'EXPERIMENT_NOT_FOUND',
        message: 'Une expérience citée en preuve n’existe pas dans cette idée.',
      });
    }
    const rating: StoredRating = {
      criterionId,
      note: body.note,
      proof: body.proof,
      experimentIds: [...new Set(body.experimentIds)],
      ratedBy: actor.userId,
      ratedAt: new Date(),
    };
    const ratings = [...(doc.ratings ?? []).filter((r) => r.criterionId !== criterionId), rating];
    const updated = await this.write(orgId, doc, { ratings }, actor);
    await this.record(orgId, actor, 'idea_lab.rating.updated', id, {
      criterionId,
      note: body.note,
    });
    return toIdeaView(updated);
  }

  async clearRating(
    orgId: string,
    id: string,
    criterionId: string,
    actor: IdeaActor,
  ): Promise<IdeaView> {
    const doc = await this.load(orgId, id);
    const ratings = (doc.ratings ?? []).filter((r) => r.criterionId !== criterionId);
    if (ratings.length === (doc.ratings ?? []).length) {
      throw new NotFoundException({ code: 'RATING_NOT_FOUND', message: 'Aucune note à retirer.' });
    }
    const updated = await this.write(orgId, doc, { ratings }, actor);
    await this.record(orgId, actor, 'idea_lab.rating.cleared', id, { criterionId });
    return toIdeaView(updated);
  }

  async addExperiment(
    orgId: string,
    id: string,
    body: ExperimentBody,
    actor: IdeaActor,
  ): Promise<IdeaView> {
    const doc = await this.load(orgId, id);
    if ((doc.experiments ?? []).length >= MAX_EXPERIMENTS_PER_IDEA) {
      throw new ForbiddenException({
        code: 'EXPERIMENT_LIMIT_REACHED',
        limit: MAX_EXPERIMENTS_PER_IDEA,
        message: `Une idée porte au plus ${MAX_EXPERIMENTS_PER_IDEA} expériences.`,
      });
    }
    const now = new Date();
    const experiment: StoredExperiment = {
      id: randomBytes(8).toString('hex'),
      ...body,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    };
    const updated = await this.write(
      orgId,
      doc,
      { experiments: [...(doc.experiments ?? []), experiment] },
      actor,
    );
    await this.record(orgId, actor, 'idea_lab.experiment.created', id, {
      experimentId: experiment.id,
      type: body.type,
    });
    return toIdeaView(updated);
  }

  async updateExperiment(
    orgId: string,
    id: string,
    experimentId: string,
    body: ExperimentBody,
    actor: IdeaActor,
  ): Promise<IdeaView> {
    const doc = await this.load(orgId, id);
    const current = (doc.experiments ?? []).find((e) => e.id === experimentId);
    if (!current) {
      throw new NotFoundException({
        code: 'EXPERIMENT_NOT_FOUND',
        message: 'Expérience introuvable.',
      });
    }
    const experiments = (doc.experiments ?? []).map((e) =>
      e.id === experimentId ? { ...current, ...body, updatedAt: new Date() } : e,
    );
    const updated = await this.write(orgId, doc, { experiments }, actor);
    await this.record(orgId, actor, 'idea_lab.experiment.updated', id, {
      experimentId,
      status: body.status,
    });
    return toIdeaView(updated);
  }

  async deleteExperiment(
    orgId: string,
    id: string,
    experimentId: string,
    actor: IdeaActor,
  ): Promise<IdeaView> {
    const doc = await this.load(orgId, id);
    const experiments = (doc.experiments ?? []).filter((e) => e.id !== experimentId);
    if (experiments.length === (doc.experiments ?? []).length) {
      throw new NotFoundException({
        code: 'EXPERIMENT_NOT_FOUND',
        message: 'Expérience introuvable.',
      });
    }
    // La preuve d'une note ne cite plus une expérience disparue ; la note reste.
    const ratings = (doc.ratings ?? []).map((r) => ({
      ...r,
      experimentIds: (r.experimentIds ?? []).filter((e) => e !== experimentId),
    }));
    const updated = await this.write(orgId, doc, { experiments, ratings }, actor);
    await this.record(orgId, actor, 'idea_lab.experiment.deleted', id, { experimentId });
    return toIdeaView(updated);
  }

  /**
   * Passage vers le Canvas d'un projet de l'organisation (ADR-0036 § 3). Le projet
   * est créé, s'il est nouveau, par la création de projet existante (`POST
   * /projects`, limite de l'offre comprise) : cette méthode n'en crée jamais.
   */
  async promote(
    orgId: string,
    id: string,
    projectId: string,
    actor: IdeaActor,
  ): Promise<PromotionView> {
    const doc = await this.load(orgId, id);
    const project = await this.projects.findScoped(projectId, orgId);
    const pid = String(project._id);
    const current = await this.canvas.find(orgId, pid);
    const plan = planPromotion(current?.blocs ?? emptyCanvasBlocks(), {
      id: String(doc._id),
      problem: doc.problem ?? '',
      solution: doc.solution ?? '',
      target: doc.target ?? '',
      revenueModel: doc.revenueModel ?? '',
    });
    // Rien à ajouter : aucune écriture du Canvas, donc ni version ni révision inutiles.
    const canvasDoc =
      plan.added.length > 0
        ? await this.canvas.replace(orgId, pid, actor.userId, plan.blocs)
        : current;
    const promotions = [
      ...(doc.promotions ?? []),
      { projectId: pid, at: new Date(), by: actor.userId, cards: plan.added.length },
    ].slice(-20);
    const updated = await this.write(orgId, doc, { promotions }, actor);
    await this.record(orgId, actor, 'idea_lab.idea.promoted', id, {
      projectId: pid,
      cards: plan.added.length,
      ignored: plan.ignored.length,
    });
    return {
      idea: toIdeaView(updated),
      projectId: pid,
      canvasVersion: canvasDoc ? canvasDoc.version : null,
      added: plan.added,
      present: plan.present,
      ignored: plan.ignored,
      empty: plan.empty,
    };
  }

  /** Champs de la fiche transmis à l'IA (ADR-0036 § 4) — rien d'autre. */
  async aiInput(orgId: string, id: string) {
    const doc = await this.load(orgId, id);
    return {
      ideaId: String(doc._id),
      input: {
        title: doc.title,
        problem: doc.problem ?? '',
        target: doc.target ?? '',
        solution: doc.solution ?? '',
        alternatives: (doc.alternatives ?? []).map((a) => ({
          name: a.name,
          description: a.description,
        })),
        revenueModel: doc.revenueModel ?? '',
        market: doc.market ?? '',
        hypotheses: (doc.hypotheses ?? []).map((h) => ({ text: h.text })),
      },
    };
  }
}
