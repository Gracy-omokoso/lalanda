// Logique pure du Kanban et de la vue liste (ADR-0039 § 2.3 et § 8).
//
// Colonnes = statuts PROPRES AU PROJET (`project.columns`). L'ordre dans une
// colonne suit le rang fractionnaire `rank` (`rankBetween`, partagé avec le
// serveur) : la vue liste suit le même rang. Le déplacement (glisser-déposer ou
// menu clavier « Déplacer vers… ») produit le corps de `POST /work/tasks/:id/move`
// et une mise à jour OPTIMISTE locale, que la réponse du serveur remplace.

import {
  rankBetween,
  type MoveWorkTaskBody,
  type WorkColumn,
  type WorkColumnCategory,
  type WorkTaskView,
} from '@lalanda/shared/work';

export interface ColonneKanban {
  column: WorkColumn;
  /** Tâches de premier niveau de la colonne, triées par rang. */
  taches: WorkTaskView[];
}

function parRang(a: WorkTaskView, b: WorkTaskView): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.number - b.number;
}

/**
 * Répartit les tâches de PREMIER NIVEAU dans les colonnes du projet. Les
 * sous-tâches restent dans le panneau de leur parent (compteur sur la carte).
 * Une tâche dont la colonne n'existe plus (réglage en cours d'écriture) va
 * dans la première colonne de même catégorie, sinon la première : elle reste
 * visible plutôt que perdue.
 */
export function colonnesKanban(
  columns: readonly WorkColumn[],
  tasks: readonly WorkTaskView[],
): ColonneKanban[] {
  const cols = columns.map((column) => ({ column, taches: [] as WorkTaskView[] }));
  if (cols.length === 0) return [];
  const parCle = new Map(cols.map((c) => [c.column.key, c]));
  for (const t of tasks) {
    if (t.parentTaskId !== null) continue;
    const cible =
      parCle.get(t.columnKey) ??
      cols.find((c) => c.column.category === t.columnCategory) ??
      cols[0]!;
    cible.taches.push(t);
  }
  for (const c of cols) c.taches.sort(parRang);
  return cols;
}

/**
 * Vue liste : colonnes dans l'ordre du projet, rang dans la colonne, chaque
 * sous-tâche juste sous son parent (profondeur 1). Une sous-tâche dont le
 * parent n'est pas dans la liste (filtre) remonte au premier niveau.
 */
export function lignesListe(
  columns: readonly WorkColumn[],
  tasks: readonly WorkTaskView[],
): { task: WorkTaskView; profondeur: 0 | 1 }[] {
  const presents = new Set(tasks.map((t) => t.id));
  const enfants = new Map<string, WorkTaskView[]>();
  const racines: WorkTaskView[] = [];
  for (const t of tasks) {
    if (t.parentTaskId !== null && presents.has(t.parentTaskId)) {
      const l = enfants.get(t.parentTaskId) ?? [];
      l.push(t);
      enfants.set(t.parentTaskId, l);
    } else racines.push(t);
  }
  const ordreColonne = new Map(columns.map((c, i) => [c.key, i]));
  racines.sort((a, b) => {
    const ca = ordreColonne.get(a.columnKey) ?? columns.length;
    const cb = ordreColonne.get(b.columnKey) ?? columns.length;
    return ca !== cb ? ca - cb : parRang(a, b);
  });
  const lignes: { task: WorkTaskView; profondeur: 0 | 1 }[] = [];
  for (const r of racines) {
    lignes.push({ task: r, profondeur: 0 });
    for (const e of (enfants.get(r.id) ?? []).sort(parRang))
      lignes.push({ task: e, profondeur: 1 });
  }
  return lignes;
}

export interface Placement {
  /** Corps de `POST /work/tasks/:id/move`. */
  corps: MoveWorkTaskBody;
  /** Rang calculé localement, pour l'affichage optimiste. */
  rang: string;
}

/**
 * Place `task` dans la colonne `columnKey` à l'index `index` de `tachesCible`
 * (liste ordonnée de la colonne d'arrivée, la tâche déplacée pouvant y figurer
 * déjà). Voisines : `afterTaskId` = la tâche juste AU-DESSUS (on se place après
 * elle), `beforeTaskId` = la tâche juste EN DESSOUS — même sens que
 * `afterTaskId` à la création (« insérer juste après cette tâche »).
 *
 * Rend `null` si le geste ne change rien (même colonne, même place).
 */
