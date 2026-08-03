// DTO d'entrée/sortie pour POST /evaluate.
// La validation stricte se fait via Zod (moteur), pas via class-validator, pour rester cohérent.

import { z } from 'zod';

export const EvaluateRequestSchema = z.object({
  /** Slug d'un template connu. S3-lite : uniquement `hello-world`. */
  templateSlug: z.string().min(1).default('hello-world'),
  /** Map driver.id → valeur. Les drivers absents utilisent le `defaut` du template. */
  drivers: z.record(z.string(), z.number().finite()).default({}),
});

export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>;

export interface EvaluateResponseLine {
  sheetId: string;
  lineId: string;
  label: string;
  formulaSource: string;
  value: number;
  format: 'money' | 'number' | 'percent';
}

export interface EvaluateResponse {
  templateSlug: string;
  templateVersion: string;
  drivers: Record<string, number>;
  lines: EvaluateResponseLine[];
}
