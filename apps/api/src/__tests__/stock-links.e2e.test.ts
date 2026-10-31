// Liens des stocks, des équipements et de la bibliothèque avec le brief, « Mes tâches »,
// la cloche et la marge, contre la vraie application (ADR-0046 § 6.4, § 6.6, § 6.7 ;
// critère 18). ADR-0046 — S7.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard → contrôleurs →
// MongoDB. Une organisation N (Propriétaire, Administrateur, Directeur financier,
// Comptable, Magasinier, Commercial, Responsable RH, Conseiller) et une organisation B.
//
// Couvre : faits et règles R16 à R18 et leurs gardes ; ANTI-FUITE (ni valeur de stock, ni
// coût, ni nom d'article dans le brief, ni titre de document, ni document d'un dossier
// fermé au membre) ; e-mail ; éléments de « Mes tâches » (à compter, à valider — pas
// pour un compteur —, « À traiter », maintenance) ; notifications des stocks sans
// doublon, une par franchissement ; marge : `materials` informatif, marge inchangée,
// masqué sans `stock.read` ou sans accès aux valeurs.

import 'reflect-metadata';

import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { emailContent } from '../morning-brief/morning-brief-email.job.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { StockNotificationsJob } from '../stock/agenda/stock-notifications.job.js';
import { StockPendingService } from '../stock/stock-pending.service.js';
import { ProjectMarginService } from '../work/margin/project-margin.service.js';
import { e2eSuite, registerAndLogin } from './e2e-utils.js';
import { kinshasaToday, useStockFixture, type StockAccount } from './stock-e2e-fixtures.js';

vi.setConfig({ testTimeout: 180_000 });

const tag = randomBytes(4).toString('hex');
const TODAY = kinshasaDayOf(new Date());
const SECRET_ITEM = `Câble secret ${tag}`;
const SECRET_DOC = `Attestation fiscale ${tag}`;

interface Fact {
  id: string;
  status: string;
  value: string | null;
  source: { module: string };
}
interface Brief {
  version: string;
  facts: Fact[];
  alerts: { ruleId: string; message: string }[];
  recommendations: { ruleId: string; message: string; actionPath: string }[];
  rulesSkipped: { ruleId: string; reason: string }[];
}
interface TaskEntry {
  id: string;
  source: string;
  kind?: string;
  title: string;
  href: string;
}

const pdf = (texte: string) =>
  Buffer.from(`%PDF-1.4\n1 0 obj << /Title (${texte}) >> endobj\ntrailer\n%%EOF\n`, 'latin1');

