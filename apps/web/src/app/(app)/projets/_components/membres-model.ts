// Membres d'un projet et visibilité — règles d'écran pures (ADR-0060 § 3, § 4), testées.
//
// Le serveur décide de l'accès (portée résolue à chaque lecture) ; l'écran ne fait
// qu'expliquer qui voit le projet et proposer ce qui peut encore être ajouté.

import type {
  WorkProjectMembersView,
  WorkProjectVisibility,
  WorkTeamRef,
} from '@lalanda/shared/work';

import type { WorkMemberOption } from '@/lib/work-api';

export const VISIBILITES: Readonly<
  Record<WorkProjectVisibility, { label: string; phrase: string }>
> = {
  organization: {
    label: 'Toute l’organisation',
    phrase: 'Tous les membres de l’organisation qui accèdent aux Projets voient ce projet.',
  },
  private: {
    label: 'Membres seulement',
    phrase:
      'Seuls ses membres (ajoutés un à un ou par leur équipe), son responsable et la direction voient ce projet.',
  },
};

/** Membres de l'organisation qui peuvent encore être ajoutés un à un. */
export function personnesAjoutables(
  membres: readonly WorkMemberOption[],
  vue: Pick<WorkProjectMembersView, 'users'> | null,
): WorkMemberOption[] {
  const deja = new Set((vue?.users ?? []).map((u) => u.userId));
  return membres.filter((m) => !deja.has(m.userId));
}

/** Équipes qui ne sont pas encore ajoutées. */
export function equipesAjoutables(
  equipes: readonly WorkTeamRef[],
  vue: Pick<WorkProjectMembersView, 'teams'> | null,
): WorkTeamRef[] {
  const deja = new Set((vue?.teams ?? []).map((t) => t.teamId));
  return equipes.filter((t) => !deja.has(t.teamId));
}

/** « 7 personnes ont accès » / phrase de la visibilité organisation. */
export function phraseAcces(vue: Pick<WorkProjectMembersView, 'visibility' | 'memberCount'>): string {
  if (vue.visibility === 'organization') return VISIBILITES.organization.phrase;
  const n = vue.memberCount;
  return `${n} personne${n > 1 ? 's ont' : ' a'} accès à ce projet, en plus de la direction.`;
}

/** Libellé d'une équipe dans la liste : « Équipe chantier · 4 membres ». */
export function libelleEquipe(t: Pick<WorkTeamRef, 'name' | 'memberCount'>): string {
  return `${t.name} · ${t.memberCount} membre${t.memberCount > 1 ? 's' : ''}`;
}

/** Message d'un refus de l'API des membres. */
export function messageMembres(code: string | null, repli: string): string {
  switch (code) {
    case 'WORK_MEMBER_NOT_ELIGIBLE':
      return 'Cette personne n’a pas accès aux Projets : demandez d’abord un rôle qui les ouvre.';
    case 'WORK_PROJECT_MEMBER_LIMIT':
      return 'Le projet compte déjà 200 membres ajoutés un à un : ajoutez plutôt une équipe.';
    case 'WORK_PROJECT_TEAM_LIMIT':
      return 'Le projet compte déjà 50 équipes.';
    case 'HR_TEAM_NOT_FOUND':
      return 'Cette équipe n’existe plus.';
    case 'WORK_PROJECT_ARCHIVED':
      return 'Ce projet est archivé : restaurez-le avant de changer ses membres.';
    default:
      return repli;
  }
}
