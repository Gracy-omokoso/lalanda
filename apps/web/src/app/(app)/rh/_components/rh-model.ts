// Ressources humaines — règles communes aux écrans (ADR-0045 § 8, lot H6). Logique pure.
//
// Les droits viennent des ACTIONS servies par `GET /me/permissions` (coquille,
// `useShell().actions`), jamais d'un nom de rôle. Masquer ou désactiver est un
// confort : l'API refuse de toute façon. Les relations (manager, soi-même) sont
// jugées par l'API (`hrViewerScope`) et lues dans `GET /hr/me`.
//
// AUCUN calcul : jours décomptés, soldes et effectifs sont ceux de l'API (moteur),
// en chaînes décimales ; l'écran les met en forme (« 2,5 jours »), sans additionner.

import { HR_CONFIDENTIAL_LEAVE_LABEL, type LeaveRequestStatus } from '@lalanda/shared/hr';

import type { OrgAction } from '@/lib/api';
import type { HrEmployeeListItem, LeaveBoundView, LeaveRequestView } from '@/lib/api-hr';

import { formatJour } from '../../projets/_components/projets-model';

export { aujourdhui, formatJour } from '../../projets/_components/projets-model';

export const RH_BASE = '/rh';

type Actions = readonly OrgAction[] | null;

const a = (actions: Actions, action: OrgAction): boolean =>
  actions !== null && actions.includes(action);

export const peutLireRh = (x: Actions): boolean => a(x, 'hr.read');
export const peutGererRh = (x: Actions): boolean => a(x, 'hr.manage');
export const peutDemanderAbsence = (x: Actions): boolean => a(x, 'leave.request');
export const peutValiderAbsences = (x: Actions): boolean => a(x, 'leave.approve');
/** Entrée dans l'application : `leave.request` OU `hr.read` (§ 8). */
export const peutEntrerRh = (x: Actions): boolean => peutLireRh(x) || peutDemanderAbsence(x);

/**
 * Écran d'arrivée de `/rh` (§ 8) : la liste des collaborateurs avec `hr.read`,
 * sinon « Mon espace ».
 */
export function destinationRh(x: Actions): string {
  return peutLireRh(x) ? `${RH_BASE}/collaborateurs` : `${RH_BASE}/moi`;
}

// ── Liens ───────────────────────────────────────────────────────────────────

export const lienCollaborateur = (id: string): string =>
  `${RH_BASE}/collaborateurs/${encodeURIComponent(id)}`;
export const lienAbsencesCollaborateur = (id: string): string =>
  `${lienCollaborateur(id)}/absences`;
export const LIEN_A_VALIDER = `${RH_BASE}/absences?vue=a-valider`;
export const LIEN_MOI = `${RH_BASE}/moi`;

// ── Erreurs ─────────────────────────────────────────────────────────────────

/** Phrase d'une route d'API qui n'existe pas encore (lot non fusionné) : 404. */
export const PHRASE_PAS_ENCORE =
  'Cette partie des ressources humaines n’est pas encore disponible sur ce serveur. Elle arrive avec une prochaine livraison : rien n’est affiché plutôt que des données inventées.';

const MESSAGES: Record<string, string> = {
  STALE_REVISION:
    'La fiche a été modifiée entre-temps par quelqu’un d’autre. Rechargez la page avant de recommencer.',
  EMPLOYEE_NUMBER_EXISTS: 'Un autre collaborateur porte déjà ce matricule.',
  EMPLOYEE_USER_NOT_MEMBER: 'Ce compte n’est pas membre de l’organisation.',
  EMPLOYEE_USER_ALREADY_LINKED: 'Ce compte est déjà relié à un autre dossier collaborateur.',
  EMPLOYEE_NOT_LINKED:
    'Aucun dossier collaborateur n’est relié à votre compte. Demandez aux ressources humaines de créer ou de relier votre fiche.',
  MANAGER_CYCLE:
    'Ce manager est déjà sous la responsabilité de ce collaborateur : choisissez une autre personne.',
  DEPARTMENT_NAME_EXISTS: 'Un service actif porte déjà ce nom.',
  DEPARTMENT_CYCLE: 'Un service ne peut pas être rattaché à l’un de ses propres sous-services.',
  DEPARTMENT_TOO_DEEP: 'Huit niveaux de services au plus.',
  DEPARTMENT_IN_USE:
    'Des collaborateurs actifs ou des sous-services sont encore rattachés à ce service.',
  LEAVE_NO_WORKING_DAY: 'Aucun jour travaillé dans cette période : rien à décompter.',
  LEAVE_BALANCE_INSUFFICIENT: 'Votre solde ne suffit pas pour cette absence.',
  LEAVE_OVERLAP: 'Une autre demande en attente ou accordée couvre déjà une partie de ces dates.',
  SELF_APPROVAL_FORBIDDEN: 'On ne valide pas sa propre absence : une autre personne doit le faire.',
  LEAVE_NOT_YOUR_STEP: 'Cette demande attend la décision d’une autre personne.',
  APPROVER_ALREADY_APPROVED:
    'Vous avez déjà validé une étape de cette demande : l’étape suivante revient à une autre personne.',
  SECRETS_NOT_CONFIGURED: 'Le coffre des données sensibles n’est pas configuré sur ce serveur.',
};

interface ErreurApi {
  status?: unknown;
  detail?: unknown;
}

