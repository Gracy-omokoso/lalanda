// ADR-0052 — O4 : carte « Votre société » (critère 18).
import {
  ORGANIZATION_SETUP_STEPS,
  ORGANIZATION_SETUP_STEP_IDS,
  type OrganizationSetupStepId,
  type OrganizationSetupView,
} from '@lalanda/shared/organization-setup';
import { describe, expect, it } from 'vitest';

import { carteSociete } from './votre-societe-model';

function vue(
  etats: Partial<Record<OrganizationSetupStepId, 'done' | 'todo' | 'deferred'>>,
  refus: OrganizationSetupStepId[] = [],
): OrganizationSetupView {
  return {
    organizationId: 'o',
    steps: ORGANIZATION_SETUP_STEP_IDS.map((id) => ({
      id,
      state: etats[id] ?? 'todo',
      level: ORGANIZATION_SETUP_STEPS[id].level,
      requiredFor: [...ORGANIZATION_SETUP_STEPS[id].requiredFor],
      missing: etats[id] === 'done' ? [] : [ORGANIZATION_SETUP_STEPS[id].missingCode],
      canAct: !refus.includes(id),
    })),
    modules: null,
    capabilities: {
      invoice: { ready: false, missing: ['fiscal_profile'] },
      normalize: { ready: false, enabled: false, missing: [] },
      accounting_active: { ready: false, active: false, missing: [] },
    },
  };
}

const tout = (etat: 'done' | 'deferred') =>
  Object.fromEntries(ORGANIZATION_SETUP_STEP_IDS.map((id) => [id, etat])) as Record<
    OrganizationSetupStepId,
    'done'
  >;

describe('carteSociete', () => {
  it('rien tant que l’avancement n’est pas lu', () => {
    expect(carteSociete(null)).toBeNull();
  });

  it('organisation neuve : 0/9, trois capacités, lien direct vers l’étape 1', () => {
    const c = carteSociete(vue({}))!;
    expect(c).toMatchObject({ faites: 0, total: 9, pourcent: 0 });
    expect(c.pastilles.map((p) => p.label)).toEqual(['Facturer', 'Normaliser', 'Comptabilité']);
    expect(c.suivante).toMatchObject({
      id: 'societe',
      href: '/organisation/mise-en-route?etape=societe',
      peutAgir: true,
    });
  });

  it('invité sans droits : lecture, avec qui peut faire l’étape suivante', () => {
    const c = carteSociete(vue({}, [...ORGANIZATION_SETUP_STEP_IDS]))!;
    expect(c.suivante.peutAgir).toBe(false);
    expect(c.suivante.quiPeut).toMatch(/Propriétaire/);
  });

  it('les reports comptent dans la barre ; la carte disparaît quand tout est réglé', () => {
    const c = carteSociete(vue({ societe: 'done', equipe: 'deferred' }))!;
    expect(c).toMatchObject({ faites: 1, reglees: 2, pourcent: 22 });
    expect(c.suivante.id).toBe('fiscal');
    expect(carteSociete(vue(tout('done')))).toBeNull();
    expect(carteSociete(vue({ ...tout('done'), tresorerie: 'deferred' }))).toBeNull();
  });
});
