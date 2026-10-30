// Données sensibles du collaborateur — corps d'écriture, lecture en clair et formes
// masquées (ADR-0045 § 2.4, § 3.1). ADR-0045 — H2.
//
// Le clair ne circule QUE dans deux sens : le corps d'un `PUT …/private/:section`
// (`hr.manage` ET `hr.sensitive.read`) et la réponse d'un `POST …/private/reveal`
// (`hr.sensitive.read`, ou le collaborateur lui-même ; audit strict, 30 par heure).
// Toute autre vue ne porte que les formes masquées (`EmployeePrivateSummary`) :
// jamais un montant, un numéro de compte ni un numéro de pièce. Validation de FORME
// seulement : aucune vérification auprès d'une banque, d'un opérateur ou d'un état civil.

import { z } from 'zod';

import {
  HrCalendarDay,
  HrCurrencySchema,
  HrPositiveAmount,
  hrFr,
  hrIssue,
  hrOptionalText,
  hrRequiredText,
} from './common.js';
import {
  HR_COMPENSATION_PERIODS,
  HR_ID_DOCUMENT_KINDS,
  HR_LIMITS,
  HR_PHONE_PATTERN,
  HR_PRIVATE_SECTIONS,
  type HrBankDetailKind,
  type HrCompensationPeriod,
  type HrCurrency,
  type HrIdDocumentKind,
} from './constants.js';

const L = HR_LIMITS;

/**
 * Champs chiffrés de `hr_employee_private` : les quatre sections, plus le motif
 * détaillé de sortie (`exitNote`, § 2.4 « Plus `exitNote` »), chiffré de la même façon.
 */
export const HR_PRIVATE_FIELDS = [...HR_PRIVATE_SECTIONS, 'exitNote'] as const;
export type HrPrivateField = (typeof HR_PRIVATE_FIELDS)[number];

export function isHrPrivateField(value: unknown): value is HrPrivateField {
  return typeof value === 'string' && (HR_PRIVATE_FIELDS as readonly string[]).includes(value);
}

const phone = (what: string) =>
  hrRequiredText(L.workPhone, what).superRefine((v, ctx) => {
    if (!HR_PHONE_PATTERN.test(v)) hrIssue(ctx, 'PHONE_INVALID', 'Numéro de téléphone invalide.');
  });

const optionalPhone = hrOptionalText(L.workPhone).superRefine((v, ctx) => {
  if (v !== null && !HR_PHONE_PATTERN.test(v)) {
    hrIssue(ctx, 'PHONE_INVALID', 'Numéro de téléphone invalide.');
  }
});

const optionalEmail = hrOptionalText(L.workEmail).superRefine((v, ctx) => {
  if (v !== null && !z.email().safeParse(v).success) {
    hrIssue(ctx, 'EMAIL_INVALID', 'Adresse e-mail invalide.');
  }
});

/** Numéro de compte, IBAN, BIC : lettres, chiffres, espaces et tirets (forme seulement). */
const accountText = (max: number, what: string) =>
  hrRequiredText(max, what).superRefine((v, ctx) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(v)) {
      hrIssue(ctx, 'ACCOUNT_INVALID', `${what} : lettres, chiffres, espaces et tirets.`);
    }
  });

// ── Sections (§ 2.4) ────────────────────────────────────────────────────────

/** Un salaire de base CONTRACTUEL, déclaré, jamais calculé. */
export const HrCompensationEntrySchema = z
  .object({
    effectiveFrom: HrCalendarDay,
    amount: HrPositiveAmount,
    currency: HrCurrencySchema,
    period: z.enum(HR_COMPENSATION_PERIODS, hrFr('Période attendue : month, day ou hour.')),
    note: hrOptionalText(L.compensationNote).optional(),
  })
  .strict();
export type HrCompensationEntry = z.output<typeof HrCompensationEntrySchema>;

export const HrCompensationSectionSchema = z
  .object({
    history: z
      .array(HrCompensationEntrySchema)
      .min(1, { message: 'Au moins un salaire est attendu.' })
      .max(L.compensationHistoryMax, {
        message: `${L.compensationHistoryMax} entrées au plus.`,
      }),
  })
  .strict()
  .superRefine((s, ctx) => {
    const dates = s.history.map((h) => h.effectiveFrom);
    if (new Set(dates).size !== dates.length) {
      hrIssue(
        ctx,
        'COMPENSATION_DATE_DUPLICATE',
        'Deux salaires ne prennent pas effet le même jour.',
      );
    }
  });
