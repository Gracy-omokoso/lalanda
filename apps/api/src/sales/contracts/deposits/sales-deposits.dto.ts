// Corps des routes d'acompte — ADR-0050 § 5.1, § 5.2. ADR-0050 — V4.
//
// Les corps partagés (`PrepareSalesDepositSchema`, `ResolveSalesDepositSchema`, lot V0)
// sont repris tels quels ; la révision attendue de l'engagement (`expectedRevision`,
// `409 STALE_REVISION`) s'y ajoute, comme pour `prepare-invoice`. Le groupe de taxation
// reste EXIGÉ et jamais prérempli (`400 TAX_GROUP_REQUIRED`) ; aucun pourcentage.

import {
  PrepareSalesDepositSchema,
  ResolveSalesDepositSchema,
  SalesContractExpectedRevision,
} from '@lalanda/shared/sales-contracts';
import { z } from 'zod';

/** Ajoute `expectedRevision` (entier ≥ 1, exigé) à un corps strict partagé. */
function withExpectedRevision<T>(schema: z.ZodType<T>) {
  return z.unknown().transform((raw, ctx): T & { expectedRevision: number } => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Corps attendu : un objet JSON.',
        params: { code: 'INVALID_TYPE' },
      });
      return z.NEVER;
    }
    const { expectedRevision, ...rest } = raw as Record<string, unknown>;
    const revision = SalesContractExpectedRevision.safeParse(expectedRevision);
    if (!revision.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedRevision'],
        message: 'Révision attendue : un entier.',
        params: { code: expectedRevision === undefined ? 'FIELD_REQUIRED' : 'INVALID_TYPE' },
      });
    }
    const body = schema.safeParse(rest);
    if (!body.success) {
      for (const i of body.error.issues) ctx.addIssue({ ...i } as z.core.$ZodRawIssue);
    }
    if (!revision.success || !body.success) return z.NEVER;
    return { ...body.data, expectedRevision: revision.data };
  });
}

/** `POST /sales/{orders|contracts}/:id/prepare-deposit`. */
export const PrepareDepositBodySchema = withExpectedRevision(PrepareSalesDepositSchema);
export type PrepareDepositInput = z.output<typeof PrepareDepositBodySchema>;

/** `POST /sales/{orders|contracts}/:id/deposits/:invoiceId/resolved`. */
export const ResolveDepositBodySchema = withExpectedRevision(ResolveSalesDepositSchema);
export type ResolveDepositInput = z.output<typeof ResolveDepositBodySchema>;
