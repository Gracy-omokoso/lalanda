import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Business Model Canvas (S18d — docs/05).
 *
 * Un canvas par projet : les 9 blocs BMC, chaque bloc étant une liste ordonnée
 * de cartes courtes. Le Canvas guide les hypothèses SANS générer de montants
 * (docs/05 § Relations financières) — aucune donnée chiffrée ici.
 */

/** Les 9 blocs du BMC — ordre canonique docs/05 § Blocs. */
export const CANVAS_BLOCKS = [
  'segments_clients',
  'proposition_valeur',
  'canaux',
  'relations_clients',
  'revenus',
  'ressources_cles',
  'activites_cles',
  'partenaires_cles',
  'couts',
] as const;

export type CanvasBlockId = (typeof CANVAS_BLOCKS)[number];

/** Carte d'un bloc — texte court, position stable dans le bloc. */
export interface CanvasCard {
  id: string;
  texte: string;
  ordre: number;
}

export type CanvasBlocks = Record<CanvasBlockId, CanvasCard[]>;

/** Blocs vides — état initial d'un canvas jamais sauvegardé. */
export function emptyCanvasBlocks(): CanvasBlocks {
  return Object.fromEntries(CANVAS_BLOCKS.map((b) => [b, []])) as CanvasBlocks;
}

@Schema({ collection: 'canvases', timestamps: true, strict: true })
export class Canvas {
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  /** Les 9 blocs BMC. Objet libre côté Mongoose — la forme est garantie par zod au PUT. */
  @Prop({ type: Object, required: true })
  blocs!: CanvasBlocks;

  /** Incrémenté à chaque PUT — versionnement léger (docs/05 § Versionnement). */
  @Prop({ type: Number, required: true, default: 0 })
  version!: number;

  /** User id du dernier auteur (docs/05 : l'historique indique l'auteur). */
  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  // timestamps: true
  createdAt!: Date;
  updatedAt!: Date;
}

export type CanvasDocument = HydratedDocument<Canvas>;
export const CanvasSchema = SchemaFactory.createForClass(Canvas);

// Un seul canvas par projet — l'upsert du PUT s'appuie sur cet index.
CanvasSchema.index({ projectId: 1 }, { unique: true });
CanvasSchema.index({ organizationId: 1, projectId: 1 });

/**
 * Instantané d'un canvas au moment d'un PUT (docs/05 § Versionnement).
 * Seules les 20 dernières révisions par projet sont conservées (rétention légère).
 */
@Schema({ collection: 'canvas_revisions', timestamps: { createdAt: true, updatedAt: false } })
export class CanvasRevision {
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  /** Version du canvas au moment du snapshot. */
  @Prop({ type: Number, required: true })
  version!: number;

  @Prop({ type: Object, required: true })
  blocs!: CanvasBlocks;

  /** Auteur du PUT ayant produit cette révision. */
  @Prop({ type: String, required: true })
  savedBy!: string;

  createdAt!: Date;
}

export type CanvasRevisionDocument = HydratedDocument<CanvasRevision>;
export const CanvasRevisionSchema = SchemaFactory.createForClass(CanvasRevision);

// Unicité et lecture « révisions d'un projet », plus récentes en premier.
CanvasRevisionSchema.index({ projectId: 1, version: -1 }, { unique: true });
CanvasRevisionSchema.index({ organizationId: 1, projectId: 1, version: -1 });
