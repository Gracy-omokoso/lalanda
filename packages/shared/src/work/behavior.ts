// Comportement des projets — réglages de l'organisation (ADR-0061 § 3).
//
// Étend `work_settings` (ADR-0039 § 2.1) sans le casser : chaque champ est
// FACULTATIF dans `PUT /work/settings` (absent : valeur courante gardée) et a une
// valeur par défaut qui reproduit le comportement antérieur. Chaque réglage a un
// effet réel côté serveur ou côté écran — aucun réglage décoratif.

import { z } from 'zod';

import { WORK_PROJECT_VISIBILITIES, type WorkProjectVisibility } from './constants.js';
import { addDays } from './scheduling.js';

/** Vue ouverte par défaut en entrant dans un projet. */
export const WORK_DEFAULT_VIEWS = ['overview', 'list', 'board'] as const;
export type WorkDefaultView = (typeof WORK_DEFAULT_VIEWS)[number];

/** Jours ISO : 1 = lundi … 7 = dimanche. */
export const WORK_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type WorkWeekday = (typeof WORK_WEEKDAYS)[number];

export const WORK_BEHAVIOR_LIMITS = {
  autoArchiveDaysMin: 1,
  autoArchiveDaysMax: 365,
  creatorRolesMax: 20,
} as const;

/** Réglages de comportement (valeurs effectives, défauts appliqués). */
export interface WorkBehaviorSettings {
  /**
   * Rôles autorisés à créer un projet, PARMI les détenteurs de `work.manage` (le
   * réglage restreint, il n'élargit jamais) ; `null` : tout détenteur de `work.manage`
   * (comportement antérieur). La direction (`organization.manage`) crée toujours.
   */
  projectCreatorRoles: string[] | null;
  defaultVisibility: WorkProjectVisibility;
  defaultView: WorkDefaultView;
  /** Jours ouvrés (« échéance proche », résumé quotidien). */
  workingDays: WorkWeekday[];
  /** Projets terminés archivés automatiquement après N jours ; `null` : jamais. */
  autoArchiveCompletedDays: number | null;
  /** Les gestionnaires (`work.manage`) modifient et suppriment les commentaires des autres. */
  managersModerateComments: boolean;
  /** Numéros de tâche (#12) affichés. */
  showTaskNumbers: boolean;
}

export const DEFAULT_WORK_BEHAVIOR: WorkBehaviorSettings = {
  projectCreatorRoles: null,
  defaultVisibility: 'organization',
  defaultView: 'overview',
  workingDays: [1, 2, 3, 4, 5],
  autoArchiveCompletedDays: null,
  managersModerateComments: true,
  showTaskNumbers: true,
};

/** Champs facultatifs ajoutés à `PutWorkSettingsBody`. */
export const workBehaviorFields = {
  projectCreatorRoles: z
    .array(
      z.string({ error: 'Rôle attendu.' }).regex(/^[a-z_]{1,40}$/, { message: 'Rôle invalide.' }),
      { error: 'Liste de rôles attendue.' },
    )
    .max(WORK_BEHAVIOR_LIMITS.creatorRolesMax)
    .nullable()
    .optional(),
  defaultVisibility: z
    .enum(WORK_PROJECT_VISIBILITIES, { error: 'Visibilité : organization ou private.' })
    .optional(),
  defaultView: z.enum(WORK_DEFAULT_VIEWS, { error: 'Vue : overview, list ou board.' }).optional(),
  workingDays: z
    .array(z.number({ error: 'Jour attendu (1 à 7).' }).int().min(1).max(7), {
      error: 'Liste de jours attendue.',
    })
    .min(1, { message: 'Au moins un jour ouvré.' })
    .max(7)
    .superRefine((days, ctx) => {
      if (new Set(days).size !== days.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'Un jour figure deux fois.',
          params: { code: 'WORK_WEEKDAY_DUPLICATE' },
        });
      }
    })
    .optional(),
  autoArchiveCompletedDays: z
    .number({ error: 'Nombre de jours attendu.' })
    .int()
    .min(WORK_BEHAVIOR_LIMITS.autoArchiveDaysMin)
    .max(WORK_BEHAVIOR_LIMITS.autoArchiveDaysMax)
    .nullable()
    .optional(),
  managersModerateComments: z.boolean({ error: 'Vrai ou faux attendu.' }).optional(),
  showTaskNumbers: z.boolean({ error: 'Vrai ou faux attendu.' }).optional(),
};

/** Jour ISO (1 = lundi … 7 = dimanche) d'une date civile `AAAA-MM-JJ`. */
export function isoWeekdayOf(day: string): WorkWeekday {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return (d === 0 ? 7 : d) as WorkWeekday;
}

/**
 * Fin de la fenêtre « échéance proche » : `dueSoonDays` JOURS OUVRÉS après
 * `today` (0 : aujourd'hui seulement). Un vendredi avec 1 jour et une semaine du
 * lundi au vendredi : la fenêtre va jusqu'au lundi. Fonction pure.
 */
export function dueSoonEnd(
  today: string,
  dueSoonDays: number,
  workingDays: readonly number[],
): string {
  const open = new Set(workingDays.length > 0 ? workingDays : [1, 2, 3, 4, 5, 6, 7]);
  let end = today;
  let remaining = dueSoonDays;
  let guard = 0;
  while (remaining > 0 && guard < 400) {
    end = addDays(end, 1);
    if (open.has(isoWeekdayOf(end))) remaining -= 1;
    guard += 1;
  }
  return end;
}

/** `today` est-il un jour ouvré ? */
export function isWorkingDay(today: string, workingDays: readonly number[]): boolean {
  return workingDays.includes(isoWeekdayOf(today));
}

/** Vue d'entrée d'un projet → segment d'URL (`/projets/<id>/<segment>`). */
export function defaultViewSegment(view: WorkDefaultView): 'apercu' | 'liste' | 'kanban' {
  return view === 'list' ? 'liste' : view === 'board' ? 'kanban' : 'apercu';
}
