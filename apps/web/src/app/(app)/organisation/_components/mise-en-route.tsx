'use client';

// Mise en route d'une organisation (ADR-0030 § 8).
//
// Quatre étapes reprenables : identité visuelle, profil fiscal, points de vente,
// choix des modules. Les trois premières SONT les panneaux existants — aucune
// logique, aucun appel d'API n'est dupliqué ici. Ce composant ne fait que :
//   - lire où l'on en est (`useMiseEnRoute`, déduit des données enregistrées) ;
//   - présenter une étape à la fois, avec sa raison d'être ;
//   - permettre d'aller et venir librement (chaque étape est une URL).

import { buttonClasses, MODULES, PageHeader, Progress, Stepper, type ModuleId } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PLAN_LABELS } from '../../souscription/_components/subscription-model';
import { useShell } from '../../_components/shell-context';
import { MODULE_IDS } from '../../_components/nav-model';

import { BrandIdentityPanel } from './brand-identity-panel';
import { FiscalProfilePanel } from './fiscal-profile-panel';
import { NormalizedInvoicingPanel } from './normalized-invoicing-panel';
import {
  ETAPES,
  etapeDeReprise,
  etapeDepuisParam,
  etapePrecedente,
  etapeSuivante,
  etatsAffiches,
  lienEtape,
  progression,
  type EtapeId,
} from './onboarding-model';
import { useMiseEnRoute } from './use-mise-en-route';

const renderLink = ({
  children,
  ...props
}: {
  href: string;
  className: string;
  'aria-current'?: 'page' | 'step';
  children: React.ReactNode;
}): React.ReactElement => (
  <Link {...props} scroll={false}>
    {children}
  </Link>
);

