import { describe, expect, it } from 'vitest';

import { ACCOUNTING_ACTIVATION_MISSING_CODES } from '../accounting/constants.js';
import {
  ORGANIZATION_SETUP_DEFERRABLE_STEPS,
  ORGANIZATION_SETUP_STEPS,
  PutOrganizationSetupModulesSchema,
  isDeferrableStep,
  normalizeSetupModules,
  ORGANIZATION_SETUP_STEP_IDS,
  OrganizationSetupViewSchema,
  type OrganizationSetupView,
} from './index.js';

function vue(): OrganizationSetupView {
  return {
    organizationId: 'org-1',
    steps: ORGANIZATION_SETUP_STEP_IDS.map((id) => ({
      id,
      state: 'todo' as const,
      level: ORGANIZATION_SETUP_STEPS[id].level,
      requiredFor: [...ORGANIZATION_SETUP_STEPS[id].requiredFor],
      missing: [ORGANIZATION_SETUP_STEPS[id].missingCode],
      canAct: true,
    })),
    modules: null,
    capabilities: {
      invoice: { ready: false, missing: ['fiscal_profile'] },
      normalize: { ready: false, enabled: false, missing: ['fiscal_profile', 'country_cd'] },
      accounting_active: { ready: false, active: false, missing: ['BOOK_CURRENCY_REQUIRED'] },
    },
  };
}

describe('organization-setup (ADR-0052 — O0)', () => {
  it('neuf étapes, dans l’ordre conseillé de l’ADR', () => {
    expect(ORGANIZATION_SETUP_STEP_IDS).toEqual([
      'societe',
      'fiscal',
      'devises',
      'identite',
      'normalisation',
      'tresorerie',
      'comptabilite',
      'equipe',
      'modules',
    ]);
  });

  it('décision ouverte n° 2 (défaut) : seule la fiche fiscale bloque l’émission', () => {
    const bloquantes = ORGANIZATION_SETUP_STEP_IDS.filter((id) =>
      ORGANIZATION_SETUP_STEPS[id].requiredFor.includes('invoice'),
    );
    expect(bloquantes).toEqual(['fiscal']);
    const niveauBloquant = ORGANIZATION_SETUP_STEP_IDS.filter(
      (id) => ORGANIZATION_SETUP_STEPS[id].level === 'blocking',
    );
    expect(niveauBloquant).toEqual(['fiscal']);
  });

  it('les codes comptables sont ceux d’ADR-0049 § 3.1', () => {
    const v = vue();
    v.capabilities.accounting_active.missing = [...ACCOUNTING_ACTIVATION_MISSING_CODES];
    expect(OrganizationSetupViewSchema.safeParse(v).success).toBe(true);
  });

  it('accepte une vue conforme', () => {
    expect(OrganizationSetupViewSchema.safeParse(vue()).success).toBe(true);
  });

  it('refuse toute valeur ajoutée (critère 2 : booléens et codes seulement)', () => {
    const v = vue() as unknown as Record<string, unknown>;
    expect(OrganizationSetupViewSchema.safeParse({ ...v, nif: 'A123' }).success).toBe(false);
    const etape = { ...vue().steps[1], legalName: 'ACME' };
    expect(
      OrganizationSetupViewSchema.safeParse({ ...vue(), steps: [etape, ...vue().steps.slice(1)] })
        .success,
    ).toBe(false);
  });

  it('refuse un code inconnu et un nombre d’étapes faux', () => {
    const v = vue();
    expect(
      OrganizationSetupViewSchema.safeParse({
        ...v,
        capabilities: { ...v.capabilities, invoice: { ready: false, missing: ['rccm'] } },
      }).success,
    ).toBe(false);
    expect(OrganizationSetupViewSchema.safeParse({ ...v, steps: v.steps.slice(1) }).success).toBe(
      false,
    );
  });

  // ADR-0052 — O2/O3 : déclarations mémorisées (§ 4).
  it('« pas maintenant » : les quatre étapes de § 4, jamais la fiche fiscale (critère 7)', () => {
    expect(ORGANIZATION_SETUP_DEFERRABLE_STEPS).toEqual([
      'normalisation',
      'tresorerie',
      'comptabilite',
      'equipe',
    ]);
    expect(isDeferrableStep('fiscal')).toBe(false);
    expect(isDeferrableStep('societe')).toBe(false);
    expect(isDeferrableStep('equipe')).toBe(true);
  });

  it('modules : au moins un, sans doublon ; `null` = tous ; ordre canonique', () => {
    const ok = (b: unknown) => PutOrganizationSetupModulesSchema.safeParse(b).success;
    expect(ok({ modules: ['run'] })).toBe(true);
    expect(ok({ modules: null })).toBe(true);
    expect(ok({ modules: [] })).toBe(false);
    expect(ok({ modules: ['run', 'run'] })).toBe(false);
    expect(ok({ modules: ['ventes'] })).toBe(false);
    expect(ok({ modules: ['run'], extra: 1 })).toBe(false);
    expect(normalizeSetupModules(['grow', 'build'])).toEqual(['build', 'grow']);
    expect(normalizeSetupModules(['grow', 'run', 'build'])).toBeNull();
    expect(normalizeSetupModules(null)).toBeNull();
  });

  it('les modules sont désormais enregistrés par `organization.manage` (décision n° 3)', () => {
    expect(ORGANIZATION_SETUP_STEPS.modules.action).toBe('organization.manage');
  });
});
