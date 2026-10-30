import { describe, expect, it } from 'vitest';

import { demande, employe } from './fixtures.test-utils';
import { membresEquipe, presence } from './equipe-model';

describe('Mon équipe', () => {
  const jour = '2026-11-04';

  it('présence : absence en cours, à venir, ou rien ; types masqués restent « Absent »', () => {
    expect(presence([demande({ status: 'approved' })], jour)).toEqual({
      texte: 'Congés aujourd’hui, jusqu’au 6 nov. 2026',
      absent: true,
    });
    expect(
      presence([demande({ status: 'approved', typeLabel: 'Absent', masked: true })], jour)?.texte,
    ).toMatch(/^Absent aujourd’hui/);
    expect(presence([demande({ status: 'approved' })], '2026-10-30')).toEqual({
      texte: 'Congés à partir du 2 nov. 2026',
      absent: false,
    });
    expect(presence([demande({ status: 'pending' })], jour)).toBeNull();
    expect(presence(undefined, jour)).toBeNull();
  });

  it('directs puis indirects, par nom ; soldes rendus tels quels', () => {
    const { directs, indirects } = membresEquipe(
      {
        members: [
          { employee: employe({ id: 'b', firstName: 'Zoé' }), direct: true },
          {
            employee: employe({ id: 'a', firstName: 'Ali', departmentName: 'Ventes' }),
            direct: true,
            balances: [
              {
                typeId: 't1',
                typeLabel: 'Congés',
                leaveYear: 2026,
                accrued: '0.00',
                allocated: '0.00',
                adjusted: '0.00',
                carriedOver: '0.00',
                expired: '0.00',
                taken: '0.00',
                upcoming: '0.00',
                pending: '0.00',
                available: '2.50',
              },
            ],
          },
          { employee: employe({ id: 'c', firstName: 'Céline' }), direct: false },
        ],
      },
      jour,
    );
    expect(directs.map((m) => m.id)).toEqual(['a', 'b']);
    expect(indirects.map((m) => m.id)).toEqual(['c']);
    expect(directs[0]!.poste).toBe('Comptable · Ventes');
    expect(directs[0]!.soldes).toEqual(['Congés : 2,5 jours disponibles']);
  });
});
