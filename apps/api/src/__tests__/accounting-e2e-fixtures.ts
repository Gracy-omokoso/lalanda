// Jeux d'essai des e2e de la comptabilité (ADR-0049, lot K5).
//
// Les pièces sources (factures figées, encaissements, dépenses, factures et paiements
// fournisseurs, virements) sont INSÉRÉES en base comme des documents déjà figés par leur
// module : la comptabilité les lit sans jamais les écrire, et c'est cette lecture qui est
// testée. Les numéros de compte ci-dessous sont des valeurs de TEST (comptes du pack v1
// brouillon), pas des règles comptables.
//
// Mode actif : le pack v1 reste `draft` (aucun expert ne l'a relu) ; l'activation par
// `POST /accounting/activate` est donc impossible (critère 2, testé par K4). Pour tester
// la persistance, le réglage `mode: 'active'` est posé directement en base, comme le
// ferait l'activation une fois le pack approuvé.

import type { INestApplication } from '@nestjs/common';
import { ObjectId, type Db } from 'mongodb';
import request from 'supertest';
import { expect } from 'vitest';

import { dbOf, makeE2EApp, registerAndLogin } from './e2e-utils.js';
// ADR-0053 — P8
import { enrolerDeuxFacteurs } from './platform-2fa-e2e.js';

export const PACK = { slug: 'syscohada-revise-2017-cd', version: 1 } as const;

/** Règles de TEST, validées par l'organisation (aucune n'est une règle de l'éditeur). */
export const TEST_RULES = [
  { key: 'sale.invoice.receivable', debit: ['{customer}'], credit: [] },
  { key: 'sale.invoice.revenue.SER.B', debit: [], credit: ['706'] },
  { key: 'sale.invoice.revenue.SER.C', debit: [], credit: ['706'] },
  { key: 'sale.invoice.revenue.BIE.B', debit: [], credit: ['701'] },
  { key: 'sale.invoice.revenue.BIE.C', debit: [], credit: ['701'] },
  { key: 'sale.invoice.vat.B', debit: [], credit: ['4431'] },
  { key: 'sale.invoice.vat.C', debit: [], credit: ['4431'] },
  { key: 'sale.credit_note.receivable', debit: [], credit: ['{customer}'] },
  { key: 'sale.credit_note.revenue.SER.B', debit: ['706'], credit: [] },
  { key: 'sale.credit_note.vat.B', debit: ['4431'], credit: [] },
  { key: 'sale.payment_at_issue.receivable', debit: [], credit: ['{customer}'] },
  { key: 'receipt.VIREMENT', debit: ['{treasuryAccount}'], credit: [] },
  { key: 'receipt.ESPECES', debit: ['{treasuryAccount}'], credit: [] },
  { key: 'receipt.receivable', debit: [], credit: ['{customer}'] },
  { key: 'expense.loyer', debit: ['601'], credit: [] },
  { key: 'expense.achats', debit: ['601'], credit: [] },
  { key: 'expense.payment', debit: [], credit: ['{treasuryAccount}'] },
  { key: 'purchase.invoice.achats', debit: ['601'], credit: [] },
  { key: 'purchase.invoice.payable', debit: [], credit: ['{supplier}'] },
  { key: 'purchase.payment.payable', debit: ['{supplier}'], credit: [] },
  { key: 'purchase.payment.bank_transfer', debit: [], credit: ['{treasuryAccount}'] },
  { key: 'transfer.treasury', debit: ['{treasuryAccount}'], credit: ['{treasuryAccount}'] },
  { key: 'transfer.internal', debit: ['585'], credit: ['585'] },
].map((r) => ({ ...r, requiresReview: false }));

export type Who = string;

export interface AccountingWorld {
  app: INestApplication;
  db: Db;
  org: string;
  tag: string;
  userIds: Record<Who, string>;
  get: (who: Who, path: string) => request.Test;
  post: (who: Who, path: string, body?: unknown) => request.Test;
  put: (who: Who, path: string, body: unknown) => request.Test;
  del: (who: Who, path: string) => request.Test;
  orgOf: Record<Who, string>;
}

export const ok = (res: request.Response, status = 200): Record<string, any> => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Record<string, any>;
};

export const code = (res: request.Response, status: number, expected: string): void => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.code).toBe(expected);
};

/**
 * Une application, un Propriétaire (`owner`), des membres invités dans son organisation,
 * et d'autres Propriétaires d'organisations distinctes (`others`).
 */
