// Briques communes du module comptable (ADR-0049 § 11). ADR-0049 — K4.
//
// Erreurs au format des autres modules (`{ code, message, details? }`) ; une ressource
// d'une autre organisation répond 404, jamais 403. L'acteur réunit l'utilisateur, son
// rôle (audit) et ses droits EFFECTIFS (décisions). Les lots K5 à K7 réutilisent ces
// briques sans les modifier.

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Connection } from 'mongoose';
import type { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import {
  orgPermissionsOf,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { badRequest, notFound } from '../purchases/invoices/purchase-p4.common.js';
import { conflict, invalidRequest, isDuplicateKey, staleRevision } from '../sales/sales.errors.js';

export { badRequest, conflict, isDuplicateKey, notFound, staleRevision };

/** Acteur d'une requête comptable : identité, rôle (audit), droits EFFECTIFS. */
export interface AccountingActor {
  userId: string;
  role: string;
  perms: CurrentOrgPermissionsValue | undefined;
}

/** Ne vaut que sur une route portant `@RequirePermission` (droits résolus par le guard). */
export const CurrentAccountingActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccountingActor => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const perms = orgPermissionsOf(req);
    return { userId: req.user?.id ?? '', role: perms?.role ?? 'unknown', perms };
  },
);

/** Corps validé par un schéma partagé ; 400 `INVALID_REQUEST` sinon. */
export function parseWith<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) invalidRequest(parsed.error);
  return parsed.data;
}

/** Paramètre de chemin validé par un schéma ; 400 `INVALID_REQUEST` sinon. */
export function parseParam<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) invalidRequest(parsed.error, 'Paramètre de chemin invalide.');
  return parsed.data;
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Date(value).toISOString();
}

/**
 * Collection des écritures (`accounting_entries`, lot K5), LUE seulement ici : verrous de
 * la monnaie de tenue et de la bascule (§ 2.2), compte mouvementé (§ 2.3). Absente avant
 * K5 : les comptages valent alors zéro.
 */
export const ACCOUNTING_ENTRIES_COLLECTION = 'accounting_entries';

/** Vrai si l'organisation a au moins une écriture `posted` (verrous du § 2.2). */
export async function hasPostedEntry(
  connection: Connection,
  organizationId: string,
): Promise<boolean> {
  const n = await connection
    .collection(ACCOUNTING_ENTRIES_COLLECTION)
    .countDocuments({ organizationId, status: 'posted' }, { limit: 1 });
  return n > 0;
}

/** Vrai si une ligne d'écriture vise ce compte (`409 ACCOUNT_IN_USE`, § 2.3). */
export async function accountHasEntries(
  connection: Connection,
  organizationId: string,
  accountNumber: string,
): Promise<boolean> {
  const n = await connection.collection(ACCOUNTING_ENTRIES_COLLECTION).countDocuments(
    {
      organizationId,
      $or: [
        { 'lines.accountNumber': accountNumber },
        { 'lines.auxiliaryAccountNumber': accountNumber },
      ],
    },
    { limit: 1 },
  );
  return n > 0;
}
