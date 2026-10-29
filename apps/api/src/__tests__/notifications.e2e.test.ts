// BOÎTE DE NOTIFICATIONS BOUT EN BOUT (ADR-0039 § 2.11, § 4, lot L2).
//
// Ce que ce fichier prouve, sur un vrai serveur et une vraie base :
//
//  · ISOLATION — par organisation (le propriétaire de B ne voit, ne compte ni ne
//    marque rien de A, même par identifiant forgé) et par membre (un collègue
//    de la même organisation non plus) ;
//  · PORT — l'auteur n'est jamais notifié ; un non-membre, un destinataire sans
//    l'action requise, un lien absolu sont écartés sans lever ;
//  · DÉDOUBLONNAGE — la même `dedupeKey` émise trois fois crée UNE ligne ;
//  · PRÉFÉRENCES — un type coupé n'est pas enregistré ; corps contrôlé ;
//  · REVÉRIFICATION — un membre qui perd `work.read` ne voit plus ses
//    notifications `work.*`, ni dans la liste ni dans le compteur ;
//  · LECTURE — curseur, non lues, marquage unitaire et global, conservation.
//
// Aucun module producteur n'est chargé ici : les émissions passent par le port
// `NOTIFICATIONS_PORT`, exactement comme le feront `work` et le brief.

import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import type { NotificationInput, NotificationsPort } from '../notifications/notifications.port.js';
import type { NotifyOutcome } from '../notifications/notifications.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

