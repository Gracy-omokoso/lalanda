// Acomptes d'une commande client ou d'un contrat — ADR-0050 § 5.1, § 5.2 (O4, O5).
// ADR-0050 — V4.
//
// - « Préparer l'acompte » crée un BROUILLON `FT`/`ET` par `InvoiceDraftsService.create`
//   (seul écrivain autorisé de `sales_invoices`), à UNE ligne libre : libellé prérempli,
//   quantité 1, prix = montant demandé dans le mode de prix de l'engagement, groupe de
//   taxation CHOISI par l'utilisateur (exigé, jamais prérempli — EC2). Puis un lien
//   `order_deposit` / `contract_deposit` avec le montant demandé. Le calcul, la taxation
//   et la mention « D'ACOMPTE » sont ceux du circuit existant des factures ; l'écart
//   entre le total calculé et le montant demandé est SIGNALÉ, jamais corrigé.
// - Rien n'est émis, rien n'est normalisé, rien n'est envoyé à la DGI : « Émettre » et
//   « Normaliser » restent les routes existantes sous `sales.invoice`.
// - Aucune imputation automatique sur la facture finale (décision ouverte n° 11) : elle
//   reçoit seulement le RAPPEL des codes en ligne C (`commentWithDepositRecall`, utilisé
//   par `prepare-invoice` des commandes et, pour les contrats, par le lot V5). Le moteur
//   signale `DEPOSIT_NOT_RESOLVED` jusqu'au geste déclaratif « traité ».
// - Rien n'est écrit dans le réalisé, la trésorerie ni la comptabilité : une `FT` émise y
//   entre exactement comme une `FT` saisie à la main (`sale.deposit.*`, compte d'attente).
//
// Isolation : chaque requête porte `organizationId` (404 hors organisation). Concurrence :
// préparation et geste sont conditionnés par la révision de l'engagement.

import { depositSummary, isTaxGroupLetter, type DepositSummaryResult } from '@lalanda/engine';
import { SALES_DEPOSIT_FINAL_INVOICE_WARNING } from '@lalanda/shared/sales-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService, type AuditMetadataValue } from '../../../authz/audit.service.js';
import { InvoiceDraftsService } from '../../invoices/invoice-drafts.service.js';
import type { InvoiceActor } from '../../invoices/invoice.types.js';
import type { InvoiceDraftInput } from '../../invoices/invoices.dto.js';
import { SettlementsService } from '../../receipts/settlements.service.js';
import { conflict, isDuplicateKey } from '../../sales.errors.js';
import { contractsNotFound } from '../common/contracts.common.js';
import type { EngagementLine } from '../common/engagement-document.js';
import { SalesContractsService } from '../contracts/sales-contracts.service.js';
import type { SalesContractLean } from '../contracts/sales-contract.schema.js';
import {
  SalesDocumentLinksService,
  invoiceStateOf,
  type LiveLink,
} from '../links/sales-document-links.service.js';
import { orderInvoiceComment } from '../orders/sales-order-model.js';
import type { SalesOrderLean } from '../orders/sales-order.schema.js';
import { SalesOrdersService } from '../orders/sales-orders.service.js';
import {
  depositItemTypeOf,
  depositRecallCode,
  isDepositLink,
  isFinalLink,
  sameAmount,
} from './sales-deposit-model.js';
import {
  SalesDepositResolution,
  type SalesDepositResolutionDocument,
  type SalesDepositResolutionLean,
} from './sales-deposit-resolution.schema.js';
import type { PrepareDepositInput, ResolveDepositInput } from './sales-deposits.dto.js';

/** Longueur maximale de la ligne de commentaire C (ADR-0023). */
const COMMENT_C_MAX = 255;

export type DepositOwnerKind = 'order' | 'contract';

