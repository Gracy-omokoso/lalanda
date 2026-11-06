'use client';

// Panneau de tâche (ADR-0039 § 8) : tiroir latéral, plein écran sous 768 px,
// ouvert par `?tache=<id>` depuis n'importe quel onglet du projet.
//
// Contenu : titre, statut (colonne), responsable, dates, priorité, étiquettes,
// jalon, estimation, description ; sous-tâches ; dépendances avec avertissement
// de conflit (JAMAIS de décalage automatique des dates) ; puis la collaboration
// (`tache-collab.tsx`) : commentaires avec mentions, pièces jointes, temps,
// historique.

import {
  WORK_PRIORITIES,
  type WorkTaskDetail,
  type WorkTaskView,
  type WorkTaskWriteResult,
} from '@lalanda/shared/work';
import { Tag } from '@lalanda/ui';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { workApi } from '@/lib/work-api';

import {
  AbsenceBadges,
  Avatar,
  CercleCoche,
  DateEcheance,
  BOUTON_DANGER,
  BOUTON_PETIT,
  CHAMP,
  BloqueeBadge,
  aria,
} from './elements';
import { colonnesKanban, placer } from './kanban-model';
import { COULEURS_CARTE, LIBELLES_COULEUR, numeroVisible } from './cartes-model';
import { useProjet } from './project-context';
import {
  PRIORITES,
  PROJETS_BASE,
  codeWork,
  formatJour,
  formatMinutes,
  messageWork,
} from './projets-model';
import { Collaboration } from './tache-collab';

/** Champ « à plat » de la grille : bordure au survol et au focus seulement. */
const CHAMP_PLAT =
  'h-8 min-w-0 max-w-full rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 text-sm transition-colors duration-[var(--motion-fast)] hover:border-[var(--border)] focus:border-[var(--accent)] focus:bg-[var(--surface)] disabled:hover:border-transparent';
