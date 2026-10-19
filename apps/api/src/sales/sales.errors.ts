// Erreurs HTTP du module ventes — ADR-0022 § S25c.5.
//
// Forme des contrôleurs existants : `{ code, message, details? }`, message en
// français. Une ressource d'une autre organisation répond 404, jamais 403.

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { ZodError, ZodIssue } from 'zod';

export interface SalesIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * Code d'un problème Zod. Les règles métier posent leur propre code
 * (`params.code` : `NIF_REQUIRED_FOR_TYPE`, `PRICE_TOO_PRECISE`…) ; les erreurs
 * de forme reçoivent un code générique stable.
 */
function codeOf(issue: ZodIssue): string {
  if (issue.code === 'custom') {
    const code = (issue.params as { code?: unknown } | undefined)?.code;
    if (typeof code === 'string') return code;
    return 'INVALID_VALUE';
  }
  if (issue.code === 'unrecognized_keys') return 'UNKNOWN_FIELD';
  if (issue.code === 'invalid_type') {
    return issue.received === 'undefined' ? 'FIELD_REQUIRED' : 'INVALID_TYPE';
  }
  return 'INVALID_VALUE';
}

export function issuesOf(error: ZodError): SalesIssue[] {
  return error.issues.map((i) => ({
    path: i.path.join('.'),
    code: codeOf(i),
    message: i.message,
  }));
}

export function invalidRequest(error: ZodError, message = 'Corps de requête invalide.'): never {
  throw new BadRequestException({
    code: 'INVALID_REQUEST',
    message,
    details: { issues: issuesOf(error) },
  });
}

/** 400 `INVALID_REQUEST` à partir de problèmes déjà formés (règles vérifiées en base). */
export function invalidRequestOf(issues: SalesIssue[]): never {
  throw new BadRequestException({
    code: 'INVALID_REQUEST',
    message: 'Corps de requête invalide.',
    details: { issues },
  });
}

export function invalidCursor(): never {
  throw new BadRequestException({
    code: 'INVALID_CURSOR',
    message: 'Curseur de pagination illisible : reprenez la liste depuis le début.',
  });
}

export function customerNotFound(): never {
  throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Client introuvable.' });
}

export function catalogItemNotFound(): never {
  throw new NotFoundException({
    code: 'CATALOG_ITEM_NOT_FOUND',
    message: 'Article introuvable.',
  });
}

export function conflict(code: string, message: string, details?: Record<string, unknown>): never {
  throw new ConflictException({ code, message, ...(details ? { details } : {}) });
}

export function staleRevision(currentRevision: number): never {
  conflict(
    'STALE_REVISION',
    'Cette fiche a été modifiée par quelqu’un d’autre entre-temps : rechargez-la avant de l’enregistrer.',
    { currentRevision },
  );
}

/** Code Mongo d'une violation d'index unique. */
export function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}
