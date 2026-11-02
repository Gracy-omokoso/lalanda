// Fournisseur RÉEL du port `SALES_CONTRACTS_AGENDA_SOURCE` de « Mes tâches » —
// ADR-0050 § 6. ADR-0050 — V6.
//
// LECTURE SEULE (motif de `PurchasesAgendaSource`, ADR-0044 — P3) : rien n'est copié dans
// `work_tasks` ni écrit nulle part. Les éléments viennent du moteur (`contractAlerts`,
// § 7) ; les échéances bloquées, de l'échéancier du lot V5
// (`SalesSubscriptionsService.schedule`) ; l'acompte non « traité », du moteur
// (`depositSummary`, § 5.2). Chaque élément est montré selon les droits EFFECTIFS passés
// par `WorkTasksService.myTasks` (qui n'appelle ce fournisseur qu'avec `sales.read`) :
//
//   - contrat ou avenant à approuver, reconduction à constater : `sales.contract.approve`
//     (séparation des tâches de la route d'approbation) ;
//   - préavis, fin de terme, copie signée manquante, échéance bloquée : le responsable ;
//   - brouillons d'échéance à émettre : `sales.invoice` (un élément agrégé) ;
//   - acompte à marquer « traité » : `sales.manage`.
//
// Isolation : toute lecture porte `organizationId`.

import {
  contractAlerts,
  depositSummary,
  termsAt,
  type AlertContractInput,
  type ContractAlert,
} from '@lalanda/engine';
import type { SalesContractMyTaskItem } from '@lalanda/shared/sales-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuthzService } from '../../../authz/authz.service.js';
import { kinshasaDay } from '../../../crm/crm-model.js';
import type {
  SalesContractsAgendaActor,
  SalesContractsAgendaPage,
  SalesContractsAgendaReader,
} from '../../../work/my-tasks.ports.js';
import {
  SalesContractAmendment,
  type SalesContractAmendmentDocument,
  type SalesContractAmendmentLean,
} from '../amendments/sales-contract-amendment.schema.js';
import { engineAmendmentOf, engineContractOf } from '../contracts/sales-contract-model.js';
import {
  SalesContract,
  type SalesContractDocument,
  type SalesContractLean,
} from '../contracts/sales-contract.schema.js';
import { DEPOSIT_LINK_KINDS, FINAL_LINK_KINDS } from '../deposits/sales-deposit-model.js';
import {
  SalesDepositResolution,
  type SalesDepositResolutionDocument,
  type SalesDepositResolutionLean,
} from '../deposits/sales-deposit-resolution.schema.js';
import {
  SalesContractFile,
  type SalesContractFileDocument,
} from '../files/sales-contract-file.schema.js';
import {
  SalesDocumentLink,
  type SalesDocumentLinkDocument,
  type SalesDocumentLinkLean,
} from '../links/sales-document-link.schema.js';
import {
  SalesDocumentLinksService,
  invoiceStateOf,
} from '../links/sales-document-links.service.js';
import { SalesOrder, type SalesOrderDocument } from '../orders/sales-order.schema.js';
import { SalesContractSettingsService } from '../settings/sales-contract-settings.service.js';
import { SalesSubscriptionsService } from '../subscriptions/sales-subscriptions.service.js';
import {
  compareAgendaItems,
  depositItem,
  isForViewer,
  itemOfAlert,
  type AgendaAmendmentRef,
  type AgendaContractRef,
} from './contracts-agenda-model.js';

/** Contrats lus au plus par organisation pour les alertes (borne de lecture). */
export const CONTRACTS_AGENDA_SCAN_MAX = 2_000;
/** Liens d'acompte lus au plus par organisation. */
const DEPOSIT_LINKS_SCAN_MAX = 2_000;
/** Fenêtre des échéances bloquées : celle de rattrapage de la tâche (§ 5.3). */
const BLOCKED_PAST_DAYS = 90;
/** Délai de préparation maximal (`subscriptionLeadDays` ≤ 30). */
const BLOCKED_LEAD_DAYS = 30;

const ALERT_STATUSES = ['submitted', 'signed', 'terminated'] as const;

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

const dayOf = (d: Date | null | undefined): string | null => (d ? kinshasaDay(new Date(d)) : null);

