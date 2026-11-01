// Briques de schéma et corps de requête des commandes clients et des contrats (ADR-0050
// §§ 2, 3 et 5). ADR-0050 — V0.
//
// Mêmes règles que `@lalanda/shared/purchases` et `@lalanda/shared/accounting` : corps
// `.strict()`, codes métier dans `params.code`, identifiants Mongo ramenés en minuscules,
// montants en CHAÎNES décimales (jamais un `number` JSON), dates civiles `AAAA-MM-JJ` au
// jour de Kinshasa (ADR-0027). Les LIGNES, le client et la devise d'un document
// (`currency`, `priceMode`, `customer`, `lines`) sont validés par l'API avec LE MÊME schéma
// que le brouillon de facture (`CreateInvoiceSchema`, motif ADR-0035 § 1) : ils restent
// opaques ici. Les règles qui exigent la base (ressource d'une autre organisation → 404,
// statut, échéance déjà préparée) sont vérifiées par les services des lots V2 à V5, qui
// RÉUTILISENT ces briques dans leurs propres fichiers.

import { z } from 'zod';

import {
  SALES_CONTRACT_AMENDMENT_PURPOSES,
  SALES_CONTRACT_BILLING_FREQUENCIES,
  SALES_CONTRACT_BILLING_TIMINGS,
  SALES_CONTRACT_FILE_KINDS,
  SALES_CONTRACT_LIMITS as L,
  SALES_CONTRACT_RENEWAL_MODES,
  SALES_CONTRACT_SIGNATORY_SIDES,
  SALES_CONTRACT_TERMINATION_PARTIES,
  SALES_DEPOSIT_INVOICE_TYPES,
} from './constants.js';

type RawIssue = z.core.$ZodRawIssue;
type Ctx = z.RefinementCtx;

/**
 * Message français d'un schéma. Repose `received` comme `fr()` de
 * `@lalanda/shared/work` : un champ absent reste reconnu `FIELD_REQUIRED` par l'API.
 */
export function salesContractFr(message: string): { error: (iss: RawIssue) => string } {
  const error = (iss: RawIssue): string => {
    if (iss.code === 'invalid_type' || iss.code === 'invalid_value') {
      const input = iss.input;
      (iss as { received?: string }).received =
        input === undefined
          ? 'undefined'
          : input === null
            ? 'null'
            : Array.isArray(input)
              ? 'array'
              : typeof input;
    }
    return message;
  };
  return { error };
}

/** Ajoute une erreur portant un code métier stable (`params.code`). */
export function salesContractIssue(
  ctx: Ctx,
  code: string,
  message: string,
  path?: PropertyKey[],
): void {
  ctx.addIssue({
    code: 'custom',
    message,
    params: { code },
    ...(path === undefined ? {} : { path }),
  });
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Identifiant Mongo (24 hexadécimaux), ramené en minuscules. */
export const SalesContractId = z
  .string(salesContractFr('Identifiant attendu.'))
  .refine((v) => OBJECT_ID.test(v), {
    message: 'Identifiant invalide.',
    params: { code: 'SALES_CONTRACT_ID_INVALID' },
  })
  .transform((v) => v.toLowerCase());

/** Révision attendue (écriture concurrente → `409 STALE_REVISION`). */
export const SalesContractExpectedRevision = z
  .number(salesContractFr('Révision attendue : un entier.'))
  .int({ message: 'Révision attendue : un entier.' })
  .min(1);

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Vrai pour une date civile `AAAA-MM-JJ` qui existe au calendrier grégorien. */
export function isSalesContractCalendarDay(value: string): boolean {
  const m = CALENDAR_DAY.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month - 1]!;
}

/** Date civile au jour de Kinshasa (ADR-0027). */
export const SalesContractCalendarDay = z
  .string(salesContractFr('Date attendue au format AAAA-MM-JJ.'))
  .refine(isSalesContractCalendarDay, {
    message: 'Date attendue au format AAAA-MM-JJ.',
    params: { code: 'INVALID_DATE' },
  });

const DECIMAL = /^(\d{1,13})(?:\.(\d+))?$/;

/**
 * Forme canonique d'un montant décimal positif ou nul, deux décimales au plus
 * (`"12.5"` → `"12.50"`), ou `null` si la chaîne n'est pas un montant. Forme seulement :
 * aucun calcul (le moteur `invoice-totals` calcule).
 */