export type HrCompensationSection = z.output<typeof HrCompensationSectionSchema>;

const bankAccount = z
  .object({
    kind: z.literal('bank'),
    bankName: hrRequiredText(L.bankName, 'Banque'),
    holderName: hrRequiredText(L.holderName, 'Titulaire'),
    accountNumber: accountText(L.accountNumber, 'Numéro de compte'),
    iban: accountText(L.iban, 'IBAN').nullable().optional(),
    swift: accountText(L.swift, 'BIC').nullable().optional(),
  })
  .strict();

const mobileMoneyAccount = z
  .object({
    kind: z.literal('mobile_money'),
    operator: hrRequiredText(L.mobileOperator, 'Opérateur'),
    holderName: hrRequiredText(L.holderName, 'Titulaire'),
    phoneNumber: phone('Numéro'),
  })
  .strict();

/** Un moyen de paiement du collaborateur (forme seulement). */
export const HrBankAccountSchema = z.discriminatedUnion('kind', [bankAccount, mobileMoneyAccount]);
export type HrBankAccount = z.output<typeof HrBankAccountSchema>;

export const HrBankDetailsSectionSchema = z
  .object({
    accounts: z
      .array(HrBankAccountSchema)
      .max(L.bankDetailsMax, { message: `${L.bankDetailsMax} moyens de paiement au plus.` }),
  })
  .strict();
export type HrBankDetailsSection = z.output<typeof HrBankDetailsSectionSchema>;

export const HrIdDocumentSchema = z
  .object({
    kind: z.enum(HR_ID_DOCUMENT_KINDS, hrFr('Nature de pièce inconnue.')),
    number: hrRequiredText(L.idDocumentNumber, 'Numéro de pièce'),
    issuedOn: HrCalendarDay.nullable().optional(),
    expiresOn: HrCalendarDay.nullable().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.issuedOn && d.expiresOn && d.expiresOn < d.issuedOn) {
      hrIssue(ctx, 'ID_DOCUMENT_DATES', 'La date d’expiration précède la date de délivrance.', [
        'expiresOn',
      ]);
    }
  });
export type HrIdDocument = z.output<typeof HrIdDocumentSchema>;

export const HrIdentitySectionSchema = z
  .object({
    birthDate: HrCalendarDay.nullable().optional(),
    nationality: hrOptionalText(L.nationality).optional(),
    idDocuments: z
      .array(HrIdDocumentSchema)
      .max(L.idDocumentsMax, { message: `${L.idDocumentsMax} pièces au plus.` })
      .default([]),
  })
  .strict();
export type HrIdentitySection = z.output<typeof HrIdentitySectionSchema>;

export const HrEmergencyContactSchema = z
  .object({
    name: hrRequiredText(L.emergencyContactName, 'Nom'),
    relation: hrRequiredText(L.emergencyContactRelation, 'Lien'),
    phone: phone('Téléphone'),
  })
  .strict();

export const HrPersonalContactSectionSchema = z
  .object({
    address: hrOptionalText(L.address).optional(),
    personalPhone: optionalPhone.optional(),
    personalEmail: optionalEmail.optional(),
    emergencyContacts: z
      .array(HrEmergencyContactSchema)
      .max(L.emergencyContactsMax, { message: `${L.emergencyContactsMax} contacts au plus.` })
      .default([]),
  })
  .strict();
export type HrPersonalContactSection = z.output<typeof HrPersonalContactSectionSchema>;

export const HrExitNoteSectionSchema = z
  .object({ note: hrRequiredText(L.exitNote, 'Motif de sortie') })
  .strict();
export type HrExitNoteSection = z.output<typeof HrExitNoteSectionSchema>;

/** Contenu en clair de chaque champ chiffré. */
export interface HrPrivateSections {
  compensation: HrCompensationSection;
  bankDetails: HrBankDetailsSection;
  identity: HrIdentitySection;
  personalContact: HrPersonalContactSection;
  exitNote: HrExitNoteSection;
}

