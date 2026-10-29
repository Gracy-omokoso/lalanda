// Business plan narratif — accès aux données (ADR-0037).
//
// Lit le projet, le Canvas et le plan figé ; n'y écrit JAMAIS. N'écrit que dans
// ses propres collections. Toutes les requêtes sont scopées par organisation ET
// projet : le projet a déjà été résolu par `ProjectsService.findScoped`, qui
// rend 404 pour un projet d'une autre organisation.

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { EngineError, ENGINE_VERSION, evaluateTemplate, type Template } from '@lalanda/engine';

import { CanvasService } from '../canvas/canvas.service.js';
import type { CanvasBlocks } from '../canvas/canvas.schema.js';
import { getTemplate } from '../evaluate/template-registry.js';
import { getParameterPack } from '../parameter-packs/parameter-pack-registry.js';
import { PlansService } from '../plans/plans.service.js';
import type { ProjectDocument } from '../projects/project.schema.js';
import {
  contentSha256,
  pendingProposals,
  type Currency,
  type EngineLine,
  type PlanHypothesis,
  type PlanSource,
} from './business-plan-assembly.js';
import { BUSINESS_PLAN_SECTION_IDS, type BusinessPlanSectionId } from './business-plan.sections.js';
import {
  BusinessPlan,
  BusinessPlanSettings,
  BusinessPlanVersion,
  type BusinessPlanDocument,
  type BusinessPlanSections,
  type BusinessPlanSettingsDocument,
  type BusinessPlanVersionDocument,
  type FrozenSection,
  type SectionProposal,
  type SectionState,
} from './business-plan.schemas.js';

/** Coupe-circuit plateforme de l'IA du business plan (ADR-0037 § 4). */
export function platformAiDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['BUSINESS_PLAN_AI'] ?? '').trim().toLowerCase() === 'off';
}

export function emptySection(): SectionState {
  return {
    text: '',
    origin: null,
    updatedBy: null,
    updatedAt: null,
    acceptedBy: null,
    acceptedAt: null,
    proposal: null,
  };
}

export interface PlanChoice {
  version: number;
  status: 'approved' | 'superseded';
  fingerprint: string;
  approvedAt: string;
}

type ProjectLike = Pick<
  ProjectDocument,
  'templateSlug' | 'parameterPackSlug' | 'deviseAffichage' | 'driverValues'
> & { _id: unknown };

function currencyOf(project: ProjectLike, template: Template): Currency {
  const pack = project.parameterPackSlug ? getParameterPack(project.parameterPackSlug) : undefined;
  return ((project.deviseAffichage as Currency | undefined) ??
    pack?.devise_principale ??
    template.devise_base ??
    'USD') as Currency;
}

function hypothesesFrom(
  template: Template,
  values: Record<string, number>,
  currency: Currency,
): PlanHypothesis[] {
  const groups = new Map((template.groupes_hypotheses ?? []).map((g) => [g.id, g.label]));
  const out: PlanHypothesis[] = [];
  for (const d of template.drivers) {
    const value = values[d.id];
    // Une hypothèse sans valeur résolue n'est pas affichée : jamais de zéro inventé.
    if (value === undefined || !Number.isFinite(value)) continue;
    out.push({
      id: d.id,
      label: d.label ?? d.id,
      value,
      format: d.type,
      currency: (d.devise as Currency | undefined) ?? currency,
      unit: d.unite ?? null,
      group: d.groupe ? (groups.get(d.groupe) ?? null) : null,
    });
  }
  return out;
}

function sheetTitlesOf(template: Template): Record<string, string> {
  const titles: Record<string, string> = { amortissements: 'Amortissements' };
  for (const f of template.feuilles) titles[f.id] = f.label ?? f.id;
  return titles;
}

function linesOf(lines: readonly EngineLine[]): EngineLine[] {
  return lines.map((l) => ({
    sheetId: l.sheetId,
    lineId: l.lineId,
    label: l.label,
    value: l.value,
    format: l.format,
    ...(l.seuil ? { seuil: l.seuil } : {}),
  }));
}

