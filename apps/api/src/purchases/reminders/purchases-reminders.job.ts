// Rappels d'échéance des factures fournisseurs — ADR-0044 § 6.5. ADR-0044 — P6.
//
// Tâche récurrente `purchases.due-reminders` de l'ordonnanceur (ADR-0020), motif de
// `work.due-reminders` et `crm.due-reminders` : toutes les 15 minutes, à partir de
// 7 h à Kinshasa, 500 factures au plus par passage.
//
//   - `purchases.invoice_due_soon` : facture VALIDÉE, hors litige, reste à payer
//     positif, échéance dans [aujourd'hui, aujourd'hui + dueSoonDays] (réglages des
//     achats) ;
//   - `purchases.invoice_overdue`  : même facture, échéance < aujourd'hui.
//
// Destinataires : détenteurs EFFECTIFS de `payables.pay` (`holdersFilter`), refiltrés
// à la lecture par `purchase.read`. Une seule émission par (facture, échéance, type) :
// réclamation par insertion sous index unique (`purchase_due_reminders`), puis
// `dedupeKey = <type>:<invoiceId>:<échéance>`. Rejouer ne crée pas de doublon ;
// déplacer l'échéance rouvre le rappel. Le reste à payer vient du moteur
// (`payableSettlement`, via `settlementsOf`). Émission par le port, hors transaction.

import { NOTIFICATION_LIMITS } from '@lalanda/shared/notifications';
import { PURCHASE_SETTINGS_DEFAULTS } from '@lalanda/shared/purchases';
import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { holdersFilter } from '../../authz/authz.service.js';
import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../../notifications/notifications.port.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import {
  INVOICES,
  settlementsOf,
  supplierNamesOf,
  type PayableInvoiceDoc,
} from '../payments/payable-settlements.js';
import {
  PurchaseDueReminder,
  type PurchaseDueReminderDocument,
} from './purchase-due-reminder.schema.js';

export const PURCHASES_DUE_REMINDERS_JOB = 'purchases.due-reminders';
export const PURCHASES_DUE_REMINDERS_EVERY_MS = 15 * 60_000;
/** Heure de Kinshasa à partir de laquelle les rappels partent (comme `work` et `crm`). */
export const PURCHASES_DUE_REMINDERS_HOUR = 7;
/** Factures au plus par passage. */
export const PURCHASES_DUE_REMINDERS_BATCH = 500;
/** Plus grande fenêtre « bientôt » admise par les réglages (ADR-0044 § 2.2). */
const DUE_SOON_MAX = 30;

export interface PurchasesDueRemindersReport {
  claimed: number;
  notified: number;
  skipped: number;
}

type Kind = 'purchases.invoice_due_soon' | 'purchases.invoice_overdue';

function kinshasaHour(now: Date): number {
  return new Date(now.getTime() + 3_600_000).getUTCHours();
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number }).code === 11000;
}

@Injectable()
export class PurchasesDueRemindersJob implements OnModuleInit {
  private readonly logger = new Logger('AchatsRappels');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(
    @InjectModel(PurchaseDueReminder.name)
    private readonly claims: Model<PurchaseDueReminderDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
  ) {
    this.port = port ?? noNotifications;
  }

  onModuleInit(): void {
    this.scheduler.every(
      PURCHASES_DUE_REMINDERS_JOB,
      PURCHASES_DUE_REMINDERS_EVERY_MS,
      async (_p, ctx) => {
        await this.run(ctx.now);
      },
    );
  }

