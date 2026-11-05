// Modèle des écrans « Importer un fichier » (ADR-0062) et « Construire avec
// l'IA » (ADR-0063). Pur : aucun appel, aucune horloge. Le serveur décide de
// tout (lecture, erreurs, corrections) ; l'écran ne fait que présenter.

import {
  WORK_PLAN_LIMITS,
  sprintCalendar,
  type CreateProjectFromPlanBody,
  type WorkAiDetailLevel,
  type WorkAiPlanDraft,
  type WorkAiPlanRequestBody,
  type WorkImportIssue,
  type WorkImportPreview,
  type WorkPlanTask,
} from '@lalanda/shared/work';

import { messageWork, statutHttp } from './projets-model';

// ── Import ──────────────────────────────────────────────────────────────────

export const IMPORT_HREF = '/projets/importer';
export const IA_HREF = '/projets/construire-ia';

/** Lien d'import vers un projet existant. */
export function hrefImportProjet(projectId: string): string {
  return `${IMPORT_HREF}?projet=${encodeURIComponent(projectId)}`;
}

export const FORMATS_ACCEPTES =
  '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Contrôle local AVANT envoi (le serveur revérifie) : extension et taille. */
export function fichierRefuse(file: { name: string; size: number }): string | null {
  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    return 'Format non pris en charge : choisissez un fichier .xlsx ou .csv (le modèle convient).';
  }
  if (file.size > WORK_PLAN_LIMITS.importFileMaxBytes) return 'Le fichier dépasse 2 Mo.';
  if (file.size === 0) return 'Le fichier est vide.';
  return null;
}

