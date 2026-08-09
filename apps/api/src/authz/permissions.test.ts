// Test de matrice — LE garde-fou du RBAC (ADR-0012 § Plan de validation).
//
// ── Pourquoi la matrice est REDÉCLARÉE ici ───────────────────────────────────
//
// Les tableaux ci-dessous ne sont PAS importés de `permissions.ts`. Ils sont
// retranscrits à la main depuis ADR-0012 §3 et §4. C'est délibéré : un test qui
// importerait la matrice de production vérifierait seulement qu'elle est égale à
// elle-même. Ici, toute modification d'une case de production casse le test, ce
// qui force une mise à jour CONSCIENTE de l'ADR et de docs/12.
//
// 8 rôles × 15 actions + 6 rôles plateforme × 15 actions = 210 cases vérifiées.

import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  ORG_PERMISSION_MATRIX,
  ORG_ROLES,
  ORG_ROLE_RANK,
  OWNER_ROLE,
  PLATFORM_FORBIDDEN_ACTIONS,
  PLATFORM_MFA_REQUIRED,
  PLATFORM_PERMISSION_MATRIX,
  PLATFORM_ROLES,
  can,
  canGrantRole,
  canPlatform,
  grantableRoles,
  isAssignableRole,
  isOwnerRole,
  normalizeOrgRole,
  platformRoleRequiresMfa,
  platformRolesRequireMfa,
  sodDecision,
  type Action,
  type OrgRole,
  type PlatformRole,
} from './permissions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Transcription d'ADR-0012 §3 — matrice organisation
//
// Légende (identique à celle de l'ADR) :
//   A = ✓  autorisé            S = ✓ⓢ autorisé, séparation des tâches
//   . = ✗  refusé              P = ✓P autorisé, projets assignés
//   C = ⚙  conditionnel (droit explicite à accorder)
// ─────────────────────────────────────────────────────────────────────────────

const ORDRE_ORG: readonly OrgRole[] = [
  'owner',
  'admin',
  'finance_director',
  'accountant',
  'analyst',
  'project_manager',
  'advisor',
  'viewer',
];

//                                        PRO ADM DIR CPT ANA CDP CON LEC
const ATTENDU_ORG: Record<Action, string> = {
  'organization.manage': 'A   A   .   .   .   .   .   .',
  'billing.manage': 'A   .   .   .   .   .   .   .',
  'members.invite': 'A   A   .   .   .   .   .   .',
  'project.create': 'A   A   A   .   .   .   .   .',
  'project.read': 'A   A   A   A   A   P   A   A',
  'project.update': 'A   A   A   .   .   P   .   .',
  'canvas.update': 'A   A   A   .   A   P   .   .',
  'inputs.update': 'A   A   A   .   A   P   .   .',
  'plan.calculate': 'A   A   A   .   A   P   .   .',
  'plan.approve': 'S   .   S   .   .   .   .   .',
  'actuals.import': 'A   A   A   A   .   .   .   .',
  'period.close': 'A   .   A   C   .   .   .   .',
  'analytics.read': 'A   A   A   A   A   P   A   A',
  'report.export': 'A   A   A   A   A   P   .   .',
  'audit.read': 'A   A   A   .   .   .   .   .',
};

const CODE_VERS_GRANT: Record<string, string> = {
  A: 'allow',
  '.': 'deny',
  S: 'allow_sod',
  P: 'allow_project',
  C: 'conditional',
};

// ─────────────────────────────────────────────────────────────────────────────
// Transcription d'ADR-0012 §4 — matrice plateforme
//
//   N = ✓   natif        D = ⚙D  sous accès délégué seulement
//   . = ✗   interdit, y compris au super-administrateur
// ─────────────────────────────────────────────────────────────────────────────

const ORDRE_PLATEFORME: readonly PlatformRole[] = [
  'platform_super_admin',
  'platform_admin',
  'platform_support',
  'platform_billing',
  'platform_template_editor',
  'platform_country_pack_manager',
];

