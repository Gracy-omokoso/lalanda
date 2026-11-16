// Collaboration sur une tâche — ADR-0076 § 2 à § 4. Fonctions PURES, testées :
// collaborateurs proposés, abonnés, liste de contrôle, validation. Le serveur reste
// juge de chaque geste ; ces règles ne font que masquer ce qui serait refusé.

import {
  WORK_APPROVAL_STATE_LABELS,
  WORK_COLLAB_LIMITS,
  taskRights,
  type PutWorkChecklistBody,
  type WorkChecklistItemView,
  type WorkProjectRights,
  type WorkTaskApprovalSummary,
  type WorkTaskMyRights,
  type WorkTaskView,
} from '@lalanda/shared/work';

import type { WorkMemberOption } from '@/lib/work-api';

/** Personne proposée dans un sélecteur. */
export interface OptionPersonne {
  userId: string;
  name: string;
}

/**
 * Collaborateurs proposés : qui peut porter une tâche (`canUpdate`), voit le projet et
 * n'est pas Lecteur ; ni le responsable ni les collaborateurs déjà là. Stagiaire : soi
 * seulement.
 */
export function collaborateursProposes(
  members: readonly WorkMemberOption[],
  t: { assigneeUserId: string | null; collaboratorUserIds: readonly string[] },
  regle: { moi: string | null; soiSeulement: boolean },
): OptionPersonne[] {
  const pris = new Set([...(t.assigneeUserId ? [t.assigneeUserId] : []), ...t.collaboratorUserIds]);
  return members
    .filter(
      (m) =>
        m.canUpdate &&
        m.seesProject !== false &&
        m.projectRole !== 'viewer' &&
        !pris.has(m.userId) &&
        (!regle.soiSeulement || m.userId === regle.moi),
    )
    .map((m) => ({ userId: m.userId, name: m.name }));
}

/** Le Stagiaire ne retire que lui-même d'une liste de collaborateurs. */
export function collaborateurRetirable(
  userId: string,
  regle: { moi: string | null; soiSeulement: boolean },
): boolean {
  return !regle.soiSeulement || userId === regle.moi;
}

/** Abonnés proposés : membres qui voient le projet, pas encore abonnés. */
export function abonnesProposes(
  members: readonly WorkMemberOption[],
  abonnes: readonly string[],
): OptionPersonne[] {
  const deja = new Set(abonnes);
  return members
    .filter((m) => m.seesProject !== false && !deja.has(m.userId))
    .map((m) => ({ userId: m.userId, name: m.name }));
}

/** « 3/5 » ou `null` sans liste de contrôle. */
export function progressionListe(t: Pick<WorkTaskView, 'checklistDone' | 'checklistTotal'>): {
  texte: string;
  complet: boolean;
} | null {
  const total = t.checklistTotal ?? 0;
  if (total <= 0) return null;
  const faits = Math.min(t.checklistDone ?? 0, total);
  return { texte: `${faits}/${total}`, complet: faits === total };
}

/** Élément éditable de la liste (sans les auteurs, posés par le serveur). */
export type ElementListe = PutWorkChecklistBody['items'][number];

export function elementsDe(items: readonly WorkChecklistItemView[]): ElementListe[] {
  return items.map((i) => ({ id: i.id, text: i.text, done: i.done }));
}

/** Ajoute un élément (texte rogné) ; `null` si vide ou si la liste est pleine. */
export function ajouterElement(
  items: readonly ElementListe[],
  texte: string,
): ElementListe[] | null {
  const t = texte.trim().slice(0, WORK_COLLAB_LIMITS.checklistTextMax);
  if (t === '' || items.length >= WORK_COLLAB_LIMITS.checklistItemsMax) return null;
  return [...items, { text: t, done: false }];
}

export function basculerElement(items: readonly ElementListe[], index: number): ElementListe[] {
  return items.map((i, k) => (k === index ? { ...i, done: !i.done } : i));
}

export function retirerElement(items: readonly ElementListe[], index: number): ElementListe[] {
  return items.filter((_, k) => k !== index);
}

/** Déplace un élément d'un cran (`-1` : vers le haut) ; inchangé au bord. */
export function deplacerElement(
  items: readonly ElementListe[],
  index: number,
  delta: -1 | 1,
): ElementListe[] {
  const j = index + delta;
  if (j < 0 || j >= items.length) return [...items];
  const out = [...items];
  [out[index], out[j]] = [out[j]!, out[index]!];
  return out;
}

/** Libellé de l'état de validation, ou `null` sans validation. */
export function libelleValidation(a: WorkTaskApprovalSummary | null | undefined): string | null {
  if (!a || !a.required) return null;
  return WORK_APPROVAL_STATE_LABELS[a.state];
}

/** Pastille « À valider » des cartes et de la liste : validation en attente. */
export function enAttenteDeValidation(t: Pick<WorkTaskView, 'approval'>): boolean {
  return t.approval?.required === true && t.approval.state === 'pending';
}

/** Une décision exige-t-elle un motif ? (Demander des modifications, Refuser.) */
export function motifRequis(decision: 'approve' | 'request_changes' | 'reject'): boolean {
  return decision !== 'approve';
}

/**
 * Droits d'affichage d'une tâche : ceux du serveur (`myRights`), sinon (instance N-1)
 * ceux de la règle partagée avec les droits du projet, sinon le droit d'organisation.
 */
export function droitsTache(
  t: Pick<WorkTaskView, 'assignee' | 'collaboratorUserIds' | 'createdBy'> & {
    myRights?: WorkTaskMyRights;
  },
  ctx: {
    moi: string | null;
    travailler: boolean;
    droitsProjet: WorkProjectRights | null;
    parent?: Pick<WorkTaskView, 'assignee'> | null;
  },
): WorkTaskMyRights {
  if (!ctx.travailler) {
    return {
      canEdit: false,
      canComplete: false,
      canCheck: false,
      canSubmit: false,
      canDecide: false,
      canManage: false,
    };
  }
  if (t.myRights) return t.myRights;
  if (ctx.droitsProjet && ctx.moi) {
    const r = taskRights({
      userId: ctx.moi,
      project: ctx.droitsProjet,
      task: {
        assigneeUserId: t.assignee?.userId ?? null,
        collaboratorUserIds: t.collaboratorUserIds ?? [],
        createdBy: t.createdBy ?? null,
      },
      parent: ctx.parent ? { assigneeUserId: ctx.parent.assignee?.userId ?? null } : null,
    });
    return { ...r, canSubmit: false, canDecide: false, canManage: ctx.droitsProjet.canManage };
  }
  return {
    canEdit: true,
    canComplete: true,
    canCheck: true,
    canSubmit: false,
    canDecide: false,
    canManage: false,
  };
}
