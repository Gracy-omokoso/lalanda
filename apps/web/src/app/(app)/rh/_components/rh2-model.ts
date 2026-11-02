// Second volet des ressources humaines — règles communes (ADR-0051 § 6, § 10 ; lot H16).
// Logique pure.
//
// Messages d'erreur du second volet (codes nommés par l'ADR), jours civils (semaine,
// décalage) et état d'une fonction éteinte par défaut : pointage, plannings, objectifs
// et évaluations ne montrent JAMAIS de fausses données ; l'écran explique comment les
// activer et qui peut le faire.

import type { OrgAction } from '@/lib/api';

import { MESSAGES_FRAIS } from './frais-model';
import { messageRh } from './rh-model';

const MESSAGES: Record<string, string> = {
  ...MESSAGES_FRAIS,
  ATTENDANCE_RATE_LIMITED: 'Trop de pointages aujourd’hui : vingt au plus par jour.',
  ATTENDANCE_IN_FUTURE: 'Un pointage ne peut pas être dans le futur.',
  ATTENDANCE_CORRECTION_NOT_YOURS: 'Cette correction concerne une autre personne.',
  SHIFT_OVERLAP: 'Ce créneau chevauche un autre créneau de la même personne.',
  REVIEW_CLOSE_FORBIDDEN:
    'L’évalué et l’évaluateur ne clôturent pas l’évaluation : une autre personne des ressources humaines le fait.',
  REVIEW_SECTION_NOT_YOURS: 'Cette partie de l’évaluation est rédigée par une autre personne.',
  REVIEW_WRONG_STATUS: 'L’évaluation n’en est pas à cette étape.',
  REVIEWER_IS_EMPLOYEE: 'Un collaborateur ne s’évalue pas lui-même comme évaluateur.',
  HR_REVEAL_RATE_LIMITED: 'Trop d’affichages en une heure : réessayez plus tard.',
};

function codeDe(err: unknown): string | null {
  const detail = (err as { detail?: unknown } | null)?.detail;
  if (typeof detail !== 'object' || detail === null) return null;
  const code = (detail as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** Message d'une erreur du second volet, en français simple. */
export function messageRh2(err: unknown, repli: string): string {
  const code = codeDe(err);
  if (code !== null && MESSAGES[code]) return MESSAGES[code]!;
  return messageRh(err, repli);
}

// ── Fonctions éteintes par défaut ───────────────────────────────────────────

export type Fonction = 'attendance' | 'planning' | 'performance';

const NOMS: Record<Fonction, string> = {
  attendance: 'Le pointage',
  planning: 'Les plannings',
  performance: 'Les objectifs et les évaluations',
};

const POURQUOI: Record<Fonction, string> = {
  attendance:
    'Il est éteint par défaut : sa mise en place se fait après avoir vérifié avec votre juriste l’information des salariés et la durée de conservation. Lalanda n’enregistre que l’heure du serveur — aucune position, aucune photo, aucun appareil.',
  planning:
    'Ils sont éteints par défaut. Une fois activés, le manager ou les ressources humaines saisissent les créneaux et les publient ; Lalanda signale les chevauchements, les absences et le sous-effectif, sans jamais placer personne.',
  performance:
    'Ils sont éteints par défaut. Une fois activés, la trame et l’échelle sont saisies par votre organisation : Lalanda ne propose aucune note et aucune évaluation n’a d’effet automatique.',
};

/** Explication d'une fonction éteinte : ce qu'elle fait, qui l'active, où. */
export function explicationEteinte(
  f: Fonction,
  x: readonly OrgAction[] | null,
): { titre: string; texte: string; action: string } {
  const gerer = x !== null && x.includes('hr.manage');
  return {
    titre: `${NOMS[f]} ${f === 'attendance' ? 'n’est pas activé' : 'ne sont pas activés'} dans votre organisation`,
    texte: POURQUOI[f],
    action: gerer
      ? 'Vous pouvez l’activer dans Ressources humaines › Réglages.'
      : 'Seule une personne qui gère les ressources humaines peut l’activer, dans les réglages.',
  };
}

// ── Jours civils ────────────────────────────────────────────────────────────

const JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;

function enDate(jour: string): Date {
  const m = JOUR.exec(jour);
  if (!m) throw new RangeError(`Jour invalide : ${jour}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

const enJour = (d: Date): string => d.toISOString().slice(0, 10);

/** Jour décalé de `n` jours (négatif pour reculer). */
export function decaler(jour: string, n: number): string {
  const d = enDate(jour);
  d.setUTCDate(d.getUTCDate() + n);
  return enJour(d);
}

/** Lundi de la semaine d'un jour civil. */
export function lundiDe(jour: string): string {
  const d = enDate(jour);
  const decalage = (d.getUTCDay() + 6) % 7;
  return decaler(jour, -decalage);
}

/** Les sept jours d'une semaine, du lundi au dimanche. */
export function joursSemaine(lundi: string): string[] {
  return Array.from({ length: 7 }, (_, i) => decaler(lundi, i));
}

const JOURS_COURTS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

/** « lun. 2 » : jour de la semaine et quantième. */
export function jourCourt(jour: string): string {
  const d = enDate(jour);
  return `${JOURS_COURTS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()}`;
}

/** Minutes rendues par le moteur → « 9 h 08 », « 45 min ». Mise en forme seulement. */
export function duree(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

/** Heure de Kinshasa d'un horodatage ISO (« 08:02 »). */
export function heureKinshasa(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Kinshasa',
  });
}

/**
 * Horodatage UTC d'une heure saisie à Kinshasa (UTC+1, sans heure d'été) : « 2026-11-02 »
 * et « 08:02 » → « 2026-11-02T07:02:00Z ». `null` si la saisie est illisible.
 */
export function instantKinshasa(jour: string, heure: string): string | null {
  const h = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(heure);
  if (!JOUR.test(jour) || !h) return null;
  const d = enDate(jour);
  d.setUTCHours(Number(h[1]) - 1, Number(h[2]), 0, 0);
  return d.toISOString().replace('.000Z', 'Z');
}
