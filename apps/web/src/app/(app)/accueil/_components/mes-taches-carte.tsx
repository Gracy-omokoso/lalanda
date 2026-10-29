'use client';

// Carte « Mes tâches » de l'Accueil (ADR-0039 § 6.5) : en retard, du jour,
// cinq premières, lien vers « Mes tâches ». Alimentée par `GET /work/my-tasks`.
// Le parent ne la monte qu'avec `work.read` (`carteVisible`).

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { workApi } from '@/lib/work-api';

import { MES_TACHES_HREF, carteMesTaches, type CarteMesTaches } from './mes-taches-model';

export function MesTachesCarte({
  organizationId,
}: {
  organizationId: string | null;
}): React.ReactElement {
  // `undefined` : chargement ; `null` : lecture impossible.
  const [carte, setCarte] = useState<CarteMesTaches | null | undefined>(undefined);

  useEffect(() => {
    let annule = false;
    setCarte(undefined);
    workApi.myTasks().then(
      (vue) => {
        if (!annule) setCarte(carteMesTaches(vue));
      },
      () => {
        if (!annule) setCarte(null);
      },
    );
    return () => {
      annule = true;
    };
  }, [organizationId]);

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Mes tâches</h3>
        <Link
          href={MES_TACHES_HREF}
          className="text-sm font-medium text-[var(--accent)] underline-offset-2 hover:underline"
        >
          Ouvrir Mes tâches
        </Link>
      </div>
      {carte === undefined ? (
        <span aria-hidden="true" className="h-12 rounded bg-[var(--surface-muted)]" />
      ) : carte === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Vos tâches n’ont pas pu être lues pour l’instant. Ouvrez « Mes tâches » pour réessayer.
        </p>
      ) : (
        <>
          <p className="text-sm">
            <span
              className={`font-mono font-semibold tabular-nums ${carte.enRetard > 0 ? 'text-[var(--danger)]' : ''}`}
            >
              {carte.enRetard}
            </span>{' '}
            <span className="text-[var(--foreground-muted)]">en retard</span>
            <span aria-hidden="true" className="text-[var(--foreground-muted)]">
              {' · '}
            </span>
            <span className="font-mono font-semibold tabular-nums">{carte.aujourdhui}</span>{' '}
            <span className="text-[var(--foreground-muted)]">pour aujourd’hui</span>
          </p>
          {carte.lignes.length === 0 ? (
            <p className="text-sm text-[var(--foreground-muted)]">
              Rien en retard ni prévu pour aujourd’hui.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {carte.lignes.map((l) => (
                <li key={l.id}>
                  <Link
                    href={l.lien}
                    className="flex flex-col rounded-[var(--radius-md)] px-2 py-1.5 transition hover:bg-[var(--surface-muted)]"
                  >
                    <span className="truncate text-sm font-medium">{l.titre}</span>
                    <span className="truncate text-xs text-[var(--foreground-muted)]">
                      <span className={l.enRetard ? 'font-medium text-[var(--danger)]' : ''}>
                        {l.echeance}
                      </span>
                      {l.projet ? ` · ${l.projet}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {carte.autres > 0 ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Et {carte.autres} autre{carte.autres > 1 ? 's' : ''} dans « Mes tâches ».
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
