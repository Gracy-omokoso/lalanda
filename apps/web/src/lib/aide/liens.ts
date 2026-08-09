// Cibles d'aide citées DEPUIS l'application (S22d).
//
// Module volontairement séparé de `index.ts` : les composants qui s'en servent
// (bandeau de ratios, onglets de résultats) sont des composants CLIENT. Importer
// le registre depuis eux embarquerait la totalité du contenu d'aide dans le
// bundle du navigateur, pour n'y lire que quelques chaînes d'URL. Ce fichier ne
// dépend de rien.
//
// L'intérêt de centraliser ces chaînes plutôt que de les écrire en dur dans les
// composants : `liens.test.ts` les vérifie une à une contre les ancres réelles
// des articles. Un lien écrit dans un composant échapperait à ce contrôle et
// pourrirait en silence au premier renommage de section.

export const LIENS_AIDE = {
  centre: '/aide',
  demarrer: '/aide/demarrer',
  glossaire: '/aide/glossaire',

  bandeauRatios: '/aide/ratios-bancaires',

  feuilleRatios: '/aide/ratios-bancaires',
  feuilleActivite: '/aide/comprendre-les-chiffres#compte-exploitation',
  feuilleTresorerie: '/aide/comprendre-les-chiffres#tresorerie-mensuelle',
  feuilleProjection: '/aide/comprendre-les-chiffres#projection',
  feuilleFinancement: '/aide/comprendre-les-chiffres#financement',
  feuillePlanFinancement: '/aide/comprendre-les-chiffres#plan-financement',
  feuilleBfr: '/aide/comprendre-les-chiffres#bfr',
  feuilleBilan: '/aide/comprendre-les-chiffres#bilan',
  feuilleCaf: '/aide/comprendre-les-chiffres#caf',
  feuilleSeuil: '/aide/comprendre-les-chiffres#seuil-rentabilite',
  feuilleAmortissements: '/aide/comprendre-les-chiffres#amortissements',
} as const;

/**
 * Aide de la feuille de résultats affichée, par identifiant d'onglet.
 *
 * Les clés correspondent aux identifiants d'onglet de la vue projet (`?tab=`) —
 * cf. `TAB_ORDER` dans `projects/_components/project-plan.tsx`.
 *
 * Renvoie `undefined` pour un onglet sans article dédié : l'appelant n'affiche
 * alors aucun lien, plutôt que d'en proposer un qui déçoit.
 */
export function lienAidePourFeuille(idFeuille: string): string | undefined {
  const table: Record<string, string> = {
    ratios: LIENS_AIDE.feuilleRatios,
    activite: LIENS_AIDE.feuilleActivite,
    tresorerie: LIENS_AIDE.feuilleTresorerie,
    projection: LIENS_AIDE.feuilleProjection,
    financement: LIENS_AIDE.feuilleFinancement,
    plan_financement: LIENS_AIDE.feuillePlanFinancement,
    bfr: LIENS_AIDE.feuilleBfr,
    bilan: LIENS_AIDE.feuilleBilan,
    caf: LIENS_AIDE.feuilleCaf,
    seuil_rentabilite: LIENS_AIDE.feuilleSeuil,
    amortissements: LIENS_AIDE.feuilleAmortissements,
  };
  return table[idFeuille];
}
