// Garde de l'espace externe — ADR-0078 § 3.
//
// Lit le cookie `lalanda_ext_session` (jamais celui de better-auth), résout la session
// (compte actif, fiche active, au moins un accès ouvert) et pose `req.external`. Ne pose
// NI `req.user` NI `req.orgId` : aucune garde de l'ERP ne peut prendre un compte externe
// pour un membre. Écritures soumises à la fonctionnalité `run_work` de l'organisation,
// comme les routes `/work`.

import {
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { isFeatureGatedMethod } from '@lalanda/shared/pricing';
import { WORK_EXTERNAL_SESSION_COOKIE } from '@lalanda/shared/work';
import type { Request } from 'express';

import { FeatureAccessService } from '../../admin/features/feature-access.service.js';
import { WorkExternalAuthService, type ExternalContext } from './work-external-auth.service.js';

export interface ExternalRequest extends Request {
  external?: ExternalContext;
}

/** Valeur d'un cookie du header `Cookie: a=b; c=d`. */
export function cookieOf(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(rest.join('=') ?? '') || undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

@Injectable()
export class ExternalAuthGuard implements CanActivate {
  constructor(
    @Inject(WorkExternalAuthService) private readonly auth: WorkExternalAuthService,
    @Optional()
    @Inject(FeatureAccessService)
    private readonly features: FeatureAccessService | null = null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ExternalRequest>();
    const token = cookieOf(req.headers.cookie, WORK_EXTERNAL_SESSION_COOKIE);
    const external = await this.auth.resolve(token);
    if (
      this.features &&
      isFeatureGatedMethod(req.method) &&
      !this.features.isOpenEverywhere('run_work')
    ) {
      const decision = await this.features.decide(external.organizationId, 'run_work');
      if (!decision.allowed) {
        throw new ForbiddenException({
          code: decision.code,
          message: 'Cet espace est momentanément en lecture seule.',
        });
      }
    }
    req.external = external;
    return true;
  }
}

/** Contexte externe de la requête (après `ExternalAuthGuard`). */
export const CurrentExternal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ExternalContext => {
    const req = ctx.switchToHttp().getRequest<ExternalRequest>();
    if (!req.external) {
      throw new Error('CurrentExternal utilisé sans ExternalAuthGuard — décoration invalide.');
    }
    return req.external;
  },
);
