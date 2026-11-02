// Règles pures de l'échéancier et des abonnements — ADR-0050 § 2.4, § 4.3, § 5.3.
// ADR-0050 — V5.
//
// Aucune base, aucune horloge, aucun montant : les dates viennent du moteur `contracts`
// (`billingOccurrences`, `occurrenceStatus`), les montants de `InvoiceDraftsService`.
// Les libellés ne disent jamais qu'une clause est valable, ni qu'un contrat est
// « reconduit automatiquement » (critère 18).

import type { OccurrenceBlockReason, OccurrenceState } from '@lalanda/engine';
import {
  SALES_SUBSCRIPTIONS_SYSTEM_ACTOR,
  type SalesContractOccurrenceBlock,
} from '@lalanda/shared/sales-contracts';
import { z } from 'zod';

import type { InvoiceActor } from '../../invoices/invoice.types.js';

/** Acteur des brouillons préparés par la tâche (`createdBy`, audit). Jamais émetteur. */
export const SUBSCRIPTIONS_ACTOR: InvoiceActor = Object.freeze({
  userId: SALES_SUBSCRIPTIONS_SYSTEM_ACTOR,
  name: 'Préparation des échéances',
  role: 'system',
});

/** Longueur maximale de la ligne de commentaire C (ADR-0023, motif des commandes). */
export const COMMENT_C_MAX = 255;

/** Fenêtre de lecture par défaut et maximale de `GET …/schedule` (jours). */
export const SCHEDULE_DEFAULT_PAST_DAYS = 365;
export const SCHEDULE_DEFAULT_FUTURE_DAYS = 365;
export const SCHEDULE_MAX_SPAN_DAYS = 3 * 366;

/** Motif du moteur → code partagé (`SALES_CONTRACT_OCCURRENCE_BLOCKS`). */
export const BLOCK_CODE_OF: Readonly<Record<OccurrenceBlockReason, SalesContractOccurrenceBlock>> =
  Object.freeze({
    CUSTOMER_ARCHIVED: 'CUSTOMER_ARCHIVED',
    COMPUTATION_ERROR: 'CALCULATION_ERROR',
    RENEWAL_NOT_RECORDED: 'RENEWAL_NOT_RECORDED',
    TERMINATED: 'CONTRACT_TERMINATED',
    AMENDMENT_PENDING: 'AMENDMENT_PENDING',
  });

export const BLOCK_MESSAGES: Readonly<Record<SalesContractOccurrenceBlock, string>> = Object.freeze(
  {
    CUSTOMER_ARCHIVED:
      'Le client est désactivé : réactivez-le pour préparer le brouillon de cette échéance.',
    CALCULATION_ERROR:
      'Le brouillon de cette échéance ne peut pas être calculé (taux de TVA DGI indisponibles ou ligne invalide).',
    RENEWAL_NOT_RECORDED:
      'Le terme en cours est échu : la reconduction doit être constatée par un approbateur avant toute préparation.',
    CONTRACT_TERMINATED: 'Échéance postérieure à la date d’effet de la résiliation enregistrée.',
    AMENDMENT_PENDING:
      'Un avenant non signé a atteint sa date d’effet : signez-le ou annulez-le avant de préparer.',
  },
);

export const OCCURRENCE_STATE_LABELS: Readonly<Record<OccurrenceState, string>> = Object.freeze({
  prepared: 'Brouillon préparé',
  to_prepare: 'À préparer',
  upcoming: 'À venir',
  blocked: 'Bloquée',
});

/** Clé d'une échéance d'échéancier (`item:<itemRef>`, celle du moteur). */
export function scheduleKeyOf(itemRef: string): string {
  return `item:${itemRef}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ITEM = /^item:[A-Za-z0-9_-]{1,40}$/;

/** Clé d'échéance d'une route : date `AAAA-MM-JJ` (abonnement) ou `item:<itemRef>`. */
export const OccurrenceKeySchema = z.string().refine((k) => DAY.test(k) || ITEM.test(k), {
  message: 'Échéance attendue : date AAAA-MM-JJ ou item:<référence>.',
});

/** `AAAA-MM-JJ` → `JJ/MM/AAAA` (affichage du commentaire C). */
export function frenchDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Ligne de commentaire C (§ 4.3) : « Abonnement CT… — période du … au … » ou
 * « Contrat CT… — échéance du … ». Tronquée à `max` avec un drapeau.
 */
export function occurrenceComment(
  input:
    | {
        kind: 'subscription_occurrence';
        number: string;
        periodStart: string | null;
        periodEnd: string | null;
        date: string;
      }
    | { kind: 'schedule_item'; number: string; date: string; label: string | null },
  max: number = COMMENT_C_MAX,
): { text: string; truncated: boolean } {
  let full: string;
  if (input.kind === 'subscription_occurrence') {
    full =
      input.periodStart && input.periodEnd
        ? `Abonnement ${input.number} — période du ${frenchDay(input.periodStart)} au ${frenchDay(input.periodEnd)}`
        : `Abonnement ${input.number} — échéance du ${frenchDay(input.date)}`;
  } else {
    full = `Contrat ${input.number} — échéance du ${frenchDay(input.date)}${
      input.label ? ` — ${input.label}` : ''
    }`;
  }
  return full.length > max
    ? { text: full.slice(0, max), truncated: true }
    : { text: full, truncated: false };
}
