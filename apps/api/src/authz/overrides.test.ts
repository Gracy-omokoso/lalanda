// ADR-0041 — A1 : autorisations par membre (titre + écart), décision pure.
//
// Un cas par garde-fou (G1 à G5) et par code d'erreur de `validateOverrides`, les
// dépendances contre la matrice, les domaines et libellés, puis une propriété à graine
// fixe (2 000 tirages acteur × cible × écart) : tout écart accepté respecte les
// invariants de sécurité. Aucun stockage ni route ici : lots A2 et suivants.

import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  ACTION_DEPENDENCIES,
  ACTION_DOMAINS,
  ACTION_LABELS,
  BASE_ACTION,
  NON_DELEGABLE_ACTIONS,
  NO_OVERRIDES,
  ORG_PERMISSION_MATRIX,
  ORG_ROLES,
  SOD_PAIRS,
  actionsOf,
  can,
  canAll,
  canGrantRole,
  effectiveActions,
  firstDeniedAction,
  grantableRoles,
  potentialEffectiveActions,
  requiredActionsOf,
  validateOverrides,
  type Action,
  type OrgPermissionContext,
  type OrgRole,
  type ValidateOverridesInput,
} from './permissions.js';

/** Ligne potentielle d'un rôle, case ⚙ comptée. */
function rowOf(role: OrgRole): Action[] {
  return ACTIONS.filter((a) => ORG_PERMISSION_MATRIX[role][a] !== 'deny');
}

function validate(
  partial: Partial<ValidateOverridesInput> & Pick<ValidateOverridesInput, 'targetRole'>,
) {
  return validateOverrides({
    actorRole: 'owner',
    actorCtx: NO_OVERRIDES,
    grants: [],
    revokes: [],
    actorIsTarget: false,
    ...partial,
  });
}

describe('ADR-0041 § 1 — droits effectifs : titre + ajouts − retraits', () => {
  it('NO_OVERRIDES est vide et figé', () => {
    expect(NO_OVERRIDES).toEqual({});
    expect(Object.isFrozen(NO_OVERRIDES)).toBe(true);
  });

  it('un ajout accorde pleinement une case `deny`', () => {
    expect(can('sales_rep', 'treasury.read', NO_OVERRIDES)).toBe(false);
    expect(can('sales_rep', 'treasury.read', { grants: ['treasury.read'] })).toBe(true);
  });

  it('un retrait l’emporte sur la ligne du rôle et sur un ajout', () => {
    expect(can('accountant', 'sales.invoice', { revokes: ['sales.invoice'] })).toBe(false);
    expect(can('viewer', 'crm.manage', { grants: ['crm.manage'], revokes: ['crm.manage'] })).toBe(
      false,
    );
    expect(
      can('accountant', 'period.close', { canClosePeriods: true, revokes: ['period.close'] }),
    ).toBe(false);
  });

  it('canAll, firstDeniedAction et actionsOf héritent de l’écart', () => {
    const ctx: OrgPermissionContext = { grants: ['treasury.read'], revokes: ['crm.manage'] };
    expect(canAll('sales_rep', ['treasury.read', 'crm.read'], ctx)).toBe(true);
    expect(firstDeniedAction('sales_rep', ['crm.read', 'crm.manage'], ctx)).toBe('crm.manage');
    expect(actionsOf('sales_rep', ctx)).toContain('treasury.read');
    expect(actionsOf('sales_rep', ctx)).not.toContain('crm.manage');
    expect(effectiveActions('sales_rep', ctx)).toEqual(actionsOf('sales_rep', ctx));
  });

  it('l’ensemble potentiel compte la case ⚙ comme détenue, sauf retrait', () => {
    expect(effectiveActions('accountant', NO_OVERRIDES)).not.toContain('period.close');
    expect(potentialEffectiveActions('accountant', NO_OVERRIDES)).toContain('period.close');
    expect(potentialEffectiveActions('accountant', { revokes: ['period.close'] })).not.toContain(
      'period.close',
    );
  });
});