/** Problèmes rangés par ligne ; `null` = le fichier entier. */
export function problemesParLigne(
  issues: readonly WorkImportIssue[],
): Map<number | null, WorkImportIssue[]> {
  const out = new Map<number | null, WorkImportIssue[]>();
  for (const i of issues) out.set(i.row, [...(out.get(i.row) ?? []), i]);
  return out;
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Compteurs de l'aperçu, en clair. */
export function compteursApercu(
  p: WorkImportPreview,
): { id: string; libelle: string; valeur: number; alerte: boolean }[] {
  return [
    { id: 'lues', libelle: 'Lignes lues', valeur: p.counts.rows, alerte: false },
    { id: 'pretes', libelle: 'Prêtes à importer', valeur: p.counts.valid, alerte: false },
    {
      id: 'erreurs',
      libelle: 'En erreur (écartées)',
      valeur: p.counts.invalid,
      alerte: p.counts.invalid > 0,
    },
    { id: 'avert', libelle: 'Corrigées (à vérifier)', valeur: p.counts.warnings, alerte: false },
  ];
}

/** Ce que l'import créera, en une phrase. */
export function phraseApercu(p: WorkImportPreview): string {
  const parts = [pluriel(p.counts.valid, 'tâche', 'tâches')];
  if (p.counts.subtasks)
    parts.push(`dont ${pluriel(p.counts.subtasks, 'sous-tâche', 'sous-tâches')}`);
  if (p.counts.milestones) parts.push(pluriel(p.counts.milestones, 'jalon', 'jalons'));
  if (p.counts.dependencies)
    parts.push(pluriel(p.counts.dependencies, 'dépendance', 'dépendances'));
  const nouv: string[] = [];
  if (p.newSections.length)
    nouv.push(
      `${pluriel(p.newSections.length, 'section', 'sections')} (${p.newSections.join(', ')})`,
    );
  if (p.newLabels.length)
    nouv.push(
      `${pluriel(p.newLabels.length, 'étiquette', 'étiquettes')} (${p.newLabels.join(', ')})`,
    );
  return `${parts.join(', ')}${nouv.length ? ` ; à créer : ${nouv.join(' et ')}` : ''}.`;
}

/** Libellé du bouton d'import ; confirmation exigée s'il y a des lignes écartées. */
export function boutonImport(p: WorkImportPreview): {
  libelle: string;
  confirmer: boolean;
  actif: boolean;
} {
  if (p.counts.valid === 0) return { libelle: 'Rien à importer', confirmer: false, actif: false };
  if (p.counts.invalid > 0) {
    return {
      libelle: `Importer les ${p.counts.valid} lignes valides`,
      confirmer: true,
      actif: true,
    };
  }
  return {
    libelle: `Importer ${pluriel(p.counts.valid, 'tâche', 'tâches')}`,
    confirmer: false,
    actif: true,
  };
}

/** Heures lisibles d'une estimation en minutes (« 1,5 h »). */
export function heures(minutes: number | null): string {
  if (minutes === null) return '—';
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} h`;
}

/** Codes dont le message du serveur est le meilleur texte pour l'utilisateur. */
const CODES_SERVEUR = /^(IMPORT_|WORK_AI_|WORK_PLAN_|AI_QUOTA|WORK_TASK_LIMIT|WORK_PROJECT_LIMIT)/;

/** Message d'échec de l'import ou de l'IA : celui du serveur quand il est propre au parcours. */
export function messagePlan(err: unknown, repli: string): string {
  const d = (err as { detail?: unknown } | null)?.detail;
  const detail = typeof d === 'object' && d !== null ? (d as Record<string, unknown>) : null;
  const code = typeof detail?.['code'] === 'string' ? (detail['code'] as string) : null;
  const message = typeof detail?.['message'] === 'string' ? (detail['message'] as string) : null;
  if (message && code && CODES_SERVEUR.test(code)) return message;
  if (statutHttp(err) === 413) return 'Le fichier dépasse 2 Mo.';
  return messageWork(err, repli);
}

// ── Construire avec l'IA ────────────────────────────────────────────────────

export interface FormulaireIa {
  name: string;
  context: string;
  objective: string;
  deliverables: string;
  startDate: string;
  dueDate: string;
  memberUserIds: string[];
  sprintWeeks: 1 | 2 | 3;
  constraints: string;
  detail: WorkAiDetailLevel;
}

export function formulaireIa(today: string): FormulaireIa {
  return {
    name: '',
    context: '',
    objective: '',
    deliverables: '',
    startDate: today,
    dueDate: '',
    memberUserIds: [],
    sprintWeeks: 2,
    constraints: '',
    detail: 'standard',
  };
}

export const NIVEAUX_DETAIL: Record<WorkAiDetailLevel, string> = {
  light: 'Léger (≈ 12 tâches)',
  standard: 'Standard (≈ 25 tâches)',
  detailed: 'Détaillé (≈ 40 tâches)',
};

/** Nombre de sprints de la période (aperçu du formulaire ; le serveur recalcule). */
export function nombreSprints(
  f: Pick<FormulaireIa, 'startDate' | 'dueDate' | 'sprintWeeks'>,
): number {
  return sprintCalendar(f.startDate, f.dueDate, f.sprintWeeks).length;
}

export function preparerIa(
  f: FormulaireIa,
): { ok: true; corps: WorkAiPlanRequestBody } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  if (f.name.trim() === '') champs['name'] = 'Donnez un nom au projet.';
  if (f.objective.trim() === '')
    champs['objective'] = 'Décrivez l’objectif : c’est ce qui guide le plan.';
  if (!f.startDate) champs['startDate'] = 'Date de début obligatoire.';
  if (!f.dueDate) champs['dueDate'] = 'Date butoir obligatoire.';
  else if (f.startDate && f.dueDate < f.startDate)
    champs['dueDate'] = 'La date butoir précède le début.';
  if (
    !champs['dueDate'] &&
    !champs['startDate'] &&
    nombreSprints(f) > WORK_PLAN_LIMITS.aiSprintsMax
  ) {
    champs['sprintWeeks'] =
      `Plus de ${WORK_PLAN_LIMITS.aiSprintsMax} sprints : allongez les sprints ou rapprochez la date butoir.`;
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  const txt = (v: string) => (v.trim() === '' ? undefined : v.trim());
  return {
    ok: true,
    corps: {
      name: f.name.trim(),
      context: txt(f.context) ?? null,
      objective: f.objective.trim(),
      deliverables: txt(f.deliverables) ?? null,
      startDate: f.startDate,
      dueDate: f.dueDate,
      memberUserIds: f.memberUserIds,
      sprintWeeks: f.sprintWeeks,
      constraints: txt(f.constraints) ?? null,
      detail: f.detail,
    },
  };
}

/** Sprint (étiquette « Sprint N ») d'une tâche du plan, ou `null`. */
export function sprintDe(t: Pick<WorkPlanTask, 'labels'>): string | null {
  return (t.labels ?? []).find((l) => /^Sprint \d+$/.test(l)) ?? null;
}

/** Tâches regroupées par sprint, dans l'ordre des sprints ; jalons à part. */
export function groupesRelecture(
  draft: Pick<WorkAiPlanDraft, 'sprints'>,
  tasks: readonly WorkPlanTask[],
): {
  jalons: WorkPlanTask[];
  sprints: { label: string; periode: [string, string]; goal: string; taches: WorkPlanTask[] }[];
} {
  const jalons = tasks
    .filter((t) => t.isMilestone)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const sprints = draft.sprints.map((s) => ({
    label: s.label,
    periode: [s.startDate, s.endDate] as [string, string],
    goal: s.goal,
    taches: tasks.filter((t) => !t.isMilestone && sprintDe(t) === s.label),
  }));
  return { jalons, sprints };
}

/**
 * Retirer une tâche du plan relu : ses dépendants ne l'attendent plus, ses
 * sous-tâches éventuelles deviennent de premier niveau.
 */
export function retirerTache(tasks: readonly WorkPlanTask[], ref: string): WorkPlanTask[] {
  return tasks
    .filter((t) => t.ref !== ref)
    .map((t) => ({
      ...t,
      dependsOn: (t.dependsOn ?? []).filter((d) => d !== ref),
      parentRef: t.parentRef === ref ? null : (t.parentRef ?? null),
    }));
}

/** Modifier une tâche du plan relu (titre, échéance, responsable). */
export function modifierTache(
  tasks: readonly WorkPlanTask[],
  ref: string,
  patch: Partial<Pick<WorkPlanTask, 'title' | 'dueDate' | 'startDate' | 'assigneeUserId'>>,
): WorkPlanTask[] {
  return tasks.map((t) => {
    if (t.ref !== ref) return t;
    const next = { ...t, ...patch };
    // Une échéance avant le début ramène le début à l'échéance (le serveur exige l'ordre).
    if (next.startDate && next.dueDate && next.dueDate < next.startDate)
      next.startDate = next.dueDate;
    return next;
  });
}

/** Corps de création du projet relu (créateur commun, `origin: 'ai'`). */
export function corpsCreation(
  draft: Pick<WorkAiPlanDraft, 'draftId'>,
  f: FormulaireIa,
  description: string,
  tasks: readonly WorkPlanTask[],
): CreateProjectFromPlanBody {
  return {
    origin: 'ai',
    ...(draft.draftId ? { aiDraftId: draft.draftId } : {}),
    project: {
      name: f.name.trim(),
      description: description.trim() === '' ? null : description.trim().slice(0, 5_000),
      kind: 'internal',
      ownerUserId: null,
      startDate: f.startDate,
      dueDate: f.dueDate,
    },
    tasks: tasks.map((t) => ({ ...t })),
  };
}
