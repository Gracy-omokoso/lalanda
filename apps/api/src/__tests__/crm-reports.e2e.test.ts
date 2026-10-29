// Rapports du CRM contre la vraie application (ADR-0040 § 3.4, § 7.2 ; critère
// 14). ADR-0040 — C3.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleur → MongoDB → moteur `crmReports`. Les opportunités sont INSÉRÉES en
// base avec des dates fixes (création, clôture, gain) : le jeu est déterministe,
// quel que soit le jour d'exécution. Couvre : seuil d'échantillon (critère 14),
// filtre responsable sur tous les blocs, bornes de période (défaut 12 mois,
// 24 au plus, jours de Kinshasa), prévision par mois de clôture, RBAC, isolation
// entre organisations, aucune écriture dans le réalisé.
//
// BASE DÉDIÉE, supprimée à la fin.

import 'reflect-metadata';

import { crmReportPeriod } from '@lalanda/engine';
import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ObjectId, type Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { kinshasaDay } from '../crm/crm-model.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_crm_reports_${tag}`;

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!crm-reports';
const ROLES = ['sales_rep', 'viewer', 'advisor'] as const;
type Compte = 'owner' | (typeof ROLES)[number] | 'ownerB';

const PERIODE = 'from=2025-01-01&to=2025-06-30';

