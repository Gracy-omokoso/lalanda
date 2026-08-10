// Routes de génération de rapports de projet.
// - PDF (S8-lite → S13e) : dossier bancable rendu via Puppeteer.
// - XLSX (S14b) : classeur avec une feuille par feuille moteur et formules Excel natives.
//
// La route est côté /projects pour rester cohérente avec le scope (projet appartient à une org).

import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { evaluateTemplate } from '@lalanda/engine';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuditService } from '../authz/audit.service.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgRole } from '../authz/permissions.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { BillingService } from '../billing/billing.service.js';
import { getTemplate } from '../evaluate/template-registry.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { getParameterPack } from '../parameter-packs/parameter-pack-registry.js';
import { PlansService } from '../plans/plans.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { ReportsService } from './reports.service.js';
import type { ReportData } from './report-html.js';

/** Slug de fichier — retire diacritiques/caractères spéciaux, borne à 80 caractères. */
function fileSlug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'plan-financier'
  );
}

@Controller('projects')
@UseGuards(AuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(PlansService) private readonly plans: PlansService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Parse `?planVersion=N` — undefined si absent, 400 si non-entier positif. */
  private static parsePlanVersion(raw: string | undefined): number | undefined {
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      throw new BadRequestException({
        code: 'INVALID_PLAN_VERSION',
        message: `planVersion doit être un entier >= 1 (reçu : "${raw}").`,
      });
    }
    return n;
  }

  /**
   * Prépare le `ReportData` partagé par PDF et Excel : lookup projet + org + pack,
   * évaluation moteur, résolution de la devise d'affichage.
   * Factorise pour garantir que les deux exports partent des mêmes chiffres.
   *
   * (S16c) `planVersion` fourni → l'export repart INTÉGRALEMENT du snapshot figé
   * (drivers résolus + lignes déjà calculées) : AUCUN recalcul moteur. Les chiffres
   * d'un plan validé restent identiques quels que soient les changements ultérieurs
   * du projet. Sans `planVersion` → comportement brouillon actuel (recalcul live).
   */
  private async buildReportData(
    orgId: string,
    id: string,
    planVersion?: number,
  ): Promise<ReportData> {
    const project = await this.projects.findScoped(id, orgId);
    const org = await this.organizations.findOrgById(orgId);
    // Entitlements (S16b) : le filigrane PDF est décidé ici, côté API — jamais par l'UI.
    //
    // S22i : cette résolution vivait dans la seule branche live, APRÈS le retour
    // anticipé du plan figé. Un export `?planVersion=N` sortait donc sans
    // filigrane quel que soit le plan de l'organisation — c'est-à-dire que la
    // limite d'une offre `free` se contournait en exportant la version validée,
    // précisément l'export qu'on dépose en banque. Elle est désormais résolue
    // avant l'embranchement : les deux chemins la posent.
    const { entitlements } = await this.billing.getPlanEntitlements(orgId);

    if (planVersion !== undefined) {
      const plan = await this.plans.findVersion(orgId, String(project._id), planVersion);
      // Limite connue (S16c) : le template sert uniquement à la mise en forme
      // (labels/groupes des hypothèses). On recharge sa version COURANTE du registre —
      // on ne ré-exécute pas un moteur historique. Les chiffres, eux, viennent
      // exclusivement du snapshot.
      const template = getTemplate(plan.templateSlug);
      if (!template) {
        throw new NotFoundException({
          code: 'TEMPLATE_NOT_FOUND',
          message: `Template introuvable pour le plan : ${plan.templateSlug}`,
        });
      }
      const pack = plan.parameterPackSlug ? getParameterPack(plan.parameterPackSlug) : undefined;
      const currency =
        (project.deviseAffichage as 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR' | undefined) ??
        pack?.devise_principale ??
        template.devise_base ??
        'USD';

      return {
        organization: { name: org.name, pays: org.pays },
        project: {
          name: project.name,
          templateSlug: plan.templateSlug,
          pays: project.pays ?? org.pays,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
        },
        template,
        parameterPack: pack
          ? {
              slug: pack.slug,
              label: pack.label,
              annee: pack.annee,
              systeme_comptable: pack.systeme_comptable,
              avertissement: pack.avertissement,
            }
          : undefined,
        // Snapshot figé — aucun appel à evaluateTemplate.
        driverValues: plan.driverValues,
        lines: plan.result.lines.map((l) => ({
          sheetId: l.sheetId,
          lineId: l.lineId,
          label: l.label,
          value: l.value,
          format: l.format,
          seuil: l.seuil,
        })),
        generatedAt: new Date().toISOString(),
        currency: currency as 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR',
        plan: { version: plan.version, approvedAt: plan.approvedAt.toISOString() },
        watermark: entitlements.pdfWatermark,
      };
    }

    const template = getTemplate(project.templateSlug);
    if (!template) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: `Template introuvable pour le projet : ${project.templateSlug}`,
      });
    }
    const pack = project.parameterPackSlug
      ? getParameterPack(project.parameterPackSlug)
      : undefined;
    const evaluation = evaluateTemplate(template, project.driverValues, {
      parameterPack: pack,
    });
    // Devise d'affichage : projet > pack > template > USD.
    const currency =
      (project.deviseAffichage as 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR' | undefined) ??
      pack?.devise_principale ??
      template.devise_base ??
      'USD';

    return {
      organization: { name: org.name, pays: org.pays },
      project: {
        name: project.name,
        templateSlug: project.templateSlug,
        pays: project.pays ?? org.pays,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      },
      template,
      parameterPack: pack
        ? {
            slug: pack.slug,
            label: pack.label,
            annee: pack.annee,
            systeme_comptable: pack.systeme_comptable,
            avertissement: pack.avertissement,
          }
        : undefined,
      driverValues: Object.fromEntries(evaluation.drivers),
      lines: evaluation.lines.map((l) => ({
        sheetId: l.sheetId,
        lineId: l.lineId,
        label: l.label,
        value: l.value,
        format: l.format,
        seuil: l.seuil,
      })),
      generatedAt: new Date().toISOString(),
      currency: currency as 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR',
      watermark: entitlements.pdfWatermark,
    };
  }

  @Get(':id/report/pdf')
  @RequirePermission('report.export')
  @Header('content-type', 'application/pdf')
  async downloadPdf(
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole,
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Res({ passthrough: false }) res: Response,
    @Query('planVersion') planVersionRaw?: string,
  ): Promise<void> {
    const planVersion = ReportsController.parsePlanVersion(planVersionRaw);
    const data = await this.buildReportData(orgId, id, planVersion);
    const pdf = await this.reports.renderPdf(data);
    await this.journaliserExport({
      orgId,
      userId: user.id,
      role,
      projectId: id,
      format: 'pdf',
      planVersion,
      bytes: pdf.byteLength,
    });
    const suffix = planVersion !== undefined ? `-v${planVersion}` : '';
    res.setHeader(
      'content-disposition',
      `attachment; filename="${fileSlug(data.project.name)}${suffix}.pdf"`,
    );
    res.setHeader('content-length', String(pdf.byteLength));
    res.end(pdf);
  }

  @Get(':id/report/xlsx')
  @RequirePermission('report.export')
  @Header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async downloadXlsx(
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole,
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Res({ passthrough: false }) res: Response,
    @Query('planVersion') planVersionRaw?: string,
  ): Promise<void> {
    const planVersion = ReportsController.parsePlanVersion(planVersionRaw);
    const data = await this.buildReportData(orgId, id, planVersion);
    const xlsx = await this.reports.renderXlsx(data);
    await this.journaliserExport({
      orgId,
      userId: user.id,
      role,
      projectId: id,
      format: 'xlsx',
      planVersion,
      bytes: xlsx.byteLength,
    });
    const suffix = planVersion !== undefined ? `-v${planVersion}` : '';
    res.setHeader(
      'content-disposition',
      `attachment; filename="${fileSlug(data.project.name)}${suffix}.xlsx"`,
    );
    res.setHeader('content-length', String(xlsx.byteLength));
    res.end(xlsx);
  }

  /**
   * R4 — « les exports sensibles sont journalisés » (docs/12 § Règles critiques).
   *
   * Appelée APRÈS le rendu et AVANT l'envoi des octets : si l'écriture du journal
   * échoue, l'exception remonte, Nest répond 500 et le fichier n'est JAMAIS émis.
   * C'est le comportement exigé par ADR-0012 §6 R4 — pas d'export non traçable.
   * D'où `recordStrict()` et non `record()`, qui avale les erreurs.
   *
   * Le journal ne contient aucun montant ni contenu de rapport : acteur, rôle,
   * projet, format, version de plan et taille (docs/17 § Journalisation).
   */
  private async journaliserExport(input: {
    orgId: string;
    userId: string;
    role: OrgRole;
    projectId: string;
    format: 'pdf' | 'xlsx';
    planVersion: number | undefined;
    bytes: number;
  }): Promise<void> {
    await this.audit.recordStrict({
      organizationId: input.orgId,
      actorUserId: input.userId,
      actorRole: input.role,
      action: 'report.export',
      targetType: 'project',
      targetId: input.projectId,
      metadata: {
        format: input.format,
        planVersion: input.planVersion ?? null,
        bytes: input.bytes,
      },
    });
  }
}
