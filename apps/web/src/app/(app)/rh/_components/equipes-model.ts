// Équipes (RH) — règles d'écran pures (ADR-0060 § 2), testées.
//
// Une équipe regroupe des UTILISATEURS de l'organisation (pas des dossiers du
// personnel) et peut traverser plusieurs services. Le responsable compte parmi ses
// membres. Les règles de fond (nom unique, membres de l'organisation) sont tenues
// par l'API ; l'écran ne fait que préparer le corps et traduire ses refus.

import type { CreateTeamBody, TeamMemberView, TeamView } from '@lalanda/shared/hr';

export const EQUIPES_BASE = '/rh/equipes';

export interface FormEquipe {
  name: string;
  description: string;
  leadUserId: string;
}

export function formEquipe(t: TeamView | null): FormEquipe {
  return {
    name: t?.name ?? '',
    description: t?.description ?? '',
    leadUserId: t?.lead?.userId ?? '',
  };
}

export type ResultatEquipe =
  | { ok: true; corps: Required<Pick<CreateTeamBody, 'name'>> & Omit<CreateTeamBody, 'name' | 'memberUserIds'> }
  | { ok: false; erreur: string };

/** Contrôle de saisie avant l'envoi (mêmes bornes que l'API). */
export function validerEquipe(f: FormEquipe): ResultatEquipe {
  const name = f.name.trim();
  if (name === '') return { ok: false, erreur: 'Le nom de l’équipe est obligatoire.' };
  if (name.length > 80) return { ok: false, erreur: '80 caractères au plus.' };
  const description = f.description.trim();
  if (description.length > 1000) return { ok: false, erreur: 'Description : 1 000 caractères au plus.' };
  return {
    ok: true,
    corps: {
      name,
      description: description === '' ? null : description,
      leadUserId: f.leadUserId === '' ? null : f.leadUserId,
    },
  };
}

/** Membres de l'organisation qui ne sont pas encore dans l'équipe. */
export function candidatsAjoutables(
  candidats: readonly TeamMemberView[],
  equipe: Pick<TeamView, 'members'> | null,
): TeamMemberView[] {
  const deja = new Set((equipe?.members ?? []).map((m) => m.userId));
  return candidats.filter((c) => !deja.has(c.userId));
}

/** « 3 membres · 2 projets » */
export function resumeEquipe(t: Pick<TeamView, 'memberCount' | 'projectCount'>): string {
  const m = `${t.memberCount} membre${t.memberCount > 1 ? 's' : ''}`;
  if (t.projectCount === 0) return m;
  return `${m} · ${t.projectCount} projet${t.projectCount > 1 ? 's' : ''}`;
}

/** Message d'un refus de l'API des équipes. */
export function messageEquipe(code: string | null, repli: string): string {
  switch (code) {
    case 'HR_TEAM_NAME_EXISTS':
      return 'Une équipe porte déjà ce nom.';
    case 'HR_TEAM_LIMIT':
      return 'L’organisation a atteint le nombre maximal d’équipes (200).';
    case 'HR_TEAM_MEMBER_LIMIT':
      return 'Une équipe compte au plus 200 membres.';
    case 'MEMBER_NOT_FOUND':
      return 'Ce membre n’appartient pas (ou plus) à l’organisation.';
    case 'HR_TEAM_NOT_FOUND':
      return 'Cette équipe n’existe plus.';
    case 'STALE_REVISION':
      return 'L’équipe a été modifiée entre-temps : rechargez la page.';
    default:
      return repli;
  }
}
