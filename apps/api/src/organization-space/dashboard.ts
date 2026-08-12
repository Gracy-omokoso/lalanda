// Agrégations du tableau de bord d'organisation (S21a) — fonctions PURES.
//
// ── La règle qui gouverne tout ce fichier ────────────────────────────────────
//
// CLAUDE.md : « Le moteur financier est l'unique source de vérité des calculs. »
// Aucune fonction ici ne produit un chiffre financier. Elles LISENT des chiffres
// déjà produits : les feux tricolores figés dans le snapshot d'un plan validé
// (S16c), les écarts calculés par `actuals/variance.ts` (S18b), les limites du
// catalogue d'entitlements (S16b). Elles comptent, trient, tronquent — jamais
// elles n'additionnent, ne divisent ni ne comparent un montant à un seuil de leur
// propre initiative.
//
// Elles sont pures pour être testables sans MongoDB : le service qui les appelle
// se contente de charger des documents et de les leur passer.

import {
  ORG_ROLE_LABELS,
  can,
  type Action,
  type OrgPermissionContext,
  type OrgRole,
} from '../authz/permissions.js';
import type { VarianceLine } from '../actuals/variance.js';
import type { Entitlements, Plan } from '../billing/entitlements.js';
import type {
  AnomalieView,
  BlocMasqueView,
  ConsommationView,
  DepassementView,
  EcartProjetView,
  PlanEnAttenteView,
  RatioRougeView,
} from './organization-space.dto.js';

/** Vue minimale d'un plan validé — juste ce dont les agrégations ont besoin. */
export interface PlanSnapshotInput {
  projectId: string;
  version: number;
  approvedAt: Date;
  driverValues: Record<string, number>;
  soleApprover: boolean;
  lines: Array<{
    lineId: string;
    label: string;
    value: number;
    seuil?: { valeur: number; direction: 'min' | 'max'; statut: 'vert' | 'orange' | 'rouge' };
  }>;
}

