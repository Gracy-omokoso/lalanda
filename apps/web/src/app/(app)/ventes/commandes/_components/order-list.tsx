'use client';

// Liste des commandes clients — ADR-0050 § 9, lot V7. Lecture `sales.read` ; « + Commande »
// (`sales.contract`) ouvre une fenêtre modale. Cartes entièrement cliquables.

import { buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  salesContractsApi,
  type SalesOrderStatus,
  type SalesOrderSummary,
} from '@/lib/api-sales-contracts';

import { Alerte, BOUTON, CHAMP, Pastille } from '../../_components/form-ui';
import { formatMontant } from '../../_components/sales-model';
import { useAccesVentes } from '../../_components/sales-access';
import { formatJour } from '../../devis/_components/quote-model';
import {
  COMMANDES_BASE,
  messageEngagement,
  peutPreparerEngagement,
} from '../../contrats/_components/contract-model';

import { FenetreCommande } from './order-form';
import { FILTRES_COMMANDES, tonCommande } from './order-model';

export function OrderList(): React.ReactElement {
  const router = useRouter();
  const { actions } = useAccesVentes();
  const preparer = peutPreparerEngagement(actions);
  const [statut, setStatut] = useState<SalesOrderStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SalesOrderSummary[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nouvelle, setNouvelle] = useState(false);

  useEffect(() => {
    let annule = false;
    const t = setTimeout(() => {
      salesContractsApi
        .listOrders({ status: statut, limit: 50, ...(q.trim() ? { q: q.trim() } : {}) })
        .then((p) => {
          if (annule) return;
          setItems(p.items);
          setSuivante(p.nextCursor);
          setErreur(null);
        })
        .catch((err) => {
          if (!annule) setErreur(messageEngagement(err, 'Impossible de charger les commandes.'));
        });
    }, 200);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [statut, q]);

  async function plus(): Promise<void> {
    if (!suivante) return;
    try {
      const p = await salesContractsApi.listOrders({
        status: statut,
        limit: 50,
        cursor: suivante,
        ...(q.trim() ? { q: q.trim() } : {}),
      });
      setItems((x) => [...(x ?? []), ...p.items]);
      setSuivante(p.nextCursor);
    } catch (err) {
      setErreur(messageEngagement(err, 'Impossible de charger la suite.'));
    }
  }

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Commandes clients</h2>
          <p className="max-w-3xl text-sm text-[var(--foreground-muted)] max-sm:sr-only">
            Ce que vos clients vous commandent, avec leur propre référence. Lalanda suit ce qui
            reste à facturer ligne par ligne ; chaque facture est préparée en brouillon, puis émise
            depuis l’écran des factures.
          </p>
        </div>
        {preparer ? (
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            aria-haspopup="dialog"
            onClick={() => setNouvelle(true)}
          >
            + Commande
          </button>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          type="search"
          aria-label="Rechercher une commande"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Numéro CC…, client ou référence"
          maxLength={100}
          className={CHAMP}
        />
        <select
          aria-label="Statut"
          value={statut}
          onChange={(e) => setStatut(e.target.value as SalesOrderStatus | 'all')}
          className={CHAMP}
        >
          {FILTRES_COMMANDES.map((f) => (
            <option key={f.valeur} value={f.valeur}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {items === null ? (
        erreur ? null : (
          <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
            Chargement des commandes…
          </p>
        )
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--foreground-muted)]">
          Aucune commande. Une commande naît d’un devis accepté, ou se saisit ici.
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                href={`${COMMANDES_BASE}/${encodeURIComponent(c.id)}`}
                className="flex h-full flex-col gap-2 rounded-xl border border-[var(--border)] p-4 transition hover:border-[var(--accent)]"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{c.number}</span>
                  <Pastille ton={tonCommande(c.status, c.invoicingStatus)}>
                    {c.statusLabel}
                  </Pastille>
                  {c.invoicingLabel && c.status !== 'draft' ? (
                    <Pastille ton="neutre">{c.invoicingLabel}</Pastille>
                  ) : null}
                </span>
                <span className="text-sm">{c.customerName ?? 'Client'}</span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  Commandée le {formatJour(c.orderedOn)}
                  {c.customerReference ? ` · réf. client ${c.customerReference}` : ''}
                </span>
                <span className="mt-auto font-mono text-sm">
                  {c.total ? formatMontant(c.total, c.currency) : 'Calcul indisponible'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {suivante ? (
        <button type="button" onClick={() => void plus()} className={`${BOUTON} self-center`}>
          Afficher plus de commandes
        </button>
      ) : null}
      {nouvelle ? (
        <FenetreCommande
          vue={null}
          onFermer={() => setNouvelle(false)}
          onEnregistre={(v) => router.push(`${COMMANDES_BASE}/${encodeURIComponent(v.id)}`)}
        />
      ) : null}
    </section>
  );
}
