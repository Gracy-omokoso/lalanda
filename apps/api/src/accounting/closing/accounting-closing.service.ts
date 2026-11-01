// Clôtures de mois et d'exercice, réouvertures, à-nouveaux (ADR-0049 § 4). ADR-0049 — K6.
//
// - Mois (`accounting.close`) : `open → closed` si aucun brouillon ne l'occupe
//   (`409 PERIOD_HAS_DRAFTS`). Un mois clos refuse toute écriture nouvelle (K5) ; une
//   pièce modifiée après coup est contre-passée au premier jour ouvert (K5, n° 10).
// - Exercice (`accounting.close`) : tous les mois clos, aucune écriture en attente de
//   taux, aucun brouillon, le compte d'attente soldé OU son solde accepté explicitement
//   avec un motif (`409 FISCAL_YEAR_NOT_CLOSABLE`, `details.reasons[]`). Le moteur
//   (`computeOpeningEntries`) génère les à-nouveaux de l'exercice suivant, validés dans
//   le journal d'à-nouveaux au premier jour de cet exercice ; le résultat va au compte
//   désigné par le pack, à défaut au compte d'attente (traitement à confirmer, E7).
// - Réouverture (mois ou exercice) : Propriétaire SEUL, motif obligatoire
//   (`accountingReopenDecision`, `403 REOPEN_OWNER_ONLY`), journal en ajout seul, audit
//   strict. Rouvrir un exercice contre-passe ses à-nouveaux (décision ouverte n° 11).
// - Rien ici n'écrit dans le réalisé, un plan ou une pièce du RUN.

import {
  ACCOUNTING_REPORTING_VERSION,
  computeOpeningEntries,
  reverseEntry,
  type OpeningLine,
} from '@lalanda/engine';
import type {
  AccountingFiscalYearCloseView,
  AccountingFiscalYearView,
  AccountingReopenBody,
  CloseAccountingFiscalYearBody,
} from '@lalanda/shared/accounting';
import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { accountingReopenDecision } from '../../authz/permissions.js';
import { conflict, notFound, type AccountingActor } from '../accounting.common.js';
import type { AccountingEntryLean, StoredEntryLine } from '../entries/accounting-entry.schema.js';
import {
  AccountingEntryStore,
  proposedOf,
  type NewEntryDoc,
} from '../entries/accounting-entry-store.service.js';
import {
  AccountingFiscalYear,
  AccountingPeriod,
  type AccountingFiscalYearLean,
  type AccountingPeriodLean,
} from '../periods/accounting-period.schema.js';
import { AccountingPeriodsService } from '../periods/accounting-periods.service.js';
import { AccountingReportingService } from '../reports/accounting-reporting.service.js';
import { AccountingSettingsService } from '../settings/accounting-settings.service.js';
import type { AccountingSettingsLean } from '../settings/accounting-settings.schema.js';
import { ACCOUNTING_SUSPENSE_ACCOUNT, newEntryDoc } from '../sync/accounting-sync.service.js';
import { AccountingClosing, type AccountingClosingLean } from './accounting-closing.schema.js';

/** Clé d'opération des lignes d'à-nouveaux (aucune règle : report du moteur). */
const OPENING_OPERATION_KEY = 'closing.opening';

const abs = (v: string): string => (v.startsWith('-') ? v.slice(1) : v);

/** Ligne d'à-nouveau du moteur → ligne d'écriture enregistrée (montants recopiés). */
export function storedOpeningLine(l: OpeningLine, bookCurrency: string): StoredEntryLine {
  const side: 'debit' | 'credit' = l.debit !== null ? 'debit' : 'credit';
  const book = (l.debit ?? l.credit)!;
  const sameCurrency = l.currency === bookCurrency;
  const amount = sameCurrency ? book : abs(l.amount);
  return {
    operationKey: OPENING_OPERATION_KEY,
    side,
    accountNumber: l.accountNumber,
    auxiliaryAccountNumber: l.auxiliaryAccountNumber,
    label: l.label,
    currency: l.currency,
    amount,
    bookAmount: book,
    debit: side === 'debit' ? book : '0.00',
    credit: side === 'credit' ? book : '0.00',
    // Report d'un solde déjà converti : aucun taux nouveau n'est appliqué.
    rate: sameCurrency ? '1' : null,
    rateSource: sameCurrency ? 'same_currency' : null,
    rateRef: sameCurrency ? null : 'à-nouveau',
    letteringCode: null,
    matchRef: l.documentRef,
    suspenseReason: (l.suspenseReason ?? null) as StoredEntryLine['suspenseReason'],
    exchangeDifference: !sameCurrency && /^0+(\.0+)?$/.test(amount),
  };
}

