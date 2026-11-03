// Graphiques maison en SVG (ADR-0055 § 5, ADR-0056) : mini-courbe, courbe/aire,
// anneau et barres horizontales. Aucune bibliothèque (connexions lentes en RDC).
//
// Règles communes :
// - couleurs par les jetons `--chart-1..6` et `--chart-grid` seulement ;
// - la couleur n'est jamais seule : une légende écrit le nom de chaque série ;
// - équivalent accessible : un tableau masqué visuellement (`sr-only`) porte
//   toutes les valeurs ; le dessin est `aria-hidden` ;
// - mouvement sobre : tracé révélé ou fondu en `--motion-slow` (240 ms) au plus,
//   coupé sous `prefers-reduced-motion` (`charts.css` et règle globale). Jamais de
//   chiffre qui compte, d'apparition au défilement ni de rebond ;
// - infobulle au survol : CSS seulement (aucun état, rendu serveur possible).
//
// Les valeurs sont des nombres D'AFFICHAGE calculés par le serveur ; les libellés
// formatés (`display`) sont fournis par l'écran.

import { cn } from '../utils.js';
import {
  areaPath,
  barWidths,
  chartColor,
  donutSegments,
  linePath,
  niceScale,
  plotPoints,
  sparklinePoints,
  yOf,
  type ChartColor,
} from '../charts-geometry.js';

// ─── Mini-courbe ──────────────────────────────────────────────────────────

