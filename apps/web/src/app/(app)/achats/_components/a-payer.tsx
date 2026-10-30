'use client';

// À payer — ADR-0044 § 3.6 et § 8 : échéancier par devise (en retard, bientôt,
// plus tard, litiges à part), paiement en fenêtre modale réparti sur plusieurs
// factures, rattachement d'une dépense déjà saisie et doublons probables.
//
// Les factures sont rangées par les filtres de l'API (`due=overdue`, `due=soon`) ;
// les totaux viennent de l'échéancier du moteur (`GET /purchases/payables`). Une
// route pas encore livrée (404) donne une phrase, jamais un chiffre inventé.

import { Badge } from '@lalanda/ui';
import { AlertTriangle, CalendarClock, Copy } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { PurchaseCurrency } from '@lalanda/shared/purchases';

import {
  purchasesPayablesApi,
  type EcheancierView,
  type PossibleDuplicateView,
  type SupplierInvoiceListItem,
  type SupplierPaymentView,
} from '@/lib/api-purchases-payables';

import { Bandeau, Panneau, PhraseSection, Tuile } from '../../crm/_components/crm-ui';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { useAccesAchats } from './achats-access';
import {
  formatJour,
  lienFacture,
  messageAchats,
  peutPayerFournisseurs,
  statutDe,
} from './achats-model';
import {
  groupesEcheancier,
  phraseDoublon,
  totauxGroupe,
  type GroupeEcheancier,
} from './a-payer-model';
import { FenetrePaiement } from './paiement-formulaire';
import { phraseIndisponible } from './vue-ensemble-model';

type Lu<T> = { ok: true; v: T } | { ok: false; erreur: unknown };

const lire = <T,>(p: Promise<T>): Promise<Lu<T>> =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (erreur: unknown) => ({ ok: false as const, erreur }),
  );

interface APayerDonnees {
  echeancier: Lu<EcheancierView>;
  groupes: GroupeEcheancier[] | null;
  erreurListes: string | null;
  doublons: Lu<{ items: PossibleDuplicateView[] }>;
}

function LigneFacture({
  f,
  payer,
  onPayer,
}: {
  f: SupplierInvoiceListItem;
  payer: boolean;
  onPayer: () => void;
}): React.ReactElement {
  return (
    <li className="relative flex flex-wrap items-center gap-x-3 gap-y-1 py-2 hover:bg-[var(--surface-muted)]">
      <Link
        href={lienFacture(f.id)}
        className="min-w-0 flex-1 font-medium break-words after:absolute after:inset-0"
      >
        {f.supplierName ?? 'Fournisseur'}
        <span className="block text-xs font-normal text-[var(--foreground-muted)]">
          {f.internalNumber} · réf. {f.supplierReference} · échéance {formatJour(f.dueDate)}
        </span>
      </Link>
      <span className="text-sm tabular-nums whitespace-nowrap">
        {formatMontant(f.remaining, f.currency)}
      </span>
      {f.settlementStatus === 'partially_paid' ? <Badge tone="info">Payée en partie</Badge> : null}
      {payer ? (
        <button type="button" className={`${BOUTON_PETIT} relative z-10`} onClick={onPayer}>
          Payer
        </button>
      ) : null}
    </li>
  );
}

