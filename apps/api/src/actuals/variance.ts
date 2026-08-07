// Calculs d'écarts prévisionnel vs réalisé (S18b — docs/08 § Écarts).
//
// Module PUR (aucune dépendance Nest/Mongo) pour être testable unitairement :
// le service ne fait que charger plan + périodes puis déléguer ici.
//
// ─── Conventions MVP (documentées docs/08 § Implémenté S18b) ──────────────
// 1. Lignes de référence : les lignes `format: 'money'` de la feuille `activite`
//    du dernier plan validé — c'est le compte d'exploitation, là où vivent le CA
//    et les charges principales que l'utilisateur saisit en réalisé.
// 2. Les templates actuels expriment la feuille `activite` en MOYENNE MENSUELLE.
//    Plan annuel d'une ligne = valeur mensuelle × 12 ; prévu mensuel = annuel/12.
//    La convention « annuel/12 » (prorata linéaire, pas de saisonnalité) est le
//    choix MVP assumé — la mensualisation fine arrivera avec la DSL temporelle.
// 3. Sens d'une ligne (produit vs charge) : heuristique sur le lineId, faute de
//    métadonnée `sens` dans la DSL (hors périmètre S18b — on ne touche pas au
//    moteur). Une charge réalisée SOUS le prévu est favorable ; un produit
//    réalisé SOUS le prévu ne l'est pas (docs/08 § Écarts).
// 4. NON COMPARABLE (ADR-0011 § friction n°3) : une ligne saisie au réalisé qui
//    n'existe pas dans le plan validé comparé — cas des snapshots antérieurs à
//    FIN-001, qui n'embarquent ni `bilan` ni `caf` — n'a PAS de base prévue.
//    Elle est renvoyée avec `comparable: false` et une `raison`, jamais avec un
//    écart de 100 % (ni un statut favorable/défavorable, qui n'aurait aucun sens
//    sans référence). On ne ré-exécute JAMAIS le moteur sur un plan historique
//    pour combler le trou (docs/07 § Limite connue).

/** Ligne du plan telle qu'embarquée dans le snapshot `result.lines` (S16c). */
export interface PlanLineInput {
  sheetId: string;
  lineId: string;
  label: string;
  value: number;
  format: 'money' | 'number' | 'percent';
}

/** Période réalisée minimale pour le calcul (statut + valeurs saisies). */
export interface PeriodInput {
  month: number;
  status: 'open' | 'closed';
  values: Record<string, number>;
}

export type LineSens = 'produit' | 'charge';
export type VarianceStatut = 'favorable' | 'defavorable';

/**
 * Pourquoi une ligne saisie au réalisé n'est pas comparable au plan validé.
 * - `LIGNE_ABSENTE_DU_PLAN` : le snapshot ne contient pas du tout cet identifiant
 *   (plan validé antérieur au template/moteur courant — ADR-0011 friction n°3).
 * - `LIGNE_HORS_COMPTE_EXPLOITATION` : l'identifiant existe dans le plan mais hors
 *   de la feuille de référence (`activite`) ou avec un format non monétaire — le
 *   suivi mensuel du réalisé ne s'applique pas à ces lignes.
 */
export type NonComparableRaison = 'LIGNE_ABSENTE_DU_PLAN' | 'LIGNE_HORS_COMPTE_EXPLOITATION';

export interface VarianceLine {
  lineId: string;
  label: string;
  sens: LineSens;
  /** false → aucune base prévue : tous les champs de comparaison valent `null`. */
  comparable: boolean;
  /** Renseignée si et seulement si `comparable === false`. */
  raison: NonComparableRaison | null;
  /** Prévu mensuel = plan annuel / 12 (convention MVP). `null` si non comparable. */
  prevuMensuel: number | null;
  /** Prévu cumulé sur les mois saisis = prévu mensuel × nb mois saisis. */
  prevuCumule: number | null;
  /** Réalisé cumulé sur les mois saisis (0 si la ligne n'a jamais été saisie). */
  realiseCumule: number;
  ecart: number | null;
  /** Écart relatif (fraction, ex. 0.12 = +12 %) — null si la base prévue est nulle. */
  ecartPct: number | null;
  statut: VarianceStatut | null;
}