export async function accountingWorld(
  name: string,
  roles: readonly string[],
  others: readonly string[] = [],
): Promise<AccountingWorld> {
  const app = await makeE2EApp();
  const db = await dbOf(app);
  const tag = Math.random().toString(16).slice(2, 10);
  const server = () => app.getHttpServer();
  const cookies: Record<Who, string[]> = {};
  const userIds: Record<Who, string> = {};
  const orgOf: Record<Who, string> = {};
  const compte = (c: Who) => ({
    email: `k5-${name}-${c}-${tag}@lalanda-test.local`,
    password: 'Passw0rd!compta-k5',
    name: `Membre ${c} ${tag}`,
  });
  const sessionUserId = async (c: Who) => {
    const s = await request(server()).get('/auth/get-session').set('Cookie', cookies[c]!);
    return String(s.body?.user?.id ?? '');
  };
  const firstOrg = async (c: Who) => {
    cookies[c] = await registerAndLogin(app, compte(c));
    const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]!);
    return (orgs.body.organizations as { id: string }[])[0]!.id;
  };
  const org = await firstOrg('owner');
  orgOf['owner'] = org;
  userIds['owner'] = await sessionUserId('owner');
  for (const role of roles) {
    const inv = await request(server())
      .post(`/organizations/${org}/invitations`)
      .set('Cookie', cookies['owner']!)
      .send({ email: compte(role).email, role });
    expect(inv.status, `invitation ${role} ${JSON.stringify(inv.body)}`).toBe(201);
    cookies[role] = await registerAndLogin(app, compte(role));
    const acc = await request(server())
      .post('/invitations/accept')
      .set('Cookie', cookies[role]!)
      .send({ token: inv.body.token });
    expect(acc.status).toBe(201);
    userIds[role] = await sessionUserId(role);
    orgOf[role] = org;
  }
  for (const other of others) {
    orgOf[other] = await firstOrg(other);
    userIds[other] = await sessionUserId(other);
  }
  const as = (who: Who): string[] => [...cookies[who]!, `active_org_id=${orgOf[who]}`];
  return {
    app,
    db,
    org,
    tag,
    userIds,
    orgOf,
    get: (who, path) => request(server()).get(path).set('Cookie', as(who)),
    post: (who, path, body) =>
      request(server())
        .post(path)
        .set('Cookie', as(who))
        .send((body ?? {}) as object),
    put: (who, path, body) =>
      request(server())
        .put(path)
        .set('Cookie', as(who))
        .send(body as object),
    del: (who, path) => request(server()).delete(path).set('Cookie', as(who)),
  };
}

