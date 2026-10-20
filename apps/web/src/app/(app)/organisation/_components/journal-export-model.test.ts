import { describe, expect, it } from 'vitest';

import {
  erreurPeriode,
  jourKinshasa,
  nomFichierExport,
  periodeParDefaut,
  requeteExport,
} from './journal-export-model';

describe('export du journal (ADR-0026 § 6.3)', () => {
  it('jour et période par défaut à l’heure de Kinshasa (UTC+1)', () => {
    // 23 h 30 UTC le 31 oct. = 0 h 30 le 1er nov. à Kinshasa.
    expect(jourKinshasa(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
    expect(periodeParDefaut(new Date('2026-10-20T10:00:00Z'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-20',
    });
  });

  it('période : dates réelles, ordre, 366 jours au plus', () => {
    expect(erreurPeriode('2026-10-01', '2026-10-31')).toBeNull();
    expect(erreurPeriode('2026-10-20', '2026-10-20')).toBeNull();
    expect(erreurPeriode('2026-02-30', '2026-03-01')).toMatch(/valides/);
    expect(erreurPeriode('2026-10-31', '2026-10-01')).toMatch(/précède/);
    expect(erreurPeriode('2025-01-01', '2026-01-02')).toMatch(/366/);
    expect(erreurPeriode('2025-01-01', '2025-12-31')).toBeNull();
  });

  it('requête et nom de fichier selon le choix', () => {
    const q = requeteExport('csv-echanges', '2026-10-01', '2026-10-31');
    expect(q).toEqual({ from: '2026-10-01', to: '2026-10-31', format: 'csv', dataset: 'echanges' });
    expect(nomFichierExport(q)).toBe('echanges-dgi_2026-10-01_2026-10-31.csv');
    expect(nomFichierExport(requeteExport('json', '2026-10-01', '2026-10-31'))).toBe(
      'journal-ventes_2026-10-01_2026-10-31.json',
    );
  });
});
