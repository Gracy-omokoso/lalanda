'use client';

// À payer — ADR-0044 § 3.6 et § 8 ; refonte ADR-0071 sur le modèle des écrans
// Factures, Devis et Encaissements :
//
//   en-tête compact
//   cartes de chiffres et graphiques (`GET /purchases/payables/stats`)
//   liste : onglets (en retard, bientôt, plus tard, en litige) avec compteurs,
//   recherche, tableau dense avec « Payer », liste compacte sur téléphone
//   doublons probables
//
// Les factures sont rangées par les filtres de l'API (`due=overdue`, `due=soon`),
// jamais par une date comparée ici ; les chiffres viennent du moteur. Paiement en
// fenêtre modale réparti sur plusieurs factures, rattachement d'une dépense déjà
// saisie : inchangés.

import { StatusPill } from '@lalanda/ui';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { PurchaseCurrency } from '@lalanda/shared/purchases';

import {
  BOUTON_LIGNE,
  CARTE,
  EnTeteEcran,
  OngletsStatut,
  RechercheListe,
  SelecteurDevise,
} from '@/components/tableau-de-bord/briques';
import { contient, nombre } from '@/components/tableau-de-bord/format';
import { TableauChiffres } from '@/components/tableau-de-bord/tableau';
import { useTableau } from '@/components/tableau-de-bord/use-tableau';
import {
  purchasesPayablesApi,
  type PurchaseDuplicatesView,
  type SupplierInvoiceListItem,
  type SupplierPaymentView,
} from '@/lib/api-purchases-payables';
import { runStatsApi } from '@/lib/api-run-stats';

import { Alerte } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { useAccesAchats } from './achats-access';
import {
  formatJour,
  lienFacture,
  messageAchats,
  peutPayerFournisseurs,
  statutDe,
} from './achats-model';
import { groupesEcheancier, phraseDoublon, type GroupeEcheancier } from './a-payer-model';
import { FenetrePaiement } from './paiement-formulaire';
import {
  barresAnciennete,
  blocDevise,
  cartesAPayer,
  compteursAPayer,
  devisesDe,
  noteDeviseAchats,
  ongletsAPayer,
  type OngletAPayer,
} from './tableau-achats-model';
import { phraseIndisponible } from './vue-ensemble-model';

type Lu<T> = { ok: true; v: T } | { ok: false; erreur: unknown };

const lire = <T,>(p: Promise<T>): Promise<Lu<T>> =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (erreur: unknown) => ({ ok: false as const, erreur }),
  );

interface Listes {
  groupes: GroupeEcheancier[] | null;
  erreur: string | null;
  doublons: Lu<PurchaseDuplicatesView>;
}

type Devise = 'CDF' | 'USD';

