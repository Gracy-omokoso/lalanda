// ─────────────────────────────────────────────────────────────────────────────
// SOURCE DE VÉRITÉ DES PERMISSIONS
// docs/12-ROLES-PERMISSIONS.md · ADR-0012 (Accepted, 2026-08-08)
//
// Ce fichier — et lui seul — décide « qui a le droit de faire quoi ». ADR-0012 §8 :
// « Aucun `if (role === …)` hors de `permissions.ts` ». Les guards, les contrôleurs
// et l'interface consomment `can()` / `canPlatform()`.
//
// Trois ensembles fermés (docs/26 « états représentés par unions fermées ») :
//   1. ORG_ROLES       — les 8 rôles d'organisation (ADR-0012 §1);
//   2. PLATFORM_ROLES  — les 6 rôles plateforme, préfixés `platform_` (§2);
//   3. ACTIONS         — les 15 actions granulaires, dans l'ordre de docs/12.
//
// Refus par défaut (docs/17 § Autorisation) : les matrices sont exhaustives, une
// case absente ne compile pas, et une case `deny` est un refus.
//
// Note d'implémentation — emplacement. ADR-0012 §8 situe ce fichier dans
// `apps/api/src/auth/`. Il vit dans `apps/api/src/authz/` : `auth/` porte
// l'AUTHENTIFICATION (better-auth, session, organisation active) et `authz/`
// l'AUTORISATION. Les deux répertoires appartiennent au même propriétaire
// (ADR-0012 §9, « Dev RBAC »), la frontière d'écriture est donc inchangée.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les 8 rôles d'organisation (ADR-0012 §1).
 *
 * Slugs en anglais `snake_case` (docs/26 « noms de code en anglais »). `owner`
 * conserve la valeur de l'ancien modèle : la migration S20a n'a donc aucun
 * document `owner` à réécrire, seulement `member`.
 */
export const ORG_ROLES = [
  'owner',
  'admin',
  'finance_director',
  'accountant',
  'analyst',
  'project_manager',
  'advisor',
  'viewer',
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

/**
 * Rang de privilège explicite — `owner` = 0 (le plus privilégié).
 *
 * Existe pour une raison précise (ADR-0012 §7, « piège découvert ») :
 * `organizations.service.ts` sélectionnait l'organisation primaire avec un
 * `.sort({ role: -1 })` qui reposait sur l'ordre ALPHABÉTIQUE des deux anciennes
 * valeurs (`'owner' > 'member'`). Avec huit slugs cette astuce se retourne :
 * `'viewer' > 'project_manager' > 'owner'`. Un utilisateur propriétaire d'une org
 * et lecteur d'une autre basculait silencieusement sur la mauvaise. Le rang est
 * désormais une donnée, pas un accident de tri.
 *
 * Ne PAS dériver ce rang de la matrice : deux rôles peuvent avoir des ensembles
 * d'actions incomparables (un `accountant` n'est ni au-dessus ni en dessous d'un
 * `analyst`). Le rang est un ordre total arbitraire mais stable, utilisé
 * uniquement pour choisir une organisation par défaut et trier un affichage.
 */
export const ORG_ROLE_RANK: Readonly<Record<OrgRole, number>> = {
  owner: 0,
  admin: 1,
  finance_director: 2,
  accountant: 3,
  analyst: 4,
  project_manager: 5,
  advisor: 6,
  viewer: 7,
};

/**
 * Les 6 rôles plateforme (ADR-0012 §2). Le préfixe `platform_` est OBLIGATOIRE :
 * les deux espaces de noms cohabitent dans le même code, la collision doit être
 * impossible à écrire.
 */
export const PLATFORM_ROLES = [
  'platform_super_admin',
  'platform_admin',
  'platform_support',
  'platform_billing',
  'platform_template_editor',
  'platform_country_pack_manager',
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** Les 15 actions granulaires (docs/12 § Actions granulaires, ordre du document). */
export const ACTIONS = [
  'organization.manage',
  'billing.manage',
  'members.invite',
  'project.create',
  'project.read',
  'project.update',
  'canvas.update',
  'inputs.update',
  'plan.calculate',
  'plan.approve',
  'actuals.import',
  'period.close',
  'analytics.read',
  'report.export',
  'audit.read',
] as const;

export type Action = (typeof ACTIONS)[number];

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);
}

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Matrice organisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nature d'une case de la matrice organisation. Reprend la légende d'ADR-0012 §3
 * au lieu d'un simple booléen : les annotations ⚙ / P / ⓢ portent des règles
 * métier qu'un `true` écraserait silencieusement.
 *
 * - `allow`         (✓) — autorisé sans condition.
 * - `deny`          (✗) — refusé. Aucun contournement, même plateforme.
 * - `allow_sod`     (✓ⓢ) — autorisé, mais soumis à la séparation des tâches :
 *                    l'approbateur ne peut pas être le dernier auteur des entrées
 *                    (R2). Le guard laisse passer; le service applique la règle,
 *                    car elle dépend de la RESSOURCE, pas du seul rôle.
 * - `allow_project` (✓P) — autorisé, mais restreint aux projets assignés. Les
 *                    assignations (`project_assignments`) n'existent pas encore :
 *                    non implémenté, et c'est pourquoi `project_manager` n'est pas
 *                    attribuable (voir `ROLE_NOT_ASSIGNABLE`). Se comporte comme
 *                    `allow` pour tout rôle qui l'obtiendrait malgré tout.
 * - `conditional`   (⚙) — exige un droit explicite porté par le membership,
 *                    `false` par défaut. Seule occurrence : `accountant` +
 *                    `period.close` (docs/12 « clôture selon permission »).
 */
