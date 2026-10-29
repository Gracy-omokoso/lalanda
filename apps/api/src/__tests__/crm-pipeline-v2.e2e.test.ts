// Pipeline v2 contre la vraie application (ADR-0040 § 2.3, § 2.5, § 2.6, § 3.2 à
// § 3.4, § 6, § 7.1 ; critères 4, 12, 13 et 18). ADR-0040 — C2.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleurs → MongoDB → moteur. Couvre : responsable (défaut, éligibilité,
// filtre « les miennes », orphelines, réassignation en masse), motifs de perte
// paramétrables (obligatoires, retrait refusé s'ils servent), lignes du catalogue
// et montant hors taxes, devis prérempli depuis l'opportunité, prévision pondérée
// par devise, RBAC (le Commercial gère) et isolation entre organisations.
//
// BASE DÉDIÉE, supprimée à la fin. NIF et taux inventés.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_crm_pipeline_v2_${tag}`;

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!crm-pipeline';
const ROLES = ['admin', 'admin2', 'sales_rep', 'viewer'] as const;
type Role = 'owner' | (typeof ROLES)[number];
type Compte = Role | 'ownerB';
const roleOf = (r: (typeof ROLES)[number]) => (r === 'admin2' ? 'admin' : r);

/** Taux FICTIFS (groupe B à 16 %). */
const GROUPES: Record<string, number> = { a: 0, b: 16, c: 5 };

