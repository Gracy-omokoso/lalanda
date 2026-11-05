'use client';

// Membres d'un projet — ADR-0060 § 4, ouvert par « Partager » dans l'en-tête.
//
// Visibilité (Toute l'organisation / Membres seulement), personnes ajoutées une à
// une, équipes ajoutées (leurs membres COURANTS, résolus par le serveur : rejoindre
// l'équipe plus tard donne accès). Lecture pour qui voit le projet ; modification
// pour `work.manage`. L'accès réel est décidé par l'API, jamais par cet écran.

import type {
  WorkProjectMembersView,
  WorkProjectVisibility,
  WorkTeamRef,
} from '@lalanda/shared/work';
import { StatusPill, buttonClasses } from '@lalanda/ui';
import { Building2, Lock, UserMinus, UserPlus, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { workApi } from '@/lib/work-api';

import { CHAMP } from '../../ventes/_components/form-ui';

import { Alerte, Avatar, BOUTON_PETIT, PileAvatars } from './elements';
import {
  VISIBILITES,
  equipesAjoutables,
  libelleEquipe,
  messageMembres,
  personnesAjoutables,
  phraseAcces,
} from './membres-model';
import { useProjet } from './project-context';
import { codeWork, messageWork } from './projets-model';

function message(err: unknown, repli: string): string {
  return messageMembres(codeWork(err), messageWork(err, repli));
}

export function MembresProjet(): React.ReactElement {
  const id = useId();
  const { projectId, project, members, gerer, setProject } = useProjet();
  const [vue, setVue] = useState<WorkProjectMembersView | null>(null);
  const [equipes, setEquipes] = useState<WorkTeamRef[]>([]);
  const [personne, setPersonne] = useState('');
  const [equipe, setEquipe] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [version, setVersion] = useState(0);
  const recharger = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let annule = false;
    workApi
      .getProjectMembers(projectId)
      .then((v) => {
        if (!annule) setVue(v);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(message(err, 'Les membres du projet sont illisibles.'));
      });
    workApi
      .listTeams()
      .then((t) => {
        if (!annule) setEquipes(t);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [projectId, version]);

  async function agir(p: Promise<WorkProjectMembersView>, repli: string): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      setVue(await p);
      setPersonne('');
      setEquipe('');
    } catch (err) {
      setErreur(message(err, repli));
    } finally {
      setEnvoi(false);
    }
  }

  async function changerVisibilite(v: WorkProjectVisibility): Promise<void> {
    if (!project || project.visibility === v) return;
    setErreur(null);
    setEnvoi(true);
    try {
      setProject(
        await workApi.updateProject(projectId, {
          expectedRevision: project.revision,
          visibility: v,
        }),
      );
      recharger();
    } catch (err) {
      setErreur(message(err, 'La visibilité n’a pas pu être changée.'));
    } finally {
      setEnvoi(false);
    }
  }

  const modifiable = gerer && vue?.canManage === true && project?.status !== 'archived';
  const visibilite = project?.visibility ?? vue?.visibility ?? 'organization';

  return (
    <section aria-labelledby={`${id}-titre`} className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 id={`${id}-titre`} className="text-lg font-semibold">
          Membres et accès
        </h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          {vue ? phraseAcces({ visibility: visibilite, memberCount: vue.memberCount }) : ' '}
        </p>
      </header>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      <fieldset className="flex flex-col gap-2" disabled={!modifiable || envoi}>
        <legend className="mb-2 text-sm font-semibold">Qui voit ce projet ?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(VISIBILITES) as WorkProjectVisibility[]).map((v) => {
            const Icone = v === 'private' ? Lock : Building2;
            const actif = visibilite === v;
            return (
              <label
                key={v}
                className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-3 text-sm transition-colors ${
                  actif
                    ? 'border-[var(--accent)] bg-[var(--surface-muted)]'
                    : 'border-[var(--border)] bg-[var(--surface)]'
                } ${!modifiable ? 'cursor-default' : ''}`}
              >
                <input
                  type="radio"
                  name={`${id}-visibilite`}
                  className="mt-1"
                  checked={actif}
                  onChange={() => void changerVisibilite(v)}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Icone aria-hidden="true" className="h-4 w-4" />
                    {VISIBILITES[v].label}
                  </span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {VISIBILITES[v].phrase}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {modifiable ? (
        <div className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (personne === '') return;
              void agir(
                workApi.addProjectMembers(projectId, { userIds: [personne] }),
                'Le membre n’a pas pu être ajouté.',
              );
            }}
          >
            <label
              className="flex min-w-44 flex-1 flex-col gap-1 text-sm"
              htmlFor={`${id}-personne`}
            >
              Ajouter une personne
              <select
                id={`${id}-personne`}
                className={CHAMP}
                value={personne}
                onChange={(e) => setPersonne(e.target.value)}
              >
                <option value="">Choisir…</option>
                {personnesAjoutables(members, vue).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className={buttonClasses('primary', 'sm')}
              disabled={personne === ''}
            >
              <UserPlus aria-hidden="true" className="h-4 w-4" />
              Ajouter
            </button>
          </form>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (equipe === '') return;
              void agir(
                workApi.addProjectMembers(projectId, { teamIds: [equipe] }),
                'L’équipe n’a pas pu être ajoutée.',
              );
            }}
          >
            <label className="flex min-w-44 flex-1 flex-col gap-1 text-sm" htmlFor={`${id}-equipe`}>
              Ajouter une équipe entière
              <select
                id={`${id}-equipe`}
                className={CHAMP}
                value={equipe}
                onChange={(e) => setEquipe(e.target.value)}
              >
                <option value="">
                  {equipes.length === 0 ? 'Aucune équipe (RH › Équipes)' : 'Choisir…'}
                </option>
                {equipesAjoutables(equipes, vue).map((t) => (
                  <option key={t.teamId} value={t.teamId}>
                    {libelleEquipe(t)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className={buttonClasses('secondary', 'sm')}
              disabled={equipe === ''}
            >
              <UsersRound aria-hidden="true" className="h-4 w-4" />
              Ajouter l’équipe
            </button>
          </form>
          <p className="text-xs text-[var(--foreground-muted)] md:col-span-2">
            Une équipe ajoutée donne accès à tous ses membres, y compris ceux qui la rejoindront
            plus tard.
          </p>
        </div>
      ) : null}

      {vue === null ? null : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-label="Personnes" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Personnes</h3>
            <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
              {vue.owner ? (
                <li className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Avatar name={vue.owner.name} cle={vue.owner.userId} taille={28} />
                  <span className="min-w-0 flex-1 break-words">{vue.owner.name}</span>
                  <StatusPill tone="open">Responsable</StatusPill>
                </li>
              ) : null}
              {vue.users.length === 0 && !vue.owner ? (
                <li className="px-3 py-3 text-sm text-[var(--foreground-muted)]">
                  Personne n’est ajouté un à un.
                </li>
              ) : null}
              {vue.users.map((u) => (
                <li key={u.userId} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Avatar name={u.name} cle={u.userId} taille={28} />
                  <span className="min-w-0 flex-1 break-words">
                    {u.name}
                    {!u.canUpdate ? (
                      <span className="ml-2 text-xs text-[var(--foreground-muted)]">
                        lecture seule
                      </span>
                    ) : null}
                  </span>
                  {modifiable ? (
                    <button
                      type="button"
                      className={BOUTON_PETIT}
                      disabled={envoi}
                      onClick={() =>
                        void agir(
                          workApi.removeProjectUser(projectId, u.userId),
                          'Le membre n’a pas pu être retiré.',
                        )
                      }
                    >
                      <UserMinus aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                      Retirer<span className="sr-only"> {u.name}</span>
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Équipes" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Équipes</h3>
            {vue.teams.length === 0 ? (
              <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] px-3 py-3 text-sm text-[var(--foreground-muted)]">
                Aucune équipe ajoutée.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {vue.teams.map((t) => (
                  <li
                    key={t.teamId}
                    className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <UsersRound
                        aria-hidden="true"
                        className="h-4 w-4 text-[var(--foreground-muted)]"
                      />
                      <span className="min-w-0 flex-1 font-medium break-words">
                        {libelleEquipe(t)}
                      </span>
                      <PileAvatars membres={t.members} max={4} taille={24} />
                      {modifiable ? (
                        <button
                          type="button"
                          className={BOUTON_PETIT}
                          disabled={envoi}
                          onClick={() =>
                            void agir(
                              workApi.removeProjectTeam(projectId, t.teamId),
                              'L’équipe n’a pas pu être retirée.',
                            )
                          }
                        >
                          Retirer<span className="sr-only"> l’équipe {t.name}</span>
                        </button>
                      ) : null}
                    </div>
                    {t.members.length > 0 ? (
                      <p className="text-xs text-[var(--foreground-muted)]">
                        {t.members.map((m) => m.name).join(', ')}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
