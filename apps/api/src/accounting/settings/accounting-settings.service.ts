// Réglages, mode et activation de la comptabilité (ADR-0049 § 2.2, § 3.1). ADR-0049 — K4.
//
// - `off` par défaut : le document naît au premier accès, mode `off`, sans monnaie de
//   tenue ni bascule (AUCUNE valeur par défaut, décision ouverte n° 4).
// - `simulation` se pose par `PUT /accounting/settings` ; pack `draft` admis.
// - `active` ne se pose QUE par `POST /accounting/activate`, qui rend toutes les
//   conditions manquantes ensemble (`accountingActivationDecision`, K0). Tant que le pack
//   n'est pas `approved` ou `active`, l'activation est refusée (décision ouverte n° 5).
// - La monnaie de tenue et la bascule se verrouillent à la première écriture validée ;
//   le mois de début d'exercice, au premier exercice créé.

import { isOperationKey } from '@lalanda/engine';
import {
  ACCOUNTING_ACTIVATABLE_PACK_STATUSES,
  ACCOUNTING_MODE_BANNERS,
  ACCOUNTING_SETTINGS_DEFAULTS,
  type AccountingActivationBody,
  type AccountingActivationMissingCode,
  type AccountingSettingsView,
  type UpdateAccountingSettingsBody,
} from '@lalanda/shared/accounting';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { accountingActivationDecision } from '../../authz/permissions.js';
import {
  conflict,
  hasPostedEntry,
  isDuplicateKey,
  notFound,
  staleRevision,
  toIso,
  type AccountingActor,
} from '../accounting.common.js';
import type { AccountingChartPackLean } from '../chart/chart-pack.schema.js';
import { ChartPacksService } from '../chart/chart-packs.service.js';
import { AccountingJournalsService } from '../journals/accounting-journals.service.js';
import {
  AccountingFiscalYear,
  type AccountingFiscalYearLean,
} from '../periods/accounting-period.schema.js';
import {
  AccountingRuleSet,
  type AccountingRuleSetLean,
} from '../rules/accounting-rule-set.schema.js';
import { AccountingSettings, type AccountingSettingsLean } from './accounting-settings.schema.js';

