// Mon équipe (ADR-0045 § 3.1, `GET /hr/team`) — logique pure, lot H6.
//
// L'équipe (subordonnés directs et indirects) est calculée par l'API
// (`hrViewerScope`) ; les soldes par le moteur. Les types confidentiels arrivent
// déjà masqués (« Absent ») : l'écran n'a rien à cacher lui-même.

import type { HrTeamMemberView, HrTeamView, LeaveRequestView } from '@/lib/api-hr';

import { formatJour, formatJours, libelleType, nomAffiche } from './rh-model';

export interface MembreEquipe {
  id: string;
  nom: string;
  poste: string;
  direct: boolean;
  /** « Absent aujourd'hui, jusqu'au 5 nov. », « Absence à venir le 12 nov. », ou `null`. */
  presence: { texte: string; absent: boolean } | null;
  soldes: string[];
}

function couvre(d: LeaveRequestView, jour: string): boolean {
  return d.start.date <= jour && d.end.date >= jour;
}

/** Ce que l'on dit de la présence d'un membre, d'après ses absences accordées. */
export function presence(
  absences: readonly LeaveRequestView[] | undefined,
  jour: string,
): MembreEquipe['presence'] {
  const accordees = (absences ?? []).filter((d) => d.status === 'approved');
  const enCours = accordees.find((d) => couvre(d, jour));
  if (enCours) {
    return {
      texte: `${libelleType(enCours)} aujourd’hui, jusqu’au ${formatJour(enCours.end.date)}`,
      absent: true,
    };
  }
  const prochaine = accordees
    .filter((d) => d.start.date > jour)
    .sort((a, b) => (a.start.date < b.start.date ? -1 : 1))[0];
  if (prochaine) {
    return {
      texte: `${libelleType(prochaine)} à partir du ${formatJour(prochaine.start.date)}`,
      absent: false,
    };
  }
  return null;
}

function membre(m: HrTeamMemberView, jour: string): MembreEquipe {
  return {
    id: m.employee.id,
    nom: nomAffiche(m.employee),
    poste: [m.employee.jobTitle, m.employee.departmentName].filter(Boolean).join(' · '),
    direct: m.direct,
    presence: presence(m.absences, jour),
    soldes: (m.balances ?? []).map(
      (b) => `${b.typeLabel ?? 'Solde'} : ${formatJours(b.available)} disponibles`,
    ),
  };
}

/** Membres directs puis indirects, chacun par nom. */
export function membresEquipe(
  equipe: HrTeamView,
  jour: string,
): { directs: MembreEquipe[]; indirects: MembreEquipe[] } {
  const tous = equipe.members
    .map((m) => membre(m, jour))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  return { directs: tous.filter((m) => m.direct), indirects: tous.filter((m) => !m.direct) };
}
