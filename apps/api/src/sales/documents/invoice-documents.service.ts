// Documents PDF des factures et avoirs — ADR-0025 § 7 et § 8.
//
// - Original (`original`) : reproduit à l'identique depuis le contenu figé,
//   autant de fois que demandé ; jamais « DUPLICATA » ; rien au journal
//   électronique ; audit STRICT (un export non tracé n'est pas émis, ADR-0012 R4).
// - Duplicata (`duplicate`) : document final seulement ; le PDF est rendu
//   AVANT l'incrément, puis `duplicateCount` est incrémenté de façon atomique
//   et CONDITIONNELLE (valeur lue) avec l'entrée de journal `duplicate_issued`,
//   dans une transaction. Un duplicata concurrent fait recommencer le rendu avec
//   le numéro suivant. Un rendu refusé ou en échec ne consomme aucun numéro.
//
// SEUL ÉCRIVAIN de `duplicateCount` (test de lecture des sources). Ne touche à
// aucun champ figé, ni à `revision`.

import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { BrandingService } from '../../branding/branding.service.js';
import { inFiscalTransactionWithReplay } from '../../fiscal/fiscal-transaction.js';
import { FiscalProfileService } from '../../fiscal/fiscal-profile.service.js';
import { NormalizedInvoicingStateReader } from '../../fiscal/normalized-invoicing-state.reader.js';
import { APP_VERSION } from '../../health/app-version.js';
import { OrganizationsService } from '../../organizations/organizations.service.js';
import { PdfRenderingService } from '../../reports/pdf-rendering.service.js';
import { isObjectIdHex } from '../search.js';
import { InvoiceJournalService } from '../invoices/invoice-journal.service.js';
import { SalesInvoice, type SalesInvoiceDocument } from '../invoices/invoice.schema.js';
import type { InvoiceActor, InvoiceLean, StoredSeller } from '../invoices/invoice.types.js';
import { invoiceNotFound } from '../invoices/invoices.errors.js';
import {
  DocumentNotPrintableError,
  buildInvoiceDocument,
  type InvoiceDocumentModel,
} from './invoice-document.model.js';
import { qrCodeSvg } from './invoice-qr.js';
import { sampleInvoice } from './sample-invoice.js';
import { TemplateDgiContentError } from './templates/dgi-content.js';
import { latestTemplate, templateAt } from './templates/registry.js';
import {
  renderDocumentHtml,
  type RenderedDocumentHtml,
  type ResolvedPresentation,
} from './templates/template-engine.js';
import type {
  FrozenPresentation,
  InvoiceTemplateId,
  TemplateOptions,
} from './templates/template.contract.js';

/** Essais d'un duplicata face à des duplicatas concurrents. */
const DUPLICATE_ATTEMPTS = 3;

export interface RenderedInvoiceDocument {
  pdf: Buffer;
  fileName: string;
  duplicateNumber: number | null;
}

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

/** Page A4 à 96 ppp, densité 1,5 : vignette nette d'un aperçu de modèle. */
const PREVIEW_PAGE = { width: 794, height: 1123, deviceScaleFactor: 1.5 } as const;

/** Nom et version du modèle, imprimés en pied ; `null` : présentation d'origine. */
function layoutOf(p: FrozenPresentation | null): { label: string; version: string } | null {
  if (!p) return null;
  const t = templateAt(p.template.id, p.template.version);
  return { label: t?.label ?? p.template.id, version: p.template.version };
}

function notPrintable(err: DocumentNotPrintableError): never {
  throw new ConflictException({
    code: 'DOCUMENT_NOT_PRINTABLE',
    message: err.message,
    ...(err.issues.length > 0 ? { details: { issues: err.issues } } : {}),
  });
}

