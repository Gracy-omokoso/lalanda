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
export const LEGAL_VERSION = '2026-10-30';

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
export const KNOWN_LEGAL_VERSIONS: readonly string[] = [
  // Premier corpus publié (S22c), éditeur : Televerx LLC.
  '2026-08-09',
  // Changement d'éditeur : Go freelance SARLU, droit congolais (ADR-0043).
  LEGAL_VERSION,
] as const;

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
 * ÉDITEUR DU SERVICE (ADR-0043, décision de la dirigeante du 30 oct. 2026).
 *
 * Lalanda est porté par Go freelance SARLU, société à responsabilité limitée
 * unipersonnelle de droit congolais (République démocratique du Congo). C'est
 * l'UNIQUE endroit où l'identité de l'éditeur est déclarée : les pages légales,
 * les pieds de page et la documentation la lisent ici.
 *
 * NE RIEN COMPLÉTER PAR DÉDUCTION. Les mentions d'immatriculation (RCCM,
 * Id. Nat., NIF), le siège, le capital, le gérant et le téléphone ne sont PAS
 * publiés, par choix de la dirigeante (voir `PUBLISHER_UNPUBLISHED_MENTIONS`).
 * Les inventer produirait un document faux, publié sous le nom d'une personne
 * morale réelle.
 */
export const PUBLISHER_NAME = 'Go freelance SARLU';

/** Forme juridique de l'éditeur, en toutes lettres. */
export const PUBLISHER_LEGAL_FORM = 'société à responsabilité limitée unipersonnelle (SARLU)';

/** Droit dont relève l'éditeur en tant que société (et non, en soi, le contrat). */
export const PUBLISHER_GOVERNING_LAW = 'droit congolais (République démocratique du Congo)';

/**
 * Partenaire de développement et d'intégration.
 *
 * N'apparaît QUE dans les mentions légales (décision du 30 oct. 2026) : ni dans
 * les pieds de page, ni dans la politique de confidentialité, ni dans les CGU et
 * CGV. Televerx LLC n'est pas l'éditeur et ne contracte pas avec l'utilisateur.
 */
export const DEVELOPMENT_PARTNER_NAME = 'Televerx LLC';
export const DEVELOPMENT_PARTNER_ROLE = `partenaire de développement et d’intégration de ${PUBLISHER_NAME}`;

/**
 * Mentions d'identification de l'éditeur VOLONTAIREMENT NON PUBLIÉES.
 *
 * Décision de la dirigeante, 30 oct. 2026 : ces informations ne sont pas
 * fournies et les pages publiques ne les affichent pas, ni sous forme de
 * marqueur. Plusieurs sont habituellement attendues dans des mentions légales :
 * le choix est à faire valider par un juriste (docs/28-CONFORMITE-LEGALE.md
 * § 1.2). Cette liste n'est rendue sur AUCUNE page ; elle sert de registre
 * interne. Si une mention est fournie un jour, on l'ajoute ici comme constante
 * et on la retire de la liste.
 */
export const PUBLISHER_UNPUBLISHED_MENTIONS: readonly string[] = [
  'numéro RCCM',
  'identification nationale (Id. Nat.)',
  'numéro d’impôt (NIF)',
  'adresse du siège social',
  'capital social',
  'nom du gérant / représentant légal',
  'nom du directeur de la publication',
  'numéro de téléphone',
] as const;

/** Marqueur d'information que l'éditeur doit renseigner avant publication. */
export function legalTodo(label: string): string {
  return `[À COMPLÉTER : ${label}]`;
}
