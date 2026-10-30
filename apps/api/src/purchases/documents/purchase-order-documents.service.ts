// Bon de commande PDF et envoi au fournisseur — ADR-0044 § 3.3 (étend ADR-0042).
// ADR-0044 — P3.
//
// Contenu : `buildPurchaseOrderDocument` (pur). Présentation : le modèle choisi
// AUJOURD'HUI par l'organisation (ADR-0028), rendu par le même moteur que les
// factures et les devis, avec la même vérification des mentions
// (`InvoiceDocumentsService.html`). Export journalisé en audit STRICT
// (`purchase_order.pdf_exported`).
//
// Envoi : EXACTEMENT le chemin d'ADR-0042 (`DocumentEmailService`) — audit strict
// `purchase_order.email_requested` AVANT (échec ⇒ rien ne part), remise au
// transport, `purchase_order.emailed` après, même seau de débit (contrôleur).
// Envoyable aux statuts `approved` et `sent` (sinon `409 DOCUMENT_NOT_SENDABLE`) ;
// un envoi réussi d'une commande `approved` la passe à `sent` (`sentVia: 'email'`,
// décision ouverte n° 8). Destinataire prérempli : le contact principal du
// fournisseur, sinon l'adresse de la fiche.

import { ConflictException, Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../authz/audit.service.js';
import { BrandingService } from '../../branding/branding.service.js';
import { FiscalProfileService } from '../../fiscal/fiscal-profile.service.js';
import { APP_VERSION } from '../../health/app-version.js';
import { OrganizationsService } from '../../organizations/organizations.service.js';
import { PdfRenderingService } from '../../reports/pdf-rendering.service.js';
import {
  documentEmailDefaults,
  type DocumentEmailDraft,
  type DocumentEmailInput,
  type DocumentEmailResult,
} from '../../sales/documents/document-email.js';
import {
  DocumentEmailService,
  type DocumentEmailSender,
} from '../../sales/documents/document-email.service.js';
import {
  DocumentNotPrintableError,
  type InvoiceDocumentModel,
} from '../../sales/documents/invoice-document.model.js';
import {
  InvoiceDocumentsService,
  notSendable,
} from '../../sales/documents/invoice-documents.service.js';
import { templateAt } from '../../sales/documents/templates/registry.js';
import type { FrozenPresentation } from '../../sales/documents/templates/template.contract.js';
import type { StoredSeller } from '../../sales/invoices/invoice.types.js';
import { SENDABLE_STATUSES, isPrintableOrder } from '../orders/purchase-order-model.js';
import type { PurchaseOrderLean } from '../orders/purchase-order.schema.js';
import {
  PurchaseOrdersService,
  type PurchaseOrderActor,
} from '../orders/purchase-orders.service.js';
import type { SupplierLean } from '../suppliers/supplier.schema.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import {
  buildPurchaseOrderDocument,
  type PurchaseOrderSupplierInfo,
} from './purchase-order-document.model.js';

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

/** Ce que le bon de commande lit de la fiche : jamais les moyens de paiement. */
function supplierInfoOf(s: SupplierLean): PurchaseOrderSupplierInfo {
  const t = s.paymentTerms ?? { kind: 'immediate' };
  return {
    name: s.name,
    nif: s.nif ?? null,
    address: s.address ?? null,
    phone: s.phone ?? null,
    email: s.email ?? null,
    paymentTerms:
      t.kind === 'immediate' ? { kind: 'immediate' } : { kind: t.kind, days: t.days ?? 0 },
  };
}

/** Adresse préremplie : contact principal, sinon l'adresse de la fiche. */
function recipientOf(s: SupplierLean): string | null {
  const primary = (s.contacts ?? []).find((c) => c.isPrimary && c.email);
  return primary?.email ?? s.email ?? null;
}

