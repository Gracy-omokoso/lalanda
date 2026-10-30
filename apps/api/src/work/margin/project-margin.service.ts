// Marge encaissée d'un projet du RUN — ADR-0039 § 5 (lot L4a).
//
// Ce service ne CALCULE rien : il lit, dans l'organisation courante seulement,
// les factures liées au projet (`work_invoice_links` → `sales_invoices`), leurs
// avoirs, les lettrages des encaissements non annulés (`sales_receipts`), les
// dépenses rattachées (`treasury_expenses.workProjectId`), le temps saisi et les
// taux horaires, puis délègue TOUT au moteur (`computeProjectMargin`).
//
// Lecture seule partout : la marge se recalcule à chaque lecture et n'est écrite
// NULLE PART — ni dans `actual_periods`, ni dans un plan (ADR-0018).
//
// Le détail par membre (minutes × taux) n'est rendu qu'au détenteur de
// `treasury.manage` (contrôle `can()`), pour ne pas révéler un taux horaire.
//
// ADR-0044 § 6.1 (P6) : coûts engagés `committed` et `ordered`, INFORMATIFS, lus par
// le port `WORK_PURCHASES_SOURCE` seulement si l'appelant détient `purchase.read`
// (sinon rien n'est lu : `purchases: null`) ; jamais soustraits de la marge.

import {
  computeProjectMargin,
  type WorkMarginCreditNoteInput,
  type WorkMarginInvoiceInput,
} from '@lalanda/engine';
import type { ProjectMarginQuery, ProjectMarginView } from '@lalanda/shared/work';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { kinshasaDayOf } from '../../sales/receipts/kinshasa-day.js';
import { actorCan, isWorkId, oid, type WorkActor } from '../work.common.js';
import {
  WORK_PURCHASES_SOURCE,
  noWorkPurchases,
  type WorkPurchasesRead,
  type WorkPurchasesSource,
} from './work-purchases.port.js';
import { WorkMembersService } from '../work-members.service.js';
import { WorkProjectsService } from '../work-projects.service.js';
import {
  WorkMemberRate,
  WorkTimeEntry,
  type WorkMemberRateDocument,
  type WorkTimeEntryDocument,
} from '../work.schemas.js';
import {
  WorkInvoiceLink,
  type WorkInvoiceLinkDocument,
  type WorkInvoiceLinkLean,
} from '../billing/work-invoice-link.schema.js';

/** Collections d'autres modules, lues en lecture seule. */
const INVOICES = 'sales_invoices';
const RECEIPTS = 'sales_receipts';
const EXPENSES = 'treasury_expenses';

/** Statuts définitifs d'un document de vente (ADR-0031 § 2). */
const FINAL_STATUSES: readonly string[] = ['issued', 'normalized'];
const CREDIT_NOTE_TYPES: readonly string[] = ['FA', 'EA'];

export interface SalesDocRead {
  _id: unknown;
  type: string;
  status: string;
  series: string | null;
  currency: 'CDF' | 'USD';
  issuedAt: Date | null;
  payments: { method: string; amount: string }[] | null;
  documentAmounts?: {
    calculation?: { totals?: { groups?: { group: string; ht: string }[] } | null };
  };
  creditNote?: { originInvoiceId: string | null } | null;
}

const SALES_PROJECTION = {
  type: 1,
  status: 1,
  series: 1,
  currency: 1,
  issuedAt: 1,
  payments: 1,
  'documentAmounts.calculation.totals.groups': 1,
  'creditNote.originInvoiceId': 1,
} as const;

/** Document définitif de la série réelle : il porte de l'argent. */
export function isFinal(doc: SalesDocRead): boolean {
  return FINAL_STATUSES.includes(doc.status) && doc.series !== 'test';
}

function taxGroupsOf(doc: SalesDocRead): WorkMarginInvoiceInput['taxGroups'] {
  return (doc.documentAmounts?.calculation?.totals?.groups ?? []).map((g) => ({
    group: g.group as WorkMarginInvoiceInput['taxGroups'][number]['group'],
    ht: g.ht,
  }));
}

@Injectable()
export class ProjectMarginService {
  private readonly purchases: WorkPurchasesSource;

  constructor(
    @InjectModel(WorkInvoiceLink.name) private readonly links: Model<WorkInvoiceLinkDocument>,
    @InjectModel(WorkTimeEntry.name) private readonly time: Model<WorkTimeEntryDocument>,
    @InjectModel(WorkMemberRate.name) private readonly rates: Model<WorkMemberRateDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    // ADR-0044 — P6 : facultatif, fournisseur nul sans module des achats.
    @Optional() @Inject(WORK_PURCHASES_SOURCE) purchases: WorkPurchasesSource | null = null,
  ) {
    this.purchases = purchases ?? noWorkPurchases;
  }

