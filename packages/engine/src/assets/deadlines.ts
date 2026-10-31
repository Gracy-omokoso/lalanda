// Échéances des équipements (ADR-0046 § 3.3, § 3.4, § 6.6, § 7.2) :
// prochaine maintenance d'une périodicité, statut d'expiration (partagé avec la
// bibliothèque de documents), et liste des maintenances dues, couvertures qui
// expirent et équipements gardés par d'anciens collaborateurs.

import {
  addDays,
  addMonthsClamped,
  byString,
  checkDay,
  checkId,
  checkIntegerIn,
  checkNullableDay,
  dayNumber,
} from './money.js';
import {
  ASSET_DEADLINE_KINDS,
  ASSET_REMINDER_DAYS_BOUNDS,
  ASSETS_VERSION,
  MAINTENANCE_EVERY_MONTHS_BOUNDS,
  type AssetCoverageInput,
  type AssetDay,
  type AssetDeadline,
  type AssetDeadlineKind,
  type AssetDeadlineSettings,
  type AssetDeadlinesResult,
  type AssetEmployeeInput,
  type AssetInput,
  type AssetMaintenanceInput,
  type ExpiryStatus,
} from './types.js';

/**
 * Date de la maintenance suivante : `lastDoneOn` + `everyMonths` mois, quantième
 * ramené à la fin du mois d'arrivée (31 janv. + 1 mois = 28 ou 29 févr. ;
 * 31 août + 6 mois = 28 févr. d'une année non bissextile).
 */
export function nextMaintenanceDate(lastDoneOn: AssetDay, everyMonths: number): AssetDay {
  checkDay(lastDoneOn, 'Dernière maintenance');
  const { min, max } = MAINTENANCE_EVERY_MONTHS_BOUNDS;
  return addMonthsClamped(lastDoneOn, checkIntegerIn(everyMonths, min, max, 'Périodicité (mois)'));
}

/**
 * Statut d'une échéance à `today` : `expired` si `endOn` est passé (la veille
 * ou avant), `due_soon` si `endOn` tombe de `today` à `today + reminderDays`
 * inclus, `ok` sinon. Une couverture qui finit aujourd'hui vaut encore
 * aujourd'hui : `due_soon`.
 */
export function expiryStatus(endOn: AssetDay, reminderDays: number, today: AssetDay): ExpiryStatus {
  checkDay(endOn, 'Échéance');
  checkDay(today, 'Jour de référence');
  const { min, max } = ASSET_REMINDER_DAYS_BOUNDS;
  const days = checkIntegerIn(reminderDays, min, max, 'Délai de rappel (jours)');
  if (endOn < today) return 'expired';
  return endOn <= addDays(today, days) ? 'due_soon' : 'ok';
}

/** Un équipement cédé ou perdu ne porte plus d'échéance. */
const followed = (asset: AssetInput): boolean =>
  asset.status !== 'disposed' && asset.status !== 'lost';

/**
 * Échéances à `today` :
 * - interventions `planned` en retard (`plannedOn` < today) ou dues sous
 *   `maintenanceDueSoonDays` jours ;
 * - couvertures (garantie, assurance, contrat) `due_soon` selon leur propre
 *   `reminderDays` (sinon le réglage), ou `expired` ; une couverture remplacée
 *   par une autre du même équipement et du même type finissant plus tard est
 *   ignorée (renouvelée) ;
 * - équipements dont l'affectation ouverte désigne un collaborateur sorti
 *   (`endDate` < today) — constat `ASSET_HELD_BY_FORMER_EMPLOYEE`.
 * Les équipements cédés ou perdus, et les références à un équipement inconnu,
 * sont ignorés. Résultat trié et déterministe.
 */
