// Passage d'une idée vers le Canvas d'un projet BUILD (ADR-0036 § 3) — partie PURE.
//
// La promotion n'invente rien et ne chiffre rien : elle recopie quatre champs de
// texte de la fiche en cartes du Canvas existant, sans transformation. Aucune
// taille de marché, aucun nombre, aucun driver n'est écrit (docs/05 : « le Canvas
// guide les hypothèses sans générer de montants »).
//
// Règles :
//   - identifiants déterministes `idee-<id>-<champ>` : promouvoir deux fois la
//     même idée vers le même projet ne duplique rien (idempotent), et une carte
//     déjà présente — modifiée ou non dans le Canvas — n'est jamais écrasée ;
//   - les cartes existantes du Canvas sont conservées telles quelles ;
//   - un bloc plein (20 cartes) : la carte est ignorée et signalée, pas refusée
//     en bloc ; un texte trop long est tronqué à 500 caractères, comme le
//     questionnaire de cadrage (docs/05 § S23b).

import {
  CANVAS_BLOCKS,
  type CanvasBlockId,
  type CanvasBlocks,
  type CanvasCard,
} from '../canvas/canvas.schema.js';
import { MAX_CARDS_PER_BLOCK, MAX_CARD_TEXT_LENGTH } from '../canvas/canvas.dto.js';

export interface IdeaTextFields {
  id: string;
  problem: string;
  solution: string;
  target: string;
  revenueModel: string;
}

export type PromotedField = 'probleme' | 'solution' | 'cible' | 'revenus';

/** Correspondance champ de l'idée → bloc du Canvas (ADR-0036 § 3). */
export const PROMOTION_MAP: readonly {
  field: PromotedField;
  bloc: CanvasBlockId;
  text: (i: IdeaTextFields) => string;
}[] = [
  { field: 'probleme', bloc: 'proposition_valeur', text: (i) => prefixed('Problème', i.problem) },
  { field: 'solution', bloc: 'proposition_valeur', text: (i) => prefixed('Solution', i.solution) },
  { field: 'cible', bloc: 'segments_clients', text: (i) => i.target.trim() },
  { field: 'revenus', bloc: 'revenus', text: (i) => i.revenueModel.trim() },
];

function prefixed(label: string, value: string): string {
  const v = value.trim();
  return v === '' ? '' : `${label} : ${v}`;
}

export function promotedCardId(ideaId: string, field: PromotedField): string {
  return `idee-${ideaId}-${field}`;
}

export interface PromotionPlan {
  blocs: CanvasBlocks;
  added: { field: PromotedField; bloc: CanvasBlockId; cardId: string; truncated: boolean }[];
  /** Déjà présentes dans le Canvas (promotion précédente) : laissées telles quelles. */
  present: { field: PromotedField; cardId: string }[];
  /** Bloc plein : non ajoutées. */
  ignored: { field: PromotedField; bloc: CanvasBlockId; reason: 'BLOC_PLEIN' }[];
  /** Champs vides dans la fiche : rien à recopier. */
  empty: PromotedField[];
}

/** Cartes à ajouter au Canvas `current` (non modifié : une copie est rendue). */
export function planPromotion(current: CanvasBlocks, idea: IdeaTextFields): PromotionPlan {
  const blocs = {} as CanvasBlocks;
  for (const b of CANVAS_BLOCKS) blocs[b] = (current[b] ?? []).map((c) => ({ ...c }));
  const plan: PromotionPlan = { blocs, added: [], present: [], ignored: [], empty: [] };

  for (const m of PROMOTION_MAP) {
    const raw = m.text(idea);
    if (raw === '') {
      plan.empty.push(m.field);
      continue;
    }
    const cardId = promotedCardId(idea.id, m.field);
    const bloc = blocs[m.bloc];
    if (bloc.some((c) => c.id === cardId)) {
      plan.present.push({ field: m.field, cardId });
      continue;
    }
    if (bloc.length >= MAX_CARDS_PER_BLOCK) {
      plan.ignored.push({ field: m.field, bloc: m.bloc, reason: 'BLOC_PLEIN' });
      continue;
    }
    const truncated = raw.length > MAX_CARD_TEXT_LENGTH;
    const card: CanvasCard = {
      id: cardId,
      texte: truncated ? raw.slice(0, MAX_CARD_TEXT_LENGTH) : raw,
      ordre: bloc.reduce((max, c) => Math.max(max, c.ordre + 1), 0),
    };
    bloc.push(card);
    plan.added.push({ field: m.field, bloc: m.bloc, cardId, truncated });
  }
  return plan;
}