export type OrgGrant = 'allow' | 'deny' | 'allow_sod' | 'allow_project' | 'conditional';

/**
 * MATRICE RÔLE ORGANISATION × ACTION — transcription littérale d'ADR-0012 §3.
 *
 * Le type impose 8 rôles × 15 actions : oublier une case ne compile pas.
 * `permissions.test.ts` redéclare cette matrice en littéral (elle n'est PAS
 * importée d'ici) : toute modification de production casse le test et force une
 * mise à jour consciente de l'ADR et de docs/12. C'est le garde-fou central.
 */
export const ORG_PERMISSION_MATRIX: Readonly<Record<OrgRole, Readonly<Record<Action, OrgGrant>>>> =
  {
    // Propriétaire — « abonnement, membres, suppression et transfert » (docs/12).
    // Seul rôle à détenir `billing.manage`. Détient aussi `inputs.update` ET
    // `plan.approve` : c'est ce qui rend l'organisation solo (entrepreneur seul,
    // cas majoritaire en RDC) utilisable — voir `soleApprover` dans les plans.
    owner: {
      'organization.manage': 'allow',
      'billing.manage': 'allow',
      'members.invite': 'allow',
      'project.create': 'allow',
      'project.read': 'allow',
      'project.update': 'allow',
      'canvas.update': 'allow',
      'inputs.update': 'allow',
      'plan.calculate': 'allow',
      'plan.approve': 'allow_sod',
      'actuals.import': 'allow',
      'period.close': 'allow',
      'analytics.read': 'allow',
      'report.export': 'allow',
      'audit.read': 'allow',
    },
    // Administrateur — « membres, projets, paramètres ». Gouvernance technique,
    // pas autorité financière : ni `billing.manage`, ni `plan.approve`, ni
    // `period.close` (ADR-0012 §3, justifications).
    admin: {
      'organization.manage': 'allow',
      'billing.manage': 'deny',
      'members.invite': 'allow',
      'project.create': 'allow',
      'project.read': 'allow',
      'project.update': 'allow',
      'canvas.update': 'allow',
      'inputs.update': 'allow',
      'plan.calculate': 'allow',
      'plan.approve': 'deny',
      'actuals.import': 'allow',
      'period.close': 'deny',
      'analytics.read': 'allow',
      'report.export': 'allow',
      'audit.read': 'allow',
    },
    // Directeur financier — « plans, validation, réalisé, rapports ». L'autorité
    // financière : approuve et clôture. Cible de la migration des anciens `member`
    // (iso-privilège, ADR-0012 §7).
    finance_director: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'allow',
      'project.read': 'allow',
      'project.update': 'allow',
      'canvas.update': 'allow',
      'inputs.update': 'allow',
      'plan.calculate': 'allow',
      'plan.approve': 'allow_sod',
      'actuals.import': 'allow',
      'period.close': 'allow',
      'analytics.read': 'allow',
      'report.export': 'allow',
      'audit.read': 'allow',
    },
    // Comptable — « réalisé, mapping, clôture selon permission ». Constate, ne
    // projette pas : ni `inputs.update`, ni `plan.calculate`. Contrepartie de R2.
    accountant: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'deny',
      'project.read': 'allow',
      'project.update': 'deny',
      'canvas.update': 'deny',
      'inputs.update': 'deny',
      'plan.calculate': 'deny',
      'plan.approve': 'deny',
      'actuals.import': 'allow',
      'period.close': 'conditional',
      'analytics.read': 'allow',
      'report.export': 'allow',
      'audit.read': 'deny',
    },
    // Analyste — « scénarios, analyses, commentaires ». Modélise et calcule,
    // n'approuve ni n'importe le réalisé.
    analyst: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'deny',
      'project.read': 'allow',
      'project.update': 'deny',
      'canvas.update': 'allow',
      'inputs.update': 'allow',
      'plan.calculate': 'allow',
      'plan.approve': 'deny',
      'actuals.import': 'deny',
      'period.close': 'deny',
      'analytics.read': 'allow',
      'report.export': 'allow',
      'audit.read': 'deny',
    },
    // Chef de projet — « projets autorisés et saisie ». Tout est `allow_project` :
    // le rôle n'a de sens qu'avec des assignations de projet, qui n'existent pas
    // encore — il est donc NON ATTRIBUABLE en S20a (`ROLE_NOT_ASSIGNABLE`).
    project_manager: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'deny',
      'project.read': 'allow_project',
      'project.update': 'allow_project',
      'canvas.update': 'allow_project',
      'inputs.update': 'allow_project',
      'plan.calculate': 'allow_project',
      'plan.approve': 'deny',
      'actuals.import': 'deny',
      'period.close': 'deny',
      'analytics.read': 'allow_project',
      'report.export': 'allow_project',
      'audit.read': 'deny',
    },
    // Conseiller — « consultation, commentaires, recommandations ». Typiquement
    // EXTERNE (mentor, banquier invité) : pas de `report.export`, on lui ouvre la
    // consultation en ligne, pas l'exfiltration de fichier (docs/17).
    advisor: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'deny',
      'project.read': 'allow',
      'project.update': 'deny',
      'canvas.update': 'deny',
      'inputs.update': 'deny',
      'plan.calculate': 'deny',
      'plan.approve': 'deny',
      'actuals.import': 'deny',
      'period.close': 'deny',
      'analytics.read': 'allow',
      'report.export': 'deny',
      'audit.read': 'deny',
    },
    // Lecteur — lecture seulement. `analytics.read` est conservé : le refuser
    // viderait le rôle de son sens (ADR-0012 §3).
    viewer: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'deny',
      'project.read': 'allow',
      'project.update': 'deny',
      'canvas.update': 'deny',
      'inputs.update': 'deny',
      'plan.calculate': 'deny',
      'plan.approve': 'deny',
      'actuals.import': 'deny',
      'period.close': 'deny',
      'analytics.read': 'allow',
      'report.export': 'deny',
      'audit.read': 'deny',
    },
  };