@Injectable()
export class BusinessPlanService {
  constructor(
    @InjectModel(BusinessPlan.name) private readonly docs: Model<BusinessPlanDocument>,
    @InjectModel(BusinessPlanVersion.name)
    private readonly versions: Model<BusinessPlanVersionDocument>,
    @InjectModel(BusinessPlanSettings.name)
    private readonly settings: Model<BusinessPlanSettingsDocument>,
    @Inject(PlansService) private readonly plans: PlansService,
    @Inject(CanvasService) private readonly canvas: CanvasService,
  ) {}

  /** Document de travail du projet, créé vide à la première lecture. */
  async document(organizationId: string, projectId: string): Promise<BusinessPlanDocument> {
    const doc = await this.docs
      .findOneAndUpdate(
        { organizationId, projectId },
        {
          $setOnInsert: {
            organizationId,
            projectId,
            planVersion: null,
            sections: {},
            updatedBy: null,
            _schemaVersion: 1,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc;
  }

  async canvasBlocks(organizationId: string, projectId: string): Promise<Partial<CanvasBlocks>> {
    const c = await this.canvas.find(organizationId, projectId);
    return c?.blocs ?? {};
  }

  /** Versions figées du plan financier, sans leur snapshot. */
  async planChoices(organizationId: string, projectId: string): Promise<PlanChoice[]> {
    const docs = await this.plans.listByProject(organizationId, projectId);
    return docs.map((p) => ({
      version: p.version,
      status: p.status,
      fingerprint: p.fingerprint,
      approvedAt: p.approvedAt.toISOString(),
    }));
  }

  /**
   * Source des chiffres : snapshot du plan figé rattaché (AUCUN recalcul), ou
   * évaluation en direct du projet, marquée brouillon.
   */
  async source(
    organizationId: string,
    project: ProjectLike,
    planVersion: number | null,
  ): Promise<PlanSource> {
    const projectId = String(project._id);
    if (planVersion !== null) {
      const plan = await this.plans.findVersion(organizationId, projectId, planVersion);
      // Le modèle ne sert qu'aux libellés (comme l'export du plan figé, S16c) ;
      // les valeurs viennent EXCLUSIVEMENT du snapshot.
      const template = getTemplate(plan.templateSlug);
      if (!template) {
        throw new NotFoundException({
          code: 'TEMPLATE_NOT_FOUND',
          message: `Modèle introuvable pour le plan : ${plan.templateSlug}`,
        });
      }
      // Même règle que l'export du plan figé : projet > pack DU PLAN > modèle > USD.
      const currency = currencyOf(
        { ...project, parameterPackSlug: plan.parameterPackSlug ?? '' },
        template,
      );
      return {
        status: 'frozen',
        version: plan.version,
        fingerprint: plan.fingerprint,
        approvedAt: plan.approvedAt.toISOString(),
        superseded: plan.status === 'superseded',
        engineVersion: plan.engineVersion,
        currency,
        hypotheses: hypothesesFrom(template, plan.driverValues, currency),
        lines: linesOf(plan.result.lines),
        sheetTitles: sheetTitlesOf(template),
        error: null,
      };
    }

    const template = getTemplate(project.templateSlug);
    if (!template) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: `Modèle introuvable pour l’initiative : ${project.templateSlug}`,
      });
    }
    const currency = currencyOf(project, template);
    const pack = project.parameterPackSlug
      ? getParameterPack(project.parameterPackSlug)
      : undefined;
    const base: PlanSource = {
      status: 'live',
      version: null,
      fingerprint: null,
      approvedAt: null,
      superseded: false,
      engineVersion: ENGINE_VERSION,
      currency,
      hypotheses: [],
      lines: [],
      sheetTitles: sheetTitlesOf(template),
      error: null,
    };
    try {
      const evaluation = evaluateTemplate(template, project.driverValues, { parameterPack: pack });
      return {
        ...base,
        hypotheses: hypothesesFrom(template, Object.fromEntries(evaluation.drivers), currency),
        lines: linesOf(evaluation.lines),
      };
    } catch (err) {
      if (err instanceof EngineError) return { ...base, error: err.message };
      throw err;
    }
  }

