// Contrats clients — ADR-0050 § 2.3, § 2.4, § 3, § 4.1, § 5.3. ADR-0050 — V3.
//
// - Le document du contrat (client, devise, lignes, montants indicatifs) est composé et
//   calculé par LE MÊME code que le brouillon de facture (`InvoiceDraftsService.compose`
//   → moteur `invoice-totals`) ; les lignes de chaque échéance d'un `schedule` aussi.
//   Aucune opération sur un montant ici ; aucune facture n'est créée par ce lot.
// - Cycle : draft → submitted → approved (validation INTERNE, séparation des tâches par
//   `contractApprovalDecision`, approbateur unique toléré) → signed (copie PDF signée
//   TÉLÉVERSÉE, signature DÉCLARÉE ; empreinte `contentSha256`) → terminated ; ou
//   cancelled. Une version soumise ou approuvée ne se modifie plus : « Nouvelle version »
//   l'archive ; un contrat signé ne se modifie plus : on passe par un avenant.
// - Dates (fin de terme, date limite de préavis, terme suivant proposé) : moteur
//   `contracts` (`termsAt`, `contractTerms`, `noticeCheck`), à partir des CLAUSES
//   SAISIES ; Lalanda n'en juge jamais la validité juridique. La reconduction tacite
//   n'est jamais appliquée seule : un détenteur de `sales.contract.approve` la CONSTATE.
// - La résiliation compare la notification au préavis saisi (`noticeCheck`) et
//   l'AFFICHE ; elle n'est jamais refusée pour cela.
//
// Isolation : chaque requête porte `organizationId` ; une ressource d'une autre
// organisation répond 404. Concurrence : chaque écriture est conditionnée par la
// révision attendue (`409 STALE_REVISION`). Chaque geste est audité.

import {
  contractTerms,
  noticeCheck,
  termsAt,
  type ContractTermsResult,
  type RecordedRenewal,
} from '@lalanda/engine';
import {
  SALES_CONTRACT_CLAUSES_BANNER,
  SALES_CONTRACT_NOTICE_CHECK_LABELS,
  SALES_CONTRACT_NUMBER_PREFIX,
  type SalesContractFileKind,
  type SalesContractSettingsValues,
} from '@lalanda/shared/sales-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService, type AuditMetadataValue } from '../../../authz/audit.service.js';
import { AuthzService } from '../../../authz/authz.service.js';
import { contractApprovalDecision } from '../../../authz/permissions.js';
import { addDays, kinshasaDay } from '../../../crm/crm-model.js';
import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from '../../../crm/time-cursor.js';
import { InvoiceDraftsService } from '../../invoices/invoice-drafts.service.js';
import type { InvoiceActor, StoredLine } from '../../invoices/invoice.types.js';
import type { InvoiceDraftInput, LineInput } from '../../invoices/invoices.dto.js';
import { lineInputOf } from '../../quotes/quotes.service.js';
import { conflict, invalidCursor, staleRevision } from '../../sales.errors.js';
import { escapeRegex, isObjectIdHex, normalizeForSearch, searchKeyOf } from '../../search.js';
import {
  READ_ONLY_COLLECTIONS,
  contractsNotFound,
  nextEngagementNumber,
  unprocessable,
  type EngagementCounter,
} from '../common/contracts.common.js';
import {
  engagementDocumentOf,
  storedLineOf,
  type EngagementDocument,
  type EngagementLine,
} from '../common/engagement-document.js';
import {
  SalesContractFile,
  type SalesContractFileDocument,
  type SalesContractFileLean,
} from '../files/sales-contract-file.schema.js';
import {
  SalesContractFilesService,
  salesContractFileView,
  type SalesContractFileView,
} from '../files/sales-contract-files.service.js';
import { SalesDocumentLinksService } from '../links/sales-document-links.service.js';
import { SalesContractSettingsService } from '../settings/sales-contract-settings.service.js';
import {
  SalesContractAmendment,
  type SalesContractAmendmentDocument,
  type SalesContractAmendmentLean,
} from '../amendments/sales-contract-amendment.schema.js';
import {
  SALES_CONTRACT_AMENDMENT_STATUS_LABELS,
  SALES_CONTRACT_DERIVED_LABELS,
  SALES_CONTRACT_STATUS_LABELS,
  amendmentNumberOf,
  contractSha256,
  draftInputForLines,
  engineAmendmentOf,
  engineContractOf,
  neverSubmitted,
  salesContractActionsOf,
  type SalesContractActions,
} from './sales-contract-model.js';
import {
  SalesContract,
  SalesContractCounter,
  type SalesContractCounterDocument,
  type SalesContractDocument,
  type SalesContractLean,
  type SalesContractVersionSnapshot,
  type StoredApproval,
  type StoredContractBilling,
  type StoredRenewal,
  type StoredScheduleItem,
} from './sales-contract.schema.js';
import type {
  ListSalesContractsQuery,
  QuoteToContractInput,
  SalesContractBillingInput,
  SalesContractFileQuery,
  SalesContractInput,
} from './sales-contracts.dto.js';

