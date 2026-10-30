// Règles pures de l'envoi par e-mail (ADR-0042 § 2 et § 3).

import { describe, expect, it } from 'vitest';

import {
  DocumentEmailSchema,
  documentEmailDefaults,
  invoiceSendability,
  noticeOf,
  quoteSendability,
} from './document-email.js';

describe('invoiceSendability', () => {
  it('facture et avoir finals partent ; le brouillon part comme pro forma', () => {
    expect(invoiceSendability('issued', 'FV', 'invoice')).toEqual({
      sendable: true,
      nature: 'invoice',
    });
    expect(invoiceSendability('normalized', 'EA', 'invoice')).toEqual({
      sendable: true,
      nature: 'credit_note',
    });
    expect(invoiceSendability('draft', 'FV', 'proforma')).toEqual({
      sendable: true,
      nature: 'proforma',
    });
  });

  it('refuse un document entre deux états, ou normalisé sans éléments de sécurité', () => {
    expect(invoiceSendability('pending_normalization', 'FV', 'proforma').sendable).toBe(false);
    expect(invoiceSendability('normalization_failed', 'FV', 'proforma').sendable).toBe(false);
    expect(invoiceSendability('normalized', 'FV', 'proforma').sendable).toBe(false);
  });
});

describe('quoteSendability', () => {
  it('envoyé ou accepté seulement', () => {
    expect(quoteSendability('sent').sendable).toBe(true);
    expect(quoteSendability('accepted').sendable).toBe(true);
    for (const s of ['draft', 'refused', 'expired'] as const) {
      expect(quoteSendability(s).sendable).toBe(false);
    }
  });
});

describe('mentions et préremplissage', () => {
  it('pro forma et devis portent « pas une facture » ; la facture non', () => {
    expect(noticeOf('proforma')).toMatch(/pas une facture/);
    expect(noticeOf('quote')).toMatch(/pas une facture/);
    expect(noticeOf('invoice')).toBeNull();
    expect(noticeOf('credit_note')).toBeNull();
  });

  it('objet et message citent le document, le montant et l’expéditeur', () => {
    const d = documentEmailDefaults({
      nature: 'quote',
      reference: 'DV2610-000001',
      sellerName: 'Exemple SARL',
      total: '100 000,00',
      currency: 'CDF',
      senderName: 'Awa',
      validUntil: '30/11/2026',
    });
    expect(d.subject).toBe('Devis DV2610-000001 — Exemple SARL');
    expect(d.message).toContain('100 000,00 CDF');
    expect(d.message).toContain('30/11/2026');
    expect(d.message).toMatch(/Awa\nExemple SARL$/);
  });
});

describe('DocumentEmailSchema', () => {
  const ok = { to: 'client@exemple.cd', subject: 'Facture', message: 'Bonjour' };

  it('accepte un envoi minimal ; la copie vaut [] par défaut', () => {
    const r = DocumentEmailSchema.safeParse(ok);
    expect(r.success).toBe(true);
    expect(r.data?.cc).toEqual([]);
  });

  it('refuse une adresse invalide, un objet multiligne, un doublon, un champ inconnu', () => {
    expect(DocumentEmailSchema.safeParse({ ...ok, to: 'pas-une-adresse' }).success).toBe(false);
    expect(DocumentEmailSchema.safeParse({ ...ok, subject: 'a\r\nBcc: x@y.z' }).success).toBe(
      false,
    );
    expect(DocumentEmailSchema.safeParse({ ...ok, cc: ['CLIENT@exemple.cd'] }).success).toBe(false);
    expect(DocumentEmailSchema.safeParse({ ...ok, bcc: ['x@y.z'] }).success).toBe(false);
    expect(
      DocumentEmailSchema.safeParse({
        ...ok,
        cc: ['a@b.cd', 'c@b.cd', 'd@b.cd', 'e@b.cd', 'f@b.cd', 'g@b.cd'],
      }).success,
    ).toBe(false);
    expect(DocumentEmailSchema.safeParse({ ...ok, message: 'x'.repeat(5001) }).success).toBe(false);
  });
});
