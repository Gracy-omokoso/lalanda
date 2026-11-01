// Écritures : opérations diverses, séparation des tâches, intangibilité, chaîne,
// lettrage, régénération (ADR-0049, lot K5) — e2e.
//
// Critère 10 : une écriture `posted` ne se modifie ni ne se supprime (409) ; la
// contre-passation est liée ; la chaîne `hash` se vérifie de bout en bout ; numéros sans
// trou par journal et exercice, y compris sous concurrence (validations simultanées).
// Critère 11 : deux détenteurs de `accounting.post` : l'auteur d'une opération diverse ne
// la valide pas (`409 SELF_APPROVAL_FORBIDDEN`), l'autre oui ; un seul détenteur : il
// valide, `soleApprover: true`, audit. Plus : lettrage manuel et délettrage, régénération
// contrôlée d'un mois ouvert (aperçu puis confirmation), droits.

import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  ACCOUNTING_GENESIS_HASH,
  accountingEntryHash,
} from '../accounting/entries/accounting-entry-store.service.js';
import {
  accountingWorld,
  code,
  entriesOf,
  ok,
  prepareOrganization,
  receiptDoc,
  salesInvoiceDoc,
  type AccountingWorld,
} from './accounting-e2e-fixtures.js';
import { e2eSuite } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

type Line = Record<string, string | null | boolean>;

const OD = (lines: Record<string, string>[], extra: Record<string, unknown> = {}) => ({
  journalCode: 'OD',
  date: '2026-10-15',
  reason: 'Régularisation d’essai',
  lines,
  ...extra,
});
const balanced = [
  { accountNumber: '601', debit: '100.00' },
  { accountNumber: '521', credit: '100.00' },
];

