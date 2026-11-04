'use client';

// Onglet « Tableau » (Kanban) d'un projet (ADR-0039 § 8, ADR-0057 : cartes
// épurées façon Asana, « + Ajouter une tâche » en bas de chaque colonne) : colonnes = statuts propres au
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
import { GitBranch, MessageSquare } from 'lucide-react';
import { useState } from 'react';

import { workApi } from '@/lib/work-api';

import { AjoutEnLigne, BarreFiltres, CaseTerminee, useFiltres } from './barre-taches';
import {
  AbsenceBadges,
  Avatar,
  BloqueeBadge,
  DateEcheance,
  Etiquettes,
  PrioriteBadge,
} from './elements';
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
        aria-label="Tableau des tâches"
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
              <AjoutEnLigne
                columnKey={col.column.key}
                idPrefixe={`kanban-${col.column.key}`}
                variante="carte"
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
  const { nbCommentaires } = useProjet();
  const commentaires = nbCommentaires(t.id);
  const options = travailler ? optionsDeplacement(colonnes, t) : [];
  const idMenu = `deplacer-${t.id}`;
  return (
    <li
      draggable={travailler}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group/carte relative flex min-w-0 flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-[var(--motion-fast)] hover:border-[var(--border-strong)] ${glissee ? 'opacity-50' : ''} ${travailler ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {indicateur ? (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 left-1 right-1 h-1 rounded-full bg-[var(--accent)]"
        />
      ) : null}
      <div className="flex min-w-0 items-start gap-2">
        <span className="relative z-[1] pt-0.5">
          <CaseTerminee task={t} />
        </span>
        <button
          type="button"
          onClick={onOuvrir}
          className={`min-w-0 break-words text-left font-medium leading-snug after:absolute after:inset-0 after:content-[''] ${t.done ? 'text-[var(--foreground-muted)] line-through' : ''}`}
        >
          {t.title}
        </button>
      </div>
      {t.blocked || t.priority !== 'none' || t.labelKeys.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {t.blocked ? <BloqueeBadge /> : null}
          <PrioriteBadge priority={t.priority} />
          <Etiquettes keys={t.labelKeys} labels={labels} max={2} />
        </div>
      ) : null}
      <div className="relative z-[1] flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-[var(--foreground-muted)]">
          {t.assignee ? (
            <Avatar name={t.assignee.name} cle={t.assignee.userId} taille={24} />
          ) : null}
          <DateEcheance task={t} today={today} />
          {t.subtaskCount > 0 ? (
            <span className="inline-flex items-center gap-0.5" title="Sous-tâches terminées">
              <GitBranch aria-hidden="true" className="h-3.5 w-3.5" />
              {t.doneSubtaskCount}/{t.subtaskCount}
              <span className="sr-only"> sous-tâches terminées</span>
            </span>
          ) : null}
          {commentaires > 0 ? (
            <span className="inline-flex items-center gap-0.5" title="Commentaires">
              <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
              {commentaires}
              <span className="sr-only"> commentaire{commentaires > 1 ? 's' : ''}</span>
            </span>
          ) : null}
          {/* ADR-0045 — H5 : assigné absent, échéance pendant l'absence. */}
          <AbsenceBadges t={t} />
        </span>
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
              className="max-w-[9rem] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-xs transition-opacity duration-[var(--motion-fast)] focus:opacity-100 sm:opacity-0 sm:group-focus-within/carte:opacity-100 sm:group-hover/carte:opacity-100"
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