export function APayer(): React.ReactElement {
  const { actions, etat: acces } = useAccesAchats();
  const payer = peutPayerFournisseurs(actions);
  const [listes, setListes] = useState<Listes | null>(null);
  const [onglet, setOnglet] = useState<OngletAPayer>('en-retard');
  const [q, setQ] = useState('');
  const [devise, setDevise] = useState<Devise | null>(null);
  const [version, setVersion] = useState(0);
  const [paiement, setPaiement] = useState<{
    supplierId: string;
    currency: PurchaseCurrency;
    invoiceId: string;
  } | null>(null);
  const [fait, setFait] = useState<string | null>(null);

  const { stats, etat, reessayer } = useTableau(() => runStatsApi.payables(), `a-payer-${version}`);
  const bloc = stats ? blocDevise(stats.byCurrency, devise) : null;
  const compteurs = stats ? compteursAPayer(stats) : null;

  const charger = useCallback(() => {
    void Promise.all([
      lire(purchasesPayablesApi.listInvoices({ due: 'overdue', limit: 100 })),
      lire(purchasesPayablesApi.listInvoices({ due: 'soon', limit: 100 })),
      lire(purchasesPayablesApi.listInvoices({ status: 'validated', limit: 100 })),
      lire(purchasesPayablesApi.listDuplicates()),
      lire(purchasesPayablesApi.getSchedule()),
    ]).then(([retard, bientot, validees, doublons, echeancier]) => {
      const ok = retard.ok && bientot.ok && validees.ok;
      const err = !retard.ok
        ? retard.erreur
        : !bientot.ok
          ? bientot.erreur
          : !validees.ok
            ? validees.erreur
            : null;
      setListes({
        groupes: ok
          ? groupesEcheancier(
              retard.v.items,
              bientot.v.items,
              validees.v.items,
              echeancier.ok ? echeancier.v.dueSoonDays : null,
            )
          : null,
        erreur: ok ? null : messageAchats(err, 'Factures illisibles.'),
        doublons,
      });
    });
  }, []);

  useEffect(() => {
    if (acces === 'pret') charger();
  }, [acces, charger, version]);

  const groupe = listes?.groupes?.find((g) => g.id === onglet) ?? null;
  const factures = (groupe?.parDevise ?? [])
    .flatMap((pd) => pd.factures)
    .filter((f) => contient([f.supplierName, f.internalNumber, f.supplierReference], q));
  const payable = payer && onglet !== 'litiges';
  const ouvrirPaiement = (f: SupplierInvoiceListItem) =>
    setPaiement({ supplierId: f.supplierId, currency: f.currency, invoiceId: f.id });

  return (
    <section aria-labelledby="ap-titre" className="flex min-w-0 flex-col gap-3.5">
      <EnTeteEcran
        id="ap-titre"
        titre="À payer"
        sousTitre={
          stats
            ? `Échéancier au ${formatJour(stats.asOf)}, une devise à la fois.`
            : 'Échéancier des factures validées, une devise à la fois.'
        }
        detail="Rien n’est additionné ni converti entre devises ; les litiges sont tenus à part."
      />

      <TableauChiffres
        etat={etat}
        libelle="Chiffres des dettes fournisseurs"
        texteErreur="Les chiffres des dettes fournisseurs sont momentanément indisponibles. La liste reste à jour."
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
        cartes={stats && bloc ? cartesAPayer(stats, bloc) : stats ? [] : null}
        vide={
          stats && !bloc
            ? {
                titre: 'Rien à payer',
                texte:
                  'Aucune facture validée n’attend de paiement. Le dû, l’échu, les échéances des 30 prochains jours et le délai moyen de paiement apparaîtront ici.',
              }
            : null
        }
        courbe={
          bloc
            ? {
                titre: 'Payé, 12 derniers mois',
                nom: `Payé aux fournisseurs par mois, en ${bloc.currency}`,
                mois: bloc.months.map((m) => m.month),
                valeurs: bloc.months.map((m) => nombre(m.amount)),
                serie: 'Payé',
                unite: bloc.currency,
                couleur: 2,
              }
            : null
        }
        repartition={
          bloc
            ? {
                titre: 'Ancienneté du dû',
                nom: `Dû aux fournisseurs par ancienneté, hors litiges, en ${bloc.currency}`,
                barres: barresAnciennete(bloc),
                vide: 'Aucune facture ouverte hors litige.',
                couleur: 4,
              }
            : null
        }
        note={stats && bloc ? noteDeviseAchats(stats, bloc.currency) : null}
      />

      {!payer ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Enregistrer un paiement est réservé aux rôles qui paient les fournisseurs.
        </p>
      ) : null}

      {fait ? (
        <p role="status" className={`${CARTE} p-3 text-sm`}>
          {fait}{' '}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => setFait(null)}
          >
            Fermer
          </button>
        </p>
      ) : null}

      <div className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-col gap-2 border-b border-[var(--border)] p-2 sm:px-3 lg:flex-row lg:items-center lg:gap-3">
          <OngletsStatut
            options={ongletsAPayer(stats)}
            valeur={onglet}
            compteurs={compteurs}
            onChange={setOnglet}
          />
          <RechercheListe
            id="ap-q"
            label="Rechercher une facture à payer"
            valeur={q}
            onChange={setQ}
            placeholder="Fournisseur, FF… ou référence"
          />
        </div>
        {listes === null ? (
          <p className="px-4 py-6 text-sm text-[var(--foreground-muted)]" aria-live="polite">
            Chargement de l’échéancier…
          </p>
        ) : listes.erreur ? (
          <div className="p-3">
            <Alerte>
              <p>{listes.erreur}</p>
            </Alerte>
          </div>
        ) : factures.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[var(--foreground-muted)]">
            {q.trim() !== '' ? 'Aucune facture ne correspond.' : (groupe?.vide ?? 'Rien ici.')}
          </p>
        ) : (
          <>
            <TableauAPayer items={factures} payer={payable} onPayer={ouvrirPaiement} />
            <ListeTelephone items={factures} payer={payable} onPayer={ouvrirPaiement} />
          </>
        )}
      </div>

      <section aria-labelledby="ap-doublons" className={`${CARTE} flex flex-col gap-2 px-4 py-3.5`}>
        <h2 id="ap-doublons" className="text-[13px] font-semibold">
          Doublons probables
        </h2>
        {listes === null ? null : !listes.doublons.ok ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            {statutDe(listes.doublons.erreur) === 403
              ? 'Les doublons se lisent avec l’accès à la trésorerie.'
              : `${phraseIndisponible(listes.doublons.erreur)}.`}
          </p>
        ) : listes.doublons.v.duplicates.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Aucune dépense saisie à la main ne ressemble à un paiement fournisseur.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {listes.doublons.v.duplicates.map((x) => (
              <li key={`${x.paymentId}-${x.expenseId}`} className="flex items-start gap-2">
                <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{phraseDoublon(x)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {paiement ? (
        <FenetrePaiement
          supplierId={paiement.supplierId}
          currency={paiement.currency}
          preselection={[paiement.invoiceId]}
          onFermer={() => setPaiement(null)}
          onPaye={(p: SupplierPaymentView, mode) => {
            setPaiement(null);
            setFait(
              mode === 'rattachement'
                ? `Dépense rattachée : paiement ${p.number} enregistré, sans nouvelle dépense.`
                : `Paiement ${p.number} enregistré ; les dépenses correspondantes sont créées dans la trésorerie.`,
            );
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
    </section>
  );
}

interface LignesProps {
  items: readonly SupplierInvoiceListItem[];
  payer: boolean;
  onPayer: (f: SupplierInvoiceListItem) => void;
}

function pastille(f: SupplierInvoiceListItem): React.ReactElement {
  if (f.disputed) return <StatusPill tone="late">En litige</StatusPill>;
  if (f.settlementStatus === 'partially_paid')
    return <StatusPill tone="open">Payée en partie</StatusPill>;
  return <StatusPill tone="wait">À payer</StatusPill>;
}

function TableauAPayer({ items, payer, onPayer }: LignesProps): React.ReactElement {
  return (
    <table className="hidden w-full table-fixed border-collapse text-[13px] md:table">
      <caption className="sr-only">Factures à payer</caption>
      <colgroup>
        <col className="w-[140px]" />
        <col />
        <col className="w-[104px]" />
        <col className="w-[160px]" />
        <col className="w-[150px]" />
        <col className="w-[92px]" />
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
            Reste à payer
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
        {items.map((f) => (
          <tr
            key={f.id}
            className="relative h-[var(--row-h)] border-b border-[var(--border)] transition-colors duration-[var(--motion-fast)] last:border-b-0 hover:bg-[var(--surface-muted)]"
          >
            <td className="px-4">
              <Link
                href={lienFacture(f.id)}
                className="truncate font-mono text-xs after:absolute after:inset-0 after:content-[''] hover:underline"
              >
                {f.internalNumber}
              </Link>
            </td>
            <td className="truncate px-2">
              <span className="font-medium">{f.supplierName ?? 'Fournisseur'}</span>
              <span className="text-[var(--foreground-muted)]"> · réf. {f.supplierReference}</span>
            </td>
            <td className="px-2 text-[var(--foreground-muted)]">{formatJour(f.dueDate)}</td>
            <td className="truncate px-2 text-right font-mono tabular-nums">
              {formatMontant(f.remaining, f.currency)}
            </td>
            <td className="py-1 pl-4 pr-2">{pastille(f)}</td>
            <td className="px-4 text-right">
              {payer && !f.disputed ? (
                <button type="button" className={BOUTON_LIGNE} onClick={() => onPayer(f)}>
                  Payer
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ListeTelephone({ items, payer, onPayer }: LignesProps): React.ReactElement {
  return (
    <ul className="divide-y divide-[var(--border)] md:hidden">
      {items.map((f) => (
        <li key={f.id} className="relative flex items-start gap-3 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-center justify-between gap-2">
              <Link
                href={lienFacture(f.id)}
                className="truncate font-mono text-xs after:absolute after:inset-0 after:content-['']"
              >
                {f.internalNumber}
              </Link>
              {pastille(f)}
            </span>
            <span className="truncate text-sm font-medium">{f.supplierName ?? 'Fournisseur'}</span>
            <span className="flex items-center justify-between gap-2 text-xs text-[var(--foreground-muted)]">
              <span className="truncate">Échéance {formatJour(f.dueDate)}</span>
              <span className="shrink-0 font-mono text-[13px] text-[var(--foreground)]">
                {formatMontant(f.remaining, f.currency)}
              </span>
            </span>
          </div>
          {payer && !f.disputed ? (
            <button type="button" className={`${BOUTON_LIGNE} mt-6`} onClick={() => onPayer(f)}>
              Payer
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
