// Fiche équipement (ADR-0046 § 3, § 9) : estimation toujours étiquetée, « non
// estimable » avec motif, gestes par droits, corps des formulaires.

import { ASSET_MANAGEMENT_ESTIMATE_LABEL } from '@lalanda/shared/assets';
import { describe, expect, it } from 'vitest';

import {
  ETIQUETTE_ESTIMATION,
  gestesEquipement,
  motifNonEstimable,
  phraseEstimation,
  preparerAffectation,
  preparerCession,
  preparerCouverture,
  preparerMaintenance,
  typesBeneficiaire,
  formulaireCouverture,
  texteCoutAcquisition,
} from './fiche-model';
import { GESTIONNAIRE, LECTEUR_RH, equipement } from './fixtures.test-utils';

const estimation = {
  label: 'management_estimate' as const,
  notice: ASSET_MANAGEMENT_ESTIMATE_LABEL,
  onDate: '2026-12-31',
  currency: 'USD' as const,
  version: '1.0.0',
  stoppedByDisposalOn: null,
};

describe('amortissement indicatif', () => {
  it('l’étiquette « estimation de gestion » est toujours présente', () => {
    expect(ETIQUETTE_ESTIMATION).toMatch(/Estimation de gestion/);
    expect(ETIQUETTE_ESTIMATION).toMatch(/pas un amortissement comptable ou fiscal/);
    for (const v of [true, false]) {
      expect(phraseEstimation(equipement(), v).etiquette).toBe(ETIQUETTE_ESTIMATION);
    }
  });

  it('sans durée : « non estimable » avec le motif', () => {
    const a = equipement({
      managementEstimate: {
        ...estimation,
        estimable: false,
        reason: 'NO_DURATION',
        estimatedValue: null,
        consumed: null,
        consumedPercent: null,
        endOn: null,
        monthsTotal: null,
        monthsElapsed: null,
      },
    });
    const p = phraseEstimation(a, true);
    expect(p.etat).toBe('non_estimable');
    expect(p.etat !== 'estimee' && p.texte).toBe(
      'Non estimable : aucune durée n’est saisie pour cet équipement.',
    );
  });

  it('estimée : valeur du moteur, jamais recalculée', () => {
    const a = equipement({
      managementEstimate: {
        ...estimation,
        estimable: true,
        reason: null,
        estimatedValue: '800.00',
        consumed: '400.00',
        consumedPercent: '33.33',
        endOn: '2028-12-31',
        monthsTotal: 36,
        monthsElapsed: 12,
      },
    });
    const p = phraseEstimation(a, true);
    expect(p.etat).toBe('estimee');
    if (p.etat === 'estimee') {
      expect(p.valeur).toBe('800,00 USD');
      expect(p.lignes).toContainEqual(['Durée', '12 mois écoulés sur 36']);
    }
  });

  it('valeurs masquées ou affichage éteint', () => {
    expect(phraseEstimation(equipement(), false).etat).toBe('masquee');
    expect(phraseEstimation(equipement(), true).etat).toBe('eteinte');
  });
});

describe('coût d’acquisition inconnu', () => {
  it('affiché « Inconnu », jamais « 0 » ; motif lisible du non-estimable', () => {
    expect(texteCoutAcquisition(null, (v) => `${v} USD`)).toBe('Inconnu');
    expect(texteCoutAcquisition('0.00', (v) => `${v} USD`)).toBe('0.00 USD');
    expect(motifNonEstimable('UNKNOWN_COST')).toBe('le coût d’acquisition est inconnu');
  });
});

