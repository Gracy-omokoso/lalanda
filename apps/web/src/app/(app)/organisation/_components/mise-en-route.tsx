'use client';

// Mise en route d'une société (ADR-0052 § 2, étend ADR-0030 § 8). ADR-0052 — O2.
//
// Neuf étapes reprenables, dans l'ordre que l'on veut ; chaque étape est une URL
// (`?etape=`). L'avancement et ce qui bloque les actes viennent de l'API (`/setup`) ;
// chaque étape EST le panneau existant de son domaine, importé tel quel — aucune logique,
// aucun appel d'API n'est recopié ici. Ce composant ne fait que :
//   - dire où l'on en est et ce qui empêche de facturer, normaliser, tenir les livres ;
//   - présenter une étape à la fois, avec sa raison d'être ;
//   - porter les déclarations de § 4 (pays confirmé, « pas maintenant », modules).

import type {
  OrganizationSetupStep,
  OrganizationSetupView,
} from '@lalanda/shared/organization-setup';
import { isDeferrableStep } from '@lalanda/shared/organization-setup';
import {
  buttonClasses,
  Checkbox,
  Modal,
  MODULES,
  PageHeader,
  Progress,
  Stepper,
  type ModuleId,
} from '@lalanda/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { organizationSetupApi } from '@/lib/api-organization-setup';

import { Activation } from '../../comptabilite/_components/activation';
import { ComptabiliteChrome } from '../../comptabilite/_components/comptabilite-access';
import { PLAN_LABELS } from '../../souscription/_components/subscription-model';
import { TreasuryChrome } from '../../tresorerie/_components/treasury-access';
import ComptesTresorerie from '../../tresorerie/comptes/page';
import { useShell } from '../../_components/shell-context';
import { MODULE_IDS } from '../../_components/nav-model';
import MembresPage from '../membres/page';

