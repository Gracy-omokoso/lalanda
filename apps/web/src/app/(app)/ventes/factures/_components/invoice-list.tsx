'use client';

// Écran RUN › Ventes › Factures (ADR-0023 § S25e.14 ; refonte ADR-0056 sur la
// maquette validée le 3 nov. 2026) :
//
//   en-tête compact (titre, Journal, Nouveau document)
//   cartes de chiffres et graphiques (`GET /sales/invoices/stats`)
//   liste : onglets de statut avec compteurs, recherche, type, tableau dense
//
// Filtres par statut et par type, recherche (numéro, référence de pro forma,
// client), pagination par curseur. Un document non final s'affiche par sa
// référence `PF…`, jamais comme une facture (§ S25e.1). Les compteurs des onglets
// et les graphiques viennent du même calcul serveur : ils concordent avec la liste.

import { buttonClasses, Select, StatusPill, TextInput } from '@lalanda/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  api,
  type InvoiceStats,
  type InvoiceSummary,
  type InvoiceType,
  type SettlementView,
} from '@/lib/api';

import { BoutonApercu } from '../../_components/apercu-document';
import { Alerte } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';
import { useSalesList } from '../../_components/use-sales-list';
import { facturesAReglement } from '../../encaissements/_components/receipts-model';

import { InvoiceDashboard, type EtatTableau } from './invoice-dashboard';
import { compteursFiltres, dateCourte, statutLigne, typeAffiche } from './invoice-dashboard-model';
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
  TYPE_LABELS,
} from './invoice-model';

const BOUTON_LIGNE =
  'relative z-10 inline-flex h-7 items-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium transition-colors duration-[var(--motion-fast)] hover:border-[var(--accent)] hover:bg-[var(--surface-muted)]';

function IconeJournal(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-[15px] w-[15px]"
    >
      <path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5" />
    </svg>
  );
}

