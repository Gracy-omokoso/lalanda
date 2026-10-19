// Types et schémas des routes de FACTURATION de l'e-MCF — ADR-0024 § 1 et § 2
// (jalon F0).
//
// FICHIER DE CONTRAT : le chantier F1 (client e-MCF) valide les réponses avec
// ces schémas ; F2 (normalisation) construit `EdefInvoiceRequest` et lit les
// résultats ; F4 (étalonnage) envoie et annule. Toute modification passe par le
// CTO et un amendement d'ADR-0024.
//
// Les noms de champs DGI sont ceux de la spécification PUBLIQUE
// `docs/sources/dgi-rdc/edef-api-v2.0-2026-10-18.json` (OpenAPI 3,
// `info.version` 2.0) : `#/components/schemas/InvoiceRequestDataDto`,
// `ItemDto`, `ClientDto`, `OperatorDto`, `PaymentDto`, `InvoiceResponseDto`,
// `FinalizeInvoiceRequestDataDto`, `FinalizeInvoiceResponseDataDto`,
// `InvoiceDetailsDto`, `StatusResponseDto`, `PendingRequestDto`.
//
// Comme pour les listes (`edef.types.ts`), les champs inconnus d'une réponse
// sont ignorés ; un champ attendu au mauvais type rend la réponse non conforme
// (`invalid_response`). Exception voulue : la réponse brute du `POST` est
// conservée TELLE QUELLE (nombres JSON, aucun arrondi, aucune reconversion)
// pour `compareWithEdefResponse` du moteur.
//
// Un `errorCode` non vide est traité AVANT ces schémas par le client
// (`business`, comme pour les lectures) : les schémas ne décrivent que les
// réponses sans erreur métier.

import { z } from 'zod';

import type { EdefCallContext } from './edef.types.js';

// ── Requête `POST /api/invoice` (`InvoiceRequestDataDto`) ────────────────────

/** `InvoiceTypeEnum`. */
export const EDEF_INVOICE_TYPES = ['FV', 'FT', 'FA', 'EV', 'ET', 'EA'] as const;
/** `ItemTypeEnum`. */
export const EDEF_ITEM_TYPES = ['BIE', 'SER', 'TAX'] as const;
/** `ClientTypeEnum`. */
export const EDEF_CLIENT_TYPES = ['PP', 'PM', 'PC', 'PL', 'AO'] as const;
/** `PaymentTypeEnum`. */
export const EDEF_PAYMENT_TYPES = [
  'ESPECES',
  'VIREMENT',
  'CARTEBANCAIRE',
  'MOBILEMONEY',
  'CHEQUES',
  'CREDIT',
  'AUTRE',
] as const;
/** `TaxGroupTypeEnum` restreint aux groupes qu'utilise Lalanda (A–P, ADR-0022). */
export const EDEF_REQUEST_TAX_GROUPS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
] as const;
/** Natures d'avoir (`referenceType`). */
export const EDEF_REFERENCE_TYPES = ['COR', 'RAN', 'RAM', 'RRR'] as const;

/** `ItemDto`. Les champs facultatifs sont OMIS (pas `null`) quand ils ne s'appliquent pas. */
export interface EdefInvoiceItem {
  /** « HORS CHAMP » pour un article hors champ ; `null` admis. */
  code: string | null;
  name: string;
  type: (typeof EDEF_ITEM_TYPES)[number];
  /** CDF, nombre JSON. */
  price: number;
  /** Nombre JSON, 3 décimales au plus. */
  quantity: number;
  taxGroup: (typeof EDEF_REQUEST_TAX_GROUPS)[number];
  taxSpecificValue?: string;
  taxSpecificAmount?: number;
  originalPrice?: number;
  priceModification?: string;
}

/** `ClientDto`. `contact` et `address` seulement si `printContactDetails`. */
export interface EdefInvoiceClient {
  type: (typeof EDEF_CLIENT_TYPES)[number];
  typeDesc?: string;
  name?: string;
  nif?: string;
  contact?: string;
  address?: string;
}

/** `PaymentDto` : `curCode`/`curRate` NON transmis (ADR-0024 § 1). */
export interface EdefInvoicePayment {
  name: (typeof EDEF_PAYMENT_TYPES)[number];
  /** CDF. */
  amount: number;
}

