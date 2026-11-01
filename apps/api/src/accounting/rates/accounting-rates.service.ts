// Taux de change SAISIS (ADR-0049 § 2.7, § 5). ADR-0049 — K4.
//
// Un taux n'est jamais implicite : saisi par un humain, daté, source déclarée ; jamais
// importé d'office, jamais déduit d'un autre document, jamais celui de la veille. Le
// moteur (`applyRate`, K2) ne l'emploie que pour la date exacte de la pièce. Un taux
// dont la date tombe dans un mois CLOS ne se saisit ni ne se corrige
// (`409 RATE_IN_USE_IN_CLOSED_PERIOD`) : il servirait des écritures figées.

import type {
  AccountingBookCurrency,
  AccountingExchangeRateView,
  PutAccountingExchangeRateBody,
} from '@lalanda/shared/accounting';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import {
  badRequest,
  conflict,
  isDuplicateKey,
  staleRevision,
  type AccountingActor,
} from '../accounting.common.js';
import { AccountingPeriodsService } from '../periods/accounting-periods.service.js';
import {
  AccountingExchangeRate,
  type AccountingExchangeRateLean,
} from './accounting-exchange-rate.schema.js';

@Injectable()
export class AccountingRatesService {
  constructor(
    @InjectModel(AccountingExchangeRate.name)
    private readonly rates: Model<AccountingExchangeRateLean>,
    @Inject(AccountingPeriodsService) private readonly periods: AccountingPeriodsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<AccountingExchangeRateView[]> {
    const rows = await this.rates
      .find({ organizationId })
      .sort({ date: -1, from: 1, to: 1 })
      .limit(2000)
      .lean<AccountingExchangeRateLean[]>()
      .exec();
    return rows.map(viewOf);
  }

  async put(
    organizationId: string,
    date: string,
    from: AccountingBookCurrency,
    to: AccountingBookCurrency,
    body: PutAccountingExchangeRateBody,
    actor: AccountingActor,
  ): Promise<{ rate: AccountingExchangeRateView; created: boolean }> {
    if (from === to) {
      badRequest('RATE_SAME_CURRENCY', 'Un taux relie deux devises différentes.');
    }
    const period = await this.periods.periodOf(organizationId, date);
    if (period?.status === 'closed') {
      conflict(
        'RATE_IN_USE_IN_CLOSED_PERIOD',
        'Ce jour appartient à un mois clos : son taux ne se saisit plus.',
        { year: period.year, month: period.month },
      );
    }
    const existing = await this.rates
      .findOne({ organizationId, date, from, to })
      .lean<AccountingExchangeRateLean>()
      .exec();
    let saved: AccountingExchangeRateLean | null;
    let created = false;
    if (body.expectedRevision === null) {
      if (existing) staleRevision(existing.revision);
      try {
        await this.rates.create({
          organizationId,
          date,
          from,
          to,
          rate: body.rate,
          sourceText: body.sourceText,
          enteredBy: actor.userId,
          revision: 1,
          createdBy: actor.userId,
          updatedBy: actor.userId,
          _schemaVersion: 1,
        });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        staleRevision(1);
      }
      created = true;
      saved = await this.rates
        .findOne({ organizationId, date, from, to })
        .lean<AccountingExchangeRateLean>()
        .exec();
    } else {
      if (!existing) staleRevision(0);
      saved = await this.rates
        .findOneAndUpdate(
          { organizationId, date, from, to, revision: body.expectedRevision },
          {
            $set: {
              rate: body.rate,
              sourceText: body.sourceText,
              enteredBy: actor.userId,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { new: true },
        )
        .lean<AccountingExchangeRateLean>()
        .exec();
      if (!saved) staleRevision(existing.revision);
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: created ? 'accounting.rate_entered' : 'accounting.rate_changed',
      targetType: 'accounting_exchange_rate',
      targetId: `${date}:${from}:${to}`,
      metadata: {
        rate: body.rate,
        previousRate: existing?.rate ?? null,
        sourceText: body.sourceText,
      },
    });
    return { rate: viewOf(saved!), created };
  }
}

function viewOf(d: AccountingExchangeRateLean): AccountingExchangeRateView {
  return {
    date: d.date,
    from: d.from,
    to: d.to,
    rate: d.rate,
    sourceText: d.sourceText,
    enteredBy: d.enteredBy,
    revision: d.revision,
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}
