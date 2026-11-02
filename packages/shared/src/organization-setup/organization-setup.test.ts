import { describe, expect, it } from 'vitest';

import { ACCOUNTING_ACTIVATION_MISSING_CODES } from '../accounting/constants.js';
import {
  ORGANIZATION_SETUP_STEPS,
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
});
