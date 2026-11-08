'use client';

// Factures fournisseurs — ADR-0044 § 3.5 et § 8 ; refonte ADR-0071 sur le modèle
// des écrans Factures, Devis et Encaissements (ADR-0056, ADR-0067) :
//
//   en-tête compact (titre, Saisir une facture)
//   cartes de chiffres et graphiques (`GET /purchases/invoices/stats`)
//   liste : onglets avec compteurs, recherche, tableau dense, liste sur téléphone
//
// Saisie en fenêtre modale, libre (`?nouvelle=1`) ou depuis une commande
// (`?commande=<id>`, préremplie par l'API). Montants et restes : ceux de l'API ;
// les compteurs des onglets viennent du même calcul serveur que les filtres.

import { StatusPill, buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  IconePlus,
  OngletsStatut,
  RechercheListe,
  SelecteurDevise,
  BOUTON_PRINCIPAL,
  EnTeteEcran,
} from '@/components/tableau-de-bord/briques';
import { contient, nombre } from '@/components/tableau-de-bord/format';
import { TableauChiffres } from '@/components/tableau-de-bord/tableau';
import { useTableau } from '@/components/tableau-de-bord/use-tableau';
import { purchasesPayablesApi, type SupplierInvoiceListItem } from '@/lib/api-purchases-payables';
import { runStatsApi } from '@/lib/api-run-stats';

import { Alerte } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { useAccesAchats } from './achats-access';
import { formatJour, lienFacture, messageAchats, peutGererAchats } from './achats-model';
import { FenetreFacture } from './facture-formulaire';
import {
  FILTRES_FACTURES,
  etatFacture,
  lireFiltreFactures,
  natureFacture,
  requeteFactures,
  type FiltreFactures,
} from './factures-model';
import {
  barresCategories,
  blocDevise,
  cartesFactures,
  compteursFactures,
  devisesDe,
  noteDeviseAchats,
  tonPastille,
} from './tableau-achats-model';

type Devise = 'CDF' | 'USD';