export function APayer(): React.ReactElement {
  const { actions, etat } = useAccesAchats();
  const payer = peutPayerFournisseurs(actions);
  const [d, setD] = useState<APayerDonnees | null>(null);
  const [paiement, setPaiement] = useState<{
    supplierId: string;
    currency: PurchaseCurrency;
    invoiceId: string;
  } | null>(null);
  const [fait, setFait] = useState<string | null>(null);

  const charger = useCallback(() => {
    void Promise.all([
      lire(purchasesPayablesApi.getSchedule()),
      lire(purchasesPayablesApi.listInvoices({ due: 'overdue', limit: 100 })),
      lire(purchasesPayablesApi.listInvoices({ due: 'soon', limit: 100 })),
      lire(purchasesPayablesApi.listInvoices({ status: 'validated', limit: 100 })),
      lire(purchasesPayablesApi.listDuplicates()),
    ]).then(([echeancier, retard, bientot, validees, doublons]) => {
      const listesOk = retard.ok && bientot.ok && validees.ok;
      const erreurListe = !retard.ok
        ? retard.erreur
        : !bientot.ok
          ? bientot.erreur
          : !validees.ok
            ? validees.erreur
            : null;
      setD({
        echeancier,
        groupes: listesOk
          ? groupesEcheancier(
              retard.v.items,
              bientot.v.items,
              validees.v.items,
              echeancier.ok ? echeancier.v.dueSoonDays : null,
            )
          : null,
        erreurListes: listesOk ? null : messageAchats(erreurListe, 'Factures illisibles.'),
        doublons,
      });
    });
  }, []);

  useEffect(() => {
    if (etat === 'pret') charger();
  }, [etat, charger]);

  const ech = d?.echeancier.ok ? d.echeancier.v : null;

  function tuile(champ: 'overdue' | 'dueSoon', libelle: string): React.ReactElement {
    if (d === null) return <Tuile libelle={libelle} valeur="…" />;
    if (!d.echeancier.ok) {
      return (
        <Tuile
          libelle={libelle}
          valeur={
            <span className="text-sm font-normal text-[var(--foreground-muted)]">
              {phraseIndisponible(d.echeancier.erreur)}
            </span>
          }
        />
      );
    }
    const lignes = d.echeancier.v.byCurrency
      .filter((c) => c[champ].count > 0)
      .map((c) => `${formatMontant(c[champ].amount, c.currency)} · ${c[champ].count}`);
    return (
      <Tuile
        libelle={libelle}
        attention={champ === 'overdue' && lignes.length > 0}
        valeur={
          lignes.length === 0 ? (
            'Aucune'
          ) : (
            <span className="flex flex-col">
              {lignes.map((l) => (
                <span key={l} className="whitespace-nowrap">
                  {l}
                </span>
              ))}
            </span>
          )
        }
      />
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={CalendarClock}
        titre="À payer"
        sousTitre={
          ech
            ? `Échéancier au ${formatJour(ech.asOf)}, une devise par ligne : rien n’est additionné ni converti.`
            : 'Échéancier des factures validées, une devise par ligne : rien n’est additionné ni converti.'
        }
      >
        <dl className="grid grid-cols-2 gap-3">
          {tuile('overdue', 'En retard')}
          {tuile('dueSoon', ech ? `À payer sous ${ech.dueSoonDays} jours` : 'À payer bientôt')}
        </dl>
        {!payer ? (
          <p className="text-xs text-[var(--foreground-muted)]">
            Enregistrer un paiement est réservé aux rôles qui paient les fournisseurs.
          </p>
        ) : null}
      </Bandeau>

      {fait ? (
        <p
          role="status"
          className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-sm"
        >
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

      {d === null ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement de l’échéancier…
        </p>
      ) : d.erreurListes ? (
        <Alerte>
          <p>{d.erreurListes}</p>
        </Alerte>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(d.groupes ?? []).map((g) => {
            const totaux = totauxGroupe(ech, g.id);
            return (
              <Panneau
                key={g.id}
                titre={g.titre}
                icone={g.attention ? AlertTriangle : CalendarClock}
                id={`ap-${g.id}`}
              >
                {totaux === null ? (
                  <PhraseSection>Totaux du moteur pas encore disponibles.</PhraseSection>
                ) : totaux.length > 0 ? (
                  <ul className="flex flex-col text-sm font-medium tabular-nums">
                    {totaux.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                ) : null}
                {g.parDevise.length === 0 ? (
                  <PhraseSection>{g.vide}</PhraseSection>
                ) : (
                  g.parDevise.map((pd) => (
                    <div key={pd.currency} className="flex flex-col gap-1">
                      <p className="text-xs font-semibold text-[var(--foreground-muted)]">
                        {pd.currency}
                      </p>
                      <ul className="flex flex-col divide-y divide-[var(--border)]">
                        {pd.factures.map((f) => (
                          <LigneFacture
                            key={f.id}
                            f={f}
                            payer={payer && g.id !== 'litiges'}
                            onPayer={() =>
                              setPaiement({
                                supplierId: f.supplierId,
                                currency: f.currency,
                                invoiceId: f.id,
                              })
                            }
                          />
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </Panneau>
            );
          })}
        </div>
      )}

      <Panneau titre="Doublons probables" icone={Copy} id="ap-doublons">
        {d === null ? null : !d.doublons.ok ? (
          <PhraseSection>
            {statutDe(d.doublons.erreur) === 403
              ? 'Les doublons se lisent avec l’accès à la trésorerie.'
              : `${phraseIndisponible(d.doublons.erreur)}.`}
          </PhraseSection>
        ) : d.doublons.v.items.length === 0 ? (
          <PhraseSection>
            Aucune dépense saisie à la main ne ressemble à un paiement fournisseur.
          </PhraseSection>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {d.doublons.v.items.map((x) => (
              <li key={`${x.paymentId}-${x.expenseId}`} className="flex items-start gap-2">
                <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{phraseDoublon(x)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panneau>

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
            charger();
          }}
        />
      ) : null}
    </section>
  );
}
