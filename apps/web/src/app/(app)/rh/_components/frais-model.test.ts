import { EXPENSE_LINE_CATEGORIES } from '@lalanda/shared/hr';
import { describe, expect, it } from 'vitest';

import {
  CATEGORIES_LIGNE,
  LIBELLES_CATEGORIE,
  PHRASES_SEPARATION,
  PHRASE_APPROBATEUR_UNIQUE,
  apercuEnLigne,
  controleJustificatif,
  gestesAvance,
  gestesNote,
  libelleNatureAvance,
  lireLigne,
  ligneVide,
  separation,
  vueFrais,
  vuesFraisOffertes,
} from './frais-model';

const moi = { employeeId: 'e-moi', userId: 'u-moi' };
const note = {
  status: 'submitted' as const,
  employeeId: 'e-autre',
  createdBy: 'u-autre',
  approvals: [],
  reimbursement: null,
};

describe('ADR-0051 H16 — notes de frais : vue et droits', () => {
  it('vue d’arrivée selon les actions, jamais une vue interdite', () => {
    expect(vueFrais(null, ['expenses.approve'])).toBe('a-valider');
    expect(vueFrais(null, ['payables.pay', 'treasury.read'])).toBe('a-payer');
    expect(vueFrais('a-payer', ['hr.read'])).toBe('toutes');
    expect(vueFrais('toutes', ['expenses.claim'])).toBe('a-valider');
    expect(vuesFraisOffertes(['expenses.claim'])).toEqual(['a-valider']);
    expect(vuesFraisOffertes(['payables.pay', 'hr.read'])).toEqual([
      'a-valider',
      'a-payer',
      'toutes',
    ]);
  });

  it('les douze catégories d’une ligne, investissement et emprunt exclus', () => {
    expect([...CATEGORIES_LIGNE]).toEqual([...EXPENSE_LINE_CATEGORIES]);
    expect(Object.keys(LIBELLES_CATEGORIE).sort()).toEqual([...EXPENSE_LINE_CATEGORIES].sort());
    expect(Object.keys(LIBELLES_CATEGORIE)).not.toContain('investissement');
  });

  it('« Avance » neutre quand la nature est masquée (§ 4)', () => {
    expect(libelleNatureAvance(null)).toBe('Avance');
    expect(libelleNatureAvance('salary')).toBe('Avance sur salaire');
    expect(libelleNatureAvance('expenses')).toBe('Avance de frais');
  });
});

