// ADR-0053 — P0 : matrice plateforme (critère 15, volet unitaire) et tables de vérité des
// fonctions de décision (§ 5.3, critère 16 pour l'attribution de rôle).

import {
  PLATFORM_AUDIENCE_SUBSCRIPTION_STATUSES,
  PLATFORM_ROLE_SLUGS,
} from '@lalanda/shared/platform';
import { describe, expect, it } from 'vitest';

import { SUBSCRIPTION_STATUSES } from '../billing/subscription-state.js';
import { ACTIONS, ORG_ROLES, PLATFORM_ROLES, type PlatformRole } from './permissions.js';
import {
  PLATFORM_ACTIONS,
  PLATFORM_ACTION_MATRIX,
  announcementSendDecision,
  broadcastApprovalDecision,
  canAnyPlatformAction,
  canPlatformAction,
  platformActionHolders,
  platformActionsOf,
  platformGrantDecision,
  platformGrantNeedsSecondPerson,
  platformRoleGrantDecision,
  platformSelfDealingDecision,
  type PlatformAction,
  type PlatformActionGrant,
} from './platform-actions.js';

/**
 * Transcription INDÉPENDANTE d'ADR-0053 § 5.2, rôle par rôle (la source l'écrit action par
 * action) : une faute de recopie dans l'un des deux sens fait rougir le test.
 * ✓ = allow, ⓢ = allow_sod, ✗ = deny.
 */
const ATTENDU: Record<PlatformRole, Partial<Record<PlatformAction, PlatformActionGrant>>> = {
  platform_super_admin: {
    'platform.console.read': 'allow',
    'platform.orgs.read': 'allow',
    'platform.orgs.suspend': 'allow',
    'platform.users.read': 'allow',
    'platform.users.block': 'allow',
    'platform.roles.manage': 'allow',
    'platform.billing.read': 'allow',
    'platform.billing.confirm': 'allow',
    'platform.billing.grant': 'allow',
    'platform.features.read': 'allow',
    'platform.features.override': 'allow',
    'platform.integrations.manage': 'allow',
    'platform.audit.read': 'allow',
    'platform.audit.export': 'allow',
    'platform.announcements.draft': 'allow',
    'platform.announcements.approve': 'allow_sod',
    'platform.stats.read': 'allow',
    'platform.finance.read': 'allow',
    'platform.finance.export': 'allow',
  },
  platform_admin: {
    'platform.console.read': 'allow',
    'platform.orgs.read': 'allow',
    'platform.orgs.suspend': 'allow',
    'platform.users.read': 'allow',
    'platform.users.block': 'allow',
    'platform.billing.read': 'allow',
    'platform.billing.grant': 'allow_sod',
    'platform.features.read': 'allow',
    'platform.features.override': 'allow',
    'platform.audit.read': 'allow',
    'platform.announcements.draft': 'allow',
    'platform.announcements.approve': 'allow_sod',
    'platform.stats.read': 'allow',
  },
  platform_support: {
    'platform.console.read': 'allow',
    'platform.orgs.read': 'allow',
    'platform.users.read': 'allow',
    'platform.features.read': 'allow',
  },
  platform_billing: {
    'platform.console.read': 'allow',
    'platform.orgs.read': 'allow',
    'platform.billing.read': 'allow',
    'platform.billing.confirm': 'allow',
    'platform.billing.grant': 'allow_sod',
    'platform.features.read': 'allow',
    'platform.stats.read': 'allow',
    'platform.finance.read': 'allow',
    'platform.finance.export': 'allow',
  },
  platform_template_editor: {
    'platform.console.read': 'allow',
    'platform.templates.manage': 'allow',
  },
  platform_country_pack_manager: {
    'platform.console.read': 'allow',
    'platform.packs.manage': 'allow',
  },
};

