// Vue du statut de complétude, `GET /organizations/current/setup` (ADR-0052 § 3).
// ADR-0052 — O0.
//
// Booléens et codes seulement : ni NIF, ni raison sociale, ni solde, ni nom de membre
// (critère 2). `.strict()` partout : un champ de valeur ajouté par mégarde fait échouer la
// validation de la réponse, donc les tests.

import { z } from 'zod';

import {
  ACCOUNTING_ACTIVE_MISSING_CODES,
  INVOICE_MISSING_CODES,
  NORMALIZE_MISSING_CODES,
  ORGANIZATION_SETUP_CAPABILITIES,
  ORGANIZATION_SETUP_STEP_IDS,
  ORGANIZATION_SETUP_STEP_LEVELS,
  ORGANIZATION_SETUP_STEP_MISSING_CODES,
  ORGANIZATION_SETUP_STEP_STATES,
} from './constants.js';

export const OrganizationSetupStepSchema = z
  .object({
    id: z.enum(ORGANIZATION_SETUP_STEP_IDS),
    state: z.enum(ORGANIZATION_SETUP_STEP_STATES),
    level: z.enum(ORGANIZATION_SETUP_STEP_LEVELS),
    requiredFor: z.array(z.enum(ORGANIZATION_SETUP_CAPABILITIES)),
    /** Vide quand `done` ; sinon le code de ce qui manque. */
    missing: z.array(z.enum(ORGANIZATION_SETUP_STEP_MISSING_CODES)),
    /** Droits EFFECTIFS de l'appelant sur l'écran de l'étape (ADR-0041). */
    canAct: z.boolean(),
  })
  .strict();
export type OrganizationSetupStep = z.infer<typeof OrganizationSetupStepSchema>;

export const OrganizationSetupViewSchema = z
  .object({
    organizationId: z.string().min(1),
    steps: z.array(OrganizationSetupStepSchema).length(ORGANIZATION_SETUP_STEP_IDS.length),
    capabilities: z
      .object({
        invoice: z
          .object({ ready: z.boolean(), missing: z.array(z.enum(INVOICE_MISSING_CODES)) })
          .strict(),
        normalize: z
          .object({
            /** Une facture peut être normalisée maintenant : activée ET prérequis R1 tenus. */
            ready: z.boolean(),
            /** Facture normalisée activée (sinon « prête à activer » quand `missing` est vide). */
            enabled: z.boolean(),
            missing: z.array(z.enum(NORMALIZE_MISSING_CODES)),
          })
          .strict(),
        accounting_active: z
          .object({
            /** L'activation serait acceptée maintenant (ou la comptabilité est déjà `active`). */
            ready: z.boolean(),
            /** Mode `active` en place. */
            active: z.boolean(),
            missing: z.array(z.enum(ACCOUNTING_ACTIVE_MISSING_CODES)),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type OrganizationSetupView = z.infer<typeof OrganizationSetupViewSchema>;
