// Montage commun des suites e2e des ressources humaines (ADR-0045). ADR-0045 — H2.
//
// Une organisation N où le Propriétaire invite un membre par rôle (le Responsable RH
// compris : seul le Propriétaire peut l'attribuer), une organisation B (isolation) et
// un super-administrateur plateforme SANS appartenance à N. Les identifiants des
// comptes se lisent dans les adhésions. Vrai parcours invitation → acceptation.

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import request from 'supertest';
import { expect } from 'vitest';

import { dbOf, makeE2EApp, registerAndLogin } from './e2e-utils.js';

export const HR_ROLES = [
  'admin',
  'finance_director',
  'accountant',
  'analyst',
  'viewer',
  'sales_rep',
  'advisor',
  'hr_manager',
] as const;
export type HrRole = 'owner' | (typeof HR_ROLES)[number];
export type HrAccount = HrRole | 'ownerB' | 'superAdmin';

export interface HrFixture {
  app: INestApplication;
  db: Db;
  orgN: string;
  orgB: string;
  userIds: Record<HrAccount, string>;
  as: (account: HrAccount) => string[];
  get: (account: HrAccount, path: string) => request.Test;
  post: (account: HrAccount, path: string, body?: unknown) => request.Test;
  put: (account: HrAccount, path: string, body: unknown) => request.Test;
  clearThrottle: () => void;
}

export async function hrFixture(tag: string, prefix: string): Promise<HrFixture> {
  const app = await makeE2EApp();
  const db = await dbOf(app);
  const server = () => app.getHttpServer();
  const cookies = {} as Record<HrAccount, string[]>;
  const userIds = {} as Record<HrAccount, string>;
  const compte = (c: HrAccount) => ({
    email: `${prefix}-${c}-${tag}@lalanda-test.local`,
    password: `Passw0rd!${prefix}`,
    name: `${c === 'viewer' ? 'Bea' : c === 'analyst' ? 'Aline' : 'Membre'} ${c} ${tag}`,
  });
  const orgDe = async (c: HrAccount) => {
    cookies[c] = await registerAndLogin(app, compte(c));
    const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
    return (orgs.body.organizations as { id: string }[])[0]!.id;
  };
  const sessionUserId = async (c: HrAccount) => {
    const s = await request(server()).get('/auth/get-session').set('Cookie', cookies[c]);
    const id = String(s.body?.user?.id ?? '');
    expect(id).not.toBe('');
    return id;
  };

  const orgN = await orgDe('owner');
  userIds['owner'] = await sessionUserId('owner');
  for (const role of HR_ROLES) {
    const inv = await request(server())
      .post(`/organizations/${orgN}/invitations`)
      .set('Cookie', cookies['owner'])
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
  const orgB = await orgDe('ownerB');
  userIds['ownerB'] = await sessionUserId('ownerB');
  await orgDe('superAdmin');
  userIds['superAdmin'] = await sessionUserId('superAdmin');
  await db.collection('platform_roles').insertOne({
    userId: userIds['superAdmin'],
    role: 'platform_super_admin',
    grantedBy: null,
    reason: 'e2e RH',
    expiresAt: null,
    revokedAt: null,
    _schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const as = (c: HrAccount) => [...cookies[c], `active_org_id=${c === 'ownerB' ? orgB : orgN}`];
  return {
    app,
    db,
    orgN,
    orgB,
    userIds,
    as,
    get: (c, path) => request(server()).get(path).set('Cookie', as(c)),
    post: (c, path, body) =>
      request(server())
        .post(path)
        .set('Cookie', as(c))
        .send((body ?? {}) as object),
    put: (c, path, body) =>
      request(server())
        .put(path)
        .set('Cookie', as(c))
        .send(body as object),
    clearThrottle: () => {
      const store = app.get(ThrottlerStorage) as unknown as {
        storage: Map<string, unknown>;
        timeoutIds: Map<string, NodeJS.Timeout[]>;
      };
      for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
      store.timeoutIds.clear();
      store.storage.clear();
    },
  };
}

export function ok(res: request.Response, status = 200): Record<string, any> {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Record<string, any>;
}

export function code(res: request.Response, status: number, expected: string): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.code).toBe(expected);
}

/** Corps minimal d'une fiche. */
export function fiche(lastName: string, extra: Record<string, unknown> = {}) {
  return {
    firstName: 'Test',
    lastName,
    jobTitle: 'Agent',
    contractType: 'permanent',
    startDate: '2026-01-05',
    ...extra,
  };
}
