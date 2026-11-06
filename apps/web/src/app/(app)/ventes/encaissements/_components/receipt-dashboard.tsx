'use client';

// Cartes de chiffres et graphiques de l'écran Encaissements (ADR-0067), sur la
// réponse de `GET /sales/receipts/stats`. Aucun calcul ici : mise en forme
// (`receipt-dashboard-model.ts`) et composants SVG maison de `@lalanda/ui`.

import { BarList, LineChart, type LineSeries } from '@lalanda/ui';

import type { ReceiptStats } from '@/lib/api';

import {
  CARTE,
  CartesChiffres,
  EtatVide,
  ErreurTableau,
  SqueletteTableau,
  type EtatTableau,
} from '../../_components/dashboard-ui';
import {
  compact,
  moisCourt,
  moisLong,
  nombre,
} from '../../factures/_components/invoice-dashboard-model';

import {
  barresMoyens,
  cartesEncaissements,
  noteDevisesEncaissements,
} from './receipt-dashboard-model';

const GRILLE = 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]';

export function ReceiptDashboard({
  stats,
  etat,
  onReessayer,
}: {
  stats: ReceiptStats | null;
  etat: EtatTableau;
  onReessayer: () => void;
}): React.ReactElement {
  if (etat === 'erreur') {
    return (
      <ErreurTableau
        texte="Les chiffres des encaissements sont momentanément indisponibles. La liste reste à jour."
        onReessayer={onReessayer}
      />
    );
  }
  if (etat === 'chargement' || stats === null) {
    return (
      <SqueletteTableau label="Chargement des chiffres des encaissements" graphiques={GRILLE} />
    );
  }

  const series: LineSeries[] = [
    {
      id: 'encaisse',
      label: 'Encaissé',
      values: stats.months.map((m) => nombre(m.collected)),
      color: 1,
      variant: 'area',
    },
  ];
  const vide = stats.statusCounts.recorded === 0;

  return (
    <section aria-label="Chiffres des encaissements" className="flex flex-col gap-3">
      <CartesChiffres cartes={cartesEncaissements(stats)} />

      {vide ? (
        <EtatVide
          titre="Pas encore d’encaissement"
          texte="Enregistrez l’argent reçu sur vos factures (Mobile Money, virement, espèces…) : la courbe des 12 derniers mois, la répartition par moyen de paiement et le délai moyen d’encaissement apparaîtront ici."
        />
      ) : (
        <div className={`grid gap-3 ${GRILLE}`}>
          <div className={`${CARTE} flex min-w-0 flex-col gap-2 px-4 py-3.5`}>
            <h2 className="text-[13px] font-semibold">Encaissé, 12 derniers mois</h2>
            <LineChart
              title={`Encaissé par mois, de ${moisLong(stats.from)} à ${moisLong(stats.to)}, en ${stats.currency}`}
              labels={stats.months.map((m) => moisCourt(m.month))}
              fullLabels={stats.months.map((m) => moisLong(m.month))}
              series={series}
              formatValue={(v) => `${compact(v)} ${stats.currency}`}
              formatTick={compact}
              endLabelSeriesId="encaisse"
              height={164}
            />
          </div>

          <div className={`${CARTE} flex min-w-0 flex-col gap-2.5 px-4 py-3.5`}>
            <h2 className="text-[13px] font-semibold">Par moyen de paiement, 12 mois</h2>
            <BarList
              title={`Encaissé par moyen de paiement sur 12 mois, en ${stats.currency}`}
              items={barresMoyens(stats)}
              emptyText="Aucun encaissement sur la période."
            />
          </div>
        </div>
      )}

      <p className="text-xs text-[var(--foreground-muted)]">{noteDevisesEncaissements(stats)}</p>
    </section>
  );
}
