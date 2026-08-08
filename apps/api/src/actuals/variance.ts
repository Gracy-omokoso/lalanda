// Calculs d'écarts prévisionnel vs réalisé (S18b — docs/08 § Écarts).
//
// Module PUR (aucune dépendance Nest/Mongo) pour être testable unitairement :
// le service ne fait que charger plan + périodes puis déléguer ici.
//
// ─── Conventions MVP (documentées docs/08 § Implémenté S18b) ──────────────
// 1. Lignes de référence : les lignes `format: 'money'` de la feuille `activite`
//    du dernier plan validé — c'est le compte d'exploitation, là où vivent le CA
//    et les charges principales que l'utilisateur saisit en réalisé.
// 2. BASE ANNUELLE PAR EXERCICE. La feuille `activite` est le compte d'exploitation
//    de l'exercice 1, exprimé en MOYENNE MENSUELLE. La base annuelle d'une ligne
//    pour l'exercice N est donc résolue dans cet ordre :
//      a. ligne `<lineId>_annuel_<N>` de la feuille `projection` du plan comparé
//         (c'est le chiffre que le plan lui-même publie pour cet exercice) ;
//      b. à défaut, et UNIQUEMENT pour l'exercice 1, `activite.<lineId> × 12`.
//    Si l'exercice N n'est pas publié par le plan comparé (plans 3 ans, exercices
//    4-5 avant FIN-001 ; lignes sans série annuelle), la ligne est « non
//    comparable » avec la raison `EXERCICE_ABSENT_DU_PLAN`. On n'extrapole JAMAIS
//    l'exercice 1 sur l'exercice N : avec un taux de croissance à 20 %, l'écart
//    affiché serait faux de +44 % en année 3.
// 3. Le prévu mensuel reste `base annuelle ÷ 12` (prorata linéaire, sans
//    saisonnalité) — choix MVP assumé, annoncé dans la réponse API.
// 4. Sens d'une ligne (produit vs charge) : heuristique sur le lineId, faute de
//    métadonnée `sens` dans la DSL (hors périmètre S18b — on ne touche pas au
//    moteur). Une charge réalisée SOUS le prévu est favorable ; un produit
//    réalisé SOUS le prévu ne l'est pas (docs/08 § Écarts). Un écart nul est
//    `conforme`, ni favorable ni défavorable.
// 5. ON NE FABRIQUE JAMAIS UN CHIFFRE (doctrine ADR-0011, friction n°3) :
//    - ligne absente du plan comparé      → `comparable: false`
//    - exercice absent du plan comparé    → `comparable: false`
//    - ligne jamais saisie sur la période → `saisi: false`, réalisé et écart `null`
//    Dans aucun de ces cas on ne renvoie 0, ni −100 %, ni un statut.
//    On ne ré-exécute jamais le moteur sur un plan historique (docs/07 § Limite connue).

/** Ligne du plan telle qu'embarquée dans le snapshot `result.lines` (S16c). */
export interface PlanLineInput {
  sheetId: string;
  lineId: string;
  label: string;
  value: number;
  format: 'money' | 'number' | 'percent';
  /** Formule DSL d'origine — sert au contrôle de cohérence des soldes saisis. */
  formulaSource?: string;
}

/** Période réalisée minimale pour le calcul (statut + valeurs saisies). */
export interface PeriodInput {
  month: number;
  status: 'open' | 'closed';
  values: Record<string, number>;
}

export type LineSens = 'produit' | 'charge';
export type VarianceStatut = 'favorable' | 'defavorable' | 'conforme';

/**
 * Pourquoi une ligne n'est pas comparable au plan validé.
 * - `LIGNE_ABSENTE_DU_PLAN` : le snapshot ne contient pas du tout cet identifiant
 *   (plan validé antérieur au template courant — ADR-0011 friction n°3).
 * - `LIGNE_HORS_COMPTE_EXPLOITATION` : l'identifiant existe dans le plan mais hors
 *   de la feuille de référence (`activite`) ou avec un format non monétaire.
 * - `EXERCICE_ABSENT_DU_PLAN` : la ligne existe pour l'exercice 1 mais le plan
 *   comparé ne publie pas de base annuelle pour l'exercice demandé.
 */
