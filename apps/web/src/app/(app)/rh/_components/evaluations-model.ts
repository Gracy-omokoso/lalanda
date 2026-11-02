// Objectifs et évaluations — ADR-0051 § 2.5, § 2.6, § 3.5, § 4 et § 10 (lot H16). Logique pure.
//
// Les données parmi les plus sensibles du dossier. Règles rendues ici :
// - l'écran des évaluations s'ouvre avec `performance.read` effectif, ou pour la
//   personne concernée (l'évalué, l'évaluateur) ; à personne d'autre ;
// - le contenu ne vient QUE de `POST /hr/reviews/:id/reveal` (journalisé), section par
//   section, selon les mêmes règles de lecture que l'API ; il s'efface au changement
//   d'onglet ;
// - aucune note n'est produite : une note est CHOISIE par l'évaluateur, une appréciation
//   générale aussi, jamais calculée (pas de moyenne) ;
// - séparation visible : on n'approuve pas son propre objectif ; l'évalué et
//   l'évaluateur ne clôturent pas l'évaluation.

import {
  HR_REVIEW_ACKNOWLEDGEMENT_NOTICE,
  HR_REVIEW_NO_AUTOMATIC_EFFECT_NOTICE,
  type GoalFinalStatus,
  type GoalStatus,
  type ReviewSection,
  type ReviewStatus,
} from '@lalanda/shared/hr';

import type { OrgAction } from '@/lib/api';
import type { GoalView, ReviewListItemView, ReviewStep } from '@/lib/api-rh-2';

import type { Moi } from './frais-model';

type Actions = readonly OrgAction[] | null;
const a = (x: Actions, action: OrgAction): boolean => x !== null && x.includes(action);

export const MENTION_AUCUNE_NOTE = HR_REVIEW_NO_AUTOMATIC_EFFECT_NOTICE;
export const MENTION_PRISE_DE_CONNAISSANCE = HR_REVIEW_ACKNOWLEDGEMENT_NOTICE;

export const peutLirePerformance = (x: Actions): boolean => a(x, 'performance.read');
/** Campagnes, clôture, changement d'évaluateur : `performance.read` ET `hr.manage`. */
export const peutGererCampagnes = (x: Actions): boolean =>
  a(x, 'performance.read') && a(x, 'hr.manage');

/**
 * Accès à l'écran des évaluations : `performance` (lecture de tout le personnel),
 * `personne` (je suis évalué ou évaluateur d'au moins une évaluation), `aucun`.
 */
export function accesEvaluations(
  x: Actions,
  mesEvaluations: readonly ReviewListItemView[],
): 'performance' | 'personne' | 'aucun' {
  if (peutLirePerformance(x)) return 'performance';
  return mesEvaluations.length > 0 ? 'personne' : 'aucun';
}

// ── Libellés ────────────────────────────────────────────────────────────────

export const LIBELLES_STATUT_EVALUATION: Record<ReviewStatus, string> = {
  not_started: 'À commencer',
  self_submitted: 'Auto-évaluation remise',
  manager_submitted: 'Appréciation rédigée',
  shared: 'Partagée, à lire par le collaborateur',
  acknowledged: 'Prise de connaissance signée',
  closed: 'Clôturée',
  cancelled: 'Annulée',
};

export const LIBELLES_STATUT_OBJECTIF: Record<GoalStatus, string> = {
  proposed: 'Proposé',
  agreed: 'Validé',
  achieved: 'Atteint',
  partially_achieved: 'Partiellement atteint',
  not_achieved: 'Non atteint',
  dropped: 'Abandonné',
};

export const STATUTS_FINAUX_OBJECTIF: readonly GoalFinalStatus[] = [
  'achieved',
  'partially_achieved',
  'not_achieved',
  'dropped',
];