//                                              SA  PA  SUP FAC TPL CPK
const ATTENDU_PLATEFORME: Record<Action, string> = {
  'organization.manage': 'N   N   .   .   .   .',
  'billing.manage': 'N   .   .   N   .   .',
  'members.invite': 'N   N   .   .   .   .',
  'project.create': 'D   .   .   .   .   .',
  'project.read': 'D   D   D   .   .   .',
  'project.update': 'D   .   .   .   .   .',
  'canvas.update': 'D   .   .   .   .   .',
  'inputs.update': 'D   .   .   .   .   .',
  'plan.calculate': 'D   .   .   .   .   .',
  'plan.approve': '.   .   .   .   .   .',
  'actuals.import': 'D   .   .   .   .   .',
  'period.close': '.   .   .   .   .   .',
  'analytics.read': 'D   .   D   .   .   .',
  'report.export': '.   .   .   .   .   .',
  'audit.read': 'N   N   D   .   .   .',
};

const CODE_VERS_GRANT_PLATEFORME: Record<string, string> = {
  N: 'native',
  D: 'delegated',
  '.': 'forbidden',
};

function cellules(ligne: string): string[] {
  return ligne.trim().split(/\s+/);
}

describe('matrice rôle organisation × action (ADR-0012 §3)', () => {
  it('déclare exactement les 8 rôles et les 15 actions de docs/12', () => {
    expect([...ORG_ROLES]).toEqual([...ORDRE_ORG]);
    expect(ACTIONS).toHaveLength(15);
    expect(Object.keys(ATTENDU_ORG).sort()).toEqual([...ACTIONS].sort());
  });

  // 8 × 15 = 120 cases.
  for (const action of ACTIONS) {
    const attendus = cellules(ATTENDU_ORG[action]);
    it(`« ${action} » : les 8 cases correspondent à l'ADR`, () => {
      expect(attendus).toHaveLength(ORDRE_ORG.length);
      ORDRE_ORG.forEach((role, i) => {
        const attendu = CODE_VERS_GRANT[attendus[i]!];
        expect(attendu, `code inconnu « ${attendus[i]} »`).toBeDefined();
        expect(
          ORG_PERMISSION_MATRIX[role][action],
          `${role} × ${action} devrait être ${attendu}`,
        ).toBe(attendu);
      });
    });
  }
});

describe('matrice rôle plateforme × action (ADR-0012 §4)', () => {
  it('déclare exactement les 6 rôles plateforme, tous préfixés `platform_`', () => {
    expect([...PLATFORM_ROLES]).toEqual([...ORDRE_PLATEFORME]);
    for (const role of PLATFORM_ROLES) expect(role.startsWith('platform_')).toBe(true);
  });

  // 6 × 15 = 90 cases.
  for (const action of ACTIONS) {
    const attendus = cellules(ATTENDU_PLATEFORME[action]);
    it(`« ${action} » : les 6 cases plateforme correspondent à l'ADR`, () => {
      expect(attendus).toHaveLength(ORDRE_PLATEFORME.length);
      ORDRE_PLATEFORME.forEach((role, i) => {
        const attendu = CODE_VERS_GRANT_PLATEFORME[attendus[i]!];
        expect(attendu, `code inconnu « ${attendus[i]} »`).toBeDefined();
        expect(
          PLATFORM_PERMISSION_MATRIX[role][action],
          `${role} × ${action} devrait être ${attendu}`,
        ).toBe(attendu);
      });
    });
  }
});

