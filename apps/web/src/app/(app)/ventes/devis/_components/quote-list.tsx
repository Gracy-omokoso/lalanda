'use client';

// Écran RUN › Ventes › Devis (ADR-0035 § 5 ; refonte ADR-0067 sur le modèle de
// l'écran Factures, ADR-0056) :
//
//   en-tête compact (titre, Nouveau devis)
//   cartes de chiffres et graphiques (`GET /sales/quotes/stats`)
//   liste : onglets de statut avec compteurs, recherche, tri, tableau dense
//
// Lecture : `sales.read` ; création : `sales.quote` (ADR-0040 § 4.1). Pagination
// par curseur (« Afficher plus »). Les compteurs des onglets et les graphiques
// viennent du même calcul serveur : ils concordent avec la liste.

import { buttonClasses, StatusPill } from '@lalanda/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { QuoteStats } from '@/lib/api';
import { crmApi, type QuoteStatus, type QuoteSummary } from '@/lib/api-crm';

import { BoutonApercu } from '../../_components/apercu-document';
import {
  BOUTON_LIGNE,
  CHAMP_COMPACT,
  IconePlus,
  OngletsStatut,
  type EtatTableau,
} from '../../_components/dashboard-ui';
import { Alerte } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';
import { formatMontant } from '../../_components/sales-model';
import { aujourdhuiKinshasa } from '../../encaissements/_components/receipts-model';

import { QuoteDashboard } from './quote-dashboard';
import { compteursDevis, statutDevis } from './quote-dashboard-model';
import {
  DEVIS_BASE,
  FILTRES_DEVIS,
  formatJour,
  messageDevis,
  peutPreparerDevis,
} from './quote-model';

type Tri = 'recent' | 'valid_until';
const TRIS: readonly { valeur: Tri; label: string }[] = [
  { valeur: 'recent', label: 'Plus récents' },
  { valeur: 'valid_until', label: 'Validité la plus proche' },
];