e2eSuite('Pipeline v2 (ADR-0040 C2)', () => {
  let app: INestApplication;
  let db: Db;
  let orgN = '';
  let orgB = '';
  let customer = '';
  let itemHt = '';
  let itemHt2 = '';
  let itemTtc = '';
  let itemUsd = '';
  let itemB = '';
  let prospect = '';
  let prospectB = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;
  const userIds = {} as Record<Compte, string>;

  const server = () => app.getHttpServer();
  const asN = (role: Role = 'owner') => [...cookies[role], `active_org_id=${orgN}`];
  const asB = () => [...cookies['ownerB'], `active_org_id=${orgB}`];
  const get = (c: string[], path: string) => request(server()).get(path).set('Cookie', c);
  const post = (c: string[], path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', c)
      .send(body ?? {});
  const put = (c: string[], path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', c).send(body);
  const clearThrottle = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };
  const ok = (res: request.Response, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const code = (res: request.Response, status: number, expected: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code).toBe(expected);
  };

  async function opp(c: string[], body: Record<string, unknown>) {
    return ok(
      await post(c, '/crm/opportunities', {
        title: `Opportunité ${randomBytes(2).toString('hex')}`,
        currency: 'CDF',
        ...body,
      }),
      201,
    );
  }
  async function move(c: string[], o: Record<string, any>, body: Record<string, unknown>) {
    return post(c, `/crm/opportunities/${o.id}/move`, { expectedRevision: o.revision, ...body });
  }
  async function article(c: string[], body: Record<string, unknown>) {
    return ok(
      await post(c, '/sales/catalog-items', {
        itemType: 'SER',
        taxGroup: 'B',
        outOfScope: false,
        currency: 'CDF',
        unit: 'jour',
        specificTax: null,
        ...body,
      }),
      201,
    ).id as string;
  }

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    for (const c of ['owner', ...ROLES, 'ownerB'] as const) {
      emails[c] = `crm-pipeline-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({
      email: emails[c],
      password: MOT_DE_PASSE,
      name: `Pipeline ${c}`,
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
        .send({ email: emails[r], role: roleOf(r) });
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

    await db.collection('edef_reference_snapshots').insertOne({
      environment: 'test',
      list: 'taxGroups',
      sha256: randomBytes(32).toString('hex'),
      payload: GROUPES,
      fetchedAt: new Date(),
      _schemaVersion: 1,
    });
    customer = ok(
      await post(asN(), '/sales/customers', {
        type: 'PM',
        name: 'Client Pipeline SARL',
        nif: `T${tag.toUpperCase()}01`,
      }),
      201,
    ).id;
    itemHt = await article(asN(), {
      code: 'AUDIT-J',
      name: 'Audit (jour)',
      unitPrice: '150000',
      priceMode: 'ht',
    });
    itemHt2 = await article(asN(), {
      code: 'FORM-J',
      name: 'Formation (jour)',
      unitPrice: '150000',
      priceMode: 'ht',
    });
    itemTtc = await article(asN(), {
      code: 'LIC-TTC',
      name: 'Licence (TTC)',
      unitPrice: '116000',
      priceMode: 'ttc',
    });
    itemUsd = await article(asN(), {
      code: 'CONS-USD',
      name: 'Conseil (USD)',
      unitPrice: '100',
      priceMode: 'ht',
      currency: 'USD',
    });
    itemB = await article(asB(), {
      code: 'B-ITEM',
      name: 'Article de B',
      unitPrice: '1000',
      priceMode: 'ht',
    });
    prospect = ok(await post(asN(), '/crm/accounts', { name: 'Prospect Pipeline' }), 201).account
      .id;
    prospectB = ok(await post(asB(), '/crm/accounts', { name: 'Prospect de B' }), 201).account.id;
  }, 300_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, 60_000);

  // ── Lignes, montant HT, compte et devis prérempli ───────────────────────

  describe('lignes du catalogue et devis prérempli (critère 4)', () => {
    let o: Record<string, any>;

    it('le Commercial crée une opportunité à deux lignes : libellés et prix HT copiés, montant HT calculé', async () => {
      o = await opp(asN('sales_rep'), {
        accountId: prospect,
        amountSource: 'lines',
        amount: '1.00', // ignoré : le montant vient des lignes
        lines: [
          { catalogItemId: itemHt, quantity: '2' },
          { catalogItemId: itemHt2, quantity: '1', discountPercent: '10' },
        ],
      });
      expect(o.accountId).toBe(prospect);
      expect(o.accountName).toBe('Prospect Pipeline');
      expect(o.prospectName).toBe('Prospect Pipeline');
      expect(o.customerId).toBeNull();
      expect(o.ownerId).toBe(userIds['sales_rep']);
      expect(o.orphaned).toBe(false);
      expect(o.amountSource).toBe('lines');
      expect(o.lines).toEqual([
        {
          catalogItemId: itemHt,
          label: 'Audit (jour)',
          quantity: '2',
          unit: 'jour',
          unitPrice: '150000.00',
          discountPercent: null,
        },
        {
          catalogItemId: itemHt2,
          label: 'Formation (jour)',
          quantity: '1',
          unit: 'jour',
          unitPrice: '150000.00',
          discountPercent: '10.00',
        },
      ]);
      // 2 × 150 000 + 1 × 135 000, hors taxes.
      expect(o.amount).toBe('435000.00');
      expect(o.warnings).toEqual([]);
      const doc = await db.collection('crm_opportunities').findOne({ title: o.title });
      expect(doc?.['accountId']).toBe(prospect);
    });

    it('« Créer le devis » : deux lignes à leur prix, totaux de la composition, montant de l’opportunité inchangé', async () => {
      const q = ok(
        await post(asN('sales_rep'), '/sales/quotes/from-opportunity', { opportunityId: o.id }),
        201,
      );
      expect(q.status).toBe('draft');
      expect(q.opportunityId).toBe(o.id);
      expect(q.title).toBe(o.title);
      expect(q.currency).toBe('CDF');
      expect(q.priceMode).toBe('ht');
      expect(q.customer.name).toBe('Prospect Pipeline');
      expect(q.customer.customerId).toBeNull();
      expect(q.lines.map((l: any) => [l.catalogItemId, l.quantity, l.unitPrice])).toEqual([
        [itemHt, '2', '150000.00'],
        [itemHt2, '1', '135000.00'],
      ]);
      // Composition des devis : groupe B à 16 % sur 435 000 HT.
      expect(q.documentAmounts.calculation.ok).toBe(true);
      expect(q.total).toBe('504600.00');
      const after = ok(await get(asN(), `/crm/opportunities/${o.id}`));
      expect(after.amount).toBe('435000.00');
      expect(after.quotes.map((x: any) => x.id)).toContain(q.id);
    });

    it('compte client : le devis vise la fiche client', async () => {
      const acc = await db
        .collection('crm_accounts')
        .findOne({ organizationId: orgN, customerId: customer });
      const c = await opp(asN(), {
        accountId: String(acc!['_id']),
        lines: [{ catalogItemId: itemHt, quantity: '1' }],
      });
      expect(c.customerId).toBe(customer);
      expect(c.prospectName).toBeNull();
      expect(c.amountSource).toBe('manual');
      expect(c.amount).toBeNull();
      const q = ok(
        await post(asN(), '/sales/quotes/from-opportunity', {
          opportunityId: c.id,
          validUntil: '2099-01-31',
        }),
        201,
      );
      expect(q.customerId).toBe(customer);
      expect(q.validUntil).toBe('2099-01-31');
    });

    it('article au prix TTC : prix non recopié, avertissement, compté pour zéro', async () => {
      const t = await opp(asN(), {
        accountId: prospect,
        amountSource: 'lines',
        lines: [
          { catalogItemId: itemTtc, quantity: '1' },
          { label: 'Déplacement', quantity: '1', unitPrice: '20000' },
        ],
      });
      expect(t.lines[0].unitPrice).toBeNull();
      expect(t.warnings).toEqual([{ code: 'CRM_LINE_WITHOUT_PRICE', lineIndex: 0 }]);
      expect(t.amount).toBe('20000.00');
      // Une ligne libre n'a ni groupe ni type DGI : pas de devis prérempli.
      code(
        await post(asN(), '/sales/quotes/from-opportunity', { opportunityId: t.id }),
        409,
        'CRM_LINE_NOT_QUOTABLE',
      );
    });

    it('article d’une autre devise : refusé, jamais converti ; sans ligne : pas de devis', async () => {
      code(
        await post(asN(), '/crm/opportunities', {
          title: 'Devise',
          currency: 'CDF',
          accountId: prospect,
          lines: [{ catalogItemId: itemUsd, quantity: '1' }],
        }),
        400,
        'CRM_LINE_CURRENCY_MISMATCH',
      );
      const vide = await opp(asN(), { accountId: prospect, amount: '1000' });
      expect(vide.lines).toEqual([]);
      code(
        await post(asN(), '/sales/quotes/from-opportunity', { opportunityId: vide.id }),
        409,
        'CRM_OPPORTUNITY_HAS_NO_LINES',
      );
    });

    it('corps stricts : montant en nombre et champ de ligne inconnu refusés', async () => {
      const r = await post(asN(), '/crm/opportunities', {
        title: 'Strict',
        currency: 'CDF',
        accountId: prospect,
        lines: [{ catalogItemId: itemHt, quantity: 2, inconnu: true }],
      });
      expect(r.status).toBe(400);
      const codes = (r.body.details.issues as { code: string }[]).map((i) => i.code);
      expect(codes).toContain('DECIMAL_MUST_BE_STRING');
    });

    it('compatibilité N-1 : un prospect nommé sans `accountId` est rattaché à un compte', async () => {
      const legacy = await opp(asN(), { prospectName: 'Prospect Pipeline', amount: '500' });
      expect(legacy.accountId).toBe(prospect);
    });
  });

  // ── Motifs de perte (critère 12) ───────────────────────────────────────

  describe('motifs de perte', () => {
    it('six motifs par défaut, motif obligatoire, prévision historique seulement', async () => {
      const s = ok(await get(asN('viewer'), '/crm/settings'));
      expect(s.lostReasons.map((r: any) => r.key)).toEqual([
        'price',
        'competitor',
        'no_budget',
        'no_response',
        'need_dropped',
        'other',
      ]);
      expect(s.lostReasonRequired).toBe(true);
      expect(s.forecastProbability).toBe('historical');
    });

    it('perdu sans motif : 400 CRM_LOST_REASON_REQUIRED ; motif inconnu refusé ; motif et détail enregistrés', async () => {
      const o = await opp(asN('sales_rep'), { accountId: prospect, amount: '1000' });
      code(await move(asN('sales_rep'), o, { stageKey: 'lost' }), 400, 'CRM_LOST_REASON_REQUIRED');
      code(
        await move(asN('sales_rep'), o, { stageKey: 'lost', lostReasonKey: 'inconnu' }),
        400,
        'CRM_LOST_REASON_UNKNOWN',
      );
      const lost = ok(
        await move(asN('sales_rep'), o, {
          stageKey: 'lost',
          lostReasonKey: 'price',
          lostReasonDetail: 'Trop cher de 20 %',
        }),
      );
      expect(lost.status).toBe('lost');
      expect(lost.lostReasonKey).toBe('price');
      expect(lost.lostReason).toBe('Trop cher de 20 %');
      // Rouvrir efface le motif.
      const reopened = ok(await move(asN('sales_rep'), lost, { stageKey: 'qualified' }));
      expect(reopened.lostReasonKey).toBeNull();
      expect(reopened.lostReason).toBeNull();
      ok(await move(asN('sales_rep'), reopened, { stageKey: 'lost', lostReasonKey: 'price' }));
    });

    it('retirer un motif utilisé : 409 CRM_LOST_REASON_IN_USE ; le désactiver est permis', async () => {
      const s = ok(await get(asN(), '/crm/settings'));
      const base = {
        expectedRevision: s.revision,
        stages: s.stages,
        autoWinOnQuoteAccepted: s.autoWinOnQuoteAccepted,
        staleAfterDays: s.staleAfterDays,
      };
      code(
        await put(asN(), '/crm/settings', {
          ...base,
          lostReasons: s.lostReasons.filter((r: any) => r.key !== 'price'),
        }),
        409,
        'CRM_LOST_REASON_IN_USE',
      );
      // Clé en double : refusée.
      expect(
        (
          await put(asN(), '/crm/settings', {
            ...base,
            lostReasons: [...s.lostReasons, { key: 'price', label: 'Doublon' }],
          })
        ).status,
      ).toBe(400);
      const updated = ok(
        await put(asN('sales_rep'), '/crm/settings', {
          ...base,
          lostReasons: [
            ...s.lostReasons
              .filter((r: any) => r.key !== 'other')
              .map((r: any) => (r.key === 'price' ? { ...r, active: false } : r)),
            { key: 'timing', label: 'Calendrier', active: true },
          ],
        }),
      );
      expect(updated.lostReasons.find((r: any) => r.key === 'price').active).toBe(false);
      expect(updated.lostReasons.map((r: any) => r.key)).toContain('timing');
      const o = await opp(asN(), { accountId: prospect, amount: '1000' });
      code(
        await move(asN(), o, { stageKey: 'lost', lostReasonKey: 'price' }),
        400,
        'CRM_LOST_REASON_UNKNOWN',
      );
      ok(await move(asN(), o, { stageKey: 'lost', lostReasonKey: 'timing' }));

      // Motif facultatif : un corps d'ADR-0035 (sans motifs) garde les motifs.
      const s2 = ok(await get(asN(), '/crm/settings'));
      const off = ok(
        await put(asN(), '/crm/settings', {
          expectedRevision: s2.revision,
          stages: s2.stages,
          autoWinOnQuoteAccepted: s2.autoWinOnQuoteAccepted,
          staleAfterDays: s2.staleAfterDays,
          lostReasonRequired: false,
        }),
      );
      expect(off.lostReasons).toEqual(s2.lostReasons);
      const sans = await opp(asN(), { accountId: prospect, amount: '1000' });
      const l = ok(await move(asN(), sans, { stageKey: 'lost', lostReason: 'Ancien champ' }));
      expect(l.lostReasonKey).toBeNull();
      expect(l.lostReason).toBe('Ancien champ');
      ok(
        await put(asN(), '/crm/settings', {
          expectedRevision: off.revision,
          stages: off.stages,
          autoWinOnQuoteAccepted: off.autoWinOnQuoteAccepted,
          staleAfterDays: off.staleAfterDays,
          lostReasonRequired: true,
        }),
      );
    });

    it('le Lecteur ne modifie pas les réglages', async () => {
      const s = ok(await get(asN('viewer'), '/crm/settings'));
      code(
        await put(asN('viewer'), '/crm/settings', {
          expectedRevision: s.revision,
          stages: s.stages,
          autoWinOnQuoteAccepted: s.autoWinOnQuoteAccepted,
          staleAfterDays: s.staleAfterDays,
        }),
        403,
        'FORBIDDEN',
      );
    });
  });

  // ── Responsable et réassignation ───────────────────────────────────────

  describe('responsable', () => {
    it('responsable éligible seulement ; changement possible par PUT', async () => {
      code(
        await post(asN(), '/crm/opportunities', {
          title: 'Lecteur responsable',
          currency: 'CDF',
          accountId: prospect,
          ownerId: userIds['viewer'],
        }),
        400,
        'CRM_OWNER_NOT_ELIGIBLE',
      );
      const o = await opp(asN(), { accountId: prospect, ownerId: userIds['admin'] });
      expect(o.ownerId).toBe(userIds['admin']);
      const p = ok(
        await put(asN('sales_rep'), `/crm/opportunities/${o.id}`, {
          expectedRevision: o.revision,
          title: o.title,
          currency: 'CDF',
          accountId: prospect,
          ownerId: userIds['sales_rep'],
        }),
      );
      expect(p.ownerId).toBe(userIds['sales_rep']);
      // PUT sans `ownerId` ni lignes : inchangés.
      const q = ok(
        await put(asN(), `/crm/opportunities/${o.id}`, {
          expectedRevision: p.revision,
          title: 'Renommée',
          currency: 'CDF',
          accountId: prospect,
        }),
      );
      expect(q.ownerId).toBe(userIds['sales_rep']);
      const audit = await db
        .collection('audit_events')
        .findOne({ action: 'crm_opportunity.owner_changed', targetId: o.id });
      expect(audit).not.toBeNull();
    });

    it('filtre « les miennes » (confort) : tout `crm.read` voit tout le pipeline', async () => {
      const mine = ok(await get(asN('sales_rep'), '/crm/opportunities?ownerId=me&limit=100'));
      expect(mine.items.length).toBeGreaterThan(0);
      expect(mine.items.every((i: any) => i.ownerId === userIds['sales_rep'])).toBe(true);
      const all = ok(await get(asN('viewer'), '/crm/opportunities?limit=100'));
      expect(all.items.length).toBeGreaterThan(mine.items.length);
      const byAccount = ok(
        await get(asN('viewer'), `/crm/opportunities?accountId=${prospect}&limit=100`),
      );
      expect(byAccount.items.every((i: any) => i.accountId === prospect)).toBe(true);
      const pipe = ok(await get(asN('viewer'), `/crm/pipeline?ownerId=${userIds['sales_rep']}`));
      expect(pipe.ownerId).toBe(userIds['sales_rep']);
      const cards = pipe.stages.flatMap((s: any) => s.opportunities);
      expect(cards.every((c: any) => c.ownerId === userIds['sales_rep'])).toBe(true);
      expect((await get(asN(), '/crm/pipeline?ownerId=nimporte')).status).toBe(400);
    });

    it('départ d’un membre : opportunités orphelines, réassignées en masse et journalisées', async () => {
      const a = await opp(asN(), { accountId: prospect, ownerId: userIds['admin2'] });
      const b = await opp(asN(), { accountId: prospect, ownerId: userIds['admin2'] });
      const closed = await opp(asN(), { accountId: prospect, ownerId: userIds['admin2'] });
      ok(await move(asN(), closed, { stageKey: 'lost', lostReasonKey: 'no_budget' }));
      await db
        .collection('memberships')
        .deleteOne({ organizationId: orgN, userId: userIds['admin2'] });

      const pipe = ok(await get(asN(), '/crm/pipeline'));
      expect(pipe.orphaned.count).toBeGreaterThanOrEqual(2);
      expect(pipe.orphaned.ownerIds).toContain(userIds['admin2']);
      expect(ok(await get(asN(), `/crm/opportunities/${a.id}`)).orphaned).toBe(true);

      // Vers un non-éligible ou un membre d'une autre organisation : refusé.
      code(
        await post(asN(), '/crm/opportunities/reassign', {
          fromOwnerId: userIds['admin2'],
          toOwnerId: userIds['viewer'],
        }),
        400,
        'CRM_OWNER_NOT_ELIGIBLE',
      );
      code(
        await post(asN(), '/crm/opportunities/reassign', {
          fromOwnerId: userIds['admin2'],
          toOwnerId: userIds['ownerB'],
        }),
        404,
        'CRM_MEMBER_NOT_FOUND',
      );
      code(
        await post(asN('viewer'), '/crm/opportunities/reassign', {
          fromOwnerId: userIds['admin2'],
          toOwnerId: userIds['sales_rep'],
        }),
        403,
        'FORBIDDEN',
      );
      const r = ok(
        await post(asN('sales_rep'), '/crm/opportunities/reassign', {
          fromOwnerId: userIds['admin2'],
          toOwnerId: userIds['sales_rep'],
        }),
      );
      expect(r).toEqual({ reassigned: 2 });
      for (const o of [a, b]) {
        const v = ok(await get(asN(), `/crm/opportunities/${o.id}`));
        expect(v.ownerId).toBe(userIds['sales_rep']);
        expect(v.orphaned).toBe(false);
        expect(v.revision).toBe(o.revision + 1);
      }
      // La perdue (onlyOpen par défaut) garde son responsable.
      expect(ok(await get(asN(), `/crm/opportunities/${closed.id}`)).ownerId).toBe(
        userIds['admin2'],
      );
      expect(
        await db
          .collection('audit_events')
          .findOne({ action: 'crm_opportunity.reassigned', organizationId: orgN }),
      ).not.toBeNull();
    });
  });

  // ── Prévision (critère 13) ─────────────────────────────────────────────

  describe('prévision pondérée (organisation B, isolée)', () => {
    it('par devise, étape indisponible à part, fraction exacte ; aucun réalisé écrit', async () => {
      const actualsBefore = await db.collection('actual_periods').countDocuments({});
      // Historique : 10 opportunités passées par « lead », 4 gagnées, 6 perdues.
      for (let i = 0; i < 10; i += 1) {
        const o = await opp(asB(), { accountId: prospectB, amount: '100' });
        ok(
          await move(
            asB(),
            o,
            i < 4 ? { stageKey: 'won' } : { stageKey: 'lost', lostReasonKey: 'competitor' },
          ),
        );
      }
      await opp(asB(), { accountId: prospectB, amount: '1000', currency: 'USD' });
      await opp(asB(), { accountId: prospectB, amount: '500', currency: 'USD' });
      // « qualified » : aucun historique → non pondérable.
      await opp(asB(), {
        accountId: prospectB,
        amount: '700',
        currency: 'USD',
        stageKey: 'qualified',
      });
      await opp(asB(), { accountId: prospectB, amount: '2000' });
      await opp(asB(), { accountId: prospectB });

      const pipe = ok(await get(asB(), '/crm/pipeline'));
      expect(pipe.calculationVersion).toBe('1.1.0');
      expect(pipe.stages.find((s: any) => s.key === 'lead').winRate).toMatchObject({
        status: 'available',
        sample: 10,
        won: 4,
      });
      expect(pipe.forecast).toEqual({
        version: '1.1.0',
        basis: 'estimated',
        probabilitySource: 'historical',
        currencies: [
          {
            currency: 'CDF',
            weighted: '800.00',
            unweighted: '2000.00',
            count: 2,
            notWeightable: { total: '0.00', count: 1 },
          },
          {
            currency: 'USD',
            weighted: '600.00',
            unweighted: '2200.00',
            count: 3,
            notWeightable: { total: '700.00', count: 1 },
          },
        ],
      });
      expect(await db.collection('actual_periods').countDocuments({})).toBe(actualsBefore);
    });
  });

  // ── Opportunité gagnée ─────────────────────────────────────────────────

  it('gagner pose `wonAt` ; rouvrir l’efface', async () => {
    const o = await opp(asN('sales_rep'), { accountId: prospect, amount: '900' });
    const won = ok(await move(asN('sales_rep'), o, { stageKey: 'won' }));
    expect(won.wonAt).not.toBeNull();
    const back = ok(await move(asN('sales_rep'), won, { stageKey: 'negotiation' }));
    expect(back.wonAt).toBeNull();
  });

  // ── RBAC et isolation (critère 18) ─────────────────────────────────────

  describe('RBAC et isolation', () => {
    it('le Lecteur lit mais n’écrit pas et ne prépare pas de devis', async () => {
      ok(await get(asN('viewer'), '/crm/pipeline'));
      code(
        await post(asN('viewer'), '/crm/opportunities', {
          title: 'Non',
          currency: 'CDF',
          accountId: prospect,
        }),
        403,
        'FORBIDDEN',
      );
      const o = await opp(asN(), {
        accountId: prospect,
        lines: [{ catalogItemId: itemHt, quantity: '1' }],
      });
      code(
        await post(asN('viewer'), '/sales/quotes/from-opportunity', { opportunityId: o.id }),
        403,
        'FORBIDDEN',
      );
    });

    it('identifiants d’une autre organisation : 404, y compris forgés dans un corps', async () => {
      const o = await opp(asN(), {
        accountId: prospect,
        lines: [{ catalogItemId: itemHt, quantity: '1' }],
      });
      code(await get(asB(), `/crm/opportunities/${o.id}`), 404, 'CRM_OPPORTUNITY_NOT_FOUND');
      code(
        await post(asB(), '/sales/quotes/from-opportunity', { opportunityId: o.id }),
        404,
        'CRM_OPPORTUNITY_NOT_FOUND',
      );
      code(
        await post(asN(), '/crm/opportunities', {
          title: 'Compte forgé',
          currency: 'CDF',
          accountId: prospectB,
        }),
        404,
        'CRM_ACCOUNT_NOT_FOUND',
      );
      code(
        await post(asN(), '/crm/opportunities', {
          title: 'Article forgé',
          currency: 'CDF',
          accountId: prospect,
          lines: [{ catalogItemId: itemB, quantity: '1' }],
        }),
        404,
        'CATALOG_ITEM_NOT_FOUND',
      );
      code(
        await post(asN(), '/crm/opportunities', {
          title: 'Responsable forgé',
          currency: 'CDF',
          accountId: prospect,
          ownerId: userIds['ownerB'],
        }),
        404,
        'CRM_MEMBER_NOT_FOUND',
      );
      code(
        await put(asB(), `/crm/opportunities/${o.id}`, {
          expectedRevision: o.revision,
          title: 'x',
          currency: 'CDF',
          accountId: prospectB,
        }),
        404,
        'CRM_OPPORTUNITY_NOT_FOUND',
      );
      // La réassignation de B ne touche pas les opportunités de N.
      const r = ok(
        await post(asB(), '/crm/opportunities/reassign', {
          fromOwnerId: userIds['sales_rep'],
          toOwnerId: userIds['ownerB'],
          onlyOpen: false,
        }),
      );
      expect(r).toEqual({ reassigned: 0 });
      const listB = ok(await get(asB(), '/crm/opportunities?limit=100'));
      expect(listB.items.some((i: any) => i.id === o.id)).toBe(false);
    });
  });
});
