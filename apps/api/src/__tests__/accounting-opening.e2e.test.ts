// Reprise de l'existant : à-nouveaux de reprise à la bascule (ADR-0049 § 3.2, lot K7) — e2e.
//
// Critère 13 : une facture datée de la veille de la bascule n'est pas comptabilisée ; la
// proposition de reprise liste ses restes à encaisser ; l'encaissement postérieur se lettre
// avec la ligne d'à-nouveau.
// Plus : la reprise est une PROPOSITION (rien n'est enregistré sans saisie, rien n'est validé
// sans une autre personne autorisée) ; montants des moteurs `treasury`, `receivables`,
// `purchases` ; compte d'attente avec motif ; équilibre en monnaie de tenue et par devise ;
// taux saisi du jour de bascule seulement ; pièces sources et réalisé intacts ; isolation.
//
// Les numéros de compte sont des valeurs de TEST (pack v1 brouillon), pas des règles.

import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  accountingWorld,
  code,
  entriesOf,
  expenseDoc,
  ok,
  prepareOrganization,
  receiptDoc,
  salesInvoiceDoc,
  treasuryAccountDoc,
  type AccountingWorld,
} from './accounting-e2e-fixtures.js';
import { e2eSuite } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

type Line = Record<string, any>;

const SOURCES = [
  'sales_invoices',
  'sales_receipts',
  'supplier_invoices',
  'supplier_payments',
  'treasury_accounts',
  'treasury_expenses',
  'treasury_movements',
  'actual_periods',
];

