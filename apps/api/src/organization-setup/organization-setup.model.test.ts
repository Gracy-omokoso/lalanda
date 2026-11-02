// ADR-0052 — O0 : calcul pur du statut de complétude.

import { OrganizationSetupViewSchema } from '@lalanda/shared/organization-setup';
import { describe, expect, it } from 'vitest';

import { ORG_PERMISSION_MATRIX, effectiveActions, type OrgRole } from '../authz/permissions.js';
import {
  buildOrganizationSetupView,
  doneSteps,
  type OrganizationSetupFacts,
} from './organization-setup.model.js';

const VIDE: OrganizationSetupFacts = {
  countryConfirmed: false,
  fiscalProfile: false,
  displayCurrencySaved: false,
  brandIdentity: false,
  normalizedInvoicingEnabled: false,
  normalizeMissing: ['fiscal_profile', 'country_cd', 'active_point_of_sale'],
  treasuryAccount: false,
  accountingMode: 'off',
  accountingMissing: ['CHART_PACK_NOT_APPROVED', 'BOOK_CURRENCY_REQUIRED'],
  teamStarted: false,
  modulesChosen: false,
};

const etat = (v: ReturnType<typeof buildOrganizationSetupView>, id: string) =>
  v.steps.find((s) => s.id === id)!;

describe('buildOrganizationSetupView (ADR-0052 § 3)', () => {
  it('organisation neuve : neuf étapes à faire, rien de possible, réponse conforme au contrat', () => {
    const v = buildOrganizationSetupView('org-a', VIDE, effectiveActions('owner', {}));
    expect(OrganizationSetupViewSchema.parse(v)).toEqual(v);
    expect(v.steps.map((s) => s.state)).toEqual(Array(9).fill('todo'));
    expect(v.capabilities.invoice).toEqual({ ready: false, missing: ['fiscal_profile'] });
    expect(v.capabilities.normalize).toEqual({
      ready: false,
      enabled: false,
      missing: ['fiscal_profile', 'country_cd', 'active_point_of_sale'],
    });
    expect(v.capabilities.accounting_active).toEqual({
      ready: false,
      active: false,
      missing: ['CHART_PACK_NOT_APPROVED', 'BOOK_CURRENCY_REQUIRED'],
    });
    expect(etat(v, 'fiscal').missing).toEqual(['fiscal_profile']);
  });

  it('critère 3 : la fiche fiscale seule rend l’émission possible', () => {
    const v = buildOrganizationSetupView('org-a', { ...VIDE, fiscalProfile: true }, []);
    expect(v.capabilities.invoice).toEqual({ ready: true, missing: [] });
    expect(etat(v, 'fiscal')).toMatchObject({ state: 'done', missing: [] });
    // Rien d'autre n'est exigé pour émettre, même si tout le reste manque.
    expect(v.steps.filter((s) => s.state === 'done').map((s) => s.id)).toEqual(['fiscal']);
  });

  it('critère 6 : chaque étape passe « faite » dès que sa donnée existe', () => {
    const v = buildOrganizationSetupView(
      'org-a',
      {
        ...VIDE,
        countryConfirmed: true,
        fiscalProfile: true,
        displayCurrencySaved: true,
        brandIdentity: true,
        normalizedInvoicingEnabled: true,
        normalizeMissing: [],
        treasuryAccount: true,
        accountingMode: 'simulation',
        teamStarted: true,
        modulesChosen: true,
      },
      [],
    );
    expect(v.steps.every((s) => s.state === 'done' && s.missing.length === 0)).toBe(true);
    expect(v.capabilities.normalize).toEqual({ ready: true, enabled: true, missing: [] });
    // `simulation` fait l'étape, sans rendre la comptabilité `active`.
    expect(v.capabilities.accounting_active.active).toBe(false);
  });

  it('normalisation activée mais prérequis perdus : pas prête, les codes restent', () => {
    const v = buildOrganizationSetupView(
      'org-a',
      { ...VIDE, normalizedInvoicingEnabled: true, normalizeMissing: ['active_point_of_sale'] },
      [],
    );
    expect(v.capabilities.normalize).toEqual({
      ready: false,
      enabled: true,
      missing: ['active_point_of_sale'],
    });
  });

  it('comptabilité active : prête, aucun manque', () => {
    const v = buildOrganizationSetupView(
      'org-a',
      { ...VIDE, accountingMode: 'active', accountingMissing: ['FISCAL_YEAR_NOT_OPEN'] },
      [],
    );
    expect(v.capabilities.accounting_active).toEqual({ ready: true, active: true, missing: [] });
  });

  it('critère 8 : `canAct` suit les droits effectifs', () => {
    const admin = buildOrganizationSetupView('o', VIDE, effectiveActions('admin', {}));
    expect(ORG_PERMISSION_MATRIX.admin['fiscal.manage']).toBe('deny');
    expect(etat(admin, 'fiscal').canAct).toBe(false);
    expect(etat(admin, 'societe').canAct).toBe(true);
    const adminPlus = buildOrganizationSetupView(
      'o',
      VIDE,
      effectiveActions('admin', { grants: ['fiscal.manage'] }),
    );
    expect(etat(adminPlus, 'fiscal').canAct).toBe(true);
    expect(etat(adminPlus, 'normalisation').canAct).toBe(true);
  });

  it('décision n° 3 (défaut) : les modules s’enregistrent avec `organization.manage`', () => {
    const roles: OrgRole[] = ['viewer', 'external_accountant'];
    for (const role of roles) {
      const v = buildOrganizationSetupView('o', VIDE, effectiveActions(role, {}));
      expect(etat(v, 'modules').canAct, role).toBe(false);
    }
    expect(
      etat(buildOrganizationSetupView('o', VIDE, ['organization.manage']), 'modules').canAct,
    ).toBe(true);
  });

  // ADR-0052 — O2/O3 : déclarations de § 4.
  it('« pas maintenant » : `deferred` tant que la donnée manque, `done` dès qu’elle existe', () => {
    const reportee = buildOrganizationSetupView('o', { ...VIDE, deferred: ['tresorerie'] }, []);
    expect(etat(reportee, 'tresorerie')).toMatchObject({
      state: 'deferred',
      missing: ['treasury_account'],
    });
    const faite = buildOrganizationSetupView(
      'o',
      { ...VIDE, deferred: ['tresorerie'], treasuryAccount: true },
      [],
    );
    expect(etat(faite, 'tresorerie').state).toBe('done');
    expect(doneSteps({ ...VIDE, treasuryAccount: true }, ['tresorerie', 'equipe'])).toEqual([
      'tresorerie',
    ]);
  });

  it('modules : `null` sans choix ; la liste choisie sinon ; pays confirmé = étape 1 faite', () => {
    expect(buildOrganizationSetupView('o', VIDE, []).modules).toBeNull();
    const v = buildOrganizationSetupView(
      'o',
      { ...VIDE, modulesChosen: true, modules: ['run'], countryConfirmed: true },
      [],
    );
    expect(v.modules).toEqual(['run']);
    expect(etat(v, 'modules').state).toBe('done');
    expect(etat(v, 'societe').state).toBe('done');
    const tous = buildOrganizationSetupView(
      'o',
      { ...VIDE, modulesChosen: true, modules: null },
      [],
    );
    expect(tous.modules).toBeNull();
    expect(etat(tous, 'modules').state).toBe('done');
  });
});