/** `InvoiceRequestDataDto` tel que Lalanda l'envoie (ADR-0024 § 1). */
export interface EdefInvoiceRequest {
  nif: string;
  rn: string;
  mode: 'ttc' | 'ht';
  isf: string;
  type: (typeof EDEF_INVOICE_TYPES)[number];
  items: EdefInvoiceItem[];
  client: EdefInvoiceClient;
  /** `operator.id` NON transmis : aucun identifiant interne chez un tiers. */
  operator: { name: string };
  payment: EdefInvoicePayment[];
  /** Avoirs `FA`/`EA` seulement. */
  reference?: string;
  referenceType?: (typeof EDEF_REFERENCE_TYPES)[number];
  referenceDesc?: string;
  cmta?: string;
  cmtb?: string;
  cmtc?: string;
  cmtd?: string;
  cmte?: string;
  cmtf?: string;
  cmtg?: string;
  cmth?: string;
  /** Contre-valeur indicative seulement : `USD`. */
  curCode?: 'USD';
  /** Jusqu'à 8 décimales. */
  curRate?: number;
  /** Date du taux TELLE QUE REÇUE de la DGI. */
  curDate?: string;
}

const finiteNumber = z.number().finite();

const EdefInvoiceItemSchema = z
  .object({
    code: z.string().min(1).nullable(),
    name: z.string().min(1),
    type: z.enum(EDEF_ITEM_TYPES),
    price: finiteNumber,
    quantity: finiteNumber.positive(),
    taxGroup: z.enum(EDEF_REQUEST_TAX_GROUPS),
    taxSpecificValue: z.string().min(1).optional(),
    taxSpecificAmount: finiteNumber.optional(),
    originalPrice: finiteNumber.optional(),
    priceModification: z.string().min(1).optional(),
  })
  .strict();

const optionalText = z.string().min(1).optional();

/**
 * Garde-fou de forme sur le corps CONSTRUIT par Lalanda, avant envoi : un champ
 * inconnu (`strict`), un `null` là où la règle est d'omettre, ou un montant non
 * fini sont des erreurs de programmation, pas des données à envoyer.
 */
export const EdefInvoiceRequestSchema: z.ZodType<EdefInvoiceRequest, z.ZodTypeDef, unknown> = z
  .object({
    nif: z.string().min(1),
    rn: z.string().min(1),
    mode: z.enum(['ttc', 'ht']),
    isf: z.string().min(1),
    type: z.enum(EDEF_INVOICE_TYPES),
    items: z.array(EdefInvoiceItemSchema).min(1),
    client: z
      .object({
        type: z.enum(EDEF_CLIENT_TYPES),
        typeDesc: optionalText,
        name: optionalText,
        nif: optionalText,
        contact: optionalText,
        address: optionalText,
      })
      .strict(),
    operator: z.object({ name: z.string().min(1) }).strict(),
    payment: z.array(z.object({ name: z.enum(EDEF_PAYMENT_TYPES), amount: finiteNumber }).strict()),
    reference: optionalText,
    referenceType: z.enum(EDEF_REFERENCE_TYPES).optional(),
    referenceDesc: optionalText,
    cmta: optionalText,
    cmtb: optionalText,
    cmtc: optionalText,
    cmtd: optionalText,
    cmte: optionalText,
    cmtf: optionalText,
    cmtg: optionalText,
    cmth: optionalText,
    curCode: z.literal('USD').optional(),
    curRate: finiteNumber.positive().optional(),
    curDate: optionalText,
  })
  .strict();

// ── Contexte d'appel ─────────────────────────────────────────────────────────

/** Appels qui portent sur une facture (`POST`, `confirm`, `cancel`) : journal lié au document. */
export interface EdefInvoiceCallContext extends EdefCallContext {
  invoiceId: string;
  rn: string;
}

// ── Résultats exposés par le client (ADR-0024 § 2) ───────────────────────────

/** `POST /api/invoice` réussi. */
export interface EdefInvoiceSubmitted {
  uid: string;
  /** Réponse brute (`InvoiceResponseDto`), nombres JSON intacts → `compareWithEdefResponse`. */
  raw: Readonly<Record<string, unknown>>;
}

/** Éléments de sécurité (`FinalizeInvoiceResponseDataDto`), chaînes TELLES QUE REÇUES. */
export interface EdefSecurityElements {
  /** `codeDEFDGI`. */
  codeDefDgi: string;
  nim: string;
  counters: string;
  dateTime: string;
  qrCode: string;
}

