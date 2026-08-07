// Guard de throttling par UTILISATEUR (S16a).
//
// Le ThrottlerGuard global (voir throttling.module.ts) trace par IP — il s'exécute
// avant AuthGuard et ne connaît donc pas l'utilisateur. Ce guard-ci s'utilise au
// niveau route, APRÈS AuthGuard dans la chaîne (global → contrôleur → route), donc
// `req.user` est renseigné : le compteur est indexé par id utilisateur.
//
// Utilisation type (quota facturé, ex. POST /ai/corrective-actions) :
//   @UseGuards(UserThrottlerGuard)
//   @Throttle({ default: AI_THROTTLE })

import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const { user, ip } = req as unknown as AuthenticatedRequest;
    // Fallback IP : ne devrait jamais arriver si AuthGuard précède ce guard,
    // mais on ne laisse jamais un compteur sans clé.
    return user ? `user:${user.id}` : `ip:${ip ?? 'unknown'}`;
  }
}