function IconePlus(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      className="h-[15px] w-[15px]"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function InvoiceList(): React.ReactElement {
  const { gerer, facturer } = useAccesVentes();
  const [filtres, setFiltres] = useState<FiltresFactures>(FILTRES_INITIAUX);

  const charger = useCallback(
    (cursor: string | null) => api.listInvoices(requeteFactures(filtres, cursor)),
    [filtres],
  );
  const liste = useSalesList<InvoiceSummary>(charger, JSON.stringify(filtres));

  // ADR-0056 : chiffres, graphiques et compteurs des onglets, calculés par le
  // serveur. Un échec ne bloque pas la liste.
  const [stats, setStats] = useState<InvoiceStats | null>(null);
  const [etatStats, setEtatStats] = useState<EtatTableau>('chargement');
  const [versionStats, setVersionStats] = useState(0);
  useEffect(() => {
    let annule = false;
    setEtatStats('chargement');
    api
      .getInvoiceStats()
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
  const compteurs = stats ? compteursFiltres(stats) : null;

  // ADR-0031 : règlement des factures définitives affichées, lu d'un seul appel.
  // C'est un confort : en cas d'échec, la liste reste entière, avec le statut du
  // document seul, et l'onglet Encaissements dit le reste.
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

  const total = compteurs ? compteurs[filtres.statut] : null;

  return (
    <section aria-labelledby="factures-titre" className="flex flex-col gap-3.5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-0.5">
          <h1
            id="factures-titre"
            className="font-display text-[length:var(--font-size-h1)] font-bold leading-tight tracking-[-0.2px]"
          >
            Factures
          </h1>
          <p className="text-[13px] text-[var(--foreground-muted)]">
            Pro forma, factures normalisées DGI et avoirs.
            <span className="sr-only">
              {' '}
              Un document reste un pro forma tant qu’il n’est pas émis ou normalisé. Une facture
              émise ne se modifie plus : elle se corrige par un avoir.
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`${FACTURES_BASE}/journal`}
            className={buttonClasses(
              'secondary',
              'md',
              'flex-1 gap-1.5 px-3 text-[13px] sm:flex-none',
            )}
          >
            <IconeJournal />
            Journal
          </Link>
          {gerer ? (
            <Link
              href={`${FACTURES_BASE}/nouvelle`}
              className={buttonClasses(
                'primary',
                'md',
                'flex-1 gap-1.5 px-3.5 text-[13px] font-semibold sm:flex-none',
              )}
            >
              <IconePlus />
              Nouveau document
            </Link>
          ) : null}
        </div>
      </header>

      <InvoiceDashboard
        stats={stats}
        etat={etatStats}
        onReessayer={() => setVersionStats((v) => v + 1)}
      />

      <div className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-col gap-2 border-b border-[var(--border)] p-2 sm:px-3 lg:flex-row lg:items-center lg:gap-3">
          {/* Onglets de statut (boutons à bascule), une ligne qui défile sur téléphone. */}
          <div
            role="group"
            aria-label="Afficher"
            className="-mx-2 overflow-x-auto px-2 [scrollbar-width:none] sm:mx-0 sm:px-0"
          >
            <div className="inline-flex rounded-[var(--radius-md)] bg-[var(--surface-muted)] p-0.5">
              {FILTRES_STATUT.map((f) => {
                const actif = filtres.statut === f.valeur;
                const n = compteurs ? compteurs[f.valeur] : null;
                return (
                  <button
                    key={f.valeur}
                    type="button"
                    aria-pressed={actif}
                    onClick={() => setFiltres((x) => ({ ...x, statut: f.valeur }))}
                    className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-2.5 text-[13px] transition-colors duration-[var(--motion-fast)] ${
                      actif
                        ? 'bg-[var(--surface)] font-semibold text-[var(--foreground)] shadow-[0_1px_2px_rgba(0,0,0,0.14)]'
                        : 'text-[var(--foreground-muted)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {f.label}
                    {n !== null ? (
                      <span className="font-mono text-[11px] font-normal text-[var(--foreground-muted)]">
                        {n.toLocaleString('fr-FR')}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <form
            role="search"
            aria-label="Rechercher un document de vente"
            onSubmit={(e) => e.preventDefault()}
            className="flex min-w-0 flex-1 gap-2"
          >
            <TextInput
              id="fa-q"
              type="search"
              aria-label="Rechercher une facture"
              value={filtres.q}
              onChange={(e) => setFiltres((f) => ({ ...f, q: e.target.value }))}
              maxLength={100}
              placeholder="Numéro, référence ou client"
              leading={<Search aria-hidden="true" className="h-4 w-4" />}
              className="min-w-0 flex-1"
            />
            <Select<InvoiceType | ''>
              id="fa-type"
              aria-label="Type"
              value={filtres.type}
              onChange={(v) => setFiltres((f) => ({ ...f, type: v }))}
              options={[
                { value: '', label: 'Tous les types' },
                ...(Object.keys(TYPE_LABELS) as InvoiceType[]).map((t) => ({
                  value: t,
                  label: TYPE_LABELS[t],
                })),
              ]}
              className="w-40 shrink-0 sm:w-48"
            />
          </form>
        </div>

        {liste.etat === 'chargement' ? (
          <p className="px-4 py-6 text-sm text-[var(--foreground-muted)]" aria-live="polite">
            Chargement des documents…
          </p>
        ) : liste.etat === 'refus' ? (
          <div className="p-6 text-center sm:p-8">
            <p className="text-sm font-medium">Documents de vente non accessibles</p>
            <p className="mt-1 text-sm text-[var(--foreground-muted)]">{liste.erreur}</p>
          </div>
        ) : liste.etat === 'erreur' ? (
          <div className="p-3">
            <Alerte
              action={
                <button
                  type="button"
                  onClick={liste.recharger}
                  className={buttonClasses('secondary', 'sm')}
                >
                  Réessayer
                </button>
              }
            >
              <p>{liste.erreur}</p>
            </Alerte>
          </div>
        ) : liste.items.length === 0 ? (
          <div className="px-4 py-10 text-center">
            {filtreActif(filtres) ? (
              <p className="text-sm text-[var(--foreground-muted)]">
                Aucun document ne correspond à ces critères.
              </p>
            ) : (
              <>
                <p className="text-sm font-medium">Aucun document de vente pour l’instant</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-[var(--foreground-muted)]">
                  {gerer
                    ? 'Composez votre premier document : il naît en brouillon (pro forma), puis s’émet ou se normalise.'
                    : 'Les documents de l’organisation apparaîtront ici.'}
                </p>
                {gerer ? (
                  <Link
                    href={`${FACTURES_BASE}/nouvelle`}
                    className={buttonClasses('primary', 'md', 'mt-4 gap-1.5')}
                  >
                    <IconePlus />
                    Nouveau document
                  </Link>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <>
            <TableauFactures items={liste.items} reglements={reglements} facturer={facturer} />
            <ListeTelephone items={liste.items} reglements={reglements} facturer={facturer} />
            {liste.erreurSuite ? (
              <div className="p-3">
                <Alerte>
                  <p>{liste.erreurSuite}</p>
                </Alerte>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-[var(--foreground-muted)]">
              <span aria-live="polite">
                {total !== null && !filtres.q.trim() && filtres.type === ''
                  ? `${liste.items.length.toLocaleString('fr-FR')} document${liste.items.length > 1 ? 's' : ''} sur ${total.toLocaleString('fr-FR')}`
                  : `${liste.items.length.toLocaleString('fr-FR')} document${liste.items.length > 1 ? 's' : ''} affiché${liste.items.length > 1 ? 's' : ''}`}
              </span>
              {liste.suivante ? (
                <button
                  type="button"
                  onClick={liste.chargerSuite}
                  disabled={liste.chargementSuite}
                  className={buttonClasses('secondary', 'sm')}
                >
                  {liste.chargementSuite ? 'Chargement…' : 'Afficher plus de documents'}
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
  items: readonly InvoiceSummary[];
  reglements: Record<string, SettlementView>;
  facturer: boolean;
}

function apercuDe(d: InvoiceSummary, facturer: boolean) {
  const entete = enteteDocument(d);
  return {
    genre: 'facture' as const,
    id: d.id,
    titre: entete.titre,
    nomFichier: `${(entete.reference || d.proformaRef).replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`,
    peutEnvoyer: facturer,
  };
}

function BadgeTest(): React.ReactElement {
  return (
    <span
      className="rounded-[var(--radius-sm)] border border-[var(--warn)] px-1 text-[10px] font-bold uppercase leading-4 tracking-wide text-[var(--warn)]"
      title="Environnement de test DGI — facture sans valeur fiscale"
    >
      {BADGE_TEST_DGI}
    </span>
  );
}

/** Grand écran : tableau dense (`--row-h`), une ligne cliquable par document. */
function TableauFactures({ items, reglements, facturer }: LignesProps): React.ReactElement {
  return (
    <table className="hidden w-full table-fixed border-collapse text-[13px] md:table">
      <caption className="sr-only">Documents de vente</caption>
      <colgroup>
        <col className="w-[150px]" />
        <col />
        <col className="w-[104px]" />
        <col className="w-[104px]" />
        <col className="w-[170px]" />
        <col className="w-[164px]" />
        <col className="w-[92px]" />
      </colgroup>
      <thead>
        <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-left text-xs font-medium text-[var(--foreground-muted)]">
          <th scope="col" className="px-4 py-[7px] font-medium">
            Numéro
          </th>
          <th scope="col" className="px-2 py-[7px] font-medium">
            Client
          </th>
          <th scope="col" className="px-2 py-[7px] font-medium">
            Type
          </th>
          <th scope="col" className="px-2 py-[7px] font-medium">
            Émise le
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
          const entete = enteteDocument(d);
          const montants = montantsResume(d);
          const statut = statutLigne(d, reglements[d.id]);
          return (
            <tr
              key={d.id}
              className="relative h-[var(--row-h)] border-b border-[var(--border)] transition-colors duration-[var(--motion-fast)] last:border-b-0 hover:bg-[var(--surface-muted)]"
            >
              <td className="px-4">
                <span className="flex items-center gap-1.5">
                  <Link
                    href={`${FACTURES_BASE}/${encodeURIComponent(d.id)}`}
                    className="truncate font-mono text-xs after:absolute after:inset-0 after:content-[''] hover:underline"
                  >
                    {entete.reference}
                  </Link>
                  {resumeEnTestDgi(d) ? <BadgeTest /> : null}
                </span>
              </td>
              <td className="truncate px-2 font-medium">
                {d.customer.name ?? 'Vente de comptoir'}
              </td>
              <td className="truncate px-2 text-[var(--foreground-muted)]">{typeAffiche(d)}</td>
              <td className="px-2 text-[var(--foreground-muted)]">{dateCourte(d.issuedAt)}</td>
              <td className="px-2 text-right font-mono tabular-nums">
                <span className="block truncate">{montants.document}</span>
                {montants.normalise ? (
                  <span className="block truncate text-[11px] leading-3 text-[var(--foreground-muted)]">
                    {montants.normalise} (fait foi)
                  </span>
                ) : null}
              </td>
              <td className="py-1 pl-4 pr-2">
                <StatusPill tone={statut.ton}>{statut.label}</StatusPill>
              </td>
              <td className="px-4 text-right">
                <BoutonApercu className={BOUTON_LIGNE} document={apercuDe(d, facturer)} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Téléphone : une ligne compacte par document, mêmes informations et actions. */
function ListeTelephone({ items, reglements, facturer }: LignesProps): React.ReactElement {
  return (
    <ul className="divide-y divide-[var(--border)] md:hidden">
      {items.map((d) => {
        const entete = enteteDocument(d);
        const montants = montantsResume(d);
        const statut = statutLigne(d, reglements[d.id]);
        return (
          <li key={d.id} className="relative flex items-start gap-3 px-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center justify-between gap-2">
                <Link
                  href={`${FACTURES_BASE}/${encodeURIComponent(d.id)}`}
                  className="truncate font-mono text-xs after:absolute after:inset-0 after:content-['']"
                >
                  {entete.reference}
                </Link>
                <StatusPill tone={statut.ton}>{statut.label}</StatusPill>
              </span>
              <span className="truncate text-sm font-medium">
                {d.customer.name ?? 'Vente de comptoir'}
              </span>
              <span className="flex items-center justify-between gap-2 text-xs text-[var(--foreground-muted)]">
                <span className="flex items-center gap-1.5">
                  {typeAffiche(d)} · {dateCourte(d.issuedAt)}
                  {resumeEnTestDgi(d) ? <BadgeTest /> : null}
                </span>
                <span className="font-mono text-[13px] text-[var(--foreground)]">
                  {montants.document}
                </span>
              </span>
              {montants.normalise ? (
                <span className="self-end font-mono text-[11px] text-[var(--foreground-muted)]">
                  {montants.normalise} (fait foi)
                </span>
              ) : null}
            </div>
            <BoutonApercu className={`${BOUTON_LIGNE} mt-6`} document={apercuDe(d, facturer)} />
          </li>
        );
      })}
    </ul>
  );
}
