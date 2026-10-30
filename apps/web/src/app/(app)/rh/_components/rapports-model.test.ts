// Rapports RH (ADR-0045 § 7) — lot H7.
import { describe, expect, it } from 'vitest';

import {
  bornesPeriode,
  formatDecimal,
  formatTaux,
  largeur,
  largeurTaux,
  libelleCategorieSortie,
  lignesComptes,
  peutExporterRegistre,
  requeteRapports,
} from './rapports-model';

describe('rapports', () => {
  it('export du registre : hr.read ET hr.manage (pas report.export)', () => {
    expect(peutExporterRegistre(['hr.read', 'hr.manage'])).toBe(true);
    expect(peutExporterRegistre(['hr.read', 'report.export'])).toBe(false);
    expect(peutExporterRegistre(null)).toBe(false);
  });

  it('périodes civiles depuis le jour de Kinshasa', () => {
    expect(bornesPeriode('annee', '2026-10-30')).toEqual({ from: '2026-01-01', to: '2026-10-30' });
    expect(bornesPeriode('annee-precedente', '2026-10-30')).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
    expect(bornesPeriode('12-mois', '2028-02-29')).toEqual({
      from: '2027-02-28',
      to: '2028-02-29',
    });
    expect(requeteRapports('annee', '2026-10-30', 'd1')).toMatchObject({ departmentId: 'd1' });
    expect(requeteRapports('annee', '2026-10-30', '')).not.toHaveProperty('departmentId');
  });

  it('mise en forme des chaînes de l’API, sans calcul', () => {
    expect(formatTaux('12.50')).toBe('12,5 %');
    expect(formatTaux('3.00')).toBe('3 %');
    expect(formatTaux(null)).toBe('non calculable');
    expect(formatDecimal('41.25')).toBe('41,25');
    expect(libelleCategorieSortie('resignation')).toBe('Démission');
    expect(libelleCategorieSortie(null)).toBe('Non précisée');
  });

  it('barres : largeur d’affichage bornée, valeur en texte', () => {
    expect(largeur(0, 10)).toBe(0);
    expect(largeur(5, 10)).toBe(50);
    expect(largeur(1, 1000)).toBe(2);
    expect(largeurTaux('140.00')).toBe(100);
    expect(
      lignesComptes([
        { key: 'a', label: 'Ventes', count: 4 },
        { key: null, label: 'Sans service', count: 2 },
      ]),
    ).toEqual([
      { cle: 'a', libelle: 'Ventes', valeur: '4', largeur: 100 },
      { cle: '∅', libelle: 'Sans service', valeur: '2', largeur: 50 },
    ]);
  });
});
