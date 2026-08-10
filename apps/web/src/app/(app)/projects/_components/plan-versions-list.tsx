'use client';

// Liste des plans validés figés (S16c) — extraite de `project-plan.tsx` (S23a).
//
// Un plan validé est immuable et versionné : ses exports ne rejouent aucun
// calcul, ils rendent les chiffres tels qu'ils ont été figés. À ne pas
// confondre avec les exports du haut de l'écran, qui portent sur le brouillon
// courant.

import type { PlanSummaryView } from '@/lib/api';

export function PlanVersionsList({
  plans,
  onDownload,
}: {
  plans: PlanSummaryView[];
  onDownload: (version: number, kind: 'pdf' | 'xlsx') => Promise<void>;
}): React.ReactElement | null {
  if (plans.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
        Plans validés
      </h3>
      <ul className="flex flex-col gap-1.5">
        {plans.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <span className="fig font-semibold">v{p.version}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  p.status === 'approved'
                    ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'bg-[var(--border)] text-[var(--foreground-muted)]'
                }`}
              >
                {p.status === 'approved' ? 'Validé' : 'Remplacé'}
              </span>
              <span className="text-xs text-[var(--foreground-muted)]">
                {new Date(p.approvedAt).toLocaleDateString('fr-FR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onDownload(p.version, 'pdf')}
                title={`Télécharger le PDF figé du plan v${p.version} (aucun recalcul)`}
                className="rounded border border-[var(--border)] px-2 py-1 text-xs transition hover:bg-[var(--surface-muted)]"
              >
                PDF
              </button>
              <button
                type="button"
                onClick={() => void onDownload(p.version, 'xlsx')}
                title={`Télécharger l'Excel figé du plan v${p.version} (aucun recalcul)`}
                className="rounded border border-[var(--border)] px-2 py-1 text-xs transition hover:bg-[var(--surface-muted)]"
              >
                Excel
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
