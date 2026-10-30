'use client';

// Onglet « Liste » d'un projet (ADR-0039 § 8, onglet par défaut) : les tâches
// dans l'ordre des colonnes puis du rang (le même que le Kanban), sous-tâches
// sous leur parent. Un clic sur le titre ouvre le panneau (`?tache=`).

import { EmptyState, Skeleton } from '@lalanda/ui';

import { AjoutRapide, BarreFiltres, CaseTerminee, useFiltres } from './barre-taches';
import {
  AbsenceBadges,
  BloqueeBadge,
  Echeance,
  Etiquettes,
  PrioriteBadge,
  Responsable,
} from './elements';
import { lignesListe } from './kanban-model';
import { useProjet } from './project-context';
import { formatMinutes } from './projets-model';
import { filtrerTaches } from './taches-model';

export function VueListe(): React.ReactElement {
  const { project, tasks, settings, today, chargement, ouvrirTache } = useProjet();
  const [filtres, setFiltres] = useFiltres();

  if (project === null) {
    return chargement ? <Skeleton className="h-64 w-full" /> : <></>;
  }
  const libelleColonne = new Map(project.columns.map((c) => [c.key, c.label]));
  const lignes = lignesListe(project.columns, filtrerTaches(tasks, filtres));
  const dueSoon = settings?.dueSoonDays ?? 1;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <BarreFiltres filtres={filtres} onChange={setFiltres} idPrefixe="liste" />
      <AjoutRapide idPrefixe="liste" />
      {tasks.length === 0 ? (
        <EmptyState
          title="Aucune tâche"
          description="Ajoutez la première tâche ci-dessus ; responsable, échéance et étiquettes se règlent dans son panneau."
        />
      ) : lignes.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Aucune tâche ne correspond aux filtres.
        </p>
      ) : (
        <ul
          aria-label="Tâches du projet"
          className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]"
        >
          {lignes.map(({ task: t, profondeur }) => (
            <li
              key={t.id}
              className={`flex min-w-0 flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3 ${profondeur === 1 ? 'pl-8 sm:pl-10' : ''}`}
            >
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <span className="pt-0.5">
                  <CaseTerminee task={t} />
                </span>
                <button
                  type="button"
                  onClick={() => ouvrirTache(t.id)}
                  className={`min-w-0 break-words text-left text-sm font-medium underline-offset-2 hover:underline ${t.done ? 'text-[var(--foreground-muted)] line-through' : ''}`}
                >
                  <span className="text-[var(--foreground-muted)]">#{t.number}</span>{' '}
                  {profondeur === 1 ? <span className="sr-only">Sous-tâche : </span> : null}
                  {t.title}
                </button>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2 pl-6 sm:pl-0">
                <span className="text-xs text-[var(--foreground-muted)]">
                  {libelleColonne.get(t.columnKey) ?? t.columnKey}
                </span>
                {t.blocked ? <BloqueeBadge /> : null}
                <PrioriteBadge priority={t.priority} />
                <Echeance task={t} today={today} dueSoonDays={dueSoon} />
                <Etiquettes keys={t.labelKeys} labels={settings?.labels ?? []} max={3} />
                {t.subtaskCount > 0 ? (
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {t.doneSubtaskCount}/{t.subtaskCount} sous-tâches
                  </span>
                ) : null}
                {t.loggedMinutes > 0 ? (
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {formatMinutes(t.loggedMinutes)}
                  </span>
                ) : null}
                <Responsable name={t.assignee?.name ?? null} compact />
                {/* ADR-0045 — H5 : assigné absent, échéance pendant l'absence. */}
                <AbsenceBadges t={t} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
