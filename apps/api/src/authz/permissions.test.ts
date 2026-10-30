// Test de matrice — LE garde-fou du RBAC (ADR-0012 § Plan de validation).
//
// ── Pourquoi la matrice est REDÉCLARÉE ici ───────────────────────────────────
//
// Les tableaux ci-dessous ne sont PAS importés de `permissions.ts`. Ils sont
// retranscrits à la main depuis ADR-0012 §3 et §4 (et ADR-0021 §8 pour `fiscal.manage`,
// ADR-0022 § S25c.1 pour `sales.read` et `sales.manage`, ADR-0023 § S25e.11 pour
// `sales.invoice`, ADR-0031 § 4 pour `sales.receipt`, ADR-0034 § 8 pour `treasury.read` et
// `treasury.manage`, ADR-0035 § 3 pour `crm.read` et `crm.manage`, ADR-0039 § 7 pour `work.read`,
// `work.update` et `work.manage`, ADR-0040 § 4 pour `sales.quote` et le rôle `sales_rep`,
// ADR-0044 § 4.1 pour `purchase.*` et `payables.pay`, ADR-0045 § 4 pour `hr.*`, `leave.*` et
// le rôle `hr_manager`). C'est délibéré : un test qui
// importerait la matrice de production vérifierait seulement qu'elle est égale à
// elle-même. Ici, toute modification d'une case de production casse le test, ce
// qui force une mise à jour CONSCIENTE de l'ADR et de docs/12.
//
// 10 rôles × 38 actions + 6 rôles plateforme × 38 actions = 608 cases vérifiées.

import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  NO_OVERRIDES,
  ORG_PERMISSION_MATRIX,
  ORG_ROLES,
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  ORG_ROLE_RANK,
  OWNER_ROLE,
  PLATFORM_FORBIDDEN_ACTIONS,
  PLATFORM_PERMISSION_MATRIX,
  PLATFORM_ROLES,
  APPROVAL_ACTIONS,
  APPROVER_ROLES,
  can,
  canGrantRole,
  canPlatform,
  effectiveActions,
  grantableRoles,
  isAssignableRole,
  isOwnerRole,
  leaveApprovalDecision,
  normalizeOrgRole,
  OWNER_ONLY_ROLES,
  purchaseApprovalDecision,
  sodDecision,
  type LeaveApprovalInput,
  type PurchaseApprovalInput,
  type Action,
  type OrgPermissionContext,
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
  // ADR-0040 § 4.3 : neuvième, en fin de liste.
  'sales_rep',
  // ADR-0045 § 4.2 : dixième, en fin de liste.
  'hr_manager',
];

