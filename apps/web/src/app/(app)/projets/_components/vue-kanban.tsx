'use client';

// Onglet « Kanban » d'un projet (ADR-0039 § 8) : colonnes = statuts propres au
// projet. Glisser-déposer entre colonnes ET équivalent clavier / tactile (menu
// « Déplacer… » sur chaque carte : monter, descendre, vers une colonne) —
// accessibilité ADR-0030 § 5. Le rang est calculé par `rankBetween` pour
// l'affichage optimiste ; le serveur fait foi (`POST /work/tasks/:id/move`).
//
// Téléphone : une colonne occupe presque l'écran, et la zone du tableau défile
// horizontalement À L'INTÉRIEUR d'elle-même (la page, elle, ne déborde pas).
// La zone est `relative` : sans cela, les textes `sr-only` (positionnés en
// absolu) des colonnes lointaines prennent la page pour bloc conteneur,
// échappent au défilement et élargissent tout l'écran sur téléphone.

import type { WorkColumn, WorkTaskView } from '@lalanda/shared/work';
import { Skeleton } from '@lalanda/ui';
import { useState } from 'react';

import { workApi } from '@/lib/work-api';

import { AjoutRapide, BarreFiltres, CaseTerminee, useFiltres } from './barre-taches';
import { BloqueeBadge, Echeance, Etiquettes, PrioriteBadge, Responsable } from './elements';
import {
  appliquerDeplacement,
  colonnesKanban,
  indexDepot,
  optionsDeplacement,
  placer,
  repereCategorie,
  type ColonneKanban,
} from './kanban-model';
import { useProjet } from './project-context';
import { CATEGORIES_COLONNE } from './projets-model';
import { filtrerTaches } from './taches-model';

const TYPE_GLISSE = 'application/x-lalanda-tache';

