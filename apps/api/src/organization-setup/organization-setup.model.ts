// Calcul PUR du statut de complétude (ADR-0052 § 3). ADR-0052 — O0.
//
// Le service rassemble des FAITS lus sur le serveur (une donnée existe ou non, les
// listes `missing[]` produites par les fonctions qui gardent les actes) ; ce module
// les met en forme. Aucune lecture, aucune règle propre : il ne peut ni promettre un acte
// que le serveur refusera, ni en refuser un qu'il accepte.

import type { AccountingActivationMissingCode } from '@lalanda/shared/accounting';
import {
  ORGANIZATION_SETUP_STEPS,
  ORGANIZATION_SETUP_STEP_IDS,
  type NormalizeMissingCode,
  type OrganizationSetupStepId,
  type OrganizationSetupView,
} from '@lalanda/shared/organization-setup';

import type { Action } from '../authz/permissions.js';

/** Ce que le serveur sait de l'organisation, sans aucune valeur. */
export interface OrganizationSetupFacts {
  /** Déclaration « pays confirmé » (§ 4) — aucune n'est mémorisée avant le lot qui crée `organization_setup`. */
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
  const steps = ORGANIZATION_SETUP_STEP_IDS.map((id) => {
    const def = ORGANIZATION_SETUP_STEPS[id];
    const done = stepDone(id, facts);
    return {
      id,
      state: done ? ('done' as const) : ('todo' as const),
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