// ─────────────────────────────────────────────────────────────────────────────
// Matrice plateforme
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nature d'une case de la matrice plateforme (ADR-0012 §4).
 *
 * - `native`    (✓)  — droit propre au rôle, portée plateforme.
 * - `delegated` (⚙D) — possible UNIQUEMENT sous un accès délégué actif
 *                (`support_grants`), avec consentement d'un propriétaire pour les
 *                données financières. Sans grant : refus.
 * - `forbidden` (✗)  — interdit, y compris au super-administrateur, y compris
 *                sous accès délégué.
 */
export type PlatformGrant = 'native' | 'delegated' | 'forbidden';

/**
 * MATRICE RÔLE PLATEFORME × ACTION — transcription littérale d'ADR-0012 §4.
 *
 * Principe : un rôle plateforme n'a AUCUN droit implicite sur les données d'une
 * organisation cliente. Tout ce qui touche au contenu d'un projet est `delegated`.
 */
export const PLATFORM_PERMISSION_MATRIX: Readonly<
  Record<PlatformRole, Readonly<Record<Action, PlatformGrant>>>
> = {
  platform_super_admin: {
    'organization.manage': 'native',
    'billing.manage': 'native',
    'members.invite': 'native',
    'project.create': 'delegated',
    'project.read': 'delegated',
    'project.update': 'delegated',
    'canvas.update': 'delegated',
    'inputs.update': 'delegated',
    'plan.calculate': 'delegated',
    'plan.approve': 'forbidden',
    'actuals.import': 'delegated',
    'period.close': 'forbidden',
    'analytics.read': 'delegated',
    'report.export': 'forbidden',
    'audit.read': 'native',
  },
  platform_admin: {
    'organization.manage': 'native',
    'billing.manage': 'forbidden',
    'members.invite': 'native',
    'project.create': 'forbidden',
    'project.read': 'delegated',
    'project.update': 'forbidden',
    'canvas.update': 'forbidden',
    'inputs.update': 'forbidden',
    'plan.calculate': 'forbidden',
    'plan.approve': 'forbidden',
    'actuals.import': 'forbidden',
    'period.close': 'forbidden',
    'analytics.read': 'forbidden',
    'report.export': 'forbidden',
    'audit.read': 'native',
  },
  // « Le support ne voit jamais les données financières sans consentement
  // explicite, durée limitée et audit » (docs/12) — d'où trois `delegated` et
  // aucun `native` sur le contenu client.
  platform_support: {
    'organization.manage': 'forbidden',
    'billing.manage': 'forbidden',
    'members.invite': 'forbidden',
    'project.create': 'forbidden',
    'project.read': 'delegated',
    'project.update': 'forbidden',
    'canvas.update': 'forbidden',
    'inputs.update': 'forbidden',
    'plan.calculate': 'forbidden',
    'plan.approve': 'forbidden',
    'actuals.import': 'forbidden',
    'period.close': 'forbidden',
    'analytics.read': 'delegated',
    'report.export': 'forbidden',
    'audit.read': 'delegated',
  },
  platform_billing: {
    'organization.manage': 'forbidden',
    'billing.manage': 'native',
    'members.invite': 'forbidden',
    'project.create': 'forbidden',
    'project.read': 'forbidden',
    'project.update': 'forbidden',
    'canvas.update': 'forbidden',
    'inputs.update': 'forbidden',
    'plan.calculate': 'forbidden',
    'plan.approve': 'forbidden',
    'actuals.import': 'forbidden',
    'period.close': 'forbidden',
    'analytics.read': 'forbidden',
    'report.export': 'forbidden',
    'audit.read': 'forbidden',
  },
  // Vides sur cette matrice : opèrent sur des ressources de portée plateforme
  // (templates, Country Packs) qui n'ont pas d'action granulaire dans docs/12 —
  // lacune n°2 d'ADR-0012, à arbitrer.
  platform_template_editor: {
    'organization.manage': 'forbidden',
    'billing.manage': 'forbidden',
    'members.invite': 'forbidden',
    'project.create': 'forbidden',
    'project.read': 'forbidden',
    'project.update': 'forbidden',
    'canvas.update': 'forbidden',
    'inputs.update': 'forbidden',
    'plan.calculate': 'forbidden',
    'plan.approve': 'forbidden',
    'actuals.import': 'forbidden',
    'period.close': 'forbidden',
    'analytics.read': 'forbidden',
    'report.export': 'forbidden',
    'audit.read': 'forbidden',
  },
  platform_country_pack_manager: {
    'organization.manage': 'forbidden',
    'billing.manage': 'forbidden',
    'members.invite': 'forbidden',
    'project.create': 'forbidden',
    'project.read': 'forbidden',
    'project.update': 'forbidden',
    'canvas.update': 'forbidden',
    'inputs.update': 'forbidden',
    'plan.calculate': 'forbidden',
    'plan.approve': 'forbidden',
    'actuals.import': 'forbidden',
    'period.close': 'forbidden',
    'analytics.read': 'forbidden',
    'report.export': 'forbidden',
    'audit.read': 'forbidden',
  },
};

