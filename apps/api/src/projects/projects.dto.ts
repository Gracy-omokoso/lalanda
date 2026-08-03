import { z } from 'zod';

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  templateSlug: z.string().min(1).default('hello-world'),
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
