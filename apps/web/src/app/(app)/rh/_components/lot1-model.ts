// Règles d'écran du lot 1 RH (ADR-0068) : qui peut inviter, corriger un matricule,
// libellés de l'état du compte et des postes. Aucune règle métier : l'API reste juge.

import type { OrgAction } from '@/lib/api';
import type { EmployeeAccountView, PositionView } from '@/lib/api-hr-lot1';

type Actions = readonly OrgAction[] | null;

const a = (actions: Actions, action: OrgAction): boolean =>
  actions !== null && actions.includes(action);

/** « Inviter sur Lalanda » part vraiment : `hr.manage` ET `members.invite` (§ 1). */
export const peutInviterSurLalanda = (x: Actions): boolean =>
  a(x, 'hr.manage') && a(x, 'members.invite');

/** Corriger un matricule posé : droit RH administrateur (`hr.sensitive.read` + `hr.manage`). */
export const peutCorrigerMatricule = (x: Actions): boolean =>
  a(x, 'hr.manage') && a(x, 'hr.sensitive.read');

/**
 * Case « Inviter sur Lalanda » : cochée par défaut dès qu'un e-mail professionnel est
 * saisi, tant que la personne ne l'a pas décochée elle-même.
 */
export function caseInvitation(
  workEmail: string,
  choix: boolean | null,
): { visible: boolean; cochee: boolean } {
  const avecEmail = workEmail.trim() !== '';
  return { visible: avecEmail, cochee: avecEmail && (choix ?? true) };
}

export function libelleEtatCompte(c: EmployeeAccountView): {
  texte: string;
  ton: 'success' | 'warning' | 'neutral';
} {
  switch (c.state) {
    case 'linked':
      return { texte: 'Relié à un compte Lalanda', ton: 'success' };
    case 'invitation_pending':
      return { texte: 'Invitation en attente', ton: 'warning' };
    case 'invitation_expired':
      return { texte: 'Invitation expirée', ton: 'warning' };
    default:
      return { texte: 'Sans compte Lalanda', ton: 'neutral' };
  }
}

export const LIBELLES_STATUT_POSTE: Record<PositionView['status'], string> = {
  open: 'Vacant',
  filled: 'Pourvu',
  deleted: 'Supprimé',
};

/** Option d'un poste vacant dans le formulaire : « POS-001 — Chauffeur (Logistique) ». */
export function optionPoste(
  p: Pick<PositionView, 'positionNumber' | 'title' | 'departmentName'>,
): string {
  return `${p.positionNumber} — ${p.title}${p.departmentName ? ` (${p.departmentName})` : ''}`;
}

export type ChoixPoste = '' | 'new' | `pos:${string}`;

/** Corps `position` envoyé à l'API depuis le choix du formulaire. */
export function corpsPoste(
  choix: ChoixPoste,
): { mode: 'new' } | { mode: 'replacement'; positionId: string } | undefined {
  if (choix === 'new') return { mode: 'new' };
  if (choix.startsWith('pos:')) return { mode: 'replacement', positionId: choix.slice(4) };
  return undefined;
}
