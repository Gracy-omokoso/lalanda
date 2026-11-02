// Vocabulaire du statut de complétude (ADR-0052 § 2 et § 3). ADR-0052 — O0.
//
// Aucune règle fiscale ni juridique n'est posée ici : les niveaux reprennent la colonne
// « Statut » de l'ADR, et le seul verrou d'émission est celui que le serveur applique déjà
// (`FISCAL_PROFILE_REQUIRED`, décision ouverte n° 2, valeur par défaut).

import { ACCOUNTING_ACTIVATION_MISSING_CODES } from '../accounting/constants.js';

/** Les neuf étapes, dans l'ordre conseillé (décision ouverte n° 1 : ordre libre). */
export const ORGANIZATION_SETUP_STEP_IDS = [
  'societe',
  'fiscal',
  'devises',
  'identite',
  'normalisation',
  'tresorerie',
  'comptabilite',
  'equipe',
  'modules',
] as const;
export type OrganizationSetupStepId = (typeof ORGANIZATION_SETUP_STEP_IDS)[number];

/**
 * `done` : la donnée existe (lue sur le serveur) ; `todo` : elle manque ; `deferred` :
 * « pas maintenant » déclaré (§ 4, collection `organization_setup`, lot O2) ; une étape
 * faite n'est jamais `deferred`.
 */
export const ORGANIZATION_SETUP_STEP_STATES = ['done', 'todo', 'deferred'] as const;
export type OrganizationSetupStepState = (typeof ORGANIZATION_SETUP_STEP_STATES)[number];

/**
 * Colonne « Statut » de l'ADR § 2 : `blocking` = le serveur refuse un acte tant que
 * l'étape n'est pas faite ; `recommended` = utile, jamais exigé ; `optional` = selon
 * l'activité. Une étape `optional` peut bloquer un acte facultatif (`requiredFor`).
 */
export const ORGANIZATION_SETUP_STEP_LEVELS = ['blocking', 'recommended', 'optional'] as const;
export type OrganizationSetupStepLevel = (typeof ORGANIZATION_SETUP_STEP_LEVELS)[number];

/** Les trois actes engageants dont le statut dit s'ils sont possibles. */
export const ORGANIZATION_SETUP_CAPABILITIES = [
  'invoice',
  'normalize',
  'accounting_active',
] as const;
export type OrganizationSetupCapability = (typeof ORGANIZATION_SETUP_CAPABILITIES)[number];

/** Émettre une facture : la fiche fiscale seule (`FISCAL_PROFILE_REQUIRED`). */
export const INVOICE_MISSING_CODES = ['fiscal_profile'] as const;
export type InvoiceMissingCode = (typeof INVOICE_MISSING_CODES)[number];

/** Prérequis R1 d'ADR-0021 (`409 NORMALIZED_INVOICING_PREREQUISITES`), ordre du contrat. */
export const NORMALIZE_MISSING_CODES = [
  'fiscal_profile',
  'country_cd',
  'active_point_of_sale',
  'production_unavailable',
  'nif_elsewhere',
] as const;
export type NormalizeMissingCode = (typeof NORMALIZE_MISSING_CODES)[number];

/** Conditions d'ADR-0049 § 3.1 (`409 ACCOUNTING_ACTIVATION_PRECONDITION`). */
export const ACCOUNTING_ACTIVE_MISSING_CODES = ACCOUNTING_ACTIVATION_MISSING_CODES;

/** Ce qui manque à une étape `todo` — un code par étape, jamais une valeur. */
export const ORGANIZATION_SETUP_STEP_MISSING_CODES = [
  'country_confirmation',
  'fiscal_profile',
  'display_currency',
  'brand_identity',
  'normalized_invoicing',
  'treasury_account',
  'accounting_mode',
  'invitation',
  'modules_choice',
] as const;
export type OrganizationSetupStepMissingCode =
  (typeof ORGANIZATION_SETUP_STEP_MISSING_CODES)[number];

/**
 * Définition fixe de chaque étape (ADR-0052 § 2 et § 7) : niveau, actes qu'elle
 * conditionne côté serveur, action RBAC qui ouvre son écran (`null` = tout membre).
 *
 * `requiredFor` ne cite que les verrous du code : la fiche fiscale (émettre, et R1
 * `fiscal_profile`), la facture normalisée (normaliser), la comptabilité (`active`). Le pays
 * de l'étape 1 ne figure dans aucun verrou : R1 lit le siège de la fiche fiscale
 * (`country_cd`), pas le pays de l'organisation.
 */
export const ORGANIZATION_SETUP_STEPS: Readonly<
  Record<
    OrganizationSetupStepId,
    {
      level: OrganizationSetupStepLevel;
      requiredFor: readonly OrganizationSetupCapability[];
      action: string | null;
      missingCode: OrganizationSetupStepMissingCode;
    }
  >
> = Object.freeze({
  societe: {
    level: 'recommended',
    requiredFor: [],
    action: 'organization.manage',
    missingCode: 'country_confirmation',
  },
  fiscal: {
    level: 'blocking',
    requiredFor: ['invoice', 'normalize'],
    action: 'fiscal.manage',
    missingCode: 'fiscal_profile',
  },
  devises: {
    level: 'recommended',
    requiredFor: [],
    action: 'organization.manage',
    missingCode: 'display_currency',
  },
  identite: {
    level: 'recommended',
    requiredFor: [],
    action: 'organization.manage',
    missingCode: 'brand_identity',
  },
  normalisation: {
    level: 'optional',
    requiredFor: ['normalize'],
    action: 'fiscal.manage',
    missingCode: 'normalized_invoicing',
  },
  tresorerie: {
    level: 'recommended',
    requiredFor: [],
    action: 'treasury.manage',
    missingCode: 'treasury_account',
  },
  comptabilite: {
    level: 'optional',
    requiredFor: ['accounting_active'],
    action: 'accounting.manage',
    missingCode: 'accounting_mode',
  },
  equipe: {
    level: 'optional',
    requiredFor: [],
    action: 'members.invite',
    missingCode: 'invitation',
  },
  // ADR-0052 — O3 : décision ouverte n° 3, valeur par défaut — le choix de l'organisation
  // est enregistré par un détenteur d'`organization.manage` ; tout membre le lit.
  modules: {
    level: 'optional',
    requiredFor: [],
    action: 'organization.manage',
    missingCode: 'modules_choice',
  },
});
