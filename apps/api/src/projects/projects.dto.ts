import { z } from 'zod';

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  templateSlug: z.string().min(1).default('hello-world'),
  /**
   * Pays ISO-2 du projet (contexte fiscal). Défaut CD historique (S9-lite).
   * Le contrôleur remplace éventuellement par l'org.pays si non fourni.
   */
  pays: z.string().length(2).optional(),
  /** Slug du ParameterPack. Défaut = dérivé du `pays` par le contrôleur. */
  parameterPackSlug: z.string().min(1).optional(),
  /** Devise d'affichage. Défaut = devise principale du pack. */
  deviseAffichage: z.enum(['USD', 'CDF', 'XOF', 'XAF', 'EUR']).optional(),
  driverValues: z.record(z.string(), z.number().finite()).default({}),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const UpdateDriversSchema = z.object({
  driverValues: z.record(z.string(), z.number().finite()),
});

export const EvaluateProjectSchema = z.object({
  /** Surcharge one-shot des drivers (optionnel — sinon on utilise ceux du projet). */
  driverValues: z.record(z.string(), z.number().finite()).optional(),
  /** Si vrai, persiste les driverValues fournis dans le projet avant l'évaluation. */
  persist: z.boolean().default(false),
});
