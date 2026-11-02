// Règles PURES de la facture des abonnements (ADR-0047, décision de la dirigeante
// du 3 nov. 2026). Aucun accès base, aucune horloge implicite : testées seules.

import type { PaymentMethod as InvoicePaymentMethod } from '@lalanda/engine';
import { PLAN_CATALOG, type Plan } from '@lalanda/shared/pricing';

/** Identité de facturation de l'abonné, telle qu'elle passe chez le vendeur. */
export interface BillingIdentity {
  legalName: string;
  nif: string | null;
  address: string | null;
  /** D'où elle vient : la fiche de facturation, la fiche fiscale, ou le nom de l'organisation. */
  source: 'billing_profile' | 'fiscal_profile' | 'organization';
}

const NIF_PATTERN = /^[A-Z0-9]{5,20}$/;

/** NIF normalisé (majuscules, sans espace ni séparateur) ; `null` s'il est vide. */
export function normalizeSubscriberNif(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const n = raw.toUpperCase().replace(/[\s.\-/]/g, '');
  return n === '' ? null : n;
}

export function isValidSubscriberNif(nif: string): boolean {
  return NIF_PATTERN.test(nif);
}

function text(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Décision n° 6 : la fiche de facturation saisie fait foi ; à défaut, la fiche
 * fiscale de l'organisation abonnée (dénomination, NIF, siège) ; à défaut, le nom
 * de l'organisation. Un NIF illisible n'est jamais transmis.
 */
export function billingIdentityOf(input: {
  profile: { legalName: string; nif: string | null; address: string | null } | null;
  fiscal: { legalName: string; nif: string; address: string | null } | null;
  organizationName: string;
}): BillingIdentity {
  const clean = (nif: string | null) => {
    const n = normalizeSubscriberNif(nif);
    return n !== null && isValidSubscriberNif(n) ? n : null;
  };
  if (input.profile && text(input.profile.legalName)) {
    return {
      legalName: text(input.profile.legalName)!,
      nif: clean(input.profile.nif),
      address: text(input.profile.address),
      source: 'billing_profile',
    };
  }
  if (input.fiscal && text(input.fiscal.legalName)) {
    return {
      legalName: text(input.fiscal.legalName)!,
      nif: clean(input.fiscal.nif),
      address: text(input.fiscal.address),
      source: 'fiscal_profile',
    };
  }
  return {
    legalName: text(input.organizationName) ?? 'Organisation abonnée',
    nif: null,
    address: null,
    source: 'organization',
  };
}

/**
 * Type de client DGI : personne morale avec NIF ; sans NIF, la DGI n'admet pas le
 * type `PM` (NIF obligatoire, ADR-0022) — l'abonné est alors facturé en `PP`.
 */
export function customerTypeOf(identity: BillingIdentity): 'PM' | 'PP' {
  return identity.nif !== null ? 'PM' : 'PP';
}

const INTERVAL_LABELS: Record<string, string> = { month: 'mensuel', year: 'annuel' };

/** Désignation de la ligne : « Abonnement Lalanda Pro — mensuel ». */
export function subscriptionLineName(plan: string | null, interval: string | null): string {
  const name =
    plan && plan in PLAN_CATALOG ? PLAN_CATALOG[plan as Plan].name : (plan ?? 'offre payante');
  const period = interval ? (INTERVAL_LABELS[interval] ?? interval) : null;
  return period ? `Abonnement Lalanda ${name} — ${period}` : `Abonnement Lalanda ${name}`;
}

/** Code d'article : `LLD-PRO-M`, lettres, chiffres et tirets seulement. */
export function subscriptionLineCode(plan: string | null, interval: string | null): string {
  const p = (plan ?? 'ABO').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const i = interval === 'year' ? 'A' : interval === 'month' ? 'M' : 'X';
  return `LLD-${p}-${i}`;
}

/** Date au format JJ/MM/AAAA, en temps universel (aucune dépendance de fuseau). */
export function dayLabel(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Commentaire C (255 caractères au plus) : référence de paiement et période couverte. */
export function subscriptionComment(input: {
  reference: string | null;
  eventId: string;
  periodStart: Date | null;
  periodEnd: Date | null;
}): string {
  const ref = input.reference ?? input.eventId;
  const parts = [`Paiement ${ref}`];
  if (input.periodStart && input.periodEnd) {
    parts.push(`période du ${dayLabel(input.periodStart)} au ${dayLabel(input.periodEnd)}`);
  }
  return parts.join(' — ').slice(0, 255);
}

/** Moyen de paiement de la facture (vocabulaire e-DEF) depuis celui de l'abonnement. */
export function invoicePaymentMethodOf(method: string): InvoicePaymentMethod {
  switch (method) {
    case 'mobile_money':
      return 'MOBILEMONEY';
    case 'bank_transfer':
      return 'VIREMENT';
    case 'card':
      return 'CARTEBANCAIRE';
    default:
      return 'AUTRE';
  }
}

export type CreditApprovalDecision =
  { ok: true; soleApprover: boolean } | { ok: false; code: 'SELF_APPROVAL_FORBIDDEN' };

/**
 * Décision n° 7 : un avoir exige deux personnes. Celle qui l'a demandé ne
 * l'approuve pas, sauf si elle est le SEUL détenteur de l'action sur la
 * plateforme — exception marquée, comme partout dans la console (ADR-0053 § 5.3).
 */
export function creditApprovalDecision(input: {
  requestedBy: string;
  approverUserId: string;
  holdersCount: number;
}): CreditApprovalDecision {
  if (input.requestedBy !== input.approverUserId) return { ok: true, soleApprover: false };
  if (input.holdersCount <= 1) return { ok: true, soleApprover: true };
  return { ok: false, code: 'SELF_APPROVAL_FORBIDDEN' };
}
