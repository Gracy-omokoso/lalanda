'use client';

// Cartes de chiffres et graphiques de l'écran Factures (ADR-0056), sur la
// réponse de `GET /sales/invoices/stats`. Aucun calcul ici : mise en forme
// (`invoice-dashboard-model.ts`) et composants SVG maison de `@lalanda/ui`.

import {
  BarList,
  ChartLegend,
  DonutChart,
  LineChart,
  Sparkline,
  type LineSeries,
} from '@lalanda/ui';

import type { InvoiceStats } from '@/lib/api';

import {
  cartesChiffres,
  compact,
  moisCourt,
  moisLong,
  noteDevise,
  noteExclusions,
  nombre,
  tranchesStatut,
} from './invoice-dashboard-model';

const CARTE = 'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]';

export type EtatTableau = 'chargement' | 'pret' | 'erreur';

export function InvoiceDashboard({
  stats,
  etat,
  onReessayer,
}: {
  stats: InvoiceStats | null;
  etat: EtatTableau;
  onReessayer: () => void;
}): React.ReactElement {
  if (etat === 'erreur') {
    return (
      <div
        className={`${CARTE} flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm`}
      >
        <p className="text-[var(--foreground-muted)]">
          Les chiffres des factures sont momentanément indisponibles. La liste reste à jour.
        </p>
        <button
          type="button"
          onClick={onReessayer}
          className="h-8 rounded-[var(--radius-md)] border border-[var(--border-strong)] px-3 text-[13px] font-medium transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-muted)]"
        >
          Réessayer
        </button>
      </div>
    );
  }
  if (etat === 'chargement' || stats === null) return <Squelette />;

  const cartes = cartesChiffres(stats);
  const vide = stats.statusCounts.final === 0;
  const exclusions = noteExclusions(stats);

  const series: LineSeries[] = [
    {
      id: 'encaisse',
      label: 'Encaissé',
      values: stats.months.map((m) => nombre(m.collected)),
      color: 1,
      variant: 'area',
    },
    {
      id: 'facture',
      label: 'Facturé',
      values: stats.months.map((m) => nombre(m.billed)),
      color: 2,
      variant: 'dashed',
    },
  ];

  return (
    <section aria-label="Chiffres des factures" className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        {cartes.map((c) => (
          <li
            key={c.id}
            className={`${CARTE} flex items-end justify-between gap-2 px-3 py-2.5 sm:px-3.5 sm:py-3`}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-[var(--foreground-muted)]">{c.label}</span>
              <span
                className={`truncate font-mono text-[15px] font-medium tabular-nums sm:text-lg ${c.ton === 'alerte' ? 'text-[var(--danger)]' : ''}`}
              >
                {c.valeur}
              </span>
              <span className="truncate text-xs text-[var(--foreground-muted)]">{c.note}</span>
            </span>
            {/* Téléphone : deux cartes par ligne, la valeur d'abord (la tendance
                reste lue dans le tableau du graphique). */}
            <Sparkline
              values={c.serie}
              color={c.couleur}
              label={c.tendance}
              width={72}
              className="max-sm:hidden"
            />
          </li>
        ))}
      </ul>

      {vide ? (
        <div className={`${CARTE} flex flex-col items-center gap-1 px-4 py-8 text-center text-sm`}>
          <p className="font-medium">Pas encore de facture émise</p>
          <p className="max-w-md text-[var(--foreground-muted)]">
            Les courbes du facturé et de l’encaissé, la répartition par statut et vos meilleurs
            clients apparaîtront dès la première facture émise ou normalisée.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className={`${CARTE} flex flex-col gap-2 px-4 py-3.5`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-[13px] font-semibold">Facturé et encaissé, 12 derniers mois</h2>
              <ChartLegend series={series} />
            </div>
            <LineChart
              title={`Facturé et encaissé par mois, de ${moisLong(stats.from)} à ${moisLong(stats.to)}, en ${stats.currency}`}
              labels={stats.months.map((m) => moisCourt(m.month))}
              fullLabels={stats.months.map((m) => moisLong(m.month))}
              series={series}
              formatValue={(v) => `${compact(v)} ${stats.currency}`}
              formatTick={compact}
              endLabelSeriesId="encaisse"
              height={164}
            />
          </div>

          <div className={`${CARTE} flex flex-col gap-3 px-4 py-3.5`}>
            <h2 className="text-[13px] font-semibold">Documents par statut</h2>
            <DonutChart
              title="Répartition des documents par statut"
              slices={tranchesStatut(stats)}
              total={stats.statusCounts.all.toLocaleString('fr-FR')}
              totalLabel={stats.statusCounts.all > 1 ? 'documents' : 'document'}
              hideEmpty
            />
          </div>

          <div className={`${CARTE} flex flex-col gap-2.5 px-4 py-3.5`}>
            <h2 className="text-[13px] font-semibold">Meilleurs clients, 12 mois</h2>
            <BarList
              title={`Meilleurs clients par montant facturé sur 12 mois, en ${stats.currency}`}
              items={stats.topCustomers.map((c) => ({
                id: c.key,
                label: c.name,
                value: nombre(c.billed),
                display: compact(nombre(c.billed)),
              }))}
              emptyText="Aucun client facturé sur la période."
            />
          </div>
        </div>
      )}

      <p className="text-xs text-[var(--foreground-muted)]">
        {noteDevise(stats)}
        {exclusions ? ` ${exclusions[0]!.toUpperCase()}${exclusions.slice(1)}` : ''}
      </p>
    </section>
  );
}

/** Chargement : les blocs gardent la place des cartes (aucun saut de mise en page). */
function Squelette(): React.ReactElement {
  const bloc = 'rounded-[var(--radius-sm)] bg-[var(--surface-muted)]';
  return (
    <section
      aria-busy="true"
      aria-label="Chargement des chiffres des factures"
      className="flex flex-col gap-3"
    >
      <ul className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className={`${CARTE} flex h-[78px] flex-col justify-center gap-2 px-3.5`}>
            <span className={`${bloc} h-3 w-24`} />
            <span className={`${bloc} h-4 w-36`} />
          </li>
        ))}
      </ul>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${CARTE} h-[238px] px-4 py-3.5`}>
            <span className={`${bloc} block h-3 w-40`} />
          </div>
        ))}
      </div>
    </section>
  );
}