/** `PUT /api/invoice/{uid}/cancel` réussi. */
export interface EdefCancelled {
  /** `dateTime` de la réponse, s'il est fourni. */
  dateTime: string | null;
}

/** `GET /api/invoice` : demandes en attente de l'e-MCF (`StatusResponseDto`). */
export interface EdefPendingRequests {
  count: number;
  list: { uid: string; date: string }[];
}

/** `GET /api/invoice/{uid}` (`InvoiceDetailsDto`). */
export interface EdefInvoiceDetails {
  rn: string | null;
  nif: string | null;
  /** `totals` brut (`InvoiceResponseDto`). */
  totals: Readonly<Record<string, unknown>> | null;
  /** `null` si `secElements` est absent ou incomplet (un des cinq éléments vide). */
  security: EdefSecurityElements | null;
}

// ── Schémas de validation des réponses ───────────────────────────────────────

const nullableString = z
  .string()
  .nullish()
  .transform((v) => v ?? null);

/** `InvoiceResponseDto` : un `uid` absent ou vide (sans `errorCode`) est `invalid_response`. */
export const EdefInvoiceSubmittedSchema: z.ZodType<EdefInvoiceSubmitted, z.ZodTypeDef, unknown> = z
  .object({ uid: z.string().min(1) })
  .passthrough()
  .transform((raw) => ({ uid: raw.uid, raw: Object.freeze({ ...raw }) }));

const SecurityElementsShape = z.object({
  dateTime: nullableString,
  qrCode: nullableString,
  codeDEFDGI: nullableString,
  counters: nullableString,
  nim: nullableString,
});

function securityElementsOf(
  v: z.infer<typeof SecurityElementsShape> | null | undefined,
): EdefSecurityElements | null {
  if (!v) return null;
  const { codeDEFDGI, nim, counters, dateTime, qrCode } = v;
  if (!codeDEFDGI || !nim || !counters || !dateTime || !qrCode) return null;
  return { codeDefDgi: codeDEFDGI, nim, counters, dateTime, qrCode };
}

/**
 * `FinalizeInvoiceResponseDataDto` d'un `confirm` réussi. Les cinq éléments
 * doivent être non vides — sinon `invalid_response`, JAMAIS une normalisation
 * (« aucune facture enregistrée sans éléments de sécurité »).
 */
export const EdefSecurityElementsSchema: z.ZodType<EdefSecurityElements, z.ZodTypeDef, unknown> =
  SecurityElementsShape.transform((v, ctx) => {
    const elements = securityElementsOf(v);
    if (!elements) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'éléments de sécurité absents ou incomplets',
      });
      return z.NEVER;
    }
    return elements;
  });

/** Réponse d'un `cancel` réussi (même DTO que `confirm`, éléments vides attendus). */
export const EdefCancelledSchema: z.ZodType<EdefCancelled, z.ZodTypeDef, unknown> = z
  .object({ dateTime: nullableString })
  .transform((v) => ({ dateTime: v.dateTime }));

/** `StatusResponseDto` lu par `GET /api/invoice` ; une entrée sans `uid` est écartée. */
export const EdefPendingRequestsSchema: z.ZodType<EdefPendingRequests, z.ZodTypeDef, unknown> = z
  .object({
    pendingRequestsCount: z.number().int().nonnegative(),
    pendingRequestsList: z
      .array(z.object({ date: z.string().min(1), uid: nullableString }))
      .nullish()
      .transform((v) => v ?? []),
  })
  .transform((v) => ({
    count: v.pendingRequestsCount,
    list: v.pendingRequestsList.flatMap((p) => (p.uid ? [{ uid: p.uid, date: p.date }] : [])),
  }));

/** `InvoiceDetailsDto`. */
export const EdefInvoiceDetailsSchema: z.ZodType<EdefInvoiceDetails, z.ZodTypeDef, unknown> = z
  .object({
    rn: nullableString,
    nif: nullableString,
    totals: z
      .record(z.unknown())
      .nullish()
      .transform((v) => (v ? Object.freeze({ ...v }) : null)),
    secElements: SecurityElementsShape.nullish(),
  })
  .transform((v) => ({
    rn: v.rn,
    nif: v.nif,
    totals: v.totals,
    security: securityElementsOf(v.secElements),
  }));
