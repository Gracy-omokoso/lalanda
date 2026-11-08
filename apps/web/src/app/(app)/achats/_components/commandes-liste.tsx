'use client';

// Demandes et commandes — ADR-0044 § 3.2 et § 8 ; refonte ADR-0071 sur le modèle
// des écrans Factures, Devis et Encaissements :
//
//   en-tête compact (titre, Demander un achat)
//   cartes de chiffres et graphiques (`GET /purchases/orders/stats`)
//   liste : onglets avec compteurs, recherche, tableau dense, liste sur téléphone
//
// Création d'une demande en fenêtre modale (`purchase.request`). Montants TTC
// rendus par l'API ; compteurs des onglets servis par le même calcul serveur.

import { Modal, StatusPill, buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  BOUTON_PRINCIPAL,
  EnTeteEcran,
  IconePlus,
  OngletsStatut,
  RechercheListe,
  SelecteurDevise,
} from '@/components/tableau-de-bord/briques';
import { contient, nombre } from '@/components/tableau-de-bord/format';
import { TableauChiffres } from '@/components/tableau-de-bord/tableau';
import { useTableau } from '@/components/tableau-de-bord/use-tableau';
import { purchasesApi, type PurchaseOrderView } from '@/lib/api-purchases';
import { runStatsApi } from '@/lib/api-run-stats';

import { Alerte } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { useAccesAchats } from './achats-access';
import {
  LIBELLES_STATUT,
  formatInstantJour,
  lienCommande,
  messageAchats,
  nomPersonne,
  peutDemanderAchat,
  tonStatut,
  type Membre,
} from './achats-model';
import { NouvelleDemande } from './commande-formulaire';
import { lireArticlesPreremplis } from './commande-prefill-model';
import {
  FILTRES_COMMANDES,
  natureCommande,
  numeroCommande,
  phraseApprobations,
  requeteCommandes,
  type FiltreCommandes,
} from './commandes-model';
import {
  barresStatutsCommandes,
  blocDevise,
  cartesCommandes,
  compteursCommandes,
  devisesDe,
  noteDeviseAchats,
  tonPastille,
} from './tableau-achats-model';

type Devise = 'CDF' | 'USD';