/** Ce que l'analyse d'une organisation produit (partagée avec la tâche des rappels). */
export interface ContractsAlertScan {
  today: string;
  alerts: ContractAlert[];
  contracts: Map<string, AgendaContractRef>;
  amendments: Map<string, AgendaAmendmentRef>;
  truncated: boolean;
}

@Injectable()
export class SalesContractsAgendaSource implements SalesContractsAgendaReader {
  private readonly logger = new Logger('SalesContractsAgenda');

  constructor(
    @InjectModel(SalesContract.name) private readonly contracts: Model<SalesContractDocument>,
    @InjectModel(SalesContractAmendment.name)
    private readonly amendments: Model<SalesContractAmendmentDocument>,
    @InjectModel(SalesContractFile.name) private readonly files: Model<SalesContractFileDocument>,
    @InjectModel(SalesDocumentLink.name)
    private readonly links: Model<SalesDocumentLinkDocument>,
    @InjectModel(SalesDepositResolution.name)
    private readonly resolutions: Model<SalesDepositResolutionDocument>,
    @InjectModel(SalesOrder.name) private readonly orders: Model<SalesOrderDocument>,
    @Inject(SalesDocumentLinksService) private readonly linksService: SalesDocumentLinksService,
    @Inject(SalesContractSettingsService) private readonly settings: SalesContractSettingsService,
    @Inject(SalesSubscriptionsService) private readonly subscriptions: SalesSubscriptionsService,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  async agendaOf(
    organizationId: string,
    actor: SalesContractsAgendaActor,
    limit: number,
    now: Date,
  ): Promise<SalesContractsAgendaPage> {
    const [settings, approverCount] = await Promise.all([
      this.settings.values(organizationId),
      actor.holdsApprove
        ? this.authz.countApprovers(organizationId, 'sales.contract.approve')
        : Promise.resolve(0),
    ]);
    const scan = await this.scan(organizationId, now, {
      blockedFor: actor.userId,
      withDrafts: actor.holdsInvoice,
    });
    const viewer = {
      userId: actor.userId,
      holdsApprove: actor.holdsApprove,
      holdsInvoice: actor.holdsInvoice,
      approverCount,
      allowSoleApprover: settings.allowSoleApprover,
    };
    const items: SalesContractMyTaskItem[] = [];
    for (const alert of scan.alerts) {
      const contract = alert.contractId ? (scan.contracts.get(alert.contractId) ?? null) : null;
      const amendment = alert.amendmentId ? (scan.amendments.get(alert.amendmentId) ?? null) : null;
      const doc = amendment ?? contract;
      if (!isForViewer(alert, viewer, doc)) continue;
      const item = itemOfAlert(alert, contract, amendment);
      if (item !== null) items.push(item);
    }
    let depositsTruncated = false;
    if (actor.holdsManage) {
      const deposits = await this.unresolvedDeposits(organizationId);
      items.push(...deposits.items);
      depositsTruncated = deposits.truncated;
    }
    items.sort(compareAgendaItems);
    return {
      items: items.slice(0, limit),
      truncated: scan.truncated || depositsTruncated || items.length > limit,
    };
  }

  /**
   * Alertes du moteur pour une organisation, au jour de Kinshasa. `blockedFor` : les
   * échéances bloquées ne sont calculées que pour les contrats de CE responsable (leur
   * seul destinataire) ; `null` = aucune. `withDrafts` : brouillons d'échéance à émettre.
   */
  async scan(
    organizationId: string,
    now: Date,
    opts: { blockedFor: string | null; withDrafts: boolean },
  ): Promise<ContractsAlertScan> {
    const today = kinshasaDay(now);
    const settings = await this.settings.values(organizationId);
    const docs = await this.contracts
      .find(
        { organizationId, status: { $in: [...ALERT_STATUSES] } },
        { previousVersions: 0, searchKey: 0 },
      )
      .sort({ _id: 1 })
      .limit(CONTRACTS_AGENDA_SCAN_MAX + 1)
      .lean<SalesContractLean[]>()
      .exec();
    const truncated = docs.length > CONTRACTS_AGENDA_SCAN_MAX;
    const contracts = docs.slice(0, CONTRACTS_AGENDA_SCAN_MAX);
    const ids = contracts.map((c) => String(c._id));
    const amendmentDocs =
      ids.length === 0
        ? []
        : await this.amendments
            .find({ organizationId, contractId: { $in: ids } })
            .sort({ contractId: 1, index: 1 })
            .lean<SalesContractAmendmentLean[]>()
            .exec();
    const approvedIds = amendmentDocs
      .filter((a) => a.status === 'approved')
      .map((a) => String(a._id));
    const withCopy = new Set(
      approvedIds.length === 0
        ? []
        : (
            await this.files
              .find(
                { organizationId, amendmentId: { $in: approvedIds }, kind: 'signed_copy' },
                { amendmentId: 1 },
              )
              .lean<{ amendmentId: string | null }[]>()
              .exec()
          ).map((f) => f.amendmentId),
    );
    const draftsByContract = opts.withDrafts
      ? await this.draftOccurrences(organizationId, contracts)
      : new Map<string, string[]>();

    const contractRefs = new Map<string, AgendaContractRef>();
    const amendmentRefs = new Map<string, AgendaAmendmentRef>();
    const inputs: AlertContractInput[] = [];
    for (const c of contracts) {
      const id = String(c._id);
      const own = amendmentDocs.filter((a) => a.contractId === id);
      contractRefs.set(id, {
        id,
        number: c.number,
        title: c.title,
        customerName: c.customer?.name ?? null,
        ownerUserId: c.ownerUserId,
        createdBy: c.createdBy,
        submittedBy: c.submittedBy ?? null,
      });
      for (const a of own) {
        amendmentRefs.set(String(a._id), {
          id: String(a._id),
          number: a.number,
          createdBy: a.createdBy,
          submittedBy: a.submittedBy ?? null,
        });
      }
      const blocked =
        opts.blockedFor !== null && c.ownerUserId === opts.blockedFor
          ? await this.blockedOccurrences(organizationId, c, own, today, now)
          : [];
      try {
        const input = this.alertInput(c, own, today, withCopy, draftsByContract.get(id) ?? []);
        input.blockedOccurrences = blocked;
        // Une donnée illisible n'emporte pas les alertes des autres contrats.
        contractAlerts([input], settings, today);
        inputs.push(input);
      } catch (err) {
        this.logger.warn(
          `Alertes du contrat ${c.number} (${organizationId}) non calculées : ${String(err)}`,
        );
      }
    }
    const { alerts } = contractAlerts(inputs, settings, today);
    return { today, alerts, contracts: contractRefs, amendments: amendmentRefs, truncated };
  }

  /** Contrat → entrée du moteur, conditions EN VIGUEUR au jour `today` (`termsAt`). */
  private alertInput(
    c: SalesContractLean,
    amendments: readonly SalesContractAmendmentLean[],
    today: string,
    withCopy: ReadonlySet<string | null>,
    draftDates: readonly string[],
  ): AlertContractInput & {
    blockedOccurrences: AlertContractInput['blockedOccurrences'];
  } {
    const active = c.status === 'signed' || c.status === 'terminated';
    const inForce = active
      ? termsAt(engineContractOf(c), amendments.map(engineAmendmentOf), today).terms
      : {
          initialTermMonths: c.initialTermMonths ?? null,
          renewal: c.renewal,
          noticeDays: c.noticeDays,
        };
    return {
      id: String(c._id),
      ownerUserId: c.ownerUserId,
      status: c.status as AlertContractInput['status'],
      submittedOn: dayOf(c.submittedAt),
      submittedBy: c.submittedBy ?? null,
      startDate: c.startDate,
      initialTermMonths: inForce.initialTermMonths,
      renewal: inForce.renewal,
      noticeDays: inForce.noticeDays,
      renewals: (c.renewals ?? []).map((r) => ({
        termIndex: r.termIndex,
        from: r.from,
        to: r.to,
        mode: r.mode,
      })),
      termination: c.termination
        ? { noticeGivenOn: c.termination.noticeGivenOn, effectiveOn: c.termination.effectiveOn }
        : null,
      amendments: amendments.map((a) => ({
        id: String(a._id),
        index: a.index,
        status: a.status,
        submittedOn: dayOf(a.submittedAt),
        submittedBy: a.submittedBy ?? null,
        approvedOn: dayOf(a.approvedAt),
        hasSignedCopy: withCopy.has(String(a._id)),
      })),
      draftOccurrenceDates: [...draftDates],
      blockedOccurrences: [],
    };
  }

  /**
   * Échéances bloquées d'un contrat signé ou résilié, lues de l'échéancier du lot V5 sur
   * la fenêtre de rattrapage de la tâche (`[aujourd'hui − 90 j, aujourd'hui + 30 j]`).
   * Un échéancier illisible ne bloque pas l'agenda : rien n'est signalé pour ce contrat.
   */
  private async blockedOccurrences(
    organizationId: string,
    c: SalesContractLean,
    amendments: readonly SalesContractAmendmentLean[],
    today: string,
    now: Date,
  ): Promise<AlertContractInput['blockedOccurrences']> {
    if (c.status !== 'signed' && c.status !== 'terminated') return [];
    const billed =
      c.billing.kind !== 'none' ||
      amendments.some((a) => a.status === 'signed' && a.changes?.billing !== undefined);
    if (!billed) return [];
    const from =
      c.startDate > addDays(today, -BLOCKED_PAST_DAYS)
        ? c.startDate
        : addDays(today, -BLOCKED_PAST_DAYS);
    const to = addDays(today, BLOCKED_LEAD_DAYS);
    if (from > to) return [];
    try {
      const view = await this.subscriptions.schedule(
        organizationId,
        String(c._id),
        { from, to },
        now,
      );
      return view.entries
        .filter((e) => e.state === 'blocked')
        .map((e) => ({ key: e.key, date: e.date, reasons: e.reasons.map((r) => r.code) }));
    } catch (err) {
      this.logger.warn(
        `Échéancier du contrat ${c.number} (${organizationId}) illisible : ${String(err)}`,
      );
      return [];
    }
  }

  /**
   * Brouillons d'échéance (abonnement ou échéancier) non émis, par contrat : date
   * d'échéance du lien. Lecture seule : un lien orphelin est ignoré, jamais supprimé ici.
   */
  private async draftOccurrences(
    organizationId: string,
    contracts: readonly SalesContractLean[],
  ): Promise<Map<string, string[]>> {
    const ids = contracts.map((c) => String(c._id));
    if (ids.length === 0) return new Map();
    const links = await this.links
      .find({
        organizationId,
        contractId: { $in: ids },
        kind: { $in: ['subscription_occurrence', 'schedule_item'] },
      })
      .lean<SalesDocumentLinkLean[]>()
      .exec();
    const invoices = await this.linksService.invoicesOf(
      organizationId,
      links.map((l) => l.invoiceId),
    );
    const dueOfItem = new Map<string, string>();
    for (const c of contracts) {
      if (c.billing.kind !== 'schedule') continue;
      for (const item of c.billing.items)
        dueOfItem.set(`${String(c._id)}:${item.itemRef}`, item.dueDate);
    }
    const out = new Map<string, string[]>();
    for (const l of links) {
      const inv = invoices.get(l.invoiceId);
      if (!inv || inv.status !== 'draft' || !l.contractId) continue;
      const date =
        l.occurrenceDate ??
        (l.itemRef ? dueOfItem.get(`${l.contractId}:${l.itemRef}`) : undefined) ??
        kinshasaDay(new Date(l.linkedAt));
      out.set(l.contractId, [...(out.get(l.contractId) ?? []), date]);
    }
    return out;
  }

  /**
   * Engagements dont un acompte ÉMIS n'est pas « traité » alors qu'une facture finale
   * existe (`DEPOSIT_NOT_RESOLVED`, moteur `depositSummary`). Un élément par engagement.
   */
  private async unresolvedDeposits(
    organizationId: string,
  ): Promise<{ items: SalesContractMyTaskItem[]; truncated: boolean }> {
    const depositLinks = await this.links
      .find({ organizationId, kind: { $in: [...DEPOSIT_LINK_KINDS] } })
      .sort({ _id: 1 })
      .limit(DEPOSIT_LINKS_SCAN_MAX + 1)
      .lean<SalesDocumentLinkLean[]>()
      .exec();
    const truncated = depositLinks.length > DEPOSIT_LINKS_SCAN_MAX;
    const deposits = depositLinks.slice(0, DEPOSIT_LINKS_SCAN_MAX);
    if (deposits.length === 0) return { items: [], truncated };
    const ownerKey = (l: SalesDocumentLinkLean): string | null =>
      l.orderId ? `order:${l.orderId}` : l.contractId ? `contract:${l.contractId}` : null;
    const orderIds = [...new Set(deposits.flatMap((l) => (l.orderId ? [l.orderId] : [])))];
    const contractIds = [...new Set(deposits.flatMap((l) => (l.contractId ? [l.contractId] : [])))];
    const or: Record<string, unknown>[] = [];
    if (orderIds.length > 0) or.push({ orderId: { $in: orderIds } });
    if (contractIds.length > 0) or.push({ contractId: { $in: contractIds } });
    const finals = await this.links
      .find({ organizationId, kind: { $in: [...FINAL_LINK_KINDS] }, $or: or })
      .lean<SalesDocumentLinkLean[]>()
      .exec();
    const [invoices, resolutions] = await Promise.all([
      this.linksService.invoicesOf(organizationId, [
        ...deposits.map((l) => l.invoiceId),
        ...finals.map((l) => l.invoiceId),
      ]),
      this.resolutions
        .find(
          { organizationId, invoiceId: { $in: deposits.map((l) => l.invoiceId) } },
          { invoiceId: 1 },
        )
        .lean<Pick<SalesDepositResolutionLean, 'invoiceId'>[]>()
        .exec(),
    ]);
    const resolved = resolutions.map((r) => r.invoiceId);

    const groups = new Map<
      string,
      { deposits: SalesDocumentLinkLean[]; finals: SalesDocumentLinkLean[] }
    >();
    for (const l of deposits) {
      const k = ownerKey(l);
      if (k === null || !invoices.has(l.invoiceId)) continue;
      const g = groups.get(k) ?? { deposits: [], finals: [] };
      g.deposits.push(l);
      groups.set(k, g);
    }
    for (const l of finals) {
      const k = ownerKey(l);
      const g = k === null ? undefined : groups.get(k);
      if (g && invoices.has(l.invoiceId)) g.finals.push(l);
    }

    const pending: { kind: 'order' | 'contract'; id: string; refs: string[] }[] = [];
    for (const [key, g] of groups) {
      if (g.finals.length === 0) continue;
      let unresolved: string[];
      try {
        unresolved = depositSummary(
          g.deposits.map((l) => {
            const inv = invoices.get(l.invoiceId)!;
            const total = inv.documentAmounts?.calculation?.totals?.total;
            if (typeof total !== 'string') throw new RangeError('Total illisible');
            return {
              invoiceId: l.invoiceId,
              currency: inv.currency,
              state: invoiceStateOf(inv.status),
              total,
              // L'encaissé n'entre pas dans `DEPOSIT_NOT_RESOLVED` : non lu ici.
              paid: '0.00',
              requestedAmount: null,
            };
          }),
          g.finals.map((l) => ({
            invoiceId: l.invoiceId,
            state: invoiceStateOf(invoices.get(l.invoiceId)!.status),
          })),
          resolved,
        ).unresolved;
      } catch {
        continue;
      }
      if (unresolved.length === 0) continue;
      const [kind, id] = key.split(':') as ['order' | 'contract', string];
      pending.push({
        kind,
        id,
        refs: unresolved.map((invoiceId) => {
          const inv = invoices.get(invoiceId)!;
          return inv.number ?? inv.proformaRef ?? '';
        }),
      });
    }
    if (pending.length === 0) return { items: [], truncated };

    const numbers = new Map<string, string>();
    const oid = (ids: string[]) =>
      ids.filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
    const [orderDocs, contractDocs] = await Promise.all([
      this.orders
        .find(
          {
            organizationId,
            _id: { $in: oid(pending.filter((p) => p.kind === 'order').map((p) => p.id)) },
          },
          { number: 1 },
        )
        .lean<{ _id: Types.ObjectId; number: string }[]>()
        .exec(),
      this.contracts
        .find(
          {
            organizationId,
            _id: { $in: oid(pending.filter((p) => p.kind === 'contract').map((p) => p.id)) },
          },
          { number: 1 },
        )
        .lean<{ _id: Types.ObjectId; number: string }[]>()
        .exec(),
    ]);
    for (const d of orderDocs) numbers.set(`order:${String(d._id)}`, d.number);
    for (const d of contractDocs) numbers.set(`contract:${String(d._id)}`, d.number);
    const items = pending.flatMap((p) => {
      const number = numbers.get(`${p.kind}:${p.id}`);
      return number === undefined
        ? []
        : [depositItem({ ownerKind: p.kind, ownerId: p.id, number, references: p.refs })];
    });
    return { items, truncated };
  }
}