export function Sparkline({
  values,
  color = 1,
  width = 84,
  height = 32,
  label,
  className,
}: {
  values: readonly number[];
  color?: ChartColor;
  width?: number;
  height?: number;
  /** Nom accessible ; absent, la mini-courbe est décorative (la valeur est écrite à côté). */
  label?: string;
  className?: string;
}): React.ReactElement {
  const pts = sparklinePoints(values, width, height, 3);
  const last = pts[pts.length - 1];
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('chart-reveal shrink-0 overflow-visible', className)}
      data-points={pts.length}
      {...a11y}
    >
      {pts.length > 1 ? (
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={chartColor(color)}
          strokeWidth={1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {last ? <circle cx={last.x} cy={last.y} r={2.5} fill={chartColor(color)} /> : null}
    </svg>
  );
}

// ─── Courbe / aire ────────────────────────────────────────────────────────

export interface LineSeries {
  id: string;
  label: string;
  values: readonly number[];
  color: ChartColor;
  /** `area` : ligne pleine et aire légère ; `dashed` : tiretée ; `line` : pleine. */
  variant?: 'area' | 'line' | 'dashed';
}

function LegendSwatch({ s }: { s: LineSeries }): React.ReactElement {
  return s.variant === 'dashed' ? (
    <span
      aria-hidden="true"
      className="inline-block w-3 border-t-2 border-dashed"
      style={{ borderColor: chartColor(s.color) }}
    />
  ) : (
    <span
      aria-hidden="true"
      className="inline-block h-[3px] w-3 rounded-full"
      style={{ background: chartColor(s.color) }}
    />
  );
}

/** Légende écrite des séries (la couleur n'est jamais seule). */
export function ChartLegend({
  series,
  className,
}: {
  series: readonly LineSeries[];
  className?: string;
}): React.ReactElement {
  return (
    <ul
      className={cn(
        'flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-[var(--foreground-muted)]',
        className,
      )}
    >
      {series.map((s) => (
        <li key={s.id} className="inline-flex items-center gap-1.5">
          <LegendSwatch s={s} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Courbes sur des catégories (mois). Le dessin s'étire en largeur (traits non
 * déformés) ; les graduations, les libellés et le point final sont en HTML pour
 * rester lisibles sur téléphone.
 */
export function LineChart({
  title,
  labels,
  fullLabels,
  series,
  formatValue,
  formatTick = formatValue,
  height = 180,
  endLabelSeriesId,
  emptyText = 'Aucune donnée sur la période.',
  className,
}: {
  /** Nom du graphique : légende du tableau accessible. */
  title: string;
  /** Libellés courts sous l'axe (un par valeur). */
  labels: readonly string[];
  /** Libellés complets (infobulle, tableau) ; défaut : `labels`. */
  fullLabels?: readonly string[];
  series: readonly LineSeries[];
  formatValue: (value: number) => string;
  formatTick?: (value: number) => string;
  height?: number;
  /** Série dont la dernière valeur est écrite au bout de la courbe. */
  endLabelSeriesId?: string;
  emptyText?: string;
  className?: string;
}): React.ReactElement {
  const n = labels.length;
  const full = fullLabels ?? labels;
  if (n === 0 || series.length === 0) {
    return (
      <p
        className={cn(
          'flex items-center justify-center text-xs text-[var(--foreground-muted)]',
          className,
        )}
        style={{ height }}
      >
        {emptyText}
      </p>
    );
  }
  const scale = niceScale(series.flatMap((s) => s.values.slice(0, n)));
  const zero = yOf(0, scale);
  const endSeries = series.find((s) => s.id === endLabelSeriesId) ?? null;
  const endPoint = endSeries ? plotPoints(endSeries.values.slice(0, n), scale).at(-1) : undefined;
  const endValue = endSeries?.values[n - 1];

  return (
    <div className={cn('flex flex-col', className)}>
      <div aria-hidden="true" className="flex">
        {/* Graduations */}
        <div className="relative w-11 shrink-0" style={{ height }}>
          {scale.ticks.map((t) => (
            <span
              key={t}
              className="absolute right-2 -translate-y-1/2 font-mono text-[10px] leading-none text-[var(--foreground-muted)]"
              style={{ top: `${yOf(t, scale)}%` }}
            >
              {formatTick(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="chart-reveal absolute inset-0 h-full w-full overflow-visible"
          >
            {scale.ticks.map((t) => (
              <line
                key={t}
                x1={0}
                x2={100}
                y1={yOf(t, scale)}
                y2={yOf(t, scale)}
                stroke={t === 0 ? 'var(--border-strong)' : 'var(--chart-grid)'}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {series.map((s) => {
              const pts = plotPoints(s.values.slice(0, n), scale);
              return (
                <g key={s.id}>
                  {s.variant === 'area' ? (
                    <path d={areaPath(pts, zero)} fill={chartColor(s.color)} fillOpacity={0.12} />
                  ) : null}
                  <path
                    d={linePath(pts)}
                    fill="none"
                    stroke={chartColor(s.color)}
                    strokeWidth={s.variant === 'dashed' ? 1.8 : 2.2}
                    strokeDasharray={s.variant === 'dashed' ? '5 4' : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </svg>
          {endPoint && endSeries && endValue !== undefined ? (
            <>
              <span
                className="chart-fade absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[var(--surface)]"
                style={{
                  left: `${endPoint.x}%`,
                  top: `${endPoint.y}%`,
                  borderColor: chartColor(endSeries.color),
                }}
              />
              <span
                className="chart-fade absolute -translate-x-full -translate-y-full whitespace-nowrap pb-1.5 pr-1 font-mono text-[11px] font-semibold text-[var(--foreground)]"
                style={{ left: `${endPoint.x}%`, top: `${endPoint.y}%` }}
              >
                {formatTick(endValue)}
              </span>
            </>
          ) : null}
          {/* Infobulle au survol : une bande par catégorie, CSS seulement. */}
          <div className="absolute inset-0 flex">
            {labels.map((l, i) => (
              <div key={`${l}-${i}`} className="group relative h-full flex-1">
                <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)] opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100" />
                <span
                  className={cn(
                    'pointer-events-none absolute top-0 z-10 flex min-w-36 flex-col gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs opacity-0 shadow-[var(--shadow-pop)] transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100',
                    i >= n / 2 ? 'right-1/2 mr-2' : 'left-1/2 ml-2',
                  )}
                >
                  <span className="font-semibold">{full[i]}</span>
                  {series.map((s) => (
                    <span key={s.id} className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 text-[var(--foreground-muted)]">
                        <LegendSwatch s={s} />
                        {s.label}
                      </span>
                      <span className="font-mono">{formatValue(s.values[i] ?? 0)}</span>
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="ml-11 grid font-mono text-[10px] text-[var(--foreground-muted)]"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {labels.map((l, i) => (
          <span key={`${l}-${i}`} className="truncate pt-1 text-center">
            {l}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Période</th>
            {series.map((s) => (
              <th key={s.id} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {full.map((l, i) => (
            <tr key={`${l}-${i}`}>
              <th scope="row">{l}</th>
              {series.map((s) => (
                <td key={s.id}>{formatValue(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Anneau ───────────────────────────────────────────────────────────────

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color: ChartColor;
}

/** Anneau et sa légende chiffrée. Le total au centre est fourni (déjà calculé). */
export function DonutChart({
  title,
  slices,
  total,
  totalLabel,
  size = 120,
  hideEmpty = false,
  className,
}: {
  title: string;
  slices: readonly DonutSlice[];
  /** Texte du centre (ex. « 42 »). */
  total: string;
  /** Sous le total (ex. « documents »). */
  totalLabel: string;
  size?: number;
  /** Masque de la légende les parts à zéro. */
  hideEmpty?: boolean;
  className?: string;
}): React.ReactElement {
  const segments = donutSegments(slices.map((s) => s.value));
  const shown = slices.filter((s) => !hideEmpty || s.value > 0);
  const stroke = 16;
  const radius = 50 - stroke / 2;
  return (
    <div className={cn('flex flex-wrap items-center gap-4', className)}>
      <div aria-hidden="true" className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="chart-fade h-full w-full -rotate-90">
          <circle
            cx={50}
            cy={50}
            r={radius}
            fill="none"
            stroke="var(--chart-grid)"
            strokeWidth={stroke}
          />
          {slices.map((s, i) => {
            const seg = segments[i]!;
            if (seg.length === 0) return null;
            return (
              <circle
                key={s.id}
                cx={50}
                cy={50}
                r={radius}
                fill="none"
                stroke={chartColor(s.color)}
                strokeWidth={stroke}
                pathLength={100}
                strokeDasharray={`${seg.length} ${100 - seg.length}`}
                strokeDashoffset={-seg.offset}
              />
            );
          })}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
          <span className="font-mono text-xl font-medium">{total}</span>
          <span className="text-[11px] text-[var(--foreground-muted)]">{totalLabel}</span>
        </span>
      </div>
      <ul aria-hidden="true" className="flex min-w-[8.5rem] flex-1 flex-col gap-1.5 text-xs">
        {shown.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: chartColor(s.color) }}
            />
            <span className="truncate">{s.label}</span>
            <span className="ml-auto pl-1.5 font-mono text-[var(--foreground-muted)]">
              {s.value}
            </span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{`${title} : ${total} ${totalLabel}`}</caption>
        <tbody>
          {slices.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.label}</th>
              <td>{s.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Barres horizontales ──────────────────────────────────────────────────

export interface BarItem {
  id: string;
  label: string;
  value: number;
  /** Valeur formatée, écrite à droite. */
  display: string;
}

/** Classement en barres horizontales (une liste : lisible telle quelle). */
export function BarList({
  title,
  items,
  color = 1,
  emptyText = 'Aucune donnée sur la période.',
  className,
}: {
  title: string;
  items: readonly BarItem[];
  color?: ChartColor;
  emptyText?: string;
  className?: string;
}): React.ReactElement {
  if (items.length === 0) {
    return <p className={cn('text-xs text-[var(--foreground-muted)]', className)}>{emptyText}</p>;
  }
  const widths = barWidths(items.map((i) => i.value));
  return (
    <ol aria-label={title} className={cn('flex flex-col gap-2.5', className)}>
      {items.map((item, i) => (
        <li key={item.id} className="flex flex-col gap-1">
          <span className="flex justify-between gap-2 text-xs">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 font-mono text-[var(--foreground-muted)]">
              {item.display}
            </span>
          </span>
          <span aria-hidden="true" className="block h-1.5 rounded-full bg-[var(--surface-muted)]">
            <span
              className="chart-grow block h-1.5 rounded-full"
              style={{ width: `${widths[i]}%`, background: chartColor(color) }}
            />
          </span>
        </li>
      ))}
    </ol>
  );
}
