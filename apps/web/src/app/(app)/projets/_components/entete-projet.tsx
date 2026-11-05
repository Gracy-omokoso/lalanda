'use client';

// En-tête d'un projet façon Asana (ADR-0039 § 8, ADR-0057) : pastille de
// couleur, nom, statut de santé calculé par le serveur (En bonne voie / À
// risque / En retard), pile d'avatars de l'équipe du projet et « Partager »
// (membres du projet et visibilité, ADR-0060) ; une ligne de repères (client,
// devis, responsable, dates) ; puis les onglets de `onglets-projet.ts`.

import { Skeleton, StatusPill, TabsNav } from '@lalanda/ui';
import { FolderKanban, Lock, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { renderNextLink } from '@/components/next-link';

import { useShell } from '../../_components/shell-context';

import { SANTE, phraseSante } from './apercu-model';
import { Alerte, BOUTON_PETIT, PileAvatars } from './elements';
import { teinteAvatar } from './liste-model';
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
import { membresConnus } from './taches-model';

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
    apercu,
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
  // Personnes du projet : responsable, puis responsables des tâches (pas toute l'organisation).
  const equipe = membresConnus(project, tasks);
  const teinte = teinteAvatar(project.id);
  // ADR-0060 : « Partager » ouvre les membres du projet (personnes, équipes, visibilité).
  // Tout lecteur du projet voit qui y a accès ; seul `work.manage` modifie.
  const partager = actions !== null && actions.includes('work.read');

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Link
        href={PROJETS_BASE}
        className="self-start text-sm text-[var(--foreground-muted)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
      >
        ← Tous les projets
      </Link>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)]"
          style={{ background: `var(--label-${teinte}-bg)`, color: `var(--label-${teinte}-fg)` }}
        >
          <FolderKanban className="h-5 w-5" />
        </span>
        <h1 className="min-w-0 break-words font-[family-name:var(--font-heading,inherit)] text-[length:var(--font-size-h1)] font-semibold leading-tight">
          {project.name}
        </h1>
        {apercu && project.status !== 'archived' ? (
          <StatusPill tone={SANTE[apercu.health.status].tone} title={phraseSante(apercu.health)}>
            {SANTE[apercu.health.status].label}
          </StatusPill>
        ) : null}
        {project.status !== 'active' ? (
          <StatusPill tone="draft">{STATUTS_PROJET[project.status]}</StatusPill>
        ) : null}
        {project.visibility === 'private' ? (
          <span
            className="inline-flex items-center gap-1 text-xs text-[var(--foreground-muted)]"
            title="Projet privé : visible de ses membres et de la direction"
          >
            <Lock aria-hidden="true" className="h-3.5 w-3.5" />
            Privé
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <PileAvatars membres={equipe} max={5} />
          {partager ? (
            <Link
              href={hrefProjet(project.id, 'membres')}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent)] px-3 text-sm font-medium text-[var(--accent-foreground)] transition-opacity duration-[var(--motion-fast)] hover:opacity-90"
              title="Membres du projet, équipes et visibilité"
            >
              <UserPlus aria-hidden="true" className="h-4 w-4" />
              Partager
            </Link>
          ) : null}
        </span>
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--foreground-muted)]">
        <div className="flex gap-1">
          <dt className="sr-only">Nature</dt>
          <dd>{NATURES_PROJET[project.kind]}</dd>
        </div>
        {project.links.customerName ? (
          <div className="flex gap-1">
            <dt>Client :</dt>
            <dd className="text-[var(--foreground)]">{project.links.customerName}</dd>
          </div>
        ) : null}
        {project.links.opportunityTitle ? (
          <div className="flex gap-1">
            <dt>Opportunité :</dt>
            <dd className="text-[var(--foreground)]">{project.links.opportunityTitle}</dd>
          </div>
        ) : null}
        {project.links.quotes.length > 0 ? (
          <div className="flex gap-1">
            <dt>Devis :</dt>
            <dd>
              {project.links.quotes.map((q, i) => (
                <span key={q.quoteId}>
                  {i > 0 ? ', ' : null}
                  <Link
                    href={`/ventes/devis/${encodeURIComponent(q.quoteId)}`}
                    className="text-[var(--foreground)] underline underline-offset-2"
                  >
                    {q.number ?? 'brouillon'}
                  </Link>
                </span>
              ))}
            </dd>
          </div>
        ) : null}
        <div className="flex gap-1">
          <dt>Responsable :</dt>
          <dd className="text-[var(--foreground)]">{project.owner?.name ?? 'aucun'}</dd>
        </div>
        {project.startDate || project.dueDate ? (
          <div className="flex gap-1">
            <dt>Dates :</dt>
            <dd className="text-[var(--foreground)]">
              {formatJour(project.startDate)} → {formatJour(project.dueDate)}
            </dd>
          </div>
        ) : null}
        <div className="flex gap-1">
          <dt className="sr-only">Progression</dt>
          <dd>{prog.texte}</dd>
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