export function MiseEnRoute(): React.ReactElement {
  const params = useSearchParams();
  const router = useRouter();
  const { faits, pret, relire } = useMiseEnRoute();
  const demandee = etapeDepuisParam(params.get('etape'));
  const courante: EtapeId | null = demandee ?? (pret ? etapeDeReprise(faits) : null);
  const { faites, total } = progression(faits);
  const [occupe, setOccupe] = useState(false);

  async function continuer(id: EtapeId): Promise<void> {
    setOccupe(true);
    // Relit le serveur : l'étape suivante doit voir ce qui vient d'être enregistré.
    await relire();
    setOccupe(false);
    const suivante = etapeSuivante(id);
    router.push(suivante ? lienEtape(suivante) : '/accueil');
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Mise en route"
        description="Quatre étapes pour que vos factures sortent à votre image et en règle. Faites-les dans l’ordre qui vous convient : tout est enregistré au fil de l’eau, vous pouvez vous arrêter et reprendre plus tard, sur n’importe quel appareil."
        descriptionMobile
      />

      <div className="flex flex-col gap-1.5">
        <Progress value={faites} max={total} label="Avancement de la mise en route" />
        <p className="text-xs text-[var(--foreground-muted)]" aria-live="polite">
          {pret
            ? `${faites} étape${faites > 1 ? 's' : ''} faite${faites > 1 ? 's' : ''} sur ${total}`
            : 'Lecture de votre avancement…'}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <Stepper
          label="Étapes de la mise en route"
          renderLink={renderLink}
          className="lg:sticky lg:top-20 lg:self-start"
          steps={
            courante
              ? etatsAffiches(faits, courante).map(({ etape, etat }) => ({
                  id: etape.id,
                  href: lienEtape(etape.id),
                  label: etape.label,
                  state: etat,
                  hint: etat === 'locked' ? `Faite par ${etape.quiPeut}` : undefined,
                }))
              : []
          }
        />

        {courante ? (
          <section aria-labelledby="etape-titre" className="flex min-w-0 flex-col gap-6">
            <EnteteEtape id={courante} />
            {faits[courante] === 'refus' ? (
              <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-sm leading-6">
                <p className="font-semibold">Cette étape ne relève pas de votre rôle</p>
                <p className="mt-1 text-[var(--foreground-muted)]">
                  Elle se fait par {ETAPES.find((e) => e.id === courante)!.quiPeut} de
                  l’organisation. Vous pouvez passer à la suite ; la progression ne vous en tient
                  pas rigueur.
                </p>
              </div>
            ) : courante === 'identite' ? (
              <BrandIdentityPanel />
            ) : courante === 'fiscal' ? (
              <FiscalProfilePanel onEnregistre={() => void relire()} />
            ) : courante === 'points-de-vente' ? (
              <NormalizedInvoicingPanel onChangementEtat={() => void relire()} />
            ) : (
              <ChoixModules />
            )}

            <div className="flex flex-col-reverse gap-3 border-t border-[var(--border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
              {etapePrecedente(courante) ? (
                <Link
                  href={lienEtape(etapePrecedente(courante)!)}
                  scroll={false}
                  className={buttonClasses('ghost', 'md')}
                >
                  Étape précédente
                </Link>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => void continuer(courante)}
                disabled={occupe}
                aria-busy={occupe || undefined}
                className={buttonClasses('primary', 'lg', 'w-full sm:w-auto')}
              >
                {etapeSuivante(courante)
                  ? faits[courante] === true || faits[courante] === 'refus'
                    ? 'Continuer'
                    : 'Passer pour l’instant'
                  : 'Terminer'}
              </button>
            </div>
          </section>
        ) : (
          <div
            aria-busy="true"
            className="h-64 rounded-[var(--radius-lg)] bg-[var(--surface-muted)]"
          />
        )}
      </div>
    </div>
  );
}

function EnteteEtape({ id }: { id: EtapeId }): React.ReactElement {
  const index = ETAPES.findIndex((e) => e.id === id);
  const etape = ETAPES[index]!;
  return (
    <header className="flex flex-col gap-1">
      <p className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
        Étape {index + 1} sur {ETAPES.length}
      </p>
      <h2 id="etape-titre" className="font-display text-xl font-bold tracking-tight">
        {etape.label}
      </h2>
      <p className="max-w-2xl text-sm leading-6 text-[var(--foreground-muted)]">{etape.pourquoi}</p>
    </header>
  );
}

// Classes écrites en entier : Tailwind ne génère pas une classe composée à l'exécution.
const COULEUR_MODULE: Record<ModuleId, string> = {
  build: 'text-[var(--module-build)]',
  run: 'text-[var(--module-run)]',
  grow: 'text-[var(--module-grow)]',
};

const ACCUEIL_MODULE: Record<ModuleId, string> = {
  build: '/build',
  run: '/run',
  grow: '/grow',
};

/**
 * Étape 4 : par quoi commencer. Le choix range la navigation ; il n'ouvre ni ne
 * ferme aucun accès (ADR-0018 : l'accès est réglé par l'offre). Mémorisé dans
 * le navigateur, par organisation — faute d'API (ADR-0030, décision D3).
 */
function ChoixModules(): React.ReactElement {
  const { modules, setModules, modulesChoisis, subscription } = useShell();
  const [choix, setChoix] = useState<ModuleId[]>(() => modules ?? [...MODULE_IDS]);
  const [enregistre, setEnregistre] = useState(false);

  useEffect(() => {
    setChoix(modules ?? [...MODULE_IDS]);
  }, [modules]);

  function basculer(m: ModuleId): void {
    setEnregistre(false);
    setChoix((c) => MODULE_IDS.filter((x) => (x === m ? !c.includes(m) : c.includes(x))));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (choix.length === 0) return;
        setModules(choix);
        setEnregistre(true);
      }}
      className="flex flex-col gap-5"
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Les modules que vous utilisez</legend>
        {MODULE_IDS.map((m) => {
          const coche = choix.includes(m);
          return (
            <label
              key={m}
              className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border p-4 transition-colors ${coche ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]'}`}
            >
              <input
                type="checkbox"
                checked={coche}
                onChange={() => basculer(m)}
                className="mt-1 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">
                  <span className={`font-mono tracking-[0.08em] ${COULEUR_MODULE[m]}`}>
                    {MODULES[m].nom}
                  </span>{' '}
                  · {MODULES[m].verbe}
                </span>
                <span className="text-sm text-[var(--foreground-muted)]">
                  {MODULES[m].description}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {choix.length === 0 ? (
        <p role="alert" className="text-sm font-medium text-[var(--danger)]">
          Gardez au moins un module.
        </p>
      ) : null}
      <p className="text-xs leading-5 text-[var(--foreground-muted)]">
        Ce choix range votre navigation sur cet appareil ; il ne retire aucun accès. Ce que vous
        pouvez faire dépend de votre rôle et de votre offre
        {subscription ? ` (aujourd’hui : ${PLAN_LABELS[subscription.plan]})` : ''}. « Afficher tous
        les modules », en bas de la navigation, défait ce choix à tout moment.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={choix.length === 0}
          className={buttonClasses('secondary', 'md')}
        >
          Enregistrer mon choix
        </button>
        {enregistre || modulesChoisis ? (
          <span role="status" className="flex flex-wrap items-center gap-3 text-sm">
            {enregistre ? <span className="text-[var(--ok)]">Choix enregistré.</span> : null}
            <Link
              href={ACCUEIL_MODULE[choix[0] ?? 'build']}
              className="font-medium text-[var(--accent)] underline underline-offset-2"
            >
              Commencer par {MODULES[choix[0] ?? 'build'].nom}
            </Link>
          </span>
        ) : null}
      </div>
    </form>
  );
}
