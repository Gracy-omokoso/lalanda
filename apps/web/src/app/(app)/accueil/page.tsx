'use client';

// `/accueil` — page d'arrivée après connexion (ADR-0038 § 5).
//
// Trois grandes cartes BUILD · RUN · GROW, chacune avec deux ou trois chiffres
// lus sur des API EXISTANTES, puis ce qui concerne toute l'entreprise (alertes
// du brief du matin, mise en route). Un chiffre illisible n'est pas inventé :
// la carte affiche une phrase d'appel à sa place. Aucune API nouvelle.
// ADR-0039 § 6.5 : carte « Mes tâches » (`GET /work/my-tasks`) avec `work.read`.

import { ModuleIcon, type ModuleId } from '@lalanda/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api, type SettlementView } from '@/lib/api';
import { growApi } from '@/lib/grow-api';
import { ideaLabApi } from '@/lib/idea-lab-api';
import { morningBriefApi, type BriefRuleOutcomeView } from '@/lib/morning-brief-api';

import { moduleParId, ordreAccueil } from '../_components/nav-model';
import { useShell } from '../_components/shell-context';
import {
  MISE_EN_ROUTE_BASE,
  progression,
  termine,
} from '../organisation/_components/onboarding-model';
import { useMiseEnRoute } from '../organisation/_components/use-mise-en-route';

import {
  alertesAccueil,
  APPELS,
  chiffresBuild,
  chiffresGrow,
  chiffresRun,
  type Chiffre,
} from './_components/accueil-model';
import { MesTachesCarte } from './_components/mes-taches-carte';
import { carteVisible } from './_components/mes-taches-model';

interface Faits {
  initiatives: number | null;
  ideesActives: number | null;
  factures: SettlementView[] | null;
  alertes: BriefRuleOutcomeView[] | null;
  sante: number | null;
}

const VIDE: Faits = {
  initiatives: null,
  ideesActives: null,
  factures: null,
  alertes: null,
  sante: null,
};

/** Valeur d'une promesse réglée, ou `null` si elle a échoué. */
function lue<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === 'fulfilled' ? r.value : null;
}

const COULEUR: Record<ModuleId, string> = {
  build: 'text-[var(--module-build)]',
  run: 'text-[var(--module-run)]',
  grow: 'text-[var(--module-grow)]',
};

const FILET: Record<ModuleId, string> = {
  build: 'bg-[var(--module-build)]',
  run: 'bg-[var(--module-run)]',
  grow: 'bg-[var(--module-grow)]',
};

export default function AccueilPage(): React.ReactElement {
  const { actions, chargees, modules, organizationId } = useShell();
  const [faits, setFaits] = useState<Faits>(VIDE);
  const [pret, setPret] = useState(false);
  const lireVentes = actions?.includes('sales.read') ?? false;

  useEffect(() => {
    // On attend les permissions : interroger les ventes sans `sales.read`
    // produirait un 403 prévisible.
    if (!chargees) return;
    let annule = false;
    void Promise.allSettled([
      api.listProjects(),
      ideaLabApi.list(),
      lireVentes ? api.getOpenSettlements() : Promise.reject(new Error('non lu')),
      morningBriefApi.get(),
      growApi.getHealth(),
    ]).then(([projets, idees, factures, brief, sante]) => {
      if (annule) return;
      const score = lue(sante)?.health.score;
      setFaits({
        initiatives: lue(projets)?.projects.length ?? null,
        ideesActives: lue(idees)?.ideas.filter((i) => !i.archived).length ?? null,
        factures: lue(factures)?.items ?? null,
        alertes: lue(brief)?.brief.alerts ?? null,
        sante: score && score.disponible ? score.valeur : null,
      });
      setPret(true);
    });
    return () => {
      annule = true;
    };
  }, [chargees, lireVentes, organizationId]);

  const chiffres: Record<ModuleId, Chiffre[]> = {
    build: chiffresBuild(faits),
    run: chiffresRun(faits.factures),
    grow: chiffresGrow({
      alertes: faits.alertes === null ? null : faits.alertes.length,
      sante: faits.sante,
    }),
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Accueil</h1>
        <p className="text-sm text-[var(--foreground-muted)]">
          Concevoir, exploiter, croître : vos trois modules et ce qui demande votre attention.
        </p>
      </header>

      <ul className="grid gap-4 md:grid-cols-3">
        {ordreAccueil(modules).map((id) => (
          <li key={id}>
            <CarteModule module={id} chiffres={chiffres[id]} pret={pret} />
          </li>
        ))}
      </ul>

      <section aria-labelledby="entreprise-titre" className="flex flex-col gap-4">
        <h2 id="entreprise-titre" className="font-display text-lg font-semibold">
          Toute l’entreprise
        </h2>
        <div className="grid gap-4 lg:auto-cols-fr lg:grid-flow-col">
          {/* ADR-0039 § 6.5 : carte « Mes tâches », seulement avec `work.read`. */}
          {carteVisible(actions) ? <MesTachesCarte organizationId={organizationId} /> : null}
          <AlertesBrief alertes={faits.alertes} pret={pret} />
          <MiseEnRoute />
        </div>
      </section>
    </div>
  );
}

