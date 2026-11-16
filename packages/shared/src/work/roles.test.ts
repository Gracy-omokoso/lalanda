import { describe, expect, it } from 'vitest';

import { projectRights, resolveProjectRole, taskRights, type WorkProjectRole } from './roles.js';
import {
  DecideWorkApprovalBody,
  PostWorkProjectStatusBody,
  PutWorkChecklistBody,
  UpdateWorkProjectBody,
} from './schemas.js';
import { PutWorkNotificationPreferencesBody } from './notification-preferences.js';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const C = 'c'.repeat(24);
const T1 = '1'.repeat(24);
const T2 = '2'.repeat(24);

const base = {
  userId: A,
  ownerUserId: null,
  deputyUserId: null,
  memberUserIds: [] as string[],
  memberTeamIds: [] as string[],
  memberRoles: [] as { kind: 'user' | 'team'; id: string; role: 'member' | 'viewer' }[],
  userTeamIds: [] as string[],
};

describe('resolveProjectRole (ADR-0076 § 1)', () => {
  it('chef, adjoint, puis membre par défaut', () => {
    expect(resolveProjectRole({ ...base, ownerUserId: A })).toBe('lead');
    expect(resolveProjectRole({ ...base, deputyUserId: A })).toBe('deputy');
    expect(resolveProjectRole({ ...base, memberUserIds: [A] })).toBe('member');
    expect(resolveProjectRole(base)).toBe('none');
  });

  it('l’entrée personnelle prime sur les équipes ; Membre l’emporte entre équipes', () => {
    const roles = [
      { kind: 'user' as const, id: A, role: 'viewer' as const },
      { kind: 'team' as const, id: T1, role: 'viewer' as const },
    ];
    expect(
      resolveProjectRole({
        ...base,
        memberUserIds: [A],
        memberTeamIds: [T2],
        memberRoles: roles,
        userTeamIds: [T2],
      }),
    ).toBe('viewer');
    expect(
      resolveProjectRole({
        ...base,
        memberTeamIds: [T1, T2],
        memberRoles: roles,
        userTeamIds: [T1, T2],
      }),
    ).toBe('member');
    expect(
      resolveProjectRole({ ...base, memberTeamIds: [T1], memberRoles: roles, userTeamIds: [T1] }),
    ).toBe('viewer');
  });
});

const rights = (role: WorkProjectRole, over: Partial<Parameters<typeof projectRights>[0]> = {}) =>
  projectRights({
    role,
    orgCanUpdate: true,
    orgCanManage: false,
    internal: true,
    hasLead: true,
    ...over,
  });

describe('projectRights (ADR-0076 § 1)', () => {
  it('chef et adjoint internes gèrent sans work.manage ; pas un Stagiaire ni un Invité', () => {
    expect(rights('lead').canManage).toBe(true);
    expect(rights('deputy').canManage).toBe(true);
    expect(rights('lead', { internal: false }).canManage).toBe(false);
    expect(rights('member').canManage).toBe(false);
    expect(rights('member', { orgCanManage: true }).canManage).toBe(true);
  });

  it('plafond : sans work.update, rien', () => {
    const r = rights('lead', { orgCanUpdate: false, orgCanManage: false });
    expect(r.canManage || r.canCreateTasks || r.canComment || r.assignable).toBe(false);
  });

  it('Lecteur : commente, ne crée pas, n’est pas assignable', () => {
    const r = rights('viewer');
    expect(r.canComment).toBe(true);
    expect(r.canCreateTasks).toBe(false);
    expect(r.canLogTime).toBe(false);
    expect(r.assignable).toBe(false);
  });
});

