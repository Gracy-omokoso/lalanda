// Montage commun des suites e2e du module « work » (ADR-0039, lot L1).
//
// Une organisation A avec un compte par rôle attribuable utile au module, une
// organisation B (isolation). Deux doublures, posées sur les instances de
// l'application et non par configuration :
//
//   - stockage objet en mémoire (`ObjectStorageService`) : les pièces jointes
//     sont testées sans MinIO, octets compris ;
//   - enregistreur des notifications émises : il ENVELOPPE le port réel
//     (`WorkNotifier.port`), il ne le remplace pas — la suite reste valable une
//     fois le module de notifications (lot L2) fusionné.
//
// Les compteurs de débit sont vidés avant chaque test (motif de `fiscal.e2e`).

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';

import type { NotificationInput } from '../notifications/notifications.port.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { WorkNotifier } from '../work/work-notifier.js';
import { dbOf, makeE2EApp, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

export const WORK_ROLES = ['owner', 'admin', 'accountant', 'analyst', 'advisor', 'viewer'] as const;
export type WorkRole = (typeof WORK_ROLES)[number];
export type WorkAccount = WorkRole | 'ownerB';

export interface WorkFixture {
  app: () => INestApplication;
  db: () => Db;
  orgId: () => string;
  orgB: () => string;
  userId: (who: WorkAccount) => string;
  as: (who: WorkAccount) => string[];
  get: (who: WorkAccount, path: string) => request.Test;
  post: (who: WorkAccount, path: string, body?: unknown) => request.Test;
  put: (who: WorkAccount, path: string, body: unknown) => request.Test;
  patch: (who: WorkAccount, path: string, body: unknown) => request.Test;
  del: (who: WorkAccount, path: string) => request.Test;
  /** Notifications émises depuis le dernier `clear()`. */
  notifications: NotificationInput[];
  /** Objets du stockage simulé. */
  objects: Map<string, { body: Buffer; contentType: string }>;
  issueCodes: (res: request.Response) => string[];
}

export function useWorkFixture(prefix: string): WorkFixture {
  const tag = randomBytes(4).toString('hex');
  const password = 'Passw0rd!projets';
  let app: INestApplication;
  let db: Db;
  let orgId = '';
  let orgB = '';
  const cookies = {} as Record<WorkAccount, string[]>;
  const userIds = {} as Record<WorkAccount, string>;
  const notifications: NotificationInput[] = [];
  const objects = new Map<string, { body: Buffer; contentType: string }>();

  const server = () => app.getHttpServer();
  const as = (who: WorkAccount): string[] => [
    ...cookies[who],
    `active_org_id=${who === 'ownerB' ? orgB : orgId}`,
  ];

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);

    // Stockage objet en mémoire.
    const storage = app.get(ObjectStorageService);
    storage.uploadsBucket = () => 'work-test';
    storage.putObject = async (bucket, key, body, contentType) => {
      objects.set(`${bucket}/${key}`, { body: Buffer.from(body), contentType });
    };
    storage.getObject = async (bucket, key) => {
      const o = objects.get(`${bucket}/${key}`);
      return o ? { body: o.body, contentType: o.contentType } : null;
    };
    storage.deleteObject = async (bucket, key) => {
      objects.delete(`${bucket}/${key}`);
    };

    // Enregistreur des notifications, autour du port réel.
    const notifier = app.get(WorkNotifier);
    const inner = notifier.port;
    notifier.port = {
      notify: async (input) => {
        notifications.push(input);
        await inner.notify(input);
      },
    };

    const account = (who: WorkAccount) => ({
      email: `${prefix}-${who}-${tag}@lalanda-test.local`,
      password,
      name: `Membre ${who}`,
    });
    cookies.owner = await registerAndLogin(app, account('owner'));
    const orgs = await request(server()).get('/organizations').set('Cookie', cookies.owner);
    orgId = (orgs.body.organizations as { id: string }[])[0]!.id;
    for (const role of WORK_ROLES.filter((r) => r !== 'owner')) {
      const inv = await request(server())
        .post(`/organizations/${orgId}/invitations`)
        .set('Cookie', cookies.owner)
        .send({ email: account(role).email, role });
      expect(inv.status, `invitation ${role} ${JSON.stringify(inv.body)}`).toBe(201);
      cookies[role] = await registerAndLogin(app, account(role));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: inv.body.token });
      expect(acc.status, `acceptation ${role}`).toBe(201);
    }
    cookies.ownerB = await registerAndLogin(app, account('ownerB'));
    const orgsB = await request(server()).get('/organizations').set('Cookie', cookies.ownerB);
    orgB = (orgsB.body.organizations as { id: string }[])[0]!.id;

    const members = await request(server())
      .get(`/organizations/${orgId}/members`)
      .set('Cookie', as('owner'));
    expect(members.status).toBe(200);
    for (const m of members.body.members as { userId: string; role: WorkRole }[]) {
      userIds[m.role] = m.userId;
    }
    const membersB = await request(server())
      .get(`/organizations/${orgB}/members`)
      .set('Cookie', as('ownerB'));
    expect(membersB.status).toBe(200);
    userIds.ownerB = (membersB.body.members as { userId: string }[])[0]!.userId;
  }, E2E_HOOK_TIMEOUT_MS);

  beforeEach(() => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  });

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, E2E_HOOK_TIMEOUT_MS);

  return {
    app: () => app,
    db: () => db,
    orgId: () => orgId,
    orgB: () => orgB,
    userId: (who) => userIds[who],
    as,
    get: (who, path) => request(server()).get(path).set('Cookie', as(who)),
    post: (who, path, body) =>
      request(server())
        .post(path)
        .set('Cookie', as(who))
        .send((body ?? {}) as object),
    put: (who, path, body) =>
      request(server())
        .put(path)
        .set('Cookie', as(who))
        .send(body as object),
    patch: (who, path, body) =>
      request(server())
        .patch(path)
        .set('Cookie', as(who))
        .send(body as object),
    del: (who, path) => request(server()).delete(path).set('Cookie', as(who)),
    notifications,
    objects,
    issueCodes: (res) =>
      ((res.body?.details?.issues ?? []) as { code: string }[]).map((i) => i.code),
  };
}
