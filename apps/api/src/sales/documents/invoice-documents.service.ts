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

import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
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
import {
  invoiceFooterTemplate,
  invoiceHeaderTemplate,
  renderInvoiceDocumentHtml,
} from './invoice-document-html.js';
import { qrCodeSvg } from './invoice-qr.js';

/** Marges de page : en-tête et pied répétés y sont rendus. */
const PAGE_MARGIN = { top: '16mm', bottom: '18mm', left: '12mm', right: '12mm' } as const;

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
      });
    } catch (err) {
      if (err instanceof DocumentNotPrintableError) notPrintable(err);
      throw err;
    }
  }

  /** HTML imprimé (déterministe pour un même document figé). */
  async html(model: InvoiceDocumentModel): Promise<string> {
    const qr = model.security ? await qrCodeSvg(model.security.qrContent) : null;
    return renderInvoiceDocumentHtml(model, qr);
  }

  private async render(model: InvoiceDocumentModel): Promise<Buffer> {
    const html = await this.html(model);
    return this.pdf.render(html, {
      margin: PAGE_MARGIN,
      fixedDate: model.fixedDate,
      headerTemplate: invoiceHeaderTemplate(model),
      footerTemplate: invoiceFooterTemplate(model),
    });
  }

  async original(
    organizationId: string,
    invoiceId: string,
    actor: InvoiceActor,
  ): Promise<RenderedInvoiceDocument> {
    const doc = await this.load(organizationId, invoiceId);
    const model = await this.model(organizationId, doc, null);
    const pdf = await this.render(model);
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
      let model: InvoiceDocumentModel;
      try {
        model = buildInvoiceDocument(doc, {
          duplicateNumber: k,
          draftSeller: null,
          organizationName: 'Organisation',
          draftInTestEnvironment: false,
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
      const pdf = await this.render(model);

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
