// Types et schémas du client e-MCF minimal — ADR-0021 §6 (chantier B).
//
// Les noms de champs DGI sont ceux de la spécification PUBLIQUE
// `docs/sources/dgi-rdc/edef-api-v2.0-2026-10-18.json` (OpenAPI 3, `info.version`
// 2.0) : `#/components/schemas/InfoResponseDto`, `EmcfInfoDto`, `TaxGroupsDto`,
// `InvoiceTypeDto`, `PaymentTypeDto`, `ClientTypeDto`, `ReferenceTypeDto`,
// `ItemTypeDto`, `CurrencyRateDto`.
//
// Les réponses sont validées par Zod ; les champs inconnus sont IGNORÉS (`strip`,
// comportement par défaut de `z.object`) : la DGI peut enrichir ses réponses sans
// casser le client, mais un champ attendu au mauvais type est une réponse non
// conforme (`invalid_response`).

import { z } from 'zod';

import type { Secret } from '../integrations/secret-value.js';
import type { EdefEnvironment } from '../platform-config/dgi-platform.config.js';

/** Les sept listes de référence `GET /api/info/{list}`. */
export const EDEF_REFERENCE_LISTS = [
  'taxGroups',
  'invoiceTypes',
  'paymentTypes',
  'clientTypes',
  'referenceTypes',
  'itemTypes',
  'currencyRates',
] as const;
export type EdefReferenceList = (typeof EDEF_REFERENCE_LISTS)[number];

export interface EdefCallContext {
  environment: EdefEnvironment;
  /** Jeton e-MCF — jamais une chaîne nue (ADR-0013 §2). */
  token: Secret;
  /** Pour le journal des échanges. */
  organizationId: string | null;
  pointOfSaleId: string | null;
}

export type EdefFailureKind =
  /** Production fermée : AUCUN appel réseau. */
  | 'production_disabled'
  /** HTTP 401. */
  | 'unauthorized'
  /** Délai `DGI_HTTP_TIMEOUT_MS` dépassé. */
  | 'timeout'
  /** DNS, TLS, connexion refusée. */
  | 'network'
  /** HTTP 5xx. */
  | 'server'
  /** Corps avec `errorCode`, ou autre 4xx. */
  | 'business'
  /** JSON illisible, schéma non conforme, réponse > 1 Mio. */
  | 'invalid_response';

export interface EdefFailure {
  kind: EdefFailureKind;
  httpStatus: number | null;
  dgiErrorCode: string | null;
  /**
   * Libellé d'erreur DGI (`errorDesc`) TEL QUE REÇU, seulement assaini (secrets
   * rédigés, sauts de ligne aplatis, 300 caractères au plus) : la DGI exige de
   * l'afficher avec son code (ADR-0024 § 5). Ajout ADR-0024 (F1), facultatif
   * pour les appelants d'avant ce lot ; le client le renseigne toujours.
   */
  dgiErrorDesc?: string | null;
  /** Français, assaini (`redaction.ts`), affichable. */
  message: string;
}

export type EdefOutcome<T> =
  { ok: true; data: T; durationMs: number } | { ok: false; error: EdefFailure; durationMs: number };

export interface EdefEmcfInfo {
  nim: string | null;
  status: string | null;
  shopName: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  contact1: string | null;
  contact2: string | null;
  contact3: string | null;
}

export interface EdefInfoStatus {
  status: boolean;
  version: string | null;
  nif: string | null;
  nim: string | null;
  /** ISO 8601. */
  tokenValid: string;
  serverDateTime: string;
  emcfList: EdefEmcfInfo[];
}

export interface EdefTypeEntry {
  type: string | null;
  description: string | null;
}

export interface EdefCurrencyRate {
  type: string | null;
  description: string | null;
  date: string | null;
  rate: number | null;
}

export interface EdefReferenceData {
  /** Clés d'une lettre minuscule, taux en pour cent (entiers ou décimaux acceptés). */
  taxGroups: Record<string, number>;
  invoiceTypes: EdefTypeEntry[];
  paymentTypes: EdefTypeEntry[];
  clientTypes: EdefTypeEntry[];
  referenceTypes: EdefTypeEntry[];
  itemTypes: EdefTypeEntry[];
  currencyRates: EdefCurrencyRate[];
}

// ── Schémas de validation ────────────────────────────────────────────────────

const nullableString = z
  .string()
  .nullish()
  .transform((v) => v ?? null);

const EmcfInfoSchema = z.object({
  nim: nullableString,
  status: nullableString,
  shopName: nullableString,
  address1: nullableString,
  address2: nullableString,
  address3: nullableString,
  contact1: nullableString,
  contact2: nullableString,
  contact3: nullableString,
});

export const InfoStatusSchema = z.object({
  status: z.boolean(),
  version: nullableString,
  nif: nullableString,
  nim: nullableString,
  tokenValid: z.string().min(1),
  serverDateTime: z.string().min(1),
  emcfList: z
    .array(EmcfInfoSchema)
    .nullish()
    .transform((v) => v ?? []),
});

/**
 * `TaxGroupsDto` : la spécification déclare des entiers (`int32`), la
 * documentation de la DGI des décimaux — on accepte les deux. Seules les clés
 * d'une lettre minuscule sont retenues ; une valeur `null` (groupe non publié)
 * est écartée ; toute autre valeur non numérique rend la réponse non conforme.
 */
export const TaxGroupsSchema = z.record(z.string(), z.unknown()).transform((raw, ctx) => {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[a-z]$/.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'taux non numérique' });
      return z.NEVER;
    }
    out[key] = value;
  }
  return out;
});

const TypeEntrySchema = z.object({ type: nullableString, description: nullableString });

const CurrencyRateSchema = z.object({
  type: nullableString,
  description: nullableString,
  date: nullableString,
  rate: z
    .number()
    .nullish()
    .transform((v) => v ?? null),
});

export const REFERENCE_LIST_SCHEMAS: {
  [L in EdefReferenceList]: z.ZodType<EdefReferenceData[L], unknown>;
} = {
  taxGroups: TaxGroupsSchema,
  invoiceTypes: z.array(TypeEntrySchema),
  paymentTypes: z.array(TypeEntrySchema),
  clientTypes: z.array(TypeEntrySchema),
  referenceTypes: z.array(TypeEntrySchema),
  itemTypes: z.array(TypeEntrySchema),
  currencyRates: z.array(CurrencyRateSchema),
};