export interface SalesContractWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SalesContractSummary {
  id: string;
  number: string;
  version: number;
  title: string;
  status: SalesContract['status'];
  statusLabel: string;
  /** Statut dérivé d'un contrat signé (`upcoming`, `in_force`, `expiring`, `ended`), sinon `null`. */
  derivedStatus: string | null;
  derivedStatusLabel: string | null;
  customerId: string;
  customerName: string | null;
  ownerUserId: string;
  opportunityId: string | null;
  source: SalesContract['source'];
  startDate: string;
  billingKind: StoredContractBilling['kind'];
  currency: 'CDF' | 'USD';
  priceMode: 'ttc' | 'ht';
  /** Total INDICATIF recopié du calcul du moteur (`null` sans calcul). */
  total: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

/** Conditions en vigueur et dates calculées par le moteur, à une date. */
export interface SalesContractTermsView {
  on: string;
  inForce: {
    initialTermMonths: number | null;
    renewal: SalesContract['renewal'];
    noticeDays: number;
    clauses: string | null;
    billingKind: StoredContractBilling['kind'];
    lines: EngagementLine[];
    appliedAmendments: number[];
    pendingAmendments: number[];
  };
  currentTerm: ContractTermsResult['currentTerm'];
  terms: ContractTermsResult['terms'];
  termElapsed: boolean;
  lastTermEnd: string | null;
  noticeDeadline: string | null;
  proposedNextTerm: ContractTermsResult['proposedNextTerm'];
  billableUntil: string | null;
  renewalsRecorded: number;
  issues: ContractTermsResult['issues'];
  /** Conventions de date fixées par le moteur (leur valeur juridique reste la question JU1). */
  conventions: string[];
}

export interface SalesContractAmendmentSummary {
  id: string;
  index: number;
  number: string;
  effectiveDate: string;
  purpose: SalesContractAmendmentLean['purpose'];
  status: SalesContractAmendmentLean['status'];
  statusLabel: string;
  revision: number;
}

export interface SalesContractView extends SalesContractSummary {
  customer: SalesContractLean['customer'];
  lines: (EngagementLine & { amount: string | null })[];
  lineInputs: LineInput[];
  documentAmounts: SalesContractLean['documentAmounts'];
  initialTermMonths: number | null;
  renewal: SalesContractLean['renewal'];
  noticeDays: number;
  billing: StoredContractBilling;
  clauses: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  approvals: (Omit<StoredApproval, 'at'> & { at: string })[];
  signature:
    | (Omit<NonNullable<SalesContractLean['signature']>, 'declaredAt'> & { declaredAt: string })
    | null;
  renewals: (Omit<StoredRenewal, 'recordedAt'> & { recordedAt: string })[];
  termination:
    | (Omit<NonNullable<SalesContractLean['termination']>, 'recordedAt'> & {
        recordedAt: string;
        noticeCheckLabel: string;
      })
    | null;
  cancellation: { at: string; by: string; reason: string } | null;
  projectId: string | null;
  contentSha256: string | null;
  previousVersions: {
    version: number;
    status: SalesContract['status'];
    archivedAt: string;
    archivedBy: string;
    total: string | null;
  }[];
  amendments: SalesContractAmendmentSummary[];
  /** Conditions en vigueur et dates (contrat signé ou résilié), sinon `null`. */
  terms: SalesContractTermsView | null;
  files: SalesContractFileView[];
  actions: SalesContractActions;
  /** Ce qui empêche de soumettre (brouillon seulement). */
  blockers: { code: string; message: string; lineIndex: number | null; path: string | null }[];
  warnings: SalesContractWarning[];
  /** Bandeau constant (§ 9). */
  banner: string;
}

export interface SalesContractPage {
  items: SalesContractSummary[];
  nextCursor: string | null;
}

export interface SalesContractWithWarnings {
  contract: SalesContractView;
  warnings: SalesContractWarning[];
}

interface QuoteRead {
  _id: Types.ObjectId;
  number: string;
  version: number;
  status: string;
  title: string | null;
  opportunityId: string | null;
  currency: 'CDF' | 'USD';
  priceMode: 'ttc' | 'ht';
  customer: SalesContractLean['customer'];
  lines: StoredLine[];
  conversion: { invoiceId: string } | null;
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** Conventions de date du moteur, rappelées à l'écran (critère 7). */
export const SALES_CONTRACT_DATE_CONVENTIONS = [
  'La fin d’un terme est la veille de son anniversaire (contrat du 15 janvier de 12 mois : fin le 14 janvier suivant).',
  'La date limite de préavis est la fin du terme moins le préavis saisi, en jours civils.',
  'La date d’effet d’une résiliation est le dernier jour couvert par le contrat.',
];

export function salesContractNotFound(): never {
  contractsNotFound('SALES_CONTRACT_NOT_FOUND', 'Contrat introuvable.');
}

export function contractNotInStatus(
  code: string,
  status: SalesContract['status'],
  action: string,
): never {
  conflict(
    code,
    `Action « ${action} » impossible : le contrat est « ${SALES_CONTRACT_STATUS_LABELS[
      status
    ].toLowerCase()} ».`,
    { status },
  );
}

@Injectable()
export class SalesContractsService {
  constructor(
    @InjectModel(SalesContract.name) private readonly contracts: Model<SalesContractDocument>,
    @InjectModel(SalesContractCounter.name)
    private readonly counters: Model<SalesContractCounterDocument>,
    @InjectModel(SalesContractAmendment.name)
    private readonly amendments: Model<SalesContractAmendmentDocument>,
    @InjectModel(SalesContractFile.name)
    private readonly fileMetas: Model<SalesContractFileDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(InvoiceDraftsService) private readonly drafts: InvoiceDraftsService,
    @Inject(SalesDocumentLinksService) private readonly links: SalesDocumentLinksService,
    @Inject(SalesContractFilesService) private readonly files: SalesContractFilesService,
    @Inject(SalesContractSettingsService) private readonly settings: SalesContractSettingsService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  async requireOwn(organizationId: string, contractId: string): Promise<SalesContractLean> {
    if (!isObjectIdHex(contractId)) salesContractNotFound();
    const doc = await this.contracts
      .findOne({ _id: new Types.ObjectId(contractId), organizationId })
      .lean<SalesContractLean>()
      .exec();
    if (!doc) salesContractNotFound();
    return doc;
  }

  /** Avenants d'un contrat, dans l'ordre des index. */
  async amendmentsOf(
    organizationId: string,
    contractId: string,
  ): Promise<SalesContractAmendmentLean[]> {
    return this.amendments
      .find({ organizationId, contractId })
      .sort({ index: 1 })
      .lean<SalesContractAmendmentLean[]>()
      .exec();
  }

  async list(organizationId: string, query: ListSalesContractsQuery): Promise<SalesContractPage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.status !== 'all') and.push({ status: query.status });
    if (query.billingKind) and.push({ 'billing.kind': query.billingKind });
    if (query.customerId) and.push({ customerId: query.customerId.toLowerCase() });
    if (query.quoteId) and.push({ 'source.quoteId': query.quoteId.toLowerCase() });
    if (query.q !== undefined) {
      const term = normalizeForSearch(query.q);
      if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    }
    if (query.cursor !== undefined) {
      const cursor = decodeTimeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(beforeTimeCursor('createdAt', cursor));
    }
    const docs = await this.contracts
      .find({ $and: and })
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<SalesContractLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const settings = await this.settings.values(organizationId);
    const today = kinshasaDay(new Date());
    const amendments = page.some((c) => c.status === 'signed' || c.status === 'terminated')
      ? await this.amendments
          .find({ organizationId, contractId: { $in: page.map((c) => String(c._id)) } })
          .sort({ index: 1 })
          .lean<SalesContractAmendmentLean[]>()
          .exec()
      : [];
    const last = page[page.length - 1];
    return {
      items: page.map((c) =>
        this.summary(
          c,
          this.termsOf(
            c,
            amendments.filter((a) => a.contractId === String(c._id)),
            today,
            settings,
          ),
        ),
      ),
      nextCursor:
        docs.length > query.limit && last
          ? encodeTimeCursor(new Date(last.createdAt), String(last._id))
          : null,
    };
  }

  /** `GET /sales/contracts/:id` ; `on` : conditions en vigueur à cette date (défaut : aujourd'hui). */
  async view(organizationId: string, contractId: string, on?: string): Promise<SalesContractView> {
    return this.viewOf(organizationId, await this.requireOwn(organizationId, contractId), on);
  }