export interface SalesDepositWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SalesDepositLineView {
  invoiceId: string;
  type: string;
  status: string;
  state: 'draft' | 'issued';
  /** Numéro (émise) ou référence pro forma (brouillon). */
  reference: string | null;
  /** Code rappelé en ligne C des factures finales (émise en série réelle), sinon `null`. */
  recallCode: string | null;
  currency: 'CDF' | 'USD';
  total: string | null;
  paid: string | null;
  requestedAmount: string | null;
  /** Total − demandé, signé : écart SIGNALÉ, jamais corrigé. */
  gapToRequested: string | null;
  resolved: boolean;
  resolution: { reason: string; resolvedBy: string; resolvedAt: string } | null;
  linkedAt: string;
}

export interface SalesDepositsView {
  owner: { kind: DepositOwnerKind; id: string; number: string; revision: number };
  /** `false` si une facture liée est illisible par le moteur (rien n'est deviné). */
  available: boolean;
  deposits: SalesDepositLineView[];
  /** Par devise, sans somme entre devises (moteur `depositSummary`). */
  byCurrency: DepositSummaryResult['byCurrency'];
  /** Factures finales liées (vente, échéance, abonnement). */
  finals: {
    invoiceId: string;
    kind: string;
    state: 'draft' | 'issued';
    reference: string | null;
  }[];
  /** `DEPOSIT_NOT_RESOLVED` : acompte émis non « traité » alors qu'une facture finale existe. */
  unresolved: string[];
  issues: DepositSummaryResult['issues'];
  /** Avertissement constant dès qu'un acompte existe (§ 5.2). */
  warning: string | null;
  engineVersion: string | null;
}

export interface PreparedSalesDeposit {
  invoiceId: string;
  warnings: SalesDepositWarning[];
  deposits: SalesDepositsView;
}

/** Engagement vu par les acomptes (commande confirmée ou contrat signé). */
interface Engagement {
  kind: DepositOwnerKind;
  id: string;
  number: string;
  revision: number;
  status: string;
  currency: 'CDF' | 'USD';
  priceMode: 'ttc' | 'ht';
  customerId: string;
  printContactDetails: boolean;
  lines: EngagementLine[];
  commentC: string;
}

const iso = (d: Date | null | undefined): string => new Date(d ?? 0).toISOString();

function depositNotFound(): never {
  contractsNotFound(
    'SALES_DEPOSIT_NOT_FOUND',
    'Facture d’acompte introuvable pour cet engagement.',
  );
}

