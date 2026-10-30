// ADR-0041 — A2 : stockage, résolution et comptage des détenteurs effectifs.
//
// Ce que ce fichier protège :
// - `overridesOf` traite un document SANS les champs nouveaux comme « exactement le
//   titre » (aucune migration, critère 17), et l'interrupteur éteint neutralise tout
//   écart stocké ;
// - `holdersFilter` (base de `countApprovers` et `holdersOf`) désigne EXACTEMENT les
//   appartenances pour lesquelles `can(role, action, ctx)` est vrai — vérifié par un
//   petit évaluateur de filtre Mongo sur tous les rôles, toutes les actions et des
//   écarts tirés à graine fixe ;
// - `resolveOrgRole` relit l'appartenance à chaque appel (G8 : aucun cache) ;
// - le 403 nomme l'action et dit si un retrait en est la cause.

import type { Model } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MembershipDocument } from '../organizations/membership.schema.js';
import type { PlatformRoleAssignmentDocument } from './platform-role-assignment.schema.js';
import {
  AuthzService,
  forbidden,
  holdersFilter,
  memberPermissionsEnabled,
  overridesOf,
} from './authz.service.js';
import { buildAuthzCatalog } from './catalog.controller.js';
import {
  ACTIONS,
  APPROVER_ROLES,
  ORG_ROLES,
  can,
  type Action,
  type OrgPermissionContext,
  type OrgRole,
} from './permissions.js';

const ON = { MEMBER_PERMISSIONS_ENABLED: 'true' } as NodeJS.ProcessEnv;
const OFF = {} as NodeJS.ProcessEnv;

interface FakeMembership {
  organizationId: string;
  role: OrgRole;
  canClosePeriods: boolean;
  grants?: Action[];
  revokes?: Action[];
}

/** Évaluateur minimal des seules formes de filtre produites par `holdersFilter`. */
function matches(filter: Record<string, unknown>, doc: FakeMembership): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') {
      return (cond as Record<string, unknown>[]).some((f) => matches(f, doc));
    }
    if (key === '_id') return false;
    const value = (doc as unknown as Record<string, unknown>)[key];
    if (cond !== null && typeof cond === 'object' && '$in' in cond) {
      return ((cond as { $in: unknown[] }).$in ?? []).includes(value);
    }
    if (cond !== null && typeof cond === 'object' && '$ne' in cond) {
      const ne = (cond as { $ne: unknown }).$ne;
      return Array.isArray(value) ? !value.includes(ne) : value !== ne;
    }
    if (Array.isArray(value)) return value.includes(cond);
    return value === cond;
  });
}