export function placer(
  task: WorkTaskView,
  columnKey: string,
  tachesCible: readonly WorkTaskView[],
  index: number,
): Placement | null {
  const sans = tachesCible.filter((t) => t.id !== task.id);
  const i = Math.max(0, Math.min(index, sans.length));
  const dessus = sans[i - 1] ?? null;
  const dessous = sans[i] ?? null;
  if (task.columnKey === columnKey) {
    const avant = tachesCible.findIndex((t) => t.id === task.id);
    if (avant !== -1 && avant === i) return null;
  }
  let rang: string;
  try {
    rang = rankBetween(dessus?.rank ?? null, dessous?.rank ?? null);
  } catch {
    // Rangs égaux ou mal formés côté données : le serveur tranchera ; on garde
    // l'ancien rang pour l'affichage, qui sera remplacé par la réponse.
    rang = task.rank;
  }
  const corps: MoveWorkTaskBody = {
    columnKey,
    expectedRevision: task.revision,
    ...(dessus ? { afterTaskId: dessus.id } : {}),
    ...(dessous ? { beforeTaskId: dessous.id } : {}),
  };
  return { corps, rang };
}

/**
 * Index d'insertion (dans la colonne SANS la tâche déplacée) quand on dépose
 * AVANT la carte `cibleId` ; `null` = en fin de colonne.
 */
export function indexDepot(
  tachesCible: readonly WorkTaskView[],
  taskId: string,
  cibleId: string | null,
): number {
  const sans = tachesCible.filter((t) => t.id !== taskId);
  if (cibleId === null) return sans.length;
  const j = sans.findIndex((t) => t.id === cibleId);
  return j === -1 ? sans.length : j;
}

/**
 * Mise à jour optimiste : la tâche change de colonne et de rang ; `done` suit
 * la catégorie de la colonne (le serveur dénormalise de même, § 2.3).
 */
export function appliquerDeplacement(
  tasks: readonly WorkTaskView[],
  taskId: string,
  column: WorkColumn,
  rang: string,
): WorkTaskView[] {
  return tasks.map((t) =>
    t.id === taskId
      ? {
          ...t,
          columnKey: column.key,
          columnCategory: column.category,
          done: column.category === 'done',
          rank: rang,
        }
      : t,
  );
}

/** Remplace une tâche par la version du serveur (ou l'ajoute si nouvelle). */
export function remplacerTache(tasks: readonly WorkTaskView[], task: WorkTaskView): WorkTaskView[] {
  const i = tasks.findIndex((t) => t.id === task.id);
  if (i === -1) return [...tasks, task];
  const copie = [...tasks];
  copie[i] = task;
  return copie;
}

/** Recalcule `blocked` après un changement d'état terminé (lecture, jamais stockée). */
export function recalculerBlocages(tasks: readonly WorkTaskView[]): WorkTaskView[] {
  const done = new Map(tasks.map((t) => [t.id, t.done]));
  return tasks.map((t) => {
    const blocked = t.blockedBy.some((d) => done.get(d.taskId) === false);
    return blocked === t.blocked ? t : { ...t, blocked };
  });
}

// ─── Menu clavier « Déplacer vers… » (accessibilité ADR-0030 § 5) ───────────

export interface OptionDeplacement {
  id: string;
  label: string;
  columnKey: string;
  index: number;
}

/**
 * Gestes proposés au clavier et au toucher pour une carte : monter, descendre
 * (dans la colonne), puis chaque autre colonne (en fin de colonne). Équivalent
 * du glisser-déposer, qui n'existe ni au clavier ni au doigt.
 */
export function optionsDeplacement(
  colonnes: readonly ColonneKanban[],
  task: WorkTaskView,
): OptionDeplacement[] {
  const options: OptionDeplacement[] = [];
  const ici = colonnes.find((c) => c.taches.some((t) => t.id === task.id));
  if (ici) {
    const i = ici.taches.findIndex((t) => t.id === task.id);
    if (i > 0) {
      options.push({ id: 'monter', label: 'Monter', columnKey: ici.column.key, index: i - 1 });
    }
    if (i < ici.taches.length - 1) {
      options.push({
        id: 'descendre',
        label: 'Descendre',
        columnKey: ici.column.key,
        index: i + 1,
      });
    }
  }
  for (const c of colonnes) {
    if (c === ici) continue;
    options.push({
      id: `colonne:${c.column.key}`,
      label: `Vers « ${c.column.label} »`,
      columnKey: c.column.key,
      index: c.taches.length,
    });
  }
  return options;
}

/** Libellé lisible d'une catégorie, pour l'en-tête de colonne (texte, pas couleur). */
export function repereCategorie(category: WorkColumnCategory): string {
  return category === 'done' ? '✓' : category === 'in_progress' ? '◐' : '○';
}
