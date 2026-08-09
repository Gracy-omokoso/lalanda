// Contrats d'entrée et de sortie du module `scenarios` (ADR-0015 §3.1).
//
// Ce fichier est livré par le lot 1-A AVANT les routes (lot 1-B) : c'est
// délibéré. Les lots 2, 3 et 4 démarrent contre ces types, sans attendre les
// contrôleurs. Toute modification ultérieure d'une de ces formes casse un lot
// parallèle — elles se traitent donc comme un contrat public.

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Types de vue (sortie)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scénario tel qu'exposé par l'API.
 *
 * Les dates sont des chaînes ISO, comme partout ailleurs dans l'API : un
 * `Date` sérialisé par Nest l'est de toute façon, et le typer ainsi évite qu'un
 * consommateur croie manipuler un objet `Date`.
 */
export interface ScenarioView {
  id: string;
  organizationId: string;
  projectId: string;
  key: string;
  label: string;
  description: string | null;
  isReference: boolean;
  driverValues: Record<string, number>;
  driversUpdatedBy: string | null;
  driversUpdatedAt: string | null;
  createdBy: string;
  ordre: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Forme allégée pour les listes et les en-têtes de colonnes de la comparaison.
 *
 * `driverValues` en est ABSENT : une liste de trois scénarios traînerait sinon
 * 60 valeurs qu'aucun appelant de liste ne lit. Le détail se demande scénario
 * par scénario.
 */
export type ScenarioSummaryView = Omit<
  ScenarioView,
  'driverValues' | 'driversUpdatedBy' | 'driversUpdatedAt'
>;

// ─────────────────────────────────────────────────────────────────────────────
// Schémas d'entrée
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slug de scénario. Même expression que le schéma Mongoose — la validation est
 * dupliquée à dessein : zod rend le refus explicite en 400 `INVALID_REQUEST`,
 * Mongoose empêche qu'un chemin d'écriture oublié passe à travers.
 */
export const SCENARIO_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

export const ScenarioKeySchema = z.string().min(1).max(40).regex(SCENARIO_KEY_PATTERN);

export const CreateScenarioSchema = z
  .object({
    /** Absente → dérivée du `label` par le service (voir `slugifyKey`). */
    key: ScenarioKeySchema.optional(),
    label: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    /**
     * Duplique les `driverValues` d'un scénario existant — c'est le parcours
     * attendu (« pars de la base, dégrade le CA de 20 % ») et il évite de faire
     * ressaisir 18 à 21 drivers. Absent → `{}`, donc les défauts du template.
     */
    copyFrom: z.string().min(1).optional(),
  })
  .strict();
export type CreateScenarioBody = z.infer<typeof CreateScenarioSchema>;

/**
 * `key` n'est pas modifiable : elle est citée dans les URL et FIGÉE dans les
 * plans validés (`FinancialPlan.scenarioKey`, lot 3). La renommer ferait mentir
 * des snapshots qui ne se réécrivent jamais.
 */
export const UpdateScenarioSchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    description: z.string().max(500).optional(),
    ordre: z.number().int().min(0).max(999).optional(),
  })
  .strict();
export type UpdateScenarioBody = z.infer<typeof UpdateScenarioSchema>;

export const UpdateScenarioDriversSchema = z
  .object({
    driverValues: z.record(z.string(), z.number().finite()),
  })
  .strict();
export type UpdateScenarioDriversBody = z.infer<typeof UpdateScenarioDriversSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Constantes du scénario de référence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clé et libellé du scénario créé d'office pour tout projet — à la création
 * (lot 1), par la migration `20260809-0001` pour les projets existants, et par
 * `ensureReference` en réparation.
 *
 * Les trois chemins DOIVENT écrire la même chose : c'est la raison d'être de ces
 * constantes. La migration, elle, ne peut pas les importer (une migration
 * n'utilise que le driver `mongodb` brut, jamais les schémas applicatifs, cf.
 * `apps/api/migrations/README.md`) : elle les recopie et le dit.
 */
export const SCENARIO_REFERENCE_KEY = 'base';
export const SCENARIO_REFERENCE_LABEL = 'Scénario de base';
