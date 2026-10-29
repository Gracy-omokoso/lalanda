// Logique pure de la Chronologie (Gantt) d'un projet (ADR-0039 § 8, lot L3b) :
// échelle (jour, semaine, mois), domaine affiché, graduations, géométrie des
// barres, des losanges et des flèches de dépendance fin → début, et nouvelles
// dates quand on déplace ou étire une barre (souris ou clavier).
//
// L'ordre des lignes et les conflits viennent de `ganttRows` (partagé avec
// l'API) : l'écran et le serveur ne divergent pas. Un conflit de dates est
// MONTRÉ (couleur + texte + trait pointillé), jamais corrigé : aucune date
// n'est déplacée automatiquement (décision ouverte n° 5, défaut retenu).
//
// Rendu SVG maison, sans bibliothèque (§ 8). Unités : pixels, jours civils.

import {
  addDays,
  dependencyConflicts,
  type GanttRow,
  type PatchWorkTaskBody,
  type WorkTaskView,
} from '@lalanda/shared/work';

import {
  dernierDuMois,
  ecartJours,
  jourSemaine,
  libelleMois,
  lundiDe,
  premierDuMois,
} from './calendar-model';
import { formatJour } from './projets-model';

// ─── Échelle et dimensions ──────────────────────────────────────────────────

export type Echelle = 'jour' | 'semaine' | 'mois';

export const ECHELLES: readonly { cle: Echelle; label: string }[] = [
  { cle: 'jour', label: 'Jour' },
  { cle: 'semaine', label: 'Semaine' },
  { cle: 'mois', label: 'Mois' },
];

/** Largeur d'un jour selon l'échelle. */
export const PX_PAR_JOUR: Record<Echelle, number> = { jour: 32, semaine: 12, mois: 4 };

export const HAUTEUR_LIGNE = 36;
export const HAUTEUR_BARRE = 20;
/** Bandeau des graduations (deux étages : majeures, mineures). */
export const HAUTEUR_ENTETE = 44;
/** Demi-diagonale du losange d'un jalon. */
export const RAYON_JALON = 8;
/** Largeur des poignées d'étirement, aux deux bouts d'une barre. */
export const POIGNEE = 6;

// ─── Domaine ────────────────────────────────────────────────────────────────

export interface Domaine {
  debut: string;
  fin: string;
  /** Nombre de jours affichés, bornes incluses. */
  jours: number;
}

const MARGE: Record<Echelle, number> = { jour: 3, semaine: 7, mois: 15 };

/**
 * Jours affichés : toutes les lignes ET aujourd'hui, avec une marge, alignés
 * sur le lundi (jour, semaine) ou le premier du mois (mois).
 */
export function domaine(
  rows: readonly Pick<GanttRow, 'start' | 'end'>[],
  today: string,
  echelle: Echelle,
): Domaine {
  let min = today;
  let max = today;
  for (const r of rows) {
    if (r.start < min) min = r.start;
    if (r.end > max) max = r.end;
  }
  min = addDays(min, -MARGE[echelle]);
  max = addDays(max, MARGE[echelle]);
  const debut = echelle === 'mois' ? premierDuMois(min) : lundiDe(min);
  const fin = echelle === 'mois' ? dernierDuMois(max) : addDays(lundiDe(max), 6);
  return { debut, fin, jours: ecartJours(debut, fin) + 1 };
}

/** Abscisse du DÉBUT d'un jour. */
export function xJour(day: string, dom: Domaine, echelle: Echelle): number {
  return ecartJours(dom.debut, day) * PX_PAR_JOUR[echelle];
}

export function largeurGraphique(dom: Domaine, echelle: Echelle): number {
  return dom.jours * PX_PAR_JOUR[echelle];
}

export function hauteurGraphique(lignes: number): number {
  return HAUTEUR_ENTETE + Math.max(1, lignes) * HAUTEUR_LIGNE;
}

// ─── Graduations ────────────────────────────────────────────────────────────

