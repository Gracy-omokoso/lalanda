// Devis prérempli depuis une opportunité — ADR-0040 § 3.3. ADR-0040 — C2.
//
// Contrôleur à part pour ne pas écrire dans `quotes.controller.ts` (lot C0).
// `sales.quote` (préparer un devis) ET `crm.read` (lire l'opportunité) : le
// Commercial y a droit. Une opportunité d'une autre organisation répond 404.

import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { isCalendarDay } from '../../crm/crm-model.js';
import { invalidRequest } from '../sales.errors.js';
import { isObjectIdHex } from '../search.js';
import { QuotesService, type QuoteView } from './quotes.service.js';

type User = { id: string; email: string; name?: string | null };

/** `POST /sales/quotes/from-opportunity` `{ opportunityId, validUntil? }`. */
export const QuoteFromOpportunitySchema = z
  .object({
    opportunityId: z.string().refine(isObjectIdHex, 'Identifiant d’opportunité invalide.'),
    validUntil: z.string().refine(isCalendarDay, 'Validité : AAAA-MM-JJ.').nullable().optional(),
  })
  .strict()
  .transform((raw) => ({
    opportunityId: raw.opportunityId.toLowerCase(),
    validUntil: raw.validUntil ?? null,
  }));

@Controller('sales/quotes')
@UseGuards(AuthGuard, PermissionsGuard)
export class QuotesFromOpportunityController {
  constructor(@Inject(QuotesService) private readonly quotes: QuotesService) {}

  @Post('from-opportunity')
  @RequirePermission('sales.quote', 'crm.read')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<QuoteView> {
    const parsed = QuoteFromOpportunitySchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    const name = user.name?.trim();
    return this.quotes.createFromOpportunity(orgId, parsed.data, {
      userId: user.id,
      name: name ? name : user.email,
      role: role ?? 'unknown',
    });
  }
}
