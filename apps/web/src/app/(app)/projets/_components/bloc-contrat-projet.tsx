'use client';

// Bloc « Contrat » de l'aperçu d'un projet — ADR-0077 § 1.7.
//
// Visible avec `sales.read` (route `GET /work/projects/:id/contract`) ; rien sinon, ni si
// le projet ne suit aucun contrat. Aucun montant : le contrat fait foi, on l'ouvre.

import type { WorkProjectContractView } from '@lalanda/shared/work';
import { Card } from '@lalanda/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { workSyncApi } from '@/lib/work-sync-api';

import { useShell } from '../../_components/shell-context';
import { formatJour } from './projets-model';

const FACTURATION: Record<WorkProjectContractView['billingKind'], string> = {
  none: 'Sans facturation prévue',
  schedule: 'Échéancier',
  recurring: 'Abonnement',
};

const STATUTS: Record<string, string> = {
  signed: 'Signé',
  terminated: 'Résilié',
  cancelled: 'Annulé',
};

/** Ligne de facturation : « Échéancier · 3 échéances », sans montant. */
export function facturationContrat(c: WorkProjectContractView): string {
  if (c.billingKind !== 'schedule') return FACTURATION[c.billingKind];
  return `${FACTURATION.schedule} · ${c.scheduleItemCount} échéance${c.scheduleItemCount > 1 ? 's' : ''}`;
}

export function BlocContratProjet({ projectId }: { projectId: string }): React.ReactElement | null {
  const { actions } = useShell();
  const lire = actions?.includes('sales.read') ?? false;
  const [contrat, setContrat] = useState<WorkProjectContractView | null>(null);

  useEffect(() => {
    if (!lire) return;
    let actif = true;
    workSyncApi
      .contractOfProject(projectId)
      .then((r) => {
        if (actif) setContrat(r.contract);
      })
      .catch(() => {
        if (actif) setContrat(null);
      });
    return () => {
      actif = false;
    };
  }, [projectId, lire]);

  if (!lire || contrat === null) return null;
  return (
    <Card as="section" className="flex min-w-0 flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">Contrat</h2>
      <Link
        href={`/ventes/contrats/${encodeURIComponent(contrat.contractId)}`}
        className="text-sm font-medium text-[var(--accent)] underline-offset-2 hover:underline"
      >
        {contrat.number} — {contrat.title}
      </Link>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-[var(--foreground-muted)]">Statut</dt>
        <dd>{STATUTS[contrat.status] ?? contrat.status}</dd>
        <dt className="text-[var(--foreground-muted)]">Client</dt>
        <dd className="break-words">{contrat.customerName}</dd>
        <dt className="text-[var(--foreground-muted)]">Début</dt>
        <dd>
          {contrat.startDate ? formatJour(contrat.startDate) : '—'}
          {contrat.initialTermMonths ? ` · ${contrat.initialTermMonths} mois` : ''}
        </dd>
        <dt className="text-[var(--foreground-muted)]">Facturation</dt>
        <dd>{facturationContrat(contrat)}</dd>
      </dl>
      {contrat.billingKind !== 'none' ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          La facturation passe par le contrat : les jalons ne préparent pas de facture.
        </p>
      ) : null}
    </Card>
  );
}