@Injectable()
export class PurchaseOrderDocumentsService {
  constructor(
    @Inject(PurchaseOrdersService) private readonly orders: PurchaseOrdersService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(InvoiceDocumentsService) private readonly documents: InvoiceDocumentsService,
    @Inject(BrandingService) private readonly branding: BrandingService,
    @Inject(FiscalProfileService) private readonly profiles: FiscalProfileService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(PdfRenderingService) private readonly renderer: PdfRenderingService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DocumentEmailService) private readonly emailer: DocumentEmailService,
  ) {}

  private async buyer(organizationId: string): Promise<StoredSeller | null> {
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

  /** Contenu imprimé (sans rendu) ; `409 DOCUMENT_NOT_PRINTABLE` pour une demande. */
  private async prepare(organizationId: string, orderId: string) {
    const o = await this.orders.requireOwn(organizationId, orderId);
    if (!isPrintableOrder(o) || o.supplierId === null) {
      throw new ConflictException({
        code: 'DOCUMENT_NOT_PRINTABLE',
        message:
          'Une demande non approuvée n’a pas de bon de commande : faites-la approuver d’abord.',
        details: { status: o.status },
      });
    }
    const [buyer, presentation, supplier] = await Promise.all([
      this.buyer(organizationId),
      this.branding.presentationToFreeze(organizationId),
      this.suppliers.requireOwn(organizationId, o.supplierId),
    ]);
    let organizationName = 'Organisation';
    if (!buyer) {
      const org = await this.organizations.findOrgById(organizationId).catch(() => null);
      if (org?.name) organizationName = org.name;
    }
    let model: InvoiceDocumentModel;
    try {
      model = buildPurchaseOrderDocument(o, {
        buyer,
        organizationName,
        supplier: supplierInfoOf(supplier),
        softwareVersion: APP_VERSION.version,
        layout: layoutOf(presentation),
      });
    } catch (err) {
      if (err instanceof DocumentNotPrintableError) {
        throw new ConflictException({ code: 'DOCUMENT_NOT_PRINTABLE', message: err.message });
      }
      throw err;
    }
    return { o, supplier, presentation, model };
  }

  private async renderModel(
    organizationId: string,
    model: InvoiceDocumentModel,
    presentation: FrozenPresentation | null,
  ): Promise<Buffer> {
    const r = await this.documents.html(organizationId, model, presentation);
    return this.renderer.render(r.html, {
      margin: r.margin,
      fixedDate: model.fixedDate,
      headerTemplate: r.headerTemplate,
      footerTemplate: r.footerTemplate,
    });
  }

  async pdf(
    organizationId: string,
    orderId: string,
    actor: { userId: string; role: string },
  ): Promise<{ pdf: Buffer; fileName: string }> {
    const { o, presentation, model } = await this.prepare(organizationId, orderId);
    const pdf = await this.renderModel(organizationId, model, presentation);
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'purchase_order.pdf_exported',
      targetType: 'purchase_order',
      targetId: orderId,
      metadata: {
        orderNumber: o.orderNumber,
        status: o.status,
        template: presentation
          ? `${presentation.template.id}@${presentation.template.version}`
          : null,
        bytes: pdf.byteLength,
      },
    });
    return { pdf, fileName: model.fileName };
  }

  /** Valeurs préremplies de l'envoi (ADR-0042 § 3) ; aucun rendu, aucune écriture. */
  async emailDraft(
    organizationId: string,
    orderId: string,
    senderName: string,
  ): Promise<DocumentEmailDraft> {
    const o = await this.orders.requireOwn(organizationId, orderId);
    let prepared: Awaited<ReturnType<PurchaseOrderDocumentsService['prepare']>>;
    try {
      prepared = await this.prepare(organizationId, orderId);
    } catch (err) {
      if (err instanceof ConflictException) {
        const body = err.getResponse() as { message?: string };
        return {
          sendable: false,
          reason: body.message ?? 'Ce bon de commande ne peut pas être imprimé.',
          nature: null,
          to: null,
          cc: [],
          subject: '',
          message: '',
          attachmentName: null,
        };
      }
      throw err;
    }
    const { supplier, model } = prepared;
    const reason = sendabilityReason(o);
    const defaults = documentEmailDefaults({
      nature: 'purchase_order',
      reference: model.reference.value,
      sellerName: model.seller.title,
      total: model.total,
      currency: model.currency,
      senderName,
    });
    return {
      sendable: reason === null,
      reason,
      nature: reason === null ? 'purchase_order' : null,
      to: recipientOf(supplier),
      cc: [],
      ...defaults,
      attachmentName: model.fileName,
    };
  }

  /** Envoi par e-mail (ADR-0042) : même rendu que le téléchargement, PDF joint. */
  async email(
    organizationId: string,
    orderId: string,
    sender: DocumentEmailSender,
    actor: PurchaseOrderActor,
    input: DocumentEmailInput,
  ): Promise<DocumentEmailResult> {
    // Envoyable d'abord (§ 3.3) : une demande non approuvée répond `DOCUMENT_NOT_SENDABLE`.
    const current = await this.orders.requireOwn(organizationId, orderId);
    const reason = sendabilityReason(current);
    if (reason !== null) notSendable(reason, current.status);
    const { o, presentation, model } = await this.prepare(organizationId, orderId);
    const pdf = await this.renderModel(organizationId, model, presentation);
    const result = await this.emailer.send({
      organizationId,
      sender,
      target: {
        type: 'purchase_order',
        id: orderId,
        reference: model.reference.value,
        nature: 'purchase_order',
        status: o.status,
      },
      sellerName: model.seller.title,
      pdf,
      fileName: model.fileName,
      input,
    });
    // L'envoi EST ici le geste de transmission (décision ouverte n° 8).
    if (result.delivered) await this.orders.markSentByEmail(organizationId, orderId, actor);
    return result;
  }
}

function sendabilityReason(o: PurchaseOrderLean): string | null {
  if (SENDABLE_STATUSES.includes(o.status)) return null;
  if (o.status === 'cancelled')
    return 'Cette commande est annulée : elle ne peut plus être envoyée.';
  return 'Seule une commande approuvée ou déjà envoyée part au fournisseur.';
}
