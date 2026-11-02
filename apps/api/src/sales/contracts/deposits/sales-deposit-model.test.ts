// Règles pures des acomptes — ADR-0050 § 5.1, § 5.2. ADR-0050 — V4.

import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';

import type { LiveLink } from '../links/sales-document-links.service.js';
import { orderInvoiceComment } from '../orders/sales-order-model.js';
import {
  commentWithDepositRecall,
  depositItemTypeOf,
  depositRecallCode,
  depositRecallCodes,
  depositRecallText,
  isDepositLink,
  isFinalLink,
  sameAmount,
} from './sales-deposit-model.js';

type Inv = LiveLink['invoice'];

const invoice = (over: Partial<Inv> = {}): Inv => ({
  _id: new Types.ObjectId(),
  type: 'FT',
  status: 'issued',
  number: 'FT2611-000001',
  proformaRef: null,
  currency: 'USD',
  lines: [],
  documentAmounts: {} as Inv['documentAmounts'],
  normalization: null,
  series: 'real',
  ...over,
});

const live = (kind: string, inv: Inv): LiveLink =>
  ({ link: { kind, invoiceId: String(inv._id) }, invoice: inv }) as unknown as LiveLink;

describe('depositRecallCode', () => {
  it('numéro d’une facture émise en série réelle', () => {
    expect(depositRecallCode(invoice())).toBe('FT2611-000001');
  });
  it('code DEF/DGI d’une facture normalisée, numéro à défaut', () => {
    expect(
      depositRecallCode(
        invoice({ status: 'normalized', normalization: { codeDefDgi: 'DEF-ABC-123' } }),
      ),
    ).toBe('DEF-ABC-123');
    expect(depositRecallCode(invoice({ status: 'normalized', normalization: null }))).toBe(
      'FT2611-000001',
    );
  });
  it('rien pour un brouillon, une normalisation en cours ou en échec, une série d’essai', () => {
    expect(depositRecallCode(invoice({ status: 'draft', number: null }))).toBeNull();
    expect(depositRecallCode(invoice({ status: 'pending_normalization' }))).toBeNull();
    expect(depositRecallCode(invoice({ status: 'normalization_failed' }))).toBeNull();
    expect(depositRecallCode(invoice({ series: 'test' }))).toBeNull();
    expect(depositRecallCode(invoice({ series: 'proforma' }))).toBeNull();
  });
});

describe('depositRecallCodes', () => {
  it('acomptes émis seulement, dans l’ordre, sans doublon ni facture finale', () => {
    const a = invoice({ number: 'FT-1' });
    const b = invoice({ number: 'FT-2', status: 'draft' });
    const c = invoice({ number: 'FT-3', type: 'ET' });
    const fv = invoice({ number: 'FV-1', type: 'FV' });
    expect(
      depositRecallCodes([
        live('order_deposit', a),
        live('order_deposit', b),
        live('order_invoice', fv),
        live('contract_deposit', c),
      ]),
    ).toEqual(['FT-1', 'FT-3']);
  });
  it('classement des liens', () => {
    const i = invoice();
    expect(isDepositLink(live('order_deposit', i))).toBe(true);
    expect(isDepositLink(live('order_invoice', i))).toBe(false);
    for (const k of [
      'order_invoice',
      'contract_invoice',
      'schedule_item',
      'subscription_occurrence',
    ]) {
      expect(isFinalLink(live(k, i)), k).toBe(true);
    }
    expect(isFinalLink(live('contract_deposit', i))).toBe(false);
  });
});

describe('ligne C de la facture finale', () => {
  it('rappel en tête, puis la commande ; inchangée sans acompte', () => {
    expect(depositRecallText([])).toBe('');
    expect(depositRecallText(['FT-1'])).toBe('Acompte FT-1');
    expect(depositRecallText(['FT-1', 'FT-2'])).toBe('Acomptes FT-1, FT-2');
    const order = { number: 'CC2611-000001', customerReference: 'BC-7' };
    expect(orderInvoiceComment(order, 255)).toEqual({
      text: 'Commande CC2611-000001 — réf. client BC-7',
      truncated: false,
    });
    expect(orderInvoiceComment(order, 255, ['FT-1'])).toEqual({
      text: 'Acompte FT-1 — Commande CC2611-000001 — réf. client BC-7',
      truncated: false,
    });
  });
  it('tronquée par la fin : les codes rappelés restent entiers', () => {
    const r = commentWithDepositRecall('Commande CC2611-000001', ['FT-1'], 20);
    expect(r).toEqual({ text: 'Acompte FT-1 — Comma', truncated: true });
    expect(commentWithDepositRecall('', ['FT-1'], 255).text).toBe('Acompte FT-1');
  });
});

describe('depositItemTypeOf', () => {
  it('groupes L et N : TAX', () => {
    expect(depositItemTypeOf('L', [])).toEqual({ itemType: 'TAX', toCheck: false });
    expect(depositItemTypeOf('N', [{ taxGroup: 'B', itemType: 'BIE' }])).toEqual({
      itemType: 'TAX',
      toCheck: false,
    });
  });
  it('repris des lignes du même groupe, puis de toutes ; sinon SER signalé', () => {
    expect(
      depositItemTypeOf('B', [
        { taxGroup: 'B', itemType: 'BIE' },
        { taxGroup: 'C', itemType: 'SER' },
      ]),
    ).toEqual({ itemType: 'BIE', toCheck: false });
    expect(depositItemTypeOf('A', [{ taxGroup: 'B', itemType: 'SER' }])).toEqual({
      itemType: 'SER',
      toCheck: false,
    });
    expect(
      depositItemTypeOf('A', [
        { taxGroup: 'B', itemType: 'SER' },
        { taxGroup: 'C', itemType: 'BIE' },
      ]),
    ).toEqual({ itemType: 'SER', toCheck: true });
    expect(depositItemTypeOf('B', [])).toEqual({ itemType: 'SER', toCheck: true });
  });
});

describe('sameAmount', () => {
  it('compare en centimes, sans calcul', () => {
    expect(sameAmount('100', '100.00')).toBe(true);
    expect(sameAmount('100.5', '100.50')).toBe(true);
    expect(sameAmount('116.00', '100.00')).toBe(false);
    expect(sameAmount(null, '1')).toBeNull();
    expect(sameAmount('abc', '1')).toBeNull();
  });
});
