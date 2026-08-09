// Contrat légal partagé entre le web et l'API (S22c).
//
// ─────────────────────────────────────────────────────────────────────────────
// AVERTISSEMENT — LES TEXTES LÉGAUX SONT DES PROJETS NON VALIDÉS JURIDIQUEMENT.
// Voir docs/28-CONFORMITE-LEGALE.md.
// ─────────────────────────────────────────────────────────────────────────────
//
// POURQUOI CE MODULE EXISTE DANS `shared` ET PAS DANS CHAQUE APPLICATION.
//
// La version du corpus contractuel est écrite par l'API (`termsVersion` dans la
// collection `terms_acceptances`) et affichée par le web (bandeau des pages
// légales, case d'acceptation à l'inscription). Si les deux la définissaient
// chacune de leur côté, une mise à jour des textes appliquée d'un seul côté
// produirait la panne la plus discrète possible : l'API enregistrerait une
// acceptation « à jour » pour un utilisateur qui a lu l'ancienne version, ou
// redemanderait indéfiniment un accord déjà donné. Ni l'une ni l'autre n'échoue
// bruyamment. Une seule constante, importée des deux côtés, supprime le cas.

/**
 * VERSION DU CORPUS CONTRACTUEL.
 *
 * Couvre l'ENSEMBLE des documents opposables — CGU, CGV et politique de
 * confidentialité — plutôt qu'un document isolé : un utilisateur accepte un état
 * du corpus à une date, pas cinq numéros de version indépendants qu'il faudrait
 * recouper pour savoir ce qu'il a réellement lu.
 *
 * RÈGLE D'ÉVOLUTION : toute modification SUBSTANTIELLE (nouvelle finalité de
 * traitement, nouveau sous-traitant, changement de prix ou de durée
 * d'engagement, extension des usages interdits) impose de faire avancer cette
 * version ET d'ajouter l'ancienne à `KNOWN_LEGAL_VERSIONS`. Les acceptations
 * antérieures deviennent alors périmées et l'accord est redemandé. Une
 * correction de typographie ne la fait PAS avancer.
 */
export const LEGAL_VERSION = '2026-08-09';

/**
 * Versions du corpus ayant réellement existé, la plus ancienne d'abord.
 *
 * Sert à REFUSER une valeur inventée : sans cette liste, un client pourrait
 * enregistrer `termsVersion: '2099-01-01'` et ne plus jamais se voir redemander
 * son accord, puisque toute comparaison à la version courante le donnerait pour
 * à jour. Une acceptation est une preuve — elle ne doit porter que sur un texte
 * qui a été publié.
 *
 * NE JAMAIS RETIRER D'ENTRÉE : les acceptations passées y font référence.
 */
export const KNOWN_LEGAL_VERSIONS: readonly string[] = [LEGAL_VERSION] as const;

/** Cette chaîne désigne-t-elle une version du corpus réellement publiée ? */
export function isKnownLegalVersion(version: string): boolean {
  return KNOWN_LEGAL_VERSIONS.includes(version);
}

/**
 * Cette acceptation couvre-t-elle le corpus en vigueur ?
 *
 * `null` (jamais accepté) et une version périmée donnent le même résultat —
 * `false` — et donc le même traitement : l'accord est redemandé. Traiter
 * « ancienne acceptation » comme « acceptation » reviendrait à opposer à
 * l'utilisateur un texte qu'il n'a pas lu.
 */
export function isTermsAcceptanceCurrent(acceptedVersion: string | null | undefined): boolean {
  return acceptedVersion === LEGAL_VERSION;
}

/**
 * ÉDITEUR DU SERVICE.
 *
 * Lalanda est un produit de Televerx LLC. Ce nom est la SEULE information
 * d'identification de l'éditeur qui soit établie à ce jour : adresse, État ou
 * pays d'immatriculation, numéro d'enregistrement, capital, représentant légal
 * et adresse de contact restent inconnus et sont affichés comme
 * `[À COMPLÉTER : …]` dans les pages légales.
 *
 * NE RIEN COMPLÉTER ICI PAR DÉDUCTION. Inventer l'adresse ou le numéro
 * d'immatriculation d'une société réelle ne produit pas un document incomplet,
 * mais un document faux — publié sous la signature d'une personne morale
 * existante. Un marqueur visible est un défaut qu'on corrige ; une mention
 * inventée est une affirmation que personne ne pense à vérifier.
 */
export const PUBLISHER_NAME = 'Televerx LLC';

/** Marqueur d'information que l'éditeur doit renseigner avant publication. */
export function legalTodo(label: string): string {
  return `[À COMPLÉTER : ${label}]`;
}