/**
 * Les trois interdits absolus de la plateforme (ADR-0012 §4).
 *
 * Aucun rôle plateforme, super-administrateur compris, et aucun accès délégué ne
 * peut approuver un plan, clôturer une période ou exporter un rapport client.
 * Approuver et clôturer engagent le client vis-à-vis de sa banque; exporter
 * produit un fichier de ses données financières.
 *
 * Cette constante n'est pas décorative : `canPlatform()` la vérifie AVANT la
 * matrice, et un test s'assure qu'aucune case de la matrice ne la contredit.
 */
export const PLATFORM_FORBIDDEN_ACTIONS: readonly Action[] = [
  'plan.approve',
  'period.close',
  'report.export',
];

// ─────────────────────────────────────────────────────────────────────────────
// Décision
// ─────────────────────────────────────────────────────────────────────────────

/** Conditions dépendant du membership, pas du seul rôle (cases ⚙). */
export interface OrgPermissionContext {
  /**
   * Droit explicite `canClosePeriods` porté par le membership. Seul droit
   * conditionnel du modèle (docs/12 « clôture selon permission »), `false` par
   * défaut, accordable par un `owner` ou un `admin`.
   */
  canClosePeriods?: boolean;
}

/**
 * Autorisation atomique d'un rôle d'organisation — l'unique lecture légitime de
 * la matrice organisation.
 *
 * `allow_sod` et `allow_project` renvoient `true` : ce sont des autorisations, et
 * leurs restrictions (séparation des tâches, projets assignés) dépendent de la
 * RESSOURCE visée, que ce module ne connaît pas. Elles sont appliquées par les
 * services concernés — voir `sodDecision()`.
 */
