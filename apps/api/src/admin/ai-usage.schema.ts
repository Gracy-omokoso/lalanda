// Consommation d'IA (S21b).
//
// Le tableau de bord plateforme doit afficher les « appels IA consommés »
// (docs/13 : l'IA est un poste de coût facturé par OpenAI, ADR-0008). Rien ne
// les comptait : `billing.controller.ts` ne connaît que le nombre de projets.
//
// Un événement par appel, volontairement pauvre : QUI a appelé, POUR QUELLE
// organisation, et si la réponse est venue du LLM ou du fallback déterministe.
// Ni prompt, ni réponse, ni ratio, ni nom de projet — docs/17 § IA (« contexte
// minimal ») et § Journalisation (« aucun prompt contenant des données inutiles
// ne doit apparaître dans les logs »). Le coût se compte, il ne se raconte pas.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'ai_usage_events', timestamps: { createdAt: true, updatedAt: false } })
export class AiUsageEvent {
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  /** Endpoint appelé — `ai.corrective_actions` aujourd'hui, d'autres demain. */
  @Prop({ type: String, required: true, index: true })
  action!: string;

  /**
   * `llm` = un appel FACTURÉ a eu lieu. `fallback` = aucun appel réseau.
   * La distinction est la seule qui compte pour le coût : un tableau de bord qui
   * les additionnerait ferait croire à une facture qui n'existe pas.
   */
  @Prop({ type: String, required: true, enum: ['llm', 'fallback'] })
  source!: 'llm' | 'fallback';

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type AiUsageEventDocument = HydratedDocument<AiUsageEvent>;
export const AiUsageEventSchema = SchemaFactory.createForClass(AiUsageEvent);

AiUsageEventSchema.index({ createdAt: -1 });

// Quota mensuel par organisation : ce décompte est lu AVANT chaque réponse de
// l'assistant, donc sur le chemin chaud. Sans cet index, chaque message
// déclencherait un parcours de la collection entière, qui grossit d'une ligne
// par appel IA de la plateforme. L'ordre des clés suit la requête
// (`organizationId` et `source` en égalité, `createdAt` en intervalle).
AiUsageEventSchema.index({ organizationId: 1, source: 1, createdAt: -1 });
