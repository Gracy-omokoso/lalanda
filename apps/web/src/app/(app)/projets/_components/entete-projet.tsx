'use client';

// En-tête d'un projet et ses onglets (ADR-0039 § 8) : nom, nature, client,
// devis, responsable, dates, progression ; puis Liste · Kanban · (Calendrier ·
// Chronologie, lot L3b) · Réglages. Les onglets viennent de `onglets-projet.ts`.

import { Badge, PageHeader, Skeleton, TabsNav } from '@lalanda/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { renderNextLink } from '@/components/next-link';

import { useShell } from '../../_components/shell-context';

import { Alerte, BOUTON_PETIT } from './elements';
import { PropositionFacture } from './marge/proposition-facture';
import { ONGLET_DEFAUT, ongletDuChemin, ongletsVisibles } from './onglets-projet';
import { useProjet } from './project-context';
import {
  NATURES_PROJET,
  PROJETS_BASE,
  STATUTS_PROJET,
  formatJour,
  hrefProjet,
  progression,
} from './projets-model';

export function EnteteProjet(): React.ReactElement {
  const { actions } = useShell();
  const pathname = usePathname();
  const {
    project,
    tasks,
    erreur,
    chargement,
    avertissements,
    effacerAvertissements,
    effacerErreur,
    recharger,
    factureProposee,
    fermerPropositionFacture,
  } = useProjet();

  const courant = ongletDuChemin(pathname) ?? ONGLET_DEFAUT;
  const onglets = ongletsVisibles(actions);

  if (project === null) {
    return (
      <div className="flex flex-col gap-4" aria-busy={chargement}>
        <Link href={PROJETS_BASE} className="text-sm underline-offset-2 hover:underline">
          ← Tous les projets
        </Link>
        {erreur ? (
          <Alerte
            action={
              <button type="button" className={BOUTON_PETIT} onClick={recharger}>
                Réessayer
              </button>
            }
          >
            <p>{erreur}</p>
          </Alerte>
        ) : (
          <Skeleton className="h-20 w-full" />
        )}
      </div>
    );
  }

  const premier = tasks.filter((t) => t.parentTaskId === null);
  const prog = progression({
    openTaskCount: premier.filter((t) => !t.done).length,
    doneTaskCount: premier.filter((t) => t.done).length,
  });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Link href={PROJETS_BASE} className="text-sm underline-offset-2 hover:underline">
        ← Tous les projets
      </Link>
      <PageHeader
        module="run"
        moduleLabel="Exploiter · Projets"
        title={<span className="break-words">{project.name}</span>}
        description={project.description ?? undefined}
        descriptionMobile
      />
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <dt className="sr-only">Statut</dt>
          <dd>
            <Badge tone={project.status === 'active' ? 'info' : 'neutral'}>
              {STATUTS_PROJET[project.status]}
            </Badge>
          </dd>
          <dt className="sr-only">Nature</dt>
          <dd className="text-[var(--foreground-muted)]">{NATURES_PROJET[project.kind]}</dd>
        </div>
        {project.links.customerName ? (
          <div className="flex gap-1">
            <dt className="text-[var(--foreground-muted)]">Client :</dt>
            <dd>{project.links.customerName}</dd>
          </div>
        ) : null}
        {project.links.opportunityTitle ? (
          <div className="flex gap-1">
            <dt className="text-[var(--foreground-muted)]">Opportunité :</dt>
            <dd>{project.links.opportunityTitle}</dd>
          </div>
        ) : null}
        {project.links.quotes.length > 0 ? (
          <div className="flex gap-1">
            <dt className="text-[var(--foreground-muted)]">Devis :</dt>
            <dd>
              {project.links.quotes.map((q, i) => (
                <span key={q.quoteId}>
                  {i > 0 ? ', ' : null}
                  <Link
                    href={`/ventes/devis/${encodeURIComponent(q.quoteId)}`}
                    className="underline underline-offset-2"
                  >
                    {q.number ?? 'brouillon'}
                  </Link>
                </span>
              ))}
            </dd>
          </div>
        ) : null}
        <div className="flex gap-1">
          <dt className="text-[var(--foreground-muted)]">Responsable :</dt>
          <dd>{project.owner?.name ?? 'aucun'}</dd>
        </div>
        {project.startDate || project.dueDate ? (
          <div className="flex gap-1">
            <dt className="text-[var(--foreground-muted)]">Dates :</dt>
            <dd>
              {formatJour(project.startDate)} → {formatJour(project.dueDate)}
            </dd>
          </div>
        ) : null}
        <div className="flex min-w-[12rem] items-center gap-2">
          <dt className="sr-only">Progression</dt>
          <dd className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--surface-muted)]"
            >
              <span
                className="block h-full bg-[var(--module-run)]"
                style={{ width: `${prog.pourcent}%` }}
              />
            </span>
            <span className="text-[var(--foreground-muted)]">{prog.texte}</span>
          </dd>
        </div>
      </dl>
      {project.status === 'archived' ? (
        <p role="status" className="text-sm text-[var(--foreground-muted)]">
          Projet archivé : lecture seule. Un gestionnaire peut le restaurer dans les Réglages.
        </p>
      ) : null}

      <TabsNav
        label="Vues du projet"
        renderLink={renderNextLink}
        items={onglets.map((o) => ({
          href: hrefProjet(project.id, o.segment),
          label: o.label,
          current: o.segment === courant,
        }))}
      />

      {erreur ? (
        <Alerte
          action={
            <button type="button" className={BOUTON_PETIT} onClick={effacerErreur}>
              Fermer
            </button>
          }
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {factureProposee ? (
        <PropositionFacture
          key={factureProposee}
          taskId={factureProposee}
          project={project}
          onPrepared={recharger}
          onClose={fermerPropositionFacture}
        />
      ) : null}
      <div aria-live="polite">
        {avertissements.length > 0 ? (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,var(--surface))] p-3 text-sm sm:flex-row sm:items-start sm:justify-between"
          >
            <ul className="flex flex-col gap-1">
              {avertissements.map((m) => (
                <li key={m}>
                  <span aria-hidden="true">⚠ </span>
                  {m}
                </li>
              ))}
            </ul>
            <button type="button" className={BOUTON_PETIT} onClick={effacerAvertissements}>
              Compris
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