//                                        PRO ADM DIR CPT ANA CDP CON LEC COM RH
const ATTENDU_ORG: Record<Action, string> = {
  'organization.manage': 'A   A   .   .   .   .   .   .   .   .',
  'billing.manage': 'A   .   .   .   .   .   .   .   .   .',
  'members.invite': 'A   A   .   .   .   .   .   .   .   .',
  'project.create': 'A   A   A   .   .   .   .   .   .   .',
  'project.read': 'A   A   A   A   A   P   A   A   .   .',
  'project.update': 'A   A   A   .   .   P   .   .   .   .',
  'canvas.update': 'A   A   A   .   A   P   .   .   .   .',
  'inputs.update': 'A   A   A   .   A   P   .   .   .   .',
  'plan.calculate': 'A   A   A   .   A   P   .   .   .   .',
  'plan.approve': 'S   .   S   .   .   .   .   .   .   .',
  'actuals.import': 'A   A   A   A   .   .   .   .   .   .',
  'period.close': 'A   .   A   C   .   .   .   .   .   .',
  'analytics.read': 'A   A   A   A   A   P   A   A   A   A',
  'report.export': 'A   A   A   A   A   P   .   .   .   .',
  'audit.read': 'A   A   A   .   .   .   .   .   .   .',
  // ADR-0021 §8 : autorité financière seulement (Propriétaire, Directeur financier).
  'fiscal.manage': 'A   .   A   .   .   .   .   .   .   .',
  // ADR-0022 § S25c.1 : données maîtres de vente. Analyste et Lecteur consultent ;
  // le Conseiller, externe, ne voit pas le fichier clients ; le Chef de projet n'a rien.
  'sales.read': 'A   A   A   A   A   .   .   A   A   .',
  'sales.manage': 'A   A   A   A   .   .   .   .   .   .',
  // ADR-0023 § S25e.11 : émettre et normaliser engagent le contribuable. Propriétaire,
  // Directeur financier et Comptable ; l'Administrateur prépare mais n'émet pas.
  'sales.invoice': 'A   .   A   A   .   .   .   .   .   .',
  // ADR-0031 § 4 : enregistrer l'argent reçu, même population que `sales.invoice`.
  'sales.receipt': 'A   .   A   A   .   .   .   .   .   .',
  // ADR-0034 § 8 : trésorerie. Le Conseiller (externe) ne voit pas le détail des
  // dépenses ; l'Administrateur consulte mais n'enregistre pas de décaissement.
  'treasury.read': 'A   A   A   A   A   .   .   A   .   .',
  'treasury.manage': 'A   .   A   A   .   .   .   .   .   .',
  // ADR-0035 § 3 : le CRM suit la répartition de `sales.read` / `sales.manage`.
  'crm.read': 'A   A   A   A   A   .   .   A   A   .',
  'crm.manage': 'A   A   A   A   .   .   .   .   A   .',
  // ADR-0039 § 7 : projets et tâches du RUN. Le Lecteur lit ; Comptable et Analyste
  // travaillent sans gouverner ; le Conseiller (externe) et le Chef de projet n'ont rien.
  'work.read': 'A   A   A   A   A   .   .   A   A   A',
  'work.update': 'A   A   A   A   A   .   .   .   A   A',
  'work.manage': 'A   A   A   .   .   .   .   .   .   .',
  // ADR-0040 § 4.1 : préparer les devis. Iso-privilège avec `sales.manage`, plus
  // le Commercial (COM) ; convertir un devis exige en plus `sales.manage`.
  'sales.quote': 'A   A   A   A   .   .   .   .   A   .',
  // ADR-0044 § 4.1 : achats et fournisseurs. `purchase.read` suit `treasury.read`
  // (sans le Commercial) ; demander est ouvert à tout rôle interne qui travaille ;
  // préparer suit `sales.manage` ; approuver est une autorité de dépense (ⓢ) ;
  // payer suit `treasury.manage`.
  'purchase.read': 'A   A   A   A   A   .   .   A   .   .',
  'purchase.request': 'A   A   A   A   A   .   .   .   .   .',
  'purchase.manage': 'A   A   A   A   .   .   .   .   .   .',
  'purchase.approve': 'S   .   S   .   .   .   .   .   .   .',
  'payables.pay': 'A   .   A   A   .   .   .   .   .   .',
  // ADR-0045 § 4.1 : ressources humaines. Le registre (lecture, gestion) : Propriétaire,
  // Administrateur, Directeur financier, Responsable RH ; les données sensibles : le moins
  // de personnes possible (ni Administrateur, ni Comptable) ; demander une absence : tout
  // rôle interne ; valider : autorité RH (ⓢ). Le manager n'a besoin d'aucune action.
  'hr.read': 'A   A   A   .   .   .   .   .   .   A',
  'hr.manage': 'A   A   A   .   .   .   .   .   .   A',
  'hr.sensitive.read': 'A   .   A   .   .   .   .   .   .   A',
  'leave.request': 'A   A   A   A   A   .   .   A   A   A',
  'leave.approve': 'S   .   S   .   .   .   .   .   .   S',
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
  // ADR-0021 §8 : quatrième interdit absolu, super-administrateur compris.
  'fiscal.manage': '.   .   .   .   .   .',
  // ADR-0022 § S25c.1 : sous accès délégué seulement, comme `project.read` et
  // `project.update`. Aucune des deux n'est un interdit absolu.
  'sales.read': 'D   .   D   .   .   .',
  'sales.manage': 'D   .   .   .   .   .',
  // ADR-0023 § S25e.11 : cinquième interdit absolu, super-administrateur compris.
  'sales.invoice': '.   .   .   .   .   .',
  // ADR-0031 § 4 : interdite à tous les rôles plateforme, sans être un interdit absolu.
  'sales.receipt': '.   .   .   .   .   .',
  // ADR-0034 § 8 : sous accès délégué, comme `sales.read` et `sales.manage`.
  'treasury.read': 'D   .   D   .   .   .',
  'treasury.manage': 'D   .   .   .   .   .',
  // ADR-0035 § 3 : comme `sales.read` / `sales.manage`, sous accès délégué.
  'crm.read': 'D   .   D   .   .   .',
  'crm.manage': 'D   .   .   .   .   .',
  // ADR-0039 § 7 : comme `crm.read` / `crm.manage`, sous accès délégué.
  'work.read': 'D   .   D   .   .   .',
  'work.update': 'D   .   .   .   .   .',
  'work.manage': 'D   .   .   .   .   .',
  // ADR-0040 § 4.1 : comme `sales.manage`, sous accès délégué ; pas un interdit absolu.
  'sales.quote': 'D   .   .   .   .   .',
  // ADR-0044 § 4.1 : lecture déléguée (SA, support), demande et gestion déléguées (SA
  // seul) ; approuver et payer refusés à tous, sans être des interdits absolus.
  'purchase.read': 'D   .   D   .   .   .',
  'purchase.request': 'D   .   .   .   .   .',
  'purchase.manage': 'D   .   .   .   .   .',
  'purchase.approve': '.   .   .   .   .   .',
  'payables.pay': '.   .   .   .   .   .',
  // ADR-0045 § 4.1 : registre sous accès délégué pour le seul super-administrateur (pas
  // le support : données personnelles) ; `hr.sensitive.read`, sixième interdit absolu ;
  // demander et valider une absence refusés à tous, sans être des interdits absolus.
  'hr.read': 'D   .   .   .   .   .',
  'hr.manage': 'D   .   .   .   .   .',
  'hr.sensitive.read': '.   .   .   .   .   .',
  'leave.request': '.   .   .   .   .   .',
  'leave.approve': '.   .   .   .   .   .',
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
  it('déclare exactement les 10 rôles et les 38 actions de docs/12', () => {
    expect([...ORG_ROLES]).toEqual([...ORDRE_ORG]);
    expect(ACTIONS).toHaveLength(38);
    // Ajoutée en fin de liste, comme dans docs/12 (ADR-0021 §8).
    expect(ACTIONS[15]).toBe('fiscal.manage');
    // Dix-septième et dix-huitième, en fin de liste (ADR-0022 § S25c.1).
    expect(ACTIONS[16]).toBe('sales.read');
    expect(ACTIONS[17]).toBe('sales.manage');
    // Dix-neuvième, en fin de liste (ADR-0023 § S25e.11).
    expect(ACTIONS[18]).toBe('sales.invoice');
    // Vingtième, en fin de liste (ADR-0031 § 4).
    expect(ACTIONS[19]).toBe('sales.receipt');
    // Vingt et unième et vingt-deuxième, en fin de liste (ADR-0034 § 8, ordre de fusion).
    expect(ACTIONS[20]).toBe('treasury.read');
    expect(ACTIONS[21]).toBe('treasury.manage');
    // Vingt-troisième et vingt-quatrième, en fin de liste (ADR-0035 § 3, ordre de
    // fusion — amendement du 27 oct. 2026).
    expect(ACTIONS[22]).toBe('crm.read');
    expect(ACTIONS[23]).toBe('crm.manage');
    // Vingt-cinquième à vingt-septième, en fin de liste (ADR-0039 § 7).
    expect(ACTIONS[24]).toBe('work.read');
    expect(ACTIONS[25]).toBe('work.update');
    expect(ACTIONS[26]).toBe('work.manage');
    // Vingt-huitième, en fin de liste (ADR-0040 § 4.1).
    expect(ACTIONS[27]).toBe('sales.quote');
    // Vingt-neuvième à trente-troisième, en fin de liste (ADR-0044 § 4.1).
    expect(ACTIONS.slice(28, 33)).toEqual([
      'purchase.read',
      'purchase.request',
      'purchase.manage',
      'purchase.approve',
      'payables.pay',
    ]);
    // Trente-quatrième à trente-huitième, en fin de liste (ADR-0045 § 4.1).
    expect(ACTIONS.slice(33)).toEqual([
      'hr.read',
      'hr.manage',
      'hr.sensitive.read',
      'leave.request',
      'leave.approve',
    ]);
    expect(Object.keys(ATTENDU_ORG).sort()).toEqual([...ACTIONS].sort());
  });

  // 10 × 38 = 380 cases.
  for (const action of ACTIONS) {
    const attendus = cellules(ATTENDU_ORG[action]);
    it(`« ${action} » : les 10 cases correspondent à l'ADR`, () => {
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

// ADR-0041 — A1 : écart vide ⇒ effectif = ligne du rôle, sur les 380 cases organisation.
// Ce qui fonde « comportement strictement identique » tant qu'aucun écart n'est stocké.
describe('ADR-0041 — écart vide : les droits effectifs sont la ligne du rôle', () => {
  const VIDES: readonly OrgPermissionContext[] = [NO_OVERRIDES, {}, { grants: [], revokes: [] }];
  for (const role of ORDRE_ORG) {
    it(`« ${role} » : 38 cases identiques à la matrice, avec et sans droit de clôture`, () => {
      for (const canClosePeriods of [false, true]) {
        const attendu = ACTIONS.filter((a) => {
          const g = ORG_PERMISSION_MATRIX[role][a];
          return g === 'conditional' ? canClosePeriods : g !== 'deny';
        });
        for (const vide of VIDES) {
          const ctx = { ...vide, canClosePeriods };
          expect(effectiveActions(role, ctx), role).toEqual(attendu);
          for (const action of ACTIONS) {
            expect(can(role, action, ctx), `${role} × ${action}`).toBe(attendu.includes(action));
          }
        }
      }
    });
  }
});

describe('matrice rôle plateforme × action (ADR-0012 §4)', () => {
  it('déclare exactement les 6 rôles plateforme, tous préfixés `platform_`', () => {
    expect([...PLATFORM_ROLES]).toEqual([...ORDRE_PLATEFORME]);
    for (const role of PLATFORM_ROLES) expect(role.startsWith('platform_')).toBe(true);
  });

  // 6 × 38 = 228 cases.
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

describe('interdits absolus de la plateforme (ADR-0012 §4, ADR-0021 §8, ADR-0023 § S25e.11, ADR-0045 § 4.1)', () => {
  const interdits: Action[] = [
    'plan.approve',
    'period.close',
    'report.export',
    'fiscal.manage',
    'sales.invoice',
    'hr.sensitive.read',
  ];

  it('sont exactement ceux annoncés, au nombre de six', () => {
    expect(PLATFORM_FORBIDDEN_ACTIONS).toHaveLength(6);
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
    expect(can('accountant', 'period.close', NO_OVERRIDES)).toBe(false);
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
    const approbateurs = ORG_ROLES.filter((r) => can(r, 'plan.approve', NO_OVERRIDES));
    expect(approbateurs).toEqual(['owner', 'finance_director']);
  });

  it('`admin`, `analyst` et `project_manager` saisissent sans jamais approuver', () => {
    for (const role of ['admin', 'analyst', 'project_manager'] as const) {
      expect(can(role, 'inputs.update', NO_OVERRIDES), `${role} doit pouvoir saisir`).toBe(true);
      expect(can(role, 'plan.approve', NO_OVERRIDES), `${role} ne doit pas approuver`).toBe(false);
    }
  });

  it('le comptable constate mais ne projette pas', () => {
    expect(can('accountant', 'actuals.import', NO_OVERRIDES)).toBe(true);
    expect(can('accountant', 'inputs.update', NO_OVERRIDES)).toBe(false);
    expect(can('accountant', 'plan.calculate', NO_OVERRIDES)).toBe(false);
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
      expect(can(role, 'period.close', NO_OVERRIDES)).toBe(true);
      expect(can(role, 'plan.approve', NO_OVERRIDES)).toBe(true);
    }
  });

  it('un `admin` ne peut ni clôturer ni rouvrir', () => {
    expect(can('admin', 'period.close', NO_OVERRIDES)).toBe(false);
    expect(can('admin', 'plan.approve', NO_OVERRIDES)).toBe(false);
  });
});

describe('R4 — exports', () => {
  it("`advisor` et `viewer` n'ont pas `report.export`", () => {
    expect(can('advisor', 'report.export', NO_OVERRIDES)).toBe(false);
    expect(can('viewer', 'report.export', NO_OVERRIDES)).toBe(false);
  });

  it('`advisor` conserve la consultation en ligne', () => {
    expect(can('advisor', 'project.read', NO_OVERRIDES)).toBe(true);
    expect(can('advisor', 'analytics.read', NO_OVERRIDES)).toBe(true);
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
    for (const role of ['analyst', 'advisor', 'viewer', 'admin', 'sales_rep'] as const) {
      expect(canGrantRole('admin', role), `admin → ${role}`).toBe(true);
    }
  });

  it("un `viewer` ne peut attribuer que des rôles sans aucun droit d'écriture", () => {
    // L'ensemble d'actions d'`advisor` ({project.read, analytics.read}) est
    // contenu dans celui de `viewer` (qui y ajoute `sales.read`, ADR-0022, `crm.read`, ADR-0035, et `work.read`, ADR-0039) : la
    // règle du sous-ensemble laisse donc `viewer` « attribuer » `advisor`.
    // C'est sans conséquence — d'abord parce qu'aucun droit n'est gagné, ensuite
    // parce qu'un `viewer` n'a pas `members.invite` et que le guard le refuse
    // bien avant que R7 soit consulté. Ce que le test doit garantir, c'est
    // qu'aucune ÉCRITURE ne fuit par ce chemin.
    expect(grantableRoles('viewer').sort()).toEqual(['advisor', 'viewer']);
    for (const cible of grantableRoles('viewer')) {
      for (const action of ACTIONS) {
        // Les sept actions de lecture du Lecteur ; tout le reste est une écriture.
        // `leave.request` (ADR-0045 § 4.1) n'écrit que la demande du membre lui-même,
        // jamais une donnée de l'organisation.
        if (
          action === 'leave.request' ||
          action === 'purchase.read' ||
          action === 'project.read' ||
          action === 'analytics.read' ||
          action === 'sales.read' ||
          action === 'treasury.read' ||
          action === 'crm.read' ||
          action === 'work.read'
        ) {
          continue;
        }
        expect(can(cible, action, { canClosePeriods: true }), `${cible} × ${action}`).toBe(false);
      }
    }
    expect(can('viewer', 'members.invite', NO_OVERRIDES)).toBe(false);
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

  it('couvre les 10 rôles avec des rangs distincts', () => {
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

  it('les 10 slugs se normalisent en eux-mêmes', () => {
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
  it('chaque rôle déclare une décision pour CHACUNE des 38 actions', () => {
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
    for (const action of ecritures) expect(can('viewer', action, NO_OVERRIDES)).toBe(false);
  });

  it('`owner` détient les 38 actions', () => {
    for (const action of ACTIONS) expect(can('owner', action, NO_OVERRIDES)).toBe(true);
  });

  it('`billing.manage` est réservé au seul `owner`', () => {
    expect(ORG_ROLES.filter((r) => can(r, 'billing.manage', NO_OVERRIDES))).toEqual(['owner']);
  });

  it('`fiscal.manage` est réservé à `owner` et `finance_director` (ADR-0021 §8)', () => {
    expect(ORG_ROLES.filter((r) => can(r, 'fiscal.manage', NO_OVERRIDES))).toEqual([
      'owner',
      'finance_director',
    ]);
    // L'Administrateur gère l'organisation, pas son identité fiscale.
    expect(can('admin', 'organization.manage', NO_OVERRIDES)).toBe(true);
    expect(can('admin', 'fiscal.manage', NO_OVERRIDES)).toBe(false);
  });

  it('`fiscal.manage` ne donne pas de nouveau rôle attribuable à un `admin`', () => {
    // ADR-0021 §8 « conséquences vérifiées sur grantableRoles » : l'Administrateur
    // ne pouvait déjà pas attribuer `finance_director` (`plan.approve`).
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      'sales_rep',
      'viewer',
    ]);
  });

  it('`sales.manage` implique `sales.read` pour chaque rôle (ADR-0022 § S25c.1)', () => {
    // Gérer sans pouvoir consulter n'aurait aucun sens : l'écran de gestion lit
    // la liste avant d'écrire.
    for (const role of ORG_ROLES) {
      if (can(role, 'sales.manage', NO_OVERRIDES))
        expect(can(role, 'sales.read', NO_OVERRIDES), role).toBe(true);
    }
    for (const role of PLATFORM_ROLES) {
      if (PLATFORM_PERMISSION_MATRIX[role]['sales.manage'] !== 'forbidden') {
        expect(PLATFORM_PERMISSION_MATRIX[role]['sales.read'], role).not.toBe('forbidden');
      }
    }
  });

  it('`sales.read` et `sales.manage` ne changent pas les rôles attribuables (R7)', () => {
    // L'Administrateur détient les deux actions : il peut toujours attribuer
    // exactement les mêmes rôles qu'avant ADR-0022.
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      'sales_rep',
      'viewer',
    ]);
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('sales.read');
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('sales.manage');
  });

  it('`sales.invoice` implique `sales.manage` et ne change pas les rôles attribuables (ADR-0023)', () => {
    // Émettre suppose de pouvoir préparer le brouillon.
    for (const role of ORG_ROLES) {
      if (can(role, 'sales.invoice', NO_OVERRIDES))
        expect(can(role, 'sales.manage', NO_OVERRIDES), role).toBe(true);
    }
    // L'Administrateur ne l'a pas : il ne pouvait déjà attribuer ni `finance_director`
    // ni `accountant`, ses rôles attribuables sont inchangés.
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      'sales_rep',
      'viewer',
    ]);
  });

  it('`sales.receipt` implique `sales.read`, n’est pas un interdit absolu et ne change pas les rôles attribuables (ADR-0031)', () => {
    // Lettrer un encaissement suppose de lire les factures.
    for (const role of ORG_ROLES) {
      if (can(role, 'sales.receipt', NO_OVERRIDES))
        expect(can(role, 'sales.read', NO_OVERRIDES), role).toBe(true);
    }
    for (const role of PLATFORM_ROLES) expect(canPlatform(role, 'sales.receipt')).toBe(false);
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('sales.receipt');
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      'sales_rep',
      'viewer',
    ]);
  });

  it('`treasury.manage` implique `treasury.read` et ne change pas les rôles attribuables (ADR-0034)', () => {
    for (const role of ORG_ROLES) {
      if (can(role, 'treasury.manage', NO_OVERRIDES))
        expect(can(role, 'treasury.read', NO_OVERRIDES), role).toBe(true);
    }
    for (const role of PLATFORM_ROLES) {
      if (PLATFORM_PERMISSION_MATRIX[role]['treasury.manage'] !== 'forbidden') {
        expect(PLATFORM_PERMISSION_MATRIX[role]['treasury.read'], role).not.toBe('forbidden');
      }
    }
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('treasury.read');
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('treasury.manage');
    // L'Administrateur lit sans enregistrer : ses rôles attribuables sont inchangés,
    // le Lecteur aussi (il lit la trésorerie, le Conseiller non).
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      'sales_rep',
      'viewer',
    ]);
    expect(grantableRoles('viewer').sort()).toEqual(['advisor', 'viewer']);
  });

  it('`crm.manage` implique `crm.read` et ne change pas les rôles attribuables (ADR-0035)', () => {
    for (const role of ORG_ROLES) {
      if (can(role, 'crm.manage', NO_OVERRIDES))
        expect(can(role, 'crm.read', NO_OVERRIDES), role).toBe(true);
    }
    for (const role of PLATFORM_ROLES) {
      if (PLATFORM_PERMISSION_MATRIX[role]['crm.manage'] !== 'forbidden') {
        expect(PLATFORM_PERMISSION_MATRIX[role]['crm.read'], role).not.toBe('forbidden');
      }
    }
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      'sales_rep',
      'viewer',
    ]);
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('crm.read');
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('crm.manage');
  });

  it('`work.manage` ⇒ `work.update` ⇒ `work.read`, sans changer les rôles attribuables (ADR-0039)', () => {
    // Trois niveaux emboîtés : gouverner suppose de travailler, travailler suppose de lire.
    for (const role of ORG_ROLES) {
      if (can(role, 'work.manage', NO_OVERRIDES))
        expect(can(role, 'work.update', NO_OVERRIDES), role).toBe(true);
      if (can(role, 'work.update', NO_OVERRIDES))
        expect(can(role, 'work.read', NO_OVERRIDES), role).toBe(true);
    }
    for (const role of PLATFORM_ROLES) {
      const m = PLATFORM_PERMISSION_MATRIX[role];
      if (m['work.manage'] !== 'forbidden') expect(m['work.update'], role).not.toBe('forbidden');
      if (m['work.update'] !== 'forbidden') expect(m['work.read'], role).not.toBe('forbidden');
    }
    // Aucune n'est un interdit absolu (ADR-0039 § 7).
    for (const action of ['work.read', 'work.update', 'work.manage'] as const) {
      expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain(action);
    }
    // Le Chef de projet reste non attribuable et sans accès (décision ouverte n° 1).
    expect(can('project_manager', 'work.read', NO_OVERRIDES)).toBe(false);
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      'sales_rep',
      'viewer',
    ]);
    expect(grantableRoles('viewer').sort()).toEqual(['advisor', 'viewer']);
  });
});