@Injectable()
export class InvoiceDocumentsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoiceDocument>,
    @Inject(InvoiceJournalService) private readonly journal: InvoiceJournalService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FiscalProfileService) private readonly profiles: FiscalProfileService,
    @Inject(NormalizedInvoicingStateReader) private readonly state: NormalizedInvoicingStateReader,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(PdfRenderingService) private readonly pdf: PdfRenderingService,
    @Inject(BrandingService) private readonly branding: BrandingService,
  ) {}

  private async load(organizationId: string, invoiceId: string): Promise<InvoiceLean> {
    if (!isObjectIdHex(invoiceId)) invoiceNotFound();
    const doc = await this.invoices
      .findOne({ _id: new Types.ObjectId(invoiceId), organizationId })
      .lean<InvoiceLean>()
      .exec();
    if (!doc) invoiceNotFound();
    return doc;
  }

  /** Contenu imprimé (exposé pour les tests e2e et l'aperçu). */
  async model(
    organizationId: string,
    doc: InvoiceLean,
    duplicateNumber: number | null,
    presentation: FrozenPresentation | null = null,
  ): Promise<InvoiceDocumentModel> {
    let draftSeller: StoredSeller | null = null;
    let draftInTestEnvironment = false;
    let organizationName = 'Organisation';
    if (!doc.seller) {
      const profile = await this.profiles.find(organizationId);
      if (profile) {
        draftSeller = {
          legalName: profile.legalName,
          tradeName: profile.tradeName,
          nif: profile.nif,
          rccm: profile.rccm,
          address: headOfficeAddress(profile.headOffice),
          phone: profile.phone,
          email: profile.email,
          vatRegistered: profile.vatRegistered,
        };
      } else {
        const org = await this.organizations.findOrgById(organizationId).catch(() => null);
        if (org?.name) organizationName = org.name;
      }
    }
    if (doc.status === 'draft') {
      const settings = await this.state.read(organizationId);
      draftInTestEnvironment = settings.state === 'enabled' && settings.environment === 'test';
    }
    try {
      return buildInvoiceDocument(doc, {
        duplicateNumber,
        draftSeller,
        organizationName,
        draftInTestEnvironment,
        currentSoftwareVersion: APP_VERSION.version,
        layout: layoutOf(presentation),
      });
    } catch (err) {
      if (err instanceof DocumentNotPrintableError) notPrintable(err);
      throw err;
    }
  }

  /**
   * Présentation d'un document (ADR-0028 § 6) : celle FIGÉE au gel pour un
   * document gelé (absente : présentation d'origine) ; pour un brouillon, le
   * modèle choisi AUJOURD'HUI par l'organisation.
   */
  async presentationOf(
    organizationId: string,
    doc: InvoiceLean,
  ): Promise<FrozenPresentation | null> {
    if (doc.status === 'draft') return this.branding.presentationToFreeze(organizationId);
    return doc.presentation ?? null;
  }

  /** HTML imprimé, en-tête et pied (déterministes pour un même document figé). */
  async html(
    organizationId: string,
    model: InvoiceDocumentModel,
    presentation: FrozenPresentation | null,
  ): Promise<RenderedDocumentHtml> {
    const qr = model.security ? await qrCodeSvg(model.security.qrContent) : null;
    const resolved: ResolvedPresentation | null = presentation
      ? await this.branding.resolveForRender(organizationId, presentation)
      : null;
    try {
      return renderDocumentHtml(model, qr, resolved);
    } catch (err) {
      if (err instanceof TemplateDgiContentError) {
        // Défaut d'un MODÈLE, jamais du document : on refuse d'imprimer plutôt
        // que de produire une facture privée d'une mention obligatoire.
        throw new InternalServerErrorException({
          code: 'TEMPLATE_DGI_CONTENT_MISSING',
          message: err.message,
        });
      }
      throw err;
    }
  }

  private async render(
    organizationId: string,
    model: InvoiceDocumentModel,
    presentation: FrozenPresentation | null,
  ): Promise<Buffer> {
    const r = await this.html(organizationId, model, presentation);
    return this.pdf.render(r.html, {
      margin: r.margin,
      fixedDate: model.fixedDate,
      headerTemplate: r.headerTemplate,
      footerTemplate: r.footerTemplate,
    });
  }

  /**
   * Aperçu d'un modèle (ADR-0028 § 8) : document FICTIF marqué EXEMPLE, au nom
   * et aux couleurs de l'organisation, rendu par le vrai moteur. Rien n'est
   * enregistré ni journalisé au journal électronique.
   */
  async preview(
    organizationId: string,
    templateId: InvoiceTemplateId,
    override: Partial<TemplateOptions>,
    format: 'pdf' | 'png' = 'pdf',
  ): Promise<{ body: Buffer; fileName: string; contentType: string }> {
    const presentation = await this.branding.presentationForPreview(
      organizationId,
      templateId,
      override,
    );
    const doc = sampleInvoice(organizationId);
    const seller = await this.currentSeller(organizationId);
    const model = buildInvoiceDocument(
      { ...doc, seller: seller ?? doc.seller },
      {
        duplicateNumber: null,
        draftSeller: null,
        organizationName: 'Organisation',
        draftInTestEnvironment: false,
        layout: layoutOf(presentation),
        sample: true,
      },
    );
    const base = `apercu-modele-${latestTemplate(templateId).id}`;
    if (format === 'pdf') {
      const pdf = await this.render(organizationId, model, presentation);
      return { body: pdf, fileName: `${base}.pdf`, contentType: 'application/pdf' };
    }
    // Vignette : première page, mêmes HTML et confinement que le PDF. Les marges
    // de page (`@page`) ne s'appliquent pas à une capture : on les pose en padding.
    const r = await this.html(organizationId, model, presentation);
    const m = r.margin;
    const html = r.html.replace(
      '</head>',
      `<style>body{padding:${m.top} ${m.right} 0 ${m.left}}</style></head>`,
    );
    const png = await this.pdf.renderPng(html, PREVIEW_PAGE);
    return { body: png, fileName: `${base}.png`, contentType: 'image/png' };
  }

  /** Fiche vendeur courante (fiche fiscale), ou `null`. */
  private async currentSeller(organizationId: string): Promise<StoredSeller | null> {
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

  async original(
    organizationId: string,
    invoiceId: string,
    actor: InvoiceActor,
  ): Promise<RenderedInvoiceDocument> {
    const doc = await this.load(organizationId, invoiceId);
    const presentation = await this.presentationOf(organizationId, doc);
    const model = await this.model(organizationId, doc, null, presentation);
    const pdf = await this.render(organizationId, model, presentation);
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'sales_invoice.pdf_exported',
      targetType: 'sales_invoice',
      targetId: invoiceId,
      metadata: {
        documentKind: model.kind,
        status: doc.status,
        type: doc.type,
        reference: model.reference.value,
        test: model.test !== null,
        template: presentation
          ? `${presentation.template.id}@${presentation.template.version}`
          : null,
        bytes: pdf.byteLength,
      },
    });
    return { pdf, fileName: model.fileName, duplicateNumber: null };
  }

  async duplicate(
    organizationId: string,
    invoiceId: string,
    actor: InvoiceActor,
  ): Promise<RenderedInvoiceDocument> {
    for (let attempt = 0; attempt < DUPLICATE_ATTEMPTS; attempt += 1) {
      const doc = await this.load(organizationId, invoiceId);
      if (doc.status !== 'issued' && doc.status !== 'normalized') {
        throw new ConflictException({
          code: 'DUPLICATE_NOT_ALLOWED',
          message:
            'Seule une facture émise ou normalisée a un duplicata ; un pro forma n’en a pas.',
          details: { status: doc.status },
        });
      }
      const current = doc.duplicateCount ?? 0;
      const k = current + 1;
      // Un duplicata est une copie de l'original : même présentation FIGÉE.
      const presentation = doc.presentation ?? null;
      let model: InvoiceDocumentModel;
      try {
        model = buildInvoiceDocument(doc, {
          duplicateNumber: k,
          draftSeller: null,
          organizationName: 'Organisation',
          draftInTestEnvironment: false,
          layout: layoutOf(presentation),
        });
      } catch (err) {
        if (err instanceof DocumentNotPrintableError) {
          // Verrou ADR-0024 : un `normalized` sans éléments se lit pro forma.
          throw new ConflictException({
            code: 'DUPLICATE_NOT_ALLOWED',
            message: err.message,
          });
        }
        throw err;
      }
      if (model.kind !== 'invoice') {
        throw new ConflictException({
          code: 'DUPLICATE_NOT_ALLOWED',
          message: 'Ce document n’est pas une facture finale : pas de duplicata.',
        });
      }
      // Rendu AVANT l'incrément : un rendu refusé ne consomme aucun numéro.
      const pdf = await this.render(organizationId, model, presentation);

      const committed = await inFiscalTransactionWithReplay(this.connection, async (session) => {
        const res = await this.invoices
          .updateOne(
            {
              _id: doc._id,
              organizationId,
              status: { $in: ['issued', 'normalized'] },
              duplicateCount: current,
            },
            { $inc: { duplicateCount: 1 } },
            { session, timestamps: false },
          )
          .exec();
        if (res.matchedCount !== 1) return false;
        // Même forme que les autres entrées (`invoice-freezing.service.ts`).
        const totals = doc.documentAmounts.calculation.totals;
        const n = doc.normalizedAmounts;
        await this.journal.append(
          organizationId,
          {
            event: 'duplicate_issued',
            invoiceId: String(doc._id),
            proformaRef: doc.proformaRef,
            number: doc.number ?? null,
            series: doc.series ?? null,
            type: doc.type,
            creditNature: doc.creditNote?.nature ?? null,
            originNumber: doc.creditNote?.originNumber ?? null,
            documentTotals: totals
              ? { currency: doc.currency, total: totals.total, vatTotal: totals.vatTotal }
              : null,
            normalizedTotals: n
              ? {
                  total: n.calculation.total,
                  vatTotal: n.calculation.vatTotal,
                  specificTax: n.calculation.specificTax,
                }
              : null,
            conversion: doc.conversion
              ? {
                  rate: doc.conversion.rate,
                  rateDate: doc.conversion.rateDate,
                  rateSource: doc.conversion.rateSource,
                }
              : null,
            contentSha256: doc.contentSha256 ?? null,
            codeDefDgi: doc.normalization?.codeDefDgi ?? null,
            nim: doc.normalization?.nim ?? null,
            counters: doc.normalization?.counters ?? null,
            actor: { userId: actor.userId, name: actor.name },
          },
          { session },
        );
        await this.audit.record(
          {
            organizationId,
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: 'sales_invoice.duplicate_issued',
            targetType: 'sales_invoice',
            targetId: invoiceId,
            metadata: {
              number: doc.number ?? null,
              type: doc.type,
              duplicateNumber: k,
              mode: doc.emissionMode ?? null,
            },
          },
          { session },
        );
        return true;
      });
      if (committed) return { pdf, fileName: model.fileName, duplicateNumber: k };
    }
    throw new ConflictException({
      code: 'DUPLICATE_CONFLICT',
      message: 'D’autres duplicatas de ce document sont en cours : réessayez.',
    });
  }
}
