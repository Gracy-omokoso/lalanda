// Documents RH générés : attestation de travail et certificat de travail — ADR-0072.
//
// Contrats partagés entre l'API (`apps/api/src/hr/generated-documents/`) et l'interface.
// Le certificat ne porte QUE les mentions de l'art. 79 du Code du travail (RDC) : aucun
// champ de ce contrat ne transporte un motif de sortie, une appréciation ou un salaire.

import { z } from 'zod';

import { HrCalendarDay, hrFr, hrIssue, hrOptionalText, hrRequiredText } from './common.js';

/** Types de document générés (extension prévue : contrats, avenants). */
export const GENERATED_DOCUMENT_KINDS = ['attestation', 'certificate'] as const;
export type GeneratedDocumentKind = (typeof GENERATED_DOCUMENT_KINDS)[number];

export const GENERATED_DOCUMENT_KIND_LABELS: Readonly<Record<GeneratedDocumentKind, string>> = {
  attestation: 'Attestation de travail',
  certificate: 'Certificat de travail',
};

/** Préfixe du numéro de pièce (`ATT-2026-0001`, `CT-2026-0001`). */
export const GENERATED_DOCUMENT_PREFIXES: Readonly<Record<GeneratedDocumentKind, 'ATT' | 'CT'>> = {
  attestation: 'ATT',
  certificate: 'CT',
};

/** Titres possibles d'une attestation. */
export const ATTESTATION_TITLES = ['work', 'employment'] as const;
export type AttestationTitle = (typeof ATTESTATION_TITLES)[number];
export const ATTESTATION_TITLE_LABELS: Readonly<Record<AttestationTitle, string>> = {
  work: 'Attestation de travail',
  employment: 'Attestation d’emploi',
};

/** Modèles Lalanda (A4). */
export const GENERATED_DOCUMENT_TEMPLATES = ['classique', 'bandeau', 'marge'] as const;
export type GeneratedDocumentTemplateId = (typeof GENERATED_DOCUMENT_TEMPLATES)[number];
export const GENERATED_DOCUMENT_TEMPLATE_LABELS: Readonly<
  Record<GeneratedDocumentTemplateId, string>
> = {
  classique: 'Classique — logo à gauche, filet de couleur',
  bandeau: 'Bandeau — en-tête plein à la couleur de la marque',
  marge: 'Marge — colonne de couleur à gauche',
};

export const GENERATED_DOCUMENT_LIMITS = Object.freeze({
  intro: 600,
  closing: 300,
  place: 80,
  signatoryName: 120,
  signatoryTitle: 120,
  socialSecurityNumber: 30,
  jobs: 10,
  jobTitle: 120,
  generationsPerHour: 30,
  previewsPerHour: 60,
});

/** Champs nommés acceptés dans les textes de l'attestation. */
export const GENERATED_DOCUMENT_FIELDS = ['nom', 'poste', 'date_entree', 'organisation'] as const;
export type GeneratedDocumentField = (typeof GENERATED_DOCUMENT_FIELDS)[number];

export const DEFAULT_ATTESTATION_INTRO =
  'Nous soussignés, {organisation}, attestons que {nom} fait partie de notre personnel depuis le {date_entree} et y occupe l’emploi de {poste}.';
export const DEFAULT_ATTESTATION_CLOSING =
  'La présente attestation est délivrée à l’intéressé(e) pour servir et valoir ce que de droit.';

/** Champs `{…}` d'un texte ; ceux qui ne sont pas connus sont rendus à part. */
export function placeholdersOf(text: string): { known: string[]; unknown: string[] } {
  const known: string[] = [];
  const unknown: string[] = [];
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    const name = m[1] ?? '';
    if ((GENERATED_DOCUMENT_FIELDS as readonly string[]).includes(name)) known.push(name);
    else unknown.push(name);
  }
  return { known, unknown };
}

// Caractères refusés dans un texte libre : balises et caractères de contrôle (sauf saut de ligne).
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[<>\u0000-\u0009\u000b-\u001f\u007f]/;

