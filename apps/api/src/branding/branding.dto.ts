// Corps de requête de l'identité visuelle et du modèle de facture — ADR-0028 § 7.
// Schémas `.strict()` : un champ inconnu est refusé, jamais ignoré.

import { z } from 'zod';

import { BODY_FONT_IDS } from '../sales/documents/templates/invoice-fonts.js';
import {
  INVOICE_TEMPLATE_IDS,
  LOGO_VARIANTS,
  PALETTES,
} from '../sales/documents/templates/template.contract.js';

/** `#RRGGBB` accepté en majuscules ou minuscules, stocké en minuscules. */
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Couleur attendue au format #RRGGBB.')
  .transform((v) => v.toLowerCase());

export const PutBrandIdentitySchema = z
  .object({
    primaryColor: HexColorSchema.nullable(),
    secondaryColor: HexColorSchema.nullable(),
    font: z.enum(BODY_FONT_IDS).nullable(),
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export type PutBrandIdentityInput = z.infer<typeof PutBrandIdentitySchema>;

export const TemplateOptionsInputSchema = z
  .object({
    palette: z.enum(PALETTES).nullable(),
    accent: HexColorSchema.nullable(),
    /** Police ou paire ; contrôlée contre la liste du modèle choisi. */
    font: z.string().max(64).nullable(),
  })
  .strict();

export const PutInvoiceTemplateSchema = z
  .object({
    /** `null` : revenir à la présentation d'origine. */
    templateId: z.enum(INVOICE_TEMPLATE_IDS).nullable(),
    options: TemplateOptionsInputSchema,
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export type PutInvoiceTemplateInput = z.infer<typeof PutInvoiceTemplateSchema>;

/** Options d'un aperçu, en paramètres de requête (toutes facultatives). */
export const PreviewQuerySchema = z
  .object({
    palette: z.enum(PALETTES).optional(),
    accent: HexColorSchema.optional(),
    font: z.string().max(64).optional(),
  })
  .strict();

export const LogoVariantSchema = z.enum(LOGO_VARIANTS);
