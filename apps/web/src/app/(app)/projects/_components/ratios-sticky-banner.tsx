'use client';

// Bandeau ratios sticky (S13d) — visible en permanence en haut du panneau résultats.
// N'affiche que les lignes de la feuille `ratios` qui portent un seuil (feu tricolore).
// Un clic sur une pastille bascule l'onglet actif vers `ratios`.

import type { LineResult } from '@/lib/api';

/** Couleurs des feux tricolores — cohérentes avec RatiosCard. */
const STATUT_DOT: Record<'vert' | 'orange' | 'rouge', string> = {
  vert: '#16a34a',
  orange: '#ea580c',
  rouge: '#dc2626',
};

function formatValue(
  value: number,
  format: LineResult['format'],
  currency: string = 'USD',
): string {
  if (format === 'percent') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'percent',
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (format === 'money') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
}

interface RatiosStickyBannerProps {
  lines: LineResult[];
  currency: string;
  onSelect?: () => void;
}

export function RatiosStickyBanner({
  lines,
  currency,
  onSelect,
}: RatiosStickyBannerProps): React.ReactElement | null {
  const withSeuil = lines.filter((l) => l.seuil);
  if (withSeuil.length === 0) return null;

  return (
    <div
      className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-[var(--border)] bg-[var(--surface)]/95 px-3 py-2 backdrop-blur"
      role="region"
      aria-label="Ratios bancaires — feux tricolores"
    >
      {withSeuil.map((line) => {
        const color = line.seuil ? STATUT_DOT[line.seuil.statut] : STATUT_DOT.vert;
        return (
          <button
            key={line.lineId}
            type="button"
            onClick={onSelect}
            title={
              line.seuil
                ? `Seuil ${line.seuil.direction === 'min' ? '≥' : '≤'} ${formatValue(line.seuil.valeur, line.format, currency)}`
                : undefined
            }
            className="flex items-center gap-2 rounded-md px-1.5 py-0.5 text-xs transition hover:bg-[var(--surface-muted)]"
          >
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="font-medium text-[var(--foreground)]">{line.label}</span>
            <span className="font-semibold tabular-nums text-[var(--foreground)]">
              {formatValue(line.value, line.format, currency)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
