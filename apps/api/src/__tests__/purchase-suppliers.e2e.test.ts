// Fiches fournisseurs contre la vraie application (ADR-0044 § 2.1, § 2.8, § 3.1 ;
// critères 14, 16 et 17). ADR-0044 — P2.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleurs → MongoDB. Couvre : fiche (création, homonymes, NIF unique, mise à
// jour, archivage, suppression), coordonnées de paiement (chiffrées en base, jamais
// en clair ni dans la base, ni dans le journal, ni dans les réponses ; `reveal`
// réservé à `payables.pay` et audité strictement ; alerte et notification de
// changement ; compte partagé), fusion, `supplierId` sur la trésorerie
// (rattachement exact par `legacyKeys`, autocomplétion), droits et isolation entre
// organisations (404 sur tout identifiant forgé).
//
// BASE DÉDIÉE, supprimée à la fin. Coordonnées et NIF inventés.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_fournisseurs_${tag}`;
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!fournisseurs';
const ROLES = ['admin', 'accountant', 'analyst', 'viewer', 'sales_rep', 'advisor'] as const;
type Role = 'owner' | (typeof ROLES)[number];
type Compte = Role | 'ownerB';

/** Coordonnées fictives : jamais ces chaînes en clair hors de `reveal`. */
const COMPTE = `00011${tag.replace(/[a-f]/g, '7')}94521`;
const IBAN = `CD08${COMPTE}`;
const TELEPHONE = `+243 81 ${tag.replace(/[a-f]/g, '5').slice(0, 3)} 4578`;
const NOUVEAU_COMPTE = `99911${tag.replace(/[a-f]/g, '3')}12345`;
const nif = (n: number) => `F${tag.toUpperCase()}${String(n).padStart(3, '0')}`;

