'use client';

// ─────────────────────────────────────────────────────────────────────────────
// TUNNEL DE SOUSCRIPTION (S22b) — docs/13
//
// Trois décisions de conception, toutes prises pour éviter un cul-de-sac :
//
// 1. LE CHIFFRAGE PRÉCÈDE LE PAIEMENT. Le montant est demandé à l'API
//    (`GET .../quote`) dès que l'offre et la périodicité sont choisies, et
//    AFFICHÉ avant tout bouton de paiement. Un tunnel qui annonce « 9 USD » et
//    prélève un prorata de 6,40 USD produit des litiges même quand le calcul est
//    juste.
//
// 2. LES MOYENS DE PAIEMENT VIENNENT DU SERVEUR. Proposer « carte bancaire »
//    alors qu'aucune clé n'est configurée envoie le client sur un 503 après
//    qu'il a pris sa décision — le pire moment.
//
// 3. LA PÉRIODICITÉ ANNUELLE N'EST OFFERTE QUE LÀ OÙ ELLE EXISTE. La bascule est
//    masquée quand le couple (offre, périodicité) n'est pas vendable, plutôt que
//    de mener à un refus de l'API en bout de tunnel.
//
// 4. L'OFFRE EXPERT N'ENTRE PAS DANS CE TUNNEL. Elle n'a aucun prix publié et
//    inclut du temps d'expert humain : il n'existe donc rien à chiffrer ni à
//    encaisser. La liste des offres proposées vient de `SELF_SERVE_PLANS`
//    (catalogue partagé), qui l'exclut par construction — et non d'une liste
//    écrite ici, qu'il aurait fallu penser à ne pas compléter.
//
// ── Ce que ce composant ne fait jamais ───────────────────────────────────────
//
// Calculer un montant, décider d'une éligibilité, deviser un prorata. Tout vient
// de l'API. La seule règle locale est d'affichage (masquer une bascule qui ne
// mène nulle part), et elle est testée dans `pricing-model.test.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import { SELF_SERVE_PLANS } from '@lalanda/shared/pricing';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  api,
  type BillingInterval,
  type CheckoutResultView,
  type PaymentMethod,
  type Plan,
  type PlanQuoteView,
  type SubscriptionStateView,
} from '@/lib/api';

import {
  hasAnnualOffer,
  TIERS,
  TRIAL_DAYS,
} from '../../../(marketing)/pricing/_components/pricing-model';
import {
  cheminDepuisChiffrage,
  estRefusAutorisation,
  etatAffiche,
  formatCents,
  formatDate,
  INTERVAL_LABELS,
  isManualMethod,
  messageRefus,
  METHOD_LABELS,
  peutDemarrerEssai,
  PLAN_LABELS,
  type Ton,
} from './subscription-model';

/**
 * Offres réellement souscriptibles EN LIGNE.
 *
 * Vient du catalogue : `free` n'est pas un achat, et `expert` ne se vend pas
 * sans accord commercial. Une liste écrite ici aurait affiché Expert dès que
 * quelqu'un aurait ajouté un palier « payant » sans se demander s'il se vend.
 */
const OFFRES_PAYANTES: readonly Plan[] = SELF_SERVE_PLANS;

