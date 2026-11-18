// Outils communs du module « work » — ADR-0039 § 1 et § 4.
//
// Erreurs au format des contrôleurs de ventes (`{ code, message, details? }`,
// message en français). Une ressource d'une autre organisation répond 404,
// jamais 403. Les contrôles de ressource (auteur, saisie d'autrui) passent par
// `can(rôle, action)`, jamais par un nom de rôle (ADR-0012 § 8).

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { datesInverted } from '@lalanda/shared/work';
import { Types } from 'mongoose';

import type { CurrentOrgPermissionsValue } from '../authz/current-org-permissions.decorator.js';
import {
  can,
  NO_OVERRIDES,
  type Action,
  type OrgPermissionContext,
  type OrgRole,
} from '../authz/permissions.js';
import { conflict, invalidRequestOf, type SalesIssue } from '../sales/sales.errors.js';
import { isObjectIdHex } from '../sales/search.js';

export { conflict, staleRevision, invalidCursor } from '../sales/sales.errors.js';

/**
 * Appelant d'une requête du module. `role` absent : accès plateforme délégué.
 *
 * ADR-0041 § 9.4 (A3) : `role` est le TITRE (audit, affichage) ; `context` porte
 * le droit de clôture, les ajouts et les retraits du membre. Toute décision passe
 * par le couple (`actorCan`), jamais par le rôle seul.
 */
export interface WorkActor {
  userId: string;
  role: OrgRole | undefined;
  context: OrgPermissionContext;
}

export function workActorOf(
  user: { id: string },
  permissions: CurrentOrgPermissionsValue | undefined,
): WorkActor {
  return {
    userId: user.id,
    role: permissions?.role,
    context: permissions?.context ?? NO_OVERRIDES,
  };
}

/** L'appelant détient-il EFFECTIVEMENT cette action dans l'organisation active ? */
export function actorCan(actor: WorkActor, action: Action): boolean {
  return actor.role !== undefined && can(actor.role, action, actor.context);
}

export function isWorkId(value: unknown): value is string {
  return typeof value === 'string' && isObjectIdHex(value);
}

export function oid(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

export function notFound(code: string, message: string): never {
  throw new NotFoundException({ code, message });
}

export function projectNotFound(): never {
  notFound('WORK_PROJECT_NOT_FOUND', 'Projet introuvable.');
}
export function taskNotFound(): never {
  notFound('WORK_TASK_NOT_FOUND', 'Tâche introuvable.');
}
export function commentNotFound(): never {
  notFound('WORK_COMMENT_NOT_FOUND', 'Commentaire introuvable.');
}
export function attachmentNotFound(): never {
  notFound('WORK_ATTACHMENT_NOT_FOUND', 'Pièce jointe introuvable.');
}
export function timeEntryNotFound(): never {
  notFound('WORK_TIME_ENTRY_NOT_FOUND', 'Saisie de temps introuvable.');
}
export function rateNotFound(): never {
  notFound('WORK_RATE_NOT_FOUND', 'Taux introuvable.');
}
export function memberNotFound(): never {
  notFound('WORK_MEMBER_NOT_FOUND', 'Membre introuvable dans cette organisation.');
}

/** 400 `INVALID_REQUEST` avec un seul problème (règle vérifiée en base ou à l'horloge). */
export function invalid(path: string, code: string, message: string): never {
  invalidRequestOf([{ path, code, message }]);
}

export function invalidMany(issues: SalesIssue[]): never {
  invalidRequestOf(issues);
}

export function forbidden(code: string, message: string): never {
  throw new ForbiddenException({ code, message });
}

export function badRequest(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

export function unsupportedType(message: string): never {
  throw new UnsupportedMediaTypeException({ code: 'WORK_ATTACHMENT_TYPE', message });
}

export function projectArchived(): never {
  conflict('WORK_PROJECT_ARCHIVED', 'Ce projet est archivé : restaurez-le avant de le modifier.');
}

export function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

/** Lien relatif de l'application vers une tâche (notifications). */
export function taskHref(projectId: string, taskId: string): string {
  return `/projets/${projectId}?tache=${taskId}`;
}

// ── Curseur croissant (fils de commentaires) ─────────────────────────────────

export function encodeAscCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: at.toISOString(), i: id }), 'utf8').toString('base64url');
}

