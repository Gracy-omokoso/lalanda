// ADR-0053 — P7 : STATISTIQUES ET FINANCES DU SITE (`/admin/stats`, `/admin/finance`).
//
// Critère 20 : aucune case de moins de 5 organisations n'est servie en clair.
// Critère 21 : avec un jeu semé (deux dépôts manuels confirmés, un rappel Stripe signé, un
//              refusé, un octroi), les encaissements du mois égalent la somme des confirmés,
//              au centime ; aucun libellé ni clé ne contient « chiffre d'affaires »,
//              « facturé » ni « TVA ».
// Matrice § 5.2 : statistiques → SA, PA, finance ; finances et export → SA, finance.
// Isolation : aucun rôle d'organisation (Propriétaire compris) n'ouvre ces routes ;
//             aucune donnée métier d'un client (nom, montant de facture) n'y paraît.
// Export : journalisé au journal plateforme (`platform.finance.exported`), rôles relus.

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { type Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { findForbiddenPlatformFinanceWords } from '@lalanda/shared/platform';

import type { PlatformRole } from '../authz/permissions.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

e2eSuite('ADR-0053 — P7 : statistiques et finances du site', () => {
  let app: INestApplication;
  let db: Db;
  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  let orgClient = '';
  const TEMOIN = `TEMOIN-P7-${tag}`;
  const NOM_ORG = `Organisation secrète ${tag}`;

  const serveur = () => app.getHttpServer();
  const compte = (cle: string) => {
    const email = `p7-${cle.toLowerCase()}-${tag}@lalanda-test.local`;
    if (!emails.includes(email)) emails.push(email);
    return { email, password: `Passw0rd!${cle}`, name: `P7 ${cle}` };
  };
  const viderLimiteur = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const t of store.timeoutIds.values()) t.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };
  const idDeSession = async (c: string[]): Promise<string> => {
    const s = await request(serveur()).get('/auth/get-session').set('Cookie', c);
    return String(s.body?.user?.id ?? '');
  };
  const lire = (cle: string, chemin: string) =>
    request(serveur()).get(chemin).set('Cookie', cookies[cle]!);

  /** Toutes les cases `{ value, masked }` d'une réponse, à toute profondeur. */
  function cases(x: unknown, out: Array<{ value: unknown; masked: unknown }> = []) {
    if (Array.isArray(x)) x.forEach((v) => cases(v, out));
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if ('masked' in o && 'value' in o) out.push({ value: o['value'], masked: o['masked'] });
      else Object.values(o).forEach((v) => cases(v, out));
    }
    return out;
  }

  const MARS_2001 = (jour: number) => new Date(Date.UTC(2001, 2, jour, 12));

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    await db.collection('platform_roles').deleteMany({});

    cookies['client'] = await registerAndLogin(app, compte('client'));
    ids['client'] = await idDeSession(cookies['client']);
    const orgs = await request(serveur()).get('/organizations').set('Cookie', cookies['client']);
    orgClient = (orgs.body.organizations as { id: string }[])[0]!.id;
    await db
      .collection('organizations')
      .updateOne({ slug: { $exists: true }, ownerId: ids['client'] }, { $set: { name: NOM_ORG } });

    for (const [cle, role] of [
      ['sa', 'platform_super_admin'],
      ['pa', 'platform_admin'],
      ['sup', 'platform_support'],
      ['fac', 'platform_billing'],
      ['tpl', 'platform_template_editor'],
      ['cpk', 'platform_country_pack_manager'],
    ] as const) {
      cookies[cle] = await registerAndLogin(app, compte(cle));
      ids[cle] = await idDeSession(cookies[cle]);
      await db.collection('memberships').deleteMany({ userId: ids[cle] });
      // Opérateur SANS organisation : la sienne, créée à l'inscription, disparaît.
      await db.collection('organizations').deleteMany({ ownerId: ids[cle] });
      await db.collection('platform_roles').insertOne({
        userId: ids[cle],
        role: role satisfies PlatformRole,
        grantedBy: null,
        reason: `suite e2e P7 ${tag}`,
        expiresAt: null,
        revokedAt: null,
        _schemaVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Donnée métier du client : elle ne doit paraître dans AUCUNE réponse de la console.
    await db.collection('sales_invoices').insertOne({
      organizationId: orgClient,
      number: TEMOIN,
      customerName: `Client ${TEMOIN}`,
      totalTtc: '987654.32',
      createdAt: new Date(),
    });

    // Jeu de finances, en mars 2001 (hors de toute autre donnée).
    const demande = (reference: string, over: Record<string, unknown>) => ({
      reference: `${reference}-${tag}`,
      organizationId: orgClient,
      requestedBy: ids['client'],
      plan: 'pro',
      interval: 'month',
      amountDueCents: 1900,
      currency: 'USD',
      method: 'mobile_money',
      status: 'confirmed',
      decidedBy: ids['fac'],
      decidedAt: MARS_2001(5),
      decisionNote: 'dépôt',
      expiresAt: MARS_2001(20),
      _schemaVersion: 1,
      createdAt: MARS_2001(1),
      updatedAt: MARS_2001(5),
      ...over,
    });
    await db
      .collection('manual_payment_requests')
      .insertMany([
        demande('LLD-A', {}),
        demande('LLD-B', { plan: 'cabinet', amountDueCents: 3901, method: 'bank_transfer' }),
        demande('LLD-C', { status: 'rejected', amountDueCents: 7900, decidedAt: MARS_2001(6) }),
      ]);
    await db.collection('payment_events').insertOne({
      provider: 'stripe',
      eventId: `evt_${tag}`,
      rawType: 'invoice.paid',
      mappedEvent: 'payment.succeeded',
      organizationId: orgClient,
      status: 'processed',
      detail: null,
      _schemaVersion: 1,
      createdAt: MARS_2001(7),
      updatedAt: MARS_2001(7),
    });
    // Octroi sans paiement : ni demande ni paiement, donc hors des encaissements.
    await db.collection('platform_plan_grants').insertOne({
      targetOrganizationId: orgClient,
      plan: 'business',
      reasonCategory: 'request',
      clientMessage: 'geste',
      internalNote: 'octroi de test P7',
      startsAt: MARS_2001(8),
      endsAt: null,
      status: 'active',
      grantedBy: ids['sa'],
      createdAt: MARS_2001(8),
      updatedAt: MARS_2001(8),
    });
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (db) {
      await db.collection('platform_roles').deleteMany({ reason: `suite e2e P7 ${tag}` });
      await db.collection('manual_payment_requests').deleteMany({});
      await db.collection('payment_events').deleteMany({});
      await db.collection('platform_plan_grants').deleteMany({});
      await db.collection('sales_invoices').deleteMany({ number: TEMOIN });
    }
    await teardown(app, emails);
  }, E2E_HOOK_TIMEOUT_MS);

  // ── Matrice § 5.2 ───────────────────────────────────────────────────────────

  it('matrice : statistiques à SA, PA, finance ; finances et export à SA et finance', async () => {
    viderLimiteur();
    const attendu: Record<string, [number, number, number]> = {
      sa: [200, 200, 200],
      pa: [200, 403, 403],
      fac: [200, 200, 200],
      sup: [403, 403, 403],
      tpl: [403, 403, 403],
      cpk: [403, 403, 403],
    };
    for (const [cle, [stats, finance, exportCsv]] of Object.entries(attendu)) {
      expect((await lire(cle, '/admin/stats')).status, `${cle} stats`).toBe(stats);
      expect((await lire(cle, '/admin/finance')).status, `${cle} finance`).toBe(finance);
      const ex = await lire(cle, '/admin/finance/export.csv?from=2001-03&to=2001-03');
      expect(ex.status, `${cle} export`).toBe(exportCsv);
    }
    const refus = await lire('pa', '/admin/finance');
    expect(refus.body).toMatchObject({ code: 'FORBIDDEN', action: 'platform.finance.read' });
  });

  it('aucun rôle d’organisation n’ouvre ces routes (Propriétaire compris)', async () => {
    viderLimiteur();
    for (const [chemin, action] of [
      ['/admin/stats', 'platform.stats.read'],
      ['/admin/finance', 'platform.finance.read'],
      ['/admin/finance/export.csv', 'platform.finance.export'],
    ] as const) {
      const res = await request(serveur())
        .get(chemin)
        .set('Cookie', [...cookies['client']!, `active_org_id=${orgClient}`]);
      expect(res.status, chemin).toBe(403);
      expect(res.body, chemin).toMatchObject({ code: 'FORBIDDEN', action });
    }
  });

  // ── Statistiques (critère 20) ───────────────────────────────────────────────

  it('critère 20 — aucune case de moins de 5 n’est servie en clair', async () => {
    viderLimiteur();
    const res = await lire('sa', '/admin/stats');
    expect(res.status).toBe(200);
    const toutes = cases(res.body);
    expect(toutes.length).toBeGreaterThan(20);
    for (const c of toutes) {
      if (c.masked === true) expect(c.value).toBeNull();
      else expect(typeof c.value === 'number' && c.value >= 5, JSON.stringify(c)).toBe(true);
    }
    // Une seule organisation : ses cases sont sous le seuil.
    expect(res.body.organizations.total).toEqual({ value: null, masked: true });
    expect(res.body.minCell).toBe(5);
    expect(res.body.organizations.byPlan.map((r: { key: string }) => r.key)).toEqual([
      'free',
      'pro',
      'cabinet',
      'business',
      'expert',
    ]);
  });

  it('au-delà du seuil, les comptes sont servis en clair', async () => {
    viderLimiteur();
    const extra = Array.from({ length: 10 }, (_, i) => ({
      name: `Org P7 ${tag} ${i}`,
      slug: `org-p7-${tag}-${i}`,
      type: 'agence',
      pays: i < 5 ? 'CG' : 'GA',
      ownerId: ids['client'],
      _schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const inserted = await db.collection('organizations').insertMany(extra);
    try {
      await db.collection('crm_accounts').insertMany(
        Object.values(inserted.insertedIds)
          .slice(0, 5)
          .map((id) => ({
            organizationId: String(id),
            name: `Compte ${TEMOIN}`,
          })),
      );
      const res = await lire('pa', '/admin/stats');
      expect(res.status).toBe(200);
      expect(res.body.organizations.total).toEqual({ value: 11, masked: false });
      const pays = Object.fromEntries(
        res.body.organizations.byCountry.map((r: { key: string; cell: unknown }) => [
          r.key,
          r.cell,
        ]),
      );
      // CD (1) est sous le seuil ; seul masqué, il se déduirait du total : la plus petite
      // des autres cases (CG, 5, avant GA par ordre de clé) l'est aussi.
      expect(pays).toEqual({
        CD: { value: null, masked: true },
        CG: { value: null, masked: true },
        GA: { value: 5, masked: false },
      });
      const crm = res.body.modules.find((r: { key: string }) => r.key === 'crm');
      expect(crm.cell).toEqual({ value: 5, masked: false });
    } finally {
      await db.collection('crm_accounts').deleteMany({ name: `Compte ${TEMOIN}` });
      await db
        .collection('organizations')
        .deleteMany({ _id: { $in: Object.values(inserted.insertedIds) } });
    }
  });

  // ── Finances (critère 21) ───────────────────────────────────────────────────

  it('critère 21 — encaissements du mois = somme des dépôts confirmés, au centime', async () => {
    viderLimiteur();
    const res = await lire('fac', '/admin/finance?from=2001-03&to=2001-03');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.receipts.total).toEqual([{ currency: 'USD', totalCents: 5801, count: 2 }]);
    expect(res.body.receipts.byMonth).toEqual([
      { month: '2001-03', byCurrency: [{ currency: 'USD', totalCents: 5801, count: 2 }] },
    ]);
    // Le rappel Stripe est compté, sans montant ; le refus et l'octroi n'entrent pas.
    expect(res.body.providerEventsWithoutAmount).toEqual([{ provider: 'stripe', count: 1 }]);
    expect(res.body.manualQueue.rejected).toEqual([
      { currency: 'USD', totalCents: 7900, count: 1 },
    ]);
    expect(res.body.receipts.byPlan.map((p: { plan: string }) => p.plan).sort()).toEqual([
      'cabinet',
      'pro',
    ]);
  });

  it('critère 21 — aucun mot réservé aux pièces fiscales, ni dans les clés ni dans l’export', async () => {
    viderLimiteur();
    const json = await lire('sa', '/admin/finance?from=2001-01&to=2001-12');
    expect(findForbiddenPlatformFinanceWords(JSON.stringify(json.body))).toEqual([]);
    const csv = await lire('sa', '/admin/finance/export.csv?from=2001-03&to=2001-03');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain(
      'encaissements-constates-2001-03-2001-03.csv',
    );
    expect(csv.text).toContain('encaissements_constates;periode;USD;2;58.01');
    expect(findForbiddenPlatformFinanceWords(csv.text)).toEqual([]);
  });

  it('période invalide → 400 INVALID_PERIOD', async () => {
    viderLimiteur();
    for (const q of [
      'from=2001-13&to=2001-12',
      'from=2002-01&to=2001-01',
      'from=1990-01&to=2001-01',
    ]) {
      const res = await lire('fac', `/admin/finance?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body.code, q).toBe('INVALID_PERIOD');
    }
  });

  it('l’export est journalisé au journal plateforme, avec les rôles relus', async () => {
    viderLimiteur();
    expect((await lire('fac', '/admin/finance/export.csv?from=2001-03&to=2001-03')).status).toBe(
      200,
    );
    const evt = await db.collection('audit_events').findOne(
      {
        organizationId: 'platform',
        action: 'platform.finance.exported',
        actorUserId: ids['fac'],
      },
      { sort: { createdAt: -1 } },
    );
    expect(evt).not.toBeNull();
    expect(evt!['actorRole']).toBe('platform_billing');
    expect(evt!['metadata']).toMatchObject({ from: '2001-03', to: '2001-03' });
    // Lire n'est pas exporter : la lecture n'écrit rien.
    const avant = await db
      .collection('audit_events')
      .countDocuments({ organizationId: 'platform', actorUserId: ids['fac'] });
    await lire('fac', '/admin/finance');
    expect(
      await db
        .collection('audit_events')
        .countDocuments({ organizationId: 'platform', actorUserId: ids['fac'] }),
    ).toBe(avant);
    // Et rien ne paraît dans le journal du client.
    const journal = await request(serveur())
      .get('/audit-events?limit=500')
      .set('Cookie', [...cookies['client']!, `active_org_id=${orgClient}`]);
    expect(JSON.stringify(journal.body)).not.toContain('platform.finance');
  });

  // ── Minimisation ────────────────────────────────────────────────────────────

  it('aucune donnée d’un client : ni nom, ni identifiant, ni montant de facture', async () => {
    viderLimiteur();
    for (const chemin of [
      '/admin/stats',
      '/admin/finance?from=2001-01&to=2001-12',
      '/admin/finance/export.csv?from=2001-01&to=2001-12',
    ]) {
      const res = await lire('sa', chemin);
      expect(res.status, chemin).toBe(200);
      const texte = res.text;
      for (const temoin of [TEMOIN, NOM_ORG, orgClient, '987654', ids['client']!, `LLD-A-${tag}`]) {
        expect(texte.includes(temoin), `${chemin} contient ${temoin}`).toBe(false);
      }
    }
  });
});
