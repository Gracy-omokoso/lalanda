// Inventaires (ADR-0046 § 2.7) : création, saisie au téléphone, comptage à
// l'aveugle, séparation des tâches de la validation.

import { describe, expect, it } from 'vitest';

import {
  RAISON_COMPTEUR,
  RAISON_RIEN_COMPTE,
  RAISON_SANS_GESTION,
  formulaireInventaire,
  gestesInventaire,
  lignesAffichees,
  lireComptage,
  mentionApprobateurUnique,
  peutSaisirComptage,
  preparerInventaire,
  progression,
  requeteInventaires,
  theoriqueAffichee,
} from './inventaires-model';
import {
  COMMERCIAL,
  COMPTABLE,
  ID1,
  MAGASINIER,
  PROPRIETAIRE,
  inventaire,
  ligneInventaire,
} from './fixtures.test-utils';

const compte = (by: string) =>
  ligneInventaire({
    id: `l-${by}`,
    countedQuantity: '16.000',
    countedBy: by,
    countedAt: '2026-10-30T09:00:00Z',
  });

describe('création', () => {
  it('emplacement obligatoire ; sélection : au moins un article, sans doublon', () => {
    expect(preparerInventaire(formulaireInventaire()).ok).toBe(false);
    expect(preparerInventaire({ ...formulaireInventaire('L'), scope: 'items' }).ok).toBe(false);
    expect(
      preparerInventaire({
        ...formulaireInventaire('L'),
        scope: 'items',
        itemIds: [ID1, ID1],
        assignees: ['u1'],
      }),
    ).toEqual({
      ok: true,
      corps: { locationId: 'L', scope: 'items', itemIds: [ID1], blind: true, assignees: ['u1'] },
    });
  });

  it('à l’aveugle par défaut', () => {
    expect(formulaireInventaire().blind).toBe(true);
  });

  it('filtres', () => {
    expect(requeteInventaires('tous')).toEqual({ limit: 50 });
    expect(requeteInventaires('submitted', 'c')).toEqual({
      limit: 50,
      cursor: 'c',
      status: 'submitted',
    });
  });
});

describe('saisie du comptage', () => {
  it('ouverte à stock.count pendant le comptage seulement', () => {
    expect(peutSaisirComptage(inventaire(), MAGASINIER)).toBe(true);
    expect(peutSaisirComptage(inventaire(), COMMERCIAL)).toBe(false);
    expect(peutSaisirComptage(inventaire({ status: 'submitted' }), MAGASINIER)).toBe(false);
  });

  it('zéro se compte ; décimales bornées', () => {
    expect(lireComptage('0')).toEqual({ ok: true, valeur: '0' });
    expect(lireComptage('2,25')).toEqual({ ok: true, valeur: '2.25' });
    expect(lireComptage('').ok).toBe(false);
  });

  it('à l’aveugle : la théorie n’est jamais montrée pendant le comptage', () => {
    const l = ligneInventaire({ theoretical: '20.000' });
    expect(theoriqueAffichee(inventaire(), l)).toBeNull();
    expect(theoriqueAffichee(inventaire({ blind: false }), l)).toBe('20.000');
    expect(theoriqueAffichee(inventaire({ status: 'submitted' }), l)).toBe('20.000');
    // Masquée par l'API (`theoreticalHidden`) : jamais montrée.
    expect(
      theoriqueAffichee(inventaire({ status: 'submitted', theoreticalHidden: true }), l),
    ).toBeNull();
  });

  it('progression et filtre « à compter », recherche par nom ou code', () => {
    const c = inventaire({ lines: [ligneInventaire(), compte('u1')] });
    expect(progression(c).phrase).toBe('1 ligne comptée sur 2');
    expect(lignesAffichees(c.lines, 'a-compter', '').map((l) => l.id)).toEqual(['l1']);
    expect(lignesAffichees(c.lines, 'toutes', 'cim')).toHaveLength(2);
    expect(lignesAffichees(c.lines, 'toutes', 'zz')).toHaveLength(0);
  });
});

describe('gestes et séparation des tâches', () => {
  it('préparation : ouvrir le comptage (stock.manage)', () => {
    expect(
      gestesInventaire(inventaire({ status: 'draft' }), PROPRIETAIRE, 'u').map((g) => g.id),
    ).toEqual(['demarrer', 'annuler']);
    expect(gestesInventaire(inventaire({ status: 'draft' }), MAGASINIER, 'u')).toEqual([]);
  });

  it('comptage : soumettre désactivé tant que rien n’est compté', () => {
    expect(gestesInventaire(inventaire(), MAGASINIER, 'u')).toEqual([
      {
        id: 'soumettre',
        libelle: 'Soumettre le comptage',
        actif: false,
        raison: RAISON_RIEN_COMPTE,
      },
    ]);
    expect(gestesInventaire(inventaire({ lines: [compte('u')] }), MAGASINIER, 'u')[0]!.actif).toBe(
      true,
    );
  });

  it('celui qui a compté ne valide pas : le refus vient de l’API (`canValidate`)', () => {
    const lignes = [compte('moi'), compte('autre')];
    const refuse = inventaire({
      status: 'submitted',
      lines: lignes,
      canValidate: false,
      validationBlockedBy: 'COUNT_SELF_VALIDATION',
    });
    expect(gestesInventaire(refuse, COMPTABLE, 'moi')[0]).toEqual({
      id: 'valider',
      libelle: 'Valider les écarts',
      actif: false,
      raison: RAISON_COMPTEUR,
    });
    const permis = inventaire({ status: 'submitted', lines: lignes, canValidate: true });
    expect(gestesInventaire(permis, COMPTABLE, 'tiers')[0]!.actif).toBe(true);
  });

  it('le Magasinier ne valide jamais (stock.manage)', () => {
    const c = inventaire({ status: 'submitted', lines: [compte('autre')], canValidate: false });
    expect(gestesInventaire(c, MAGASINIER, 'moi')[0]).toMatchObject({
      actif: false,
      raison: RAISON_SANS_GESTION,
    });
  });

  it('approbateur unique : il valide son propre comptage, l’écran ne le bloque pas', () => {
    const c = inventaire({
      status: 'submitted',
      lines: [compte('moi')],
      canValidate: true,
      validationAsSoleApprover: true,
    });
    expect(gestesInventaire(c, PROPRIETAIRE, 'moi')[0]).toMatchObject({
      actif: true,
      raison: null,
    });
    expect(mentionApprobateurUnique(c)).toMatch(/Seul gestionnaire/);
    expect(mentionApprobateurUnique(inventaire())).toBeNull();
  });

  it('validé ou annulé : plus aucun geste', () => {
    expect(gestesInventaire(inventaire({ status: 'validated' }), PROPRIETAIRE, 'u')).toEqual([]);
    expect(gestesInventaire(inventaire({ status: 'cancelled' }), PROPRIETAIRE, 'u')).toEqual([]);
  });
});
