// Export du journal électronique pour les vérificateurs (ADR-0026 § 6.3) —
// logique pure de l'écran. Le serveur revérifie tout (période, droits).

import type { SalesJournalExportQuery } from '@/lib/api';

/** Jour de Kinshasa `AAAA-MM-JJ` d'un instant. */
export function jourKinshasa(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kinshasa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Période proposée : du 1er du mois en cours à aujourd'hui (Kinshasa). */
export function periodeParDefaut(maintenant: Date): { from: string; to: string } {
  const to = jourKinshasa(maintenant);
  return { from: `${to.slice(0, 8)}01`, to };
}

export const JOURS_MAX = 366;

function jourValide(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Message d'erreur de la période, ou `null` si elle est exportable. */
export function erreurPeriode(from: string, to: string): string | null {
  if (!jourValide(from) || !jourValide(to)) return 'Indiquez deux dates valides.';
  if (from > to) return 'La date de fin précède la date de début.';
  const jours =
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000 +
    1;
  if (jours > JOURS_MAX) return `La période ne peut dépasser ${JOURS_MAX} jours.`;
  return null;
}

export type ChoixExport = 'json' | 'csv-ventes' | 'csv-echanges';

export const LIBELLES_EXPORT: Record<ChoixExport, string> = {
  json: 'Complet (JSON) — factures, journal chaîné, échanges e-MCF',
  'csv-ventes': 'Ventes (CSV) — lignes et totaux par groupe',
  'csv-echanges': 'Échanges e-MCF (CSV) — requêtes et réponses',
};

export function requeteExport(
  choix: ChoixExport,
  from: string,
  to: string,
): SalesJournalExportQuery {
  return {
    from,
    to,
    format: choix === 'json' ? 'json' : 'csv',
    dataset: choix === 'csv-echanges' ? 'echanges' : 'ventes',
  };
}

/** Nom de repli (si l'en-tête `content-disposition` n'est pas lisible en CORS). */
export function nomFichierExport(q: SalesJournalExportQuery): string {
  if (q.format === 'json') return `journal-ventes_${q.from}_${q.to}.json`;
  return q.dataset === 'echanges'
    ? `echanges-dgi_${q.from}_${q.to}.csv`
    : `journal-ventes_${q.from}_${q.to}.csv`;
}
