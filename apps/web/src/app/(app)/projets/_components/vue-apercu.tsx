'use client';

// Onglet « Aperçu » d'un projet (ADR-0057), onglet par défaut : description,
// statut de santé, avancement (anneau), tâches ouvertes par responsable,
// courbe d'avancement sur 8 semaines, jalons à venir et tâches en retard.
// Tous les chiffres viennent du serveur (`GET /work/projects/:id/overview`) ;
// l'écran met en forme avec les graphiques maison de `@lalanda/ui`.

import type { WorkOverviewTaskRef } from '@lalanda/shared/work';
import {
  BarList,
  Card,
  ChartLegend,
  DonutChart,
  LineChart,
  Skeleton,
  StatusPill,
  type LineSeries,
} from '@lalanda/ui';
import Link from 'next/link';

import { SANTE, libellesSemaines, phraseSante, pourcentTermine } from './apercu-model';
import { Avatar, DateEcheance } from './elements';
import { hrefProjet } from './projets-model';
import { useProjet } from './project-context';

function Bloc({
  titre,
  children,
  className = '',
}: {
  titre: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <Card as="section" className={`flex min-w-0 flex-col gap-3 p-4 ${className}`}>
      <h2 className="text-sm font-semibold">{titre}</h2>
      {children}
    </Card>
  );
}

export function VueApercu(): React.ReactElement {
  const { project, apercu, chargement, gerer, travailler, tasks } = useProjet();

  if (project === null) {
    return chargement ? <Skeleton className="h-64 w-full" /> : <></>;
  }
  if (apercu === null) {
    return (
      <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full md:col-span-2" />
      </div>
    );
  }

  const t = apercu.totals;
  const total = t.open + t.done;
  const sante = SANTE[apercu.health.status];
  const semaines = libellesSemaines(apercu);
  const series: LineSeries[] = [
    {
      id: 'done',
      label: 'Terminées (cumul)',
      values: apercu.weeks.map((w) => w.done),
      color: 1,
      variant: 'area',
    },
    {
      id: 'total',
      label: 'Tâches créées (cumul)',
      values: apercu.weeks.map((w) => w.total),
      color: 3,
      variant: 'dashed',
    },
  ];
  const nombre = (v: number) => String(Math.round(v));

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Bloc titre="Description du projet" className="md:col-span-2 xl:col-span-2">
        {project.description ? (
          <p className="whitespace-pre-wrap break-words text-sm">{project.description}</p>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]">
            Aucune description.{' '}
            {gerer ? (
              <Link
                href={hrefProjet(project.id, 'reglages')}
                className="text-[var(--accent)] underline underline-offset-2"
              >
                Décrire le projet dans les Réglages
              </Link>
            ) : null}
          </p>
        )}
      </Bloc>

      <Bloc titre="Statut du projet">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={sante.tone}>{sante.label}</StatusPill>
          <span className="text-xs text-[var(--foreground-muted)]">calculé aujourd’hui</span>
        </div>
        <p className="text-sm">{phraseSante(apercu.health)}</p>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Chiffre label="Ouvertes" valeur={t.open} />
          <Chiffre label="Terminées" valeur={t.done} />
          <Chiffre label="En retard" valeur={t.overdue} alerte={t.overdue > 0} />
          <Chiffre label="Sans responsable" valeur={t.unassigned} />
        </dl>
      </Bloc>

      <Bloc titre="Avancement">
        {total === 0 ? (
          <VideTaches travailler={travailler} projectId={project.id} />
        ) : (
          <DonutChart
            title="Avancement des tâches"
            total={`${pourcentTermine(t)} %`}
            totalLabel="terminé"
            slices={[
              { id: 'done', label: 'Terminées', value: t.done, color: 1 },
              { id: 'open', label: 'Ouvertes', value: t.open, color: 6 },
            ]}
          />
        )}
      </Bloc>

      <Bloc titre="Tâches ouvertes par responsable">
        <BarList
          title="Tâches ouvertes par responsable"
          color={2}
          emptyText="Aucune tâche ouverte."
          items={apercu.openByAssignee.map((r) => ({
            id: r.assignee?.userId ?? 'aucun',
            label: r.assignee?.name ?? 'Sans responsable',
            value: r.open,
            display: r.overdue > 0 ? `${r.open} · ${r.overdue} en retard` : String(r.open),
          }))}
        />
      </Bloc>

      <Bloc titre="Tâches terminées, semaine par semaine" className="md:col-span-2 xl:col-span-1">
        <ChartLegend series={series} />
        <LineChart
          title="Tâches terminées et créées, cumulées, sur 8 semaines"
          labels={semaines.courts}
          fullLabels={semaines.complets}
          series={series}
          formatValue={nombre}
          endLabelSeriesId="done"
          height={160}
          emptyText="Aucune tâche sur la période."
        />
      </Bloc>

      <Bloc titre="Jalons à venir">
        {apercu.upcomingMilestones.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Aucun jalon à venir. Un jalon est une tâche à date unique (case « Jalon » du panneau).
          </p>
        ) : (
          <ListeTaches items={apercu.upcomingMilestones} />
        )}
      </Bloc>

      <Bloc titre={`Tâches en retard${t.overdue > 0 ? ` (${t.overdue})` : ''}`}>
        {apercu.overdueTasks.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            {tasks.length === 0 ? 'Rien en retard.' : 'Rien en retard : bravo.'}
          </p>
        ) : (
          <ListeTaches items={apercu.overdueTasks} />
        )}
      </Bloc>
    </div>
  );
}

function Chiffre({
  label,
  valeur,
  alerte = false,
}: {
  label: string;
  valeur: number;
  alerte?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-3 py-2">
      <dt className="text-xs text-[var(--foreground-muted)]">{label}</dt>
      <dd className={`font-mono text-lg font-medium ${alerte ? 'text-[var(--danger)]' : ''}`}>
        {valeur}
      </dd>
    </div>
  );
}

function ListeTaches({ items }: { items: readonly WorkOverviewTaskRef[] }): React.ReactElement {
  const { ouvrirTache, today } = useProjet();
  return (
    <ul className="-mx-1 flex flex-col">
      {items.map((x) => (
        <li key={x.taskId}>
          <button
            type="button"
            onClick={() => ouvrirTache(x.taskId)}
            className="flex min-h-9 w-full items-center gap-2 rounded-[var(--radius-sm)] px-1 text-left text-sm transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-muted)]"
          >
            <span className="min-w-0 flex-1 truncate">{x.title}</span>
            <DateEcheance task={{ ...x, isMilestone: false }} today={today} />
            {x.assignee ? (
              <Avatar name={x.assignee.name} cle={x.assignee.userId} taille={20} />
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function VideTaches({
  travailler,
  projectId,
}: {
  travailler: boolean;
  projectId: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-start gap-2 text-sm">
      <p className="font-medium">Ajoutez votre première tâche</p>
      <p className="text-[var(--foreground-muted)]">
        L’avancement s’affiche dès qu’une tâche existe.
      </p>
      {travailler ? (
        <Link
          href={hrefProjet(projectId, 'liste')}
          className="text-[var(--accent)] underline underline-offset-2"
        >
          Aller à la Liste
        </Link>
      ) : null}
    </div>
  );
}
