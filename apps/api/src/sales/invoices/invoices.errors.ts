// Erreurs HTTP des documents de vente — ADR-0023 § S25e.14.
//
// Même forme que le reste du module ventes : `{ code, message, details? }`,
// message en français. Les codes sont ceux, figés, d'`INVOICE_ERROR_CODES`
// (`invoice.contract.ts`) : le compilateur refuse un code hors contrat.

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { SalesIssue } from '../sales.errors.js';
import type { INVOICE_ERROR_CODES, InvoiceNotIssuableIssueCode } from './invoice.contract.js';

type CodesOf<S extends keyof typeof INVOICE_ERROR_CODES> = (typeof INVOICE_ERROR_CODES)[S][number];

export function invoiceNotFound(): never {
  throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Document introuvable.' });
}

export function notFound(code: CodesOf<404>, message: string): never {
  throw new NotFoundException({ code, message });
}

export function invoiceConflict(
  code: CodesOf<409>,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new ConflictException({ code, message, ...(details ? { details } : {}) });
}

export function staleInvoiceRevision(currentRevision: number): never {
  invoiceConflict(
    'STALE_REVISION',
    'Ce document a été modifié entre-temps : rechargez-le avant de continuer.',
    { currentRevision },
  );
}

export function invoiceNotDraft(status: string): never {
  invoiceConflict(
    'INVOICE_NOT_DRAFT',
    'Ce document n’est plus un brouillon : il ne se modifie plus (un avoir corrige une facture).',
    { status },
  );
}

/** Problème d'un 422 `INVOICE_NOT_ISSUABLE` : TOUS les problèmes sont rendus. */
export interface NotIssuableIssue {
  code: InvoiceNotIssuableIssueCode;
  lineIndex: number | null;
  message: string;
  details?: Readonly<Record<string, string>>;
}

export function notIssuable(issues: readonly NotIssuableIssue[]): never {
  throw new UnprocessableEntityException({
    code: 'INVOICE_NOT_ISSUABLE',
    message: 'Ce document ne peut pas être émis en l’état : corrigez les problèmes signalés.',
    details: { issues },
  });
}

/** 400 `INVALID_REQUEST` à partir de problèmes formés après lecture de la base. */
export function invalidInvoiceRequest(issues: SalesIssue[]): never {
  throw new BadRequestException({
    code: 'INVALID_REQUEST',
    message: 'Corps de requête invalide.',
    details: { issues },
  });
}