export function canonicalSalesContractAmount(raw: string): string | null {
  const m = DECIMAL.exec(raw);
  if (m === null) return null;
  const fraction = m[2] ?? '';
  if (fraction.length > 2) return null;
  const integer = m[1]!.replace(/^0+(?=\d)/, '');
  return `${integer}.${fraction.padEnd(2, '0')}`;
}

/**
 * Montant strictement positif, canonique (`"12.50"`) : montant demandé d'un acompte
 * (§ 5.1). Aucun pourcentage (décision ouverte n° 12).
 */
export const SalesContractPositiveAmount = z.unknown().transform((raw, ctx): string => {
  if (typeof raw === 'number') {
    salesContractIssue(
      ctx,
      'DECIMAL_MUST_BE_STRING',
      'Montant attendu sous forme de chaîne (par exemple "12.50"), jamais de nombre.',
    );
    return z.NEVER;
  }
  if (typeof raw !== 'string') {
    salesContractIssue(ctx, 'FIELD_REQUIRED', 'Montant obligatoire.');
    return z.NEVER;
  }
  const canonical = canonicalSalesContractAmount(raw.trim());
  if (canonical === null) {
    salesContractIssue(
      ctx,
      'INVALID_AMOUNT',
      'Montant invalide : chiffres et point décimal, deux décimales au plus.',
    );
    return z.NEVER;
  }
  if (canonical === '0.00') {
    salesContractIssue(ctx, 'AMOUNT_NOT_POSITIVE', 'Le montant doit être strictement positif.');
    return z.NEVER;
  }
  return canonical;
});

/** Texte obligatoire : espaces de bord retirés, 1 à `max` caractères. */
export function salesContractRequiredText(max: number, what: string) {
  return z
    .string(salesContractFr(`${what} : texte attendu.`))
    .trim()
    .refine((v) => v.length > 0, {
      message: `${what} obligatoire.`,
      params: { code: 'FIELD_REQUIRED' },
    })
    .refine((v) => v.length <= max, {
      message: `${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    });
}

/** Texte facultatif : espaces de bord retirés, vide → `null`. */
export function salesContractOptionalText(max: number) {
  return z
    .string(salesContractFr('Texte attendu.'))
    .trim()
    .refine((v) => v.length <= max, {
      message: `${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    })
    .transform((v) => (v === '' ? null : v))
    .nullable();
}

function boundedInt(min: number, max: number, what: string) {
  const message = `${what} : un entier de ${min} à ${max}.`;
  return z
    .number(salesContractFr(message))
    .int({ message })
    .min(min, { message })
    .max(max, { message });
}

// ── Clauses saisies (§ 2.3) ─────────────────────────────────────────────────

/** Durée du premier terme en mois, ou `null` (durée indéterminée). */
export const SalesContractInitialTermMonths = boundedInt(
  L.initialTermMonthsMin,
  L.initialTermMonthsMax,
  'Durée du premier terme (mois)',
).nullable();

/** Préavis contractuel de non-reconduction ou de résiliation, en jours (clause saisie). */
export const SalesContractNoticeDays = boundedInt(
  L.noticeDaysMin,
  L.noticeDaysMax,
  'Préavis (jours)',
);

/**
 * Reconduction — **clause saisie**. `none` : ni période ni nombre ; `tacit` et `explicit` :
 * période exigée, nombre maximal facultatif (`null` : sans limite saisie).
 */
export const SalesContractRenewalSchema = z
  .object({
    mode: z.enum(
      SALES_CONTRACT_RENEWAL_MODES,
      salesContractFr('Reconduction attendue : none, tacit ou explicit.'),
    ),
    periodMonths: boundedInt(
      L.renewalPeriodMonthsMin,
      L.renewalPeriodMonthsMax,
      'Période de reconduction (mois)',
    ).nullable(),
    maxRenewals: boundedInt(0, L.maxRenewalsMax, 'Nombre maximal de reconductions').nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.mode === 'none') {
      if (r.periodMonths !== null || r.maxRenewals !== null) {
        salesContractIssue(
          ctx,
          'RENEWAL_FIELDS_WITHOUT_RENEWAL',
          'Sans reconduction, ni période ni nombre de reconductions.',
          ['mode'],
        );
      }
    } else if (r.periodMonths === null) {
      salesContractIssue(ctx, 'RENEWAL_PERIOD_REQUIRED', 'Période de reconduction obligatoire.', [
        'periodMonths',
      ]);
    }
  });
