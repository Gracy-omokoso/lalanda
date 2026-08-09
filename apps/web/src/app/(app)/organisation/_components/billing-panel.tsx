'use client';

// Facturation de l'organisation (S21a) — `billing.manage`, donc le Propriétaire
// SEUL (ADR-0012 §3 : docs/12 réserve l'abonnement au Propriétaire).
//
// Un Administrateur reçoit un 403 ici, et c'est la règle. La page le dit
// calmement : c'est le cas qui surprend le plus, il mérite une phrase.
//
// Aucune intégration de paiement (docs/13 § Hors périmètre S16b). L'écran
// l'annonce au lieu d'afficher un bouton « changer de plan » qui ne mènerait
// nulle part — la limite est une information, pas une gêne à cacher.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { api, type OrganizationBillingView } from '@/lib/api';

import {
  estRefus,
  formatDate,
  libelleLimite,
  libellePlan,
  messageErreur,
} from './organization-model';

export function BillingPanel(): React.ReactElement {
  const [vue, setVue] = useState<OrganizationBillingView | null>(null);
  const [refuse, setRefuse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async (): Promise<void> => {
    setChargement(true);
    setErreur(null);
    try {
      setVue(await api.getOrganizationBilling());
      setRefuse(false);
    } catch (err) {
      if (estRefus(err)) {
        setRefuse(true);
        setVue(null);
      } else {
        setErreur(messageErreur(err, 'Impossible de charger la facturation.'));
      }
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (chargement) {
    return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
  }

  if (refuse) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
        <p className="text-sm font-medium">Section réservée au Propriétaire</p>
        <p className="mt-1 text-sm text-[var(--foreground-muted)]">
          L’abonnement relève du seul Propriétaire de l’organisation — un Administrateur gère les
          membres et les paramètres, pas la facturation. Consultez les offres publiques sur{' '}
          <Link href="/pricing" className="underline hover:text-[var(--accent)]">
            la page tarifs
          </Link>
          .
        </p>
      </div>
    );
  }

  if (erreur || !vue) {
    return (
      <div
        role="alert"
        className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
      >
        {erreur ?? 'Facturation indisponible.'}
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* ── Plan courant ────────────────────────────────────────────────── */}
      <section aria-labelledby="plan-titre" className="doc-card flex flex-col gap-3 px-5 py-4">
        <h3
          id="plan-titre"
          className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.1em] opacity-70"
        >
          Offre en cours
        </h3>
        <p className="font-display text-2xl font-bold tracking-tight">{libellePlan(vue.plan)}</p>
        <dl className="grid gap-2 sm:grid-cols-2">
          <Rubrique
            terme="Projets"
            valeur={libelleLimite(
              vue.consommation.projets.utilise,
              vue.consommation.projets.limite,
            )}
          />
          <Rubrique
            terme="Membres"
            valeur={libelleLimite(
              vue.consommation.sieges.utilise,
              vue.consommation.sieges.limite,
              'sans limite contractuelle',
            )}
          />
          <Rubrique
            terme="Export PDF"
            valeur={vue.entitlements.pdfWatermark ? 'Avec filigrane' : 'Sans filigrane'}
          />
        </dl>
      </section>

      {/* ── Dépassements ────────────────────────────────────────────────── */}
      {vue.depassements.length > 0 ? (
        <section
          aria-labelledby="depassements-titre"
          className="flex flex-col gap-2 rounded-lg border border-[var(--ko)]/40 bg-[var(--danger-bg)] p-4"
        >
          <h3 id="depassements-titre" className="text-sm font-semibold text-[var(--danger)]">
            Au-dessus des limites de l’offre
          </h3>
          <ul className="flex flex-col gap-1 text-sm text-[var(--danger)]">
            {vue.depassements.map((d) => (
              <li key={d.code}>
                {d.libelle} : <span className="fig">{libelleLimite(d.utilise, d.limite)}</span>
              </li>
            ))}
          </ul>
          {/* docs/13 § Changements de plan : « aucune suppression automatique de
              projet ». Le dire évite la panique. */}
          <p className="text-xs text-[var(--danger)]">
            Rien n’est supprimé. Les créations au-delà de la limite sont refusées tant que l’offre
            n’est pas relevée.
          </p>
        </section>
      ) : null}

      {/* ── Historique ──────────────────────────────────────────────────── */}
      <section aria-labelledby="historique-titre" className="flex flex-col gap-2">
        <h3
          id="historique-titre"
          className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[var(--foreground-muted)]"
        >
          Historique de l’abonnement
        </h3>
        <ul className="flex flex-col gap-1 text-sm">
          {vue.historique.map((h, i) => (
            <li key={`${h.depuis}-${i}`} className="ledger-row">
              <span>
                {h.evenement} <span className="opacity-70">({libellePlan(h.plan)})</span>
              </span>
              <span className="leader" aria-hidden="true" />
              <span className="fig text-xs text-[var(--foreground-muted)]">
                {formatDate(h.depuis === '' ? null : h.depuis)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Limite assumée, annoncée ────────────────────────────────────── */}
      <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--foreground-muted)]">
        {vue.paiement.message}
      </p>
    </div>
  );
}

function Rubrique({ terme, valeur }: { terme: string; valeur: string }): React.ReactElement {
  return (
    <div className="flex flex-col">
      <dt className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.1em] opacity-70">
        {terme}
      </dt>
      <dd className="fig text-sm font-medium">{valeur}</dd>
    </div>
  );
}
