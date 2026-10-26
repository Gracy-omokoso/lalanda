// PDF d'un devis — ADR-0035 § 1.
//
// Contenu : `buildQuoteDocument` (pur). Présentation : le modèle de facture
// choisi AUJOURD'HUI par l'organisation (ADR-0028), rendu par le même moteur que
// les factures, avec la même vérification des mentions (`InvoiceDocumentsService.html`).
// Export journalisé en audit STRICT, comme le PDF d'une facture.

import { ConflictException, Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../authz/audit.service.js';
import { BrandingService } from '../../branding/branding.service.js';
import { FiscalProfileService } from '../../fiscal/fiscal-profile.service.js';
import { APP_VERSION } from '../../health/app-version.js';
import { kinshasaDay } from '../../crm/crm-model.js';
import { OrganizationsService } from '../../organizations/organizations.service.js';
import { PdfRenderingService } from '../../reports/pdf-rendering.service.js';
import { InvoiceDocumentsService } from '../documents/invoice-documents.service.js';
import { DocumentNotPrintableError } from '../documents/invoice-document.model.js';
import { templateAt } from '../documents/templates/registry.js';
import type { FrozenPresentation } from '../documents/templates/template.contract.js';
import type { InvoiceActor, StoredSeller } from '../invoices/invoice.types.js';
import { buildQuoteDocument } from './quote-document.model.js';
import { quoteStatusOf } from './quote-model.js';
import { QuotesService } from './quotes.service.js';

function headOfficeAddress(h: {
  line1: string;
  line2: string | null;
  commune: string | null;
  city: string;
  province: string | null;
  country: string;
}): string {
  return [h.line1, h.line2, h.commune, h.city, h.province, h.country]
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .join(', ');
}

function layoutOf(p: FrozenPresentation | null): { label: string; version: string } | null {
  if (!p) return null;
  const t = templateAt(p.template.id, p.template.version);
  return { label: t?.label ?? p.template.id, version: p.template.version };
}

@Injectable()
export class QuoteDocumentsService {
  constructor(
    @Inject(QuotesService) private readonly quotes: QuotesService,
    @Inject(InvoiceDocumentsService) private readonly documents: InvoiceDocumentsService,
    @Inject(BrandingService) private readonly branding: BrandingService,
    @Inject(FiscalProfileService) private readonly profiles: FiscalProfileService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(PdfRenderingService) private readonly renderer: PdfRenderingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async seller(organizationId: string): Promise<StoredSeller | null> {
    const profile = await this.profiles.find(organizationId);
    if (!profile) return null;
    return {
      legalName: profile.legalName,
      tradeName: profile.tradeName,
      nif: profile.nif,
      rccm: profile.rccm,
      address: headOfficeAddress(profile.headOffice),
      phone: profile.phone,
      email: profile.email,
      vatRegistered: profile.vatRegistered,
    };
  }

  async pdf(
    organizationId: string,
    quoteId: string,
    actor: InvoiceActor,
  ): Promise<{ pdf: Buffer; fileName: string }> {
    const q = await this.quotes.requireOwn(organizationId, quoteId);
    const [seller, presentation] = await Promise.all([
      this.seller(organizationId),
      this.branding.presentationToFreeze(organizationId),
    ]);
    let organizationName = 'Organisation';
    if (!seller) {
      const org = await this.organizations.findOrgById(organizationId).catch(() => null);
      if (org?.name) organizationName = org.name;
    }
    const status = quoteStatusOf(q.status, q.validUntil, kinshasaDay(new Date()));
    let model;
    try {
      model = buildQuoteDocument(q, {
        seller,
        organizationName,
        status,
        softwareVersion: APP_VERSION.version,
        layout: layoutOf(presentation),
      });
    } catch (err) {
      if (err instanceof DocumentNotPrintableError) {
        throw new ConflictException({
          code: 'DOCUMENT_NOT_PRINTABLE',
          message: err.message,
          ...(err.issues.length > 0 ? { details: { issues: err.issues } } : {}),
        });
      }
      throw err;
    }
    const r = await this.documents.html(organizationId, model, presentation);
    const pdf = await this.renderer.render(r.html, {
      margin: r.margin,
      fixedDate: model.fixedDate,
      headerTemplate: r.headerTemplate,
      footerTemplate: r.footerTemplate,
    });
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'sales_quote.pdf_exported',
      targetType: 'sales_quote',
      targetId: quoteId,
      metadata: {
        number: q.number,
        version: q.version,
        status,
        template: presentation
          ? `${presentation.template.id}@${presentation.template.version}`
          : null,
        bytes: pdf.byteLength,
      },
    });
    return { pdf, fileName: model.fileName };
  }
}
