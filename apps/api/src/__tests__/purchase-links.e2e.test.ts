// Liens des achats avec le reste de Lalanda, contre la vraie application (ADR-0044
// § 3.1.1, § 6.1, § 6.4, § 6.5 ; critères 10 et 15). ADR-0044 — P6.
//
// Couvre : brief du matin (faits `fournisseurs.*`, `mes_approbations.en_attente`,
// règles R11 et R12, faits masqués sans `purchase.read`), coûts engagés de la marge
// (`committed`, `ordered`, jamais soustraits ; rien sans `purchase.read`), tâche
// `purchases.due-reminders` (destinataires `payables.pay`, une seule fois, cloche
// vide sans le droit), fiche fournisseur 360° (sections, droits, isolation), et
// recalcul des brouillons de facture à la modification d'une commande.

import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import type { NotificationInput } from '../notifications/notifications.port.js';
import { PurchasesDueRemindersJob } from '../purchases/reminders/purchases-reminders.job.js';
import { ProjectMarginService } from '../work/margin/project-margin.service.js';
import { e2eSuite } from './e2e-utils.js';
import { useP4Fixture, type P4Account } from './purchases-p4-e2e-fixtures.js';

vi.setConfig({ testTimeout: 120_000 });

const kinshasaToday = (): string => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Allocation = { category: string; workProjectId?: string | null; amount: string };
type Fact = { id: string; status: string; value: string | null };