export type SalesContractRenewal = z.output<typeof SalesContractRenewalSchema>;

// ── Échéancier (§ 2.4) ──────────────────────────────────────────────────────

/** Lignes d'un document : validées par l'API avec le schéma du brouillon de facture. */
const OpaqueLines = z.array(z.unknown(), salesContractFr('Lignes attendues.'));

/** Identifiant stable d'une échéance d'un `schedule` (lien `schedule_item`). */
export const SalesContractItemRef = z
  .string(salesContractFr('Référence d’échéance attendue.'))
  .regex(/^[A-Za-z0-9_-]{1,40}$/, {
    message: 'Référence d’échéance : lettres, chiffres, tiret ou souligné, 40 au plus.',
  });

export const SalesContractScheduleItemSchema = z
  .object({
    itemRef: SalesContractItemRef,
    dueDate: SalesContractCalendarDay,
    label: salesContractRequiredText(L.labelMax, 'Libellé de l’échéance'),
    /** Chaque échéance porte ses propres lignes : aucun pourcentage (décision n° 14). */
    lines: OpaqueLines,
  })
  .strict();

export const SalesContractBillingSchema = z
  .discriminatedUnion(
    'kind',
    [
      z.object({ kind: z.literal('none') }).strict(),
      z
        .object({
          kind: z.literal('schedule'),
          items: z
            .array(SalesContractScheduleItemSchema)
            .min(L.scheduleItemsMin, { message: 'Au moins une échéance.' })
            .max(L.scheduleItemsMax, { message: `${L.scheduleItemsMax} échéances au plus.` }),
        })
        .strict(),
      z
        .object({
          kind: z.literal('recurring'),
          frequency: z.enum(
            SALES_CONTRACT_BILLING_FREQUENCIES,
            salesContractFr('Fréquence attendue : weekly, monthly, quarterly ou yearly.'),
          ),
          anchorDate: SalesContractCalendarDay,
          timing: z.enum(
            SALES_CONTRACT_BILLING_TIMINGS,
            salesContractFr('Moment attendu : in_advance ou in_arrears.'),
          ),
          autoPrepare: z.boolean(salesContractFr('Préparation automatique : vrai ou faux.')),
        })
        .strict(),
    ],
    salesContractFr('Échéancier attendu : none, schedule ou recurring.'),
  )
  .superRefine((b, ctx) => {
    if (b.kind !== 'schedule') return;
    const seen = new Set<string>();
    b.items.forEach((item, i) => {
      if (seen.has(item.itemRef)) {
        salesContractIssue(
          ctx,
          'SCHEDULE_ITEM_REF_DUPLICATE',
          'Deux échéances portent la même référence.',
          ['items', i, 'itemRef'],
        );
      }
      seen.add(item.itemRef);
    });
  });
export type SalesContractBilling = z.output<typeof SalesContractBillingSchema>;

// ── Corps : approbation, signature, résiliation, reconduction (§§ 2.3, 3) ───

/** `POST …/submit`, `…/new-version`, `…/confirm`, `…/renewals` : révision seule. */
export const SalesContractRevisionSchema = z
  .object({ expectedRevision: SalesContractExpectedRevision })
  .strict();

/** `POST …/approve` (contrat ou avenant) : commentaire facultatif. */
export const SalesContractApproveSchema = z
  .object({
    expectedRevision: SalesContractExpectedRevision,
    comment: salesContractOptionalText(L.commentMax).optional(),
  })
  .strict()
  .transform((b) => ({ expectedRevision: b.expectedRevision, comment: b.comment ?? null }));

/** `POST …/reject` (contrat ou avenant) : commentaire exigé ; retour en `draft`. */
export const SalesContractRejectSchema = z
  .object({
    expectedRevision: SalesContractExpectedRevision,
    comment: salesContractRequiredText(L.commentMax, 'Commentaire'),
  })
  .strict();

/** `POST …/cancel` (commande, contrat, avenant) et « Clore » une commande : motif exigé. */
export const SalesContractReasonSchema = z
  .object({
    expectedRevision: SalesContractExpectedRevision,
    reason: salesContractRequiredText(L.reasonMax, 'Motif'),
  })
  .strict();