e2eSuite('comptabilité — reprise de l’existant (ADR-0049, K7)', () => {
  let w: AccountingWorld;
  let bank = '';
  let cashUsd = '';
  let inv1 = '';
  let inv2 = '';
  let testSeries = '';
  let si = '';
  const supplierId = new ObjectId();

  const snapshot = async (org: string): Promise<string> => {
    const out: Record<string, unknown> = {};
    for (const c of SOURCES) {
      out[c] = await w.db.collection(c).find({ organizationId: org }).sort({ _id: 1 }).toArray();
    }
    return JSON.stringify(out);
  };

  const invoice = (org: string, issuedAt: string, ht: string, vat: string, extra = {}) => {
    const doc = salesInvoiceDoc(org, {
      issuedAt,
      groups: [{ group: 'B', itemType: 'SER', ht, vat }],
      ...extra,
    });
    const total = (BigInt(ht.replace('.', '')) + BigInt(vat.replace('.', ''))).toString();
    doc['amountOnCredit'] = `${total.slice(0, -2)}.${total.slice(-2)}`;
    return doc;
  };

  beforeAll(async () => {
    w = await accountingWorld(
      'reprise',
      ['finance_director', 'accountant', 'external_accountant', 'admin'],
      ['solo', 'sim', 'off'],
    );
    await prepareOrganization(w, {
      mode: 'active',
      author: 'owner',
      validator: 'finance_director',
    });
    await prepareOrganization(w, { who: 'solo', mode: 'active' });
    const org = w.org;

    // Trésorerie : banque CDF rattachée au plan, caisse USD non rattachée, compte ouvert après.
    const b = treasuryAccountDoc(org, { name: 'Banque', kind: 'bank', currency: 'CDF' });
    b['openingBalance'] = '300000.00';
    b['openingDate'] = '2026-09-01';
    const c = treasuryAccountDoc(org, { name: 'Caisse dollars', kind: 'cash', currency: 'USD' });
    c['openingBalance'] = '100.00';
    c['openingDate'] = '2026-09-01';
    const later = treasuryAccountDoc(org, {
      name: 'Mobile',
      kind: 'mobile_money',
      currency: 'CDF',
    });
    later['openingBalance'] = '5000.00';
    later['openingDate'] = '2026-10-15';
    await w.db.collection('treasury_accounts').insertMany([b, c, later]);
    bank = b._id.toHexString();
    cashUsd = c._id.toHexString();
    ok(
      await w.put('owner', `/accounting/treasury-links/${bank}`, {
        accountNumber: '521',
        expectedRevision: null,
      }),
    );

    // Ventes : facture partiellement encaissée avant la bascule, facture de la veille,
    // facture de la série d'essai (sans valeur).
    const i1 = invoice(org, '2026-09-20', '100000.00', '16000.00', { number: 'FV-0920' });
    const i2 = invoice(org, '2026-09-30', '50000.00', '8000.00', { number: 'FV-0930' });
    const t = invoice(org, '2026-09-30', '1000.00', '160.00', { series: 'test', number: 'T-1' });
    await w.db.collection('sales_invoices').insertMany([i1, i2, t]);
    inv1 = i1._id.toHexString();
    inv2 = i2._id.toHexString();
    testSeries = t._id.toHexString();
    await w.db.collection('sales_receipts').insertOne(
      receiptDoc(org, {
        receivedOn: '2026-09-25',
        amount: '16000.00',
        accountId: bank,
        allocations: [{ invoiceId: inv1, invoiceNumber: 'FV-0920', amount: '16000.00' }],
      }),
    );
    // Dépense avant la bascule : dans le solde de la banque, jamais comptabilisée.
    await w.db
      .collection('treasury_expenses')
      .insertOne(expenseDoc(org, { spentOn: '2026-09-30', amount: '100000.00', accountId: bank }));

    // Achats : facture fournisseur validée, payée en partie avant la bascule.
    await w.db.collection('suppliers').insertOne({
      _id: supplierId,
      organizationId: org,
      name: 'Fournisseur Essai',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const s = {
      _id: new ObjectId(),
      organizationId: org,
      internalNumber: 'FF-0915',
      supplierId: supplierId.toHexString(),
      kind: 'invoice',
      creditedInvoiceId: null,
      invoiceDate: '2026-09-15',
      currency: 'CDF',
      total: '50000.00',
      deductibleVat: null,
      costAllocations: [{ category: 'achats', workProjectId: null, amount: '50000.00' }],
      status: 'validated',
      validatedAt: new Date(),
      revision: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await w.db.collection('supplier_invoices').insertOne(s);
    si = s._id.toHexString();
    await w.db.collection('supplier_payments').insertOne({
      _id: new ObjectId(),
      organizationId: org,
      number: 'PF-0920',
      status: 'recorded',
      paidOn: '2026-09-20',
      amount: '20000.00',
      currency: 'CDF',
      method: 'bank_transfer',
      accountId: bank,
      supplierId: supplierId.toHexString(),
      allocations: [{ invoiceId: si, amount: '20000.00' }],
      revision: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await w?.app.close();
  }, E2E_HOOK_TIMEOUT_MS);

  it('critère 13 — la facture de la veille n’est pas comptabilisée ; la proposition liste ses restes', async () => {
    ok(await w.post('owner', '/accounting/sync'));
    for (const id of [inv1, inv2, testSeries]) {
      expect(await entriesOf(w.db, w.org, { 'source.id': id }), id).toEqual([]);
    }

    const before = await snapshot(w.org);
    const accountsBefore = await w.db
      .collection('accounting_accounts')
      .countDocuments({ organizationId: w.org });
    const p = ok(await w.get('accountant', '/accounting/opening/proposal'));
    expect(p).toMatchObject({
      proposal: true,
      simulation: false,
      cutoverDate: '2026-10-01',
      asOfStartOf: '2026-10-01',
      bookCurrency: 'CDF',
      journalCode: 'AN',
      counterpartRequired: true,
      awaitingRateCount: 1,
      current: { state: 'none', validated: false },
    });
    expect(p['notProposed']).toEqual([
      'capitaux_propres',
      'immobilisations',
      'emprunts',
      'stocks',
      'dettes_fiscales_et_sociales',
    ]);
    const byRef = new Map((p['lines'] as Line[]).map((l) => [l['ref'], l]));
    expect([...byRef.keys()].sort()).toEqual(
      [
        `treasury:${bank}`,
        `treasury:${cashUsd}`,
        `sales_invoice:${inv1}`,
        `sales_invoice:${inv2}`,
        `supplier_invoice:${si}`,
      ].sort(),
    );
    // Trésorerie : 300 000 + 16 000 (encaissement) − 100 000 (dépense) au début du 1er octobre.
    expect(byRef.get(`treasury:${bank}`)).toMatchObject({
      kind: 'treasury',
      accountNumber: '521',
      side: 'debit',
      amount: '216000.00',
      bookAmount: '216000.00',
      status: 'proposed',
      suspenseReason: null,
      partyName: 'Banque',
    });
    // Caisse non rattachée : compte d'attente, avec son motif ; sans taux, elle attend.
    expect(byRef.get(`treasury:${cashUsd}`)).toMatchObject({
      accountNumber: 'ATTENTE',
      currency: 'USD',
      amount: '100.00',
      bookAmount: null,
      status: 'awaiting_rate',
      suspenseReason: 'NO_TREASURY_ACCOUNT',
    });
    // Restes à encaisser par facture : 116 000 − 16 000 ; la veille de la bascule, entière.
    expect(byRef.get(`sales_invoice:${inv1}`)).toMatchObject({
      kind: 'receivable',
      accountNumber: '411',
      side: 'debit',
      amount: '100000.00',
      documentNumber: 'FV-0920',
    });
    expect(byRef.get(`sales_invoice:${inv1}`)!['auxiliaryAccountNumber']).toMatch(/^411\d{5}$/);
    expect(byRef.get(`sales_invoice:${inv2}`)).toMatchObject({
      kind: 'receivable',
      amount: '58000.00',
      documentNumber: 'FV-0930',
    });
    // Reste à payer : 50 000 − 20 000.
    expect(byRef.get(`supplier_invoice:${si}`)).toMatchObject({
      kind: 'payable',
      accountNumber: '401',
      side: 'credit',
      amount: '30000.00',
      partyName: 'Fournisseur Essai',
    });
    expect(p['currencyTotals']).toEqual([
      { currency: 'CDF', debit: '374000.00', credit: '30000.00' },
      { currency: 'USD', debit: '100.00', credit: '0.00' },
    ]);
    expect(p['bookImbalance']).toBe('344000.00');
    expect(p['laterTreasuryAccounts']).toEqual([
      expect.objectContaining({ name: 'Mobile', openingDate: '2026-10-15' }),
    ]);
    // Une proposition n'enregistre rien : ni écriture, ni compte auxiliaire.
    expect(await entriesOf(w.db, w.org, { journalKind: 'opening' })).toEqual([]);
    expect(
      await w.db.collection('accounting_accounts').countDocuments({ organizationId: w.org }),
    ).toBe(accountsBefore);
    expect(await snapshot(w.org)).toBe(before);
  });

  it('droits : lecture pour l’expert-comptable et l’administrateur, saisie refusée', async () => {
    ok(await w.get('external_accountant', '/accounting/opening/proposal'));
    ok(await w.get('admin', '/accounting/opening'));
    for (const who of ['external_accountant', 'admin']) {
      const res = await w.post(who, '/accounting/opening', { reason: 'Reprise', lines: [] });
      expect(res.status, who).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', action: 'accounting.post' });
    }
  });

  it('saisie : taux du jour de bascule exigé, équilibre par devise, puis brouillon', async () => {
    const before = await snapshot(w.org);
    const usdCounterpart = { accountNumber: 'ATTENTE', currency: 'USD', credit: '100.00' };
    const cdfCounterpart = {
      accountNumber: 'ATTENTE',
      credit: '344000.00',
      label: 'Capitaux propres à classer (dernière balance de l’expert)',
    };
    code(
      await w.post('accountant', '/accounting/opening', {
        reason: 'Reprise au 1er octobre',
        lines: [cdfCounterpart, usdCounterpart],
      }),
      409,
      'OPENING_RATE_MISSING',
    );
    // Un taux d'un autre jour ne sert jamais.
    ok(
      await w.put('accountant', '/accounting/exchange-rates/2026-09-30/USD/CDF', {
        rate: '2700',
        sourceText: 'Taux de la veille (essai)',
        expectedRevision: null,
      }),
      201,
    );
    code(
      await w.post('accountant', '/accounting/opening', {
        reason: 'Reprise',
        lines: [cdfCounterpart, usdCounterpart],
      }),
      409,
      'OPENING_RATE_MISSING',
    );
    ok(
      await w.put('accountant', '/accounting/exchange-rates/2026-10-01/USD/CDF', {
        rate: '2800',
        sourceText: 'Taux du jour de bascule (essai)',
        expectedRevision: null,
      }),
      201,
    );
    // Contrepartie en CDF seulement : déséquilibre en USD.
    const unbalanced = await w.post('accountant', '/accounting/opening', {
      reason: 'Reprise',
      lines: [cdfCounterpart, { accountNumber: 'ATTENTE', credit: '280000.00' }],
    });
    code(unbalanced, 409, 'ENTRY_UNBALANCED');
    expect(unbalanced.body.details.currencyTotals).toEqual([
      { currency: 'CDF', debit: '374000.00', credit: '654000.00' },
      { currency: 'USD', debit: '100.00', credit: '0.00' },
    ]);
    code(
      await w.post('accountant', '/accounting/opening', {
        reason: 'Reprise',
        exclude: ['treasury:inconnu'],
        lines: [cdfCounterpart, usdCounterpart],
      }),
      409,
      'OPENING_UNKNOWN_PROPOSAL_LINE',
    );
    code(
      await w.post('accountant', '/accounting/opening', {
        reason: 'Reprise',
        lines: [{ accountNumber: '999', credit: '344000.00' }, usdCounterpart],
      }),
      409,
      'ACCOUNT_NOT_IN_PLAN',
    );
    expect(await entriesOf(w.db, w.org, { journalKind: 'opening' })).toEqual([]);

    const draft = ok(
      await w.post('accountant', '/accounting/opening', {
        reason: 'Reprise au 1er octobre',
        lines: [cdfCounterpart, usdCounterpart],
      }),
      201,
    );
    expect(draft).toMatchObject({
      state: 'draft',
      validated: false,
      balanced: true,
      differences: { changed: [], missing: [] },
      entry: {
        journalCode: 'AN',
        journalKind: 'opening',
        date: '2026-10-01',
        status: 'draft',
        number: null,
        manual: { authorId: w.userIds['accountant'], validatorId: null },
      },
    });
    const lines = draft['entry']['lines'] as Line[];
    expect(lines).toHaveLength(7);
    const usd = lines.filter((l) => l['currency'] === 'USD');
    expect(usd.map((l) => [l['debit'], l['credit'], l['rate'], l['rateSource']])).toEqual([
      ['280000.00', null, '2800', 'entered'],
      [null, '280000.00', '2800', 'entered'],
    ]);
    const sum = (side: 'debit' | 'credit') =>
      lines.reduce((s, l) => s + BigInt(String(l[side] ?? '0.00').replace('.', '')), 0n);
    expect(sum('debit')).toBe(sum('credit'));
    expect(sum('debit')).toBe(65400000n);
    // Les comptes auxiliaires naissent à la saisie, comme à la synchronisation.
    const receivable = lines.find((l) => l['operationKey'] === 'opening.receivable')!;
    expect(receivable['auxiliaryAccountNumber']).toMatch(/^411\d{5}$/);

    // Une seule reprise à la fois.
    code(
      await w.post('accountant', '/accounting/opening', {
        reason: 'Encore',
        lines: [cdfCounterpart, usdCounterpart],
      }),
      409,
      'OPENING_ALREADY_EXISTS',
    );
    // Les pièces sources et le réalisé n'ont pas bougé.
    expect(await snapshot(w.org)).toBe(before);
  });

  it('validation : séparation des tâches, numéro, chaîne, puis lettrage de l’encaissement postérieur', async () => {
    const status = ok(await w.get('accountant', '/accounting/opening'));
    const id = status['entry']['id'] as string;
    const revision = status['entry']['revision'] as number;
    // Les routes génériques des opérations diverses ne touchent pas la reprise.
    code(
      await w.put('accountant', `/accounting/entries/${id}`, { expectedRevision: revision }),
      409,
      'OPENING_ENTRY_USE_OPENING_ROUTE',
    );
    code(
      await w.post('finance_director', `/accounting/entries/${id}/validate`, {
        expectedRevision: revision,
      }),
      409,
      'OPENING_ENTRY_USE_OPENING_ROUTE',
    );
    code(
      await w.post('accountant', `/accounting/opening/${id}/validate`, {
        expectedRevision: revision,
      }),
      409,
      'SELF_APPROVAL_FORBIDDEN',
    );
    expect(
      (
        await w.post('external_accountant', `/accounting/opening/${id}/validate`, {
          expectedRevision: revision,
        })
      ).status,
    ).toBe(403);
    // Isolation : une autre organisation ne voit pas cette reprise.
    code(
      await w.post('solo', `/accounting/opening/${id}/validate`, { expectedRevision: revision }),
      404,
      'OPENING_NOT_FOUND',
    );

    const before = await snapshot(w.org);
    const posted = ok(
      await w.post('finance_director', `/accounting/opening/${id}/validate`, {
        expectedRevision: revision,
      }),
    );
    expect(posted).toMatchObject({
      state: 'posted',
      validated: true,
      balanced: true,
      entry: {
        status: 'posted',
        journalCode: 'AN',
        fiscalYear: 2026,
        number: 1,
        manual: {
          authorId: w.userIds['accountant'],
          validatorId: w.userIds['finance_director'],
          soleApprover: false,
        },
      },
    });
    expect(posted['entry']['hash']).toMatch(/^[0-9a-f]{64}$/);
    code(
      await w.post('finance_director', `/accounting/opening/${id}/validate`, {
        expectedRevision: posted['entry']['revision'],
      }),
      409,
      'ENTRY_NOT_DRAFT',
    );
    const audit = await w.db
      .collection('audit_events')
      .findOne({ organizationId: w.org, action: 'accounting.opening_validated' });
    expect(audit).toMatchObject({ targetId: id });

    // Encaissement postérieur à la bascule, de la facture de la veille.
    const r = receiptDoc(w.org, {
      receivedOn: '2026-10-10',
      amount: '58000.00',
      accountId: bank,
      allocations: [{ invoiceId: inv2, invoiceNumber: 'FV-0930', amount: '58000.00' }],
    });
    await w.db.collection('sales_receipts').insertOne(r);
    ok(await w.post('owner', '/accounting/sync'));
    const [receiptEntry] = await entriesOf(w.db, w.org, { 'source.id': r._id.toHexString() });
    expect(receiptEntry).toBeDefined();
    const [an] = await entriesOf(w.db, w.org, { _id: new ObjectId(id) });
    const anLine = (an!['lines'] as Line[]).find((l) => l['matchRef'] === `sales_invoice:${inv2}`)!;
    const receiptLine = (receiptEntry!['lines'] as Line[]).find(
      (l) => l['matchRef'] === `sales_invoice:${inv2}`,
    )!;
    expect(anLine['letteringCode']).toMatch(/^L\d{6}$/);
    expect(receiptLine['letteringCode']).toBe(anLine['letteringCode']);
    expect(receiptLine['auxiliaryAccountNumber']).toBe(anLine['auxiliaryAccountNumber']);
    // La facture de la veille n'est toujours pas comptabilisée.
    expect(await entriesOf(w.db, w.org, { 'source.id': inv2 })).toEqual([]);
    // Le réalisé n'a pas bougé (seul l'encaissement de test a été ajouté aux sources).
    const after = JSON.parse(await snapshot(w.org)) as Record<string, unknown[]>;
    const prior = JSON.parse(before) as Record<string, unknown[]>;
    expect(after['actual_periods']).toEqual(prior['actual_periods']);
    expect(after['sales_invoices']).toEqual(prior['sales_invoices']);
    // Une seconde reprise est refusée tant que la première n'est pas contre-passée.
    code(
      await w.post('accountant', '/accounting/opening', { reason: 'Encore', lines: [] }),
      409,
      'OPENING_ALREADY_EXISTS',
    );
  });

  it('approbateur unique ; montant qui ne correspond plus aux pièces : validation refusée', async () => {
    const org = w.orgOf['solo']!;
    const i = invoice(org, '2026-09-28', '10000.00', '0.00', { number: 'FV-SOLO' });
    await w.db.collection('sales_invoices').insertOne(i);
    const body = {
      reason: 'Reprise',
      lines: [{ accountNumber: 'ATTENTE', credit: '10000.00' }],
    };
    const draft = ok(await w.post('solo', '/accounting/opening', body), 201);
    // Un encaissement antérieur à la bascule, saisi après coup, change le reste dû.
    await w.db.collection('sales_receipts').insertOne(
      receiptDoc(org, {
        receivedOn: '2026-09-29',
        amount: '4000.00',
        accountId: null,
        allocations: [
          { invoiceId: i._id.toHexString(), invoiceNumber: 'FV-SOLO', amount: '4000.00' },
        ],
      }),
    );
    const refused = await w.post('solo', `/accounting/opening/${draft['entry']['id']}/validate`, {
      expectedRevision: draft['entry']['revision'],
    });
    code(refused, 409, 'OPENING_PROPOSAL_CHANGED');
    expect(refused.body.details.changed).toEqual([`sales_invoice:${i._id.toHexString()}`]);
    const st = ok(await w.get('solo', '/accounting/opening'));
    expect(st['differences']['changed']).toEqual([`sales_invoice:${i._id.toHexString()}`]);

    // Le brouillon se supprime ; la reprise se saisit à nouveau, au montant du moteur.
    ok(await w.del('solo', `/accounting/entries/${draft['entry']['id']}`), 204);
    const again = ok(
      await w.post('solo', '/accounting/opening', {
        reason: 'Reprise',
        lines: [{ accountNumber: 'ATTENTE', credit: '6000.00' }],
      }),
      201,
    );
    expect(again['entry']['sourceKey']).toBe('opening:2026-10-01:1');
    const posted = ok(
      await w.post('solo', `/accounting/opening/${again['entry']['id']}/validate`, {
        expectedRevision: again['entry']['revision'],
      }),
    );
    expect(posted).toMatchObject({
      state: 'posted',
      entry: { number: 1, manual: { soleApprover: true } },
    });
  });

  it('simulation : proposée, jamais enregistrée ; éteinte : rien n’est lu', async () => {
    await prepareOrganization(w, { who: 'sim', mode: 'simulation' });
    const org = w.orgOf['sim']!;
    await w.db
      .collection('sales_invoices')
      .insertOne(invoice(org, '2026-09-10', '2000.00', '320.00', { number: 'FV-SIM' }));
    const p = ok(await w.get('sim', '/accounting/opening/proposal'));
    expect(p).toMatchObject({ simulation: true, mode: 'simulation' });
    expect(p['lines']).toHaveLength(1);
    code(
      await w.post('sim', '/accounting/opening', {
        reason: 'Reprise',
        lines: [{ accountNumber: 'ATTENTE', credit: '2320.00' }],
      }),
      409,
      'ACCOUNTING_NOT_ACTIVE',
    );
    expect(await entriesOf(w.db, org)).toEqual([]);
    expect(
      await w.db.collection('accounting_accounts').countDocuments({ organizationId: org }),
    ).toBe(0);

    code(await w.get('off', '/accounting/opening/proposal'), 409, 'ACCOUNTING_OFF');
    expect(ok(await w.get('off', '/accounting/opening'))).toMatchObject({ state: 'none' });
  });
});