  /**
   * Dates du moteur pour un contrat signé ou résilié, à `on` ; `null` avant la signature
   * ou si une donnée est illisible (le moteur lève sur une entrée invalide).
   */
  termsOf(
    c: SalesContractLean,
    amendments: readonly SalesContractAmendmentLean[],
    on: string,
    settings: SalesContractSettingsValues,
  ): ContractTermsResult | null {
    if (c.status !== 'signed' && c.status !== 'terminated') return null;
    try {
      return contractTerms(
        engineContractOf(c),
        amendments.map(engineAmendmentOf),
        this.engineRenewals(c),
        c.termination
          ? { noticeGivenOn: c.termination.noticeGivenOn, effectiveOn: c.termination.effectiveOn }
          : null,
        on,
        { termEndAlertDays: settings.termEndAlertDays },
      );
    } catch {
      return null;
    }
  }

  engineRenewals(c: SalesContractLean): RecordedRenewal[] {
    return (c.renewals ?? []).map((r) => ({
      termIndex: r.termIndex,
      from: r.from,
      to: r.to,
      mode: r.mode,
    }));
  }

  private summary(c: SalesContractLean, terms: ContractTermsResult | null): SalesContractSummary {
    const derived = c.status === 'signed' && terms ? terms.status : null;
    return {
      id: String(c._id),
      number: c.number,
      version: c.version,
      title: c.title,
      status: c.status,
      statusLabel: SALES_CONTRACT_STATUS_LABELS[c.status],
      derivedStatus: derived,
      derivedStatusLabel: derived ? (SALES_CONTRACT_DERIVED_LABELS[derived] ?? null) : null,
      customerId: c.customerId,
      customerName: c.customer.name ?? null,
      ownerUserId: c.ownerUserId,
      opportunityId: c.opportunityId ?? null,
      source: c.source ?? null,
      startDate: c.startDate,
      billingKind: c.billing.kind,
      currency: c.currency,
      priceMode: c.priceMode,
      total: c.documentAmounts.calculation.totals?.total ?? null,
      createdAt: new Date(c.createdAt).toISOString(),
      updatedAt: new Date(c.updatedAt).toISOString(),
      revision: c.revision,
    };
  }

  /** Ce qui empêche de soumettre : calcul du document et de chaque échéance. */
  private async blockersOf(
    organizationId: string,
    c: SalesContractLean,
  ): Promise<SalesContractView['blockers']> {
    const blockers: SalesContractView['blockers'] = [];
    const check = (
      doc: { lines: EngagementLine[]; documentAmounts: SalesContractLean['documentAmounts'] },
      path: string | null,
    ) => {
      if (doc.lines.length === 0) {
        blockers.push({
          code: 'NO_LINES',
          message: 'Ajoutez au moins une ligne.',
          lineIndex: null,
          path,
        });
        return;
      }
      const calc = doc.documentAmounts.calculation;
      if (!calc.ok && calc.issues.length === 0) {
        blockers.push({
          code: 'TAX_RATES_UNAVAILABLE',
          message: 'Aucun taux de TVA DGI relevé : impossible de calculer le contrat.',
          lineIndex: null,
          path,
        });
      }
      for (const i of calc.issues) {
        if (i.code === 'NO_LINES') continue;
        blockers.push({ code: i.code, message: i.message, lineIndex: i.lineIndex, path });
      }
    };
    check(c, null);
    if (c.billing.kind === 'schedule') {
      c.billing.items.forEach((item, i) => check(item, `billing.items.${i}`));
    }
    // Le contrôle que l'émission appliquera (vendeur non assujetti), motif des devis.
    const vat = await this.drafts.sellerVatIssues(organizationId, [
      ...c.lines,
      ...(c.billing.kind === 'schedule' ? c.billing.items.flatMap((i) => i.lines) : []),
    ]);
    blockers.push(...vat.map((v) => ({ ...v, path: null })));
    return blockers;
  }

  async viewOf(
    organizationId: string,
    c: SalesContractLean,
    on?: string,
  ): Promise<SalesContractView> {
    const contractId = String(c._id);
    const [amendments, files, settings] = await Promise.all([
      this.amendmentsOf(organizationId, contractId),
      this.files.list(organizationId, { contractId, amendmentId: null }),
      this.settings.values(organizationId),
    ]);
    const today = kinshasaDay(new Date());
    const at = on ?? today;
    const terms = this.termsOf(c, amendments, at, settings);
    const todayTerms = at === today ? terms : this.termsOf(c, amendments, today, settings);
    const warnings: SalesContractWarning[] = [];
    let termsView: SalesContractView['terms'] = null;
    if (terms) {
      const inForce = termsAt(engineContractOf(c), amendments.map(engineAmendmentOf), at);
      termsView = {
        on: at,
        inForce: {
          initialTermMonths: inForce.terms.initialTermMonths,
          renewal: inForce.terms.renewal,
          noticeDays: inForce.terms.noticeDays,
          clauses: inForce.terms.clauses,
          billingKind: inForce.terms.billing.kind,
          lines: [...inForce.terms.lines],
          appliedAmendments: inForce.appliedAmendments,
          pendingAmendments: inForce.pendingAmendments,
        },
        currentTerm: terms.currentTerm,
        terms: terms.terms,
        termElapsed: terms.termElapsed,
        lastTermEnd: terms.lastTermEnd,
        noticeDeadline: terms.noticeDeadline,
        proposedNextTerm: terms.proposedNextTerm,
        billableUntil: terms.billableUntil,
        renewalsRecorded: terms.renewalsRecorded,
        issues: terms.issues,
        conventions: SALES_CONTRACT_DATE_CONVENTIONS,
      };
      if (inForce.pendingAmendments.length > 0) {
        warnings.push({
          code: 'AMENDMENT_PENDING',
          message:
            'Un avenant non signé a atteint sa date d’effet : il reste sans effet tant qu’il n’est pas signé.',
          details: { amendments: inForce.pendingAmendments },
        });
      }
    } else if (c.status === 'signed' || c.status === 'terminated') {
      warnings.push({
        code: 'TERMS_UNAVAILABLE',
        message: 'Les dates de ce contrat ne peuvent pas être calculées : vérifiez ses clauses.',
      });
    }
    const totals = c.documentAmounts.calculation.totals;
    return {
      ...this.summary(c, terms),
      customer: c.customer,
      lines: c.lines.map((l) => ({
        ...l,
        amount: totals?.lines.find((t) => t.index === l.index)?.amount ?? null,
      })),
      lineInputs: c.lines.map((l) => lineInputOf(storedLineOf(l), false)),
      documentAmounts: c.documentAmounts,
      initialTermMonths: c.initialTermMonths ?? null,
      renewal: c.renewal,
      noticeDays: c.noticeDays,
      billing: c.billing,
      clauses: c.clauses ?? null,
      submittedAt: iso(c.submittedAt),
      submittedBy: c.submittedBy ?? null,
      approvals: (c.approvals ?? []).map((a) => ({ ...a, at: iso(a.at)! })),
      signature: c.signature ? { ...c.signature, declaredAt: iso(c.signature.declaredAt)! } : null,
      renewals: (c.renewals ?? []).map((r) => ({ ...r, recordedAt: iso(r.recordedAt)! })),
      termination: c.termination
        ? {
            ...c.termination,
            recordedAt: iso(c.termination.recordedAt)!,
            noticeCheckLabel: SALES_CONTRACT_NOTICE_CHECK_LABELS[c.termination.noticeCheck.result],
          }
        : null,
      cancellation: c.cancellation
        ? { at: iso(c.cancellation.at)!, by: c.cancellation.by, reason: c.cancellation.reason }
        : null,
      projectId: c.projectId ?? null,
      contentSha256: c.contentSha256 ?? null,
      previousVersions: (c.previousVersions ?? []).map((v) => ({
        version: v.version,
        status: v.status,
        archivedAt: iso(v.archivedAt)!,
        archivedBy: v.archivedBy,
        total: v.documentAmounts?.calculation?.totals?.total ?? null,
      })),
      amendments: amendments.map((a) => amendmentSummaryOf(a)),
      terms: termsView,
      files: files.map(salesContractFileView),
      actions: salesContractActionsOf(c, this.renewalRecordable(todayTerms, today, settings)),
      blockers: c.status === 'draft' ? await this.blockersOf(organizationId, c) : [],
      warnings,
      banner: SALES_CONTRACT_CLAUSES_BANNER,
    };
  }

