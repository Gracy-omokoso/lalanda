'use client';

// Carte « Marge » d'un projet du RUN (ADR-0039 § 5 et § 8, lot L4a).
//
// Lit `GET /work/projects/:id/margin` et AFFICHE ce que rend l'API (moteur
// `computeProjectMargin`) : aucun montant n'est calculé ici. Une ligne par
// devise, jamais de total toutes devises. Étiquetée « TTC » (décision ouverte
// n° 8, recommandation retenue). Sans `treasury.manage`, l'API ne rend pas le
// détail par membre : la carte ne l'affiche pas.
//
// Autonome : ne dépend que de l'identifiant du projet — elle se pose dans
// l'onglet « Marge » (`projets/[id]/marge/page.tsx`) ou n'importe où ailleurs.

import type { ProjectMarginView } from '@lalanda/shared/work';
import { Alert, Badge, Card, Skeleton } from '@lalanda/ui';
import { useCallback, useEffect, useState } from 'react';

import { workBillingApi } from '@/lib/work-billing-api';

import {
  MARGE_EXPLICATION,
  MARGE_TITRE,
  constats,
  duree,
  lignesDevise,
  messageErreur,
  montantSigne,
} from './marge-model';
import { formatMontant } from '../../../ventes/_components/sales-model';

export function CarteMarge({ projectId }: { projectId: string }): React.ReactElement {
  const [vue, setVue] = useState<ProjectMarginView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setErreur(null);
    try {
      setVue(await workBillingApi.margin(projectId));
    } catch (err) {
      setVue(null);
      setErreur(messageErreur(err, 'La marge du projet n’a pas pu être calculée.'));
    }
  }, [projectId]);

  useEffect(() => {
    void charger();
  }, [charger]);

  return (
    <Card as="section" className="flex flex-col gap-4 p-4 sm:p-6" aria-labelledby="marge-titre">
      <header className="flex flex-col gap-1">
        <h2 id="marge-titre" className="text-base font-semibold">
          {MARGE_TITRE}
        </h2>
        <p className="text-sm text-[var(--foreground-muted)]">{MARGE_EXPLICATION}</p>
      </header>

      {erreur ? (
        <Alert tone="danger" title="Marge indisponible">
          {erreur}
        </Alert>
      ) : vue === null ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          {vue.currencies.length === 0 ? (
            <p className="text-sm">
              Rien à compter pour l’instant : aucun encaissement, aucune dépense rattachée, aucun
              temps valorisé.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {vue.currencies.map((c) => (
                <div
                  key={c.currency}
                  className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-4"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{c.currency}</span>
                    <Badge tone="neutral">TTC</Badge>
                  </div>
                  <dl className="flex flex-col gap-1 text-sm">
                    {lignesDevise(c).map((l) => (
                      <div key={l.libelle} className="flex justify-between gap-4">
                        <dt className="text-[var(--foreground-muted)]">{l.libelle}</dt>
                        <dd className="tabular-nums">{l.valeur}</dd>
                      </div>
                    ))}
                    <div className="mt-1 flex justify-between gap-4 border-t border-[var(--border)] pt-2 font-semibold">
                      <dt>Marge encaissée</dt>
                      <dd className="tabular-nums">{montantSigne(c.margin, c.currency)}</dd>
                    </div>
                  </dl>
                  <p className="text-xs text-[var(--foreground-muted)]">
                    Pour information : facturé hors taxes{' '}
                    {montantSigne(c.invoicedExclTax, c.currency)} ({c.invoiceCount} facture(s)
                    émise(s), {c.expenseCount} dépense(s)) — jamais soustrait.
                  </p>
                </div>
              ))}
            </div>
          )}

          {vue.byMember && vue.byMember.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Coût du temps par membre</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {vue.byMember.map((m) => (
                  <li key={`${m.user.userId}-${m.currency}`} className="flex justify-between gap-4">
                    <span>
                      {m.user.name} — {duree(m.minutes)}
                    </span>
                    <span className="tabular-nums">{formatMontant(m.cost, m.currency)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <ul className="flex flex-col gap-2">
            {constats(vue).map((c) => (
              <li key={c.code}>
                <Alert tone={c.ton === 'attention' ? 'warning' : 'info'}>{c.texte}</Alert>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--foreground-muted)]">
            Recalculée à chaque ouverture (version {vue.version}). Elle n’alimente ni le réalisé ni
            le plan.
          </p>
        </>
      )}
    </Card>
  );
}