e2eSuite('Stocks, équipements, documents — brief, Mes tâches, cloche, marge (ADR-0046 S7)', () => {
  const f = useStockFixture(tag);
  let loc = '';
  const item = { a: '', b: '', c: '' };
  let projectId = '';
  const count = { one: '', two: '' };
  let assetId = '';
  let maintenanceId = '';

  const brief = async (who: StockAccount): Promise<Brief> =>
    f.ok(await f.get(who, '/morning-brief'))['brief'] as Brief;
  const fact = (b: Brief, id: string): Fact => {
    const x = b.facts.find((y) => y.id === id);
    expect(x, id).toBeDefined();
    return x!;
  };
  const myTasks = async (who: StockAccount): Promise<TaskEntry[]> => {
    const v = f.ok(await f.get(who, '/work/my-tasks'));
    return ['overdue', 'today', 'next7Days', 'later', 'noDate'].flatMap((g) => v[g] as TaskEntry[]);
  };
  const adjIn = (id: string, quantity: string, unitCost = '2.00') => ({
    kind: 'adjustment',
    fromLocationId: loc,
    reason: { key: 'other', note: 'Stock initial' },
    lines: [{ itemId: id, quantity, direction: 'in', unitCost }],
  });
  const notifications = async (kind: string) =>
    f.db().collection('notifications').find({ organizationId: f.orgId(), kind }).toArray();
  const job = () => f.app().get(StockNotificationsJob, { strict: false });

  it('prépare deux articles sous le seuil, un article consommé par un projet', async () => {
    loc = await f.defaultLocation();
    const reorder = { minQuantity: '10', targetQuantity: null, locationId: null };
    item.a = (await f.item(SECRET_ITEM, { costCurrency: 'USD', reorder }))['id'];
    item.b = (await f.item(`Gaine ${tag}`, { costCurrency: 'USD', reorder }))['id'];
    item.c = (await f.item(`Ciment ${tag}`, { costCurrency: 'USD' }))['id'];
    f.ok((await f.voucher('owner', adjIn(item.a, '3', '7.77'))).posted);
    f.ok((await f.voucher('owner', adjIn(item.b, '4'))).posted);
    f.ok((await f.voucher('owner', adjIn(item.c, '20'))).posted);
    projectId = f.ok(
      await f.post('owner', '/work/projects', { name: `Chantier ${tag}`, kind: 'internal' }),
      201,
    )['id'];
    // Une ligne « À traiter » (réception non reconnue).
    await f
      .app()
      .get(StockPendingService)
      .open(f.orgId(), {
        reason: 'unknown_item',
        sourceKey: `reception:${tag}:l1:unknown_item`,
        proposal: {
          movementKind: 'purchase_receipt',
          movementSourceKey: `reception:${tag}:l1`,
          source: { kind: 'reception', receptionId: tag, orderLineId: 'l1' },
          itemId: null,
          itemRef: 'INCONNU',
          label: 'Inconnu',
          quantity: '1',
          unit: 'pièce',
          occurredOn: kinshasaToday(),
          locationId: null,
          unitPrice: '5.00',
          discountPercent: null,
          currency: 'USD',
          workProjectId: null,
          orderId: 'commande-s7',
          movementId: null,
          maxQuantity: null,
          invoicedUnitCost: null,
        },
      } as never);
  });

  describe('brief du matin — R16 à R18 (§ 6.6, critère 18)', () => {
    it('prépare une maintenance due, une garantie et deux documents qui expirent', async () => {
      const cats = f.ok(await f.get('owner', '/assets/categories'))['items'] as { id: string }[];
      const a = f.ok(
        await f.post('owner', '/assets', {
          name: `Groupe électrogène ${tag}`,
          categoryId: cats[0]!.id,
          acquisition: { on: '2026-01-15', cost: '1234.56', currency: 'USD' },
        }),
        201,
      );
      assetId = a['id'];
      const assigned = f.ok(
        await f.post('owner', `/assets/${assetId}/assign`, {
          expectedRevision: a['revision'],
          assignee: { kind: 'member', userId: f.userId('storekeeper') },
          from: TODAY,
        }),
      );
      expect(assigned['currentAssignment']['assignee']['kind']).toBe('member');
      maintenanceId = f.ok(
        await f.post('owner', `/assets/${assetId}/maintenance`, {
          kind: 'preventive',
          plannedOn: TODAY,
        }),
        201,
      )['id'];
      f.ok(
        await f.post('owner', `/assets/${assetId}/coverages`, {
          kind: 'warranty',
          provider: 'Constructeur',
          reference: 'GAR-S7',
          startOn: '2025-01-01',
          endOn: addDays(TODAY, 20),
        }),
        201,
      );
      // Bibliothèque : un document ouvert à tous, un autre dans un dossier fermé au
      // Magasinier (« Fiscal et administratif »).
      const folders = f.ok(await f.post('owner', '/documents/folders/defaults'))['items'] as {
        id: string;
        name: string;
      }[];
      const byName = (n: string) => folders.find((x) => x.name === n)!.id;
      // Stockage objet en mémoire (motif de `library-documents.e2e`).
      const storage = f.app().get(ObjectStorageService);
      const objects = new Map<string, Buffer>();
      storage.uploadsBucket = () => 'docs-test';
      storage.putObject = async (bucket, key, body) => {
        objects.set(`${bucket}/${key}`, Buffer.from(body));
      };
      // Envoi `multipart/form-data` : session du Comptable (même compte que la fixture).
      const cookies = await registerAndLogin(f.app(), {
        email: `stk-accountant-${tag}@lalanda-test.local`,
        password: 'Passw0rd!stocks-s3',
        name: `Membre accountant ${tag}`,
      });
      for (const [title, folderId, days] of [
        [`Contrat de bail ${tag}`, byName('Divers'), 5],
        [SECRET_DOC, byName('Fiscal et administratif'), 10],
      ] as const) {
        const res = await request(f.app().getHttpServer())
          .post('/documents')
          .set('Cookie', [...cookies, `active_org_id=${f.orgId()}`])
          .field('title', title)
          .field('folderId', folderId)
          .field('nature', 'certificate')
          .field('expiresOn', addDays(TODAY, days))
          .attach('file', pdf(title), {
            filename: 'piece.pdf',
            contentType: 'application/octet-stream',
          });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
      }
    });

    it('Magasinier : deux articles sous le seuil → R16 ; maintenance → R17 ; échéances → R18', async () => {
      const b = await brief('storekeeper');
      expect(b.version).toBe('1.5.0');
      expect(fact(b, 'stock.sous_seuil').value).toBe('2');
      expect(fact(b, 'stock.ruptures').value).toBe('0');
      expect(fact(b, 'stock.a_traiter').value).toBe('1');
      expect(fact(b, 'equipements.maintenances_dues').value).toBe('1');
      expect(fact(b, 'equipements.couvertures_expirant').value).toBe('1');
      expect(fact(b, 'equipements.chez_anciens').value).toBe('0');
      // Le dossier fiscal lui est fermé : un seul document compté.
      expect(fact(b, 'documents.expirant').value).toBe('1');
      const r16 = b.recommendations.find((r) => r.ruleId === 'ruptures_et_seuils');
      expect(r16).toMatchObject({
        message: '2 articles sous le seuil.',
        actionPath: '/stocks/reapprovisionnement',
      });
      expect(b.recommendations.map((r) => r.ruleId)).toEqual(
        expect.arrayContaining(['maintenances_dues', 'echeances_documents_et_garanties']),
      );
    });

    it('Comptable (lecture des dossiers fiscaux) : deux documents qui expirent', async () => {
      expect(fact(await brief('accountant'), 'documents.expirant').value).toBe('2');
    });

    it('ANTI-FUITE : ni nom d’article, ni coût, ni valeur, ni titre de document', async () => {
      for (const who of ['storekeeper', 'owner', 'accountant'] as const) {
        const raw = JSON.stringify(await brief(who));
        expect(raw).not.toContain(SECRET_ITEM);
        expect(raw).not.toContain(SECRET_DOC);
        expect(raw).not.toContain('Contrat de bail');
        expect(raw).not.toContain('7.77');
        expect(raw).not.toContain('1234.56');
        expect(raw).not.toContain('Groupe électrogène');
      }
    });

    it('gardes : sans `stock.read` les faits des stocks sont masqués ; sans `assets.read` aussi', async () => {
      const rh = await brief('hr_manager');
      for (const id of ['stock.ruptures', 'stock.sous_seuil', 'stock.a_traiter']) {
        expect(fact(rh, id)).toMatchObject({ status: 'hidden', value: null });
      }
      expect(rh.rulesSkipped).toContainEqual({ ruleId: 'ruptures_et_seuils', reason: 'hidden' });
      // Le Commercial lit les stocks mais pas les équipements.
      const com = await brief('sales_rep');
      expect(fact(com, 'stock.sous_seuil').value).toBe('2');
      expect(fact(com, 'equipements.maintenances_dues')).toMatchObject({ status: 'hidden' });
      expect(com.rulesSkipped).toContainEqual({ ruleId: 'maintenances_dues', reason: 'hidden' });
      // Le Conseiller ne lit ni stocks, ni équipements, ni bibliothèque.
      const adv = await brief('advisor');
      expect(fact(adv, 'documents.expirant').status).toBe('hidden');
    });

    it('e-mail : mêmes faits, et rien des modules que le membre ne lit pas', async () => {
      const mail = emailContent((await brief('storekeeper')) as never, 'N');
      expect(mail.facts.join('\n')).toContain('Articles sous le seuil');
      // Le Conseiller ne lit ni stocks, ni équipements, ni bibliothèque : rien, pas même
      // la mention « masqué ».
      const adv = emailContent((await brief('advisor')) as never, 'N').facts.join('\n');
      for (const label of ['Articles', 'Maintenances dues', 'Documents qui expirent']) {
        expect(adv).not.toContain(label);
      }
    });

    it('isolation : l’organisation B ne voit rien de N', async () => {
      const b = await brief('ownerB');
      expect(fact(b, 'stock.sous_seuil').value).toBe('0');
      expect(fact(b, 'stock.a_traiter').value).toBe('0');
      expect(fact(b, 'equipements.maintenances_dues').value).toBe('0');
      expect(fact(b, 'documents.expirant').value).toBe('0');
    });
  });

  describe('« Mes tâches » (§ 6.7)', () => {
    it('inventaire à compter chez le compteur assigné, à valider chez un validateur éligible', async () => {
      const created = f.ok(
        await f.post('owner', '/stock/counts', {
          locationId: loc,
          scope: 'items',
          itemIds: [item.c],
          assignees: [f.userId('storekeeper')],
        }),
        201,
      );
      count.one = created['id'];
      const started = f.ok(
        await f.post('owner', `/stock/counts/${count.one}/start`, { expectedRevision: 1 }),
      );
      const mag = await myTasks('storekeeper');
      const toCount = mag.find((t) => t.id === `stock:count:${count.one}`);
      expect(toCount).toMatchObject({
        source: 'stock',
        kind: 'count_to_count',
        href: `/stocks/inventaires/${count.one}`,
      });
      // « À traiter » regroupé pour qui mouvemente (`stock.move`) ; maintenance de son matériel.
      expect(mag.find((t) => t.id === 'stock:pending')?.title).toBe(
        '1 ligne « À traiter » dans le magasin',
      );
      expect(mag.find((t) => t.id === `assets:maintenance:${maintenanceId}`)).toMatchObject({
        source: 'assets',
        href: `/equipements/${assetId}`,
      });
      // Le Comptable ne mouvemente pas : pas d'« À traiter ».
      expect((await myTasks('accountant')).some((t) => t.id === 'stock:pending')).toBe(false);
      // Le Commercial ne lit pas les équipements : aucune maintenance.
      expect((await myTasks('sales_rep')).some((t) => t.source === 'assets')).toBe(false);

      // Comptage, soumission : l'inventaire passe « à valider ».
      const line = started['lines'][0]['id'];
      const counted = f.ok(
        await f.put('storekeeper', `/stock/counts/${count.one}/lines/${line}`, {
          countedQuantity: '20',
        }),
      );
      f.ok(
        await f.post('storekeeper', `/stock/counts/${count.one}/submit`, {
          expectedRevision: counted['revision'],
        }),
      );
      const after = await myTasks('storekeeper');
      expect(after.some((t) => t.id.endsWith(count.one))).toBe(false);
      for (const who of ['accountant', 'admin', 'owner'] as const) {
        expect((await myTasks(who)).map((t) => t.id)).toContain(`stock:validate:${count.one}`);
      }
    });

    it('le compteur qui détient `stock.manage` ne voit pas « à valider » son propre inventaire', async () => {
      const created = f.ok(
        await f.post('owner', '/stock/counts', {
          locationId: loc,
          scope: 'items',
          itemIds: [item.b],
          assignees: [f.userId('accountant')],
        }),
        201,
      );
      count.two = created['id'];
      const started = f.ok(
        await f.post('owner', `/stock/counts/${count.two}/start`, { expectedRevision: 1 }),
      );
      const counted = f.ok(
        await f.put('accountant', `/stock/counts/${count.two}/lines/${started['lines'][0]['id']}`, {
          countedQuantity: '4',
        }),
      );
      f.ok(
        await f.post('accountant', `/stock/counts/${count.two}/submit`, {
          expectedRevision: counted['revision'],
        }),
      );
      expect((await myTasks('accountant')).map((t) => t.id)).not.toContain(
        `stock:validate:${count.two}`,
      );
      expect((await myTasks('admin')).map((t) => t.id)).toContain(`stock:validate:${count.two}`);
    });

    it('ANTI-FUITE : aucun coût ni valeur dans les éléments ; isolation', async () => {
      const raw = JSON.stringify(await myTasks('owner'));
      expect(raw).not.toContain('7.77');
      expect(raw).not.toContain('1234.56');
      expect((await myTasks('ownerB')).some((t) => ['stock', 'assets'].includes(t.source))).toBe(
        false,
      );
    });
  });

  describe('cloche des stocks (§ 6.7)', () => {
    it('seuils, « À traiter », inventaires : une notification par destinataire, sans doublon', async () => {
      await job().run();
      const below = await notifications('stock.below_reorder');
      // Deux articles × détenteurs effectifs de `stock.manage` (Propriétaire,
      // Administrateur, Directeur financier, Comptable).
      expect(below).toHaveLength(8);
      expect(new Set(below.map((n) => n['recipientUserId']))).toEqual(
        new Set(
          ['owner', 'admin', 'finance_director', 'accountant'].map((w) => f.userId(w as never)),
        ),
      );
      expect(below.every((n) => n['requiredAction'] === 'stock.read')).toBe(true);
      const pending = await notifications('stock.pending_lines');
      expect(pending.map((n) => n['recipientUserId']).sort()).toEqual(
        ['owner', 'admin', 'finance_director', 'storekeeper']
          .map((w) => f.userId(w as never))
          .sort(),
      );
      const submitted = await notifications('stock.count_submitted');
      // Inventaire 1 (compté par le Magasinier) : les quatre validateurs ; inventaire 2
      // (compté par le Comptable) : trois, le Comptable exclu.
      expect(submitted.filter((n) => n['source']['entityId'] === count.one)).toHaveLength(4);
      const two = submitted.filter((n) => n['source']['entityId'] === count.two);
      expect(two).toHaveLength(3);
      expect(two.map((n) => n['recipientUserId'])).not.toContain(f.userId('accountant'));
      // Anti-fuite : aucun coût dans les titres.
      for (const n of [...below, ...pending, ...submitted]) {
        expect(String(n['title'])).not.toMatch(/7\.77|2\.00/);
      }

      // Rejouer : aucun doublon.
      const before = await f
        .db()
        .collection('notifications')
        .countDocuments({ organizationId: f.orgId() });
      await job().run();
      expect(
        await f.db().collection('notifications').countDocuments({ organizationId: f.orgId() }),
      ).toBe(before);
    });

    it('inventaire assigné : notifié au compteur ; un nouveau franchissement du seuil renotifie', async () => {
      const created = f.ok(
        await f.post('owner', '/stock/counts', {
          locationId: loc,
          scope: 'items',
          itemIds: [item.a],
          assignees: [f.userId('storekeeper')],
        }),
        201,
      );
      f.ok(await f.post('owner', `/stock/counts/${created['id']}/start`, { expectedRevision: 1 }));
      // Article A repasse au-dessus du seuil, puis en dessous.
      f.ok((await f.voucher('owner', adjIn(item.a, '10'))).posted);
      await job().run();
      const assigned = await notifications('stock.count_assigned');
      expect(assigned).toHaveLength(1);
      expect(assigned[0]!['recipientUserId']).toBe(f.userId('storekeeper'));
      const aBefore = (await notifications('stock.below_reorder')).filter(
        (n) => n['source']['entityId'] === item.a,
      ).length;
      f.ok(
        (
          await f.voucher('storekeeper', {
            kind: 'issue',
            fromLocationId: loc,
            lines: [{ itemId: item.a, quantity: '6' }],
          })
        ).posted,
      );
      await job().run();
      await job().run();
      const aAfter = (await notifications('stock.below_reorder')).filter(
        (n) => n['source']['entityId'] === item.a,
      ).length;
      expect(aAfter - aBefore).toBe(4);
    });

    it('stock négatif : une notification `stock.negative` par épisode', async () => {
      const s = f.ok(await f.get('owner', '/stock/settings'));
      f.ok(
        await f.put('owner', '/stock/settings', {
          allowNegativeManualMoves: true,
          expectedRevision: s['revision'],
        }),
      );
      f.ok(
        (
          await f.voucher('storekeeper', {
            kind: 'issue',
            fromLocationId: loc,
            lines: [{ itemId: item.b, quantity: '6' }],
          })
        ).posted,
      );
      await job().run();
      await job().run();
      const neg = await notifications('stock.negative');
      expect(neg).toHaveLength(4);
      expect(neg.every((n) => n['source']['entityId'] === item.b)).toBe(true);
      expect(fact(await brief('storekeeper'), 'stock.ruptures').value).toBe('1');
    });
  });

  describe('marge du projet — matériel informatif (§ 6.4, critère 18)', () => {
    it('sortie de 30,00 USD vers le projet : `materials` = 30,00, marge INCHANGÉE', async () => {
      const avant = f.ok(await f.get('owner', `/work/projects/${projectId}/margin`));
      expect(avant['version']).toBe('1.3.0');
      expect(avant['materials']).toEqual([]);
      f.ok(
        (
          await f.voucher('storekeeper', {
            kind: 'issue',
            fromLocationId: loc,
            workProjectId: projectId,
            lines: [{ itemId: item.c, quantity: '15' }],
          })
        ).posted,
      );
      const apres = f.ok(await f.get('owner', `/work/projects/${projectId}/margin`));
      expect(apres['materials']).toEqual([
        { currency: 'USD', consumedValue: '30.00', issueCount: 1, unvaluedCount: 0 },
      ]);
      expect(apres['currencies']).toEqual(avant['currencies']);
      expect(apres['findings']).toEqual(avant['findings']);
    });

    it('ANTI-FUITE : sans accès aux valeurs, ou sans `stock.read`, rien n’est lu', async () => {
      const margins = f.app().get(ProjectMarginService, { strict: false });
      const sansValeurs = await margins.margin(f.orgId(), projectId, {}, {
        userId: f.userId('storekeeper'),
        role: 'storekeeper',
        context: { canClosePeriods: false, grants: [], revokes: [] },
      } as never);
      expect(sansValeurs.materials).toBeNull();
      const sansStock = await margins.margin(f.orgId(), projectId, {}, {
        userId: f.userId('owner'),
        role: 'viewer',
        context: { canClosePeriods: false, grants: [], revokes: ['stock.read'] },
      } as never);
      expect(sansStock.materials).toBeNull();
      // Isolation : le projet de N n'existe pas dans B.
      expect((await f.get('ownerB', `/work/projects/${projectId}/margin`)).status).toBe(404);
    });
  });
});
