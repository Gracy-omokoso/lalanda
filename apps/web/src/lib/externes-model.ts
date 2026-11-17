// Membres externes d'un projet (contact client, consultant) — ADR-0078. Logique pure des
// écrans : messages d'erreur, libellés, durée. L'API reste juge de tout accès.

import {
  WORK_CLIENT_APPROVAL_LABELS,
  WORK_EXTERNAL_CLOSE_REASONS,
  type WorkClientApprovalState,
  type WorkExternalCloseReason,
} from '@lalanda/shared/work';

/** Message en français d'un code d'erreur des membres externes, ou `null`. */
export function messageExterne(code: string | null): string | null {
  switch (code) {
    case 'WORK_EXTERNAL_PROJECT_NOT_CLIENT':
      return 'Un contact client ne s’invite que sur un projet client relié à une fiche client.';
    case 'WORK_EXTERNAL_CUSTOMER_MISMATCH':
      return 'Le contact doit être relié à la fiche client de ce projet.';
    case 'WORK_EXTERNAL_CRM_MISMATCH':
      return 'Ce compte CRM n’est pas relié à la fiche client du projet.';
    case 'WORK_EXTERNAL_RECORD_INACTIVE':
      return 'Cette fiche est archivée ou fusionnée : choisissez une fiche active.';
    case 'WORK_EXTERNAL_REFERENT_NOT_ELIGIBLE':
      return 'Le référent doit être un membre interne qui peut modifier les tâches.';
    case 'WORK_EXTERNAL_KIND_CONFLICT':
      return 'Cette adresse a déjà un compte externe d’un autre genre dans l’organisation.';
    case 'WORK_EXTERNAL_RECORD_CONFLICT':
      return 'Cette adresse est déjà reliée à une autre fiche.';
    case 'WORK_EXTERNAL_ALREADY_MEMBER':
      return 'Cette personne a déjà accès à ce projet.';
    case 'WORK_EXTERNAL_LIMIT':
      return 'Le nombre maximal d’accès externes est atteint.';
    case 'WORK_EXTERNAL_NOT_PROJECT_CONSULTANT':
      return 'Cette personne n’est pas consultant de ce projet : invitez-la d’abord.';
    case 'WORK_CLIENT_APPROVAL_NEEDS_VISIBLE':
      return 'Une validation client exige une tâche visible par le client.';
    case 'WORK_COMMENT_EXTERNAL_SHARED':
      return 'Le commentaire d’un membre externe reste partagé.';
    case 'WORK_PROJECT_MANAGE_FORBIDDEN':
      return 'Seuls le chef de projet, son adjoint et les gestionnaires font ce geste.';
    case 'WORK_EXTERNAL_NOT_GUEST':
      return 'Seul un membre au rôle « Invité externe » se convertit.';
    case 'WORK_EXTERNAL_GUEST_NOT_MEMBER':
      return 'L’invité n’est pas membre d’un des projets choisis.';
    default:
      return null;
  }
}

const RAISONS: Readonly<Record<WorkExternalCloseReason, string>> = {
  manual: 'fermé à la main',
  member_removed: 'retiré du projet',
  project_archived: 'projet archivé',
  customer_inactive: 'fiche client archivée',
  supplier_inactive: 'fiche fournisseur archivée',
  converted: 'converti',
};

/** Libellé du motif de fermeture d'un accès. */
export function libelleFermeture(reason: string | null): string {
  return reason && (WORK_EXTERNAL_CLOSE_REASONS as readonly string[]).includes(reason)
    ? RAISONS[reason as WorkExternalCloseReason]
    : 'fermé';
}

/** Libellé et ton de la validation client. */
export function etatValidationClient(state: WorkClientApprovalState): {
  libelle: string;
  ton: 'ok' | 'wait' | 'late' | 'draft';
} {
  const libelle = WORK_CLIENT_APPROVAL_LABELS[state];
  if (state === 'approved') return { libelle, ton: 'ok' };
  if (state === 'pending') return { libelle, ton: 'wait' };
  if (state === 'changes_requested') return { libelle, ton: 'late' };
  return { libelle, ton: 'draft' };
}

/** Minutes → « 1 h 30 », « 45 min ». */
export function duree(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** « 1,5 » heure(s) → minutes (virgule ou point) ; `null` si illisible ou hors bornes. */
export function minutesDe(saisie: string): number | null {
  const t = saisie.trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const minutes = Math.round(Number(t) * 60);
  return minutes >= 1 && minutes <= 1440 ? minutes : null;
}