@Injectable()
export class SalesDepositsService {
  constructor(
    @InjectModel(SalesDepositResolution.name)
    private readonly resolutions: Model<SalesDepositResolutionDocument>,
    @Inject(SalesOrdersService) private readonly orders: SalesOrdersService,
    @Inject(SalesContractsService) private readonly contracts: SalesContractsService,
    @Inject(SalesDocumentLinksService) private readonly links: SalesDocumentLinksService,
    @Inject(InvoiceDraftsService) private readonly drafts: InvoiceDraftsService,
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Engagement ───────────────────────────────────────────────────────────

  private orderEngagement(o: SalesOrderLean): Engagement {
    return {
      kind: 'order',
      id: String(o._id),
      number: o.number,
      revision: o.revision,
      status: o.status,
      currency: o.currency,
      priceMode: o.priceMode,
      customerId: o.customerId,
      printContactDetails: o.customer.printContactDetails === true,
      lines: o.lines,
      commentC: orderInvoiceComment(o, COMMENT_C_MAX).text,
    };
  }

  private contractEngagement(c: SalesContractLean): Engagement {
    const scheduleLines =
      c.billing.kind === 'schedule' ? c.billing.items.flatMap((i) => i.lines) : [];
    return {
      kind: 'contract',
      id: String(c._id),
      number: c.number,
      revision: c.revision,
      status: c.status,
      currency: c.currency,
      priceMode: c.priceMode,
      customerId: c.customerId,
      printContactDetails: c.customer.printContactDetails === true,
      lines: [...c.lines, ...(scheduleLines as EngagementLine[])],
      commentC: `Contrat ${c.number}`.slice(0, COMMENT_C_MAX),
    };
  }

  private async engagementOf(
    organizationId: string,
    kind: DepositOwnerKind,
    id: string,
  ): Promise<Engagement> {
    return kind === 'order'
      ? this.orderEngagement(await this.orders.requireOwn(organizationId, id))
      : this.contractEngagement(await this.contracts.requireOwn(organizationId, id));
  }

  /**
   * Révision vérifiée puis consommée (motif de `prepare-invoice`) : deux gestes
   * concurrents sur le même engagement ne passent pas tous deux ; `409 STALE_REVISION`.
   * Le statut est relu et conditionné ; seul `updatedBy` change.
   */
  private async reserve(
    organizationId: string,
    kind: DepositOwnerKind,
    id: string,
    expectedRevision: number,
    actor: InvoiceActor,
    requiredStatus: string | null,
  ): Promise<Engagement> {
    if (kind === 'order') {
      const current = await this.orders.load(organizationId, id, expectedRevision);
      if (requiredStatus !== null && current.status !== requiredStatus) {
        conflict('ORDER_NOT_CONFIRMED', 'Un acompte se prépare sur une commande confirmée.', {
          status: current.status,
        });
      }
      const updated = await this.orders.transition(organizationId, current, expectedRevision, {
        updatedBy: actor.userId,
      });
      return this.orderEngagement(updated);
    }
    const current = await this.contracts.load(organizationId, id, expectedRevision);
    if (requiredStatus !== null && current.status !== requiredStatus) {
      conflict('CONTRACT_NOT_SIGNED', 'Un acompte se prépare sur un contrat signé.', {
        status: current.status,
      });
    }
    const updated = await this.contracts.transition(organizationId, current, expectedRevision, {
      $set: { updatedBy: actor.userId },
    });
    return this.contractEngagement(updated);
  }

  private ownerOf(e: { kind: DepositOwnerKind; id: string }) {
    return e.kind === 'order' ? { orderId: e.id } : { contractId: e.id };
  }

  private async record(
    organizationId: string,
    actor: InvoiceActor,
    e: Engagement,
    action: string,
    metadata: Record<string, AuditMetadataValue>,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      targetType: e.kind === 'order' ? 'sales_order' : 'sales_contract',
      targetId: e.id,
      action: `${e.kind === 'order' ? 'sales_order' : 'sales_contract'}.${action}`,
      metadata,
    });
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  /** `GET /sales/{orders|contracts}/:id/deposits` : acomptes, finales, `DEPOSIT_NOT_RESOLVED`. */
  async view(
    organizationId: string,
    kind: DepositOwnerKind,
    id: string,
  ): Promise<SalesDepositsView> {
    return this.viewOf(organizationId, await this.engagementOf(organizationId, kind, id));
  }

