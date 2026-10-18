// Garde de ré-authentification récente — réutilisable hors d'`/admin` (ADR-0021 §8).
//
// Les écritures sensibles du module fiscal (saisie d'un jeton e-MCF, désactivation
// de la facture normalisée, retrait d'un point de vente, changement
// d'environnement) exigent une ré-authentification de moins de 10 minutes, par le
// MÊME mécanisme qu'ADR-0013 §5 : une fenêtre liée à la session, ouverte par
// `POST /me/reauth` (ou `POST /admin/reauth`). Un seul mécanisme vaut mieux que
// deux : une fenêtre ouverte par l'un vaut pour l'autre.
//
// Utilisation, sur la route (APRÈS `AuthGuard`, posé au niveau du contrôleur) :
//
//   @Post('deactivate')
//   @RequireRecentReauth()
//   async deactivate(...) { ... }
//
// Sans fenêtre ouverte pour CETTE session : `401 REAUTH_REQUIRED` (corps produit par
// `ReauthService.assertRecent`). L'interface lit alors `GET /me/reauth` pour savoir
// s'il faut demander un mot de passe ou une reconnexion Google, puis rejoue une fois.
//
// Le module consommateur importe `IntegrationsModule`, qui exporte `ReauthService` :
// Nest instancie ce garde dans l'injecteur du module consommateur.

import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { ReauthService } from './reauth.service.js';

/** Marqueur lisible par introspection — les tests vérifient quelles routes l'exigent. */
export const REQUIRES_RECENT_REAUTH_KEY = 'lalanda:requiresRecentReauth';

@Injectable()
export class RecentReauthGuard implements CanActivate {
  constructor(@Inject(ReauthService) private readonly reauth: ReauthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // `AuthGuard` doit précéder ce garde. S'il manque, on refuse : un garde de
    // sécurité mal câblé ne laisse jamais passer.
    if (!req.user) throw new UnauthorizedException({ code: 'NOT_AUTHENTICATED' });
    await this.reauth.assertRecent(req.user.id, req.headers.cookie);
    return true;
  }
}

/** Exige une ré-authentification de moins de 10 minutes pour CETTE session. */
export function RequireRecentReauth(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(REQUIRES_RECENT_REAUTH_KEY, true),
    UseGuards(RecentReauthGuard),
  );
}
