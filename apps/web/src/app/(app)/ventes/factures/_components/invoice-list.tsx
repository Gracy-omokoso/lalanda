'use client';

// Liste des documents de vente (ADR-0023 § S25e.14) : filtres par statut et
// par type, recherche (numéro, référence de pro forma, client), pagination par
// curseur. Un document non final s'affiche par sa référence `PF-…`, jamais
// comme une facture (§ S25e.1).

import Link from 'next/link';
import { useCallback, useState } from 'react';

import { api, type InvoiceSummary, type InvoiceType } from '@/lib/api';

import { Alerte, BOUTON, CHAMP, Pastille } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';
import { formatDate } from '../../_components/sales-model';
import { useSalesList } from '../../_components/use-sales-list';

import {
  enteteDocument,
  FACTURES_BASE,
  FILTRES_INITIAUX,
  FILTRES_STATUT,
  filtreActif,
  type FiltresFactures,
  montantsResume,
  requeteFactures,
  STATUS_LABELS,
  tonStatut,
  TYPE_LABELS,
} from './invoice-model';

export function InvoiceList(): React.ReactElement {
  const { gerer } = useAccesVentes();
  const [filtres, setFiltres] = useState<FiltresFactures>(FILTRES_INITIAUX);

  const charger = useCallback(
    (cursor: string | null) => api.listInvoices(requeteFactures(filtres, cursor)),
    [filtres],
  );
  const liste = useSalesList<InvoiceSummary>(charger, JSON.stringify(filtres));

  return (
    <section aria-labelledby="factures-titre" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="factures-titre" className="font-display text-lg font-bold tracking-tight">
            Documents de vente
          </h2>
          <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
            Un document reste un pro forma tant qu’il n’est pas émis ou normalisé. Une facture émise
            ne se modifie plus : elle se corrige par un avoir.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href={`${FACTURES_BASE}/journal`} className={`${BOUTON} text-center`}>
            Journal
          </Link>
          {gerer ? (
            <Link href={`${FACTURES_BASE}/nouvelle`} className={`${BOUTON} text-center`}>
              Nouveau document
            </Link>
          ) : null}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Afficher</legend>
        <div className="flex flex-wrap gap-2">
          {FILTRES_STATUT.map((f) => {
            const actif = filtres.statut === f.valeur;
            return (
              <button
                key={f.valeur}
                type="button"
                aria-pressed={actif}
                onClick={() => setFiltres((x) => ({ ...x, statut: f.valeur }))}
                className={
                  actif
                    ? 'rounded-full border border-[var(--accent)] px-3 py-1 text-xs font-semibold'
                    : 'rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--foreground-muted)] hover:border-[var(--accent)]'
                }
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <form
        role="search"
        aria-label="Rechercher un document de vente"
        onSubmit={(e) => e.preventDefault()}
        className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fa-q" className="text-sm font-medium">
            Rechercher
          </label>
          <input
            id="fa-q"
            type="search"
            value={filtres.q}
            onChange={(e) => setFiltres((f) => ({ ...f, q: e.target.value }))}
            maxLength={100}
            placeholder="Numéro, référence PF-… ou client"
            className={CHAMP}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fa-type" className="text-sm font-medium">
            Type
          </label>
          <select
            id="fa-type"
            value={filtres.type}
            onChange={(e) =>
              setFiltres((f) => ({ ...f, type: e.target.value as InvoiceType | '' }))
            }
            className={CHAMP}
          >
            <option value="">Tous les types</option>
            {(Object.keys(TYPE_LABELS) as InvoiceType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </form>

      {liste.etat === 'chargement' ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement des documents…
        </p>
      ) : liste.etat === 'refus' ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
          <p className="text-sm font-medium">Documents de vente non accessibles</p>
          <p className="mt-1 text-sm text-[var(--foreground-muted)]">{liste.erreur}</p>
        </div>
      ) : liste.etat === 'erreur' ? (
        <Alerte
          action={
            <button
              type="button"
              onClick={liste.recharger}
              className={`${BOUTON} text-[var(--foreground)]`}
            >
              Réessayer
            </button>
          }
        >
          <p>{liste.erreur}</p>
        </Alerte>
      ) : liste.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
          {filtreActif(filtres) ? (
            <p className="text-sm text-[var(--foreground-muted)]">
              Aucun document ne correspond à ces critères.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">Aucun document de vente pour l’instant</p>
              <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                {gerer
                  ? 'Composez votre premier document : il naît en brouillon (pro forma).'
                  : 'Les documents de l’organisation apparaîtront ici.'}
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {liste.items.map((d) => {
              const entete = enteteDocument(d);
              const montants = montantsResume(d);
              return (
                <li key={d.id}>
                  <Link
                    href={`${FACTURES_BASE}/${encodeURIComponent(d.id)}`}
                    className="flex flex-col gap-2 p-4 transition hover:bg-[var(--surface,transparent)] sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{entete.reference}</span>
                        <Pastille ton={tonStatut(d.status)}>{STATUS_LABELS[d.status]}</Pastille>
                        <span className="text-xs text-[var(--foreground-muted)]">
                          {TYPE_LABELS[d.type]}
                        </span>
                      </span>
                      <span className="break-words text-sm">
                        {d.customer.name ?? 'Vente de comptoir'}
                      </span>
                      <span className="text-xs text-[var(--foreground-muted)]">
                        {d.issuedAt ? `Émise le ${formatDate(d.issuedAt)}` : entete.titre}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5 text-sm sm:items-end">
                      <span className="font-mono">{montants.document}</span>
                      {montants.normalise ? (
                        <span className="font-mono text-xs text-[var(--foreground-muted)]">
                          {montants.normalise} (fait foi)
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          {liste.erreurSuite ? (
            <Alerte>
              <p>{liste.erreurSuite}</p>
            </Alerte>
          ) : null}
          {liste.suivante ? (
            <button
              type="button"
              onClick={liste.chargerSuite}
              disabled={liste.chargementSuite}
              className={`${BOUTON} self-center`}
            >
              {liste.chargementSuite ? 'Chargement…' : 'Afficher plus de documents'}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