describe('gestes', () => {
  it('aucun geste sans assets.manage', () => {
    expect(gestesEquipement(equipement(), LECTEUR_RH)).toEqual([]);
  });
  it('équipement cédé : réintégrer seulement', () => {
    expect(
      gestesEquipement(equipement({ status: 'disposed' }), GESTIONNAIRE).map((g) => g.id),
    ).toEqual(['reintegrer']);
  });
  it('affecté : réaffecter et retour', () => {
    const a = equipement({
      currentAssignment: {
        id: 'x',
        assetId: 'a1',
        assignee: { kind: 'member', userId: 'u', name: 'Gracy' },
        from: '2026-02-01',
        to: null,
        handedOverBy: 'u',
        conditionOut: null,
        conditionIn: null,
        note: null,
        createdAt: '',
      },
    });
    expect(gestesEquipement(a, GESTIONNAIRE).map((g) => g.libelle)).toContain('Réaffecter');
    expect(gestesEquipement(a, GESTIONNAIRE).map((g) => g.id)).toContain('retourner');
  });
});

describe('formulaires', () => {
  it('bénéficiaires proposés selon ce que le rôle peut lister', () => {
    expect(typesBeneficiaire(['assets.manage'])).toEqual(['member']);
    expect(typesBeneficiaire(['hr.read', 'work.read', 'stock.read'])).toEqual([
      'employee',
      'member',
      'project',
      'location',
    ]);
  });

  it('affectation : bénéficiaire typé et révision', () => {
    const p = preparerAffectation(
      { kind: 'employee', cible: 'e1', from: '2026-10-31', conditionOut: ' bon ', note: '' },
      4,
    );
    expect(p).toEqual({
      ok: true,
      corps: {
        expectedRevision: 4,
        assignee: { kind: 'employee', employeeId: 'e1' },
        from: '2026-10-31',
        conditionOut: 'bon',
        note: null,
      },
    });
    expect(
      preparerAffectation({ kind: 'member', cible: '', from: '', conditionOut: '', note: '' }, 1)
        .ok,
    ).toBe(false);
  });

  it('maintenance : récurrence réservée à la préventive, coût avec devise', () => {
    const base = {
      kind: 'preventive' as const,
      dejaFaite: false,
      date: '2026-11-15',
      cost: '50',
      currency: 'USD' as const,
      performedBy: '',
      note: '',
      everyMonths: '6',
    };
    const p = preparerMaintenance(base);
    expect(p.ok && p.corps).toMatchObject({
      status: 'planned',
      plannedOn: '2026-11-15',
      cost: '50',
      currency: 'USD',
      recurrence: { everyMonths: 6 },
    });
    expect(preparerMaintenance({ ...base, kind: 'corrective' }).ok).toBe(false);
    const sansCout = preparerMaintenance({ ...base, cost: '', everyMonths: '' });
    expect(sansCout.ok && sansCout.corps.currency).toBeNull();
  });

  it('couverture : dates ordonnées, document lié, coût masqué non envoyé', () => {
    const f = {
      ...formulaireCouverture(null, '2026-10-31'),
      provider: 'SONAS',
      endOn: '2027-10-30',
      documentId: 'd1',
    };
    const p = preparerCouverture(f, true);
    expect(p.ok && p.corps).toEqual({
      kind: 'warranty',
      provider: 'SONAS',
      reference: null,
      startOn: '2026-10-31',
      endOn: '2027-10-30',
      documentId: 'd1',
      reminderDays: null,
    });
    expect(preparerCouverture({ ...f, endOn: '2026-01-01' }, false).ok).toBe(false);
  });

  it('cession : motif obligatoire, prix seulement pour une vente', () => {
    const f = {
      kind: 'scrapped' as const,
      on: '2026-10-31',
      proceeds: '100',
      currency: 'USD' as const,
      buyer: 'X',
      reason: '',
    };
    expect(preparerCession(f, 2).ok).toBe(false);
    const p = preparerCession({ ...f, reason: 'Écran cassé' }, 2);
    expect(p.ok && p.corps).toMatchObject({ proceeds: null, currency: null, buyer: null });
    const v = preparerCession({ ...f, kind: 'sold', reason: 'Revendu' }, 2);
    expect(v.ok && v.corps).toMatchObject({ proceeds: '100', currency: 'USD', buyer: 'X' });
  });
});