describe('interdits absolus de la plateforme (ADR-0012 §4)', () => {
  const interdits: Action[] = ['plan.approve', 'period.close', 'report.export'];

  it('sont exactement ceux annoncés', () => {
    expect([...PLATFORM_FORBIDDEN_ACTIONS].sort()).toEqual([...interdits].sort());
  });

  it('aucun rôle plateforme ne les obtient, même avec un accès délégué actif', () => {
    for (const role of PLATFORM_ROLES) {
      for (const action of interdits) {
        expect(canPlatform(role, action, { hasActiveGrant: true }), `${role} × ${action}`).toBe(
          false,
        );
      }
    }
  });

  it('la matrice elle-même ne contredit jamais la liste', () => {
    for (const role of PLATFORM_ROLES) {
      for (const action of interdits) {
        expect(PLATFORM_PERMISSION_MATRIX[role][action]).toBe('forbidden');
      }
    }
  });

  it("le super-administrateur n'échappe pas à la règle", () => {
    expect(canPlatform('platform_super_admin', 'report.export', { hasActiveGrant: true })).toBe(
      false,
    );
    // …alors qu'il détient bien ses droits de portée plateforme.
    expect(canPlatform('platform_super_admin', 'audit.read')).toBe(true);
  });
});

describe('accès délégué (⚙D)', () => {
  it('une case `delegated` est refusée SANS grant et accordée AVEC', () => {
    expect(canPlatform('platform_support', 'project.read')).toBe(false);
    expect(canPlatform('platform_support', 'project.read', { hasActiveGrant: true })).toBe(true);
  });

  it('un grant ne crée jamais un droit là où la case est `forbidden`', () => {
    expect(canPlatform('platform_billing', 'project.read', { hasActiveGrant: true })).toBe(false);
  });
});

describe('droit conditionnel ⚙ (docs/12 « clôture selon permission »)', () => {
  it('le comptable ne clôture pas sans le droit explicite', () => {
    expect(can('accountant', 'period.close')).toBe(false);
    expect(can('accountant', 'period.close', { canClosePeriods: false })).toBe(false);
  });

  it('le comptable clôture une fois le droit accordé', () => {
    expect(can('accountant', 'period.close', { canClosePeriods: true })).toBe(true);
  });

  it("le drapeau n'élargit AUCUN autre rôle ni aucune autre action", () => {
    // C'est l'invariant qui empêche `canClosePeriods` de devenir une porte dérobée.
    for (const role of ORG_ROLES) {
      for (const action of ACTIONS) {
        const sans = can(role, action, { canClosePeriods: false });
        const avec = can(role, action, { canClosePeriods: true });
        if (role === 'accountant' && action === 'period.close') {
          expect(sans).toBe(false);
          expect(avec).toBe(true);
        } else {
          expect(avec, `${role} × ${action} ne doit pas dépendre du drapeau`).toBe(sans);
        }
      }
    }
  });

  it("`conditional` n'apparaît qu'une seule fois dans toute la matrice", () => {
    const cases = ORG_ROLES.flatMap((r) =>
      ACTIONS.filter((a) => ORG_PERMISSION_MATRIX[r][a] === 'conditional').map((a) => `${r}:${a}`),
    );
    expect(cases).toEqual(['accountant:period.close']);
  });
});

