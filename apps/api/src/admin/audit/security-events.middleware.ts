// Relevé des événements de sécurité sur les réponses de l'API (ADR-0053 § 6.5 — lot P5).
//
// ── Pourquoi un middleware, et pas un bloc dans chaque garde ─────────────────
//
// Les refus à compter naissent dans quatre fichiers d'autres lots (`AuthGuard`,
// `PlatformAuthGuard`, `PermissionsGuard`, `ReauthService`) et dans les services de la
// console. Les y instrumenter entrerait dans leurs zones de conflit ; observer la
// réponse une fois envoyée ne touche à aucun d'eux et ne change aucun comportement :
// le middleware n'intercepte rien, ne retarde rien et n'échoue jamais.
//
// Il lit le `code` du corps JSON au passage (`res.json`), puis, à la fin de la réponse,
// confie méthode, chemin, statut et code à `classifySecurityResponse`. Seule la NATURE
// est comptée. Les routes better-auth (`/auth/*`) sont montées avant Nest et ne passent
// pas par ici : les connexions refusées au formulaire ne sont pas encore comptées (écart
// documenté du lot P5).

import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { classifySecurityResponse } from './security-events.js';
import { SecurityEventsService } from './security-events.service.js';

@Injectable()
export class SecurityEventsMiddleware implements NestMiddleware {
  constructor(@Inject(SecurityEventsService) private readonly events: SecurityEventsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    let code: string | null = null;
    const json = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (body !== null && typeof body === 'object') {
        const c = (body as { code?: unknown }).code;
        if (typeof c === 'string') code = c;
      }
      return json(body);
    }) as Response['json'];

    res.once('finish', () => {
      const path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
      const kind = classifySecurityResponse({
        method: req.method,
        path,
        status: res.statusCode,
        code,
      });
      if (kind) void this.events.increment(kind);
    });
    next();
  }
}