@Injectable()
export class AccountingClosingService {
  constructor(
    @Inject(AccountingSettingsService) private readonly settings: AccountingSettingsService,
    @Inject(AccountingPeriodsService) private readonly periodsService: AccountingPeriodsService,
    @Inject(AccountingReportingService) private readonly reporting: AccountingReportingService,
    @Inject(forwardRef(() => AccountingEntryStore)) private readonly store: AccountingEntryStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @InjectModel(AccountingFiscalYear.name)
    private readonly fiscalYears: Model<AccountingFiscalYearLean>,
    @InjectModel(AccountingPeriod.name) private readonly periods: Model<AccountingPeriodLean>,
    @InjectModel(AccountingClosing.name) private readonly closings: Model<AccountingClosingLean>,
  ) {}

  // ── Briques ──────────────────────────────────────────────────────────────

  private async activeSettings(organizationId: string): Promise<AccountingSettingsLean> {
    const s = await this.settings.ensure(organizationId);
    if (s.mode !== 'active' || s.bookCurrency === null) {
      conflict(
        'ACCOUNTING_NOT_ACTIVE',
        'Les clôtures n’existent qu’en mode actif : en simulation, rien n’est enregistré.',
      );
    }
    return s;
  }

  private async fiscalYearView(
    organizationId: string,
    year: number,
  ): Promise<AccountingFiscalYearView> {
    const view = (await this.periodsService.list(organizationId)).find((f) => f.year === year);
    if (!view) notFound('FISCAL_YEAR_NOT_FOUND', 'Exercice introuvable.');
    return view;
  }

  private async findFiscalYear(
    organizationId: string,
    year: number,
  ): Promise<AccountingFiscalYearLean> {
    const fy = await this.fiscalYears
      .findOne({ organizationId, year })
      .lean<AccountingFiscalYearLean>()
      .exec();
    if (!fy) notFound('FISCAL_YEAR_NOT_FOUND', 'Exercice introuvable.');
    return fy;
  }

  private async findPeriod(
    organizationId: string,
    year: number,
    month: number,
  ): Promise<AccountingPeriodLean> {
    const p = await this.periods
      .findOne({ organizationId, year, month })
      .lean<AccountingPeriodLean>()
      .exec();
    if (!p) notFound('PERIOD_NOT_FOUND', 'Ce mois n’appartient à aucun exercice.');
    return p;
  }

  /** Propriétaire seul, motif obligatoire : le titre est jugé avant le motif. */
  private reopenReason(actor: AccountingActor, body: AccountingReopenBody): string {
    const d = accountingReopenDecision({ actorRole: actor.role, reason: body.reason });
    if (d.ok) return d.reason;
    if (d.code === 'REOPEN_OWNER_ONLY') {
      throw new ForbiddenException({
        code: 'REOPEN_OWNER_ONLY',
        message: 'Seul le Propriétaire rouvre une période comptable close.',
      });
    }
    throw new BadRequestException({
      code: 'REOPEN_REASON_REQUIRED',
      message: 'Un motif de réouverture est obligatoire : il reste inscrit au journal.',
    });
  }

  // ── Mois ─────────────────────────────────────────────────────────────────

  async closePeriod(
    organizationId: string,
    year: number,
    month: number,
    actor: AccountingActor,
  ): Promise<AccountingFiscalYearView> {
    await this.activeSettings(organizationId);
    const p = await this.findPeriod(organizationId, year, month);
    const fy = await this.findFiscalYear(organizationId, p.fiscalYear);
    if (fy.status !== 'open') {
      conflict('FISCAL_YEAR_CLOSED', 'L’exercice de ce mois est clos ou en cours de clôture.');
    }
    if (p.status === 'closed') conflict('PERIOD_ALREADY_CLOSED', 'Ce mois est déjà clos.');
    const drafts = await this.store.entries
      .countDocuments({ organizationId, status: 'draft', date: { $gte: p.start, $lte: p.end } })
      .exec();
    if (drafts > 0) {
      conflict(
        'PERIOD_HAS_DRAFTS',
        'Des écritures en brouillon occupent ce mois : validez-les ou supprimez-les avant de clôturer.',
        { drafts },
      );
    }
    const res = await this.periods
      .updateOne(
        { _id: p._id, organizationId, status: 'open' },
        {
          $set: {
            status: 'closed',
            closedAt: new Date(),
            closedBy: actor.userId,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.modifiedCount === 0) conflict('PERIOD_ALREADY_CLOSED', 'Ce mois est déjà clos.');
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.period_closed',
      targetType: 'accounting_period',
      targetId: `${year}-${String(month).padStart(2, '0')}`,
      metadata: { fiscalYear: p.fiscalYear },
    });
    return this.fiscalYearView(organizationId, p.fiscalYear);
  }

