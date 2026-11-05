// Construction d'un plan de projet par l'IA — orchestration (ADR-0063).
//
// Ordre des opérations (même schéma que l'Idea Lab, ADR-0036 § 4) :
//
//   1. IA coupée par la plateforme (`WORK_AI_PLAN=off`) → 503, aucun appel ;
//   2. membres choisis : de l'organisation active, détenant `work.update` ;
//   3. aucun client (SDK absent) → 503 « IA indisponible » ; client simulé en
//      développement si `WORK_AI_PLAN_SIMULATED=on` (jamais en production) ;
//   4. `AiQuotaService.runGuarded` : 403 AVANT l'appel si le quota du mois est
//      épuisé ; l'appel ; la réponse est vérifiée et corrigée (`sanitizePlan`) ;
//      seule une proposition ACCEPTÉE est décomptée (une régénération l'est
//      aussi). Panne ou délai → 503 ; réponse invalide → 422 ; rien n'est
//      décompté dans ces deux cas.
//
// Chaque tentative laisse une ligne dans `work_ai_plan_logs` (TTL 90 jours).
// Rien n'est créé ici : la création passe par `WorkPlanBuilder` après relecture.

import {
  sprintCalendar,
  type WorkAiPlanDraft,
  type WorkAiPlanRequestBody,
  type WorkPlanApplyResult,
  type WorkPlanOrigin,
  type WorkPlanProject,
  type WorkPlanTask,
} from '@lalanda/shared/work';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { FALLBACK_LOG_PREFIX, type OpenAIChatClient } from '../ai/ai-actions.service.js';
import { AiQuotaService } from '../ai/ai-quota.service.js';
import { type WorkActor } from './work.common.js';
import {
  ACTION_WORK_AI_PLAN,
  AiPlanRejected,
  MENTION_WORK_AI_PLAN,
  WORK_AI_PLAN_MAX_TOKENS,
  WORK_AI_PLAN_MODEL,
  WORK_AI_PLAN_PROMPT_VERSION,
  WORK_AI_PLAN_TIMEOUT_MS,
  firstNameOf,
  inputFingerprint,
  payloadFor,
  projectDescriptionOf,
  promptSysteme,
  promptUtilisateur,
  sanitizePlan,
  type AiPlanInput,
} from './work-ai-plan.js';
import {
  WorkAiPlanLog,
  type WorkAiPlanLogDocument,
  type WorkAiPlanOutcome,
} from './work-ai-plan.schema.js';
import { SimulatedWorkPlanClient, simulatedPlanEnabled } from './work-ai-plan.simulated.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkPlanBuilder } from './work-plan-builder.js';

/** Jeton du client OpenAI partagé, fourni par `WorkModule`. */
export const WORK_AI_CHAT_CLIENT = Symbol('WORK_AI_CHAT_CLIENT');

export const WORK_AI_LOG_RETENTION_DAYS = 90;
const MAX_LOGGED_RESPONSE = 8_000;

export function platformWorkAiDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['WORK_AI_PLAN'] ?? '').trim().toLowerCase() === 'off';
}

function unavailable(): never {
  throw new ServiceUnavailableException({
    code: 'WORK_AI_UNAVAILABLE',
    message:
      'L’IA est indisponible pour le moment. Réessayez dans quelques minutes, ou créez le projet à la main ou depuis un fichier.',
  });
}

@Injectable()
export class WorkAiPlanService {
  private readonly logger = new Logger('WorkAiPlan');

  /** Client du modèle ; remplaçable en test (jamais d'appel réel dans les tests). */
  client: OpenAIChatClient | null;

