import { describe, expect, it } from 'vitest';

import { facturationContrat } from './bloc-contrat-projet';

const c = {
  contractId: 'c',
  number: 'CT2611-000001',
  title: 'Maintenance',
  status: 'signed',
  customerName: 'Client',
  startDate: '2026-11-01',
  initialTermMonths: 12,
  billingKind: 'schedule' as const,
  scheduleItemCount: 3,
};

describe('ADR-0077 § 1.7 — bloc Contrat du projet', () => {
  it('facturation sans montant', () => {
    expect(facturationContrat(c)).toBe('Échéancier · 3 échéances');
    expect(facturationContrat({ ...c, scheduleItemCount: 1 })).toBe('Échéancier · 1 échéance');
    expect(facturationContrat({ ...c, billingKind: 'recurring' })).toBe('Abonnement');
  });
});
