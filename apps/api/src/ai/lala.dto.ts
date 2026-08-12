// DTO de l'interprétation des résultats et du chat « Lala » (S24a).
//
// Deux besoins distincts, portés par deux points d'API :
//
//  1. `POST /ai/interpretations` — pour CHAQUE ligne d'une feuille de résultats,
//     une LECTURE de ce chiffre-là. Ce n'est pas une définition (« le DSCR
//     mesure… ») : c'est ce que VOTRE valeur dit, comparée à son seuil.
//  2. `POST /ai/lala/messages` — l'approfondissement, quand l'utilisateur clique
//     « Discuter avec Lala » sous une interprétation.
//
// Les deux consomment le résultat d'un `evaluate` déjà produit par le moteur,
// exactement comme `POST /ai/corrective-actions` (S14a). L'IA ne déclenche
// aucun calcul : elle lit une sortie moteur qu'on lui présente.

import { z } from 'zod';

import { EvaluateLineSchema } from './ai-actions.dto.js';

/**
 * Bornes de taille du contexte transmis.
 *
 * Même esprit que les bornes techniques de `ai-limits.ts` (S22h) : ce n'est pas
 * une mesure de coût, c'est une mesure de tenue. Une feuille du moteur compte au
 * plus quelques dizaines de lignes; accepter un tableau non borné laisserait un
 * client bavard occuper mémoire et jetons sans limite.
 */
export const MAX_LIGNES_CONTEXTE = 400;
/**
 * Lignes interprétées EN UN APPEL.
 *
 * Le plafond de jetons en sortie est de 1024 (S22h) : au-delà d'une dizaine de
 * lectures de deux ou trois phrases, la réponse serait tronquée et retomberait
 * entièrement sur le déterministe. L'interface demande donc les interprétations
 * à l'ouverture d'une bulle, ligne par ligne, plutôt que d'en produire trente
 * d'avance dont vingt-huit ne seront jamais lues.
 */
export const MAX_LIGNES_INTERPRETEES = 10;
/** Un échange reste court : au-delà, le contexte utile s'est déjà déplacé. */
export const MAX_MESSAGES_ECHANGE = 20;
/** Longueur d'un message utilisateur — une question, pas un mémoire. */
export const MAX_CARACTERES_MESSAGE = 2000;

// ─── Interprétations ─────────────────────────────────────────────────────────

export const InterpretationsRequestSchema = z.object({
  templateSlug: z.string().min(1),
  /** Feuille de résultats affichée (`ratios`, `tresorerie`, `bilan`…). */
  sheetId: z.string().min(1),
  /** Libellé court de la feuille tel qu'affiché — sert au cadrage du prompt. */
  sheetLabel: z.string().min(1).max(120).optional(),
  devise: z.string().max(8).optional(),
  /**
   * Feuille complète telle que le moteur l'a produite. Elle sert DEUX fois : à
   * cadrer la lecture, et à borner les chiffres citables — tout ce qui est ici
   * vient du moteur, rien d'autre n'est autorisé dans le texte rendu.
   */
  lines: z.array(EvaluateLineSchema).min(1).max(MAX_LIGNES_CONTEXTE),
  /** Lignes dont on veut l'interprétation, sous-ensemble de `lines`. */
  lineIds: z.array(z.string().min(1)).min(1).max(MAX_LIGNES_INTERPRETEES),
});
export type InterpretationsRequest = z.infer<typeof InterpretationsRequestSchema>;

/**
 * Origine du texte rendu, ligne par ligne.
 *
 * `fallback` n'est pas un mode dégradé honteux : c'est une lecture déterministe
 * complète, écrite à partir des mêmes chiffres. L'exposer permet à l'interface
 * de le DIRE, comme le fait déjà `/ai/corrective-actions` (docs/11).
 */
export const SourceTexteSchema = z.enum(['llm', 'fallback']);
export type SourceTexte = z.infer<typeof SourceTexteSchema>;

export const InterpretationSchema = z.object({
  lineId: z.string().min(1),
  /** Lecture de CE chiffre. Jamais une définition, jamais une recommandation. */
  texte: z.string().min(1),
  source: SourceTexteSchema,
});
export type Interpretation = z.infer<typeof InterpretationSchema>;

export const InterpretationsResponseSchema = z.object({
  sheetId: z.string().min(1),
  interpretations: z.array(InterpretationSchema),
  /**
   * Source DOMINANTE, pour l'indicateur global de l'interface. Une réponse peut
   * être mixte : une ligne dont le texte a cité un chiffre absent du moteur
   * retombe seule sur le déterministe, sans entraîner les autres.
   */
  source: SourceTexteSchema,
  /**
   * Réserve de portée de la feuille (ex. trésorerie mensuelle simplifiée).
   * Renvoyée SYSTÉMATIQUEMENT quand elle existe, quelle que soit la source :
   * elle ne dépend pas de ce que le modèle a bien voulu écrire.
   */
  avertissementFeuille: z.string().nullable(),
  /** Mention anti-conseil, non négociable — voir `MENTION_NON_CONSEIL`. */
  mention: z.string().min(1),
});
export type InterpretationsResponse = z.infer<typeof InterpretationsResponseSchema>;

// ─── Chat avec Lala ──────────────────────────────────────────────────────────

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(MAX_CARACTERES_MESSAGE),
});
export type Message = z.infer<typeof MessageSchema>;

export const ChatRequestSchema = z
  .object({
    templateSlug: z.string().min(1),
    sheetId: z.string().min(1),
    sheetLabel: z.string().min(1).max(120).optional(),
    /** Ligne d'où part la conversation — celle dont on veut « plus d'éclairage ». */
    lineId: z.string().min(1),
    devise: z.string().max(8).optional(),
    lines: z.array(EvaluateLineSchema).min(1).max(MAX_LIGNES_CONTEXTE),
    /** Interprétation déjà affichée, reprise pour que l'échange la prolonge. */
    interpretation: z.string().max(4000).optional(),
    /**
     * Historique de l'échange, le DERNIER message étant la question posée.
     * Le rôle `system` n'est pas acceptable ici : le cadrage appartient au
     * serveur, jamais au client (docs/11 § Garde-fous, « refus des instructions
     * malveillantes »).
     */
    messages: z.array(MessageSchema).min(1).max(MAX_MESSAGES_ECHANGE),
  })
  .refine((r) => r.messages[r.messages.length - 1]?.role === 'user', {
    // Un échange se termine toujours par la question de l'utilisateur. Sans
    // cette règle, un client pourrait faire répondre le modèle « à sa propre
    // réponse » et faire dériver le fil sans qu'aucun humain n'ait rien demandé.
    message: 'Le dernier message doit être celui de l’utilisateur.',
    path: ['messages'],
  })
  .refine((r) => r.lines.some((l) => l.lineId === r.lineId), {
    // La ligne d'origine doit exister dans le contexte fourni : sinon Lala
    // parlerait d'un résultat dont il n'a pas la valeur.
    message: 'La ligne d’origine est absente des lignes fournies.',
    path: ['lineId'],
  });
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatResponseSchema = z.object({
  reply: z.string().min(1),
  source: SourceTexteSchema,
  avertissementFeuille: z.string().nullable(),
  mention: z.string().min(1),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
