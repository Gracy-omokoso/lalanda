'use client';

// Panneau de tâche (ADR-0039 § 8) : tiroir latéral, plein écran sous 768 px,
// ouvert par `?tache=<id>` depuis n'importe quel onglet du projet.
//
// Contenu : titre, statut (colonne), responsable, dates, priorité, étiquettes,
// jalon, estimation, description ; sous-tâches ; dépendances avec avertissement
// de conflit (JAMAIS de décalage automatique des dates) ; puis la collaboration
// (`tache-collab.tsx`) : commentaires avec mentions, pièces jointes, temps,
// historique.

import { WORK_PRIORITIES, type WorkTaskDetail } from '@lalanda/shared/work';
import { Tag, buttonClasses } from '@lalanda/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { workApi } from '@/lib/work-api';

import {
  AbsenceBadges,
  BOUTON_DANGER,
  BOUTON_PETIT,
  CHAMP,
  Champ,
  BloqueeBadge,
  aria,
} from './elements';
import { colonnesKanban, placer } from './kanban-model';
import { useProjet } from './project-context';
import { PRIORITES, codeWork, formatJour, formatMinutes, messageWork } from './projets-model';
import { Collaboration } from './tache-collab';
import {
  candidatsDependance,
  diffTache,
  formulaireTache,
  messagesAvertissements,
  type FormulaireTache,
} from './taches-model';

export function PanneauTache(): React.ReactElement | null {
  const { tacheOuverte, fermerTache } = useProjet();
  const panneau = useRef<HTMLDivElement>(null);
  const retour = useRef<Element | null>(null);

  useEffect(() => {
    if (!tacheOuverte) return;
    retour.current ??= document.activeElement;
    panneau.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fermerTache();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tacheOuverte, fermerTache]);

  useEffect(() => {
    if (tacheOuverte) return;
    const el = retour.current;
    retour.current = null;
    if (el instanceof HTMLElement) el.focus();
  }, [tacheOuverte]);

  if (!tacheOuverte) return null;
  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40 hidden bg-black/30 md:block"
        onClick={fermerTache}
      />
      <div
        ref={panneau}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tache-titre"
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-[var(--background)] outline-none md:left-auto md:w-[34rem] md:border-l md:border-[var(--border)] md:shadow-[var(--shadow-pop)]"
      >
        <DetailTache key={tacheOuverte} taskId={tacheOuverte} />
      </div>
    </>
  );
}

