// Heures de début et d'échéance du module Projets (ADR-0080).
//
// Modèle : le JOUR reste `startDate` / `dueDate` (`AAAA-MM-JJ`) ; l'heure,
// FACULTATIVE, est `startTime` / `dueTime` (`HH:mm`, 24 h) et se lit dans le
// FUSEAU DE L'ORGANISATION (réglage d'organisation, Africa/Kinshasa par défaut).
// Sans heure, tout se comporte exactement comme avant : une échéance couvre la
// journée entière (en retard le lendemain à 0 h), un début commence à 0 h.
//
// Fonctions pures : « maintenant » est toujours fourni par l'appelant. Le seul
// calcul de fuseau passe par `Intl` (aucune table d'offsets codée en dur), si
// bien qu'un fuseau à heure d'été ajouté plus tard resterait juste.

import { z } from 'zod';

// ── Fuseaux proposés ────────────────────────────────────────────────────────

/**
 * Fuseaux qu'une organisation peut choisir. La RDC en compte deux : l'Ouest
 * (Kinshasa, UTC+1) et l'Est (Lubumbashi, UTC+2). Aucun n'a d'heure d'été.
 */
export const WORK_TIME_ZONES = ['Africa/Kinshasa', 'Africa/Lubumbashi'] as const;
export type WorkTimeZone = (typeof WORK_TIME_ZONES)[number];

/** Fuseau d'une organisation qui n'a rien réglé (ADR-0027 : jour de Kinshasa). */
export const WORK_DEFAULT_TIME_ZONE: WorkTimeZone = 'Africa/Kinshasa';

export interface WorkTimeZoneInfo {
  /** Abréviation affichée à côté d'une heure (« 14:00 WAT »). */
  abbr: string;
  /** Décalage lisible (« UTC+1 »). */
  offset: string;
  /** Ville de référence. */
  city: string;
  /** Libellé complet, pour les réglages, les e-mails et les infobulles. */
  label: string;
}

export const WORK_TIME_ZONE_INFO: Record<WorkTimeZone, WorkTimeZoneInfo> = {
  'Africa/Kinshasa': {
    abbr: 'WAT',
    offset: 'UTC+1',
    city: 'Kinshasa',
    label: 'Heure de Kinshasa — Ouest de la RDC (WAT, UTC+1)',
  },
  'Africa/Lubumbashi': {
    abbr: 'CAT',
    offset: 'UTC+2',
    city: 'Lubumbashi',
    label: 'Heure de Lubumbashi — Est de la RDC (CAT, UTC+2)',
  },
};

export function isWorkTimeZone(value: unknown): value is WorkTimeZone {
  return typeof value === 'string' && (WORK_TIME_ZONES as readonly string[]).includes(value);
}

/** Fuseau lu en base : une valeur inconnue (ou absente) retombe sur Kinshasa. */
export function workTimeZoneOr(value: unknown): WorkTimeZone {
  return isWorkTimeZone(value) ? value : WORK_DEFAULT_TIME_ZONE;
}

// ── Heure du jour ───────────────────────────────────────────────────────────

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Vrai pour une heure `HH:mm` sur 24 h (`00:00` à `23:59`). */
export function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/** Heure `HH:mm` (24 h) d'un corps de requête ; code `WORK_TIME_INVALID`. */
export const WorkTime = z.string({ error: 'Heure attendue : HH:mm (24 h).' }).refine(isTimeOfDay, {
  message: 'Heure : HH:mm sur 24 h (par exemple 09:30 ou 17:00).',
  params: { code: 'WORK_TIME_INVALID' },
});

// ── Horloge de l'organisation ───────────────────────────────────────────────

/** « Maintenant » lu dans le fuseau de l'organisation. */
export interface OrgClock {
  /** Jour civil `AAAA-MM-JJ`. */
  today: string;
  /** Heure `HH:mm`. */
  time: string;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    FORMATTERS.set(timeZone, f);
  }
  return f;
}

function partsOf(instant: Date, timeZone: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) parts[p.type] = p.value;
  // Certains moteurs rendent « 24 » pour minuit malgré `h23`.
  if (parts['hour'] === '24') parts['hour'] = '00';
  return parts;
}

/** Jour et heure d'un instant dans un fuseau. */
export function orgClock(now: Date, timeZone: string): OrgClock {
  const p = partsOf(now, timeZone);
  return {
    today: `${p['year']}-${p['month']}-${p['day']}`,
    time: `${p['hour']}:${p['minute']}`,
  };
}

/** Jour civil d'un instant dans un fuseau (généralise `kinshasaDayOf`). */
export function dayIn(instant: Date, timeZone: string): string {
  return orgClock(instant, timeZone).today;
}

