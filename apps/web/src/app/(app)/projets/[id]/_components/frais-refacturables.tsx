'use client';

// Frais refacturables sur la fiche projet — ADR-0051 § 7.3 et § 10 (lot H16, branché par
// le lot H14).
//
// Lit `GET /work/projects/:id/rebillable-expenses` (lot H14) et AFFICHE les lignes de frais
// marquées « à refacturer », imputées au projet et remboursées (ou soldées par une
// avance) : libellé « Frais NF… — {libellé} », jamais le nom du collaborateur (décision
// ouverte n° 10), montant rendu par l'API, jamais additionné ici. Aucune facture n'est
// créée : refacturer reste un geste de l'utilisateur. Les frais remboursés imputés au
// projet entrent déjà dans la marge par leur dépense de remboursement.

import type { WorkRebillableExpensesView } from '@lalanda/shared/hr';
import { Alert, Skeleton } from '@lalanda/ui';
import { useCallback, useEffect, useState } from 'react';

import { workBillingApi } from '@/lib/work-billing-api';

import { messageErreur } from '../../_components/marge/marge-model';
import { formatMontant } from '../../../ventes/_components/sales-model';

export const PHRASE_REFACTURABLES =
  'Frais du personnel marqués « à refacturer » sur ce projet, déjà remboursés. Ils comptent déjà dans la marge ci-dessus ; aucune facture n’est jamais créée seule : reprenez-les dans une facture si le client doit les payer.';

export const PHRASE_REFACTURABLES_VIDE = 'Aucun frais remboursé n’est marqué « à refacturer ».';

export function FraisRefacturables({ projectId }: { projectId: string }): React.ReactElement {
  const [vue, setVue] = useState<WorkRebillableExpensesView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setErreur(null);
    try {
      setVue(await workBillingApi.rebillableExpenses(projectId));
    } catch (err) {
      setVue(null);
      setErreur(messageErreur(err, 'Les frais à refacturer n’ont pas pu être lus.'));
    }
  }, [projectId]);

  useEffect(() => {
    void charger();
  }, [charger]);

  return (
    <section
      aria-labelledby="frais-refacturables"
      className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] p-4 sm:p-5"
    >
      <h3 id="frais-refacturables" className="text-sm font-semibold">
        Frais à refacturer
      </h3>
      <p className="text-sm text-[var(--foreground-muted)]">{PHRASE_REFACTURABLES}</p>
      {erreur ? (
        <Alert tone="danger" title="Frais indisponibles">
          {erreur}
        </Alert>
      ) : vue === null ? (
        <Skeleton className="h-16 w-full" />
      ) : vue.items.length === 0 ? (
        <p className="text-sm">{PHRASE_REFACTURABLES_VIDE}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
          {vue.items.map((l) => (
            <li key={l.key} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between">
              <span className="min-w-0 break-words">
                {l.label}
                <span className="block text-xs text-[var(--foreground-muted)]">
                  {l.spentOn}
                  {l.merchant ? ` · ${l.merchant}` : ''}
                </span>
              </span>
              <span className="tabular-nums">{formatMontant(l.amount, l.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      {vue?.truncated ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Liste bornée : la suite n’est pas affichée.
        </p>
      ) : null}
    </section>
  );
}
