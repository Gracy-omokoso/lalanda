// Montage commun des suites e2e du lot P4 (ADR-0044 : réceptions, factures
// fournisseurs, rapprochement). ADR-0044 — P4.
//
// Une organisation N avec un compte par rôle utile aux achats (deux approbateurs :
// Propriétaire et Directeur financier), une organisation B à UN SEUL approbateur
// (isolation et « approbateur unique »). Doublures posées sur les instances :
//
//   - stockage objet en mémoire (`ObjectStorageService`) ;
//   - enregistreur des notifications : il ENVELOPPE le port réel ;
//   - enregistreur du port de stock (nul en R3, § 6.6).
//
// Les commandes sont créées par les routes du lot P3 : demande du Propriétaire,
// approbation du Directeur financier (séparation des tâches), envoi manuel.

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';

import type { NotificationInput } from '../notifications/notifications.port.js';
import { SupplierInvoicesNotifier } from '../purchases/invoices/supplier-invoices-notifier.js';
import {
  PURCHASE_RECEPTION_SINK,
  type PurchaseReceptionChange,
  type PurchaseReceptionSink,
} from '../purchases/stock-sink.port.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { dbOf, makeE2EApp, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

export const P4_ROLES = [
  'owner',
  'admin',
  'finance_director',
  'accountant',
  'analyst',
  'viewer',
  'sales_rep',
] as const;
export type P4Role = (typeof P4_ROLES)[number];
export type P4Account = P4Role | 'ownerB';

export interface OrderLineSeed {
  id: string;
  label?: string;
  quantity: string;
  unitPrice: string;
  unit?: string;
  discountPercent?: string | null;
  kind?: 'goods' | 'service';
  receivable?: boolean;
  category?: string | null;
  workProjectId?: string | null;
}

export interface P4Fixture {
  app: () => INestApplication;
  db: () => Db;
  orgId: (who?: P4Account) => string;
  userId: (who: P4Account) => string;
  get: (who: P4Account, path: string) => request.Test;
  post: (who: P4Account, path: string, body?: unknown) => request.Test;
  put: (who: P4Account, path: string, body: unknown) => request.Test;
  postRaw: (who: P4Account, path: string) => request.Test;
  ok: (res: request.Response, status?: number) => Record<string, any>;
  code: (res: request.Response, status: number, expected: string) => void;
  notifications: NotificationInput[];
  stockChanges: PurchaseReceptionChange[];
  objects: Map<string, { body: Buffer; contentType: string }>;
  supplier: (who: P4Account, name: string, extra?: Record<string, unknown>) => Promise<string>;
  /** Commande créée par les routes du lot P3 (demande, soumission, approbation, envoi). */
  seedOrder: (input: {
    who?: P4Account;
    supplierId: string;
    currency?: 'CDF' | 'USD';
    lines: OrderLineSeed[];
    status?: 'cancelled';
    phase?: 'request' | 'order';
    sent?: boolean;
    declaredTaxes?: { label: string; amount: string }[];
  }) => Promise<{ id: string; line: Record<string, string> }>;
  order: (orderId: string) => Promise<Record<string, any>>;
}