describe('ADR-0041 § 2 — validateOverrides : un cas par garde-fou', () => {
  it('écart accepté : rendu trié dans l’ordre d’ACTIONS, avec l’effectif', () => {
    const r = validate({
      targetRole: 'viewer',
      grants: ['crm.manage'],
      revokes: ['treasury.read', 'sales.read'],
    });
    expect(r).toEqual({
      ok: true,
      grants: ['crm.manage'],
      revokes: ['sales.read', 'treasury.read'],
      effective: ['project.read', 'analytics.read', 'crm.read', 'crm.manage', 'work.read'],
    });
  });

  it('G2 — personne ne modifie ses propres autorisations', () => {
    expect(validate({ targetRole: 'admin', actorIsTarget: true })).toEqual({
      ok: false,
      code: 'SELF_PERMISSIONS_FORBIDDEN',
    });
    // Même un écart vide (« revenir au titre ») sur soi-même est refusé.
    expect(
      validate({ targetRole: 'viewer', actorIsTarget: true, revokes: ['work.read'] }),
    ).toMatchObject({
      code: 'SELF_PERMISSIONS_FORBIDDEN',
    });
  });

  it('G3 — les autorisations d’un Propriétaire ne se personnalisent pas', () => {
    expect(validate({ targetRole: 'owner', revokes: ['billing.manage'] })).toEqual({
      ok: false,
      code: 'OWNER_PERMISSIONS_FIXED',
    });
    expect(validate({ targetRole: 'owner', grants: ['audit.read'] })).toMatchObject({
      code: 'OWNER_PERMISSIONS_FIXED',
    });
    // Écart vide : rien à refuser.
    expect(validate({ targetRole: 'owner' })).toMatchObject({ ok: true });
  });

  it('G3 — `billing.manage` ne se délègue pas', () => {
    expect(NON_DELEGABLE_ACTIONS).toEqual(['billing.manage']);
    expect(validate({ targetRole: 'admin', grants: ['billing.manage'] })).toEqual({
      ok: false,
      code: 'PERMISSION_NOT_DELEGABLE',
      actions: ['billing.manage'],
    });
  });

  it('§ 1 — ajout ou retrait sans objet, doublon, ajout et retrait simultanés', () => {
    const redundant = (r: ReturnType<typeof validate>) =>
      r.ok ? [] : r.code === 'PERMISSION_OVERRIDE_REDUNDANT' ? r.actions : ['autre refus'];
    // Ajout d'une action déjà accordée par le titre.
    expect(redundant(validate({ targetRole: 'viewer', grants: ['crm.read'] }))).toEqual([
      'crm.read',
    ]);
    // Retrait d'une action que le titre refuse.
    expect(redundant(validate({ targetRole: 'viewer', revokes: ['crm.manage'] }))).toEqual([
      'crm.manage',
    ]);
    // Doublon.
    expect(
      redundant(validate({ targetRole: 'viewer', revokes: ['crm.read', 'crm.read'] })),
    ).toEqual(['crm.read']);
    // Même action ajoutée et retirée.
    expect(
      redundant(
        validate({ targetRole: 'viewer', grants: ['crm.manage'], revokes: ['crm.manage'] }),
      ),
    ).toEqual(['crm.manage']);
    // Case ⚙ du Comptable : stockée dans `canClosePeriods`, jamais dans l'écart.
    expect(redundant(validate({ targetRole: 'accountant', grants: ['period.close'] }))).toEqual([
      'period.close',
    ]);
    expect(redundant(validate({ targetRole: 'accountant', revokes: ['period.close'] }))).toEqual([
      'period.close',
    ]);
  });

  it('G5 — un ajout n’élargit jamais une case `allow_project`', () => {
    expect(validate({ targetRole: 'project_manager', grants: ['project.read'] })).toMatchObject({
      ok: false,
      code: 'PERMISSION_OVERRIDE_REDUNDANT',
      actions: ['project.read'],
    });
    // Un retrait la supprime entièrement.
    const r = validate({ targetRole: 'project_manager', revokes: ['report.export'] });
    expect(r.ok && r.effective.includes('report.export')).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('G1 — un Administrateur ajoute ce qu’il détient, pas plus (critère 4)', () => {
    const admin = { actorRole: 'admin' as const, actorCtx: NO_OVERRIDES };
    expect(
      validate({ ...admin, targetRole: 'viewer', targetCtxBefore: {}, grants: ['crm.manage'] }),
    ).toMatchObject({
      ok: true,
    });
    expect(
      validate({ ...admin, targetRole: 'viewer', targetCtxBefore: {}, grants: ['sales.invoice'] }),
    ).toEqual({
      ok: false,
      code: 'PERMISSION_ESCALATION',
      actions: ['sales.invoice'],
    });
    expect(
      validate({ ...admin, targetRole: 'viewer', targetCtxBefore: {}, grants: ['plan.approve'] }),
    ).toEqual({
      ok: false,
      code: 'PERMISSION_ESCALATION',
      actions: ['plan.approve'],
    });
  });

  it('G1 — on ne touche pas à un membre plus puissant que soi, même pour lui retirer', () => {
    const r = validate({
      actorRole: 'admin',
      targetRole: 'accountant',
      targetCtxBefore: {},
      revokes: ['sales.invoice'],
    });
    expect(r).toMatchObject({ ok: false, code: 'PERMISSION_ESCALATION' });
    expect(!r.ok && r.code === 'PERMISSION_ESCALATION' && r.actions).toEqual([
      'period.close',
      'sales.invoice',
      'sales.receipt',
      'treasury.manage',
    ]);
  });

  it('G1 — l’acteur est jugé sur ses droits EFFECTIFS : un retrait le limite', () => {
    const r = validate({
      actorRole: 'admin',
      actorCtx: { revokes: ['crm.manage'] },
      targetRole: 'viewer',
      grants: ['crm.manage'],
    });
    expect(r).toEqual({ ok: false, code: 'PERMISSION_ESCALATION', actions: ['crm.manage'] });
    // Un ajout reçu se transmet : un Administrateur à qui l'on a ajouté `treasury.manage`.
    expect(
      validate({
        actorRole: 'admin',
        actorCtx: { grants: ['treasury.manage'] },
        targetRole: 'viewer',
        grants: ['treasury.manage'],
      }),
    ).toMatchObject({ ok: true });
  });

  it('G4 — paire R2 statique : un Analyste ne reçoit pas `plan.approve` (critère 7)', () => {
    expect(validate({ targetRole: 'analyst', grants: ['plan.approve'] })).toEqual({
      ok: false,
      code: 'SOD_CONFLICT',
      pair: ['inputs.update', 'plan.approve'],
    });
    // Un Lecteur qui a reçu `plan.approve` ne reçoit pas `inputs.update`.
    expect(
      validate({ targetRole: 'viewer', grants: ['inputs.update', 'plan.approve'] }),
    ).toMatchObject({ code: 'SOD_CONFLICT', pair: ['inputs.update', 'plan.approve'] });
    // Chacune seule passe.
    expect(validate({ targetRole: 'viewer', grants: ['plan.approve'] })).toMatchObject({
      ok: true,
    });
  });

  it('G4 — paire R3 : un Comptable ne reçoit pas `plan.approve`, même sans droit de clôture', () => {
    expect(
      validate({
        targetRole: 'accountant',
        targetCtxBefore: { canClosePeriods: false },
        grants: ['plan.approve'],
      }),
    ).toEqual({ ok: false, code: 'SOD_CONFLICT', pair: ['period.close', 'plan.approve'] });
  });

  it('G4 — les titres qui cumulent nativement une paire ne sont pas concernés', () => {
    expect(validate({ targetRole: 'finance_director', revokes: ['sales.invoice'] })).toMatchObject({
      ok: true,
    });
  });

  it('décision n° 3 refusée : `fiscal.manage` ajouté à un Comptable est accepté', () => {
    expect(SOD_PAIRS).toHaveLength(2);
    expect(SOD_PAIRS.some((p) => p.includes('sales.invoice') && p.includes('fiscal.manage'))).toBe(
      false,
    );
    expect(validate({ targetRole: 'accountant', grants: ['fiscal.manage'] })).toMatchObject({
      ok: true,
    });
  });

  it('§ 4 — dépendance manquante : refus, jamais de complément silencieux (critère 9)', () => {
    expect(validate({ targetRole: 'advisor', grants: ['sales.manage'] })).toEqual({
      ok: false,
      code: 'PERMISSION_DEPENDENCY_MISSING',
      action: 'sales.manage',
      missing: ['sales.read'],
    });
    // Retirer `sales.read` à un Comptable qui garde `sales.manage`.
    expect(validate({ targetRole: 'accountant', revokes: ['sales.read'] })).toMatchObject({
      code: 'PERMISSION_DEPENDENCY_MISSING',
      missing: ['sales.read'],
    });
    // `work.manage` exige `work.update`, donc `work.read`.
    expect(validate({ targetRole: 'advisor', grants: ['work.manage'] })).toMatchObject({
      code: 'PERMISSION_DEPENDENCY_MISSING',
      action: 'work.manage',
      missing: ['work.read', 'work.update'],
    });
    // Avec ses dépendances, l'ajout passe.
    expect(
      validate({ targetRole: 'advisor', grants: ['sales.read', 'sales.manage'] }),
    ).toMatchObject({
      ok: true,
    });
  });

  it('§ 4 — socle `analytics.read` non retirable tant qu’une autre action est détenue', () => {
    expect(validate({ targetRole: 'viewer', revokes: ['analytics.read'] })).toMatchObject({
      ok: false,
      code: 'PERMISSION_DEPENDENCY_MISSING',
      missing: ['analytics.read'],
    });
    // Tout retirer reste possible : aucune autre action détenue.
    expect(
      validate({ targetRole: 'advisor', revokes: ['project.read', 'analytics.read'] }),
    ).toEqual({
      ok: true,
      grants: [],
      revokes: ['project.read', 'analytics.read'],
      effective: [],
    });
  });
});

describe('ADR-0041 § 2 G1 et décision n° 5 — R7 sur les droits effectifs de l’acteur', () => {
  it('sans écart, grantableRoles est inchangé pour tout acteur sans case ⚙', () => {
    for (const role of ORG_ROLES) {
      if (role === 'accountant') continue;
      expect(grantableRoles(role, NO_OVERRIDES), role).toEqual(grantableRoles(role));
    }
  });

  it('un Administrateur privé de `crm.manage` ne peut plus attribuer le titre Commercial', () => {
    expect(canGrantRole('admin', 'sales_rep', NO_OVERRIDES)).toBe(true);
    expect(canGrantRole('admin', 'sales_rep', { revokes: ['crm.manage'] })).toBe(false);
  });

  it('le titre reste soumis à R7 : aucun ajout ne permet à un Administrateur d’attribuer Comptable', () => {
    expect(
      canGrantRole('admin', 'accountant', { grants: ['sales.invoice', 'sales.receipt'] }),
    ).toBe(false);
  });
});

describe('ADR-0041 § 4 et § 5 — dépendances, domaines et libellés', () => {
  it('chaque ligne de la matrice satisfait déjà toutes les dépendances (case ⚙ comptée)', () => {
    for (const role of ORG_ROLES) {
      const row = new Set(rowOf(role));
      for (const action of row) {
        const missing = requiredActionsOf(action).filter((a) => !row.has(a));
        expect(missing, `${role} × ${action}`).toEqual([]);
      }
    }
  });

  it('les dépendances ne visent que des actions connues et ne bouclent pas', () => {
    for (const [action, deps] of Object.entries(ACTION_DEPENDENCIES)) {
      expect(ACTIONS).toContain(action);
      for (const d of deps ?? []) expect(ACTIONS).toContain(d);
      expect(requiredActionsOf(action as Action)).not.toContain(action);
    }
    expect(requiredActionsOf(BASE_ACTION)).toEqual([]);
    expect(requiredActionsOf('sales.invoice')).toEqual([
      'analytics.read',
      'sales.read',
      'sales.manage',
    ]);
    expect(requiredActionsOf('report.export')).toEqual(['project.read', 'analytics.read']);
  });

  it('sept domaines ; chaque action dans exactement un domaine, avec un libellé', () => {
    expect(ACTION_DOMAINS).toHaveLength(7);
    const all = ACTION_DOMAINS.flatMap((d) => d.actions);
    expect(all).toHaveLength(ACTIONS.length);
    expect([...all].sort()).toEqual([...ACTIONS].sort());
    for (const action of ACTIONS) {
      expect(ACTION_LABELS[action].trim().length, action).toBeGreaterThan(0);
    }
    expect(new Set(ACTION_DOMAINS.map((d) => d.key)).size).toBe(7);
  });

  it('le vocabulaire visible ne dit ni « action », ni « grant », ni « override »', () => {
    const textes = [...Object.values(ACTION_LABELS), ...ACTION_DOMAINS.map((d) => d.label)];
    for (const t of textes) expect(t).not.toMatch(/\b(action|grant|override)/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Propriété à graine fixe (ADR-0041 § 9.5) : 2 000 tirages acteur × cible × écart.
// ─────────────────────────────────────────────────────────────────────────────

/** mulberry32 — générateur déterministe, pour que tout échec soit reproductible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ADR-0041 § 9.5 — propriété : tout écart accepté est sûr', () => {
  it('2 000 tirages à graine fixe', () => {
    const rand = prng(41_2026);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
    const subset = <T>(xs: readonly T[], p: number): T[] => xs.filter(() => rand() < p);
    const denied = (role: OrgRole) =>
      ACTIONS.filter((a) => ORG_PERMISSION_MATRIX[role][a] === 'deny');
    const ctxOf = (role: OrgRole): OrgPermissionContext => ({
      canClosePeriods: rand() < 0.5,
      grants: subset(denied(role), 0.1),
      revokes: subset(
        ACTIONS.filter((a) => ORG_PERMISSION_MATRIX[role][a] !== 'deny'),
        0.08,
      ),
    });

    let accepted = 0;
    const codes = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      // Acteur souvent Propriétaire ou Directeur financier : sinon presque tout est escalade.
      const actorRole =
        rand() < 0.5 ? pick(['owner', 'finance_director'] as const) : pick(ORG_ROLES);
      const targetRole = pick(ORG_ROLES);
      const actorCtx = ctxOf(actorRole);
      const targetCtxBefore = rand() < 0.3 ? undefined : ctxOf(targetRole);
      // Écart demandé : surtout plausible, parfois n'importe quoi (doublons, sans objet).
      const grants = rand() < 0.8 ? subset(denied(targetRole), 0.12) : subset(ACTIONS, 0.05);
      const revokes =
        rand() < 0.8
          ? subset(
              ACTIONS.filter((a) => ORG_PERMISSION_MATRIX[targetRole][a] !== 'deny'),
              0.1,
            )
          : subset(ACTIONS, 0.05);
      const actorIsTarget = rand() < 0.05;

      const r = validateOverrides({
        actorRole,
        actorCtx,
        targetRole,
        targetCtxBefore,
        grants,
        revokes,
        actorIsTarget,
      });
      if (!r.ok) {
        codes.add(r.code);
        continue;
      }
      accepted++;
      const label = `tirage ${i} : ${actorRole} → ${targetRole}`;
      const after: OrgPermissionContext = {
        canClosePeriods: targetCtxBefore?.canClosePeriods === true,
        grants: r.grants,
        revokes: r.revokes,
      };
      const actorHolds = new Set(effectiveActions(actorRole, actorCtx));
      const potential = potentialEffectiveActions(targetRole, after);

      // G2 : acteur ≠ cible.
      expect(actorIsTarget, label).toBe(false);
      // G1 : potentiel(cible) ⊆ effectif(acteur), avant comme après.
      expect(
        potential.filter((a) => !actorHolds.has(a)),
        label,
      ).toEqual([]);
      if (targetCtxBefore !== undefined) {
        expect(
          potentialEffectiveActions(targetRole, targetCtxBefore).filter((a) => !actorHolds.has(a)),
          label,
        ).toEqual([]);
      }
      // G3 : rien de non délégable ajouté ; écart vide pour le Propriétaire.
      expect(
        r.grants.filter((a) => NON_DELEGABLE_ACTIONS.includes(a)),
        label,
      ).toEqual([]);
      if (targetRole === 'owner') expect([...r.grants, ...r.revokes], label).toEqual([]);
      // G4 : aucune paire complétée par ajout.
      const nativeRow = new Set(rowOf(targetRole));
      for (const [x, y] of SOD_PAIRS) {
        if (nativeRow.has(x) && nativeRow.has(y)) continue;
        expect(potential.includes(x) && potential.includes(y), `${label} ${x}+${y}`).toBe(false);
      }
      // § 1 : forme de stockage.
      expect(
        r.grants.filter((a) => r.revokes.includes(a)),
        label,
      ).toEqual([]);
      expect(
        r.grants.every((a) => ORG_PERMISSION_MATRIX[targetRole][a] === 'deny'),
        label,
      ).toBe(true);
      expect(
        r.revokes.every((a) => ORG_PERMISSION_MATRIX[targetRole][a] !== 'deny'),
        label,
      ).toBe(true);
      // § 4 : dépendances satisfaites.
      for (const a of potential) {
        expect(
          requiredActionsOf(a).filter((d) => !potential.includes(d)),
          `${label} ${a}`,
        ).toEqual([]);
      }
      // L'effectif rendu est celui que `can()` décidera.
      expect(r.effective, label).toEqual(effectiveActions(targetRole, after));
    }

    // La propriété n'est pas vide de sens : assez d'acceptations, et chaque refus rencontré.
    expect(accepted).toBeGreaterThan(100);
    expect([...codes].sort()).toEqual([
      'OWNER_PERMISSIONS_FIXED',
      'PERMISSION_DEPENDENCY_MISSING',
      'PERMISSION_ESCALATION',
      'PERMISSION_NOT_DELEGABLE',
      'PERMISSION_OVERRIDE_REDUNDANT',
      'SELF_PERMISSIONS_FORBIDDEN',
      'SOD_CONFLICT',
    ]);
  });
});
