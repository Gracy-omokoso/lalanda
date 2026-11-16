'use client';

// `/projets/mes-taches/temps/a-valider` — semaines de temps soumises que l'appelant peut
// valider (ADR-0077 § 4) : son équipe (relation de manager du moteur RH) et, avec
// `work.manage`, toutes les autres sauf les siennes. Chaque ligne ouvre la feuille du
// membre, où l'on approuve ou renvoie. Lien du brief du matin (règle R21).

import type { PendingTimesheetView } from '@lalanda/shared/work';
import { timesheetHref } from '@lalanda/shared/work';
import { Alert, PageHeader, buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { workSyncApi } from '@/lib/work-sync-api';

import { useShell } from '../../_components/shell-context';

import { OngletsMesTaches } from './equipe-elements';
import { messageWork, peutLire } from './projets-model';
import { TEMPS_HREF, formatMinutes } from './temps-model';

export function TempsAValider(): React.ReactElement {
  const { actions, chargees } = useShell();
  const lecture = peutLire(actions);
  const [items, setItems] = useState<PendingTimesheetView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!lecture) return;
    workSyncApi
      .pendingTimesheets()
      .then((r) => setItems(r.items))
      .catch((err: unknown) => setErreur(messageWork(err, 'La liste est illisible.')));
  }, [lecture]);

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-busy={items === null && !erreur}>
      <PageHeader
        module="run"
        moduleLabel="Exploiter · Projets"
        title="Feuilles de temps à valider"
        description="Semaines soumises par votre équipe. Ouvrez une feuille pour l’approuver ou la renvoyer avec un motif."
        actions={
          <Link href={TEMPS_HREF} className={buttonClasses('secondary', 'md')}>
            Ma feuille de temps
          </Link>
        }
      />
      <OngletsMesTaches actif="temps" />
      {chargees && !lecture ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Les projets ne sont pas ouverts à votre rôle.
        </p>
      ) : erreur ? (
        <Alert tone="danger">{erreur}</Alert>
      ) : items === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">Aucune semaine à valider.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
          {items.map((p) => (
            <li
              key={`${p.user.userId}-${p.week}`}
              className="relative flex flex-wrap items-center gap-2 px-3 py-2.5 hover:bg-[var(--surface-muted)]"
            >
              <Link
                href={timesheetHref(p.user.userId, p.week)}
                className="min-w-0 flex-1 text-sm font-medium underline-offset-2 after:absolute after:inset-0 hover:underline"
              >
                {p.user.name} — semaine du {p.week.slice(8, 10)}/{p.week.slice(5, 7)}
              </Link>
              <span className="text-sm tabular-nums">{formatMinutes(p.totalMinutes)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