export function SubscriptionFunnel(): React.ReactElement {
  const [state, setState] = useState<SubscriptionStateView | null>(null);
  const [methodes, setMethodes] = useState<PaymentMethod[] | null>(null);
  const [refuse, setRefuse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const [plan, setPlan] = useState<Plan>('pro');
  const [interval, setIntervalChoisi] = useState<BillingInterval>('month');
  const [quote, setQuote] = useState<PlanQuoteView | null>(null);
  const [quoteErreur, setQuoteErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [instructions, setInstructions] = useState<CheckoutResultView | null>(null);

  const charger = useCallback(async (): Promise<void> => {
    setChargement(true);
    setErreur(null);
    try {
      const vue = await api.getSubscription();
      setState(vue);
      setRefuse(false);
    } catch (err) {
      if (estRefusAutorisation(err)) {
        setRefuse(true);
        setState(null);
      } else {
        setErreur(messageRefus(err, "Impossible de charger l'état de votre abonnement."));
      }
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  // Les moyens de paiement sont chargés une fois, indépendamment de l'état :
  // leur échec ne doit pas empêcher de lire son abonnement.
  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        const { methods } = await api.getPaymentMethods();
        if (!annule) setMethodes(methods.filter((m) => m.available).map((m) => m.method));
      } catch {
        if (!annule) setMethodes([]);
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  // Une périodicité annuelle retenue puis un passage sur Business laisserait un
  // choix invalide en mémoire, et le chiffrage échouerait sans que le client
  // comprenne pourquoi.
  useEffect(() => {
    if (interval === 'year' && !hasAnnualOffer(plan === 'free' ? 'free' : plan)) {
      setIntervalChoisi('month');
    }
  }, [plan, interval]);

  // Chiffrage : relancé à chaque changement d'offre ou de périodicité.
  useEffect(() => {
    if (!state) return;
    let annule = false;
    setQuote(null);
    setQuoteErreur(null);
    void (async () => {
      try {
        const resultat = await api.getPlanQuote(plan, interval);
        if (!annule) setQuote(resultat);
      } catch (err) {
        if (!annule) {
          setQuoteErreur(messageRefus(err, 'Chiffrage indisponible pour cette combinaison.'));
        }
      }
    })();
    return () => {
      annule = true;
    };
  }, [plan, interval, state]);

  async function demarrerEssai(): Promise<void> {
    setEnCours(true);
    setErreur(null);
    try {
      setState(await api.startTrial());
    } catch (err) {
      setErreur(messageRefus(err, "L'essai n'a pas pu être démarré."));
    } finally {
      setEnCours(false);
    }
  }

  async function payer(method: PaymentMethod): Promise<void> {
    setEnCours(true);
    setErreur(null);
    setInstructions(null);
    try {
      const resultat = await api.startCheckout({ plan, interval, method });
      if (resultat.redirectUrl) {
        // Redirection vers le fournisseur. `window.location` et non `router` :
        // c'est une sortie de l'application, pas une navigation interne.
        window.location.assign(resultat.redirectUrl);
        return;
      }
      // Fournisseur manuel : les instructions de dépôt s'affichent ici, avec la
      // référence à recopier. Rien n'est actif tant qu'un administrateur n'a
      // pas constaté le versement.
      setInstructions(resultat);
      await charger();
    } catch (err) {
      setErreur(messageRefus(err, "Le paiement n'a pas pu être ouvert."));
    } finally {
      setEnCours(false);
    }
  }

  async function programmer(): Promise<void> {
    setEnCours(true);
    setErreur(null);
    try {
      setState(await api.changePlan(plan, interval));
    } catch (err) {
      setErreur(messageRefus(err, "Le changement n'a pas pu être programmé."));
    } finally {
      setEnCours(false);
    }
  }

  if (chargement) {
    return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
  }

  if (refuse) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
        <p className="text-sm font-medium">Section réservée au Propriétaire</p>
        <p className="mt-1 text-sm text-[var(--foreground-muted)]">
          L’abonnement relève du Propriétaire de l’organisation. Consultez les offres publiques sur{' '}
          <Link href="/pricing" className="underline hover:text-[var(--accent)]">
            la page tarifs
          </Link>
          .
        </p>
      </div>
    );
  }

  if (!state) {
    return <Alerte ton="critique">{erreur ?? 'État de l’abonnement indisponible.'}</Alerte>;
  }

  const vue = etatAffiche(state);
  const chemin = quote ? cheminDepuisChiffrage(quote) : null;
  const annuelPossible = hasAnnualOffer(plan === 'free' ? 'free' : plan);

  return (
    <div className="flex flex-col gap-8">
      {/* ── État courant ─────────────────────────────────────────────────── */}
      <Encart ton={vue.ton}>
        <p className="font-semibold">{vue.titre}</p>
        <p className="mt-1 text-sm">{vue.detail}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <Donnee libelle="Offre appliquée" valeur={PLAN_LABELS[state.plan]} />
          <Donnee libelle="Prochaine échéance" valeur={formatDate(state.currentPeriodEnd)} />
          <Donnee
            libelle="Projets"
            valeur={
              state.entitlements.maxProjects === null
                ? `${state.usage.projects} (illimités)`
                : `${state.usage.projects} / ${state.entitlements.maxProjects}`
            }
          />
        </dl>
      </Encart>

      {erreur ? <Alerte ton="critique">{erreur}</Alerte> : null}

      {/* ── Essai ────────────────────────────────────────────────────────── */}
      {peutDemarrerEssai(state) ? (
        <section className="rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-6">
          <h2 className="font-display text-lg font-bold tracking-tight">
            Essayer {TRIAL_DAYS} jours, sans carte bancaire
          </h2>
          <p className="mt-2 text-sm text-[var(--foreground-muted)]">
            Vous obtenez l’offre Pro pendant {TRIAL_DAYS} jours. Aucun moyen de paiement n’est
            demandé et aucun prélèvement n’a lieu au terme : le compte revient à l’offre gratuite,
            sans qu’aucun projet ne soit supprimé.
          </p>
          <button
            type="button"
            onClick={() => void demarrerEssai()}
            disabled={enCours}
            className="mt-4 inline-flex items-center justify-center rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
          >
            {enCours ? 'Activation…' : `Démarrer l’essai de ${TRIAL_DAYS} jours`}
          </button>
        </section>
      ) : null}

      {/* ── Choix de l'offre ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold tracking-tight">Choisir une offre</h2>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Offre</legend>
          {OFFRES_PAYANTES.map((slug) => {
            const tier = TIERS.find((t) => t.slug === slug)!;
            const actif = plan === slug;
            return (
              <label
                key={slug}
                className={`flex cursor-pointer flex-col rounded-lg border p-5 transition ${
                  actif
                    ? 'border-[var(--accent)] bg-[var(--surface)]'
                    : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-muted)]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="offre"
                    value={slug}
                    checked={actif}
                    onChange={() => setPlan(slug)}
                    className="accent-[var(--accent)]"
                  />
                  <span className="font-display font-bold">{tier.name}</span>
                  <span className="fig ml-auto text-sm text-[var(--foreground-muted)]">
                    {tier.priceMonthUsd} USD / mois
                  </span>
                </span>
                <span className="mt-2 text-sm text-[var(--foreground-muted)]">{tier.tagline}</span>
              </label>
            );
          })}
        </fieldset>

        {annuelPossible ? (
          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="sr-only">Périodicité</legend>
            {(['month', 'year'] as BillingInterval[]).map((valeur) => (
              <label
                key={valeur}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                  interval === valeur
                    ? 'border-[var(--accent)]'
                    : 'border-[var(--border)] hover:bg-[var(--surface-muted)]'
                }`}
              >
                <input
                  type="radio"
                  name="periodicite"
                  value={valeur}
                  checked={interval === valeur}
                  onChange={() => setIntervalChoisi(valeur)}
                  className="accent-[var(--accent)]"
                />
                {INTERVAL_LABELS[valeur]}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]">
            L’offre {PLAN_LABELS[plan]} est proposée en facturation mensuelle uniquement.
          </p>
        )}
      </section>

      {/* ── Chiffrage ────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-6">
        <h2 className="font-display text-lg font-bold tracking-tight">Montant</h2>
        {quoteErreur ? (
          <p className="mt-2 text-sm text-[var(--danger)]">{quoteErreur}</p>
        ) : !quote ? (
          <p className="mt-2 text-sm text-[var(--foreground-muted)]">Calcul en cours…</p>
        ) : (
          <>
            <p className="fig mt-2 text-3xl font-semibold tracking-tight">
              {formatCents(quote.amountDueCents, quote.currency)}
            </p>
            <p className="mt-1 text-sm text-[var(--foreground-muted)]">
              {chemin?.raison}{' '}
              {/* La fiscalité de la vente numérique n'est pas arbitrée
                  (docs/13) : l'omettre laisserait croire à un prix TTC. */}
              Montant hors taxes.
            </p>
            {quote.creditCents > 0 ? (
              <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                Crédit appliqué : {formatCents(quote.creditCents, quote.currency)}
                {quote.carriedCreditCents > 0
                  ? ` — dont ${formatCents(quote.carriedCreditCents, quote.currency)} reportés sur vos prochaines échéances (aucun remboursement).`
                  : '.'}
              </p>
            ) : null}
            {quote.effect === 'period_end' && quote.effectiveAt ? (
              <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                Effet au {formatDate(quote.effectiveAt)}.
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* ── Paiement ─────────────────────────────────────────────────────── */}
      {chemin?.type === 'programme' ? (
        <section>
          <button
            type="button"
            onClick={() => void programmer()}
            disabled={enCours}
            className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
          >
            {enCours ? 'Enregistrement…' : `Programmer le passage à ${PLAN_LABELS[plan]}`}
          </button>
        </section>
      ) : chemin?.type === 'paiement' ? (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-lg font-bold tracking-tight">Moyen de paiement</h2>
          {methodes === null ? (
            <p className="text-sm text-[var(--foreground-muted)]">Chargement des moyens…</p>
          ) : methodes.length === 0 ? (
            <Alerte ton="attention">
              Aucun moyen de paiement n’est disponible pour le moment. Contactez le support pour
              régler votre abonnement.
            </Alerte>
          ) : (
            <div className="flex flex-wrap gap-3">
              {methodes.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => void payer(method)}
                  disabled={enCours}
                  className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
                >
                  {METHOD_LABELS[method]}
                  {isManualMethod(method) ? (
                    <span className="ml-2 text-xs text-[var(--foreground-muted)]">
                      (confirmation sous 24 h)
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          {methodes?.some(isManualMethod) ? (
            <p className="text-sm text-[var(--foreground-muted)]">
              Mobile money et virement sont vérifiés par un administrateur avant activation, et ne
              se renouvellent pas automatiquement : un nouveau versement sera nécessaire à chaque
              échéance.
            </p>
          ) : null}
        </section>
      ) : chemin?.type === 'aucun' ? (
        <p className="text-sm text-[var(--foreground-muted)]">{chemin.raison}</p>
      ) : null}

      {/* ── Instructions de dépôt (fournisseur manuel) ───────────────────── */}
      {instructions?.instructions ? (
        <section className="rounded-lg border-2 border-[var(--accent)] bg-[var(--surface)] p-6">
          <h2 className="font-display text-lg font-bold tracking-tight">
            {instructions.instructions.title}
          </h2>
          <p className="font-mono mt-3 rounded border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm">
            Référence : <strong>{instructions.reference}</strong>
          </p>
          <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5 text-sm">
            {instructions.instructions.steps.map((etape) => (
              <li key={etape}>{etape}</li>
            ))}
          </ol>
          {instructions.instructions.accounts.length > 0 ? (
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              {instructions.instructions.accounts.map((compte) => (
                <Donnee key={compte.label} libelle={compte.label} valeur={compte.value} />
              ))}
            </dl>
          ) : null}
          <p className="mt-4 text-sm text-[var(--foreground-muted)]">
            Montant à verser : {formatCents(instructions.amountDueCents)}. Votre abonnement est
            activé après vérification du versement.
          </p>
        </section>
      ) : null}

      <p className="text-sm text-[var(--foreground-muted)]">
        Le détail de votre facturation et l’historique des changements sont dans{' '}
        <Link href="/organisation/facturation" className="underline hover:text-[var(--accent)]">
          l’espace organisation
        </Link>
        .
      </p>
    </div>
  );
}

function Donnee({ libelle, valeur }: { libelle: string; valeur: string }): React.ReactElement {
  return (
    <div>
      <dt className="text-xs tracking-wide text-[var(--foreground-muted)] uppercase">{libelle}</dt>
      <dd className="fig mt-0.5 font-medium">{valeur}</dd>
    </div>
  );
}

const TON_CLASSES: Readonly<Record<Ton, string>> = {
  info: 'border-[var(--border)] bg-[var(--surface)]',
  succes: 'border-[var(--accent)] bg-[var(--surface)]',
  attention: 'border-[var(--warning,var(--border))] bg-[var(--surface-muted)]',
  critique: 'border-[var(--danger)]/40 bg-[var(--danger-bg)] text-[var(--danger)]',
};

function Encart({ ton, children }: { ton: Ton; children: React.ReactNode }): React.ReactElement {
  return <section className={`rounded-lg border p-6 ${TON_CLASSES[ton]}`}>{children}</section>;
}

function Alerte({ ton, children }: { ton: Ton; children: React.ReactNode }): React.ReactElement {
  return (
    <p role="alert" className={`rounded-md border p-3 text-sm ${TON_CLASSES[ton]}`}>
      {children}
    </p>
  );
}
