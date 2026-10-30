// Paiements fournisseurs et trésorerie contre la vraie application (ADR-0044 § 2.6,
// § 3.6, § 6.2, § 6.3, O3 ; critères 10, 11, 12, 17). ADR-0044 — P5.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleurs → MongoDB (transactions). Couvre : paiement partiel puis total,
// ventilation au prorata des imputations de coût (dépenses créées, `origin`, solde du
// compte, TVA déclarée répartie), verrou de la trésorerie, annulation, paiement de
// plusieurs factures, refus (brouillon, litige, autre fournisseur, dépassement),
// rattachement d'une dépense existante gardée ou remplacée sans double comptage,
// doublon probable, échéancier, prévision (échéances, litige, commandes non
// facturées), droits (dont la paire approuver / payer par ajout), isolation.

import 'reflect-metadata';

import { ObjectId } from 'mongodb';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { useP4Fixture } from './purchases-p4-e2e-fixtures.js';

vi.setConfig({ testTimeout: 120_000 });

const kinshasaToday = (): string => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Allocation = { category: string; workProjectId?: string | null; amount: string };

e2eSuite('Paiements fournisseurs et trésorerie (ADR-0044 P5)', () => {
  const f = useP4Fixture('achpay');
  const today = kinshasaToday();
  let supplierId = '';
  let otherSupplierId = '';
  let projectId = '';
  let bankId = '';
  let ref = 0;

  /** Facture saisie et validée par l'Administrateur ; rend sa fiche. */
  async function validatedInvoice(opts: {
    total: string;
    allocations?: Allocation[];
    supplier?: string;
    who?: 'admin' | 'ownerB';
    dueDate?: string;
    invoiceDate?: string;
    taxes?: { label: string; amount: string }[];
    subtotal?: string;
    deductibleVat?: string | null;
    currency?: 'USD' | 'CDF';
  }): Promise<Record<string, any>> {
    const who = opts.who ?? 'admin';
    const draft = f.ok(
      await f.post(who, '/purchases/invoices', {
        supplierId: opts.supplier ?? supplierId,
        supplierReference: `FP-${++ref}`,
        invoiceDate: opts.invoiceDate ?? addDays(today, -5),
        ...(opts.dueDate ? { dueDate: opts.dueDate } : {}),
        currency: opts.currency ?? 'USD',
        subtotal: opts.subtotal ?? opts.total,
        taxes: opts.taxes ?? [],
        total: opts.total,
        ...(opts.deductibleVat !== undefined ? { deductibleVat: opts.deductibleVat } : {}),
        costAllocations: opts.allocations ?? [{ category: 'achats', amount: opts.total }],
      }),
      201,
    );
    return f.ok(
      await f.post(who, `/purchases/invoices/${draft['id']}/validate`, { expectedRevision: 1 }),
    );
  }

  /** Cookies d'un compte, lus sur une requête de la fixture (méthodes absentes de la fixture). */
  const cookiesOf = async (who: Parameters<typeof f.get>[0]): Promise<string[]> => {
    const res = await f.get(who, '/me/permissions');
    const raw = (res as unknown as { req: { getHeader: (h: string) => unknown } }).req.getHeader(
      'cookie',
    );
    return (Array.isArray(raw) ? raw : String(raw).split(/;\s*/)).map(String);
  };
  const invoice = async (id: string) => f.ok(await f.get('viewer', `/purchases/invoices/${id}`));
  const balance = async (accountId: string, who: 'owner' | 'ownerB' = 'owner') =>
    f.ok(await f.get(who, `/treasury/accounts/${accountId}`))['balance'] as string;
  const expense = async (id: string) => f.ok(await f.get('owner', `/treasury/expenses/${id}`));
  const monthTotal = async (): Promise<string> => {
    const body = f.ok(
      await f.get('owner', `/treasury/expenses/summary?from=${addDays(today, -40)}&to=${today}`),
    );
    return (body['totalsByCurrency']?.['USD'] as string | undefined) ?? '0.00';
  };
  const pay = (who: Parameters<typeof f.post>[0], body: Record<string, unknown>) =>
    f.post(who, '/purchases/payments', {
      supplierId,
      paidOn: today,
      method: 'bank_transfer',
      accountId: bankId,
      ...body,
    });

  it('prépare fournisseurs, projet RUN et compte bancaire USD', async () => {
    supplierId = await f.supplier('owner', 'Socimex', {
      defaultCurrency: 'USD',
      defaultCategory: 'achats',
    });
    otherSupplierId = await f.supplier('owner', 'Batiplus', { defaultCategory: 'achats' });
    const project = f.ok(
      await f.post('owner', '/work/projects', { name: 'Chantier P', kind: 'internal' }),
      201,
    );
    projectId = project['id'] as string;
    const bank = f.ok(
      await f.post('owner', '/treasury/accounts', {
        name: 'Banque USD',
        kind: 'bank',
        currency: 'USD',
        openingBalance: '10000.00',
        openingDate: '2026-01-01',
      }),
      201,
    );
    bankId = bank['id'] as string;
  });

  describe('paiement, ventilation et dépenses possédées (critère 10)', () => {
    let invoiceId = '';
    let firstPayment: Record<string, any> = {};

    it('paiement partiel : deux dépenses au prorata, origin posé, solde et reste à payer', async () => {
      const inv = await validatedInvoice({
        total: '1000.00',
        subtotal: '862.07',
        taxes: [{ label: 'TVA 16 %', amount: '137.93' }],
        deductibleVat: '137.93',
        allocations: [
          { category: 'achats', workProjectId: projectId, amount: '600.00' },
          { category: 'services_exterieurs', workProjectId: null, amount: '400.00' },
        ],
      });
      invoiceId = inv['id'];
      const before = await balance(bankId);
      expect(before).toBe('10000.00');

      firstPayment = f.ok(
        await pay('accountant', {
          amount: '500.00',
          reference: 'VIR-001',
          allocations: [{ invoiceId, amount: '500.00' }],
        }),
        201,
      );
      expect(firstPayment).toMatchObject({
        number: expect.stringMatching(/^PF\d{4}-\d{6}$/),
        supplierId,
        currency: 'USD',
        amount: '500.00',
        origin: 'recorded',
        status: 'recorded',
        accountId: bankId,
        linkedExpense: null,
        allocations: [{ invoiceId, amount: '500.00', internalNumber: inv['internalNumber'] }],
      });
      const parts = firstPayment['expenses'] as Record<string, any>[];
      expect(parts.map((p) => [p.amount, p.category, p.workProjectId, p.allocationIndex])).toEqual([
        ['300.00', 'achats', projectId, 0],
        ['200.00', 'services_exterieurs', null, 1],
      ]);
      const e0 = await expense(parts[0].id);
      expect(e0).toMatchObject({
        spentOn: today,
        amount: '300.00',
        currency: 'USD',
        supplierId,
        accountId: bankId,
        reference: 'VIR-001',
        label: `Paiement ${inv['internalNumber']} — ${inv['supplierReference']}`,
        origin: {
          kind: 'supplier_payment',
          paymentId: firstPayment['id'],
          paymentNumber: firstPayment['number'],
          invoiceId,
          allocationIndex: 0,
        },
      });
      // TVA DÉCLARÉE répartie (jamais calculée) : la moitié payée, au prorata 60/40.
      const e1 = await expense(parts[1].id);
      const vat = [e0['deductibleVat'], e1['deductibleVat']].map((v: string) =>
        Math.round(Number(v) * 100),
      );
      expect(vat[0]! + vat[1]!).toBe(6897);

      expect(await balance(bankId)).toBe('9500.00');
      expect((await invoice(invoiceId))['settlement']).toMatchObject({
        status: 'partially_paid',
        paid: '500.00',
        remaining: '500.00',
      });

      const audit = await f
        .db()
        .collection('audit_events')
        .findOne({ action: 'supplier_payment.recorded', targetId: firstPayment['id'] });
      expect(audit?.['metadata']).toMatchObject({ amount: '500.00', currency: 'USD' });
    });

    it('la trésorerie ne modifie, n’annule ni ne joint de pièce à une dépense possédée', async () => {
      const id = (firstPayment['expenses'] as { id: string }[])[0]!.id;
      const e = await expense(id);
      f.code(
        await f.put('owner', `/treasury/expenses/${id}`, {
          expectedRevision: e['revision'],
          expense: {
            spentOn: today,
            amount: '1.00',
            currency: 'USD',
            category: 'achats',
            label: 'Tentative',
          },
        }),
        409,
        'EXPENSE_OWNED_BY_PURCHASES',
      );
      f.code(
        await f.post('owner', `/treasury/expenses/${id}/cancel`, { reason: 'Tentative' }),
        409,
        'EXPENSE_OWNED_BY_PURCHASES',
      );
      f.code(
        await request(f.app().getHttpServer())
          .delete(`/treasury/expenses/${id}/attachment`)
          .set('Cookie', await cookiesOf('owner')),
        409,
        'EXPENSE_OWNED_BY_PURCHASES',
      );
      expect((await expense(id))['amount']).toBe('300.00');
    });

    it('refus : dépassement du reste (409), somme incohérente (400), compte d’une autre devise', async () => {
      f.code(
        await pay('accountant', {
          amount: '600.00',
          allocations: [{ invoiceId, amount: '600.00' }],
        }),
        409,
        'SUPPLIER_PAYMENT_EXCEEDS_REMAINING',
      );
      f.code(
        await pay('accountant', {
          amount: '400.00',
          allocations: [{ invoiceId, amount: '300.00' }],
        }),
        400,
        'SUPPLIER_PAYMENT_ALLOCATION_MISMATCH',
      );
      const cdf = f.ok(
        await f.post('owner', '/treasury/accounts', {
          name: 'Caisse CDF',
          kind: 'cash',
          currency: 'CDF',
          openingBalance: '0.00',
          openingDate: '2026-01-01',
        }),
        201,
      );
      const res = await pay('accountant', {
        amount: '10.00',
        accountId: cdf['id'],
        allocations: [{ invoiceId, amount: '10.00' }],
      });
      expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      // Rien n'a été écrit : transaction annulée.
      expect((await invoice(invoiceId))['settlement']['remaining']).toBe('500.00');
    });

    it('paiement total : facture soldée, absente de l’échéancier ; annulation : dépenses annulées', async () => {
      const second = f.ok(
        await pay('owner', {
          amount: '500.00',
          allocations: [{ invoiceId, amount: '500.00' }],
        }),
        201,
      );
      expect((await invoice(invoiceId))['settlement']).toMatchObject({
        status: 'paid',
        remaining: '0.00',
      });
      expect(await balance(bankId)).toBe('9000.00');
      const payables = f.ok(await f.get('viewer', '/purchases/payables'));
      expect((payables['invoices'] as { id: string }[]).map((i) => i.id)).not.toContain(invoiceId);

      const cancelled = f.ok(
        await f.post('accountant', `/purchases/payments/${second['id']}/cancel`, {
          reason: 'Virement rejeté',
          expectedRevision: 1,
        }),
      );
      expect(cancelled['status']).toBe('cancelled');
      expect((cancelled['expenses'] as { status: string }[]).map((e) => e.status)).toEqual([
        'cancelled',
        'cancelled',
      ]);
      expect(await balance(bankId)).toBe('9500.00');
      expect((await invoice(invoiceId))['settlement']['remaining']).toBe('500.00');
      f.code(
        await f.post('accountant', `/purchases/payments/${second['id']}/cancel`, {
          reason: 'Encore',
          expectedRevision: 2,
        }),
        409,
        'SUPPLIER_PAYMENT_CANCELLED',
      );
      // Une dépense annulée par le paiement reste possédée : la trésorerie ne la touche pas.
      const id = (cancelled['expenses'] as { id: string }[])[0]!.id;
      f.code(
        await f.post('owner', `/treasury/expenses/${id}/cancel`, { reason: 'x' }),
        409,
        'EXPENSE_OWNED_BY_PURCHASES',
      );
      const audit = await f
        .db()
        .collection('audit_events')
        .findOne({ action: 'supplier_payment.cancelled', targetId: second['id'] });
      expect(audit?.['metadata']).toMatchObject({ reason: 'Virement rejeté' });
    });

    it('liste et fiche des paiements (lecture : achats + trésorerie)', async () => {
      const list = f.ok(await f.get('viewer', `/purchases/payments?invoiceId=${invoiceId}`));
      expect((list['items'] as { id: string }[]).map((p) => p.id)).toContain(firstPayment['id']);
      const one = f.ok(await f.get('viewer', `/purchases/payments/${firstPayment['id']}`));
      expect(one['expenseIds']).toHaveLength(2);
    });
  });

  describe('plusieurs factures dans un paiement, et refus', () => {
    it('ventilation sur deux factures : une dépense par imputation, toutes deux soldées', async () => {
      const a = await validatedInvoice({ total: '100.00' });
      const b = await validatedInvoice({
        total: '50.00',
        allocations: [{ category: 'transport', amount: '50.00' }],
      });
      const p = f.ok(
        await pay('finance_director', {
          amount: '150.00',
          allocations: [
            { invoiceId: a['id'], amount: '100.00' },
            { invoiceId: b['id'], amount: '50.00' },
          ],
        }),
        201,
      );
      expect(
        (p['expenses'] as Record<string, any>[]).map((e) => [e.invoiceId, e.amount, e.category]),
      ).toEqual([
        [a['id'], '100.00', 'achats'],
        [b['id'], '50.00', 'transport'],
      ]);
      expect((await invoice(a['id']))['settlement']['status']).toBe('paid');
      expect((await invoice(b['id']))['settlement']['status']).toBe('paid');
    });

    it('brouillon, litige, autre fournisseur, facture en double : refusés', async () => {
      const draft = f.ok(
        await f.post('admin', '/purchases/invoices', {
          supplierId,
          supplierReference: `FP-${++ref}`,
          invoiceDate: today,
          currency: 'USD',
          subtotal: '10.00',
          total: '10.00',
        }),
        201,
      );
      f.code(
        await pay('owner', {
          amount: '10.00',
          allocations: [{ invoiceId: draft['id'], amount: '10.00' }],
        }),
        409,
        'SUPPLIER_INVOICE_NOT_PAYABLE',
      );
      const disputed = await validatedInvoice({ total: '20.00' });
      f.ok(
        await f.post('admin', `/purchases/invoices/${disputed['id']}/dispute`, {
          reason: 'Quantités fausses',
          expectedRevision: disputed['revision'],
        }),
      );
      f.code(
        await pay('owner', {
          amount: '20.00',
          allocations: [{ invoiceId: disputed['id'], amount: '20.00' }],
        }),
        409,
        'SUPPLIER_INVOICE_DISPUTED',
      );
      const other = await validatedInvoice({ total: '30.00', supplier: otherSupplierId });
      f.code(
        await pay('owner', {
          amount: '30.00',
          allocations: [{ invoiceId: other['id'], amount: '30.00' }],
        }),
        409,
        'SUPPLIER_PAYMENT_SUPPLIER_MISMATCH',
      );
      const res = await pay('owner', {
        amount: '20.00',
        allocations: [
          { invoiceId: other['id'], amount: '10.00' },
          { invoiceId: other['id'], amount: '10.00' },
        ],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('rattacher une dépense existante, sans double comptage (critère 11)', () => {
    it('une imputation : la dépense est GARDÉE, aucune dépense nouvelle, total inchangé', async () => {
      const inv = await validatedInvoice({ total: '200.00' });
      const direct = f.ok(
        await f.post('owner', '/treasury/expenses', {
          spentOn: today,
          amount: '200.00',
          currency: 'USD',
          category: 'achats',
          label: 'Fournitures Socimex',
          supplierName: 'Socimex',
          accountId: bankId,
        }),
        201,
      );
      const totalBefore = await monthTotal();
      const balanceBefore = await balance(bankId);
      const countBefore = await f
        .db()
        .collection('treasury_expenses')
        .countDocuments({ organizationId: f.orgId() });

      const p = f.ok(
        await f.post('owner', '/purchases/payments/from-expense', {
          expenseId: direct['id'],
          expectedRevision: direct['revision'],
          allocations: [{ invoiceId: inv['id'], amount: '200.00' }],
        }),
        201,
      );
      expect(p).toMatchObject({
        origin: 'linked_expense',
        amount: '200.00',
        paidOn: today,
        accountId: bankId,
        expenseIds: [direct['id']],
        linkedExpense: { id: direct['id'], mode: 'kept' },
      });
      const linked = await expense(direct['id']);
      expect(linked).toMatchObject({
        status: 'recorded',
        supplierId,
        origin: { paymentId: p['id'], invoiceId: inv['id'], allocationIndex: 0 },
      });
      expect(
        await f.db().collection('treasury_expenses').countDocuments({ organizationId: f.orgId() }),
      ).toBe(countBefore);
      expect(await monthTotal()).toBe(totalBefore);
      expect(await balance(bankId)).toBe(balanceBefore);
      expect((await invoice(inv['id']))['settlement']['status']).toBe('paid');
      // Prévision : la facture payée n'y sort plus.
      const forecast = f.ok(await f.get('owner', '/treasury/forecast?currency=USD'));
      for (const s of forecast['scenarios'] as { flows: { label: string }[] }[]) {
        expect(s.flows.some((x) => x.label.includes(inv['internalNumber']))).toBe(false);
      }
      // Rattachée deux fois : refusé.
      f.code(
        await f.post('owner', '/purchases/payments/from-expense', {
          expenseId: direct['id'],
          expectedRevision: linked['revision'],
          allocations: [{ invoiceId: inv['id'], amount: '200.00' }],
        }),
        409,
        'EXPENSE_OWNED_BY_PURCHASES',
      );
      // Annulé : la dépense redevient directe, toujours enregistrée.
      f.ok(
        await f.post('owner', `/purchases/payments/${p['id']}/cancel`, {
          reason: 'Erreur de rattachement',
          expectedRevision: 1,
        }),
      );
      const back = await expense(direct['id']);
      expect(back).toMatchObject({ status: 'recorded', origin: null });
      expect(await monthTotal()).toBe(totalBefore);
      expect((await invoice(inv['id']))['settlement']['remaining']).toBe('200.00');
    });

    it('plusieurs imputations : la dépense est REMPLACÉE par les parts, total inchangé', async () => {
      const inv = await validatedInvoice({
        total: '100.00',
        allocations: [
          { category: 'achats', workProjectId: projectId, amount: '70.00' },
          { category: 'transport', amount: '30.00' },
        ],
      });
      const direct = f.ok(
        await f.post('owner', '/treasury/expenses', {
          spentOn: addDays(today, -1),
          amount: '100.00',
          currency: 'USD',
          category: 'charges_diverses',
          label: 'Socimex divers',
          supplierId,
          accountId: bankId,
        }),
        201,
      );
      const totalBefore = await monthTotal();
      const p = f.ok(
        await f.post('owner', '/purchases/payments/from-expense', {
          expenseId: direct['id'],
          expectedRevision: direct['revision'],
          method: 'cash',
          allocations: [{ invoiceId: inv['id'], amount: '100.00' }],
        }),
        201,
      );
      expect(p['linkedExpense']).toEqual({ id: direct['id'], mode: 'replaced' });
      expect(p['method']).toBe('cash');
      expect(
        (p['expenses'] as Record<string, any>[]).map((e) => [e.amount, e.category, e.status]),
      ).toEqual([
        ['70.00', 'achats', 'recorded'],
        ['30.00', 'transport', 'recorded'],
      ]);
      const original = await expense(direct['id']);
      expect(original['status']).toBe('cancelled');
      expect(original['cancelReason']).toBe(`Rattachée au paiement ${p['number']}`);
      expect(await monthTotal()).toBe(totalBefore);

      f.ok(
        await f.post('owner', `/purchases/payments/${p['id']}/cancel`, {
          reason: 'Annulation',
          expectedRevision: 1,
        }),
      );
      expect((await expense(direct['id']))['status']).toBe('recorded');
      expect(await monthTotal()).toBe(totalBefore);
    });

    it('autre fournisseur, autre devise, révision périmée : refusés', async () => {
      const inv = await validatedInvoice({ total: '40.00' });
      const foreign = f.ok(
        await f.post('owner', '/treasury/expenses', {
          spentOn: today,
          amount: '40.00',
          currency: 'USD',
          category: 'achats',
          label: 'Autre',
          supplierId: otherSupplierId,
        }),
        201,
      );
      f.code(
        await f.post('owner', '/purchases/payments/from-expense', {
          expenseId: foreign['id'],
          expectedRevision: foreign['revision'],
          allocations: [{ invoiceId: inv['id'], amount: '40.00' }],
        }),
        409,
        'EXPENSE_SUPPLIER_MISMATCH',
      );
      const cdf = f.ok(
        await f.post('owner', '/treasury/expenses', {
          spentOn: today,
          amount: '40.00',
          currency: 'CDF',
          category: 'achats',
          label: 'Francs',
        }),
        201,
      );
      f.code(
        await f.post('owner', '/purchases/payments/from-expense', {
          expenseId: cdf['id'],
          expectedRevision: cdf['revision'],
          allocations: [{ invoiceId: inv['id'], amount: '40.00' }],
        }),
        409,
        'SUPPLIER_PAYMENT_CURRENCY_MISMATCH',
      );
      f.code(
        await f.post('owner', '/purchases/payments/from-expense', {
          expenseId: cdf['id'],
          expectedRevision: cdf['revision'] + 3,
          allocations: [{ invoiceId: inv['id'], amount: '40.00' }],
        }),
        409,
        'STALE_REVISION',
      );
    });
  });

  describe('doublons probables (O3 c)', () => {
    it('paiement saisi et dépense directe du même montant à deux jours : signalés, rien d’annulé', async () => {
      const inv = await validatedInvoice({ total: '80.00' });
      const p = f.ok(
        await pay('owner', {
          amount: '80.00',
          allocations: [{ invoiceId: inv['id'], amount: '80.00' }],
        }),
        201,
      );
      const direct = f.ok(
        await f.post('owner', '/treasury/expenses', {
          spentOn: addDays(today, -2),
          amount: '80.00',
          currency: 'USD',
          category: 'achats',
          label: 'Saisie en double ?',
          supplierId,
        }),
        201,
      );
      const dup = f.ok(await f.get('viewer', `/purchases/duplicates?supplierId=${supplierId}`));
      expect(dup['windowDays']).toBe(3);
      expect(dup['duplicates']).toContainEqual(
        expect.objectContaining({
          code: 'POSSIBLE_DUPLICATE_EXPENSE',
          paymentId: p['id'],
          paymentNumber: p['number'],
          expenseId: direct['id'],
          amount: '80.00',
          daysApart: 2,
        }),
      );
      const payables = f.ok(await f.get('owner', '/purchases/payables'));
      expect(payables['duplicates']['status']).toBe('known');
      expect(payables['duplicates']['count']).toBeGreaterThanOrEqual(1);
      expect((await expense(direct['id']))['status']).toBe('recorded');
    });
  });

  describe('échéancier et prévision de trésorerie (critère 12)', () => {
    let late: Record<string, any> = {};
    let soon: Record<string, any> = {};
    let disputed: Record<string, any> = {};

    it('échéancier : en retard, à venir, litige à part, par devise', async () => {
      late = await validatedInvoice({ total: '300.00', dueDate: addDays(today, -1) });
      soon = await validatedInvoice({ total: '200.00', dueDate: addDays(today, 10) });
      disputed = await validatedInvoice({ total: '70.00', dueDate: addDays(today, 3) });
      f.ok(
        await f.post('admin', `/purchases/invoices/${disputed['id']}/dispute`, {
          reason: 'Contesté',
          expectedRevision: disputed['revision'],
        }),
      );
      const view = f.ok(await f.get('viewer', `/purchases/payables?supplierId=${supplierId}`));
      expect(view['asOf']).toBe(today);
      const items = view['invoices'] as Record<string, any>[];
      expect(items.find((i) => i.id === late['id'])).toMatchObject({
        remaining: '300.00',
        overdue: true,
        disputed: false,
      });
      expect(items.find((i) => i.id === disputed['id'])).toMatchObject({ disputed: true });
      const usd = (view['schedule'] as Record<string, any>[]).find((c) => c.currency === 'USD')!;
      expect(Number(usd['overdue']['amount'])).toBeGreaterThanOrEqual(300);
      expect(Number(usd['disputed']['amount'])).toBeGreaterThanOrEqual(70);
      expect((view['aging'] as { currency: string }[]).map((a) => a.currency)).toEqual(['USD']);
      f.code(await f.get('viewer', '/purchases/payables?asOf=2026-02-30'), 400, 'INVALID_REQUEST');
    });

    it('prévision : −300 à J+1, −200 à J+10 dans les trois scénarios ; litige exclu et constaté', async () => {
      await f.seedOrder({
        supplierId,
        lines: [{ id: 'a', quantity: '2', unitPrice: '25.00' }],
      });
      const res = f.ok(await f.get('viewer', '/treasury/forecast?currency=USD'));
      expect(res['version']).toBe('1.1.0');
      for (const s of res['scenarios'] as {
        flows: { date: string; source: string; amount: string; label: string }[];
      }[]) {
        const mine = (n: string) => s.flows.filter((x) => x.label.includes(n));
        expect(mine(late['internalNumber'])).toEqual([
          expect.objectContaining({
            date: addDays(today, 1),
            source: 'payable',
            amount: '300.00',
          }),
        ]);
        expect(mine(soon['internalNumber'])).toEqual([
          expect.objectContaining({
            date: addDays(today, 10),
            source: 'payable',
            amount: '200.00',
          }),
        ]);
        expect(mine(disputed['internalNumber'])).toEqual([]);
      }
      const codes = (res['uncertainty']['findings'] as { code: string }[]).map((x) => x.code);
      expect(codes).toContain('PAYABLES_DISPUTED');
      expect(codes).toContain('ORDERS_NOT_INVOICED');
      expect(codes).not.toContain('PAYABLES_NOT_INTEGRATED');
      // Aucune somme CDF + USD : la prévision CDF ne voit aucune facture USD.
      const cdf = f.ok(await f.get('viewer', '/treasury/forecast?currency=CDF'));
      for (const s of cdf['scenarios'] as { flows: { source: string }[] }[]) {
        expect(s.flows.filter((x) => x.source === 'payable')).toEqual([]);
      }
    });

    it('payée, la facture sort de la prévision ; sa dépense entre dans le solde, une seule fois', async () => {
      const before = await balance(bankId);
      f.ok(
        await pay('accountant', {
          amount: '300.00',
          allocations: [{ invoiceId: late['id'], amount: '300.00' }],
        }),
        201,
      );
      expect(Number(await balance(bankId))).toBe(Number(before) - 300);
      const res = f.ok(await f.get('viewer', '/treasury/forecast?currency=USD'));
      for (const s of res['scenarios'] as { flows: { label: string }[] }[]) {
        expect(s.flows.some((x) => x.label.includes(late['internalNumber']))).toBe(false);
      }
      expect(res['openingBalance']).toBe(await balance(bankId));
    });
  });

  describe('droits et séparation des tâches', () => {
    it('Analyste, Administrateur, Lecteur : pas de paiement ; Commercial : rien', async () => {
      const inv = await validatedInvoice({ total: '5.00' });
      const body = { amount: '5.00', allocations: [{ invoiceId: inv['id'], amount: '5.00' }] };
      for (const who of ['analyst', 'admin', 'viewer'] as const) {
        expect((await pay(who, body)).status, who).toBe(403);
        expect(
          (
            await f.post(who, '/purchases/payments/from-expense', {
              expenseId: new ObjectId().toHexString(),
              expectedRevision: 1,
              allocations: body.allocations,
            })
          ).status,
          who,
        ).toBe(403);
      }
      expect((await f.get('sales_rep', '/purchases/payments')).status).toBe(403);
      expect((await f.get('sales_rep', '/purchases/payables')).status).toBe(403);
      expect((await f.get('sales_rep', '/purchases/duplicates')).status).toBe(403);
      // Le Comptable paie mais n'approuve pas.
      expect(
        (
          await f.post(
            'accountant',
            `/purchases/invoices/${new ObjectId().toHexString()}/force-validate`,
            {
              reason: 'x',
              expectedRevision: 1,
            },
          )
        ).status,
      ).toBe(403);
    });

    it('un approbateur ne devient pas payeur par ajout de droit (paire G4), ni l’inverse', async () => {
      const previous = process.env['MEMBER_PERMISSIONS_ENABLED'];
      process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
      try {
        const patch = async (who: 'viewer' | 'accountant', grants: string[]) => {
          const members = f.ok(await f.get('owner', `/organizations/${f.orgId()}/members`));
          const expectedRevision = (
            members['members'] as { userId: string; permissionsRevision: number }[]
          ).find((m) => m.userId === f.userId(who))!.permissionsRevision;
          return request(f.app().getHttpServer())
            .patch(`/organizations/${f.orgId()}/members/${f.userId(who)}/permissions`)
            .set('Cookie', await cookiesOf('owner'))
            .send({ grants, revokes: [], expectedRevision });
        };
        // Le Comptable paie : il ne reçoit pas l'autorité de dépense.
        const accountant = await patch('accountant', ['purchase.approve']);
        expect(accountant.status, JSON.stringify(accountant.body)).toBe(409);
        expect(accountant.body).toMatchObject({
          code: 'SOD_CONFLICT',
          pair: ['purchase.approve', 'payables.pay'],
        });
        // Un Lecteur ne cumule pas les deux par ajout.
        const viewer = await patch('viewer', ['purchase.approve', 'payables.pay']);
        expect(viewer.status, JSON.stringify(viewer.body)).toBe(409);
        expect(viewer.body.code).toBe('SOD_CONFLICT');
        // Rien n'a changé : le Lecteur ne paie toujours pas.
        const inv = await validatedInvoice({ total: '6.00' });
        expect(
          (
            await pay('viewer', {
              amount: '6.00',
              allocations: [{ invoiceId: inv['id'], amount: '6.00' }],
            })
          ).status,
        ).toBe(403);
      } finally {
        if (previous === undefined) delete process.env['MEMBER_PERMISSIONS_ENABLED'];
        else process.env['MEMBER_PERMISSIONS_ENABLED'] = previous;
      }
    });
  });

  describe('isolation entre organisations (critère 17)', () => {
    it('fournisseur, facture, paiement, dépense et compte d’une autre organisation : 404', async () => {
      const inv = await validatedInvoice({ total: '9.00' });
      const p = f.ok(
        await pay('owner', {
          amount: '9.00',
          allocations: [{ invoiceId: inv['id'], amount: '9.00' }],
        }),
        201,
      );
      const supplierB = await f.supplier('ownerB', 'Fournisseur B', { defaultCategory: 'achats' });
      const invB = await validatedInvoice({ total: '12.00', supplier: supplierB, who: 'ownerB' });

      f.code(
        await f.post('ownerB', '/purchases/payments', {
          supplierId,
          paidOn: today,
          method: 'cash',
          amount: '9.00',
          allocations: [{ invoiceId: inv['id'], amount: '9.00' }],
        }),
        404,
        'SUPPLIER_NOT_FOUND',
      );
      f.code(
        await f.post('ownerB', '/purchases/payments', {
          supplierId: supplierB,
          paidOn: today,
          method: 'cash',
          amount: '9.00',
          allocations: [{ invoiceId: inv['id'], amount: '9.00' }],
        }),
        404,
        'SUPPLIER_INVOICE_NOT_FOUND',
      );
      const forgedAccount = await f.post('ownerB', '/purchases/payments', {
        supplierId: supplierB,
        paidOn: today,
        method: 'bank_transfer',
        accountId: bankId,
        amount: '12.00',
        allocations: [{ invoiceId: invB['id'], amount: '12.00' }],
      });
      expect(forgedAccount.status, JSON.stringify(forgedAccount.body)).toBe(404);
      expect((await invoice(inv['id']))['settlement']['status']).toBe('paid');

      f.code(
        await f.get('ownerB', `/purchases/payments/${p['id']}`),
        404,
        'SUPPLIER_PAYMENT_NOT_FOUND',
      );
      f.code(
        await f.post('ownerB', `/purchases/payments/${p['id']}/cancel`, {
          reason: 'x',
          expectedRevision: 1,
        }),
        404,
        'SUPPLIER_PAYMENT_NOT_FOUND',
      );
      const expenseN = (p['expenseIds'] as string[])[0]!;
      f.code(
        await f.post('ownerB', '/purchases/payments/from-expense', {
          expenseId: expenseN,
          expectedRevision: 1,
          allocations: [{ invoiceId: invB['id'], amount: '12.00' }],
        }),
        404,
        'EXPENSE_NOT_FOUND',
      );
      const listB = f.ok(await f.get('ownerB', '/purchases/payments'));
      expect(listB['items']).toEqual([]);
      const payablesB = f.ok(await f.get('ownerB', '/purchases/payables'));
      expect((payablesB['invoices'] as { id: string }[]).map((i) => i.id)).toEqual([invB['id']]);
      const dupB = f.ok(await f.get('ownerB', '/purchases/duplicates'));
      expect(dupB['duplicates']).toEqual([]);
    });
  });
});
