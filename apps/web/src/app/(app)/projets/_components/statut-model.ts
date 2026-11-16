// Statut DÉCLARÉ d'un projet — ADR-0076 § 5. Fonctions pures, testées.
//
// Il s'affiche à côté de la santé CALCULÉE (`overviewHealth`), jamais à sa place :
// l'une est l'avis du chef de projet, l'autre le constat des échéances.

import {
  WORK_PROJECT_STATUS_LABELS,
  WORK_PROJECT_STATUS_VALUES,
  type WorkProjectStatusValue,
  type WorkProjectStatusView,
} from '@lalanda/shared/work';
import type { StatusTone } from '@lalanda/ui';

export const TONS_STATUT: Readonly<Record<WorkProjectStatusValue, StatusTone>> = {
  on_track: 'ok',
  at_risk: 'wait',
  off_track: 'late',
  done: 'open',
};

export const OPTIONS_STATUT = WORK_PROJECT_STATUS_VALUES.map((v) => ({
  value: v,
  label: WORK_PROJECT_STATUS_LABELS[v],
}));

/** « À risque · 16/11/2026 · Awa » (date `AAAA-MM-JJ` → `JJ/MM/AAAA`). */
export function resumeStatut(s: Pick<WorkProjectStatusView, 'status' | 'date' | 'author'>): string {
  const [a, m, j] = s.date.split('-');
  return `${WORK_PROJECT_STATUS_LABELS[s.status]} · ${j}/${m}/${a} · ${s.author.name}`;
}

/** Corps de publication : texte rogné, date facultative (défaut : aujourd'hui serveur). */
export function corpsStatut(f: {
  status: WorkProjectStatusValue;
  text: string;
  date: string;
}): { status: WorkProjectStatusValue; text: string; date?: string } | null {
  const text = f.text.trim();
  if (text === '') return null;
  return { status: f.status, text, ...(f.date ? { date: f.date } : {}) };
}
