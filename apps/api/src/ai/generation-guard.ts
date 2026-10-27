// Contrôle d'un texte rédigé par l'IA avant publication (ADR-0033 § 4, ADR-0037 § 4).
//
// Factorisé depuis le brief du matin pour que tout texte généré passe par la
// MÊME porte : un prompt qui demande de ne pas inventer de chiffre n'est pas un
// contrôle (docs/11 § S24a). La canonisation des nombres reste `lala-nombres.ts`.
//
// Pur : sans Nest, sans base, sans réseau.

import { chiffresNonAutorises } from './lala-nombres.js';

/**
 * Motif de rejet d'une série de textes générés, ou `null` s'ils sont publiables.
 *
 * Ordre des contrôles : vide, trop long, nombre absent des données fournies. Le
 * premier texte fautif donne le motif — un seul suffit à refuser la réponse.
 */
export function motifDeRejetTextes(
  textes: readonly string[],
  autorises: ReadonlySet<string>,
  maxCaracteres: number,
): string | null {
  for (const brut of textes) {
    const t = brut.trim();
    if (t === '') return 'texte vide';
    if (t.length > maxCaracteres) return `texte trop long (${t.length} > ${maxCaracteres})`;
    const fautifs = chiffresNonAutorises(t, autorises);
    if (fautifs.length > 0) return `chiffres absents des faits : ${fautifs.join(', ')}`;
  }
  return null;
}

/**
 * Sources citées par une réponse : liste non vide d'identifiants CONNUS,
 * dédoublonnée dans l'ordre. Lève sur toute source absente ou inconnue.
 */
export function sourcesVerifiees(value: unknown, connues: ReadonlySet<string>): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('sources absentes');
  const out: string[] = [];
  for (const s of value) {
    if (typeof s !== 'string' || !connues.has(s)) {
      throw new Error(`source inconnue : ${String(s).slice(0, 60)}`);
    }
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Retire les chevrons : aucune chaîne ne doit pouvoir fermer un bloc de données. */
export function sansChevrons(texte: string): string {
  return texte.replace(/[<>]/g, ' ');
}