e2eSuite('Liens des achats : brief, marge, rappels, fiche 360° (ADR-0044 P6)', () => {
  const f = useP4Fixture('achlnk');
  const today = kinshasaToday();
  let supplierId = '';
  let supplierB = '';
  let projectId = '';
  let bankId = '';
  let ref = 0;
  const overdueIds: string[] = [];
  let soonId = '';
  let projectInvoiceId = '';

  async function validatedInvoice(opts: {
    total: string;
    allocations?: Allocation[];
    dueDate: string;
    who?: P4Account;
    supplier?: string;
  }): Promise<Record<string, any>> {
    const who = opts.who ?? 'admin';
    const draft = f.ok(
      await f.post(who, '/purchases/invoices', {
        supplierId: opts.supplier ?? supplierId,
        supplierReference: `LK-${++ref}`,
        invoiceDate: addDays(today, -40),
        dueDate: opts.dueDate,
        currency: 'USD',
        subtotal: opts.total,
        taxes: [],
        total: opts.total,
        costAllocations: opts.allocations ?? [{ category: 'achats', amount: opts.total }],
      }),
      201,
    );
    return f.ok(
      await f.post(who, `/purchases/invoices/${draft['id']}/validate`, { expectedRevision: 1 }),
    );
  }

  const facts = async (who: P4Account): Promise<Map<string, Fact>> => {
    const body = f.ok(await f.get(who, '/morning-brief'));
    return new Map((body['brief']['facts'] as Fact[]).map((x) => [x.id, x]));
  };
  const ruleIds = async (who: P4Account): Promise<string[]> => {
    const body = f.ok(await f.get(who, '/morning-brief'));
    return (body['brief']['recommendations'] as { ruleId: string }[]).map((r) => r.ruleId);
  };

  it('prépare fournisseurs, projet RUN, compte bancaire et factures', async () => {
    supplierId = await f.supplier('owner', 'Socimex', {
      defaultCurrency: 'USD',
      defaultCategory: 'achats',
    });
    supplierB = await f.supplier('ownerB', 'Autre', { defaultCurrency: 'USD' });
    projectId = f.ok(
      await f.post('owner', '/work/projects', { name: 'Chantier P', kind: 'internal' }),
      201,
    )['id'] as string;
    bankId = f.ok(
      await f.post('owner', '/treasury/accounts', {
        name: 'Banque USD',
        kind: 'bank',
        currency: 'USD',
        openingBalance: '10000.00',
        openingDate: '2026-01-01',
      }),
      201,
    )['id'] as string;

    // Deux factures en retard (dont une en partie au projet P), une bientôt, une en litige.
    const a = await validatedInvoice({
      total: '1000.00',
      dueDate: addDays(today, -1),
      allocations: [
        { category: 'achats', workProjectId: projectId, amount: '600.00' },
        { category: 'services_exterieurs', workProjectId: null, amount: '400.00' },
      ],
    });
    projectInvoiceId = a['id'];
    const b = await validatedInvoice({ total: '200.00', dueDate: addDays(today, -10) });
    overdueIds.push(a['id'], b['id']);
    soonId = (await validatedInvoice({ total: '50.00', dueDate: addDays(today, 2) }))['id'];
    const disputed = await validatedInvoice({ total: '70.00', dueDate: addDays(today, -3) });
    f.ok(
      await f.post('admin', `/purchases/invoices/${disputed['id']}/dispute`, {
        reason: 'Quantités contestées',
        expectedRevision: disputed['revision'],
      }),
    );
    // Paiement partiel de 500 sur la facture du projet (critère 10).
    f.ok(
      await f.post('accountant', '/purchases/payments', {
        supplierId,
        paidOn: today,
        method: 'bank_transfer',
        accountId: bankId,
        amount: '500.00',
        allocations: [{ invoiceId: projectInvoiceId, amount: '500.00' }],
      }),
      201,
    );
    // Organisation B : une facture en retard, invisible depuis N.
    await validatedInvoice({
      who: 'ownerB',
      supplier: supplierB,
      total: '99.00',
      dueDate: addDays(today, -5),
    });
  });

  describe('brief du matin (§ 6.4, critère 15)', () => {
    it('Propriétaire : deux factures en retard, montants par devise, R11', async () => {
      const brief = await facts('owner');
      expect(brief.get('fournisseurs.factures_en_retard')).toMatchObject({
        status: 'known',
        value: '2',
      });
      expect(brief.get('fournisseurs.a_payer_bientot')?.value).toBe('1');
      // 1 000 − 500 payés + 200 ; le litige à part.
      expect(brief.get('fournisseurs.factures_en_retard.USD')?.value).toBe('700.00');
      expect(await ruleIds('owner')).toContain('factures_fournisseurs_en_retard');
      const body = f.ok(await f.get('owner', '/morning-brief'));
      expect(body['brief']['version']).toBe('1.4.0');
      const r11 = (body['brief']['alerts'] as Record<string, unknown>[]).find(
        (a) => a['ruleId'] === 'factures_fournisseurs_en_retard',
      );
      expect(r11).toMatchObject({ actionPath: '/achats/a-payer', severity: 'attention' });
    });

    it('R12 : la demande soumise attend le Directeur financier, pas son demandeur', async () => {
      const created = f.ok(
        await f.post('owner', '/purchases/orders', {
          title: 'Ramettes',
          supplierId,
          currency: 'USD',
          lines: [{ label: 'Ramette', quantity: '1', unitPrice: '10.00', kind: 'goods' }],
        }),
        201,
      );
      f.ok(
        await f.post('owner', `/purchases/orders/${created['id']}/submit`, {
          expectedRevision: created['revision'],
        }),
      );
      expect((await facts('finance_director')).get('mes_approbations.en_attente')?.value).toBe('1');
      expect(await ruleIds('finance_director')).toContain('approbations_achat_en_attente');
      expect((await facts('owner')).get('mes_approbations.en_attente')?.value).toBe('0');
      // Sans `purchase.approve` : fait masqué, R12 jamais évaluée.
      const analyst = await facts('analyst');
      expect(analyst.get('mes_approbations.en_attente')).toMatchObject({
        status: 'hidden',
        value: null,
      });
      expect(analyst.get('fournisseurs.factures_en_retard')?.value).toBe('2');
      // Approuvée, elle disparaît.
      const o = await f.order(created['id']);
      f.ok(
        await f.post('finance_director', `/purchases/orders/${created['id']}/approve`, {
          expectedRevision: o['revision'],
        }),
      );
      expect((await facts('finance_director')).get('mes_approbations.en_attente')?.value).toBe('0');
    });

    it('sans purchase.read (Commercial) : rien des achats, ni fait connu ni règle', async () => {
      const brief = await facts('sales_rep');
      for (const [id, fact] of brief) {
        if (id.startsWith('fournisseurs.') || id.startsWith('mes_approbations.')) {
          expect(fact, id).toMatchObject({ status: 'hidden', value: null });
        }
      }
      expect(brief.has('fournisseurs.factures_en_retard.USD')).toBe(false);
      const rules = await ruleIds('sales_rep');
      expect(rules).not.toContain('factures_fournisseurs_en_retard');
      expect(rules).not.toContain('approbations_achat_en_attente');
    });

    it('isolation : l’organisation B ne compte que sa facture', async () => {
      const brief = await facts('ownerB');
      expect(brief.get('fournisseurs.factures_en_retard')?.value).toBe('1');
      expect(brief.get('fournisseurs.factures_en_retard.USD')?.value).toBe('99.00');
    });
  });

  describe('marge du projet : coûts engagés informatifs (§ 6.1, critère 10)', () => {
    it('committed = 300 (part du projet dans le reste), ordered = commande non facturée', async () => {
      await f.seedOrder({
        supplierId,
        lines: [
          { id: 'p', quantity: '10', unitPrice: '5.00', workProjectId: projectId },
          { id: 'x', quantity: '1', unitPrice: '99.00' },
        ],
      });
      const m = f.ok(await f.get('owner', `/work/projects/${projectId}/margin`));
      expect(m['version']).toBe('1.2.0');
      expect(m['purchases']).toEqual([
        { currency: 'USD', committed: '300.00', ordered: '50.00', invoiceCount: 1, orderCount: 1 },
      ]);
      // Jamais soustrait : la marge ne voit que la dépense de 300 du paiement.
      expect(m['currencies'][0]).toMatchObject({
        currency: 'USD',
        expenses: '300.00',
        margin: '-300.00',
      });
    });

    it('sans purchase.read : rien n’est lu, `purchases: null`', async () => {
      const margins = f.app().get(ProjectMarginService, { strict: false });
      const view = await margins.margin(f.orgId(), projectId, {}, {
        userId: f.userId('sales_rep'),
        role: 'sales_rep',
        context: { canClosePeriods: false, grants: [], revokes: [] },
      } as never);
      expect(view.purchases).toBeNull();
      expect(view.currencies[0]?.margin).toBe('-300.00');
    });
  });

  describe('rappels d’échéance `purchases.due-reminders` (§ 6.5)', () => {
    it('une fois par facture et par échéance, aux détenteurs de payables.pay', async () => {
      const job = f.app().get(PurchasesDueRemindersJob, { strict: false });
      const sent: NotificationInput[] = [];
      const inner = job.port;
      job.port = {
        notify: async (input) => {
          sent.push(input);
          await inner.notify(input);
        },
      };
      const at = new Date(Date.parse(`${today}T09:00:00Z`)); // 10 h à Kinshasa
      // Avant 7 h à Kinshasa : rien.
      expect((await job.run(new Date(Date.parse(`${today}T04:00:00Z`)))).claimed).toBe(0);

      const first = await job.run(at);
      expect(first.notified).toBeGreaterThanOrEqual(4); // N : 2 en retard + 1 bientôt ; B : 1
      const overdue = sent.filter(
        (n) => n.kind === 'purchases.invoice_overdue' && n.organizationId === f.orgId(),
      );
      expect([...new Set(overdue.map((n) => n.source.entityId))].sort()).toEqual(
        [...overdueIds].sort(),
      );
      const recipients = [...new Set(overdue.map((n) => n.recipientUserId))].sort();
      expect(recipients).toEqual(
        [f.userId('owner'), f.userId('finance_director'), f.userId('accountant')].sort(),
      );
      const soon = sent.filter((n) => n.kind === 'purchases.invoice_due_soon');
      expect(soon.map((n) => n.source.entityId)).toContain(soonId);
      expect(overdue[0]).toMatchObject({
        requiredAction: 'purchase.read',
        href: expect.stringMatching(/^\/achats\/factures\//),
        dedupeKey: expect.stringMatching(/^purchases\.invoice_overdue:/),
      });
      // Le litige n'est pas rappelé.
      expect(
        sent.some(
          (n) =>
            !overdueIds.includes(n.source.entityId) &&
            n.kind === 'purchases.invoice_overdue' &&
            n.organizationId === f.orgId(),
        ),
      ).toBe(false);

      // Rejouer : rien de plus.
      sent.length = 0;
      expect((await job.run(at)).claimed).toBe(0);
      expect(sent).toEqual([]);

      // La cloche : le comptable les voit ; le Commercial (sans purchase.read), rien.
      const mine = f.ok(await f.get('accountant', '/notifications'));
      expect(
        (mine['items'] as { kind: string }[]).some((n) => n.kind === 'purchases.invoice_overdue'),
      ).toBe(true);
      const rep = f.ok(await f.get('sales_rep', '/notifications'));
      expect(
        (rep['items'] as { kind: string }[]).some((n) => n.kind.startsWith('purchases.')),
      ).toBe(false);
    });
  });

  describe('fiche fournisseur 360° (§ 3.1.1)', () => {
    it('Propriétaire : sections connues, solde et ancienneté par devise', async () => {
      const o = f.ok(await f.get('owner', `/purchases/suppliers/${supplierId}/overview`));
      expect(o['supplier']['id']).toBe(supplierId);
      expect(o['sections']['orders']['status']).toBe('known');
      expect(o['sections']['orders']['data']['totalsByCurrency']).toEqual([
        // Commandes engagées : la demande approuvée (10,00) et la commande du projet (149,00).
        { currency: 'USD', total: '159.00', count: 2 },
      ]);
      expect(o['sections']['receptions']['status']).toBe('known');
      expect(o['sections']['invoices']['data']['recent'].length).toBe(4);
      expect(o['sections']['balance']['data']['byCurrency']).toEqual([
        {
          currency: 'USD',
          remaining: '750.00',
          notDue: '50.00',
          days1to30: '700.00',
          days31to60: '0.00',
          days61to90: '0.00',
          over90: '0.00',
          disputed: '70.00',
        },
      ]);
      expect(o['sections']['payments']['data']['recent']).toHaveLength(1);
      expect(o['sections']['directExpenses']).toEqual({ status: 'empty', data: null });
      // Coordonnées de paiement jamais en clair.
      expect(JSON.stringify(o)).not.toMatch(/accountNumber"\s*:\s*"\d{6,}/);
    });

    it('droits et isolation : Commercial 403, autre organisation 404', async () => {
      expect((await f.get('sales_rep', `/purchases/suppliers/${supplierId}/overview`)).status).toBe(
        403,
      );
      expect((await f.get('ownerB', `/purchases/suppliers/${supplierId}/overview`)).status).toBe(
        404,
      );
    });
  });

  describe('résumé des achats `GET /purchases/summary` (§ 3.6)', () => {
    it('engagé à date, facturé, payé et reste par devise ; droits et isolation', async () => {
      const s = f.ok(await f.get('viewer', '/purchases/summary'));
      expect(s['byCurrency']).toEqual([
        {
          currency: 'USD',
          // Ramettes (10,00) + commande du projet (149,00), rien de facturé dessus.
          committed: '159.00',
          invoiced: '1320.00',
          credited: '0.00',
          paid: '500.00',
          remaining: '820.00',
        },
      ]);
      expect(s['bySupplier'][0]).toMatchObject({ supplierId, supplierName: expect.any(String) });
      // Période sans facture : l'engagé reste, le facturé disparaît.
      const vide = f.ok(
        await f.get(
          'viewer',
          `/purchases/summary?from=${addDays(today, 1)}&to=${addDays(today, 2)}`,
        ),
      );
      expect(vide['byCurrency']).toEqual([
        {
          currency: 'USD',
          committed: '159.00',
          invoiced: '0.00',
          credited: '0.00',
          paid: '0.00',
          remaining: '0.00',
        },
      ]);
      f.code(
        await f.get('viewer', `/purchases/summary?from=${today}&to=${addDays(today, -1)}`),
        400,
        'INVALID_REQUEST',
      );
      expect((await f.get('sales_rep', '/purchases/summary')).status).toBe(403);
      const b = f.ok(await f.get('ownerB', '/purchases/summary'));
      expect(b['byCurrency']).toEqual([
        {
          currency: 'USD',
          committed: '0.00',
          invoiced: '99.00',
          credited: '0.00',
          paid: '0.00',
          remaining: '99.00',
        },
      ]);
    });
  });

  describe('modification d’une commande : brouillons de facture recalculés', () => {
    it('le prix corrigé sur la commande lève l’écart du brouillon lié', async () => {
      const order = await f.seedOrder({
        supplierId,
        sent: false,
        lines: [{ id: 's', quantity: '10', unitPrice: '5.00', kind: 'service', receivable: false }],
      });
      const draft = f.ok(
        await f.post('admin', '/purchases/invoices', {
          supplierId,
          supplierReference: `LK-${++ref}`,
          invoiceDate: today,
          currency: 'USD',
          orderIds: [order.id],
          lines: [{ orderLineId: order.line['s'], quantity: '10', unitPrice: '6.00' }],
          total: '60.00',
        }),
        201,
      );
      expect(draft['matchingStatus']).toBe('variance');

      const current = await f.order(order.id);
      const updated = f.ok(
        await f.put('owner', `/purchases/orders/${order.id}`, {
          title: current['title'],
          supplierId,
          currency: 'USD',
          lines: [
            {
              id: order.line['s'],
              label: 'Ligne s',
              quantity: '10',
              unitPrice: '6.00',
              kind: 'service',
              receivable: false,
              category: 'achats',
            },
          ],
          expectedRevision: current['revision'],
        }),
      );
      expect(updated['status']).toBe('submitted');
      f.ok(
        await f.post('finance_director', `/purchases/orders/${order.id}/approve`, {
          expectedRevision: updated['revision'],
        }),
      );
      const after = f.ok(await f.get('viewer', `/purchases/invoices/${draft['id']}`));
      expect(after['status']).toBe('draft');
      expect(after['matching']['status']).toBe('matched');
      // La révision du brouillon ne change pas (sortie dérivée).
      expect(after['revision']).toBe(draft['revision']);
    });
  });
});