export interface ProjetInput {
  id: string;
  name: string;
  driverValues: Record<string, number>;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ratios au rouge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lignes dont le feu est AU ROUGE dans le snapshot d'un plan validé.
 *
 * Le statut `rouge` a été décidé par le moteur au moment de la validation, en
 * comparant la valeur au `seuil_pack` du Country Pack alors chargé (S10). On ne
 * refait pas cette comparaison : un seuil qui changerait dans un pack plus récent
 * ne doit PAS repeindre a posteriori un plan déjà parti chez un banquier.
 */
export function ratiosRougesDuPlan(plan: PlanSnapshotInput, projectName: string): RatioRougeView[] {
  return plan.lines
    .filter((l) => l.seuil?.statut === 'rouge')
    .map((l) => ({
      projectId: plan.projectId,
      projectName,
      planVersion: plan.version,
      lineId: l.lineId,
      label: l.label,
      valeur: l.value,
      seuilValeur: l.seuil!.valeur,
      seuilDirection: l.seuil!.direction,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Plans en attente de validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les hypothèses SAISIES du projet diffèrent-elles de celles figées dans le plan ?
 *
 * Comparaison de deux dictionnaires, pas d'un calcul. On ne compare que les
 * drivers présents sur le PROJET — ce sont les surcharges de l'utilisateur; le
 * snapshot, lui, porte des drivers RÉSOLUS (utilisateur > pack > défaut du
 * template) et contient donc en plus des valeurs que l'utilisateur n'a jamais
 * touchées.
 *
 * Limite assumée et documentée : un changement de version de template ou de
 * Country Pack modifierait le plan sans modifier aucune surcharge, et ne serait
 * pas détecté ici. Détecter ce cas exigerait de ré-exécuter le moteur — ce que ce
 * fichier s'interdit. Le tableau de bord signale donc « en attente » sans jamais
 * prétendre à l'exhaustivité, et n'empêche rien : il oriente.
 */
export function hypothesesModifiees(
  projectDrivers: Record<string, number>,
  planDrivers: Record<string, number>,
): boolean {
  for (const [id, valeur] of Object.entries(projectDrivers)) {
    if (planDrivers[id] !== valeur) return true;
  }
  return false;
}

/**
 * État de validation d'un projet, ou `null` si son dernier plan validé est à jour.
 */
export function planEnAttente(
  projet: ProjetInput,
  dernierPlan: PlanSnapshotInput | undefined,
): PlanEnAttenteView | null {
  if (!dernierPlan) {
    return {
      projectId: projet.id,
      projectName: projet.name,
      derniereVersion: null,
      raison: 'AUCUN_PLAN',
      modifieLe: projet.updatedAt.toISOString(),
    };
  }
  if (!hypothesesModifiees(projet.driverValues, dernierPlan.driverValues)) return null;
  return {
    projectId: projet.id,
    projectName: projet.name,
    derniereVersion: dernierPlan.version,
    raison: 'HYPOTHESES_MODIFIEES',
    modifieLe: projet.updatedAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Écarts du réalisé
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Résumé des écarts d'un projet, à partir des lignes produites par
 * `computeVariances` (S18b). Aucun écart n'est calculé ici : on compte les lignes
 * déjà marquées `defavorable` et on retient la pire par `ecartPct`, un nombre lui
 * aussi fourni par le calcul d'origine.
 */
export function resumeEcarts(
  projet: { id: string; name: string },
  year: number,
  planVersion: number,
  lignes: readonly VarianceLine[],
): EcartProjetView | null {
  const defavorables = lignes.filter((l) => l.statut === 'defavorable');
  if (defavorables.length === 0) return null;

  // `ecartPct` peut être `null` (base prévue nulle) : ces lignes comptent dans le
  // total mais ne peuvent pas prétendre au titre de « pire écart ».
  const chiffrees = defavorables.filter(
    (l): l is VarianceLine & { ecartPct: number } => typeof l.ecartPct === 'number',
  );
  const pire = chiffrees.reduce<(VarianceLine & { ecartPct: number }) | null>(
    (max, l) => (max === null || Math.abs(l.ecartPct) > Math.abs(max.ecartPct) ? l : max),
    null,
  );

  return {
    projectId: projet.id,
    projectName: projet.name,
    year,
    planVersion,
    lignesDefavorables: defavorables.length,
    pireEcart: pire ? { lineId: pire.lineId, label: pire.label, ecartPct: pire.ecartPct } : null,
  };
}

/**
 * Anomalies de saisie signalées par le calcul d'écarts — jamais corrigées d'office
 * (docs/08). Un solde saisi qui ne correspond pas à ses composantes est remonté
 * au Comptable, à lui de trancher.
 */
export function anomaliesDesEcarts(
  projet: { id: string; name: string },
  year: number,
  lignes: readonly VarianceLine[],
): AnomalieView[] {
  return lignes.flatMap((l) =>
    l.diagnostics.map((d) => ({
      projectId: projet.id,
      projectName: projet.name,
      year,
      lineId: l.lineId,
      label: l.label,
      code: d.code,
      message: d.message,
      months: d.months,
    })),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Périodes du Comptable
// ─────────────────────────────────────────────────────────────────────────────

/** Période réalisée, réduite à ce qui décide de son état d'avancement. */
export interface PeriodeInput {
  month: number;
  status: 'open' | 'closed';
  values: Record<string, number>;
}

/** Nombre de mois d'un exercice — le réalisé est mensuel (docs/08). */
export const MOIS_PAR_EXERCICE = 12;

/**
 * Premier mois de l'exercice restant à saisir, ou `null` si tout est saisi.
 *
 * Un mois est « à saisir » s'il n'a pas de document, ou s'il en a un qui est
 * ouvert et vide. Les périodes sont créées à la première saisie : l'absence de
 * document est donc l'état nominal d'un mois jamais touché, pas une anomalie.
 *
 * On ne renvoie qu'UN mois par projet, le plus ancien. Lister les douze mois
 * ouverts d'un projet neuf noierait le seul qui appelle une action.
 */
export function prochainMoisASaisir(periodes: readonly PeriodeInput[]): number | null {
  const parMois = new Map(periodes.map((p) => [p.month, p]));
  for (let mois = 1; mois <= MOIS_PAR_EXERCICE; mois++) {
    const p = parMois.get(mois);
    if (!p) return mois;
    if (p.status === 'open' && Object.keys(p.values).length === 0) return mois;
  }
  return null;
}

/**
 * Mois saisis mais encore ouverts — ceux qu'une clôture attend.
 * Un mois vide n'est pas « à clôturer » : il est à saisir.
 */
export function moisACloturer(periodes: readonly PeriodeInput[]): number[] {
  return periodes
    .filter((p) => p.status === 'open' && Object.keys(p.values).length > 0)
    .map((p) => p.month)
    .sort((a, b) => a - b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Consommation et limites du plan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Consommation face aux limites. `limite: null` = illimité (docs/13 : « les
 * nombres exacts sont des paramètres de catalogue, pas du code »).
 *
 * `seats` vaut `null` sur l'offre Expert, dont les sièges sont négociés au
 * contrat : cela se lit « illimité / non plafonné ici », surtout pas 0, qui
 * afficherait « 3 membres sur 0 autorisés ». Les autres offres portent toutes un
 * nombre depuis la grille à cinq paliers.
 */
export function consommation(
  plan: Plan,
  entitlements: Entitlements,
  usage: { projets: number; membres: number },
): ConsommationView {
  return {
    plan,
    projets: { utilise: usage.projets, limite: entitlements.maxProjects },
    sieges: { utilise: usage.membres, limite: entitlements.seats ?? null },
  };
}

/**
 * Ressources déjà au-dessus de la limite du plan.
 *
 * Cas réel : une organisation rétrogradée de `pro` vers `free` garde ses projets
 * — docs/13 § Changements de plan, « aucune suppression automatique de projet ».
 * L'interface doit donc pouvoir le dire sans que rien ne soit détruit.
 */
export function depassements(c: ConsommationView): DepassementView[] {
  const out: DepassementView[] = [];
  if (c.projets.limite !== null && c.projets.utilise > c.projets.limite) {
    out.push({
      code: 'PROJETS',
      libelle: 'Projets',
      utilise: c.projets.utilise,
      limite: c.projets.limite,
    });
  }
  if (c.sieges.limite !== null && c.sieges.utilise > c.sieges.limite) {
    out.push({
      code: 'SIEGES',
      libelle: 'Sièges',
      utilise: c.sieges.utilise,
      limite: c.sieges.limite,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocs visibles / masqués
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Action qui ouvre chaque bloc du tableau de bord.
 *
 * Table DÉCLARATIVE, unique endroit où le lien bloc → action est écrit. Le
 * service la lit pour décider quoi charger, et `blocsMasques` la lit pour dire ce
 * qui manque : les deux ne peuvent pas diverger. Aucun `if (role === …)` — la
 * décision reste `can()` (ADR-0012 §8).
 */
export const BLOCS_DU_TABLEAU_DE_BORD = [
  {
    section: 'gouvernance',
    titre: 'Pilotage de l’organisation',
    action: 'organization.manage',
    raison:
      'Le suivi des projets, des validations du mois et de la consommation du plan est réservé ' +
      'au Propriétaire et à l’Administrateur.',
  },
  {
    section: 'validation',
    titre: 'Validation financière',
    action: 'plan.approve',
    raison:
      'Les ratios au rouge, les plans en attente et les écarts du réalisé sont réservés aux rôles ' +
      'qui valident les plans : Propriétaire et Directeur financier.',
  },
  {
    section: 'comptabilite',
    titre: 'Saisie du réalisé',
    action: 'actuals.import',
    raison:
      'Les périodes à saisir et à clôturer sont réservées aux rôles qui constatent le réalisé : ' +
      'Comptable, Directeur financier, Administrateur et Propriétaire.',
  },
  {
    section: 'projets',
    titre: 'Projets',
    action: 'project.read',
    raison: 'La consultation des projets exige au minimum le rôle de Lecteur.',
  },
] as const satisfies ReadonlyArray<{
  section: BlocMasqueView['section'];
  titre: string;
  action: Action;
  raison: string;
}>;

/** Ce bloc est-il ouvert au rôle de l'appelant ? */
export function blocVisible(
  section: BlocMasqueView['section'],
  role: OrgRole,
  ctx: OrgPermissionContext,
): boolean {
  const bloc = BLOCS_DU_TABLEAU_DE_BORD.find((b) => b.section === section);
  if (!bloc) return false;
  return can(role, bloc.action, ctx);
}

/**
 * Blocs que le rôle ne permet pas de voir, avec la raison en français.
 *
 * Ne contient AUCUNE donnée : ni compteur, ni nom de projet, ni montant. C'est ce
 * qui permet de l'envoyer à un Lecteur sans rien lui divulguer — un test e2e le
 * vérifie sur la réponse complète.
 */
export function blocsMasques(role: OrgRole, ctx: OrgPermissionContext): BlocMasqueView[] {
  return BLOCS_DU_TABLEAU_DE_BORD.filter((b) => !can(role, b.action, ctx)).map((b) => ({
    section: b.section,
    titre: b.titre,
    action: b.action,
    raison: b.raison,
  }));
}

/**
 * Les onze actions de la matrice qui MODIFIENT quelque chose.
 *
 * Les quatre autres (`project.read`, `analytics.read`, `report.export`,
 * `audit.read`) sont des lectures. `report.export` produit bien un fichier, mais
 * il ne change rien dans l'organisation — le compter comme une écriture ferait
 * passer un Analyste pour un rôle d'écriture au seul motif qu'il exporte.
 */
export const ACTIONS_ECRITURE: readonly Action[] = [
  'organization.manage',
  'billing.manage',
  'members.invite',
  'project.create',
  'project.update',
  'canvas.update',
  'inputs.update',
  'plan.calculate',
  'plan.approve',
  'actuals.import',
  'period.close',
];

/**
 * Le rôle n'ouvre-t-il AUCUNE écriture, nulle part ?
 *
 * Vrai pour le Conseiller et le Lecteur seuls : l'interface ne leur propose alors
 * aucune action, plutôt que des boutons qui répondraient 403 (docs/12).
 *
 * Un Analyste n'est PAS en lecture seule, même si l'espace organisation ne lui
 * ouvre aucun bloc d'action : il saisit et calcule dans l'espace projet. Le lui
 * annoncer « lecture seule » ici serait faux et décourageant. Déduit de la
 * matrice, jamais d'une liste de rôles écrite en dur.
 */
export function estLectureSeule(role: OrgRole, ctx: OrgPermissionContext): boolean {
  return !ACTIONS_ECRITURE.some((a) => can(role, a, ctx));
}

/** Libellé français du rôle — repris de la matrice, jamais retraduit ici. */
export function libelleRole(role: OrgRole): string {
  return ORG_ROLE_LABELS[role];
}