function DetailTache({ taskId }: { taskId: string }): React.ReactElement {
  const ctx = useProjet();
  const {
    project,
    tasks,
    settings,
    members,
    travailler,
    gerer,
    fermerTache,
    appliquerEcriture,
    setTasks,
  } = ctx;
  const [detail, setDetail] = useState<WorkTaskDetail | null>(null);
  const [f, setF] = useState<FormulaireTache | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [alertes, setAlertes] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [nouvelleSous, setNouvelleSous] = useState('');
  const [predecesseur, setPredecesseur] = useState('');

  const charger = useCallback(() => {
    workApi
      .getTask(taskId)
      .then((d) => {
        setDetail(d);
        setF(formulaireTache(d));
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageWork(err, 'Impossible de charger la tâche.')));
  }, [taskId]);

  useEffect(() => charger(), [charger]);

  /** Après une écriture : la liste du projet, les avertissements, puis le détail. */
  const apres = useCallback(
    (r: Parameters<typeof appliquerEcriture>[0]) => {
      appliquerEcriture(r);
      setAlertes(messagesAvertissements(r.warnings, [...tasks, r.task]));
      charger();
    },
    [appliquerEcriture, tasks, charger],
  );

  async function agir(geste: () => Promise<void>, repli: string): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      await geste();
    } catch (err) {
      setErreur(messageWork(err, repli));
      if (codeWork(err) === 'STALE_REVISION') {
        ctx.recharger();
        charger();
      }
    } finally {
      setEnvoi(false);
    }
  }

  if (detail === null || f === null || project === null) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h2 id="tache-titre" className="text-base font-semibold">
            Tâche
          </h2>
          <button type="button" className={BOUTON_PETIT} onClick={fermerTache}>
            Fermer
          </button>
        </div>
        <p role={erreur ? 'alert' : 'status'} className="text-sm text-[var(--foreground-muted)]">
          {erreur ?? 'Chargement de la tâche…'}
        </p>
      </div>
    );
  }

  const d = detail;
  const ecrire = travailler;
  const labels = settings?.labels ?? [];
  const eligibles = members.filter((m) => m.canUpdate);
  const candidats = candidatsDependance(tasks, d);

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (f === null) return;
    if (f.title.trim() === '') {
      setChamps({ title: 'Le titre est obligatoire.' });
      return;
    }
    if (f.isMilestone && f.dueDate === '') {
      setChamps({ dueDate: 'Un jalon exige une échéance.' });
      return;
    }
    if (!f.isMilestone && f.startDate && f.dueDate && f.dueDate < f.startDate) {
      setChamps({ dueDate: 'L’échéance précède la date de début.' });
      return;
    }
    setChamps({});
    const corps = diffTache(d, f);
    if (corps === null) return;
    await agir(
      async () => apres(await workApi.patchTask(d.id, corps)),
      'Enregistrement impossible.',
    );
  }

  async function changerColonne(columnKey: string): Promise<void> {
    const cols = colonnesKanban(project!.columns, tasks);
    const cible = cols.find((c) => c.column.key === columnKey);
    if (!cible) return;
    // Sous-tâche : hors Kanban ; on la place en fin de liste de sa colonne.
    const p = placer(d, columnKey, cible.taches, cible.taches.length);
    if (p === null) return;
    await agir(
      async () => apres(await workApi.moveTask(d.id, p.corps)),
      'Changement de statut impossible.',
    );
  }

  async function supprimer(): Promise<void> {
    if (!window.confirm(`Supprimer définitivement #${d.number} « ${d.title} » ?`)) return;
    await agir(async () => {
      await workApi.deleteTask(d.id);
      setTasks((t) => t.filter((x) => x.id !== d.id && x.parentTaskId !== d.id));
      fermerTache();
    }, 'Suppression impossible.');
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      <div className="sticky top-0 z-10 -mx-4 -mt-4 flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--background)] px-4 py-3 sm:-mx-5 sm:-mt-5 sm:px-5">
        <h2 id="tache-titre" className="min-w-0 truncate text-base font-semibold">
          <span className="text-[var(--foreground-muted)]">#{d.number}</span>{' '}
          {d.isMilestone ? <span aria-label="Jalon">◆ </span> : null}
          {d.title}
        </h2>
        <button type="button" className={BOUTON_PETIT} onClick={fermerTache}>
          Fermer
        </button>
      </div>

      {erreur ? (
        <p
          role="alert"
          className="rounded-md bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          {erreur}
        </p>
      ) : null}
      {alertes.length > 0 ? (
        <ul
          role="status"
          className="flex flex-col gap-1 rounded-md border border-[var(--warn)] p-3 text-sm"
        >
          {alertes.map((a) => (
            <li key={a}>
              <span aria-hidden="true">⚠ </span>
              {a}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1.5">
          <label htmlFor="tache-statut" className="text-sm font-medium">
            Statut
          </label>
          <select
            id="tache-statut"
            value={d.columnKey}
            disabled={!ecrire || envoi}
            onChange={(e) => void changerColonne(e.target.value)}
            className={CHAMP}
          >
            {project.columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        {ecrire ? (
          <button
            type="button"
            disabled={envoi}
            className={buttonClasses(d.done ? 'secondary' : 'primary', 'md')}
            onClick={() =>
              void agir(
                async () =>
                  apres(
                    d.done
                      ? await workApi.reopenTask(d.id, d.revision)
                      : await workApi.completeTask(d.id, d.revision),
                  ),
                'Changement d’état impossible.',
              )
            }
          >
            {d.done ? 'Rouvrir' : 'Terminer'}
          </button>
        ) : null}
        {d.blocked ? <BloqueeBadge /> : null}
      </div>
      {d.done && d.subtasks.some((s) => !s.done) ? (
        <p className="text-sm text-[var(--warn)]">
          Cette tâche est terminée, mais {d.subtasks.filter((s) => !s.done).length} sous-tâche(s)
          restent ouvertes : terminer une tâche ne termine pas ses sous-tâches.
        </p>
      ) : null}

      <form onSubmit={(e) => void enregistrer(e)} noValidate className="flex flex-col gap-4">
        <fieldset disabled={!ecrire || envoi} className="flex flex-col gap-4">
          <legend className="sr-only">Détails de la tâche</legend>
          <Champ id="tache-t" label="Titre" requis erreur={champs['title']}>
            <input
              id="tache-t"
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
              className={CHAMP}
              maxLength={300}
              {...aria('tache-t', champs['title'])}
            />
          </Champ>
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ id="tache-resp" label="Responsable">
              <select
                id="tache-resp"
                value={f.assigneeUserId}
                onChange={(e) => setF({ ...f, assigneeUserId: e.target.value })}
                className={CHAMP}
              >
                <option value="">Aucun</option>
                {d.assignee && !eligibles.some((m) => m.userId === d.assignee!.userId) ? (
                  <option value={d.assignee.userId}>{d.assignee.name}</option>
                ) : null}
                {eligibles.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
              {/* ADR-0045 — H5 : assigné absent (jours seulement), constat d'échéance. */}
              {d.assigneeAbsence || d.dueDateAbsence ? (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <AbsenceBadges t={d} details />
                </div>
              ) : null}
            </Champ>
            <Champ id="tache-prio" label="Priorité">
              <select
                id="tache-prio"
                value={f.priority}
                onChange={(e) =>
                  setF({ ...f, priority: e.target.value as FormulaireTache['priority'] })
                }
                className={CHAMP}
              >
                {WORK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITES[p].label}
                  </option>
                ))}
              </select>
            </Champ>
            {!f.isMilestone ? (
              <Champ id="tache-debut" label="Début">
                <input
                  id="tache-debut"
                  type="date"
                  value={f.startDate}
                  onChange={(e) => setF({ ...f, startDate: e.target.value })}
                  className={CHAMP}
                />
              </Champ>
            ) : null}
            <Champ
              id="tache-ech"
              label="Échéance"
              requis={f.isMilestone}
              erreur={champs['dueDate']}
            >
              <input
                id="tache-ech"
                type="date"
                value={f.dueDate}
                onChange={(e) => setF({ ...f, dueDate: e.target.value })}
                className={CHAMP}
                {...aria('tache-ech', champs['dueDate'])}
              />
            </Champ>
            <Champ
              id="tache-est"
              label="Estimation (minutes)"
              aide="Indicative, jamais utilisée dans un coût."
            >
              <input
                id="tache-est"
                type="number"
                min={0}
                max={100000}
                inputMode="numeric"
                value={f.estimate}
                onChange={(e) => setF({ ...f, estimate: e.target.value })}
                className={CHAMP}
                {...aria('tache-est', undefined, true)}
              />
            </Champ>
            {d.parentTaskId === null && d.subtasks.length === 0 ? (
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.isMilestone}
                  onChange={(e) => setF({ ...f, isMilestone: e.target.checked })}
                />
                Jalon (date unique, sans début)
              </label>
            ) : null}
          </div>
          {labels.length > 0 ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-sm font-medium">Étiquettes</legend>
              <div className="flex flex-wrap gap-2">
                {labels.map((l) => (
                  <label key={l.key} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={f.labelKeys.includes(l.key)}
                      onChange={(e) =>
                        setF({
                          ...f,
                          labelKeys: e.target.checked
                            ? [...f.labelKeys, l.key]
                            : f.labelKeys.filter((k) => k !== l.key),
                        })
                      }
                    />
                    <Tag color={l.color}>{l.label}</Tag>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <Champ id="tache-desc" label="Description">
            <textarea
              id="tache-desc"
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              className={CHAMP}
              rows={4}
              maxLength={10000}
            />
          </Champ>
        </fieldset>
        {ecrire ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={envoi || diffTache(d, f) === null}
              className={buttonClasses('primary', 'md')}
            >
              Enregistrer
            </button>
            {diffTache(d, f) !== null ? (
              <button
                type="button"
                className={buttonClasses('ghost', 'md')}
                onClick={() => setF(formulaireTache(d))}
              >
                Annuler les modifications
              </button>
            ) : null}
          </div>
        ) : null}
      </form>

      {/* ─── Sous-tâches ─────────────────────────────────────────────────── */}
      {d.parentTaskId === null && !d.isMilestone ? (
        <section aria-labelledby="sous-titre" className="flex flex-col gap-2">
          <h3 id="sous-titre" className="text-sm font-semibold">
            Sous-tâches ({d.subtasks.filter((s) => s.done).length}/{d.subtasks.length})
          </h3>
          <ul className="flex flex-col gap-1">
            {d.subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={s.done}
                  disabled={!ecrire || envoi}
                  aria-label={
                    s.done ? `Rouvrir #${s.number} ${s.title}` : `Terminer #${s.number} ${s.title}`
                  }
                  onChange={() =>
                    void agir(
                      async () =>
                        apres(
                          s.done
                            ? await workApi.reopenTask(s.id, s.revision)
                            : await workApi.completeTask(s.id, s.revision),
                        ),
                      'Changement d’état impossible.',
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() => ctx.ouvrirTache(s.id)}
                  className={`min-w-0 break-words text-left underline-offset-2 hover:underline ${s.done ? 'text-[var(--foreground-muted)] line-through' : ''}`}
                >
                  #{s.number} {s.title}
                </button>
              </li>
            ))}
          </ul>
          {ecrire && d.subtasks.length < 100 ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const titre = nouvelleSous.trim();
                if (!titre) return;
                void agir(async () => {
                  apres(await workApi.createTask(project.id, { title: titre, parentTaskId: d.id }));
                  setNouvelleSous('');
                }, 'Création de la sous-tâche impossible.');
              }}
            >
              <label htmlFor="sous-nouvelle" className="sr-only">
                Nouvelle sous-tâche
              </label>
              <input
                id="sous-nouvelle"
                value={nouvelleSous}
                onChange={(e) => setNouvelleSous(e.target.value)}
                placeholder="Ajouter une sous-tâche…"
                maxLength={300}
                className={CHAMP}
              />
              <button
                type="submit"
                className={BOUTON_PETIT}
                disabled={envoi || !nouvelleSous.trim()}
              >
                Ajouter
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      {/* ─── Dépendances ─────────────────────────────────────────────────── */}
      <section aria-labelledby="dep-titre" className="flex flex-col gap-2">
        <h3 id="dep-titre" className="text-sm font-semibold">
          Dépendances
        </h3>
        <p className="text-xs text-[var(--foreground-muted)]">
          « Attend » : cette tâche ne devrait pas commencer avant la fin de la tâche citée. Un
          conflit de dates est signalé, jamais corrigé à votre place.
        </p>
        {d.predecessors.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">N’attend aucune tâche.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {d.predecessors.map((p) => (
              <li key={p.taskId} className="flex flex-wrap items-center gap-2 text-sm">
                <span>Attend</span>
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => ctx.ouvrirTache(p.taskId)}
                >
                  #{p.number} {p.title}
                </button>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {p.done ? '✓ terminée' : '○ pas terminée'}
                </span>
                {ecrire ? (
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    disabled={envoi}
                    aria-label={`Retirer la dépendance à #${p.number}`}
                    onClick={() =>
                      void agir(
                        async () => apres(await workApi.removeDependency(d.id, p.taskId)),
                        'Retrait impossible.',
                      )
                    }
                  >
                    Retirer
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {ecrire && candidats.length > 0 && d.blockedBy.length < 20 ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!predecesseur) return;
              void agir(async () => {
                apres(await workApi.addDependency(d.id, { predecessorTaskId: predecesseur }));
                setPredecesseur('');
              }, 'Ajout de la dépendance impossible.');
            }}
          >
            <label htmlFor="dep-ajout" className="sr-only">
              Tâche attendue
            </label>
            <select
              id="dep-ajout"
              value={predecesseur}
              onChange={(e) => setPredecesseur(e.target.value)}
              className={CHAMP}
            >
              <option value="">Attendre la tâche…</option>
              {candidats.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.number} {t.title}
                  {t.dueDate ? ` (échéance ${formatJour(t.dueDate, false)})` : ''}
                </option>
              ))}
            </select>
            <button type="submit" className={BOUTON_PETIT} disabled={envoi || !predecesseur}>
              Ajouter
            </button>
          </form>
        ) : null}
        {d.successors.length > 0 ? (
          <p className="text-sm">
            Attendue par :{' '}
            {d.successors.map((s, i) => (
              <span key={s.taskId}>
                {i > 0 ? ', ' : null}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => ctx.ouvrirTache(s.taskId)}
                >
                  #{s.number} {s.title}
                </button>
              </span>
            ))}
          </p>
        ) : null}
      </section>

      <Collaboration detail={d} onChange={charger} />

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-4 text-xs text-[var(--foreground-muted)]">
        <span>
          Temps saisi : {formatMinutes(d.loggedMinutes)}
          {d.source?.kind === 'quote_line' ? ' · Issue d’une ligne de devis' : ''}
        </span>
        {gerer && project.status !== 'archived' ? (
          <button
            type="button"
            className={BOUTON_DANGER}
            disabled={envoi}
            onClick={() => void supprimer()}
          >
            Supprimer la tâche
          </button>
        ) : null}
      </footer>
    </div>
  );
}
