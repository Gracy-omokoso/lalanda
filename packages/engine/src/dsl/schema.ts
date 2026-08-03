// Schéma Zod du DSL de template Lalanda.
// Voir brief §7 pour la spécification complète.
// S1 : sous-ensemble minimal (drivers scalaires, formules ponctuelles, pas de temporalité, pas de custom functions).

import { z } from 'zod';

// ─── Identifiants ─────────────────────────────────────────────
// Snake_case ASCII, [a-z0-9_], commence par une lettre, 1..64 chars.
const IdSchema = z
  .string()
  .min(1, 'identifiant vide')
  .max(64, 'identifiant trop long (>64)')
  .regex(/^[a-z][a-z0-9_]*$/, 'identifiant invalide (attendu : ^[a-z][a-z0-9_]*$)');

// ─── Types de drivers ─────────────────────────────────────────
const DriverTypeSchema = z.enum(['number', 'percent', 'money']);
export type DriverType = z.infer<typeof DriverTypeSchema>;

const CurrencySchema = z.enum(['USD', 'CDF']);

// Un driver scalaire — la temporalité (mensualisation) arrive en S2.
const DriverSchema = z
  .object({
    id: IdSchema,
    groupe: IdSchema.optional(),
    label: z.string().min(1).optional(),
    type: DriverTypeSchema.default('number'),
    devise: CurrencySchema.optional(),
    defaut: z.number().finite().optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    unite: z.string().optional(),
    aide: z.string().optional(),
  })
  .strict();

export type Driver = z.infer<typeof DriverSchema>;

// ─── Groupes d'hypothèses (organisation UI, pas de sémantique de calcul) ─────
const GroupeSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1),
  })
  .strict();

// ─── Feuilles et lignes ───────────────────────────────────────
// S1 : uniquement des feuilles calculées avec des lignes explicites.
// Les feuilles typées (syscohada_resultat, cashflow_mensuel, syscohada_bilan) arriveront à partir de S2/S7.
const LigneSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1).optional(),
    /**
     * Expression source dans le DSL. Peut référencer un `driver.id`, une autre `ligne.id`,
     * et utiliser les opérateurs `+ - * / ^` avec parenthèses.
     * S1 n'accepte AUCUNE fonction custom.
     */
    formule: z.string().min(1),
    format: z.enum(['money', 'number', 'percent']).default('number'),
  })
  .strict();

export type Ligne = z.infer<typeof LigneSchema>;

const FeuilleSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1).optional(),
    lignes: z.array(LigneSchema).min(1, 'une feuille doit contenir au moins une ligne'),
  })
  .strict();

export type Feuille = z.infer<typeof FeuilleSchema>;

// ─── Template racine ──────────────────────────────────────────
// Conforme au brief §7 pour les champs présents ; les champs futurs (parameter_pack,
// horizon_mois, sorties…) sont acceptés en optionnel — ils seront exploités à partir de S2/S7.
export const TemplateSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*$/, 'slug invalide (attendu : ^[a-z][a-z0-9-]*$)'),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'version invalide (attendu : semver majeur.mineur.patch)'),
    secteur: z.string().optional(),
    pays: z.array(z.string().length(2)).optional(),
    devise_base: CurrencySchema.optional(),
    horizon_mois: z.number().int().positive().max(120).optional(),
    parameter_pack: z.string().optional(),
    groupes_hypotheses: z.array(GroupeSchema).optional(),
    drivers: z.array(DriverSchema).min(1, 'au moins un driver requis'),
    feuilles: z.array(FeuilleSchema).min(1, 'au moins une feuille requise'),
    sorties: z.array(IdSchema).optional(),
  })
  .strict();

export type Template = z.infer<typeof TemplateSchema>;

// ─── Validation croisée (unicité des id) ──────────────────────
// Ces vérifications ne sont pas exprimables en Zod pur → helper séparé.

import { DuplicateIdError, type EngineError } from './errors.js';

export interface CollectedIds {
  readonly drivers: ReadonlySet<string>;
  readonly lignes: ReadonlySet<string>;
  readonly feuilles: ReadonlySet<string>;
  readonly groupes: ReadonlySet<string>;
}

/**
 * Parcourt le template déjà validé par Zod et lève une {@link DuplicateIdError}
 * dès qu'un identifiant est réutilisé au sein de la même catégorie ou entre driver/ligne
 * (les deux vivent dans le même espace de noms de formules).
 */
export function collectIds(template: Template): CollectedIds {
  const drivers = new Set<string>();
  const lignes = new Set<string>();
  const feuilles = new Set<string>();
  const groupes = new Set<string>();

  for (const g of template.groupes_hypotheses ?? []) {
    if (groupes.has(g.id)) throw new DuplicateIdError('groupe', g.id);
    groupes.add(g.id);
  }
  for (const d of template.drivers) {
    if (drivers.has(d.id)) throw new DuplicateIdError('driver', d.id);
    drivers.add(d.id);
  }
  for (const f of template.feuilles) {
    if (feuilles.has(f.id)) throw new DuplicateIdError('feuille', f.id);
    feuilles.add(f.id);
    for (const l of f.lignes) {
      if (lignes.has(l.id) || drivers.has(l.id)) {
        // Un id de ligne ne peut pas doubler un id de driver — sinon les formules deviennent ambiguës.
        throw new DuplicateIdError('ligne', l.id);
      }
      lignes.add(l.id);
    }
  }

  return { drivers, lignes, feuilles, groupes };
}

export { DuplicateIdError, type EngineError };