e2eSuite('notifications — isolation, port, dédoublonnage, préférences (ADR-0039)', () => {
  let app: INestApplication;
  const tag = randomBytes(4).toString('hex');
  const mk = (k: string): { email: string; password: string; name: string } => ({
    email: `notif-${k}-${tag}@lalanda-test.local`,
    password: `Passw0rd!notif${k}`,
    name: k.toUpperCase(),
  });
  const owner = mk('a');
  const ownerB = mk('b');
  const colleague = mk('v');
  const outsider = mk('x');
  const emails = [owner.email, ownerB.email, colleague.email, outsider.email];

  let cA: string[] = [];
  let cB: string[] = [];
  let cV: string[] = [];
  let orgA = '';
  let orgB = '';
  let ownerId = '';
  let ownerBId = '';
  let colleagueId = '';
  let outsiderId = '';
  let port: NotificationsPort & { emit(input: NotificationInput): Promise<NotifyOutcome> };

  const server = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();
  const asA = (): string[] => [...cA, `active_org_id=${orgA}`];
  const asB = (): string[] => [...cB, `active_org_id=${orgB}`];
  const asV = (): string[] => [...cV, `active_org_id=${orgA}`];

  const emission = (over: Partial<NotificationInput> = {}): NotificationInput => ({
    organizationId: orgA,
    recipientUserId: ownerId,
    kind: 'work.task_assigned',
    requiredAction: 'work.read',
    source: { module: 'work', entityType: 'task', entityId: 't-1', projectId: 'p-1' },
    title: 'V vous a assigné #12 Poser le carrelage',
    href: '/projets/p-1?tache=t-1',
    actorUserId: colleagueId,
    ...over,
  });

  async function userId(email: string): Promise<string> {
    const db = await dbOf(app);
    return String((await db.collection('user').findOne({ email }))?._id);
  }

  async function invite(email: string, role: string, cookies: string[]): Promise<void> {
    const inv = await request(server())
      .post(`/organizations/${orgA}/invitations`)
      .set('Cookie', asA())
      .send({ email, role });
    expect(inv.status).toBe(201);
    const acc = await request(server())
      .post('/invitations/accept')
      .set('Cookie', cookies)
      .send({ token: inv.body.token });
    expect(acc.status).toBe(201);
  }

  beforeAll(async () => {
    app = await makeE2EApp();
    const { NOTIFICATIONS_PORT } = await import('../notifications/notifications.port.js');
    port = app.get(NOTIFICATIONS_PORT);

    cA = await registerAndLogin(app, owner);
    cB = await registerAndLogin(app, ownerB);
    orgA = (await request(server()).get('/organizations').set('Cookie', cA)).body.organizations[0]
      .id;
    orgB = (await request(server()).get('/organizations').set('Cookie', cB)).body.organizations[0]
      .id;
    cV = await registerAndLogin(app, colleague);
    await invite(colleague.email, 'viewer', cV);
    await registerAndLogin(app, outsider);

    ownerId = await userId(owner.email);
    ownerBId = await userId(ownerB.email);
    colleagueId = await userId(colleague.email);
    outsiderId = await userId(outsider.email);
  }, 180_000);

  afterAll(async () => {
    if (app) {
      const db = await dbOf(app);
      const orgs = { organizationId: { $in: [orgA, orgB] } };
      await db.collection('notifications').deleteMany(orgs);
      await db.collection('notification_preferences').deleteMany(orgs);
    }
    await teardown(app, emails);
  }, 60_000);

  const list = (cookies: string[], qs = ''): request.Test =>
    request(server()).get(`/notifications${qs}`).set('Cookie', cookies);
  const count = async (cookies: string[]): Promise<number> => {
    const res = await request(server()).get('/notifications/unread-count').set('Cookie', cookies);
    expect(res.status).toBe(200);
    return res.body.unread as number;
  };

  it('le port est fourni par le module générique et enregistre une notification', async () => {
    expect(await port.emit(emission())).toBe('created');
    const res = await list(asA());
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const [n] = res.body.items;
    expect(n).toMatchObject({
      kind: 'work.task_assigned',
      title: 'V vous a assigné #12 Poser le carrelage',
      href: '/projets/p-1?tache=t-1',
      actorUserId: colleagueId,
      readAt: null,
      source: { module: 'work', entityType: 'task', entityId: 't-1', projectId: 'p-1' },
    });
    expect(Object.keys(n)).not.toContain('requiredAction');
    expect(Object.keys(n)).not.toContain('recipientUserId');
    expect(await count(asA())).toBe(1);

    // Conservation : 180 jours par défaut.
    const db = await dbOf(app);
    const doc = await db.collection('notifications').findOne({ recipientUserId: ownerId });
    const days = (doc!['expiresAt'].getTime() - doc!['createdAt'].getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(180);
  });

  it('isolation par organisation : B ne voit, ne compte ni ne marque rien de A', async () => {
    const idA = (await list(asA())).body.items[0].id as string;
    expect((await list(asB())).body.items).toEqual([]);
    expect(await count(asB())).toBe(0);
    const forged = await request(server()).post(`/notifications/${idA}/read`).set('Cookie', asB());
    expect(forged.status).toBe(404);
    expect(forged.body.code ?? forged.body.error?.code).toBe('NOTIFICATION_NOT_FOUND');
    // Cookie d'organisation forgé : B n'est pas membre de A, `AuthGuard` le
    // ramène à sa propre organisation — jamais une ligne de A.
    const cross = await list([...cB, `active_org_id=${orgA}`]);
    expect(cross.status).toBe(200);
    expect(cross.body.items.map((n: { id: string }) => n.id)).not.toContain(idA);
    // Une émission pour B dans l'organisation A (dont il n'est pas membre) est écartée.
    expect(await port.emit(emission({ recipientUserId: ownerBId }))).toBe('not_member');
    expect(await port.emit(emission({ recipientUserId: outsiderId }))).toBe('not_member');
    // Et A ne voit pas les notifications de B dans B.
    expect(
      await port.emit(
        emission({ organizationId: orgB, recipientUserId: ownerBId, actorUserId: null }),
      ),
    ).toBe('created');
    expect(await count(asA())).toBe(1);
    expect(await count(asB())).toBe(1);
  });

  it('isolation par membre : un collègue de A ne voit ni ne marque celles du propriétaire', async () => {
    const idA = (await list(asA())).body.items[0].id as string;
    expect((await list(asV())).body.items).toEqual([]);
    expect(await count(asV())).toBe(0);
    const forged = await request(server()).post(`/notifications/${idA}/read`).set('Cookie', asV());
    expect(forged.status).toBe(404);
    const garbage = await request(server())
      .post('/notifications/pas-un-id/read')
      .set('Cookie', asV());
    expect(garbage.status).toBe(404);
    // `read-all` du collègue ne touche pas celles du propriétaire.
    await request(server()).post('/notifications/read-all').set('Cookie', asV()).expect(200);
    expect(await count(asA())).toBe(1);
  });

  it("l'auteur n'est jamais notifié ; un lien absolu est écarté sans lever", async () => {
    expect(await port.emit(emission({ actorUserId: ownerId }))).toBe('rejected');
    expect(await port.emit(emission({ href: 'https://evil.example/x' }))).toBe('rejected');
    expect(await port.emit(emission({ href: '//evil.example/x' }))).toBe('rejected');
    await expect(port.notify(emission({ title: '' }))).resolves.toBeUndefined();
    expect(await count(asA())).toBe(1);
  });

  it('dédoublonnage : la même clé émise trois fois crée une seule notification', async () => {
    const reminder = emission({
      kind: 'work.task_due_soon',
      actorUserId: null,
      dedupeKey: 'work.task_due_soon:t-1:2026-11-02',
      title: 'Échéance demain : #12 Poser le carrelage',
    });
    const outcomes = await Promise.all([port.emit(reminder), port.emit(reminder)]);
    outcomes.push(await port.emit(reminder));
    expect(outcomes.filter((o) => o === 'created')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(2);
    // Une autre échéance rouvre un rappel ; la même clé chez un autre destinataire aussi.
    expect(await port.emit({ ...reminder, dedupeKey: 'work.task_due_soon:t-1:2026-11-03' })).toBe(
      'created',
    );
    expect(await port.emit({ ...reminder, recipientUserId: colleagueId })).toBe('created');
    expect(await count(asA())).toBe(3);
    expect(await count(asV())).toBe(1);
  });

  it('préférences : un type coupé n’est plus enregistré ; corps contrôlé', async () => {
    const initial = await request(server()).get('/notifications/preferences').set('Cookie', asA());
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ mutedKinds: [] });

    const put = await request(server())
      .put('/notifications/preferences')
      .set('Cookie', asA())
      .send({ mutedKinds: ['work.mentioned'] });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ mutedKinds: ['work.mentioned'] });

    expect(await port.emit(emission({ kind: 'work.mentioned' }))).toBe('muted');
    expect(await port.emit(emission({ kind: 'work.comment_on_followed' }))).toBe('created');

    for (const bad of [
      { mutedKinds: ['crm.inconnu'] },
      { mutedKinds: ['work.mentioned', 'work.mentioned'] },
      { mutedKinds: [], userId: colleagueId },
      {},
    ]) {
      const res = await request(server())
        .put('/notifications/preferences')
        .set('Cookie', asA())
        .send(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    // Préférences personnelles : celles du collègue restent vides.
    const v = await request(server()).get('/notifications/preferences').set('Cookie', asV());
    expect(v.body).toEqual({ mutedKinds: [] });
    expect(
      await port.emit(
        emission({ kind: 'work.mentioned', recipientUserId: colleagueId, actorUserId: ownerId }),
      ),
    ).toBe('created');
  });

  it('revérification : un membre qui perd work.read ne voit plus ses notifications work.*', async () => {
    expect(await count(asV())).toBe(2);
    const db = await dbOf(app);
    await db
      .collection('memberships')
      .updateOne({ organizationId: orgA, userId: colleagueId }, { $set: { role: 'advisor' } });
    try {
      expect(await count(asV())).toBe(0);
      expect((await list(asV())).body.items).toEqual([]);
      // Une nouvelle émission exigeant `work.read` est refusée à l'émission.
      expect(
        await port.emit(emission({ recipientUserId: colleagueId, actorUserId: ownerId })),
      ).toBe('not_allowed');
    } finally {
      await db
        .collection('memberships')
        .updateOne({ organizationId: orgA, userId: colleagueId }, { $set: { role: 'viewer' } });
    }
    // Rendue l'action, les notifications réapparaissent (aucune n'a été supprimée).
    expect(await count(asV())).toBe(2);
  });

  it('lecture : curseur, non lues, marquage unitaire puis global', async () => {
    const all = (await list(asA(), '?limit=100')).body.items as { id: string }[];
    expect(all.length).toBe(4);

    const p1 = await list(asA(), '?limit=3');
    expect(p1.body.items).toHaveLength(3);
    expect(p1.body.nextCursor).toEqual(expect.any(String));
    const p2 = await list(asA(), `?limit=3&cursor=${p1.body.nextCursor as string}`);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
    expect([...p1.body.items, ...p2.body.items].map((n: { id: string }) => n.id)).toEqual(
      all.map((n) => n.id),
    );
    expect((await list(asA(), '?cursor=@@@')).status).toBe(400);
    expect((await list(asA(), '?limit=101')).status).toBe(400);
    expect((await list(asA(), '?autre=1')).status).toBe(400);

    const first = all[0]!.id;
    const read = await request(server()).post(`/notifications/${first}/read`).set('Cookie', asA());
    expect(read.status).toBe(200);
    expect(read.body.readAt).toEqual(expect.any(String));
    const again = await request(server()).post(`/notifications/${first}/read`).set('Cookie', asA());
    expect(again.body.readAt).toBe(read.body.readAt);
    expect(await count(asA())).toBe(3);
    const unread = await list(asA(), '?unreadOnly=true');
    expect(unread.body.items.map((n: { id: string }) => n.id)).not.toContain(first);

    const all2 = await request(server()).post('/notifications/read-all').set('Cookie', asA());
    expect(all2.status).toBe(200);
    expect(all2.body).toEqual({ unread: 0 });
    expect(await count(asA())).toBe(0);
    // Celles de B et du collègue ne sont pas touchées.
    expect(await count(asB())).toBe(1);
    expect(await count(asV())).toBe(2);
  });

  it('conservation : une notification échue n’est plus servie', async () => {
    const db = await dbOf(app);
    await db
      .collection('notifications')
      .updateMany(
        { organizationId: orgB, recipientUserId: ownerBId },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
    expect(await count(asB())).toBe(0);
    expect((await list(asB())).body.items).toEqual([]);
    const ttl = (await db.collection('notifications').indexes()).find(
      (i) => i.key['expiresAt'] === 1,
    );
    expect(ttl?.expireAfterSeconds).toBe(0);
  });
});