/** Texte libre borné, sans HTML, aux champs nommés connus ; vide → `null` (texte par défaut). */
function freeText(max: number) {
  return hrOptionalText(max).superRefine((v, ctx) => {
    if (v === null) return;
    if (FORBIDDEN_CHARS.test(v)) {
      hrIssue(ctx, 'GENERATED_DOC_TEXT_FORBIDDEN', 'Ni balise (< >) ni caractère de contrôle.');
      return;
    }
    const { unknown } = placeholdersOf(v);
    if (unknown.length > 0) {
      hrIssue(
        ctx,
        'GENERATED_DOC_UNKNOWN_FIELD',
        `Champ inconnu : {${unknown[0]}}. Champs possibles : ${GENERATED_DOCUMENT_FIELDS.map((f) => `{${f}}`).join(', ')}.`,
      );
    }
  });
}

/** Texte d'une ligne, sans HTML (lieu, signataire, intitulé d'emploi). */
function lineText(max: number, what: string) {
  return hrRequiredText(max, what).superRefine((v, ctx) => {
    if (FORBIDDEN_CHARS.test(v) || v.includes('\n')) {
      hrIssue(ctx, 'GENERATED_DOC_TEXT_FORBIDDEN', 'Ni balise (< >) ni caractère de contrôle.');
    }
  });
}

const L = GENERATED_DOCUMENT_LIMITS;

export const GeneratedDocumentSignatory = z
  .object({
    name: lineText(L.signatoryName, 'Nom du signataire'),
    title: lineText(L.signatoryTitle, 'Qualité du signataire'),
  })
  .strict();
export type GeneratedDocumentSignatory = z.output<typeof GeneratedDocumentSignatory>;

// ── Réglages ────────────────────────────────────────────────────────────────

/** `PUT /hr/generated-documents/settings` */
export const PutGeneratedDocumentSettingsBody = z
  .object({
    templateId: z.enum(GENERATED_DOCUMENT_TEMPLATES, hrFr('Modèle inconnu.')),
    place: hrOptionalText(L.place).superRefine((v, ctx) => {
      if (v !== null && FORBIDDEN_CHARS.test(v)) {
        hrIssue(ctx, 'GENERATED_DOC_TEXT_FORBIDDEN', 'Ni balise (< >) ni caractère de contrôle.');
      }
    }),
    signatory: GeneratedDocumentSignatory.nullable(),
    attestationIntro: freeText(L.intro),
    attestationClosing: freeText(L.closing),
    expectedRevision: z.number(hrFr('Révision attendue : un entier.')).int().min(0),
  })
  .strict();
export type PutGeneratedDocumentSettingsInput = z.output<typeof PutGeneratedDocumentSettingsBody>;

export interface GeneratedDocumentSettingsView {
  templateId: GeneratedDocumentTemplateId;
  place: string | null;
  signatory: GeneratedDocumentSignatory | null;
  /** `null` : texte par défaut. */
  attestationIntro: string | null;
  attestationClosing: string | null;
  defaults: { attestationIntro: string; attestationClosing: string };
  templates: Array<{ id: GeneratedDocumentTemplateId; label: string; version: number }>;
  fields: readonly GeneratedDocumentField[];
  revision: number;
}

// ── Génération ──────────────────────────────────────────────────────────────

export const CertificateJob = z
  .object({
    title: lineText(L.jobTitle, 'Intitulé de l’emploi'),
    from: HrCalendarDay,
    to: HrCalendarDay,
  })
  .strict()
  .superRefine((j, ctx) => {
    if (j.to < j.from) {
      hrIssue(ctx, 'DATE_BEFORE_START', 'La fin de l’emploi précède son début.', ['to']);
    }
  });
export type CertificateJob = z.output<typeof CertificateJob>;

const common = {
  templateId: z.enum(GENERATED_DOCUMENT_TEMPLATES, hrFr('Modèle inconnu.')).optional(),
  signatory: GeneratedDocumentSignatory,
  place: lineText(L.place, 'Lieu'),
  issuedOn: HrCalendarDay,
  /** Pièce visible du collaborateur (défaut : oui). */
  visibleToEmployee: z.boolean(hrFr('Booléen attendu.')).optional(),
};

