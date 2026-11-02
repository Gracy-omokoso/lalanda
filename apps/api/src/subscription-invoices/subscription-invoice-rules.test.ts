import { describe, expect, it } from 'vitest';

import {
  billingIdentityOf,
  creditApprovalDecision,
  customerTypeOf,
  invoicePaymentMethodOf,
  subscriptionComment,
  subscriptionLineCode,
  subscriptionLineName,
} from './subscription-invoice-rules.js';

describe('ADR-0047 — règles de la facture des abonnements', () => {
  it('identité : fiche de facturation, puis fiche fiscale, puis nom de l’organisation', () => {
    const fiscal = { legalName: 'Fiscale SARL', nif: 'A1234567Z', address: 'Kinshasa' };
    expect(
      billingIdentityOf({
        profile: { legalName: ' Saisie SA ', nif: 'b 98-765', address: '' },
        fiscal,
        organizationName: 'Org',
      }),
    ).toEqual({ legalName: 'Saisie SA', nif: 'B98765', address: null, source: 'billing_profile' });
    expect(billingIdentityOf({ profile: null, fiscal, organizationName: 'Org' })).toMatchObject({
      legalName: 'Fiscale SARL',
      nif: 'A1234567Z',
      source: 'fiscal_profile',
    });
    expect(billingIdentityOf({ profile: null, fiscal: null, organizationName: 'Org' })).toEqual({
      legalName: 'Org',
      nif: null,
      address: null,
      source: 'organization',
    });
  });

  it('un NIF illisible n’est jamais transmis ; sans NIF, client de type PP', () => {
    const id = billingIdentityOf({
      profile: { legalName: 'X', nif: '!!', address: null },
      fiscal: null,
      organizationName: 'X',
    });
    expect(id.nif).toBeNull();
    expect(customerTypeOf(id)).toBe('PP');
    expect(customerTypeOf({ ...id, nif: 'A12345' })).toBe('PM');
  });

  it('désignation, code, commentaire et moyen de paiement', () => {
    expect(subscriptionLineName('pro', 'month')).toBe('Abonnement Lalanda Pro — mensuel');
    expect(subscriptionLineCode('business', 'year')).toBe('LLD-BUSINESS-A');
    expect(
      subscriptionComment({
        reference: 'LLD-ABC-1',
        eventId: 'manual:LLD-ABC-1',
        periodStart: new Date('2026-11-03T00:00:00Z'),
        periodEnd: new Date('2026-12-03T00:00:00Z'),
      }),
    ).toBe('Paiement LLD-ABC-1 — période du 03/11/2026 au 03/12/2026');
    expect(invoicePaymentMethodOf('mobile_money')).toBe('MOBILEMONEY');
    expect(invoicePaymentMethodOf('bank_transfer')).toBe('VIREMENT');
    expect(invoicePaymentMethodOf('card')).toBe('CARTEBANCAIRE');
    expect(invoicePaymentMethodOf('paypal')).toBe('AUTRE');
  });

  it('avoir : deux personnes, sauf détenteur unique (marqué)', () => {
    expect(
      creditApprovalDecision({ requestedBy: 'a', approverUserId: 'b', holdersCount: 2 }),
    ).toEqual({
      ok: true,
      soleApprover: false,
    });
    expect(
      creditApprovalDecision({ requestedBy: 'a', approverUserId: 'a', holdersCount: 2 }),
    ).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    expect(
      creditApprovalDecision({ requestedBy: 'a', approverUserId: 'a', holdersCount: 1 }),
    ).toEqual({
      ok: true,
      soleApprover: true,
    });
  });
});
