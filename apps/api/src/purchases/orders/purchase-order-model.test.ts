// Règles pures des demandes et commandes — ADR-0044 § 2.3. ADR-0044 — P3.

import { describe, expect, it } from 'vitest';

import { formatPurchaseNumber } from '../counters/purchase-counters.service.js';
import {
  CANCELLABLE_STATUSES,
  EDITABLE_STATUSES,
  approvableFilter,
  isSoleApproverOrg,
} from './purchase-order-model.js';

describe('demandes et commandes — règles pures (ADR-0044 § 2.3)', () => {
  it('approbateur unique : réglage permis ET un seul détenteur effectif', () => {
    expect(isSoleApproverOrg(true, 1)).toBe(true);
    expect(isSoleApproverOrg(true, 0)).toBe(true);
    expect(isSoleApproverOrg(true, 2)).toBe(false);
    expect(isSoleApproverOrg(false, 1)).toBe(false);
  });

  it('à approuver : soumise, pas déjà approuvée par lui, ni demandeur ni créateur', () => {
    expect(approvableFilter('org', 'u', false)).toEqual({
      organizationId: 'org',
      status: 'submitted',
      'approvals.userId': { $ne: 'u' },
      $nor: [{ requestedBy: 'u' }, { createdBy: 'u' }],
    });
    expect(approvableFilter('org', 'u', true)).not.toHaveProperty('$nor');
  });

  it('une commande envoyée ne se modifie plus ; on annule avant réception complète', () => {
    expect(EDITABLE_STATUSES).not.toContain('sent');
    expect(CANCELLABLE_STATUSES).toContain('partially_received');
    expect(CANCELLABLE_STATUSES).not.toContain('received');
  });

  it('numéros `{P}{AA}{MM}-NNNNNN`', () => {
    expect(formatPurchaseNumber('request', { year: 2026, month: 10 }, 1)).toBe('DA2610-000001');
    expect(formatPurchaseNumber('order', { year: 2027, month: 1 }, 42)).toBe('BC2701-000042');
    expect(formatPurchaseNumber('invoice', { year: 2026, month: 12 }, 7)).toBe('FF2612-000007');
  });
});
