'use client';

// Fiche fournisseur : consultants rattachés, leurs projets et leur temps valorisé au taux
// d'achat — ADR-0078 § 2.4. Base de la facture fournisseur (récapitulatif mois × projet,
// exportable en CSV) ; aucune pièce comptable n'est créée. Visible avec `work.read` ET
// `purchase.read` (droits de la route) ; le serveur calcule tout (moteur).

import type { SupplierConsultantsView } from '@lalanda/shared/work';
import { Alert, StatusPill, buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { duree, libelleFermeture } from '@/lib/externes-model';
import { workExternalApi } from '@/lib/work-external-api';

import { useAccesAchats } from './achats-access';

export function ConsultantsFournisseur({
  supplierId,
}: {
  supplierId: string;
}): React.ReactElement | null {
  const { actions } = useAccesAchats();
  const visible =
    actions !== null && actions.includes('work.read') && actions.includes('purchase.read');
  const [vue, setVue] = useState<SupplierConsultantsView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let annule = false;
    workExternalApi
      .supplierConsultants(supplierId)
      .then((v) => {
        if (!annule) setVue(v);
      })
      .catch(() => {
        if (!annule) setErreur('Les consultants de ce fournisseur sont illisibles.');
      });
    return () => {
      annule = true;
    };
  }, [supplierId, visible]);

  if (!visible) return null;
  if (erreur) return <Alert tone="danger">{erreur}</Alert>;
  if (!vue || vue.consultants.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div>
        <h2 className="text-base font-semibold">Consultants et temps valorisé</h2>
        <p className="text-xs text-[var(--foreground-muted)]">
          Temps saisi par les consultants de ce fournisseur, au taux d’achat en vigueur au jour
          travaillé. Base de la facture fournisseur : rien n’est comptabilisé automatiquement.
        </p>
      </div>
      {vue.consultants.map((c) => (
        <div
          key={c.account.id}
          className="flex flex-col gap-2 border-t border-[var(--border)] pt-3"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{c.account.name}</span>
            <span className="text-xs text-[var(--foreground-muted)]">{c.account.email}</span>
            <StatusPill tone={c.account.status === 'active' ? 'ok' : 'draft'}>
              {c.account.status === 'active'
                ? 'Accès ouvert'
                : libelleFermeture(c.account.closedReason)}
            </StatusPill>
            <a
              href={workExternalApi.recapCsvUrl(c.account.id)}
              className={buttonClasses('secondary', 'sm')}
            >
              Exporter le récapitulatif (CSV)
            </a>
          </div>
          <p className="text-xs text-[var(--foreground-muted)]">
            Projets :{' '}
            {c.projects.length === 0
              ? '—'
              : c.projects.map((p, i) => (
                  <span key={p.projectId}>
                    {i > 0 ? ', ' : ''}
                    <Link
                      href={`/projets/${p.projectId}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {p.projectName || 'Projet'}
                    </Link>
                    {p.status === 'closed' ? ' (fermé)' : ''}
                  </span>
                ))}
          </p>
          {c.recap.rows.length === 0 ? (
            <p className="text-sm text-[var(--foreground-muted)]">Aucun temps saisi.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--foreground-muted)]">
                  <th className="py-1 font-medium">Mois</th>
                  <th className="py-1 font-medium">Projet</th>
                  <th className="py-1 text-right font-medium">Temps</th>
                  <th className="py-1 text-right font-medium">Montant HT</th>
                </tr>
              </thead>
              <tbody>
                {c.recap.rows.map((r) => (
                  <tr key={`${r.period}-${r.projectId}-${r.currency ?? '-'}`}>
                    <td className="py-1">{r.period}</td>
                    <td className="py-1">{r.projectName}</td>
                    <td className="py-1 text-right tabular-nums">{duree(r.minutes)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {r.amount && r.currency ? `${r.amount} ${r.currency}` : 'sans taux'}
                    </td>
                  </tr>
                ))}
                {c.recap.totals.map((t) => (
                  <tr key={t.currency} className="font-semibold">
                    <td className="py-1" colSpan={2}>
                      Total {t.currency}
                    </td>
                    <td className="py-1 text-right tabular-nums">{duree(t.minutes)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {t.amount} {t.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {c.recap.minutesWithoutRate > 0 ? (
            <Alert tone="warning">
              {duree(c.recap.minutesWithoutRate)} sans taux d’achat : posez le taux du consultant
              pour les valoriser.
            </Alert>
          ) : null}
        </div>
      ))}
    </section>
  );
}
