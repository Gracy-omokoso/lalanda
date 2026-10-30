// Calendrier des absences (ADR-0045 § 3.2, § 8 ; moteur `teamCalendar`) — logique
// pure, lot H6.
//
// L'API rend les absences de la PORTÉE de l'appelant (soi, équipe, service,
// organisation, bornée par `teamCalendarVisibility` et `hrViewerScope`), bornes
// déjà ramenées à la fenêtre, types confidentiels déjà masqués (« Absent »). Ce
// module ne fait que POSER ces absences sur une grille personnes × jours (ordi-
// nateur) ou une liste par jour (téléphone) : il ne compte aucun jour.

import type { HrCalendarEntry, HrCalendarScope, HrCalendarView } from '@/lib/api-hr';

import {
  decaler,
  libelleJour,
  periode,
  type Periode,
  type VueCalendrier,
} from '../../projets/_components/calendar-model';

export { decaler, periode, type Periode, type VueCalendrier };

export type DemiCase = 'full' | 'am' | 'pm';

export interface CaseAbsence {
  requestId: string;
  demi: DemiCase;
  statut: 'pending' | 'approved';
  libelle: string;
}

export interface LignePersonne {
  employeeId: string;
  nom: string;
  /** Une case par jour de la période (`null` = présent ou non renseigné). */
  cases: (CaseAbsence | null)[];
}

export interface Ferie {
  date: string;
  libelle: string;
  demi: 'am' | 'pm' | null;
}

/** Demi-journée occupée par une absence un jour donné (bornes de l'API). */
export function demiDuJour(
  e: Pick<HrCalendarEntry, 'start' | 'end'>,
  jour: string,
): DemiCase | null {
  if (jour < e.start.date || jour > e.end.date) return null;
  if (e.start.date === e.end.date) return e.start.half === e.end.half ? e.start.half : 'full';
  if (jour === e.start.date && e.start.half === 'pm') return 'pm';
  if (jour === e.end.date && e.end.half === 'am') return 'am';
  return 'full';
}

function nomDe(view: HrCalendarView, e: HrCalendarEntry): string {
  return (
    e.employeeName?.trim() ||
    view.employees?.find((p) => p.id === e.employeeId)?.name ||
    'Un collaborateur'
  );
}

/**
 * Grille personnes × jours. Une personne apparaît dès qu'elle a une absence dans
 * la fenêtre ; deux absences le même jour (matin et après-midi) gardent la
 * première, l'autre reste lisible dans la liste du téléphone et au survol.
 */
export function grillePersonnes(view: HrCalendarView, jours: readonly string[]): LignePersonne[] {
  const lignes = new Map<string, LignePersonne>();
  for (const e of view.entries) {
    let l = lignes.get(e.employeeId);
    if (!l) {
      l = { employeeId: e.employeeId, nom: nomDe(view, e), cases: jours.map(() => null) };
      lignes.set(e.employeeId, l);
    }
    jours.forEach((jour, i) => {
      const demi = demiDuJour(e, jour);
      if (demi === null || l!.cases[i]) return;
      l!.cases[i] = { requestId: e.requestId, demi, statut: e.status, libelle: e.label };
    });
  }
  return [...lignes.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

export function feries(view: HrCalendarView): Map<string, Ferie> {
  return new Map(
    view.holidays.map((h) => [
      h.date,
      { date: h.date, libelle: h.label ?? 'Jour férié', demi: h.halfDay },
    ]),
  );
}

export interface JourListe {
  date: string;
  titre: string;
  ferie: Ferie | null;
  absences: {
    requestId: string;
    nom: string;
    libelle: string;
    demi: DemiCase;
    statut: 'pending' | 'approved';
  }[];
}

/** Liste par jour (téléphone) : seuls les jours avec une absence ou un férié. */
export function listeParJour(view: HrCalendarView, jours: readonly string[]): JourListe[] {
  const f = feries(view);
  return jours
    .map((date) => ({
      date,
      titre: libelleJour(date),
      ferie: f.get(date) ?? null,
      absences: view.entries
        .map((e) => ({ e, demi: demiDuJour(e, date) }))
        .filter((x): x is { e: HrCalendarEntry; demi: DemiCase } => x.demi !== null)
        .map(({ e, demi }) => ({
          requestId: e.requestId,
          nom: nomDe(view, e),
          libelle: e.label,
          demi,
          statut: e.status,
        }))
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    }))
    .filter((j) => j.ferie !== null || j.absences.length > 0);
}

export const LIBELLES_DEMI: Record<DemiCase, string> = {
  full: 'journée',
  am: 'matin',
  pm: 'après-midi',
};

export const LIBELLES_PORTEE: Record<HrCalendarScope, string> = {
  me: 'Moi',
  team: 'Mon équipe',
  department: 'Mon service',
  organization: 'Toute l’organisation',
};

/**
 * Portées proposées : « Moi » et « Mon service » à tous (le défaut, décision
 * ouverte n° 8), « Mon équipe » aux managers, l'organisation à `hr.read`. L'API
 * borne de toute façon selon `teamCalendarVisibility`.
 */
export function porteesProposees(opts: { isManager: boolean; lireRh: boolean }): HrCalendarScope[] {
  const p: HrCalendarScope[] = ['me'];
  if (opts.isManager) p.push('team');
  p.push('department');
  if (opts.lireRh) p.push('organization');
  return p;
}

/** Texte lisible d'une case (lecteurs d'écran, infobulle). */
export function texteCase(nom: string, jour: string, c: CaseAbsence): string {
  const demi = c.demi === 'full' ? '' : ` (${LIBELLES_DEMI[c.demi]})`;
  const attente = c.statut === 'pending' ? ', en attente de validation' : '';
  return `${nom}, ${libelleJour(jour)} : ${c.libelle}${demi}${attente}`;
}