describe('matrice rôle plateforme × action plateforme (ADR-0053 § 5.2)', () => {
  it('six rôles × 21 actions = 126 cases, toutes conformes à la transcription', () => {
    let cases = 0;
    for (const role of PLATFORM_ROLES) {
      for (const action of PLATFORM_ACTIONS) {
        expect(PLATFORM_ACTION_MATRIX[role][action], `${role} × ${action}`).toBe(
          ATTENDU[role][action] ?? 'deny',
        );
        cases += 1;
      }
    }
    expect(cases).toBe(126);
  });

  it('la matrice est figée', () => {
    expect(Object.isFrozen(PLATFORM_ACTION_MATRIX)).toBe(true);
    expect(Object.isFrozen(PLATFORM_ACTION_MATRIX.platform_admin)).toBe(true);
  });

  it('chaque rôle ouvre la console ; chaque action a au moins un détenteur', () => {
    for (const role of PLATFORM_ROLES) {
      expect(canPlatformAction(role, 'platform.console.read'), role).toBe(true);
    }
    for (const action of PLATFORM_ACTIONS) {
      expect(platformActionHolders(action).length, action).toBeGreaterThan(0);
    }
  });

  it('écarts assumés avec S21b (décision ouverte n° 7)', () => {
    // `platform_admin` perd la confirmation des paiements manuels.
    expect(canPlatformAction('platform_admin', 'platform.billing.confirm')).toBe(false);
    // `platform_billing` gagne la console (corrige F7).
    expect(canPlatformAction('platform_billing', 'platform.console.read')).toBe(true);
    // `platform_support` perd le journal plateforme.
    expect(canPlatformAction('platform_support', 'platform.audit.read')).toBe(false);
    // Le super-administrateur ne publie pas un Country Pack (docs/12 § Règles critiques).
    expect(canPlatformAction('platform_super_admin', 'platform.packs.manage')).toBe(false);
    expect(platformActionHolders('platform.packs.manage')).toEqual([
      'platform_country_pack_manager',
    ]);
  });

  it('rôles cumulés : l’un suffit ; aucun rôle, aucune action', () => {
    expect(canAnyPlatformAction([], 'platform.console.read')).toBe(false);
    expect(platformActionsOf([])).toEqual([]);
    expect(
      canAnyPlatformAction(['platform_support', 'platform_billing'], 'platform.billing.confirm'),
    ).toBe(true);
    expect(platformActionsOf(['platform_template_editor'])).toEqual([
      'platform.console.read',
      'platform.templates.manage',
    ]);
  });
});

describe('deux espaces de noms disjoints (ADR-0053 § 2.3)', () => {
  it('aucune action plateforme n’est une action d’organisation, et inversement', () => {
    const org = new Set<string>(ACTIONS);
    for (const action of PLATFORM_ACTIONS) expect(org.has(action), action).toBe(false);
    for (const action of ACTIONS) expect(action.startsWith('platform.'), action).toBe(false);
  });

  it('aucun rôle d’organisation n’apparaît dans la matrice plateforme', () => {
    const roles = new Set(Object.keys(PLATFORM_ACTION_MATRIX));
    for (const role of ORG_ROLES) expect(roles.has(role), role).toBe(false);
    // Un rôle d'organisation passé par erreur ne détient rien.
    expect(canAnyPlatformAction(['owner' as PlatformRole], 'platform.console.read')).toBe(false);
    // Une action d'organisation passée par erreur n'est détenue par aucun rôle plateforme.
    expect(canAnyPlatformAction([...PLATFORM_ROLES], 'organization.manage' as PlatformAction)).toBe(
      false,
    );
  });

  it('le vocabulaire partagé égale celui de l’API', () => {
    expect([...PLATFORM_ROLE_SLUGS]).toEqual([...PLATFORM_ROLES]);
    expect([...PLATFORM_AUDIENCE_SUBSCRIPTION_STATUSES].sort()).toEqual(
      [...SUBSCRIPTION_STATUSES].sort(),
    );
  });
});

describe('platformSelfDealingDecision (§ 2.6, critère 13)', () => {
  const cas: [boolean, number, ReturnType<typeof platformSelfDealingDecision>][] = [
    [false, 1, { ok: true, soleOperator: false }],
    [false, 3, { ok: true, soleOperator: false }],
    [true, 1, { ok: true, soleOperator: true }],
    [true, 0, { ok: true, soleOperator: true }],
    [true, 2, { ok: false, code: 'PLATFORM_SELF_DEALING' }],
  ];
  it.each(cas)('membre=%s, détenteurs=%i', (actorIsMemberOfTarget, holdersCount, attendu) => {
    for (const gesture of [
      'billing.confirm',
      'billing.grant',
      'features.override',
      'orgs.suspend',
      'orgs.restore',
    ] as const) {
      expect(platformSelfDealingDecision({ gesture, actorIsMemberOfTarget, holdersCount })).toEqual(
        attendu,
      );
    }
  });
});

