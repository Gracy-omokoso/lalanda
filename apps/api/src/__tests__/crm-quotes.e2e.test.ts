// CRM minimal et devis contre la vraie application (ADR-0035).
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleurs → MongoDB → moteur. La conversion d'un devis en facture puis la
// NORMALISATION passent par le vrai client e-MCF et le FAUX serveur e-MCF local :
// aucun appel à la DGI réelle. Le rendu Chromium est remplacé par un double
// (`%PDF-FAKE` + HTML imprimé).
//
// BASE DÉDIÉE, supprimée à la fin. NIF et jetons inventés (marqués ANTIFUITE).

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { startFakeEdefServer, type FakeEdefServer } from '../edef/testing/fake-edef-server.js';
import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_crm_devis_${tag}`;
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';
process.env['DGI_ISF_TEST'] = process.env['DGI_ISF_TEST'] || 'ISF-TEST-E2E';
delete process.env['DGI_PRODUCTION_ENABLED'];

vi.setConfig({ testTimeout: 300_000 });

const MOT_DE_PASSE = 'Passw0rd!crm-devis';
const NIF_N = 'A0000000X';
const NIM = 'XX01000001-1';
const JETON = `ANTIFUITE-crm-devis-${tag}-0123456789abcdef`;
const DAY = 86_400_000;

/** Taux FICTIFS, identiques dans l'instantané et dans le faux serveur. */
const GROUPES: Record<string, number> = {
  a: 0,
  b: 16,
  c: 5,
  d: 0,
  e: 0,
  f: 16,
  g: 5,
  h: 0,
  i: 0,
  j: 0,
  k: 0,
  l: 0,
  m: 0,
  n: 0,
  o: 1,
  p: 1,
};

const ROLES = ['admin', 'accountant', 'analyst', 'advisor', 'viewer'] as const;
type Role = 'owner' | (typeof ROLES)[number];
type Compte = Role | 'ownerB';

function binary(req: request.Test): request.Test {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

e2eSuite('CRM minimal et devis (ADR-0035)', () => {
  let app: INestApplication;
  let db: Db;
  let fake: FakeEdefServer;
  let orgN = '';
  let orgB = '';
  let customer = '';
  let item = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;

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
  const del = (c: string[], path: string) => request(server()).delete(path).set('Cookie', c);
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

  /** Ligne libre : 2 h de conseil à 40 000,00 CDF HT, groupe B. */
  const LIGNE_LIBRE = {
    source: 'free',
    code: 'CONSEIL-H',
    name: 'Conseil (heure)',
    itemType: 'SER',
    taxGroup: 'B',
    outOfScope: false,
    unit: 'heure',
    quantity: '2',
    unitPrice: '40000.00',
    specificTax: null,
    discount: null,
  };
  const lignes = () => [
    LIGNE_LIBRE,
    {
      source: 'catalog',
      catalogItemId: item,
      quantity: '3',
      unitPrice: null,
      discount: { kind: 'percent', value: '10' },
    },
  ];
  const corpsDevis = (extra: Record<string, unknown> = {}) => ({
    currency: 'CDF',
    priceMode: 'ht',
    customer: { customerId: customer, printContactDetails: false },
    lines: lignes(),
    title: 'Accompagnement comptable',
    notes: 'Paiement à 30 jours.',
    ...extra,
  });

  async function opportunite(c: string[] = asN(), extra: Record<string, unknown> = {}) {
    return ok(
      await post(c, '/crm/opportunities', {
        title: `Opportunité ${randomBytes(2).toString('hex')}`,
        customerId: customer,
        currency: 'CDF',
        amount: '250000',
        ...extra,
      }),
      201,
    );
  }

  /** Devis envoyé (puis accepté si demandé). */
  async function devis(extra: Record<string, unknown> = {}, until: 'sent' | 'accepted' = 'sent') {
    const d = ok(await post(asN(), '/sales/quotes', corpsDevis(extra)), 201);
    const s = ok(await post(asN(), `/sales/quotes/${d.id}/send`, { expectedRevision: d.revision }));
    if (until === 'sent') return s;
    return ok(await post(asN(), `/sales/quotes/${d.id}/accept`, { expectedRevision: s.revision }));
  }

  async function instantane(list: string, payload: unknown) {
    await db.collection('edef_reference_snapshots').insertOne({
      environment: 'test',
      list,
      sha256: randomBytes(32).toString('hex'),
      payload,
      fetchedAt: new Date(),
      _schemaVersion: 1,
    });
  }

  beforeAll(async () => {
    fake = await startFakeEdefServer({
      tokens: { [JETON]: { nif: NIF_N, nim: NIM, tokenValid: '2099-01-31T00:00:00' } },
      taxGroups: GROUPES,
    });
    process.env['DGI_EDEF_TEST_URL'] = fake.baseUrl;
    process.env['DGI_EDEF_PRODUCTION_URL'] = 'https://edef.invalid';
    app = await makeE2EApp();
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));
    vi.spyOn(app.get(PdfRenderingService), 'render').mockImplementation(async (html, opts) =>
      Buffer.from(
        `%PDF-FAKE\n${html}\n<!--header-->${opts?.headerTemplate ?? ''}\n<!--footer-->${opts?.footerTemplate ?? ''}`,
        'utf8',
      ),
    );

    for (const c of ['owner', ...ROLES, 'ownerB'] as const) {
      emails[c] = `crm-devis-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({ email: emails[c], password: MOT_DE_PASSE, name: `CRM ${c}` });
    const orgDe = async (c: Compte) => {
      cookies[c] = await registerAndLogin(app, compte(c));
      const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
      return (orgs.body.organizations as { id: string }[])[0]!.id;
    };
    orgN = await orgDe('owner');
    for (const role of ROLES) {
      const inv = await request(server())
        .post(`/organizations/${orgN}/invitations`)
        .set('Cookie', cookies['owner'])
        .send({ email: emails[role], role });
      expect(inv.status, `invitation ${role}`).toBe(201);
      cookies[role] = await registerAndLogin(app, compte(role));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: inv.body.token });
      expect(acc.status).toBe(201);
    }
    orgB = await orgDe('ownerB');

    // Organisation N en facture normalisée, environnement de test DGI (faux serveur).
    ok(
      await put(asN(), '/organizations/current/fiscal-profile', {
        legalName: 'Exemple SARL',
        tradeName: null,
        legalForm: 'sarl',
        legalFormOther: null,
        nif: NIF_N,
        rccm: null,
        nationalId: null,
        vatRegistered: true,
        headOffice: {
          line1: '1, avenue Exemple',
          line2: null,
          commune: 'Gombe',
          city: 'Kinshasa',
          province: 'Kinshasa',
        },
        phone: '+243 800 000 000',
        email: 'facturation@exemple.cd',
      }),
    );
    const reauth = async () =>
      ok(await post(cookies['owner'], '/me/reauth', { password: MOT_DE_PASSE }));
    await reauth();
    ok(
      await post(asN(), '/organizations/current/normalized-invoicing/points-of-sale', {
        label: 'Boutique',
        environment: 'test',
        expectedNim: null,
        token: JETON,
      }),
      201,
    );
    await reauth();
    ok(
      await post(asN(), '/organizations/current/normalized-invoicing/activate', {
        environment: 'test',
      }),
    );
    await instantane('taxGroups', GROUPES);
    await instantane('clientTypes', [
      { type: 'PM', description: 'Personne morale (fictif)' },
      { type: 'PP', description: 'Personne physique (fictif)' },
    ]);
    await instantane('referenceTypes', [{ type: 'RRR', description: 'Remise (fictif)' }]);

    customer = ok(
      await post(asN(), '/sales/customers', {
        type: 'PM',
        name: 'Client Exemple SARL',
        nif: `T${tag.toUpperCase()}01`,
      }),
      201,
    ).id;
    item = ok(
      await post(asN(), '/sales/catalog-items', {
        code: 'AUDIT-J',
        name: 'Audit (jour)',
        itemType: 'SER',
        taxGroup: 'B',
        outOfScope: false,
        unitPrice: '150000',
        priceMode: 'ht',
        currency: 'CDF',
        unit: 'jour',
        specificTax: null,
      }),
      201,
    ).id;
  }, 300_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
      await fake?.close();
    }
  }, 60_000);

  // ── Pipeline ─────────────────────────────────────────────────────────────

  describe('pipeline personnalisable', () => {
    it('réglages par défaut, puis étapes renommées et ajoutées ; étape utilisée non retirable', async () => {
      const s = ok(await get(asN(), '/crm/settings'));
      expect(s).toMatchObject({ revision: 0, autoWinOnQuoteAccepted: true, staleAfterDays: 14 });
      expect(s.stages.map((x: { label: string }) => x.label)).toEqual([
        'Lead',
        'Qualifié',
        'Proposition',
        'Négociation',
        'Gagné',
        'Perdu',
      ]);
      const stages = [
        { key: 'lead', label: 'Piste', kind: 'open' },
        { key: 'qualified', label: 'Qualifié', kind: 'open' },
        { key: 'demo', label: 'Démonstration', kind: 'open' },
        { key: 'proposal', label: 'Proposition', kind: 'open' },
        { key: 'negotiation', label: 'Négociation', kind: 'open' },
        { key: 'won', label: 'Gagné', kind: 'won' },
        { key: 'lost', label: 'Perdu', kind: 'lost' },
      ];
      const saved = ok(
        await put(asN(), '/crm/settings', {
          expectedRevision: 0,
          stages,
          autoWinOnQuoteAccepted: true,
          staleAfterDays: 14,
        }),
      );
      expect(saved.revision).toBe(1);
      expect(saved.stages[0].label).toBe('Piste');

      // Deux étapes « gagnées » : refusé avec le code.
      const bad = await put(asN(), '/crm/settings', {
        expectedRevision: 1,
        stages: [...stages, { key: 'won2', label: 'Signé', kind: 'won' }],
        autoWinOnQuoteAccepted: true,
        staleAfterDays: 14,
      });
      expect(bad.status).toBe(400);
      expect(JSON.stringify(bad.body)).toContain('STAGE_WON_REQUIRED');

      // Une opportunité en « démonstration » interdit de retirer l'étape.
      const o = await opportunite(asN(), { stageKey: 'demo' });
      expect(o).toMatchObject({ stageKey: 'demo', stageLabel: 'Démonstration', status: 'open' });
      const retrait = await put(asN(), '/crm/settings', {
        expectedRevision: 1,
        stages: stages.filter((x) => x.key !== 'demo'),
        autoWinOnQuoteAccepted: true,
        staleAfterDays: 14,
      });
      expect(retrait.status).toBe(409);
      expect(retrait.body.code).toBe('CRM_STAGE_IN_USE');
      // Révision périmée.
      const perime = await put(asN(), '/crm/settings', {
        expectedRevision: 0,
        stages,
        autoWinOnQuoteAccepted: true,
        staleAfterDays: 14,
      });
      expect(perime.status).toBe(409);
      expect(perime.body.code).toBe('STALE_REVISION');
    });

    it('prospect et contact, opportunité déplacée d’étape en étape, historique et Kanban', async () => {
      const prospect = ok(
        await post(asN(), '/crm/contacts', {
          name: 'Awa Mbuyi',
          jobTitle: 'Gérante',
          email: 'Awa@Prospect.cd',
          companyName: 'Prospect SARL',
        }),
        201,
      );
      expect(prospect).toMatchObject({
        kind: 'prospect',
        email: 'awa@prospect.cd',
        companyName: 'Prospect SARL',
      });
      const contactClient = ok(
        await post(asN(), '/crm/contacts', { name: 'Jean Kabeya', customerId: customer }),
        201,
      );
      expect(contactClient).toMatchObject({
        kind: 'customer_contact',
        customerName: 'Client Exemple SARL',
      });

      const o = ok(
        await post(asN(), '/crm/opportunities', {
          title: 'Logiciel de caisse',
          prospectName: 'Prospect SARL',
          contactId: prospect.id,
          amount: '1500',
          currency: 'USD',
          expectedCloseDate: '2026-12-15',
        }),
        201,
      );
      expect(o).toMatchObject({
        stageKey: 'lead',
        status: 'open',
        amount: '1500.00',
        contactName: 'Awa Mbuyi',
      });
      let cur = o;
      for (const stageKey of ['qualified', 'proposal']) {
        cur = ok(
          await post(asN(), `/crm/opportunities/${o.id}/move`, {
            expectedRevision: cur.revision,
            stageKey,
          }),
        );
      }
      expect(cur.stageHistory.map((e: { stageKey: string }) => e.stageKey)).toEqual([
        'lead',
        'qualified',
        'proposal',
      ]);
      const inconnue = await post(asN(), `/crm/opportunities/${o.id}/move`, {
        expectedRevision: cur.revision,
        stageKey: 'nulle-part',
      });
      expect(inconnue.status).toBe(400);
      expect(JSON.stringify(inconnue.body)).toContain('UNKNOWN_STAGE');

      const board = ok(await get(asN(), '/crm/pipeline'));
      const proposal = board.stages.find((s: { key: string }) => s.key === 'proposal');
      expect(proposal.opportunities.map((x: { id: string }) => x.id)).toContain(o.id);
      // Somme par le moteur, par devise, sans conversion.
      expect(proposal.totals).toEqual([{ currency: 'USD', total: '1500.00', count: 1 }]);
      expect(proposal.winRate).toMatchObject({ status: 'unavailable', requiredSample: 10 });
      expect(board.stages.find((s: { key: string }) => s.key === 'won').winRate).toBeNull();

      // Vue liste filtrée.
      const liste = ok(await get(asN(), '/crm/opportunities?status=open&stageKey=proposal'));
      expect(liste.items.map((x: { id: string }) => x.id)).toEqual([o.id]);

      // Perdue, avec motif.
      const perdue = ok(
        await post(asN(), `/crm/opportunities/${o.id}/move`, {
          expectedRevision: cur.revision,
          stageKey: 'lost',
          // ADR-0040 — C2 : motif obligatoire par défaut ; `lostReason` en reste le détail.
          lostReasonKey: 'no_budget',
          lostReason: 'Budget reporté',
        }),
      );
      expect(perdue).toMatchObject({ status: 'lost', lostReason: 'Budget reporté' });
      expect(perdue.closedAt).not.toBeNull();
    });

    it('relances en retard, prochaines actions, opportunités inactives', async () => {
      const o = await opportunite();
      const hier = new Date(Date.now() - DAY).toISOString();
      const demain = new Date(Date.now() + DAY).toISOString();
      const relance = ok(
        await post(asN(), '/crm/activities', {
          kind: 'follow_up',
          subject: 'Relancer pour la signature',
          dueAt: hier,
          opportunityId: o.id,
        }),
        201,
      );
      expect(relance).toMatchObject({ overdue: true, done: false, kindLabel: 'Relance' });
      ok(
        await post(asN(), '/crm/activities', {
          kind: 'meeting',
          subject: 'Démonstration',
          dueAt: demain,
          opportunityId: o.id,
        }),
        201,
      );
      const note = ok(
        await post(asN(), '/crm/activities', {
          kind: 'note',
          subject: 'Intéressé',
          opportunityId: o.id,
        }),
        201,
      );
      expect(note).toMatchObject({ done: true, dueAt: null });

      let board = ok(await get(asN(), '/crm/pipeline'));
      expect(board.overdueActivities.map((a: { id: string }) => a.id)).toContain(relance.id);
      expect(
        board.upcomingActivities.find((a: { opportunityId: string }) => a.opportunityId === o.id),
      ).toMatchObject({ subject: 'Démonstration', opportunityTitle: o.title });
      const enRetard = ok(await get(asN(), `/crm/activities?status=overdue&opportunityId=${o.id}`));
      expect(enRetard.items.map((a: { id: string }) => a.id)).toEqual([relance.id]);

      const faite = ok(
        await post(asN(), `/crm/activities/${relance.id}/complete`, {
          expectedRevision: relance.revision,
        }),
      );
      expect(faite).toMatchObject({ done: true, overdue: false });
      board = ok(await get(asN(), '/crm/pipeline'));
      expect(board.overdueActivities.map((a: { id: string }) => a.id)).not.toContain(relance.id);

      // Inactive : aucune activité depuis 20 jours (seuil 14).
      await db
        .collection('crm_opportunities')
        .updateOne(
          { _id: new ObjectId(o.id) },
          { $set: { lastActivityAt: new Date(Date.now() - 20 * DAY) } },
        );
      board = ok(await get(asN(), '/crm/pipeline'));
      const stale = board.stale.find((x: { id: string }) => x.id === o.id);
      expect(stale).toMatchObject({ stale: true, daysSinceActivity: 20 });
    });

    it('probabilité par étape : indisponible sous 10 opportunités clôturées, puis taux historique', async () => {
      const now = new Date();
      const closed = (won: boolean, i: number) => ({
        organizationId: orgN,
        title: `Historique ${i}`,
        customerId: null,
        prospectName: 'Historique',
        contactId: null,
        stageKey: won ? 'won' : 'lost',
        status: won ? 'won' : 'lost',
        amount: null,
        currency: 'CDF',
        expectedCloseDate: null,
        lostReason: null,
        closedAt: new Date(now.getTime() - 200 * DAY),
        lastActivityAt: now,
        stageHistory: [
          { stageKey: 'lead', at: now, by: 'u', source: 'user', quoteId: null },
          { stageKey: won ? 'won' : 'lost', at: now, by: 'u', source: 'user', quoteId: null },
        ],
        searchKey: 'historique',
        revision: 1,
        createdBy: 'u',
        updatedBy: 'u',
        createdAt: now,
        updatedAt: now,
        _schemaVersion: 1,
      });
      // Une opportunité perdue est déjà passée par « lead » (test précédent).
      await db
        .collection('crm_opportunities')
        .insertMany([0, 1, 2, 3, 4, 5].map((i) => closed(true, i)));
      let lead = ok(await get(asN(), '/crm/pipeline')).stages.find(
        (s: { key: string }) => s.key === 'lead',
      );
      expect(lead.winRate).toEqual({
        status: 'unavailable',
        sample: 7,
        won: 6,
        requiredSample: 10,
      });
      await db.collection('crm_opportunities').insertMany([6, 7, 8].map((i) => closed(false, i)));
      lead = ok(await get(asN(), '/crm/pipeline')).stages.find(
        (s: { key: string }) => s.key === 'lead',
      );
      // 6 gagnées sur 10 passées par « lead ».
      expect(lead.winRate).toEqual({ status: 'available', ratePercent: '60', sample: 10, won: 6 });
    });

    it('import et export CSV : tout ou rien, rattachement par NIF et e-mail, export journalisé', async () => {
      const avant = await db.collection('crm_contacts').countDocuments({ organizationId: orgN });
      const fautif = await post(asN(), '/crm/contacts/import', {
        csv: `nom;email;nif_client\nPaul;paul@exemple.cd;\n;sans-nom@exemple.cd;\nMarie;marie@exemple.cd;INCONNU99\n`,
      });
      expect(fautif.status).toBe(400);
      expect(fautif.body.code).toBe('CSV_IMPORT_INVALID');
      expect(fautif.body.details.errors.map((e: { line: number }) => e.line)).toEqual([3, 4]);
      expect(await db.collection('crm_contacts').countDocuments({ organizationId: orgN })).toBe(
        avant,
      );

      const nif = `T${tag.toUpperCase()}01`;
      const essai = ok(
        await post(asN(), '/crm/contacts/import', {
          csv: `\uFEFFNom;Fonction;Email;Téléphone;Entreprise;NIF client\nPaul;DAF;paul@exemple.cd;;Paul SA;\nMarie;;marie@exemple.cd;;;${nif}\n`,
          dryRun: true,
        }),
      );
      expect(essai).toEqual({ dryRun: true, rows: 2, created: 0 });
      ok(
        await post(asN(), '/crm/contacts/import', {
          csv: `nom;fonction;email;telephone;entreprise;nif_client\nPaul;DAF;paul@exemple.cd;;Paul SA;\nMarie;;marie@exemple.cd;;;${nif}\n`,
        }),
      );
      const marie = ok(await get(asN(), '/crm/contacts?q=marie')).items[0];
      expect(marie).toMatchObject({ kind: 'customer_contact', customerId: customer });

      const opp = ok(
        await post(asN(), '/crm/opportunities/import', {
          csv: `titre;etape;montant;devise;cloture_prevue;prospect;nif_client;email_contact\nRenouvellement;Proposition;"2 500,50";usd;2026-12-31;;${nif};marie@exemple.cd\n`,
        }),
      );
      expect(opp).toEqual({ dryRun: false, rows: 1, created: 1 });
      const importee = ok(await get(asN(), '/crm/opportunities?q=renouvellement')).items[0];
      expect(importee).toMatchObject({
        stageKey: 'proposal',
        amount: '2500.50',
        currency: 'USD',
        customerId: customer,
        contactName: 'Marie',
      });

      const exp = await request(server())
        .get('/crm/contacts/export')
        .set('Cookie', asN())
        .buffer(true);
      expect(exp.status).toBe(200);
      expect(exp.headers['content-type']).toContain('text/csv');
      const csv = exp.text;
      expect(csv.startsWith('﻿nom;fonction;email;telephone;entreprise;nif_client;notes')).toBe(
        true,
      );
      expect(csv).toContain(`Marie;;marie@exemple.cd;;Client Exemple SARL;${nif};`);
      expect(
        await db
          .collection('audit_events')
          .countDocuments({ organizationId: orgN, action: 'crm.contacts_exported' }),
      ).toBe(1);
      // Un export réimporté tel quel est accepté (essai).
      const relu = ok(await post(asN(), '/crm/contacts/import', { csv, dryRun: true }));
      expect(relu.rows).toBeGreaterThanOrEqual(4);
    });
  });

  // ── Devis ────────────────────────────────────────────────────────────────

  describe('devis', () => {
    it('même calcul que le brouillon de facture (moteur), numéro DV, validité par défaut', async () => {
      const d = ok(await post(asN(), '/sales/quotes', corpsDevis()), 201);
      expect(d.number).toMatch(/^DV\d{4}-\d{6}$/);
      expect(d).toMatchObject({ version: 1, status: 'draft', currency: 'CDF', blockers: [] });
      expect(d.documentAmounts.calculation.ok).toBe(true);
      // Remise de 10 % sur l'article de catalogue (moteur).
      expect(d.lines[1]).toMatchObject({ originalPrice: '150000.00', unitPrice: '135000.00' });

      const f = ok(
        await post(asN(), '/sales/invoices', {
          type: 'FV',
          currency: 'CDF',
          priceMode: 'ht',
          customer: { customerId: customer, printContactDetails: false },
          pointOfSaleId: null,
          lines: lignes(),
          payments: [],
          comments: { A: null, C: null },
          creditNote: null,
          showUsdCounterValue: false,
        }),
        201,
      );
      expect(d.documentAmounts.calculation.totals).toEqual(f.documentAmounts.calculation.totals);
      ok(await del(asN(), `/sales/invoices/${f.id}`), 204);

      // Ligne « origine » refusée ; montant en nombre refusé.
      const origine = await post(
        asN(),
        '/sales/quotes',
        corpsDevis({ lines: [{ source: 'origin', originLineIndex: 0, quantity: '1' }] }),
      );
      expect(origine.status).toBe(400);
      expect(JSON.stringify(origine.body)).toContain('LINE_SOURCE_INVALID');
      const nombre = await post(
        asN(),
        '/sales/quotes',
        corpsDevis({ lines: [{ ...LIGNE_LIBRE, unitPrice: 40000 }] }),
      );
      expect(nombre.status).toBe(400);
      expect(JSON.stringify(nombre.body)).toContain('DECIMAL_MUST_BE_STRING');

      // Brouillon jamais envoyé : supprimable.
      ok(await del(asN(), `/sales/quotes/${d.id}`), 204);
      expect((await get(asN(), `/sales/quotes/${d.id}`)).status).toBe(404);
    });

    it('envoi, nouvelle version, refus ; expiration dérivée de la validité', async () => {
      const s = await devis();
      expect(s).toMatchObject({ status: 'sent', actions: { edit: false, accept: true } });
      expect(
        (
          await put(asN(), `/sales/quotes/${s.id}`, {
            ...corpsDevis(),
            expectedRevision: s.revision,
          })
        ).status,
      ).toBe(409);
      expect((await del(asN(), `/sales/quotes/${s.id}`)).body.code).toBe('QUOTE_NOT_DELETABLE');

      const v2 = ok(
        await post(asN(), `/sales/quotes/${s.id}/new-version`, { expectedRevision: s.revision }),
      );
      expect(v2).toMatchObject({ version: 2, status: 'draft', number: s.number });
      expect(v2.previousVersions).toEqual([
        expect.objectContaining({ version: 1, status: 'sent' }),
      ]);
      const modifie = ok(
        await put(asN(), `/sales/quotes/${s.id}`, {
          ...corpsDevis({ lines: [LIGNE_LIBRE] }),
          expectedRevision: v2.revision,
        }),
      );
      const envoye = ok(
        await post(asN(), `/sales/quotes/${s.id}/send`, { expectedRevision: modifie.revision }),
      );
      const refuse = ok(
        await post(asN(), `/sales/quotes/${s.id}/refuse`, {
          expectedRevision: envoye.revision,
          reason: 'Trop cher',
        }),
      );
      expect(refuse).toMatchObject({ status: 'refused', refusalReason: 'Trop cher' });

      // Expiré : envoyé, validité passée.
      const e = await devis();
      await db
        .collection('sales_quotes')
        .updateOne({ _id: new ObjectId(e.id) }, { $set: { validUntil: '2026-01-01' } });
      const lu = ok(await get(asN(), `/sales/quotes/${e.id}`));
      expect(lu).toMatchObject({ status: 'expired', actions: { accept: false, newVersion: true } });
      const accepte = await post(asN(), `/sales/quotes/${e.id}/accept`, {
        expectedRevision: lu.revision,
      });
      expect(accepte.status).toBe(409);
      expect(accepte.body.code).toBe('QUOTE_STATUS_CONFLICT');
      const expires = ok(await get(asN(), '/sales/quotes?status=expired'));
      expect(expires.items.map((x: { id: string }) => x.id)).toContain(e.id);
    });

    it('PDF : modèle de l’organisation, intitulé DEVIS, aucune mention DGI de facture', async () => {
      const s = await devis();
      const res = await binary(
        request(server()).get(`/sales/quotes/${s.id}/pdf`).set('Cookie', asN()),
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${s.number}-v1.pdf"`);
      const t = (res.body as Buffer).toString('utf8');
      expect(t.startsWith('%PDF-FAKE')).toBe(true);
      expect(t).toContain('DEVIS — non valable comme facture');
      expect(t).toContain(`${s.number} — version 1`);
      expect(t).not.toContain('Éléments de sécurité DGI');
      expect(t).not.toContain('Environnement de test DGI');
      expect(t).not.toContain('PRO FORMA');
      expect(
        await db.collection('audit_events').countDocuments({
          organizationId: orgN,
          action: 'sales_quote.pdf_exported',
          targetId: s.id,
        }),
      ).toBe(1);
    });

    it('accepté → opportunité gagnée ; converti en brouillon de facture puis NORMALISÉ (faux e-MCF)', async () => {
      const o = await opportunite();
      const a = await devis({ opportunityId: o.id }, 'accepted');
      expect(a).toMatchObject({ status: 'accepted', opportunityOutcome: 'won' });
      const gagnee = ok(await get(asN(), `/crm/opportunities/${o.id}`));
      expect(gagnee).toMatchObject({ status: 'won', stageKey: 'won' });
      expect(gagnee.stageHistory.at(-1)).toMatchObject({ source: 'quote', quoteId: a.id });
      expect(gagnee.quotes).toEqual([
        expect.objectContaining({ id: a.id, status: 'accepted', total: a.total }),
      ]);

      const conv = ok(
        await post(asN(), `/sales/quotes/${a.id}/convert`, { expectedRevision: a.revision }),
      );
      expect(conv.amountsDiffer).toBe(false);
      expect(conv.quote.conversion).toMatchObject({
        invoiceId: conv.invoiceId,
        alive: true,
        invoiceStatus: 'draft',
      });
      const f = ok(await get(asN(), `/sales/invoices/${conv.invoiceId}`));
      expect(f).toMatchObject({
        status: 'draft',
        documentKind: 'proforma',
        type: 'FV',
        currency: 'CDF',
        priceMode: 'ht',
      });
      expect(f.comments.C).toContain(a.number);
      expect(f.documentAmounts.calculation.totals.total).toBe(a.total);
      // Prix du devis FIXÉS sur la facture, même si le catalogue change ensuite.
      expect(f.lines[1]).toMatchObject({
        source: 'catalog',
        catalogItemId: item,
        priceOverridden: true,
      });

      const encore = await post(asN(), `/sales/quotes/${a.id}/convert`, {
        expectedRevision: conv.quote.revision,
      });
      expect(encore.status).toBe(409);
      expect(encore.body.code).toBe('QUOTE_ALREADY_CONVERTED');

      // La facture suit SON circuit : paiement, puis normalisation DGI (faux serveur).
      const avant = fake.callsTo('submit').length;
      const pret = ok(
        await put(asN(), `/sales/invoices/${f.id}`, {
          type: 'FV',
          currency: 'CDF',
          priceMode: 'ht',
          customer: { customerId: customer, printContactDetails: false },
          pointOfSaleId: f.pointOfSaleId,
          lines: f.lines.map((l: Record<string, unknown>) =>
            l['source'] === 'catalog'
              ? {
                  source: 'catalog',
                  catalogItemId: l['catalogItemId'],
                  quantity: l['quantity'],
                  unitPrice: l['originalPrice'] ?? l['unitPrice'],
                  discount: l['discount'],
                }
              : { ...LIGNE_LIBRE },
          ),
          // À crédit : la facture issue du devis se règle ensuite par un encaissement
          // (ADR-0031 ; intégration du 27 oct. 2026).
          payments: [{ method: 'CREDIT', amount: f.documentAmounts.calculation.totals.total }],
          comments: { A: null, C: f.comments.C },
          creditNote: null,
          showUsdCounterValue: false,
          expectedRevision: f.revision,
        }),
      );
      expect(pret.readiness).toMatchObject({ action: 'normalize', ready: true });
      const n = ok(
        await post(asN(), `/sales/invoices/${f.id}/normalize`, {
          expectedRevision: pret.revision,
          exchangeRate: null,
        }),
      );
      expect(n, JSON.stringify(n.normalization)).toMatchObject({
        status: 'normalized',
        documentKind: 'invoice',
        series: 'test',
      });
      expect(n.number).toMatch(/^TEST-IN\d{4}-\d{6}$/);
      expect(fake.callsTo('submit').length - avant).toBe(1);
      const lu = ok(await get(asN(), `/sales/quotes/${a.id}`));
      expect(lu.conversion).toMatchObject({
        alive: true,
        invoiceStatus: 'normalized',
        reference: n.number,
      });

      // Encaissement (ADR-0031) : seules les factures de la série RÉELLE se règlent.
      // Cette organisation normalise en environnement de test DGI : la facture issue
      // du devis est de la série d'essai, le règlement n'y est donc pas applicable.
      expect(ok(await get(asN(), `/sales/settlements/${n.id}`))).toMatchObject({
        status: 'not_applicable',
        settlement: null,
      });
    });

    it('vendeur non assujetti : un devis à groupe réservé aux assujettis ne part pas', async () => {
      ok(
        await put(asB(), '/organizations/current/fiscal-profile', {
          legalName: 'Petit Commerce B',
          tradeName: null,
          legalForm: 'sarl',
          legalFormOther: null,
          nif: `B${tag.toUpperCase()}99`,
          rccm: null,
          nationalId: null,
          vatRegistered: false,
          headOffice: {
            line1: '2, avenue Exemple',
            line2: null,
            commune: 'Gombe',
            city: 'Kinshasa',
            province: 'Kinshasa',
          },
          phone: '+243 800 000 001',
          email: 'b@exemple.cd',
        }),
      );
      const d = ok(
        await post(asB(), '/sales/quotes', {
          currency: 'CDF',
          priceMode: 'ht',
          customer: { customerId: null, walkIn: { name: 'Client comptoir' } },
          lines: [LIGNE_LIBRE],
          title: null,
          notes: null,
        }),
        201,
      );
      expect(d.blockers.map((b: { code: string }) => b.code)).toContain(
        'TAX_GROUP_REQUIRES_VAT_REGISTRATION',
      );
      const envoi = await post(asB(), `/sales/quotes/${d.id}/send`, {
        expectedRevision: d.revision,
      });
      expect(envoi.status).toBe(409);
      expect(envoi.body.code).toBe('QUOTE_NOT_READY');
    });

    it('règle de gain désactivable ; opportunité avec devis non supprimable', async () => {
      const s0 = ok(await get(asN(), '/crm/settings'));
      ok(
        await put(asN(), '/crm/settings', {
          expectedRevision: s0.revision,
          stages: s0.stages,
          autoWinOnQuoteAccepted: false,
          staleAfterDays: s0.staleAfterDays,
        }),
      );
      const o = await opportunite();
      const a = await devis({ opportunityId: o.id }, 'accepted');
      expect(a.opportunityOutcome).toBe('disabled');
      expect(ok(await get(asN(), `/crm/opportunities/${o.id}`)).status).toBe('open');
      const suppr = await del(asN(), `/crm/opportunities/${o.id}`);
      expect(suppr.status).toBe(409);
      expect(suppr.body.code).toBe('CRM_OPPORTUNITY_HAS_QUOTES');
    });
  });

  // ── Isolation et RBAC ────────────────────────────────────────────────────

  describe('isolation entre organisations', () => {
    it('une autre organisation ne voit ni ne cible rien : 404, jamais 403', async () => {
      const o = await opportunite();
      const c = ok(await post(asN(), '/crm/contacts', { name: 'Secret', companyName: 'X' }), 201);
      const q = ok(await post(asN(), '/sales/quotes', corpsDevis({ opportunityId: o.id })), 201);
      for (const path of [
        `/crm/opportunities/${o.id}`,
        `/crm/contacts/${c.id}`,
        `/sales/quotes/${q.id}`,
        `/sales/quotes/${q.id}/pdf`,
      ]) {
        expect((await get(asB(), path)).status, path).toBe(404);
      }
      expect(
        (await post(asB(), `/sales/quotes/${q.id}/send`, { expectedRevision: 1 })).status,
      ).toBe(404);
      expect(
        (
          await post(asB(), `/crm/opportunities/${o.id}/move`, {
            expectedRevision: 1,
            stageKey: 'won',
          })
        ).status,
      ).toBe(404);
      // Références d'une autre organisation refusées à la création.
      const viaOpp = await post(asB(), '/sales/quotes', {
        ...corpsDevis({ opportunityId: o.id }),
        customer: { customerId: null, walkIn: { name: 'Comptoir' } },
        lines: [LIGNE_LIBRE],
      });
      expect(viaOpp.status).toBe(404);
      const viaClient = await post(asB(), '/crm/opportunities', {
        title: 'Vol',
        customerId: customer,
        currency: 'CDF',
      });
      expect(viaClient.status).toBe(404);
      const board = ok(await get(asB(), '/crm/pipeline'));
      expect(board.stages.flatMap((s: { opportunities: unknown[] }) => s.opportunities)).toEqual(
        [],
      );
      // B a ses propres devis (cas « vendeur non assujetti ») : aucun n'est à N.
      const idsDeN = new Set([q.id]);
      const devisDeB = ok(await get(asB(), '/sales/quotes')).items as { id: string }[];
      expect(devisDeB.filter((x) => idsDeN.has(x.id))).toEqual([]);
    });
  });

  describe('RBAC', () => {
    it('Lecteur et Analyste consultent ; le Conseiller ne voit rien ; seuls les gestionnaires écrivent', async () => {
      for (const role of ['viewer', 'analyst'] as const) {
        expect((await get(asN(role), '/crm/pipeline')).status, role).toBe(200);
        expect((await get(asN(role), '/sales/quotes')).status, role).toBe(200);
        expect(
          (
            await post(asN(role), '/crm/opportunities', {
              title: 'x',
              prospectName: 'y',
              currency: 'CDF',
            })
          ).status,
          role,
        ).toBe(403);
        expect((await post(asN(role), '/sales/quotes', corpsDevis())).status, role).toBe(403);
        expect((await get(asN(role), '/crm/contacts/export')).status, role).toBe(403);
      }
      for (const path of ['/crm/pipeline', '/crm/contacts', '/sales/quotes']) {
        expect((await get(asN('advisor'), path)).status, path).toBe(403);
      }
    });

    it('Administrateur et Comptable gèrent CRM et devis ; seul qui détient sales.invoice normalise', async () => {
      for (const role of ['admin', 'accountant'] as const) {
        ok(
          await post(asN(role), '/crm/opportunities', {
            title: `Opp ${role}`,
            prospectName: 'P',
            currency: 'CDF',
          }),
          201,
        );
        const d = ok(await post(asN(role), '/sales/quotes', corpsDevis()), 201);
        const s = ok(
          await post(asN(role), `/sales/quotes/${d.id}/send`, { expectedRevision: d.revision }),
        );
        const a = ok(
          await post(asN(role), `/sales/quotes/${d.id}/accept`, { expectedRevision: s.revision }),
        );
        const conv = ok(
          await post(asN(role), `/sales/quotes/${d.id}/convert`, { expectedRevision: a.revision }),
        );
        const f = ok(await get(asN(role), `/sales/invoices/${conv.invoiceId}`));
        const n = await post(asN(role), `/sales/invoices/${f.id}/normalize`, {
          expectedRevision: f.revision,
          exchangeRate: null,
        });
        // L'Administrateur prépare mais n'émet pas (sales.invoice) ; le Comptable passe
        // le garde et bute sur le paiement manquant (règle de la facture, pas du devis).
        if (role === 'admin') expect(n.status).toBe(403);
        else expect(n.status).not.toBe(403);
      }
    });
  });
});