import { BillingPanel } from './billing-panel';
import { BrandIdentityPanel } from './brand-identity-panel';
import { FiscalProfilePanel } from './fiscal-profile-panel';
import { NormalizedInvoicingPanel } from './normalized-invoicing-panel';
import {
  ETAPES,
  etapeDe,
  etapeDeReprise,
  etapeDepuisParam,
  etapePrecedente,
  etapeSuivante,
  etapeVue,
  etatsAffiches,
  lienEtape,
  pastilles,
  peutReporter,
  peutReprendre,
  progression,
  type EtapeId,
} from './onboarding-model';
import { messageErreur } from './organization-model';
import { SettingsPanel } from './settings-panel';
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
  const { vue, pret, echec, relire, remplacer } = useMiseEnRoute();
  const demandee = etapeDepuisParam(params.get('etape'));
  const courante: EtapeId | null = demandee ?? (vue ? etapeDeReprise(vue) : null);
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
        description="Neuf étapes pour configurer votre société. Faites-les dans l’ordre qui vous convient : tout est enregistré au fil de l’eau, vous pouvez vous arrêter et reprendre plus tard, sur n’importe quel appareil."
        descriptionMobile
      />

      {vue ? <Capacites vue={vue} /> : null}

      {vue ? <Avancement vue={vue} /> : null}
      {pret && echec && !vue ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          Votre avancement n’a pas pu être lu. Rechargez la page dans un instant.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
        <Stepper
          label="Étapes de la mise en route"
          renderLink={renderLink}
          className="lg:sticky lg:top-20 lg:self-start"
          steps={
            vue && courante
              ? etatsAffiches(vue, courante).map(({ etape, etat, hint }) => ({
                  id: etape.id,
                  href: lienEtape(etape.id),
                  label: etape.label,
                  state: etat,
                  hint,
                }))
              : []
          }
        />

        {vue && courante ? (
          <section aria-labelledby="etape-titre" className="flex min-w-0 flex-col gap-6">
            <EnteteEtape id={courante} step={etapeVue(vue, courante)} />
            <Declarations step={etapeVue(vue, courante)} onVue={remplacer} />
            {!etapeVue(vue, courante).canAct ? (
              <HorsRole id={courante} faite={etapeVue(vue, courante).state === 'done'} />
            ) : (
              <ContenuEtape id={courante} relire={relire} />
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
                  ? etapeVue(vue, courante).state === 'todo' && etapeVue(vue, courante).canAct
                    ? 'Passer pour l’instant'
                    : 'Continuer'
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

/** Facturer · Normaliser · Comptabilité : prêtes ou non, et ce qui manque (§ 3). */
function Capacites({ vue }: { vue: OrganizationSetupView }): React.ReactElement {
  return (
    <ul className="grid gap-3 md:grid-cols-3" aria-label="Ce que votre société peut faire">
      {pastilles(vue).map((p) => (
        <li key={p.id}>
          <Link
            href={lienEtape(p.etape)}
            scroll={false}
            className={`flex h-full flex-col gap-1.5 rounded-[var(--radius-lg)] border p-4 transition hover:shadow-[var(--shadow-pop)] ${
              p.pret
                ? 'border-[var(--border)] bg-[var(--surface)]'
                : p.id === 'invoice'
                  ? 'border-[var(--danger)] bg-[var(--surface)]'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 rounded-full ${p.pret ? 'bg-[var(--ok)]' : p.id === 'invoice' ? 'bg-[var(--danger)]' : 'bg-[var(--border-strong)]'}`}
              />
              {p.label}
              <span className="sr-only">{p.pret ? ' : prêt' : ' : pas encore'}</span>
            </span>
            <span className="text-sm text-[var(--foreground-muted)]">{p.phrase}</span>
            {!p.pret && p.manques.length > 0 && p.id === 'invoice' ? (
              <span className="text-sm font-medium">{p.manques.join(' ')}</span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Avancement({ vue }: { vue: OrganizationSetupView }): React.ReactElement {
  const { faites, reglees, total } = progression(vue);
  const reportees = reglees - faites;
  return (
    <div className="flex flex-col gap-1.5">
      <Progress value={reglees} max={total} label="Avancement de la mise en route" />
      <p className="text-xs text-[var(--foreground-muted)]" aria-live="polite">
        {`${faites} étape${faites > 1 ? 's' : ''} faite${faites > 1 ? 's' : ''} sur ${total}`}
        {reportees > 0 ? ` · ${reportees} pour plus tard` : ''}
      </p>
    </div>
  );
}

function EnteteEtape({
  id,
  step,
}: {
  id: EtapeId;
  step: OrganizationSetupStep;
}): React.ReactElement {
  const index = ETAPES.findIndex((e) => e.id === id);
  const etape = ETAPES[index]!;
  const niveau =
    step.level === 'blocking'
      ? 'Nécessaire pour facturer'
      : step.level === 'recommended'
        ? 'Recommandé'
        : 'Facultatif';
  return (
    <header className="flex flex-col gap-1">
      <p className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
        Étape {index + 1} sur {ETAPES.length} · {niveau}
        {step.state === 'done' ? ' · faite' : step.state === 'deferred' ? ' · pour plus tard' : ''}
      </p>
      <h2 id="etape-titre" className="font-display text-xl font-bold tracking-tight">
        {etape.label}
      </h2>
      <p className="max-w-2xl text-sm leading-6 text-[var(--foreground-muted)]">{etape.pourquoi}</p>
    </header>
  );
}

function HorsRole({ id, faite }: { id: EtapeId; faite: boolean }): React.ReactElement {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-sm leading-6">
      <p className="font-semibold">
        {faite ? 'Cette étape est faite' : 'Cette étape ne relève pas de votre rôle'}
      </p>
      <p className="mt-1 text-[var(--foreground-muted)]">
        Elle se fait par {etapeDe(id).quiPeut} de l’organisation. Vous pouvez passer à la suite ; la
        progression ne vous en tient pas rigueur.
      </p>
    </div>
  );
}

/**
 * Déclarations de § 4 attachées à l'étape : « pays confirmé » (étape 1), « pas maintenant »
 * (quatre étapes facultatives), reprise d'une étape reportée. Le report passe par une
 * fenêtre qui dit ce qu'il signifie : rien n'est désactivé, l'étape se reprend à tout moment.
 */
function Declarations({
  step,
  onVue,
}: {
  step: OrganizationSetupStep;
  onVue: (v: OrganizationSetupView) => void;
}): React.ReactElement | null {
  const [ouverte, setOuverte] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const etape = etapeDe(step.id);

  async function envoyer(appel: () => Promise<OrganizationSetupView>): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      onVue(await appel());
      setOuverte(false);
    } catch (err) {
      setErreur(messageErreur(err, 'L’enregistrement a échoué. Réessayez dans un instant.'));
    } finally {
      setEnvoi(false);
    }
  }

  const id = step.id;
  if (id === 'societe' && step.canAct) {
    return (
      <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          {step.state === 'done'
            ? 'Pays confirmé. Vous pouvez encore le modifier ci-dessous.'
            : 'Vérifiez le nom et le pays ci-dessous, enregistrez-les si besoin, puis confirmez le pays.'}
        </p>
        {step.state !== 'done' ? (
          <button
            type="button"
            disabled={envoi}
            aria-busy={envoi || undefined}
            onClick={() => void envoyer(organizationSetupApi.confirmCountry)}
            className={buttonClasses('secondary', 'md', 'w-full sm:w-auto')}
          >
            Confirmer le pays
          </button>
        ) : null}
        {erreur ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {erreur}
          </p>
        ) : null}
      </div>
    );
  }

  if (!isDeferrableStep(id)) return null;
  if (peutReprendre(step)) {
    return (
      <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          Vous avez choisi « {etape.report} ». Rien n’est bloqué ; vous pouvez la faire quand vous
          voulez.
        </p>
        <button
          type="button"
          disabled={envoi}
          onClick={() => void envoyer(() => organizationSetupApi.undefer(id))}
          className={buttonClasses('ghost', 'md', 'w-full sm:w-auto')}
        >
          La remettre à faire
        </button>
        {erreur ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {erreur}
          </p>
        ) : null}
      </div>
    );
  }
  if (!peutReporter(step)) return null;
  return (
    <>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOuverte(true)}
          className={buttonClasses('ghost', 'md', 'w-full sm:w-auto')}
        >
          {etape.report}
        </button>
      </div>
      <Modal
        open={ouverte}
        onClose={() => setOuverte(false)}
        busy={envoi}
        title={`${etape.label} : ${etape.report?.toLowerCase()}`}
        description="L’étape est mise de côté pour toute la société. Rien n’est désactivé, et vous pourrez la reprendre à tout moment depuis la mise en route."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setOuverte(false)}
              className={buttonClasses('ghost', 'md')}
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={envoi}
              aria-busy={envoi || undefined}
              onClick={() => void envoyer(() => organizationSetupApi.defer(id))}
              className={buttonClasses('primary', 'md')}
            >
              Confirmer
            </button>
          </div>
        }
      >
        {erreur ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {erreur}
          </p>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]">
            La mise en route la comptera comme réglée ; elle ne sera jamais présentée comme une
            faute.
          </p>
        )}
      </Modal>
    </>
  );
}

/** Le panneau existant de chaque étape, importé tel quel. */
function ContenuEtape({
  id,
  relire,
}: {
  id: EtapeId;
  relire: () => Promise<void>;
}): React.ReactElement {
  switch (id) {
    case 'societe':
    case 'devises':
      return <SettingsPanel />;
    case 'fiscal':
      return <FiscalProfilePanel onEnregistre={() => void relire()} />;
    case 'identite':
      return <BrandIdentityPanel />;
    case 'normalisation':
      return <NormalizedInvoicingPanel onChangementEtat={() => void relire()} />;
    case 'tresorerie':
      return (
        <TreasuryChrome>
          <ComptesTresorerie />
        </TreasuryChrome>
      );
    case 'comptabilite':
      return (
        <ComptabiliteChrome>
          <Activation />
        </ComptabiliteChrome>
      );
    case 'equipe':
      return <MembresPage />;
    case 'modules':
      return <ModulesReglagesOffre />;
  }
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

/** Réglages existants des modules (ADR-0044 à ADR-0050), montrés à qui peut les changer. */
const REGLAGES_MODULES = [
  {
    action: 'sales.manage',
    href: '/ventes',
    titre: 'Ventes',
    texte: 'Catalogue, clients, devis et factures.',
  },
  {
    action: 'purchase.manage',
    href: '/achats',
    titre: 'Achats',
    texte: 'Fournisseurs, commandes et approbations.',
  },
  {
    action: 'hr.manage',
    href: '/rh/reglages',
    titre: 'Ressources humaines',
    texte: 'Réglages des salariés, congés et documents.',
  },
  {
    action: 'stock.manage',
    href: '/stocks/reglages',
    titre: 'Stocks',
    texte: 'Réglages des articles, emplacements et seuils.',
  },
] as const;

function ModulesReglagesOffre(): React.ReactElement {
  const { actions } = useShell();
  const reglages = REGLAGES_MODULES.filter((r) => actions?.includes(r.action));
  return (
    <div className="flex flex-col gap-8">
      <ChoixModules />
      {reglages.length > 0 ? (
        <section aria-labelledby="reglages-modules" className="flex flex-col gap-3">
          <h3 id="reglages-modules" className="text-sm font-semibold">
            Réglages des modules
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {reglages.map((r) => (
              <li key={r.href}>
                <Link
                  href={r.href}
                  className="flex h-full flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-pop)]"
                >
                  <span className="text-sm font-semibold">{r.titre}</span>
                  <span className="text-sm text-[var(--foreground-muted)]">{r.texte}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="offre-titre" className="flex flex-col gap-3">
        <h3 id="offre-titre" className="text-sm font-semibold">
          Votre offre
        </h3>
        {actions?.includes('billing.manage') ? (
          <BillingPanel />
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]">
            L’offre ouvre ou ferme l’accès aux modules ; elle est gérée par le Propriétaire. Elle ne
            bloque jamais la mise en route.
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Par quoi la société commence. Le choix range l'accueil de chaque membre (ADR-0038 § 5) ;
 * il n'ouvre ni ne ferme aucun accès (ADR-0018 : l'accès est réglé par l'offre). Enregistré
 * côté serveur pour toute l'organisation (ADR-0052 — O3, décision ouverte n° 3) ; un membre
 * sans `organization.manage` le lit sans pouvoir le changer.
 */
function ChoixModules(): React.ReactElement {
  const { modules, setModules, modulesChoisis, peutChoisirModules, subscription } = useShell();
  const [choix, setChoix] = useState<ModuleId[]>(() => modules ?? [...MODULE_IDS]);
  const [enregistre, setEnregistre] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    setChoix(modules ?? [...MODULE_IDS]);
  }, [modules]);

  function basculer(m: ModuleId): void {
    setEnregistre(false);
    setChoix((c) => MODULE_IDS.filter((x) => (x === m ? !c.includes(m) : c.includes(x))));
  }

  async function enregistrer(): Promise<void> {
    if (choix.length === 0) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await setModules(choix);
      setEnregistre(true);
    } catch (err) {
      setErreur(messageErreur(err, 'L’enregistrement a échoué. Réessayez dans un instant.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void enregistrer();
      }}
      className="flex flex-col gap-5"
    >
      <fieldset className="flex flex-col gap-3" disabled={!peutChoisirModules || envoi}>
        <legend className="mb-2 text-sm font-medium">Les modules de la société</legend>
        {MODULE_IDS.map((m) => {
          const coche = choix.includes(m);
          return (
            <label
              key={m}
              className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border p-4 transition-colors ${coche ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]'}`}
            >
              <Checkbox checked={coche} onChange={() => basculer(m)} className="mt-0.5" />
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
        Ce choix place ces modules en tête de l’accueil de chaque membre, sur tous ses appareils ;
        il ne masque ni ne retire aucun module. Ce que chacun peut faire dépend de son rôle et de
        l’offre
        {subscription ? ` (aujourd’hui : ${PLAN_LABELS[subscription.plan]})` : ''}.
        {peutChoisirModules
          ? ''
          : ' Le choix est enregistré par un Propriétaire ou un Administrateur.'}
      </p>
      {erreur ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {peutChoisirModules ? (
          <button
            type="submit"
            disabled={choix.length === 0 || envoi}
            aria-busy={envoi || undefined}
            className={buttonClasses('secondary', 'md')}
          >
            Enregistrer pour la société
          </button>
        ) : null}
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
