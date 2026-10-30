// Règles pures des demandes d'absence (ADR-0045 § 2.5, § 4.3). ADR-0045 — H3.
import { describe, expect, it } from 'vitest';

import { currentStepOf, decisionOn, managerUserIdOf, seesLeaveType } from './leave-model.js';
import type { StoredApproval } from './leave-request.schema.js';

const ok = (userId: string, step: 'manager' | 'hr'): StoredApproval => ({
  step,
  userId,
  decision: 'approved',
  at: new Date(0),
  comment: null,
  soleApprover: false,
  onBehalfOfManager: false,
});

const ctx = (userId: string, holdsLeaveApprove: boolean, approverCount = 3) => ({
  userId,
  holdsLeaveApprove,
  approverCount,
  allowSoleApprover: true,
});

describe('demandes d’absence — règles pures', () => {
  it('étape en cours : la première non validée ; rien hors attente', () => {
    expect(currentStepOf({ status: 'pending', steps: ['manager', 'hr'], approvals: [] })).toBe(
      'manager',
    );
    expect(
      currentStepOf({
        status: 'pending',
        steps: ['manager', 'hr'],
        approvals: [ok('a', 'manager')],
      }),
    ).toBe('hr');
    expect(currentStepOf({ status: 'approved', steps: ['hr'], approvals: [] })).toBeNull();
  });

  it('manager désigné : collaborateur actif relié à un compte', () => {
    const byId = new Map([
      ['m1', { status: 'active' as const, userId: 'u-m' }],
      ['m2', { status: 'exited' as const, userId: 'u-x' }],
    ]);
    expect(managerUserIdOf({ managerEmployeeId: 'm1' }, byId)).toBe('u-m');
    expect(managerUserIdOf({ managerEmployeeId: 'm2' }, byId)).toBeNull();
    expect(managerUserIdOf({ managerEmployeeId: null }, byId)).toBeNull();
  });

  it('séparation des tâches : soi refusé, tiers refusé, manager accepté, deux étapes deux personnes', () => {
    const r = {
      status: 'pending' as const,
      steps: ['manager', 'hr'] as ('manager' | 'hr')[],
      approvals: [],
    };
    expect(decisionOn(r, 'u-b', 'u-a', ctx('u-b', false), 'approve')).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    expect(decisionOn(r, 'u-b', 'u-a', ctx('u-c', false), 'approve')).toEqual({
      ok: false,
      code: 'LEAVE_NOT_YOUR_STEP',
    });
    expect(decisionOn(r, 'u-b', 'u-a', ctx('u-a', false), 'approve')).toMatchObject({ ok: true });
    const suppleance = decisionOn(r, 'u-b', 'u-a', ctx('u-rh', true), 'approve');
    expect(suppleance).toMatchObject({ ok: true, onBehalfOfManager: true });
    const r2 = { ...r, approvals: [ok('u-rh', 'manager')] };
    expect(decisionOn(r2, 'u-b', 'u-a', ctx('u-rh', true), 'approve')).toEqual({
      ok: false,
      code: 'APPROVER_ALREADY_APPROVED',
    });
    // Approbateur unique : il valide sa propre absence, marqué.
    const seul = {
      status: 'pending' as const,
      steps: ['hr'] as ('manager' | 'hr')[],
      approvals: [],
    };
    expect(decisionOn(seul, 'u-o', null, ctx('u-o', true, 1), 'approve')).toEqual({
      ok: true,
      soleApprover: true,
      onBehalfOfManager: false,
    });
  });

  it('type confidentiel : soi, données sensibles ou étape RH seulement', () => {
    const base = {
      confidential: true,
      isSelf: false,
      seesConfidential: false,
      holdsLeaveApprove: false,
    };
    expect(seesLeaveType(base)).toBe(false);
    expect(seesLeaveType({ ...base, isSelf: true })).toBe(true);
    expect(seesLeaveType({ ...base, seesConfidential: true })).toBe(true);
    expect(seesLeaveType({ ...base, holdsLeaveApprove: true })).toBe(true);
    expect(seesLeaveType({ ...base, confidential: false })).toBe(true);
  });
});
