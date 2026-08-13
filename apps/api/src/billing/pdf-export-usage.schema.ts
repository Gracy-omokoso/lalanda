// Consommation d'exports PDF — la collection qui matérialise le quota.
//
// Jumelle de `admin/ai-usage.schema.ts`, dont elle reprend la forme et les
// index. Elle vit dans `billing/` et non dans `admin/` parce qu'elle sert
// D'ABORD à appliquer une limite commerciale, et seulement ensuite à alimenter
// un tableau de bord d'exploitation : le comptage IA a fait le chemin inverse
// (statistique d'abord, quota ensuite) et c'est un accident d'histoire, pas un
// modèle à copier.
//
// Un événement par rendu, volontairement pauvre : QUI a exporté, POUR QUELLE
// organisation, SUR QUEL projet, et si un fichier est réellement sorti. Ni
// contenu de rapport, ni montant, ni nom de projet — docs/17 § Journalisation.
// Le coût se compte, il ne se raconte pas.
//
// Ce n'est PAS le journal d'audit. `audit_events` (R4 de l'ADR-0012, écrit par
// `reports.controller.ts` via `recordStrict`) est une PREUVE : son échec annule
// l'export. Cette collection-ci est un COMPTEUR : son échec est journalisé et
// l'export part quand même. Les deux coexistent parce qu'ils ne répondent pas à
// la même question, et parce qu'un compteur dérivé du journal d'audit lierait le
// quota à la rétention de l'audit.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'pdf_export_events', timestamps: { createdAt: true, updatedAt: false } })
export class PdfExportEvent {
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  /** Projet exporté — sert au tableau de bord, jamais au quota (qui est par organisation). */
  @Prop({ type: String, required: true })
  projectId!: string;

  /**
   * `rendered` = un PDF est sorti. `failed` = le rendu a été abandonné (délai
   * dépassé, portillon saturé, Chromium indisponible).
   *
   * La distinction est la seule qui compte pour le quota : seuls les `rendered`
   * sont décomptés. Les `failed` sont néanmoins écrits — sans eux, une vague de
   * délais dépassés sur le Droplet resterait invisible jusqu'à ce qu'un client
   * se plaigne. C'est exactement le rôle des lignes `source: 'fallback'` côté IA.
   */
  @Prop({ type: String, required: true, enum: ['rendered', 'failed'] })
  outcome!: 'rendered' | 'failed';

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type PdfExportEventDocument = HydratedDocument<PdfExportEvent>;
export const PdfExportEventSchema = SchemaFactory.createForClass(PdfExportEvent);

PdfExportEventSchema.index({ createdAt: -1 });

// Quota mensuel par organisation : ce décompte est lu AVANT chaque rendu, donc
// sur le chemin d'un export. Sans cet index, chaque export déclencherait un
// parcours de la collection entière, qui grossit d'une ligne par PDF de la
// plateforme. L'ordre des clés suit la requête (`organizationId` et `outcome` en
// égalité, `createdAt` en intervalle).
PdfExportEventSchema.index({ organizationId: 1, outcome: 1, createdAt: -1 });