describe('ADR-0051 H16 — séparation des tâches visible', () => {
  it('le bénéficiaire, l’auteur d’une saisie et l’approbateur précédent ne valident pas', () => {
    expect(separation({ ...note, employeeId: 'e-moi' }, moi)).toBe('beneficiaire');
    expect(separation({ ...note, createdBy: 'u-moi' }, moi)).toBe('auteur');
    expect(
      separation({ ...note, approvals: [{ userId: 'u-moi', decision: 'approved' }] }, moi),
    ).toBe('deja-valide');
    expect(separation(note, moi)).toBeNull();
  });

  it('sa propre note : aucun bouton « Valider », la phrase le dit', () => {
    const g = gestesNote({ ...note, employeeId: 'e-moi' }, moi, ['expenses.approve'], false);
    expect(g.valider).toBe(false);
    expect(g.phrase).toBe(PHRASES_SEPARATION.beneficiaire);
    expect(g.annuler).toBe(true);
  });

  it('la vue « à valider » de l’API fait foi : approbateur unique signalé', () => {
    const g = gestesNote({ ...note, employeeId: 'e-moi' }, moi, ['expenses.approve'], true);
    expect(g.valider).toBe(true);
    expect(g.phrase).toBe(PHRASE_APPROBATEUR_UNIQUE);
  });

  it('rembourser : `payables.pay` et `treasury.read`, une note approuvée non remboursée', () => {
    const approuvee = { ...note, status: 'approved' as const };
    expect(gestesNote(approuvee, moi, ['payables.pay', 'treasury.read'], false).rembourser).toBe(
      true,
    );
    expect(gestesNote(approuvee, moi, ['payables.pay'], false).rembourser).toBe(false);
    expect(gestesNote(approuvee, moi, ['expenses.approve'], false).valider).toBe(false);
  });

  it('brouillon : modifier et soumettre pour le bénéficiaire seulement', () => {
    const brouillon = { ...note, status: 'draft' as const, employeeId: 'e-moi' };
    expect(gestesNote(brouillon, moi, ['expenses.claim'], false)).toMatchObject({
      modifier: true,
      soumettre: true,
    });
    expect(gestesNote({ ...brouillon, employeeId: 'x' }, moi, [], false).soumettre).toBe(false);
  });

  it('avance sur salaire : le manager n’est jamais une autorité', () => {
    const avance = {
      status: 'submitted' as const,
      employeeId: 'e-equipe',
      createdBy: 'u-equipe',
      approvals: [],
      disbursement: null,
    };
    expect(gestesAvance({ ...avance, kind: 'expenses' }, moi, [], ['e-equipe']).valider).toBe(true);
    expect(gestesAvance({ ...avance, kind: 'salary' }, moi, [], ['e-equipe']).valider).toBe(false);
    const soi = gestesAvance({ ...avance, kind: 'expenses', employeeId: 'e-moi' }, moi, [
      'expenses.approve',
    ]);
    expect(soi.valider).toBe(false);
    expect(soi.phrase).toBe(PHRASES_SEPARATION.beneficiaire);
  });
});

describe('ADR-0051 H16 — saisie d’une ligne et justificatif', () => {
  it('lit une ligne complète en chaînes, montant à la française', () => {
    const l = lireLigne(
      {
        ...ligneVide('2026-11-02'),
        category: 'transport',
        label: ' Taxi ',
        amount: '15,5',
        merchant: '',
      },
      '2026-11-02',
    );
    expect(l).toEqual({
      ok: true,
      ligne: { spentOn: '2026-11-02', category: 'transport', label: 'Taxi', amount: '15.5' },
    });
  });

  it('refacturable seulement avec un projet', () => {
    const base = {
      ...ligneVide('2026-11-02'),
      category: 'transport' as const,
      label: 'Taxi',
      amount: '5',
    };
    expect(lireLigne({ ...base, rebillable: true }, '2026-11-02').ok).toBe(false);
    expect(
      lireLigne({ ...base, rebillable: true, workProjectId: 'p1' }, '2026-11-02'),
    ).toMatchObject({
      ok: true,
      ligne: { workProjectId: 'p1', rebillable: true },
    });
  });

  it('refuse date future, catégorie et montant absents', () => {
    const l = lireLigne({ ...ligneVide('2026-11-03'), label: 'x' }, '2026-11-02');
    expect(l.ok).toBe(false);
    if (!l.ok) {
      expect(l.erreurs).toContain('La date de la dépense ne peut pas être future.');
      expect(l.erreurs).toContain('Choisissez une catégorie.');
      expect(l.erreurs).toContain('Saisissez un montant.');
    }
  });

  it('justificatif : photo ≤ 2 Mo ou PDF ≤ 10 Mo, aperçu en ligne pour une image seulement', () => {
    expect(controleJustificatif({ type: 'image/jpeg', size: 1_000 })).toBeNull();
    expect(controleJustificatif({ type: 'image/jpeg', size: 3 * 1024 * 1024 })).toMatch(/2 Mo/);
    expect(controleJustificatif({ type: 'application/pdf', size: 3 * 1024 * 1024 })).toBeNull();
    expect(controleJustificatif({ type: 'image/svg+xml', size: 10 })).toMatch(/Format refusé/);
    expect(apercuEnLigne('image/png')).toBe(true);
    expect(apercuEnLigne('application/pdf')).toBe(false);
  });
});
