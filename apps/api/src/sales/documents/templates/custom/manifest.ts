// Manifeste d'un paquet de modèle (format 1) — ADR-0029 § 2.
//
// Schéma STRICT : un champ inconnu est refusé, jamais ignoré (un paquet écrit
// pour un format futur ne doit pas être accepté à moitié). Les champs de la
// place de marché (`publisher`, `license`, `price`, `signature`) sont lus et
// contrôlés dès aujourd'hui ; `signature` doit valoir `null` tant qu'aucune
// signature n'est vérifiée.

import { z } from 'zod';

import { BODY_FONT_IDS, EDITORIAL_FONT_PAIRS } from '../invoice-fonts.js';
import { PALETTES } from '../template.contract.js';

export const MANIFEST_FORMAT = 'lalanda.modele-facture';
export const MANIFEST_FORMAT_VERSION = 1;
/** Versions MAJEURES du contrat de données que ce moteur sait servir. */
export const SUPPORTED_CONTRACTS = [1] as const;

/** `éditeur.nom` : minuscules, chiffres, tirets, au moins un point. */
export const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
/** SemVer strict `MAJEUR.MINEUR.CORRECTIF`, sans zéro de tête. */
export const SEMVER = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** Identifiant SPDX simple (`MIT`, `CC-BY-4.0`) ou `proprietary`. */
const LICENSE = /^(proprietary|[A-Za-z0-9][A-Za-z0-9.+-]{1,63})$/;

export const BUILTIN_FONT_CHOICES: readonly string[] = [...BODY_FONT_IDS, ...EDITORIAL_FONT_PAIRS];

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      // eslint-disable-next-line no-control-regex -- refus délibéré des caractères de contrôle (ADR-0029).
      (s) => !/[\u0000-\u001f\u007f<>]/.test(s),
      'Caractères « < », « > » ou de contrôle interdits.',
    );

const url = z
  .string()
  .max(200)
  .regex(/^https:\/\/[^\s<>"']+$/, 'Adresse https:// attendue.');

const Person = z
  .object({
    name: text(120),
    email: z.string().email().max(200).nullable().optional(),
    url: url.nullable().optional(),
  })
  .strict();

const Publisher = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Identifiant d’éditeur : minuscules, chiffres, tirets.'),
    name: text(120),
    url: url.nullable().optional(),
  })
  .strict();

const Price = z
  .object({
    amount: z.string().regex(/^\d{1,7}\.\d{2}$/, 'Montant attendu au format « 25.00 ».'),
    currency: z.enum(['USD', 'CDF']),
  })
  .strict();

export const FontDeclarationSchema = z
  .object({
    family: text(64)
      .refine(
        (s) => /^[A-Za-z0-9 -]+$/.test(s),
        'Nom de famille : lettres, chiffres, espaces, tirets.',
      )
      .refine((s) => !/^lalanda/i.test(s), 'Les noms commençant par « Lalanda » sont réservés.'),
    file: z
      .string()
      .regex(/^polices\/[a-z0-9][a-z0-9._-]*\.woff2$/, 'Chemin attendu : polices/<nom>.woff2.'),
    weight: z
      .number()
      .int()
      .min(100)
      .max(900)
      .refine((n) => n % 100 === 0, 'Graisse : 100, 200… 900.'),
    style: z.enum(['normal', 'italic']),
  })
  .strict();

export const ManifestSchema = z
  .object({
    format: z.literal(MANIFEST_FORMAT),
    formatVersion: z.literal(MANIFEST_FORMAT_VERSION),
    id: z
      .string()
      .min(3)
      .max(64)
      .regex(TEMPLATE_ID, 'Identifiant attendu : « editeur.nom » (minuscules, chiffres, tirets).'),
    name: text(60),
    description: text(280),
    version: z
      .string()
      .regex(SEMVER, 'Version SemVer attendue : MAJEUR.MINEUR.CORRECTIF (ex. 1.0.0).'),
    contract: z
      .number()
      .int()
      .refine((n) => (SUPPORTED_CONTRACTS as readonly number[]).includes(n), {
        message: `Contrat de données non pris en charge (attendu : ${SUPPORTED_CONTRACTS.join(', ')}).`,
      }),
    author: Person,
    publisher: Publisher.nullable(),
    license: z.string().regex(LICENSE, 'Licence : identifiant SPDX (ex. MIT) ou « proprietary ».'),
    price: Price.nullable(),
    options: z
      .object({
        palettes: z.array(z.enum(PALETTES)).min(1).max(PALETTES.length),
        accent: z.string().regex(HEX, 'Couleur attendue au format #RRGGBB.'),
        fonts: z
          .array(
            z.string().refine((s) => BUILTIN_FONT_CHOICES.includes(s), {
              message: `Police intégrée inconnue. Choix : ${BUILTIN_FONT_CHOICES.join(', ')}.`,
            }),
          )
          .min(1)
          .max(BUILTIN_FONT_CHOICES.length),
        font: z.string(),
      })
      .strict()
      .superRefine((o, ctx) => {
        if (!o.fonts.includes(o.font)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['font'],
            message: 'La police par défaut doit figurer dans « fonts ».',
          });
        }
        if (
          new Set(o.palettes).size !== o.palettes.length ||
          new Set(o.fonts).size !== o.fonts.length
        ) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Valeur en double.' });
        }
      }),
    fonts: z.array(FontDeclarationSchema).max(6),
    signature: z.null({
      invalid_type_error:
        'Aucune signature n’est encore vérifiée par Lalanda : « signature » doit valoir null.',
    }),
  })
  .strict();

export type TemplateManifest = z.infer<typeof ManifestSchema>;