describe('ADR-0040 § 4 — rôle Commercial et action `sales.quote`', () => {
  it('`sales.quote` : exactement les détenteurs de `sales.manage`, plus le Commercial', () => {
    const quote = ORG_ROLES.filter((r) => can(r, 'sales.quote', NO_OVERRIDES));
    const manage = ORG_ROLES.filter((r) => can(r, 'sales.manage', NO_OVERRIDES));
    expect(quote).toEqual([...manage, 'sales_rep']);
    // Préparer un devis suppose de lire les ventes.
    for (const role of quote) expect(can(role, 'sales.read', NO_OVERRIDES), role).toBe(true);
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('sales.quote');
    for (const role of PLATFORM_ROLES) {
      expect(PLATFORM_PERMISSION_MATRIX[role]['sales.quote'], role).toBe(
        PLATFORM_PERMISSION_MATRIX[role]['sales.manage'],
      );
    }
  });

  it('le Commercial détient huit actions sur trente-huit, et seulement celles-là', () => {
    expect(ACTIONS.filter((a) => can('sales_rep', a, { canClosePeriods: true }))).toEqual([
      'analytics.read',
      'sales.read',
      'crm.read',
      'crm.manage',
      'work.read',
      'work.update',
      'sales.quote',
      // ADR-0045 § 4.1 : demander une absence, comme tout rôle interne.
      'leave.request',
    ]);
  });

  it('le Commercial ne voit ni la trésorerie, ni le réalisé, ni n’émet ou n’encaisse (D3)', () => {
    for (const action of [
      'treasury.read',
      'treasury.manage',
      'project.read',
      'sales.manage',
      'sales.invoice',
      'sales.receipt',
      'work.manage',
      'members.invite',
    ] as const) {
      expect(can('sales_rep', action, NO_OVERRIDES), action).toBe(false);
    }
  });

  it('rang 5, entre l’Analyste et le Chef de projet ; libellé « Commercial »', () => {
    expect(ORG_ROLE_RANK.analyst).toBe(4);
    expect(ORG_ROLE_RANK.sales_rep).toBe(5);
    // ADR-0045 § 4.2 : le Responsable RH s'insère au rang 6 ; les suivants glissent.
    expect(ORG_ROLE_RANK.project_manager).toBe(7);
    expect(ORG_ROLE_RANK.advisor).toBe(8);
    expect(ORG_ROLE_RANK.viewer).toBe(9);
    expect(ORG_ROLE_LABELS.sales_rep).toBe('Commercial');
    expect(ORG_ROLE_DESCRIPTIONS.sales_rep.length).toBeGreaterThan(20);
  });

  it('attribuable : l’Administrateur l’invite, le Commercial n’attribue rien d’autre que lui-même', () => {
    expect(isAssignableRole('sales_rep')).toBe(true);
    expect(canGrantRole('owner', 'sales_rep')).toBe(true);
    expect(canGrantRole('admin', 'sales_rep')).toBe(true);
    // Le Comptable détient les huit actions mais n'a pas `members.invite` : le
    // guard le refuse avant R7 (critère d'acceptation n° 3, vérifié en e2e).
    expect(can('accountant', 'members.invite', NO_OVERRIDES)).toBe(false);
    expect(can('sales_rep', 'members.invite', NO_OVERRIDES)).toBe(false);
    expect(grantableRoles('viewer')).not.toContain('sales_rep');
  });

  it('`member` historique n’est pas un alias du Commercial', () => {
    expect(normalizeOrgRole('member')).toBe('finance_director');
    expect(normalizeOrgRole('sales_rep')).toBe('sales_rep');
  });
});

