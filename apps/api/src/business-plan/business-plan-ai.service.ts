// Brouillon IA d'une section — orchestration (ADR-0037 § 4, § 5).
//
//   1. IA désactivée (plateforme ou organisation) → aucune proposition, aucun
//      appel, aucun quota. La rédaction manuelle reste entière.
//   2. Client absent → idem (`indisponible`).
//   3. Sinon `AiQuotaService.runGuarded` : 403 AVANT l'appel si le quota est
//      épuisé ; décompte APRÈS, d'une proposition ACCEPTÉE par le vérificateur
//      seulement. Un rejet n'enregistre rien et ne coûte rien au client.
//
// Le journal ne garde ni le prompt ni la réponse (texte libre de l'entrepreneur) :
// empreintes, longueur, issue, motif. Il ne fait jamais échouer la réponse.

import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { FALLBACK_LOG_PREFIX, type OpenAIChatClient } from '../ai/ai-actions.service.js';
import { AiQuotaService } from '../ai/ai-quota.service.js';
import {
  BUSINESS_PLAN_MODEL,
  BUSINESS_PLAN_PROMPT_VERSION,
  MENTION_BUSINESS_PLAN,
  chiffresAutorises,
  inputSha256,
  motifDeRejet,
  motifJournalisable,
  parseReponse,
  payloadFor,
  promptSysteme,
  promptUtilisateur,
  sourcesConnues,
  type BusinessPlanAiInput,
  type BusinessPlanDraft,
} from './business-plan-ai.js';
import {
  BusinessPlanAiLog,
  type BusinessPlanAiLogDocument,
  type BusinessPlanAiOutcome,
  type SectionProposal,
} from './business-plan.schemas.js';

export const BUSINESS_PLAN_CHAT_CLIENT = Symbol('BUSINESS_PLAN_CHAT_CLIENT');

/** Étiquette du quota et du journal de consommation. */
export const ACTION_BUSINESS_PLAN = 'ai.business_plan';

export const DEFAULT_LOG_RETENTION_DAYS = 90;

export function logRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['BUSINESS_PLAN_AI_LOG_RETENTION_DAYS'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_LOG_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_LOG_RETENTION_DAYS;
}

export type DraftReason =
  'desactivee_plateforme' | 'desactivee_organisation' | 'indisponible' | 'rejetee' | null;

export interface DraftResult {
  /** Proposition à enregistrer, ou `null` (désactivée, indisponible, rejetée). */
  proposal: SectionProposal | null;
  source: 'llm' | 'fallback';
  reason: DraftReason;
  /** Motif lisible d'un rejet (jamais le texte rejeté). */
  detail: string | null;
  mention: string;
}

export interface DraftContext {
  organizationId: string;
  userId: string;
  projectId: string;
  disabledBy: 'organization' | 'platform' | null;
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

@Injectable()
export class BusinessPlanAiService {
  private readonly logger = new Logger(BusinessPlanAiService.name);

  constructor(
    @InjectModel(BusinessPlanAiLog.name) private readonly logs: Model<BusinessPlanAiLogDocument>,
    @Inject(AiQuotaService) private readonly quota: AiQuotaService,
    @Optional()
    @Inject(BUSINESS_PLAN_CHAT_CLIENT)
    private readonly openai: OpenAIChatClient | null = null,
  ) {}

  async draft(ctx: DraftContext, input: BusinessPlanAiInput): Promise<DraftResult> {
    const payload = payloadFor(input);
    const inputSha = inputSha256(payload);
    const base = { ctx, sectionId: input.sectionId, inputSha };
    const vide = (reason: DraftReason, detail: string | null = null): DraftResult => ({
      proposal: null,
      source: 'fallback',
      reason,
      detail,
      mention: MENTION_BUSINESS_PLAN,
    });

    if (ctx.disabledBy !== null) {
      await this.log(base, { outcome: 'disabled', reason: ctx.disabledBy });
      return vide(
        ctx.disabledBy === 'platform' ? 'desactivee_plateforme' : 'desactivee_organisation',
      );
    }
    const client = this.openai;
    if (!client) {
      await this.log(base, { outcome: 'error', reason: 'ClientAbsent' });
      return vide('indisponible');
    }

    return this.quota.runGuarded(
      { organizationId: ctx.organizationId, userId: ctx.userId, action: ACTION_BUSINESS_PLAN },
      async () => {
        const started = Date.now();
        let raw: string;
        try {
          raw = await client.chatJson({
            system: promptSysteme(),
            user: promptUtilisateur(payload),
            model: BUSINESS_PLAN_MODEL,
          });
        } catch (err) {
          const name = err instanceof Error ? err.name : 'Inconnue';
          this.logger.warn(`${FALLBACK_LOG_PREFIX} raison=${name} operation=business_plan`);
          await this.log(base, {
            outcome: 'error',
            reason: name,
            durationMs: Date.now() - started,
          });
          return { value: vide('indisponible'), source: 'fallback' };
        }
        const durationMs = Date.now() - started;
        const reponse = { responseSha256: sha(raw), responseLength: raw.length, durationMs };

        let draft: BusinessPlanDraft | null = null;
        let rejet: string | null;
        try {
          draft = parseReponse(raw, sourcesConnues(payload));
          rejet = motifDeRejet(draft, chiffresAutorises(payload));
        } catch (err) {
          rejet = `réponse illisible : ${err instanceof Error ? err.message : String(err)}`;
        }

        if (rejet !== null || draft === null) {
          const motif = motifJournalisable(rejet ?? 'réponse vide');
          this.logger.warn(
            `${FALLBACK_LOG_PREFIX} raison=BusinessPlanRefuse operation=business_plan — ${motif}`,
          );
          await this.log(base, { outcome: 'rejected', reason: motif, ...reponse });
          return { value: vide('rejetee', motif), source: 'fallback' };
        }

        await this.log(base, { outcome: 'accepted', ...reponse });
        return {
          value: {
            proposal: {
              text: draft.texte.trim(),
              sources: draft.sources,
              generatedAt: new Date(),
              inputSha256: inputSha,
              model: BUSINESS_PLAN_MODEL,
              promptVersion: BUSINESS_PLAN_PROMPT_VERSION,
            },
            source: 'llm',
            reason: null,
            detail: null,
            mention: MENTION_BUSINESS_PLAN,
          },
          source: 'llm',
        };
      },
    );
  }

  private async log(
    base: { ctx: DraftContext; sectionId: string; inputSha: string },
    entry: {
      outcome: BusinessPlanAiOutcome;
      reason?: string | null;
      responseSha256?: string;
      responseLength?: number;
      durationMs?: number;
    },
  ): Promise<void> {
    try {
      await this.logs.create({
        organizationId: base.ctx.organizationId,
        userId: base.ctx.userId,
        projectId: base.ctx.projectId,
        sectionId: base.sectionId,
        model: BUSINESS_PLAN_MODEL,
        promptVersion: BUSINESS_PLAN_PROMPT_VERSION,
        inputSha256: base.inputSha,
        responseSha256: entry.responseSha256 ?? null,
        responseLength: entry.responseLength ?? null,
        outcome: entry.outcome,
        reason: entry.reason ?? null,
        durationMs: entry.durationMs ?? null,
        expiresAt: new Date(Date.now() + logRetentionDays() * 86_400_000),
        _schemaVersion: 1,
      });
    } catch (err) {
      this.logger.warn(
        `journal du business plan impossible : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
