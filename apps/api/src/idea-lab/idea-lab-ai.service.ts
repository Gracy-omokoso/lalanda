// Assistance IA de l'Idea Lab — orchestration (ADR-0036 § 4).
//
// Ordre des opérations, et pourquoi (même schéma que le brief du matin, ADR-0033) :
//
//   1. IA désactivée (plateforme ou organisation) → texte déterministe, aucun
//      appel, aucun quota.
//   2. Client absent → texte déterministe, rien à décompter (état de configuration).
//   3. Sinon `AiQuotaService.runGuarded` : refus 403 AVANT l'appel si le quota du
//      mois est épuisé ; décompte APRÈS, d'une réponse ACCEPTÉE seulement. Une
//      réponse rejetée par le vérificateur (nombre absent de la saisie, forme,
//      longueur) retombe sur le déterministe et n'est pas décomptée.
//
// Chaque tentative laisse une ligne dans `idea_lab_ai_logs` (empreinte de
// l'entrée, réponse bornée, issue), expirée par index TTL. Le prompt n'y est pas
// conservé : il contient le texte saisi par l'utilisateur.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { FALLBACK_LOG_PREFIX, type OpenAIChatClient } from '../ai/ai-actions.service.js';
import { AiQuotaService } from '../ai/ai-quota.service.js';
import {
  chiffresAutorises,
  IDEA_LAB_MODEL,
  IDEA_LAB_PROMPT_VERSION,
  inputFingerprint,
  MENTION_IDEA_LAB,
  motifDeRejet,
  parseReponse,
  payloadFor,
  promptSysteme,
  promptUtilisateur,
  reponseDeterministe,
  type IdeaAiInput,
  type IdeaAssistAnswer,
  type IdeaAssistIntent,
} from './idea-lab-ai.js';
import {
  IdeaLabAiLog,
  IdeaLabSettings,
  type IdeaAiOutcome,
  type IdeaLabAiLogDocument,
  type IdeaLabSettingsDocument,
} from './idea-lab.schemas.js';

/** Jeton du client OpenAI partagé, fourni par `IdeaLabModule`. */
export const IDEA_LAB_CHAT_CLIENT = Symbol('IDEA_LAB_CHAT_CLIENT');

/** Étiquette du quota et du journal de consommation (ADR-0036 § 4). */
export const ACTION_IDEA_LAB = 'ai.idea_lab';

export const MAX_LOGGED_RESPONSE = 4000;
export const DEFAULT_LOG_RETENTION_DAYS = 90;

/** Rétention du journal en jours, bornée à [1, 365] ; une valeur invalide prend le défaut. */
export function logRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['IDEA_LAB_AI_LOG_RETENTION_DAYS'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_LOG_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_LOG_RETENTION_DAYS;
}

/** Coupe-circuit plateforme (ADR-0036 § 4). */
export function platformAiDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['IDEA_LAB_AI'] ?? '').trim().toLowerCase() === 'off';
}

export type IdeaAssistReason =
  'desactivee_plateforme' | 'desactivee_organisation' | 'indisponible' | 'rejetee' | null;

export interface IdeaAssistView {
  intent: IdeaAssistIntent;
  answer: IdeaAssistAnswer;
  /** `llm` : rédigé par l'IA et vérifié ; `fallback` : écrit sans modèle. */
  source: 'llm' | 'fallback';
  reason: IdeaAssistReason;
  mention: string;
}

export interface IdeaAssistContext {
  organizationId: string;
  userId: string;
  ideaId: string;
  disabledBy: 'organization' | 'platform' | null;
}

@Injectable()
export class IdeaLabAiService {
  private readonly logger = new Logger(IdeaLabAiService.name);

  constructor(
    @InjectModel(IdeaLabAiLog.name) private readonly logs: Model<IdeaLabAiLogDocument>,
    @InjectModel(IdeaLabSettings.name) private readonly settings: Model<IdeaLabSettingsDocument>,
    @Inject(AiQuotaService) private readonly quota: AiQuotaService,
    @Optional()
    @Inject(IDEA_LAB_CHAT_CLIENT)
    private readonly openai: OpenAIChatClient | null = null,
  ) {}

  /** Qui a désactivé l'IA de l'Idea Lab, ou `null` si elle est permise. */
  async aiDisabledBy(organizationId: string): Promise<'organization' | 'platform' | null> {
    if (platformAiDisabled()) return 'platform';
    const s = await this.settings.findOne({ organizationId }, { aiEnabled: 1 }).lean().exec();
    return s && s.aiEnabled === false ? 'organization' : null;
  }