import {
  candidatsDependance,
  diffTache,
  formulaireTache,
  horsDuProjet,
  messagesAvertissements,
  responsableVerrouille,
  responsablesProposes,
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
        className="panneau-tache-entree fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-[var(--background)] outline-none md:left-auto md:w-[38rem] md:border-l md:border-[var(--border)] md:shadow-[var(--shadow-pop)]"
      >
        {/* Ouverture du tiroir en 180 ms (ADR-0055 § 4) ; coupée sous
            `prefers-reduced-motion` par la règle globale. */}
        <style>{`@keyframes panneau-tache-entree{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}.panneau-tache-entree{animation:panneau-tache-entree var(--motion-base) var(--ease-standard)}`}</style>
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
    moi,
    assignerSoiSeulement,
    fermerTache,
    appliquerEcriture,
    setTasks,
    today,
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
  // ADR-0066 § 2 et § 3 : « Moi » seulement pour un Stagiaire ; sinon les personnes qui
  // voient le projet. Le serveur reste juge.
  const regleAssignation = { moi, soiSeulement: assignerSoiSeulement };
  const eligibles = responsablesProposes(members, regleAssignation);
  const respVerrouille = responsableVerrouille(d.assignee?.userId ?? null, regleAssignation);
  const nbHorsProjet = gerer && !assignerSoiSeulement ? horsDuProjet(members) : 0;
  const candidats = candidatsDependance(tasks, d);

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

  /** Enregistre aussitôt un champ (façon Asana : pas de bouton « Enregistrer »). */
  async function sauver(partiel: Partial<FormulaireTache>): Promise<void> {
    if (f === null) return;
    const g = { ...f, ...partiel };
    setF(g);
    if (g.title.trim() === '') {
      setChamps({ title: 'Le titre est obligatoire.' });
      return;
    }
    if (g.isMilestone && g.dueDate === '') {
      setChamps({ dueDate: 'Un jalon exige une échéance.' });
      return;
    }
    if (!g.isMilestone && g.startDate && g.dueDate && g.dueDate < g.startDate) {
      setChamps({ dueDate: 'L’échéance précède la date de début.' });
      return;
    }
    setChamps({});
    const corps = diffTache(d, g);
    if (corps === null) return;
    await agir(
      async () => apres(await workApi.patchTask(d.id, corps)),
      'Enregistrement impossible.',
    );
  }

  const basculerTerminee = () =>
    void agir(
      async () =>
        apres(
          d.done
            ? await workApi.reopenTask(d.id, d.revision)
            : await workApi.completeTask(d.id, d.revision),
        ),
      'Changement d’état impossible.',
    );

  const parent = d.parentTaskId ? tasks.find((t) => t.id === d.parentTaskId) : null;

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      <div className="sticky top-0 z-10 -mx-4 -mt-4 flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--background)] px-4 py-2.5 sm:-mx-5 sm:-mt-5 sm:px-5">
        {ecrire ? (
          <button
            type="button"
            disabled={envoi}
            onClick={basculerTerminee}
            aria-pressed={d.done}
            className={`inline-flex h-8 items-center gap-2 rounded-[var(--radius-md)] border px-2.5 text-sm font-medium transition-colors duration-[var(--motion-base)] ${
              d.done
                ? 'border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_14%,var(--surface))] text-[var(--ok)]'
                : 'border-[var(--border-strong)] hover:border-[var(--ok)] hover:text-[var(--ok)]'
            }`}
          >
            <span aria-hidden="true">✓</span>
            {d.done ? 'Terminée' : 'Marquer comme terminée'}
          </button>
        ) : (
          <span className="text-sm text-[var(--foreground-muted)]">
            {d.done ? '✓ Terminée' : 'Ouverte'} · lecture seule
          </span>
        )}
        <span className="flex items-center gap-1">
          {numeroVisible(d.number, ctx.settings?.showTaskNumbers) ? (
            <span className="hidden text-xs text-[var(--foreground-muted)] sm:inline">
              #{d.number}
            </span>
          ) : null}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-lg leading-none text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            onClick={fermerTache}
            aria-label="Fermer le panneau (Échap)"
            title="Fermer (Échap)"
          >
            ×
          </button>
        </span>
      </div>

      {parent ? (
        <button
          type="button"
          onClick={() => ctx.ouvrirTache(parent.id)}
          className="-mb-3 self-start text-xs text-[var(--foreground-muted)] underline-offset-2 hover:underline"
        >
          ‹ Sous-tâche de #{parent.number} {parent.title}
        </button>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="tache-t" className="sr-only">
          Titre de la tâche
        </label>
        {/* Titre lu par le dialogue (aria-labelledby). */}
        <h2 id="tache-titre" className="sr-only">
          #{d.number} {d.title}
        </h2>
        <textarea
          id="tache-t"
          value={f.title}
          rows={1}
          readOnly={!ecrire}
          disabled={envoi}
          maxLength={300}
          onChange={(e) => setF({ ...f, title: e.target.value.replace(/\n/g, ' ') })}
          onBlur={() => void sauver({ title: f.title })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className={`field-sizing-content w-full resize-none rounded-[var(--radius-md)] border border-transparent bg-transparent px-1.5 py-1 font-[family-name:var(--font-heading,inherit)] text-xl font-semibold leading-snug outline-none transition-colors duration-[var(--motion-fast)] ${ecrire ? 'hover:border-[var(--border)] focus:border-[var(--accent)]' : ''} ${d.done ? 'text-[var(--foreground-muted)]' : ''}`}
          {...aria('tache-t', champs['title'])}
        />
        {champs['title'] ? (
          <p id="tache-t-erreur" className="text-xs text-[var(--danger)]">
            {champs['title']}
          </p>
        ) : null}
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
      {d.done && d.subtasks.some((s) => !s.done) ? (
        <p className="text-sm text-[var(--warn)]">
          Cette tâche est terminée, mais {d.subtasks.filter((s) => !s.done).length} sous-tâche(s)
          restent ouvertes : terminer une tâche ne termine pas ses sous-tâches.
        </p>
      ) : null}

      <fieldset disabled={!ecrire || envoi} className="min-w-0">
        <legend className="sr-only">Champs de la tâche</legend>
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt>
            <label htmlFor="tache-resp" className="text-[var(--foreground-muted)]">
              Responsable
            </label>
          </dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2">
            {d.assignee ? (
              <Avatar name={d.assignee.name} cle={d.assignee.userId} taille={24} />
            ) : null}
            <select
              id="tache-resp"
              value={f.assigneeUserId}
              onChange={(e) => void sauver({ assigneeUserId: e.target.value })}
              className={CHAMP_PLAT}
              disabled={respVerrouille}
              aria-describedby={
                respVerrouille || assignerSoiSeulement || nbHorsProjet > 0
                  ? 'tache-resp-aide'
                  : undefined
              }
            >
              <option value="">Aucun responsable</option>
              {d.assignee && !eligibles.some((m) => m.userId === d.assignee!.userId) ? (
                <option value={d.assignee.userId}>{d.assignee.name}</option>
              ) : null}
              {eligibles.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
            {respVerrouille || assignerSoiSeulement ? (
              <span
                id="tache-resp-aide"
                className="basis-full text-xs text-[var(--foreground-muted)]"
              >
                {respVerrouille
                  ? 'Cette tâche est assignée à un collègue : votre rôle ne permet pas de la réassigner.'
                  : 'Votre rôle permet de vous assigner une tâche, ou de la laisser sans responsable.'}
              </span>
            ) : nbHorsProjet > 0 ? (
              <span
                id="tache-resp-aide"
                className="basis-full text-xs text-[var(--foreground-muted)]"
              >
                {nbHorsProjet === 1
                  ? '1 personne ne voit pas ce projet. '
                  : `${nbHorsProjet} personnes ne voient pas ce projet. `}
                <Link
                  href={`${PROJETS_BASE}/${project.id}/membres`}
                  className="font-medium text-[var(--primary)] underline-offset-2 hover:underline"
                >
                  Ajouter un membre
                </Link>
              </span>
            ) : null}
            {/* ADR-0045 — H5 : assigné absent (jours seulement), constat d'échéance. */}
            {d.assigneeAbsence || d.dueDateAbsence ? (
              <span className="flex basis-full flex-wrap items-center gap-1">
                <AbsenceBadges t={d} details />
              </span>
            ) : null}
          </dd>

          <dt>
            <label htmlFor="tache-ech" className="text-[var(--foreground-muted)]">
              Échéance{f.isMilestone ? ' *' : ''}
            </label>
          </dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2">
            <input
              id="tache-ech"
              type="date"
              value={f.dueDate}
              onChange={(e) => void sauver({ dueDate: e.target.value })}
              className={`${CHAMP_PLAT} w-auto`}
              {...aria('tache-ech', champs['dueDate'])}
            />
            <DateEcheance task={d} today={today} />
            {champs['dueDate'] ? (
              <span id="tache-ech-erreur" className="basis-full text-xs text-[var(--danger)]">
                {champs['dueDate']}
              </span>
            ) : null}
          </dd>

          {!f.isMilestone ? (
            <>
              <dt>
                <label htmlFor="tache-debut" className="text-[var(--foreground-muted)]">
                  Début
                </label>
              </dt>
              <dd>
                <input
                  id="tache-debut"
                  type="date"
                  value={f.startDate}
                  onChange={(e) => void sauver({ startDate: e.target.value })}
                  className={`${CHAMP_PLAT} w-auto`}
                />
              </dd>
            </>
          ) : null}

          <dt className="text-[var(--foreground-muted)]">Projet</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate font-medium">{project.name}</span>
            <label htmlFor="tache-statut" className="sr-only">
              Statut (colonne)
            </label>
            <select
              id="tache-statut"
              value={d.columnKey}
              onChange={(e) => void changerColonne(e.target.value)}
              className={`${CHAMP_PLAT} w-auto`}
            >
              {project.columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            {d.blocked ? <BloqueeBadge /> : null}
          </dd>

          <dt>
            <label htmlFor="tache-prio" className="text-[var(--foreground-muted)]">
              Priorité
            </label>
          </dt>
          <dd>
            <select
              id="tache-prio"
              value={f.priority}
              onChange={(e) =>
                void sauver({ priority: e.target.value as FormulaireTache['priority'] })
              }
              className={`${CHAMP_PLAT} w-auto`}
            >
              {WORK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITES[p].label}
                </option>
              ))}
            </select>
          </dd>

          {/* ADR-0061 § 4 : couleur de la carte (post-it), palette fermée de 8 pastels. */}
          <dt className="self-start pt-1 text-[var(--foreground-muted)]" id="tache-couleur">
            Couleur
          </dt>
          <dd>
            <div
              role="radiogroup"
              aria-labelledby="tache-couleur"
              className="flex flex-wrap items-center gap-1.5"
            >
              {[null, ...COULEURS_CARTE].map((c) => {
                const choisie = (d.color ?? null) === c;
                return (
                  <button
                    key={c ?? 'aucune'}
                    type="button"
                    role="radio"
                    aria-checked={choisie}
                    disabled={!ecrire || envoi}
                    title={c ? LIBELLES_COULEUR[c] : 'Aucune couleur'}
                    onClick={() =>
                      void agir(
                        async () =>
                          apres(
                            await workApi.patchTask(d.id, {
                              expectedRevision: d.revision,
                              color: c,
                            }),
                          ),
                        'Couleur non enregistrée.',
                      )
                    }
                    className={`h-6 w-6 rounded-full border transition-shadow ${
                      choisie
                        ? 'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--surface)]'
                        : ''
                    } ${c ? 'border-transparent' : 'border-dashed border-[var(--border-strong)] bg-[var(--surface)]'}`}
                    style={
                      c
                        ? {
                            background: `var(--card-${c}-bg)`,
                            boxShadow: `inset 0 0 0 2px var(--card-${c}-dot)`,
                          }
                        : undefined
                    }
                  >
                    <span className="sr-only">{c ? LIBELLES_COULEUR[c] : 'Aucune couleur'}</span>
                  </button>
                );
              })}
            </div>
          </dd>

          <dt
            className="self-start pt-1 text-[var(--foreground-muted)]"
            title="« Attend » : cette tâche ne devrait pas commencer avant la fin de la tâche citée. Un conflit de dates est signalé, jamais corrigé à votre place."
          >
            Dépendances
          </dt>
          <dd className="min-w-0">
            <Dependances
              d={d}
              ecrire={ecrire}
              envoi={envoi}
              candidats={candidats}
              predecesseur={predecesseur}
              setPredecesseur={setPredecesseur}
              agir={agir}
              apres={apres}
            />
          </dd>

          {labels.length > 0 ? (
            <>
              <dt className="self-start pt-0.5 text-[var(--foreground-muted)]">Étiquettes</dt>
              <dd>
                <fieldset className="flex flex-wrap gap-1.5">
                  <legend className="sr-only">Étiquettes</legend>
                  {labels.map((l) => {
                    const pose = f.labelKeys.includes(l.key);
                    return (
                      <label
                        key={l.key}
                        className={`inline-flex cursor-pointer items-center rounded-full transition-opacity duration-[var(--motion-fast)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)] ${pose ? '' : 'opacity-45 hover:opacity-80'}`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={pose}
                          onChange={(e) =>
                            void sauver({
                              labelKeys: e.target.checked
                                ? [...f.labelKeys, l.key]
                                : f.labelKeys.filter((k) => k !== l.key),
                            })
                          }
                        />
                        <Tag color={l.color}>
                          {pose ? <span aria-hidden="true">✓ </span> : null}
                          {l.label}
                        </Tag>
                      </label>
                    );
                  })}
                </fieldset>
              </dd>
            </>
          ) : null}

          <dt>
            <label htmlFor="tache-est" className="text-[var(--foreground-muted)]">
              Estimation
            </label>
          </dt>
          <dd className="flex items-center gap-2">
            <input
              id="tache-est"
              type="number"
              min={0}
              max={100000}
              inputMode="numeric"
              value={f.estimate}
              placeholder="—"
              onChange={(e) => setF({ ...f, estimate: e.target.value })}
              onBlur={() => void sauver({ estimate: f.estimate })}
              className={`${CHAMP_PLAT} w-24`}
              aria-describedby="tache-est-aide"
            />
            <span id="tache-est-aide" className="text-xs text-[var(--foreground-muted)]">
              minutes, indicatif
            </span>
          </dd>

          {d.parentTaskId === null && d.subtasks.length === 0 ? (
            <>
              <dt className="text-[var(--foreground-muted)]">Jalon</dt>
              <dd>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={f.isMilestone}
                    onChange={(e) => void sauver({ isMilestone: e.target.checked })}
                  />
                  <span>◆ Date unique, sans début</span>
                </label>
              </dd>
            </>
          ) : null}
        </dl>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tache-desc" className="text-sm font-semibold">
          Description
        </label>
        <textarea
          id="tache-desc"
          value={f.description}
          readOnly={!ecrire}
          disabled={envoi}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          onBlur={() => void sauver({ description: f.description })}
          placeholder={ecrire ? 'De quoi s’agit-il ? Ajoutez du contexte…' : 'Aucune description.'}
          className="field-sizing-content min-h-[5rem] w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)]"
          rows={4}
          maxLength={10000}
        />
      </div>

      {/* ─── Sous-tâches ─────────────────────────────────────────────────── */}
      {d.parentTaskId === null && !d.isMilestone ? (
        <section aria-labelledby="sous-titre" className="flex flex-col gap-2">
          <h3 id="sous-titre" className="text-sm font-semibold">
            Sous-tâches ({d.subtasks.filter((s) => s.done).length}/{d.subtasks.length})
          </h3>
          <ul className="flex flex-col rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] empty:hidden">
            {d.subtasks.map((s) => (
              <li
                key={s.id}
                className="flex min-h-9 items-center gap-2 border-b border-[var(--border)] px-1 text-sm last:border-b-0"
              >
                <CercleCoche
                  coche={s.done}
                  taille={16}
                  disabled={!ecrire || envoi}
                  label={
                    s.done ? `Rouvrir #${s.number} ${s.title}` : `Terminer #${s.number} ${s.title}`
                  }
                  onClick={() =>
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
                  {s.title}
                </button>
                {s.assignee ? (
                  <span className="ml-auto">
                    <Avatar name={s.assignee.name} cle={s.assignee.userId} taille={20} />
                  </span>
                ) : null}
                {s.dueDate ? <DateEcheance task={s} today={today} /> : null}
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

/** Dépendances dans la grille de champs (« Attend » / « Attendue par »). */
function Dependances({
  d,
  ecrire,
  envoi,
  candidats,
  predecesseur,
  setPredecesseur,
  agir,
  apres,
}: {
  d: WorkTaskDetail;
  ecrire: boolean;
  envoi: boolean;
  candidats: WorkTaskView[];
  predecesseur: string;
  setPredecesseur: (v: string) => void;
  agir: (geste: () => Promise<void>, repli: string) => Promise<void>;
  apres: (r: WorkTaskWriteResult) => void;
}): React.ReactElement {
  const ctx = useProjet();
  return (
    <div className="flex flex-col gap-1.5">
      {d.predecessors.length === 0 ? (
        ecrire && candidats.length > 0 ? null : (
          <p className="text-sm text-[var(--foreground-muted)]">N’attend aucune tâche.</p>
        )
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
    </div>
  );
}