export interface ProjectionLine {
  lineId: string;
  label: string;
  sens: LineSens;
  comparable: boolean;
  raison: NonComparableRaison | null;
  planAnnuel: number | null;
  /** Réalisé cumulé des mois CLÔTURÉS uniquement (observation ferme). */
  realiseClos: number;
  /** Prévisionnel des mois restants = prévu mensuel × (12 − nb mois clôturés). */
  previsionnelRestant: number | null;
  /** Total exercice recalculé = réalisé clôturé + prévisionnel restant. */
  totalProjete: number | null;
  /** Écart du total projeté vs le plan annuel d'origine. */
  ecartVsPlan: number | null;
}

/** Feuille de référence du réalisé — le compte d'exploitation. */
const REFERENCE_SHEET = 'activite';

/**
 * Soldes de gestion et produits, reconnus au PRÉFIXE du lineId. Testé en premier
 * car un solde peut porter un mot de charge en fin d'identifiant :
 * `resultat_avant_impot` est un solde (produit), pas un impôt.
 */
const PRODUIT_PATTERN =
  /^(ca|chiffre|ventes?|produit|produits|recette|recettes|encaissement|encaissements|subvention|subventions|marge|resultat|excedent|ebe|caf|solde|tresorerie)(_|$)/;

/**
 * Mots-clés identifiant une CHARGE dans un lineId (heuristique MVP).
 * Tout le reste est traité en sens « produit » : plus haut que prévu = favorable.
 */
const CHARGE_PATTERN =
  /(^|_)(cout|couts|charge|charges|achat|achats|depense|depenses|frais|salaire|salaires|personnel|loyer|impot|impots|ibp|taxe|taxes|interet|interets|dette|amortissement|dap)(_|$)/;

/**
 * Déduit le sens d'une ligne depuis son identifiant (convention MVP documentée).
 * Ordre volontaire : préfixe « produit » d'abord, mots-clés « charge » ensuite,
 * produit par défaut.
 */
export function inferSens(lineId: string): LineSens {
  if (PRODUIT_PATTERN.test(lineId)) return 'produit';
  return CHARGE_PATTERN.test(lineId) ? 'charge' : 'produit';
}

/**
 * Lignes de référence du suivi réalisé : lignes monétaires du compte
 * d'exploitation (`activite`) du plan, dans l'ordre du template.
 */
export function referenceLines(planLines: PlanLineInput[]): PlanLineInput[] {
  return planLines.filter((l) => l.sheetId === REFERENCE_SHEET && l.format === 'money');
}

