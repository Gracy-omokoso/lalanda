// Actions de la vue `normalization` selon la personne — ADR-0024 § 9.2.
//
// `actions` dépend de la phase ET des permissions de la personne. La vue d'un
// document est construite par `invoice-view.ts` sans connaître la personne
// (aucune action proposée) ; cet intercepteur la complète, pour TOUTE réponse
// qui est une vue de document de vente, avec le rôle résolu par
// `PermissionsGuard` et la matrice unique (`can()`, `authz/permissions.ts`).
// Ainsi `GET /sales/invoices/:id`, `normalize`, `retry`, `check`… rendent les
// mêmes actions, sans que l'interface ait à les déduire.

import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

import type { AuthenticatedRequest } from '../../auth/auth.guard.js';
import { can, type OrgPermissionContext, type OrgRole } from '../../authz/permissions.js';
import type { InvoiceView } from '../invoices/invoice.contract.js';
import {
  NO_NORMALIZATION_PERMISSIONS,
  normalizationActions,
  type NormalizationPermissions,
} from '../invoices/invoice-view.js';

export function normalizationPermissionsOf(
  role: OrgRole | undefined,
  ctx: OrgPermissionContext = {},
): NormalizationPermissions {
  if (!role) return NO_NORMALIZATION_PERMISSIONS;
  return {
    invoice: can(role, 'sales.invoice', ctx),
    manage: can(role, 'sales.manage', ctx),
    fiscal: can(role, 'fiscal.manage', ctx),
  };
}

function isInvoiceView(body: unknown): body is InvoiceView {
  if (typeof body !== 'object' || body === null) return false;
  const v = body as Partial<InvoiceView>;
  return (
    typeof v.proformaRef === 'string' &&
    typeof v.documentKind === 'string' &&
    typeof v.status === 'string' &&
    typeof v.normalization === 'object' &&
    v.normalization !== null
  );
}

@Injectable()
export class NormalizationActionsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return next.handle().pipe(
      map((body: unknown) => {
        if (!isInvoiceView(body) || body.normalization === null) return body;
        const permissions = normalizationPermissionsOf(req.orgRole, req.orgRoleContext);
        return {
          ...body,
          normalization: {
            ...body.normalization,
            actions: normalizationActions(body.normalization, body.status, permissions),
          },
        };
      }),
    );
  }
}
