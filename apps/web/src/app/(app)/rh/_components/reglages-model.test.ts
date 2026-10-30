// Réglages RH (ADR-0045 § 2.2, § 2.5, § 2.6, § 2.9) — lot H7.
import { describe, expect, it } from 'vitest';

import { HR_DEFAULT_CONTRACT_TYPES, HR_SETTINGS_DEFAULTS } from '@lalanda/shared/hr';

import type { HrSettingsFull } from '@/lib/api-hr-admin';

import {
  PHRASE_AUCUNE_REGLE,
  cleContrat,
  formModele,
  formReglages,
  formTypeAbsence,
  peutModifierCircuit,
  peutModifierReglages,
  phraseDebutAnnee,
  phraseSemaine,
  validerFerie,
  validerModele,
  validerReglages,
  validerTypeAbsence,
} from './reglages-model';

const reglages: HrSettingsFull = {
  ...HR_SETTINGS_DEFAULTS,
  contractTypes: HR_DEFAULT_CONTRACT_TYPES.map((c) => ({ ...c })),
  reminders: { ...HR_SETTINGS_DEFAULTS.reminders },
  retention: { ...HR_SETTINGS_DEFAULTS.retention },
  revision: 0,
  isDefault: true,
};

describe('droits et texte d’aide', () => {
  it('le circuit exige leave.approve en plus de hr.manage', () => {
    expect(peutModifierReglages(['hr.manage'])).toBe(true);
    expect(peutModifierCircuit(['hr.manage'])).toBe(false);
    expect(peutModifierCircuit(['hr.manage', 'leave.approve'])).toBe(true);
  });

  it('Lalanda ne pose aucune règle légale, le texte le dit', () => {
    expect(PHRASE_AUCUNE_REGLE).toMatch(/aucune règle légale/);
  });
});

describe('réglages généraux', () => {
  it('aller-retour sans changement, puis corps validé par le schéma partagé', () => {
    const r = validerReglages(formReglages(reglages), 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.corps.workPattern).toEqual(HR_SETTINGS_DEFAULTS.workPattern);
      expect(r.corps.leaveYearStart).toBe('01-01');
      expect(r.corps.retention).toEqual({
        privateDataMonthsAfterExit: null,
        anonymizeYearsAfterExit: null,
      });
    }
  });

  it('refuse une semaine vide, une date impossible, un délai non entier', () => {
    const f = formReglages(reglages);
    const vide = {
      ...f,
      semaine: { mon: '0', tue: '0', wed: '0', thu: '0', fri: '0', sat: '0', sun: '0' } as const,
    };
    expect(validerReglages(vide, 0).ok).toBe(false);
    expect(validerReglages({ ...f, debutMois: '02', debutJour: '31' }, 0).ok).toBe(false);
    expect(validerReglages({ ...f, rappelEssai: 'quinze' }, 0)).toMatchObject({ ok: false });
  });

  it('phrases lisibles', () => {
    expect(phraseSemaine(reglages)).toBe('lundi, mardi, mercredi, jeudi, vendredi');
    expect(phraseDebutAnnee('07-01')).toBe('1er juillet');
  });

  it('clé d’un nouveau type de contrat, unique', () => {
    expect(cleContrat('Consultant externe', [])).toBe('consultant_externe');
    expect(cleContrat('CDI', ['cdi'])).toBe('cdi_2');
  });
});

describe('types d’absence', () => {
  it('par défaut : aucune acquisition (aucun droit posé)', () => {
    const r = validerTypeAbsence({ ...formTypeAbsence(null), label: 'Formation' });
    expect(r).toMatchObject({ ok: true, corps: { accrual: { kind: 'none' } } });
  });

  it('acquisition saisie en français, deux décimales au plus', () => {
    const f = {
      ...formTypeAbsence(null),
      label: 'Congés',
      deductsFromBalance: true,
      acquisition: 'monthly' as const,
      jours: '2,08',
    };
    expect(validerTypeAbsence(f)).toMatchObject({
      ok: true,
      corps: { accrual: { kind: 'monthly', days: '2.08' } },
    });
    expect(validerTypeAbsence({ ...f, jours: '2,085' }).ok).toBe(false);
  });
});

describe('jours fériés et modèles', () => {
  it('jour férié : date et libellé requis', () => {
    expect(
      validerFerie({ date: '2026-06-30', label: 'Fermeture', demi: '', recurring: true }),
    ).toMatchObject({
      ok: true,
      corps: { halfDay: null, recurring: true },
    });
    expect(validerFerie({ date: '', label: '', demi: '', recurring: false }).ok).toBe(false);
  });

  it('modèle : décalage entier, au moins un élément', () => {
    const f = formModele(null);
    f.label = 'Accueil';
    f.items[0] = { label: 'Remettre le badge', assignee: 'hr', offsetDays: '-2', note: '' };
    expect(validerModele(f)).toMatchObject({ ok: true, corps: { items: [{ offsetDays: -2 }] } });
    expect(validerModele({ ...f, items: [] }).ok).toBe(false);
    expect(validerModele({ ...f, items: [{ ...f.items[0]!, offsetDays: 'demain' }] }).ok).toBe(
      false,
    );
  });
});