describe('taskRights (ADR-0076 § 2)', () => {
  const task = (
    assigneeUserId: string | null,
    collaboratorUserIds: string[] = [],
    createdBy = C,
  ) => ({
    assigneeUserId,
    collaboratorUserIds,
    createdBy,
  });

  it('le responsable modifie, termine et coche ; le collaborateur modifie et coche sans terminer', () => {
    expect(taskRights({ userId: A, project: rights('member'), task: task(A) })).toEqual({
      canEdit: true,
      canComplete: true,
      canCheck: true,
    });
    expect(taskRights({ userId: A, project: rights('member'), task: task(B, [A]) })).toEqual({
      canEdit: true,
      canComplete: false,
      canCheck: true,
    });
  });

  it('la tâche d’un collègue : ni modifier ni terminer ; le créateur modifie', () => {
    expect(taskRights({ userId: A, project: rights('member'), task: task(B) }).canEdit).toBe(false);
    expect(taskRights({ userId: A, project: rights('member'), task: task(B, [], A) }).canEdit).toBe(
      true,
    );
  });

  it('gestion : tout ; Lecteur : rien', () => {
    expect(taskRights({ userId: A, project: rights('deputy'), task: task(B) }).canComplete).toBe(
      true,
    );
    expect(taskRights({ userId: A, project: rights('viewer'), task: task(A) }).canEdit).toBe(false);
  });

  it('sans responsable : sous-tâche terminée par le responsable de la parente ; projet sans chef : tout Membre', () => {
    const p = rights('member');
    expect(
      taskRights({ userId: A, project: p, task: task(null), parent: { assigneeUserId: A } })
        .canComplete,
    ).toBe(true);
    expect(taskRights({ userId: A, project: p, task: task(null) }).canComplete).toBe(false);
    expect(
      taskRights({ userId: A, project: rights('none', { hasLead: false }), task: task(null) })
        .canComplete,
    ).toBe(true);
    expect(
      taskRights({
        userId: A,
        project: rights('none', { hasLead: false }),
        task: task(null),
        parent: { assigneeUserId: B },
      }).canComplete,
    ).toBe(false);
  });
});

describe('contrats ADR-0076', () => {
  it('motif obligatoire pour demander des modifications ou refuser', () => {
    expect(
      DecideWorkApprovalBody.safeParse({ expectedRevision: 1, decision: 'approve' }).success,
    ).toBe(true);
    const r = DecideWorkApprovalBody.safeParse({ expectedRevision: 1, decision: 'reject' });
    expect(r.success).toBe(false);
    expect(
      DecideWorkApprovalBody.safeParse({
        expectedRevision: 1,
        decision: 'request_changes',
        reason: 'Revoir le devis',
      }).success,
    ).toBe(true);
  });

  it('liste de contrôle : 30 éléments au plus', () => {
    const items = Array.from({ length: 31 }, (_, i) => ({ text: `É${i}`, done: false }));
    expect(PutWorkChecklistBody.safeParse({ expectedRevision: 1, items }).success).toBe(false);
    expect(
      PutWorkChecklistBody.safeParse({ expectedRevision: 1, items: items.slice(0, 30) }).success,
    ).toBe(true);
  });

  it('statut du projet et adjoint distinct du chef', () => {
    expect(
      PostWorkProjectStatusBody.safeParse({ status: 'at_risk', text: 'Retard client' }).success,
    ).toBe(true);
    expect(PostWorkProjectStatusBody.safeParse({ status: 'late', text: 'x' }).success).toBe(false);
    expect(
      UpdateWorkProjectBody.safeParse({ expectedRevision: 1, ownerUserId: A, deputyUserId: A })
        .success,
    ).toBe(false);
  });

  it('préférences : un client N-1 sans les nouveaux événements reste accepté', () => {
    const ch = { bell: true, email: false };
    const events = Object.fromEntries(
      [
        'task_assigned',
        'mentioned',
        'comment_on_followed',
        'task_due_soon',
        'task_overdue',
        'task_status_changed',
        'added_to_project',
        'project_at_risk',
      ].map((e) => [e, ch]),
    );
    expect(
      PutWorkNotificationPreferencesBody.safeParse({
        expectedRevision: 0,
        events,
        digest: { enabled: false, hour: 7, workingDaysOnly: true },
      }).success,
    ).toBe(true);
  });
});
