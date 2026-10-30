import { describe, expect, it } from 'vitest';

import type { LeaveTypeView } from '@/lib/api-hr';

import { aideType, formDemandeInitial, typesProposes, validerDemande } from './demande-model';

const conges: LeaveTypeView = {
  id: 't1',
  label: 'Congés',
  unit: 'half_day',
  confidential: false,
  deductsFromBalance: true,
  active: true,
};
const maladie: LeaveTypeView = {
  id: 't2',
  label: 'Maladie',
  unit: 'day',
  confidential: true,
  active: true,
};
const injustifiee: LeaveTypeView = {
  id: 't3',
  label: 'Absence non justifiée',
  unit: 'day',
  confidential: false,
  hrOnly: true,
  active: true,
};
const archive: LeaveTypeView = {
  id: 't4',
  label: 'Ancien',
  unit: 'day',
  confidential: false,
  active: false,
};
const types = [conges, maladie];

describe('demande d’absence', () => {
  it('types proposés : actifs ; réservés aux RH seulement avec `hr.manage`', () => {
    expect(typesProposes([conges, injustifiee, archive], false).map((t) => t.id)).toEqual(['t1']);
    expect(typesProposes([conges, injustifiee, archive], true).map((t) => t.id)).toEqual([
      't1',
      't3',
    ]);
  });

  it('champs requis et ordre des dates', () => {
    const r = validerDemande({ ...formDemandeInitial('2026-11-02'), fin: '2026-11-01' }, types);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.typeId).toBeDefined();
      expect(r.erreurs.fin).toMatch(/précéder/);
    }
  });

  it('une matinée seule', () => {
    const r = validerDemande(
      { ...formDemandeInitial('2026-11-02'), typeId: 't1', fin: '', demiUnique: 'am' },
      types,
    );
    expect(r).toEqual({
      ok: true,
      corps: {
        typeId: 't1',
        start: { date: '2026-11-02', half: 'am' },
        end: { date: '2026-11-02', half: 'am' },
      },
    });
  });

  it('du lundi matin au vendredi midi (cas 8 de l’ADR) : aucun jour décompté par le web', () => {
    const r = validerDemande(
      {
        ...formDemandeInitial('2026-11-02'),
        typeId: 't1',
        fin: '2026-11-06',
        demiFin: 'am',
        motif: '  Vacances ',
      },
      types,
    );
    expect(r).toEqual({
      ok: true,
      corps: {
        typeId: 't1',
        start: { date: '2026-11-02', half: 'full' },
        end: { date: '2026-11-06', half: 'am' },
        reason: 'Vacances',
      },
    });
    if (r.ok) expect('days' in r.corps).toBe(false);
  });

  it('un type en jours entiers ignore les demi-journées ; saisie pour autrui', () => {
    const r = validerDemande(
      {
        ...formDemandeInitial('2026-11-02'),
        typeId: 't2',
        fin: '2026-11-03',
        demiDebut: 'pm',
        demiFin: 'am',
      },
      types,
      'e9',
    );
    expect(r.ok && r.corps).toEqual({
      typeId: 't2',
      start: { date: '2026-11-02', half: 'full' },
      end: { date: '2026-11-03', half: 'full' },
      employeeId: 'e9',
    });
  });

  it('motif borné', () => {
    const r = validerDemande(
      { ...formDemandeInitial('2026-11-02'), typeId: 't1', motif: 'x'.repeat(501) },
      types,
    );
    expect(!r.ok && r.erreurs.motif).toMatch(/500/);
  });

  it('aide : confidentialité dite, solde rappelé', () => {
    expect(aideType(maladie)).toMatch(/« Absent »/);
    expect(aideType(conges)).toMatch(/solde/);
    expect(aideType(undefined)).toBeUndefined();
  });
});
