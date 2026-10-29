// Points d'API du business plan d'un projet (ADR-0037 § 8).
//
//   GET    /projects/:id/business-plan                                   project.read
//   PUT    /projects/:id/business-plan/plan                              canvas.update
//   PUT    /projects/:id/business-plan/sections/:sectionId               canvas.update
//   POST   /projects/:id/business-plan/sections/:sectionId/draft         canvas.update + quota + débit IA
//   POST   /projects/:id/business-plan/sections/:sectionId/proposal/accept   canvas.update
//   POST   /projects/:id/business-plan/sections/:sectionId/proposal/discard  canvas.update
//   GET    /projects/:id/business-plan/versions                          project.read
//   GET    /projects/:id/business-plan/versions/:version                 project.read
//   POST   /projects/:id/business-plan/versions                          plan.approve (séparation des tâches)
//   GET    /projects/:id/business-plan/pdf[?version=N]                   report.export + quota PDF
//
// Isolation : chaque route passe par `projects.findScoped(id, orgId)` — un projet
// d'une autre organisation rend 404. Le client n'envoie JAMAIS un chiffre : les
// tableaux sont relus dans le plan figé (ou évalués en direct) côté serveur.

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';

import { AiQuotaService } from '../ai/ai-quota.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { AuditService } from '../authz/audit.service.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { AuthzService } from '../authz/authz.service.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { can, NO_OVERRIDES, sodDecision, type OrgRole } from '../authz/permissions.js';
import type { AiQuotaStatus } from '../billing/ai-quota.js';
import { BillingService } from '../billing/billing.service.js';
import { PdfExportQuotaService } from '../billing/pdf-export-quota.service.js';
import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { AI_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { MENTION_BUSINESS_PLAN } from './business-plan-ai.js';
import { BusinessPlanAiService, type DraftResult } from './business-plan-ai.service.js';
import {
  assembleSections,
  contentSha256,
  pendingProposals,
  planLabel,
  type AssembledSection,
  type PlanSource,
} from './business-plan-assembly.js';
import { renderBusinessPlanHtml } from './business-plan-html.js';
import {
  BUSINESS_PLAN_SECTIONS,
  MAX_AI_NOTES,
  MAX_SECTION_TEXT,
  isSectionId,
  type BusinessPlanSectionId,
} from './business-plan.sections.js';
import type { BusinessPlanVersionDocument } from './business-plan.schemas.js';
import { BusinessPlanService, parseVersion, type PlanChoice } from './business-plan.service.js';

export const PlanRequestSchema = z
  .object({ planVersion: z.number().int().min(1).nullable() })
  .strict();
export const SectionTextSchema = z.object({ text: z.string().max(MAX_SECTION_TEXT) }).strict();
export const DraftRequestSchema = z
  .object({ notes: z.string().max(MAX_AI_NOTES).optional() })
  .strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
  }
  return parsed.data;
}

function sectionParam(raw: string): BusinessPlanSectionId {
  if (!isSectionId(raw)) {
    throw new BadRequestException({
      code: 'BUSINESS_PLAN_UNKNOWN_SECTION',
      message: `Section inconnue : « ${raw.slice(0, 40)} ».`,
    });
  }
  return raw;
}

export interface VersionSummaryView {
  version: number;
  approvedAt: string;
  approvedBy: string;
  soleApprover: boolean;
  plan: { version: number; fingerprint: string; approvedAt: string };
  contentSha256: string;
}

export interface SectionView extends AssembledSection {
  proposal: { text: string; sources: string[]; generatedAt: string } | null;
  updatedAt: string | null;
  acceptedAt: string | null;
}

export interface BusinessPlanView {
  projectId: string;
  projectName: string;
  planVersion: number | null;
  plan: PlanSource & { label: string };
  planChoices: PlanChoice[];
  sections: SectionView[];
  pendingProposals: BusinessPlanSectionId[];
  versions: VersionSummaryView[];
  /** Le contenu publiable diffère-t-il de la dernière version validée ? */
  changedSinceLastVersion: boolean;
  blockers: { code: string; message: string }[];
  ai: {
    enabled: boolean;
    disabledBy: 'organization' | 'platform' | null;
    quota: AiQuotaStatus | null;
    mention: string;
  };
  permissions: { write: boolean; validate: boolean; export: boolean };
}

