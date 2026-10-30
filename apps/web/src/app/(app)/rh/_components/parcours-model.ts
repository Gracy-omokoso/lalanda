// Entrées et sorties (ADR-0045 § 2.9, § 3.1) — logique pure, lot H7.
//
// La sortie ne retire PAS l'accès à Lalanda (décision ouverte n° 13) : elle propose
// la liste de départ. L'anonymisation est irréversible : elle exige une
// confirmation forte (taper le nom affiché). Avancement d'une liste : compté par
// l'API (`done`, `total`), jamais recompté ici.

import {
  EMPLOYEE_EXIT_CATEGORIES,
  HR_CHECKLIST_KIND_LABELS,
  type EmployeeExitCategory,
  type HrChecklistAssignee,
  type HrChecklistKind,
} from '@lalanda/shared/hr';

import type { OrgAction } from '@/lib/api';
import type { HrEmployeeView } from '@/lib/api-hr';
import type { ChecklistItemView, ChecklistTemplateView, ChecklistView } from '@/lib/api-hr-admin';

import { formatJour } from './rh-model';

type Actions = readonly OrgAction[] | null;
const a = (x: Actions, action: OrgAction): boolean => x !== null && x.includes(action);

export const LIBELLES_SORTIE: Record<EmployeeExitCategory, string> = {
  resignation: 'Démission',
  end_of_contract: 'Fin de contrat',
  dismissal: 'Licenciement',
  mutual_agreement: 'Départ d’un commun accord',
  retirement: 'Départ à la retraite',
  death: 'Décès',
  other: 'Autre',
};

export const CATEGORIES_SORTIE = EMPLOYEE_EXIT_CATEGORIES;

export { HR_CHECKLIST_KIND_LABELS as LIBELLES_LISTE };

// ── Sortie ──────────────────────────────────────────────────────────────────

export interface FormSortie {
  endDate: string;
  exitCategory: EmployeeExitCategory | '';
}

export function validerSortie(
  f: FormSortie,
  fiche: Pick<HrEmployeeView, 'startDate' | 'revision'>,
):
  | {
      ok: true;
      corps: { endDate: string; exitCategory: EmployeeExitCategory; expectedRevision: number };
    }
  | { ok: false; erreurs: Partial<Record<keyof FormSortie, string>> } {
  const e: Partial<Record<keyof FormSortie, string>> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.endDate)) e.endDate = 'La date de sortie est obligatoire.';
  else if (fiche.startDate && f.endDate < fiche.startDate) {
    e.endDate = 'La date de sortie ne peut pas précéder la date d’entrée.';
  }
  if (f.exitCategory === '') e.exitCategory = 'Choisissez la nature de la sortie.';
  if (Object.keys(e).length > 0 || f.exitCategory === '') return { ok: false, erreurs: e };
  return {
    ok: true,
    corps: { endDate: f.endDate, exitCategory: f.exitCategory, expectedRevision: fiche.revision },
  };
}

/** Réintégration offerte tant que la date de sortie est future (l'API revérifie). */
export function peutReintegrer(
  fiche: Pick<HrEmployeeView, 'status' | 'endDate'>,
  aujourdhui: string,
): boolean {
  return fiche.status === 'exited' && fiche.endDate !== null && fiche.endDate > aujourdhui;
}

/** Phrase de la sortie : ce qu'elle fait et ce qu'elle ne fait pas. */
export const PHRASE_SORTIE =
  'Les absences accordées après la date de sortie sont annulées et leurs jours rendus. L’accès à Lalanda n’est PAS retiré : la liste de départ le propose, et le retrait se fait depuis la page des membres.';

// ── Anonymisation (irréversible) ────────────────────────────────────────────

export const PHRASE_ANONYMISATION =
  'Irréversible. Le nom devient « Ancien collaborateur n° … », les données sensibles et les documents sensibles sont effacés, le compte Lalanda est délié. Les absences et les chiffres des rapports sont conservés. Lalanda ne fixe aucune durée de conservation : décidez-en avec votre conseil juridique.';

/** Confirmation forte : le nom affiché, retapé à l'identique (espaces de bord ignorés). */
export function confirmationAnonymisation(saisie: string, nom: string): boolean {
  return saisie.trim() !== '' && saisie.trim() === nom.trim();
}

export function peutDemanderAnonymisation(
  actions: Actions,
  fiche: Pick<HrEmployeeView, 'status'>,
): boolean {
  return a(actions, 'hr.manage') && a(actions, 'hr.sensitive.read') && fiche.status === 'exited';
}

// ── Listes ──────────────────────────────────────────────────────────────────

/** Modèles proposés : la nature qui convient au statut d'abord, puis l'autre. */
export function modelesProposes(
  modeles: readonly ChecklistTemplateView[],
  fiche: Pick<HrEmployeeView, 'status'>,
): ChecklistTemplateView[] {
  const prioritaire: HrChecklistKind = fiche.status === 'exited' ? 'offboarding' : 'onboarding';
  return [...modeles].sort((x, y) => {
    const px = x.kind === prioritaire ? 0 : 1;
    const py = y.kind === prioritaire ? 0 : 1;
    return px - py || x.label.localeCompare(y.label, 'fr');
  });
}

/** « 3 sur 5 faits » (comptes de l'API). */
export function avancement(l: Pick<ChecklistView, 'done' | 'total'>): string {
  return `${l.done} sur ${l.total} fait${l.done >= 2 ? 's' : ''}`;
}

export function peutCocher(
  actions: Actions,
  item: Pick<ChecklistItemView, 'assigneeUserId'>,
  monUserId: string | null,
): boolean {
  return a(actions, 'hr.manage') || (monUserId !== null && item.assigneeUserId === monUserId);
}

/** État d'un élément, en texte (jamais par la seule couleur). */
export function etatElement(
  item: Pick<ChecklistItemView, 'doneAt' | 'dueDate'>,
  aujourdhui: string,
): { texte: string; retard: boolean } {
  if (item.doneAt)
    return { texte: `Fait le ${formatJour(item.doneAt.slice(0, 10))}`, retard: false };
  if (item.dueDate < aujourdhui) {
    return { texte: `En retard — prévu le ${formatJour(item.dueDate)}`, retard: true };
  }
  return { texte: `Pour le ${formatJour(item.dueDate)}`, retard: false };
}

export function libelleAssigne(
  item: Pick<ChecklistItemView, 'assigneeUserId'>,
  monUserId: string | null,
): string {
  return monUserId !== null && item.assigneeUserId === monUserId ? 'Vous' : 'Un membre';
}

const ROLES_ASSIGNE: Record<'hr' | 'manager' | 'employee', string> = {
  hr: 'Ressources humaines',
  manager: 'Manager',
  employee: 'Collaborateur',
};

/** Assigné d'un élément de MODÈLE (rôle symbolique ou personne nommée). */
export function libelleAssigneModele(x: HrChecklistAssignee): string {
  return typeof x === 'string' ? ROLES_ASSIGNE[x] : 'Une personne désignée';
}

/** Échéance relative d'un élément de modèle (« 3 jours avant », « le jour même »). */
export function libelleDecalage(jours: number, kind: HrChecklistKind): string {
  const pivot = kind === 'onboarding' ? 'l’entrée' : 'la sortie';
  if (jours === 0) return `le jour de ${pivot}`;
  const n = Math.abs(jours);
  return `${n} jour${n >= 2 ? 's' : ''} ${jours < 0 ? 'avant' : 'après'} ${pivot}`;
}
