// Export du journal électronique des ventes et des échanges e-MCF d'une
// organisation, sur une période — ADR-0026 § 6.3 (exigence 1.20, écart B3).
//
// LECTURE seule : les factures figées (via `InvoiceDraftsService`), les entrées
// du journal chaîné (via `InvoiceJournalService`, son seul écrivain) et le
// journal des échanges e-MCF. Rien n'est réécrit ; la chaîne est vérifiée
// entière (`verify`) et son état accompagne l'export. Une trace d'audit est
// posée à chaque export (qui, quand, quelle période, quel format).

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { FiscalProfileService } from '../../fiscal/fiscal-profile.service.js';
import { APP_VERSION } from '../../health/app-version.js';
import { JOURNAL_GENESIS_HASH } from './canonical.js';
import type {
  ExportedDgiExchange,
  ExportedInvoice,
  SalesJournalExport,
} from './invoice.contract.js';
import { InvoiceDraftsService } from './invoice-drafts.service.js';
import { InvoiceJournalService } from './invoice-journal.service.js';
import type { InvoiceActor } from './invoice.types.js';
import {
  JOURNAL_HASH_ALGORITHM,
  dgiExchangesCsv,
  exportedInvoiceOf,
  periodBounds,
  salesJournalCsv,
} from './journal-export.js';

/** Bornes de volume d'un export : au-delà, réduire la période. */
export const JOURNAL_EXPORT_LIMITS = {
  days: 366,
  invoices: 5_000,
  journalEntries: 50_000,
  exchanges: 20_000,
} as const;

export type JournalExportFormat = 'json' | 'csv';
export type JournalExportDataset = 'ventes' | 'echanges';

export interface JournalExportQuery {
  from: string;
  to: string;
  format: JournalExportFormat;
  dataset: JournalExportDataset;
}

export interface JournalExportFile {
  fileName: string;
  contentType: string;
  body: string;
}

interface ExchangeDoc {
  _id: unknown;
  at: Date;
  exchangeId?: string | null;
  entry?: 'request' | 'response' | 'complete' | null;
  invoiceId?: string | null;
  rn?: string | null;
  uid?: string | null;
  environment: 'test' | 'production';
  method: string;
  path: string;
  httpStatus?: number | null;
  durationMs?: number | null;
  outcome?: string | null;
  dgiErrorCode?: string | null;
  requestBody?: string | null;
  responseBody?: string | null;
}

function tooLarge(what: string, limit: number): never {
  throw new BadRequestException({
    code: 'EXPORT_TOO_LARGE',
    message: `La période contient plus de ${limit} ${what} : réduisez-la (un mois, un trimestre).`,
    details: { limit },
  });
}