  async margin(
    organizationId: string,
    projectId: string,
    query: ProjectMarginQuery,
    actor: WorkActor,
  ): Promise<ProjectMarginView> {
    await this.projects.requireOwn(organizationId, projectId);

    const links = await this.links
      .find({ organizationId, projectId })
      .lean<WorkInvoiceLinkLean[]>()
      .exec();
    const invoiceIds = [...new Set(links.map((l) => l.invoiceId).filter(isWorkId))];

    const [invoiceDocs, creditNoteDocs, receipts, expenses, entries] = await Promise.all([
      invoiceIds.length === 0
        ? []
        : (this.connection
            .collection(INVOICES)
            .find(
              { organizationId, _id: { $in: invoiceIds.map(oid) } },
              { projection: SALES_PROJECTION },
            )
            .toArray() as unknown as Promise<SalesDocRead[]>),
      invoiceIds.length === 0
        ? []
        : (this.connection
            .collection(INVOICES)
            .find(
              {
                organizationId,
                type: { $in: CREDIT_NOTE_TYPES },
                'creditNote.originInvoiceId': { $in: invoiceIds },
              },
              { projection: SALES_PROJECTION },
            )
            .toArray() as unknown as Promise<SalesDocRead[]>),
      invoiceIds.length === 0
        ? []
        : this.connection
            .collection(RECEIPTS)
            .find(
              { organizationId, status: 'recorded', invoiceIds: { $in: invoiceIds } },
              { projection: { receivedOn: 1, allocations: 1 } },
            )
            .toArray(),
      this.connection
        .collection(EXPENSES)
        .find(
          { organizationId, workProjectId: projectId, status: 'recorded' },
          // ADR-0045 — H5 : la catégorie sert au seul constat `personnel` (marge 1.2.0).
          { projection: { spentOn: 1, amount: 1, currency: 1, category: 1 } },
        )
        .toArray(),
      this.time
        .find(
          { organizationId, projectId, deletedAt: null },
          { userId: 1, workedOn: 1, minutes: 1 },
        )
        .lean<{ userId: string; workedOn: string; minutes: number }[]>()
        .exec(),
    ]);
    // ADR-0044 § 6.1 : achats lus seulement avec `purchase.read` (droits effectifs).
    const purchasesRead: WorkPurchasesRead | null = actorCan(actor, 'purchase.read')
      ? await this.purchases.purchasesOf(organizationId, projectId)
      : null;
    const userIds = [...new Set(entries.map((e) => e.userId))];
    const rates =
      userIds.length === 0
        ? []
        : await this.rates
            .find(
              { organizationId, userId: { $in: userIds } },
              { userId: 1, currency: 1, hourlyCost: 1, effectiveFrom: 1 },
            )
            .lean<
              {
                userId: string;
                currency: 'CDF' | 'USD';
                hourlyCost: string;
                effectiveFrom: string;
              }[]
            >()
            .exec();

    // Lettrages par facture, datés du jour de l'encaissement.
    const allocationsBy = new Map<string, { receivedOn: string; amount: string }[]>();
    for (const r of receipts) {
      const receivedOn = String(r['receivedOn']);
      for (const a of (r['allocations'] ?? []) as { invoiceId: string; amount: string }[]) {
        if (!invoiceIds.includes(a.invoiceId)) continue;
        const list = allocationsBy.get(a.invoiceId) ?? [];
        list.push({ receivedOn, amount: a.amount });
        allocationsBy.set(a.invoiceId, list);
      }
    }

    // Un lien orphelin (brouillon supprimé) n'apporte rien : il est ignoré.
    const invoices: WorkMarginInvoiceInput[] = invoiceDocs
      .filter((d) => !CREDIT_NOTE_TYPES.includes(d.type))
      .map((d) => {
        const id = String(d._id);
        const final = isFinal(d) && d.issuedAt !== null;
        return {
          id,
          currency: d.currency,
          final,
          issuedOn: final ? kinshasaDayOf(new Date(d.issuedAt as Date)) : null,
          payments: d.payments ?? [],
          allocations: allocationsBy.get(id) ?? [],
          taxGroups: taxGroupsOf(d),
        };
      });
    const creditNotes: WorkMarginCreditNoteInput[] = creditNoteDocs.map((d) => {
      const final = isFinal(d) && d.issuedAt !== null;
      return {
        id: String(d._id),
        currency: d.currency,
        final,
        issuedOn: final ? kinshasaDayOf(new Date(d.issuedAt as Date)) : null,
        payments: d.payments ?? [],
        taxGroups: taxGroupsOf(d),
      };
    });

    const result = computeProjectMargin({
      invoices,
      creditNotes,
      expenses: expenses.map((e) => ({
        id: String(e['_id']),
        currency: e['currency'] as 'CDF' | 'USD',
        spentOn: String(e['spentOn']),
        amount: String(e['amount']),
        category: typeof e['category'] === 'string' ? (e['category'] as string) : null,
      })),
      timeEntries: entries.map((e) => ({
        userId: e.userId,
        workedOn: e.workedOn,
        minutes: e.minutes,
      })),
      rates,
      from: query.from ?? null,
      to: query.to ?? null,
      ...(purchasesRead === null ? {} : { purchases: { projectId, ...purchasesRead } }),
    });

    let byMember: ProjectMarginView['byMember'] = null;
    if (actorCan(actor, 'treasury.manage')) {
      const refs = await this.members.refs(result.byMember.map((m) => m.userId));
      byMember = result.byMember.map((m) => ({
        user: WorkMembersService.refOf(refs, m.userId),
        currency: m.currency,
        minutes: m.minutes,
        cost: m.cost,
      }));
    }

    return {
      projectId,
      version: result.version,
      from: result.from,
      to: result.to,
      currencies: result.currencies,
      findings: result.findings,
      minutesWithoutRate: result.minutesWithoutRate,
      byMember,
      purchases: result.purchases ?? null,
    };
  }
}