  private async viewOf(organizationId: string, e: Engagement): Promise<SalesDepositsView> {
    const live = await this.links.liveLinks(organizationId, [this.ownerOf(e)]);
    const deposits = live.filter(isDepositLink);
    const finals = live.filter(isFinalLink);
    const depositIds = deposits.map((d) => d.link.invoiceId);
    const [resolutions, paid] = await Promise.all([
      depositIds.length === 0
        ? Promise.resolve([] as SalesDepositResolutionLean[])
        : this.resolutions
            .find({ organizationId, invoiceId: { $in: depositIds } })
            .lean<SalesDepositResolutionLean[]>()
            .exec(),
      this.paidOf(organizationId, deposits),
    ]);
    const resolutionOf = new Map(resolutions.map((r) => [r.invoiceId, r]));

    let summary: DepositSummaryResult | null = null;
    try {
      summary = depositSummary(
        deposits.map(({ link, invoice }) => {
          const total = invoice.documentAmounts?.calculation?.totals?.total;
          if (typeof total !== 'string') throw new RangeError('Total illisible');
          return {
            invoiceId: link.invoiceId,
            currency: invoice.currency,
            state: invoiceStateOf(invoice.status),
            total,
            paid: paid.get(link.invoiceId) ?? '0.00',
            requestedAmount: link.requestedAmount ?? null,
          };
        }),
        finals.map(({ link, invoice }) => ({
          invoiceId: link.invoiceId,
          state: invoiceStateOf(invoice.status),
        })),
        [...resolutionOf.keys()],
      );
    } catch {
      summary = null;
    }
    const lineOf = new Map((summary?.deposits ?? []).map((d) => [d.invoiceId, d]));

    return {
      owner: { kind: e.kind, id: e.id, number: e.number, revision: e.revision },
      available: summary !== null,
      deposits: deposits.map(({ link, invoice }) => {
        const engine = lineOf.get(link.invoiceId);
        const r = resolutionOf.get(link.invoiceId);
        return {
          invoiceId: link.invoiceId,
          type: invoice.type,
          status: invoice.status,
          state: invoiceStateOf(invoice.status),
          reference: invoice.number ?? invoice.proformaRef ?? null,
          recallCode: depositRecallCode(invoice),
          currency: invoice.currency,
          total: engine?.total ?? invoice.documentAmounts?.calculation?.totals?.total ?? null,
          paid: engine?.paid ?? null,
          requestedAmount: link.requestedAmount ?? null,
          gapToRequested: engine?.gapToRequested ?? null,
          resolved: r !== undefined,
          resolution: r
            ? { reason: r.reason, resolvedBy: r.resolvedBy, resolvedAt: iso(r.resolvedAt) }
            : null,
          linkedAt: iso(link.linkedAt),
        };
      }),
      byCurrency: summary?.byCurrency ?? [],
      finals: finals.map(({ link, invoice }) => ({
        invoiceId: link.invoiceId,
        kind: link.kind,
        state: invoiceStateOf(invoice.status),
        reference: invoice.number ?? invoice.proformaRef ?? null,
      })),
      unresolved: summary?.unresolved ?? [],
      issues: summary?.issues ?? [],
      warning: deposits.length > 0 ? SALES_DEPOSIT_FINAL_INVOICE_WARNING : null,
      engineVersion: summary?.version ?? null,
    };
  }

  /** Encaissé par acompte émis : lecture du statut de règlement (ADR-0031), sans calcul. */
  private async paidOf(
    organizationId: string,
    deposits: readonly LiveLink[],
  ): Promise<Map<string, string>> {
    const issued = deposits
      .filter((d) => invoiceStateOf(d.invoice.status) === 'issued')
      .map((d) => d.link.invoiceId);
    if (issued.length === 0) return new Map();
    const views = await this.settlements.byIds(organizationId, issued);
    return new Map(views.map((v) => [v.invoiceId, v.settlement?.received ?? '0.00']));
  }

  // ── Préparer (§ 5.1) ─────────────────────────────────────────────────────