@Injectable()
export class JournalExportService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(InvoiceDraftsService) private readonly drafts: InvoiceDraftsService,
    @Inject(InvoiceJournalService) private readonly journal: InvoiceJournalService,
    @Inject(FiscalProfileService) private readonly profiles: FiscalProfileService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Export complet (forme JSON). */
  async build(organizationId: string, from: string, to: string): Promise<SalesJournalExport> {
    const { start, end, days } = periodBounds(from, to);
    if (!(days >= 1) || days > JOURNAL_EXPORT_LIMITS.days) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: `La période va du ${from} au ${to} : elle doit compter de 1 à ${JOURNAL_EXPORT_LIMITS.days} jours.`,
        details: { issues: [{ path: 'to', code: 'INVALID_PERIOD', message: 'Période invalide.' }] },
      });
    }

    const [docs, entries, rawExchanges, profile, chainValid] = await Promise.all([
      this.drafts.finalBetween(organizationId, start, end, JOURNAL_EXPORT_LIMITS.invoices),
      this.journal.entriesBetween(
        organizationId,
        start,
        end,
        JOURNAL_EXPORT_LIMITS.journalEntries + 1,
      ),
      this.connection
        .collection<ExchangeDoc>('edef_exchanges')
        .find({ organizationId, at: { $gte: start, $lt: end } })
        .sort({ at: 1, _id: 1 })
        .limit(JOURNAL_EXPORT_LIMITS.exchanges + 1)
        .toArray(),
      this.profiles.find(organizationId),
      this.journal.verify(organizationId),
    ]);
    if (docs.length > JOURNAL_EXPORT_LIMITS.invoices) {
      tooLarge('factures', JOURNAL_EXPORT_LIMITS.invoices);
    }
    if (entries.length > JOURNAL_EXPORT_LIMITS.journalEntries) {
      tooLarge('entrées de journal', JOURNAL_EXPORT_LIMITS.journalEntries);
    }
    if (rawExchanges.length > JOURNAL_EXPORT_LIMITS.exchanges) {
      tooLarge('échanges avec la DGI', JOURNAL_EXPORT_LIMITS.exchanges);
    }

    const refs = await this.journal.entriesOfInvoices(
      organizationId,
      docs.map((d) => String(d._id)),
    );
    const byInvoice = new Map<string, typeof refs>();
    for (const r of refs) {
      const list = byInvoice.get(r.invoiceId) ?? [];
      list.push(r);
      byInvoice.set(r.invoiceId, list);
    }
    const invoices = docs
      .map((d) => exportedInvoiceOf(d, byInvoice.get(String(d._id)) ?? []))
      .filter((i): i is ExportedInvoice => i !== null);

    const dgiExchanges: ExportedDgiExchange[] = rawExchanges.map((r) => ({
      at: new Date(r.at).toISOString(),
      exchangeId: r.exchangeId ?? String(r._id),
      entry: r.entry ?? 'complete',
      invoiceId: r.invoiceId ?? null,
      rn: r.rn ?? null,
      uid: r.uid ?? null,
      environment: r.environment,
      method: r.method,
      path: r.path,
      httpStatus: r.httpStatus ?? null,
      durationMs: r.durationMs ?? null,
      outcome: r.outcome ?? null,
      dgiErrorCode: r.dgiErrorCode ?? null,
      requestBody: r.requestBody ?? null,
      responseBody: r.responseBody ?? null,
    }));

    const first = entries[0];
    const last = entries[entries.length - 1];
    return {
      format: 'lalanda.sales-journal',
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      softwareVersion: APP_VERSION.version,
      organization: {
        id: organizationId,
        legalName: profile?.legalName ?? null,
        nif: profile?.nif ?? null,
      },
      period: { from, to, timeZone: 'Africa/Kinshasa' },
      chain: {
        valid: chainValid,
        algorithm: JOURNAL_HASH_ALGORITHM,
        genesisHash: JOURNAL_GENESIS_HASH,
        entriesInPeriod: entries.length,
        firstSeq: first?.seq ?? null,
        lastSeq: last?.seq ?? null,
        anchorPrevHash: first?.prevHash ?? null,
        lastHash: last?.hash ?? null,
      },
      invoices,
      journal: entries,
      dgiExchanges,
    };
  }

  /** Fichier à télécharger, tracé dans le journal d'audit. */
  async file(
    organizationId: string,
    query: JournalExportQuery,
    actor: InvoiceActor,
  ): Promise<JournalExportFile> {
    const exp = await this.build(organizationId, query.from, query.to);
    const base = `journal-ventes_${query.from}_${query.to}`;
    const file: JournalExportFile =
      query.format === 'json'
        ? {
            fileName: `${base}.json`,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify(exp, null, 2),
          }
        : query.dataset === 'echanges'
          ? {
              fileName: `echanges-dgi_${query.from}_${query.to}.csv`,
              contentType: 'text/csv; charset=utf-8',
              body: dgiExchangesCsv(exp.dgiExchanges),
            }
          : {
              fileName: `${base}.csv`,
              contentType: 'text/csv; charset=utf-8',
              body: salesJournalCsv(exp),
            };
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'sales_journal.exported',
      targetType: 'sales_journal',
      targetId: organizationId,
      metadata: {
        from: query.from,
        to: query.to,
        format: query.format,
        dataset: query.format === 'json' ? 'complet' : query.dataset,
        invoices: exp.invoices.length,
        journalEntries: exp.journal.length,
        dgiExchanges: exp.dgiExchanges.length,
        chainValid: exp.chain.valid,
      },
    });
    return file;
  }
}
