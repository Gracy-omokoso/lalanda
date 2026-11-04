// Logique pure de la vue Liste « façon Asana » et des atomes partagés
// (ADR-0057) : groupes repliables par colonne, avatars, ton d'une échéance.
// Testée sans DOM ; les `.tsx` assemblent.

import type { WorkColumn, WorkTaskView } from '@lalanda/shared/work';

export interface LigneListe {
  task: WorkTaskView;
  profondeur: 0 | 1;
}

export interface GroupeListe {
  column: WorkColumn;
  lignes: LigneListe[];
  /** Tâches de premier niveau du groupe (le compteur de l'en-tête). */
  total: number;
  terminees: number;
}

function parRang(a: WorkTaskView, b: WorkTaskView): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.number - b.number;
}

/**
 * Un groupe par colonne du projet (ordre du projet, même s'il est vide : on y
 * ajoute une tâche en ligne). Dans un groupe : rang, puis chaque sous-tâche
 * juste sous son parent. Une sous-tâche dont le parent n'est pas affiché
 * (filtre) remonte au premier niveau du groupe de SA colonne. Une tâche dont la
 * colonne n'existe plus va dans la première colonne de même catégorie, sinon la
 * première (même règle que le Kanban : visible plutôt que perdue).
 */
export function groupesListe(
  columns: readonly WorkColumn[],
  tasks: readonly WorkTaskView[],
): GroupeListe[] {
  if (columns.length === 0) return [];
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
  const groupes = columns.map<GroupeListe & { racines: WorkTaskView[] }>((column) => ({
    column,
    lignes: [],
    total: 0,
    terminees: 0,
    racines: [],
  }));
  const parCle = new Map(groupes.map((g) => [g.column.key, g]));
  for (const r of racines) {
    const g =
      parCle.get(r.columnKey) ??
      groupes.find((x) => x.column.category === r.columnCategory) ??
      groupes[0]!;
    g.racines.push(r);
  }
  return groupes.map(({ racines: rs, ...g }) => {
    rs.sort(parRang);
    for (const r of rs) {
      g.lignes.push({ task: r, profondeur: 0 });
      for (const e of (enfants.get(r.id) ?? []).sort(parRang)) {
        g.lignes.push({ task: e, profondeur: 1 });
      }
    }
    g.total = rs.length;
    g.terminees = rs.filter((t) => t.done).length;
    return g;
  });
}

// ─── Avatars ────────────────────────────────────────────────────────────────

/** Teintes d'avatar : paires `--label-*-bg` / `--label-*-fg` (contrastes vérifiés). */
export const TEINTES_AVATAR = ['blue', 'green', 'purple', 'orange', 'teal', 'pink'] as const;
export type TeinteAvatar = (typeof TEINTES_AVATAR)[number];

/** Teinte stable d'un membre (même personne, même couleur partout). */
export function teinteAvatar(cle: string): TeinteAvatar {
  let h = 0;
  for (let i = 0; i < cle.length; i += 1) h = (h * 31 + cle.charCodeAt(i)) >>> 0;
  return TEINTES_AVATAR[h % TEINTES_AVATAR.length]!;
}

/** « Marie-Claire Ngalula » → « MN » ; « kevin » → « K ». */
export function initiales(nom: string): string {
  const mots = nom.split(/\s+/).filter(Boolean);
  const lettres = mots.slice(0, 2).map((m) => m[0]!.toUpperCase());
  return lettres.join('') || '?';
}

/** Pile d'avatars : les `max` premiers, puis « +n ». */
export function pileAvatars<T>(
  membres: readonly T[],
  max: number,
): { montres: T[]; reste: number } {
  const montres = membres.slice(0, Math.max(0, max));
  return { montres, reste: membres.length - montres.length };
}

// ─── Échéance « façon Asana » ───────────────────────────────────────────────

export type TonDate = 'retard' | 'aujourdhui' | 'demain' | 'normal' | 'terminee';

function jourSuivant(jour: string): string {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Ton d'une échéance dans une ligne : rouge en retard, vert aujourd'hui (et
 * demain), neutre sinon ; une tâche terminée n'est jamais « en retard ».
 * Le libellé écrit (« Aujourd'hui », « Demain », date) double toujours la couleur.
 */
export function tonDate(
  t: { done: boolean; dueDate: string | null },
  today: string,
): TonDate | null {
  if (t.dueDate === null) return null;
  if (t.done) return 'terminee';
  if (t.dueDate < today) return 'retard';
  if (t.dueDate === today) return 'aujourdhui';
  if (t.dueDate === jourSuivant(today)) return 'demain';
  return 'normal';
}
