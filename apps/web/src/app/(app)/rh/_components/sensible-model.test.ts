// Données sensibles (ADR-0045 § 2.4, § 8) — lot H7.
import { describe, expect, it } from 'vitest';

import type { EmployeePrivateSummary } from '@lalanda/shared/hr';

import {
  PHRASE_JOURNALISEE,
  PHRASE_PLAFOND,
  formSensible,
  formatMontantDeclare,
  lignesClaires,
  lignesMasquees,
  messageSensible,
  peutModifierSensible,
  peutVoirSensible,
  phraseAlerteBancaire,
  validerSensible,
} from './sensible-model';

const tampon = { changedAt: '2026-10-01T08:00:00.000Z', changedBy: 'u1' };

const resume: EmployeePrivateSummary = {
  employeeId: 'e1',
  revision: 3,
  compensation: { ...tampon, since: '2026-01-01', entries: 2 },
  bankDetails: {
    ...tampon,
    accounts: [{ kind: 'bank', masked: 'Rawbank •••• 4521', fingerprint: 'f1' }],
  },
  identity: {
    ...tampon,
    hasBirthDate: true,
    hasNationality: false,
    idDocuments: [{ kind: 'passport', expiresOn: '2027-03-01' }],
  },
  personalContact: {
    ...tampon,
    hasAddress: true,
    hasPersonalPhone: false,
    hasPersonalEmail: false,
    emergencyContacts: 2,
  },
  exitNote: null,
  bankDetailsAlert: { ...tampon, until: '2026-10-08T08:00:00.000Z' },
};

describe('droits', () => {
  it('voir : hr.sensitive.read ou soi ; modifier : hr.manage ET hr.sensitive.read', () => {
    expect(peutVoirSensible(['hr.read', 'hr.manage'], false)).toBe(false);
    expect(peutVoirSensible(['hr.sensitive.read'], false)).toBe(true);
    expect(peutVoirSensible(['leave.request'], true)).toBe(true);
    expect(peutModifierSensible(['hr.manage'])).toBe(false);
    expect(peutModifierSensible(['hr.manage', 'hr.sensitive.read'])).toBe(true);
    expect(peutModifierSensible(null)).toBe(false);
  });
});

describe('formes masquées', () => {
  it('ni montant, ni numéro : seulement ce que l’API masque', () => {
    expect(lignesMasquees('compensation', resume)).toEqual([
      'Salaire renseigné depuis le 1 janv. 2026',
      '2 entrées dans l’historique',
    ]);
    expect(lignesMasquees('bankDetails', resume)).toEqual(['Banque · Rawbank •••• 4521']);
    expect(lignesMasquees('identity', resume)).toEqual([
      'Date de naissance renseignée',
      'Passeport — expire le 1 mars 2027',
    ]);
    expect(lignesMasquees('personalContact', resume)).toContain('2 contacts d’urgence renseignés');
    expect(lignesMasquees('exitNote', resume)).toEqual([]);
  });

  it('le bandeau bancaire alerte sans révéler', () => {
    expect(phraseAlerteBancaire(resume)).toMatch(/modifiées le 1 oct\. 2026/);
    expect(phraseAlerteBancaire({ ...resume, bankDetailsAlert: null })).toBeNull();
  });
});

describe('affichage', () => {
  it('la confirmation dit que l’affichage est journalisé', () => {
    expect(PHRASE_JOURNALISEE).toMatch(/journalisé/);
    expect(PHRASE_JOURNALISEE).toMatch(/60 secondes/);
  });

  it('le plafond (429) se dit en clair', () => {
    expect(messageSensible({ status: 429, detail: { code: 'HR_REVEAL_RATE_LIMITED' } }, 'x')).toBe(
      PHRASE_PLAFOND,
    );
    expect(PHRASE_PLAFOND).toMatch(/30 affichages/);
  });

  it('le clair est mis en forme sans calcul', () => {
    expect(formatMontantDeclare('450000.00', 'CDF')).toBe('450 000 CDF');
    expect(formatMontantDeclare('1200.50', 'USD')).toBe('1 200,50 USD');
    expect(
      lignesClaires('compensation', {
        history: [
          { effectiveFrom: '2026-01-01', amount: '450000.00', currency: 'CDF', period: 'month' },
        ],
      }),
    ).toEqual([['Depuis le 1 janv. 2026', '450 000 CDF par mois']]);
  });
});

describe('formulaires', () => {
  it('salaire : saisie française normalisée, schéma partagé', () => {
    const f = formSensible('compensation', null);
    f.salaires[0] = {
      effectiveFrom: '2026-01-01',
      amount: '450 000,5',
      currency: 'CDF',
      period: 'month',
      note: '',
    };
    const r = validerSensible('compensation', f);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.history[0]!.amount).toBe('450000.50');
  });

  it('erreurs lisibles, numéro de ligne compris', () => {
    const f = formSensible('personalContact', null);
    f.contacts = [{ name: 'Marie', relation: 'Sœur', phone: 'abc' }];
    const r = validerSensible('personalContact', f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.join(' ')).toMatch(/Ligne 1 : Numéro de téléphone invalide/);
  });

  it('coordonnées bancaires prérempliées depuis le clair', () => {
    const f = formSensible('bankDetails', {
      accounts: [
        { kind: 'mobile_money', operator: 'M-Pesa', holderName: 'A', phoneNumber: '+243810000000' },
      ],
    });
    expect(f.comptes[0]).toMatchObject({ kind: 'mobile_money', nom: 'M-Pesa' });
    expect(validerSensible('bankDetails', f).ok).toBe(true);
  });
});
