import { describe, expect, it } from 'vitest';

import {
  corpsGeneration,
  formInitial,
  typesPossibles,
  validerForm,
} from './documents-generes-model';

const enPoste = { status: 'active', startDate: '2023-03-15', endDate: null, jobTitle: 'Agent' };

describe('documents générés (ADR-0072) — écran', () => {
  it('types proposés selon la fiche', () => {
    expect(typesPossibles(enPoste, '2026-11-08')).toEqual(['attestation']);
    expect(
      typesPossibles({ ...enPoste, status: 'exited', endDate: '2026-11-01' }, '2026-11-08'),
    ).toEqual(['certificate']);
    expect(typesPossibles({ ...enPoste, endDate: '2026-12-31' }, '2026-11-08')).toEqual([
      'attestation',
      'certificate',
    ]);
    expect(typesPossibles({ ...enPoste, status: 'anonymized' }, '2026-11-08')).toEqual([]);
    expect(typesPossibles({ ...enPoste, startDate: '2027-01-01' }, '2026-11-08')).toEqual([]);
  });

  it('formulaire : signataire, lieu requis ; corps sans option cochée par défaut', () => {
    const f = formInitial(enPoste, null, 'attestation', '2026-11-08');
    expect(Object.keys(validerForm(f)).sort()).toEqual([
      'lieu',
      'signataireNom',
      'signataireQualite',
    ]);
    const rempli = { ...f, signataireNom: 'G. E.', signataireQualite: 'DG', lieu: 'Kinshasa' };
    expect(validerForm(rempli)).toEqual({});
    expect(corpsGeneration(rempli)).toMatchObject({
      kind: 'attestation',
      includePersonalAddress: false,
      includeEmployeeNumber: false,
      visibleToEmployee: true,
    });
  });

  it('certificat : emplois cohérents, numéro CNSS facultatif', () => {
    const f = {
      ...formInitial({ ...enPoste, endDate: '2026-11-01' }, null, 'certificate', '2026-11-08'),
      signataireNom: 'G. E.',
      signataireQualite: 'DG',
      lieu: 'Kinshasa',
    };
    expect(f.emplois).toEqual([{ title: 'Agent', from: '2023-03-15', to: '2026-11-01' }]);
    expect(validerForm(f)).toEqual({});
    expect(corpsGeneration(f)).toMatchObject({ kind: 'certificate', socialSecurityNumber: null });
    const faux = {
      ...f,
      emplois: [{ title: 'A', from: '2026-02-01', to: '2026-01-01' }],
      cnss: '<1>',
    };
    expect(Object.keys(validerForm(faux)).sort()).toEqual(['cnss', 'emploi-0']);
  });
});