  constructor(
    @InjectModel(WorkAiPlanLog.name) private readonly logs: Model<WorkAiPlanLogDocument>,
    @Inject(AiQuotaService) private readonly quota: AiQuotaService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkPlanBuilder) private readonly builder: WorkPlanBuilder,
    @Optional() @Inject(WORK_AI_CHAT_CLIENT) client: OpenAIChatClient | null = null,
  ) {
    this.client = simulatedPlanEnabled() ? new SimulatedWorkPlanClient() : client;
  }

  async generate(
    organizationId: string,
    request: WorkAiPlanRequestBody,
    actor: WorkActor,
    now: Date = new Date(),
  ): Promise<WorkAiPlanDraft> {
    const memberIds = request.memberUserIds ?? [];
    await this.members.requireEligible(
      organizationId,
      memberIds,
      'work.update',
      'WORK_ASSIGNEE_NOT_ELIGIBLE',
      'memberUserIds',
    );
    const refs = await this.members.refs(memberIds);
    const input: AiPlanInput = {
      request,
      members: memberIds.map((userId, i) => ({
        ref: `m${i + 1}`,
        userId,
        firstName: firstNameOf(refs.get(userId)?.name ?? ''),
      })),
      sprints: sprintCalendar(request.startDate, request.dueDate, request.sprintWeeks),
    };
    const payload = payloadFor(input);
    const base = { organizationId, userId: actor.userId, sha: inputFingerprint(payload), now };

    if (platformWorkAiDisabled()) {
      await this.log(base, { outcome: 'disabled', reason: 'platform' });
      throw new ServiceUnavailableException({
        code: 'WORK_AI_DISABLED',
        message: 'La construction de plan par l’IA est désactivée sur cette plateforme.',
      });
    }
    const client = this.client;
    if (!client) {
      await this.log(base, { outcome: 'error', reason: 'ClientAbsent' });
      unavailable();
    }

    return this.quota.runGuarded(
      { organizationId, userId: actor.userId, action: ACTION_WORK_AI_PLAN },
      async () => {
        const started = Date.now();
        let raw: string;
        try {
          raw = await client.chatJson({
            system: promptSysteme(),
            user: promptUtilisateur(payload),
            model: WORK_AI_PLAN_MODEL,
            maxOutputTokens: WORK_AI_PLAN_MAX_TOKENS,
            timeoutMs: WORK_AI_PLAN_TIMEOUT_MS,
          });
        } catch (err) {
          const name = err instanceof Error ? err.name : 'Inconnue';
          this.logger.warn(`${FALLBACK_LOG_PREFIX} raison=${name} operation=work_plan`);
          await this.log(base, {
            outcome: 'error',
            reason: name,
            durationMs: Date.now() - started,
          });
          unavailable();
        }
        const durationMs = Date.now() - started;
        let plan;
        try {
          plan = sanitizePlan(raw, input);
        } catch (err) {
          const reason = err instanceof AiPlanRejected ? err.reason : String(err);
          this.logger.warn(
            `${FALLBACK_LOG_PREFIX} raison=PlanRefuse operation=work_plan — ${reason}`,
          );
          await this.log(base, { outcome: 'rejected', reason, raw, durationMs });
          throw new UnprocessableEntityException({
            code: 'WORK_AI_INVALID_RESPONSE',
            message:
              'La proposition de l’IA était inutilisable (réponse incomplète ou incohérente). Elle n’est pas décomptée : réessayez.',
          });
        }
        const draftId = await this.log(base, {
          outcome: 'accepted',
          raw,
          durationMs,
          corrections: plan.corrections.length,
        });
        const draft: WorkAiPlanDraft = {
          draftId: draftId ?? '',
          summary: plan.summary,
          description: projectDescriptionOf(request, plan.summary, plan.sprints),
          sprints: plan.sprints,
          tasks: plan.tasks,
          corrections: plan.corrections,
          mention: MENTION_WORK_AI_PLAN,
        };
        return { value: draft, source: 'llm' as const };
      },
    );
  }

  /** Créer le projet relu — le créateur commun (`WorkPlanBuilder`), comme l'import. */
  async createFromPlan(
    organizationId: string,
    project: WorkPlanProject,
    tasks: WorkPlanTask[],
    actor: WorkActor,
    origin: WorkPlanOrigin,
    aiDraftId: string | undefined,
  ): Promise<WorkPlanApplyResult> {
    const result = await this.builder.createProject(organizationId, project, tasks, actor, origin);
    if (aiDraftId) {
      try {
        await this.logs
          .updateOne(
            { _id: aiDraftId, organizationId, userId: actor.userId, outcome: 'accepted' },
            { $set: { projectId: result.projectId } },
          )
          .exec();
      } catch (err) {
        this.logger.warn(
          `journal du plan IA non relié : ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return result;
  }

  private async log(
    base: { organizationId: string; userId: string; sha: string; now: Date },
    entry: {
      outcome: WorkAiPlanOutcome;
      reason?: string | null;
      raw?: string;
      durationMs?: number;
      corrections?: number;
    },
  ): Promise<string | null> {
    try {
      const doc = await this.logs.create({
        organizationId: base.organizationId,
        userId: base.userId,
        model: WORK_AI_PLAN_MODEL,
        promptVersion: WORK_AI_PLAN_PROMPT_VERSION,
        inputSha256: base.sha,
        response: entry.raw === undefined ? null : entry.raw.slice(0, MAX_LOGGED_RESPONSE),
        outcome: entry.outcome,
        reason: entry.reason ?? null,
        durationMs: entry.durationMs ?? null,
        corrections: entry.corrections ?? 0,
        projectId: null,
        expiresAt: new Date(base.now.getTime() + WORK_AI_LOG_RETENTION_DAYS * 86_400_000),
        _schemaVersion: 1,
      });
      return String(doc._id);
    } catch (err) {
      this.logger.warn(
        `journal du plan IA impossible : ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
