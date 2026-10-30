'use client';

// Factures fournisseurs — ADR-0044 § 3.5 et § 8 : liste filtrable (brouillons, en
// écart, validées, en retard, en litige) et saisie en fenêtre modale, libre
// (`?nouvelle=1`) ou depuis une commande (`?commande=<id>`, préremplie par l'API).
// Montants et restes à payer : ceux de l'API.

import { Badge, buttonClasses } from '@lalanda/ui';
import { FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { purchasesPayablesApi, type SupplierInvoiceListItem } from '@/lib/api-purchases-payables';

import { Bandeau } from '../../crm/_components/crm-ui';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { useAccesAchats } from './achats-access';
import { formatJour, lienFacture, messageAchats, peutGererAchats } from './achats-model';
import { FenetreFacture } from './facture-formulaire';
import {
  FILTRES_FACTURES,
  LIBELLES_RAPPROCHEMENT,
  etatFacture,
  lireFiltreFactures,
  natureFacture,
  requeteFactures,
  tonRapprochement,
  type FiltreFactures,
} from './factures-model';

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
  const [items, setItems] = useState<SupplierInvoiceListItem[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

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

  useEffect(() => charger(filtre, null), [filtre, charger]);

  const fermer = () => router.replace(pathname);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={FileText}
        titre="Factures fournisseurs"
        sousTitre="Ce que vous devez : chaque facture est rapprochée de sa commande et de ses réceptions avant d’être payée."
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => router.replace(`${pathname}?nouvelle=1`)}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Saisir une facture
            </button>
          ) : null
        }
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les factures">
          {FILTRES_FACTURES.map((f) => (
            <button
              key={f.valeur}
              type="button"
              className={BOUTON_PETIT}
              aria-pressed={filtre === f.valeur}
              onClick={() => setFiltre(f.valeur)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Bandeau>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

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

      {items === null ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement des factures…
        </p>
      ) : items.length === 0 ? (
        erreur ? null : (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
            Aucune facture ne correspond.
          </p>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((f) => {
            const etat = etatFacture(f);
            return (
              <li key={f.id}>
                <Link
                  href={lienFacture(f.id)}
                  className="flex h-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold break-words">
                      {f.supplierName ?? 'Fournisseur'}
                    </span>
                    <Badge tone={etat.ton}>{etat.libelle}</Badge>
                  </span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {natureFacture(f)} {f.internalNumber} · réf. {f.supplierReference}
                  </span>
                  <span className="flex flex-wrap gap-2 text-xs">
                    {f.kind === 'invoice' && f.status !== 'cancelled' ? (
                      <Badge tone={tonRapprochement(f.matchingStatus)}>
                        {LIBELLES_RAPPROCHEMENT[f.matchingStatus]}
                      </Badge>
                    ) : null}
                    {!f.hasAttachment && f.status !== 'cancelled' ? (
                      <Badge tone="neutral">Sans pièce</Badge>
                    ) : null}
                  </span>
                  <span className="flex items-end justify-between gap-2">
                    <strong className="font-display text-lg tabular-nums">
                      {formatMontant(f.total, f.currency)}
                    </strong>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      échéance {formatJour(f.dueDate)}
                    </span>
                  </span>
                  {f.status === 'validated' &&
                  f.kind === 'invoice' &&
                  f.settlementStatus !== 'paid' ? (
                    <span className="text-xs">
                      Reste à payer {formatMontant(f.remaining, f.currency)}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {suivante ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-center`}
          onClick={() => charger(filtre, suivante)}
        >
          Afficher plus de factures
        </button>
      ) : null}
    </section>
  );
}