export const HR_PRIVATE_SECTION_SCHEMAS = {
  compensation: HrCompensationSectionSchema,
  bankDetails: HrBankDetailsSectionSchema,
  identity: HrIdentitySectionSchema,
  personalContact: HrPersonalContactSectionSchema,
  exitNote: HrExitNoteSectionSchema,
} as const;

/**
 * Corps de `PUT /hr/employees/:id/private/:section` (`hr.manage` + `hr.sensitive.read`).
 * `data: null` efface la section. `expectedRevision` : révision du dossier sensible
 * (`0` tant qu'aucune section n'a été écrite) → `409 STALE_REVISION`.
 */
export function updatePrivateSectionBody<F extends HrPrivateField>(field: F) {
  return z
    .object({
      data: HR_PRIVATE_SECTION_SCHEMAS[field].nullable(),
      expectedRevision: z
        .number(hrFr('Révision attendue : un entier.'))
        .int({ message: 'Révision attendue : un entier.' })
        .min(0),
    })
    .strict();
}
export interface UpdatePrivateSectionBody<F extends HrPrivateField = HrPrivateField> {
  data: HrPrivateSections[F] | null;
  expectedRevision: number;
}

/** Corps de `POST /hr/employees/:id/private/reveal`. */
export const RevealPrivateBody = z
  .object({
    sections: z
      .array(z.enum(HR_PRIVATE_FIELDS, hrFr('Section inconnue.')))
      .min(1, { message: 'Au moins une section.' })
      .max(HR_PRIVATE_FIELDS.length)
      .superRefine((list, ctx) => {
        if (new Set(list).size !== list.length) {
          hrIssue(ctx, 'SECTION_DUPLICATE', 'Une section n’est demandée qu’une fois.');
        }
      }),
  })
  .strict();
export type RevealPrivateBody = z.output<typeof RevealPrivateBody>;

// ── Vues ────────────────────────────────────────────────────────────────────

interface SectionStamp {
  changedAt: string;
  changedBy: string;
}

/** « Salaire renseigné depuis le … » : ni montant, ni devise. */
export interface HrCompensationMasked extends SectionStamp {
  /** Prise d'effet du salaire le plus récent. */
  since: string;
  entries: number;
}

export interface HrBankAccountMasked {
  kind: HrBankDetailKind;
  /** `Rawbank •••• 4521`, `M-Pesa •••• 78`. */
  masked: string;
  /** Empreinte HMAC, propre à l'organisation : signale un compte partagé. */
  fingerprint: string;
}

export interface HrBankDetailsMasked extends SectionStamp {
  accounts: HrBankAccountMasked[];
}

/** Type et date d'expiration seulement, jamais le numéro. */
export interface HrIdentityMasked extends SectionStamp {
  hasBirthDate: boolean;
  hasNationality: boolean;
  idDocuments: { kind: HrIdDocumentKind; expiresOn: string | null }[];
}

export interface HrPersonalContactMasked extends SectionStamp {
  hasAddress: boolean;
  hasPersonalPhone: boolean;
  hasPersonalEmail: boolean;
  emergencyContacts: number;
}

export interface HrExitNoteMasked extends SectionStamp {
  present: true;
}

/**
 * Formes masquées, lisibles sans `reveal` par un détenteur de `hr.sensitive.read` ou
 * par le collaborateur lui-même. `bankDetailsAlert` : bandeau de sept jours après un
 * changement de coordonnées bancaires (la fraude classique est le détournement du
 * salaire).
 */
export interface EmployeePrivateSummary {
  employeeId: string;
  /** Révision du dossier sensible ; `0` s'il n'existe pas encore. */
  revision: number;
  compensation: HrCompensationMasked | null;
  bankDetails: HrBankDetailsMasked | null;
  identity: HrIdentityMasked | null;
  personalContact: HrPersonalContactMasked | null;
  exitNote: HrExitNoteMasked | null;
  bankDetailsAlert: { changedAt: string; changedBy: string; until: string } | null;
}

/** Réponse de `reveal` : le clair des seules sections demandées (absentes → `null`). */
export interface EmployeePrivateRevealView {
  employeeId: string;
  revealedAt: string;
  sections: { [F in HrPrivateField]?: HrPrivateSections[F] | null };
}

/** Réexportés pour les écrans (libellés). */
export type { HrCompensationPeriod, HrCurrency };
