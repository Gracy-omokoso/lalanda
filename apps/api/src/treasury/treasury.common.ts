// Outils partagés de la trésorerie RUN — ADR-0034.

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';

import { kinshasaDay } from '../sales/invoices/exchange-rate-reference.service.js';
import { conflict } from '../sales/sales.errors.js';

export interface TreasuryActor {
  userId: string;
  role: string;
}

/** Date civile du jour à Kinshasa (UTC+1, ADR-0027). */
export function todayKinshasa(now: Date = new Date()): string {
  return kinshasaDay(now);
}

/** 404 uniforme : un document d'une autre organisation est « introuvable ». */
export function notFound(code: string, message: string): never {
  throw new NotFoundException({ code, message });
}

/** Identifiant Mongo lisible ? Sinon la ressource est introuvable (jamais un 500). */
export function isMongoId(value: string): boolean {
  return /^[0-9a-f]{24}$/.test(value) && isValidObjectId(value);
}

/** 400 avec un code métier stable — règle vérifiée hors du schéma d'entrée. */
export function rejected(code: string, message: string, details?: Record<string, unknown>): never {
  throw new BadRequestException({ code, message, ...(details ? { details } : {}) });
}

export function noFutureDate(date: string, code: string, what: string): void {
  if (date > todayKinshasa()) {
    rejected(code, `${what} ne peut pas être datée dans le futur (jour de Kinshasa).`);
  }
}

export { conflict };

/**
 * Clé d'objet d'une pièce justificative. Même règle que l'avatar et le logo
 * (`storage/object-key.ts`) : l'identifiant est tiré au hasard, sans aucune
 * dérivation de l'organisation ni de la dépense ; le préfixe est un rangement.
 */
export function expenseReceiptObjectKey(objectId: string): string {
  return `expense-receipts/${objectId}`;
}