export type NonComparableRaison =
  'LIGNE_ABSENTE_DU_PLAN' | 'LIGNE_HORS_COMPTE_EXPLOITATION' | 'EXERCICE_ABSENT_DU_PLAN';

/** D'où vient la base annuelle affichée (docs/08 : « la méthode utilisée est affichée »). */
export type BaseSource = 'projection' | 'activite_x12';

/** Anomalie détectée sur la saisie, sans jamais la corriger d'office. */
export interface VarianceDiagnostic {
  code: 'INCOHERENCE_SOLDE';
  message: string;
  /** Mois d'exercice concernés. */
  months: number[];
}

export interface VarianceLine {
  lineId: string;
  label: string;
  sens: LineSens;
  /** false → le plan comparé n'offre aucune base : tous les champs prévus sont `null`. */
  comparable: boolean;
  /** Renseignée si et seulement si `comparable === false`. */
  raison: NonComparableRaison | null;
  /** false → la ligne n'a été saisie sur aucun mois : réalisé et écart sont `null`. */
  saisi: boolean;
  /** Origine de la base annuelle — `null` si non comparable. */
  base: BaseSource | null;
  /** Prévu mensuel = base annuelle de l'exercice ÷ 12. */
  prevuMensuel: number | null;
  /** Prévu cumulé sur les mois saisis = prévu mensuel × nb mois saisis. */
  prevuCumule: number | null;
  /** Réalisé cumulé sur les mois saisis. `null` si la ligne n'a jamais été saisie. */
  realiseCumule: number | null;
  ecart: number | null;
  /** Écart relatif (fraction, ex. 0.12 = +12 %) — null si la base prévue est nulle. */
  ecartPct: number | null;
  statut: VarianceStatut | null;
  diagnostics: VarianceDiagnostic[];
}

export interface ProjectionLine {
  lineId: string;
  label: string;
  sens: LineSens;
  comparable: boolean;
  raison: NonComparableRaison | null;
  base: BaseSource | null;
  planAnnuel: number | null;
  /** Réalisé cumulé des mois CLÔTURÉS uniquement (observation ferme). */
  realiseClos: number | null;
  /** Prévisionnel des mois restants = prévu mensuel × (12 − nb mois clôturés). */
  previsionnelRestant: number | null;
  /** Total exercice recalculé = réalisé clôturé + prévisionnel restant. */
  totalProjete: number | null;
  /** Écart du total projeté vs la base annuelle de l'exercice. */
  ecartVsPlan: number | null;
}

/** Feuille de référence du réalisé — le compte d'exploitation (exercice 1, mensuel). */
const REFERENCE_SHEET = 'activite';
/** Feuille des séries annuelles publiées par le plan (`<racine>_annuel_N`). */
const PROJECTION_SHEET = 'projection';

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
 * d'exploitation (`activite`) du plan, dans l'ordre du template. Ce sont les
 * lignes que l'utilisateur saisit, quel que soit l'exercice suivi.
 */
export function referenceLines(planLines: PlanLineInput[]): PlanLineInput[] {
  return planLines.filter((l) => l.sheetId === REFERENCE_SHEET && l.format === 'money');
}

/**
 * Base annuelle d'une ligne pour l'exercice demandé, ou `null` si le plan comparé
 * ne la publie pas (convention 2 du bandeau de tête).
 */
export function resolveAnnualBase(
  planLines: PlanLineInput[],
  lineId: string,
  year: number,
): { planAnnuel: number; source: BaseSource } | null {
  const serie = planLines.find(
    (l) =>
      l.lineId === `${lineId}_annuel_${year}` &&
      l.sheetId === PROJECTION_SHEET &&
      l.format === 'money',
  );
  if (serie) return { planAnnuel: serie.value, source: 'projection' };

  // Repli exercice 1 uniquement : la feuille `activite` EST l'exercice 1.
  if (year === 1) {
    const mensuel = planLines.find(
      (l) => l.lineId === lineId && l.sheetId === REFERENCE_SHEET && l.format === 'money',
    );
    if (mensuel) return { planAnnuel: mensuel.value * 12, source: 'activite_x12' };
  }
  return null;
}