  async setAiEnabled(organizationId: string, aiEnabled: boolean, userId: string): Promise<void> {
    await this.settings
      .findOneAndUpdate(
        { organizationId },
        {
          $set: { aiEnabled, updatedBy: userId },
          $setOnInsert: { organizationId, _schemaVersion: 1 },
        },
        { upsert: true },
      )
      .exec();
  }

  async assist(
    ctx: IdeaAssistContext,
    input: IdeaAiInput,
    intent: IdeaAssistIntent,
    now: Date = new Date(),
  ): Promise<IdeaAssistView> {
    const payload = payloadFor(input);
    const sha = inputFingerprint(intent, payload);
    const base = { ctx, intent, sha, now };
    const view = (
      answer: IdeaAssistAnswer,
      source: 'llm' | 'fallback',
      reason: IdeaAssistReason,
    ): IdeaAssistView => ({ intent, answer, source, reason, mention: MENTION_IDEA_LAB });
    const deterministe = (): IdeaAssistAnswer => reponseDeterministe(intent, payload);

    if (ctx.disabledBy !== null) {
      await this.log(base, { outcome: 'disabled', reason: ctx.disabledBy });
      return view(
        deterministe(),
        'fallback',
        ctx.disabledBy === 'platform' ? 'desactivee_plateforme' : 'desactivee_organisation',
      );
    }

    const client = this.openai;
    if (!client) {
      await this.log(base, { outcome: 'error', reason: 'ClientAbsent' });
      return view(deterministe(), 'fallback', 'indisponible');
    }

    return this.quota.runGuarded(
      { organizationId: ctx.organizationId, userId: ctx.userId, action: ACTION_IDEA_LAB },
      async () => {
        const started = Date.now();
        let raw: string;
        try {
          raw = await client.chatJson({
            system: promptSysteme(intent),
            user: promptUtilisateur(intent, payload),
            model: IDEA_LAB_MODEL,
          });
        } catch (err) {
          const name = err instanceof Error ? err.name : 'Inconnue';
          this.logger.warn(`${FALLBACK_LOG_PREFIX} raison=${name} operation=idea_lab`);
          await this.log(base, {
            outcome: 'error',
            reason: name,
            durationMs: Date.now() - started,
          });
          return { value: view(deterministe(), 'fallback', 'indisponible'), source: 'fallback' };
        }
        const durationMs = Date.now() - started;

        let answer: IdeaAssistAnswer | null = null;
        let rejet: string | null;
        try {
          answer = parseReponse(intent, raw);
          rejet = motifDeRejet(answer, payload, chiffresAutorises(payload));
        } catch (err) {
          rejet = `réponse illisible : ${err instanceof Error ? err.message : String(err)}`;
        }
        if (rejet !== null || answer === null) {
          this.logger.warn(
            `${FALLBACK_LOG_PREFIX} raison=IdeaLabRefuse operation=idea_lab — ${rejet ?? ''}`,
          );
          await this.log(base, { outcome: 'rejected', reason: rejet, raw, durationMs });
          return { value: view(deterministe(), 'fallback', 'rejetee'), source: 'fallback' };
        }
        await this.log(base, { outcome: 'accepted', raw, durationMs });
        return { value: view(answer, 'llm', null), source: 'llm' };
      },
    );
  }

  private async log(
    base: { ctx: IdeaAssistContext; intent: IdeaAssistIntent; sha: string; now: Date },
    entry: { outcome: IdeaAiOutcome; reason?: string | null; raw?: string; durationMs?: number },
  ): Promise<void> {
    try {
      await this.logs.create({
        organizationId: base.ctx.organizationId,
        userId: base.ctx.userId,
        ideaId: base.ctx.ideaId,
        intent: base.intent,
        model: IDEA_LAB_MODEL,
        promptVersion: IDEA_LAB_PROMPT_VERSION,
        inputSha256: base.sha,
        response: entry.raw === undefined ? null : entry.raw.slice(0, MAX_LOGGED_RESPONSE),
        outcome: entry.outcome,
        reason: entry.reason ?? null,
        durationMs: entry.durationMs ?? null,
        expiresAt: new Date(base.now.getTime() + logRetentionDays() * 86_400_000),
        _schemaVersion: 1,
      });
    } catch (err) {
      this.logger.warn(
        `journal de l’Idea Lab impossible : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
