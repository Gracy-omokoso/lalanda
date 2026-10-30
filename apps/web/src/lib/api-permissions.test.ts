// Tests du client des autorisations (ADR-0041, lot A5) : lecture tolérante d'une
// API N-1 et relecture des permissions par la coquille (focus, `403`).

import { describe, expect, it } from 'vitest';

import type { MemberView, MyPermissionsView } from './api';
import {
  creerLimiteurRelecture,
  estRefusDePermission,
  normaliserMembre,
  normaliserMesPermissions,
} from './api-permissions';

describe('lecture tolérante (champs absents = exactement le titre)', () => {
  it('complète /me/permissions d’avant A2', () => {
    const brut: MyPermissionsView = {
      organizationId: 'o',
      role: 'viewer',
      roleLabel: 'Lecteur',
      actions: ['project.read', 'analytics.read'],
      grantableRoles: [],
      canClosePeriods: false,
    };
    const p = normaliserMesPermissions(brut);
    expect(p.roleActions).toEqual(brut.actions);
    expect(p.grants).toEqual([]);
    expect(p.customized).toBe(false);
    expect(p.permissionsRevision).toBe(0);
  });

  it('complète une ligne de membre d’avant A4', () => {
    const brut: MemberView = {
      userId: 'u',
      email: null,
      name: null,
      role: 'viewer',
      roleLabel: 'Lecteur',
      canClosePeriods: false,
      acceptedAt: null,
      isLastOwner: false,
      manageable: true,
    };
    const m = normaliserMembre(brut);
    expect(m.grants).toEqual([]);
    expect(m.revokes).toEqual([]);
    expect(m.customized).toBe(false);
  });
});

describe('relecture des permissions par la coquille (G8)', () => {
  it('ne relit que sur le refus du guard', () => {
    expect(estRefusDePermission({ code: 'FORBIDDEN', action: 'sales.read' })).toBe(true);
    expect(estRefusDePermission({ code: 'NO_ORGANIZATION' })).toBe(false);
    expect(estRefusDePermission({ code: 'PERMISSION_ESCALATION' })).toBe(false);
    expect(estRefusDePermission('texte')).toBe(false);
    expect(estRefusDePermission(null)).toBe(false);
  });

  it('une rafale ne déclenche qu’une lecture par fenêtre', () => {
    const peutRelire = creerLimiteurRelecture(2000);
    expect(peutRelire(10_000)).toBe(true);
    expect(peutRelire(10_500)).toBe(false);
    expect(peutRelire(11_999)).toBe(false);
    expect(peutRelire(12_000)).toBe(true);
  });
});
