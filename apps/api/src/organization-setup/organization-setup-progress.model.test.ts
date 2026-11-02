// ADR-0052 — O1 : avancement de la mise en route affiché par le sélecteur.

import { describe, expect, it } from 'vitest';

import { setupProgress } from './organization-setup-progress.model.js';
import type { OrganizationSetupFacts } from './organization-setup.model.js';

const VIDE: OrganizationSetupFacts = {
  countryConfirmed: false,
  fiscalProfile: false,
  displayCurrencySaved: false,
  brandIdentity: false,
  normalizedInvoicingEnabled: false,
  normalizeMissing: ['fiscal_profile'],
  treasuryAccount: false,
  accountingMode: 'off',
  accountingMissing: [],
  teamStarted: false,
  modulesChosen: false,
};

describe('setupProgress (ADR-0052 — O1)', () => {
  it('organisation neuve : 0 étape faite sur 9', () => {
    expect(setupProgress('org-b', VIDE)).toEqual({
      organizationId: 'org-b',
      done: 0,
      deferred: 0,
      total: 9,
    });
  });

  it('compte les étapes faites et les « pas maintenant » séparément', () => {
    const p = setupProgress('org-a', {
      ...VIDE,
      countryConfirmed: true,
      fiscalProfile: true,
      accountingMode: 'simulation',
      deferred: ['tresorerie', 'equipe'],
    });
    expect(p).toMatchObject({ done: 3, deferred: 2, total: 9 });
  });

  it('une étape faite et aussi déclarée « pas maintenant » ne compte qu’une fois, comme faite', () => {
    const p = setupProgress('org-a', { ...VIDE, treasuryAccount: true, deferred: ['tresorerie'] });
    expect(p).toMatchObject({ done: 1, deferred: 0 });
  });
});
