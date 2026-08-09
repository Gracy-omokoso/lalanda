'use client';

// Bandeau ratios sticky (S13d) — visible en permanence en haut du panneau résultats.
// N'affiche que les lignes de la feuille `ratios` qui portent un seuil (feu tricolore).
// Un clic sur une pastille bascule l'onglet actif vers `ratios`.

import type { LineResult } from '@/lib/api';

import { LienAideRatios } from './aide-contextuelle';

/** Couleurs des feux tricolores — tokens globaux (globals.css), thème-aware. */
const STATUT_DOT: Record<'vert' | 'orange' | 'rouge', string> = {
  vert: 'var(--ok)',
  orange: 'var(--warn)',
  rouge: 'var(--ko)',
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
  /** Cible d'aide (S22d). Omise, aucun lien n'est rendu. */
  hrefAide?: string;
}

export function RatiosStickyBanner({
  lines,
  currency,
  onSelect,
  hrefAide,
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
            <span className="fig font-semibold text-[var(--foreground)]">
              {formatValue(line.value, line.format, currency)}
            </span>
          </button>
        );
      })}
      {hrefAide ? <LienAideRatios href={hrefAide} /> : null}
    </div>
  );
}