export function decodeAscCursor(raw: string): { at: Date; id: Types.ObjectId } | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { t, i } = parsed as Record<string, unknown>;
    if (typeof t !== 'string' || typeof i !== 'string' || !isObjectIdHex(i)) return null;
    const at = new Date(t);
    if (Number.isNaN(at.getTime()) || encodeAscCursor(at, i) !== raw) return null;
    return { at, id: new Types.ObjectId(i) };
  } catch {
    return null;
  }
}

/** Filtre « après le curseur » pour le tri `{ [field]: 1, _id: 1 }`. */
export function afterAscCursor(
  field: string,
  cursor: { at: Date; id: Types.ObjectId },
): Record<string, unknown> {
  return {
    $or: [{ [field]: { $gt: cursor.at } }, { [field]: cursor.at, _id: { $gt: cursor.id } }],
  };
}

/** Taille JSON d'une valeur, en octets UTF-8. */
export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
}

/**
 * Identifiant de chemin ramené en minuscules : les identifiants sont comparés
 * comme chaînes (`parentTaskId`, `blockedBy.taskId`), jamais à la casse près.
 * Un identifiant mal formé passe tel quel : le service répond 404.
 */
export class WorkIdPipe {
  transform(value: unknown): unknown {
    return typeof value === 'string' && isObjectIdHex(value) ? value.toLowerCase() : value;
  }
}

// ── ADR-0080 : heures de début et d'échéance ─────────────────────────────────

/**
 * ADR-0080 : heures retenues après une modification partielle. Une heure absente
 * du corps garde la valeur stockée, sauf si le corps efface son jour (`null`) :
 * l'heure part avec lui. Une heure posée alors que le jour final manque est
 * refusée `WORK_TIME_WITHOUT_DATE`.
 */
export function finalTimes(
  body: {
    startDate?: string | null;
    dueDate?: string | null;
    startTime?: string | null;
    dueTime?: string | null;
  },
  current: {
    startDate?: string | null;
    dueDate?: string | null;
    startTime?: string | null;
    dueTime?: string | null;
  },
): { startTime: string | null; dueTime: string | null } {
  const pick = (time: 'startTime' | 'dueTime', day: 'startDate' | 'dueDate'): string | null => {
    const finalDay = body[day] !== undefined ? body[day] : (current[day] ?? null);
    if (body[time] !== undefined && body[time] !== null) {
      if (!finalDay) invalid(time, 'WORK_TIME_WITHOUT_DATE', 'Une heure exige une date.');
      return body[time];
    }
    if (body[time] === null || !finalDay) return null;
    return current[time] ?? null;
  };
  return { startTime: pick('startTime', 'startDate'), dueTime: pick('dueTime', 'dueDate') };
}

/** ADR-0080 : échéance (jour + heure) ≥ début (jour + heure), état final. */
export function checkFinalDates(v: {
  startDate: string | null;
  dueDate: string | null;
  startTime: string | null;
  dueTime: string | null;
}): void {
  if (datesInverted(v)) {
    const sameDay = v.startDate === v.dueDate;
    invalid(
      sameDay ? 'dueTime' : 'dueDate',
      'WORK_DATES_INVERTED',
      sameDay
        ? 'L’heure d’échéance précède l’heure de début.'
        : 'L’échéance précède la date de début.',
    );
  }
}

/**
 * ADR-0080 : filtre Mongo « échéance dépassée » vu de l'horloge de
 * l'organisation — jour passé, ou jour même et heure atteinte. Sans heure, la
 * règle d'avant (`dueDate < aujourd'hui`).
 */
export function overdueFilter(clock: { today: string; time: string }): Record<string, unknown> {
  return {
    $or: [
      { dueDate: { $ne: null, $lt: clock.today } },
      { dueDate: clock.today, dueTime: { $ne: null, $lte: clock.time } },
    ],
  };
}

/** ADR-0080 : même règle en expression d'agrégation (`$cond`, `$expr`). */
export function overdueExpr(clock: { today: string; time: string }): Record<string, unknown> {
  return {
    $and: [
      { $ne: ['$dueDate', null] },
      {
        $or: [
          { $lt: ['$dueDate', clock.today] },
          {
            $and: [
              { $eq: ['$dueDate', clock.today] },
              { $ne: [{ $ifNull: ['$dueTime', null] }, null] },
              { $lte: ['$dueTime', clock.time] },
            ],
          },
        ],
      },
    ],
  };
}
