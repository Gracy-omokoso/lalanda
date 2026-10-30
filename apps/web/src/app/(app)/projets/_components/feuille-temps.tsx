'use client';

// `/projets/mes-taches/temps` — feuille de temps hebdomadaire en LECTURE seule
// (ADR-0045 O5, § 6.3), lot H7 : grille jour × projet des saisies existantes,
// croisée avec les absences accordées (sans le type) et les jours fériés, et les
// constats rendus par l'API. Aucune saisie, validation ni verrou : on saisit son
// temps depuis les tâches. Totaux et constats viennent du moteur (`weeklyTimesheet`).

import type { WeeklyTimesheetView } from '@lalanda/shared/work';
import { PageHeader, buttonClasses } from '@lalanda/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { hrAdminApi } from '@/lib/api-hr-admin';
import { workApi, type WorkMemberOption } from '@/lib/work-api';

import { useShell } from '../../_components/shell-context';

import { Alerte, BOUTON_PETIT } from './elements';
import { MES_TACHES_HREF, messageWork, peutLire } from './projets-model';
import {
  enteteJour,
  etatJour,
  formatMinutes,
  formatPrevu,
  messageConstat,
  peutChoisirMembre,
  phraseSemaine,
  semaineVoisine,
  tonConstat,
} from './temps-model';

const TH = 'px-2 py-2 text-left text-xs font-semibold text-[var(--foreground-muted)]';
const TD = 'px-2 py-2 align-top tabular-nums';

export function FeuilleTemps(): React.ReactElement {
  const { actions, chargees } = useShell();
  const lecture = peutLire(actions);
  const choisir = peutChoisirMembre(actions);
  const [semaine, setSemaine] = useState<string | undefined>(undefined);
  const [membre, setMembre] = useState('');
  const [membres, setMembres] = useState<WorkMemberOption[]>([]);
  const [vue, setVue] = useState<WeeklyTimesheetView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    if (!choisir) return;
    workApi
      .listMembers()
      .then(setMembres)
      .catch(() => undefined);
  }, [choisir]);

  useEffect(() => {
    if (!lecture) return;
    let annule = false;
    setChargement(true);
    hrAdminApi
      .getTimesheet({
        ...(semaine ? { week: semaine } : {}),
        ...(membre ? { userId: membre } : {}),
      })
      .then((v) => {
        if (annule) return;
        setVue(v);
        setErreur(null);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(messageWork(err, 'La feuille de temps est illisible.'));
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [lecture, semaine, membre]);

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-busy={chargement}>
      <PageHeader
        module="run"
        moduleLabel="Exploiter · Projets"
        title="Feuille de temps"
        description="Votre semaine en lecture : le temps saisi sur les tâches, les absences accordées et les jours fériés. Rien ne se saisit ni ne se valide ici."
        actions={
          <Link href={MES_TACHES_HREF} className={buttonClasses('secondary', 'md')}>
            Mes tâches
          </Link>
        }
      />
      {chargees && !lecture ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Les projets ne sont pas ouverts à votre rôle.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={BOUTON_PETIT}
              disabled={!vue}
              onClick={() => vue && setSemaine(semaineVoisine(vue.week, -1))}
            >
              <ChevronLeft aria-hidden="true" className="inline h-3.5 w-3.5" /> Semaine précédente
            </button>
            <button
              type="button"
              className={BOUTON_PETIT}
              disabled={!vue}
              onClick={() => vue && setSemaine(semaineVoisine(vue.week, 1))}
            >
              Semaine suivante <ChevronRight aria-hidden="true" className="inline h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={BOUTON_PETIT}
              disabled={semaine === undefined}
              onClick={() => setSemaine(undefined)}
            >
              Cette semaine
            </button>
            {choisir && membres.length > 0 ? (
              <select
                aria-label="Membre"
                className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-xs"
                value={membre}
                onChange={(e) => setMembre(e.target.value)}
              >
                <option value="">Moi</option>
                {membres.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <p className="sr-only" aria-live="polite">
            {vue ? phraseSemaine(vue) : ''}
          </p>
          {erreur ? <Alerte>{erreur}</Alerte> : null}
          {vue ? (
            <div className={`flex min-w-0 flex-col gap-4 ${chargement ? 'opacity-60' : ''}`}>
              <p className="text-sm font-medium">
                {phraseSemaine(vue)} — {vue.user.name}
                {vue.employeeLinked
                  ? ''
                  : ' (sans fiche collaborateur : semaine de l’organisation, aucune absence)'}
              </p>
              <div className="max-w-full overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
                <table className="w-full min-w-[44rem] border-collapse text-sm">
                  <caption className="sr-only">
                    Temps saisi par projet et par jour, {phraseSemaine(vue)}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Projet
                      </th>
                      {vue.days.map((j) => (
                        <th key={j.date} scope="col" className={TH}>
                          <span className="block">{enteteJour(j)}</span>
                          <span className="block font-normal">
                            {etatJour(j) ?? `Prévu ${formatPrevu(j.expected)}`}
                          </span>
                        </th>
                      ))}
                      <th scope="col" className={TH}>
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {vue.projects.length === 0 ? (
                      <tr className="border-t border-[var(--border)]">
                        <td
                          colSpan={vue.days.length + 2}
                          className={`${TD} text-[var(--foreground-muted)]`}
                        >
                          Aucun temps saisi cette semaine.
                        </td>
                      </tr>
                    ) : (
                      vue.projects.map((p) => (
                        <tr key={p.projectId} className="border-t border-[var(--border)]">
                          <th scope="row" className={`${TD} text-left font-medium`}>
                            {p.projectName}
                          </th>
                          {p.minutesByDay.map((m, i) => (
                            <td key={vue.days[i]?.date ?? i} className={TD}>
                              {formatMinutes(m)}
                            </td>
                          ))}
                          <td className={`${TD} font-semibold`}>{formatMinutes(p.totalMinutes)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[var(--border-strong)]">
                      <th scope="row" className={`${TD} text-left`}>
                        Total du jour
                      </th>
                      {vue.days.map((j) => (
                        <td key={j.date} className={`${TD} font-semibold`}>
                          {formatMinutes(j.totalMinutes)}
                        </td>
                      ))}
                      <td className={`${TD} font-bold`}>{formatMinutes(vue.totalMinutes)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {vue.findings.length > 0 ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {vue.findings.map((c) => (
                    <li
                      key={`${c.code}-${c.date}`}
                      className={`rounded-[var(--radius-md)] border p-3 ${
                        tonConstat(c) === 'attention'
                          ? 'border-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)]'
                          : 'border-[var(--border)] bg-[var(--surface-muted)]'
                      }`}
                    >
                      <span className="font-semibold">
                        {tonConstat(c) === 'attention' ? 'À vérifier : ' : 'Information : '}
                      </span>
                      {messageConstat(c)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : chargement ? (
            <p className="text-sm text-[var(--foreground-muted)]">Chargement de la feuille…</p>
          ) : null}
        </>
      )}
    </section>
  );
}