export function useP4Fixture(prefix: string): P4Fixture {
  const tag = randomBytes(4).toString('hex');
  process.env['MONGODB_DB'] = `${process.env['MONGODB_DB'] ?? 'lalanda'}_${prefix}_${tag}`.slice(
    0,
    60,
  );
  const password = 'Passw0rd!achats-p4';
  let app: INestApplication;
  let db: Db;
  let orgN = '';
  let orgB = '';
  const cookies = {} as Record<P4Account, string[]>;
  const userIds = {} as Record<P4Account, string>;
  const notifications: NotificationInput[] = [];
  const stockChanges: PurchaseReceptionChange[] = [];
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  let orderSeq = 0;

  const server = () => app.getHttpServer();
  const orgOf = (who: P4Account) => (who === 'ownerB' ? orgB : orgN);
  const as = (who: P4Account): string[] => [...cookies[who], `active_org_id=${orgOf(who)}`];

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);

    const storage = app.get(ObjectStorageService);
    storage.uploadsBucket = () => 'achats-test';
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

    const notifier = app.get(SupplierInvoicesNotifier);
    const inner = notifier.port;
    notifier.port = {
      notify: async (input) => {
        notifications.push(input);
        await inner.notify(input);
      },
    };
    const sink = app.get<PurchaseReceptionSink>(PURCHASE_RECEPTION_SINK);
    sink.onReceptionChanged = async (change) => {
      stockChanges.push(change);
    };

    const account = (who: P4Account) => ({
      email: `${prefix}-${who}-${tag}@lalanda-test.local`,
      password,
      name: `Achats ${who}`,
    });
    cookies.owner = await registerAndLogin(app, account('owner'));
    const orgs = await request(server()).get('/organizations').set('Cookie', cookies.owner);
    orgN = (orgs.body.organizations as { id: string }[])[0]!.id;
    for (const role of P4_ROLES.filter((r) => r !== 'owner')) {
      const inv = await request(server())
        .post(`/organizations/${orgN}/invitations`)
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

    for (const m of await db.collection('memberships').find({}).toArray()) {
      if (m['organizationId'] === orgB) userIds.ownerB = m['userId'] as string;
      else if (m['organizationId'] === orgN) userIds[m['role'] as P4Role] = m['userId'] as string;
    }
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

  const post = (who: P4Account, path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', as(who))
      .send((body ?? {}) as object);
  const ok = (res: request.Response, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };

  return {
    app: () => app,
    db: () => db,
    orgId: (who = 'owner') => orgOf(who),
    userId: (who) => userIds[who],
    get: (who, path) => request(server()).get(path).set('Cookie', as(who)),
    post,
    put: (who, path, body) =>
      request(server())
        .put(path)
        .set('Cookie', as(who))
        .send(body as object),
    postRaw: (who, path) => request(server()).post(path).set('Cookie', as(who)),
    ok,
    code: (res, status, expected) => {
      expect(res.status, JSON.stringify(res.body)).toBe(status);
      expect(res.body.code, JSON.stringify(res.body)).toBe(expected);
    },
    notifications,
    stockChanges,
    objects,
    supplier: async (who, name, extra = {}) => {
      const body = ok(
        await post(who, '/purchases/suppliers', { name: `${name} ${tag}`, ...extra }),
        201,
      );
      return body['supplier']['id'] as string;
    },
    seedOrder: async (input) => {
      const who = input.who ?? 'owner';
      const approver: P4Account = who === 'ownerB' ? 'ownerB' : 'finance_director';
      orderSeq += 1;
      const created = ok(
        await post(who, '/purchases/orders', {
          title: `Commande ${orderSeq}`,
          supplierId: input.supplierId,
          currency: input.currency ?? 'USD',
          lines: input.lines.map((l) => ({
            label: l.label ?? `Ligne ${l.id}`,
            quantity: l.quantity,
            unit: l.unit ?? 'pièce',
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent ?? null,
            kind: l.kind ?? 'goods',
            ...(l.receivable === undefined ? {} : { receivable: l.receivable }),
            category: l.category ?? 'achats',
            workProjectId: l.workProjectId ?? null,
          })),
          ...(input.declaredTaxes ? { declaredTaxes: input.declaredTaxes } : {}),
        }),
        201,
      );
      const id = created['id'] as string;
      const lineIds: Record<string, string> = {};
      input.lines.forEach((l, i) => {
        lineIds[l.id] = (created['lines'] as { id: string }[])[i]!.id;
      });
      let o = ok(
        await post(who, `/purchases/orders/${id}/submit`, {
          expectedRevision: created['revision'],
        }),
      );
      if ((input.phase ?? 'order') === 'order' && o['status'] === 'submitted') {
        o = ok(
          await post(approver, `/purchases/orders/${id}/approve`, {
            expectedRevision: o['revision'],
          }),
        );
      }
      if ((input.phase ?? 'order') === 'order' && input.sent !== false) {
        o = ok(
          await post(who, `/purchases/orders/${id}/mark-sent`, { expectedRevision: o['revision'] }),
        );
      }
      if (input.status === 'cancelled') {
        ok(
          await post(who, `/purchases/orders/${id}/cancel`, {
            reason: 'Essai',
            expectedRevision: o['revision'],
          }),
        );
      }
      return { id, line: lineIds };
    },
    order: async (orderId) =>
      (await db
        .collection('purchase_orders')
        .findOne({ _id: new ObjectId(orderId) })) as unknown as Record<string, any>,
  };
}
