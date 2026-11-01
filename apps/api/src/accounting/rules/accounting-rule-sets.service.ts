// Règles de correspondance versionnées (ADR-0049 § 2.4). ADR-0049 — K4.
//
// - Une version naît BROUILLON : copie de la version validée en vigueur, sinon des règles
//   PROPOSÉES du pack — chacune encore « à confirmer » (`requiresReview: true` dès que le
//   pack la dit `to_confirm`). Le pack v1 n'en propose aucune : le brouillon naît VIDE.
// - L'organisation change les comptes, jamais la liste des clés (`checkRuleSet`, K2 :
//   `400 UNKNOWN_OPERATION_KEY`) ; un numéro hors du plan actif est refusé.
// - Validation : `ruleSetDecision` (K0) — le dernier auteur ne valide pas, sauf
//   approbateur unique (marqué) ; la déclaration « relu par notre expert-comptable »
//   (nom, date) est exigée, déclarative, non vérifiée par Lalanda (décision n° 6).
// - Une version `validated` est immuable ; la suivante la rend `superseded`.
// - Une règle `requiresReview` n'est JAMAIS appliquée (`resolveRule`) : compte d'attente.

import { ACCOUNT_TOKENS, checkRuleSet, isAccountNumber } from '@lalanda/engine';
import type {
  AccountingRuleSetView,
  UpdateAccountingRuleSetBody,
  ValidateAccountingRuleSetBody,
} from '@lalanda/shared/accounting';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { AuthzService } from '../../authz/authz.service.js';
import { ruleSetDecision } from '../../authz/permissions.js';
import {
  badRequest,
  conflict,
  isDuplicateKey,
  notFound,
  staleRevision,
  type AccountingActor,
} from '../accounting.common.js';
import { AccountingAccountsService } from '../chart/accounting-accounts.service.js';
import {
  AccountingSettings,
  type AccountingSettingsLean,
} from '../settings/accounting-settings.schema.js';
import { AccountingSettingsService } from '../settings/accounting-settings.service.js';
import {
  AccountingRuleSet,
  type AccountingRuleSetLean,
  type StoredRule,
} from './accounting-rule-set.schema.js';