const AttestationInput = z
  .object({
    kind: z.literal('attestation'),
    ...common,
    title: z.enum(ATTESTATION_TITLES, hrFr('Titre inconnu.')).optional(),
    includeContractType: z.boolean(hrFr('Booléen attendu.')).optional(),
    includeDepartment: z.boolean(hrFr('Booléen attendu.')).optional(),
    includeEmployeeNumber: z.boolean(hrFr('Booléen attendu.')).optional(),
    /** Donnée SENSIBLE (ADR-0045 § 2.4) : choix explicite, `hr.sensitive.read` requis. */
    includePersonalAddress: z.boolean(hrFr('Booléen attendu.')).optional(),
  })
  .strict();

const CertificateInput = z
  .object({
    kind: z.literal('certificate'),
    ...common,
    /** Emplois occupés (nature des services, art. 79) ; défaut : le poste de la fiche. */
    jobs: z.array(CertificateJob).min(1).max(L.jobs).optional(),
    /** Numéro d'immatriculation CNSS (art. 79) ; vide → « non communiqué ». */
    socialSecurityNumber: hrOptionalText(L.socialSecurityNumber)
      .superRefine((v, ctx) => {
        if (v !== null && !/^[0-9A-Za-z ./-]+$/.test(v)) {
          hrIssue(ctx, 'GENERATED_DOC_SSN_FORMAT', 'Chiffres, lettres, espaces, points ou tirets.');
        }
      })
      .optional(),
  })
  .strict();

/** `POST /hr/employees/:id/generated-documents` (et `/preview`). */
export const GenerateHrDocumentBody = z.discriminatedUnion('kind', [
  AttestationInput,
  CertificateInput,
]);
export type GenerateHrDocumentInput = z.output<typeof GenerateHrDocumentBody>;

/** Une pièce du registre. */
export interface GeneratedDocumentView {
  id: string;
  employeeId: string;
  kind: GeneratedDocumentKind;
  number: string;
  templateId: string;
  documentId: string;
  issuedOn: string;
  place: string;
  signatory: GeneratedDocumentSignatory;
  sensitive: boolean;
  createdBy: string;
  createdAt: string;
}

export interface GeneratedDocumentPage {
  items: GeneratedDocumentView[];
}

/** Durée entre deux jours inclus, en années, mois et jours (calendrier civil). */
export function serviceDuration(
  from: string,
  to: string,
): { years: number; months: number; days: number } {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  // `to` inclus : la borne de fin exclusive est le lendemain.
  const end = Date.UTC(ty, tm - 1, td + 1);
  /** `from` + n mois, jour ramené au dernier jour du mois s'il n'existe pas (31 → 28). */
  const plusMonths = (n: number): number => {
    const last = new Date(Date.UTC(fy, fm - 1 + n + 1, 0)).getUTCDate();
    return Date.UTC(fy, fm - 1 + n, Math.min(fd, last));
  };
  let total = Math.max(0, (ty - fy) * 12 + (tm - fm) - 1);
  while (plusMonths(total + 1) <= end) total += 1;
  while (total > 0 && plusMonths(total) > end) total -= 1;
  const days = Math.round((end - plusMonths(total)) / 86_400_000);
  const years = Math.floor(total / 12);
  const months = total % 12;
  return { years, months, days };
}

/** « 2 ans, 3 mois et 4 jours » (termes nuls omis ; « moins d'un jour » impossible : `to` inclus). */
export function serviceDurationLabel(d: { years: number; months: number; days: number }): string {
  const parts: string[] = [];
  if (d.years) parts.push(`${d.years} an${d.years > 1 ? 's' : ''}`);
  if (d.months) parts.push(`${d.months} mois`);
  if (d.days) parts.push(`${d.days} jour${d.days > 1 ? 's' : ''}`);
  if (parts.length === 0) return '0 jour';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
}

/** Numéro de pièce : `ATT-2026-0001` (au moins quatre chiffres). */
export function generatedDocumentNumber(
  kind: GeneratedDocumentKind,
  year: number,
  seq: number,
): string {
  return `${GENERATED_DOCUMENT_PREFIXES[kind]}-${year}-${String(seq).padStart(4, '0')}`;
}
