// Campagnes et évaluations — ADR-0051 § 6.3. ADR-0051 — H15.
//
//   GET  /hr/review-cycles · POST · PUT /:id · POST /:id/open · /:id/close
//                                         performance.read + hr.manage
//   GET  /hr/reviews?cycleId=&mine=&toWrite=
//                                         analytics.read ; STATUTS seulement
//   PUT  /hr/reviews/:id/sections/:section
//                                         analytics.read ; soi, évaluateur, performance.read
//   POST /hr/reviews/:id/reveal           analytics.read ; lecteurs du § 4, audit strict, 30/h
//   POST /hr/reviews/:id/submit-self · /submit-manager · /share · /acknowledge
//                                         analytics.read ; soi ou évaluateur
//   POST /hr/reviews/:id/close · /reassign
//                                         hr.manage + performance.read (puis
//                                         `reviewCloseDecision` pour la clôture)
//
// `performance.read` est déclarée EN PREMIER sur les routes des campagnes : le refus la
// nomme (Administrateur et Directeur financier détiennent `hr.manage`, pas elle). Pour la
// clôture et le changement d'évaluateur, `hr.manage` en premier comme le dit l'ADR.
// `performance.read` est un interdit absolu de la plateforme.

import {
  CreateReviewCycleBody,
  ListReviewsQuery,
  ReassignReviewBody,
  RevealReviewBody,
  REVIEW_SECTIONS,
  WriteReviewSectionBody,
  type ReviewListItemView,
  type ReviewSection,
} from '@lalanda/shared/hr';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { HrPerformanceAccess, parse, type PerformanceViewer } from './hr-performance-access.js';
import {
  CloseReviewCycleBody,
  HrReviewsService,
  OpenReviewCycleBody,
  ReviewStepBody,
  type ReviewCycleView,
  type ReviewRevealView,
} from './hr-reviews.service.js';

type User = { id: string };

function sectionOf(raw: string): ReviewSection {
  if (!(REVIEW_SECTIONS as readonly string[]).includes(raw)) {
    throw new BadRequestException({
      code: 'REVIEW_SECTION_UNKNOWN',
      message: 'Section inconnue.',
    });
  }
  return raw as ReviewSection;
}

@Controller('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrReviewsController {
  constructor(
    @Inject(HrReviewsService) private readonly reviews: HrReviewsService,
    @Inject(HrPerformanceAccess) private readonly access: HrPerformanceAccess,
  ) {}

  private viewer(
    orgId: string,
    user: User,
    role: OrgRole | undefined,
    perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<PerformanceViewer> {
    return this.access.viewerOf(orgId, user.id, role, perms);
  }

  // ── Campagnes ────────────────────────────────────────────────────────────

  @Get('review-cycles')
  @RequirePermission('performance.read', 'hr.manage')
  async listCycles(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<{ items: ReviewCycleView[] }> {
    await this.viewer(orgId, user, role, perms);
    return { items: await this.reviews.listCycles(orgId) };
  }

  @Post('review-cycles')
  @RequirePermission('performance.read', 'hr.manage')
  async createCycle(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<ReviewCycleView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.createCycle(orgId, pv, parse(CreateReviewCycleBody, body));
  }

  @Put('review-cycles/:id')
  @RequirePermission('performance.read', 'hr.manage')
  async updateCycle(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReviewCycleView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.updateCycle(orgId, pv, id, body);
  }

  @Post('review-cycles/:id/open')
  @HttpCode(200)
  @RequirePermission('performance.read', 'hr.manage')
  async openCycle(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReviewCycleView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.openCycle(orgId, pv, id, parse(OpenReviewCycleBody, body));
  }

  @Post('review-cycles/:id/close')
  @HttpCode(200)
  @RequirePermission('performance.read', 'hr.manage')
  async closeCycle(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReviewCycleView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.closeCycle(orgId, pv, id, parse(CloseReviewCycleBody, body));
  }

  // ── Évaluations ──────────────────────────────────────────────────────────

  @Get('reviews')
  @RequirePermission('analytics.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<{ items: ReviewListItemView[] }> {
    const q = parse(ListReviewsQuery, query);
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.list(orgId, pv, q);
  }

  @Put('reviews/:id/sections/:section')
  @RequirePermission('analytics.read')
  async writeSection(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Param('section') section: string,
    @Body() body: unknown,
  ): Promise<ReviewListItemView> {
    const s = sectionOf(section);
    const b = parse(WriteReviewSectionBody, body);
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.writeSection(orgId, pv, id, s, b);
  }

  @Post('reviews/:id/reveal')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async reveal(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReviewRevealView> {
    const b = parse(RevealReviewBody, body);
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.reveal(orgId, pv, id, b.sections);
  }

  @Post('reviews/:id/submit-self')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async submitSelf(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReviewListItemView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.submitSelf(orgId, pv, id, parse(ReviewStepBody, body));
  }

  @Post('reviews/:id/submit-manager')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async submitManager(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReviewListItemView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.submitManager(orgId, pv, id, parse(ReviewStepBody, body));
  }

  @Post('reviews/:id/share')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async share(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReviewListItemView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.share(orgId, pv, id, parse(ReviewStepBody, body));
  }

  @Post('reviews/:id/acknowledge')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async acknowledge(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReviewListItemView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.acknowledge(orgId, pv, id, parse(ReviewStepBody, body));
  }

  @Post('reviews/:id/close')
  @HttpCode(200)
  @RequirePermission('hr.manage', 'performance.read')
  async close(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReviewListItemView & { soleApprover: boolean; unsigned: boolean }> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.close(orgId, pv, id, parse(ReviewStepBody, body));
  }

  @Post('reviews/:id/reassign')
  @HttpCode(200)
  @RequirePermission('hr.manage', 'performance.read')
  async reassign(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReviewListItemView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.reviews.reassign(orgId, pv, id, parse(ReassignReviewBody, body));
  }
}
