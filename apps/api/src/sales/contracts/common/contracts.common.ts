// Briques communes du module des engagements clients (commandes, contrats) —
// ADR-0050 § 2, § 3. ADR-0050 — V2.
//
// - Acteur, erreurs et lecture des corps au format des contrôleurs de ventes
//   (`{ code, message, details? }`, message en français) ;
// - numérotation des pièces internes `XX{AA}{MM}-NNNNNN` (motif ADR-0027, des devis
//   `DV…` et des achats) : année et mois au jour de Kinshasa, compteur ANNUEL par
//   organisation, trous admis, HORS série fiscale. V2 l'utilise pour `CC…` ; V3 la
//   réutilise pour `CT…` avec son propre compteur.
//
// Aucune règle fiscale ni calcul de montant ici : les montants viennent de
// `InvoiceDraftsService.compose` (moteur `invoice-totals`), le reste à facturer du
// moteur `contracts` (`orderInvoicing`).

import { HttpException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Model } from 'mongoose';
import type { ZodType } from 'zod';

import type { OrgRole } from '../../../authz/permissions.js';
import {
  fiscalYearOf,
  periodInYear,
  type NumberingPeriod,
} from '../../invoices/invoice-numbering.js';
import type { InvoiceActor } from '../../invoices/invoice.types.js';
import { invalidRequest, isDuplicateKey } from '../../sales.errors.js';

export type ContractsUser = { id: string; email: string; name?: string | null };

/** Acteur au format des factures (nom affiché, rôle pour l'audit). */
export function contractsActorOf(user: ContractsUser, role: OrgRole | undefined): InvoiceActor {
  const name = user.name?.trim();
  return { userId: user.id, name: name ? name : user.email, role: role ?? 'unknown' };
}

/** Corps validé par un schéma zod, sinon `400 INVALID_REQUEST` (forme des ventes). */
export function parseContractsBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) invalidRequest(parsed.error);
  return parsed.data;
}

export function contractsNotFound(code: string, message: string): never {
  throw new NotFoundException({ code, message });
}

/** `422` métier (pièce refusée, client exigé…). */
export function unprocessable(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new UnprocessableEntityException({ code, message, ...(details ? { details } : {}) });
}

export function httpError(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

/** Collections d'autres modules, LUES en lecture seule par la connexion. */
export const READ_ONLY_COLLECTIONS = Object.freeze({
  quotes: 'sales_quotes',
  invoices: 'sales_invoices',
  customers: 'customers',
  opportunities: 'crm_opportunities',
});

/** `CC2611-000001`, `CT2611-000042`… (le rang s'allonge au-delà de 999 999). */
export function formatEngagementNumber(
  prefix: string,
  period: NumberingPeriod,
  seq: number,
): string {
  const yy = String(period.year % 100).padStart(2, '0');
  const mm = String(period.month).padStart(2, '0');
  return `${prefix}${yy}${mm}-${String(seq).padStart(6, '0')}`;
}

/** Forme d'un compteur annuel (`{ organizationId, year, last }`). */
export interface EngagementCounter {
  organizationId: string;
  year: number;
  last: number;
}

/**
 * Numéro suivant d'un compteur annuel `counters`, attribué à l'instant `now`. Un
 * numéro pris par une création qui échoue ensuite est perdu : trou admis (pièce
 * interne, hors série fiscale).
 */
export async function nextEngagementNumber(
  counters: Model<EngagementCounter>,
  organizationId: string,
  prefix: string,
  now: Date,
): Promise<string> {
  const year = fiscalYearOf(now);
  const bump = () =>
    counters
      .findOneAndUpdate(
        { organizationId, year },
        { $inc: { last: 1 }, $setOnInsert: { _schemaVersion: 1 } },
        { upsert: true, new: true },
      )
      .lean<EngagementCounter>()
      .exec();
  let counter: EngagementCounter | null;
  try {
    counter = await bump();
  } catch (err) {
    // Première création concurrente du compteur : la seconde bute sur l'index unique.
    if (!isDuplicateKey(err)) throw err;
    counter = await bump();
  }
  return formatEngagementNumber(prefix, periodInYear(year, now), counter!.last);
}
