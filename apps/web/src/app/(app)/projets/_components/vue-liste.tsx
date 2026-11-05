'use client';

// Onglet « Liste » d'un projet, façon Asana (ADR-0057) : un groupe repliable par
// colonne (statut), lignes denses (`--row-h`) avec cercle à cocher, nom éditable
// sur place, responsable, échéance colorée, priorité, étiquettes et compteurs ;
// « + Ajouter une tâche » en bas de chaque groupe (Entrée pour enchaîner) et
// « + Ajouter une section » (nouvelle colonne) pour un gestionnaire.
// Un clic sur la ligne (hors nom) ou sur « Détails » ouvre le panneau (`?tache=`).

import { WORK_LIMITS, WorkColumnsSchema, type WorkTaskView } from '@lalanda/shared/work';
import { Skeleton } from '@lalanda/ui';
import { ChevronDown, ChevronRight, GitBranch, MessageSquare } from 'lucide-react';
import { useState } from 'react';

import { workApi } from '@/lib/work-api';

import { AjoutEnLigne, BarreFiltres, CaseTerminee, useFiltres } from './barre-taches';
import { BoutonImporterTaches } from './import-entrees';
import {
  AbsenceBadges,
  Avatar,
  BloqueeBadge,
  DateEcheance,
  Etiquettes,
  PrioriteBadge,
} from './elements';
import { groupesListe } from './liste-model';
import { useProjet } from './project-context';
import { cleDepuisLibelle, messageWork } from './projets-model';
import { filtrerTaches, filtresActifs } from './taches-model';

/** Gabarit des colonnes (≥ 640 px) : nom, responsable, échéance, priorité, étiquettes. */
const GRILLE =
  'sm:grid sm:grid-cols-[minmax(0,1fr)_9.5rem_6.5rem_6.5rem] lg:grid-cols-[minmax(0,1fr)_10rem_7rem_7rem_11rem]';