  async setPlan(
    organizationId: string,
    projectId: string,
    planVersion: number | null,
    userId: string,
  ): Promise<void> {
    if (planVersion !== null) {
      // 404 PLAN_NOT_FOUND si la version n'existe pas pour CE projet de CETTE organisation.
      await this.plans.findVersion(organizationId, projectId, planVersion);
    }
    await this.document(organizationId, projectId);
    await this.docs
      .updateOne({ organizationId, projectId }, { $set: { planVersion, updatedBy: userId } })
      .exec();
  }

  private async patchSection(
    organizationId: string,
    projectId: string,
    sectionId: BusinessPlanSectionId,
    patch: Partial<SectionState>,
    userId: string | null,
  ): Promise<void> {
    const doc = await this.document(organizationId, projectId);
    const current: SectionState = { ...emptySection(), ...(doc.sections[sectionId] ?? {}) };
    const next: SectionState = { ...current, ...patch };
    const set: Record<string, unknown> = { [`sections.${sectionId}`]: next };
    if (userId !== null) set['updatedBy'] = userId;
    await this.docs.updateOne({ organizationId, projectId }, { $set: set }).exec();
  }

  /** Texte saisi : l'origine devient `user`, même s'il partait d'un brouillon accepté. */
  async writeText(
    organizationId: string,
    projectId: string,
    sectionId: BusinessPlanSectionId,
    text: string,
    userId: string,
  ): Promise<void> {
    const now = new Date();
    await this.patchSection(
      organizationId,
      projectId,
      sectionId,
      {
        text,
        origin: text.trim() === '' ? null : 'user',
        updatedBy: userId,
        updatedAt: now,
        acceptedBy: null,
        acceptedAt: null,
      },
      userId,
    );
  }

  /** Proposition de l'IA : rangée À CÔTÉ du texte, jamais à sa place. */
  async storeProposal(
    organizationId: string,
    projectId: string,
    sectionId: BusinessPlanSectionId,
    proposal: SectionProposal,
  ): Promise<void> {
    // Pas d'`updatedBy` : une proposition ne modifie pas le contenu publiable.
    await this.patchSection(organizationId, projectId, sectionId, { proposal }, null);
  }

  async acceptProposal(
    organizationId: string,
    projectId: string,
    sectionId: BusinessPlanSectionId,
    userId: string,
  ): Promise<void> {
    const doc = await this.document(organizationId, projectId);
    const proposal = doc.sections[sectionId]?.proposal;
    if (!proposal) {
      throw new ConflictException({
        code: 'BUSINESS_PLAN_NO_PROPOSAL',
        message: 'Aucune proposition de l’IA en attente pour cette section.',
      });
    }
    const now = new Date();
    await this.patchSection(
      organizationId,
      projectId,
      sectionId,
      {
        text: proposal.text,
        origin: 'ai_accepted',
        updatedBy: userId,
        updatedAt: now,
        acceptedBy: userId,
        acceptedAt: now,
        proposal: null,
      },
      userId,
    );
  }

  async discardProposal(
    organizationId: string,
    projectId: string,
    sectionId: BusinessPlanSectionId,
  ): Promise<void> {
    const doc = await this.document(organizationId, projectId);
    if (!doc.sections[sectionId]?.proposal) {
      throw new ConflictException({
        code: 'BUSINESS_PLAN_NO_PROPOSAL',
        message: 'Aucune proposition de l’IA en attente pour cette section.',
      });
    }
    await this.patchSection(organizationId, projectId, sectionId, { proposal: null }, null);
  }

  listVersions(organizationId: string, projectId: string): Promise<BusinessPlanVersionDocument[]> {
    return this.versions.find({ organizationId, projectId }).sort({ version: -1 }).exec();
  }

  async findVersion(
    organizationId: string,
    projectId: string,
    version: number,
  ): Promise<BusinessPlanVersionDocument> {
    if (!Number.isInteger(version) || version < 1) {
      throw new NotFoundException({ code: 'BUSINESS_PLAN_VERSION_NOT_FOUND' });
    }
    const doc = await this.versions.findOne({ organizationId, projectId, version }).exec();
    if (!doc) throw new NotFoundException({ code: 'BUSINESS_PLAN_VERSION_NOT_FOUND' });
    return doc;
  }