export function CommandesListe(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { actions, membres, moi } = useAccesAchats();
  const demander = peutDemanderAchat(actions);
  const creation = params.get('nouvelle') === '1';
  const fournisseur = params.get('fournisseur');
  // ADR-0046 — S8 : lignes préremplies depuis le réapprovisionnement des stocks.
  const articles = lireArticlesPreremplis(params.get('articles'));
  const [filtre, setFiltre] = useState<FiltreCommandes>('toutes');
  const [q, setQ] = useState('');
  const [devise, setDevise] = useState<Devise | null>(null);
  const [items, setItems] = useState<PurchaseOrderView[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const { stats, etat, reessayer } = useTableau(() => runStatsApi.orders(), 'commandes');
  const bloc = stats ? blocDevise(stats.byCurrency, devise) : null;
  const compteurs = stats ? compteursCommandes(stats) : null;

  const charger = useCallback((f: FiltreCommandes, cursor: string | null) => {
    purchasesApi
      .listOrders(requeteCommandes(f, cursor))
      .then((p) => {
        setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
        setSuivante(p.nextCursor);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setItems([]);
        setErreur(messageAchats(err, 'Impossible de charger les demandes.'));
      });
  }, []);

  useEffect(() => {
    setItems(null);
    charger(filtre, null);
  }, [filtre, charger]);

  const ouvrir = (oui: boolean) => router.replace(oui ? `${pathname}?nouvelle=1` : pathname);
  const visibles = (items ?? []).filter((o) =>
    contient([o.title, o.supplierName, o.orderNumber, o.requestNumber], q),
  );
  const total = compteurs ? compteurs[filtre] : null;

  return (
    <section aria-labelledby="cmd-titre" className="flex min-w-0 flex-col gap-3.5">
      <EnTeteEcran
        id="cmd-titre"
        titre="Demandes et commandes"
        sousTitre="Une demande d’achat devient bon de commande une fois approuvée."
        action={
          demander ? (
            <button type="button" className={BOUTON_PRINCIPAL} onClick={() => ouvrir(true)}>
              <IconePlus />
              Demander un achat
            </button>
          ) : null
        }
      />

      <TableauChiffres
        etat={etat}
        libelle="Chiffres des demandes et commandes"
        texteErreur="Les chiffres des commandes sont momentanément indisponibles. La liste reste à jour."
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
        cartes={stats && bloc ? cartesCommandes(stats, bloc) : stats ? [] : null}
        vide={
          stats && !bloc
            ? {
                titre: 'Pas encore de demande d’achat',
                texte:
                  'Décrivez un besoin et le devis du fournisseur : le commandé des 12 derniers mois, les commandes ouvertes et le délai d’approbation apparaîtront ici.',
                action: demander
                  ? { href: `${pathname}?nouvelle=1`, label: 'Demander un achat' }
                  : null,
              }
            : null
        }
        courbe={
          bloc
            ? {
                titre: 'Commandé, 12 derniers mois',
                nom: `Commandes approuvées par mois, total TTC, en ${bloc.currency}`,
                mois: bloc.months.map((m) => m.month),
                valeurs: bloc.months.map((m) => nombre(m.amount)),
                serie: 'Commandé',
                unite: bloc.currency,
              }
            : null
        }
        repartition={
          stats
            ? {
                titre: 'Par statut',
                nom: 'Nombre de demandes et de commandes par statut, toutes devises',
                barres: barresStatutsCommandes(stats),
                vide: 'Aucune demande.',
                couleur: 3,
              }
            : null
        }
        note={
          stats && bloc
            ? `${noteDeviseAchats(stats, bloc.currency)} « Commandes ouvertes » : total TTC des commandes approuvées ni closes ni annulées.`
            : null
        }
      />

      <Modal
        open={demander && creation}
        onClose={() => ouvrir(false)}
        title="Demander un achat"
        description="Décrivez le besoin et le devis du fournisseur. La demande part en approbation depuis sa fiche."
        size="lg"
      >
        <NouvelleDemande
          fournisseurInitial={fournisseur}
          articlesInitiaux={articles}
          onCree={(id) => router.push(lienCommande(id))}
        />
      </Modal>

      <div className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-col gap-2 border-b border-[var(--border)] p-2 sm:px-3 lg:flex-row lg:items-center lg:gap-3">
          <OngletsStatut
            options={FILTRES_COMMANDES}
            valeur={filtre}
            compteurs={compteurs}
            onChange={setFiltre}
          />
          <RechercheListe
            id="cmd-q"
            label="Rechercher une demande ou une commande"
            valeur={q}
            onChange={setQ}
            placeholder="Objet, fournisseur, DA… ou BC…"
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
            Chargement des demandes…
          </p>
        ) : visibles.length === 0 ? (
          erreur ? null : (
            <p className="px-4 py-10 text-center text-sm text-[var(--foreground-muted)]">
              {filtre !== 'toutes' || q.trim() !== ''
                ? 'Aucune demande ne correspond à ces critères.'
                : 'Aucune demande d’achat pour l’instant.'}
            </p>
          )
        ) : (
          <>
            <TableauCommandes items={visibles} membres={membres} moi={moi} />
            <ListeTelephone items={visibles} membres={membres} moi={moi} />
          </>
        )}
        {items !== null && items.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--foreground-muted)]">
            <span aria-live="polite">
              {total !== null && !q.trim()
                ? `${items.length.toLocaleString('fr-FR')} sur ${total.toLocaleString('fr-FR')}`
                : `${visibles.length.toLocaleString('fr-FR')} affichée${visibles.length > 1 ? 's' : ''}`}
            </span>
            {suivante ? (
              <button
                type="button"
                className={buttonClasses('secondary', 'sm')}
                onClick={() => charger(filtre, suivante)}
              >
                Afficher plus de demandes
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

interface LignesProps {
  items: readonly PurchaseOrderView[];
  membres: readonly Membre[];
  moi: string | null;
}

function TableauCommandes({ items, membres, moi }: LignesProps): React.ReactElement {
  return (
    <table className="hidden w-full table-fixed border-collapse text-[13px] md:table">
      <caption className="sr-only">Demandes et commandes</caption>
      <colgroup>
        <col className="w-[150px]" />
        <col />
        <col className="w-[150px]" />
        <col className="w-[150px]" />
        <col className="w-[170px]" />
      </colgroup>
      <thead>
        <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-left text-xs font-medium text-[var(--foreground-muted)]">
          <th scope="col" className="px-4 py-[7px] font-medium">
            Numéro
          </th>
          <th scope="col" className="px-2 py-[7px] font-medium">
            Objet et fournisseur
          </th>
          <th scope="col" className="px-2 py-[7px] font-medium">
            Demandé par
          </th>
          <th scope="col" className="px-2 py-[7px] text-right font-medium">
            Total TTC
          </th>
          <th scope="col" className="py-[7px] pl-4 pr-4 font-medium">
            Statut
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((o) => {
          const progression = o.status === 'submitted' ? phraseApprobations(o) : null;
          return (
            <tr
              key={o.id}
              className="relative h-[var(--row-h)] border-b border-[var(--border)] transition-colors duration-[var(--motion-fast)] last:border-b-0 hover:bg-[var(--surface-muted)]"
            >
              <td className="px-4">
                <Link
                  href={lienCommande(o.id)}
                  className="truncate font-mono text-xs after:absolute after:inset-0 after:content-[''] hover:underline"
                  title={natureCommande(o)}
                >
                  {numeroCommande(o)}
                </Link>
              </td>
              <td className="truncate px-2" title={progression ?? undefined}>
                <span className="font-medium">{o.title}</span>
                <span className="text-[var(--foreground-muted)]">
                  {' '}
                  · {o.supplierName ?? 'Fournisseur à choisir'}
                </span>
              </td>
              <td className="truncate px-2 text-[var(--foreground-muted)]">
                {nomPersonne(membres, o.requestedBy, moi)}
              </td>
              <td className="truncate px-2 text-right font-mono tabular-nums">
                {formatMontant(o.totals.total, o.currency)}
              </td>
              <td className="py-1 pl-4 pr-4">
                <StatusPill tone={tonPastille(tonStatut(o.status))}>
                  {LIBELLES_STATUT[o.status]}
                </StatusPill>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ListeTelephone({ items, membres, moi }: LignesProps): React.ReactElement {
  return (
    <ul className="divide-y divide-[var(--border)] md:hidden">
      {items.map((o) => (
        <li key={o.id} className="relative flex flex-col gap-1 px-3 py-2.5">
          <span className="flex items-center justify-between gap-2">
            <Link
              href={lienCommande(o.id)}
              className="truncate font-mono text-xs after:absolute after:inset-0 after:content-['']"
            >
              {numeroCommande(o)}
            </Link>
            <StatusPill tone={tonPastille(tonStatut(o.status))}>
              {LIBELLES_STATUT[o.status]}
            </StatusPill>
          </span>
          <span className="truncate text-sm font-medium">{o.title}</span>
          <span className="flex items-center justify-between gap-2 text-xs text-[var(--foreground-muted)]">
            <span className="truncate">
              {nomPersonne(membres, o.requestedBy, moi)} · {formatInstantJour(o.updatedAt)}
            </span>
            <span className="shrink-0 font-mono text-[13px] text-[var(--foreground)]">
              {formatMontant(o.totals.total, o.currency)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