export function VueListe(): React.ReactElement {
  const { project, tasks, settings, chargement, travailler } = useProjet();
  const [filtres, setFiltres] = useFiltres();
  const [replies, setReplies] = useState<Set<string>>(new Set());

  if (project === null) {
    return chargement ? <Skeleton className="h-64 w-full" /> : <></>;
  }
  const groupes = groupesListe(project.columns, filtrerTaches(tasks, filtres));
  const filtre = filtresActifs(filtres);
  const labels = settings?.labels ?? [];

  function basculer(cle: string): void {
    setReplies((r) => {
      const n = new Set(r);
      if (n.has(cle)) n.delete(cle);
      else n.add(cle);
      return n;
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <BarreFiltres filtres={filtres} onChange={setFiltres} idPrefixe="liste" />
      {/* ADR-0062 : importer les tâches d'un fichier dans ce projet (work.update). */}
      {travailler ? (
        <div className="-mt-2 flex justify-end">
          <BoutonImporterTaches projectId={project.id} />
        </div>
      ) : null}
      {tasks.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-5 text-center">
          <p className="text-sm font-medium">Ajoutez votre première tâche</p>
          <p className="mt-1 text-sm text-[var(--foreground-muted)]">
            {travailler
              ? 'Cliquez sur « + Ajouter une tâche » dans une section, tapez son nom puis Entrée : vous pouvez enchaîner.'
              : 'Ce projet n’a encore aucune tâche.'}
          </p>
        </div>
      ) : null}

      <div
        role="table"
        aria-label="Tâches du projet"
        className="min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]"
      >
        <div
          role="row"
          className={`hidden h-9 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 text-xs font-medium text-[var(--foreground-muted)] sm:grid ${GRILLE}`}
        >
          <span role="columnheader" className="pl-7">
            Nom de la tâche
          </span>
          <span role="columnheader">Responsable</span>
          <span role="columnheader">Échéance</span>
          <span role="columnheader">Priorité</span>
          <span role="columnheader" className="hidden lg:block">
            Étiquettes
          </span>
        </div>

        {groupes.map((g) => {
          const replie = replies.has(g.column.key);
          const idGroupe = `groupe-${g.column.key}`;
          if (filtre && g.lignes.length === 0) return null;
          return (
            <div key={g.column.key} role="rowgroup" aria-labelledby={idGroupe}>
              <div role="row" className="border-b border-[var(--border)]">
                <span role="cell" className="block">
                  <button
                    type="button"
                    id={idGroupe}
                    aria-expanded={!replie}
                    onClick={() => basculer(g.column.key)}
                    className="flex h-10 w-full items-center gap-1.5 px-2 text-left text-sm font-semibold transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-muted)]"
                  >
                    {replie ? (
                      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate">{g.column.label}</span>
                    <span className="text-xs font-normal text-[var(--foreground-muted)]">
                      {g.total}
                      <span className="sr-only"> tâche{g.total > 1 ? 's' : ''}</span>
                    </span>
                  </button>
                </span>
              </div>
              {replie ? null : (
                <>
                  {g.lignes.map(({ task: t, profondeur }) => (
                    <LigneTache key={t.id} t={t} profondeur={profondeur} labels={labels} />
                  ))}
                  {filtre ? null : (
                    <div role="row" className="border-b border-[var(--border)]">
                      <span role="cell" className="block">
                        <AjoutEnLigne
                          columnKey={g.column.key}
                          idPrefixe={`liste-${g.column.key}`}
                        />
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        {filtre && groupes.every((g) => g.lignes.length === 0) ? (
          <p className="p-4 text-sm text-[var(--foreground-muted)]">
            Aucune tâche ne correspond aux filtres.
          </p>
        ) : null}
      </div>
      <AjoutSection />
    </div>
  );
}

function LigneTache({
  t,
  profondeur,
  labels,
}: {
  t: WorkTaskView;
  profondeur: 0 | 1;
  labels: Parameters<typeof Etiquettes>[0]['labels'];
}): React.ReactElement {
  const { today, ouvrirTache, tacheOuverte, nbCommentaires } = useProjet();
  const commentaires = nbCommentaires(t.id);
  const active = tacheOuverte === t.id;
  return (
    <div
      role="row"
      onClick={() => ouvrirTache(t.id)}
      className={`group/ligne relative cursor-pointer gap-3 border-b border-[var(--border)] px-3 py-2 text-sm transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-muted)] sm:h-[var(--row-h)] sm:items-center sm:py-0 ${GRILLE} ${active ? 'bg-[var(--accent-soft)]' : ''}`}
    >
      <span
        role="cell"
        className={`flex min-w-0 items-center gap-2 ${profondeur === 1 ? 'pl-6' : ''}`}
      >
        <CaseTerminee task={t} />
        {profondeur === 1 ? <span className="sr-only">Sous-tâche : </span> : null}
        <NomEditable t={t} />
        <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--foreground-muted)]">
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
          {t.blocked ? <BloqueeBadge /> : null}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            ouvrirTache(t.id);
          }}
          className="ml-auto shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-xs text-[var(--foreground-muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover/ligne:opacity-100"
        >
          Détails<span className="sr-only"> de #{t.number}</span> ›
        </button>
      </span>
      {/* Téléphone : les métadonnées passent sous le nom. */}
      <span role="cell" className="mt-1 flex min-w-0 items-center gap-1.5 pl-7 sm:mt-0 sm:pl-0">
        {t.assignee ? (
          <>
            <Avatar name={t.assignee.name} cle={t.assignee.userId} taille={24} />
            <span className="hidden truncate text-xs sm:inline">{t.assignee.name}</span>
          </>
        ) : (
          <span className="hidden text-xs text-[var(--foreground-muted)] sm:inline">—</span>
        )}
        <AbsenceBadges t={t} />
        <span className="sm:hidden">
          <DateEcheance task={t} today={today} />
        </span>
        <span className="sm:hidden">
          <PrioriteBadge priority={t.priority} />
        </span>
      </span>
      <span role="cell" className="hidden sm:block">
        <DateEcheance task={t} today={today} />
      </span>
      <span role="cell" className="hidden sm:block">
        <PrioriteBadge priority={t.priority} />
      </span>
      <span role="cell" className="hidden min-w-0 lg:block">
        <Etiquettes keys={t.labelKeys} labels={labels} max={2} />
      </span>
    </div>
  );
}

/** Nom éditable sur place (Entrée ou sortie du champ : enregistre ; Échap : annule). */
function NomEditable({ t }: { t: WorkTaskView }): React.ReactElement {
  const { travailler, appliquerEcriture, signalerErreur, ouvrirTache } = useProjet();
  const [valeur, setValeur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const barre = t.done ? 'text-[var(--foreground-muted)] line-through' : '';

  if (!travailler) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          ouvrirTache(t.id);
        }}
        className={`min-w-0 truncate text-left ${barre}`}
      >
        {t.title}
      </button>
    );
  }

  async function enregistrer(): Promise<void> {
    const titre = (valeur ?? '').trim();
    setValeur(null);
    if (titre === '' || titre === t.title) return;
    setEnvoi(true);
    try {
      appliquerEcriture(
        await workApi.patchTask(t.id, { title: titre, expectedRevision: t.revision }),
      );
    } catch (err) {
      signalerErreur(err, 'Renommage impossible.');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <input
      aria-label={`Nom de la tâche #${t.number}`}
      value={valeur ?? t.title}
      disabled={envoi}
      maxLength={300}
      onClick={(e) => e.stopPropagation()}
      onFocus={() => setValeur(t.title)}
      onChange={(e) => setValeur(e.target.value)}
      onBlur={() => void enregistrer()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          const champ = e.currentTarget;
          setValeur(t.title);
          requestAnimationFrame(() => champ.blur());
        }
      }}
      className={`field-sizing-content h-7 min-w-[3rem] max-w-full truncate rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 outline-none transition-colors duration-[var(--motion-fast)] hover:border-[var(--border)] focus:border-[var(--accent)] focus:bg-[var(--surface)] ${barre}`}
    />
  );
}

/** « + Ajouter une section » : une nouvelle colonne « en cours », avant « Terminé ». */
function AjoutSection(): React.ReactElement | null {
  const { project, gerer, setProject } = useProjet();
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  if (!project || !gerer || project.status === 'archived') return null;
  if (project.columns.length >= WORK_LIMITS.columnsMax) return null;
  const p = project;

  async function ajouter(): Promise<void> {
    const label = nom.trim();
    if (!label) return;
    const key = cleDepuisLibelle(
      label,
      p.columns.map((c) => c.key),
    );
    const iDone = p.columns.findIndex((c) => c.category === 'done');
    const cols = [...p.columns];
    cols.splice(iDone === -1 ? cols.length : iDone, 0, { key, label, category: 'in_progress' });
    const r = WorkColumnsSchema.safeParse(cols);
    if (!r.success) {
      setErreur(r.error.issues[0]?.message ?? 'Section invalide.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      setProject(
        await workApi.updateProject(p.id, { expectedRevision: p.revision, columns: r.data }),
      );
      setNom('');
      setOuvert(false);
    } catch (err) {
      setErreur(messageWork(err, 'Ajout de la section impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="self-start rounded-[var(--radius-md)] px-2 py-1.5 text-sm text-[var(--foreground-muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
      >
        + Ajouter une section
      </button>
    );
  }
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void ajouter();
      }}
    >
      <label htmlFor="section-nouvelle" className="text-xs font-medium">
        Nouvelle section (colonne « en cours », placée avant « Terminé »)
      </label>
      <div className="flex gap-2">
        <input
          id="section-nouvelle"
          autoFocus
          value={nom}
          maxLength={WORK_LIMITS.columnLabelMax}
          onChange={(e) => setNom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOuvert(false);
            }
          }}
          className="h-9 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-sm"
        />
        <button
          type="submit"
          disabled={envoi || !nom.trim()}
          className="rounded-[var(--radius-md)] border border-[var(--border-strong)] px-3 text-sm disabled:opacity-50"
        >
          Ajouter
        </button>
        <button type="button" onClick={() => setOuvert(false)} className="px-2 text-sm">
          Annuler
        </button>
      </div>
      {erreur ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </form>
  );
}
