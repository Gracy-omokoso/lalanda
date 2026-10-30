// Échéances (ADR-0045 § 6.4) — lot H7.
import { describe, expect, it } from 'vitest';

import {
  detailEcheance,
  filtrerEcheances,
  horizonDepuis,
  libelleDelai,
  lienEcheance,
  tonDelai,
  type Echeance,
} from './echeances-model';

const base: Echeance = {
  kind: 'contract_end',
  employeeId: 'e1',
  employeeName: 'Aline',
  date: '2026-11-29',
  daysLeft: 30,
  documentId: null,
  documentLabel: null,
  idKind: null,
};

describe('échéances', () => {
  it('délai rendu par l’API, en mots', () => {
    expect(libelleDelai(30)).toBe('dans 30 jours');
    expect(libelleDelai(1)).toBe('demain');
    expect(libelleDelai(0)).toBe('aujourd’hui');
    expect(libelleDelai(-2)).toBe('dépassée de 2 jours');
    expect(tonDelai(-1)).toBe('danger');
    expect(tonDelai(5)).toBe('warning');
    expect(tonDelai(20)).toBe('neutral');
  });

  it('chaque carte mène à l’onglet qui porte l’échéance', () => {
    expect(lienEcheance(base)).toBe('/rh/collaborateurs/e1');
    expect(lienEcheance({ ...base, kind: 'document_expiry', documentId: 'd1' })).toBe(
      '/rh/collaborateurs/e1/documents',
    );
    expect(lienEcheance({ ...base, kind: 'id_expiry' })).toBe('/rh/collaborateurs/e1/sensible');
  });

  it('pièce sans nature (hors hr.sensitive.read) : jamais de numéro', () => {
    expect(detailEcheance({ ...base, kind: 'id_expiry' })).toBe('Pièce d’identité');
    expect(detailEcheance({ ...base, kind: 'id_expiry', idKind: 'passport' })).toBe('Passeport');
    expect(
      detailEcheance({ ...base, kind: 'document_expiry', documentLabel: 'Document confidentiel' }),
    ).toBe('Document confidentiel');
  });

  it('filtre et horizon', () => {
    const items = [base, { ...base, kind: 'probation_end' as const }];
    expect(filtrerEcheances(items, 'probation_end')).toHaveLength(1);
    expect(filtrerEcheances(items, '')).toHaveLength(2);
    expect(horizonDepuis('30')).toBe(30);
    expect(horizonDepuis('')).toBeNull();
    expect(horizonDepuis('999')).toBeNull();
  });
});