function codeDe(err: unknown): string | null {
  const detail = (err as ErreurApi | null)?.detail;
  if (typeof detail !== 'object' || detail === null) return null;
  const code = (detail as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function statutDe(err: unknown): number | null {
  const s = (err as ErreurApi | null)?.status;
  return typeof s === 'number' ? s : null;
}

/** Message d'une erreur d'API des ressources humaines, en français clair. */
export function messageRh(err: unknown, repli: string): string {
  if (typeof err !== 'object' || err === null) return repli;
  const code = codeDe(err);
  if (code !== null && MESSAGES[code]) return MESSAGES[code]!;
  const status = statutDe(err);
  if (status === 403) return 'Votre rôle ne permet pas cette action sur les ressources humaines.';
  if (status === 404) return PHRASE_PAS_ENCORE;
  if (status === 429) return 'Trop de demandes en peu de temps : réessayez plus tard.';
  const detail = (err as ErreurApi).detail;
  if (typeof detail === 'object' && detail !== null) {
    const m = (detail as { message?: unknown }).message;
    if (typeof m === 'string' && m !== '') return m;
  }
  return repli;
}

/** Une lecture qui peut échouer : succès, ou erreur gardée pour être dite. */
export type Lecture<T> = { ok: true; valeur: T } | { ok: false; erreur: unknown };

export function lire<T>(p: Promise<T>): Promise<Lecture<T>> {
  return p.then(
    (valeur) => ({ ok: true as const, valeur }),
    (erreur: unknown) => ({ ok: false as const, erreur }),
  );
}

// ── Noms ────────────────────────────────────────────────────────────────────

type Nommable = Pick<HrEmployeeListItem, 'firstName' | 'lastName' | 'preferredName'>;

/** Nom d'usage s'il existe, sinon prénom et nom. */
export function nomAffiche(e: Nommable): string {
  const usage = e.preferredName?.trim();
  if (usage) return usage;
  return `${e.firstName} ${e.lastName}`.trim();
}

/** Initiales d'une pastille (deux lettres au plus), décoratives. */
export function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  const lettres = mots.length >= 2 ? [mots[0]!, mots[mots.length - 1]!] : mots.slice(0, 1);
  return lettres
    .map((m) => m[0]!.toUpperCase())
    .join('')
    .slice(0, 2);
}

// ── Durées ──────────────────────────────────────────────────────────────────

const JOURS = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Durée rendue par l'API (`"2.50"`) en français (« 2,5 jours »). Mise en forme
 * seulement : zéros de fin retirés, virgule décimale, accord du mot « jour »
 * (singulier sous deux). Une valeur illisible est rendue telle quelle.
 */
export function formatJours(valeur: string | null | undefined): string {
  if (valeur === null || valeur === undefined) return '—';
  const m = JOURS.exec(valeur.trim());
  if (m === null) return valeur;
  const fraction = (m[3] ?? '').replace(/0+$/, '');
  const entier = m[2]!.replace(/^0+(?=\d)/, '');
  const texte = `${m[1] ?? ''}${entier}${fraction ? `,${fraction}` : ''}`;
  const pluriel = Number(entier) >= 2;
  return `${texte} jour${pluriel ? 's' : ''}`;
}

// ── Périodes d'absence ──────────────────────────────────────────────────────

const DEMI: Record<LeaveBoundView['half'], string> = {
  full: '',
  am: ' (matin)',
  pm: ' (après-midi)',
};

/**
 * « le 3 nov. 2026 », « le 3 nov. 2026 (matin) », « du 3 nov. (après-midi) au
 * 5 nov. 2026 ». L'année n'est répétée que si elle change.
 */
export function libellePeriode(start: LeaveBoundView, end: LeaveBoundView): string {
  if (start.date === end.date) {
    const demi = start.half === end.half ? DEMI[start.half] : '';
    return `le ${formatJour(start.date)}${demi}`;
  }
  const memeAnnee = start.date.slice(0, 4) === end.date.slice(0, 4);
  return `du ${formatJour(start.date, !memeAnnee)}${start.half === 'pm' ? DEMI.pm : ''} au ${formatJour(end.date)}${end.half === 'am' ? DEMI.am : ''}`;
}

// ── Statuts des demandes ────────────────────────────────────────────────────

export const LIBELLES_STATUT_DEMANDE: Record<LeaveRequestStatus, string> = {
  pending: 'En attente',
  approved: 'Accordée',
  rejected: 'Refusée',
  cancelled: 'Annulée',
};

export type Ton = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function tonStatutDemande(s: LeaveRequestStatus): Ton {
  switch (s) {
    case 'pending':
      return 'warning';
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const LIBELLES_ETAPE: Record<'manager' | 'hr', string> = {
  manager: 'Manager',
  hr: 'Ressources humaines',
};

/**
 * Étape en attente d'une demande : celle servie par l'API, sinon la première
 * étape figée qui n'a pas encore de décision. `null` hors attente.
 */
export function etapeEnAttente(r: LeaveRequestView): 'manager' | 'hr' | null {
  if (r.status !== 'pending') return null;
  if (r.currentStep) return r.currentStep;
  const faites = new Set(r.approvals.map((x) => x.step));
  return r.steps.find((s) => !faites.has(s)) ?? null;
}

/** Libellé du type tel que servi ; un type masqué reste « Absent ». */
export function libelleType(r: Pick<LeaveRequestView, 'typeLabel' | 'masked'>): string {
  return r.masked ? HR_CONFIDENTIAL_LEAVE_LABEL : r.typeLabel;
}

// ── Statut d'un collaborateur ───────────────────────────────────────────────

export function libelleStatutCollaborateur(e: HrEmployeeListItem): { texte: string; ton: Ton } {
  if (e.status === 'exited') return { texte: 'Sorti', ton: 'neutral' };
  if (e.status === 'anonymized') return { texte: 'Anonymisé', ton: 'neutral' };
  if (e.upcoming) return { texte: 'À venir', ton: 'info' };
  if (e.onProbation) return { texte: 'Période d’essai', ton: 'warning' };
  return { texte: 'Actif', ton: 'success' };
}