/** Charge le pack v1 (gestionnaire plateforme de test) une fois par base. */
export async function loadPack(w: AccountingWorld): Promise<void> {
  if (await w.db.collection('accounting_chart_packs').findOne({ slug: PACK.slug })) return;
  const pm = `pm-${w.tag}`;
  const cookies = await registerAndLogin(w.app, {
    email: `k5-pack-${w.tag}@lalanda-test.local`,
    password: 'Passw0rd!compta-k5',
    name: `Pack ${w.tag}`,
  });
  const s = await request(w.app.getHttpServer()).get('/auth/get-session').set('Cookie', cookies);
  await w.db.collection('platform_roles').insertOne({
    userId: String(s.body?.user?.id ?? pm),
    role: 'platform_country_pack_manager',
    grantedBy: null,
    reason: 'e2e comptabilité K5',
    expiresAt: null,
    revokedAt: null,
    _schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // ADR-0053 — P8 : le gestionnaire plateforme s'enrôle avant la console.
  await enrolerDeuxFacteurs(w.app, cookies, 'Passw0rd!compta-k5');
  ok(
    await request(w.app.getHttpServer())
      .post('/accounting/platform/chart-packs')
      .set('Cookie', cookies)
      .send(PACK),
  );
}

/**
 * Organisation prête : pack choisi, monnaie de tenue, bascule, exercice ouvert, règles de
 * TEST validées (auteur `author`, validateur `validator`), puis mode demandé.
 */
export async function prepareOrganization(
  w: AccountingWorld,
  opts: {
    who?: Who;
    mode: 'simulation' | 'active';
    bookCurrency?: 'CDF' | 'USD';
    cutoverDate?: string;
    rules?: typeof TEST_RULES | null;
    author?: Who;
    validator?: Who;
    fiscalYears?: number[];
  },
): Promise<void> {
  const who = opts.who ?? 'owner';
  const org = w.orgOf[who]!;
  await loadPack(w);
  const s0 = ok(await w.get(who, '/accounting/settings'));
  ok(
    await w.put(who, '/accounting/settings', {
      expectedRevision: s0['revision'],
      mode: 'simulation',
      chartPack: PACK,
      bookCurrency: opts.bookCurrency ?? 'CDF',
      cutoverDate: opts.cutoverDate ?? '2026-10-01',
    }),
  );
  for (const year of opts.fiscalYears ?? [2026]) {
    ok(await w.post(who, '/accounting/fiscal-years', { year }), 201);
  }
  if (opts.rules !== null) {
    const author = opts.author ?? who;
    const validator = opts.validator ?? who;
    const draft = ok(await w.post(author, '/accounting/rule-sets', {}), 201);
    const saved = ok(
      await w.put(author, `/accounting/rule-sets/${draft['version']}`, {
        expectedRevision: draft['revision'],
        rules: opts.rules ?? TEST_RULES,
      }),
    );
    ok(
      await w.post(validator, `/accounting/rule-sets/${draft['version']}/validate`, {
        expectedRevision: saved['revision'],
        expertReview: { declared: true, name: 'Cabinet Essai', date: '2026-10-01', note: null },
      }),
    );
  }
  if (opts.mode === 'active') {
    await w.db
      .collection('accounting_settings')
      .updateOne(
        { organizationId: org },
        { $set: { mode: 'active', activatedAt: new Date(), activatedBy: w.userIds[who] } },
      );
  }
}

// ── Pièces sources figées ──────────────────────────────────────────────────

export interface GroupSpec {
  group: string;
  itemType: 'BIE' | 'SER';
  ht: string;
  vat: string;
}

/** Somme de décimaux à deux chiffres (jeux d'essai seulement). */
export function add(...values: string[]): string {
  const cents = values.reduce((s, v) => s + BigInt(v.replace('.', '')), 0n);
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** Facture (ou avoir) de vente FIGÉE, insérée comme l'aurait laissée son module. */
export function salesInvoiceDoc(
  org: string,
  opts: {
    type?: string;
    status?: string;
    series?: 'real' | 'test' | 'proforma' | null;
    number?: string;
    currency?: 'CDF' | 'USD';
    issuedAt?: string;
    groups: GroupSpec[];
    payments?: { method: string; amount: string }[];
    customerId?: string;
    customerName?: string;
    conversion?: { rate: string } | null;
  },
): Record<string, unknown> & { _id: ObjectId } {
  const _id = new ObjectId();
  const lines = opts.groups.map((g, index) => ({
    index,
    source: 'free',
    catalogItemId: null,
    originLineIndex: null,
    code: null,
    edefCode: null,
    name: `Ligne ${index + 1}`,
    unit: null,
    itemType: g.itemType,
    taxGroup: g.group,
    outOfScope: false,
    specificTax: null,
    quantity: '1',
    originalPrice: null,
    discount: null,
    unitPrice: g.ht,
    priceModification: null,
    priceOverridden: false,
  }));
  const total = add(...opts.groups.map((g) => add(g.ht, g.vat)));
  const totals = {
    calculationVersion: 'test',
    policyId: 'test',
    priceMode: 'ht',
    lines: opts.groups.map((g, index) => ({
      index,
      amount: g.ht,
      specificTaxAmount: '0.00',
      specificTaxValue: null,
    })),
    groups: opts.groups.map((g) => ({
      group: g.group,
      ratePercent: '0.00',
      total: add(g.ht, g.vat),
      ht: g.ht,
      vat: g.vat,
      specificTax: '0.00',
    })),
    specificTax: '0.00',
    total,
    vatTotal: add(...opts.groups.map((g) => g.vat)),
  };
  const payments = opts.payments ?? [{ method: 'CREDIT', amount: total }];
  const status = opts.status ?? 'normalized';
  const issuedAt = new Date(`${opts.issuedAt ?? '2026-10-05'}T10:00:00+01:00`);
  const currency = opts.currency ?? 'CDF';
  return {
    _id,
    organizationId: org,
    status,
    proformaRef: `PF-${_id.toHexString()}`,
    type: opts.type ?? 'FV',
    currency,
    priceMode: 'ht',
    customer: {
      customerId: opts.customerId ?? new ObjectId().toHexString(),
      type: 'PM',
      name: opts.customerName ?? 'Client essai',
      nif: null,
      exemptionReference: null,
      phone: null,
      email: null,
      address: null,
      printContactDetails: false,
    },
    pointOfSaleId: null,
    lines,
    payments,
    comments: {},
    creditNote: null,
    showUsdCounterValue: false,
    documentAmounts: {
      currency,
      calculation: { ok: true, issues: [], totals },
      paymentsCheck: null,
    },
    conversion:
      currency === 'USD' && opts.conversion
        ? {
            from: 'USD',
            to: 'CDF',
            rate: opts.conversion.rate,
            rateDate: opts.issuedAt ?? '2026-10-05',
            rateSource: 'dgi',
            reference: null,
            originInvoiceId: null,
            conversionVersion: 'test',
          }
        : null,
    normalizedAmounts:
      status === 'normalized' && currency === 'CDF'
        ? { currency: 'CDF', lines: [], payments, calculation: totals, counterValueUsd: null }
        : null,
    number: opts.number ?? `IN2610-${_id.toHexString().slice(-6)}`,
    series: opts.series === undefined ? 'real' : opts.series,
    fiscalYear: 2026,
    issuedAt,
    frozenAt: issuedAt,
    contentSha256: 'e'.repeat(64),
    amountOnCredit: null,
    credited: [],
    creditRevision: 0,
    normalization: null,
    duplicateCount: 0,
    revision: 1,
    sortAt: issuedAt,
    searchKey: '',
    createdBy: 'fixture',
    updatedBy: 'fixture',
    // Horodatages techniques : l'instant du gel (aujourd'hui), pas la date de la pièce.
    createdAt: new Date(),
    updatedAt: new Date(),
    _schemaVersion: 1,
  };
}

export function treasuryAccountDoc(
  org: string,
  opts: { name: string; kind: 'cash' | 'bank' | 'mobile_money'; currency: 'CDF' | 'USD' },
): Record<string, unknown> & { _id: ObjectId } {
  const now = new Date();
  return {
    _id: new ObjectId(),
    organizationId: org,
    name: opts.name,
    kind: opts.kind,
    institution: null,
    currency: opts.currency,
    openingBalance: '0.00',
    openingDate: '2026-09-30',
    active: true,
    revision: 1,
    createdBy: 'fixture',
    updatedBy: 'fixture',
    createdAt: now,
    updatedAt: now,
  };
}

export function receiptDoc(
  org: string,
  opts: {
    receivedOn: string;
    amount: string;
    currency?: 'CDF' | 'USD';
    method?: string;
    accountId: string | null;
    allocations: { invoiceId: string; invoiceNumber: string | null; amount: string }[];
  },
): Record<string, unknown> & { _id: ObjectId } {
  const now = new Date();
  return {
    _id: new ObjectId(),
    organizationId: org,
    status: 'recorded',
    receivedOn: opts.receivedOn,
    amount: opts.amount,
    currency: opts.currency ?? 'CDF',
    method: opts.method ?? 'VIREMENT',
    reference: `ENC-${Math.random().toString(16).slice(2, 8)}`,
    note: null,
    accountId: opts.accountId,
    allocations: opts.allocations,
    invoiceIds: opts.allocations.map((a) => a.invoiceId),
    cancellation: null,
    calculationVersion: 'test',
    revision: 1,
    createdBy: 'fixture',
    updatedBy: 'fixture',
    createdAt: now,
    updatedAt: now,
    _schemaVersion: 1,
  };
}

export function expenseDoc(
  org: string,
  opts: {
    spentOn: string;
    amount: string;
    currency?: 'CDF' | 'USD';
    category?: string;
    accountId: string | null;
    deductibleVat?: string | null;
    origin?: Record<string, unknown> | null;
  },
): Record<string, unknown> & { _id: ObjectId } {
  const now = new Date();
  return {
    _id: new ObjectId(),
    organizationId: org,
    spentOn: opts.spentOn,
    amount: opts.amount,
    currency: opts.currency ?? 'CDF',
    category: opts.category ?? 'loyer',
    label: 'Dépense essai',
    supplierName: 'Bailleur',
    supplierKey: null,
    supplierId: null,
    accountId: opts.accountId,
    deductibleVat: opts.deductibleVat ?? null,
    reference: null,
    attachment: null,
    recurringExpenseId: null,
    occurrenceDate: null,
    workProjectId: null,
    origin: opts.origin ?? null,
    status: 'recorded',
    cancelReason: null,
    cancelledAt: null,
    revision: 1,
    createdBy: 'fixture',
    updatedBy: 'fixture',
    createdAt: now,
    updatedAt: now,
  };
}

/** Écritures enregistrées d'une organisation (lecture directe, pour les assertions). */
export async function entriesOf(
  db: Db,
  org: string,
  filter: Record<string, unknown> = {},
): Promise<Record<string, any>[]> {
  return db
    .collection('accounting_entries')
    .find({ organizationId: org, ...filter })
    .sort({ _id: 1 })
    .toArray();
}