e2eSuite('Rapports du CRM (ADR-0040 C3)', () => {
  let app: INestApplication;
  let db: Db;
  let orgN = '';
  let orgB = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;
  const userIds = {} as Record<Compte, string>;

  const server = () => app.getHttpServer();
  const as = (c: Compte) => [...cookies[c], `active_org_id=${c === 'ownerB' ? orgB : orgN}`];
  const get = (c: Compte, query = '') =>
    request(server())
      .get(`/crm/reports${query ? `?${query}` : ''}`)
      .set('Cookie', as(c));
  const clearThrottle = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };
  const ok = (res: request.Response) => {
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Record<string, any>;
  };
  const code = (res: request.Response, status: number, expected: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code).toBe(expected);
  };

  /** Instant d'une heure de Kinshasa (UTC+1). */
  const at = (day: string, time = '10:00') => new Date(`${day}T${time}:00+01:00`);

  function doc(
    organizationId: string,
    o: {
      status: 'open' | 'won' | 'lost';
      created: Date;
      closed?: Date;
      ownerId: string;
      amount?: string | null;
      currency?: 'CDF' | 'USD';
      stages: string[];
      expectedCloseDate?: string | null;
      lostReasonKey?: string | null;
    },
  ) {
    const stageKey = o.status === 'open' ? o.stages[o.stages.length - 1]! : o.status;
    return {
      _id: new ObjectId(),
      organizationId,
      title: `Rapport ${randomBytes(3).toString('hex')}`,
      customerId: null,
      prospectName: 'Prospect',
      contactId: null,
      stageKey,
      status: o.status,
      amount: o.amount === undefined ? '100.00' : o.amount,
      currency: o.currency ?? 'USD',
      expectedCloseDate: o.expectedCloseDate ?? null,
      lostReason: null,
      closedAt: o.closed ?? null,
      lastActivityAt: o.closed ?? o.created,
      stageHistory: o.stages.map((s, i) => ({
        stageKey: s,
        at: new Date(o.created.getTime() + i * 1000),
        by: o.ownerId,
        source: 'user',
        quoteId: null,
      })),
      accountId: null,
      ownerId: o.ownerId,
      lines: [],
      amountSource: 'manual',
      lostReasonKey: o.lostReasonKey ?? null,
      wonAt: o.status === 'won' ? (o.closed ?? null) : null,
      searchKey: 'rapport',
      revision: 1,
      createdBy: o.ownerId,
      updatedBy: o.ownerId,
      createdAt: o.created,
      updatedAt: o.closed ?? o.created,
      _schemaVersion: 1,
    };
  }

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    for (const c of ['owner', ...ROLES, 'ownerB'] as const) {
      emails[c] = `crm-reports-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({
      email: emails[c],
      password: MOT_DE_PASSE,
      name: `Rapports ${c}`,
    });
    const orgDe = async (c: Compte) => {
      cookies[c] = await registerAndLogin(app, compte(c));
      const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
      return (orgs.body.organizations as { id: string }[])[0]!.id;
    };
    orgN = await orgDe('owner');
    for (const r of ROLES) {
      const inv = await request(server())
        .post(`/organizations/${orgN}/invitations`)
        .set('Cookie', cookies['owner'])
        .send({ email: emails[r], role: r });
      expect(inv.status, `invitation ${r} ${JSON.stringify(inv.body)}`).toBe(201);
      cookies[r] = await registerAndLogin(app, compte(r));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[r])
        .send({ token: inv.body.token });
      expect(acc.status).toBe(201);
    }
    orgB = await orgDe('ownerB');
    const users = await db.collection('user').find({}).toArray();
    for (const c of Object.keys(emails) as Compte[]) {
      const u = users.find((x) => x['email'] === emails[c].toLowerCase());
      expect(u, `utilisateur ${c}`).toBeDefined();
      userIds[c] = String(u!['_id']);
    }

    const u1 = userIds['owner'];
    const u2 = userIds['sales_rep'];
    const won = (created: Date, closed: Date, ownerId = u1) =>
      doc(orgN, { status: 'won', created, closed, ownerId, stages: ['lead', 'qualified', 'won'] });
    await db.collection('crm_opportunities').insertMany([
      // Six gagnées par U1 en février 2025 : cycles de 2 à 7 jours.
      ...[2, 3, 4, 5, 6, 7].map((d) =>
        won(at('2025-02-01'), at(`2025-02-${String(1 + d).padStart(2, '0')}`)),
      ),
      // Bornes de Kinshasa : gagnée le 30 juin à 23 h 30 (dans la période) et le
      // 1er juillet à 0 h 30 (hors période, bien que le 30 juin en UTC).
      won(at('2025-06-20'), at('2025-06-30', '23:30')),
      won(at('2025-06-25'), at('2025-07-01', '00:30')),
      // Quatre perdues par U2 en mars 2025 (10 jours) : trois « prix », une sans motif.
      ...[0, 1, 2, 3].map((i) =>
        doc(orgN, {
          status: 'lost',
          created: at('2025-03-01'),
          closed: at('2025-03-11'),
          ownerId: u2,
          stages: ['lead', 'lost'],
          lostReasonKey: i < 3 ? 'price' : null,
        }),
      ),
      // Ouvertes : en retard, mois lointain, sans date (CDF).
      doc(orgN, {
        status: 'open',
        created: at('2025-04-01'),
        ownerId: u1,
        amount: '200.00',
        stages: ['lead'],
        expectedCloseDate: '2000-01-01',
      }),
      doc(orgN, {
        status: 'open',
        created: at('2025-04-01'),
        ownerId: u1,
        amount: '1000.00',
        stages: ['lead', 'qualified'],
        expectedCloseDate: '2099-01-15',
      }),
      doc(orgN, {
        status: 'open',
        created: at('2025-04-01'),
        ownerId: u2,
        amount: '500000.00',
        currency: 'CDF',
        stages: ['lead'],
        expectedCloseDate: null,
      }),
      // Hors période (2024) : ni dans l'entonnoir, ni dans les clôturées.
      won(at('2024-03-01'), at('2024-03-05')),
      // Organisation B : vingt gagnées dans la même période, jamais vues par N.
      ...Array.from({ length: 20 }, () =>
        doc(orgB, {
          status: 'won',
          created: at('2025-02-01'),
          closed: at('2025-02-02'),
          ownerId: userIds['ownerB'],
          stages: ['lead', 'won'],
          amount: '999.00',
        }),
      ),
    ]);
  }, 300_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, 60_000);

  describe('blocs du rapport (§ 7.2)', () => {
    it('étiquette estimée, période, entonnoir, conversion, cycle et motifs de perte', async () => {
      const r = ok(await get('owner', PERIODE));
      expect(r.basis).toBe('estimated');
      expect(r.label).toMatch(/^Montants estimés/);
      expect(r.version).toBe('1.1.0');
      expect(r.period).toEqual({ from: '2025-01-01', to: '2025-06-30' });
      expect(r.minSample).toBe(10);
      expect(r.ownerId).toBeNull();
      expect(r.truncated).toBe(false);
      expect(r.stages.map((s: any) => s.key)).toEqual([
        'lead',
        'qualified',
        'proposal',
        'negotiation',
        'won',
        'lost',
      ]);

      // Créées dans la période : 8 gagnées + 4 perdues + 3 ouvertes.
      expect(r.funnel.created).toBe(15);
      expect(r.funnel.stages[0]).toEqual({
        stageKey: 'lead',
        count: 15,
        amounts: [
          { currency: 'CDF', total: '500000.00', count: 1 },
          { currency: 'USD', total: '2400.00', count: 14 },
        ],
      });
      expect(r.funnel.stages.map((s: any) => s.count)).toEqual([15, 9, 0, 0]);
      // lead → plus loin : 8 gagnées + 1 ouverte en « qualifié » sur 15.
      expect(r.conversion.stages[0]).toEqual({
        fromStageKey: 'lead',
        toStageKey: 'qualified',
        rate: { status: 'available', ratePercent: '60', sample: 15, count: 9 },
      });

      // Clôturées dans la période : 7 gagnées (la borne du 1er juillet exclue) + 4 perdues.
      expect(r.conversion.overall).toEqual({
        status: 'available',
        ratePercent: '64',
        sample: 11,
        count: 7,
      });
      expect(r.cycle.won).toEqual({ status: 'unavailable', sample: 7, requiredSample: 10 });
      expect(r.cycle.lost).toEqual({ status: 'unavailable', sample: 4, requiredSample: 10 });

      expect(r.lostReasons).toEqual({
        total: 4,
        reasons: [
          { lostReasonKey: 'price', label: 'Prix', count: 3 },
          { lostReasonKey: null, label: null, count: 1 },
        ],
      });
    });

    it('par responsable : noms joints, ouvertes, gagnées, perdues, prévision', async () => {
      const r = ok(await get('owner', PERIODE));
      const u1 = r.byOwner.find((o: any) => o.ownerId === userIds['owner']);
      const u2 = r.byOwner.find((o: any) => o.ownerId === userIds['sales_rep']);
      expect(r.byOwner).toHaveLength(2);
      expect(u1.ownerName).toBe('Rapports owner');
      expect(u1.isMember).toBe(true);
      expect(u1.won).toEqual({
        count: 7,
        amounts: [{ currency: 'USD', total: '700.00', count: 7 }],
      });
      expect(u1.lost.count).toBe(0);
      expect(u1.open.count).toBe(2);
      expect(u1.winRate).toEqual({
        status: 'unavailable',
        sample: 7,
        count: 7,
        requiredSample: 10,
      });
      expect(u2.ownerName).toBe('Rapports sales_rep');
      expect(u2.lost.count).toBe(4);
      expect(u2.topLostReasons[0]).toEqual({ lostReasonKey: 'price', label: 'Prix', count: 3 });
      expect(u2.forecast).toEqual([
        {
          currency: 'CDF',
          weighted: '346153.85',
          unweighted: '500000.00',
          count: 1,
          notWeightable: { total: '0.00', count: 0 },
        },
      ]);
    });

    it('prévision par mois de clôture prévue : en retard, mois, sans date ; probabilité historique exacte', async () => {
      // Historique de l'organisation : 9 gagnées + 4 perdues passées par « lead »
      // → 9/13 ; « qualifié » : 9 passages < 10 → indisponible.
      const r = ok(await get('owner', PERIODE));
      expect(r.forecastByMonth.probabilitySource).toBe('historical');
      expect(r.forecastByMonth.buckets.map((b: any) => [b.kind, b.month, b.count])).toEqual([
        ['overdue', null, 1],
        ['month', '2099-01', 1],
        ['no_date', null, 1],
      ]);
      const [overdue, month, noDate] = r.forecastByMonth.buckets;
      // 200 × 9/13 = 138,46…
      expect(overdue.currencies[0]).toMatchObject({ currency: 'USD', weighted: '138.46' });
      expect(month.currencies[0]).toMatchObject({
        currency: 'USD',
        weighted: '0.00',
        notWeightable: { total: '1000.00', count: 1 },
      });
      // 500 000 × 9/13 = 346 153,846… : une devise à part, jamais additionnée.
      expect(noDate.currencies).toEqual([
        expect.objectContaining({ currency: 'CDF', weighted: '346153.85' }),
      ]);
    });
  });

  describe('critère 14 : seuil et filtre responsable', () => {
    it('sous dix clôturées, taux et durées indisponibles avec l’échantillon', async () => {
      const r = ok(await get('owner', 'from=2025-03-01&to=2025-06-30'));
      expect(r.conversion.overall).toEqual({
        status: 'unavailable',
        sample: 5,
        count: 1,
        requiredSample: 10,
      });
      expect(r.cycle.won).toMatchObject({ status: 'unavailable', sample: 1 });
      expect(r.cycle.lost).toMatchObject({ status: 'unavailable', sample: 4 });
    });

    it('le filtre ownerId restreint tous les blocs ; « me » désigne l’appelant', async () => {
      const id = ok(await get('owner', `${PERIODE}&ownerId=${userIds['sales_rep']}`));
      const me = ok(await get('sales_rep', `${PERIODE}&ownerId=me`));
      for (const r of [id, me]) {
        expect(r.ownerId).toBe(userIds['sales_rep']);
        expect(r.byOwner.map((o: any) => o.ownerId)).toEqual([userIds['sales_rep']]);
        expect(r.funnel.created).toBe(5);
        expect(r.conversion.overall).toMatchObject({ status: 'unavailable', sample: 4, count: 0 });
        expect(r.lostReasons.total).toBe(4);
        expect(r.forecastByMonth.buckets.map((b: any) => b.kind)).toEqual(['no_date']);
      }
      expect({ ...me, generatedAt: null }).toEqual({ ...id, generatedAt: null });
    });
  });

  describe('période', () => {
    it('défaut : 12 mois glissants jusqu’au jour de Kinshasa', async () => {
      const r = ok(await get('owner'));
      const expected = crmReportPeriod({ today: kinshasaDay(new Date()) });
      expect(expected.ok).toBe(true);
      if (expected.ok) expect(r.period).toEqual({ from: expected.from, to: expected.to });
      // Les opportunités de 2025 sont hors de cette fenêtre ; les ouvertes restent prévues.
      expect(r.forecastByMonth.buckets).toHaveLength(3);
    });

    it('jours de Kinshasa : la gagnée de 23 h 30 le 30 juin compte, pas celle de 0 h 30 le 1er juillet', async () => {
      const juin = ok(await get('owner', 'from=2025-06-30&to=2025-06-30'));
      expect(juin.conversion.overall).toMatchObject({ sample: 1, count: 1 });
      const juillet = ok(await get('owner', 'from=2025-07-01&to=2025-07-01'));
      expect(juillet.conversion.overall).toMatchObject({ sample: 1, count: 1 });
      expect(juillet.funnel.created).toBe(0);
    });

    it('24 mois au plus : exactement 24 acceptés, un jour de plus refusé', async () => {
      ok(await get('owner', 'from=2023-07-01&to=2025-06-30'));
      code(await get('owner', 'from=2023-06-30&to=2025-06-30'), 400, 'CRM_REPORT_PERIOD_TOO_LONG');
    });

    it('début après fin, jour illisible ou paramètre inconnu : 400', async () => {
      code(await get('owner', 'from=2025-07-01&to=2025-06-30'), 400, 'CRM_REPORT_PERIOD_INVALID');
      code(await get('owner', 'from=2025-02-30'), 400, 'CRM_REPORT_PERIOD_INVALID');
      code(await get('owner', 'from=01/01/2025'), 400, 'INVALID_REQUEST');
      code(await get('owner', 'ownerId=nimporte'), 400, 'INVALID_REQUEST');
      code(await get('owner', 'currency=USD'), 400, 'INVALID_REQUEST');
    });
  });

  describe('RBAC et isolation', () => {
    it('crm.read : Commercial et Lecteur lisent ; Conseiller refusé ; sans session 401', async () => {
      ok(await get('sales_rep', PERIODE));
      ok(await get('viewer', PERIODE));
      expect((await get('advisor', PERIODE)).status).toBe(403);
      expect((await request(server()).get('/crm/reports')).status).toBe(401);
    });

    it('chaque organisation ne voit que ses opportunités', async () => {
      const b = ok(await get('ownerB', PERIODE));
      expect(b.funnel.created).toBe(20);
      expect(b.conversion.overall).toEqual({
        status: 'available',
        ratePercent: '100',
        sample: 20,
        count: 20,
      });
      expect(b.byOwner.map((o: any) => o.ownerId)).toEqual([userIds['ownerB']]);
      expect(b.forecastByMonth.buckets).toEqual([]);
      // Un responsable de N demandé depuis B : rien.
      const vide = ok(await get('ownerB', `${PERIODE}&ownerId=${userIds['owner']}`));
      expect(vide.funnel.created).toBe(0);
      expect(vide.byOwner).toEqual([]);
    });

    it('rien n’est écrit : ni réalisé, ni opportunité', async () => {
      const avant = {
        actual: await db.collection('actual_periods').countDocuments({}),
        opps: await db.collection('crm_opportunities').find({}).sort({ _id: 1 }).toArray(),
      };
      ok(await get('owner', PERIODE));
      expect(await db.collection('actual_periods').countDocuments({})).toBe(avant.actual);
      expect(await db.collection('crm_opportunities').find({}).sort({ _id: 1 }).toArray()).toEqual(
        avant.opps,
      );
    });
  });
});
