'use client';

// Liste des documents de vente (ADR-0023 § S25e.14) : filtres par statut et
// par type, recherche (numéro, référence de pro forma, client), pagination par
// curseur. Un document non final s'affiche par sa référence `PF…`, jamais
// comme une facture (§ S25e.1).

import { buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { api, type InvoiceSummary, type InvoiceType, type SettlementView } from '@/lib/api';

import { BoutonApercu } from '../../_components/apercu-document';
import { Alerte, BOUTON, BOUTON_PETIT, CHAMP, Pastille } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';
import { formatDate } from '../../_components/sales-model';
import { useSalesList } from '../../_components/use-sales-list';
import {
  facturesAReglement,
  pastilleReglement,
} from '../../encaissements/_components/receipts-model';

import {
  BADGE_TEST_DGI,
  enteteDocument,
  resumeEnTestDgi,
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
  const { gerer, facturer } = useAccesVentes();
  const [filtres, setFiltres] = useState<FiltresFactures>(FILTRES_INITIAUX);

  const charger = useCallback(
    (cursor: string | null) => api.listInvoices(requeteFactures(filtres, cursor)),
    [filtres],
  );
  const liste = useSalesList<InvoiceSummary>(charger, JSON.stringify(filtres));

  // ADR-0031 : pastille de règlement des factures définitives affichées, lue
  // d'un seul appel. C'est un confort : en cas d'échec, la liste reste entière,
  // sans pastille, et l'onglet Encaissements dit le reste.
  const [reglements, setReglements] = useState<Record<string, SettlementView>>({});
  const idsReglement = facturesAReglement(liste.items).join(',');
  useEffect(() => {
    if (idsReglement === '') return;
    let annule = false;
    api
      .getSettlements(idsReglement.split(','))
      .then((r) => {
        if (!annule) setReglements(Object.fromEntries(r.items.map((v) => [v.invoiceId, v])));
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [idsReglement]);

  return (
    <section aria-labelledby="factures-titre" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="factures-titre" className="font-display text-lg font-bold tracking-tight">
            Documents de vente
          </h2>
          {/* ADR-0030 : non affichée sur téléphone, lue par les lecteurs d'écran. */}
          <p className="max-w-2xl text-sm text-[var(--foreground-muted)] max-sm:sr-only">
            Un document reste un pro forma tant qu’il n’est pas émis ou normalisé. Une facture émise
            ne se modifie plus : elle se corrige par un avoir.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`${FACTURES_BASE}/journal`}
            className={buttonClasses('secondary', 'md', 'flex-1 sm:flex-none')}
          >
            Journal
          </Link>
          {gerer ? (
            <Link
              href={`${FACTURES_BASE}/nouvelle`}
              className={buttonClasses('primary', 'md', 'flex-1 sm:flex-none')}
            >
              Nouveau document
            </Link>
          ) : null}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Afficher</legend>
        {/* Une ligne qui défile sur téléphone (ADR-0030), plusieurs sur bureau. */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
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
                    ? 'shrink-0 whitespace-nowrap rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]'
                    : 'shrink-0 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--foreground-muted)] hover:border-[var(--accent)]'
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
            placeholder="Numéro (IN…, AV…), référence PF… ou client"
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
                <li key={d.id} className="flex flex-col sm:flex-row sm:items-start">
                  <Link
                    href={`${FACTURES_BASE}/${encodeURIComponent(d.id)}`}
                    className="flex min-w-0 flex-1 flex-col gap-2 p-4 transition hover:bg-[var(--surface,transparent)] sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{entete.reference}</span>
                        {resumeEnTestDgi(d) ? (
                          <span
                            className="rounded border border-[var(--warn,#b45309)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--warn,#b45309)]"
                            title="Environnement de test DGI — facture sans valeur fiscale"
                          >
                            {BADGE_TEST_DGI}
                          </span>
                        ) : null}
                        <Pastille ton={tonStatut(d.status)}>{STATUS_LABELS[d.status]}</Pastille>
                        {(() => {
                          const reglement = pastilleReglement(reglements[d.id]);
                          return reglement ? (
                            <Pastille ton={reglement.ton}>{reglement.label}</Pastille>
                          ) : null;
                        })()}
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
                  <div className="px-4 pb-4 sm:py-4 sm:pl-0">
                    <BoutonApercu
                      className={BOUTON_PETIT}
                      document={{
                        genre: 'facture',
                        id: d.id,
                        titre: entete.titre,
                        nomFichier: `${(entete.reference || d.proformaRef).replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`,
                        peutEnvoyer: facturer,
                      }}
                    />
                  </div>
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
