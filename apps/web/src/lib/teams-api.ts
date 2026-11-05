// Client des équipes — ADR-0060 § 2 (`/hr/teams`, rangées dans les RH).
//
// Lecture `hr.read`, gestion `hr.manage`. Les Projets lisent les équipes par
// `GET /work/teams` (`workApi.listTeams`), sous `work.read`.

import type {
  AddTeamMembersBody,
  CreateTeamBody,
  TeamListView,
  TeamMemberView,
  TeamView,
  UpdateTeamBody,
} from '@lalanda/shared/hr';

import { jsonRequest } from './api';

const id = (v: string) => encodeURIComponent(v);

export const teamsApi = {
  list: () => jsonRequest<TeamListView>('/hr/teams', { method: 'GET' }).then((r) => r.items),
  /** Membres de l'organisation proposés (nom seulement). */
  candidates: () =>
    jsonRequest<{ items: TeamMemberView[] }>('/hr/teams/candidates', { method: 'GET' }).then(
      (r) => r.items,
    ),
  get: (teamId: string) => jsonRequest<TeamView>(`/hr/teams/${id(teamId)}`, { method: 'GET' }),
  create: (body: CreateTeamBody) => jsonRequest<TeamView>('/hr/teams', { method: 'POST', body }),
  update: (teamId: string, body: UpdateTeamBody) =>
    jsonRequest<TeamView>(`/hr/teams/${id(teamId)}`, { method: 'PUT', body }),
  addMembers: (teamId: string, body: AddTeamMembersBody) =>
    jsonRequest<TeamView>(`/hr/teams/${id(teamId)}/members`, { method: 'POST', body }),
  removeMember: (teamId: string, userId: string) =>
    jsonRequest<TeamView>(`/hr/teams/${id(teamId)}/members/${id(userId)}`, { method: 'DELETE' }),
  remove: (teamId: string) => jsonRequest<void>(`/hr/teams/${id(teamId)}`, { method: 'DELETE' }),
};
