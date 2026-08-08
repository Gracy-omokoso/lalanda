import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { AuthzService } from './authz.service.js';
import {
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  actionsOf,
  grantableRoles,
  isAssignableRole,
  type Action,
  type OrgRole,
} from './permissions.js';

export interface MyPermissionsView {
  organizationId: string;
  role: OrgRole;
  roleLabel: string;
  /** Liste plate des actions effectives — l'UI masque tout le reste. */
  actions: Action[];
  /** Rôles que cet utilisateur peut attribuer (R7) — alimente le sélecteur. */
  grantableRoles: Array<{ value: OrgRole; label: string; description: string }>;
  canClosePeriods: boolean;
}

/**
 * Permissions effectives de l'utilisateur sur son organisation active (ADR-0012 §8).
 *
 * Sert UNIQUEMENT à masquer ce qui serait de toute façon refusé : « côté web,
 * l'autorisation n'est jamais décidée par le client » (docs/12 § Modèle, « les
 * contrôles sont exécutés côté serveur »). Masquer est un confort d'interface;
 * le serveur refuse quand même.
 *
 * Pas de `@RequirePermission` : la route ne lit que les droits de l'appelant sur
 * sa propre organisation. Exiger une permission pour lire ses propres permissions
 * serait circulaire.
 */
@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(@Inject(AuthzService) private readonly authz: AuthzService) {}

  @Get('permissions')
  async permissions(
    @CurrentUser() user: { id: string },
    @CurrentOrgId() orgId: string,
  ): Promise<MyPermissionsView> {
    const resolved = await this.authz.resolveOrgRole(user.id, orgId);
    // `AuthGuard` n'a posé cet `orgId` qu'après avoir vérifié l'appartenance :
    // un `undefined` ici signale une membership supprimée entre les deux, ce qui
    // se traite comme une absence totale de droits, pas comme une erreur.
    const role: OrgRole = resolved?.role ?? 'viewer';
    const context = resolved?.context ?? {};

    return {
      organizationId: orgId,
      role,
      roleLabel: ORG_ROLE_LABELS[role],
      actions: resolved ? actionsOf(role, context) : [],
      grantableRoles: grantableRoles(role)
        .filter(isAssignableRole)
        .map((value) => ({
          value,
          label: ORG_ROLE_LABELS[value],
          description: ORG_ROLE_DESCRIPTIONS[value],
        })),
      canClosePeriods: context.canClosePeriods === true,
    };
  }
}
