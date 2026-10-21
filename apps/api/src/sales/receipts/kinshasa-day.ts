// Jour civil à Kinshasa (UTC+1, sans heure d'été) — même convention que la
// numérotation des factures (ADR-0027, `fiscalPeriodOf`). Mise en forme d'une
// date : aucune opération sur un montant.

const KINSHASA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Kinshasa',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `AAAA-MM-JJ` du jour de Kinshasa qui contient l'instant `at`. */
export function kinshasaDayOf(at: Date): string {
  const parts: Record<string, string> = {};
  for (const part of KINSHASA_DAY.formatToParts(at)) parts[part.type] = part.value;
  const day = `${parts['year']}-${parts['month']}-${parts['day']}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Date illisible : ${String(at)}`);
  return day;
}
