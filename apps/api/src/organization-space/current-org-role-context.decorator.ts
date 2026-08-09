// Conditions du rôle d'organisation (case ⚙ de la matrice) résolues par
// `PermissionsGuard`.
//
// `CurrentOrgRole` (authz/) donne le rôle; il manquait son contexte. Sans lui, un
// contrôleur qui veut savoir si un Comptable peut clôturer devrait relire la
// membership — ou pire, deviner. Le guard l'a déjà résolu et posé sur la requête.
//
// Vit ici plutôt que dans `authz/` : `authz/**` est le périmètre d'écriture du
// Dev RBAC (ADR-0012 §9) et ce décorateur ne sert qu'à l'espace organisation. Il
// ne LIT que des données déjà posées, il n'ajoute aucune règle.

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import type { OrgPermissionContext } from '../authz/permissions.js';

export const CurrentOrgRoleContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrgPermissionContext => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().orgRoleContext ?? {};
  },
);
