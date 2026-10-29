'use client';

// `/projets/mes-taches` — « Mes tâches » transverse (ADR-0039 § 4 et § 8) :
// tâches non terminées assignées à l'appelant, tous projets non archivés,
// groupées au jour de Kinshasa (en retard · aujourd'hui · 7 jours · plus tard ·
// sans date). La bascule vers un calendrier est le lot L3b
// (`mes-taches/calendrier`) : elle n'est pas affichée tant qu'il n'existe pas.

import type { MyTaskItem, MyTasksView } from '@lalanda/shared/work';
import { EmptyState, PageHeader, Skeleton, buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { workApi } from '@/lib/work-api';

import { useShell } from '../../_components/shell-context';

import { Alerte, BOUTON_PETIT, BloqueeBadge, Echeance, PrioriteBadge } from './elements';
import { GROUPES_MES_TACHES, appliquerTache, totalMesTaches } from './mes-taches-model';
import { PROJETS_BASE, hrefTache, messageWork, peutTravailler } from './projets-model';

export function MesTaches(): React.ReactElement {
  const { actions } = useShell();
  const travailler = peutTravailler(actions);
  const [vue, setVue] = useState<MyTasksView | null>(null);
  const [dueSoon, setDueSoon] = useState(1);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState('');

  const charger = useCallback(() => {
    workApi
      .myTasks()
      .then((v) => {
        setVue(v);
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageWork(err, 'Impossible de charger vos tâches.')));
    workApi
      .getSettings()
      .then((s) => setDueSoon(s.dueSoonDays))
      .catch(() => undefined);
  }, []);
  useEffect(() => charger(), [charger]);

  async function terminer(t: MyTaskItem): Promise<void> {
    try {
      const r = await workApi.completeTask(t.id, t.revision);
      setVue((v) => (v ? appliquerTache(v, r.task, dueSoon) : v));
      setAnnonce(`#${t.number} « ${t.title} » terminée.`);
    } catch (err) {
      setErreur(messageWork(err, 'Impossible de terminer la tâche.'));
      charger();
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <PageHeader
        module="run"
        moduleLabel="Exploiter · Projets"
        title="Mes tâches"
        description="Les tâches qui vous sont assignées, tous projets confondus, de la plus urgente à la plus lointaine."
        actions={
          <>
            <Link
              href={`${PROJETS_BASE}/mes-taches/calendrier`}
              className={buttonClasses('secondary', 'md')}
            >
              Calendrier
            </Link>
            <Link href={PROJETS_BASE} className={buttonClasses('secondary', 'md')}>
              Tous les projets
            </Link>
          </>
        }
      />
      <p className="sr-only" aria-live="polite">
        {annonce}
      </p>
      {erreur ? (
        <Alerte
          action={
            <button type="button" className={BOUTON_PETIT} onClick={charger}>
              Réessayer
            </button>
          }
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {vue === null ? (
        erreur ? null : (
          <div aria-busy="true" className="flex flex-col gap-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )
      ) : totalMesTaches(vue) === 0 ? (
        <EmptyState
          title="Aucune tâche ouverte pour vous"
          description="Quand une tâche vous sera assignée dans un projet, elle apparaîtra ici."
          action={
            <Link href={PROJETS_BASE} className={buttonClasses('secondary', 'md')}>
              Voir les projets
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {GROUPES_MES_TACHES.map((g) => {
            const liste = vue[g.cle];
            return (
              <section key={g.cle} aria-labelledby={`mt-${g.cle}`} className="flex flex-col gap-2">
                <h2
                  id={`mt-${g.cle}`}
                  className="flex items-baseline gap-2 text-base font-semibold"
                >
                  {g.titre}
                  <span className="text-sm font-normal text-[var(--foreground-muted)]">
                    ({liste.length})
                  </span>
                </h2>
                {liste.length === 0 ? (
                  <p className="text-sm text-[var(--foreground-muted)]">{g.vide}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
                    {liste.map((t) => (
                      <li
                        key={t.id}
                        className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0"
                            checked={false}
                            disabled={!travailler}
                            aria-label={`Terminer #${t.number} ${t.title}`}
                            onChange={() => void terminer(t)}
                          />
                          <span className="flex min-w-0 flex-col">
                            <Link
                              href={hrefTache(t.projectId, t.id)}
                              className="break-words text-sm font-medium underline-offset-2 hover:underline"
                            >
                              <span className="text-[var(--foreground-muted)]">#{t.number}</span>{' '}
                              {t.title}
                            </Link>
                            <span className="truncate text-xs text-[var(--foreground-muted)]">
                              {t.projectName}
                            </span>
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
                          {t.blocked ? <BloqueeBadge /> : null}
                          <PrioriteBadge priority={t.priority} />
                          <Echeance task={t} today={vue.asOf} dueSoonDays={dueSoon} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
