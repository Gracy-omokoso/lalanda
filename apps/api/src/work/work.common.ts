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
import { Types } from 'mongoose';

import { can, type Action, type OrgRole } from '../authz/permissions.js';
import { conflict, invalidRequestOf, type SalesIssue } from '../sales/sales.errors.js';
import { isObjectIdHex } from '../sales/search.js';

export { conflict, staleRevision, invalidCursor } from '../sales/sales.errors.js';

/** Appelant d'une requête du module. `role` absent : accès plateforme délégué. */
export interface WorkActor {
  userId: string;
  role: OrgRole | undefined;
}

export function workActorOf(user: { id: string }, role: OrgRole | undefined): WorkActor {
  return { userId: user.id, role };
}

/** L'appelant détient-il cette action dans l'organisation active ? */
export function actorCan(actor: WorkActor, action: Action): boolean {
  return actor.role !== undefined && can(actor.role, action);
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

export const projectNotFound = (): never =>
  notFound('WORK_PROJECT_NOT_FOUND', 'Projet introuvable.');
export const taskNotFound = (): never => notFound('WORK_TASK_NOT_FOUND', 'Tâche introuvable.');
export const commentNotFound = (): never =>
  notFound('WORK_COMMENT_NOT_FOUND', 'Commentaire introuvable.');
export const attachmentNotFound = (): never =>
  notFound('WORK_ATTACHMENT_NOT_FOUND', 'Pièce jointe introuvable.');
export const timeEntryNotFound = (): never =>
  notFound('WORK_TIME_ENTRY_NOT_FOUND', 'Saisie de temps introuvable.');
export const rateNotFound = (): never => notFound('WORK_RATE_NOT_FOUND', 'Taux introuvable.');
export const memberNotFound = (): never =>
  notFound('WORK_MEMBER_NOT_FOUND', 'Membre introuvable dans cette organisation.');

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
  conflict(
    'WORK_PROJECT_ARCHIVED',
    'Ce projet est archivé : restaurez-le avant de le modifier.',
  );
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