function versionSummary(v: BusinessPlanVersionDocument): VersionSummaryView {
  return {
    version: v.version,
    approvedAt: v.approvedAt.toISOString(),
    approvedBy: v.approvedBy,
    soleApprover: v.approval?.soleApprover === true,
    plan: {
      version: v.plan.version,
      fingerprint: v.plan.fingerprint,
      approvedAt: new Date(v.plan.approvedAt).toISOString(),
    },
    contentSha256: v.contentSha256,
  };
}

/** Slug de fichier — même règle que le dossier financier. */
function fileSlug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'business-plan'
  );
}

@Controller('projects')
@UseGuards(AuthGuard, PermissionsGuard)
export class BusinessPlanController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(BusinessPlanService) private readonly service: BusinessPlanService,
    @Inject(BusinessPlanAiService) private readonly ai: BusinessPlanAiService,
    @Inject(AiQuotaService) private readonly quota: AiQuotaService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(PdfExportQuotaService) private readonly pdfQuota: PdfExportQuotaService,
    @Inject(PdfRenderingService) private readonly pdf: PdfRenderingService,
  ) {}

  private async view(orgId: string, projectId: string, role: OrgRole): Promise<BusinessPlanView> {
    const project = await this.projects.findScoped(projectId, orgId);
    const pid = String(project._id);
    const doc = await this.service.document(orgId, pid);
    const [source, planChoices, versions, disabledBy, quota] = await Promise.all([
      this.service.source(orgId, project, doc.planVersion),
      this.service.planChoices(orgId, pid),
      this.service.listVersions(orgId, pid),
      this.service.aiDisabledBy(orgId),
      this.quota.status(orgId).catch(() => null),
    ]);
    const raw = doc.sections ?? {};
    const assembled = assembleSections(
      Object.fromEntries(
        BUSINESS_PLAN_SECTIONS.map((s) => [
          s.id,
          { text: raw[s.id]?.text ?? '', origin: raw[s.id]?.origin ?? null },
        ]),
      ),
      source,
    );
    const sha = contentSha256(raw, { version: source.version, fingerprint: source.fingerprint });
    return {
      projectId: pid,
      projectName: project.name,
      planVersion: doc.planVersion,
      plan: { ...source, label: planLabel(source) },
      planChoices,
      sections: assembled.map((s) => {
        const st = raw[s.id];
        return {
          ...s,
          proposal: st?.proposal
            ? {
                text: st.proposal.text,
                sources: st.proposal.sources,
                generatedAt: new Date(st.proposal.generatedAt).toISOString(),
              }
            : null,
          updatedAt: st?.updatedAt ? new Date(st.updatedAt).toISOString() : null,
          acceptedAt: st?.acceptedAt ? new Date(st.acceptedAt).toISOString() : null,
        };
      }),
      pendingProposals: pendingProposals(raw),
      versions: versions.map(versionSummary),
      changedSinceLastVersion: versions[0] ? versions[0].contentSha256 !== sha : true,
      blockers: BusinessPlanService.blockers(doc),
      ai: { enabled: disabledBy === null, disabledBy, quota, mention: MENTION_BUSINESS_PLAN },
      permissions: {
        write: can(role, 'canvas.update', NO_OVERRIDES),
        validate: can(role, 'plan.approve', NO_OVERRIDES),
        export: can(role, 'report.export', NO_OVERRIDES),
      },
    };
  }

  @Get(':id/business-plan')
  @RequirePermission('project.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
  ): Promise<BusinessPlanView> {
    return this.view(orgId, id, role ?? 'viewer');
  }

  @Put(':id/business-plan/plan')
  @RequirePermission('canvas.update')
  async putPlan(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<BusinessPlanView> {
    const { planVersion } = parse(PlanRequestSchema, body);
    const project = await this.projects.findScoped(id, orgId);
    await this.service.setPlan(orgId, String(project._id), planVersion, user.id);
    return this.view(orgId, id, role ?? 'viewer');
  }

  @Put(':id/business-plan/sections/:sectionId')
  @RequirePermission('canvas.update')
  async putSection(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Param('sectionId') sectionRaw: string,
    @Body() body: unknown,
  ): Promise<BusinessPlanView> {
    const sectionId = sectionParam(sectionRaw);
    const { text } = parse(SectionTextSchema, body);
    const project = await this.projects.findScoped(id, orgId);
    await this.service.writeText(orgId, String(project._id), sectionId, text, user.id);
    return this.view(orgId, id, role ?? 'viewer');
  }

  @Post(':id/business-plan/sections/:sectionId/draft')
  @RequirePermission('canvas.update')
  @Throttle({ default: AI_THROTTLE })
  @UseGuards(UserThrottlerGuard)
  async draft(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('sectionId') sectionRaw: string,
    @Body() body: unknown,
  ): Promise<DraftResult> {
    const sectionId = sectionParam(sectionRaw);
    const { notes } = parse(DraftRequestSchema, body);
    const project = await this.projects.findScoped(id, orgId);
    const pid = String(project._id);
    const doc = await this.service.document(orgId, pid);
    // Tout ce que voit le modèle est relu côté serveur, pour CE projet de CETTE
    // organisation : le client n'envoie que ses réponses aux questions guides.
    const [source, canvas, disabledBy] = await Promise.all([
      this.service.source(orgId, project, doc.planVersion),
      this.service.canvasBlocks(orgId, pid),
      this.service.aiDisabledBy(orgId),
    ]);
    const result = await this.ai.draft(
      { organizationId: orgId, userId: user.id, projectId: pid, disabledBy },
      {
        sectionId,
        notes: notes ?? '',
        currentText: doc.sections?.[sectionId]?.text ?? '',
        canvas,
        source,
      },
    );
    if (result.proposal) {
      await this.service.storeProposal(orgId, pid, sectionId, result.proposal);
    }
    return result;
  }

  @Post(':id/business-plan/sections/:sectionId/proposal/accept')
  @RequirePermission('canvas.update')
  async accept(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Param('sectionId') sectionRaw: string,
  ): Promise<BusinessPlanView> {
    const sectionId = sectionParam(sectionRaw);
    const project = await this.projects.findScoped(id, orgId);
    await this.service.acceptProposal(orgId, String(project._id), sectionId, user.id);
    return this.view(orgId, id, role ?? 'viewer');
  }

  @Post(':id/business-plan/sections/:sectionId/proposal/discard')
  @RequirePermission('canvas.update')
  async discard(
    @CurrentOrgId() orgId: string,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Param('sectionId') sectionRaw: string,
  ): Promise<BusinessPlanView> {
    const sectionId = sectionParam(sectionRaw);
    const project = await this.projects.findScoped(id, orgId);
    await this.service.discardProposal(orgId, String(project._id), sectionId);
    return this.view(orgId, id, role ?? 'viewer');
  }

  @Get(':id/business-plan/versions')
  @RequirePermission('project.read')
  async listVersions(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
  ): Promise<{ versions: VersionSummaryView[] }> {
    const project = await this.projects.findScoped(id, orgId);
    const docs = await this.service.listVersions(orgId, String(project._id));
    return { versions: docs.map(versionSummary) };
  }

  @Get(':id/business-plan/versions/:version')
  @RequirePermission('project.read')
  async getVersion(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Param('version') versionRaw: string,
  ): Promise<VersionSummaryView & { sections: AssembledSection[] }> {
    const project = await this.projects.findScoped(id, orgId);
    const pid = String(project._id);
    const version = parseVersion(versionRaw, 'INVALID_BUSINESS_PLAN_VERSION') ?? 0;
    const v = await this.service.findVersion(orgId, pid, version);
    const source = await this.frozenSourceOf(orgId, project, v);
    return { ...versionSummary(v), sections: assembleSections(v.sections, source) };
  }

  @Post(':id/business-plan/versions')
  @RequirePermission('plan.approve')
  async validate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole,
    @Param('id') id: string,
  ): Promise<VersionSummaryView> {
    const project = await this.projects.findScoped(id, orgId);
    const pid = String(project._id);
    const doc = await this.service.document(orgId, pid);

    // R2 — séparation validation / saisie (ADR-0012 § 6), comme le plan figé :
    // le dernier auteur du document ne le valide pas, sauf approbateur unique.
    const decision = sodDecision({
      approverUserId: user.id,
      lastInputAuthorUserId: doc.updatedBy ?? null,
      approverCountInOrg: await this.authz.countApprovers(orgId),
    });
    if (decision === 'self_forbidden') {
      throw new ConflictException({
        code: 'SELF_APPROVAL_FORBIDDEN',
        message:
          'Vous avez fait la dernière modification de ce business plan : sa validation revient ' +
          'à une autre personne habilitée. (Séparation des tâches, docs/12.)',
      });
    }

    const v = await this.service.freeze({
      organizationId: orgId,
      projectId: pid,
      approvedBy: user.id,
      soleApprover: decision === 'sole_approver',
    });
    await this.audit.record({
      organizationId: orgId,
      actorUserId: user.id,
      actorRole: role,
      action: 'business_plan.validate',
      targetType: 'business_plan',
      targetId: String(v._id),
      metadata: {
        projectId: pid,
        version: v.version,
        planVersion: v.plan.version,
        soleApprover: decision === 'sole_approver',
      },
    });
    return versionSummary(v);
  }

  /** Source d'une version validée : le plan figé rattaché, empreinte vérifiée. */
  private async frozenSourceOf(
    orgId: string,
    project: Parameters<BusinessPlanService['source']>[1],
    v: BusinessPlanVersionDocument,
  ): Promise<PlanSource> {
    const source = await this.service.source(orgId, project, v.plan.version);
    if (source.fingerprint !== v.plan.fingerprint) {
      throw new ConflictException({
        code: 'BUSINESS_PLAN_PLAN_MISMATCH',
        message:
          'L’empreinte du plan financier rattaché ne correspond plus à celle enregistrée à la ' +
          'validation : export refusé.',
      });
    }
    return source;
  }

  @Get(':id/business-plan/pdf')
  @RequirePermission('report.export')
  @Header('content-type', 'application/pdf')
  async downloadPdf(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole,
    @Param('id') id: string,
    @Res({ passthrough: false }) res: Response,
    @Query('version') versionRaw?: string,
  ): Promise<void> {
    const project = await this.projects.findScoped(id, orgId);
    const pid = String(project._id);
    const version = parseVersion(versionRaw, 'INVALID_BUSINESS_PLAN_VERSION');
    // Filigrane décidé ici, côté API, pour les deux chemins (leçon S22i).
    const { entitlements } = await this.billing.getPlanEntitlements(orgId);

    let html: string;
    let fixedDate: Date | undefined;
    if (version !== undefined) {
      const v = await this.service.findVersion(orgId, pid, version);
      const source = await this.frozenSourceOf(orgId, project, v);
      html = renderBusinessPlanHtml({
        projectName: project.name,
        pays: project.pays,
        sections: assembleSections(v.sections, source),
        source,
        document: {
          version: v.version,
          approvedAt: v.approvedAt.toISOString(),
          contentSha256: v.contentSha256,
        },
        generatedAt: v.approvedAt.toISOString(),
        watermark: entitlements.pdfWatermark,
      });
      // Rendu reproductible d'un document figé (ADR-0025 § O2).
      fixedDate = v.approvedAt;
    } else {
      const doc = await this.service.document(orgId, pid);
      const source = await this.service.source(orgId, project, doc.planVersion);
      html = renderBusinessPlanHtml({
        projectName: project.name,
        pays: project.pays,
        sections: assembleSections(doc.sections ?? {}, source),
        source,
        document: null,
        generatedAt: new Date().toISOString(),
        watermark: entitlements.pdfWatermark,
      });
    }

    const pdf = await this.pdfQuota.runGuarded(
      { organizationId: orgId, userId: user.id, projectId: pid },
      async () => {
        const octets = await this.pdf.render(html, fixedDate ? { fixedDate } : {});
        // R4 : pas d'export non traçable — un journal en échec annule l'envoi.
        await this.audit.recordStrict({
          organizationId: orgId,
          actorUserId: user.id,
          actorRole: role,
          action: 'report.export',
          targetType: 'project',
          targetId: pid,
          metadata: {
            format: 'pdf',
            kind: 'business_plan',
            businessPlanVersion: version ?? null,
            bytes: octets.byteLength,
          },
        });
        return octets;
      },
    );

    const suffix = version !== undefined ? `-v${version}` : '-brouillon';
    res.setHeader(
      'content-disposition',
      `attachment; filename="business-plan-${fileSlug(project.name)}${suffix}.pdf"`,
    );
    res.setHeader('content-length', String(pdf.byteLength));
    res.end(pdf);
  }
}