e2eSuite('comptabilité — écritures et opérations diverses (ADR-0049, K5)', () => {
  let w: AccountingWorld;

  /** Chaîne intacte : rangs 1…n, `prevHash` = `hash` précédent, empreintes recalculées. */
  const verifyChain = async (org: string): Promise<number> => {
    const docs = await w.db
      .collection('accounting_entries')
      .find({ organizationId: org, seq: { $type: 'number' } })
      .sort({ seq: 1 })
      .toArray();
    let prev = ACCOUNTING_GENESIS_HASH;
    docs.forEach((d, i) => {
      expect(d['seq']).toBe(i + 1);
      expect(d['prevHash']).toBe(prev);
      expect(accountingEntryHash(prev, d as never)).toBe(d['hash']);
      prev = d['hash'] as string;
    });
    const head = await w.db.collection('accounting_journal_heads').findOne({ organizationId: org });
    expect(head).toMatchObject({ seq: docs.length, lastHash: docs.length ? prev : null });
    return docs.length;
  };

  /** Numéros sans trou par journal et exercice. */
  const expectNoGaps = async (org: string): Promise<void> => {
    const docs = await w.db
      .collection('accounting_entries')
      .find({ organizationId: org, number: { $type: 'number' } })
      .toArray();
    const by = new Map<string, number[]>();
    for (const d of docs) {
      const k = `${d['journalCode']}:${d['fiscalYear']}`;
      by.set(k, [...(by.get(k) ?? []), d['number'] as number]);
    }
    for (const [k, nums] of by) {
      expect(
        nums.sort((a, b) => a - b),
        k,
      ).toEqual(nums.map((_, i) => i + 1));
    }
  };

  beforeAll(async () => {
    w = await accountingWorld(
      'ecritures',
      ['finance_director', 'accountant', 'external_accountant', 'admin'],
      ['solo'],
    );
    await prepareOrganization(w, {
      mode: 'active',
      author: 'owner',
      validator: 'finance_director',
    });
    await prepareOrganization(w, { who: 'solo', mode: 'active' });
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await w?.app.close();
  }, E2E_HOOK_TIMEOUT_MS);

  it('saisie : contrôles du journal, du plan, de l’équilibre ; droits', async () => {
    code(
      await w.post(
        'accountant',
        '/accounting/entries',
        OD([
          { accountNumber: '601', debit: '100.00' },
          { accountNumber: '521', credit: '90.00' },
        ]),
      ),
      409,
      'ENTRY_UNBALANCED',
    );
    code(
      await w.post('accountant', '/accounting/entries', OD(balanced, { journalCode: 'VE' })),
      409,
      'JOURNAL_NOT_MANUAL',
    );
    code(
      await w.post(
        'accountant',
        '/accounting/entries',
        OD([
          { accountNumber: '999', debit: '1.00' },
          { accountNumber: '521', credit: '1.00' },
        ]),
      ),
      409,
      'ACCOUNT_NOT_IN_PLAN',
    );
    code(
      await w.post(
        'accountant',
        '/accounting/entries',
        OD([
          { accountNumber: '601', debit: '1.00', credit: '1.00' },
          { accountNumber: '521', credit: '1.00' },
        ]),
      ),
      400,
      'INVALID_REQUEST',
    );
    code(
      await w.post(
        'accountant',
        '/accounting/entries',
        OD([{ accountNumber: '601', debit: 1 } as never, { accountNumber: '521', credit: '1.00' }]),
      ),
      400,
      'INVALID_REQUEST',
    );
    for (const who of ['external_accountant', 'admin']) {
      const res = await w.post(who, '/accounting/entries', OD(balanced));
      expect(res.status, who).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', action: 'accounting.post' });
    }
    ok(await w.get('external_accountant', '/accounting/entries'));
    ok(await w.get('admin', '/accounting/entries'));
  });

  it('critère 11 — séparation des tâches : l’auteur ne valide pas, un autre détenteur oui', async () => {
    const draft = ok(await w.post('accountant', '/accounting/entries', OD(balanced)), 201);
    expect(draft).toMatchObject({
      status: 'draft',
      number: null,
      journalCode: 'OD',
      manual: { authorId: w.userIds['accountant'], validatorId: null },
    });
    code(
      await w.post('accountant', `/accounting/entries/${draft['id']}/validate`, {
        expectedRevision: draft['revision'],
      }),
      409,
      'SELF_APPROVAL_FORBIDDEN',
    );
    expect(
      (
        await w.post('external_accountant', `/accounting/entries/${draft['id']}/validate`, {
          expectedRevision: 1,
        })
      ).status,
    ).toBe(403);
    const posted = ok(
      await w.post('finance_director', `/accounting/entries/${draft['id']}/validate`, {
        expectedRevision: draft['revision'],
      }),
    );
    expect(posted).toMatchObject({
      status: 'posted',
      fiscalYear: 2026,
      number: 1,
      seq: 1,
      manual: {
        authorId: w.userIds['accountant'],
        validatorId: w.userIds['finance_director'],
        soleApprover: false,
      },
    });
    expect(posted['hash']).toMatch(/^[0-9a-f]{64}$/);
    code(
      await w.post('finance_director', `/accounting/entries/${draft['id']}/validate`, {
        expectedRevision: posted['revision'],
      }),
      409,
      'ENTRY_NOT_DRAFT',
    );
    const audit = await w.db.collection('audit_events').findOne({
      organizationId: w.org,
      action: 'accounting.entry_validated',
      targetId: draft['id'],
    });
    expect(audit?.['metadata']).toMatchObject({ soleApprover: false, number: 1 });
  });

  it('critère 11 — approbateur unique : il valide sa propre écriture, marqué', async () => {
    const draft = ok(await w.post('solo', '/accounting/entries', OD(balanced)), 201);
    const posted = ok(
      await w.post('solo', `/accounting/entries/${draft['id']}/validate`, {
        expectedRevision: draft['revision'],
      }),
    );
    expect(posted).toMatchObject({
      status: 'posted',
      number: 1,
      manual: { soleApprover: true, validatorId: w.userIds['solo'] },
    });
    const audit = await w.db
      .collection('audit_events')
      .findOne({ organizationId: w.orgOf['solo'], action: 'accounting.entry_validated' });
    expect(audit?.['metadata']).toMatchObject({ soleApprover: true });
  });

  it('critère 10 — intangibilité : ni modification ni suppression ; contre-passation liée, une seule fois', async () => {
    const draft = ok(
      await w.post('accountant', '/accounting/entries', OD(balanced, { date: '2026-10-16' })),
      201,
    );
    const edited = ok(
      await w.put('accountant', `/accounting/entries/${draft['id']}`, {
        expectedRevision: draft['revision'],
        lines: [
          { accountNumber: '601', debit: '120.00' },
          { accountNumber: '521', credit: '120.00' },
        ],
      }),
    );
    expect(edited['lines'][0]).toMatchObject({ debit: '120.00', credit: null });
    const posted = ok(
      await w.post('finance_director', `/accounting/entries/${draft['id']}/validate`, {
        expectedRevision: edited['revision'],
      }),
    );
    const stored = await w.db
      .collection('accounting_entries')
      .findOne({ _id: new ObjectId(posted['id'] as string) });
    code(
      await w.put('accountant', `/accounting/entries/${posted['id']}`, {
        expectedRevision: posted['revision'],
        reason: 'autre',
      }),
      409,
      'ENTRY_NOT_DRAFT',
    );
    code(await w.del('accountant', `/accounting/entries/${posted['id']}`), 409, 'ENTRY_NOT_DRAFT');
    expect(
      await w.db
        .collection('accounting_entries')
        .findOne({ _id: new ObjectId(posted['id'] as string) }),
    ).toEqual(stored);

    code(
      await w.post('accountant', `/accounting/entries/${posted['id']}/reverse`, {}),
      400,
      'INVALID_REQUEST',
    );
    const rev = ok(
      await w.post('accountant', `/accounting/entries/${posted['id']}/reverse`, {
        reason: 'Erreur de compte',
        date: '2026-10-17',
      }),
      201,
    );
    expect(rev).toMatchObject({
      status: 'posted',
      reversalOf: posted['id'],
      reversalReason: 'MANUAL',
      journalCode: 'OD',
      date: '2026-10-17',
    });
    expect(rev['lines'].map((l: Line) => [l['accountNumber'], l['debit'], l['credit']])).toEqual([
      ['601', null, '120.00'],
      ['521', '120.00', null],
    ]);
    expect(ok(await w.get('owner', `/accounting/entries/${posted['id']}`))['reversedBy']).toBe(
      rev['id'],
    );
    code(
      await w.post('accountant', `/accounting/entries/${posted['id']}/reverse`, {
        reason: 'encore',
      }),
      409,
      'ENTRY_ALREADY_REVERSED',
    );
    code(
      await w.post('accountant', `/accounting/entries/${rev['id']}/reverse`, { reason: 'encore' }),
      409,
      'ENTRY_IS_REVERSAL',
    );

    // Un brouillon, lui, se supprime.
    const scrap = ok(await w.post('accountant', '/accounting/entries', OD(balanced)), 201);
    expect((await w.del('accountant', `/accounting/entries/${scrap['id']}`)).status).toBe(204);
    code(await w.get('owner', `/accounting/entries/${scrap['id']}`), 404, 'ENTRY_NOT_FOUND');
  });

  it('critère 10 — numéros sans trou sous concurrence ; chaîne vérifiée de bout en bout', async () => {
    const drafts = [];
    for (let i = 0; i < 4; i += 1) {
      drafts.push(ok(await w.post('accountant', '/accounting/entries', OD(balanced)), 201));
    }
    const results = await Promise.all(
      drafts.map((d) =>
        w.post('finance_director', `/accounting/entries/${d['id']}/validate`, {
          expectedRevision: d['revision'],
        }),
      ),
    );
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const numbers = results.map((r) => r.body.number as number).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(4);
    await expectNoGaps(w.org);
    await expectNoGaps(w.orgOf['solo']!);
    expect(await verifyChain(w.org)).toBeGreaterThanOrEqual(7);
    await verifyChain(w.orgOf['solo']!);
  });

  it('lettrage manuel sur un compte client, délettrage', async () => {
    const org = w.org;
    const client = { customerId: new ObjectId().toHexString(), customerName: 'Client lettrage' };
    const inv = salesInvoiceDoc(org, {
      ...client,
      issuedAt: '2026-10-05',
      groups: [{ group: 'B', itemType: 'SER', ht: '1000.00', vat: '0.00' }],
    });
    await w.db.collection('sales_invoices').insertOne(inv);
    await w.db.collection('sales_receipts').insertOne(
      receiptDoc(org, {
        receivedOn: '2026-10-06',
        amount: '400.00',
        accountId: null,
        allocations: [
          {
            invoiceId: inv._id.toHexString(),
            invoiceNumber: inv['number'] as string,
            amount: '400.00',
          },
        ],
      }),
    );
    ok(await w.post('owner', '/accounting/sync'));
    const invEntry = (await entriesOf(w.db, org, { 'source.id': inv._id.toHexString() }))[0]!;
    const aux = (invEntry['lines'] as Line[])[0]!['auxiliaryAccountNumber'] as string;
    expect(aux).toMatch(/^411\d{5}$/);
    const recEntry = (await entriesOf(w.db, org, { 'source.kind': 'sales_receipt' }))[0]!;
    expect((recEntry['lines'] as Line[]).every((l) => l['letteringCode'] === null)).toBe(true);

    // Reste dû soldé par une opération diverse sur l'auxiliaire du client.
    const od = ok(
      await w.post(
        'accountant',
        '/accounting/entries',
        OD([
          { accountNumber: '601', debit: '600.00' },
          { accountNumber: '411', auxiliaryAccountNumber: aux, credit: '600.00' },
        ]),
      ),
      201,
    );
    code(
      await w.post(
        'accountant',
        '/accounting/entries',
        OD([
          { accountNumber: '601', debit: '1.00' },
          { accountNumber: '401', auxiliaryAccountNumber: aux, credit: '1.00' },
        ]),
      ),
      409,
      'ACCOUNT_NOT_IN_PLAN',
    );
    const odPosted = ok(
      await w.post('finance_director', `/accounting/entries/${od['id']}/validate`, {
        expectedRevision: od['revision'],
      }),
    );
    const refs = [`${String(invEntry['_id'])}#0`, `${String(recEntry['_id'])}#1`];
    code(
      await w.post('accountant', '/accounting/lettering', { lineRefs: refs }),
      409,
      'LETTERING_NOT_BALANCED',
    );
    code(
      await w.post('accountant', '/accounting/lettering', {
        lineRefs: [...refs, `${odPosted['id']}#0`],
      }),
      409,
      'LETTERING_LINE_WITHOUT_AUXILIARY',
    );
    expect(
      (await w.post('external_accountant', '/accounting/lettering', { lineRefs: refs })).status,
    ).toBe(403);
    const lettered = ok(
      await w.post('accountant', '/accounting/lettering', {
        lineRefs: [...refs, `${odPosted['id']}#1`],
      }),
      201,
    );
    expect(lettered).toMatchObject({
      accountNumber: '411',
      auxiliaryAccountNumber: aux,
      currency: 'CDF',
      bookDifference: '0.00',
      automatic: false,
    });
    const view = ok(await w.get('owner', `/accounting/entries/${String(invEntry['_id'])}`));
    expect(view['lines'][0]['letteringCode']).toBe(lettered['code']);
    code(
      await w.post('accountant', '/accounting/lettering', {
        lineRefs: [...refs, `${odPosted['id']}#1`],
      }),
      409,
      'LETTERING_ALREADY_LETTERED',
    );
    ok(await w.post('accountant', `/accounting/lettering/${lettered['code']}/unletter`));
    expect(
      ok(await w.get('owner', `/accounting/entries/${String(invEntry['_id'])}`))['lines'][0][
        'letteringCode'
      ],
    ).toBeNull();
    code(
      await w.post('accountant', `/accounting/lettering/${lettered['code']}/unletter`),
      409,
      'LETTERING_NOT_ACTIVE',
    );
  });

  it('régénération contrôlée d’un mois ouvert : aperçu, puis contre-passation et génération nouvelle', async () => {
    const org = w.org;
    expect((await w.post('admin', '/accounting/periods/2026/10/regenerate')).status).toBe(403);
    const preview = ok(await w.post('owner', '/accounting/periods/2026/10/regenerate'));
    expect(preview['confirmed']).toBe(false);
    const generated = preview['reversed'] as { sourceKey: string }[];
    expect(generated.length).toBe(2); // facture et encaissement ; jamais une opération diverse
    expect(generated.every((g) => !g.sourceKey.startsWith('manual:'))).toBe(true);
    expect(preview['created']).toHaveLength(2);
    const count = await w.db
      .collection('accounting_entries')
      .countDocuments({ organizationId: org });
    expect(count).toBeGreaterThan(0);

    const done = ok(await w.post('owner', '/accounting/periods/2026/10/regenerate?confirm=true'));
    expect(done).toMatchObject({ confirmed: true, ruleSetVersion: 1 });
    expect(done['created'].map((c: { sourceKey: string }) => c.sourceKey).sort()).toEqual(
      generated.map((g) => g.sourceKey).sort(),
    );
    for (const g of generated) {
      const same = await entriesOf(w.db, org, { sourceKey: g.sourceKey });
      expect(same.map((e) => e['keyed'])).toEqual([false, true]);
      expect(same[0]!['regeneration']).toMatchObject({ role: 'reversed' });
      const reversal = await entriesOf(w.db, org, { reversalOf: String(same[0]!['_id']) });
      expect(reversal[0]).toMatchObject({
        reversalReason: 'REGENERATION',
        regeneration: { role: 'reversal' },
      });
    }
    expect(ok(await w.post('owner', '/accounting/sync'))).toMatchObject({ created: 0, posted: 0 });
    await expectNoGaps(org);
    await verifyChain(org);
    code(await w.post('owner', '/accounting/periods/2026/13/regenerate'), 400, 'INVALID_REQUEST');
  });
});