export function can(role: OrgRole, action: Action, ctx: OrgPermissionContext = {}): boolean {
  switch (ORG_PERMISSION_MATRIX[role][action]) {
    case 'allow':
    case 'allow_sod':
    case 'allow_project':
      return true;
    case 'conditional':
      return ctx.canClosePeriods === true;
    case 'deny':
      return false;
  }
}

/** Autorisation conjonctive : toutes les actions demandées doivent être détenues. */
export function canAll(
  role: OrgRole,
  actions: readonly Action[],
  ctx: OrgPermissionContext = {},
): boolean {
  return actions.every((a) => can(role, a, ctx));
}

/** Première action refusée — renseigne `action` dans la réponse 403. */
export function firstDeniedAction(
  role: OrgRole,
  actions: readonly Action[],
  ctx: OrgPermissionContext = {},
): Action | undefined {
  return actions.find((a) => !can(role, a, ctx));
}

/** Actions effectivement détenues — exposé à l'UI pour masquer ce qui serait refusé. */
export function actionsOf(role: OrgRole, ctx: OrgPermissionContext = {}): Action[] {
  return ACTIONS.filter((a) => can(role, a, ctx));
}

/** Contexte d'un principal plateforme sur une organisation cible. */
export interface PlatformPermissionContext {
  /** Un `support_grants` actif (non expiré, non révoqué) couvre-t-il cette requête ? */
  hasActiveGrant?: boolean;
}

/**
 * Autorisation d'un rôle plateforme. Les trois interdits absolus sont vérifiés
 * en premier : aucune case de matrice ni aucun grant ne peut les lever.
 */
