import { describe, expect, it } from 'vitest';

import { demande, employe } from './fixtures.test-utils';
import {
  etatMoi,
  grouperDemandes,
  lignesFiche,
  lignesSoldes,
  peutAnnulerDemande,
} from './moi-model';

describe('Mon espace', () => {
  it('404 : pas encore disponible ; autre échec : erreur ; succès : prêt', () => {
    expect(etatMoi(null).etat).toBe('chargement');
    expect(etatMoi({ ok: false, erreur: { status: 404 } }).etat).toBe('pas-encore');
    expect(etatMoi({ ok: false, erreur: { status: 500 } }).etat).toBe('erreur');
    expect(
      etatMoi({
        ok: true,
        valeur: { employee: null, balances: [], requests: [], isManager: false, canApprove: false },
      }).etat,
    ).toBe('pret');
  });

  it('ma fiche : champs non sensibles, vides omis', () => {
    const lignes = lignesFiche(
      employe({ departmentName: 'Finance', managerName: 'Jean', workEmail: 'awa@ex.cd' }),
    );
    expect(lignes.map(([k]) => k)).toEqual([
      'Poste',
      'Service',
      'Manager',
      'Date d’entrée',
      'E-mail professionnel',
    ]);
    expect(lignes[3]![1]).toBe('16 janv. 2026');
  });

  it('soldes affichés tels que rendus, libellé du type lu à défaut', () => {
    const [l] = lignesSoldes(
      [
        {
          typeId: 't1',
          leaveYear: 2026,
          accrued: '20.00',
          allocated: '0.00',
          adjusted: '0.00',
          carriedOver: '0.00',
          expired: '0.00',
          taken: '3.50',
          upcoming: '1.00',
          pending: '0.50',
          available: '15.00',
        },
      ],
      [{ id: 't1', label: 'Congés', unit: 'half_day', confidential: false, active: true }],
    );
    expect(l).toEqual({
      typeId: 't1',
      libelle: 'Congés',
      disponible: '15 jours',
      details: ['Pris : 3,5 jours', 'À venir : 1 jour', 'En attente : 0,5 jour'],
    });
  });

  it('demandes en cours puis passées', () => {
    const jour = '2026-10-30';
    const { enCours, passees } = grouperDemandes(
      [
        demande({
          id: 'a',
          status: 'approved',
          start: { date: '2026-11-10', half: 'full' },
          end: { date: '2026-11-12', half: 'full' },
        }),
        demande({ id: 'b', status: 'pending' }),
        demande({
          id: 'c',
          status: 'approved',
          start: { date: '2026-09-01', half: 'full' },
          end: { date: '2026-09-02', half: 'full' },
        }),
        demande({
          id: 'd',
          status: 'rejected',
          start: { date: '2026-10-01', half: 'full' },
          end: { date: '2026-10-01', half: 'full' },
        }),
      ],
      jour,
    );
    expect(enCours.map((d) => d.id)).toEqual(['b', 'a']);
    expect(passees.map((d) => d.id)).toEqual(['d', 'c']);
  });

  it('annulation : en attente, ou accordée avant son début', () => {
    const jour = '2026-11-02';
    expect(peutAnnulerDemande(demande(), jour)).toBe(true);
    expect(peutAnnulerDemande(demande({ status: 'approved' }), jour)).toBe(false);
    expect(peutAnnulerDemande(demande({ status: 'approved' }), '2026-11-01')).toBe(true);
    expect(peutAnnulerDemande(demande({ status: 'rejected' }), '2026-11-01')).toBe(false);
  });
});
