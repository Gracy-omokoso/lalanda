// Contrats, versions, avenants, signature, reconduction, résiliation — ADR-0050, lot V3.
//
// Critères d'acceptation couverts : 1 (permissions des contrats : Commercial, Comptable,
// Administrateur, Lecteur, Analyste, Conseiller), 2 (séparation des tâches, approbateur
// unique, réglage), 5 (contrat : brouillon seul modifiable, nouvelle version, copie
// signée exigée, empreinte), 6 (avenant : `termsAt` avant et après la date d'effet,
// échéance déjà préparée, avenant non signé sans effet), 7 (fin de terme et date limite
// de préavis), 8 (reconduction tacite CONSTATÉE par un humain, `maxRenewals`), 14
// (résiliation en deçà du préavis saisi : affichée, acceptée), 16 (copies : PDF seul,
// téléchargement inerte, ajout seul), 17 (isolation), 18 (mots interdits). Règle
// absolue : aucune facture n'est créée par ce lot ; la signature est DÉCLARÉE (PDF
// téléversé), jamais électronique.
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

import 'reflect-metadata';

import { randomBytes } from 'node:crypto';

import { findForbiddenSalesContractWords } from '@lalanda/shared/sales-contracts';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { e2eSuite, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

const fiche = (nif: string) => ({
  legalName: 'Exemple SARL',
  tradeName: null,
  legalForm: 'sarl',
  legalFormOther: null,
  nif,
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
});

/** Ligne libre au groupe B. */
const ligne = (name: string, quantity: string, unitPrice: string) => ({
  source: 'free',
  code: null,
  name,
  itemType: 'SER',
  taxGroup: 'B',
  outOfScope: false,
  unit: 'mois',
  quantity,
  unitPrice,
  specificTax: null,
  discount: null,
});

const PDF = Buffer.from('%PDF-1.4\n% contrat signé\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');

const SIGNATAIRES = [
  { name: 'Client Signataire', title: 'Directeur', side: 'customer' },
  { name: 'Gérant', title: null, side: 'organization' },
];

type Who = 'owner' | 'admin' | 'accountant' | 'analyst' | 'advisor' | 'viewer' | 'ownerB';
type Actor = Who | 'rep' | 'dir';

e2eSuite('contrats, avenants, signature et résiliation (ADR-0050, V3)', () => {
  const f = useWorkFixture('scontracts');
  let customer = '';
  let customerB = '';
  const extra: Record<'rep' | 'dir', string[]> = { rep: [], dir: [] };
  const extraIds: Record<'rep' | 'dir', string> = { rep: '', dir: '' };

  const ok = (res: { status: number; body: unknown }, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const code = (res: { status: number; body: any }, status: number, c: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code, JSON.stringify(res.body)).toBe(c);
  };
  const cookies = (who: Actor) =>
    who === 'rep' || who === 'dir' ? [...extra[who], `active_org_id=${f.orgId()}`] : f.as(who);
  const srv = () => request(f.app().getHttpServer());
  const post = (who: Actor, path: string, body?: unknown) =>
    srv()
      .post(path)
      .set('Cookie', cookies(who))
      .send((body ?? {}) as object);
  const put = (who: Actor, path: string, body: unknown) =>
    srv()
      .put(path)
      .set('Cookie', cookies(who))
      .send(body as object);
  const del = (who: Actor, path: string) => srv().delete(path).set('Cookie', cookies(who));
  const upload = (who: Actor, path: string, body: Buffer = PDF) =>
    srv()
      .post(path)
      .set('Cookie', cookies(who))
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'contrat-signe.pdf')
      .send(body);

  const corps = (more: Record<string, unknown> = {}) => ({
    title: 'Maintenance du parc informatique',
    startDate: '2027-01-15',
    initialTermMonths: 12,
    renewal: { mode: 'tacit', periodMonths: 12, maxRenewals: null },
    noticeDays: 30,
    billing: { kind: 'none' },
    currency: 'USD',
    priceMode: 'ht',
    customer: { customerId: customer, printContactDetails: false },
    lines: [ligne('Maintenance mensuelle', '1', '500.00')],
    ...more,
  });

  /** Préparé par `author`, soumis, approuvé par `approver`, copie signée, signé. */
  async function contratSigne(
    more: Record<string, unknown> = {},
    author: Actor = 'rep',
    approver: Actor = 'owner',
  ): Promise<Record<string, any>> {
    const c = ok(await post(author, '/sales/contracts', corps(more)), 201);
    const s = ok(
      await post(author, `/sales/contracts/${c.id}/submit`, { expectedRevision: c.revision }),
    );
    const a = ok(
      await post(approver, `/sales/contracts/${c.id}/approve`, { expectedRevision: s.revision }),
    );
    const file = ok(await upload(author, `/sales/contracts/${c.id}/files?kind=signed_copy`), 201);
    return ok(
      await post(author, `/sales/contracts/${c.id}/signature`, {
        expectedRevision: a.revision,
        signedOn: '2027-01-10',
        signatories: SIGNATAIRES,
        fileId: file.id,
      }),
    );
  }

  /** Avenant préparé, soumis, approuvé, copie signée, signé. */
  async function avenantSigne(
    contractId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, any>> {
    const base = `/sales/contracts/${contractId}/amendments`;
    const a = ok(await post('rep', base, body), 201);
    const s = ok(await post('rep', `${base}/${a.id}/submit`, { expectedRevision: a.revision }));
    const ap = ok(await post('owner', `${base}/${a.id}/approve`, { expectedRevision: s.revision }));
    const file = ok(
      await upload(
        'rep',
        `/sales/contracts/${contractId}/files?kind=signed_copy&amendmentId=${a.id}`,
      ),
      201,
    );
    return ok(
      await post('rep', `${base}/${a.id}/signature`, {
        expectedRevision: ap.revision,
        signedOn: '2027-02-20',
        signatories: SIGNATAIRES,
        fileId: file.id,
      }),
    );
  }

  async function inviter(role: 'sales_rep' | 'finance_director', key: 'rep' | 'dir', tag: string) {
    const email = `scontracts-${key}-${tag}@lalanda-test.local`;
    const inv = await f.post('owner', `/organizations/${f.orgId()}/invitations`, { email, role });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    extra[key] = await registerAndLogin(f.app(), {
      email,
      password: 'Passw0rd!contrats',
      name: key === 'rep' ? 'Commercial' : 'Directeur financier',
    });
    const acc = await srv()
      .post('/invitations/accept')
      .set('Cookie', extra[key])
      .send({ token: inv.body.token });
    expect(acc.status).toBe(201);
  }

  beforeAll(async () => {
    ok(await f.put('owner', '/organizations/current/fiscal-profile', fiche('A1111111X')));
    ok(await f.put('ownerB', '/organizations/current/fiscal-profile', fiche('B2222222X')));
    await f
      .db()
      .collection('edef_reference_snapshots')
      .insertOne({
        environment: 'test',
        list: 'taxGroups',
        sha256: randomBytes(32).toString('hex'),
        payload: {
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
        },
        fetchedAt: new Date(),
        _schemaVersion: 1,
      });
    const tag = randomBytes(3).toString('hex').toUpperCase();
    customer = ok(
      await f.post('owner', '/sales/customers', {
        type: 'PM',
        name: 'Client Gombe SARL',
        nif: `T${tag}01`,
      }),
      201,
    ).id;
    customerB = ok(
      await f.post('ownerB', '/sales/customers', {
        type: 'PM',
        name: 'Client B',
        nif: `T${tag}02`,
      }),
      201,
    ).id;
    await inviter('sales_rep', 'rep', tag.toLowerCase());
    await inviter('finance_director', 'dir', tag.toLowerCase());
    const members = ok(await f.get('owner', `/organizations/${f.orgId()}/members`));
    for (const m of members.members as { userId: string; role: string }[]) {
      if (m.role === 'sales_rep') extraIds.rep = m.userId;
      if (m.role === 'finance_director') extraIds.dir = m.userId;
    }
  }, E2E_HOOK_TIMEOUT_MS);

  // ── Permissions (critère 1) ──────────────────────────────────────────────

  describe('permissions (critère 1)', () => {
    it('le Commercial crée, modifie et soumet ; 403 sur approuver, résilier, constater', async () => {
      const c = ok(await post('rep', '/sales/contracts', corps()), 201);
      expect(c).toMatchObject({ status: 'draft', version: 1, ownerUserId: extraIds.rep });
      expect(c.number).toMatch(/^CT\d{4}-\d{6}$/);
      const p = ok(
        await put('rep', `/sales/contracts/${c.id}`, {
          ...corps({ title: 'Maintenance (révisé)' }),
          expectedRevision: c.revision,
        }),
      );
      const s = ok(
        await post('rep', `/sales/contracts/${c.id}/submit`, { expectedRevision: p.revision }),
      );
      expect(s.status).toBe('submitted');
      for (const path of ['approve', 'reject', 'renewals', 'terminate']) {
        const res = await post('rep', `/sales/contracts/${c.id}/${path}`, {
          expectedRevision: s.revision,
        });
        expect(res.status, path).toBe(403);
      }
      expect((await put('rep', '/sales/contract-settings', {})).status).toBe(403);
    });

    it('Comptable et Administrateur préparent sans approuver ; Lecteur et Analyste lisent ; Conseiller refusé', async () => {
      for (const who of ['accountant', 'admin'] as const) {
        const c = ok(await f.post(who, '/sales/contracts', corps()), 201);
        const s = ok(
          await f.post(who, `/sales/contracts/${c.id}/submit`, { expectedRevision: c.revision }),
        );
        expect(
          (await f.post(who, `/sales/contracts/${c.id}/approve`, { expectedRevision: s.revision }))
            .status,
          who,
        ).toBe(403);
      }
      for (const who of ['viewer', 'analyst'] as const) {
        ok(await f.get(who, '/sales/contracts'));
        ok(await f.get(who, '/sales/contract-settings'));
        expect((await f.post(who, '/sales/contracts', corps())).status, who).toBe(403);
      }
      expect((await f.get('advisor', '/sales/contracts')).status).toBe(403);
    });

    it('responsable sans `sales.read` effectif → 422 OWNER_WITHOUT_SALES_READ', async () => {
      code(
        await f.post('owner', '/sales/contracts', corps({ ownerUserId: f.userId('advisor') })),
        422,
        'OWNER_WITHOUT_SALES_READ',
      );
      const c = ok(
        await f.post('owner', '/sales/contracts', corps({ ownerUserId: f.userId('viewer') })),
        201,
      );
      expect(c.ownerUserId).toBe(f.userId('viewer'));
    });
  });

  // ── Séparation des tâches (critère 2) ────────────────────────────────────

  describe('séparation des tâches (critère 2)', () => {
    it('deux détenteurs : celui qui a soumis ou créé n’approuve pas ; l’autre approuve', async () => {
      const c = ok(await post('dir', '/sales/contracts', corps()), 201);
      const s = ok(
        await post('dir', `/sales/contracts/${c.id}/submit`, { expectedRevision: c.revision }),
      );
      code(
        await post('dir', `/sales/contracts/${c.id}/approve`, { expectedRevision: s.revision }),
        409,
        'SELF_APPROVAL_FORBIDDEN',
      );
      code(
        await post('dir', `/sales/contracts/${c.id}/reject`, {
          expectedRevision: s.revision,
          comment: 'non',
        }),
        409,
        'SELF_APPROVAL_FORBIDDEN',
      );
      const a = ok(
        await f.post('owner', `/sales/contracts/${c.id}/approve`, { expectedRevision: s.revision }),
      );
      expect(a.status).toBe('approved');
      expect(a.approvals).toEqual([
        expect.objectContaining({
          userId: f.userId('owner'),
          decision: 'approved',
          soleApprover: false,
        }),
      ]);

      // Créé par le Propriétaire, soumis par le Commercial : le créateur n'approuve pas.
      const c2 = ok(await f.post('owner', '/sales/contracts', corps()), 201);
      const s2 = ok(
        await post('rep', `/sales/contracts/${c2.id}/submit`, { expectedRevision: c2.revision }),
      );
      code(
        await f.post('owner', `/sales/contracts/${c2.id}/approve`, {
          expectedRevision: s2.revision,
        }),
        409,
        'SELF_APPROVAL_FORBIDDEN',
      );
      ok(await post('dir', `/sales/contracts/${c2.id}/approve`, { expectedRevision: s2.revision }));
    });

    it('seul détenteur : approbation marquée `soleApprover` ; réglage à false → 409', async () => {
      const corpsB = corps({ customer: { customerId: customerB, printContactDetails: false } });
      const c = ok(await f.post('ownerB', '/sales/contracts', corpsB), 201);
      const s = ok(
        await f.post('ownerB', `/sales/contracts/${c.id}/submit`, { expectedRevision: c.revision }),
      );
      const a = ok(
        await f.post('ownerB', `/sales/contracts/${c.id}/approve`, {
          expectedRevision: s.revision,
        }),
      );
      expect(a.approvals[0]).toMatchObject({ decision: 'approved', soleApprover: true });

      const reglage = ok(await f.get('ownerB', '/sales/contract-settings'));
      expect(reglage).toMatchObject({
        revision: null,
        allowSoleApprover: true,
        noticeAlertDays: 30,
      });
      const corpsReglage = {
        noticeAlertDays: 30,
        termEndAlertDays: 60,
        subscriptionLeadDays: 0,
        autoPrepareSubscriptionDrafts: true,
        allowSoleApprover: false,
      };
      expect(
        ok(
          await f.put('ownerB', '/sales/contract-settings', {
            ...corpsReglage,
            expectedRevision: null,
          }),
        ),
      ).toMatchObject({ revision: 1, allowSoleApprover: false });
      code(
        await f.put('ownerB', '/sales/contract-settings', {
          ...corpsReglage,
          expectedRevision: null,
        }),
        409,
        'STALE_REVISION',
      );
      const c2 = ok(await f.post('ownerB', '/sales/contracts', corpsB), 201);
      const s2 = ok(
        await f.post('ownerB', `/sales/contracts/${c2.id}/submit`, {
          expectedRevision: c2.revision,
        }),
      );
      code(
        await f.post('ownerB', `/sales/contracts/${c2.id}/approve`, {
          expectedRevision: s2.revision,
        }),
        409,
        'SELF_APPROVAL_FORBIDDEN',
      );
      ok(
        await f.put('ownerB', '/sales/contract-settings', {
          ...corpsReglage,
          allowSoleApprover: true,
          expectedRevision: 1,
        }),
      );
    });
  });

  // ── Cycle du contrat (critère 5) ─────────────────────────────────────────

  describe('cycle, versions et signature (critère 5)', () => {
    it('brouillon seul modifiable ; nouvelle version ; copie signée exigée ; empreinte ; immuable', async () => {
      const c = ok(await post('rep', '/sales/contracts', corps()), 201);
      const s = ok(
        await post('rep', `/sales/contracts/${c.id}/submit`, { expectedRevision: c.revision }),
      );
      code(
        await put('rep', `/sales/contracts/${c.id}`, { ...corps(), expectedRevision: s.revision }),
        409,
        'CONTRACT_NOT_DRAFT',
      );
      const v2 = ok(
        await post('rep', `/sales/contracts/${c.id}/new-version`, { expectedRevision: s.revision }),
      );
      expect(v2).toMatchObject({ status: 'draft', version: 2 });
      expect(v2.previousVersions).toEqual([
        expect.objectContaining({ version: 1, status: 'submitted' }),
      ]);
      code(await del('rep', `/sales/contracts/${c.id}`), 409, 'CONTRACT_ALREADY_SUBMITTED');
      const p = ok(
        await put('rep', `/sales/contracts/${c.id}`, {
          ...corps({ lines: [ligne('Maintenance mensuelle', '1', '550.00')] }),
          expectedRevision: v2.revision,
        }),
      );
      const s2 = ok(
        await post('rep', `/sales/contracts/${c.id}/submit`, { expectedRevision: p.revision }),
      );
      const a = ok(
        await f.post('owner', `/sales/contracts/${c.id}/approve`, {
          expectedRevision: s2.revision,
        }),
      );
      const brouillon = ok(
        await upload('rep', `/sales/contracts/${c.id}/files?kind=draft_copy`),
        201,
      );
      const signature = {
        expectedRevision: a.revision,
        signedOn: '2027-01-10',
        signatories: SIGNATAIRES,
      };
      code(
        await post('rep', `/sales/contracts/${c.id}/signature`, { ...signature, fileId: null }),
        422,
        'SIGNED_COPY_REQUIRED',
      );
      code(
        await post('rep', `/sales/contracts/${c.id}/signature`, {
          ...signature,
          fileId: brouillon.id,
        }),
        422,
        'SIGNED_COPY_REQUIRED',
      );
      const sansClient = await post('rep', `/sales/contracts/${c.id}/signature`, {
        ...signature,
        signatories: [SIGNATAIRES[1]],
        fileId: null,
      });
      expect(sansClient.status).toBe(400);
      const copie = ok(await upload('rep', `/sales/contracts/${c.id}/files?kind=signed_copy`), 201);
      const signe = ok(
        await post('rep', `/sales/contracts/${c.id}/signature`, { ...signature, fileId: copie.id }),
      );
      expect(signe.status).toBe('signed');
      expect(signe.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(signe.signature).toMatchObject({ signedOn: '2027-01-10', fileId: copie.id });
      code(
        await put('rep', `/sales/contracts/${c.id}`, {
          ...corps(),
          expectedRevision: signe.revision,
        }),
        409,
        'CONTRACT_NOT_DRAFT',
      );
      code(
        await post('rep', `/sales/contracts/${c.id}/new-version`, {
          expectedRevision: signe.revision,
        }),
        409,
        'SALES_CONTRACT_STATUS_CONFLICT',
      );
      code(
        await post('rep', `/sales/contracts/${c.id}/cancel`, {
          expectedRevision: signe.revision,
          reason: 'x',
        }),
        409,
        'SALES_CONTRACT_STATUS_CONFLICT',
      );
      // Aucune facture n'est créée par ce lot.
      expect(
        await f.db().collection('sales_invoices').countDocuments({ organizationId: f.orgId() }),
      ).toBe(0);
    });

    it('rejet commenté → brouillon ; révision attendue ; suppression d’un brouillon jamais soumis', async () => {
      const c = ok(await post('rep', '/sales/contracts', corps()), 201);
      code(
        await post('rep', `/sales/contracts/${c.id}/submit`, { expectedRevision: c.revision + 5 }),
        409,
        'STALE_REVISION',
      );
      const s = ok(
        await post('rep', `/sales/contracts/${c.id}/submit`, { expectedRevision: c.revision }),
      );
      expect(
        (await f.post('owner', `/sales/contracts/${c.id}/reject`, { expectedRevision: s.revision }))
          .status,
      ).toBe(400);
      const r = ok(
        await f.post('owner', `/sales/contracts/${c.id}/reject`, {
          expectedRevision: s.revision,
          comment: 'Préavis à revoir',
        }),
      );
      expect(r.status).toBe('draft');
      expect(r.actions.newVersion).toBe(true);
      const v2 = ok(
        await post('rep', `/sales/contracts/${c.id}/new-version`, { expectedRevision: r.revision }),
      );
      expect(v2.version).toBe(2);
      expect(v2.approvals).toEqual([]);

      const jetable = ok(await post('rep', '/sales/contracts', corps()), 201);
      expect((await del('rep', `/sales/contracts/${jetable.id}`)).status).toBe(204);
      code(await f.get('owner', `/sales/contracts/${jetable.id}`), 404, 'SALES_CONTRACT_NOT_FOUND');
    });

    it('devis accepté → contrat aux prix du devis, devis inchangé ; devis envoyé 409', async () => {
      const corpsDevis = {
        currency: 'CDF',
        priceMode: 'ht',
        customer: { customerId: customer, printContactDetails: false },
        lines: [ligne('Conseil (heure)', '2', '40000.00')],
        title: 'Accompagnement annuel',
      };
      const d = ok(await f.post('owner', '/sales/quotes', corpsDevis), 201);
      const envoye = ok(
        await f.post('owner', `/sales/quotes/${d.id}/send`, { expectedRevision: d.revision }),
      );
      const clauses = {
        startDate: '2027-01-01',
        initialTermMonths: 12,
        renewal: { mode: 'none', periodMonths: null, maxRenewals: null },
        noticeDays: 0,
        billing: { kind: 'none' },
      };
      code(
        await post('rep', `/sales/quotes/${d.id}/to-contract`, clauses),
        409,
        'QUOTE_NOT_ACCEPTED',
      );
      ok(
        await f.post('owner', `/sales/quotes/${d.id}/accept`, {
          expectedRevision: envoye.revision,
        }),
      );
      const avant = await f
        .db()
        .collection('sales_quotes')
        .findOne({ _id: new ObjectId(d.id) });
      const res = ok(await post('rep', `/sales/quotes/${d.id}/to-contract`, clauses), 201);
      expect(res.contract).toMatchObject({
        status: 'draft',
        title: 'Accompagnement annuel',
        currency: 'CDF',
        source: { kind: 'quote', quoteId: d.id },
      });
      expect(res.contract.lines.map((l: { unitPrice: string }) => l.unitPrice)).toEqual(
        (avant!['lines'] as { unitPrice: string }[]).map((l) => l.unitPrice),
      );
      const apres = await f
        .db()
        .collection('sales_quotes')
        .findOne({ _id: new ObjectId(d.id) });
      expect(JSON.stringify(apres)).toBe(JSON.stringify(avant));
      const liste = ok(await f.get('viewer', `/sales/contracts?quoteId=${d.id}`));
      expect(liste.items.map((x: { id: string }) => x.id)).toEqual([res.contract.id]);
      code(
        await f.post('ownerB', `/sales/quotes/${d.id}/to-contract`, clauses),
        404,
        'QUOTE_NOT_FOUND',
      );
    });
  });

  // ── Avenants (critère 6) ─────────────────────────────────────────────────

  describe('avenants (critère 6)', () => {
    it('avenant signé au 1er mars : ancien prix le 28 février, nouveau le 1er mars ; non signé sans effet', async () => {
      const c = await contratSigne();
      const base = `/sales/contracts/${c.id}/amendments`;
      const brouillon = ok(
        await post('rep', base, {
          effectiveDate: '2027-03-01',
          purpose: 'change',
          changes: { lines: [ligne('Maintenance mensuelle', '1', '650.00')] },
        }),
        201,
      );
      expect(brouillon).toMatchObject({ index: 1, status: 'draft', number: `${c.number}-A1` });
      const sansEffet = ok(await f.get('viewer', `/sales/contracts/${c.id}?on=2027-03-01`));
      expect(sansEffet.terms.inForce.lines[0].unitPrice).toBe(c.lines[0].unitPrice);
      expect(sansEffet.terms.inForce.pendingAmendments).toEqual([1]);
      expect(sansEffet.warnings.map((w: { code: string }) => w.code)).toContain(
        'AMENDMENT_PENDING',
      );
      ok(
        await post('rep', `${base}/${brouillon.id}/cancel`, {
          expectedRevision: brouillon.revision,
          reason: 'Doublon',
        }),
      );

      const signe = await avenantSigne(c.id, {
        effectiveDate: '2027-03-01',
        purpose: 'change',
        changes: { lines: [ligne('Maintenance mensuelle', '1', '650.00')] },
      });
      expect(signe).toMatchObject({ index: 2, status: 'signed' });
      expect(signe.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      const nouveau = signe.changes.lines[0].unitPrice;
      expect(nouveau).not.toBe(c.lines[0].unitPrice);
      const fev = ok(await f.get('viewer', `/sales/contracts/${c.id}?on=2027-02-28`));
      expect(fev.terms.inForce.lines[0].unitPrice).toBe(c.lines[0].unitPrice);
      const mars = ok(await f.get('viewer', `/sales/contracts/${c.id}?on=2027-03-01`));
      expect(mars.terms.inForce.lines[0].unitPrice).toBe(nouveau);
      expect(mars.terms.inForce.appliedAmendments).toEqual([2]);
      expect(mars.terms.inForce.pendingAmendments).toEqual([]);
      // Le contrat lui-même n'a pas bougé.
      expect(mars.contentSha256).toBe(c.contentSha256);
      expect(mars.lines[0].unitPrice).toBe(c.lines[0].unitPrice);
      const liste = ok(await f.get('viewer', base));
      expect(liste.items.map((a: { status: string }) => a.status)).toEqual(['cancelled', 'signed']);
      // Approbation de l'avenant : même séparation des tâches.
      const a3 = ok(
        await post('dir', base, {
          effectiveDate: '2027-06-01',
          purpose: 'change',
          changes: { noticeDays: 45 },
        }),
        201,
      );
      const s3 = ok(
        await post('dir', `${base}/${a3.id}/submit`, { expectedRevision: a3.revision }),
      );
      code(
        await post('dir', `${base}/${a3.id}/approve`, { expectedRevision: s3.revision }),
        409,
        'SELF_APPROVAL_FORBIDDEN',
      );
      expect(
        (await post('rep', `${base}/${a3.id}/approve`, { expectedRevision: s3.revision })).status,
      ).toBe(403);
    });

    it('date d’effet avant le début 422, avant une échéance déjà préparée 409, contrat non signé 409', async () => {
      const c = await contratSigne();
      const base = `/sales/contracts/${c.id}/amendments`;
      const changement = { purpose: 'change', changes: { clauses: 'Clause révisée' } };
      code(
        await post('rep', base, { ...changement, effectiveDate: '2027-01-01' }),
        422,
        'AMENDMENT_BEFORE_CONTRACT_START',
      );
      code(
        await post('rep', base, { purpose: 'change', changes: {}, effectiveDate: '2027-02-01' }),
        422,
        'AMENDMENT_WITHOUT_CHANGES',
      );
      // Une échéance d'abonnement déjà préparée au 15 avril (brouillon lié, lot V5).
      const invoiceId = new ObjectId();
      await f.db().collection('sales_invoices').insertOne({
        _id: invoiceId,
        organizationId: f.orgId(),
        type: 'FV',
        status: 'draft',
        number: null,
        proformaRef: null,
        currency: 'USD',
        lines: [],
        documentAmounts: {},
      });
      await f
        .db()
        .collection('sales_document_links')
        .insertOne({
          organizationId: f.orgId(),
          invoiceId: String(invoiceId),
          kind: 'subscription_occurrence',
          orderId: null,
          contractId: c.id,
          itemRef: null,
          occurrenceDate: '2027-04-15',
          lineMap: [],
          requestedAmount: null,
          linkedAt: new Date(),
          linkedBy: 'system:subscriptions',
          _schemaVersion: 1,
        });
      code(
        await post('rep', base, { ...changement, effectiveDate: '2027-04-01' }),
        409,
        'AMENDMENT_BEFORE_PREPARED_OCCURRENCE',
      );
      ok(await post('rep', base, { ...changement, effectiveDate: '2027-04-16' }), 201);
      await f.db().collection('sales_invoices').deleteOne({ _id: invoiceId });
      // Brouillon supprimé : le lien orphelin est ignoré, la date redevient libre.
      ok(await post('rep', base, { ...changement, effectiveDate: '2027-04-01' }), 201);

      const brouillon = ok(await post('rep', '/sales/contracts', corps()), 201);
      code(
        await post('rep', `/sales/contracts/${brouillon.id}/amendments`, {
          ...changement,
          effectiveDate: '2027-02-01',
        }),
        409,
        'CONTRACT_NOT_SIGNED',
      );
    });
  });

  // ── Préavis, terme, reconduction (critères 7 et 8) ───────────────────────

  describe('préavis, terme et reconduction (critères 7 et 8)', () => {
    it('contrat du 15 janv. 2027, 12 mois, préavis 30 j : fin le 14 janv. 2028, préavis le 15 déc. 2027', async () => {
      const c = await contratSigne();
      expect(c.derivedStatus).toBe('upcoming');
      expect(c.terms).toMatchObject({
        currentTerm: { index: 0, from: '2027-01-15', to: '2028-01-14' },
        noticeDeadline: '2027-12-15',
        proposedNextTerm: { index: 1, from: '2028-01-15', to: '2029-01-14' },
        billableUntil: '2028-01-14',
      });
      expect(c.terms.conventions.length).toBeGreaterThan(0);
      expect(c.banner).toContain('Lalanda calcule les dates');
      // Proposée, jamais appliquée : rien n'est enregistré, rien à constater aujourd'hui.
      expect(c.renewals).toEqual([]);
      code(
        await f.post('owner', `/sales/contracts/${c.id}/renewals`, {
          expectedRevision: c.revision,
        }),
        409,
        'RENEWAL_NOT_PROPOSED',
      );
    });

    it('reconduction tacite constatée par un humain ; `maxRenewals` atteint → plus de terme proposé', async () => {
      const c = await contratSigne({
        startDate: '2025-01-15',
        renewal: { mode: 'tacit', periodMonths: 12, maxRenewals: 1 },
      });
      // Terme échu sans constat : rien n'est facturable au-delà (RENEWAL_NOT_RECORDED, V5).
      expect(c.terms).toMatchObject({
        termElapsed: true,
        billableUntil: '2026-01-14',
        proposedNextTerm: { from: '2026-01-15', to: '2027-01-14' },
      });
      expect(c.actions.recordRenewal).toBe(true);
      expect(
        (await post('rep', `/sales/contracts/${c.id}/renewals`, { expectedRevision: c.revision }))
          .status,
      ).toBe(403);
      const r = ok(
        await post('dir', `/sales/contracts/${c.id}/renewals`, { expectedRevision: c.revision }),
      );
      expect(r.renewals).toEqual([
        expect.objectContaining({
          termIndex: 1,
          from: '2026-01-15',
          to: '2027-01-14',
          mode: 'tacit_recorded',
          recordedBy: extraIds.dir,
        }),
      ]);
      expect(r.terms).toMatchObject({ billableUntil: '2027-01-14', proposedNextTerm: null });
      code(
        await post('dir', `/sales/contracts/${c.id}/renewals`, { expectedRevision: r.revision }),
        409,
        'RENEWAL_NOT_PROPOSED',
      );

      const sans = await contratSigne({
        startDate: '2025-01-15',
        renewal: { mode: 'none', periodMonths: null, maxRenewals: null },
      });
      expect(sans.derivedStatus).toBe('ended');
      code(
        await f.post('owner', `/sales/contracts/${sans.id}/renewals`, {
          expectedRevision: sans.revision,
        }),
        409,
        'RENEWAL_NOT_PROPOSED',
      );
    });

    it('renouvellement exprès : avenant `renewal` signé → terme suivant enregistré', async () => {
      const c = await contratSigne({
        startDate: '2025-03-01',
        renewal: { mode: 'explicit', periodMonths: 12, maxRenewals: null },
      });
      expect(c.terms.proposedNextTerm).toBeNull();
      const tacite = await contratSigne();
      code(
        await post('rep', `/sales/contracts/${tacite.id}/amendments`, {
          effectiveDate: '2028-01-15',
          purpose: 'renewal',
          changes: { clauses: 'Renouvellement' },
        }),
        409,
        'AMENDMENT_RENEWAL_NOT_EXPLICIT',
      );
      await avenantSigne(c.id, {
        effectiveDate: '2026-03-01',
        purpose: 'renewal',
        changes: { clauses: 'Renouvellement exprès pour un an' },
      });
      const apres = ok(await f.get('viewer', `/sales/contracts/${c.id}`));
      expect(apres.renewals).toEqual([
        expect.objectContaining({
          termIndex: 1,
          from: '2026-03-01',
          to: '2027-02-28',
          mode: 'explicit_amendment',
        }),
      ]);
      expect(apres.terms.billableUntil).toBe('2027-02-28');
    });
  });

  // ── Résiliation (critère 14) ─────────────────────────────────────────────

  describe('résiliation (critère 14)', () => {
    it('notifiée le 1er déc. 2027, effet au 14 janv. 2028, préavis saisi 60 j : en deçà, acceptée', async () => {
      const c = await contratSigne({ noticeDays: 60 });
      const corpsResiliation = {
        expectedRevision: c.revision,
        noticeGivenOn: '2027-12-01',
        by: 'customer',
        effectiveOn: '2028-01-14',
        reason: 'Le client change de prestataire',
      };
      expect(
        (await post('rep', `/sales/contracts/${c.id}/terminate`, corpsResiliation)).status,
      ).toBe(403);
      const res = ok(await f.post('owner', `/sales/contracts/${c.id}/terminate`, corpsResiliation));
      expect(res.warnings.map((w: { code: string }) => w.code)).toEqual(['NOTICE_BELOW_CLAUSE']);
      expect(res.contract.status).toBe('terminated');
      expect(res.contract.termination).toMatchObject({
        noticeCheck: { result: 'below_clause', noticeDays: 60, daysGiven: 44 },
        noticeCheckLabel: 'Préavis en deçà de la clause saisie',
      });
      expect(res.contract.terms.billableUntil).toBe('2028-01-14');
      code(
        await f.post('owner', `/sales/contracts/${c.id}/terminate`, {
          ...corpsResiliation,
          expectedRevision: res.contract.revision,
        }),
        409,
        'CONTRACT_NOT_SIGNED',
      );

      const c2 = await contratSigne({ noticeDays: 30 });
      const res2 = ok(
        await post('dir', `/sales/contracts/${c2.id}/terminate`, {
          ...corpsResiliation,
          expectedRevision: c2.revision,
          noticeGivenOn: '2027-11-01',
          effectiveOn: '2027-12-31',
        }),
      );
      expect(res2.warnings).toEqual([]);
      expect(res2.contract.termination.noticeCheck.result).toBe('meets_clause');
      expect(res2.contract.terms.billableUntil).toBe('2027-12-31');
    });
  });

  // ── Copies (critère 16) ──────────────────────────────────────────────────

  describe('copies (critère 16)', () => {
    it('PDF seul, 10 Mio au plus, téléchargement inerte, ajout seul', async () => {
      const c = await contratSigne();
      const seconde = ok(
        await upload('rep', `/sales/contracts/${c.id}/files?kind=signed_copy`),
        201,
      );
      const v = ok(await f.get('viewer', `/sales/contracts/${c.id}`));
      expect(v.files.filter((x: { kind: string }) => x.kind === 'signed_copy')).toHaveLength(2);
      expect(v.files.map((x: { id: string }) => x.id)).toContain(seconde.id);
      code(
        await upload(
          'rep',
          `/sales/contracts/${c.id}/files?kind=signed_copy`,
          Buffer.from('<html></html>'),
        ),
        422,
        'FILE_NOT_PDF',
      );
      code(
        await upload(
          'rep',
          `/sales/contracts/${c.id}/files?kind=signed_copy`,
          Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]),
        ),
        422,
        'FILE_TOO_LARGE',
      );
      expect(
        (await upload('rep', `/sales/contracts/${c.id}/files?kind=customer_order`)).status,
      ).toBe(400);
      expect(
        (await upload('viewer', `/sales/contracts/${c.id}/files?kind=signed_copy`)).status,
      ).toBe(403);
      const dl = await f.get('viewer', `/sales/contracts/${c.id}/files/${seconde.id}`);
      expect(dl.status).toBe(200);
      expect(dl.headers['content-type']).toBe('application/pdf');
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  // ── Isolation et mots (critères 17 et 18) ────────────────────────────────

  describe('isolation et mots (critères 17 et 18)', () => {
    it('toute ressource d’une autre organisation répond 404', async () => {
      const c = await contratSigne();
      const fileId = c.files[0].id as string;
      for (const res of [
        await f.get('ownerB', `/sales/contracts/${c.id}`),
        await f.put('ownerB', `/sales/contracts/${c.id}`, { ...corps(), expectedRevision: 1 }),
        await f.del('ownerB', `/sales/contracts/${c.id}`),
        await f.post('ownerB', `/sales/contracts/${c.id}/terminate`, {
          expectedRevision: c.revision,
          noticeGivenOn: '2027-06-01',
          by: 'customer',
          effectiveOn: '2027-07-01',
          reason: 'x',
        }),
        await f.post('ownerB', `/sales/contracts/${c.id}/renewals`, {
          expectedRevision: c.revision,
        }),
        await f.get('ownerB', `/sales/contracts/${c.id}/amendments`),
        await f.get('ownerB', `/sales/contracts/${c.id}/files/${fileId}`),
        await f.post('ownerB', `/sales/contracts/${c.id}/amendments`, {
          effectiveDate: '2027-03-01',
          purpose: 'change',
          changes: { noticeDays: 10 },
        }),
      ]) {
        code(res, 404, 'SALES_CONTRACT_NOT_FOUND');
      }
      const liste = ok(await f.get('ownerB', '/sales/contracts'));
      expect(liste.items.map((x: { id: string }) => x.id)).not.toContain(c.id);
      // Un client d'une autre organisation : 404 par la composition des factures.
      expect(
        (
          await f.post(
            'owner',
            '/sales/contracts',
            corps({ customer: { customerId: customerB, printContactDetails: false } }),
          )
        ).status,
      ).toBe(404);
    });

    it('aucune réponse ne dit « conforme », « valable juridiquement » ni « reconduit automatiquement »', async () => {
      const liste = ok(await f.get('viewer', '/sales/contracts?limit=100'));
      const textes = [JSON.stringify(liste)];
      for (const item of liste.items.slice(0, 15) as { id: string }[]) {
        textes.push(JSON.stringify(ok(await f.get('viewer', `/sales/contracts/${item.id}`))));
        textes.push(
          JSON.stringify(ok(await f.get('viewer', `/sales/contracts/${item.id}/amendments`))),
        );
      }
      expect(findForbiddenSalesContractWords(textes.join('\n'))).toEqual([]);
      expect(liste.items.length).toBeGreaterThan(5);
    });
  });
});
