// Corps de requête de l'Idea Lab (ADR-0036 § 6). Tous `.strict()` : un champ
// inconnu est refusé (400), jamais ignoré. Un montant est une chaîne décimale
// (docs/26). Une taille de marché sans source est refusée (ADR-0036 § 2.3) ; une
// note sans preuve aussi (§ 2.2).

import {
  IDEA_EXPERIMENT_CONCLUSIONS,
  IDEA_EXPERIMENT_STATUSES,
  IDEA_EXPERIMENT_TYPES,
  IDEA_NOTE_MAX,
  IDEA_PROOF_MIN_LENGTH,
} from '@lalanda/engine';
import { BadRequestException } from '@nestjs/common';
import { z, type ZodError } from 'zod';

import { IDEA_HYPOTHESIS_STATUSES, MARKET_SIZE_UNITS } from './idea-lab.schemas.js';
import { typeMessages } from '../validation/zod-compat.js';

export const OBJECT_ID = /^[0-9a-f]{24}$/;
/** Identifiants générés par le client (hypothèses) ou le serveur (expériences). */
const LOCAL_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const DECIMAL = /^\d{1,15}(\.\d{1,2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

/** Bornes techniques (ADR-0036 § 1) — anti-abus, pas des règles commerciales. */
export const MAX_IDEAS_PER_ORGANIZATION = 50;
export const MAX_EXPERIMENTS_PER_IDEA = 30;
export const MAX_COUNT = 10_000_000;

const text = (max: number) => z.string().trim().max(max, `${max} caractères au plus.`);

const AlternativeSchema = z
  .object({
    name: z.string().trim().min(1, 'Nom de l’alternative requis.').max(120),
    description: text(500).default(''),
    source: text(300)
      .nullable()
      .default(null)
      .transform((s) => (s === '' ? null : s)),
  })
  .strict();

const HypothesisSchema = z
  .object({
    id: z.string().regex(LOCAL_ID, 'Identifiant d’hypothèse invalide.'),
    text: z.string().trim().min(1, 'Hypothèse vide.').max(300),
    status: z.enum(IDEA_HYPOTHESIS_STATUSES).default('a_tester'),
  })
  .strict();

export const MarketSizeSchema = z
  .object({
    value: z.string().regex(DECIMAL, 'Valeur positive, deux décimales au plus (ex. « 125000 »).'),
    unit: z.enum(MARKET_SIZE_UNITS),
    currency: z
      .string()
      .regex(CURRENCY, 'Code de devise ISO à trois lettres.')
      .nullable()
      .default(null),
    scope: z.string().trim().min(1, 'Dites ce qui est compté (périmètre).').max(300),
    source: z
      .string({
        error: typeMessages({ required: 'La source de la taille de marché est obligatoire.' }),
      })
      .trim()
      .min(3, 'La source de la taille de marché est obligatoire.')
      .max(300),
    sourceDate: z.string().regex(ISO_DATE, 'Date AAAA-MM-JJ.').nullable().default(null),
    sourceUrl: z
      .string()
      .trim()
      .max(500)
      .regex(/^https?:\/\/\S+$/, 'Adresse web (http ou https).')
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.unit === 'montant' && m.currency === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Un marché exprimé en montant porte sa devise.',
      });
    }
    if (m.unit !== 'montant' && m.currency !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'La devise ne s’applique qu’à un marché exprimé en montant.',
      });
    }
  });

export const IdeaFicheSchema = z
  .object({
    title: z.string().trim().min(1, 'Titre requis.').max(120),
    problem: text(1000).default(''),
    target: text(1000).default(''),
    solution: text(1000).default(''),
    alternatives: z.array(AlternativeSchema).max(10, '10 alternatives au plus.').default([]),
    revenueModel: text(1000).default(''),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/, 'Code pays ISO à deux lettres.')
      .nullable()
      .default(null),
    market: text(300).default(''),
    hypotheses: z
      .array(HypothesisSchema)
      .max(20, '20 hypothèses au plus.')
      .default([])
      .refine((h) => new Set(h.map((x) => x.id)).size === h.length, 'Hypothèses en double.'),
    marketSize: MarketSizeSchema.nullable().default(null),
  })
  .strict();
export type IdeaFiche = z.infer<typeof IdeaFicheSchema>;

export const ArchivedSchema = z.object({ archived: z.boolean() }).strict();

export const RatingSchema = z
  .object({
    note: z.number().int('Note entière.').min(0).max(IDEA_NOTE_MAX),
    proof: z
      .string({ error: typeMessages({ required: 'Une note s’accompagne de sa preuve.' }) })
      .trim()
      .min(IDEA_PROOF_MIN_LENGTH, 'Une note s’accompagne de sa preuve.')
      .max(1000),
    experimentIds: z.array(z.string().regex(LOCAL_ID)).max(5, '5 expériences au plus.').default([]),
  })
  .strict();
export type RatingBody = z.infer<typeof RatingSchema>;

const count = z.number().int().min(0).max(MAX_COUNT).nullable().default(null);

const ResultsSchema = z
  .object({
    realises: count,
    confirmant: count,
    visiteurs: count,
    inscrits: count,
    sollicites: count,
    precommandes: count,
    montant: z
      .string()
      .regex(DECIMAL, 'Montant positif, deux décimales au plus.')
      .nullable()
      .default(null),
    devise: z
      .string()
      .regex(CURRENCY, 'Code de devise ISO à trois lettres.')
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((r, ctx) => {
    if ((r.montant === null) !== (r.devise === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['devise'],
        message: 'Un montant déclaré porte sa devise, et une devise son montant.',
      });
    }
  });

export const ExperimentSchema = z
  .object({
    type: z.enum(IDEA_EXPERIMENT_TYPES),
    title: z.string().trim().min(1, 'Titre requis.').max(120),
    hypothesis: text(500).default(''),
    targetPct: z.number().int().min(0).max(100).nullable().default(null),
    status: z.enum(IDEA_EXPERIMENT_STATUSES).default('a_faire'),
    results: ResultsSchema.prefault({}),
    conclusion: z.enum(IDEA_EXPERIMENT_CONCLUSIONS).nullable().default(null),
    notes: text(2000).default(''),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.status === 'terminee' && e.conclusion === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['conclusion'],
        message: 'Une expérience terminée porte sa conclusion.',
      });
    }
    if (e.status !== 'terminee' && e.conclusion !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['conclusion'],
        message: 'Une conclusion ne se pose que sur une expérience terminée.',
      });
    }
  });
export type ExperimentBody = z.infer<typeof ExperimentSchema>;

export const PromoteSchema = z
  .object({ projectId: z.string().regex(OBJECT_ID, 'Identifiant de projet invalide.') })
  .strict();

export const SettingsSchema = z.object({ aiEnabled: z.boolean() }).strict();

export function parseBody<T>(schema: z.ZodType<T, unknown>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalidRequest(parsed.error);
  return parsed.data;
}

export function invalidRequest(error: ZodError): never {
  throw new BadRequestException({
    code: 'INVALID_REQUEST',
    message: error.issues[0]?.message ?? 'Corps de requête invalide.',
    details: {
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    },
  });
}
