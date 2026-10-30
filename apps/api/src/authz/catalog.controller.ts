// ADR-0041 § 6 — `GET /authz/catalog` : le vocabulaire des autorisations, servi à
// l'écran pour qu'il ne recopie plus la liste des actions. Donnée STATIQUE, entièrement
// tirée de `permissions.ts` (source unique) : domaines, libellés, dépendances, paires
// de séparation des tâches, actions non délégables, ligne de chaque rôle attribuable.
//
// Authentifiée (`AuthGuard`) mais sans permission : elle ne dit rien d'aucun membre ni
// d'aucune organisation, seulement ce que la matrice publiée (docs/12) dit déjà.

import { Controller, Get, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';

import { memberPermissionsEnabled } from './authz.service.js';
import {
  ACTION_DEPENDENCIES,
  ACTION_DOMAINS,
  ACTION_LABELS,
  ACTIONS,
  ASSIGNABLE_ORG_ROLES,
  BASE_ACTION,
  NON_DELEGABLE_ACTIONS,
  ORG_PERMISSION_MATRIX,
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  SOD_PAIRS,
  type Action,
  type OrgRole,
} from './permissions.js';

export interface AuthzCatalogView {
  /**
   * Interrupteur `MEMBER_PERMISSIONS_ENABLED` : éteint, l'écran affiche la grille
   * en lecture seule au lieu de découvrir le refus au premier enregistrement.
   */
  memberPermissionsEnabled: boolean;
  /** Les sept domaines de l'écran, dans l'ordre d'affichage. */
  domains: Array<{ key: string; label: string; actions: Action[] }>;
  /** Libellé français de chaque action (« autorisation »). */
  labels: Record<Action, string>;
  /** Dépendances DIRECTES ; `baseAction` s'y ajoute pour toute autre action. */
  dependencies: Partial<Record<Action, Action[]>>;
  /** Socle non retirable tant que le membre détient une autre action. */
  baseAction: Action;
  /** Paires incompatibles par ajout (G4). */
  sodPairs: Array<[Action, Action]>;
  /** Actions jamais ajoutables (G3). */
  nonDelegable: Action[];
  /**
   * Ligne de chaque rôle attribuable, pour l'aperçu à l'invitation : `actions` (cases
   * accordées) et `conditional` (case ⚙, accordée selon le droit de clôture).
   */
  roleMatrix: Array<{
    role: OrgRole;
    label: string;
    description: string;
    actions: Action[];
    conditional: Action[];
  }>;
}

export function buildAuthzCatalog(env: NodeJS.ProcessEnv = process.env): AuthzCatalogView {
  const dependencies: Partial<Record<Action, Action[]>> = {};
  for (const action of ACTIONS) {
    const deps = ACTION_DEPENDENCIES[action];
    if (deps !== undefined) dependencies[action] = [...deps];
  }
  return {
    memberPermissionsEnabled: memberPermissionsEnabled(env),
    domains: ACTION_DOMAINS.map((d) => ({ key: d.key, label: d.label, actions: [...d.actions] })),
    labels: { ...ACTION_LABELS },
    dependencies,
    baseAction: BASE_ACTION,
    sodPairs: SOD_PAIRS.map(([a, b]) => [a, b] as [Action, Action]),
    nonDelegable: [...NON_DELEGABLE_ACTIONS],
    roleMatrix: ASSIGNABLE_ORG_ROLES.map((role) => {
      const row = ORG_PERMISSION_MATRIX[role];
      return {
        role,
        label: ORG_ROLE_LABELS[role],
        description: ORG_ROLE_DESCRIPTIONS[role],
        actions: ACTIONS.filter((a) => row[a] !== 'deny' && row[a] !== 'conditional'),
        conditional: ACTIONS.filter((a) => row[a] === 'conditional'),
      };
    }),
  };
}

@Controller('authz')
@UseGuards(AuthGuard)
export class CatalogController {
  @Get('catalog')
  catalog(): AuthzCatalogView {
    return buildAuthzCatalog();
  }
}