e2eSuite('Fournisseurs (ADR-0044 P2)', () => {
  let app: INestApplication;
  let db: Db;
  let orgN = '';
  let orgB = '';
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
  const del = (c: string[], path: string, body?: unknown) =>
    request(server())
      .delete(path)
      .set('Cookie', c)
      .send(body ?? {});
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

  async function fournisseur(
    name: string,
    extra: Record<string, unknown> = {},
    c: string[] = asN(),
  ): Promise<{
    supplier: Record<string, any>;
    warnings: Array<{ code: string; supplierId: string }>;
  }> {
    return ok(await post(c, '/purchases/suppliers', { name, ...extra }), 201) as never;
  }
  async function compteBancaire(supplier: Record<string, any>, c: string[] = asN()) {
    return ok(
      await post(c, `/purchases/suppliers/${supplier['id']}/payment-methods`, {
        kind: 'bank',
        label: 'Compte principal',
        details: {
          bankName: 'Rawbank',
          accountHolder: 'Socimex SARL',
          accountNumber: COMPTE,
          iban: IBAN,
          swift: 'RAWBCDKI',
        },
        expectedRevision: supplier['revision'],
      }),
      201,
    );
  }

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    for (const c of ['owner', ...ROLES, 'ownerB'] as const) {
      emails[c] = `fournisseurs-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({
      email: emails[c],
      password: MOT_DE_PASSE,
      name: `Fournisseurs ${c}`,
    });
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
      expect(inv.status, `invitation ${role} ${JSON.stringify(inv.body)}`).toBe(201);
      cookies[role] = await registerAndLogin(app, compte(role));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: inv.body.token });
      expect(acc.status).toBe(201);
    }
    orgB = await orgDe('ownerB');
    for (const m of await db.collection('memberships').find({}).toArray()) {
      const who = (Object.keys(emails) as Compte[]).find(
        (c) =>
          (c === 'ownerB' ? m['organizationId'] === orgB : m['organizationId'] === orgN) &&
          m['role'] === (c === 'ownerB' ? 'owner' : c),
      );
      if (who) userIds[who] = m['userId'] as string;
    }
  }, 300_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, 60_000);

  // ── Fiche ────────────────────────────────────────────────────────────────

  describe('fiche', () => {
    it('créer, lister, homonyme signalé, NIF normalisé et unique', async () => {
      const a = await fournisseur('Socimex SARL', {
        nif: ` ${nif(1).slice(0, 4)}-${nif(1).slice(4).toLowerCase()} `,
        paymentTerms: { kind: 'net', days: 30 },
        defaultCurrency: 'USD',
        defaultCategory: 'achats',
        contacts: [{ name: 'Mme Kabila', email: 'achats@socimex.test', isPrimary: true }],
      });
      expect(a.supplier).toMatchObject({
        name: 'Socimex SARL',
        nif: nif(1),
        paymentTerms: { kind: 'net', days: 30 },
        defaultCurrency: 'USD',
        active: true,
        mergedInto: null,
        revision: 1,
        paymentMethods: [],
        paymentDetailsChangedAlert: null,
      });
      expect(a.supplier['contacts'][0]['id']).toMatch(/^[0-9a-f]{24}$/);
      expect(a.warnings).toEqual([]);

      const b = await fournisseur('socimex  sarl');
      expect(b.warnings).toEqual([{ code: 'SUPPLIER_SIMILAR_NAME', supplierId: a.supplier['id'] }]);

      code(
        await post(asN(), '/purchases/suppliers', { name: 'Autre', nif: nif(1) }),
        409,
        'SUPPLIER_NIF_EXISTS',
      );
      const dup = await post(asN(), '/purchases/suppliers', { name: 'Autre', nif: nif(1) });
      expect(dup.body.details.supplierId).toBe(a.supplier['id']);
      code(
        await post(asN(), '/purchases/suppliers', { name: 'Mauvaise', defaultCategory: 'zzz' }),
        400,
        'INVALID_REQUEST',
      );

      const liste = ok(await get(asN(), '/purchases/suppliers?q=socimex'));
      expect(liste['items'].map((s: { id: string }) => s.id)).toEqual(
        expect.arrayContaining([a.supplier['id'], b.supplier['id']]),
      );
      // Le Propriétaire détient `treasury.read` : reste dû servi (vide sans facture).
      expect(liste['items'][0]['remainingByCurrency']).toEqual({});
    });

    it('mettre à jour (révision), archiver, restaurer, supprimer', async () => {
      const { supplier } = await fournisseur('Kin Papeterie');
      const id = supplier['id'] as string;
      code(
        await put(asN(), `/purchases/suppliers/${id}`, { expectedRevision: 9, name: 'X' }),
        409,
        'STALE_REVISION',
      );
      const maj = ok(
        await put(asN(), `/purchases/suppliers/${id}`, {
          expectedRevision: 1,
          phone: '+243 99 000 0000',
        }),
      );
      expect(maj['supplier']).toMatchObject({ revision: 2, phone: '+243 99 000 0000' });
      const archive = ok(
        await post(asN(), `/purchases/suppliers/${id}/archive`, { expectedRevision: 2 }),
      );
      expect(archive['active']).toBe(false);
      const visibles = ok(await get(asN(), '/purchases/suppliers?q=papeterie'));
      expect(visibles['items']).toEqual([]);
      const archives = ok(await get(asN(), '/purchases/suppliers?q=papeterie&active=false'));
      expect(archives['items']).toHaveLength(1);
      ok(await post(asN(), `/purchases/suppliers/${id}/restore`, { expectedRevision: 3 }));
      expect(ok(await get(asN(), `/purchases/suppliers/${id}`))['active']).toBe(true);
      const sup = await del(asN(), `/purchases/suppliers/${id}`);
      expect(sup.status).toBe(204);
      code(await get(asN(), `/purchases/suppliers/${id}`), 404, 'SUPPLIER_NOT_FOUND');
    });

    it('suppression refusée quand une dépense vise la fiche', async () => {
      const { supplier } = await fournisseur('Fournisseur utilisé');
      ok(
        await post(asN(), '/treasury/expenses', {
          spentOn: '2026-01-10',
          amount: '5.00',
          currency: 'USD',
          category: 'achats',
          label: 'Achat',
          supplierId: supplier['id'],
        }),
        201,
      );
      const res = await del(asN(), `/purchases/suppliers/${supplier['id']}`);
      code(res, 409, 'SUPPLIER_IN_USE');
      expect(res.body.details.expenses).toBe(1);
    });
  });

  // ── Coordonnées de paiement (§ 2.1.1, critère 14) ───────────────────────

  describe('coordonnées de paiement', () => {
    it('chiffrées en base, masquées partout, jamais au journal ; reveal audité', async () => {
      const { supplier } = await fournisseur(`Banque ${tag}`);
      const ecrit = await compteBancaire(supplier);
      const methode = ecrit['supplier']['paymentMethods'][0];
      expect(methode).toMatchObject({
        kind: 'bank',
        label: 'Compte principal',
        isDefault: true,
        masked: `Rawbank •••• ${COMPTE.slice(-4)}`,
      });
      expect(methode['fingerprint']).toMatch(/^[0-9a-f]{16}$/);
      expect(ecrit['supplier']['paymentDetailsChangedAlert']).toMatchObject({
        by: userIds['owner'],
      });

      // Jamais le clair dans les réponses de lecture…
      const fiche = await get(asN(), `/purchases/suppliers/${supplier['id']}`);
      const liste = await get(asN(), `/purchases/suppliers?q=banque`);
      for (const res of [fiche, liste]) {
        const texte = JSON.stringify(res.body);
        expect(texte).not.toContain(COMPTE);
        expect(texte).not.toContain(IBAN);
        expect(texte).not.toContain('cipher');
        expect(texte).not.toContain('ciphertext');
      }
      // … ni dans le document Mongo…
      const brut = await db
        .collection('suppliers')
        .findOne({ _id: new ObjectId(supplier['id'] as string) });
      const texteBrut = JSON.stringify(brut);
      expect(texteBrut).not.toContain(COMPTE);
      expect(texteBrut).not.toContain(IBAN);
      expect(texteBrut).not.toContain('Socimex SARL');
      expect(brut!['paymentMethods'][0]['cipher']).toMatchObject({
        alg: 'aes-256-gcm',
        keyId: 'k1',
        last4: null,
      });
      // … ni dans le journal d'audit.
      const journal = await db
        .collection('audit_events')
        .find({ organizationId: orgN, targetId: supplier['id'] })
        .toArray();
      expect(journal.map((e) => e['action'])).toContain('supplier.payment_details_changed');
      const texteJournal = JSON.stringify(journal);
      expect(texteJournal).not.toContain(COMPTE);
      expect(texteJournal).not.toContain(IBAN);

      // `reveal` : `payables.pay` seulement ; Administrateur et Lecteur → 403.
      const chemin = `/purchases/suppliers/${supplier['id']}/payment-methods/${methode['id']}/reveal`;
      for (const role of ['admin', 'viewer', 'analyst'] as const) {
        const refus = await post(asN(role), chemin);
        expect(refus.status, role).toBe(403);
      }
      const avant = await db
        .collection('audit_events')
        .countDocuments({ organizationId: orgN, action: 'supplier.payment_details_revealed' });
      const clair = ok(await post(asN('accountant'), chemin));
      expect(clair).toEqual({
        id: methode['id'],
        kind: 'bank',
        details: {
          bankName: 'Rawbank',
          accountHolder: 'Socimex SARL',
          accountNumber: COMPTE,
          iban: IBAN,
          swift: 'RAWBCDKI',
        },
      });
      const trace = await db
        .collection('audit_events')
        .find({ organizationId: orgN, action: 'supplier.payment_details_revealed' })
        .toArray();
      expect(trace).toHaveLength(avant + 1);
      expect(trace[trace.length - 1]).toMatchObject({
        actorUserId: userIds['accountant'],
        targetId: supplier['id'],
      });
      expect(JSON.stringify(trace)).not.toContain(COMPTE);
    });

    it('modifier un IBAN : audit avant/après masqués, notification des payeurs et approbateurs', async () => {
      const { supplier } = await fournisseur(`Notif ${tag}`);
      const ecrit = await compteBancaire(supplier);
      const methode = ecrit['supplier']['paymentMethods'][0];
      const avant = await db.collection('notifications').countDocuments({
        organizationId: orgN,
        kind: 'purchases.supplier_payment_details_changed',
      });
      const maj = ok(
        await put(
          asN('admin'),
          `/purchases/suppliers/${supplier['id']}/payment-methods/${methode['id']}`,
          {
            details: {
              bankName: 'Equity BCDC',
              accountHolder: 'Notif SARL',
              accountNumber: NOUVEAU_COMPTE,
            },
            expectedRevision: ecrit['supplier']['revision'],
          },
        ),
      );
      expect(maj['supplier']['paymentMethods'][0]['masked']).toBe(
        `Equity BCDC •••• ${NOUVEAU_COMPTE.slice(-4)}`,
      );
      expect(maj['supplier']['paymentDetailsChangedAlert']['by']).toBe(userIds['admin']);
      const audit = await db
        .collection('audit_events')
        .find({
          organizationId: orgN,
          targetId: supplier['id'],
          action: 'supplier.payment_details_changed',
        })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
      expect(audit!['metadata']).toMatchObject({
        change: 'updated',
        before: `Rawbank •••• ${COMPTE.slice(-4)}`,
        after: `Equity BCDC •••• ${NOUVEAU_COMPTE.slice(-4)}`,
      });
      const notifs = await db
        .collection('notifications')
        .find({ organizationId: orgN, kind: 'purchases.supplier_payment_details_changed' })
        .toArray();
      const nouvelles = notifs.slice(avant);
      const destinataires = new Set(nouvelles.map((n) => n['recipientUserId']));
      // Payeurs (Propriétaire, Comptable) et approbateurs (Propriétaire) ; pas l'auteur.
      expect(destinataires.has(userIds['owner'])).toBe(true);
      expect(destinataires.has(userIds['accountant'])).toBe(true);
      expect(destinataires.has(userIds['admin'])).toBe(false);
      expect(destinataires.has(userIds['viewer'])).toBe(false);
      expect(JSON.stringify(nouvelles)).not.toContain(NOUVEAU_COMPTE);
    });

    it('deux fournisseurs qui partagent un compte : avertissement ; mobile money masqué', async () => {
      const { supplier: a } = await fournisseur(`Partage A ${tag}`);
      const { supplier: b } = await fournisseur(`Partage B ${tag}`);
      const corps = (s: Record<string, any>) => ({
        kind: 'mobile_money',
        label: 'M-Pesa',
        details: { operator: 'M-Pesa', phoneNumber: TELEPHONE, holderName: 'Jean' },
        expectedRevision: s['revision'],
      });
      const ra = ok(
        await post(asN(), `/purchases/suppliers/${a['id']}/payment-methods`, corps(a)),
        201,
      );
      expect(ra['warnings']).toEqual([]);
      expect(ra['supplier']['paymentMethods'][0]['masked']).toBe(
        `M-Pesa •••• ${TELEPHONE.replace(/\D/g, '').slice(-2)}`,
      );
      const rb = ok(
        await post(asN(), `/purchases/suppliers/${b['id']}/payment-methods`, corps(b)),
        201,
      );
      expect(rb['warnings']).toEqual([
        { code: 'SUPPLIER_PAYMENT_DETAILS_SHARED', supplierId: a['id'] },
      ]);
      const sans = ok(
        await del(
          asN(),
          `/purchases/suppliers/${b['id']}/payment-methods/${rb['supplier']['paymentMethods'][0]['id']}`,
          { expectedRevision: rb['supplier']['revision'] },
        ),
      );
      expect(sans['supplier']['paymentMethods']).toEqual([]);
    });

    it('un chiffré recopié vers une autre fiche ne se déchiffre pas', async () => {
      const { supplier: a } = await fournisseur(`Source chiffré ${tag}`);
      const ecrit = await compteBancaire(a);
      const { supplier: b } = await fournisseur(`Cible chiffré ${tag}`);
      const brut = await db
        .collection('suppliers')
        .findOne({ _id: new ObjectId(a['id'] as string) });
      await db
        .collection('suppliers')
        .updateOne(
          { _id: new ObjectId(b['id'] as string) },
          { $set: { paymentMethods: brut!['paymentMethods'] } },
        );
      const methodId = ecrit['supplier']['paymentMethods'][0]['id'];
      const res = await post(
        asN(),
        `/purchases/suppliers/${b['id']}/payment-methods/${methodId}/reveal`,
      );
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain(COMPTE);
    });
  });

  // ── Fusion ───────────────────────────────────────────────────────────────

  describe('fusion', () => {
    it('réassigne dépenses, règles et clés ; la source garde mergedInto ; NIF différents refusés', async () => {
      const { supplier: source } = await fournisseur(`Fusion source ${tag}`, { nif: nif(10) });
      const { supplier: cible } = await fournisseur(`Fusion cible ${tag}`);
      const { supplier: autre } = await fournisseur(`Fusion autre ${tag}`, { nif: nif(11) });
      await db
        .collection('suppliers')
        .updateOne(
          { _id: new ObjectId(source['id'] as string) },
          { $set: { legacyKeys: [`fusion ${tag}`] } },
        );
      const dep = ok(
        await post(asN(), '/treasury/expenses', {
          spentOn: '2026-02-01',
          amount: '12.00',
          currency: 'USD',
          category: 'achats',
          label: 'Avant fusion',
          supplierId: source['id'],
        }),
        201,
      );
      code(
        await post(asN(), `/purchases/suppliers/${source['id']}/merge`, {
          targetSupplierId: autre['id'],
          expectedRevision: 1,
        }),
        409,
        'SUPPLIER_MERGE_NIF_MISMATCH',
      );
      code(
        await post(asN(), `/purchases/suppliers/${source['id']}/merge`, {
          targetSupplierId: source['id'],
          expectedRevision: 1,
        }),
        409,
        'SUPPLIER_MERGE_INTO_SELF',
      );
      code(
        await post(asN('viewer'), `/purchases/suppliers/${source['id']}/merge`, {
          targetSupplierId: cible['id'],
          expectedRevision: 1,
        }),
        403,
        'FORBIDDEN',
      );
      const fusion = ok(
        await post(asN(), `/purchases/suppliers/${source['id']}/merge`, {
          targetSupplierId: cible['id'],
          expectedRevision: 1,
        }),
      );
      expect(fusion['moved']).toMatchObject({ expenses: 1, legacyKeys: 1 });
      expect(fusion['supplier']).toMatchObject({ id: cible['id'], nif: nif(10) });
      const s = ok(await get(asN(), `/purchases/suppliers/${source['id']}`));
      expect(s).toMatchObject({ mergedInto: cible['id'], active: false, nif: null });
      expect(
        (await db
          .collection('treasury_expenses')
          .findOne({ _id: new ObjectId(dep['id'] as string) }))!['supplierId'],
      ).toBe(cible['id']);
      const liste = ok(await get(asN(), `/purchases/suppliers?q=fusion source`));
      expect(liste['items']).toEqual([]);
      // Une saisie texte de l'ancienne clé est désormais rattachée à la cible.
      const texte = ok(
        await post(asN(), '/treasury/expenses', {
          spentOn: '2026-02-02',
          amount: '3.00',
          currency: 'USD',
          category: 'achats',
          label: 'Texte',
          supplierName: `FUSION  ${tag.toUpperCase()}`,
        }),
        201,
      );
      expect(texte['supplierId']).toBe(cible['id']);
      expect(
        (await db.collection('audit_events').findOne({
          organizationId: orgN,
          action: 'supplier.merged',
          targetId: source['id'],
        }))!['metadata'],
      ).toMatchObject({ into: cible['id'], expenses: 1 });
    });
  });

  // ── Trésorerie (§ 2.8) ───────────────────────────────────────────────────

  describe('trésorerie', () => {
    it('supplierId posé : le nom devient la copie de la fiche ; null : fournisseur de passage', async () => {
      const { supplier } = await fournisseur(`Kin Énergie ${tag}`);
      const d = ok(
        await post(asN(), '/treasury/expenses', {
          spentOn: '2026-03-01',
          amount: '40.00',
          currency: 'USD',
          category: 'achats',
          label: 'Carburant',
          supplierName: 'texte ignoré',
          supplierId: supplier['id'],
        }),
        201,
      );
      expect(d).toMatchObject({ supplierId: supplier['id'], supplierName: `Kin Énergie ${tag}` });
      const passage = ok(
        await put(asN(), `/treasury/expenses/${d['id']}`, {
          expectedRevision: d['revision'],
          expense: {
            spentOn: '2026-03-01',
            amount: '40.00',
            currency: 'USD',
            category: 'achats',
            label: 'Carburant',
            supplierName: 'Station de passage',
            supplierId: null,
          },
        }),
      );
      expect(passage).toMatchObject({ supplierId: null, supplierName: 'Station de passage' });

      const regle = ok(
        await post(asN(), '/treasury/recurring-expenses', {
          label: 'Loyer',
          amount: '100.00',
          currency: 'USD',
          category: 'achats',
          supplierId: supplier['id'],
          frequency: 'monthly',
          startDate: '2026-01-01',
        }),
        201,
      );
      expect(regle['supplierId']).toBe(supplier['id']);

      const auto = ok(
        await get(asN(), `/treasury/suppliers?q=${encodeURIComponent('kin energie')}`),
      );
      expect(auto['entries']).toEqual(
        expect.arrayContaining([{ name: `Kin Énergie ${tag}`, supplierId: supplier['id'] }]),
      );
      const libres = ok(await get(asN(), '/treasury/suppliers?q=passage'));
      expect(libres['entries']).toEqual([{ name: 'Station de passage', supplierId: null }]);
      expect(libres['items']).toEqual(['Station de passage']);
    });

    it('fiche archivée refusée ; fiche d’une autre organisation : 404', async () => {
      const { supplier } = await fournisseur(`Archivé ${tag}`);
      ok(
        await post(asN(), `/purchases/suppliers/${supplier['id']}/archive`, {
          expectedRevision: 1,
        }),
      );
      const corps = (supplierId: string) => ({
        spentOn: '2026-03-02',
        amount: '1.00',
        currency: 'USD',
        category: 'achats',
        label: 'X',
        supplierId,
      });
      code(
        await post(asN(), '/treasury/expenses', corps(supplier['id'])),
        409,
        'SUPPLIER_ARCHIVED',
      );
      const { supplier: deB } = await fournisseur(`Fiche B ${tag}`, {}, asB());
      code(
        await post(asN(), '/treasury/expenses', corps(deB['id'])),
        404,
        'EXPENSE_SUPPLIER_UNKNOWN',
      );
    });
  });

  // ── Droits et isolation (critères 1 et 17) ───────────────────────────────

  describe('droits et isolation', () => {
    it('lecture : Lecteur et Analyste lisent, Commercial et Conseiller non ; écriture : Administrateur oui, Analyste non', async () => {
      for (const role of ['viewer', 'analyst', 'admin', 'accountant'] as const) {
        expect((await get(asN(role), '/purchases/suppliers')).status, role).toBe(200);
      }
      for (const role of ['sales_rep', 'advisor'] as const) {
        code(await get(asN(role), '/purchases/suppliers'), 403, 'FORBIDDEN');
      }
      code(await post(asN('analyst'), '/purchases/suppliers', { name: 'X' }), 403, 'FORBIDDEN');
      code(await post(asN('viewer'), '/purchases/suppliers', { name: 'X' }), 403, 'FORBIDDEN');
      await fournisseur(`Par admin ${tag}`, {}, asN('admin'));
      // Lecteur : `purchase.read` sans `treasury.read`? Le Lecteur a `treasury.read` ;
      // l'Analyste aussi : le reste dû leur est servi.
      const liste = ok(await get(asN('viewer'), '/purchases/suppliers'));
      expect(liste['items'][0]['remainingByCurrency']).not.toBeNull();
      code(
        await get(asN('admin'), '/purchases/suppliers/migration-report'),
        404,
        'SUPPLIER_MIGRATION_REPORT_NOT_FOUND',
      );
      code(await get(asN('viewer'), '/purchases/suppliers/migration-report'), 403, 'FORBIDDEN');
    });

    it('toute route rend 404 pour une fiche d’une autre organisation', async () => {
      const { supplier: a } = await fournisseur(`Isolé ${tag}`);
      const ecrit = await compteBancaire(a);
      const methodId = ecrit['supplier']['paymentMethods'][0]['id'];
      const id = a['id'] as string;
      const b = asB();
      code(await get(b, `/purchases/suppliers/${id}`), 404, 'SUPPLIER_NOT_FOUND');
      code(
        await put(b, `/purchases/suppliers/${id}`, { expectedRevision: 1, name: 'X' }),
        404,
        'SUPPLIER_NOT_FOUND',
      );
      code(
        await post(b, `/purchases/suppliers/${id}/archive`, { expectedRevision: 1 }),
        404,
        'SUPPLIER_NOT_FOUND',
      );
      code(await del(b, `/purchases/suppliers/${id}`), 404, 'SUPPLIER_NOT_FOUND');
      code(
        await post(b, `/purchases/suppliers/${id}/payment-methods/${methodId}/reveal`),
        404,
        'SUPPLIER_NOT_FOUND',
      );
      // Fusion vers une fiche forgée d'une autre organisation.
      const { supplier: deB } = await fournisseur(`Cible B ${tag}`, {}, b);
      code(
        await post(asN(), `/purchases/suppliers/${id}/merge`, {
          targetSupplierId: deB['id'],
          expectedRevision: ecrit['supplier']['revision'],
        }),
        404,
        'SUPPLIER_NOT_FOUND',
      );
      const listeB = ok(await get(b, '/purchases/suppliers'));
      expect(listeB['items'].map((s: { id: string }) => s.id)).not.toContain(id);
      code(await get(asN(), '/purchases/suppliers/not-an-id'), 404, 'SUPPLIER_NOT_FOUND');
    });
  });
});