export function canPlatform(
  role: PlatformRole,
  action: Action,
  ctx: PlatformPermissionContext = {},
): boolean {
  if (PLATFORM_FORBIDDEN_ACTIONS.includes(action)) return false;
  switch (PLATFORM_PERMISSION_MATRIX[role][action]) {
    case 'native':
      return true;
    case 'delegated':
      return ctx.hasActiveGrant === true;
    case 'forbidden':
      return false;
  }
}

/** Un utilisateur peut détenir plusieurs rôles plateforme : l'un suffit. */
export function canAnyPlatform(
  roles: readonly PlatformRole[],
  action: Action,
  ctx: PlatformPermissionContext = {},
): boolean {
  return roles.some((r) => canPlatform(r, action, ctx));
}

// ─────────────────────────────────────────────────────────────────────────────
// Attribution de rôles (R7 — pas d'élévation de privilège)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Actions qu'un rôle peut POTENTIELLEMENT détenir, conditionnelles comprises.
 *
 * Distinct d'`actionsOf()` : on compare ici des rôles, pas des situations. Un
 * `accountant` peut potentiellement clôturer (⚙), donc `period.close` compte —
 * sinon un `admin` pourrait attribuer un rôle capable d'une action qu'il ne
 * détient pas, en comptant sur le fait que le droit est désactivé par défaut.
 */
function potentialActionsOf(role: OrgRole): Set<Action> {
  return new Set(ACTIONS.filter((a) => ORG_PERMISSION_MATRIX[role][a] !== 'deny'));
}

/**
 * Rôles qu'un acteur peut attribuer (invitation ou changement de rôle) — R7.
 *
 * Règle : un acteur ne peut attribuer qu'un rôle dont l'ensemble d'actions est un
 * SOUS-ENSEMBLE du sien. Sinon `403 ROLE_ESCALATION`.
 *
 * Conséquences opérationnelles assumées (ADR-0012 §6 R7) :
 * - un `admin` ne peut pas attribuer `finance_director` (qui détient `plan.approve`);
 * - un `admin` ne peut pas non plus attribuer `accountant`, à cause du `period.close`
 *   conditionnel. Seul un `owner` le peut. C'est volontaire : l'alternative (liste
 *   blanche par rôle) est plus souple mais ouvre une escalade par composition.
 *
 * `project_manager` est exclu tant que les assignations de projet n'existent pas
 * (voir `isAssignableRole`) : il apparaîtrait ici sans restreindre quoi que ce soit.
 */
export function grantableRoles(actorRole: OrgRole): OrgRole[] {
  const mine = potentialActionsOf(actorRole);
  return ORG_ROLES.filter((candidate) => {
    if (!isAssignableRole(candidate)) return false;
    for (const action of potentialActionsOf(candidate)) {
      if (!mine.has(action)) return false;
    }
    return true;
  });
}

export function canGrantRole(actorRole: OrgRole, target: OrgRole): boolean {
  return grantableRoles(actorRole).includes(target);
}

/**
 * Rôles réellement attribuables en S20a.
 *
 * `project_manager` est présent dans l'enum et la matrice mais REFUSÉ à
 * l'attribution (`409 ROLE_NOT_ASSIGNABLE`) : toutes ses cases sont `allow_project`
 * et les assignations de projet (`project_assignments`) n'existent pas encore.
 * L'attribuer aujourd'hui donnerait un rôle qui ne restreint rien — ADR-0012 §7 :
 * « mieux vaut un rôle documenté et bloqué qu'un rôle qui ne restreint rien ».
 */
export function isAssignableRole(role: OrgRole): boolean {
  return role !== 'project_manager';
}

export const ASSIGNABLE_ORG_ROLES: readonly OrgRole[] = ORG_ROLES.filter(isAssignableRole);

