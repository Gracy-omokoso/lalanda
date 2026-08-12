// Logique pure des interprétations et de l'échange avec Lala (S24a).
//
// Même parti pris que `results-model.ts` : ce qui se raisonne sans React vit
// ici, et devient testable. Trois règles y sont verrouillées, parce qu'elles
// sont vérifiables et qu'une régression y serait invisible à l'œil :
//
//  1. **Un texte déterministe ne se fait jamais passer pour de l'IA.** docs/11
//     § Garde-fous : « le champ `source` permet à l'interface d'indiquer
//     clairement à l'utilisateur d'où viennent les suggestions. »
//  2. **Le dernier message envoyé est toujours celui de l'utilisateur** —
//     l'API le refuse autrement (`ChatRequestSchema`), et une interface qui
//     l'ignore produit un 400 que l'utilisateur ne comprendrait pas.
//  3. **L'historique est borné**, côté client aussi : envoyer 40 messages pour
//     s'en faire refuser 20 gaspille un aller-retour.

import type { LalaMessage, TexteIaSource } from '@/lib/api';

/**
 * Plafond d'historique — miroir de `MAX_MESSAGES_ECHANGE` côté API.
 *
 * Dupliqué volontairement : le client doit pouvoir couper AVANT d'envoyer, sans
 * attendre un 400. La valeur de référence reste celle de `lala.dto.ts`; ce
 * miroir ne doit jamais être plus PERMISSIF qu'elle.
 */
export const MAX_MESSAGES_ECHANGE = 20;

/** Longueur maximale d'une question — miroir de `MAX_CARACTERES_MESSAGE`. */
export const MAX_CARACTERES_QUESTION = 2000;

/** Ce que l'interface affiche pour annoncer la provenance d'un texte. */
export interface EtiquetteSource {
  texte: string;
  /** Infobulle : pourquoi ce texte vient de là. */
  titre: string;
}

export function etiquetteSource(source: TexteIaSource): EtiquetteSource {
  if (source === 'llm') {
    return {
      texte: 'Rédigé par Lala',
      titre:
        'Texte rédigé par l’assistante IA à partir des chiffres calculés par le moteur. ' +
        'Les nombres cités sont vérifiés contre ces chiffres.',
    };
  }
  return {
    texte: 'Explication automatique',
    titre:
      'Explication établie directement à partir des chiffres du moteur, sans l’assistante IA — ' +
      'soit qu’elle soit indisponible, soit que sa réponse ait été écartée.',
  };
}

/**
 * Historique borné aux N derniers messages.
 *
 * On coupe par la GAUCHE : la question courante et les échanges qui l'entourent
 * comptent plus que le début du fil. Le contexte financier, lui, n'est pas dans
 * l'historique — il est renvoyé à chaque appel avec les lignes du moteur.
 */
export function historiqueBorne(
  messages: readonly LalaMessage[],
  max: number = MAX_MESSAGES_ECHANGE,
): LalaMessage[] {
  if (max <= 0) return [];
  return messages.slice(Math.max(0, messages.length - max));
}

/**
 * Messages à envoyer pour une nouvelle question.
 *
 * Retourne `null` quand il n'y a rien à envoyer : question vide ou uniquement
 * des espaces. C'est le seul endroit qui décide qu'un envoi est légitime — le
 * composant n'a pas à rejouer la règle.
 */
export function messagesAEnvoyer(
  historique: readonly LalaMessage[],
  question: string,
): LalaMessage[] | null {
  const propre = question.trim();
  if (propre === '') return null;
  const tronquee = propre.slice(0, MAX_CARACTERES_QUESTION);
  // La question est ajoutée EN DERNIER : l'API exige que le fil se termine par
  // l'utilisateur, et un fil qui finirait sur une réponse ferait « répondre le
  // modèle à sa propre réponse ».
  return historiqueBorne([...historique, { role: 'user', content: tronquee }]);
}

/** Un envoi est possible s'il y a une question et qu'aucun appel n'est en cours. */
export function peutEnvoyer(question: string, enCours: boolean): boolean {
  return !enCours && question.trim() !== '';
}

/**
 * Clé de cache d'une interprétation.
 *
 * La valeur de la ligne entre dans la clé : rouvrir une bulle après un
 * recalcul ne doit pas resservir la lecture de l'ancien chiffre. C'est le
 * scénario réel d'un aller-retour « Modifier les hypothèses → Résultats ».
 */
export function cleInterpretation(sheetId: string, lineId: string, valeur: number): string {
  return `${sheetId}::${lineId}::${valeur}`;
}