export function QuoteList(): React.ReactElement {
  const { actions } = useAccesVentes();
  const gerer = peutPreparerDevis(actions);
  const [statut, setStatut] = useState<QuoteStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [tri, setTri] = useState<Tri>('recent');
  const [items, setItems] = useState<QuoteSummary[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [chargementSuite, setChargementSuite] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // ADR-0067 : chiffres, graphiques et compteurs des onglets, calculés par le
  // serveur. Un échec ne bloque pas la liste.
  const [stats, setStats] = useState<QuoteStats | null>(null);
  const [etatStats, setEtatStats] = useState<EtatTableau>('chargement');
  const [versionStats, setVersionStats] = useState(0);
  useEffect(() => {
    let annule = false;
    setEtatStats('chargement');
    crmApi
      .getQuoteStats()
      .then((s) => {
        if (annule) return;
        setStats(s);
        setEtatStats('pret');
      })
      .catch(() => {
        if (!annule) setEtatStats('erreur');
      });
    return () => {
      annule = true;
    };
  }, [versionStats]);
  const compteurs = stats ? compteursDevis(stats) : null;
  const asOf = stats?.asOf ?? aujourdhuiKinshasa(new Date());

  useEffect(() => {
    let annule = false;
    setItems(null);
    const t = setTimeout(() => {
      crmApi
        .listQuotes({ status: statut, sort: tri, limit: 50, ...(q.trim() ? { q: q.trim() } : {}) })
        .then((p) => {
          if (annule) return;
          setItems(p.items);
          setSuivante(p.nextCursor);
          setErreur(null);
        })
        .catch((err) => {
          if (annule) return;
          setItems([]);
          setErreur(messageDevis(err, 'Impossible de charger les devis.'));
        });
    }, 200);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [statut, q, tri]);

  async function plus(): Promise<void> {
    if (!suivante) return;
    setChargementSuite(true);
    try {
      const p = await crmApi.listQuotes({
        status: statut,
        sort: tri,
        limit: 50,
        cursor: suivante,
        ...(q.trim() ? { q: q.trim() } : {}),
      });
      setItems((x) => [...(x ?? []), ...p.items]);
      setSuivante(p.nextCursor);
    } catch (err) {
      setErreur(messageDevis(err, 'Impossible de charger la suite.'));
    } finally {
      setChargementSuite(false);
    }
  }

  const total = compteurs ? compteurs[statut] : null;
  const filtre = statut !== 'all' || q.trim() !== '';

  return (
    <section aria-labelledby="devis-titre" className="flex flex-col gap-3.5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-0.5">
          <h1
            id="devis-titre"
            className="font-display text-[length:var(--font-size-h1)] font-bold leading-tight tracking-[-0.2px]"
          >
            Devis
          </h1>
          <p className="text-[13px] text-[var(--foreground-muted)]">
            Propositions de prix, sans valeur de facture.
            <span className="sr-only">
              {' '}
              Une fois accepté, un devis se convertit en brouillon de facture, qui suit ensuite son
              propre circuit (émission ou normalisation DGI).
            </span>
          </p>
        </div>
        {gerer ? (
          <Link
            href={`${DEVIS_BASE}/nouveau`}
            className={buttonClasses(
              'primary',
              'md',
              'gap-1.5 px-3.5 text-[13px] font-semibold max-sm:w-full',
            )}
          >
            <IconePlus />
            Nouveau devis
          </Link>
        ) : null}
      </header>

      <QuoteDashboard
        stats={stats}
        etat={etatStats}
        gerer={gerer}
        onReessayer={() => setVersionStats((v) => v + 1)}
      />

      <div className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-col gap-2 border-b border-[var(--border)] p-2 sm:px-3 lg:flex-row lg:items-center lg:gap-3">
          <OngletsStatut
            options={FILTRES_DEVIS}
            valeur={statut}
            compteurs={compteurs}
            onChange={setStatut}
          />
          <form
            role="search"
            aria-label="Rechercher un devis"
            onSubmit={(e) => e.preventDefault()}
            className="flex min-w-0 flex-1 gap-2"
          >
            <label htmlFor="dv-q" className="sr-only">
              Rechercher un devis
            </label>
            <input
              id="dv-q"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={100}
              placeholder="Numéro DV…, client ou objet"
              className={`${CHAMP_COMPACT} min-w-0 flex-1`}
            />
            <label htmlFor="dv-tri" className="sr-only">
              Trier
            </label>
            <select
              id="dv-tri"
              value={tri}
              onChange={(e) => setTri(e.target.value as Tri)}
              className={`${CHAMP_COMPACT} w-36 shrink-0 sm:w-48`}
            >
              {TRIS.map((t) => (
                <option key={t.valeur} value={t.valeur}>
                  {t.label}
                </option>
              ))}
            </select>
          </form>
        </div>

        {erreur ? (
          <div className="p-3">
            <Alerte>
              <p>{erreur}</p>
            </Alerte>
          </div>
        ) : null}
        {items === null ? (
          <p className="px-4 py-6 text-sm text-[var(--foreground-muted)]" aria-live="polite">
            Chargement des devis…
          </p>
        ) : items.length === 0 ? (
          erreur ? null : (
            <div className="px-4 py-10 text-center">
              {filtre ? (
                <p className="text-sm text-[var(--foreground-muted)]">
                  Aucun devis ne correspond à ces critères.
                </p>
              ) : (
                <>
                  <p className="text-sm font-medium">Aucun devis pour l’instant</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-[var(--foreground-muted)]">
                    {gerer
                      ? 'Préparez votre premier devis : il naît en brouillon, puis s’envoie au client.'
                      : 'Les devis de l’organisation apparaîtront ici.'}
                  </p>
                </>
              )}
            </div>
          )
        ) : (
          <>
            <TableauDevis items={items} gerer={gerer} asOf={asOf} />
            <ListeTelephone items={items} gerer={gerer} asOf={asOf} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--foreground-muted)]">
              <span aria-live="polite">
                {total !== null && !q.trim()
                  ? `${items.length.toLocaleString('fr-FR')} devis sur ${total.toLocaleString('fr-FR')}`
                  : `${items.length.toLocaleString('fr-FR')} devis affiché${items.length > 1 ? 's' : ''}`}
              </span>
              {suivante ? (
                <button
                  type="button"
                  onClick={() => void plus()}
                  disabled={chargementSuite}
                  className={buttonClasses('secondary', 'sm')}
                >
                  {chargementSuite ? 'Chargement…' : 'Afficher plus de devis'}
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

interface LignesProps {
  items: readonly QuoteSummary[];
  gerer: boolean;
  asOf: string;
}

function apercuDe(d: QuoteSummary, gerer: boolean) {
  return {
    genre: 'devis' as const,
    id: d.id,
    titre: `Devis ${d.number} (v${d.version})`,
    nomFichier: `${d.number}-v${d.version}.pdf`,
    peutEnvoyer: gerer,
  };
}

function montant(d: QuoteSummary): string {
  return d.total ? formatMontant(d.total, d.currency) : 'Calcul indisponible';
}

/** Grand écran : tableau dense (`--row-h`), une ligne cliquable par devis. */
function TableauDevis({ items, gerer, asOf }: LignesProps): React.ReactElement {
  return (
    <table className="hidden w-full table-fixed border-collapse text-[13px] md:table">
      <caption className="sr-only">Devis</caption>
      <colgroup>
        <col className="w-[150px]" />
        <col />
        <col className="w-[116px]" />
        <col className="w-[170px]" />
        <col className="w-[160px]" />
        <col className="w-[92px]" />
      </colgroup>
      <thead>
        <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-left text-xs font-medium text-[var(--foreground-muted)]">
          <th scope="col" className="px-4 py-[7px] font-medium">
            Numéro
          </th>
          <th scope="col" className="px-2 py-[7px] font-medium">
            Client et objet
          </th>
          <th scope="col" className="px-2 py-[7px] font-medium">
            Valable jusqu’au
          </th>
          <th scope="col" className="px-2 py-[7px] text-right font-medium">
            Montant TTC
          </th>
          <th scope="col" className="py-[7px] pl-4 pr-2 font-medium">
            Statut
          </th>
          <th scope="col" className="px-4 py-[7px] font-medium">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((d) => {
          const statut = statutDevis(d, asOf);
          return (
            <tr
              key={d.id}
              className="relative h-[var(--row-h)] border-b border-[var(--border)] transition-colors duration-[var(--motion-fast)] last:border-b-0 hover:bg-[var(--surface-muted)]"
            >
              <td className="px-4">
                <span className="flex items-baseline gap-1.5">
                  <Link
                    href={`${DEVIS_BASE}/${encodeURIComponent(d.id)}`}
                    className="truncate font-mono text-xs after:absolute after:inset-0 after:content-[''] hover:underline"
                  >
                    {d.number}
                  </Link>
                  <span className="text-[11px] text-[var(--foreground-muted)]">v{d.version}</span>
                </span>
              </td>
              <td className="truncate px-2">
                <span className="font-medium">{d.customerName ?? 'Client sans fiche'}</span>
                {d.title ? (
                  <span className="text-[var(--foreground-muted)]"> · {d.title}</span>
                ) : null}
              </td>
              <td className="px-2 text-[var(--foreground-muted)]">{formatJour(d.validUntil)}</td>
              <td className="truncate px-2 text-right font-mono tabular-nums">{montant(d)}</td>
              <td className="py-1 pl-4 pr-2">
                <StatusPill tone={statut.ton}>{statut.label}</StatusPill>
              </td>
              <td className="px-4 text-right">
                <BoutonApercu className={BOUTON_LIGNE} document={apercuDe(d, gerer)} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Téléphone : une ligne compacte par devis, mêmes informations et actions. */
function ListeTelephone({ items, gerer, asOf }: LignesProps): React.ReactElement {
  return (
    <ul className="divide-y divide-[var(--border)] md:hidden">
      {items.map((d) => {
        const statut = statutDevis(d, asOf);
        return (
          <li key={d.id} className="relative flex items-start gap-3 px-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center justify-between gap-2">
                <Link
                  href={`${DEVIS_BASE}/${encodeURIComponent(d.id)}`}
                  className="truncate font-mono text-xs after:absolute after:inset-0 after:content-['']"
                >
                  {d.number} · v{d.version}
                </Link>
                <StatusPill tone={statut.ton}>{statut.label}</StatusPill>
              </span>
              <span className="truncate text-sm font-medium">
                {d.customerName ?? 'Client sans fiche'}
              </span>
              <span className="flex items-center justify-between gap-2 text-xs text-[var(--foreground-muted)]">
                <span className="truncate">Jusqu’au {formatJour(d.validUntil)}</span>
                <span className="shrink-0 font-mono text-[13px] text-[var(--foreground)]">
                  {montant(d)}
                </span>
              </span>
            </div>
            <BoutonApercu className={`${BOUTON_LIGNE} mt-6`} document={apercuDe(d, gerer)} />
          </li>
        );
      })}
    </ul>
  );
}