function CarteModule({
  module,
  chiffres,
  pret,
}: {
  module: ModuleId;
  chiffres: Chiffre[];
  pret: boolean;
}): React.ReactElement {
  const m = moduleParId(module);
  return (
    <Link
      href={m.href}
      className="group relative flex h-full flex-col gap-5 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-pop)] sm:p-6"
    >
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${FILET[module]}`} />
      <span className="flex items-start justify-between gap-4">
        <span className="flex flex-col">
          <span className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {m.label}
          </span>
          <span className="text-sm font-medium text-[var(--foreground-muted)]">{m.verb}</span>
        </span>
        <ModuleIcon module={module} strokeWidth={1.5} className={`h-10 w-10 ${COULEUR[module]}`} />
      </span>

      {!pret ? (
        <span aria-hidden="true" className="flex flex-col gap-2">
          <span className="h-5 w-3/4 rounded bg-[var(--surface-muted)]" />
          <span className="h-5 w-2/3 rounded bg-[var(--surface-muted)]" />
        </span>
      ) : chiffres.length > 0 ? (
        <dl className="flex flex-col gap-1.5">
          {chiffres.map((c) => (
            <div key={c.id} className="flex items-baseline gap-2">
              <dt className="sr-only">{c.libelle}</dt>
              <dd className="flex items-baseline gap-2">
                <span
                  className={`font-mono text-xl font-semibold tabular-nums ${c.attention ? 'text-[var(--danger)]' : ''}`}
                >
                  {c.valeur}
                </span>
                <span aria-hidden="true" className="text-sm text-[var(--foreground-muted)]">
                  {c.libelle}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-[var(--foreground-muted)]">{APPELS[module]}</p>
      )}

      <span className={`mt-auto text-sm font-semibold ${COULEUR[module]}`}>
        Ouvrir {m.label}{' '}
        <span aria-hidden="true" className="inline-block transition group-hover:translate-x-0.5">
          →
        </span>
      </span>
    </Link>
  );
}

const TON: Record<string, string> = {
  critique: 'border-l-[var(--danger)]',
  attention: 'border-l-[var(--warn)]',
  info: 'border-l-[var(--border-strong)]',
};

const SEVERITE: Record<string, string> = {
  critique: 'Critique',
  attention: 'Attention',
  info: 'Information',
};

function AlertesBrief({
  alertes,
  pret,
}: {
  alertes: BriefRuleOutcomeView[] | null;
  pret: boolean;
}): React.ReactElement {
  const liste = alertes === null ? [] : alertesAccueil(alertes);
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Brief du matin</h3>
        <Link
          href="/organisation/brief"
          className="text-sm font-medium text-[var(--accent)] underline-offset-2 hover:underline"
        >
          Lire le brief complet
        </Link>
      </div>
      {!pret ? (
        <span aria-hidden="true" className="h-12 rounded bg-[var(--surface-muted)]" />
      ) : alertes === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Le brief n’a pas pu être lu pour l’instant. Ouvrez-le pour réessayer.
        </p>
      ) : liste.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Aucune alerte ce matin : rien ne demande votre attention immédiate.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {liste.map((a) => (
            <li key={a.id}>
              <Link
                href={a.lien}
                className={`block rounded-[var(--radius-md)] border border-l-4 border-[var(--border)] ${TON[a.severite] ?? ''} px-3 py-2 transition hover:bg-[var(--surface-muted)]`}
              >
                <span className="block text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                  {SEVERITE[a.severite]}
                </span>
                <span className="block text-sm font-medium">{a.titre}</span>
                {a.message ? (
                  <span className="block text-sm text-[var(--foreground-muted)]">{a.message}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Rappel de la mise en route tant qu'une étape ouverte au rôle reste à faire. */
function MiseEnRoute(): React.ReactElement | null {
  const { faits, pret } = useMiseEnRoute();
  if (!pret || termine(faits)) return null;
  const { faites, total } = progression(faits);
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="text-sm font-semibold">
        Mise en route · {faites}/{total}
      </h3>
      <div
        aria-hidden="true"
        className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]"
      >
        <div
          className="h-full rounded-full bg-[var(--accent)]"
          style={{ width: `${total ? Math.round((faites / total) * 100) : 0}%` }}
        />
      </div>
      <p className="text-sm text-[var(--foreground-muted)]">
        Identité visuelle, profil fiscal, points de vente : ce qu’il faut pour facturer en règle.
      </p>
      <Link
        href={MISE_EN_ROUTE_BASE}
        className="text-sm font-medium text-[var(--accent)] underline-offset-2 hover:underline"
      >
        Reprendre la mise en route
        <span className="sr-only">
          {' '}
          ({faites} étapes faites sur {total})
        </span>
      </Link>
    </div>
  );
}
