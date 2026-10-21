// Explication du brief du matin — orchestration (ADR-0033 § 4 à § 7).
//
// Ordre des opérations, et pourquoi :
//
//   1. IA désactivée (plateforme ou organisation) → texte déterministe, aucun
//      appel, aucun quota. Le brief reste complet sans l'IA.
//   2. Cache : même organisation, même intention, même jour, même empreinte des
//      faits → la réponse acceptée est servie de nouveau, sans appel ni quota.
//   3. Sinon `AiQuotaService.runGuarded` : refus 403 AVANT l'appel si le quota
//      du mois est épuisé ; décompte APRÈS, d'une réponse ACCEPTÉE seulement.
//      Une réponse rejetée par le vérificateur retombe sur le déterministe et
//      n'est pas décomptée — nos rejets ne sont pas facturés au client.
//
// Chaque tentative laisse une ligne dans `morning_brief_ai_logs` (prompt
// d'agrégats, réponse bornée, issue), expirée par index TTL. Le journal ne fait
// jamais échouer la réponse : perdre une trace est sans commune mesure avec
// refuser une explication déjà produite.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { MorningBrief } from '@lalanda/engine';

import { FALLBACK_LOG_PREFIX, type OpenAIChatClient } from '../ai/ai-actions.service.js';
import { AiQuotaService } from '../ai/ai-quota.service.js';
import {
  MENTION_BRIEF,
  MORNING_BRIEF_MODEL,
  MORNING_BRIEF_PROMPT_VERSION,
  chiffresAutorises,
  factsFingerprint,
  motifDeRejet,
  parseReponse,
  payloadFor,
  promptSysteme,
  promptUtilisateur,
  reponseDeterministe,
  sourcesConnues,
  type BriefAnswer,
  type BriefIntent,
} from './morning-brief-ai.js';
import { kinshasaClock } from './morning-brief.service.js';
import {
  MorningBriefAiLog,
  type BriefAiOutcome,
  type MorningBriefAiLogDocument,
} from './morning-brief.schemas.js';

/** Jeton du client OpenAI partagé, fourni par `MorningBriefModule`. */
export const MORNING_BRIEF_CHAT_CLIENT = Symbol('MORNING_BRIEF_CHAT_CLIENT');

/** Étiquette du quota et du journal de consommation (ADR-0033 § 5). */
export const ACTION_MORNING_BRIEF = 'ai.morning_brief';

/** Longueur maximale de la réponse brute conservée au journal. */
export const MAX_LOGGED_RESPONSE = 4000;

export const DEFAULT_LOG_RETENTION_DAYS = 90;

/** Rétention du journal en jours, bornée à [1, 365] ; une valeur invalide prend le défaut. */
export function logRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['MORNING_BRIEF_AI_LOG_RETENTION_DAYS'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_LOG_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_LOG_RETENTION_DAYS;
}

export type BriefAnswerReason =
  'desactivee_plateforme' | 'desactivee_organisation' | 'indisponible' | 'rejetee' | null;

export interface BriefAnswerView {
  intent: BriefIntent;
  items: { texte: string; sources: { id: string; label: string }[] }[];
  /** `llm` : rédigé par l'IA et vérifié ; `fallback` : écrit sans modèle. */
  source: 'llm' | 'fallback';
  cached: boolean;
  reason: BriefAnswerReason;
  mention: string;
  factsSha256: string;
}

export interface BriefAnswerContext {
  organizationId: string;
  userId: string;
  /** `null` si l'IA est permise ; sinon qui l'a désactivée. */
  disabledBy: 'organization' | 'platform' | null;
}

@Injectable()
export class MorningBriefAiService {
  private readonly logger = new Logger(MorningBriefAiService.name);

  constructor(
    @InjectModel(MorningBriefAiLog.name) private readonly logs: Model<MorningBriefAiLogDocument>,
    @Inject(AiQuotaService) private readonly quota: AiQuotaService,
    @Optional()
    @Inject(MORNING_BRIEF_CHAT_CLIENT)
    private readonly openai: OpenAIChatClient | null = null,
  ) {}