@Injectable()
export class AccountingRuleSetsService {
  constructor(
    @InjectModel(AccountingRuleSet.name) private readonly ruleSets: Model<AccountingRuleSetLean>,
    @InjectModel(AccountingSettings.name)
    private readonly settingsModel: Model<AccountingSettingsLean>,
    @Inject(AccountingSettingsService) private readonly settings: AccountingSettingsService,
    @Inject(AccountingAccountsService) private readonly accounts: AccountingAccountsService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<AccountingRuleSetView[]> {
    const rows = await this.ruleSets
      .find({ organizationId })
      .sort({ version: -1 })
      .lean<AccountingRuleSetLean[]>()
      .exec();
    return rows.map(viewOf);
  }

  async get(organizationId: string, version: number): Promise<AccountingRuleSetView> {
    return viewOf(await this.find(organizationId, version));
  }

  async create(organizationId: string, actor: AccountingActor): Promise<AccountingRuleSetView> {
    const settings = await this.settings.ensure(organizationId, actor.userId);
    const draft = await this.ruleSets
      .findOne({ organizationId, status: 'draft' })
      .lean<AccountingRuleSetLean>()
      .exec();
    if (draft) {
      conflict('RULE_SET_DRAFT_EXISTS', 'Un brouillon de règles existe déjà : modifiez-le.', {
        version: draft.version,
      });
    }
    const validated = await this.ruleSets
      .findOne({ organizationId, status: 'validated' })
      .lean<AccountingRuleSetLean>()
      .exec();
    const pack = await this.settings.chartPackOf(settings);
    const rules: StoredRule[] = validated
      ? validated.rules.map((r) => ({ ...r, debit: [...r.debit], credit: [...r.credit] }))
      : (pack?.content.proposedRules ?? []).map((r) => ({
          key: r.key,
          debit: [...r.debit],
          credit: [...r.credit],
          requiresReview: r.requiresReview || r.confirmation === 'to_confirm',
        }));
    const last = await this.ruleSets
      .findOne({ organizationId })
      .sort({ version: -1 })
      .lean<AccountingRuleSetLean>()
      .exec();
    const version = (last?.version ?? 0) + 1;
    try {
      await this.ruleSets.create({
        organizationId,
        version,
        status: 'draft',
        rules,
        basedOn: settings.chartPack
          ? { packSlug: settings.chartPack.slug, packVersion: settings.chartPack.version }
          : null,
        validation: null,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (isDuplicateKey(err)) {
        conflict('RULE_SET_DRAFT_EXISTS', 'Un brouillon de règles existe déjà : modifiez-le.');
      }
      throw err;
    }
    await this.trace(organizationId, actor, 'accounting.rule_set_created', version, {
      rules: rules.length,
      from: validated ? `version ${validated.version}` : 'pack',
    });
    return this.get(organizationId, version);
  }

  async update(
    organizationId: string,
    version: number,
    body: UpdateAccountingRuleSetBody,
    actor: AccountingActor,
  ): Promise<AccountingRuleSetView> {
    const current = await this.find(organizationId, version);
    if (current.status !== 'draft') immutable();
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const rules: StoredRule[] = body.rules.map((r) => ({
      key: r.key,
      debit: [...r.debit],
      credit: [...r.credit],
      requiresReview: r.requiresReview,
    }));
    await this.assertRules(organizationId, version, rules, 'save');
    const updated = await this.ruleSets
      .findOneAndUpdate(
        { organizationId, version, status: 'draft', revision: body.expectedRevision },
        { $set: { rules, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<AccountingRuleSetLean>()
      .exec();
    if (!updated) staleRevision(current.revision);
    await this.trace(organizationId, actor, 'accounting.rule_set_changed', version, {
      rules: rules.length,
    });
    return viewOf(updated);
  }

  async validate(
    organizationId: string,
    version: number,
    body: ValidateAccountingRuleSetBody,
    actor: AccountingActor,
  ): Promise<AccountingRuleSetView> {
    const current = await this.find(organizationId, version);
    if (current.revision !== body.expectedRevision && current.status === 'draft') {
      staleRevision(current.revision);
    }
    const review = body.expertReview;
    const expertReviewDeclared =
      review.declared && Boolean(review.name ?? null) && Boolean(review.date ?? null);
    const decision = ruleSetDecision({
      status: current.status,
      validatorUserId: actor.userId,
      lastAuthorUserId: current.updatedBy || current.createdBy,
      approverCountInOrg: await this.authz.countApprovers(organizationId, 'accounting.manage'),
      expertReviewDeclared,
    });
    if (!decision.ok) {
      const messages = {
        RULE_SET_IMMUTABLE: 'Cette version n’est plus un brouillon : elle ne change plus.',
        SELF_APPROVAL_FORBIDDEN:
          'Vous avez modifié ces règles en dernier : une autre personne autorisée doit les valider.',
        EXPERT_REVIEW_DECLARATION_REQUIRED:
          'Déclarez la relecture par votre expert-comptable (nom et date) avant de valider.',
      } as const;
      conflict(decision.code, messages[decision.code]);
    }
    await this.assertRules(organizationId, version, current.rules, 'validate');
    const now = new Date();
    const validation = {
      by: actor.userId,
      at: now,
      soleApprover: decision.soleApprover,
      expertReview: {
        declared: true,
        name: review.name ?? null,
        date: review.date ?? null,
        note: review.note ?? null,
      },
    };
    const updated = await this.ruleSets
      .findOneAndUpdate(
        { organizationId, version, status: 'draft', revision: current.revision },
        {
          $set: { status: 'validated', validation, updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<AccountingRuleSetLean>()
      .exec();
    if (!updated) staleRevision(current.revision);
    await this.ruleSets
      .updateMany(
        { organizationId, status: 'validated', version: { $ne: version } },
        { $set: { status: 'superseded', updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    await this.settings.ensure(organizationId, actor.userId);
    await this.settingsModel
      .updateOne({ organizationId }, { $set: { ruleSetVersion: version } })
      .exec();
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.rule_set_validated',
      targetType: 'accounting_rule_set',
      targetId: String(version),
      metadata: {
        version,
        soleApprover: decision.soleApprover,
        expertReviewName: validation.expertReview.name,
        expertReviewDate: validation.expertReview.date,
        rules: current.rules.length,
        requiresReview: current.rules.filter((r) => r.requiresReview).length,
      },
    });
    return viewOf(updated);
  }

  /**
   * Forme (`checkRuleSet`, K2) puis plan : chaque numéro visé est un compte ACTIF du plan
   * de l'organisation. `save` → 400 ; `validate` → 409 (le plan a pu changer depuis).
   */
  private async assertRules(
    organizationId: string,
    version: number,
    rules: StoredRule[],
    when: 'save' | 'validate',
  ): Promise<void> {
    const issues = checkRuleSet({ version, status: 'draft', rules });
    const unknown = issues.filter((i) => i.code === 'UNKNOWN_OPERATION_KEY');
    if (unknown.length > 0) {
      badRequest('UNKNOWN_OPERATION_KEY', 'Clé d’opération inconnue du moteur.', {
        issues: unknown,
      });
    }
    if (issues.length > 0) {
      badRequest('RULE_SET_INVALID', 'Règles illisibles.', { issues });
    }
    const plan = await this.accounts.activeNumbers(organizationId);
    const outside = new Set<string>();
    for (const r of rules) {
      for (const ref of [...r.debit, ...r.credit]) {
        if ((ACCOUNT_TOKENS as readonly string[]).includes(ref)) continue;
        if (isAccountNumber(ref) && !plan.has(ref)) outside.add(ref);
      }
    }
    if (outside.size > 0) {
      const details = { accounts: [...outside].sort() };
      const message = 'Ces comptes ne sont pas dans le plan actif de l’organisation.';
      if (when === 'save') badRequest('RULE_ACCOUNT_NOT_IN_CHART', message, details);
      conflict('RULE_ACCOUNT_NOT_IN_CHART', message, details);
    }
  }

  private async find(organizationId: string, version: number): Promise<AccountingRuleSetLean> {
    const found = await this.ruleSets
      .findOne({ organizationId, version })
      .lean<AccountingRuleSetLean>()
      .exec();
    if (!found) notFound('RULE_SET_NOT_FOUND', 'Version de règles introuvable.');
    return found;
  }

  private async trace(
    organizationId: string,
    actor: AccountingActor,
    action: string,
    version: number,
    metadata: Record<string, string | number>,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action,
      targetType: 'accounting_rule_set',
      targetId: String(version),
      metadata: { version, ...metadata },
    });
  }
}

function immutable(): never {
  conflict('RULE_SET_IMMUTABLE', 'Cette version n’est plus un brouillon : elle ne change plus.');
}

function viewOf(d: AccountingRuleSetLean): AccountingRuleSetView {
  return {
    version: d.version,
    status: d.status,
    rules: d.rules.map((r) => ({
      key: r.key,
      debit: [...r.debit],
      credit: [...r.credit],
      requiresReview: r.requiresReview,
    })),
    basedOn: d.basedOn,
    validation: d.validation
      ? {
          by: d.validation.by,
          at: new Date(d.validation.at).toISOString(),
          soleApprover: d.validation.soleApprover,
          expertReview: { ...d.validation.expertReview },
        }
      : null,
    revision: d.revision,
    createdBy: d.createdBy,
    updatedBy: d.updatedBy,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}