describe('broadcastApprovalDecision (§ 5.3, critère 19)', () => {
  it('l’auteur ou celui qui a soumis n’approuve pas, sauf approbateur unique marqué', () => {
    const base = { createdBy: 'a', submittedBy: 'a', holdersCount: 2 };
    expect(broadcastApprovalDecision({ ...base, approverUserId: 'b' })).toEqual({
      ok: true,
      soleApprover: false,
    });
    expect(broadcastApprovalDecision({ ...base, approverUserId: 'a' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    expect(
      broadcastApprovalDecision({
        createdBy: 'a',
        submittedBy: 'c',
        holdersCount: 2,
        approverUserId: 'c',
      }),
    ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
    expect(broadcastApprovalDecision({ ...base, holdersCount: 1, approverUserId: 'a' })).toEqual({
      ok: true,
      soleApprover: true,
    });
  });
});

describe('platformGrantDecision (§ 5.3, critère 17)', () => {
  const start = new Date('2026-11-02T00:00:00.000Z');
  const plus = (d: number): Date => new Date(start.getTime() + d * 86_400_000);

  it('seconde personne : offre Expert, sans échéance, ou plus de 90 jours', () => {
    expect(platformGrantNeedsSecondPerson('pro', start, plus(90))).toBe(false);
    expect(platformGrantNeedsSecondPerson('pro', start, plus(91))).toBe(true);
    expect(platformGrantNeedsSecondPerson('pro', start, null)).toBe(true);
    expect(platformGrantNeedsSecondPerson('expert', start, plus(10))).toBe(true);
  });

  it('table de vérité', () => {
    const base = { startsAt: start, requestedBy: 'a', holdersCount: 2 };
    expect(
      platformGrantDecision({ ...base, plan: 'pro', endsAt: plus(30), approverUserId: null }),
    ).toEqual({ ok: true, status: 'active', soleApprover: false });
    expect(
      platformGrantDecision({ ...base, plan: 'expert', endsAt: plus(30), approverUserId: null }),
    ).toEqual({ ok: true, status: 'pending_approval' });
    expect(
      platformGrantDecision({ ...base, plan: 'expert', endsAt: plus(30), approverUserId: 'a' }),
    ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
    expect(
      platformGrantDecision({ ...base, plan: 'expert', endsAt: null, approverUserId: 'b' }),
    ).toEqual({ ok: true, status: 'active', soleApprover: false });
    expect(
      platformGrantDecision({
        ...base,
        holdersCount: 1,
        plan: 'expert',
        endsAt: null,
        approverUserId: null,
      }),
    ).toEqual({ ok: true, status: 'active', soleApprover: true });
  });
});

describe('platformRoleGrantDecision (§ 5.3, critère 16)', () => {
  it('s’attribuer un rôle → SELF_GRANT_FORBIDDEN', () => {
    expect(platformRoleGrantDecision({ actorUserId: 'a', targetUserId: 'a' })).toEqual({
      ok: false,
      code: 'SELF_GRANT_FORBIDDEN',
    });
    expect(platformRoleGrantDecision({ actorUserId: 'a', targetUserId: 'b' })).toEqual({
      ok: true,
    });
  });
});

describe('announcementSendDecision (§ 6.6, critère 19)', () => {
  it('nombre retapé exact ; écart de plus de 10 % → nouvelle approbation', () => {
    const base = { audienceCountAtApproval: 100 };
    expect(
      announcementSendDecision({
        ...base,
        confirmedAudienceCount: 99,
        recountedAudienceCount: 100,
      }),
    ).toEqual({ ok: false, code: 'AUDIENCE_COUNT_MISMATCH' });
    expect(
      announcementSendDecision({
        ...base,
        confirmedAudienceCount: 100,
        recountedAudienceCount: 110,
      }),
    ).toEqual({ ok: true });
    expect(
      announcementSendDecision({
        ...base,
        confirmedAudienceCount: 100,
        recountedAudienceCount: 111,
      }),
    ).toEqual({ ok: false, code: 'REAPPROVAL_REQUIRED' });
    expect(
      announcementSendDecision({
        audienceCountAtApproval: 0,
        confirmedAudienceCount: 0,
        recountedAudienceCount: 0,
      }),
    ).toEqual({ ok: true });
  });
});
