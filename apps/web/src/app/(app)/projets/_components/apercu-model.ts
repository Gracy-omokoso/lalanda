// Mise en forme de l'Aperçu d'un projet (ADR-0057). Les chiffres viennent du
// serveur (`GET /work/projects/:id/overview`) ; ici, seulement des libellés.

import type {
  WorkOverviewHealth,
  WorkOverviewHealthReason,
  WorkProjectOverview,
} from '@lalanda/shared/work';
import type { StatusTone } from '@lalanda/ui';

import { formatJour } from './projets-model';

export const SANTE: Record<WorkOverviewHealth, { label: string; tone: StatusTone }> = {
  on_track: { label: 'En bonne voie', tone: 'ok' },
  at_risk: { label: 'À risque', tone: 'wait' },
  off_track: { label: 'En retard', tone: 'late' },
};

const RAISONS: Record<WorkOverviewHealthReason, string> = {
  PROJECT_DUE_PASSED: 'l’échéance du projet est dépassée et des tâches restent ouvertes',
  MANY_OVERDUE_TASKS: 'au moins 3 tâches en retard, soit le quart des tâches ouvertes ou plus',
  OVERDUE_TASKS: 'des tâches sont en retard',
  PROJECT_DUE_SOON: 'l’échéance du projet arrive dans 7 jours et moins de 75 % est terminé',
};

/** Phrase lisible du statut : « À risque : des tâches sont en retard. » */
export function phraseSante(h: WorkProjectOverview['health']): string {
  const base = SANTE[h.status].label;
  if (h.reasons.length === 0) return `${base} : aucune tâche en retard.`;
  return `${base} : ${h.reasons.map((r) => RAISONS[r]).join(' ; ')}.`;
}

/** Libellés de la courbe : « 2/11 » sous l'axe, « Semaine du 2 nov. 2026 » au survol. */
export function libellesSemaines(o: Pick<WorkProjectOverview, 'weeks'>): {
  courts: string[];
  complets: string[];
} {
  return {
    courts: o.weeks.map(
      (w) => `${Number(w.weekStart.slice(8, 10))}/${Number(w.weekStart.slice(5, 7))}`,
    ),
    complets: o.weeks.map((w) => `Semaine du ${formatJour(w.weekStart)}`),
  };
}

/** Pourcentage terminé (entier), 0 sans tâche. */
export function pourcentTermine(t: WorkProjectOverview['totals']): number {
  const total = t.open + t.done;
  return total === 0 ? 0 : Math.round((t.done / total) * 100);
}