export const LIBELLES_SECTION: Record<ReviewSection, string> = {
  selfAssessment: 'Auto-évaluation',
  managerAssessment: 'Appréciation de l’évaluateur',
  employeeComment: 'Commentaire du collaborateur',
  hrNote: 'Note des ressources humaines',
};

// ── Rôles et règles (miroir des règles de l'API, qui reste juge) ────────────

export interface Roles {
  self: boolean;
  reviewer: boolean;
  /** Manager de la chaîne, ni évalué ni évaluateur. */
  chain: boolean;
  perf: boolean;
}

export function rolesSur(
  r: Pick<ReviewListItemView, 'employeeId' | 'reviewerUserId'>,
  moi: Moi,
  x: Actions,
): Roles {
  const self = moi.employeeId !== null && r.employeeId === moi.employeeId;
  const reviewer = moi.userId !== null && r.reviewerUserId === moi.userId;
  const perf = peutLirePerformance(x);
  return { self, reviewer, chain: !self && !reviewer && !perf, perf };
}

const APRES_AUTO: readonly ReviewStatus[] = [
  'self_submitted',
  'manager_submitted',
  'shared',
  'acknowledged',
  'closed',
];
const APRES_REDACTION: readonly ReviewStatus[] = [
  'manager_submitted',
  'shared',
  'acknowledged',
  'closed',
];
const APRES_PARTAGE: readonly ReviewStatus[] = ['shared', 'acknowledged', 'closed'];
const APRES_SIGNATURE: readonly ReviewStatus[] = ['acknowledged', 'closed'];

/** Sections que l'appelant peut afficher maintenant (règle de lecture de l'API). */
export function sectionsLisibles(roles: Roles, statut: ReviewStatus): ReviewSection[] {
  const out: ReviewSection[] = [];
  const lit = (s: ReviewSection): void => {
    if (!out.includes(s)) out.push(s);
  };
  if (roles.perf) {
    lit('selfAssessment');
    lit('managerAssessment');
    lit('employeeComment');
    lit('hrNote');
    return out;
  }
  if (roles.self || ((roles.reviewer || roles.chain) && APRES_AUTO.includes(statut))) {
    lit('selfAssessment');
  }
  if (
    roles.reviewer ||
    (roles.chain && APRES_REDACTION.includes(statut)) ||
    (roles.self && APRES_PARTAGE.includes(statut))
  ) {
    lit('managerAssessment');
  }
  if (roles.self || ((roles.reviewer || roles.chain) && APRES_SIGNATURE.includes(statut))) {
    lit('employeeComment');
  }
  return out;
}

/** Section que l'appelant peut rédiger maintenant, ou `null` (règle d'écriture de l'API). */
export function sectionsEditables(
  roles: Roles,
  statut: ReviewStatus,
  /** `null` : inconnu de l'appelant (campagne non lisible) ; l'API tranche. */
  avecAutoEvaluation: boolean | null,
): ReviewSection[] {
  const out: ReviewSection[] = [];
  if (roles.self && avecAutoEvaluation !== false && statut === 'not_started') {
    out.push('selfAssessment');
  }
  if (roles.reviewer && (statut === 'not_started' || statut === 'self_submitted')) {
    out.push('managerAssessment');
  }
  if (roles.self && statut === 'shared') out.push('employeeComment');
  if (
    roles.perf &&
    ['not_started', 'self_submitted', 'manager_submitted', 'shared', 'acknowledged'].includes(
      statut,
    )
  ) {
    out.push('hrNote');
  }
  return out;
}

export interface Etape {
  etape: ReviewStep;
  libelle: string;
}

export const PHRASE_CLOTURE_INTERDITE =
  'Vous êtes l’évalué ou l’évaluateur : la clôture revient à une autre personne des ressources humaines.';

/**
 * Étapes offertes et phrase de séparation. La clôture exige `performance.read` et
 * `hr.manage`, et n'est jamais offerte à l'évalué ni à l'évaluateur (§ 3.5).
 */