export interface Graduation {
  jour: string;
  x: number;
  label: string;
  /** Samedi ou dimanche (échelle jour : fond grisé). */
  weekend?: boolean;
}

/**
 * Graduations de l'en-tête : majeures (mois, ou années à l'échelle mois) et
 * mineures (jours, lundis, ou mois). La première majeure est toujours à x = 0.
 */
export function graduations(
  dom: Domaine,
  echelle: Echelle,
): { majeures: Graduation[]; mineures: Graduation[] } {
  const majeures: Graduation[] = [];
  const mineures: Graduation[] = [];
  for (let d = dom.debut; d <= dom.fin; d = addDays(d, 1)) {
    const x = xJour(d, dom, echelle);
    const premierDuMoisOuDebut = d.endsWith('-01') || d === dom.debut;
    if (echelle === 'mois') {
      if (d.slice(5) === '01-01' || d === dom.debut)
        majeures.push({ jour: d, x, label: d.slice(0, 4) });
      if (d.endsWith('-01')) mineures.push({ jour: d, x, label: libelleMois(d).split(' ')[0]! });
    } else {
      if (premierDuMoisOuDebut) majeures.push({ jour: d, x, label: libelleMois(d) });
      if (echelle === 'jour') {
        mineures.push({
          jour: d,
          x,
          label: String(Number(d.slice(8))),
          weekend: jourSemaine(d) >= 5,
        });
      } else if (jourSemaine(d) === 0) {
        mineures.push({ jour: d, x, label: formatJour(d, false) });
      }
    }
  }
  return { majeures, mineures };
}

// ─── Géométrie ──────────────────────────────────────────────────────────────

export interface BarreGeo {
  taskId: string;
  index: number;
  forme: GanttRow['shape'];
  depth: 0 | 1;
  conflit: boolean;
  /** Haut de la ligne (graphique, en-tête compris). */
  yLigne: number;
  /** Milieu vertical de la ligne. */
  yMilieu: number;
  /** Bord gauche et largeur de la barre (pour un jalon : boîte du losange). */
  x: number;
  largeur: number;
  /** Abscisses d'accroche des flèches : sortie (fin) et entrée (début). */
  xSortie: number;
  xEntree: number;
}

/** Bornes affichées d'une tâche (mêmes règles que `ganttRows`). */
export function bornes(t: {
  startDate: string | null;
  dueDate: string | null;
  isMilestone: boolean;
}): { start: string; end: string } | null {
  const end = t.dueDate ?? t.startDate;
  if (end === null) return null;
  const start = t.isMilestone ? end : (t.startDate ?? end);
  return { start, end: start > end ? start : end };
}

export function barres(rows: readonly GanttRow[], dom: Domaine, echelle: Echelle): BarreGeo[] {
  const px = PX_PAR_JOUR[echelle];
  return rows.map((r, index) => {
    const yLigne = HAUTEUR_ENTETE + index * HAUTEUR_LIGNE;
    const yMilieu = yLigne + HAUTEUR_LIGNE / 2;
    if (r.shape === 'milestone') {
      const cx = xJour(r.end, dom, echelle) + px / 2;
      return {
        taskId: r.taskId,
        index,
        forme: r.shape,
        depth: r.depth,
        conflit: r.conflict,
        yLigne,
        yMilieu,
        x: cx - RAYON_JALON,
        largeur: RAYON_JALON * 2,
        xSortie: cx + RAYON_JALON,
        xEntree: cx - RAYON_JALON,
      };
    }
    const x = xJour(r.start, dom, echelle);
    const largeur = (ecartJours(r.start, r.end) + 1) * px;
    return {
      taskId: r.taskId,
      index,
      forme: r.shape,
      depth: r.depth,
      conflit: r.conflict,
      yLigne,
      yMilieu,
      x,
      largeur,
      xSortie: x + largeur,
      xEntree: x,
    };
  });
}

