// Tâche `sales.normalization.alerts` — toutes les 5 min (ADR-0024, décision
// ouverte n° 3, amendement du 21 oct. 2026).
//
// Elle LIT l'état durable et décide des alertes ; elle n'écrit que dans
// `normalization_alerts` (par `NormalizationAlertsService`). Lire l'état plutôt
// que d'écouter des événements : une alerte n'est pas perdue si le processus
// s'arrête entre l'écriture fiscale et l'envoi, elle part au passage suivant.
//
//  - normalisations incertaines : `pending_normalization` en phase `uncertain`
//    ou `needs_review` depuis plus de 15 min — une alerte par épisode (fenêtre =
//    début de l'incertitude) ;
//  - numéros abandonnés : entrées de journal `number_abandoned` des dernières
//    24 h (rattrape un arrêt) — une alerte par entrée (fenêtre = son heure) ;
//  - jetons expirés : points de vente activés dont `dgi.tokenValidUntil` est
//    passé — une alerte par échéance.
//
// Le refus d'un jeton (401) n'est pas un état durable : il est signalé sur le
// moment par la normalisation et le rattrapage (`tokenRejected`).

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { SalesInvoiceJournalEntry } from '../invoices/invoice-journal.schema.js';
import type { InvoiceLean } from '../invoices/invoice.types.js';
import {
  hourOf,
  NormalizationAlertsService,
  UNCERTAIN_ALERT_AFTER_MS,
  type NormalizationAlertOutcome,
} from './normalization-alerts.service.js';
import { NormalizationRecorder } from './normalization-recorder.js';

export const ALERTS_JOB = 'sales.normalization.alerts';
export const ALERTS_EVERY_MS = 5 * 60_000;
/** Profondeur de lecture du journal : rattrape une journée d'arrêt. */
export const ABANDONED_LOOKBACK_MS = 24 * 3600_000;
const LIMIT = 200;

export interface AlertsReport {
  uncertain: NormalizationAlertOutcome[];
  abandoned: NormalizationAlertOutcome[];
  tokenExpired: NormalizationAlertOutcome[];
}

interface JournalRow {
  organizationId: string;
  at: Date;
  invoiceId: string | null;
  number: string | null;
  proformaRef: string | null;
}

interface PointOfSaleRow {
  _id: unknown;
  organizationId: string;
  label: string;
  dgi: { tokenValidUntil: Date } | null;
}

/** Référence lisible d'un document : numéro réservé ou définitif, sinon pro forma. */
export function documentLabel(
  doc: Pick<InvoiceLean, 'number' | 'proformaRef' | 'normalization'>,
): string {
  return doc.normalization?.reservedNumber ?? doc.number ?? doc.proformaRef;
}

@Injectable()
export class NormalizationAlertsJob implements OnModuleInit {
  constructor(
    @Inject(NormalizationRecorder) private readonly recorder: NormalizationRecorder,
    @InjectModel(SalesInvoiceJournalEntry.name)
    private readonly journal: Model<SalesInvoiceJournalEntry>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(NormalizationAlertsService) private readonly alerts: NormalizationAlertsService,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(ALERTS_JOB, ALERTS_EVERY_MS, async (_payload, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date()): Promise<AlertsReport> {
    const report: AlertsReport = { uncertain: [], abandoned: [], tokenExpired: [] };

    const uncertain = await this.recorder.findUncertain(LIMIT);
    for (const doc of uncertain) {
      const n = doc.normalization!;
      const since = n.uncertainSince ?? n.review?.since ?? null;
      if (!since) continue;
      const start = new Date(since);
      if (now.getTime() - start.getTime() < UNCERTAIN_ALERT_AFTER_MS) continue;
      report.uncertain.push(
        await this.alerts.notify({
          organizationId: doc.organizationId,
          cause: 'normalization_uncertain',
          subject: { type: 'sales_invoice', id: String(doc._id), label: documentLabel(doc) },
          since: start,
          bucket: start,
          now,
        }),
      );
    }

    const abandoned = await this.journal
      .find(
        {
          event: 'number_abandoned',
          at: { $gte: new Date(now.getTime() - ABANDONED_LOOKBACK_MS) },
        },
        { organizationId: 1, at: 1, invoiceId: 1, number: 1, proformaRef: 1 },
      )
      .sort({ at: 1 })
      .limit(LIMIT)
      .lean<JournalRow[]>()
      .exec();
    for (const entry of abandoned) {
      if (!entry.invoiceId) continue;
      const at = new Date(entry.at);
      report.abandoned.push(
        await this.alerts.notify({
          organizationId: entry.organizationId,
          cause: 'number_abandoned',
          subject: {
            type: 'sales_invoice',
            id: entry.invoiceId,
            label: entry.proformaRef ?? entry.number ?? entry.invoiceId,
            number: entry.number,
          },
          since: at,
          bucket: hourOf(at),
          now,
        }),
      );
    }

    const expired = await this.connection
      .collection<PointOfSaleRow>('emcf_points_of_sale')
      .find(
        { enabled: true, 'dgi.tokenValidUntil': { $lte: now } },
        { projection: { organizationId: 1, label: 1, dgi: 1 } },
      )
      .limit(LIMIT)
      .toArray();
    for (const pos of expired) {
      if (!pos.dgi) continue;
      const until = new Date(pos.dgi.tokenValidUntil);
      report.tokenExpired.push(
        await this.alerts.notify({
          organizationId: pos.organizationId,
          cause: 'token_expired',
          subject: { type: 'point_of_sale', id: String(pos._id), label: pos.label },
          since: until,
          bucket: until,
          now,
        }),
      );
    }
    return report;
  }
}