export function etapesOffertes(
  r: Pick<ReviewListItemView, 'status'>,
  roles: Roles,
  x: Actions,
  /** `null` : inconnu de l'appelant ; les deux étapes sont offertes, l'API tranche. */
  avecAutoEvaluation: boolean | null,
): { etapes: Etape[]; phrase: string | null } {
  const etapes: Etape[] = [];
  let phrase: string | null = null;
  if (roles.self && avecAutoEvaluation !== false && r.status === 'not_started') {
    etapes.push({ etape: 'submit-self', libelle: 'Remettre mon auto-évaluation' });
  }
  const attenteAuto = avecAutoEvaluation === true && r.status === 'not_started';
  if (roles.reviewer && !attenteAuto && ['not_started', 'self_submitted'].includes(r.status)) {
    etapes.push({ etape: 'submit-manager', libelle: 'Terminer mon appréciation' });
  }
  if (roles.reviewer && r.status === 'manager_submitted') {
    etapes.push({ etape: 'share', libelle: 'Partager avec le collaborateur' });
  }
  if (roles.self && r.status === 'shared') {
    etapes.push({ etape: 'acknowledge', libelle: 'Signer la prise de connaissance' });
  }
  if (peutGererCampagnes(x) && (r.status === 'shared' || r.status === 'acknowledged')) {
    if (roles.self || roles.reviewer) phrase = PHRASE_CLOTURE_INTERDITE;
    else
      etapes.push({
        etape: 'close',
        libelle: r.status === 'shared' ? 'Clôturer (non signée)' : 'Clôturer',
      });
  }
  return { etapes, phrase };
}

// ── Objectifs ───────────────────────────────────────────────────────────────

export const PHRASE_OBJECTIF_SOI =
  'C’est votre propre objectif : votre manager ou les ressources humaines le valident.';

/** Gestes sur un objectif. `planificateur` : manager de la chaîne ou `hr.manage`. */
export function gestesObjectif(
  g: Pick<GoalView, 'status' | 'employeeId'>,
  moi: Moi,
  x: Actions,
  equipe: readonly string[],
): { valider: boolean; avancer: boolean; clore: boolean; phrase: string | null } {
  const soi = moi.employeeId !== null && g.employeeId === moi.employeeId;
  const autorite = equipe.includes(g.employeeId) || (a(x, 'performance.read') && a(x, 'hr.manage'));
  const ouvert = g.status === 'proposed' || g.status === 'agreed';
  return {
    valider: g.status === 'proposed' && autorite && !soi,
    avancer: ouvert && (soi || autorite),
    clore: g.status === 'agreed' && autorite && !soi,
    phrase: g.status === 'proposed' && soi ? PHRASE_OBJECTIF_SOI : null,
  };
}

/** Cible d'un objectif en texte (jamais un avancement calculé). */
export function libelleCible(t: GoalView['target']): string | null {
  if (t === null) return null;
  if (t.kind === 'text') return t.value;
  return `${t.value.replace('.', ',')}${t.unit ? ` ${t.unit}` : ''}`;
}

/** Dernière déclaration d'avancement, telle que posée par une personne. */
export function dernierAvancement(g: Pick<GoalView, 'progress'>): string | null {
  const d = g.progress[g.progress.length - 1];
  if (!d) return null;
  return d.percent === null ? d.note : `${d.percent} % — ${d.note}`;
}

/** Valeurs offertes pour une section notée : celles de l'échelle saisie, choisies. */
export function valeursEchelle(scale: { min: number; max: number; labels: string[] }): {
  valeur: number;
  libelle: string;
}[] {
  const out: { valeur: number; libelle: string }[] = [];
  for (let v = scale.min; v <= scale.max; v += 1) {
    const l = scale.labels[v - scale.min];
    out.push({ valeur: v, libelle: l ? `${v} — ${l}` : String(v) });
  }
  return out;
}
