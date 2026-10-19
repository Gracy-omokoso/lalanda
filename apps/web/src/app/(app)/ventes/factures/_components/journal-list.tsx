'use client';

// Journal électronique des documents de vente (ADR-0023 § S25e.12) : une entrée
// par transition, chaînée par empreinte. Si le chaînage est rompu
// (`chainValid: false`), l'écran le dit en tête : une entrée a été altérée ou
// supprimée.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type JournalEntryView } from '@/lib/api';

import { Alerte, BOUTON } from '../../_components/form-ui';
import { estRefus, formatDate, formatMontant } from '../../_components/sales-model';

import {
  FACTURES_BASE,
  formatTauxChange,
  JOURNAL_EVENT_LABELS,
  messageFacture,
  NATURE_LABELS,
  TYPE_LABELS,
} from './invoice-model';

export function JournalList(): React.ReactElement {
  const [items, setItems] = useState<JournalEntryView[]>([]);
  const [curseur, setCurseur] = useState<string | null>(null);
  const [chaineValide, setChaineValide] = useState(true);
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'erreur' | 'refus'>('chargement');
  const [erreur, setErreur] = useState<string | null>(null);
  const [suite, setSuite] = useState(false);
  const premier = useRef(true);

  const charger = useCallback((cursor: string | null): void => {
    if (cursor) setSuite(true);
    else setEtat('chargement');
    api
      .listJournal({ limit: 100, ...(cursor ? { cursor } : {}) })
      .then((p) => {
        setItems((avant) => (cursor ? [...avant, ...p.items] : p.items));
        setCurseur(p.nextCursor);
        setChaineValide((v) => (cursor ? v && p.chainValid : p.chainValid));
        setEtat('pret');
      })
      .catch((err: unknown) => {
        setErreur(messageFacture(err, 'Impossible de charger le journal.'));
        if (!cursor) setEtat(estRefus(err) ? 'refus' : 'erreur');
      })
      .finally(() => setSuite(false));
  }, []);

  useEffect(() => {
    if (!premier.current) return;
    premier.current = false;
    charger(null);
  }, [charger]);

  return (
    <section aria-labelledby="journal-titre" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href={FACTURES_BASE} className="text-sm text-[var(--foreground-muted)] underline">
          ← Documents de vente
        </Link>
        <h2 id="journal-titre" className="font-display text-lg font-bold tracking-tight">
          Journal électronique
        </h2>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Chaque émission, normalisation ou reprise y est inscrite, dans l’ordre, sans trou. Chaque
          entrée scelle la précédente : une modification ou une suppression se verrait.
        </p>
      </div>

      {etat === 'chargement' ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement du journal…
        </p>
      ) : etat === 'refus' ? (
        <p className="text-sm text-[var(--foreground-muted)]">{erreur}</p>
      ) : etat === 'erreur' ? (
        <Alerte
          action={
            <button
              type="button"
              className={`${BOUTON} text-[var(--foreground)]`}
              onClick={() => charger(null)}
            >
              Réessayer
            </button>
          }
        >
          <p>{erreur}</p>
        </Alerte>
      ) : (
        <>
          {chaineValide ? (
            <p className="text-sm" aria-live="polite">
              Chaînage vérifié par le serveur : intact.
            </p>
          ) : (
            <Alerte>
              <p>
                Le chaînage du journal est rompu : une entrée a été modifiée ou supprimée. Prévenez
                le Propriétaire de l’organisation et le support.
              </p>
            </Alerte>
          )}
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--foreground-muted)]">
              Aucune entrée pour l’instant : le journal commence à la première émission ou
              normalisation.
            </div>
          ) : (
            <ol className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
              {items.map((e) => (
                <li key={e.seq} className="flex flex-col gap-1 p-4 text-sm">
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-xs text-[var(--foreground-muted)]">
                      n° {e.seq}
                    </span>
                    <span className="font-medium">{JOURNAL_EVENT_LABELS[e.event]}</span>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {formatDate(e.at)}
                    </span>
                  </p>
                  <p>
                    {e.invoiceId ? (
                      <Link
                        className="font-mono underline"
                        href={`${FACTURES_BASE}/${encodeURIComponent(e.invoiceId)}`}
                      >
                        {e.number ?? e.proformaRef ?? 'document'}
                      </Link>
                    ) : null}
                    {e.type ? ` · ${TYPE_LABELS[e.type]}` : ''}
                    {e.creditNature ? ` · ${NATURE_LABELS[e.creditNature].court}` : ''}
                    {e.originNumber ? ` · sur la facture n° ${e.originNumber}` : ''}
                  </p>
                  {e.documentTotals ? (
                    <p className="text-xs text-[var(--foreground-muted)]">
                      Total du document :{' '}
                      {formatMontant(e.documentTotals.total, e.documentTotals.currency)}
                      {e.normalizedTotals
                        ? ` · normalisé : ${formatMontant(e.normalizedTotals.total, 'CDF')}`
                        : ''}
                      {e.conversion && e.conversion.rate !== '1'
                        ? ` · ${formatTauxChange(e.conversion.rate)}`
                        : ''}
                    </p>
                  ) : null}
                  {e.codeDefDgi ? (
                    <p className="break-all font-mono text-xs">Code DEF/DGI : {e.codeDefDgi}</p>
                  ) : null}
                  <p className="text-xs text-[var(--foreground-muted)]">
                    {e.actor ? `Par ${e.actor.name}` : 'Par le système'} · empreinte{' '}
                    <span className="font-mono">{e.hash.slice(0, 12)}…</span>
                  </p>
                </li>
              ))}
            </ol>
          )}
          {curseur ? (
            <button
              type="button"
              className={`${BOUTON} self-center`}
              disabled={suite}
              onClick={() => charger(curseur)}
            >
              {suite ? 'Chargement…' : 'Afficher la suite'}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