function statutFor(sens: LineSens, ecart: number): VarianceStatut {
  // Écart nul = conforme au plan → favorable (aucune dérive).
  if (sens === 'charge') return ecart <= 0 ? 'favorable' : 'defavorable';
  return ecart >= 0 ? 'favorable' : 'defavorable';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cumul d'une ligne sur un ensemble de périodes. */
function cumul(periods: PeriodInput[], lineId: string): number {
  return periods.reduce((sum, p) => sum + (p.values[lineId] ?? 0), 0);
}

/**
 * Lignes saisies au réalisé qui n'ont PAS de contrepartie comparable dans le plan
 * validé — ADR-0011 friction n°3. Retournées dans un ordre déterministe (tri par
 * identifiant) pour que deux appels successifs donnent le même résultat
 * (docs/08 § Critères d'acceptation : « les écarts sont reproductibles »).
 */
function nonComparableIds(
  planLines: PlanLineInput[],
  periods: PeriodInput[],
): { lineId: string; label: string; raison: NonComparableRaison }[] {
  const comparableIds = new Set(referenceLines(planLines).map((l) => l.lineId));
  const planLabels = new Map(planLines.map((l) => [l.lineId, l.label]));
  const saisis = new Set<string>();
  for (const p of periods) for (const lineId of Object.keys(p.values)) saisis.add(lineId);

  return [...saisis]
    .filter((lineId) => !comparableIds.has(lineId))
    .sort()
    .map((lineId) => ({
      lineId,
      // Faute de libellé dans le plan, l'identifiant fait office de libellé.
      label: planLabels.get(lineId) ?? lineId,
      raison: planLabels.has(lineId)
        ? ('LIGNE_HORS_COMPTE_EXPLOITATION' as const)
        : ('LIGNE_ABSENTE_DU_PLAN' as const),
    }));
}

/**
 * Écarts cumulés réalisé vs plan sur les mois SAISIS (toute période existante,
 * ouverte ou clôturée) — comparaison à périmètre identique : prévu cumulé et
 * réalisé cumulé couvrent exactement les mêmes mois.
 *
 * Les lignes du réalisé absentes du plan comparé sont ajoutées en fin de liste,
 * marquées `comparable: false` : leur réalisé est affiché, aucun écart n'est
 * inventé (ADR-0011 friction n°3).
 */
export function computeVariances(
  planLines: PlanLineInput[],
  periods: PeriodInput[],
): VarianceLine[] {
  const monthsCount = periods.length;

  const comparables: VarianceLine[] = referenceLines(planLines).map((line) => {
    const planAnnuel = line.value * 12; // feuille activite = moyenne mensuelle (convention 2).
    const prevuMensuel = planAnnuel / 12;
    const prevuCumule = prevuMensuel * monthsCount;
    const realiseCumule = cumul(periods, line.lineId);
    const ecart = realiseCumule - prevuCumule;
    const sens = inferSens(line.lineId);
    return {
      lineId: line.lineId,
      label: line.label,
      sens,
      comparable: true,
      raison: null,
      prevuMensuel: round2(prevuMensuel),
      prevuCumule: round2(prevuCumule),
      realiseCumule: round2(realiseCumule),
      ecart: round2(ecart),
      ecartPct: prevuCumule !== 0 ? round2((ecart / Math.abs(prevuCumule)) * 100) / 100 : null,
      statut: statutFor(sens, ecart),
    };
  });

  const orphelines: VarianceLine[] = nonComparableIds(planLines, periods).map(
    ({ lineId, label, raison }) => ({
      lineId,
      label,
      sens: inferSens(lineId),
      comparable: false,
      raison,
      prevuMensuel: null,
      prevuCumule: null,
      realiseCumule: round2(cumul(periods, lineId)),
      ecart: null,
      ecartPct: null,
      statut: null,
    }),
  );

  return [...comparables, ...orphelines];
}

/**
 * Projection actualisée simple (docs/08 § Projection, convention MVP) :
 * réalisé des mois CLÔTURÉS + prévisionnel (annuel/12) des mois restants.
 * Les mois ouverts non clôturés comptent comme « restants » — seule la clôture
 * transforme une saisie en observation ferme.
 *
 * Une ligne non comparable ne peut pas être projetée (pas de plan annuel de
 * référence) : seul son réalisé clôturé est renvoyé.
 */
export function computeUpdatedProjection(
  planLines: PlanLineInput[],
  periods: PeriodInput[],
): ProjectionLine[] {
  const closed = periods.filter((p) => p.status === 'closed');
  const remainingMonths = 12 - closed.length;

  const comparables: ProjectionLine[] = referenceLines(planLines).map((line) => {
    const planAnnuel = line.value * 12;
    const prevuMensuel = planAnnuel / 12;
    const realiseClos = cumul(closed, line.lineId);
    const previsionnelRestant = prevuMensuel * remainingMonths;
    const totalProjete = realiseClos + previsionnelRestant;
    return {
      lineId: line.lineId,
      label: line.label,
      sens: inferSens(line.lineId),
      comparable: true,
      raison: null,
      planAnnuel: round2(planAnnuel),
      realiseClos: round2(realiseClos),
      previsionnelRestant: round2(previsionnelRestant),
      totalProjete: round2(totalProjete),
      ecartVsPlan: round2(totalProjete - planAnnuel),
    };
  });

  const orphelines: ProjectionLine[] = nonComparableIds(planLines, periods).map(
    ({ lineId, label, raison }) => ({
      lineId,
      label,
      sens: inferSens(lineId),
      comparable: false,
      raison,
      planAnnuel: null,
      realiseClos: round2(cumul(closed, lineId)),
      previsionnelRestant: null,
      totalProjete: null,
      ecartVsPlan: null,
    }),
  );

  return [...comparables, ...orphelines];
}
