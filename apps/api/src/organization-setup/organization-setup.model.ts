// Calcul PUR du statut de complétude (ADR-0052 § 3). ADR-0052 — O0.
//
// Le service rassemble des FAITS lus sur le serveur (une donnée existe ou non, les
// listes `missing[]` produites par les fonctions qui gardent les actes) ; ce module
// les met en forme. Aucune lecture, aucune règle propre : il ne peut ni promettre un acte
// que le serveur refusera, ni en refuser un qu'il accepte.

import type { AccountingActivationMissingCode } from '@lalanda/shared/accounting';
import {
  ORGANIZATION_SETUP_STEPS,
  type OrganizationSetupDeferrableStep,
  type OrganizationSetupModuleId,
  ORGANIZATION_SETUP_STEP_IDS,
  type NormalizeMissingCode,
  type OrganizationSetupStepId,
  type OrganizationSetupView,
} from '@lalanda/shared/organization-setup';

import type { Action } from '../authz/permissions.js';

/** Ce que le serveur sait de l'organisation, sans aucune valeur. */
export interface OrganizationSetupFacts {
  /** Déclaration « pays confirmé » (§ 4, `organization_setup`). */
  countryConfirmed: boolean;
  fiscalProfile: boolean;
  /** Un document `organization_settings` existe (devise enregistrée). */
  displayCurrencySaved: boolean;
  /** Un logo principal relié ou une couleur principale (même règle que l'interface). */
  brandIdentity: boolean;
  normalizedInvoicingEnabled: boolean;
  /** R1 d'ADR-0021 dans l'environnement courant (`missingPrerequisites`). */
  normalizeMissing: readonly NormalizeMissingCode[];
  /** Au moins un compte de trésorerie actif. */
  treasuryAccount: boolean;
  accountingMode: 'off' | 'simulation' | 'active';
  /** ADR-0049 § 3.1 (`activationMissing`), vide quand le mode est `active`. */
  accountingMissing: readonly AccountingActivationMissingCode[];
  /** Au moins une invitation émise, ou un autre membre que le propriétaire. */
  teamStarted: boolean;
  /** Choix de modules enregistré côté serveur (lot O3). */
  modulesChosen: boolean;
  /** ADR-0052 — O3 : modules choisis ; `null` = tous (ou aucun choix). */
  modules?: readonly OrganizationSetupModuleId[] | null;
  /** ADR-0052 — O2 : « pas maintenant » déclarés (§ 4) ; ignorés pour une étape faite. */
  deferred?: readonly OrganizationSetupDeferrableStep[];
}

/** Étapes faites parmi `ids` : sert au service à retirer un « pas maintenant » devenu inutile. */
export function doneSteps(
  facts: OrganizationSetupFacts,
  ids: readonly OrganizationSetupStepId[] = ORGANIZATION_SETUP_STEP_IDS,
): OrganizationSetupStepId[] {
  return ids.filter((id) => stepDone(id, facts));
}

function stepDone(id: OrganizationSetupStepId, f: OrganizationSetupFacts): boolean {
  switch (id) {
    case 'societe':
      return f.countryConfirmed;
    case 'fiscal':
      return f.fiscalProfile;
    case 'devises':
      return f.displayCurrencySaved;
    case 'identite':
      return f.brandIdentity;
    case 'normalisation':
      return f.normalizedInvoicingEnabled;
    case 'tresorerie':
      return f.treasuryAccount;
    case 'comptabilite':
      return f.accountingMode === 'active' || f.accountingMode === 'simulation';
    case 'equipe':
      return f.teamStarted;
    case 'modules':
      return f.modulesChosen;
  }
}

/**
 * Vue du statut. `actions` : droits EFFECTIFS de l'appelant (ADR-0041) ; `canAct` d'une
 * étape sans action (modules) vaut `true` pour tout membre.
 */
export function buildOrganizationSetupView(
  organizationId: string,
  facts: OrganizationSetupFacts,
  actions: readonly Action[],
): OrganizationSetupView {
  const held = new Set<string>(actions);
  const deferred = new Set<string>(facts.deferred ?? []);
  const steps = ORGANIZATION_SETUP_STEP_IDS.map((id) => {
    const def = ORGANIZATION_SETUP_STEPS[id];
    const done = stepDone(id, facts);
    return {
      id,
      // `done` prime : un « pas maintenant » est retiré dès que l'étape est faite (critère 6).
      state: done
        ? ('done' as const)
        : deferred.has(id)
          ? ('deferred' as const)
          : ('todo' as const),
      level: def.level,
      requiredFor: [...def.requiredFor],
      missing: done ? [] : [def.missingCode],
      canAct: def.action === null ? true : held.has(def.action),
    };
  });
  const accountingActive = facts.accountingMode === 'active';
  const accountingMissing = accountingActive ? [] : [...facts.accountingMissing];
  return {
    organizationId,
    steps,
    modules: facts.modulesChosen && facts.modules ? [...facts.modules] : null,
    capabilities: {
      invoice: facts.fiscalProfile
        ? { ready: true, missing: [] }
        : { ready: false, missing: ['fiscal_profile'] },
      normalize: {
        ready: facts.normalizedInvoicingEnabled && facts.normalizeMissing.length === 0,
        enabled: facts.normalizedInvoicingEnabled,
        missing: [...facts.normalizeMissing],
      },
      accounting_active: {
        ready: accountingActive || accountingMissing.length === 0,
        active: accountingActive,
        missing: accountingMissing,
      },
    },
  };
}