describe('ADR-0044 § 4 — achats et fournisseurs (lot P0)', () => {
  const ACHATS = [
    'purchase.read',
    'purchase.request',
    'purchase.manage',
    'purchase.approve',
    'payables.pay',
  ] as const;
  const detenteurs = (action: Action): OrgRole[] =>
    ORG_ROLES.filter((r) => can(r, action, NO_OVERRIDES));

  it('`purchase.read` suit `treasury.read`, sans le Commercial (D3)', () => {
    expect(detenteurs('purchase.read')).toEqual(
      detenteurs('treasury.read').filter((r) => r !== 'sales_rep'),
    );
    expect(detenteurs('purchase.read')).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
      'analyst',
      'viewer',
    ]);
  });

  it('demander : tout rôle interne qui travaille ; ni Lecteur, ni Commercial (décision n° 4)', () => {
    expect(detenteurs('purchase.request')).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
      'analyst',
    ]);
  });

  it('préparer suit `sales.manage` ; payer suit `treasury.manage`', () => {
    expect(detenteurs('purchase.manage')).toEqual(detenteurs('sales.manage'));
    expect(detenteurs('payables.pay')).toEqual(detenteurs('treasury.manage'));
  });

  it('approuver : Propriétaire et Directeur financier seulement, case ⓢ', () => {
    expect(detenteurs('purchase.approve')).toEqual(['owner', 'finance_director']);
    for (const role of ORG_ROLES) {
      const cell = ORG_PERMISSION_MATRIX[role]['purchase.approve'];
      expect(cell === 'deny' || cell === 'allow_sod', role).toBe(true);
    }
    // Le Comptable paie sans autoriser ; l'Administrateur prépare sans autoriser ni payer.
    expect(can('accountant', 'payables.pay', NO_OVERRIDES)).toBe(true);
    expect(can('accountant', 'purchase.approve', NO_OVERRIDES)).toBe(false);
    expect(can('admin', 'purchase.manage', NO_OVERRIDES)).toBe(true);
    expect(can('admin', 'purchase.approve', NO_OVERRIDES)).toBe(false);
    expect(can('admin', 'payables.pay', NO_OVERRIDES)).toBe(false);
  });

  it('chaque action d’approbation n’a que des cases ✗ ou ⓢ ; `APPROVER_ROLES` inchangé', () => {
    expect([...APPROVAL_ACTIONS]).toEqual(['plan.approve', 'purchase.approve', 'leave.approve']);
    for (const action of APPROVAL_ACTIONS) {
      for (const role of ORG_ROLES) {
        expect(['deny', 'allow_sod']).toContain(ORG_PERMISSION_MATRIX[role][action]);
      }
    }
    expect(APPROVER_ROLES).toEqual(['owner', 'finance_director']);
  });

  it('plateforme : aucune n’est un interdit absolu ; approuver et payer refusés à tous', () => {
    for (const action of ACHATS) expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain(action);
    for (const role of PLATFORM_ROLES) {
      for (const action of ['purchase.approve', 'payables.pay'] as const) {
        expect(canPlatform(role, action, { hasActiveGrant: true }), `${role} × ${action}`).toBe(
          false,
        );
      }
    }
    expect(canPlatform('platform_super_admin', 'purchase.manage', { hasActiveGrant: true })).toBe(
      true,
    );
    expect(canPlatform('platform_support', 'purchase.read', { hasActiveGrant: true })).toBe(true);
    expect(canPlatform('platform_support', 'purchase.read')).toBe(false);
  });

  it('aucun rôle nouveau, R7 inchangé : l’Administrateur attribue les mêmes rôles', () => {
    // ADR-0044 n'ajoute aucun rôle ; le dixième, `hr_manager`, vient d'ADR-0045.
    expect(ORG_ROLES.filter((r) => r !== 'hr_manager')).toHaveLength(9);
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      'sales_rep',
      'viewer',
    ]);
    expect(grantableRoles('viewer').sort()).toEqual(['advisor', 'viewer']);
    expect(canGrantRole('admin', 'accountant')).toBe(false);
    expect(canGrantRole('admin', 'finance_director')).toBe(false);
  });
});