  /**
   * Un terme suivant est proposé (reconduction tacite) et sa fenêtre d'affichage est
   * ouverte — la même que l'élément « Reconduction à constater » du moteur
   * (`contractAlerts` : à partir de fin du terme − `termEndAlertDays`).
   */
  renewalRecordable(
    terms: ContractTermsResult | null,
    today: string,
    settings: SalesContractSettingsValues,
  ): boolean {
    if (!terms || terms.proposedNextTerm === null || terms.lastTermEnd === null) return false;
    return today >= addDays(terms.lastTermEnd, -settings.termEndAlertDays);
  }

  // ── Lectures d'autres modules (lecture seule) ────────────────────────────

  private async quoteOf(organizationId: string, quoteId: string): Promise<QuoteRead> {
    const notFound = () => contractsNotFound('QUOTE_NOT_FOUND', 'Devis introuvable.');
    if (!isObjectIdHex(quoteId)) notFound();
    const doc = await this.connection.collection(READ_ONLY_COLLECTIONS.quotes).findOne(
      { _id: new Types.ObjectId(quoteId), organizationId },
      {
        projection: {
          number: 1,
          version: 1,
          status: 1,
          title: 1,
          opportunityId: 1,
          currency: 1,
          priceMode: 1,
          customer: 1,
          lines: 1,
          conversion: 1,
        },
      },
    );
    if (!doc) notFound();
    return doc as unknown as QuoteRead;
  }

  private async assertOpportunity(organizationId: string, opportunityId: string): Promise<void> {
    const found = isObjectIdHex(opportunityId)
      ? await this.connection
          .collection(READ_ONLY_COLLECTIONS.opportunities)
          .findOne(
            { _id: new Types.ObjectId(opportunityId), organizationId },
            { projection: { _id: 1 } },
          )
      : null;
    if (!found) contractsNotFound('OPPORTUNITY_NOT_FOUND', 'Opportunité introuvable.');
  }

  /** Le responsable détient `sales.read` EFFECTIF dans l'organisation (§ 2.3). */
  private async assertOwner(organizationId: string, ownerUserId: string): Promise<void> {
    const holders = await this.authz.holdersOf(organizationId, 'sales.read');
    if (!holders.includes(ownerUserId)) {
      unprocessable(
        'OWNER_WITHOUT_SALES_READ',
        'Le responsable du contrat doit pouvoir lire les ventes de l’organisation.',
      );
    }
  }

  // ── Composition (code des factures) ──────────────────────────────────────

  async compose(organizationId: string, draft: InvoiceDraftInput): Promise<EngagementDocument> {
    return engagementDocumentOf(await this.drafts.compose(organizationId, draft));
  }

  /** Échéancier stocké : lignes de chaque échéance composées par le code des factures. */
  async composeBilling(
    organizationId: string,
    billing: SalesContractBillingInput,
  ): Promise<StoredContractBilling> {
    if (billing.kind !== 'schedule') return billing;
    const items: StoredScheduleItem[] = [];
    for (const item of billing.items) {
      const doc = await this.compose(organizationId, item.draft);
      items.push({
        itemRef: item.itemRef,
        dueDate: item.dueDate,
        label: item.label,
        lines: doc.lines,
        documentAmounts: doc.documentAmounts,
      });
    }
    return { kind: 'schedule', items };
  }

  // ── Séparation des tâches (§ 8.3) ────────────────────────────────────────

  /**
   * `contractApprovalDecision` sur les détenteurs EFFECTIFS de `sales.contract.approve`
   * et le réglage `allowSoleApprover` ; `409 SELF_APPROVAL_FORBIDDEN` sinon.
   */
  async approvalVerdict(
    organizationId: string,
    approverUserId: string,
    submittedBy: string | null,
    createdBy: string | null,
  ): Promise<{ soleApprover: boolean }> {
    const [settings, holdersCount] = await Promise.all([
      this.settings.values(organizationId),
      this.authz.countApprovers(organizationId, 'sales.contract.approve'),
    ]);
    const verdict = contractApprovalDecision({
      approverUserId,
      submittedBy,
      createdBy,
      holdersCount,
      allowSoleApprover: settings.allowSoleApprover,
    });
    if (!verdict.ok) {
      conflict(
        'SELF_APPROVAL_FORBIDDEN',
        'Vous avez préparé ou soumis ce document : un autre approbateur doit le valider.',
      );
    }
    return { soleApprover: verdict.soleApprover };
  }

  // ── Écritures ────────────────────────────────────────────────────────────

  private auditBase(organizationId: string, actor: InvoiceActor, contractId: string) {
    return {
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      targetType: 'sales_contract',
      targetId: contractId,
    };
  }

  async record(
    organizationId: string,
    actor: InvoiceActor,
    contractId: string,
    action: string,
    metadata: Record<string, AuditMetadataValue>,
  ): Promise<void> {
    await this.audit.record({
      ...this.auditBase(organizationId, actor, contractId),
      action,
      metadata,
    });
  }

  private searchKeyOf(number: string, title: string, customerName: string | null): string {
    return searchKeyOf([number, title, customerName]);
  }

