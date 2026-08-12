// Consommation de l'agent vocal — collection DISTINCTE de `ai_usage_events`.
//
// ── Pourquoi une collection à part et pas une `action` de plus ───────────────
//
// `AiUsageService.countBilledForOrganizationSince()` compte TOUS les documents
// `{organizationId, source:'llm'}` de sa collection, sans filtrer l'action :
// c'est délibéré côté texte (« un quota par usage se contournerait en changeant
// d'écran »). Y écrire une session vocale ferait donc décompter un message texte
// par appel vocal — et surtout, cela mélangerait deux unités qui n'ont ni le même
// coût ni le même ordre de grandeur (voir `lala-vocal-quota.ts`).
//
// Deux compteurs, deux collections, deux refus. Le quota de messages texte reste
// exactement ce qu'il était.
//
// ── Ce que le document contient, et ce qu'il ne contiendra jamais ────────────
//
// QUI a appelé, POUR quelle organisation, COMBIEN de minutes ont été débitées.
// Ni transcription, ni question, ni réponse, ni nom de projet, ni identifiant de
// projet — docs/17 § IA (« contexte minimal ») et docs/11. Ce n'est pas une
// précaution de plus : l'agent vocal ne reçoit AUCUNE de ces données, donc rien
// de tel ne peut apparaître ici sans qu'un chemin de fuite ait été ouvert
// ailleurs. Le schéma est la trace écrite de cette frontière.
//
// `conversationId` est l'identifiant OPAQUE rendu par ElevenLabs. Il sert au
// rapprochement d'une facture fournisseur avec une organisation, et à rien
// d'autre. Il ne porte aucun contenu.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'lala_vocal_sessions', timestamps: { createdAt: true, updatedAt: true } })
export class LalaVocalSession {
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  /** Identifiant opaque de la conversation chez le fournisseur, s'il est connu. */
  @Prop({ type: String, required: false, default: null })
  conversationId!: string | null;

  /**
   * Minutes IMPUTÉES à l'organisation pour cette session.
   *
   * Écrit à l'OUVERTURE, au plafond de session, et corrigé à la baisse à la
   * clôture. Jamais l'inverse : une session ouverte dont on n'entend plus parler
   * a pu durer autant que le plafond, et la compter à zéro ferait de « ne pas
   * rapporter la fin » la stratégie la moins chère. Voir `minutesADebiter`.
   */
  @Prop({ type: Number, required: true })
  minutesDebitees!: number;

  /** La fin de la session a-t-elle été rapportée ? `false` = débit pessimiste. */
  @Prop({ type: Boolean, required: true, default: false })
  cloturee!: boolean;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type LalaVocalSessionDocument = HydratedDocument<LalaVocalSession>;
export const LalaVocalSessionSchema = SchemaFactory.createForClass(LalaVocalSession);

// Le décompte du mois est lu AVANT chaque ouverture de session, donc sur le
// chemin chaud. L'ordre des clés suit la requête : `organizationId` en égalité,
// `createdAt` en intervalle.
LalaVocalSessionSchema.index({ organizationId: 1, createdAt: -1 });
