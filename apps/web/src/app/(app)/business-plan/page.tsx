'use client';

// `/business-plan` — entrée BUILD « Business plan » (ADR-0037 § 9) : les projets
// de l'organisation et l'état de leur document narratif. L'édition se fait dans
// l'onglet « Business plan » de chaque projet.

import { Badge, EmptyState, PageHeader } from '@lalanda/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { businessPlanApi, type BusinessPlanOverviewItem } from '@/lib/business-plan-api';

export default function BusinessPlanOverviewPage(): React.ReactElement {
  const [items, setItems] = useState<BusinessPlanOverviewItem[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    businessPlanApi
      .overview()
      .then((r) => setItems(r.projects))
      .catch((err: unknown) =>
        setErreur(err instanceof Error ? err.message : 'Impossible de charger les business plans.'),
      );
  }, []);

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        module="build"
        title="Business plan"
        description="Le document narratif de chaque initiative : votre texte, les chiffres du plan financier validé, et une aide IA qui ne cite que vos données."
      />
      {erreur ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {erreur}
        </p>
      ) : items === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="Aucune initiative"
          description="Créez d’abord un plan financier : son business plan s’y rattache."
          action={
            <Link className="text-sm font-medium underline" href="/initiatives">
              Initiatives
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((p) => (
            <li
              key={p.projectId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-4"
            >
              <div className="flex flex-col gap-1">
                <Link
                  href={`/initiatives/${p.projectId}/business-plan`}
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  {p.projectName}
                </Link>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {p.filledSections} / {p.totalSections} sections renseignées —{' '}
                  {p.planVersion !== null
                    ? `plan financier v${p.planVersion} rattaché`
                    : 'aucun plan figé rattaché'}
                </span>
              </div>
              {p.lastValidated ? (
                <Badge tone="success">Validé v{p.lastValidated.version}</Badge>
              ) : (
                <Badge tone="neutral">Brouillon</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