function statutFor(sens: LineSens, ecart: number): VarianceStatut {
  if (ecart === 0) return 'conforme';
  if (sens === 'charge') return ecart < 0 ? 'favorable' : 'defavorable';
  return ecart > 0 ? 'favorable' : 'defavorable';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Périodes où la ligne a effectivement été saisie (clé présente, pas un 0 implicite). */
function periodsWithLine(periods: PeriodInput[], lineId: string): PeriodInput[] {
  return periods.filter((p) => p.values[lineId] !== undefined);
}

/** Cumul d'une ligne sur les périodes où elle est saisie. */
function cumul(periods: PeriodInput[], lineId: string): number {
  return periods.reduce((sum, p) => sum + (p.values[lineId] ?? 0), 0);
}

// ─── Contrôle de cohérence des soldes saisis (I2) ──────────────
//
// Les soldes du compte d'exploitation (`marge_matiere`, `excedent_brut`,
// `resultat_net`…) sont CALCULÉS par le moteur mais SAISIS à la main dans le
// réalisé : rien n'empêche l'utilisateur d'entrer un EBE qui ne découle pas de
// ses propres lignes. On ne recalcule pas sa saisie à sa place — on la signale.
//
// Le contrôle est volontairement restreint aux formules qui sont une pure
// combinaison ± d'autres lignes de référence (`marge_matiere - charges_operationnelles`).
// Les formules avec produit, division ou fonction (`IF`, `IFERROR`, `ca * taux`)
// sortent du contrôle : les réimplémenter ici créerait une seconde source de
// vérité de calcul, ce que la charte interdit (le moteur est l'unique source).

interface SoldeComposant {
  lineId: string;
  signe: 1 | -1;
}

/** Tolérance d'arrondi : 1 centime, ou 0,5 % pour les gros montants. */
function tolerance(expected: number): number {
  return Math.max(0.01, Math.abs(expected) * 0.005);
}

/**
 * Décompose `a - b + c` en composants signés, si et seulement si la formule est
 * une pure combinaison ± d'AUTRES lignes de référence. `null` sinon.
 */
export function parseSoldeFormula(
  formula: string | undefined,
  selfId: string,
  refIds: Set<string>,
): SoldeComposant[] | null {
  if (!formula) return null;
  const compact = formula.replace(/\s+/g, '');
  if (!/^[a-z][a-z0-9_]*([+-][a-z][a-z0-9_]*)+$/.test(compact)) return null;

  const composants: SoldeComposant[] = [];
  const tokens = compact.match(/[+-]?[a-z][a-z0-9_]*/g) ?? [];
  for (const token of tokens) {
    const signe: 1 | -1 = token.startsWith('-') ? -1 : 1;
    const lineId = token.replace(/^[+-]/, '');
    // Un identifiant hors des lignes de référence (driver, autre feuille) ou une
    // auto-référence rend le contrôle impossible : on renonce plutôt que d'approximer.
    if (lineId === selfId || !refIds.has(lineId)) return null;
    composants.push({ lineId, signe });
  }
  return composants.length >= 2 ? composants : null;
}

/**
 * Mois où le solde saisi ne correspond pas à la combinaison de ses composants,
 * eux aussi saisis. Un mois où un composant manque n'est pas contrôlable — il
 * n'est pas signalé (on ne suppose pas qu'un composant absent vaut 0).
 */
function soldeDiagnostics(
  line: PlanLineInput,
  refIds: Set<string>,
  periods: PeriodInput[],
): VarianceDiagnostic[] {
  const composants = parseSoldeFormula(line.formulaSource, line.lineId, refIds);
  if (!composants) return [];

  const months: number[] = [];
  for (const p of periods) {
    const saisi = p.values[line.lineId];
    if (saisi === undefined) continue;
    if (composants.some((c) => p.values[c.lineId] === undefined)) continue;
    const attendu = composants.reduce((sum, c) => sum + c.signe * (p.values[c.lineId] ?? 0), 0);
    if (Math.abs(saisi - attendu) > tolerance(attendu)) months.push(p.month);
  }
  if (months.length === 0) return [];

  const formule = composants
    .map((c, i) => (i === 0 ? c.lineId : `${c.signe === -1 ? '− ' : '+ '}${c.lineId}`))
    .join(' ');
  return [
    {
      code: 'INCOHERENCE_SOLDE',
      message: `Le solde saisi ne correspond pas à « ${formule} » sur ${months.length} mois. Vérifiez la saisie : ce solde n'est pas recalculé automatiquement.`,
      months,
    },
  ];
}

// ─── Lignes hors du plan comparé ───────────────────────────────

/**
 * Lignes saisies au réalisé qui n'ont PAS de contrepartie comparable dans le plan
 * validé — ADR-0011 friction n°3. Retournées dans un ordre déterministe (tri par
 * identifiant) pour que deux appels successifs donnent le même résultat
 * (docs/08 § Critères d'acceptation : « les écarts sont reproductibles »).
 */
function orphanLines(
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

// ─── Écarts ────────────────────────────────────────────────────

/**
 * Écarts cumulés réalisé vs plan sur les mois SAISIS de l'exercice `year`
 * — comparaison à périmètre identique : pour une ligne donnée, prévu cumulé et
 * réalisé cumulé couvrent exactement les mêmes mois.
 */
export function computeVariances(
  planLines: PlanLineInput[],
  periods: PeriodInput[],
  year: number,
): VarianceLine[] {
  const refs = referenceLines(planLines);
  const refIds = new Set(refs.map((l) => l.lineId));

  const comparables: VarianceLine[] = refs.map((line) => {
    const sens = inferSens(line.lineId);
    const diagnostics = soldeDiagnostics(line, refIds, periods);
    const base = resolveAnnualBase(planLines, line.lineId, year);

    // Le plan comparé ne publie rien pour cet exercice : on ne l'invente pas.
    if (!base) {
      const saisiePeriods = periodsWithLine(periods, line.lineId);
      return {
        lineId: line.lineId,
        label: line.label,
        sens,
        comparable: false,
        raison: 'EXERCICE_ABSENT_DU_PLAN',
        saisi: saisiePeriods.length > 0,
        base: null,
        prevuMensuel: null,
        prevuCumule: null,
        realiseCumule: saisiePeriods.length > 0 ? round2(cumul(saisiePeriods, line.lineId)) : null,
        ecart: null,
        ecartPct: null,
        statut: null,
        diagnostics,
      };
    }

    const prevuMensuel = base.planAnnuel / 12;
    const saisiePeriods = periodsWithLine(periods, line.lineId);

    // Ligne jamais saisie : aucun réalisé observé. Renvoyer 0 fabriquerait un
    // écart de −100 % défavorable sur une ligne que l'utilisateur n'a pas encore
    // remplie — exactement ce que la doctrine ADR-0011 interdit.
    if (saisiePeriods.length === 0) {
      return {
        lineId: line.lineId,
        label: line.label,
        sens,
        comparable: true,
        raison: null,
        saisi: false,
        base: base.source,
        prevuMensuel: round2(prevuMensuel),
        prevuCumule: null,
        realiseCumule: null,
        ecart: null,
        ecartPct: null,
        statut: null,
        diagnostics,
      };
    }

    const prevuCumule = prevuMensuel * saisiePeriods.length;
    const realiseCumule = cumul(saisiePeriods, line.lineId);
    const ecart = realiseCumule - prevuCumule;
    return {
      lineId: line.lineId,
      label: line.label,
      sens,
      comparable: true,
      raison: null,
      saisi: true,
      base: base.source,
      prevuMensuel: round2(prevuMensuel),
      prevuCumule: round2(prevuCumule),
      realiseCumule: round2(realiseCumule),
      ecart: round2(ecart),
      ecartPct: prevuCumule !== 0 ? round2((ecart / Math.abs(prevuCumule)) * 100) / 100 : null,
      statut: statutFor(sens, round2(ecart)),
      diagnostics,
    };
  });

  const orphelines: VarianceLine[] = orphanLines(planLines, periods).map(
    ({ lineId, label, raison }) => ({
      lineId,
      label,
      sens: inferSens(lineId),
      comparable: false,
      raison,
      saisi: true, // une orpheline n'existe que parce qu'elle a été saisie
      base: null,
      prevuMensuel: null,
      prevuCumule: null,
      realiseCumule: round2(cumul(periodsWithLine(periods, lineId), lineId)),
      ecart: null,
      ecartPct: null,
      statut: null,
      diagnostics: [],
    }),
  );

  return [...comparables, ...orphelines];
}

// ─── Projection actualisée ─────────────────────────────────────

/**
 * Projection actualisée simple (docs/08 § Projection, convention MVP) :
 * réalisé des mois CLÔTURÉS + prévisionnel (base annuelle ÷ 12) des mois restants.
 * Les mois ouverts non clôturés comptent comme « restants » — seule la clôture
 * transforme une saisie en observation ferme.
 *
 * Deux cas où le réalisé clôturé vaut `null` plutôt que 0 :
 * - la ligne n'est comparable pour aucun exercice (pas de base) ;
 * - des mois SONT clôturés mais la ligne n'y figure pas — la donnée manque, elle
 *   ne vaut pas zéro. Sans aucun mois clôturé, en revanche, `realiseClos` vaut
 *   bien 0 : la somme sur zéro mois observé est exacte, et la projection est
 *   alors égale au plan (100 % d'estimation, signalé par `monthsClosed: []`).
 */
export function computeUpdatedProjection(
  planLines: PlanLineInput[],
  periods: PeriodInput[],
  year: number,
): ProjectionLine[] {
  const closed = periods.filter((p) => p.status === 'closed');
  const remainingMonths = 12 - closed.length;

  const comparables: ProjectionLine[] = referenceLines(planLines).map((line) => {
    const sens = inferSens(line.lineId);
    const base = resolveAnnualBase(planLines, line.lineId, year);
    if (!base) {
      return {
        lineId: line.lineId,
        label: line.label,
        sens,
        comparable: false,
        raison: 'EXERCICE_ABSENT_DU_PLAN' as const,
        base: null,
        planAnnuel: null,
        realiseClos: null,
        previsionnelRestant: null,
        totalProjete: null,
        ecartVsPlan: null,
      };
    }

    const prevuMensuel = base.planAnnuel / 12;
    const previsionnelRestant = prevuMensuel * remainingMonths;
    const closedWithLine = periodsWithLine(closed, line.lineId);
    const observationManquante = closed.length > 0 && closedWithLine.length === 0;
    const realiseClos = observationManquante ? null : cumul(closedWithLine, line.lineId);
    const totalProjete = realiseClos === null ? null : realiseClos + previsionnelRestant;

    return {
      lineId: line.lineId,
      label: line.label,
      sens,
      comparable: true,
      raison: null,
      base: base.source,
      planAnnuel: round2(base.planAnnuel),
      realiseClos: realiseClos === null ? null : round2(realiseClos),
      previsionnelRestant: round2(previsionnelRestant),
      totalProjete: totalProjete === null ? null : round2(totalProjete),
      ecartVsPlan: totalProjete === null ? null : round2(totalProjete - base.planAnnuel),
    };
  });

  const orphelines: ProjectionLine[] = orphanLines(planLines, periods).map(
    ({ lineId, label, raison }) => ({
      lineId,
      label,
      sens: inferSens(lineId),
      comparable: false,
      raison,
      base: null,
      planAnnuel: null,
      realiseClos: round2(cumul(periodsWithLine(closed, lineId), lineId)),
      previsionnelRestant: null,
      totalProjete: null,
      ecartVsPlan: null,
    }),
  );

  return [...comparables, ...orphelines];
}