describe('R2 — séparation validation / saisie (docs/12 § Règles critiques)', () => {
  it('`plan.approve` et `inputs.update` sont deux actions distinctes', () => {
    expect(ACTIONS).toContain('plan.approve');
    expect(ACTIONS).toContain('inputs.update');
  });

  it('seuls `owner` et `finance_director` peuvent approuver un plan', () => {
    const approbateurs = ORG_ROLES.filter((r) => can(r, 'plan.approve'));
    expect(approbateurs).toEqual(['owner', 'finance_director']);
  });

  it('`admin`, `analyst` et `project_manager` saisissent sans jamais approuver', () => {
    for (const role of ['admin', 'analyst', 'project_manager'] as const) {
      expect(can(role, 'inputs.update'), `${role} doit pouvoir saisir`).toBe(true);
      expect(can(role, 'plan.approve'), `${role} ne doit pas approuver`).toBe(false);
    }
  });

  it('le comptable constate mais ne projette pas', () => {
    expect(can('accountant', 'actuals.import')).toBe(true);
    expect(can('accountant', 'inputs.update')).toBe(false);
    expect(can('accountant', 'plan.calculate')).toBe(false);
  });

  it('toute case `plan.approve` autorisée porte la marque ⓢ', () => {
    for (const role of ORG_ROLES) {
      const cell = ORG_PERMISSION_MATRIX[role]['plan.approve'];
      expect(cell === 'deny' || cell === 'allow_sod').toBe(true);
    }
  });

  describe('décision dynamique', () => {
    it('approbateur différent du dernier saisisseur → séparé', () => {
      expect(
        sodDecision({
          approverUserId: 'u1',
          lastInputAuthorUserId: 'u2',
          approverCountInOrg: 2,
        }),
      ).toBe('separated');
    });

    it("auto-approbation avec d'autres approbateurs disponibles → refus", () => {
      expect(
        sodDecision({
          approverUserId: 'u1',
          lastInputAuthorUserId: 'u1',
          approverCountInOrg: 2,
        }),
      ).toBe('self_forbidden');
    });

    it('entrepreneur SEUL : auto-approbation autorisée mais marquée', () => {
      // Le cas majoritaire en RDC. Sans cette échappatoire, une organisation
      // d'une personne ne pourrait JAMAIS valider son plan.
      expect(
        sodDecision({
          approverUserId: 'u1',
          lastInputAuthorUserId: 'u1',
          approverCountInOrg: 1,
        }),
      ).toBe('sole_approver');
    });

    it('auteur des entrées inconnu (projet antérieur à S20a) → séparé', () => {
      expect(
        sodDecision({
          approverUserId: 'u1',
          lastInputAuthorUserId: null,
          approverCountInOrg: 1,
        }),
      ).toBe('separated');
    });
  });
});

describe('R3 — clôture et réouverture exigent des permissions distinctes', () => {
  it('un comptable habilité clôture mais ne peut pas rouvrir', () => {
    const ctx = { canClosePeriods: true };
    expect(can('accountant', 'period.close', ctx)).toBe(true);
    // La réouverture exige les DEUX; il lui manque `plan.approve`.
    expect(can('accountant', 'plan.approve', ctx)).toBe(false);
  });

  it('`owner` et `finance_director` détiennent bien les deux', () => {
    for (const role of ['owner', 'finance_director'] as const) {
      expect(can(role, 'period.close')).toBe(true);
      expect(can(role, 'plan.approve')).toBe(true);
    }
  });

  it('un `admin` ne peut ni clôturer ni rouvrir', () => {
    expect(can('admin', 'period.close')).toBe(false);
    expect(can('admin', 'plan.approve')).toBe(false);
  });
});

describe('R4 — exports', () => {
  it("`advisor` et `viewer` n'ont pas `report.export`", () => {
    expect(can('advisor', 'report.export')).toBe(false);
    expect(can('viewer', 'report.export')).toBe(false);
  });

  it('`advisor` conserve la consultation en ligne', () => {
    expect(can('advisor', 'project.read')).toBe(true);
    expect(can('advisor', 'analytics.read')).toBe(true);
  });
});