export const SalesContractSignatorySchema = z
  .object({
    name: salesContractRequiredText(L.signatoryNameMax, 'Nom du signataire'),
    title: salesContractOptionalText(L.signatoryTitleMax),
    side: z.enum(
      SALES_CONTRACT_SIGNATORY_SIDES,
      salesContractFr('Côté attendu : customer ou organization.'),
    ),
  })
  .strict();

/**
 * `POST …/signature` (contrat ou avenant) : date, au moins un signataire de chaque côté et
 * la copie signée DÉJÀ téléversée (`fileId` ; son absence est `422 SIGNED_COPY_REQUIRED`,
 * vérifiée par le service avec la pièce). La signature est **déclarée** (décision n° 6).
 */
export const SalesContractSignatureSchema = z
  .object({
    expectedRevision: SalesContractExpectedRevision,
    signedOn: SalesContractCalendarDay,
    signatories: z
      .array(SalesContractSignatorySchema)
      .max(L.signatoriesMax, { message: `${L.signatoriesMax} signataires au plus.` }),
    fileId: SalesContractId.nullable(),
  })
  .strict()
  .superRefine((b, ctx) => {
    for (const side of SALES_CONTRACT_SIGNATORY_SIDES) {
      if (!b.signatories.some((s) => s.side === side)) {
        salesContractIssue(
          ctx,
          'SIGNATORIES_REQUIRED',
          'Au moins un signataire du client et un de l’organisation.',
          ['signatories'],
        );
        return;
      }
    }
  });

/**
 * `POST /sales/contracts/:id/terminate` : la comparaison au préavis saisi (`noticeCheck`)
 * est AFFICHÉE, jamais un refus (§ 2.3, critère 14).
 */
export const SalesContractTerminateSchema = z
  .object({
    expectedRevision: SalesContractExpectedRevision,
    noticeGivenOn: SalesContractCalendarDay,
    by: z.enum(
      SALES_CONTRACT_TERMINATION_PARTIES,
      salesContractFr('Partie attendue : customer ou organization.'),
    ),
    effectiveOn: SalesContractCalendarDay,
    reason: salesContractRequiredText(L.reasonMax, 'Motif'),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.effectiveOn < b.noticeGivenOn) {
      salesContractIssue(
        ctx,
        'TERMINATION_BEFORE_NOTICE',
        'La date d’effet ne précède pas la notification.',
        ['effectiveOn'],
      );
    }
  });

// ── Corps : pièces et acomptes (§§ 2.6, 5.1, 5.2) ───────────────────────────

/** Métadonnées d'un téléversement ; type et taille réels contrôlés sur le fichier reçu. */
export const SalesContractFileMetaSchema = z
  .object({
    kind: z.enum(
      SALES_CONTRACT_FILE_KINDS,
      salesContractFr('Nature attendue : draft_copy, signed_copy ou customer_order.'),
    ),
    amendmentId: SalesContractId.nullable().optional(),
  })
  .strict()
  .transform((b) => ({ kind: b.kind, amendmentId: b.amendmentId ?? null }));

/** Groupe de taxation : une lettre de A à P (forme seulement ; ADR-0022). */
export const SalesContractTaxGroup = z
  .string(salesContractFr('Groupe de taxation obligatoire.'))
  .regex(/^[A-P]$/, { message: 'Groupe de taxation : une lettre de A à P.' });

/**
 * `POST /sales/{orders|contracts}/:id/prepare-deposit` — le groupe de taxation est EXIGÉ et
 * jamais prérempli (EC2, décision ouverte n° 12) ; aucun pourcentage.
 */
export const PrepareSalesDepositSchema = z
  .object({
    type: z.enum(SALES_DEPOSIT_INVOICE_TYPES, salesContractFr('Type attendu : FT ou ET.')),
    requestedAmount: SalesContractPositiveAmount,
    taxGroup: z.unknown().transform((raw, ctx): string => {
      if (raw === undefined || raw === null || raw === '') {
        salesContractIssue(
          ctx,
          'TAX_GROUP_REQUIRED',
          'Choisissez le groupe de taxation de l’acompte.',
        );
        return z.NEVER;
      }
      const parsed = SalesContractTaxGroup.safeParse(raw);
      if (!parsed.success) {
        salesContractIssue(ctx, 'UNKNOWN_TAX_GROUP', 'Groupe de taxation : une lettre de A à P.');
        return z.NEVER;
      }
      return parsed.data;
    }),
    label: salesContractOptionalText(L.labelMax).optional(),
  })
  .strict()
  .transform((b) => ({
    type: b.type,
    requestedAmount: b.requestedAmount,
    taxGroup: b.taxGroup,
    label: b.label ?? null,
  }));