export function assetDeadlines(
  assets: readonly AssetInput[],
  maintenance: readonly AssetMaintenanceInput[],
  coverages: readonly AssetCoverageInput[],
  today: AssetDay,
  settings: AssetDeadlineSettings,
  employees: readonly AssetEmployeeInput[] = [],
): AssetDeadlinesResult {
  checkDay(today, 'Jour de référence');
  const { min, max } = ASSET_REMINDER_DAYS_BOUNDS;
  const defaultReminder = checkIntegerIn(settings.reminderDays, min, max, 'Rappel des couvertures');
  const dueSoonDays = checkIntegerIn(
    settings.maintenanceDueSoonDays,
    min,
    max,
    'Rappel des maintenances',
  );
  const active = new Map<string, AssetInput>();
  for (const a of assets) {
    checkId(a.id, 'Équipement');
    if (followed(a)) active.set(a.id, a);
  }
  const deadlines: AssetDeadline[] = [];
  const todayN = dayNumber(today);
  const push = (
    kind: AssetDeadlineKind,
    assetId: string,
    refId: string | null,
    employeeId: string | null,
    date: AssetDay,
  ): void => {
    deadlines.push({
      kind,
      assetId,
      refId,
      employeeId,
      date,
      daysLeft: dayNumber(date) - todayN,
      dedupeKey: [
        assetId,
        kind.startsWith('maintenance')
          ? 'maintenance'
          : kind.startsWith('coverage')
            ? 'coverage'
            : 'holder',
        refId ?? employeeId,
        date,
      ].join(':'),
    });
  };

  const dueLimit = addDays(today, dueSoonDays);
  for (const [i, m] of maintenance.entries()) {
    if (m.status !== 'planned' || !active.has(m.assetId)) continue;
    const planned = checkNullableDay(m.plannedOn, `Intervention n° ${i + 1} (date prévue)`);
    if (planned === null || planned > dueLimit) continue;
    push(
      planned < today ? 'maintenance_overdue' : 'maintenance_due_soon',
      m.assetId,
      m.id,
      null,
      planned,
    );
  }

  const latestEnd = new Map<string, AssetDay>();
  for (const [i, c] of coverages.entries()) {
    const start = checkDay(c.startOn, `Couverture n° ${i + 1} (début)`);
    const end = checkDay(c.endOn, `Couverture n° ${i + 1} (fin)`);
    if (end < start) throw new RangeError(`Couverture n° ${i + 1} : la fin précède le début`);
    const key = `${c.assetId}\u0000${c.kind}`;
    const prev = latestEnd.get(key);
    if (prev === undefined || end > prev) latestEnd.set(key, end);
  }
  for (const c of coverages) {
    if (!active.has(c.assetId)) continue;
    if (latestEnd.get(`${c.assetId}\u0000${c.kind}`) !== c.endOn) continue; // renouvelée
    const reminder =
      c.reminderDays === null || c.reminderDays === undefined ? defaultReminder : c.reminderDays;
    const status = expiryStatus(c.endOn, reminder, today);
    if (status === 'ok') continue;
    push(
      status === 'expired' ? 'coverage_expired' : 'coverage_due_soon',
      c.assetId,
      c.id,
      null,
      c.endOn,
    );
  }

  const leftOn = new Map<string, AssetDay>();
  for (const [i, e] of employees.entries()) {
    const end = checkNullableDay(e.endDate, `Collaborateur n° ${i + 1} (sortie)`);
    if (end !== null && end < today) leftOn.set(e.id, end);
  }
  for (const a of active.values()) {
    const assignee = a.currentAssignment?.assignee;
    if (assignee?.kind !== 'employee') continue;
    const end = leftOn.get(assignee.employeeId);
    if (end !== undefined) push('held_by_former_employee', a.id, null, assignee.employeeId, end);
  }

  deadlines.sort(
    (a, b) =>
      byString(a.date, b.date) ||
      byString(a.kind, b.kind) ||
      byString(a.assetId, b.assetId) ||
      byString(a.dedupeKey, b.dedupeKey),
  );
  const counts = Object.fromEntries(ASSET_DEADLINE_KINDS.map((k) => [k, 0])) as Record<
    AssetDeadlineKind,
    number
  >;
  for (const d of deadlines) counts[d.kind] += 1;
  return { version: ASSETS_VERSION, today, deadlines, counts, total: deadlines.length };
}