/** Générateur pseudo-aléatoire à graine fixe (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('interrupteur MEMBER_PERMISSIONS_ENABLED', () => {
  it('est éteint par défaut et ne s’allume que sur la valeur exacte « true »', () => {
    expect(memberPermissionsEnabled(OFF)).toBe(false);
    expect(memberPermissionsEnabled({ MEMBER_PERMISSIONS_ENABLED: '1' } as NodeJS.ProcessEnv)).toBe(
      false,
    );
    expect(memberPermissionsEnabled(ON)).toBe(true);
  });
});

describe('overridesOf (ADR-0041 § 9.1)', () => {
  it('document sans les champs nouveaux : écart vide (exactement le titre)', () => {
    expect(overridesOf({}, ON)).toEqual({ grants: [], revokes: [] });
    expect(overridesOf(null, ON)).toEqual({ grants: [], revokes: [] });
    expect(overridesOf({ grants: null, revokes: undefined }, ON)).toEqual({
      grants: [],
      revokes: [],
    });
  });

  it('interrupteur éteint : tout écart stocké est ignoré', () => {
    expect(overridesOf({ grants: ['crm.manage'], revokes: ['sales.invoice'] }, OFF)).toEqual({
      grants: [],
      revokes: [],
    });
  });

  it('interrupteur allumé : lit l’écart, sans doublon, en ignorant une valeur inconnue', () => {
    expect(
      overridesOf(
        { grants: ['crm.manage', 'crm.manage', 'inconnue'], revokes: ['sales.invoice'] },
        ON,
      ),
    ).toEqual({ grants: ['crm.manage'], revokes: ['sales.invoice'] });
  });
});

describe('holdersFilter — détenteurs effectifs (ADR-0041 § 9.3)', () => {
  it('interrupteur éteint, `plan.approve` : exactement le filtre par rôle d’avant', () => {
    const filter = holdersFilter('org', 'plan.approve', OFF);
    expect(filter).toEqual({
      organizationId: 'org',
      $or: [{ role: { $in: [...APPROVER_ROLES] } }],
    });
  });

  it('équivaut à `can(role, action, ctx)` sur tous les rôles, toutes les actions, 2 000 écarts', () => {
    const random = rng(41);
    const pick = (): Action[] => ACTIONS.filter(() => random() < 0.12);
    const filters = new Map(ACTIONS.map((a) => [a, holdersFilter('org', a, ON)] as const));
    const ailleurs = new Map(ACTIONS.map((a) => [a, holdersFilter('autre', a, ON)] as const));
    const ecarts: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const role = ORG_ROLES[Math.floor(random() * ORG_ROLES.length)]!;
      const grants = pick();
      const revokes = pick().filter((a) => !grants.includes(a));
      const doc: FakeMembership = {
        organizationId: 'org',
        role,
        canClosePeriods: random() < 0.5,
        grants,
        revokes,
      };
      const ctx: OrgPermissionContext = { canClosePeriods: doc.canClosePeriods, grants, revokes };
      for (const action of ACTIONS) {
        if (matches(filters.get(action)!, doc) !== can(role, action, ctx)) {
          ecarts.push(`${i} ${role} · ${action}`);
        }
        if (matches(ailleurs.get(action)!, doc)) ecarts.push(`${i} autre org · ${action}`);
      }
    }
    expect(ecarts).toEqual([]);
  });

  it('éteint, ignore l’écart : équivaut à la ligne du rôle et à la case ⚙', () => {
    for (const role of ORG_ROLES) {
      for (const canClosePeriods of [false, true]) {
        const doc: FakeMembership = {
          organizationId: 'org',
          role,
          canClosePeriods,
          grants: ['crm.manage'],
          revokes: ['analytics.read'],
        };
        for (const action of ACTIONS) {
          expect(matches(holdersFilter('org', action, OFF), doc)).toBe(
            can(role, action, { canClosePeriods }),
          );
        }
      }
    }
  });
});

describe('AuthzService', () => {
  const ENV = process.env['MEMBER_PERMISSIONS_ENABLED'];
  afterEach(() => {
    if (ENV === undefined) delete process.env['MEMBER_PERMISSIONS_ENABLED'];
    else process.env['MEMBER_PERMISSIONS_ENABLED'] = ENV;
  });

  function harnais(docs: Record<string, unknown>[]) {
    const lean = (value: unknown) => ({ lean: () => ({ exec: async () => value }) });
    const findOne = vi.fn(() => ({ select: () => lean(docs[0] ?? null) }));
    const find = vi.fn((filter: Record<string, unknown>) => ({
      select: () => lean(docs.filter((d) => matches(filter, d as unknown as FakeMembership))),
    }));
    const countDocuments = vi.fn((filter: Record<string, unknown>) => ({
      exec: async () => docs.filter((d) => matches(filter, d as unknown as FakeMembership)).length,
    }));
    const memberships = { findOne, find, countDocuments } as unknown as Model<MembershipDocument>;
    const service = new AuthzService(
      memberships,
      {} as unknown as Model<PlatformRoleAssignmentDocument>,
    );
    return { service, findOne };
  }

  it('resolveOrgRole : appartenance sans les champs nouveaux = contexte d’avant, révision 0', async () => {
    process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
    const { service } = harnais([{ role: 'accountant', canClosePeriods: false }]);
    expect(await service.resolveOrgRole('u', 'org')).toEqual({
      role: 'accountant',
      context: { canClosePeriods: false },
      permissionsRevision: 0,
    });
  });

  it('resolveOrgRole : lit l’écart et la révision quand l’interrupteur est allumé', async () => {
    const doc = {
      role: 'sales_rep',
      canClosePeriods: false,
      grants: ['treasury.read'],
      revokes: ['crm.manage'],
      permissionsRevision: 3,
    };
    delete process.env['MEMBER_PERMISSIONS_ENABLED'];
    const off = await harnais([doc]).service.resolveOrgRole('u', 'org');
    expect(off?.context).toEqual({ canClosePeriods: false });

    process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
    const on = await harnais([doc]).service.resolveOrgRole('u', 'org');
    expect(on).toEqual({
      role: 'sales_rep',
      context: { canClosePeriods: false, grants: ['treasury.read'], revokes: ['crm.manage'] },
      permissionsRevision: 3,
    });
  });

  it('G8 — aucune mise en cache : chaque résolution relit l’appartenance', async () => {
    const { service, findOne } = harnais([{ role: 'viewer', canClosePeriods: false }]);
    await service.resolveOrgRole('u', 'org');
    await service.resolveOrgRole('u', 'org');
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('countApprovers et holdersOf comptent les détenteurs effectifs (interrupteur allumé)', async () => {
    process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
    const docs = [
      { userId: 'o', organizationId: 'org', role: 'owner', canClosePeriods: false },
      {
        userId: 'fd',
        organizationId: 'org',
        role: 'finance_director',
        canClosePeriods: false,
        revokes: ['plan.approve'],
      },
      {
        userId: 'v',
        organizationId: 'org',
        role: 'viewer',
        canClosePeriods: false,
        grants: ['plan.approve'],
      },
    ];
    const { service } = harnais(docs);
    expect(await service.countApprovers('org')).toBe(2);
    expect(await service.holdersOf('org', 'plan.approve')).toEqual(['o', 'v']);

    delete process.env['MEMBER_PERMISSIONS_ENABLED'];
    expect(await service.countApprovers('org')).toBe(2);
    expect(await service.holdersOf('org', 'plan.approve')).toEqual(['o', 'fd']);
  });
});

describe('forbidden — 403 du guard (ADR-0041 § 6)', () => {
  it('nomme l’action manquante ; `customized` faux par défaut', () => {
    expect(forbidden('sales.invoice', 'accountant')).toMatchObject({
      code: 'FORBIDDEN',
      action: 'sales.invoice',
      role: 'accountant',
      customized: false,
    });
  });

  it('`customized: true` et message de retrait quand un retrait est en cause', () => {
    const payload = forbidden('sales.invoice', 'accountant', true);
    expect(payload.customized).toBe(true);
    expect(payload.message).toContain('retirée à votre compte');
  });
});

describe('catalogue des autorisations (ADR-0041 § 5, § 6)', () => {
  const catalog = buildAuthzCatalog();

  it('dit si la personnalisation est ouverte (interrupteur, lu à chaque appel)', () => {
    expect(buildAuthzCatalog({}).memberPermissionsEnabled).toBe(false);
    expect(buildAuthzCatalog({ MEMBER_PERMISSIONS_ENABLED: 'true' }).memberPermissionsEnabled).toBe(
      true,
    );
  });

  it('chaque action figure dans exactement un domaine et a un libellé', () => {
    const vues = catalog.domains.flatMap((d) => d.actions);
    expect([...vues].sort()).toEqual([...ACTIONS].sort());
    for (const a of ACTIONS) expect(catalog.labels[a]?.length).toBeGreaterThan(0);
  });

  it('expose paires, non délégables, socle et dépendances ; aucune paire facturation', () => {
    expect(catalog.sodPairs).toEqual([
      ['inputs.update', 'plan.approve'],
      ['period.close', 'plan.approve'],
    ]);
    expect(catalog.nonDelegable).toEqual(['billing.manage']);
    expect(catalog.baseAction).toBe('analytics.read');
    expect(catalog.dependencies['sales.invoice']).toEqual(['sales.manage']);
  });

  it('la ligne de chaque rôle attribuable, case ⚙ à part ; `project_manager` absent', () => {
    expect(catalog.roleMatrix.map((r) => r.role)).not.toContain('project_manager');
    const accountant = catalog.roleMatrix.find((r) => r.role === 'accountant')!;
    expect(accountant.conditional).toEqual(['period.close']);
    expect(accountant.actions).not.toContain('period.close');
    for (const row of catalog.roleMatrix) {
      for (const a of row.actions) expect(can(row.role, a, {})).toBe(true);
    }
  });
});
