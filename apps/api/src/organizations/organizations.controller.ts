import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { ORG_ROLE_LABELS, type OrgRole } from '../authz/permissions.js';
import { OrganizationsService } from './organizations.service.js';

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['solo', 'agence', 'incubateur', 'banque', 'ecole']).optional(),
  pays: z.string().length(2).optional(),
});

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  type: string;
  pays: string;
  role: OrgRole;
  roleLabel: string;
  /** Droit conditionnel de clôture (case ⚙) — l'UI en a besoin pour masquer. */
  canClosePeriods: boolean;
}

@Controller('organizations')
@UseGuards(AuthGuard)
export class OrganizationsController {
  constructor(@Inject(OrganizationsService) private readonly orgs: OrganizationsService) {}

  @Get()
  async list(
    @CurrentUser() user: { id: string },
    // ADR-0052 — O1 (F2) : l'organisation que l'API SERT (cookie vérifié, sinon primaire).
    @CurrentOrgId() activeOrgId: string,
  ): Promise<{ organizations: OrganizationView[]; activeOrganizationId: string }> {
    const rows = await this.orgs.listForUser(user.id);
    return {
      // ADR-0052 — O1 : le sélecteur affiche CETTE organisation, pas la première appartenance.
      activeOrganizationId: activeOrgId,
      organizations: rows.map(({ org, role, canClosePeriods }) => ({
        id: String(org._id),
        name: org.name,
        slug: org.slug,
        type: org.type,
        pays: org.pays,
        role,
        roleLabel: ORG_ROLE_LABELS[role],
        canClosePeriods,
      })),
    };
  }

  @Post()
  async create(
    @CurrentUser() user: { id: string },
    @Body() body: unknown,
  ): Promise<OrganizationView> {
    const parsed = CreateOrgSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const org = await this.orgs.createForUser(user.id, parsed.data);
    return {
      id: String(org._id),
      name: org.name,
      slug: org.slug,
      type: org.type,
      pays: org.pays,
      role: 'owner',
      roleLabel: ORG_ROLE_LABELS.owner,
      canClosePeriods: false,
    };
  }
}
