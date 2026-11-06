'use client';

// Cartes de chiffres et graphiques de l'écran Devis (ADR-0067), sur la réponse de
// `GET /sales/quotes/stats`. Aucun calcul ici : mise en forme
// (`quote-dashboard-model.ts`) et composants SVG maison de `@lalanda/ui`.

import { ChartLegend, DonutChart, LineChart, type LineSeries } from '@lalanda/ui';

import type { QuoteStats } from '@/lib/api';

import {
  CARTE,
  CartesChiffres,
  EtatVide,
  ErreurTableau,
  SqueletteTableau,
  type EtatTableau,
} from '../../_components/dashboard-ui';
import { moisCourt, moisLong } from '../../factures/_components/invoice-dashboard-model';

import { DEVIS_BASE } from './quote-model';
import { cartesDevis, noteDevisesDevis, tranchesStatutDevis } from './quote-dashboard-model';

const GRILLE = 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]';

export function QuoteDashboard({
  stats,
  etat,
  gerer,
  onReessayer,
}: {
  stats: QuoteStats | null;
  etat: EtatTableau;
  gerer: boolean;
  onReessayer: () => void;
}): React.ReactElement {
  if (etat === 'erreur') {
    return (
      <ErreurTableau
        texte="Les chiffres des devis sont momentanément indisponibles. La liste reste à jour."
        onReessayer={onReessayer}
      />
    );
  }
  if (etat === 'chargement' || stats === null) {
    return <SqueletteTableau label="Chargement des chiffres des devis" graphiques={GRILLE} />;
  }

  const series: LineSeries[] = [
    {
      id: 'acceptes',
      label: 'Acceptés',
      values: stats.months.map((m) => m.accepted),
      color: 1,
      variant: 'area',
    },
    {
      id: 'emis',
      label: 'Émis',
      values: stats.months.map((m) => m.sent),
      color: 2,
      variant: 'dashed',
    },
  ];
  const n = stats.statusCounts.all;

  return (
    <section aria-label="Chiffres des devis" className="flex flex-col gap-3">
      <CartesChiffres cartes={cartesDevis(stats)} />

      {n === 0 ? (
        <EtatVide
          titre="Pas encore de devis"
          texte="Proposez vos prix sans émettre de facture : le devis s’envoie au client, puis se convertit en brouillon de facture une fois accepté. Les courbes et la répartition apparaîtront dès le premier devis."
          action={gerer ? { href: `${DEVIS_BASE}/nouveau`, label: 'Nouveau devis' } : null}
        />
      ) : (
        <div className={`grid gap-3 ${GRILLE}`}>
          <div className={`${CARTE} flex min-w-0 flex-col gap-2 px-4 py-3.5`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-[13px] font-semibold">Émis et acceptés, 12 derniers mois</h2>
              <ChartLegend series={series} />
            </div>
            <LineChart
              title={`Devis émis et acceptés par mois, de ${moisLong(stats.from)} à ${moisLong(stats.to)}`}
              labels={stats.months.map((m) => moisCourt(m.month))}
              fullLabels={stats.months.map((m) => moisLong(m.month))}
              series={series}
              formatValue={(v) => `${v.toLocaleString('fr-FR')} devis`}
              formatTick={(v) => v.toLocaleString('fr-FR')}
              endLabelSeriesId="acceptes"
              height={164}
            />
          </div>

          <div className={`${CARTE} flex min-w-0 flex-col gap-3 px-4 py-3.5`}>
            <h2 className="text-[13px] font-semibold">Devis par statut</h2>
            <DonutChart
              title="Répartition des devis par statut"
              slices={tranchesStatutDevis(stats)}
              total={n.toLocaleString('fr-FR')}
              totalLabel="devis"
              hideEmpty
            />
            {stats.converted > 0 ? (
              <p className="text-xs text-[var(--foreground-muted)]">
                {stats.converted.toLocaleString('fr-FR')} devis accepté
                {stats.converted > 1 ? 's' : ''} déjà converti{stats.converted > 1 ? 's' : ''} en
                facture.
              </p>
            ) : null}
          </div>
        </div>
      )}

      <p className="text-xs text-[var(--foreground-muted)]">{noteDevisesDevis(stats)}</p>
    </section>
  );
}