@Injectable()
export class AccountingSettingsService {
  constructor(
    @InjectModel(AccountingSettings.name)
    private readonly settings: Model<AccountingSettingsLean>,
    @InjectModel(AccountingRuleSet.name) private readonly ruleSets: Model<AccountingRuleSetLean>,
    @InjectModel(AccountingFiscalYear.name)
    private readonly fiscalYears: Model<AccountingFiscalYearLean>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(ChartPacksService) private readonly packs: ChartPacksService,
    @Inject(AccountingJournalsService) private readonly journals: AccountingJournalsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Réglages de l'organisation, créés au mode `off` au premier accès. */
  async ensure(organizationId: string, actorUserId = 'system'): Promise<AccountingSettingsLean> {
    const found = await this.settings
      .findOne({ organizationId })
      .lean<AccountingSettingsLean>()
      .exec();
    if (found) return found;
    try {
      await this.settings.create({
        organizationId,
        ...ACCOUNTING_SETTINGS_DEFAULTS,
        chartPack: null,
        ruleSetVersion: null,
        activatedAt: null,
        activatedBy: null,
        revision: 1,
        createdBy: actorUserId,
        updatedBy: actorUserId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
    return (await this.settings.findOne({ organizationId }).lean<AccountingSettingsLean>().exec())!;
  }

  /** Pack choisi par l'organisation, `null` si aucun (ou disparu). */
  async chartPackOf(settings: AccountingSettingsLean): Promise<AccountingChartPackLean | null> {
    return settings.chartPack === null ? null : this.packs.find(settings.chartPack);
  }

  async view(organizationId: string): Promise<AccountingSettingsView> {
    return this.viewOf(await this.ensure(organizationId));
  }

  async update(
    organizationId: string,
    body: UpdateAccountingSettingsBody,
    actor: AccountingActor,
  ): Promise<AccountingSettingsView> {
    const current = await this.ensure(organizationId, actor.userId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const { expectedRevision, ...patch } = body;
    const set: Record<string, unknown> = {};

    if (patch.mode !== undefined && patch.mode !== current.mode) {
      if (current.mode === 'active') {
        conflict(
          'ACCOUNTING_ACTIVE_USE_DEACTIVATE',
          'La comptabilité est active : revenez au mode « off » par la désactivation.',
        );
      }
      set['mode'] = patch.mode;
    }

    let pack = await this.chartPackOf(current);
    if (patch.chartPack !== undefined && !sameRef(patch.chartPack, current.chartPack)) {
      if (patch.chartPack === null) {
        if (current.mode === 'active') lockedWhileActive('chartPack');
        pack = null;
      } else {
        const next = await this.packs.find(patch.chartPack);
        if (!next) notFound('CHART_PACK_NOT_FOUND', 'Pack de plan comptable introuvable.');
        if (next.status === 'retired') {
          conflict('CHART_PACK_RETIRED', 'Ce pack est retiré : choisissez une version en vigueur.');
        }
        if (
          current.mode === 'active' &&
          !ACCOUNTING_ACTIVATABLE_PACK_STATUSES.includes(next.status)
        ) {
          conflict(
            'CHART_PACK_NOT_APPROVED',
            'En mode actif, seul un pack relu et approuvé peut être choisi.',
          );
        }
        pack = next;
      }
      set['chartPack'] = patch.chartPack;
    }

    const lockedByEntries =
      (patch.bookCurrency !== undefined && patch.bookCurrency !== current.bookCurrency) ||
      (patch.cutoverDate !== undefined && patch.cutoverDate !== current.cutoverDate)
        ? await hasPostedEntry(this.connection, organizationId)
        : false;
    if (patch.bookCurrency !== undefined && patch.bookCurrency !== current.bookCurrency) {
      if (lockedByEntries) {
        conflict(
          'BOOK_CURRENCY_LOCKED',
          'La monnaie de tenue ne change plus après la première écriture validée.',
        );
      }
      set['bookCurrency'] = patch.bookCurrency;
    }
    if (patch.cutoverDate !== undefined && patch.cutoverDate !== current.cutoverDate) {
      if (lockedByEntries) {
        conflict(
          'CUTOVER_LOCKED',
          'La date de bascule ne change plus après la première écriture validée.',
        );
      }
      set['cutoverDate'] = patch.cutoverDate;
    }
    if (
      patch.fiscalYearStartMonth !== undefined &&
      patch.fiscalYearStartMonth !== current.fiscalYearStartMonth
    ) {
      if (await this.hasFiscalYear(organizationId)) {
        conflict(
          'FISCAL_YEAR_START_LOCKED',
          'Un exercice existe déjà : le mois de début d’exercice ne change plus.',
        );
      }
      set['fiscalYearStartMonth'] = patch.fiscalYearStartMonth;
    }
    if (patch.stockPosting !== undefined && patch.stockPosting !== current.stockPosting) {
      if (
        patch.stockPosting === 'perpetual' &&
        !(await this.stockPostingValidated(organizationId, pack))
      ) {
        conflict(
          'STOCK_POSTING_NOT_VALIDATED',
          'Les écritures de stock restent éteintes tant que l’expert-comptable n’a pas validé la méthode d’inventaire (ADR-0049 § 6.7).',
        );
      }
      set['stockPosting'] = patch.stockPosting;
    }
    if (patch.depreciationPosting !== undefined) set['depreciationPosting'] = 'off';

    if (Object.keys(set).length === 0) return this.viewOf(current);
    const updated = await this.settings
      .findOneAndUpdate(
        { organizationId, revision: expectedRevision },
        { $set: { ...set, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<AccountingSettingsLean>()
      .exec();
    if (!updated) staleRevision((await this.ensure(organizationId)).revision);

    if (set['mode'] === 'simulation')
      await this.journals.ensureDefaults(organizationId, actor.userId);
    const fields = Object.keys(set);
    const audit = {
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: set['mode'] !== undefined ? 'accounting.mode_changed' : 'accounting.settings_changed',
      targetType: 'accounting_settings',
      targetId: organizationId,
      metadata: { fields, from: current.mode, to: updated.mode },
    };
    if (set['mode'] !== undefined) await this.audit.recordStrict(audit);
    else await this.audit.record(audit);
    return this.viewOf(updated);
  }

  /**
   * `POST /accounting/activate` (§ 3.1) : `accounting.manage` ET `fiscal.manage` au guard ;
   * toutes les conditions ici, rendues ensemble (`details.missing[]`).
   */
  async activate(
    organizationId: string,
    body: AccountingActivationBody,
    actor: AccountingActor,
  ): Promise<AccountingSettingsView> {
    const current = await this.ensure(organizationId, actor.userId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (current.mode === 'active') return this.viewOf(current);
    const missing = await this.activationMissing(current);
    if (missing.length > 0) {
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'accounting.activation_refused',
        targetType: 'accounting_settings',
        targetId: organizationId,
        metadata: { missing },
      });
      conflict(
        'ACCOUNTING_ACTIVATION_PRECONDITION',
        'La comptabilité ne peut pas encore être activée : des conditions manquent.',
        { missing },
      );
    }
    const updated = await this.settings
      .findOneAndUpdate(
        { organizationId, revision: body.expectedRevision, mode: current.mode },
        {
          $set: {
            mode: 'active',
            activatedAt: new Date(),
            activatedBy: actor.userId,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<AccountingSettingsLean>()
      .exec();
    if (!updated) staleRevision((await this.ensure(organizationId)).revision);
    await this.journals.ensureDefaults(organizationId, actor.userId);
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.activated',
      targetType: 'accounting_settings',
      targetId: organizationId,
      metadata: { from: current.mode, chartPack: refLabel(updated.chartPack) },
    });
    return this.viewOf(updated);
  }

  /** `POST /accounting/deactivate` : retour à `off` ; rien n'est effacé (§ 3.1). */
  async deactivate(
    organizationId: string,
    body: AccountingActivationBody,
    actor: AccountingActor,
  ): Promise<AccountingSettingsView> {
    const current = await this.ensure(organizationId, actor.userId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (current.mode === 'off') return this.viewOf(current);
    const updated = await this.settings
      .findOneAndUpdate(
        { organizationId, revision: body.expectedRevision },
        { $set: { mode: 'off', updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<AccountingSettingsLean>()
      .exec();
    if (!updated) staleRevision((await this.ensure(organizationId)).revision);
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.deactivated',
      targetType: 'accounting_settings',
      targetId: organizationId,
      metadata: { from: current.mode },
    });
    return this.viewOf(updated);
  }

  /** Conditions manquantes de l'activation (K0, `accountingActivationDecision`). */
  async activationMissing(
    settings: AccountingSettingsLean,
  ): Promise<AccountingActivationMissingCode[]> {
    const pack = await this.chartPackOf(settings);
    const validated = await this.ruleSets
      .findOne({ organizationId: settings.organizationId, status: 'validated' })
      .lean<AccountingRuleSetLean>()
      .exec();
    const review = validated?.validation?.expertReview;
    const openYear = await this.fiscalYears
      .countDocuments({ organizationId: settings.organizationId, status: 'open' }, { limit: 1 })
      .exec();
    const decision = accountingActivationDecision({
      chartPackStatus: pack?.status ?? null,
      bookCurrency: settings.bookCurrency,
      cutoverDate: settings.cutoverDate,
      validatedRuleSet: validated
        ? {
            expertReviewDeclared:
              review?.declared === true && Boolean(review.name) && Boolean(review.date),
          }
        : null,
      hasOpenFiscalYear: openYear > 0,
    });
    return decision.ok ? [] : [...decision.missing];
  }

  private async hasFiscalYear(organizationId: string): Promise<boolean> {
    return (await this.fiscalYears.countDocuments({ organizationId }, { limit: 1 }).exec()) > 0;
  }

  /**
   * § 6.7 : `perpetual` exige un pack relu (`approved`/`active`) dont les règles `stock.*`
   * sont sourcées, ET une règle `stock.*` validée par l'organisation, applicable
   * (`requiresReview` faux). Le pack v1 n'en contient aucune : toujours refusé.
   */
  private async stockPostingValidated(
    organizationId: string,
    pack: AccountingChartPackLean | null,
  ): Promise<boolean> {
    if (pack === null || !ACCOUNTING_ACTIVATABLE_PACK_STATUSES.includes(pack.status)) return false;
    const packStock = pack.content.proposedRules.some(
      (r) => r.key.startsWith('stock.') && r.confirmation === 'sourced',
    );
    if (!packStock) return false;
    const validated = await this.ruleSets
      .findOne({ organizationId, status: 'validated' })
      .lean<AccountingRuleSetLean>()
      .exec();
    return (
      validated?.rules.some(
        (r) => r.key.startsWith('stock.') && isOperationKey(r.key) && !r.requiresReview,
      ) ?? false
    );
  }

  private async viewOf(d: AccountingSettingsLean): Promise<AccountingSettingsView> {
    const pack = await this.chartPackOf(d);
    const missing = d.mode === 'active' ? [] : await this.activationMissing(d);
    const entriesLocked = await hasPostedEntry(this.connection, d.organizationId);
    return {
      mode: d.mode,
      banner: d.mode === 'off' ? null : ACCOUNTING_MODE_BANNERS[d.mode],
      chartPack:
        d.chartPack === null
          ? null
          : {
              slug: d.chartPack.slug,
              version: d.chartPack.version,
              label: pack?.content.label ?? '',
              status: pack?.status ?? 'retired',
              warnings: pack ? [...pack.content.warnings] : [],
            },
      bookCurrency: d.bookCurrency,
      cutoverDate: d.cutoverDate,
      fiscalYearStartMonth: d.fiscalYearStartMonth,
      stockPosting: d.stockPosting,
      depreciationPosting: 'off',
      ruleSetVersion: d.ruleSetVersion,
      activatedAt: toIso(d.activatedAt),
      activatedBy: d.activatedBy,
      activation: { possible: d.mode !== 'active' && missing.length === 0, missing },
      locks: {
        bookCurrency: entriesLocked,
        cutoverDate: entriesLocked,
        fiscalYearStartMonth: await this.hasFiscalYear(d.organizationId),
      },
      revision: d.revision,
      updatedAt: new Date(d.updatedAt).toISOString(),
    };
  }
}

function sameRef(
  a: { slug: string; version: number } | null,
  b: { slug: string; version: number } | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.slug === b.slug && a.version === b.version;
}

function refLabel(ref: { slug: string; version: number } | null): string | null {
  return ref === null ? null : `${ref.slug}@${ref.version}`;
}

function lockedWhileActive(field: string): never {
  conflict('ACCOUNTING_ACTIVE_SETTING_LOCKED', 'Ce réglage ne change pas en mode actif.', {
    field,
  });
}
