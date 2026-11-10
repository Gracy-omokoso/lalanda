// Cartes de service (badge vérifiable) et cartes de visite — ADR-0069.
//
// Contrats partagés entre l'API (`apps/api/src/hr/cards/`) et l'interface. Aucune
// donnée sensible : nom, poste, matricule, coordonnées PROFESSIONNELLES, photo
// consentie. Le jeton de vérification n'est jamais un identifiant interne.

import { z } from 'zod';

import { HrId, hrFr, hrOptionalText } from './common.js';

/** Types de carte. */
export const CARD_KINDS = ['badge', 'business'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CARD_KIND_LABELS: Readonly<Record<CardKind, string>> = {
  badge: 'Carte de service',
  business: 'Carte de visite',
};

export const CARD_ORIENTATIONS = ['vertical', 'horizontal'] as const;
export type CardOrientation = (typeof CARD_ORIENTATIONS)[number];

/** Variante de couleur : marque, noir et blanc, fond sombre de marque. */
export const CARD_VARIANTS = ['brand', 'mono', 'inverse'] as const;
export type CardVariant = (typeof CARD_VARIANTS)[number];

export const CARD_VARIANT_LABELS: Readonly<Record<CardVariant, string>> = {
  brand: 'Couleurs de la marque',
  mono: 'Noir et blanc',
  inverse: 'Fond sombre',
};

export const CARD_FACES = ['recto', 'verso'] as const;
export type CardFace = (typeof CARD_FACES)[number];

/** Formats d'export : PDF (une page par face), PNG 300 dpi d'une face. */
export const CARD_EXPORT_FORMATS = ['pdf', 'png'] as const;
export type CardExportFormat = (typeof CARD_EXPORT_FORMATS)[number];

/** Formats d'un lot : PDF (pages), planche A4 2 × 5, archive ZIP de PNG. */
export const CARD_BATCH_FORMATS = ['pdf', 'sheet', 'png-zip'] as const;
export type CardBatchFormat = (typeof CARD_BATCH_FORMATS)[number];

/** Dimensions en millimètres (ADR-0069 § 1). */
export const CARD_DIMENSIONS: Readonly<
  Record<CardKind, { width: number; height: number; bleed: number; safe: number }>
> = {
  // ISO/IEC 7810 ID-1 (CR80).
  badge: { width: 85.6, height: 53.98, bleed: 0, safe: 3 },
  business: { width: 85, height: 55, bleed: 3, safe: 4 },
};

/** Côté minimal conseillé d'un QR imprimé (mm). */
export const CARD_QR_MIN_MM = 15;

/** Plafond d'un lot. */
export const CARD_BATCH_MAX = 100;

/** Bornes des textes de l'organisation imprimés sur les cartes. */
export const CARD_TEXT_MAX = 160;

/** Jeton de vérification : 18 octets aléatoires, 24 caractères base64url. */
export const CARD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/;

/** Modèle choisi : intégré (`badge-v-arche`…) ou paquet installé (`pkg:<packageId>`). */
export const CardTemplateRef = z
  .string(hrFr('Modèle attendu.'))
  .regex(/^(?:[a-z]+(?:-[a-z0-9]+)+|pkg:[0-9a-f]{32})$/, { message: 'Modèle inconnu.' });

const HEX = /^#[0-9a-f]{6}$/;

const kindSettings = z
  .object({
    templateId: CardTemplateRef.nullable(),
    variant: z.enum(CARD_VARIANTS, hrFr('Variante inconnue.')),
    accent: z.string().regex(HEX, { message: 'Couleur attendue au format #rrggbb.' }).nullable(),
  })
  .strict();

/** `PUT /hr/cards/settings`. */
export const PutCardSettingsBody = z
  .object({
    expectedRevision: z.number().int().min(0),
    badge: kindSettings,
    business: kindSettings,
    showEmployeeNumber: z.boolean(),
    badgeVerso: z.boolean(),
    vcardQr: z.boolean(),
    address: hrOptionalText(CARD_TEXT_MAX),
    website: hrOptionalText(CARD_TEXT_MAX),
    phone: hrOptionalText(CARD_TEXT_MAX),
    slogan: hrOptionalText(CARD_TEXT_MAX),
  })
  .strict();
export type PutCardSettingsInput = z.infer<typeof PutCardSettingsBody>;

/** `PUT /hr/employees/:id/card/consent`. */
export const PutCardConsentBody = z
  .object({
    expectedRevision: z.number().int().min(0),
    /** Consentement à la photo sur la carte. `false` : retrait, la photo est effacée. */
    photo: z.boolean(),
    /** Second accord : photo montrée sur la page publique de vérification. */
    photoPublic: z.boolean(),
  })
  .strict();
export type PutCardConsentInput = z.infer<typeof PutCardConsentBody>;

/** `POST /hr/employees/:id/card/issue` et `/revoke`. */
export const CardRevisionBody = z.object({ expectedRevision: z.number().int().min(0) }).strict();

/** Requête d'export d'une carte. */
export const CardExportQuery = z
  .object({
    kind: z.enum(CARD_KINDS, hrFr('Type de carte inconnu.')),
    format: z.enum(CARD_EXPORT_FORMATS, hrFr('Format inconnu.')).default('pdf'),
    face: z.enum(CARD_FACES, hrFr('Face inconnue.')).default('recto'),
    template: CardTemplateRef.optional(),
  })
  .strict();
export type CardExportInput = z.infer<typeof CardExportQuery>;

/** Aperçu d'un modèle avec des données fictives. */
export const CardPreviewQuery = z
  .object({
    format: z.enum(CARD_EXPORT_FORMATS, hrFr('Format inconnu.')).default('png'),
    face: z.enum(CARD_FACES, hrFr('Face inconnue.')).default('recto'),
    variant: z.enum(CARD_VARIANTS, hrFr('Variante inconnue.')).optional(),
  })
  .strict();

/** `POST /hr/cards/batch`. */
export const CardBatchBody = z
  .object({
    kind: z.enum(CARD_KINDS, hrFr('Type de carte inconnu.')),
    format: z.enum(CARD_BATCH_FORMATS, hrFr('Format inconnu.')),
    employeeIds: z
      .array(HrId)
      .min(1, { message: 'Choisissez au moins un collaborateur.' })
      .max(CARD_BATCH_MAX, { message: `${CARD_BATCH_MAX} collaborateurs au plus par lot.` }),
    template: CardTemplateRef.optional(),
  })
  .strict();
export type CardBatchInput = z.infer<typeof CardBatchBody>;

// ── Vues ────────────────────────────────────────────────────────────────────

export interface CardTemplateSummary {
  /** `badge-v-arche`, ou `pkg:<packageId>`. */
  id: string;
  kind: CardKind;
  orientation: CardOrientation;
  name: string;
  description: string;
  version: string;
  source: 'lalanda' | 'code' | 'designer';
}

export interface CardSettingsView {
  badge: { templateId: string; variant: CardVariant; accent: string | null };
  business: { templateId: string; variant: CardVariant; accent: string | null };
  showEmployeeNumber: boolean;
  badgeVerso: boolean;
  vcardQr: boolean;
  address: string | null;
  website: string | null;
  phone: string | null;
  slogan: string | null;
  revision: number;
  templates: CardTemplateSummary[];
  verifyBaseUrl: string;
  storageAvailable: boolean;
}

export interface CardProfileView {
  employeeId: string;
  photo: { contentType: string; width: number; height: number; byteSize: number } | null;
  consent: {
    photo: boolean;
    photoPublic: boolean;
    at: string | null;
    by: string | null;
  };
  verification: {
    issued: boolean;
    serial: number;
    issuedAt: string | null;
    /** URL encodée dans le QR (visible par les RH seulement). */
    url: string | null;
    revokedAt: string | null;
  };
  /** Statut que montrerait la page publique. */
  publicStatus: 'active' | 'inactive' | 'invalid';
  revision: number;
}

/** Réponse de la page publique (ADR-0069 § 4). */
export type PublicCardView =
  | { valid: false }
  | {
      valid: true;
      displayName: string;
      jobTitle: string;
      organization: {
        name: string;
        logoUrl: string | null;
        /** Favicon de l'organisation (ADR-0073 § 3), sinon celui de Lalanda. */
        faviconUrl?: string | null;
      };
      status: 'active' | 'inactive';
      statusLabel: string;
      photoUrl: string | null;
      checkedAt: string;
    };

export interface CardPackageView {
  packageId: string;
  templateRef: string;
  format: 'code' | 'designer';
  kind: CardKind;
  orientation: CardOrientation;
  id: string;
  name: string;
  version: string;
  contentSha256: string;
  byteSize: number;
  createdAt: string;
}