/** Heure civile (0–23) d'un instant dans un fuseau. */
export function hourIn(instant: Date, timeZone: string): number {
  return Number(partsOf(instant, timeZone)['hour']);
}

/** Décalage du fuseau à cet instant, en millisecondes (UTC+1 → 3 600 000). */
function offsetMs(instant: Date, timeZone: string): number {
  const p = partsOf(instant, timeZone);
  const asUtc = Date.UTC(
    Number(p['year']),
    Number(p['month']) - 1,
    Number(p['day']),
    Number(p['hour']),
    Number(p['minute']),
    Number(p['second']),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instant UTC d'un jour et d'une heure lus dans un fuseau. */
export function zonedInstant(day: string, time: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError(`Date invalide : ${day}`);
  if (!isTimeOfDay(time)) throw new RangeError(`Heure invalide : ${time}`);
  const [h, m] = time.split(':').map(Number) as [number, number];
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, m);
  // Deux passes suffisent, y compris autour d'un changement d'heure.
  let guess = naive - offsetMs(new Date(naive), timeZone);
  guess = naive - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/**
 * Instant où une échéance est dépassée : à l'heure exacte si elle est posée,
 * sinon au début du LENDEMAIN (la journée entière reste « à temps »).
 */
export function dueDeadline(dueDate: string, dueTime: string | null, timeZone: string): Date {
  if (dueTime !== null) return zonedInstant(dueDate, dueTime, timeZone);
  const next = new Date(Date.parse(`${dueDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return zonedInstant(next, '00:00', timeZone);
}

// ── Règles ──────────────────────────────────────────────────────────────────

/** Ce que les règles lisent d'une échéance. */
export interface DueLike {
  dueDate: string | null;
  dueTime?: string | null;
}

/**
 * Échéance dépassée, vue de l'horloge de l'organisation : jour passé, ou jour
 * même et heure atteinte (`14:00` est en retard dès 14 h 00). Sans heure : la
 * règle d'avant, en retard le lendemain.
 */
export function isPastDue(due: DueLike, clock: OrgClock): boolean {
  if (due.dueDate === null) return false;
  if (due.dueDate < clock.today) return true;
  const t = due.dueTime ?? null;
  return due.dueDate === clock.today && t !== null && t <= clock.time;
}

/**
 * Échéance (jour + heure) antérieure au début (jour + heure) : refusée
 * `WORK_DATES_INVERTED`. Une heure absente vaut 0 h pour le début et la fin de
 * journée pour l'échéance : seul le cas « même jour, deux heures, fin < début »
 * s'ajoute à la règle des jours. L'égalité est permise (≥).
 */
export function datesInverted(v: {
  startDate?: string | null;
  startTime?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
}): boolean {
  if (!v.startDate || !v.dueDate) return false;
  if (v.dueDate < v.startDate) return true;
  if (v.dueDate > v.startDate) return false;
  return !!v.startTime && !!v.dueTime && v.dueTime < v.startTime;
}

/** Ordre de tri de deux échéances le même jour : une heure passe avant « toute la journée ». */
export function compareDue(a: DueLike, b: DueLike): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  const ta = a.dueTime ?? null;
  const tb = b.dueTime ?? null;
  if (ta === tb) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return ta < tb ? -1 : 1;
}

/** Clé d'une échéance pour les rappels : `AAAA-MM-JJ` ou `AAAA-MM-JJTHH:mm`. */
export function dueKey(dueDate: string, dueTime: string | null | undefined): string {
  return dueTime ? `${dueDate}T${dueTime}` : dueDate;
}

// ── Affichage ───────────────────────────────────────────────────────────────

/** « 14:00 WAT » — l'abréviation lève l'ambiguïté Ouest / Est. */
export function formatTimeShort(time: string, timeZone: string): string {
  return `${time} ${WORK_TIME_ZONE_INFO[workTimeZoneOr(timeZone)].abbr}`;
}

/** « 14:00, heure de Kinshasa (WAT, UTC+1) » — e-mails, détails, infobulles. */
export function formatTimeLong(time: string, timeZone: string): string {
  const info = WORK_TIME_ZONE_INFO[workTimeZoneOr(timeZone)];
  return `${time}, heure de ${info.city} (${info.abbr}, ${info.offset})`;
}

/**
 * Jour + heure facultative en texte brut (`AAAA-MM-JJ` puis « à 14:00 WAT ») :
 * titres de notification, CSV. Sans heure : le jour seul, comme avant.
 */
export function formatDayTime(
  day: string,
  time: string | null | undefined,
  timeZone: string,
  style: 'short' | 'long' = 'short',
): string {
  if (!time) return day;
  return `${day} à ${style === 'long' ? formatTimeLong(time, timeZone) : formatTimeShort(time, timeZone)}`;
}
