// Réconciliation fiches clients ↔ comptes CRM (ADR-0040 § 2.1). ADR-0040 — C1.
//
// Tâche récurrente `crm.accounts-reconcile` de l'ordonnanceur (ADR-0020), une
// fois par jour, 1 000 fiches au plus par passage. Elle rattrape une
// synchronisation perdue (panne entre l'écriture de la fiche client et celle du
// compte) :
//
//   1. fiche client sans compte, ou dont le compte n'a pas le même nom ou le même
//      état actif → `CrmAccountsSync.sync` (création ou recopie) ;
//   2. compte client dont la fiche n'existe plus → le compte redevient prospect.
//
// Idempotente : un second passage ne trouve plus d'écart et n'écrit rien.

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';

import { Customer, type CustomerDocument } from '../../sales/customer.schema.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { CrmAccount, type CrmAccountDocument } from './crm-account.schema.js';
import { CrmAccountsSync } from './crm-accounts-sync.service.js';

export const CRM_ACCOUNTS_RECONCILE_JOB = 'crm.accounts-reconcile';
export const CRM_ACCOUNTS_RECONCILE_EVERY_MS = 24 * 60 * 60_000;
/** Fiches (et comptes orphelins) au plus par passage. */
export const CRM_ACCOUNTS_RECONCILE_BATCH = 1_000;

export interface ReconcileReport {
  examined: number;
  created: number;
  updated: number;
  reverted: number;
  failed: number;
}

@Injectable()
export class CrmAccountsReconcileJob implements OnModuleInit {
  private readonly logger = new Logger('CrmComptesReconciliation');

  constructor(
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(CrmAccount.name) private readonly accounts: Model<CrmAccountDocument>,
    @Inject(CrmAccountsSync) private readonly sync: CrmAccountsSync,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(CRM_ACCOUNTS_RECONCILE_JOB, CRM_ACCOUNTS_RECONCILE_EVERY_MS, async () => {
      const report = await this.run();
      if (report.examined > 0) this.logger.log(`réconciliation : ${JSON.stringify(report)}`);
    });
  }

  async run(batch: number = CRM_ACCOUNTS_RECONCILE_BATCH): Promise<ReconcileReport> {
    const report: ReconcileReport = { examined: 0, created: 0, updated: 0, reverted: 0, failed: 0 };

    // 1. Fiches sans compte ou dont le compte diverge.
    const drifted = await this.customers
      .aggregate<{ _id: Types.ObjectId; organizationId: string }>([
        {
          $lookup: {
            from: this.accounts.collection.collectionName,
            let: { org: '$organizationId', cid: { $toString: '$_id' } },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$organizationId', '$$org'] },
                      { $eq: ['$customerId', '$$cid'] },
                    ],
                  },
                },
              },
              { $project: { name: 1, active: 1 } },
            ],
            as: 'account',
          },
        },
        {
          $match: {
            $expr: {
              $or: [
                { $eq: [{ $size: '$account' }, 0] },
                { $ne: [{ $first: '$account.name' }, '$name'] },
                { $ne: [{ $first: '$account.active' }, '$active'] },
              ],
            },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: batch },
        { $project: { organizationId: 1 } },
      ])
      .exec();
    for (const c of drifted) {
      this.count(
        report,
        await this.sync.sync(c.organizationId, String(c._id)).catch(() => 'failed' as const),
      );
    }

    // 2. Comptes client dont la fiche n'existe plus.
    const left = batch - drifted.length;
    if (left > 0) {
      const orphans = await this.accounts
        .aggregate<{ organizationId: string; customerId: string }>([
          { $match: { customerId: { $type: 'string' } } },
          {
            $lookup: {
              from: this.customers.collection.collectionName,
              let: {
                org: '$organizationId',
                cid: {
                  $convert: { input: '$customerId', to: 'objectId', onError: null, onNull: null },
                },
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [{ $eq: ['$_id', '$$cid'] }, { $eq: ['$organizationId', '$$org'] }],
                    },
                  },
                },
                { $project: { _id: 1 } },
              ],
              as: 'customer',
            },
          },
          { $match: { customer: { $size: 0 } } },
          { $sort: { _id: 1 } },
          { $limit: left },
          { $project: { organizationId: 1, customerId: 1 } },
        ])
        .exec();
      for (const a of orphans) {
        this.count(
          report,
          await this.sync.sync(a.organizationId, a.customerId).catch(() => 'failed' as const),
        );
      }
    }
    return report;
  }

  private count(report: ReconcileReport, outcome: string): void {
    report.examined += 1;
    if (outcome === 'created') report.created += 1;
    else if (outcome === 'updated') report.updated += 1;
    else if (outcome === 'reverted') report.reverted += 1;
    else if (outcome === 'failed') report.failed += 1;
  }
}