// ─────────────────────────────────────────────────────────────────────────────
// Séparation des tâches (R2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Résultat de l'évaluation de la séparation des tâches sur une approbation de plan.
 *
 * - `separated`      — approbateur ≠ dernier auteur des entrées. Cas nominal.
 * - `sole_approver`  — l'organisation ne compte qu'UN seul principal détenant
 *                      `plan.approve` : l'auto-approbation est autorisée mais
 *                      marquée. C'est l'échappatoire d'ADR-0012 §6 R2, sans
 *                      laquelle une organisation d'une personne — le cas
 *                      majoritaire en RDC — ne pourrait jamais valider un plan.
 * - `self_forbidden` — auto-approbation alors que d'autres approbateurs existent :
 *                      refus `409 SELF_APPROVAL_FORBIDDEN`.
 */
export type SodDecision = 'separated' | 'sole_approver' | 'self_forbidden';

export function sodDecision(input: {
  approverUserId: string;
  lastInputAuthorUserId: string | null;
  approverCountInOrg: number;
}): SodDecision {
  const isSelf =
    input.lastInputAuthorUserId !== null && input.lastInputAuthorUserId === input.approverUserId;
  if (!isSelf) return 'separated';
  return input.approverCountInOrg <= 1 ? 'sole_approver' : 'self_forbidden';
}

/** Rôles capables d'approuver un plan — sert à compter les approbateurs d'une org. */
export const APPROVER_ROLES: readonly OrgRole[] = ORG_ROLES.filter(
  (r) => ORG_PERMISSION_MATRIX[r]['plan.approve'] !== 'deny',
);

// ─────────────────────────────────────────────────────────────────────────────
// Compatibilité et libellés
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rôle cible de la migration des anciens `member` (ADR-0012 §7).
 *
 * `finance_director` par ISO-PRIVILÈGE : avant S20a un `member` pouvait créer et
 * modifier des projets, saisir, calculer, approuver un plan, importer le réalisé,
 * clôturer et exporter — tout sauf gérer l'organisation, l'abonnement et les
 * invitations. C'est exactement le périmètre de `finance_director`. La migration
 * ne retire ni n'ajoute aucun droit.
 */
export const LEGACY_MEMBER_ROLE: OrgRole = 'finance_director';

/**
 * Traduit l'ancienne valeur `member` encore présente en base ou acceptée en
 * entrée d'API (compatibilité N-1 pendant le déploiement progressif — docs/24
 * règle 3, ADR-0012 §7). `owner` n'a pas changé de valeur et passe tel quel.
 *
 * Retourne `undefined` si la valeur n'est ni un rôle actuel ni un alias connu.
 */
export function normalizeOrgRole(value: unknown): OrgRole | undefined {
  if (isOrgRole(value)) return value;
  if (value === 'member') return LEGACY_MEMBER_ROLE;
  return undefined;
}

/** Libellés français — UI et messages d'erreur (docs/12 § Rôles organisation). */
export const ORG_ROLE_LABELS: Readonly<Record<OrgRole, string>> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  finance_director: 'Directeur financier',
  accountant: 'Comptable',
  analyst: 'Analyste',
  project_manager: 'Chef de projet',
  advisor: 'Conseiller',
  viewer: 'Lecteur',
};

/** Description courte d'un rôle — affichée sous le sélecteur de rôle. */
export const ORG_ROLE_DESCRIPTIONS: Readonly<Record<OrgRole, string>> = {
  owner: 'Abonnement, membres, suppression et transfert. Valide les plans.',
  admin: 'Membres, projets et paramètres. Ne valide pas les plans.',
  finance_director: 'Plans, validation, réalisé et rapports.',
  accountant: 'Réalisé et mapping. Clôture si le droit lui est accordé.',
  analyst: 'Scénarios, hypothèses et analyses. Ne valide pas.',
  project_manager: 'Projets assignés et saisie. Indisponible sans assignation de projet.',
  advisor: 'Consultation et recommandations. Sans export.',
  viewer: 'Lecture seule.',
};

export const PLATFORM_ROLE_LABELS: Readonly<Record<PlatformRole, string>> = {
  platform_super_admin: 'Super administrateur',
  platform_admin: 'Administrateur plateforme',
  platform_support: 'Support',
  platform_billing: 'Finance et facturation',
  platform_template_editor: 'Éditeur de templates',
  platform_country_pack_manager: 'Gestionnaire comptable et fiscal',
};