/** `POST …/deposits/:invoiceId/resolved` : geste déclaratif, motif libre (§ 5.2). */
export const ResolveSalesDepositSchema = z
  .object({ reason: salesContractRequiredText(L.reasonMax, 'Motif') })
  .strict();

// ── Corps : réglages (§ 2.1) ────────────────────────────────────────────────

/** `PUT /sales/contract-settings` : corps COMPLET ; `sales.contract.approve`. */
export const SalesContractSettingsSchema = z
  .object({
    expectedRevision: SalesContractExpectedRevision.nullable(),
    noticeAlertDays: boundedInt(0, L.alertDaysMax, 'Alerte de préavis (jours)'),
    termEndAlertDays: boundedInt(0, L.alertDaysMax, 'Alerte de fin de terme (jours)'),
    subscriptionLeadDays: boundedInt(
      0,
      L.subscriptionLeadDaysMax,
      'Avance de préparation des brouillons (jours)',
    ),
    autoPrepareSubscriptionDrafts: z.boolean(
      salesContractFr('Préparation automatique : vrai ou faux.'),
    ),
    allowSoleApprover: z.boolean(salesContractFr('Approbateur unique : vrai ou faux.')),
  })
  .strict();

// ── Avenants (§ 2.5) ────────────────────────────────────────────────────────

/**
 * Champs du contrat qu'un avenant peut porter (contenu COMPLET : ce qui n'est pas fourni
 * est repris du contrat en vigueur). Les lignes restent opaques (schéma de facture, API).
 */
export const SalesContractAmendmentChangesSchema = z
  .object({
    lines: OpaqueLines.optional(),
    billing: SalesContractBillingSchema.optional(),
    initialTermMonths: SalesContractInitialTermMonths.optional(),
    renewal: SalesContractRenewalSchema.optional(),
    noticeDays: SalesContractNoticeDays.optional(),
    clauses: salesContractOptionalText(L.clausesMax).optional(),
  })
  .strict();

/** `POST /sales/contracts/:id/amendments` et `PUT …/amendments/:aid` (avec révision). */
export const SalesContractAmendmentSchema = z
  .object({
    expectedRevision: SalesContractExpectedRevision.optional(),
    effectiveDate: SalesContractCalendarDay,
    purpose: z.enum(
      SALES_CONTRACT_AMENDMENT_PURPOSES,
      salesContractFr('Objet attendu : change ou renewal.'),
    ),
    changes: SalesContractAmendmentChangesSchema,
  })
  .strict();

// ── En-têtes des documents (§§ 2.2, 2.3) ────────────────────────────────────

/**
 * Champs d'en-tête d'une commande client, hors document de vente. Les lots V2 et V3
 * ÉTENDENT cet objet avec `currency`, `priceMode`, `customer` et `lines`, validés par le
 * schéma du brouillon de facture côté API, puis appliquent `.strict()`.
 */
export const SALES_ORDER_HEADER_FIELDS = {
  customerReference: salesContractOptionalText(L.customerReferenceMax).optional(),
  orderedOn: SalesContractCalendarDay,
  opportunityId: SalesContractId.nullable().optional(),
  requestedDeliveryDate: SalesContractCalendarDay.nullable().optional(),
  notes: salesContractOptionalText(L.notesMax).optional(),
} as const;

/** Champs d'en-tête d'un contrat, hors document de vente (même usage). */
export const SALES_CONTRACT_HEADER_FIELDS = {
  title: salesContractRequiredText(L.titleMax, 'Titre du contrat'),
  opportunityId: SalesContractId.nullable().optional(),
  ownerUserId: SalesContractId.nullable().optional(),
  startDate: SalesContractCalendarDay,
  initialTermMonths: SalesContractInitialTermMonths,
  renewal: SalesContractRenewalSchema,
  noticeDays: SalesContractNoticeDays,
  billing: SalesContractBillingSchema,
  clauses: salesContractOptionalText(L.clausesMax).optional(),
} as const;
