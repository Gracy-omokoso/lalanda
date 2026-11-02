// ADR-0052 — O3 : reprise unique de l'ancien choix local des modules.
import { describe, expect, it } from 'vitest';

import { TOUS_LOCAL, planModules } from './modules-organisation-model';

describe('planModules (ADR-0052 critère 11)', () => {
  it('le choix du serveur fait foi et efface l’ancienne valeur locale', () => {
    expect(
      planModules({ choisiServeur: true, brutLocal: '["run"]', peutEnregistrer: false }),
    ).toEqual({ type: 'serveur', effacerLocal: true });
    expect(planModules({ choisiServeur: true, brutLocal: null, peutEnregistrer: true })).toEqual({
      type: 'serveur',
      effacerLocal: false,
    });
  });

  it('un gérant reprend une fois la valeur locale, « tous » compris', () => {
    expect(
      planModules({ choisiServeur: false, brutLocal: '["grow","run"]', peutEnregistrer: true }),
    ).toEqual({
      type: 'migrer',
      modules: ['run', 'grow'],
    });
    expect(
      planModules({ choisiServeur: false, brutLocal: TOUS_LOCAL, peutEnregistrer: true }),
    ).toEqual({
      type: 'migrer',
      modules: null,
    });
  });

  it('sans le droit d’enregistrer, la valeur locale range seulement cet appareil', () => {
    expect(
      planModules({ choisiServeur: false, brutLocal: '["build"]', peutEnregistrer: false }),
    ).toEqual({
      type: 'local',
      modules: ['build'],
    });
  });

  it('rien nulle part : aucun choix ; une valeur corrompue vaut « tous »', () => {
    expect(planModules({ choisiServeur: false, brutLocal: null, peutEnregistrer: true })).toEqual({
      type: 'aucun',
    });
    expect(
      planModules({ choisiServeur: false, brutLocal: '{oops', peutEnregistrer: true }),
    ).toEqual({
      type: 'migrer',
      modules: null,
    });
  });
});
