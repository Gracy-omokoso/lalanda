// Registre (ADR-0046 § 3.1) : requête par identifiants, formulaire sans durée par défaut.

import { describe, expect, it } from 'vitest';

import { equipement } from './fixtures.test-utils';
import {
  correspond,
  formulaireEquipement,
  preparerEquipement,
  preparerModification,
  requeteRegistre,
} from './registre-model';

describe('requête du registre', () => {
  it('statut et catégorie seulement, curseur si présent', () => {
    expect(requeteRegistre({ statut: 'active', categoryId: '' }, null)).toEqual({
      status: 'active',
      limit: 50,
    });
    expect(requeteRegistre({ statut: 'disposed', categoryId: 'c1' }, 'k')).toEqual({
      status: 'disposed',
      categoryId: 'c1',
      cursor: 'k',
      limit: 50,
    });
  });

  it('recherche locale sans accents sur nom, numéro, marque', () => {
    const a = equipement({ name: 'Imprimante réseau' });
    expect(correspond(a, 'reseau')).toBe(true);
    expect(correspond(a, 'EQ-000001')).toBe(true);
    expect(correspond(a, 'dell')).toBe(true);
    expect(correspond(a, 'scanner')).toBe(false);
  });
});

describe('formulaire d’équipement', () => {
  const vide = formulaireEquipement(null, '2026-10-31');

  it('aucune durée par défaut : pas d’estimation sans saisie', () => {
    expect(vide.years).toBe('');
    const p = preparerEquipement(
      { ...vide, name: 'PC', categoryId: 'c1', cost: '1 200' },
      { creation: true, coutMasque: false },
    );
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.corps.managementDepreciation).toBeNull();
      expect(p.corps.acquisition).toEqual({
        on: '2026-10-31',
        cost: '1200',
        currency: 'USD',
        supplierId: null,
      });
      expect(p.corps.status).toBe('in_service');
    }
  });

  it('champs obligatoires et estimation incomplète refusés', () => {
    const p = preparerEquipement(
      { ...vide, cost: 'abc', years: '3' },
      { creation: true, coutMasque: false },
    );
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(Object.keys(p.champs).sort()).toEqual(['categoryId', 'cost', 'name', 'startOn']);
    }
  });

  it('estimation saisie : durée, résiduelle (0 par défaut), départ', () => {
    const p = preparerEquipement(
      { ...vide, name: 'PC', categoryId: 'c1', cost: '1200', years: '3', startOn: '2026-01-15' },
      { creation: true, coutMasque: false },
    );
    expect(p.ok && p.corps.managementDepreciation).toEqual({
      years: 3,
      residualValue: '0',
      startOn: '2026-01-15',
    });
  });

  it('coût vide : inconnu (null), jamais « 0 » ; coût masqué : aucun coût envoyé', () => {
    const base = { ...vide, name: 'Écran', categoryId: 'c1' };
    const visible = preparerEquipement(
      { ...base, cost: '  ' },
      { creation: true, coutMasque: false },
    );
    expect(visible.ok && visible.corps.acquisition.cost).toBeNull();
    // Rôle qui ne voit pas les valeurs (assets.manage sans purchase.read ni treasury.read).
    const masque = preparerEquipement({ ...base, cost: '' }, { creation: true, coutMasque: true });
    expect(masque.ok).toBe(true);
    if (masque.ok) {
      expect(masque.corps.acquisition).not.toHaveProperty('cost');
      expect(JSON.stringify(masque.corps)).not.toContain('"0"');
    }
  });

  it('modification visible : vider le coût le déclare inconnu', () => {
    const a = equipement();
    const f = formulaireEquipement(a, '2026-10-31');
    const p = preparerModification({ ...f, cost: '' }, a, false);
    expect(p.ok && p.corps.acquisition?.cost).toBeNull();
  });

  it('modification : révision attendue, coût masqué jamais renvoyé', () => {
    const a = equipement({ valuesHidden: true });
    const f = formulaireEquipement(a, '2026-10-31');
    const p = preparerModification({ ...f, status: 'under_maintenance' }, a, true);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.corps.expectedRevision).toBe(3);
      expect(p.corps.acquisition).toBeUndefined();
      expect(p.corps.status).toBe('under_maintenance');
    }
  });
});
