'use client';

// Liste des devis — ADR-0035 § 5. Lecture : `sales.read` ; création : `sales.quote` (ADR-0040 § 4.1).

import { buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { crmApi, type QuoteStatus, type QuoteSummary } from '@/lib/api-crm';

import { BoutonApercu } from '../../_components/apercu-document';
import { Alerte, BOUTON, BOUTON_PETIT, CHAMP, Pastille } from '../../_components/form-ui';
import { formatMontant } from '../../_components/sales-model';
import { useAccesVentes } from '../../_components/sales-access';

import {
  DEVIS_BASE,
  FILTRES_DEVIS,
  QUOTE_STATUS_LABELS,
  formatJour,
  messageDevis,
  peutPreparerDevis,
  tonDevis,
} from './quote-model';

export function QuoteList(): React.ReactElement {
  const { actions } = useAccesVentes();
  const gerer = peutPreparerDevis(actions);
  const [statut, setStatut] = useState<QuoteStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<QuoteSummary[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    const t = setTimeout(() => {
      crmApi
        .listQuotes({ status: statut, limit: 50, ...(q.trim() ? { q: q.trim() } : {}) })
        .then((p) => {
          if (annule) return;
          setItems(p.items);
          setSuivante(p.nextCursor);
          setErreur(null);
        })
        .catch((err) => {
          if (!annule) setErreur(messageDevis(err, 'Impossible de charger les devis.'));
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
      const p = await crmApi.listQuotes({ status: statut, limit: 50, cursor: suivante });
      setItems((x) => [...(x ?? []), ...p.items]);
      setSuivante(p.nextCursor);
    } catch (err) {
      setErreur(messageDevis(err, 'Impossible de charger la suite.'));
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)] max-sm:sr-only">
          Un devis propose des prix sans valoir facture. Une fois accepté, il se convertit en
          brouillon de facture, qui suit ensuite son propre circuit (émission ou normalisation DGI).
        </p>
        {gerer ? (
          <Link href={`${DEVIS_BASE}/nouveau`} className={buttonClasses('primary', 'md')}>
            Nouveau devis
          </Link>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          type="search"
          aria-label="Rechercher un devis"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Numéro DV…, client ou objet"
          maxLength={100}
          className={CHAMP}
        />
        <select
          aria-label="Statut"
          value={statut}
          onChange={(e) => setStatut(e.target.value as QuoteStatus | 'all')}
          className={CHAMP}
        >
          {FILTRES_DEVIS.map((f) => (
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
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement des devis…
        </p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--foreground-muted)]">
          Aucun devis.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {items.map((d) => (
            <li key={d.id} className="flex flex-col sm:flex-row sm:items-start">
              <Link
                href={`${DEVIS_BASE}/${encodeURIComponent(d.id)}`}
                className="flex min-w-0 flex-1 flex-col gap-1 p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <span className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{d.number}</span>
                    <span className="text-xs text-[var(--foreground-muted)]">v{d.version}</span>
                    <Pastille ton={tonDevis(d.status)}>{QUOTE_STATUS_LABELS[d.status]}</Pastille>
                  </span>
                  <span className="text-sm">{d.customerName ?? 'Client sans fiche'}</span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {d.title ? `${d.title} · ` : ''}valable jusqu’au {formatJour(d.validUntil)}
                  </span>
                </span>
                <span className="font-mono text-sm">
                  {d.total ? formatMontant(d.total, d.currency) : 'Calcul indisponible'}
                </span>
              </Link>
              <div className="px-4 pb-4 sm:py-4 sm:pl-0">
                <BoutonApercu
                  className={BOUTON_PETIT}
                  document={{
                    genre: 'devis',
                    id: d.id,
                    titre: `Devis ${d.number} (v${d.version})`,
                    nomFichier: `${d.number}-v${d.version}.pdf`,
                    peutEnvoyer: gerer,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {suivante ? (
        <button type="button" onClick={() => void plus()} className={`${BOUTON} self-center`}>
          Afficher plus de devis
        </button>
      ) : null}
    </section>
  );
}