describe('R7 — attribution de rôles sans élévation de privilège', () => {
  it('un `owner` peut attribuer tous les rôles attribuables', () => {
    expect(grantableRoles('owner').sort()).toEqual(
      ORG_ROLES.filter(isAssignableRole).slice().sort(),
    );
  });

  it('un `admin` ne peut pas attribuer `finance_director` (qui approuve)', () => {
    expect(canGrantRole('admin', 'finance_director')).toBe(false);
  });

  it('un `admin` ne peut pas attribuer `accountant` (clôture conditionnelle)', () => {
    // Conséquence assumée d'ADR-0012 §6 R7 : le sous-ensemble se calcule sur les
    // actions POTENTIELLES, drapeau ⚙ compris. Sinon un `admin` accorderait un
    // rôle capable d'une action qu'il n'a pas, en pariant sur le défaut `false`.
    expect(canGrantRole('admin', 'accountant')).toBe(false);
  });

  it('un `admin` peut attribuer les rôles strictement plus faibles que lui', () => {
    for (const role of ['analyst', 'advisor', 'viewer', 'admin'] as const) {
      expect(canGrantRole('admin', role), `admin → ${role}`).toBe(true);
    }
  });

  it("un `viewer` ne peut attribuer que des rôles sans aucun droit d'écriture", () => {
    // `advisor` et `viewer` ont des ensembles d'actions IDENTIQUES dans la
    // matrice ({project.read, analytics.read}) : la règle du sous-ensemble ne
    // peut donc pas les distinguer, et `viewer` « peut » attribuer `advisor`.
    // C'est sans conséquence — d'abord parce qu'aucun droit n'est gagné, ensuite
    // parce qu'un `viewer` n'a pas `members.invite` et que le guard le refuse
    // bien avant que R7 soit consulté. Ce que le test doit garantir, c'est
    // qu'aucune ÉCRITURE ne fuit par ce chemin.
    expect(grantableRoles('viewer').sort()).toEqual(['advisor', 'viewer']);
    for (const cible of grantableRoles('viewer')) {
      for (const action of ACTIONS) {
        if (action === 'project.read' || action === 'analytics.read') continue;
        expect(can(cible, action, { canClosePeriods: true }), `${cible} × ${action}`).toBe(false);
      }
    }
    expect(can('viewer', 'members.invite')).toBe(false);
  });

  it('personne ne peut attribuer `owner` sauf un `owner`', () => {
    for (const role of ORG_ROLES) {
      expect(canGrantRole(role, 'owner'), `${role} → owner`).toBe(role === 'owner');
    }
  });

  it("aucun rôle ne peut attribuer un rôle détenant une action qu'il n'a pas", () => {
    // L'invariant général, vérifié exhaustivement plutôt que cas par cas.
    for (const acteur of ORG_ROLES) {
      for (const cible of grantableRoles(acteur)) {
        for (const action of ACTIONS) {
          if (ORG_PERMISSION_MATRIX[cible][action] !== 'deny') {
            expect(
              ORG_PERMISSION_MATRIX[acteur][action],
              `${acteur} attribue ${cible} qui détient ${action}`,
            ).not.toBe('deny');
          }
        }
      }
    }
  });

  it("`project_manager` n'est attribuable par personne tant que les projets ne sont pas assignables", () => {
    expect(isAssignableRole('project_manager')).toBe(false);
    for (const role of ORG_ROLES) {
      expect(grantableRoles(role)).not.toContain('project_manager');
    }
  });
});

describe('rang de privilège (correction du tri de l’organisation primaire)', () => {
  it('`owner` est le rang 0', () => {
    expect(ORG_ROLE_RANK.owner).toBe(0);
  });

  it('couvre les 8 rôles avec des rangs distincts', () => {
    const rangs = ORG_ROLES.map((r) => ORG_ROLE_RANK[r]);
    expect(new Set(rangs).size).toBe(ORG_ROLES.length);
  });

  it('`owner` gagne contre tout autre rôle — ce que le tri alphabétique ne faisait PAS', () => {
    // Le bug d'origine : 'project_manager' > 'owner' et 'viewer' > 'owner' en
    // ordre alphabétique. Le rang explicite inverse ces comparaisons.
    for (const role of ORG_ROLES) {
      if (role === 'owner') continue;
      expect(ORG_ROLE_RANK.owner).toBeLessThan(ORG_ROLE_RANK[role]);
      // Preuve que le tri naïf se serait trompé sur ces deux-là :
      if (role === 'project_manager' || role === 'viewer') {
        expect(role > 'owner').toBe(true);
      }
    }
  });
});

