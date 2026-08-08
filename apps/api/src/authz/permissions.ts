// ─────────────────────────────────────────────────────────────────────────────
// SOURCE DE VÉRITÉ DES PERMISSIONS (S20a — docs/12-ROLES-PERMISSIONS.md)
//
// Ce fichier — et lui seul — décide « qui a le droit de faire quoi ». Aucun autre
// module n'a le droit de coder en dur une comparaison de rôle : les guards, les
// contrôleurs et l'interface consomment `can()` / `PERMISSION_MATRIX`.
//
// Trois ensembles fermés (docs/26 « états représentés par unions fermées ») :
//   1. ORG_ROLES        — les 8 rôles d'organisation;
//   2. PLATFORM_ROLES   — les 6 rôles plateforme, indépendants de toute org;
//   3. ACTIONS          — les 15 actions granulaires.
//
// Refus par défaut (docs/17 § Autorisation) : la matrice est exhaustive, une case
// absente est impossible (le type l'interdit) et une case `false` est un refus.
// ─────────────────────────────────────────────────────────────────────────────

/** Les 8 rôles d'organisation (docs/12 § Rôles organisation). */
export const ORG_ROLES = [
  'proprietaire',
  'administrateur',
  'directeur_financier',
  'comptable',
  'analyste',
  'chef_projet',
  'conseiller',
  'lecteur',
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

/** Les 6 rôles plateforme (docs/12 § Rôles plateforme). Portée : produit entier. */
export const PLATFORM_ROLES = [
  'super_admin',
  'admin_plateforme',
  'support',
  'finance',
  'editeur_templates',
  'gestionnaire_fiscal',
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** Les 15 actions granulaires (docs/12 § Actions granulaires). */
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

/**
 * MATRICE RÔLE × ACTION.
 *
 * Le type impose les 8 rôles × 15 actions : oublier une case ne compile pas.
 * Lecture : `PERMISSION_MATRIX[role][action] === true` ⇒ autorisé.
 *
 * Justifications structurantes (docs/12 § Règles critiques, docs/17 § Finance) :
 *
 * - **Séparation validation / saisie.** Aucun rôle subalterne (= autre que
 *   `proprietaire`) ne détient à la fois `plan.approve` et `inputs.update`.
 *   Concrètement : le `directeur_financier` valide mais ne saisit pas; le
 *   `comptable` saisit, importe et clôture mais ne valide pas. L'invariant est
 *   vérifié par un test (`permissions.test.ts`), pas seulement par ce commentaire.
 * - **Réouverture d'une période.** Elle exige DEUX permissions (`period.close` ET
 *   `plan.approve`) — docs/12 « une clôture et une réouverture peuvent exiger deux
 *   permissions distinctes ». Le comptable clôture donc mais ne rouvre pas.
 * - **`billing.manage` réservé au `proprietaire`** : docs/12 attribue l'abonnement
 *   au seul Propriétaire. La simple LECTURE de l'abonnement (quotas affichés dans
 *   l'UI) passe par `analytics.read`, que tous les rôles détiennent.
 * - **`lecteur`** ne peut ni calculer ni exporter : lecture stricte.
 */
export const PERMISSION_MATRIX: Readonly<Record<OrgRole, Readonly<Record<Action, boolean>>>> = {
  // Contrôle total : abonnement, membres, suppression et transfert (docs/12).
  proprietaire: {
    'organization.manage': true,
    'billing.manage': true,
    'members.invite': true,
    'project.create': true,
    'project.read': true,
    'project.update': true,
    'canvas.update': true,
    'inputs.update': true,
    'plan.calculate': true,
    'plan.approve': true,
    'actuals.import': true,
    'period.close': true,
    'analytics.read': true,
    'report.export': true,
    'audit.read': true,
  },
  // « membres, projets, paramètres » — gouvernance, pas finance : ni validation,
  // ni saisie, ni clôture, ni abonnement.
  administrateur: {
    'organization.manage': true,
    'billing.manage': false,
    'members.invite': true,
    'project.create': true,
    'project.read': true,
    'project.update': true,
    'canvas.update': true,
    'inputs.update': false,
    'plan.calculate': true,
    'plan.approve': false,
    'actuals.import': false,
    'period.close': false,
    'analytics.read': true,
    'report.export': true,
    'audit.read': true,
  },
  // « plans, validation, réalisé, rapports » — l'autorité de validation. Pas de
  // saisie ni d'import : c'est la séparation création/approbation (docs/17).
  directeur_financier: {
    'organization.manage': false,
    'billing.manage': false,
    'members.invite': false,
    'project.create': true,
    'project.read': true,
    'project.update': true,
    'canvas.update': false,
    'inputs.update': false,
    'plan.calculate': true,
    'plan.approve': true,
    'actuals.import': false,
    'period.close': true,
    'analytics.read': true,
    'report.export': true,
    'audit.read': true,
  },
  // « réalisé, mapping, clôture selon permission » — saisit, importe, clôture;
  // ne valide jamais un plan et ne rouvre donc pas une période.
  comptable: {
    'organization.manage': false,
    'billing.manage': false,
    'members.invite': false,
    'project.create': false,
    'project.read': true,
    'project.update': false,
    'canvas.update': false,
    'inputs.update': true,
    'plan.calculate': true,
    'plan.approve': false,
    'actuals.import': true,
    'period.close': true,
    'analytics.read': true,
    'report.export': true,
    'audit.read': false,
  },
  // « scénarios, analyses, commentaires » — explore et modélise le canvas,
  // ne touche ni aux entrées officielles ni au réalisé.
  analyste: {
    'organization.manage': false,
    'billing.manage': false,
    'members.invite': false,
    'project.create': false,
    'project.read': true,
    'project.update': false,
    'canvas.update': true,
    'inputs.update': false,
    'plan.calculate': true,
    'plan.approve': false,
    'actuals.import': false,
    'period.close': false,
    'analytics.read': true,
    'report.export': true,
    'audit.read': false,
  },
  // « projets autorisés et saisie » — cible de migration des anciens `member`
  // (voir migrations/20260808-0001) : crée des projets et saisit, ne valide pas.
  chef_projet: {
    'organization.manage': false,
    'billing.manage': false,
    'members.invite': false,
    'project.create': true,
    'project.read': true,
    'project.update': true,
    'canvas.update': true,
    'inputs.update': true,
    'plan.calculate': true,
    'plan.approve': false,
    'actuals.import': true,
    'period.close': false,
    'analytics.read': true,
    'report.export': true,
    'audit.read': false,
  },
  // « consultation, commentaires, recommandations » — lit tout, n'écrit rien.
  conseiller: {
    'organization.manage': false,
    'billing.manage': false,
    'members.invite': false,
    'project.create': false,
    'project.read': true,
    'project.update': false,
    'canvas.update': false,
    'inputs.update': false,
    'plan.calculate': true,
    'plan.approve': false,
    'actuals.import': false,
    'period.close': false,
    'analytics.read': true,
    'report.export': true,
    'audit.read': false,
  },
  // Lecture seulement : pas même un export (un export est une sortie de données).
  lecteur: {
    'organization.manage': false,
    'billing.manage': false,
    'members.invite': false,
    'project.create': false,
    'project.read': true,
    'project.update': false,
    'canvas.update': false,
    'inputs.update': false,
    'plan.calculate': false,
    'plan.approve': false,
    'actuals.import': false,
    'period.close': false,
    'analytics.read': true,
    'report.export': false,
    'audit.read': false,
  },
};

/** Autorisation atomique — l'unique lecture légitime de la matrice. */
export function can(role: OrgRole, action: Action): boolean {
  return PERMISSION_MATRIX[role][action];
}

/** Autorisation conjonctive : toutes les actions demandées doivent être détenues. */
export function canAll(role: OrgRole, actions: readonly Action[]): boolean {
  return actions.every((a) => can(role, a));
}

/** Première action refusée — sert à renseigner `action` dans la réponse 403. */
export function firstDeniedAction(role: OrgRole, actions: readonly Action[]): Action | undefined {
  return actions.find((a) => !can(role, a));
}

/** Actions détenues par un rôle — exposé à l'UI pour masquer ce qui serait refusé. */
export function actionsOf(role: OrgRole): Action[] {
  return ACTIONS.filter((a) => can(role, a));
}

/**
 * Rôle le moins privilégié capable de faire ce que faisait l'ancien `member`
 * (créer un projet + saisir) — cible de la migration S20a. Exporté pour que la
 * migration, l'API (alias N-1) et les tests parlent de la même valeur.
 */
export const LEGACY_MEMBER_ROLE: OrgRole = 'chef_projet';
export const LEGACY_OWNER_ROLE: OrgRole = 'proprietaire';

/**
 * Traduit les anciennes valeurs `owner` / `member` encore acceptées en entrée
 * d'API (compatibilité N-1 pendant le déploiement progressif — docs/24, règle 3).
 * Retourne `undefined` si la valeur n'est ni un rôle actuel ni un alias connu.
 */
export function normalizeOrgRole(value: unknown): OrgRole | undefined {
  if (isOrgRole(value)) return value;
  if (value === 'owner') return LEGACY_OWNER_ROLE;
  if (value === 'member') return LEGACY_MEMBER_ROLE;
  return undefined;
}

/** Libellés français — utilisés par l'UI et les messages d'erreur. */
export const ORG_ROLE_LABELS: Readonly<Record<OrgRole, string>> = {
  proprietaire: 'Propriétaire',
  administrateur: 'Administrateur',
  directeur_financier: 'Directeur financier',
  comptable: 'Comptable',
  analyste: 'Analyste',
  chef_projet: 'Chef de projet',
  conseiller: 'Conseiller',
  lecteur: 'Lecteur',
};

export const PLATFORM_ROLE_LABELS: Readonly<Record<PlatformRole, string>> = {
  super_admin: 'Super administrateur',
  admin_plateforme: 'Administrateur plateforme',
  support: 'Support',
  finance: 'Finance / facturation',
  editeur_templates: 'Éditeur de templates',
  gestionnaire_fiscal: 'Gestionnaire comptable et fiscal',
};
