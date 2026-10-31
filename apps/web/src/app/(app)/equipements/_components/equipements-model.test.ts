// Règles communes des équipements (ADR-0046 § 5.2, § 8) : droits par actions,
// valeurs masquées, refus de chevauchement clair, mise en forme sans calcul.

import { describe, expect, it } from 'vitest';

import {
  estRefusChevauchement,
  formatMontant,
  formatPourcentage,
  libelleBeneficiaire,
  lireEntierSaisi,
  lireMontantSaisi,
  messageEquipements,
  montantPourSaisie,
  peutExporterRegistre,
  peutGererEquipements,
  peutVoirValeurs,
  valeursAffichees,
} from './equipements-model';
import { EXPORTATEUR, GESTIONNAIRE, LECTEUR_RH } from './fixtures.test-utils';

const erreur = (status: number, code?: string) => ({
  status,
  detail: code ? { code, message: 'brut' } : {},
});

describe('droits (useShell().actions)', () => {
  it('gestion, export et valeurs selon les actions, jamais le rôle', () => {
    expect(peutGererEquipements(GESTIONNAIRE)).toBe(true);
    expect(peutGererEquipements(LECTEUR_RH)).toBe(false);
    expect(peutExporterRegistre(EXPORTATEUR)).toBe(true);
    expect(peutExporterRegistre(GESTIONNAIRE)).toBe(false);
    expect(peutVoirValeurs(LECTEUR_RH)).toBe(false);
    expect(peutVoirValeurs(EXPORTATEUR)).toBe(true);
    expect(peutGererEquipements(null)).toBe(false);
  });

  it('une valeur masquée par l’API reste masquée', () => {
    expect(valeursAffichees(GESTIONNAIRE, true)).toBe(false);
    expect(valeursAffichees(GESTIONNAIRE, false)).toBe(true);
    expect(valeursAffichees(LECTEUR_RH, false)).toBe(false);
  });
});

describe('erreurs', () => {
  it('le chevauchement d’affectation est dit clairement', () => {
    const e = erreur(409, 'ASSET_ASSIGNMENT_OVERLAP');
    expect(estRefusChevauchement(e)).toBe(true);
    expect(messageEquipements(e, 'x')).toMatch(/chevaucherait/);
    expect(estRefusChevauchement(erreur(409, 'STALE_REVISION'))).toBe(false);
  });

  it('403, 404 et message de l’API', () => {
    expect(messageEquipements(erreur(403), 'x')).toMatch(/rôle/);
    expect(messageEquipements(erreur(404), 'x')).toMatch(/introuvable/);
    expect(messageEquipements({ status: 400, detail: { message: 'Nom obligatoire.' } }, 'x')).toBe(
      'Nom obligatoire.',
    );
    expect(messageEquipements(null, 'repli')).toBe('repli');
  });
});

describe('mise en forme et saisies', () => {
  it('montants groupés, virgule, devise', () => {
    expect(formatMontant('1200.00', 'USD')).toBe('1 200,00 USD');
    expect(formatMontant('-5.5', 'CDF')).toBe('−5,50 CDF');
    expect(formatMontant(null, 'USD')).toBe('—');
    expect(formatPourcentage('33.33')).toBe('33,33 %');
  });

  it('saisies dans la forme du contrat', () => {
    expect(lireMontantSaisi('1 200,5')).toEqual({ ok: true, valeur: '1200.5' });
    expect(lireMontantSaisi('12,345').ok).toBe(false);
    expect(lireMontantSaisi('').ok).toBe(false);
    expect(montantPourSaisie('1200.00')).toBe('1200,00');
    expect(lireEntierSaisi('3', 1, 50)).toEqual({ ok: true, valeur: 3 });
    expect(lireEntierSaisi('0', 1, 50).ok).toBe(false);
    expect(lireEntierSaisi('2,5', 1, 50).ok).toBe(false);
  });

  it('bénéficiaire lisible, collaborateur sorti signalé', () => {
    expect(libelleBeneficiaire(null)).toBe('Personne');
    expect(
      libelleBeneficiaire({
        kind: 'employee',
        employeeId: 'e1',
        name: 'Aline',
        jobTitle: 'Comptable',
        exited: true,
      }),
    ).toBe('Aline (Comptable) — sorti de l’organisation');
    expect(libelleBeneficiaire({ kind: 'project', workProjectId: 'p', name: 'Gombe' })).toBe(
      'Projet Gombe',
    );
  });
});
