// « Mon espace » (ADR-0045 § 8, `GET /hr/me`) — logique pure, lot H6.
//
// Ma fiche (dossier NON sensible : poste, service, manager, dates, coordonnées
// professionnelles), mes soldes (moteur), mes demandes. Rien n'est calculé : les
// soldes et les jours sont ceux de l'API, mis en forme seulement.

import type {
  HrEmployeeView,
  HrMeView,
  LeaveBalanceView,
  LeaveRequestView,
  LeaveTypeView,
} from '@/lib/api-hr';

import { formatJour, formatJours, statutDe, type Lecture } from './rh-model';

export type EtatMoi =
  | { etat: 'chargement' }
  | { etat: 'pas-encore' }
  | { etat: 'erreur'; erreur: unknown }
  | { etat: 'pret'; moi: HrMeView };

export function etatMoi(l: Lecture<HrMeView> | null): EtatMoi {
  if (l === null) return { etat: 'chargement' };
  if (l.ok) return { etat: 'pret', moi: l.valeur };
  if (statutDe(l.erreur) === 404) return { etat: 'pas-encore' };
  return { etat: 'erreur', erreur: l.erreur };
}

/** Lignes de ma fiche, dans l'ordre d'affichage ; les champs vides sont omis. */
export function lignesFiche(e: HrEmployeeView): [string, string][] {
  const lignes: [string, string | null | undefined][] = [
    ['Poste', e.jobTitle],
    ['Service', e.departmentName],
    ['Manager', e.managerName],
    ['Date d’entrée', formatJour(e.startDate)],
    ['Type de contrat', e.contractTypeLabel ?? null],
    ['Fin de période d’essai', e.probationEndDate ? formatJour(e.probationEndDate) : null],
    ['Fin de contrat', e.contractEndDate ? formatJour(e.contractEndDate) : null],
    ['Matricule', e.employeeNumber],
    ['Lieu de travail', e.workLocation],
    ['E-mail professionnel', e.workEmail],
    ['Téléphone professionnel', e.workPhone],
  ];
  return lignes.filter((l): l is [string, string] => typeof l[1] === 'string' && l[1] !== '');
}

export interface LigneSolde {
  typeId: string;
  libelle: string;
  disponible: string;
  details: string[];
}

/**
 * Soldes par type, tels que rendus par le moteur. Le libellé vient du solde
 * s'il le porte, sinon des types d'absence lus ; à défaut, « Type d'absence ».
 */
export function lignesSoldes(
  soldes: readonly LeaveBalanceView[],
  types: readonly LeaveTypeView[] = [],
): LigneSolde[] {
  const noms = new Map(types.map((t) => [t.id, t.label]));
  return soldes.map((s) => ({
    typeId: s.typeId,
    libelle: s.typeLabel ?? noms.get(s.typeId) ?? 'Type d’absence',
    disponible: formatJours(s.available),
    details: [
      `Pris : ${formatJours(s.taken)}`,
      `À venir : ${formatJours(s.upcoming)}`,
      `En attente : ${formatJours(s.pending)}`,
    ],
  }));
}

/**
 * Demandes en cours (en attente, ou accordées qui ne sont pas encore finies) puis
 * passées ; chaque groupe trié par date de début, la plus proche d'abord pour les
 * premières, la plus récente d'abord pour les secondes.
 */
export function grouperDemandes(
  demandes: readonly LeaveRequestView[],
  aujourdhui: string,
): { enCours: LeaveRequestView[]; passees: LeaveRequestView[] } {
  const enCours = demandes
    .filter(
      (d) => d.status === 'pending' || (d.status === 'approved' && d.end.date >= aujourdhui),
    )
    .sort((a, b) => (a.start.date < b.start.date ? -1 : a.start.date > b.start.date ? 1 : 0));
  const ids = new Set(enCours.map((d) => d.id));
  const passees = demandes
    .filter((d) => !ids.has(d.id))
    .sort((a, b) => (a.start.date > b.start.date ? -1 : a.start.date < b.start.date ? 1 : 0));
  return { enCours, passees };
}

/**
 * Le demandeur peut-il annuler (§ 2.7) ? Tant qu'elle est en attente, ou une fois
 * accordée tant qu'elle n'a pas commencé. Confort : l'API reste juge.
 */
export function peutAnnulerDemande(d: LeaveRequestView, aujourdhui: string): boolean {
  if (d.status === 'pending') return true;
  return d.status === 'approved' && d.start.date > aujourdhui;
}