export function FacturesListe(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { actions } = useAccesAchats();
  const gerer = peutGererAchats(actions);
  const libre = params.get('nouvelle') === '1';
  const commande = params.get('commande');
  const fournisseur = params.get('fournisseur');
  const [filtre, setFiltre] = useState<FiltreFactures>(() =>
    lireFiltreFactures(params.get('filtre')),
  );
  const [q, setQ] = useState('');
  const [devise, setDevise] = useState<Devise | null>(null);
  const [items, setItems] = useState<SupplierInvoiceListItem[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // ADR-0071 : chiffres et compteurs calculés par le serveur ; un échec n'empêche
  // pas la liste.
  const { stats, etat, reessayer } = useTableau(() => runStatsApi.supplierInvoices(), 'factures');
  const bloc = stats ? blocDevise(stats.byCurrency, devise) : null;
  const compteurs = stats ? compteursFactures(stats) : null;

  const charger = useCallback((f: FiltreFactures, cursor: string | null) => {
    purchasesPayablesApi
      .listInvoices(requeteFactures(f, cursor))
      .then((p) => {
        setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
        setSuivante(p.nextCursor);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setItems([]);
        setErreur(messageAchats(err, 'Impossible de charger les factures.'));
      });
  }, []);

  useEffect(() => {
    setItems(null);
    charger(filtre, null);
  }, [filtre, charger]);

  const fermer = () => router.replace(pathname);
  const visibles = (items ?? []).filter((f) =>
    contient([f.supplierName, f.internalNumber, f.supplierReference], q),
  );
  const total = compteurs ? compteurs[filtre] : null;

  return (
    <section aria-labelledby="ff-titre" className="flex min-w-0 flex-col gap-3.5">
      <EnTeteEcran
        id="ff-titre"
        titre="Factures fournisseurs"
        sousTitre="Ce que vous devez, rapproché de la commande et des réceptions."
        detail="Chaque facture est rapprochée de sa commande et de ses réceptions avant d’être payée ; les taxes sont celles du fournisseur, jamais calculées."
        action={
          gerer ? (
            <button
              type="button"
              className={BOUTON_PRINCIPAL}
              onClick={() => router.replace(`${pathname}?nouvelle=1`)}
            >
              <IconePlus />
              Saisir une facture
            </button>
          ) : null
        }
      />

      <TableauChiffres
        etat={etat}
        libelle="Chiffres des factures fournisseurs"
        texteErreur="Les chiffres des factures fournisseurs sont momentanément indisponibles. La liste reste à jour."
        onReessayer={reessayer}
        outils={
          stats && bloc ? (
            <SelecteurDevise
              devises={devisesDe(stats)}
              valeur={bloc.currency}
              onChange={setDevise}
            />
          ) : null
        }
        cartes={stats && bloc ? cartesFactures(stats, bloc) : stats ? [] : null}
        vide={
          stats && (!bloc || stats.statusCounts.validated === 0)
            ? {
                titre: 'Pas encore de facture validée',
                texte:
                  'Saisissez les factures de vos fournisseurs : le facturé des 12 derniers mois, le reste à payer et la répartition par catégorie apparaîtront ici.',
                action: gerer
                  ? { href: `${pathname}?nouvelle=1`, label: 'Saisir une facture' }
                  : null,
              }
            : null
        }
        courbe={
          stats && bloc
            ? {
                titre: 'Facturé, 12 derniers mois',
                nom: `Facturé par les fournisseurs par mois, en ${bloc.currency}`,
                mois: bloc.months.map((m) => m.month),
                valeurs: bloc.months.map((m) => nombre(m.amount)),
                serie: 'Facturé',
                unite: bloc.currency,
              }
            : null
        }
        repartition={
          bloc
            ? {
                titre: 'Par catégorie, 12 mois',
                nom: `Facturé par catégorie d’imputation sur 12 mois, en ${bloc.currency}`,
                barres: barresCategories(bloc),
                vide: 'Aucune imputation sur la période.',
              }
            : null
        }
        note={stats && bloc ? noteDeviseAchats(stats, bloc.currency) : null}
      />

      {gerer && (libre || commande) ? (
        <FenetreFacture
          source={
            commande
              ? { type: 'commande', orderId: commande }
              : { type: 'libre', supplierId: fournisseur }
          }
          onFermer={fermer}
          onCree={(f) => router.push(lienFacture(f.id))}
        />
      ) : null}

      <div className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-col gap-2 border-b border-[var(--border)] p-2 sm:px-3 lg:flex-row lg:items-center lg:gap-3">
          <OngletsStatut
            options={FILTRES_FACTURES}
            valeur={filtre}
            compteurs={compteurs}
            onChange={setFiltre}
          />
          <RechercheListe
            id="ff-q"
            label="Rechercher une facture fournisseur"
            valeur={q}
            onChange={setQ}
            placeholder="Fournisseur, FF… ou référence"
          />
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
            Chargement des factures…
          </p>
        ) : visibles.length === 0 ? (
          erreur ? null : (
            <p className="px-4 py-10 text-center text-sm text-[var(--foreground-muted)]">
              {filtre !== 'toutes' || q.trim() !== ''
                ? 'Aucune facture ne correspond à ces critères.'
                : 'Aucune facture fournisseur pour l’instant.'}
            </p>
          )
        ) : (
          <>
            <TableauFactures items={visibles} />
            <ListeTelephone items={visibles} />
          </>
        )}
        {items !== null && items.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--foreground-muted)]">
            <span aria-live="polite">
              {total !== null && !q.trim()
                ? `${items.length.toLocaleString('fr-FR')} facture${items.length > 1 ? 's' : ''} sur ${total.toLocaleString('fr-FR')}`
                : `${visibles.length.toLocaleString('fr-FR')} affichée${visibles.length > 1 ? 's' : ''}`}
            </span>
            {suivante ? (
              <button
                type="button"
                className={buttonClasses('secondary', 'sm')}
                onClick={() => charger(filtre, suivante)}
              >
                Afficher plus de factures
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function resteDe(f: SupplierInvoiceListItem): string | null {
  return f.status === 'validated' && f.kind === 'invoice' && f.settlementStatus !== 'paid'
    ? formatMontant(f.remaining, f.currency)
    : null;
}

/** Grand écran : tableau dense, une ligne cliquable par facture. */
function TableauFactures({
  items,
}: {
  items: readonly SupplierInvoiceListItem[];
}): React.ReactElement {
  return (
    <table className="hidden w-full table-fixed border-collapse text-[13px] md:table">
      <caption className="sr-only">Factures fournisseurs</caption>
      <colgroup>
        <col className="w-[140px]" />
        <col />
        <col className="w-[104px]" />
        <col className="w-[150px]" />
        <col className="w-[140px]" />
        <col className="w-[170px]" />
      </colgroup>
      <thead>
        <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-left text-xs font-medium text-[var(--foreground-muted)]">
          <th scope="col" className="px-4 py-[7px] font-medium">
            Numéro
          </th>
          <th scope="col" className="px-2 py-[7px] font-medium">
            Fournisseur et référence
          </th>
          <th scope="col" className="px-2 py-[7px] font-medium">
            Échéance
          </th>
          <th scope="col" className="px-2 py-[7px] text-right font-medium">
            Total TTC
          </th>
          <th scope="col" className="px-2 py-[7px] text-right font-medium">
            Reste à payer
          </th>
          <th scope="col" className="py-[7px] pl-4 pr-4 font-medium">
            Statut
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((f) => {
          const etat = etatFacture(f);
          const reste = resteDe(f);
          return (
            <tr
              key={f.id}
              className="relative h-[var(--row-h)] border-b border-[var(--border)] transition-colors duration-[var(--motion-fast)] last:border-b-0 hover:bg-[var(--surface-muted)]"
            >
              <td className="px-4">
                <Link
                  href={lienFacture(f.id)}
                  className="truncate font-mono text-xs after:absolute after:inset-0 after:content-[''] hover:underline"
                  title={natureFacture(f)}
                >
                  {f.internalNumber}
                </Link>
              </td>
              <td className="truncate px-2">
                <span className="font-medium">{f.supplierName ?? 'Fournisseur'}</span>
                <span className="text-[var(--foreground-muted)]">
                  {' '}
                  · réf. {f.supplierReference}
                </span>
                {f.kind === 'credit_note' ? (
                  <span className="text-[var(--foreground-muted)]"> · avoir</span>
                ) : null}
              </td>
              <td className="px-2 text-[var(--foreground-muted)]">{formatJour(f.dueDate)}</td>
              <td className="truncate px-2 text-right font-mono tabular-nums">
                {formatMontant(f.total, f.currency)}
              </td>
              <td className="truncate px-2 text-right font-mono tabular-nums">{reste ?? '—'}</td>
              <td className="py-1 pl-4 pr-4">
                <StatusPill tone={tonPastille(etat.ton)}>{etat.libelle}</StatusPill>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Téléphone : une ligne compacte par facture, mêmes informations. */
function ListeTelephone({
  items,
}: {
  items: readonly SupplierInvoiceListItem[];
}): React.ReactElement {
  return (
    <ul className="divide-y divide-[var(--border)] md:hidden">
      {items.map((f) => {
        const etat = etatFacture(f);
        const reste = resteDe(f);
        return (
          <li key={f.id} className="relative flex flex-col gap-1 px-3 py-2.5">
            <span className="flex items-center justify-between gap-2">
              <Link
                href={lienFacture(f.id)}
                className="truncate font-mono text-xs after:absolute after:inset-0 after:content-['']"
              >
                {f.internalNumber}
              </Link>
              <StatusPill tone={tonPastille(etat.ton)}>{etat.libelle}</StatusPill>
            </span>
            <span className="truncate text-sm font-medium">{f.supplierName ?? 'Fournisseur'}</span>
            <span className="flex items-center justify-between gap-2 text-xs text-[var(--foreground-muted)]">
              <span className="truncate">Échéance {formatJour(f.dueDate)}</span>
              <span className="shrink-0 font-mono text-[13px] text-[var(--foreground)]">
                {reste ? `Reste ${reste}` : formatMontant(f.total, f.currency)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
