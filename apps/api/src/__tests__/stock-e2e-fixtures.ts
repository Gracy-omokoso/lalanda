// Montage commun des suites e2e des stocks (ADR-0046, lot S3). ADR-0046 — S3.
//
// Une organisation N où le Propriétaire invite un membre par rôle utile (Magasinier
// compris), et une organisation B à UN SEUL détenteur de `stock.manage` (son
// Propriétaire) : isolation et « approbateur unique ». Vrai parcours invitation →
// acceptation ; chaque suite a sa base (`e2e-database.setup.ts`).

import type { INestApplication } from '@nestjs/common';
import type { Db } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, expect } from 'vitest';

import { dbOf, makeE2EApp, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

export const STOCK_ROLES = [
  'admin',
  'finance_director',
  'accountant',
  'storekeeper',
  'sales_rep',
  'hr_manager',
  'advisor',
] as const;
export type StockAccount = 'owner' | (typeof STOCK_ROLES)[number] | 'ownerB';

export interface StockFixture {
  app: () => INestApplication;
  db: () => Db;
  orgId: (who?: StockAccount) => string;
  userId: (who: StockAccount) => string;
  get: (who: StockAccount, path: string) => request.Test;
  post: (who: StockAccount, path: string, body?: unknown) => request.Test;
  put: (who: StockAccount, path: string, body: unknown) => request.Test;
  ok: (res: request.Response, status?: number) => Record<string, any>;
  code: (res: request.Response, status: number, expected: string) => void;
  /** Article créé par le Propriétaire (ou `who`). */
  item: (name: string, extra?: Record<string, unknown>, who?: StockAccount) => Promise<any>;
  /** Emplacement par défaut de l'organisation. */
  defaultLocation: (who?: StockAccount) => Promise<string>;
  /** Bon créé puis comptabilisé ; rend le bon (ou la réponse brute si refusé). */
  voucher: (
    who: StockAccount,
    body: Record<string, unknown>,
  ) => Promise<{ created: Record<string, any>; posted: request.Response }>;
}

export const kinshasaToday = (): string =>
  new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

export function useStockFixture(tag: string): StockFixture {
  let app: INestApplication;
  let db: Db;
  let orgN = '';
  let orgB = '';
  const cookies = {} as Record<StockAccount, string[]>;
  const userIds = {} as Record<StockAccount, string>;
  const server = () => app.getHttpServer();
  const orgOf = (who: StockAccount) => (who === 'ownerB' ? orgB : orgN);
  const as = (who: StockAccount): string[] => [...cookies[who], `active_org_id=${orgOf(who)}`];
  const compte = (c: StockAccount) => ({
    email: `stk-${c}-${tag}@lalanda-test.local`,
    password: 'Passw0rd!stocks-s3',
    name: `Membre ${c} ${tag}`,
  });

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    const firstOrg = async (c: StockAccount) => {
      cookies[c] = await registerAndLogin(app, compte(c));
      const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
      return (orgs.body.organizations as { id: string }[])[0]!.id;
    };
    const sessionUserId = async (c: StockAccount) => {
      const s = await request(server()).get('/auth/get-session').set('Cookie', cookies[c]);
      return String(s.body?.user?.id ?? '');
    };
    orgN = await firstOrg('owner');
    userIds.owner = await sessionUserId('owner');
    for (const role of STOCK_ROLES) {
      const inv = await request(server())
        .post(`/organizations/${orgN}/invitations`)
        .set('Cookie', cookies.owner)
        .send({ email: compte(role).email, role });
      expect(inv.status, `invitation ${role} ${JSON.stringify(inv.body)}`).toBe(201);
      cookies[role] = await registerAndLogin(app, compte(role));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: inv.body.token });
      expect(acc.status).toBe(201);
      userIds[role] = await sessionUserId(role);
    }
    orgB = await firstOrg('ownerB');
    userIds.ownerB = await sessionUserId('ownerB');
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  }, E2E_HOOK_TIMEOUT_MS);

  const ok = (res: request.Response, status = 200): Record<string, any> => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const get = (who: StockAccount, path: string) =>
    request(server()).get(path).set('Cookie', as(who));
  const post = (who: StockAccount, path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', as(who))
      .send((body ?? {}) as object);
  const put = (who: StockAccount, path: string, body: unknown) =>
    request(server())
      .put(path)
      .set('Cookie', as(who))
      .send(body as object);

  return {
    app: () => app,
    db: () => db,
    orgId: (who = 'owner') => orgOf(who),
    userId: (who) => userIds[who],
    get,
    post,
    put,
    ok,
    code: (res, status, expected) => {
      expect(res.status, JSON.stringify(res.body)).toBe(status);
      expect(res.body.code).toBe(expected);
    },
    item: async (name, extra = {}, who = 'owner') =>
      ok(await post(who, '/stock/items', { name, unit: 'pièce', ...extra }), 201),
    defaultLocation: async (who = 'owner') =>
      ok(await get(who, '/stock/settings'))['defaultLocationId'] as string,
    voucher: async (who, body) => {
      const created = ok(
        await post(who, '/stock/vouchers', { postedOn: kinshasaToday(), ...body }),
        201,
      );
      const posted = await post(who, `/stock/vouchers/${created['id']}/post`, {
        expectedRevision: created['revision'],
      });
      return { created, posted };
    },
  };
}
