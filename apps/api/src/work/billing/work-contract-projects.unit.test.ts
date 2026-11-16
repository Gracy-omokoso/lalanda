import { describe, expect, it } from 'vitest';

import { isRealProjectId, pendingOf } from './work-contract-links.js';
import { contractSeeds } from './work-contract-projects.service.js';

const contract = {
  number: 'CT2611-000001',
  lines: [
    { name: 'Maintenance', quantity: '12', unit: 'mois' },
    { name: '', quantity: '1', unit: null },
  ],
  billing: {
    kind: 'schedule' as const,
    items: [{ itemRef: 'E1', dueDate: '2026-12-01', label: 'Installation' }],
  },
};

describe('ADR-0077 § 1 — graines du projet d’un contrat', () => {
  it('une tâche par ligne sans montant, puis un jalon par échéance', () => {
    const seeds = contractSeeds(contract, undefined, true);
    expect(seeds.map((s) => [s.title, s.milestone?.dueDate ?? null])).toEqual([
      ['Maintenance', null],
      ['Ligne 2', null],
      ['Installation', '2026-12-01'],
    ]);
    expect(seeds[0]!.description).toBe('Quantité : 12 mois\nLigne 1 du contrat CT2611-000001.');
  });

  it('sans jalons sur demande, ni pour un abonnement', () => {
    expect(contractSeeds(contract, [0], false)).toHaveLength(1);
    const recurring = { ...contract, billing: { kind: 'recurring' as const } };
    expect(contractSeeds(recurring, undefined, true).some((s) => s.milestone)).toBe(false);
  });

  it('indice hors du contrat : 400', () => {
    expect(() => contractSeeds(contract, [5], true)).toThrow();
  });

  it('réservation : jamais prise pour un projet réel', () => {
    const id = 'a'.repeat(24);
    expect(isRealProjectId(id)).toBe(true);
    expect(isRealProjectId(pendingOf(id))).toBe(false);
    expect(isRealProjectId(null)).toBe(false);
  });
});