  /** Raisons qui empêchent la validation — vide si elle est possible. */
  static blockers(
    doc: Pick<BusinessPlan, 'planVersion' | 'sections'>,
  ): { code: string; message: string }[] {
    const out: { code: string; message: string }[] = [];
    if (doc.planVersion === null) {
      out.push({
        code: 'BUSINESS_PLAN_NO_FROZEN_PLAN',
        message: 'Rattachez une version validée du plan financier avant de valider le document.',
      });
    }
    const pending = pendingProposals(doc.sections);
    if (pending.length > 0) {
      out.push({
        code: 'BUSINESS_PLAN_PENDING_AI',
        message: `Acceptez ou écartez les propositions de l’IA en attente (${pending.length}).`,
      });
    }
    const filled = BUSINESS_PLAN_SECTION_IDS.some(
      (id) => (doc.sections[id]?.text ?? '').trim() !== '',
    );
    if (!filled) {
      out.push({ code: 'BUSINESS_PLAN_EMPTY', message: 'Toutes les sections sont vides.' });
    }
    return out;
  }

  /** Fige une version immuable. La séparation des tâches est décidée par l'appelant. */
  async freeze(input: {
    organizationId: string;
    projectId: string;
    approvedBy: string;
    soleApprover: boolean;
  }): Promise<BusinessPlanVersionDocument> {
    const doc = await this.document(input.organizationId, input.projectId);
    const blockers = BusinessPlanService.blockers(doc);
    if (blockers.length > 0) {
      const first = blockers[0]!;
      throw new ConflictException({ code: first.code, message: first.message, blockers });
    }
    const plan = await this.plans.findVersion(
      input.organizationId,
      input.projectId,
      doc.planVersion as number,
    );
    const sections: Partial<Record<BusinessPlanSectionId, FrozenSection>> = {};
    for (const id of BUSINESS_PLAN_SECTION_IDS) {
      const s = doc.sections[id];
      const text = (s?.text ?? '').trim();
      sections[id] = { text, origin: text === '' ? null : (s?.origin ?? 'user') };
    }
    const sha = contentSha256(sections, { version: plan.version, fingerprint: plan.fingerprint });
    const last = await this.versions
      .findOne({ organizationId: input.organizationId, projectId: input.projectId })
      .sort({ version: -1 })
      .exec();
    if (last && last.contentSha256 === sha) {
      throw new ConflictException({
        code: 'BUSINESS_PLAN_UNCHANGED',
        message: `Le document n’a pas changé depuis la version ${last.version}.`,
      });
    }
    try {
      return await this.versions.create({
        organizationId: input.organizationId,
        projectId: input.projectId,
        version: (last?.version ?? 0) + 1,
        sections,
        plan: { version: plan.version, fingerprint: plan.fingerprint, approvedAt: plan.approvedAt },
        contentSha256: sha,
        approvedAt: new Date(),
        approvedBy: input.approvedBy,
        approval: { soleApprover: input.soleApprover, lastEditor: doc.updatedBy ?? null },
        _schemaVersion: 1,
      });
    } catch (err) {
      // Index unique {projectId, version} : une validation concurrente a gagné.
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException({
          code: 'BUSINESS_PLAN_CONCURRENT_VALIDATION',
          message: 'Une autre validation vient d’aboutir : rechargez la page.',
        });
      }
      throw err;
    }
  }

  async aiDisabledBy(organizationId: string): Promise<'platform' | 'organization' | null> {
    if (platformAiDisabled()) return 'platform';
    const s = await this.settings.findOne({ organizationId }, { aiEnabled: 1 }).lean().exec();
    return s && s.aiEnabled === false ? 'organization' : null;
  }

  async setAiEnabled(organizationId: string, aiEnabled: boolean, userId: string): Promise<void> {
    await this.settings
      .updateOne(
        { organizationId },
        {
          $set: { aiEnabled, updatedBy: userId },
          $setOnInsert: { organizationId, _schemaVersion: 1 },
        },
        { upsert: true },
      )
      .exec();
  }

  /** Lecture plane des sections (objet Mongo → valeurs). */
  static sectionsOf(doc: { sections: BusinessPlanSections }): BusinessPlanSections {
    return doc.sections ?? {};
  }
}

/** Parse un numéro de version positif ; 400 sinon. */
export function parseVersion(raw: string | undefined, code: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new BadRequestException({ code, message: `version invalide : « ${raw.slice(0, 20)} »` });
  }
  return n;
}