export function VueKanban(): React.ReactElement {
  const {
    project,
    tasks,
    settings,
    today,
    chargement,
    travailler,
    ouvrirTache,
    setTasks,
    appliquerEcriture,
    signalerErreur,
    recharger,
  } = useProjet();
  const [filtres, setFiltres] = useFiltres();
  const [glisse, setGlisse] = useState<string | null>(null);
  const [survol, setSurvol] = useState<{ col: string; avant: string | null } | null>(null);
  const [annonce, setAnnonce] = useState('');

  if (project === null) {
    return chargement ? <Skeleton className="h-64 w-full" /> : <></>;
  }

  // Placement calculé sur TOUTES les tâches (les filtres ne changent que l'affichage).
  const completes = colonnesKanban(project.columns, tasks);
  const affichees = colonnesKanban(project.columns, filtrerTaches(tasks, filtres));
  const dueSoon = settings?.dueSoonDays ?? 1;

  async function deplacer(task: WorkTaskView, column: WorkColumn, index: number): Promise<void> {
    const cible = completes.find((c) => c.column.key === column.key);
    if (!cible) return;
    const p = placer(task, column.key, cible.taches, index);
    if (p === null) return;
    setTasks((t) => appliquerDeplacement(t, task.id, column, p.rang));
    setAnnonce(`#${task.number} déplacée vers « ${column.label} ».`);
    try {
      appliquerEcriture(await workApi.moveTask(task.id, p.corps));
    } catch (err) {
      signalerErreur(err, 'Déplacement impossible.');
      recharger();
    }
  }

  function deposer(e: React.DragEvent, col: ColonneKanban, avant: string | null): void {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData(TYPE_GLISSE) || glisse;
    setGlisse(null);
    setSurvol(null);
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const cible = completes.find((c) => c.column.key === col.column.key)!;
    void deplacer(task, col.column, indexDepot(cible.taches, task.id, avant));
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <BarreFiltres filtres={filtres} onChange={setFiltres} idPrefixe="kanban" />
      <p className="sr-only" aria-live="polite">
        {annonce}
      </p>
      {travailler ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Glissez une carte d’une colonne à l’autre, ou utilisez son menu « Déplacer » (clavier et
          écran tactile).
        </p>
      ) : null}
      <div
        className="relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0"
        role="region"
        aria-label="Tableau Kanban"
        tabIndex={0}
      >
        {affichees.map((col) => {
          const enSurvol = survol?.col === col.column.key;
          return (
            <section
              key={col.column.key}
              aria-label={`Colonne ${col.column.label}, ${col.taches.length} tâche${col.taches.length > 1 ? 's' : ''}`}
              className={`flex w-[82vw] max-w-[20rem] shrink-0 snap-start flex-col gap-2 rounded-[var(--radius-lg)] border bg-[var(--surface-muted)] p-2.5 sm:w-72 ${enSurvol ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
              onDragOver={(e) => {
                if (!travailler || glisse === null) return;
                e.preventDefault();
                if (!enSurvol || survol?.avant !== null)
                  setSurvol({ col: col.column.key, avant: null });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSurvol(null);
              }}
              onDrop={(e) => deposer(e, col, null)}
            >
              <h3 className="flex items-center justify-between gap-2 px-1 text-sm font-semibold">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span aria-hidden="true">{repereCategorie(col.column.category)}</span>
                  <span className="truncate">{col.column.label}</span>
                  <span className="sr-only">({CATEGORIES_COLONNE[col.column.category]})</span>
                </span>
                <span className="text-xs font-normal text-[var(--foreground-muted)]">
                  {col.taches.length}
                </span>
              </h3>
              <ul className="flex min-h-[3rem] flex-col gap-2">
                {col.taches.map((t) => (
                  <Carte
                    key={t.id}
                    t={t}
                    colonnes={completes}
                    labels={settings?.labels ?? []}
                    today={today}
                    dueSoon={dueSoon}
                    travailler={travailler}
                    glissee={glisse === t.id}
                    indicateur={enSurvol && survol?.avant === t.id}
                    onOuvrir={() => ouvrirTache(t.id)}
                    onDeplacer={(colKey, index) => {
                      const c = project.columns.find((x) => x.key === colKey);
                      if (c) void deplacer(t, c, index);
                    }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TYPE_GLISSE, t.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setGlisse(t.id);
                    }}
                    onDragEnd={() => {
                      setGlisse(null);
                      setSurvol(null);
                    }}
                    onDragOver={(e) => {
                      if (!travailler || glisse === null) return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (survol?.avant !== t.id) setSurvol({ col: col.column.key, avant: t.id });
                    }}
                    onDrop={(e) => deposer(e, col, t.id)}
                  />
                ))}
                {enSurvol && survol?.avant === null ? (
                  <li aria-hidden="true" className="h-1 rounded-full bg-[var(--accent)]" />
                ) : null}
              </ul>
              <AjoutRapide
                columnKey={col.column.key}
                idPrefixe={`kanban-${col.column.key}`}
                compact
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Carte({
  t,
  colonnes,
  labels,
  today,
  dueSoon,
  travailler,
  glissee,
  indicateur,
  onOuvrir,
  onDeplacer,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  t: WorkTaskView;
  colonnes: ColonneKanban[];
  labels: Parameters<typeof Etiquettes>[0]['labels'];
  today: string;
  dueSoon: number;
  travailler: boolean;
  glissee: boolean;
  indicateur: boolean;
  onOuvrir: () => void;
  onDeplacer: (columnKey: string, index: number) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}): React.ReactElement {
  const options = travailler ? optionsDeplacement(colonnes, t) : [];
  const idMenu = `deplacer-${t.id}`;
  return (
    <li
      draggable={travailler}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative flex min-w-0 flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-sm shadow-[var(--shadow-card)] ${glissee ? 'opacity-50' : ''} ${travailler ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {indicateur ? (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 left-1 right-1 h-1 rounded-full bg-[var(--accent)]"
        />
      ) : null}
      <div className="flex min-w-0 items-start gap-2">
        <span className="pt-0.5">
          <CaseTerminee task={t} />
        </span>
        <button
          type="button"
          onClick={onOuvrir}
          className={`min-w-0 break-words text-left font-medium underline-offset-2 hover:underline ${t.done ? 'text-[var(--foreground-muted)] line-through' : ''}`}
        >
          <span className="text-[var(--foreground-muted)]">#{t.number}</span> {t.title}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {t.blocked ? <BloqueeBadge /> : null}
        <PrioriteBadge priority={t.priority} />
        <Echeance task={t} today={today} dueSoonDays={dueSoon} />
        <Etiquettes keys={t.labelKeys} labels={labels} max={2} />
        {t.subtaskCount > 0 ? (
          <span className="text-xs text-[var(--foreground-muted)]">
            {t.doneSubtaskCount}/{t.subtaskCount} sous-tâches
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Responsable name={t.assignee?.name ?? null} compact={t.assignee !== null} />
        {options.length > 0 ? (
          <>
            <label htmlFor={idMenu} className="sr-only">
              Déplacer #{t.number} {t.title}
            </label>
            <select
              id={idMenu}
              value=""
              onChange={(e) => {
                const o = options.find((x) => x.id === e.target.value);
                if (o) onDeplacer(o.columnKey, o.index);
              }}
              className="max-w-[9rem] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-xs"
            >
              <option value="">Déplacer…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
    </li>
  );
}