describe('ADR-0044 § 2.3 — `purchaseApprovalDecision` (séparation des tâches des achats)', () => {
  const base: PurchaseApprovalInput = {
    decision: 'approve',
    approverUserId: 'dir',
    requestedBy: 'ana',
    createdBy: 'ana',
    priorApproverUserIds: [],
    requiredApprovals: 1,
    approverCountInOrg: 2,
    allowSoleApprover: true,
  };
  const decide = (over: Partial<PurchaseApprovalInput>) =>
    purchaseApprovalDecision({ ...base, ...over });

  it('approbateur distinct du demandeur : approuvé, palier 1 atteint', () => {
    expect(decide({})).toEqual({
      ok: true,
      soleApprover: false,
      effectiveRequired: 1,
      complete: true,
    });
  });

  it('critère 2 — le demandeur n’approuve pas sa demande quand d’autres approbateurs existent', () => {
    expect(decide({ approverUserId: 'ana' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    // Ni le créateur quand il diffère du demandeur.
    expect(decide({ approverUserId: 'pro', createdBy: 'pro' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    // Le refus suit la même règle d’éligibilité.
    expect(decide({ decision: 'reject', approverUserId: 'ana' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('critère 2 — palier 2 : deux personnes distinctes ; la même n’approuve pas deux fois', () => {
    const premiere = decide({ requiredApprovals: 2 });
    expect(premiere).toEqual({
      ok: true,
      soleApprover: false,
      effectiveRequired: 2,
      complete: false,
    });
    expect(decide({ requiredApprovals: 2, priorApproverUserIds: ['dir'] })).toEqual({
      ok: false,
      code: 'APPROVER_ALREADY_APPROVED',
    });
    expect(
      decide({ requiredApprovals: 2, approverUserId: 'pro', priorApproverUserIds: ['dir'] }),
    ).toEqual({ ok: true, soleApprover: false, effectiveRequired: 2, complete: true });
  });

  it('critère 2 — approbateur unique : il approuve sa demande, marquée, palier réduit à 1', () => {
    expect(
      decide({
        approverUserId: 'pro',
        requestedBy: 'pro',
        createdBy: 'pro',
        approverCountInOrg: 1,
        requiredApprovals: 2,
      }),
    ).toEqual({ ok: true, soleApprover: true, effectiveRequired: 1, complete: true });
    // Demande d’autrui, palier 1 : rien d’exceptionnel, pas de marque.
    expect(decide({ approverCountInOrg: 1 })).toEqual({
      ok: true,
      soleApprover: false,
      effectiveRequired: 1,
      complete: true,
    });
    // Demande d’autrui, palier 2 réduit : l’échappatoire sert, le geste est marqué.
    expect(decide({ approverCountInOrg: 1, requiredApprovals: 2 })).toEqual({
      ok: true,
      soleApprover: true,
      effectiveRequired: 1,
      complete: true,
    });
  });

  it('`allowSoleApprover: false` ferme l’échappatoire, même seul', () => {
    expect(
      decide({ approverUserId: 'ana', approverCountInOrg: 1, allowSoleApprover: false }),
    ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
    expect(
      decide({ approverCountInOrg: 1, allowSoleApprover: false, requiredApprovals: 2 }),
    ).toMatchObject({ ok: true, effectiveRequired: 2, complete: false, soleApprover: false });
  });

  it('un refus recevable ne complète jamais la demande', () => {
    expect(
      decide({ decision: 'reject', requiredApprovals: 2, priorApproverUserIds: ['pro'] }),
    ).toEqual({ ok: true, soleApprover: false, effectiveRequired: 2, complete: false });
    expect(
      decide({ decision: 'reject', approverUserId: 'ana', approverCountInOrg: 1 }),
    ).toMatchObject({ ok: true, soleApprover: true, complete: false });
  });

  it('ne lit aucun rôle : seul le nombre de détenteurs effectifs décide de l’échappatoire', () => {
    // Deux détenteurs effectifs (par exemple un Lecteur ayant reçu l’autorisation) :
    // le Propriétaire seul de son titre ne s’auto-approuve plus.
    expect(
      decide({
        approverUserId: 'pro',
        requestedBy: 'pro',
        createdBy: 'pro',
        approverCountInOrg: 2,
      }),
    ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
  });
});

describe('ADR-0045 § 4 — ressources humaines et rôle Responsable RH (lot H0)', () => {
  const RH = [
    'hr.read',
    'hr.manage',
    'hr.sensitive.read',
    'leave.request',
    'leave.approve',
  ] as const;
  const detenteurs = (action: Action): OrgRole[] =>
    ORG_ROLES.filter((r) => can(r, action, NO_OVERRIDES));

  it('registre : Propriétaire, Administrateur, Directeur financier, Responsable RH', () => {
    for (const action of ['hr.read', 'hr.manage'] as const) {
      expect(detenteurs(action), action).toEqual([
        'owner',
        'admin',
        'finance_director',
        'hr_manager',
      ]);
    }
  });

  it('données sensibles : ni Administrateur ni Comptable (décision ouverte n° 3)', () => {
    expect(detenteurs('hr.sensitive.read')).toEqual(['owner', 'finance_director', 'hr_manager']);
  });

  it('demander une absence : tout rôle interne, ni Conseiller ni Chef de projet', () => {
    expect(detenteurs('leave.request')).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
      'analyst',
      'viewer',
      'sales_rep',
      'hr_manager',
    ]);
  });

  it('valider : autorité RH en case ⓢ ; l’Administrateur ne valide pas', () => {
    expect(detenteurs('leave.approve')).toEqual(['owner', 'finance_director', 'hr_manager']);
    for (const role of ORG_ROLES) {
      expect(['deny', 'allow_sod']).toContain(ORG_PERMISSION_MATRIX[role]['leave.approve']);
    }
    expect(APPROVAL_ACTIONS).toContain('leave.approve');
    // `APPROVER_ROLES` reste celui des plans.
    expect(APPROVER_ROLES).toEqual(['owner', 'finance_director']);
  });

  it('le Responsable RH détient huit actions sur trente-huit, et seulement celles-là', () => {
    expect(ACTIONS.filter((a) => can('hr_manager', a, { canClosePeriods: true }))).toEqual([
      'analytics.read',
      'work.read',
      'work.update',
      'hr.read',
      'hr.manage',
      'hr.sensitive.read',
      'leave.request',
      'leave.approve',
    ]);
    // Disjoint de la finance et de la gouvernance (O6).
    for (const action of [
      'organization.manage',
      'members.invite',
      'treasury.read',
      'sales.read',
      'purchase.read',
      'crm.read',
      'project.read',
      'report.export',
      'audit.read',
    ] as const) {
      expect(can('hr_manager', action, NO_OVERRIDES), action).toBe(false);
    }
  });

  it('rang 6, après le Commercial ; libellé et description du § 4.2', () => {
    expect(ORG_ROLE_RANK.sales_rep).toBe(5);
    expect(ORG_ROLE_RANK.hr_manager).toBe(6);
    expect(ORG_ROLE_RANK.project_manager).toBe(7);
    expect(ORG_ROLE_LABELS.hr_manager).toBe('Responsable RH');
    expect(ORG_ROLE_DESCRIPTIONS.hr_manager).toBe(
      'Dossiers du personnel, absences et documents RH. Ne voit ni la trésorerie, ni les ventes, ni les achats.',
    );
    expect(normalizeOrgRole('hr_manager')).toBe('hr_manager');
    expect(isOwnerRole('hr_manager')).toBe(false);
  });

  it('R7 — attribuable par le seul Propriétaire (critère 2, décision ouverte n° 2)', () => {
    expect(isAssignableRole('hr_manager')).toBe(true);
    expect(OWNER_ONLY_ROLES).toEqual(['hr_manager']);
    for (const role of ORG_ROLES) {
      expect(canGrantRole(role, 'hr_manager'), `${role} → hr_manager`).toBe(role === 'owner');
    }
    // Même un acteur qui réunirait les huit actions par ajouts ne l'attribue pas.
    const toutAjoute: OrgPermissionContext = {
      grants: ACTIONS.filter(
        (a) => ORG_PERMISSION_MATRIX.admin[a] === 'deny' && a !== 'billing.manage',
      ),
    };
    expect(grantableRoles('admin', toutAjoute)).not.toContain('hr_manager');
    expect(grantableRoles('admin', toutAjoute)).toContain('finance_director');
    // L'Administrateur attribue les mêmes rôles qu'avant.
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      'sales_rep',
      'viewer',
    ]);
    expect(grantableRoles('owner')).toContain('hr_manager');
  });

  it('plateforme : registre délégué au seul super-administrateur ; sensibles interdites absolument', () => {
    expect(canPlatform('platform_super_admin', 'hr.read', { hasActiveGrant: true })).toBe(true);
    expect(canPlatform('platform_super_admin', 'hr.manage', { hasActiveGrant: true })).toBe(true);
    expect(canPlatform('platform_super_admin', 'hr.read')).toBe(false);
    expect(canPlatform('platform_support', 'hr.read', { hasActiveGrant: true })).toBe(false);
    for (const role of PLATFORM_ROLES) {
      for (const action of ['hr.sensitive.read', 'leave.request', 'leave.approve'] as const) {
        expect(canPlatform(role, action, { hasActiveGrant: true }), `${role} × ${action}`).toBe(
          false,
        );
      }
    }
    expect(PLATFORM_FORBIDDEN_ACTIONS).toContain('hr.sensitive.read');
    for (const action of RH.filter((a) => a !== 'hr.sensitive.read')) {
      expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain(action);
    }
  });
});

describe('ADR-0045 § 4.3 — `leaveApprovalDecision` (séparation des tâches des absences)', () => {
  // A manager de B ; RH détient `leave.approve` ; C n'est ni l'un ni l'autre.
  const base: LeaveApprovalInput = {
    decision: 'approve',
    approverUserId: 'A',
    beneficiaryUserId: 'B',
    step: 'manager',
    isDesignatedManager: true,
    holdsLeaveApprove: false,
    priorApproverUserIds: [],
    approverCountInOrg: 2,
    allowSoleApprover: true,
  };
  const decide = (over: Partial<LeaveApprovalInput>) => leaveApprovalDecision({ ...base, ...over });

  it('critère 9 — le manager désigné valide l’étape manager', () => {
    expect(decide({})).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: false });
  });

  it('critère 9 — B ne valide pas sa propre demande, à aucune étape', () => {
    for (const step of ['manager', 'hr'] as const) {
      expect(
        decide({ approverUserId: 'B', step, isDesignatedManager: false, holdsLeaveApprove: true }),
      ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
    }
    expect(decide({ decision: 'reject', approverUserId: 'B' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('critère 9 — C, ni manager ni détenteur : 403 LEAVE_NOT_YOUR_STEP', () => {
    for (const step of ['manager', 'hr'] as const) {
      expect(decide({ approverUserId: 'C', step, isDesignatedManager: false })).toEqual({
        ok: false,
        code: 'LEAVE_NOT_YOUR_STEP',
      });
    }
    // Le manager désigné ne tient pas l'étape RH sans `leave.approve`.
    expect(decide({ step: 'hr' })).toEqual({ ok: false, code: 'LEAVE_NOT_YOUR_STEP' });
  });

  it('suppléance : un détenteur de `leave.approve` tient l’étape manager, marquée', () => {
    expect(
      decide({ approverUserId: 'RH', isDesignatedManager: false, holdsLeaveApprove: true }),
    ).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: true });
  });

  it('critère 9 — deux étapes, deux personnes', () => {
    // A, manager ET détenteur, a validé l'étape manager : il ne tient pas l'étape RH.
    expect(decide({ step: 'hr', holdsLeaveApprove: true, priorApproverUserIds: ['A'] })).toEqual({
      ok: false,
      code: 'APPROVER_ALREADY_APPROVED',
    });
    expect(
      decide({
        approverUserId: 'RH',
        step: 'hr',
        isDesignatedManager: false,
        holdsLeaveApprove: true,
        priorApproverUserIds: ['A'],
      }),
    ).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: false });
    // Un refus clôt la demande à toute étape, même par qui a validé l'étape précédente.
    expect(
      decide({
        decision: 'reject',
        step: 'hr',
        holdsLeaveApprove: true,
        priorApproverUserIds: ['A'],
      }),
    ).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: false });
  });

  it('critère 9 — approbateur unique : la Propriétaire valide sa propre absence, marquée', () => {
    const seule = {
      approverUserId: 'PRO',
      beneficiaryUserId: 'PRO',
      step: 'hr' as const,
      isDesignatedManager: false,
      holdsLeaveApprove: true,
      approverCountInOrg: 1,
    };
    expect(decide(seule)).toEqual({ ok: true, soleApprover: true, onBehalfOfManager: false });
    // Et l'étape RH qu'elle a déjà tenue comme manager d'autrui.
    expect(decide({ ...seule, beneficiaryUserId: 'B', priorApproverUserIds: ['PRO'] })).toEqual({
      ok: true,
      soleApprover: true,
      onBehalfOfManager: false,
    });
    // Une décision ordinaire n'est pas marquée.
    expect(decide({ ...seule, beneficiaryUserId: 'B' })).toEqual({
      ok: true,
      soleApprover: false,
      onBehalfOfManager: false,
    });
  });

  it('l’échappatoire exige le réglage, un seul détenteur, et que ce soit lui', () => {
    const soi = {
      approverUserId: 'PRO',
      beneficiaryUserId: 'PRO',
      step: 'hr' as const,
      isDesignatedManager: false,
      holdsLeaveApprove: true,
    };
    expect(decide({ ...soi, approverCountInOrg: 1, allowSoleApprover: false })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    expect(decide({ ...soi, approverCountInOrg: 2 })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    expect(decide({ ...soi, approverCountInOrg: 1, holdsLeaveApprove: false })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('un collaborateur sans compte n’est le « soi » de personne', () => {
    expect(
      decide({
        approverUserId: 'RH',
        beneficiaryUserId: null,
        step: 'hr',
        isDesignatedManager: false,
        holdsLeaveApprove: true,
      }),
    ).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: false });
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
      'sales_rep',
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
