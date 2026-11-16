// Dépenses récurrentes avec fournisseur et projet, filtres de la liste — ADR-0077 § 2, § 3.
//
// Couvre : règle avec fiche fournisseur et projet, héritage par l'occurrence confirmée,
// nom COURANT de la fiche dans la liste des règles (copie inchangée), audit par
// identifiants ; fiche d'une autre organisation 404, archivée 409, fusionnée 409 ;
// projet d'une autre organisation 404, archivé 409 ; projet détaché par `null`, inchangé
// si absent ; filtres `supplierId` et `workProjectId` (identifiant invalide 400, fiche
// d'autrui : liste vide).
//
// BASE DÉDIÉE, supprimée à la fin.

import 'reflect-metadata';

import { ObjectId } from 'mongodb';
import { beforeAll, describe, expect, it } from 'vitest';

import { kinshasaDayOf } from '../sales/receipts/kinshasa-day.js';
import { e2eSuite } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

e2eSuite('dépenses récurrentes : fournisseur et projet ; filtres (ADR-0077 § 2, § 3)', () => {
  const f = useWorkFixture('tsync');
  const today = () => kinshasaDayOf(new Date());
  let fiche = '';
  let ficheB = '';
  let projet = '';
  let projetB = '';

  const ok = (res: { status: number; body: unknown }, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const code = (res: { status: number; body: any }, status: number, c: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code, JSON.stringify(res.body)).toBe(c);
  };
  const regle = (more: Record<string, unknown> = {}) => ({
    label: 'Loyer du chantier',
    amount: '300.00',
    currency: 'USD',
    category: 'loyer',
    frequency: 'monthly',
    startDate: today(),
    ...more,
  });

  beforeAll(async () => {
    fiche = ok(await f.post('owner', '/purchases/suppliers', { name: 'Socimex SARL' }), 201)
      .supplier.id;
    ficheB = ok(await f.post('ownerB', '/purchases/suppliers', { name: 'Fournisseur B' }), 201)
      .supplier.id;
    projet = ok(
      await f.post('owner', '/work/projects', { name: 'Chantier Gombe', kind: 'client' }),
      201,
    ).id;
    projetB = ok(
      await f.post('ownerB', '/work/projects', { name: 'Projet B', kind: 'internal' }),
      201,
    ).id;
  }, E2E_HOOK_TIMEOUT_MS);

  describe('règle récurrente', () => {
    it('fiche et projet : posés, rendus, hérités par l’occurrence, audités par identifiants', async () => {
      const r = ok(
        await f.post(
          'owner',
          '/treasury/recurring-expenses',
          regle({ supplierId: fiche, workProjectId: projet }),
        ),
        201,
      );
      expect(r).toMatchObject({
        supplierId: fiche,
        supplierName: 'Socimex SARL',
        workProjectId: projet,
      });
      const audit = await f
        .db()
        .collection('audit_events')
        .findOne({ action: 'treasury.recurring.created', targetId: r.id });
      expect(audit?.['metadata']).toMatchObject({ supplierId: fiche, workProjectId: projet });
      expect(JSON.stringify(audit?.['metadata'])).not.toMatch(/Socimex/);

      const c = ok(
        await f.post(
          'owner',
          `/treasury/recurring-expenses/${r.id}/occurrences/${today()}/confirm`,
          {},
        ),
      );
      expect(c.expense).toMatchObject({
        supplierId: fiche,
        supplierName: 'Socimex SARL',
        workProjectId: projet,
      });

      // Fiche renommée : la liste des règles montre le nom courant, la copie reste.
      await f
        .db()
        .collection('suppliers')
        .updateOne({ _id: new ObjectId(fiche) }, { $set: { name: 'Socimex Congo' } });
      const regles = ok(await f.get('viewer', '/treasury/recurring-expenses')).items as Record<
        string,
        any
      >[];
      expect(regles.find((x) => x.id === r.id)?.supplierName).toBe('Socimex Congo');
      const stored = await f
        .db()
        .collection('treasury_recurring_expenses')
        .findOne({ _id: new ObjectId(r.id) });
      expect(stored?.['supplierName']).toBe('Socimex SARL');
    });

    it('nom libre (fournisseur de passage) sans fiche', async () => {
      const r = ok(
        await f.post(
          'owner',
          '/treasury/recurring-expenses',
          regle({ supplierName: 'Marché Gambela' }),
        ),
        201,
      );
      expect(r).toMatchObject({
        supplierId: null,
        supplierName: 'Marché Gambela',
        workProjectId: null,
      });
    });

    it('fiche ou projet d’une autre organisation : 404 ; archivés ou fusionnée : 409', async () => {
      code(
        await f.post('owner', '/treasury/recurring-expenses', regle({ supplierId: ficheB })),
        404,
        'EXPENSE_SUPPLIER_UNKNOWN',
      );
      code(
        await f.post('owner', '/treasury/recurring-expenses', regle({ workProjectId: projetB })),
        404,
        'EXPENSE_WORK_PROJECT_UNKNOWN',
      );
      const archivee = ok(
        await f.post('owner', '/purchases/suppliers', { name: 'Ancienne papeterie' }),
        201,
      ).supplier.id;
      await f
        .db()
        .collection('suppliers')
        .updateOne({ _id: new ObjectId(archivee) }, { $set: { active: false } });
      code(
        await f.post('owner', '/treasury/recurring-expenses', regle({ supplierId: archivee })),
        409,
        'SUPPLIER_ARCHIVED',
      );
      const fusionnee = ok(
        await f.post('owner', '/purchases/suppliers', { name: 'Doublon SARL' }),
        201,
      ).supplier.id;
      await f
        .db()
        .collection('suppliers')
        .updateOne({ _id: new ObjectId(fusionnee) }, { $set: { mergedInto: fiche } });
      code(
        await f.post('owner', '/treasury/recurring-expenses', regle({ supplierId: fusionnee })),
        409,
        'SUPPLIER_MERGED',
      );
      const archive = ok(
        await f.post('owner', '/work/projects', { name: 'Clos', kind: 'internal' }),
        201,
      );
      await f
        .db()
        .collection('work_projects')
        .updateOne({ _id: new ObjectId(archive.id) }, { $set: { status: 'archived' } });
      code(
        await f.post('owner', '/treasury/recurring-expenses', regle({ workProjectId: archive.id })),
        409,
        'WORK_PROJECT_ARCHIVED',
      );
    });

    it('modification : projet absent = inchangé, `null` = détaché ; occurrence d’un projet archivé : 409', async () => {
      const r = ok(
        await f.post('owner', '/treasury/recurring-expenses', regle({ workProjectId: projet })),
        201,
      );
      const p1 = ok(
        await f.put('owner', `/treasury/recurring-expenses/${r.id}`, {
          expectedRevision: r.revision,
          recurringExpense: regle({ label: 'Loyer (révisé)' }),
        }),
      );
      expect(p1.workProjectId).toBe(projet);
      const p2 = ok(
        await f.put('owner', `/treasury/recurring-expenses/${r.id}`, {
          expectedRevision: p1.revision,
          recurringExpense: regle({ workProjectId: null }),
        }),
      );
      expect(p2.workProjectId).toBeNull();

      const tmp = ok(
        await f.post('owner', '/work/projects', { name: 'Temporaire', kind: 'internal' }),
        201,
      );
      const r2 = ok(
        await f.post('owner', '/treasury/recurring-expenses', regle({ workProjectId: tmp.id })),
        201,
      );
      await f
        .db()
        .collection('work_projects')
        .updateOne({ _id: new ObjectId(tmp.id) }, { $set: { status: 'archived' } });
      code(
        await f.post(
          'owner',
          `/treasury/recurring-expenses/${r2.id}/occurrences/${today()}/confirm`,
          {},
        ),
        409,
        'WORK_PROJECT_ARCHIVED',
      );
    });
  });

  describe('filtres de la liste', () => {
    it('par fiche fournisseur et par projet ; identifiant invalide 400 ; fiche d’autrui vide', async () => {
      ok(
        await f.post('owner', '/treasury/expenses', {
          spentOn: today(),
          amount: '12.00',
          currency: 'USD',
          category: 'charges_diverses',
          label: 'Fournitures',
          supplierId: fiche,
        }),
        201,
      );
      ok(
        await f.post('owner', '/treasury/expenses', {
          spentOn: today(),
          amount: '8.00',
          currency: 'USD',
          category: 'charges_diverses',
          label: 'Taxi',
          supplierName: null,
          workProjectId: projet,
        }),
        201,
      );
      const parFiche = ok(await f.get('viewer', `/treasury/expenses?supplierId=${fiche}`))
        .items as Record<string, any>[];
      expect(parFiche.length).toBeGreaterThan(0);
      expect(parFiche.every((d) => d.supplierId === fiche)).toBe(true);
      const parProjet = ok(await f.get('viewer', `/treasury/expenses?workProjectId=${projet}`))
        .items as Record<string, any>[];
      expect(parProjet.length).toBeGreaterThan(0);
      expect(parProjet.every((d) => d.workProjectId === projet)).toBe(true);
      const croise = ok(
        await f.get('viewer', `/treasury/expenses?supplierId=${fiche}&workProjectId=${projet}`),
      ).items as Record<string, any>[];
      expect(croise.every((d) => d.supplierId === fiche && d.workProjectId === projet)).toBe(true);
      expect((await f.get('viewer', '/treasury/expenses?supplierId=pas-un-id')).status).toBe(400);
      expect(ok(await f.get('owner', `/treasury/expenses?supplierId=${ficheB}`)).items).toEqual([]);
    });
  });
});