  async run(now: Date = new Date()): Promise<PurchasesDueRemindersReport> {
    const report: PurchasesDueRemindersReport = { claimed: 0, notified: 0, skipped: 0 };
    if (kinshasaHour(now) < PURCHASES_DUE_REMINDERS_HOUR) return report;
    const today = kinshasaDayOf(now);
    const open = (until: string) => ({
      status: 'validated',
      kind: 'invoice',
      disputed: null,
      dueDate: { $lte: until },
    });

    const orgs = (await this.connection
      .collection(INVOICES)
      .distinct('organizationId', open(addDays(today, DUE_SOON_MAX)))) as string[];
    for (const organizationId of orgs.sort()) {
      if (report.claimed >= PURCHASES_DUE_REMINDERS_BATCH) break;
      const settings = await this.connection
        .collection('purchase_settings')
        .findOne({ organizationId }, { projection: { dueSoonDays: 1 } });
      const dueSoonDays =
        typeof settings?.['dueSoonDays'] === 'number'
          ? (settings['dueSoonDays'] as number)
          : PURCHASE_SETTINGS_DEFAULTS.dueSoonDays;
      const rows = (await this.connection
        .collection(INVOICES)
        .find(
          { organizationId, ...open(addDays(today, dueSoonDays)) },
          {
            projection: {
              status: 1,
              kind: 1,
              total: 1,
              dueDate: 1,
              internalNumber: 1,
              supplierId: 1,
            },
          },
        )
        .sort({ dueDate: 1, _id: 1 })
        .toArray()) as unknown as PayableInvoiceDoc[];
      if (rows.length === 0) continue;

      // Factures déjà rappelées pour cette échéance : rien à réclamer.
      const kindOf = (dueDate: string): Kind =>
        dueDate < today ? 'purchases.invoice_overdue' : 'purchases.invoice_due_soon';
      const done = await this.claims
        .find(
          { organizationId, invoiceId: { $in: rows.map((r) => String(r._id)) } },
          { invoiceId: 1, kind: 1, dueDate: 1 },
        )
        .lean<{ invoiceId: string; kind: Kind; dueDate: string }[]>()
        .exec();
      const claimed = new Set(done.map((c) => `${c.invoiceId}|${c.kind}|${c.dueDate}`));
      const pending = rows
        .filter((r) => !claimed.has(`${String(r._id)}|${kindOf(r.dueDate)}|${r.dueDate}`))
        .slice(0, PURCHASES_DUE_REMINDERS_BATCH - report.claimed);
      if (pending.length === 0) continue;

      const [settlements, names, payers] = await Promise.all([
        settlementsOf(this.connection, organizationId, pending),
        supplierNamesOf(
          this.connection,
          organizationId,
          pending.map((r) => r.supplierId),
        ),
        this.connection
          .collection('memberships')
          .find(holdersFilter(organizationId, 'payables.pay'), { projection: { userId: 1 } })
          .toArray(),
      ]);
      const recipients = [
        ...new Set(payers.map((m) => String(m['userId'])).filter((u) => u.length > 0)),
      ].sort();

      for (const inv of pending) {
        const invoiceId = String(inv._id);
        const remaining = settlements.get(invoiceId)?.remaining ?? '0.00';
        if (remaining === '0.00') continue; // soldée : rien à rappeler
        const kind = kindOf(inv.dueDate);
        // Réclamer d'abord : deux passages concurrents ne servent jamais deux fois.
        try {
          await this.claims.create({
            organizationId,
            invoiceId,
            kind,
            dueDate: inv.dueDate,
            claimedAt: now,
          });
        } catch (err) {
          if (isDuplicateKey(err)) continue;
          throw err;
        }
        report.claimed += 1;
        if (recipients.length === 0) {
          report.skipped += 1;
          continue;
        }
        const name = names.get(inv.supplierId);
        const raw =
          kind === 'purchases.invoice_overdue'
            ? `Facture fournisseur en retard : ${inv.internalNumber}${name ? ` (${name})` : ''}, échéance ${inv.dueDate}`
            : inv.dueDate === today
              ? `Facture fournisseur à payer aujourd’hui : ${inv.internalNumber}${name ? ` (${name})` : ''}`
              : `Facture fournisseur à payer bientôt : ${inv.internalNumber}${name ? ` (${name})` : ''}, échéance ${inv.dueDate}`;
        const max = NOTIFICATION_LIMITS.titleMax;
        const title = raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
        for (const recipientUserId of recipients) {
          await this.port.notify({
            organizationId,
            recipientUserId,
            kind,
            requiredAction: 'purchase.read',
            source: { module: 'purchases', entityType: 'supplier_invoice', entityId: invoiceId },
            title,
            href: `/achats/factures/${invoiceId}`,
            actorUserId: null,
            dedupeKey: `${kind}:${invoiceId}:${inv.dueDate}`,
          });
        }
        report.notified += 1;
      }
    }
    if (report.claimed > 0) {
      this.logger.log(
        `Rappels de factures fournisseurs ${today} : ${report.notified} émis, ${report.skipped} sans destinataire.`,
      );
    }
    return report;
  }
}