  /** Écriture conditionnée par statut ET révision ; perte → 409 explicite. */
  async transition(
    organizationId: string,
    current: SalesContractLean,
    expectedRevision: number,
    update: { $set?: Record<string, unknown>; $push?: Record<string, unknown> },
    extraFilter: Record<string, unknown> = {},
  ): Promise<SalesContractLean> {
    const updated = await this.contracts
      .findOneAndUpdate(
        {
          _id: current._id,
          organizationId,
          status: current.status,
          revision: expectedRevision,
          ...extraFilter,
        },
        { ...update, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<SalesContractLean>()
      .exec();
    if (!updated) {
      const again = await this.requireOwn(organizationId, String(current._id));
      if (again.status !== current.status) {
        contractNotInStatus('SALES_CONTRACT_STATUS_CONFLICT', again.status, 'modifier');
      }
      staleRevision(again.revision);
    }
    return updated;
  }

  async load(
    organizationId: string,
    contractId: string,
    expectedRevision: number,
  ): Promise<SalesContractLean> {
    const current = await this.requireOwn(organizationId, contractId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    return current;
  }

  private async contentOf(organizationId: string, input: SalesContractInput, actor: InvoiceActor) {
    const ownerUserId = input.header.ownerUserId ?? actor.userId;
    await this.assertOwner(organizationId, ownerUserId);
    const doc = await this.compose(organizationId, input.draft);
    const customerId = doc.customer.customerId;
    if (!customerId) {
      conflict(
        'CUSTOMER_REQUIRED',
        'Un client est exigé : convertissez d’abord le prospect en client.',
      );
    }
    return {
      title: input.header.title,
      opportunityId: input.header.opportunityId,
      ownerUserId,
      customerId,
      ...doc,
      startDate: input.header.startDate,
      initialTermMonths: input.header.initialTermMonths,
      renewal: input.header.renewal,
      noticeDays: input.header.noticeDays,
      billing: await this.composeBilling(organizationId, input.billing),
      clauses: input.header.clauses,
    };
  }

  async create(
    organizationId: string,
    input: SalesContractInput,
    actor: InvoiceActor,
  ): Promise<SalesContractView> {
    if (input.header.opportunityId !== null) {
      await this.assertOpportunity(organizationId, input.header.opportunityId);
    }
    const content = await this.contentOf(organizationId, input, actor);
    const created = await this.insert(organizationId, { ...content, source: null }, actor);
    await this.record(organizationId, actor, String(created._id), 'sales_contract.created', {
      number: created.number,
      currency: created.currency,
      billingKind: created.billing.kind,
      source: null,
    });
    return this.viewOf(organizationId, created);
  }

  private async insert(
    organizationId: string,
    fields: Awaited<ReturnType<SalesContractsService['contentOf']>> & {
      source: SalesContract['source'];
    },
    actor: InvoiceActor,
  ): Promise<SalesContractLean> {
    const number = await nextEngagementNumber(
      this.counters as unknown as Model<EngagementCounter>,
      organizationId,
      SALES_CONTRACT_NUMBER_PREFIX,
      new Date(),
    );
    const doc = await this.contracts.create({
      organizationId,
      number,
      version: 1,
      status: 'draft',
      ...fields,
      submittedAt: null,
      submittedBy: null,
      approvals: [],
      signature: null,
      renewals: [],
      termination: null,
      cancellation: null,
      projectId: null,
      previousVersions: [],
      contentSha256: null,
      searchKey: this.searchKeyOf(number, fields.title, fields.customer.name),
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    return doc.toObject() as SalesContractLean;
  }

  /**
   * `POST /sales/quotes/:id/to-contract` (§ 4.1) : contrat `draft` aux PRIX DU DEVIS (même
   * si le catalogue a changé), devis seulement LU. Les clauses sont saisies dans la
   * requête. Une conversion du devis en facture déjà faite est signalée, jamais refusée.
   */
  async createFromQuote(
    organizationId: string,
    quoteId: string,
    input: QuoteToContractInput,
    actor: InvoiceActor,
  ): Promise<SalesContractWithWarnings> {
    const quote = await this.quoteOf(organizationId, quoteId);
    const id = String(quote._id);
    if (quote.status !== 'accepted') {
      conflict('QUOTE_NOT_ACCEPTED', 'Seul un devis accepté donne un contrat.', {
        status: quote.status,
      });
    }
    const customerId = quote.customer?.customerId;
    if (!customerId) {
      conflict(
        'CUSTOMER_REQUIRED',
        'Ce devis est adressé à un client de passage : créez d’abord la fiche client.',
      );
    }
    const warnings: SalesContractWarning[] = [];
    const convertedId = quote.conversion?.invoiceId ?? null;
    if (
      convertedId &&
      (await this.links.invoicesOf(organizationId, [convertedId])).has(convertedId)
    ) {
      warnings.push({
        code: 'QUOTE_ALREADY_CONVERTED',
        message:
          'Ce devis a déjà été converti en facture : vérifiez que le contrat ne fait pas double emploi.',
        details: { invoiceId: convertedId },
      });
    }
    const base = {
      currency: quote.currency,
      priceMode: quote.priceMode,
      customerId,
      printContactDetails: quote.customer.printContactDetails,
    };
    const billing: SalesContractBillingInput =
      input.billing.kind === 'schedule'
        ? {
            kind: 'schedule',
            items: input.billing.items.map((item, i) => ({
              itemRef: item.itemRef,
              dueDate: item.dueDate,
              label: item.label,
              draft: draftInputForLines(base, item.lines, `billing.items.${i}.lines`),
            })),
          }
        : input.billing;
    const content = await this.contentOf(
      organizationId,
      {
        header: {
          title: input.title ?? quote.title ?? `Contrat — devis ${quote.number}`,
          opportunityId: quote.opportunityId ?? null,
          ownerUserId: input.ownerUserId,
          startDate: input.startDate,
          initialTermMonths: input.initialTermMonths,
          renewal: input.renewal,
          noticeDays: input.noticeDays,
          clauses: input.clauses,
        },
        draft: {
          type: 'FV',
          currency: quote.currency,
          priceMode: quote.priceMode,
          customer: { customerId, printContactDetails: quote.customer.printContactDetails },
          pointOfSaleId: null,
          lines: quote.lines.map((l) => lineInputOf(l, true)),
          payments: [],
          comments: { A: null, C: null },
          creditNote: null,
          showUsdCounterValue: false,
        },
        billing,
      },
      actor,
    );
    const created = await this.insert(
      organizationId,
      { ...content, source: { kind: 'quote', quoteId: id, quoteVersion: quote.version } },
      actor,
    );
    await this.record(organizationId, actor, String(created._id), 'sales_contract.created', {
      number: created.number,
      currency: created.currency,
      billingKind: created.billing.kind,
      source: 'quote',
      quoteId: id,
      quoteNumber: quote.number,
      quoteVersion: quote.version,
    });
    return { contract: await this.viewOf(organizationId, created), warnings };
  }

  /** Brouillon seulement (`409 CONTRACT_NOT_DRAFT`) : une version soumise ne se modifie plus. */
  async put(
    organizationId: string,
    contractId: string,
    expectedRevision: number,
    input: SalesContractInput,
    actor: InvoiceActor,
  ): Promise<SalesContractView> {
    const current = await this.load(organizationId, contractId, expectedRevision);
    if (current.status !== 'draft') {
      contractNotInStatus('CONTRACT_NOT_DRAFT', current.status, 'modifier');
    }
    if (
      input.header.opportunityId !== null &&
      input.header.opportunityId !== (current.opportunityId ?? null)
    ) {
      await this.assertOpportunity(organizationId, input.header.opportunityId);
    }
    const content = await this.contentOf(organizationId, input, actor);
    const updated = await this.transition(organizationId, current, expectedRevision, {
      $set: {
        ...content,
        searchKey: this.searchKeyOf(current.number, content.title, content.customer.name),
        updatedBy: actor.userId,
      },
    });
    await this.record(organizationId, actor, contractId, 'sales_contract.updated', {
      number: current.number,
      version: current.version,
      total: content.documentAmounts.calculation.totals?.total ?? null,
    });
    return this.viewOf(organizationId, updated);
  }

  /** Brouillon v1 JAMAIS soumis seulement : le contrat et ses pièces disparaissent. */
  async remove(organizationId: string, contractId: string, actor: InvoiceActor): Promise<void> {
    const current = await this.requireOwn(organizationId, contractId);
    if (current.status !== 'draft') {
      contractNotInStatus('CONTRACT_NOT_DRAFT', current.status, 'supprimer');
    }
    if (!neverSubmitted(current)) {
      conflict(
        'CONTRACT_ALREADY_SUBMITTED',
        'Ce contrat a déjà été soumis : annulez-le au lieu de le supprimer, son historique est conservé.',
      );
    }
    const res = await this.contracts
      .deleteOne({
        _id: current._id,
        organizationId,
        status: 'draft',
        revision: current.revision,
      })
      .exec();
    if (res.deletedCount !== 1) staleRevision(current.revision);
    await this.files.removeAll(organizationId, { contractId, amendmentId: null });
    await this.record(organizationId, actor, contractId, 'sales_contract.deleted', {
      number: current.number,
    });
  }

  /** « Soumettre » : calcul sans bloquant exigé (contrôle `checkSellerVatStatus` compris). */
  async submit(
    organizationId: string,
    contractId: string,
    expectedRevision: number,
    actor: InvoiceActor,
  ): Promise<SalesContractView> {
    const current = await this.load(organizationId, contractId, expectedRevision);
    if (current.status !== 'draft') {
      contractNotInStatus('CONTRACT_NOT_DRAFT', current.status, 'soumettre');
    }
    const blockers = await this.blockersOf(organizationId, current);
    if (blockers.length > 0) {
      conflict('CONTRACT_NOT_READY', 'Ce contrat ne peut pas encore être soumis.', { blockers });
    }
    await this.assertOwner(organizationId, current.ownerUserId);
    const updated = await this.transition(organizationId, current, expectedRevision, {
      $set: {
        status: 'submitted',
        submittedAt: new Date(),
        submittedBy: actor.userId,
        updatedBy: actor.userId,
      },
    });
    await this.record(organizationId, actor, contractId, 'sales_contract.submitted', {
      number: current.number,
      version: current.version,
      total: current.documentAmounts.calculation.totals?.total ?? null,
    });
    return this.viewOf(organizationId, updated);
  }

  /** « Approuver » (validation INTERNE, pas la signature) : séparation des tâches. */
  async approve(
    organizationId: string,
    contractId: string,
    expectedRevision: number,
    comment: string | null,
    actor: InvoiceActor,
  ): Promise<SalesContractView> {
    return this.decide(organizationId, contractId, expectedRevision, 'approved', comment, actor);
  }

  /** « Rejeter » : commentaire exigé ; retour en `draft` (même séparation). */
  async reject(
    organizationId: string,
    contractId: string,
    expectedRevision: number,
    comment: string,
    actor: InvoiceActor,
  ): Promise<SalesContractView> {
    return this.decide(organizationId, contractId, expectedRevision, 'rejected', comment, actor);
  }

  private async decide(
    organizationId: string,
    contractId: string,
    expectedRevision: number,
    decision: 'approved' | 'rejected',
    comment: string | null,
    actor: InvoiceActor,
  ): Promise<SalesContractView> {
    const current = await this.load(organizationId, contractId, expectedRevision);
    if (current.status !== 'submitted') {
      contractNotInStatus(
        'CONTRACT_NOT_SUBMITTED',
        current.status,
        decision === 'approved' ? 'approuver' : 'rejeter',
      );
    }
    const { soleApprover } = await this.approvalVerdict(
      organizationId,
      actor.userId,
      current.submittedBy ?? null,
      current.createdBy,
    );
    const approval: StoredApproval = {
      userId: actor.userId,
      decision,
      at: new Date(),
      comment,
      soleApprover,
    };
    const updated = await this.transition(organizationId, current, expectedRevision, {
      $set: { status: decision === 'approved' ? 'approved' : 'draft', updatedBy: actor.userId },
      $push: { approvals: approval },
    });
    await this.record(
      organizationId,
      actor,
      contractId,
      decision === 'approved' ? 'sales_contract.approved' : 'sales_contract.rejected',
      { number: current.number, version: current.version, comment, soleApprover },
    );
    return this.viewOf(organizationId, updated);
  }

  /**
   * « Nouvelle version » (depuis soumis, approuvé ou rejeté) : l'état courant est archivé
   * dans `previousVersions`, la version augmente, le contrat redevient modifiable.
   */
  async newVersion(
    organizationId: string,
    contractId: string,
    expectedRevision: number,
    actor: InvoiceActor,
  ): Promise<SalesContractView> {
    const current = await this.load(organizationId, contractId, expectedRevision);
    const rejected =
      current.status === 'draft' && current.approvals.some((a) => a.decision === 'rejected');
    if (current.status !== 'submitted' && current.status !== 'approved' && !rejected) {
      contractNotInStatus('SALES_CONTRACT_STATUS_CONFLICT', current.status, 'nouvelle version');
    }
    const snapshot: SalesContractVersionSnapshot = {
      title: current.title,
      customerId: current.customerId,
      opportunityId: current.opportunityId ?? null,
      ownerUserId: current.ownerUserId,
      currency: current.currency,
      priceMode: current.priceMode,
      customer: current.customer,
      lines: current.lines,
      documentAmounts: current.documentAmounts,
      startDate: current.startDate,
      initialTermMonths: current.initialTermMonths ?? null,
      renewal: current.renewal,
      noticeDays: current.noticeDays,
      billing: current.billing,
      clauses: current.clauses ?? null,
      version: current.version,
      status: current.status,
      submittedAt: current.submittedAt ?? null,
      submittedBy: current.submittedBy ?? null,
      approvals: current.approvals ?? [],
      archivedAt: new Date(),
      archivedBy: actor.userId,
    };
    const updated = await this.transition(organizationId, current, expectedRevision, {
      $set: {
        status: 'draft',
        version: current.version + 1,
        submittedAt: null,
        submittedBy: null,
        approvals: [],
        updatedBy: actor.userId,
      },
      $push: { previousVersions: snapshot },
    });
    await this.record(organizationId, actor, contractId, 'sales_contract.new_version', {
      number: current.number,
      archivedVersion: current.version,
      version: current.version + 1,
      archivedStatus: current.status,
    });
    return this.viewOf(organizationId, updated);
  }

  /** « Annuler » : avant signature, motif exigé ; le contrat est conservé. */
  async cancel(
    organizationId: string,
    contractId: string,
    expectedRevision: number,
    reason: string,
    actor: InvoiceActor,
  ): Promise<SalesContractView> {
    const current = await this.load(organizationId, contractId, expectedRevision);
    if (!['draft', 'submitted', 'approved'].includes(current.status)) {
      contractNotInStatus('SALES_CONTRACT_STATUS_CONFLICT', current.status, 'annuler');
    }
    const updated = await this.transition(organizationId, current, expectedRevision, {
      $set: {
        status: 'cancelled',
        cancellation: { at: new Date(), by: actor.userId, reason },
        updatedBy: actor.userId,
      },
    });
    await this.record(organizationId, actor, contractId, 'sales_contract.cancelled', {
      number: current.number,
      reason,
      previousStatus: current.status,
    });
    return this.viewOf(organizationId, updated);
  }

  /** Copie signée téléversée de ce contrat (ou de cet avenant) ; `null` sinon. */
  async signedCopy(
    organizationId: string,
    contractId: string,
    amendmentId: string | null,
    fileId: string | null,
  ): Promise<SalesContractFileLean | null> {
    if (fileId === null || !isObjectIdHex(fileId)) return null;
    return this.fileMetas
      .findOne({
        _id: new Types.ObjectId(fileId),
        organizationId,
        contractId,
        amendmentId,
        kind: 'signed_copy',
      })
      .lean<SalesContractFileLean>()
      .exec();
  }

  /**
   * « Déclarer la signature » : contrat approuvé, date, signataires des deux côtés et
   * copie PDF signée DÉJÀ téléversée (`422 SIGNED_COPY_REQUIRED`). Le contenu devient
   * immuable (`contentSha256`). Aucune signature électronique (décision ouverte n° 6).
   */
  async declareSignature(
    organizationId: string,
    contractId: string,
    input: {
      expectedRevision: number;
      signedOn: string;
      signatories: { name: string; title: string | null; side: 'customer' | 'organization' }[];
      fileId: string | null;
    },
    actor: InvoiceActor,
  ): Promise<SalesContractView> {
    const current = await this.load(organizationId, contractId, input.expectedRevision);
    if (current.status !== 'approved') {
      contractNotInStatus('CONTRACT_NOT_APPROVED', current.status, 'déclarer la signature');
    }
    const copy = await this.signedCopy(organizationId, contractId, null, input.fileId);
    if (!copy) {
      unprocessable(
        'SIGNED_COPY_REQUIRED',
        'Téléversez d’abord la copie PDF signée du contrat, puis déclarez la signature.',
      );
    }
    const sha = contractSha256(current);
    const updated = await this.transition(organizationId, current, input.expectedRevision, {
      $set: {
        status: 'signed',
        signature: {
          signedOn: input.signedOn,
          signatories: input.signatories,
          fileId: String(copy._id),
          declaredBy: actor.userId,
          declaredAt: new Date(),
        },
        contentSha256: sha,
        updatedBy: actor.userId,
      },
    });
    await this.record(organizationId, actor, contractId, 'sales_contract.signed', {
      number: current.number,
      version: current.version,
      signedOn: input.signedOn,
      fileId: String(copy._id),
      fileSha256: copy.sha256,
      contentSha256: sha,
    });
    return this.viewOf(organizationId, updated);
  }

  /**
   * « Résilier » (signé seulement) : notification et date d'effet enregistrées ; le moteur
   * compare au préavis SAISI en vigueur à la notification (`noticeCheck`) et l'AFFICHE,
   * sans jamais refuser : la validité juridique n'est pas jugée par Lalanda.
   */
  async terminate(
    organizationId: string,
    contractId: string,
    input: {
      expectedRevision: number;
      noticeGivenOn: string;
      by: 'customer' | 'organization';
      effectiveOn: string;
      reason: string;
    },
    actor: InvoiceActor,
  ): Promise<SalesContractWithWarnings> {
    const current = await this.load(organizationId, contractId, input.expectedRevision);
    if (current.status !== 'signed') {
      contractNotInStatus('CONTRACT_NOT_SIGNED', current.status, 'résilier');
    }
    const amendments = await this.amendmentsOf(organizationId, contractId);
    const { terms } = termsAt(
      engineContractOf(current),
      amendments.map(engineAmendmentOf),
      input.noticeGivenOn,
    );
    const check = noticeCheck(input.noticeGivenOn, input.effectiveOn, terms.noticeDays);
    const updated = await this.transition(organizationId, current, input.expectedRevision, {
      $set: {
        status: 'terminated',
        termination: {
          noticeGivenOn: input.noticeGivenOn,
          by: input.by,
          effectiveOn: input.effectiveOn,
          reason: input.reason,
          recordedBy: actor.userId,
          recordedAt: new Date(),
          noticeCheck: {
            result: check.result,
            noticeDays: check.noticeDays,
            daysGiven: check.daysGiven,
          },
        },
        updatedBy: actor.userId,
      },
    });
    const warnings: SalesContractWarning[] = [];
    if (check.result === 'below_clause') {
      warnings.push({
        code: 'NOTICE_BELOW_CLAUSE',
        message: SALES_CONTRACT_NOTICE_CHECK_LABELS.below_clause,
        details: {
          noticeDays: check.noticeDays,
          daysGiven: check.daysGiven,
          latestNoticeDate: check.latestNoticeDate,
        },
      });
    }
    await this.record(organizationId, actor, contractId, 'sales_contract.terminated', {
      number: current.number,
      noticeGivenOn: input.noticeGivenOn,
      effectiveOn: input.effectiveOn,
      by: input.by,
      reason: input.reason,
      noticeCheck: check.result,
      noticeDays: check.noticeDays,
      daysGiven: check.daysGiven,
    });
    return { contract: await this.viewOf(organizationId, updated), warnings };
  }

  /**
   * « Constater la reconduction » (`POST …/renewals`) : le terme suivant PROPOSÉ par le
   * moteur (reconduction tacite saisie, non résilié, `maxRenewals` non atteint) est
   * enregistré en ajout seul. Jamais automatique : sans ce geste, rien n'est préparé
   * au-delà du terme. Le terme n'étant préparé par personne, la séparation des tâches
   * (`contractApprovalDecision`) n'a ici aucune personne à écarter.
   */
  async recordRenewal(
    organizationId: string,
    contractId: string,
    expectedRevision: number,
    actor: InvoiceActor,
  ): Promise<SalesContractView> {
    const current = await this.load(organizationId, contractId, expectedRevision);
    if (current.status !== 'signed') {
      contractNotInStatus('CONTRACT_NOT_SIGNED', current.status, 'constater la reconduction');
    }
    const [amendments, settings] = await Promise.all([
      this.amendmentsOf(organizationId, contractId),
      this.settings.values(organizationId),
    ]);
    const today = kinshasaDay(new Date());
    const terms = this.termsOf(current, amendments, today, settings);
    if (!this.renewalRecordable(terms, today, settings) || !terms?.proposedNextTerm) {
      conflict(
        'RENEWAL_NOT_PROPOSED',
        'Aucune reconduction n’est à constater pour ce contrat aujourd’hui.',
        {
          lastTermEnd: terms?.lastTermEnd ?? null,
          proposedNextTerm: terms?.proposedNextTerm ?? null,
        },
      );
    }
    const next = terms.proposedNextTerm;
    const renewal: StoredRenewal = {
      termIndex: next.index,
      from: next.from,
      to: next.to!,
      recordedBy: actor.userId,
      recordedAt: new Date(),
      mode: 'tacit_recorded',
      amendmentId: null,
    };
    const updated = await this.transition(
      organizationId,
      current,
      expectedRevision,
      { $set: { updatedBy: actor.userId }, $push: { renewals: renewal } },
      { 'renewals.termIndex': { $ne: next.index } },
    );
    await this.record(organizationId, actor, contractId, 'sales_contract.renewal_recorded', {
      number: current.number,
      termIndex: next.index,
      from: next.from,
      to: next.to,
      mode: 'tacit_recorded',
    });
    return this.viewOf(organizationId, updated);
  }

  /** Ajoute une reconduction EXPRESSE (avenant `purpose: 'renewal'` signé). */
  async appendExplicitRenewal(
    organizationId: string,
    contractId: string,
    renewal: StoredRenewal,
  ): Promise<void> {
    await this.contracts
      .updateOne(
        {
          _id: new Types.ObjectId(contractId),
          organizationId,
          status: 'signed',
          'renewals.termIndex': { $ne: renewal.termIndex },
        },
        { $push: { renewals: renewal }, $inc: { revision: 1 } },
      )
      .exec();
  }

  // ── Pièces (§ 2.6 : `draft_copy`, `signed_copy`) ─────────────────────────

  /** Vérifie qu'une pièce peut être jointe AVANT de lire le corps. */
  async assertFileAttachable(
    organizationId: string,
    contractId: string,
    query: SalesContractFileQuery,
  ): Promise<void> {
    const current = await this.requireOwn(organizationId, contractId);
    if (query.amendmentId === null) {
      if (current.status === 'cancelled') {
        contractNotInStatus('SALES_CONTRACT_STATUS_CONFLICT', current.status, 'joindre une pièce');
      }
      return;
    }
    const amendment = isObjectIdHex(query.amendmentId)
      ? await this.amendments
          .findOne({
            _id: new Types.ObjectId(query.amendmentId),
            organizationId,
            contractId,
          })
          .lean<SalesContractAmendmentLean>()
          .exec()
      : null;
    if (!amendment) {
      contractsNotFound('SALES_CONTRACT_AMENDMENT_NOT_FOUND', 'Avenant introuvable.');
    }
    if (amendment.status === 'cancelled') {
      conflict('SALES_CONTRACT_AMENDMENT_STATUS_CONFLICT', 'Cet avenant est annulé.', {
        status: amendment.status,
      });
    }
  }

  async addFile(
    organizationId: string,
    contractId: string,
    query: SalesContractFileQuery,
    bytes: Buffer,
    rawFileName: unknown,
    actor: InvoiceActor,
  ): Promise<SalesContractFileView> {
    await this.assertFileAttachable(organizationId, contractId, query);
    const kind: SalesContractFileKind = query.kind;
    const meta = await this.files.add(
      organizationId,
      { contractId, amendmentId: query.amendmentId },
      kind,
      bytes,
      rawFileName,
      actor.userId,
    );
    await this.record(organizationId, actor, contractId, 'sales_contract.file_added', {
      fileId: String(meta._id),
      kind,
      amendmentId: query.amendmentId,
      size: meta.size,
      sha256: meta.sha256,
    });
    return salesContractFileView(meta);
  }

  /** Une pièce du contrat ou d'un de ses avenants ; `404` sinon. */
  async readFile(organizationId: string, contractId: string, fileId: string) {
    await this.requireOwn(organizationId, contractId);
    const meta = isObjectIdHex(fileId)
      ? await this.fileMetas
          .findOne({ _id: new Types.ObjectId(fileId), organizationId, contractId })
          .lean<SalesContractFileLean>()
          .exec()
      : null;
    if (!meta) contractsNotFound('SALES_CONTRACT_FILE_NOT_FOUND', 'Pièce introuvable.');
    return this.files.read(
      organizationId,
      { contractId, amendmentId: meta.amendmentId ?? null },
      fileId,
    );
  }

  /** Dates des échéances déjà préparées (liens vivants d'échéancier ou d'abonnement). */
  async preparedOccurrenceDates(
    organizationId: string,
    contract: SalesContractLean,
  ): Promise<string[]> {
    const live = await this.links.liveLinks(organizationId, [{ contractId: String(contract._id) }]);
    const dueOf = new Map(
      contract.billing.kind === 'schedule'
        ? contract.billing.items.map((i) => [i.itemRef, i.dueDate] as const)
        : [],
    );
    return live.flatMap(({ link }) => {
      if (link.kind === 'subscription_occurrence' && link.occurrenceDate) {
        return [link.occurrenceDate];
      }
      if (link.kind === 'schedule_item' && link.itemRef) {
        const due = dueOf.get(link.itemRef);
        return due ? [due] : [];
      }
      return [];
    });
  }
}

export function amendmentSummaryOf(
  a: SalesContractAmendmentLean,
  contractNumber?: string,
): SalesContractAmendmentSummary {
  return {
    id: String(a._id),
    index: a.index,
    number: contractNumber ? amendmentNumberOf(contractNumber, a.index) : a.number,
    effectiveDate: a.effectiveDate,
    purpose: a.purpose,
    status: a.status,
    statusLabel: SALES_CONTRACT_AMENDMENT_STATUS_LABELS[a.status],
    revision: a.revision,
  };
}
