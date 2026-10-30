// CSV v2 du CRM contre la vraie application (ADR-0040 — C9 ; ADR-0035 § 2).
//
// Colonnes facultatives `compte` (contacts, opportunités), `responsable`,
// `motif_perte`, `detail_perte` (opportunités), à l'import et à l'export.
// Couvre : compatibilité d'un fichier ADR-0035, motif exigé pour une perdue
// (sans défaut), compte inconnu ou ambigu, responsable inéligible (droits
// effectifs), essai à blanc sans écriture, isolation entre organisations, aller
// et retour d'un export.
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

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
process.env['MONGODB_DB'] = `lalanda_e2e_crm_csv_v2_${tag}`;

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!crm-csv-v2';
const ROLES = ['sales_rep', 'viewer'] as const;
type Role = 'owner' | (typeof ROLES)[number];
type Compte = Role | 'ownerB';

const OPP_V1 = 'titre;etape;montant;devise;cloture_prevue;prospect;nif_client;email_contact';
const OPP_V2 = `${OPP_V1};compte;responsable;motif_perte;detail_perte`;

e2eSuite('CSV v2 du CRM (ADR-0040 C9)', () => {
  let app: INestApplication;
  let db: Db;
  let orgN = '';
  let orgB = '';
  let customer = '';
  let nif = '';
  let prospect = '';
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
  const rejected = (res: request.Response) => {
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('CSV_IMPORT_INVALID');
    return res.body.details.errors as { line: number; message: string }[];
  };
  const count = (collection: string, filter: Record<string, unknown> = {}) =>
    db.collection(collection).countDocuments({ organizationId: orgN, ...filter });
  const importOpp = (csv: string, dryRun = false, c = asN()) =>
    post(c, '/crm/opportunities/import', { csv, dryRun });

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    for (const c of ['owner', ...ROLES, 'ownerB'] as const) {
      emails[c] = `crm-csv-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({ email: emails[c], password: MOT_DE_PASSE, name: `CSV ${c}` });
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

    nif = `T${tag.toUpperCase()}01`;
    customer = ok(
      await post(asN(), '/sales/customers', { type: 'PM', name: 'Client CSV SARL', nif }),
      201,
    ).id;
    prospect = ok(await post(asN(), '/crm/accounts', { name: 'Prospect Unique' }), 201).account.id;
    // Deux comptes homonymes (autorisés, avertissement seulement).
    ok(await post(asN(), '/crm/accounts', { name: 'Homonyme' }), 201);
    ok(await post(asN(), '/crm/accounts', { name: 'Homonyme' }), 201);
    // Compte d'une autre organisation : jamais visible par N.
    ok(await post(asB(), '/crm/accounts', { name: 'Secret de B' }), 201);
  }, 300_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, 60_000);

  it('compatibilité : un fichier ADR-0035 (ouverte, NIF, prospect) est accepté tel quel', async () => {
    const res = ok(
      await importOpp(
        `${OPP_V1}\nAncienne;Proposition;"1 000,00";usd;;;${nif};\nAutre;;;;;Nouveau Prospect V1;;\n`,
      ),
    );
    expect(res).toEqual({ dryRun: false, rows: 2, created: 2 });
    const doc = await db
      .collection('crm_opportunities')
      .findOne({ organizationId: orgN, title: 'Ancienne' });
    expect(doc).toMatchObject({ customerId: customer, ownerId: userIds['owner'] });
    expect(typeof doc!['accountId']).toBe('string');

    const contacts = ok(
      await post(asN(), '/crm/contacts/import', {
        csv: `nom;fonction;email;telephone;entreprise;nif_client\nAncien;;ancien@exemple.cd;;;${nif}\n`,
      }),
    );
    expect(contacts.created).toBe(1);
  });

  it('ancien fichier avec une opportunité perdue sans motif : erreur de ligne explicite, rien créé', async () => {
    const avant = await count('crm_opportunities');
    const errors = rejected(
      await importOpp(
        `${OPP_V1}\nOuverte;;;;;Prospect Unique;;\nPerdue;Perdu;;;;Prospect Unique;;\n`,
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe(3);
    expect(errors[0]!.message).toMatch(/motif de perte obligatoire/);
    expect(await count('crm_opportunities')).toBe(avant);
  });

  it('v2 : compte par nom, responsable par e-mail, motif par libellé et détail', async () => {
    const res = ok(
      await importOpp(
        `${OPP_V2}\nGagnable;;500;;;;;;prospect unique;${emails['sales_rep'].toUpperCase()};;\nPerdue v2;Perdu;;;;;;;Prospect Unique;;Prix;Trop cher\nClient v2;;;;;;${nif};;Client CSV SARL;;;\n`,
      ),
    );
    expect(res.created).toBe(3);
    const docs = await db
      .collection('crm_opportunities')
      .find({ organizationId: orgN, title: { $in: ['Gagnable', 'Perdue v2', 'Client v2'] } })
      .toArray();
    const by = (t: string) => docs.find((d) => d['title'] === t)!;
    expect(by('Gagnable')).toMatchObject({ accountId: prospect, ownerId: userIds['sales_rep'] });
    expect(by('Perdue v2')).toMatchObject({
      accountId: prospect,
      status: 'lost',
      lostReasonKey: 'price',
      lostReason: 'Trop cher',
      ownerId: userIds['owner'],
    });
    expect(by('Client v2')).toMatchObject({ customerId: customer });

    const contacts = ok(
      await post(asN(), '/crm/contacts/import', {
        csv: `nom;email;compte\nAwa;awa@exemple.cd;Prospect Unique\n`,
      }),
    );
    expect(contacts.created).toBe(1);
    const awa = await db.collection('crm_contacts').findOne({ organizationId: orgN, name: 'Awa' });
    expect(awa).toMatchObject({ accountId: prospect, companyName: 'Prospect Unique' });
  });

  it('refus par ligne : compte inconnu, ambigu, d’une autre organisation, NIF incohérent ; responsable inéligible ou étranger ; motif inconnu', async () => {
    const avantOpp = await count('crm_opportunities');
    const avantComptes = await count('crm_accounts');
    const errors = rejected(
      await importOpp(
        [
          OPP_V2,
          'A;;;;;;;;Inconnu SA;;;',
          'B;;;;;;;;Homonyme;;;',
          'C;;;;;;;;Secret de B;;;',
          `D;;;;;;${nif};;Prospect Unique;;;`,
          `E;;;;;;;;Prospect Unique;${emails['viewer']};;`,
          `F;;;;;;;;Prospect Unique;${emails['ownerB']};;`,
          'G;Perdu;;;;;;;Prospect Unique;;Météo;',
          'H;;;;;Prospect Créé Jamais;;;;;;',
        ].join('\n'),
      ),
    );
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(errors[0]!.message).toMatch(/compte inconnu : « Inconnu SA »/);
    expect(errors[1]!.message).toMatch(/compte ambigu .* 2 comptes/);
    expect(errors[2]!.message).toMatch(/compte inconnu : « Secret de B »/);
    expect(errors[3]!.message).toMatch(/n’est pas celui du client de NIF/);
    expect(errors[4]!.message).toMatch(/ne peut pas être responsable/);
    expect(errors[5]!.message).toMatch(/responsable inconnu/);
    expect(errors[6]!.message).toMatch(/motif de perte inconnu/);
    // Tout ou rien : ni opportunité, ni prospect créé par la ligne valide.
    expect(await count('crm_opportunities')).toBe(avantOpp);
    expect(await count('crm_accounts')).toBe(avantComptes);

    const contact = rejected(
      await post(asN(), '/crm/contacts/import', { csv: `nom;compte\nZ;Homonyme\n` }),
    );
    expect(contact[0]).toMatchObject({ line: 2, message: expect.stringMatching(/ambigu/) });
  });

  it('essai à blanc : rien n’est écrit, pas même le prospect d’un ancien fichier', async () => {
    const avant = await count('crm_accounts');
    const res = ok(await importOpp(`${OPP_V1}\nEssai;;;;;Prospect Essai Blanc;;\n`, true));
    expect(res).toEqual({ dryRun: true, rows: 1, created: 0 });
    expect(await count('crm_accounts')).toBe(avant);
  });

  it('export v2 : colonnes ajoutées en fin de ligne, réimportable, journalisé ; isolé par organisation', async () => {
    const exp = await request(server())
      .get('/crm/opportunities/export')
      .set('Cookie', asN())
      .buffer(true);
    expect(exp.status).toBe(200);
    const csv = exp.text;
    expect(csv.startsWith(`﻿${OPP_V2}\r\n`)).toBe(true);
    expect(csv).toContain(
      `Perdue v2;lost;;CDF;;Prospect Unique;;;Prospect Unique;${emails['owner']};price;Trop cher`,
    );
    expect(csv).toContain(`;Prospect Unique;${emails['sales_rep']};;`);
    expect(csv).not.toContain('Secret de B');
    // Aller et retour : l'export se réimporte (essai).
    const relu = ok(await importOpp(csv, true));
    expect(relu.rows).toBeGreaterThanOrEqual(5);

    const contacts = await request(server())
      .get('/crm/contacts/export')
      .set('Cookie', asN())
      .buffer(true);
    expect(
      contacts.text.startsWith(
        '﻿nom;fonction;email;telephone;entreprise;nif_client;notes;compte\r\n',
      ),
    ).toBe(true);
    expect(contacts.text).toContain('Awa;;awa@exemple.cd;;Prospect Unique;;;Prospect Unique');

    // Organisation B : son export ne voit rien de N.
    const b = await request(server())
      .get('/crm/opportunities/export')
      .set('Cookie', asB())
      .buffer(true);
    expect(b.status).toBe(200);
    expect(b.text).not.toContain('Prospect Unique');
    expect(
      await db.collection('audit_events').countDocuments({
        organizationId: orgN,
        action: 'crm.opportunities_exported',
      }),
    ).toBe(1);
    expect(ObjectId.isValid(prospect)).toBe(true);
  });
});
