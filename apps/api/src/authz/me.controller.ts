import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { AuthzService, memberPermissionsEnabled } from './authz.service.js';
import {
  NON_DELEGABLE_ACTIONS,
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  actionsOf,
  effectiveActions,
  grantableRoles,
  isAssignableRole,
  type Action,
  type OrgRole,
} from './permissions.js';

export interface MyPermissionsView {
  organizationId: string;
  role: OrgRole;
  roleLabel: string;
  /**
   * Liste plate des actions EFFECTIVES (ADR-0041) — ligne du rôle, case ⚙, ajouts,
   * retraits. L'UI masque tout le reste.
   */
  actions: Action[];
  /** ADR-0041 § 6 — ligne du rôle seule (case ⚙ selon `canClosePeriods`), sans l'écart. */
  roleActions: Action[];
  /** ADR-0041 § 6 — ajouts propres à ce membre. */
  grants: Action[];
  /** ADR-0041 § 6 — retraits propres à ce membre. */
  revokes: Action[];
  /** ADR-0041 § 6 — l'écart n'est pas vide. */
  customized: boolean;
  /**
   * ADR-0041 § 6 — ce que l'appelant pourrait ajouter à autrui (G1, G3) : ses droits
   * effectifs moins les actions non délégables.
   */
  grantableActions: Action[];
  /** ADR-0041 G8 — révision des autorisations de l'appartenance. */
  permissionsRevision: number;
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
    const grants = [...(context.grants ?? [])];
    const revokes = [...(context.revokes ?? [])];
    const actions = resolved ? effectiveActions(role, context) : [];

    return {
      organizationId: orgId,
      role,
      roleLabel: ORG_ROLE_LABELS[role],
      actions,
      roleActions: resolved
        ? actionsOf(role, { canClosePeriods: context.canClosePeriods === true })
        : [],
      grants,
      revokes,
      customized: grants.length > 0 || revokes.length > 0,
      grantableActions: actions.filter((a) => !NON_DELEGABLE_ACTIONS.includes(a)),
      permissionsRevision: resolved?.permissionsRevision ?? 0,
      // ADR-0041 G1 / décision n° 5 : R7 jugé sur les droits effectifs de l'appelant
      // dès que les écarts sont lus. Interrupteur éteint : calcul d'avant, identique à
      // celui que les services des membres et des invitations appliquent jusqu'au lot A4.
      grantableRoles: (memberPermissionsEnabled()
        ? grantableRoles(role, context)
        : grantableRoles(role)
      )
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
