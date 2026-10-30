'use client';

// `/projets/mes-taches` — « Mes tâches » transverse (ADR-0039 § 4 et § 8) :
// tâches non terminées assignées à l'appelant, tous projets non archivés,
// groupées au jour de Kinshasa (en retard · aujourd'hui · 7 jours · plus tard ·
// sans date). La bascule vers un calendrier est le lot L3b
// (`mes-taches/calendrier`) : elle n'est pas affichée tant qu'il n'existe pas.
//
// ADR-0040 — C4 § 5 : les relances du CRM assignées à l'appelant figurent dans
// la même liste (pastille « Relance », compte ou opportunité) ; leur case se
// coche par la route du CRM ; un clic ouvre l'opportunité, le compte ou le contact.

import type { CrmMyTaskItem } from '@lalanda/shared/crm';
import type { HrMyTaskItem } from '@lalanda/shared/hr';
import type { PurchasesMyTaskItem } from '@lalanda/shared/purchases';
import type { MyTasksView, WorkMyTaskItem } from '@lalanda/shared/work';
import { EmptyState, PageHeader, Skeleton, buttonClasses } from '@lalanda/ui';
import { ClipboardCheck, Scale } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { crmAgendaApi } from '@/lib/crm-agenda-api';
import { workApi } from '@/lib/work-api';

import { useShell } from '../../_components/shell-context';

import { Alerte, BOUTON_PETIT, BloqueeBadge, Echeance, PrioriteBadge } from './elements';
import {
  GROUPES_MES_TACHES,
  PASTILLE_RELANCE,
  PASTILLE_APPROBATION,
  appliquerTache,
  estApprobation,
  estElementRh,
  estRelance,
  peutCocherRelance,
  retirerElement,
  pastilleElementRh,
  sousTitreApprobation,
  sousTitreElementRh,
  sousTitreRelance,
  titreElementRh,
  totalMesTaches,
} from './mes-taches-model';
import { PROJETS_BASE, hrefTache, messageWork, peutTravailler } from './projets-model';

export function MesTaches(): React.ReactElement {
  const { actions } = useShell();
  const travailler = peutTravailler(actions);
  const cocherRelances = peutCocherRelance(actions);
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

  async function cocherRelance(r: CrmMyTaskItem): Promise<void> {
    try {
      await crmAgendaApi.complete(r.activityId, r.revision);
      setVue((v) => (v ? retirerElement(v, r.id, dueSoon) : v));
      setAnnonce(`${r.kindLabel} « ${r.subject} » faite.`);
    } catch (err) {
      setErreur(messageWork(err, 'Impossible de cocher la relance.'));
      charger();
    }
  }

  async function terminer(t: WorkMyTaskItem): Promise<void> {
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
                    {liste.map((t) =>
                      estElementRh(t) ? (
                        <LigneElementRh key={t.id} e={t} today={vue.asOf} dueSoonDays={dueSoon} />
                      ) : estApprobation(t) ? (
                        <LigneApprobation key={t.id} a={t} today={vue.asOf} dueSoonDays={dueSoon} />
                      ) : estRelance(t) ? (
                        <LigneRelance
                          key={t.id}
                          r={t}
                          today={vue.asOf}
                          dueSoonDays={dueSoon}
                          peutCocher={cocherRelances}
                          onCocher={() => void cocherRelance(t)}
                        />
                      ) : (
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
                      ),
                    )}
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

/**
 * Approbation d'achat (ADR-0044 § 6.5, § 8) : pastille « Approbation », pas de case à
 * cocher — approuver exige une décision, le lien ouvre la demande.
 */
function LigneApprobation({
  a,
  today,
  dueSoonDays,
}: {
  a: PurchasesMyTaskItem;
  today: string;
  dueSoonDays: number;
}): React.ReactElement {
  return (
    <li className="relative flex min-w-0 flex-col gap-1.5 px-3 py-2.5 hover:bg-[var(--surface-muted)] sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <ClipboardCheck
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--module-run)]"
        />
        <span className="flex min-w-0 flex-col">
          <Link
            href={a.href}
            className="break-words text-sm font-medium underline-offset-2 after:absolute after:inset-0 hover:underline"
          >
            {a.title}
          </Link>
          <span className="truncate text-xs text-[var(--foreground-muted)]">
            {sousTitreApprobation(a)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[0.7rem] font-medium">
          <Scale aria-hidden="true" className="h-3 w-3" />
          {PASTILLE_APPROBATION}
        </span>
        <Echeance
          task={{ dueDate: a.dueDate, done: false, isMilestone: false }}
          today={today}
          dueSoonDays={dueSoonDays}
        />
      </div>
    </li>
  );
}

/**
 * Élément RH (ADR-0045 § 6.1, § 8) : absence à valider — pastille « Validation
 * d'absence », pas de case à cocher (valider est une décision), le lien ouvre la liste
 * « À valider » ; ou élément de liste d'entrée ou de sortie (lot H4), même forme.
 */
function LigneElementRh({
  e,
  today,
  dueSoonDays,
}: {
  e: HrMyTaskItem;
  today: string;
  dueSoonDays: number;
}): React.ReactElement {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <span aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-center text-xs">
          ✓
        </span>
        <span className="flex min-w-0 flex-col">
          <Link
            href={e.href}
            className="break-words text-sm font-medium underline-offset-2 hover:underline"
          >
            {titreElementRh(e)}
          </Link>
          <span className="truncate text-xs text-[var(--foreground-muted)]">
            {sousTitreElementRh(e)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[0.7rem] font-medium">
          <span aria-hidden="true">⏸</span>
          {pastilleElementRh(e)}
        </span>
        <Echeance
          task={{ dueDate: e.dueDate, done: false, isMilestone: false }}
          today={today}
          dueSoonDays={dueSoonDays}
        />
      </div>
    </li>
  );
}

/** Relance du CRM dans la liste (ADR-0040 — C4 § 8.2) : pastille, compte, case du CRM. */
function LigneRelance({
  r,
  today,
  dueSoonDays,
  peutCocher,
  onCocher,
}: {
  r: CrmMyTaskItem;
  today: string;
  dueSoonDays: number;
  peutCocher: boolean;
  onCocher: () => void;
}): React.ReactElement {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0"
          checked={false}
          disabled={!peutCocher}
          aria-label={`Marquer faite : ${r.kindLabel.toLowerCase()} « ${r.subject} »`}
          onChange={onCocher}
        />
        <span className="flex min-w-0 flex-col">
          <Link
            href={r.href}
            className="break-words text-sm font-medium underline-offset-2 hover:underline"
          >
            {r.subject}
          </Link>
          <span className="truncate text-xs text-[var(--foreground-muted)]">
            {r.kindLabel} · {sousTitreRelance(r)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[0.7rem] font-medium">
          <span aria-hidden="true">↻</span>
          {PASTILLE_RELANCE}
        </span>
        <Echeance
          task={{ dueDate: r.dueDate, done: false, isMilestone: false }}
          today={today}
          dueSoonDays={dueSoonDays}
        />
      </div>
    </li>
  );
}