  async answer(
    ctx: BriefAnswerContext,
    brief: MorningBrief,
    intent: BriefIntent,
    now: Date = new Date(),
  ): Promise<BriefAnswerView> {
    const payload = payloadFor(brief);
    const sha = factsFingerprint(payload);
    const { day } = kinshasaClock(now);
    const base = { ctx, intent, sha, day, now };

    const view = (
      answer: BriefAnswer,
      source: 'llm' | 'fallback',
      reason: BriefAnswerReason,
      cached = false,
    ): BriefAnswerView => ({
      intent,
      items: answer.items.map((i) => ({
        texte: i.texte.trim(),
        sources: i.sources.map((id) => ({ id, label: labelOf(brief, id) })),
      })),
      source,
      cached,
      reason,
      mention: MENTION_BRIEF,
      factsSha256: sha,
    });
    const deterministe = (): BriefAnswer => reponseDeterministe(intent, brief);

    // 1. Désactivée.
    if (ctx.disabledBy !== null) {
      await this.log(base, { outcome: 'disabled', reason: ctx.disabledBy });
      return view(
        deterministe(),
        'fallback',
        ctx.disabledBy === 'platform' ? 'desactivee_plateforme' : 'desactivee_organisation',
      );
    }

    // 2. Cache.
    const cached = await this.logs
      .findOne(
        { organizationId: ctx.organizationId, intent, day, factsSha256: sha, outcome: 'accepted' },
        { answer: 1 },
      )
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (cached?.answer) return view(cached.answer, 'llm', null, true);

    // 3. Client absent : état de configuration, rien à décompter.
    const client = this.openai;
    if (!client) {
      await this.log(base, { outcome: 'error', reason: 'ClientAbsent' });
      return view(deterministe(), 'fallback', 'indisponible');
    }

    return this.quota.runGuarded(
      { organizationId: ctx.organizationId, userId: ctx.userId, action: ACTION_MORNING_BRIEF },
      async () => {
        const prompt = { system: promptSysteme(intent), user: promptUtilisateur(intent, payload) };
        const started = Date.now();
        let raw: string;
        try {
          raw = await client.chatJson({ ...prompt, model: MORNING_BRIEF_MODEL });
        } catch (err) {
          const name = err instanceof Error ? err.name : 'Inconnue';
          this.logger.warn(`${FALLBACK_LOG_PREFIX} raison=${name} operation=morning_brief`);
          await this.log(base, {
            outcome: 'error',
            reason: name,
            prompt,
            durationMs: Date.now() - started,
          });
          return { value: view(deterministe(), 'fallback', 'indisponible'), source: 'fallback' };
        }
        const durationMs = Date.now() - started;

        let answer: BriefAnswer | null = null;
        let rejet: string | null;
        try {
          answer = parseReponse(intent, raw, sourcesConnues(payload));
          rejet = motifDeRejet(intent, answer, chiffresAutorises(payload, brief));
        } catch (err) {
          rejet = `réponse illisible : ${err instanceof Error ? err.message : String(err)}`;
        }

        if (rejet !== null || answer === null) {
          this.logger.warn(
            `${FALLBACK_LOG_PREFIX} raison=BriefRefuse operation=morning_brief — ${rejet ?? ''}`,
          );
          await this.log(base, { outcome: 'rejected', reason: rejet, prompt, raw, durationMs });
          return { value: view(deterministe(), 'fallback', 'rejetee'), source: 'fallback' };
        }

        await this.log(base, { outcome: 'accepted', prompt, raw, durationMs, answer });
        return { value: view(answer, 'llm', null), source: 'llm' };
      },
    );
  }

  private async log(
    base: { ctx: BriefAnswerContext; intent: BriefIntent; sha: string; day: string; now: Date },
    entry: {
      outcome: BriefAiOutcome;
      reason?: string | null;
      prompt?: { system: string; user: string };
      raw?: string;
      durationMs?: number;
      answer?: BriefAnswer;
    },
  ): Promise<void> {
    try {
      await this.logs.create({
        organizationId: base.ctx.organizationId,
        userId: base.ctx.userId,
        intent: base.intent,
        model: MORNING_BRIEF_MODEL,
        promptVersion: MORNING_BRIEF_PROMPT_VERSION,
        factsSha256: base.sha,
        day: base.day,
        prompt: entry.prompt ?? null,
        response: entry.raw === undefined ? null : entry.raw.slice(0, MAX_LOGGED_RESPONSE),
        answer: entry.answer ?? null,
        outcome: entry.outcome,
        reason: entry.reason ?? null,
        durationMs: entry.durationMs ?? null,
        expiresAt: new Date(base.now.getTime() + logRetentionDays() * 86_400_000),
        _schemaVersion: 1,
      });
    } catch (err) {
      this.logger.warn(
        `journal du brief impossible : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function labelOf(brief: MorningBrief, id: string): string {
  const f = brief.facts.find((x) => x.id === id);
  if (f) return f.label;
  const r = [...brief.alerts, ...brief.recommendations].find((x) => x.ruleId === id);
  return r ? `Règle : ${r.title}` : id;
}
