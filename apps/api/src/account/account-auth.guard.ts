// Guard de l'espace compte (S20b — ADR-0012/0013, risque n°2).
//
// POURQUOI UN GUARD DÉDIÉ PLUTÔT QUE `AuthGuard` :
//
// `AuthGuard` (src/auth/auth.guard.ts) fait DEUX choses : il résout la session,
// puis il exige une organisation active et lève `403 NO_ORGANIZATION` s'il n'en
// trouve aucune. Cette seconde règle est juste pour les routes métier — projets,
// plans, réalisé n'ont aucun sens hors d'une organisation — mais elle est fatale
// ici : `/account/*` est le SEUL espace qui doit rester accessible à un
// utilisateur sans organisation. Deux cas réels le produisent :
//
//   1. un compte fraîchement inscrit dont l'auto-provisionnement d'organisation a
//      échoué (le hook `databaseHooks.user.create.after` n'est pas transactionnel);
//   2. un compte dont la dernière organisation vient d'être supprimée.
//
// Dans les deux cas, réutiliser `AuthGuard` enfermerait l'utilisateur DEHORS de
// son propre espace compte : plus moyen de consulter ses sessions, de changer son
// mot de passe ni de supprimer son compte. Un écran de gestion de compte doit
// survivre exactement aux situations où l'on a besoin de lui.
//
// Ce guard ne fait donc QUE résoudre la session et remplir `req.user`. Il ne
// résout PAS `req.orgId` — c'est délibéré, et c'est pourquoi aucune route de ce
// module n'utilise `CurrentOrgId` (qui lèverait, faute d'org résolue).
//
// Il ne modifie ni ne remplace `AuthGuard` : la refonte RBAC en cours dans
// `src/auth/` reste libre de faire évoluer le guard partagé sans casser cet
// espace, et réciproquement.

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { getAuth } from '../auth/auth.js';

export interface AccountRequest extends Request {
  user?: { id: string; email: string; name?: string | null };
}

@Injectable()
export class AccountAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AccountRequest>();

    const session = await getAuth().api.getSession({
      headers: new Headers(req.headers as Record<string, string>),
    });
    if (!session?.user) {
      throw new UnauthorizedException({ code: 'NOT_AUTHENTICATED' });
    }

    // Même forme que celle posée par `AuthGuard` : le décorateur `CurrentUser`
    // partagé lit `req.user` et fonctionne donc à l'identique sous ce guard.
    req.user = {
      id: String(session.user.id),
      email: session.user.email,
      name: session.user.name ?? null,
    };

    return true;
  }
}