describe('compatibilité N-1 des anciens rôles', () => {
  it('`member` devient `finance_director` (iso-privilège, ADR-0012 §7)', () => {
    expect(normalizeOrgRole('member')).toBe('finance_director');
  });

  it('`owner` traverse la migration inchangé', () => {
    expect(normalizeOrgRole('owner')).toBe('owner');
  });

  it('les 8 slogans S20a se normalisent en eux-mêmes', () => {
    for (const role of ORG_ROLES) expect(normalizeOrgRole(role)).toBe(role);
  });

  it('une valeur inconnue ne se normalise pas en un rôle par défaut', () => {
    // Renvoyer `viewer` ici serait tentant et dangereux : une faute de frappe
    // deviendrait un accès silencieux au lieu d'une erreur.
    expect(normalizeOrgRole('root')).toBeUndefined();
    expect(normalizeOrgRole('')).toBeUndefined();
    expect(normalizeOrgRole(undefined)).toBeUndefined();
    expect(normalizeOrgRole(null)).toBeUndefined();
    expect(normalizeOrgRole(42)).toBeUndefined();
  });
});

describe('cohérence structurelle de la matrice', () => {
  it('chaque rôle déclare une décision pour CHACUNE des 15 actions', () => {
    for (const role of ORG_ROLES) {
      for (const action of ACTIONS) {
        expect(ORG_PERMISSION_MATRIX[role][action], `${role} × ${action}`).toBeDefined();
      }
    }
  });

  it('`viewer` ne détient aucune action d’écriture', () => {
    const ecritures: Action[] = [
      'organization.manage',
      'billing.manage',
      'members.invite',
      'project.create',
      'project.update',
      'canvas.update',
      'inputs.update',
      'plan.approve',
      'actuals.import',
      'period.close',
    ];
    for (const action of ecritures) expect(can('viewer', action)).toBe(false);
  });

  it('`owner` détient les 15 actions', () => {
    for (const action of ACTIONS) expect(can('owner', action)).toBe(true);
  });

  it('`billing.manage` est réservé au seul `owner`', () => {
    expect(ORG_ROLES.filter((r) => can(r, 'billing.manage'))).toEqual(['owner']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Identité du rôle propriétaire
//
// Ces six cas viennent de `account/owner-role.test.ts` (S20b). Le fichier
// `account/owner-role.ts` qu'ils couvraient isolait provisoirement le slug
// propriétaire en attendant cette matrice; il a été supprimé et son unique
// consommateur (`account.service.ts`, règle « dernier propriétaire ») importe
// désormais `isOwnerRole` d'ici. Le contrat qu'ils fixent est inchangé.
// ─────────────────────────────────────────────────────────────────────────────

describe('R1 — identité du rôle propriétaire (repris de S20b)', () => {
  it('reconnaît le slug propriétaire', () => {
    expect(isOwnerRole(OWNER_ROLE)).toBe(true);
    expect(isOwnerRole('owner')).toBe(true);
  });

  it('ne reconnaît AUCUN des sept autres rôles d’organisation d’ADR-0012', () => {
    // Si l'un d'eux passait pour propriétaire, un compte pourrait être supprimé
    // en laissant une organisation sans personne pour la gouverner.
    for (const role of [
      'admin',
      'finance_director',
      'accountant',
      'analyst',
      'project_manager',
      'advisor',
      'viewer',
    ]) {
      expect(isOwnerRole(role)).toBe(false);
    }
    // Redondant aujourd'hui, protecteur demain : un neuvième rôle ajouté à
    // `ORG_ROLES` sans être ajouté à la liste ci-dessus est quand même vérifié.
    for (const role of ORG_ROLES.filter((r) => r !== OWNER_ROLE)) {
      expect(isOwnerRole(role), role).toBe(false);
    }
  });

  it('ne confond pas les rôles PLATEFORME avec le rôle propriétaire d’organisation', () => {
    // Les deux espaces de noms cohabitent (ADR-0012 §2) ; le préfixe est ce qui
    // les sépare, et il doit suffire.
    for (const role of PLATFORM_ROLES) expect(isOwnerRole(role), role).toBe(false);
  });

  it('reste vrai malgré une casse ou des espaces inattendus venus de la base', () => {
    // La valeur vient d'un document Mongo, pas d'un type TypeScript : mieux vaut
    // refuser une suppression de trop que d'en autoriser une de trop.
    for (const role of ['Owner', 'OWNER', ' owner ', 'owner\n']) {
      expect(isOwnerRole(role), JSON.stringify(role)).toBe(true);
    }
  });

  it('traite comme non-propriétaire toute valeur absente ou non textuelle', () => {
    for (const value of [null, undefined, '', '   ', 0, 1, {}, [], true]) {
      expect(isOwnerRole(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('n’accepte pas un rôle qui CONTIENT « owner » sans en être un', () => {
    for (const role of ['co_owner', 'owner_delegate', 'not-owner']) {
      expect(isOwnerRole(role), role).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exigence de MFA pour les rôles plateforme (S22h — docs/17 § Identité)
// ─────────────────────────────────────────────────────────────────────────────

describe('exigence de MFA plateforme (docs/17 § Identité)', () => {
  // Retranscrite à la main, comme les matrices ci-dessus : un tableau importé de
  // `permissions.ts` ne vérifierait que son égalité à lui-même. Modifier une
  // ligne de production doit casser ce test, donc forcer une décision consciente
  // et une mise à jour de docs/12 et docs/17.
  const ATTENDU: Record<PlatformRole, boolean> = {
    platform_super_admin: true,
    platform_admin: true,
    platform_support: true,
    platform_billing: true,
    platform_template_editor: true,
    platform_country_pack_manager: true,
  };

  it('les SIX rôles plateforme exigent un second facteur — aucune exemption', () => {
    for (const role of PLATFORM_ROLES) {
      expect(PLATFORM_MFA_REQUIRED[role], role).toBe(ATTENDU[role]);
      expect(platformRoleRequiresMfa(role), role).toBe(true);
    }
  });

  it('la table couvre exactement les rôles déclarés — ni trou ni rôle fantôme', () => {
    // Une case manquante ne compilerait pas ; une case EN TROP compilerait très
    // bien et n'exigerait rien de personne.
    expect(Object.keys(PLATFORM_MFA_REQUIRED).sort()).toEqual([...PLATFORM_ROLES].sort());
  });

  it('l’exigence est DISJONCTIVE : cumuler les rôles ne dispense pas du facteur', () => {
    // Point délicat. `@RequirePlatformRole` est un « ou » : détenir l'un des
    // rôles listés suffit. Si l'exigence de MFA était conjonctive, il suffirait
    // d'ajouter à son compte un rôle exempté pour se dispenser du second facteur
    // sur les routes d'un rôle sensible — le cumul de rôles AFFAIBLIRAIT la
    // contrainte. Le test fige la sémantique même si, aujourd'hui, aucun rôle
    // n'est exempté : le jour où l'un le sera, c'est ici que le trou apparaîtra.
    expect(platformRolesRequireMfa(['platform_support', 'platform_super_admin'])).toBe(true);
    expect(platformRolesRequireMfa(['platform_billing'])).toBe(true);
  });

  it('aucun rôle détenu ⇒ aucune exigence (le garde a déjà refusé avant)', () => {
    expect(platformRolesRequireMfa([])).toBe(false);
  });

  it('l’exigence porte sur les rôles PLATEFORME, pas sur les rôles d’organisation', () => {
    // docs/17 § Identité vise les « rôles sensibles » et docs/12 § Reste à faire
    // le rattache explicitement à l'ouverture de `/admin`. Étendre l'exigence
    // aux huit rôles d'organisation est une DÉCISION PRODUIT (elle imposerait un
    // second facteur à toute la clientèle), pas une conséquence technique de ce
    // chantier. Ce test constate l'état livré pour qu'un élargissement futur soit
    // un changement visible et non un glissement.
    for (const role of ORG_ROLES) {
      expect(Object.prototype.hasOwnProperty.call(PLATFORM_MFA_REQUIRED, role), role).toBe(false);
    }
  });
});
