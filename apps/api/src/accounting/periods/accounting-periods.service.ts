// Exercices et périodes — STRUCTURE (ADR-0049 § 2.7). ADR-0049 — K4.
//
// Un exercice compte douze mois à partir du mois de début réglé (`fiscalYearStartMonth`,
// janvier par défaut, à confirmer par l'expert : E6, décision n° 19) ; il naît `open`
// avec ses douze périodes `open`. `year` est l'année civile de son premier jour. Les
// clôtures, réouvertures et à-nouveaux relèvent du lot K6 (`accounting.close`,
// `accountingReopenDecision`) : rien ici ne ferme ni ne rouvre.

import type {
  AccountingFiscalYearView,
  CreateAccountingFiscalYearBody,
} from '@lalanda/shared/accounting';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, isDuplicateKey, toIso, type AccountingActor } from '../accounting.common.js';
import { AccountingSettingsService } from '../settings/accounting-settings.service.js';
import {
  AccountingFiscalYear,
  AccountingPeriod,
  type AccountingFiscalYearLean,
  type AccountingPeriodLean,
} from './accounting-period.schema.js';

const pad = (n: number): string => String(n).padStart(2, '0');

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Douze mois civils à partir de `startMonth` de `year` : `{ year, month, start, end }`. */
export function fiscalYearMonths(
  year: number,
  startMonth: number,
): { year: number; month: number; start: string; end: string }[] {
  const months = [];
  for (let i = 0; i < 12; i += 1) {
    const index = startMonth - 1 + i;
    const y = year + Math.floor(index / 12);
    const m = (index % 12) + 1;
    months.push({
      year: y,
      month: m,
      start: `${y}-${pad(m)}-01`,
      end: `${y}-${pad(m)}-${pad(lastDay(y, m))}`,
    });
  }
  return months;
}

@Injectable()
export class AccountingPeriodsService {
  constructor(
    @InjectModel(AccountingFiscalYear.name)
    private readonly fiscalYears: Model<AccountingFiscalYearLean>,
    @InjectModel(AccountingPeriod.name) private readonly periods: Model<AccountingPeriodLean>,
    @Inject(AccountingSettingsService) private readonly settings: AccountingSettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<AccountingFiscalYearView[]> {
    const years = await this.fiscalYears
      .find({ organizationId })
      .sort({ year: -1 })
      .lean<AccountingFiscalYearLean[]>()
      .exec();
    const periods = await this.periods
      .find({ organizationId })
      .sort({ year: 1, month: 1 })
      .lean<AccountingPeriodLean[]>()
      .exec();
    return years.map((fy) => viewOf(fy, periods));
  }

  async create(
    organizationId: string,
    body: CreateAccountingFiscalYearBody,
    actor: AccountingActor,
  ): Promise<AccountingFiscalYearView> {
    const settings = await this.settings.ensure(organizationId, actor.userId);
    const months = fiscalYearMonths(body.year, settings.fiscalYearStartMonth);
    const base = {
      organizationId,
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
      closedAt: null,
      closedBy: null,
      reopenLog: [],
    };
    try {
      await this.fiscalYears.create({
        ...base,
        year: body.year,
        start: months[0]!.start,
        end: months[11]!.end,
        status: 'open',
      });
    } catch (err) {
      if (isDuplicateKey(err)) conflict('FISCAL_YEAR_EXISTS', 'Cet exercice existe déjà.');
      throw err;
    }
    try {
      await this.periods.insertMany(
        months.map((m) => ({ ...base, fiscalYear: body.year, ...m, status: 'open' })),
      );
    } catch (err) {
      // Un mois déjà couvert par un autre exercice : l'exercice créé est retiré.
      await this.periods.deleteMany({ organizationId, fiscalYear: body.year }).exec();
      await this.fiscalYears.deleteOne({ organizationId, year: body.year }).exec();
      if (isDuplicateKey(err)) {
        conflict('FISCAL_YEAR_OVERLAP', 'Ces mois appartiennent déjà à un autre exercice.');
      }
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.fiscal_year_created',
      targetType: 'accounting_fiscal_year',
      targetId: String(body.year),
      metadata: { start: months[0]!.start, end: months[11]!.end },
    });
    return (await this.list(organizationId)).find((fy) => fy.year === body.year)!;
  }

  /** Période contenant le jour `day` (`AAAA-MM-JJ`), `null` hors de tout exercice. */
  async periodOf(organizationId: string, day: string): Promise<AccountingPeriodLean | null> {
    return this.periods
      .findOne({ organizationId, start: { $lte: day }, end: { $gte: day } })
      .lean<AccountingPeriodLean>()
      .exec();
  }
}

function viewOf(
  fy: AccountingFiscalYearLean,
  periods: AccountingPeriodLean[],
): AccountingFiscalYearView {
  return {
    year: fy.year,
    start: fy.start,
    end: fy.end,
    status: fy.status,
    closedAt: toIso(fy.closedAt),
    periods: periods
      .filter((p) => p.fiscalYear === fy.year)
      .map((p) => ({
        year: p.year,
        month: p.month,
        start: p.start,
        end: p.end,
        status: p.status,
        closedAt: toIso(p.closedAt),
      })),
    revision: fy.revision,
  };
}
