// Dépenses, trésorerie réelle, report au réalisé, rapprochement et prévision
// contre la vraie application (ADR-0034).
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleur → moteur → MongoDB (replica set). BASE DÉDIÉE, supprimée à la fin.
//
// Exigences testées :
//  1. Multi-devises : comptes CDF et USD, soldes calculés, dépense refusée dans
//     une autre devise que son compte, virement de même devise neutre, virement
//     entre devises à deux montants.
//  2. Règles des dépenses : pas de date future, pas avant l'ouverture du compte,
//     TVA déductible ≤ montant, annulation motivée, révision attendue.
//  3. Récurrences : occurrences « à confirmer », confirmation idempotente,
//     date qui n'est pas une échéance, échéance future refusée.
//  4. Report au réalisé : configuration contrôlée (charge seulement, catégorie
//     d'exploitation), `dryRun`, écriture étiquetée `run.expenses`, idempotence,
//     période clôturée jamais modifiée, devise non convertible, retrait,
//     verrou de la saisie manuelle, désactivation.
//  5. Rapprochement : prévu, réalisé, écart, constats.
//  6. Prévision : trois scénarios, horizons 7/30/90/180, hypothèses, alertes.
//  7. Isolation entre organisations (404), RBAC (403 nommant l'action).
//  8. Pièce justificative assainie (si S3_* est configuré).

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import type { Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_treso_${tag}`;

vi.setConfig({ testTimeout: 90_000 });

const MOT_DE_PASSE = 'Passw0rd!tresorerie';
const ROLES = ['owner', 'accountant', 'analyst', 'advisor', 'viewer', 'admin'] as const;
type Role = (typeof ROLES)[number];
type Compte = Role | 'ownerB';

const S3_CONFIGURE = Boolean(
  process.env['S3_ENDPOINT'] &&
  process.env['S3_ACCESS_KEY'] &&
  process.env['S3_SECRET_KEY'] &&
  process.env['S3_BUCKET_UPLOADS'],
);
const itS3 = S3_CONFIGURE ? it : it.skip;

/** Jour civil de Kinshasa (UTC+1), comme l'API. */
function kinshasaToday(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}
function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}
function png(extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(64, 0);
  ihdr.writeUInt32BE(64, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_MAGIC,
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

e2eSuite('trésorerie — dépenses, comptes, réalisé, prévision (ADR-0034)', () => {
  let app: INestApplication;
  let db: Db;
  let orgId = '';
  let orgB = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;

  const server = () => app.getHttpServer();
  const as = (role: Role) => [...cookies[role], `active_org_id=${orgId}`];
  const asB = () => [...cookies['ownerB'], `active_org_id=${orgB}`];
  const get = (c: string[], path: string) => request(server()).get(path).set('Cookie', c);
  const post = (c: string[], path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', c)
      .send(body ?? {});
  const put = (c: string[], path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', c).send(body);
  const issueCodes = (res: request.Response): string[] =>
    ((res.body?.details?.issues ?? []) as { code: string }[]).map((i) => i.code);

  let banque = '';
  let caisse = '';
  let mobile = '';
  let projectId = '';

  async function expense(body: Record<string, unknown>, c = as('owner')) {
    const res = await post(c, '/treasury/expenses', {
      currency: 'USD',
      category: 'charges_diverses',
      label: 'Dépense de test',
      ...body,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; revision: number; amount: string };
  }

  async function balances(): Promise<Record<string, string>> {
    const res = await get(as('owner'), '/treasury/accounts');
    expect(res.status).toBe(200);
    return Object.fromEntries(
      (res.body.items as { id: string; balance: string }[]).map((a) => [a.id, a.balance]),
    );
  }

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    for (const c of [...ROLES, 'ownerB'] as const) {
      emails[c] = `treso-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({
      email: emails[c],
      password: MOT_DE_PASSE,
      name: `Tréso ${c}`,
    });

    cookies['owner'] = await registerAndLogin(app, compte('owner'));
    const orgs = await get(cookies['owner'], '/organizations');
    orgId = (orgs.body.organizations as { id: string }[])[0]!.id;
    for (const role of ROLES.filter((r) => r !== 'owner')) {
      const inv = await post(cookies['owner'], `/organizations/${orgId}/invitations`, {
        email: emails[role],
        role,
      });
      expect(inv.status, `invitation ${role} ${JSON.stringify(inv.body)}`).toBe(201);
      cookies[role] = await registerAndLogin(app, compte(role));
      const acc = await post(cookies[role], '/invitations/accept', { token: inv.body.token });
      expect(acc.status, `acceptation ${role}`).toBe(201);
    }
    cookies['ownerB'] = await registerAndLogin(app, compte('ownerB'));
    const orgsB = await get(cookies['ownerB'], '/organizations');
    orgB = (orgsB.body.organizations as { id: string }[])[0]!.id;
  }, 180_000);

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, 60_000);

  // ─── 1. Comptes et multi-devises ──────────────────────────────────────────

  describe('comptes, soldes et virements', () => {
    it('crée trois comptes, CDF et USD ; la devise d’ouverture fait le solde', async () => {
      const b = await post(as('owner'), '/treasury/accounts', {
        name: 'Banque USD',
        kind: 'bank',
        institution: 'Banque test',
        currency: 'USD',
        openingBalance: '1000.00',
        openingDate: '2026-01-01',
      });
      expect(b.status, JSON.stringify(b.body)).toBe(201);
      banque = b.body.id;
      expect(b.body.balance).toBe('1000.00');

      const c = await post(as('accountant'), '/treasury/accounts', {
        name: 'Caisse CDF',
        kind: 'cash',
        currency: 'CDF',
        openingBalance: '500000',
        openingDate: '2026-01-01',
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      caisse = c.body.id;

      const m = await post(as('owner'), '/treasury/accounts', {
        name: 'Mobile money USD',
        kind: 'mobile_money',
        currency: 'USD',
        openingBalance: '-20.00',
        openingDate: '2026-02-01',
      });
      expect(m.status).toBe(201);
      mobile = m.body.id;

      const list = await get(as('viewer'), '/treasury/accounts');
      expect(list.status).toBe(200);
      expect(list.body.totalsByCurrency).toEqual({ CDF: '500000.00', USD: '980.00' });
      expect(list.body.receiptsIntegrated).toBe(false);
    });

    it('refuse une devise inconnue et un montant mal formé', async () => {
      const res = await post(as('owner'), '/treasury/accounts', {
        name: 'Euro',
        kind: 'bank',
        currency: 'EUR',
        openingBalance: '1,5',
        openingDate: '2026-01-01',
      });
      expect(res.status).toBe(400);
      expect(issueCodes(res)).toContain('INVALID_AMOUNT');
    });

    it('une dépense rattachée diminue le solde ; devise, date et TVA sont contrôlées', async () => {
      await expense({
        spentOn: '2026-03-05',
        amount: '120.50',
        category: 'loyer',
        accountId: banque,
      });
      await expense({
        spentOn: '2026-03-06',
        amount: '70000',
        currency: 'CDF',
        category: 'achats',
        accountId: caisse,
      });
      const soldes = await balances();
      expect(soldes[banque]).toBe('879.50');
      expect(soldes[caisse]).toBe('430000.00');

      const devise = await post(as('owner'), '/treasury/expenses', {
        spentOn: '2026-03-05',
        amount: '10.00',
        currency: 'CDF',
        category: 'loyer',
        label: 'Mauvaise devise',
        accountId: banque,
      });
      expect(devise.status).toBe(400);
      expect(devise.body.code).toBe('EXPENSE_ACCOUNT_CURRENCY_MISMATCH');

      const futur = await post(as('owner'), '/treasury/expenses', {
        spentOn: addDays(kinshasaToday(), 2),
        amount: '10.00',
        currency: 'USD',
        category: 'loyer',
        label: 'Future',
      });
      expect(futur.status).toBe(400);
      expect(futur.body.code).toBe('EXPENSE_IN_FUTURE');

      const avant = await post(as('owner'), '/treasury/expenses', {
        spentOn: '2026-01-15',
        amount: '10.00',
        currency: 'USD',
        category: 'loyer',
        label: 'Avant ouverture',
        accountId: mobile,
      });
      expect(avant.status).toBe(400);
      expect(avant.body.code).toBe('EXPENSE_BEFORE_ACCOUNT_OPENING');

      const tva = await post(as('owner'), '/treasury/expenses', {
        spentOn: '2026-03-05',
        amount: '10.00',
        currency: 'USD',
        category: 'loyer',
        label: 'TVA excessive',
        deductibleVat: '11.00',
      });
      expect(tva.status).toBe(400);
      expect(issueCodes(tva)).toContain('VAT_EXCEEDS_AMOUNT');
    });

    it('virement de même devise : total inchangé ; montants différents refusés ; entre devises, deux montants', async () => {
      const avant = await get(as('owner'), '/treasury/accounts');
      const tr = await post(as('owner'), '/treasury/transfers', {
        date: '2026-03-10',
        fromAccountId: banque,
        toAccountId: mobile,
        amountOut: '100.00',
        amountIn: '100',
      });
      expect(tr.status, JSON.stringify(tr.body)).toBe(201);
      const apres = await get(as('owner'), '/treasury/accounts');
      expect(apres.body.totalsByCurrency.USD).toBe(avant.body.totalsByCurrency.USD);

      const ecart = await post(as('owner'), '/treasury/transfers', {
        date: '2026-03-10',
        fromAccountId: banque,
        toAccountId: mobile,
        amountOut: '100.00',
        amountIn: '99.00',
      });
      expect(ecart.status).toBe(400);
      expect(ecart.body.code).toBe('TRANSFER_AMOUNTS_DIFFER');

      const change = await post(as('owner'), '/treasury/transfers', {
        date: '2026-03-11',
        fromAccountId: caisse,
        toAccountId: banque,
        amountOut: '28500.00',
        amountIn: '10.00',
        label: 'Achat de dollars',
      });
      expect(change.status).toBe(201);
      const soldes = await balances();
      expect(soldes[caisse]).toBe('401500.00');
      expect(soldes[banque]).toBe('789.50');
      expect(soldes[mobile]).toBe('80.00');

      const ledger = await get(as('viewer'), `/treasury/movements?accountId=${banque}`);
      expect(ledger.status).toBe(200);
      expect((ledger.body.items as { source: string }[]).map((e) => e.source).sort()).toEqual([
        'expense',
        'transfer',
        'transfer',
      ]);
    });

    it('une autre entrée (apport) crédite le compte ; son annulation la retire', async () => {
      const apport = await post(as('owner'), '/treasury/movements', {
        kind: 'other_in',
        date: '2026-03-12',
        accountId: banque,
        amount: '500.00',
        label: 'Apport en compte courant',
      });
      expect(apport.status).toBe(201);
      expect((await balances())[banque]).toBe('1289.50');
      const annule = await post(as('owner'), `/treasury/movements/${apport.body.id}/cancel`, {
        reason: 'Saisi deux fois',
      });
      expect(annule.status).toBe(200);
      expect(annule.body.status).toBe('cancelled');
      expect((await balances())[banque]).toBe('789.50');
    });
  });

  // ─── 2. Dépenses : modification, annulation, synthèse ─────────────────────

  describe('dépenses', () => {
    it('modification à révision attendue, annulation motivée, plus de modification ensuite', async () => {
      const e = await expense({
        spentOn: '2026-02-02',
        amount: '15.00',
        supplierName: '  Kin Papeterie ',
      });
      const stale = await put(as('owner'), `/treasury/expenses/${e.id}`, {
        expectedRevision: 9,
        expense: {
          spentOn: '2026-02-02',
          amount: '16.00',
          currency: 'USD',
          category: 'charges_diverses',
          label: 'x',
        },
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('STALE_REVISION');
      const ok = await put(as('accountant'), `/treasury/expenses/${e.id}`, {
        expectedRevision: e.revision,
        expense: {
          spentOn: '2026-02-02',
          amount: '16.00',
          currency: 'USD',
          category: 'charges_diverses',
          label: 'Fournitures',
          supplierName: 'Kin Papeterie',
        },
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.amount).toBe('16.00');
      expect(ok.body.revision).toBe(2);

      const fournisseurs = await get(as('owner'), '/treasury/suppliers?q=papet');
      expect(fournisseurs.body.items).toEqual(['Kin Papeterie']);

      const sansMotif = await post(as('owner'), `/treasury/expenses/${e.id}/cancel`, {
        reason: ' ',
      });
      expect(sansMotif.status).toBe(400);
      const annule = await post(as('owner'), `/treasury/expenses/${e.id}/cancel`, {
        reason: 'Doublon',
      });
      expect(annule.status).toBe(200);
      expect(annule.body.status).toBe('cancelled');
      const apres = await put(as('owner'), `/treasury/expenses/${e.id}`, {
        expectedRevision: annule.body.revision,
        expense: {
          spentOn: '2026-02-02',
          amount: '1.00',
          currency: 'USD',
          category: 'charges_diverses',
          label: 'x',
        },
      });
      expect(apres.status).toBe(409);
      expect(apres.body.code).toBe('EXPENSE_CANCELLED');
    });

    it('synthèse par mois, devise et catégorie (moteur), hors dépenses annulées', async () => {
      const res = await get(
        as('analyst'),
        '/treasury/expenses/summary?from=2026-02-01&to=2026-03-31',
      );
      expect(res.status).toBe(200);
      expect(res.body.totalsByCurrency).toEqual({ CDF: '70000.00', USD: '120.50' });
      const liste = await get(as('viewer'), '/treasury/expenses?from=2026-03-01&to=2026-03-31');
      expect(liste.body.items).toHaveLength(2);
      expect(liste.body.items[0].categoryLabel).toBeTruthy();
    });
  });

  // ─── 3. Récurrences ───────────────────────────────────────────────────────

  describe('dépenses récurrentes', () => {
    let ruleId = '';
    const today = kinshasaToday();
    const start = addDays(today, -21);

    it('crée une règle hebdomadaire ; les occurrences passées sont « à confirmer »', async () => {
      const r = await post(as('owner'), '/treasury/recurring-expenses', {
        label: 'Gardiennage',
        amount: '25.00',
        currency: 'USD',
        category: 'services_exterieurs',
        accountId: banque,
        frequency: 'weekly',
        startDate: start,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      ruleId = r.body.id;
      expect(r.body.nextOccurrence).toBe(addDays(today, 7));
      const due = await get(as('viewer'), '/treasury/recurring-expenses/due');
      expect(
        (due.body.items as { recurringExpenseId: string; occurrenceDate: string }[])
          .filter((d) => d.recurringExpenseId === ruleId)
          .map((d) => d.occurrenceDate),
      ).toEqual([start, addDays(start, 7), addDays(start, 14), today]);
    });

    it('confirmation idempotente ; date non échéance et échéance future refusées', async () => {
      const occurrence = addDays(start, 7);
      const first = await post(
        as('accountant'),
        `/treasury/recurring-expenses/${ruleId}/occurrences/${occurrence}/confirm`,
        { amount: '27.50' },
      );
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.alreadyConfirmed).toBe(false);
      expect(first.body.expense.amount).toBe('27.50');
      expect(first.body.expense.occurrenceDate).toBe(occurrence);

      const again = await post(
        as('owner'),
        `/treasury/recurring-expenses/${ruleId}/occurrences/${occurrence}/confirm`,
      );
      expect(again.status).toBe(200);
      expect(again.body.alreadyConfirmed).toBe(true);
      expect(again.body.expense.id).toBe(first.body.expense.id);
      const count = await db
        .collection('treasury_expenses')
        .countDocuments({ recurringExpenseId: ruleId, occurrenceDate: occurrence });
      expect(count).toBe(1);

      const pasUneEcheance = await post(
        as('owner'),
        `/treasury/recurring-expenses/${ruleId}/occurrences/${addDays(start, 1)}/confirm`,
      );
      expect(pasUneEcheance.status).toBe(400);
      expect(pasUneEcheance.body.code).toBe('NOT_AN_OCCURRENCE');

      const future = await post(
        as('owner'),
        `/treasury/recurring-expenses/${ruleId}/occurrences/${addDays(today, 7)}/confirm`,
      );
      expect(future.status).toBe(400);
      expect(future.body.code).toBe('OCCURRENCE_IN_FUTURE');

      const due = await get(as('owner'), '/treasury/recurring-expenses/due');
      expect(
        (due.body.items as { recurringExpenseId: string; occurrenceDate: string }[]).some(
          (d) => d.recurringExpenseId === ruleId && d.occurrenceDate === occurrence,
        ),
      ).toBe(false);
    });
  });

  // ─── 4. Report vers le réalisé ────────────────────────────────────────────

  describe('report des dépenses vers le réalisé (actual_periods)', () => {
    const periodOf = async (month: number) => {
      const res = await get(as('owner'), `/projects/${projectId}/actual-periods?year=1`);
      return (
        res.body.periods as {
          month: number;
          status: string;
          values: Record<string, number>;
          sources: Record<string, { source: string }>;
        }[]
      ).find((p) => p.month === month);
    };

    it('sans configuration : synchronisation et rapprochement répondent 409 BRIDGE_NOT_CONFIGURED', async () => {
      const sync = await post(as('owner'), '/treasury/actuals-bridge/sync', {});
      expect(sync.status).toBe(409);
      expect(sync.body.code).toBe('BRIDGE_NOT_CONFIGURED');
      const rec = await get(as('owner'), '/treasury/reconciliation?year=1');
      expect(rec.status).toBe(409);
      expect(rec.body.code).toBe('BRIDGE_NOT_CONFIGURED');
      const bridge = await get(as('viewer'), '/treasury/actuals-bridge');
      expect(bridge.body.status).toBe('not_configured');
    });

    it('configuration contrôlée : charge du plan seulement, catégorie d’exploitation, plan validé', async () => {
      const created = await post(as('owner'), '/projects', {
        name: `Trésorerie ${tag}`,
        templateSlug: 'hello-world',
        deviseAffichage: 'USD',
        driverValues: { prix_unitaire: 10, quantite_mois: 100 },
      });
      expect(created.status).toBe(201);
      projectId = created.body.id;

      const sansPlan = await put(as('owner'), '/treasury/actuals-bridge', {
        enabled: true,
        projectId,
        firstMonth: '2026-01',
        mapping: { loyer: 'cout_variable' },
      });
      expect(sansPlan.status).toBe(409);
      expect(sansPlan.body.code).toBe('NO_APPROVED_PLAN');

      const plan = await post(as('owner'), `/projects/${projectId}/plans`, {});
      expect(plan.status).toBe(201);

      const produit = await put(as('owner'), '/treasury/actuals-bridge', {
        enabled: true,
        projectId,
        firstMonth: '2026-01',
        mapping: { loyer: 'ca' },
      });
      expect(produit.status).toBe(400);
      expect(produit.body.code).toBe('LINE_NOT_A_CHARGE');

      const inconnue = await put(as('owner'), '/treasury/actuals-bridge', {
        enabled: true,
        projectId,
        firstMonth: '2026-01',
        mapping: { loyer: 'ligne_fantome' },
      });
      expect(inconnue.status).toBe(400);
      expect(inconnue.body.code).toBe('UNKNOWN_LINE');

      const invest = await put(as('owner'), '/treasury/actuals-bridge', {
        enabled: true,
        projectId,
        firstMonth: '2026-01',
        mapping: { investissement: 'cout_variable' },
      });
      expect(invest.status).toBe(400);
      expect(invest.body.code).toBe('CATEGORY_NOT_OPERATING');

      // L'Analyste lit la trésorerie mais n'importe pas le réalisé.
      const analyste = await put(as('analyst'), '/treasury/actuals-bridge', {
        enabled: true,
        projectId,
        firstMonth: '2026-01',
        mapping: { loyer: 'cout_variable' },
      });
      expect(analyste.status).toBe(403);
      expect(analyste.body.action).toBe('actuals.import');

      const ok = await put(as('accountant'), '/treasury/actuals-bridge', {
        enabled: true,
        projectId,
        firstMonth: '2026-01',
        mapping: { loyer: 'cout_variable', achats: 'cout_variable' },
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.status).toBe('enabled');
      expect(ok.body.mappableLines.map((l: { lineId: string }) => l.lineId)).toEqual([
        'cout_variable',
      ]);
    });

    it('dryRun n’écrit rien ; la synchronisation écrit, étiquette, puis ne change plus rien', async () => {
      // Mars : loyer 120.50 USD (rattaché) ; achats 70 000 CDF dans la MÊME case → non convertible.
      // Avril : un loyer USD seul.
      await expense({ spentOn: '2026-04-03', amount: '300.00', category: 'loyer' });
      const dry = await post(as('owner'), '/treasury/actuals-bridge/sync', { dryRun: true });
      expect(dry.status, JSON.stringify(dry.body)).toBe(200);
      expect(dry.body.dryRun).toBe(true);
      expect(dry.body.counts.written).toBe(1);
      expect(await periodOf(4)).toBeUndefined();
      expect(
        (dry.body.skipped as { calendarMonth: string; reason: string }[]).map((s) => [
          s.calendarMonth,
          s.reason,
        ]),
      ).toContainEqual(['2026-03', 'CURRENCY_NOT_CONVERTIBLE']);
      expect((dry.body.unmapped as { category: string }[]).map((u) => u.category)).toContain(
        'services_exterieurs',
      );

      const sync = await post(as('owner'), '/treasury/actuals-bridge/sync', {});
      expect(sync.status).toBe(200);
      expect(sync.body.counts.written).toBe(1);
      const avril = await periodOf(4);
      expect(avril?.values['cout_variable']).toBe(300);
      expect(avril?.sources['cout_variable']?.source).toBe('run.expenses');
      // Mars n'est pas reporté : un chiffre partiel serait fabriqué.
      expect((await periodOf(3))?.values['cout_variable']).toBeUndefined();

      const again = await post(as('owner'), '/treasury/actuals-bridge/sync', {});
      expect(again.body.counts.written).toBe(0);
      expect(again.body.counts.unchanged).toBe(1);
      const doc = await db.collection('actual_periods').findOne({ projectId, year: 1, month: 4 });
      expect(doc?.['sources']?.['cout_variable']?.['fingerprint']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verrou : la ligne alimentée ne se saisit pas à la main ; une autre ligne, oui (étiquetée manual)', async () => {
      const bloque = await put(as('owner'), `/projects/${projectId}/actual-periods/1/4`, {
        values: { cout_variable: 1 },
      });
      expect(bloque.status).toBe(409);
      expect(bloque.body.code).toBe('LINE_FED_BY_RUN');
      const efface = await put(as('owner'), `/projects/${projectId}/actual-periods/1/4`, {
        values: { cout_variable: null },
      });
      expect(efface.status).toBe(409);
      const ca = await put(as('owner'), `/projects/${projectId}/actual-periods/1/4`, {
        values: { ca: 950 },
      });
      expect(ca.status).toBe(200);
      expect(ca.body.sources.ca.source).toBe('manual');
      expect(ca.body.values.cout_variable).toBe(300);
    });

    it('période clôturée jamais modifiée ; saisie manuelle jamais écrasée ; retrait d’une valeur devenue sans objet', async () => {
      // Mai : une saisie manuelle préexistante sur la ligne, AVANT toute dépense.
      await put(as('owner'), '/treasury/actuals-bridge', {
        enabled: false,
        projectId,
        firstMonth: '2026-01',
        mapping: { loyer: 'cout_variable', achats: 'cout_variable' },
      });
      const manuel = await put(as('owner'), `/projects/${projectId}/actual-periods/1/5`, {
        values: { cout_variable: 42 },
      });
      expect(manuel.status).toBe(200);
      const reactive = await put(as('owner'), '/treasury/actuals-bridge', {
        enabled: true,
        projectId,
        firstMonth: '2026-01',
        mapping: { loyer: 'cout_variable', achats: 'cout_variable' },
      });
      expect(reactive.status).toBe(200);
      await expense({ spentOn: '2026-05-04', amount: '310.00', category: 'loyer' });

      // Avril clôturé, puis une nouvelle dépense d'avril.
      const close = await post(as('owner'), `/projects/${projectId}/actual-periods/1/4/close`);
      expect(close.status).toBe(201);
      const juin = await expense({ spentOn: '2026-06-02', amount: '5.00', category: 'achats' });
      await expense({ spentOn: '2026-04-20', amount: '20.00', category: 'achats' });

      const sync = await post(as('owner'), '/treasury/actuals-bridge/sync', {});
      const statut = (month: number) =>
        (sync.body.results as { month: number; status: string }[]).find((r) => r.month === month)
          ?.status;
      expect(statut(4)).toBe('PERIOD_CLOSED');
      expect(statut(5)).toBe('MANUAL_VALUE_PRESENT');
      expect(statut(6)).toBe('written');
      expect((await periodOf(4))?.values['cout_variable']).toBe(300);
      expect((await periodOf(5))?.values['cout_variable']).toBe(42);
      expect((await periodOf(6))?.values['cout_variable']).toBe(5);

      // La dépense de juin est annulée : sa valeur est retirée de la période ouverte.
      await post(as('owner'), `/treasury/expenses/${juin.id}/cancel`, { reason: 'Erreur' });
      const retrait = await post(as('owner'), '/treasury/actuals-bridge/sync', {});
      expect(
        (retrait.body.results as { month: number; status: string }[]).find((r) => r.month === 6)
          ?.status,
      ).toBe('removed');
      expect((await periodOf(6))?.values['cout_variable']).toBeUndefined();
    });

    it('rapprochement : prévu, réalisé, écart et constats ; Conseiller refusé', async () => {
      const rec = await get(as('analyst'), '/treasury/reconciliation?year=1');
      expect(rec.status, JSON.stringify(rec.body)).toBe(200);
      expect(rec.body.calendarMonths[0]).toBe('2026-01');
      const line = (
        rec.body.lines as {
          lineId: string;
          months: {
            month: number;
            prevu: string | null;
            realise: string | null;
            ecart: string | null;
            statut: string | null;
            findings: string[];
          }[];
          total: { monthsCounted: number[] };
        }[]
      ).find((l) => l.lineId === 'cout_variable')!;
      // hello-world : cout_variable = 40 % de 1 000 = 400 par mois.
      expect(line.months[3]).toMatchObject({
        prevu: '400.00',
        realise: '320.00',
        ecart: '-80.00',
        statut: 'favorable',
      });
      expect(line.months[3]!.findings).toEqual(
        expect.arrayContaining(['PERIOD_CLOSED', 'NOT_SYNCED']),
      );
      expect(line.months[2]!.findings).toContain('CURRENCY_NOT_CONVERTIBLE');
      expect(line.months[4]!.findings).toContain('MANUAL_VALUE_PRESENT');
      expect(line.total.monthsCounted).toEqual([4, 5]);

      const conseiller = await get(as('advisor'), '/treasury/reconciliation?year=1');
      expect(conseiller.status).toBe(403);
      expect(conseiller.body.action).toBe('treasury.read');
    });

    it('désactivé : la ligne redevient saisissable, la synchronisation est refusée', async () => {
      const off = await put(as('owner'), '/treasury/actuals-bridge', {
        enabled: false,
        projectId,
        firstMonth: '2026-01',
        mapping: { loyer: 'cout_variable', achats: 'cout_variable' },
      });
      expect(off.body.status).toBe('disabled');
      const sync = await post(as('owner'), '/treasury/actuals-bridge/sync', {});
      expect(sync.status).toBe(409);
      expect(sync.body.code).toBe('BRIDGE_DISABLED');
      const manuel = await put(as('owner'), `/projects/${projectId}/actual-periods/1/7`, {
        values: { cout_variable: 10 },
      });
      expect(manuel.status).toBe(200);
      // Le plan validé n'a jamais été écrit.
      const plans = await db.collection('financial_plans').countDocuments({ projectId });
      expect(plans).toBe(1);
      await put(as('owner'), '/treasury/actuals-bridge', {
        enabled: true,
        projectId,
        firstMonth: '2026-01',
        mapping: { loyer: 'cout_variable', achats: 'cout_variable' },
      });
    });
  });

  // ─── 5. Prévision ─────────────────────────────────────────────────────────

  describe('prévision de trésorerie', () => {
    it('trois scénarios, horizons 7/30/90/180, ouverture = soldes USD, constats explicites', async () => {
      const comptes = await get(as('owner'), '/treasury/accounts');
      const res = await get(as('viewer'), '/treasury/forecast?currency=USD');
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(res.body.openingBalance).toBe(comptes.body.totalsByCurrency.USD);
      expect(res.body.planUsed).toBe(true);
      expect((res.body.scenarios as { id: string }[]).map((s) => s.id)).toEqual([
        'optimistic',
        'probable',
        'pessimistic',
      ]);
      for (const s of res.body.scenarios as {
        series: unknown[];
        horizons: { days: number }[];
        hypotheses: Record<string, number>;
      }[]) {
        expect(s.series).toHaveLength(181);
        expect(s.horizons.map((h) => h.days)).toEqual([7, 30, 90, 180]);
        expect(Object.keys(s.hypotheses).sort()).toEqual([
          'noDueDateDays',
          'planChargesRate',
          'planRevenueRate',
          'receivableCollectionRate',
          'receivableDelayDays',
          'recurringFactor',
        ]);
      }
      const codes = (res.body.uncertainty.findings as { code: string }[]).map((f) => f.code);
      expect(codes).toContain('RECEIPTS_NOT_INTEGRATED');
      expect(codes).toContain('ACCOUNTS_OTHER_CURRENCY');
      expect(codes).toContain('OVERDUE_RECURRING');

      const cdf = await get(as('owner'), '/treasury/forecast?currency=CDF');
      expect(cdf.body.planUsed).toBe(false);
      expect((cdf.body.uncertainty.findings as { code: string }[]).map((f) => f.code)).toContain(
        'PLAN_NOT_USED',
      );
      const eur = await get(as('owner'), '/treasury/forecast?currency=EUR');
      expect(eur.status).toBe(400);
    });

    it('réglages : hypothèses validées, minimum de trésorerie → alerte de tension, révision attendue', async () => {
      const lu = await get(as('viewer'), '/treasury/settings');
      expect(lu.body.defaultScenarios).toBe(true);
      const invalide = await put(as('owner'), '/treasury/settings', {
        expectedRevision: lu.body.revision,
        minimumBalances: { CDF: null, USD: null },
        scenarios: {
          ...lu.body.scenarios,
          probable: { ...lu.body.scenarios.probable, receivableCollectionRate: -1 },
        },
      });
      expect(invalide.status).toBe(400);
      expect(issueCodes(invalide)).toContain('INVALID_HYPOTHESES');

      const ok = await put(as('owner'), '/treasury/settings', {
        expectedRevision: lu.body.revision,
        minimumBalances: { CDF: null, USD: '1000000.00' },
        scenarios: null,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const stale = await put(as('owner'), '/treasury/settings', {
        expectedRevision: lu.body.revision,
        minimumBalances: { CDF: null, USD: null },
        scenarios: null,
      });
      expect(stale.status).toBe(409);

      const f = await get(as('owner'), '/treasury/forecast?currency=USD');
      for (const s of f.body.scenarios as { alerts: { severity: string; dayIndex: number }[] }[]) {
        expect(s.alerts[0]).toMatchObject({ severity: 'tension', dayIndex: 0 });
      }
      const vue = await put(as('viewer'), '/treasury/settings', {
        expectedRevision: ok.body.revision,
        minimumBalances: { CDF: null, USD: null },
        scenarios: null,
      });
      expect(vue.status).toBe(403);
    });
  });

  // ─── 6. Pièce justificative ───────────────────────────────────────────────

  describe('pièce justificative', () => {
    itS3('image assainie (métadonnées retirées), servie inerte ; SVG refusé', async () => {
      const e = await expense({ spentOn: '2026-02-10', amount: '9.00' });
      const hostile = png([chunk('tEXt', Buffer.from('Comment\0<script>alert(1)</script>'))]);
      const up = await request(server())
        .post(`/treasury/expenses/${e.id}/attachment`)
        .set('Cookie', as('owner'))
        .set('Content-Type', 'image/png')
        .send(hostile);
      expect(up.status, JSON.stringify(up.body)).toBe(201);
      expect(up.body.attachment.contentType).toBe('image/png');
      const lu = await request(server())
        .get(`/treasury/expenses/${e.id}/attachment`)
        .set('Cookie', as('viewer'))
        .buffer(true)
        .parse((res, cb) => {
          const parts: Buffer[] = [];
          res.on('data', (d: Buffer) => parts.push(d));
          res.on('end', () => cb(null, Buffer.concat(parts)));
        });
      expect(lu.status).toBe(200);
      expect(lu.headers['content-type']).toBe('image/png');
      expect(lu.headers['x-content-type-options']).toBe('nosniff');
      expect((lu.body as Buffer).includes(Buffer.from('<script>'))).toBe(false);

      const svg = await request(server())
        .post(`/treasury/expenses/${e.id}/attachment`)
        .set('Cookie', as('owner'))
        .set('Content-Type', 'image/png')
        .send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'));
      expect(svg.status).toBe(415);

      const autreOrg = await get(asB(), `/treasury/expenses/${e.id}/attachment`);
      expect(autreOrg.status).toBe(404);
      const retire = await request(server())
        .delete(`/treasury/expenses/${e.id}/attachment`)
        .set('Cookie', as('owner'));
      expect(retire.status).toBe(200);
      expect(retire.body.attachment).toBeNull();
    });
  });

  // ─── 7. Isolation et RBAC ─────────────────────────────────────────────────

  describe('isolation entre organisations et rôles', () => {
    it('une autre organisation ne voit rien et ne touche à rien (404)', async () => {
      const liste = await get(as('owner'), '/treasury/expenses?status=all&limit=200');
      const id = (liste.body.items as { id: string }[])[0]!.id;
      expect((await get(asB(), `/treasury/expenses/${id}`)).status).toBe(404);
      expect((await post(asB(), `/treasury/expenses/${id}/cancel`, { reason: 'x' })).status).toBe(
        404,
      );
      expect((await get(asB(), `/treasury/accounts/${banque}`)).status).toBe(404);
      const virement = await post(asB(), '/treasury/transfers', {
        date: '2026-03-10',
        fromAccountId: banque,
        toAccountId: mobile,
        amountOut: '1.00',
        amountIn: '1.00',
      });
      expect(virement.status).toBe(404);
      const depense = await post(asB(), '/treasury/expenses', {
        spentOn: '2026-03-10',
        amount: '1.00',
        currency: 'USD',
        category: 'loyer',
        label: 'Intrusion',
        accountId: banque,
      });
      expect(depense.status).toBe(404);
      const pont = await put(asB(), '/treasury/actuals-bridge', {
        enabled: true,
        projectId,
        firstMonth: '2026-01',
        mapping: {},
      });
      expect(pont.status).toBe(404);
      const vide = await get(asB(), '/treasury/accounts');
      expect(vide.body.items).toEqual([]);
      expect((await get(asB(), '/treasury/expenses')).body.items).toEqual([]);
      const prevision = await get(asB(), '/treasury/forecast?currency=USD');
      expect(prevision.body.openingBalance).toBe('0.00');
      expect(prevision.body.accountsIncluded).toEqual([]);
    });

    it('rôles : Lecteur et Administrateur lisent sans écrire ; Conseiller ne lit pas', async () => {
      expect((await get(as('viewer'), '/treasury/expenses')).status).toBe(200);
      const lecteur = await post(as('viewer'), '/treasury/expenses', {
        spentOn: '2026-03-10',
        amount: '1.00',
        currency: 'USD',
        category: 'loyer',
        label: 'Lecteur',
      });
      expect(lecteur.status).toBe(403);
      expect(lecteur.body.action).toBe('treasury.manage');
      expect((await get(as('admin'), '/treasury/accounts')).status).toBe(200);
      const admin = await post(as('admin'), '/treasury/accounts', {
        name: 'Admin',
        kind: 'cash',
        currency: 'USD',
        openingBalance: '0',
        openingDate: '2026-01-01',
      });
      expect(admin.status).toBe(403);
      const conseiller = await get(as('advisor'), '/treasury/accounts');
      expect(conseiller.status).toBe(403);
      expect(conseiller.body.action).toBe('treasury.read');
    });

    it('chaque écriture est journalisée', async () => {
      const actions = await db
        .collection('audit_events')
        .distinct('action', { organizationId: orgId, action: { $regex: '^treasury\\.' } });
      expect(actions).toEqual(
        expect.arrayContaining([
          'treasury.account.created',
          'treasury.expense.recorded',
          'treasury.expense.updated',
          'treasury.expense.cancelled',
          'treasury.transfer.recorded',
          'treasury.bridge.updated',
          'treasury.actuals.synced',
          'treasury.settings.updated',
        ]),
      );
    });
  });
});
