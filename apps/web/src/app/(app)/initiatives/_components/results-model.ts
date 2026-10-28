// Modèle de la vue RÉSULTATS (S23a) — logique pure, sans React.
//
// Extrait de `project-plan.tsx` lors de l'éclatement saisie / lecture : la liste
// des onglets, leur ordre, leurs libellés et leurs avertissements sont
// désormais des données testables, et non plus des constantes enfouies dans un
// composant de 870 lignes.
//
// Règle de fond : **les onglets suivent les feuilles que le moteur produit**.
// Les identifiants ci-dessous sont ceux déclarés sous `feuilles:` dans
// `packages/engine/src/templates/*.yaml` (`activite`, `financement`,
// `plan_financement`, `tresorerie`, `projection`, `ratios`), plus les feuilles
// dérivées que l'API renvoie dans des structures dédiées (`amortissements`,
// `bilan`, `bfr`, `caf`, `seuil_rentabilite`). Aucun onglet n'est inventé :
// `buildResultTabs` n'affiche que ce qui est réellement présent dans
// l'évaluation.

import type { LineResult } from '@/lib/api';

/**
 * Libellés courts des onglets.
 *
 * Ils doublent le `label` déclaré par la feuille dans le DSL, que
 * `EvaluationView` n'expose pas encore — à resynchroniser à chaque évolution
 * d'horizon (S18a : la projection est passée de 3 à 5 exercices).
 */
export const SHEET_LABELS: Record<string, string> = {
  ratios: 'Ratios bancaires',
  activite: "Compte d'exploitation",
  tresorerie: 'Trésorerie mensuelle',
  projection: 'Projection 5 exercices',
  financement: 'Financement',
  plan_financement: 'Plan de financement',
  amortissements: 'Amortissements',
  // (S18a, FIN-001) États financiers prévisionnels.
  bfr: 'BFR',
  bilan: 'Bilan',
  caf: 'CAF',
  seuil_rentabilite: 'Seuil',
};

/** Ordre canonique des onglets (gauche → droite) — S13d + S14c. */
export const TAB_ORDER: string[] = [
  'ratios',
  'activite',
  'tresorerie',
  'projection',
  'financement',
  'plan_financement',
  'bfr',
  'bilan',
  'caf',
  'seuil_rentabilite',
  'amortissements',
];

export const DEFAULT_TAB = 'ratios';

/**
 * Avertissements de portée attachés à une feuille.
 *
 * Le DSL porte déjà ces réserves dans le `label` de la feuille — par exemple
 * « Trésorerie mensuelle année 1 — vue simplifiée (hors variation de BFR et
 * hors intérêts) » dans les quatre templates sectoriels. L'interface remplace
 * ce libellé long par un libellé d'onglet court (`SHEET_LABELS`) : la réserve
 * disparaissait donc de l'écran, alors qu'elle change la lecture des chiffres.
 *
 * Elle est réintroduite ici, à côté du tableau, pour qu'elle soit visible **où
 * que la feuille s'affiche** et non seulement dans la note de rapprochement de
 * l'onglet Bilan.
 *
 * À supprimer le jour où l'API expose le `label` de feuille : ce texte devra
 * alors venir du moteur, seule source de vérité.
 */
export const SHEET_WARNINGS: Record<string, string> = {
  tresorerie:
    'Vue mensuelle simplifiée de l’année 1 : elle ignore la variation du besoin en fonds de roulement et les intérêts d’emprunt. Elle ne coïncide avec le bilan qu’à l’ouverture, et l’écart grandit avec le délai de paiement clients. C’est le bilan qui fait foi.',
};

export interface SheetTabDescriptor {
  id: string;
  label: string;
}

/** Ensemble des feuilles présentes dans une évaluation, par identifiant. */
export function groupLinesBySheet(lines: LineResult[]): Map<string, LineResult[]> {
  const map = new Map<string, LineResult[]>();
  for (const l of lines) {
    const arr = map.get(l.sheetId) ?? [];
    arr.push(l);
    map.set(l.sheetId, arr);
  }
  return map;
}

/**
 * Onglets à afficher : ordre canonique d'abord, puis toute feuille produite par
 * le moteur mais absente de `TAB_ORDER` — un nouveau template ne doit jamais
 * rendre une feuille invisible parce que l'interface n'a pas été mise à jour.
 *
 * `virtualIds` porte les onglets qui n'ont pas de lignes propres :
 *  - `amortissements` est rendu depuis la struct `amortissements` (S14c);
 *  - `bfr` est VIRTUEL : ses lignes vivent dans `plan_financement`
 *    (`pf_bfr_*`, ADR-0011 § Contrat 2), son rendu vient de `etatsFinanciers`.
 */
export function buildResultTabs(
  sheetIds: Iterable<string>,
  virtualIds: readonly string[] = [],
): SheetTabDescriptor[] {
  const present = new Set(sheetIds);
  const virtual = new Set(virtualIds);
  const seen = new Set<string>();
  const ordered: SheetTabDescriptor[] = [];

  for (const id of TAB_ORDER) {
    if (present.has(id) || virtual.has(id)) {
      ordered.push({ id, label: SHEET_LABELS[id] ?? id });
      seen.add(id);
    }
  }
  for (const id of present) {
    if (!seen.has(id)) {
      ordered.push({ id, label: SHEET_LABELS[id] ?? id });
      seen.add(id);
    }
  }
  return ordered;
}

/**
 * Onglet à ouvrir pour une valeur d'URL donnée.
 *
 * Un `?tab=` inconnu (lien périmé, template changé) ne doit ni planter ni
 * afficher un panneau vide : on retombe sur les ratios, puis sur le premier
 * onglet disponible.
 */
export function resolveActiveTab(
  requested: string | null,
  tabs: readonly SheetTabDescriptor[],
): string {
  if (requested && tabs.some((t) => t.id === requested)) return requested;
  if (tabs.some((t) => t.id === DEFAULT_TAB)) return DEFAULT_TAB;
  return tabs[0]?.id ?? DEFAULT_TAB;
}

/**
 * Lignes à afficher pour un onglet.
 *
 * (S18a) Le détail annuel du BFR a son propre onglet : on l'ôte du tableau brut
 * du plan de financement, qui doit rester la lecture « besoins / ressources ».
 */
export function linesForTab(bySheet: Map<string, LineResult[]>, tabId: string): LineResult[] {
  const lines = bySheet.get(tabId) ?? [];
  if (tabId !== 'plan_financement') return lines;
  return lines.filter((l) => !l.lineId.startsWith('pf_bfr_'));
}

/** Formatage d'une valeur de ligne selon le format déclaré par le moteur. */
export function formatValue(
  value: number,
  format: LineResult['format'],
  currency: string = 'USD',
): string {
  if (format === 'percent') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'percent',
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (format === 'money') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
}