/** Points du losange d'un jalon (attribut `points` d'un `<polygon>`). */
export function pointsLosange(b: BarreGeo): string {
  const cx = b.x + RAYON_JALON;
  const cy = b.yMilieu;
  const r = RAYON_JALON;
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

export interface Fleche {
  de: string;
  vers: string;
  /** Chemin SVG orthogonal, de la fin du prédécesseur au début du successeur. */
  d: string;
  /** Le successeur commence le jour de l'échéance du prédécesseur ou avant. */
  conflit: boolean;
}

const ECART_FLECHE = 8;

/**
 * Flèches fin → début. Si le successeur commence assez à droite : un coude
 * simple. Sinon le trait repart vers la gauche en passant ENTRE les deux
 * lignes, pour ne jamais traverser une barre. Le conflit est propre à l'arête
 * (même règle que `dependencyConflicts`).
 */
export function fleches(rows: readonly GanttRow[], geo: readonly BarreGeo[]): Fleche[] {
  const geoParId = new Map(geo.map((g) => [g.taskId, g]));
  const rowParId = new Map(rows.map((r) => [r.taskId, r]));
  const out: Fleche[] = [];
  for (const r of rows) {
    const vers = geoParId.get(r.taskId);
    if (!vers) continue;
    for (const predId of r.predecessorIds) {
      const de = geoParId.get(predId);
      const pred = rowParId.get(predId);
      if (!de || !pred) continue;
      const fx = de.xSortie;
      const fy = de.yMilieu;
      const tx = vers.xEntree;
      const ty = vers.yMilieu;
      let d: string;
      if (tx - fx >= ECART_FLECHE * 2) {
        const mx = fx + ECART_FLECHE;
        d = `M ${fx} ${fy} H ${mx} V ${ty} H ${tx}`;
      } else {
        const entre = ty > fy ? de.yLigne + HAUTEUR_LIGNE : de.yLigne;
        d = `M ${fx} ${fy} H ${fx + ECART_FLECHE} V ${entre} H ${tx - ECART_FLECHE} V ${ty} H ${tx}`;
      }
      out.push({ de: predId, vers: r.taskId, d, conflit: r.start <= pred.end });
    }
  }
  return out;
}

/** Ligne « aujourd'hui » au milieu du jour, ou `null` hors du domaine. */
export function xAujourdhui(today: string, dom: Domaine, echelle: Echelle): number | null {
  if (today < dom.debut || today > dom.fin) return null;
  return xJour(today, dom, echelle) + PX_PAR_JOUR[echelle] / 2;
}

// ─── Déplacer, étirer ───────────────────────────────────────────────────────

/** `deplacer` : la barre entière ; `debut` / `fin` : une poignée. */
export type ModeGeste = 'deplacer' | 'debut' | 'fin';

export interface DatesTache {
  startDate: string | null;
  dueDate: string | null;
}

/** Jours entiers correspondant à un glissement horizontal. */
export function joursDepuisPixels(dx: number, echelle: Echelle): number {
  const n = Math.round(dx / PX_PAR_JOUR[echelle]);
  return n === 0 ? 0 : n; // jamais -0
}

/**
 * Nouvelles dates après un geste de `delta` jours. Un jalon ne fait que se
 * déplacer (pas de début). Étirer ne retourne jamais la barre : la fin ne
 * passe pas avant le début, ni le début après la fin. Une date absente le
 * reste en déplacement ; l'étirement pose la date de la poignée tirée.
 */
export function nouvellesDates(
  t: DatesTache & { isMilestone: boolean },
  mode: ModeGeste,
  delta: number,
): DatesTache {
  const b = bornes(t);
  if (b === null || delta === 0) return { startDate: t.startDate, dueDate: t.dueDate };
  if (t.isMilestone || mode === 'deplacer') {
    return {
      startDate: t.isMilestone || t.startDate === null ? t.startDate : addDays(t.startDate, delta),
      dueDate: t.dueDate === null ? null : addDays(t.dueDate, delta),
    };
  }
  if (mode === 'fin') {
    const fin = addDays(b.end, delta);
    return { startDate: t.startDate, dueDate: fin < b.start ? b.start : fin };
  }
  const debut = addDays(b.start, delta);
  const borne = debut > b.end ? b.end : debut;
  return {
    startDate: borne === b.end && t.startDate === null ? null : borne,
    dueDate: t.dueDate,
  };
}

/**
 * Corps du `PATCH /work/tasks/:id` pour ces dates : seulement les champs qui
 * changent, avec la révision lue. `null` : rien n'a changé.
 */
export function corpsDates(
  t: DatesTache & { revision: number },
  dates: DatesTache,
): (PatchWorkTaskBody & { expectedRevision: number }) | null {
  const corps: PatchWorkTaskBody & { expectedRevision: number } = {
    expectedRevision: t.revision,
  };
  let change = false;
  if (dates.startDate !== t.startDate) {
    corps.startDate = dates.startDate;
    change = true;
  }
  if (dates.dueDate !== t.dueDate) {
    corps.dueDate = dates.dueDate;
    change = true;
  }
  return change ? corps : null;
}

/**
 * Équivalent clavier sur une barre : ← → déplacent d'un jour ; Maj + ← →
 * étirent l'échéance ; Alt + ← → la date de début. Un jalon ne fait que se
 * déplacer. `null` pour toute autre touche.
 */
export function gesteClavier(
  key: string,
  mods: { shift: boolean; alt: boolean },
  isMilestone: boolean,
): { mode: ModeGeste; delta: number } | null {
  const delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  if (delta === 0) return null;
  if (isMilestone) return { mode: 'deplacer', delta };
  if (mods.shift) return { mode: 'fin', delta };
  if (mods.alt) return { mode: 'debut', delta };
  return { mode: 'deplacer', delta };
}

// ─── Textes ─────────────────────────────────────────────────────────────────

type TacheTexte = Pick<
  WorkTaskView,
  'id' | 'number' | 'title' | 'startDate' | 'dueDate' | 'blockedBy' | 'isMilestone'
>;

/**
 * Conflits de dates en phrases (la couleur n'est jamais seule) : « #5 Pose
 * commence le 3 nov., sans attendre la fin de #2 Achat (échéance le 4 nov.) ».
 */
export function phrasesConflits(tasks: readonly TacheTexte[]): { taskId: string; texte: string }[] {
  const parId = new Map(tasks.map((t) => [t.id, t]));
  return dependencyConflicts(tasks).map((c) => {
    const t = parId.get(c.taskId)!;
    const p = parId.get(c.predecessorId)!;
    const debut = t.startDate ?? t.dueDate!;
    return {
      taskId: t.id,
      texte: `#${t.number} ${t.title} commence le ${formatJour(debut, false)}, sans attendre la fin de #${p.number} ${p.title} (échéance le ${formatJour(p.dueDate, false)}).`,
    };
  });
}

/** Description d'une barre pour les lecteurs d'écran. */
export function descriptionBarre(
  t: Pick<WorkTaskView, 'number' | 'title' | 'done'>,
  row: Pick<GanttRow, 'shape' | 'start' | 'end' | 'conflict'>,
): string {
  const dates =
    row.shape === 'milestone'
      ? `jalon le ${formatJour(row.end)}`
      : row.start === row.end
        ? `le ${formatJour(row.end)}`
        : `du ${formatJour(row.start)} au ${formatJour(row.end)}`;
  return [
    `#${t.number} ${t.title}`,
    dates,
    t.done ? 'terminée' : null,
    row.conflict ? 'conflit de dates avec un prédécesseur' : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Libellé d'un geste en attente (« Échéance : +2 jours »). */
export function libelleGeste(mode: ModeGeste, delta: number): string {
  const n = Math.abs(delta);
  const jours = `${delta > 0 ? '+' : '−'}${n} jour${n > 1 ? 's' : ''}`;
  const quoi = mode === 'deplacer' ? 'Déplacement' : mode === 'fin' ? 'Échéance' : 'Début';
  return `${quoi} : ${jours}`;
}
