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
      effective: [
        'project.read',
        'analytics.read',
        'crm.read',
        'crm.manage',
        'work.read',
        // ADR-0044 § 4.1 : le Lecteur consulte les achats.
        'purchase.read',
        // ADR-0045 § 4.1 : il demande ses propres absences.
        'leave.request',
        // ADR-0046 § 8.1 : il consulte stocks, équipements et bibliothèque.
        'stock.read',
        'assets.read',
        'docs.read',
        // ADR-0049 § 8.1 : il consulte la comptabilité.
        'accounting.read',
        // ADR-0051 § 5.1 : il déclare ses frais et pointe pour lui-même.
        'expenses.claim',
        'attendance.clock',
      ],
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
      // ADR-0044 § 4.1 : le Comptable paie les fournisseurs, pas l'Administrateur.
      'payables.pay',
      // ADR-0049 § 8.1 : le Comptable tient les livres ; l'Administrateur les lit seulement.
      'accounting.post',
      'accounting.close',
      'accounting.export',
      'accounting.manage',
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

  it('G4 — paire des achats : autoriser la dépense et payer ne se cumulent pas par ajout (ADR-0044)', () => {
    // Un Lecteur reçoit l'une ou l'autre, pas les deux.
    expect(
      validate({ targetRole: 'viewer', grants: ['purchase.approve', 'payables.pay'] }),
    ).toEqual({ ok: false, code: 'SOD_CONFLICT', pair: ['purchase.approve', 'payables.pay'] });
    expect(validate({ targetRole: 'viewer', grants: ['purchase.approve'] })).toMatchObject({
      ok: true,
    });
    expect(validate({ targetRole: 'viewer', grants: ['payables.pay'] })).toMatchObject({
      ok: true,
    });
    // Un Administrateur (qui prépare) ne reçoit pas les deux non plus.
    expect(
      validate({ targetRole: 'admin', grants: ['purchase.approve', 'payables.pay'] }),
    ).toMatchObject({ code: 'SOD_CONFLICT', pair: ['purchase.approve', 'payables.pay'] });
    // Le Directeur financier les cumule nativement : lui retirer autre chose passe.
    expect(
      validate({ targetRole: 'finance_director', revokes: ['purchase.manage'] }),
    ).toMatchObject({ ok: true });
  });

  it('ADR-0044 — un acheteur : Analyste ou Lecteur avec ajout de `purchase.manage` (O6)', () => {
    expect(validate({ targetRole: 'analyst', grants: ['purchase.manage'] })).toMatchObject({
      ok: true,
    });
    expect(
      validate({ targetRole: 'viewer', grants: ['purchase.request', 'purchase.manage'] }),
    ).toMatchObject({ ok: true });
    // Sans `purchase.read`, l'ajout est refusé, jamais complété.
    expect(validate({ targetRole: 'advisor', grants: ['purchase.manage'] })).toMatchObject({
      code: 'PERMISSION_DEPENDENCY_MISSING',
      action: 'purchase.manage',
      missing: ['purchase.read'],
    });
    // Payer exige aussi `treasury.read`.
    expect(
      validate({ targetRole: 'advisor', grants: ['purchase.read', 'payables.pay'] }),
    ).toMatchObject({
      code: 'PERMISSION_DEPENDENCY_MISSING',
      action: 'payables.pay',
      missing: ['treasury.read'],
    });
  });

  it('décision n° 3 refusée : `fiscal.manage` ajouté à un Comptable est accepté', () => {
    // Trois paires depuis ADR-0044 § 4.3 ; aucune ne vise la facturation.
    // ADR-0051 § 5.2 ajoute la quatrième, `expenses.approve` + `payables.pay`.
    expect(SOD_PAIRS).toHaveLength(4);
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

  it('treize domaines ; chaque action dans exactement un domaine, avec un libellé', () => {
    expect(ACTION_DOMAINS).toHaveLength(13);
    const all = ACTION_DOMAINS.flatMap((d) => d.actions);
    expect(all).toHaveLength(ACTIONS.length);
    expect([...all].sort()).toEqual([...ACTIONS].sort());
    for (const action of ACTIONS) {
      expect(ACTION_LABELS[action].trim().length, action).toBeGreaterThan(0);
    }
    expect(new Set(ACTION_DOMAINS.map((d) => d.key)).size).toBe(13);
  });

  it('ADR-0046 § 8.3 — dixième à douzième domaines « Stocks », « Équipements », « Documents »', () => {
    expect(ACTION_DOMAINS.slice(9, 12)).toEqual([
      {
        key: 'stock',
        label: 'Stocks',
        actions: ['stock.read', 'stock.move', 'stock.count', 'stock.manage'],
      },
      { key: 'assets', label: 'Équipements', actions: ['assets.read', 'assets.manage'] },
      { key: 'documents', label: 'Documents', actions: ['docs.read', 'docs.manage'] },
    ]);
    expect(ACTION_LABELS['stock.read']).toBe('Consulter les stocks');
    expect(ACTION_LABELS['stock.move']).toBe('Mouvementer le stock');
    expect(ACTION_LABELS['stock.count']).toBe('Compter un inventaire');
    expect(ACTION_LABELS['stock.manage']).toBe('Gérer les stocks et valider les écarts');
    expect(ACTION_LABELS['assets.read']).toBe('Consulter les équipements');
    expect(ACTION_LABELS['assets.manage']).toBe('Gérer les équipements');
    expect(ACTION_LABELS['docs.read']).toBe('Consulter la bibliothèque de documents');
    expect(ACTION_LABELS['docs.manage']).toBe('Gérer la bibliothèque de documents');
  });

  it('ADR-0046 § 8.3 — dépendances ; aucune paire nouvelle, rien de non délégable en plus', () => {
    for (const a of ['stock.move', 'stock.count', 'stock.manage'] as const) {
      expect(requiredActionsOf(a), a).toEqual(['analytics.read', 'stock.read']);
    }
    expect(requiredActionsOf('assets.manage')).toEqual(['analytics.read', 'assets.read']);
    expect(requiredActionsOf('docs.manage')).toEqual(['analytics.read', 'docs.read']);
    for (const a of ['stock.read', 'assets.read', 'docs.read'] as const) {
      expect(requiredActionsOf(a), a).toEqual(['analytics.read']);
    }
    // ADR-0051 § 5.2 ajoute la quatrième, `expenses.approve` + `payables.pay`.
    expect(SOD_PAIRS).toHaveLength(4);
    expect(
      SOD_PAIRS.flat().some(
        (a) => a.startsWith('stock.') || a.startsWith('assets.') || a.startsWith('docs.'),
      ),
    ).toBe(false);
    expect(NON_DELEGABLE_ACTIONS).toEqual(['billing.manage']);
  });

  it('ADR-0051 § 5.2 — domaine « Ressources humaines » élargi ; libellés et dépendances', () => {
    expect(ACTION_DOMAINS).toHaveLength(13);
    expect(ACTION_DOMAINS.find((d) => d.key === 'hr')?.actions.slice(5)).toEqual([
      'expenses.claim',
      'expenses.approve',
      'attendance.clock',
      'performance.read',
    ]);
    expect(ACTION_LABELS['expenses.claim']).toBe('Déclarer ses frais et demander une avance');
    expect(ACTION_LABELS['expenses.approve']).toBe('Valider les notes de frais et les avances');
    expect(ACTION_LABELS['attendance.clock']).toBe('Pointer sa présence');
    expect(ACTION_LABELS['performance.read']).toBe(
      'Consulter les objectifs et les évaluations du personnel',
    );
    // Déclarer et pointer : le socle seul (pour soi).
    expect(requiredActionsOf('expenses.claim')).toEqual(['analytics.read']);
    expect(requiredActionsOf('attendance.clock')).toEqual(['analytics.read']);
    // Valider : relire la trésorerie engagée et le dossier du bénéficiaire.
    expect(requiredActionsOf('expenses.approve')).toEqual([
      'analytics.read',
      'treasury.read',
      'hr.read',
    ]);
    expect(requiredActionsOf('performance.read')).toEqual(['analytics.read', 'hr.read']);
    // `payables.pay` : dépendances inchangées (décision ouverte n° 2).
    expect(ACTION_DEPENDENCIES['payables.pay']).toEqual(['purchase.read', 'treasury.read']);
    expect(NON_DELEGABLE_ACTIONS).toEqual(['billing.manage']);
  });

  it('ADR-0051 § 5.2 — paire `expenses.approve` + `payables.pay` : un Comptable ne reçoit pas la validation des frais', () => {
    expect(SOD_PAIRS).toContainEqual(['expenses.approve', 'payables.pay']);
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'accountant',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['hr.read', 'expenses.approve'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toEqual({ ok: false, code: 'SOD_CONFLICT', pair: ['expenses.approve', 'payables.pay'] });
    // Le Responsable RH la reçoit (décision ouverte n° 2) s'il lit la trésorerie.
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'hr_manager',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['expenses.approve'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toEqual({
      ok: false,
      code: 'PERMISSION_DEPENDENCY_MISSING',
      action: 'expenses.approve',
      missing: ['treasury.read'],
    });
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'hr_manager',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['treasury.read', 'expenses.approve'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toMatchObject({ ok: true, grants: ['treasury.read', 'expenses.approve'] });
    // Le Directeur financier cumule nativement : lui retirer autre chose passe.
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'finance_director',
        targetCtxBefore: NO_OVERRIDES,
        grants: [],
        revokes: ['attendance.clock'],
        actorIsTarget: false,
      }),
    ).toMatchObject({ ok: true });
  });

  it('ADR-0051 § 5.1 — `performance.read` ne s’ajoute que par un acteur qui la détient (R7)', () => {
    // Le Directeur financier ne la détient pas : il ne peut l'ajouter à personne.
    expect(
      validateOverrides({
        actorRole: 'finance_director',
        actorCtx: NO_OVERRIDES,
        targetRole: 'analyst',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['hr.read', 'performance.read'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toEqual({ ok: false, code: 'PERMISSION_ESCALATION', actions: ['performance.read'] });
    // Sans `hr.read`, la dépendance manque.
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'viewer',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['performance.read'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toEqual({
      ok: false,
      code: 'PERMISSION_DEPENDENCY_MISSING',
      action: 'performance.read',
      missing: ['hr.read'],
    });
    // Le Propriétaire l'ajoute à un Administrateur (décision ouverte n° 12, par membre).
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'admin',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['performance.read'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toMatchObject({ ok: true, grants: ['performance.read'] });
  });

  it('ADR-0050 § 8.3 — domaine « Ventes et facturation » élargi après `sales.quote` ; libellés, dépendances, aucune paire nouvelle', () => {
    expect(ACTION_DOMAINS).toHaveLength(13);
    expect(ACTION_DOMAINS.find((d) => d.key === 'sales')).toEqual({
      key: 'sales',
      label: 'Ventes et facturation',
      actions: [
        'sales.read',
        'sales.manage',
        'sales.quote',
        'sales.contract',
        'sales.contract.approve',
        'sales.invoice',
        'sales.receipt',
        'fiscal.manage',
      ],
    });
    expect(ACTION_LABELS['sales.contract']).toBe('Préparer contrats et commandes');
    expect(ACTION_LABELS['sales.contract.approve']).toBe('Approuver les contrats');
    for (const a of ['sales.contract', 'sales.contract.approve'] as const) {
      expect(requiredActionsOf(a), a).toEqual(['analytics.read', 'sales.read']);
    }
    // La règle utile (ne pas approuver ce qu'on a préparé) est dynamique
    // (`contractApprovalDecision`) : une paire statique empêcherait l'entrepreneur seul de
    // contracter.
    // ADR-0051 § 5.2 ajoute la quatrième, `expenses.approve` + `payables.pay`.
    expect(SOD_PAIRS).toHaveLength(4);
    expect(SOD_PAIRS.flat().some((a) => a.startsWith('sales.contract'))).toBe(false);
    expect(NON_DELEGABLE_ACTIONS).toEqual(['billing.manage']);
  });

  it('ADR-0050 § 8.3 — `sales.contract.approve` s’ajoute à un Comptable par écart ; sans `sales.read`, dépendance manquante', () => {
    // Décision ouverte n° 2 : un ajout par membre reste possible.
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'accountant',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['sales.contract.approve'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toMatchObject({ ok: true, grants: ['sales.contract.approve'] });
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'hr_manager',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['sales.contract'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toEqual({
      ok: false,
      code: 'PERMISSION_DEPENDENCY_MISSING',
      action: 'sales.contract',
      missing: ['sales.read'],
    });
    // Le Commercial ne reçoit pas l'approbation d'un acteur qui ne la détient pas (G1).
    expect(
      validateOverrides({
        actorRole: 'admin',
        actorCtx: NO_OVERRIDES,
        targetRole: 'sales_rep',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['sales.contract.approve'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toEqual({
      ok: false,
      code: 'PERMISSION_ESCALATION',
      actions: ['sales.contract.approve'],
    });
  });

  it('ADR-0049 § 8.3 — treizième domaine « Comptabilité », libellés et dépendances ; aucune paire nouvelle', () => {
    expect(ACTION_DOMAINS[12]).toEqual({
      key: 'accounting',
      label: 'Comptabilité',
      actions: [
        'accounting.read',
        'accounting.post',
        'accounting.close',
        'accounting.export',
        'accounting.manage',
      ],
    });
    expect(ACTION_LABELS['accounting.read']).toBe('Consulter la comptabilité');
    expect(ACTION_LABELS['accounting.post']).toBe('Saisir et valider des écritures');
    expect(ACTION_LABELS['accounting.close']).toBe('Clôturer les périodes comptables');
    expect(ACTION_LABELS['accounting.export']).toBe('Exporter la comptabilité');
    expect(ACTION_LABELS['accounting.manage']).toBe('Paramétrer la comptabilité');
    expect(requiredActionsOf('accounting.read')).toEqual(['analytics.read']);
    for (const a of [
      'accounting.post',
      'accounting.close',
      'accounting.export',
      'accounting.manage',
    ] as const) {
      expect(requiredActionsOf(a), a).toEqual(['analytics.read', 'accounting.read']);
    }
    // La règle utile (ne pas valider sa propre écriture) est dynamique : une paire
    // statique empêcherait l'entrepreneur seul de tenir ses livres.
    // ADR-0051 § 5.2 ajoute la quatrième, `expenses.approve` + `payables.pay`.
    expect(SOD_PAIRS).toHaveLength(4);
    expect(SOD_PAIRS.flat().some((a) => a.startsWith('accounting.'))).toBe(false);
    expect(NON_DELEGABLE_ACTIONS).toEqual(['billing.manage']);
  });

  it('ADR-0049 § 8.3 — `accounting.export` s’ajoute par écart sans `accounting.read` : dépendance manquante', () => {
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'sales_rep',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['accounting.export'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toEqual({
      ok: false,
      code: 'PERMISSION_DEPENDENCY_MISSING',
      action: 'accounting.export',
      missing: ['accounting.read'],
    });
    // L'Expert-comptable (externe) ne reçoit `sales.read` par ajout que du Propriétaire ou
    // d'un acteur qui le détient (décision ouverte n° 3, écarts éteints par défaut).
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'external_accountant',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['sales.read', 'purchase.read'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toMatchObject({ ok: true, grants: ['sales.read', 'purchase.read'] });
  });

  it('ADR-0046 § 8.3 — `stock.manage` s’ajoute par écart sans `stock.read` : dépendance manquante', () => {
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'hr_manager',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['stock.manage'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toEqual({
      ok: false,
      code: 'PERMISSION_DEPENDENCY_MISSING',
      action: 'stock.manage',
      missing: ['stock.read'],
    });
    // Un Administrateur, qui détient `stock.manage` (ⓢ), peut l'ajouter à un Magasinier (aucune
    // paire statique) : la séparation dynamique `stockCountDecision` s'applique alors.
    expect(
      validateOverrides({
        actorRole: 'admin',
        actorCtx: NO_OVERRIDES,
        targetRole: 'storekeeper',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['stock.manage'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toMatchObject({ ok: true, grants: ['stock.manage'] });
  });

  it('ADR-0045 § 4.5 — neuvième domaine « Ressources humaines », cinq actions, libellés', () => {
    expect(ACTION_DOMAINS[8]).toEqual({
      key: 'hr',
      label: 'Ressources humaines',
      actions: [
        'hr.read',
        'hr.manage',
        'hr.sensitive.read',
        'leave.request',
        'leave.approve',
        // ADR-0051 § 5.2 : second volet, même domaine.
        'expenses.claim',
        'expenses.approve',
        'attendance.clock',
        'performance.read',
      ],
    });
    expect(ACTION_LABELS['hr.read']).toBe('Consulter les dossiers du personnel');
    expect(ACTION_LABELS['hr.manage']).toBe('Gérer les dossiers du personnel');
    expect(ACTION_LABELS['hr.sensitive.read']).toBe('Consulter les données sensibles du personnel');
    expect(ACTION_LABELS['leave.request']).toBe('Demander une absence');
    expect(ACTION_LABELS['leave.approve']).toBe('Valider les absences');
  });

  it('ADR-0045 § 4.5 — dépendances des RH ; aucune paire, rien de non délégable en plus', () => {
    for (const a of ['hr.manage', 'hr.sensitive.read', 'leave.approve'] as const) {
      expect(requiredActionsOf(a), a).toEqual(['analytics.read', 'hr.read']);
    }
    expect(requiredActionsOf('leave.request')).toEqual(['analytics.read']);
    expect(requiredActionsOf('hr.read')).toEqual(['analytics.read']);
    // ADR-0051 § 5.2 ajoute la quatrième, `expenses.approve` + `payables.pay`.
    expect(SOD_PAIRS).toHaveLength(4);
    expect(SOD_PAIRS.flat().some((a) => a.startsWith('hr.') || a.startsWith('leave.'))).toBe(false);
    expect(NON_DELEGABLE_ACTIONS).toEqual(['billing.manage']);
  });

  it('ADR-0045 § 4.5 — `hr.sensitive.read` s’ajoute par écart, si l’acteur la détient (R7)', () => {
    // Un Directeur financier l'ajoute à un Administrateur… pas l'inverse.
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'admin',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['hr.sensitive.read'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toMatchObject({ ok: true, grants: ['hr.sensitive.read'] });
    expect(
      validateOverrides({
        actorRole: 'admin',
        actorCtx: NO_OVERRIDES,
        targetRole: 'viewer',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['hr.read', 'hr.sensitive.read'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toEqual({ ok: false, code: 'PERMISSION_ESCALATION', actions: ['hr.sensitive.read'] });
    // Sans `hr.read`, la dépendance manque : rien n'est complété en silence.
    expect(
      validateOverrides({
        actorRole: 'owner',
        actorCtx: NO_OVERRIDES,
        targetRole: 'viewer',
        targetCtxBefore: NO_OVERRIDES,
        grants: ['leave.approve'],
        revokes: [],
        actorIsTarget: false,
      }),
    ).toEqual({
      ok: false,
      code: 'PERMISSION_DEPENDENCY_MISSING',
      action: 'leave.approve',
      missing: ['hr.read'],
    });
  });

  it('ADR-0044 § 4.3 — huitième domaine « Achats et fournisseurs », cinq actions, libellés', () => {
    expect(ACTION_DOMAINS[7]).toEqual({
      key: 'purchases',
      label: 'Achats et fournisseurs',
      actions: [
        'purchase.read',
        'purchase.request',
        'purchase.manage',
        'purchase.approve',
        'payables.pay',
      ],
    });
    expect(ACTION_LABELS['purchase.read']).toBe('Consulter les achats et les fournisseurs');
    expect(ACTION_LABELS['purchase.request']).toBe('Demander un achat');
    expect(ACTION_LABELS['purchase.manage']).toBe(
      'Gérer les fournisseurs, commandes, réceptions et factures fournisseurs',
    );
    expect(ACTION_LABELS['purchase.approve']).toBe("Approuver les demandes d'achat");
    // ADR-0051 § 5.1 : libellé élargi au remboursement du personnel.
    expect(ACTION_LABELS['payables.pay']).toBe('Payer les fournisseurs et rembourser le personnel');
  });

  it('ADR-0044 § 4.3 — dépendances des achats', () => {
    for (const a of ['purchase.request', 'purchase.manage', 'purchase.approve'] as const) {
      expect(requiredActionsOf(a), a).toEqual(['analytics.read', 'purchase.read']);
    }
    expect(requiredActionsOf('payables.pay')).toEqual([
      'analytics.read',
      'treasury.read',
      'purchase.read',
    ]);
  });

  it('le vocabulaire visible ne dit ni « action », ni « grant », ni « override »', () => {
    const textes = [...Object.values(ACTION_LABELS), ...ACTION_DOMAINS.map((d) => d.label)];
    for (const t of textes) expect(t).not.toMatch(/\b(action|grant|override)/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Propriété à graine fixe (ADR-0041 § 9.5) : 10 000 tirages acteur × cible × écart.
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
  it('20 000 tirages à graine fixe', () => {
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
    // ADR-0044 : 3 000 tirages (et non 2 000) — à 33 actions, les écarts tirés à taux
    // fixe touchent plus d'actions et l'escalade domine ; 2 000 tirages ne donnaient
    // plus que 77 acceptations, sous le seuil de 100 qui garantit une propriété exercée.
    // ADR-0045 : 5 000 tirages — à 38 actions et 10 rôles, 3 000 tirages ne donnaient plus
    // que 75 acceptations. ADR-0046 : 10 000 tirages — à 46 actions et 11 rôles, 5 000
    // tirages ne donnaient plus que 60 acceptations. ADR-0049 : 15 000 tirages — à 51 actions
    // et 12 rôles, 10 000 tirages ne donnaient plus que 95 acceptations. ADR-0059 : 20 000
    // tirages — à 16 rôles, 15 000 tirages ne donnaient plus que 91 acceptations.
    for (let i = 0; i < 20000; i++) {
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
  }, 120_000); // 20 000 tirages : marge sous charge (CI)
});