  async reopenPeriod(
    organizationId: string,
    year: number,
    month: number,
    body: AccountingReopenBody,
    actor: AccountingActor,
  ): Promise<AccountingFiscalYearView> {
    const reason = this.reopenReason(actor, body);
    await this.activeSettings(organizationId);
    const p = await this.findPeriod(organizationId, year, month);
    const fy = await this.findFiscalYear(organizationId, p.fiscalYear);
    if (fy.status !== 'open') {
      conflict(
        'FISCAL_YEAR_CLOSED',
        'L’exercice de ce mois est clos : rouvrez d’abord l’exercice.',
      );
    }
    if (p.status !== 'closed') conflict('PERIOD_NOT_CLOSED', 'Ce mois n’est pas clos.');
    const res = await this.periods
      .updateOne(
        { _id: p._id, organizationId, status: 'closed' },
        {
          $set: { status: 'open', closedAt: null, closedBy: null, updatedBy: actor.userId },
          $push: { reopenLog: { at: new Date(), by: actor.userId, reason } },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.modifiedCount === 0) conflict('PERIOD_NOT_CLOSED', 'Ce mois n’est pas clos.');
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.period_reopened',
      targetType: 'accounting_period',
      targetId: `${year}-${String(month).padStart(2, '0')}`,
      metadata: { fiscalYear: p.fiscalYear, reason },
    });
    return this.fiscalYearView(organizationId, p.fiscalYear);
  }

  // ── Exercice ─────────────────────────────────────────────────────────────

  async closeFiscalYear(
    organizationId: string,
    year: number,
    body: CloseAccountingFiscalYearBody,
    actor: AccountingActor,
  ): Promise<AccountingFiscalYearCloseView> {
    const settings = await this.activeSettings(organizationId);
    const fy = await this.findFiscalYear(organizationId, year);
    if (fy.status === 'closed') conflict('FISCAL_YEAR_CLOSED', 'Cet exercice est déjà clos.');
    if (fy.status === 'closing') {
      conflict('FISCAL_YEAR_BUSY', 'Une clôture de cet exercice est déjà en cours.');
    }

    // Conditions, toutes listées (`details.reasons[]`), lues par le moteur.
    const reasons: { code: string; [k: string]: unknown }[] = [];
    const months = await this.periods
      .find({ organizationId, fiscalYear: year })
      .sort({ year: 1, month: 1 })
      .lean<AccountingPeriodLean[]>()
      .exec();
    const open = months.filter((m) => m.status !== 'closed');
    if (open.length > 0) {
      reasons.push({
        code: 'PERIODS_OPEN',
        months: open.map((m) => `${m.year}-${String(m.month).padStart(2, '0')}`),
      });
    }
    const ctx = await this.reporting.context(organizationId, fy.end, fy.start);
    const inYear = ctx.entries.filter((e) => e.date >= fy.start && e.date <= fy.end);
    const awaiting = inYear.filter((e) => e.status === 'awaiting_rate').length;
    if (awaiting > 0) reasons.push({ code: 'AWAITING_RATE', count: awaiting });
    const drafts = inYear.filter((e) => e.status === 'draft').length;
    if (drafts > 0) reasons.push({ code: 'DRAFT_ENTRIES', count: drafts });
    const reserves = await this.reporting.reserves(ctx, fy.start, fy.end);
    const suspense = reserves.find((r) => r.code === 'SUSPENSE_BALANCE') ?? null;
    const suspenseBalance = suspense ? String(suspense.details['balance'] ?? '') : null;
    if (suspense !== null && body.suspenseAcceptance === undefined) {
      reasons.push({ code: 'SUSPENSE_NOT_ACCEPTED', balance: suspenseBalance });
    }
    const nextYear = year + 1;
    const nextFy = await this.fiscalYears
      .findOne({ organizationId, year: nextYear })
      .lean<AccountingFiscalYearLean>()
      .exec();
    if (nextFy !== null) {
      const firstNext = await this.store.periodOf(organizationId, nextFy.start);
      if (firstNext === null || firstNext.status !== 'open') {
        reasons.push({ code: 'NEXT_PERIOD_CLOSED', date: nextFy.start });
      }
    }
    if (reasons.length > 0) {
      conflict('FISCAL_YEAR_NOT_CLOSABLE', 'Cet exercice ne peut pas encore être clos.', {
        reasons,
      });
    }

    // Verrou : un seul `open → closing` réussit.
    const lock = await this.fiscalYears
      .updateOne({ organizationId, year, status: 'open' }, { $set: { status: 'closing' } })
      .exec();
    if (lock.modifiedCount === 0) {
      conflict('FISCAL_YEAR_BUSY', 'Une clôture de cet exercice est déjà en cours.');
    }
    try {
      if (nextFy === null) {
        await this.periodsService.create(organizationId, { year: nextYear }, actor);
      }
      const next: AccountingFiscalYearLean =
        nextFy ?? (await this.findFiscalYear(organizationId, nextYear));
      const journals = await this.store.journalsOf(organizationId);
      const journal =
        journals.find((j) => j.kind === 'opening' && j.code === 'AN' && j.active) ??
        journals.find((j) => j.kind === 'opening' && j.active);
      if (!journal) {
        conflict('JOURNAL_NOT_FOUND', 'Aucun journal d’à-nouveaux actif pour porter le report.');
      }
      const previous = await this.closings
        .countDocuments({ organizationId, fiscalYear: year })
        .exec();
      const cycle = previous + 1;
      const opening = computeOpeningEntries({
        entries: inYear,
        bookCurrency: ctx.bookCurrency,
        fiscalYearEnd: fy.end,
        openingDate: next.start,
        journalCode: journal.code,
        chart: ctx.chart,
        resultAccountNumber: null,
        suspenseAccountNumber: ACCOUNTING_SUSPENSE_ACCOUNT,
      });

      let entryId: string | null = null;
      if (opening.lines.length > 0) {
        const lines = opening.lines.map((l) => storedOpeningLine(l, ctx.bookCurrency));
        const doc: NewEntryDoc = {
          organizationId,
          journalCode: journal.code,
          journalKind: 'opening',
          date: next.start,
          status: 'posted',
          bookCurrency: ctx.bookCurrency,
          label: `À-nouveaux de l’exercice ${year} (projet, à valider par un expert-comptable)`,
          source: null,
          sourceKey: `fiscal_year:${year}:opening:c${cycle}`,
          keyed: true,
          lines,
          reversalOf: null,
          reversalOfKey: null,
          reversalReason: null,
          generation: {
            ruleSetVersion: null,
            chartPack: settings.chartPack,
            engineVersion: ACCOUNTING_REPORTING_VERSION,
          },
          manual: null,
          regeneration: null,
          suspense: lines.some((l) => l.accountNumber === ACCOUNTING_SUSPENSE_ACCOUNT),
          createdBy: actor.userId,
          updatedBy: actor.userId,
        };
        const posted = await this.store.post(organizationId, { doc }, nextYear, actor.userId);
        if (!posted) conflict('FISCAL_YEAR_BUSY', 'Ces à-nouveaux existent déjà.');
        entryId = String(posted._id);
      }

      const now = new Date();
      const suspenseAccepted =
        suspense !== null && body.suspenseAcceptance !== undefined
          ? { reason: body.suspenseAcceptance.reason, balance: suspenseBalance ?? '' }
          : null;
      await this.closings.create({
        organizationId,
        fiscalYear: year,
        cycle,
        closedAt: now,
        closedBy: actor.userId,
        suspenseAccepted,
        openingEntryId: entryId,
        nextFiscalYear: nextYear,
        reopened: null,
        _schemaVersion: 1,
      });
      await this.fiscalYears
        .updateOne(
          { organizationId, year, status: 'closing' },
          {
            $set: {
              status: 'closed',
              closedAt: now,
              closedBy: actor.userId,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
        )
        .exec();
      await this.audit.recordStrict({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'accounting.fiscal_year_closed',
        targetType: 'accounting_fiscal_year',
        targetId: String(year),
        metadata: {
          cycle,
          openingEntryId: entryId,
          openingLines: opening.lines.length,
          suspenseAccepted: suspenseAccepted === null ? null : { ...suspenseAccepted },
        },
      });
      return {
        fiscalYear: await this.fiscalYearView(organizationId, year),
        opening: {
          entryId,
          nextFiscalYear: nextYear,
          date: next.start,
          lineCount: opening.lines.length,
          balanced: opening.balanced,
          result: { ...opening.result },
          warnings: opening.warnings.map((w) => ({ code: w.code, accountNumber: w.accountNumber })),
        },
        suspenseAccepted,
      };
    } catch (err) {
      await this.fiscalYears
        .updateOne({ organizationId, year, status: 'closing' }, { $set: { status: 'open' } })
        .exec();
      throw err;
    }
  }

  async reopenFiscalYear(
    organizationId: string,
    year: number,
    body: AccountingReopenBody,
    actor: AccountingActor,
  ): Promise<AccountingFiscalYearView> {
    const reason = this.reopenReason(actor, body);
    await this.activeSettings(organizationId);
    const fy = await this.findFiscalYear(organizationId, year);
    if (fy.status !== 'closed') conflict('FISCAL_YEAR_NOT_CLOSED', 'Cet exercice n’est pas clos.');
    const nextFy = await this.fiscalYears
      .findOne({ organizationId, year: year + 1 })
      .lean<AccountingFiscalYearLean>()
      .exec();
    if (nextFy?.status === 'closed' || nextFy?.status === 'closing') {
      conflict(
        'FISCAL_YEAR_CLOSED',
        'L’exercice suivant est clos : rouvrez-le d’abord, ses à-nouveaux en dépendent.',
      );
    }
    const closing = await this.closings
      .findOne({ organizationId, fiscalYear: year, reopened: null })
      .sort({ cycle: -1 })
      .lean<AccountingClosingLean>()
      .exec();
    const opening =
      closing?.openingEntryId != null
        ? await this.store.entries
            .findOne({ _id: closing.openingEntryId, organizationId })
            .lean<AccountingEntryLean>()
            .exec()
        : null;
    let reversalDate: string | null = null;
    let reversalFiscalYear: number | null = null;
    if (opening !== null && opening.reversedBy === null) {
      const period = await this.store.periodOf(organizationId, opening.date);
      if (period?.status === 'open') {
        reversalDate = opening.date;
        reversalFiscalYear = period.fiscalYear;
      } else {
        const day = await this.store.firstOpenDayAfter(organizationId, opening.date);
        const p = day === null ? null : await this.store.periodOf(organizationId, day);
        if (day === null || p === null) {
          conflict(
            'NEXT_PERIOD_CLOSED',
            'Aucun mois ouvert ne peut recevoir la contre-passation des à-nouveaux.',
          );
        }
        reversalDate = day;
        reversalFiscalYear = p.fiscalYear;
      }
    }

    const claim = await this.fiscalYears
      .updateOne(
        { organizationId, year, status: 'closed' },
        {
          $set: { status: 'open', closedAt: null, closedBy: null, updatedBy: actor.userId },
          $push: { reopenLog: { at: new Date(), by: actor.userId, reason } },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (claim.modifiedCount === 0) {
      conflict('FISCAL_YEAR_NOT_CLOSED', 'Cet exercice n’est pas clos.');
    }

    let reversalId: string | null = null;
    if (opening !== null && reversalDate !== null && reversalFiscalYear !== null) {
      const rev = reverseEntry(proposedOf(opening), {
        sourceKey: `${opening.sourceKey}:reversal`,
        date: reversalDate,
        reason: 'FISCAL_YEAR_REOPENED',
      });
      const doc = newEntryDoc(
        organizationId,
        rev,
        { code: opening.journalCode, kind: opening.journalKind },
        actor.userId,
        {
          source: null,
          label: `Contre-passation — à-nouveaux de l’exercice ${year} (exercice rouvert)`,
          reversalOf: String(opening._id),
          generation: opening.generation,
        },
      );
      const posted = await this.store.post(
        organizationId,
        { doc },
        reversalFiscalYear,
        actor.userId,
      );
      if (posted) {
        reversalId = String(posted._id);
        await this.store.markReversed(organizationId, String(opening._id), reversalId);
      }
    }
    if (closing) {
      await this.closings
        .updateOne(
          { _id: closing._id, reopened: null },
          {
            $set: {
              reopened: { at: new Date(), by: actor.userId, reason, reversalEntryId: reversalId },
            },
          },
        )
        .exec();
    }
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.fiscal_year_reopened',
      targetType: 'accounting_fiscal_year',
      targetId: String(year),
      metadata: { reason, openingReversalId: reversalId },
    });
    return this.fiscalYearView(organizationId, year);
  }
}