  /** `POST /sales/{orders|contracts}/:id/prepare-deposit` : BROUILLON `FT`/`ET`. */
  async prepare(
    organizationId: string,
    kind: DepositOwnerKind,
    id: string,
    input: PrepareDepositInput,
    actor: InvoiceActor,
  ): Promise<PreparedSalesDeposit> {
    const e = await this.reserve(
      organizationId,
      kind,
      id,
      input.expectedRevision,
      actor,
      kind === 'order' ? 'confirmed' : 'signed',
    );
    if (!isTaxGroupLetter(input.taxGroup)) {
      // Déjà refusé par le corps (400) : garde de type.
      conflict('UNKNOWN_TAX_GROUP', 'Groupe de taxation : une lettre de A à P.');
    }
    const warnings: SalesDepositWarning[] = [];
    const item = depositItemTypeOf(input.taxGroup, e.lines);
    if (item.toCheck) {
      warnings.push({
        code: 'DEPOSIT_ITEM_TYPE_TO_CHECK',
        message:
          'Le type d’article de la ligne d’acompte (service) n’a pas pu être repris de l’engagement : vérifiez-le avant d’émettre.',
        details: { itemType: item.itemType },
      });
    }
    const name =
      input.label ?? `Acompte — ${e.kind === 'order' ? 'commande' : 'contrat'} ${e.number}`;
    const draft: InvoiceDraftInput = {
      type: input.type,
      currency: e.currency,
      priceMode: e.priceMode,
      customer: { customerId: e.customerId, printContactDetails: e.printContactDetails },
      pointOfSaleId: null,
      lines: [
        {
          source: 'free',
          code: null,
          name,
          itemType: item.itemType,
          taxGroup: input.taxGroup,
          outOfScope: false,
          unit: null,
          quantity: '1',
          unitPrice: input.requestedAmount,
          specificTax: null,
          discount: null,
        },
      ],
      // Aucun paiement prérempli : l'utilisateur déclare les paiements à l'émission.
      payments: [],
      comments: { A: null, C: e.commentC },
      creditNote: null,
      showUsdCounterValue: false,
    };
    const invoice = await this.drafts.create(organizationId, draft, actor);
    try {
      await this.links.link(organizationId, {
        invoiceId: invoice.id,
        kind: e.kind === 'order' ? 'order_deposit' : 'contract_deposit',
        ...this.ownerOf(e),
        requestedAmount: input.requestedAmount,
        linkedBy: actor.userId,
      });
    } catch (err) {
      // Sans lien, l'acompte serait perdu pour l'engagement : le brouillon est retiré.
      await this.drafts.remove(organizationId, invoice.id, actor).catch(() => undefined);
      throw err;
    }
    const total = invoice.documentAmounts.calculation.totals?.total ?? null;
    if (sameAmount(total, input.requestedAmount) === false) {
      warnings.push({
        code: 'DEPOSIT_AMOUNT_MISMATCH',
        message:
          'Le total du brouillon (calculé par le moteur des factures) diffère du montant demandé : vérifiez-le avant de l’émettre. Rien n’est corrigé automatiquement.',
        details: { requestedAmount: input.requestedAmount, invoiceTotal: total },
      });
    }
    await this.record(organizationId, actor, e, 'deposit_prepared', {
      number: e.number,
      invoiceId: invoice.id,
      type: input.type,
      requestedAmount: input.requestedAmount,
      taxGroup: input.taxGroup,
    });
    return {
      invoiceId: invoice.id,
      warnings,
      deposits: await this.viewOf(organizationId, e),
    };
  }

  // ── Geste « traité » (§ 5.2) ─────────────────────────────────────────────

  /** `POST /sales/{orders|contracts}/:id/deposits/:invoiceId/resolved` : déclaratif. */
  async resolve(
    organizationId: string,
    kind: DepositOwnerKind,
    id: string,
    invoiceId: string,
    input: ResolveDepositInput,
    actor: InvoiceActor,
  ): Promise<SalesDepositsView> {
    const before = await this.engagementOf(organizationId, kind, id);
    const live = await this.links.liveLinks(organizationId, [this.ownerOf(before)]);
    const deposit = live.find((l) => isDepositLink(l) && l.link.invoiceId === invoiceId);
    if (!deposit) depositNotFound();
    if (invoiceStateOf(deposit.invoice.status) !== 'issued') {
      conflict(
        'DEPOSIT_NOT_ISSUED',
        'Seule une facture d’acompte émise peut être marquée « traitée ».',
        { status: deposit.invoice.status },
      );
    }
    const existing = await this.resolutions
      .findOne({ organizationId, invoiceId })
      .lean<SalesDepositResolutionLean>()
      .exec();
    if (existing) {
      conflict('DEPOSIT_ALREADY_RESOLVED', 'Cette facture d’acompte est déjà marquée « traitée ».');
    }
    const e = await this.reserve(organizationId, kind, id, input.expectedRevision, actor, null);
    try {
      await this.resolutions.create({
        organizationId,
        invoiceId,
        orderId: e.kind === 'order' ? e.id : null,
        contractId: e.kind === 'contract' ? e.id : null,
        reason: input.reason,
        resolvedBy: actor.userId,
        resolvedAt: new Date(),
        revision: 1,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (isDuplicateKey(err)) {
        conflict(
          'DEPOSIT_ALREADY_RESOLVED',
          'Cette facture d’acompte est déjà marquée « traitée ».',
        );
      }
      throw err;
    }
    await this.record(organizationId, actor, e, 'deposit_resolved', {
      number: e.number,
      invoiceId,
      reason: input.reason,
    });
    return this.viewOf(organizationId, e);
  }
}
