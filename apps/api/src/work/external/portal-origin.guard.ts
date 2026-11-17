// Écritures de l'espace externe : origine et format — ADR-0078, revue de sécurité (B8).
//
// Le cookie de session externe est `SameSite=Lax` ; en défense de profondeur, toute
// écriture `/portal/*` (connexion comprise) est refusée si l'en-tête `Origin` est présent
// et différent de `WEB_URL` (`403 EXTERNAL_ORIGIN_FORBIDDEN`), et un corps doit être du
// JSON (`415 EXTERNAL_JSON_REQUIRED`) : un formulaire HTML d'un autre site ne peut ni
// envoyer `application/json` ni poser une `Origin` acceptée.

import {
  ForbiddenException,
  Injectable,
  UnsupportedMediaTypeException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

/** Origine attendue du front (sans barre finale). */
export function portalOrigin(): string {
  return (process.env['WEB_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
}

@Injectable()
export class PortalOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const method = (req.method ?? 'GET').toUpperCase();
    if (!WRITES.has(method)) return true;
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin.replace(/\/+$/, '') !== portalOrigin()) {
      throw new ForbiddenException({
        code: 'EXTERNAL_ORIGIN_FORBIDDEN',
        message: 'Requête refusée : origine inattendue.',
      });
    }
    if (WITH_BODY.has(method)) {
      const type = String(req.headers['content-type'] ?? '').toLowerCase();
      if (!type.startsWith('application/json')) {
        throw new UnsupportedMediaTypeException({
          code: 'EXTERNAL_JSON_REQUIRED',
          message: 'Corps attendu en JSON.',
        });
      }
    }
    return true;
  }
}
