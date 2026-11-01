// Plan de l'organisation (ADR-0049 § 2.3). ADR-0049 — K4.
//
// Les comptes du pack choisi sont lus du pack (copie RÉFÉRENCÉE, jamais recopiée) ;
// l'organisation peut préciser leur libellé (le libellé du pack reste affiché) ou les
// archiver, et créer des comptes PROPRES qui prolongent un compte du pack
// (`409 ACCOUNT_OUTSIDE_PACK` sinon). Aucun numéro n'est créé par le code : un compte
// propre est saisi par l'organisation ; un compte du pack vient du YAML.

import {
  ACCOUNTING_TO_CONFIRM_LABEL,
  type AccountingAccountView,
  type ArchiveAccountingAccountBody,
  type CreateAccountingAccountBody,
  type UpdateAccountingAccountBody,
} from '@lalanda/shared/accounting';
import type { ChartPackAccount } from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import {
  accountHasEntries,
  conflict,
  isDuplicateKey,
  notFound,
  staleRevision,
  type AccountingActor,
} from '../accounting.common.js';
import {
  AccountingRuleSet,
  type AccountingRuleSetLean,
} from '../rules/accounting-rule-set.schema.js';
import { AccountingSettingsService } from '../settings/accounting-settings.service.js';
import { AccountingAccount, type AccountingAccountLean } from './accounting-account.schema.js';

/** Plan résolu : comptes du pack choisi et documents de l'organisation. */
interface ResolvedPlan {
  packAccounts: Map<string, ChartPackAccount>;
  docs: Map<string, AccountingAccountLean>;
}

@Injectable()
export class AccountingAccountsService {
  constructor(
    @InjectModel(AccountingAccount.name) private readonly accounts: Model<AccountingAccountLean>,
    @InjectModel(AccountingRuleSet.name) private readonly ruleSets: Model<AccountingRuleSetLean>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AccountingSettingsService) private readonly settings: AccountingSettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async plan(organizationId: string): Promise<ResolvedPlan> {
    const settings = await this.settings.ensure(organizationId);
    const pack = await this.settings.chartPackOf(settings);
    const docs = await this.accounts
      .find({ organizationId })
      .lean<AccountingAccountLean[]>()
      .exec();
    return {
      packAccounts: new Map((pack?.content.accounts ?? []).map((a) => [a.number, a])),
      docs: new Map(docs.map((d) => [d.number, d])),
    };
  }

  async list(organizationId: string): Promise<AccountingAccountView[]> {
    const plan = await this.plan(organizationId);
    const views: AccountingAccountView[] = [];
    for (const pa of plan.packAccounts.values()) {
      views.push(packView(pa, plan.docs.get(pa.number) ?? null));
    }
    for (const d of plan.docs.values()) {
      if (d.origin !== 'organization') continue;
      const parent = plan.packAccounts.get(d.packAccountNumber);
      views.push(ownView(d, parent ?? null));
    }
    return views.sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
  }

  /** Numéros ACTIFS du plan (comptes du pack non archivés et comptes propres actifs). */
  async activeNumbers(organizationId: string): Promise<Set<string>> {
    const plan = await this.plan(organizationId);
    const out = new Set<string>();
    for (const n of plan.packAccounts.keys()) {
      if (plan.docs.get(n)?.active !== false) out.add(n);
    }
    for (const d of plan.docs.values()) {
      if (d.origin === 'organization' && d.active && plan.packAccounts.has(d.packAccountNumber)) {
        out.add(d.number);
      }
    }
    return out;
  }

  async create(
    organizationId: string,
    body: CreateAccountingAccountBody,
    actor: AccountingActor,
  ): Promise<AccountingAccountView> {
    const plan = await this.plan(organizationId);
    if (plan.packAccounts.has(body.number) || plan.docs.has(body.number)) {
      conflict('ACCOUNT_NUMBER_EXISTS', 'Ce numéro de compte existe déjà dans le plan.');
    }
    // Le compte du pack le plus long dont le numéro commence le nouveau numéro.
    let parent: ChartPackAccount | null = null;
    for (const pa of plan.packAccounts.values()) {
      if (
        body.number.startsWith(pa.number) &&
        (parent === null || pa.number.length > parent.number.length)
      ) {
        parent = pa;
      }
    }
    if (parent === null) {
      conflict(
        'ACCOUNT_OUTSIDE_PACK',
        'Un compte propre commence par le numéro d’un compte du pack choisi.',
      );
    }
    try {
      await this.accounts.create({
        organizationId,
        number: body.number,
        origin: 'organization',
        packAccountNumber: parent.number,
        label: body.label,
        auxiliary: null,
        collectiveNumber: null,
        active: true,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (isDuplicateKey(err)) {
        conflict('ACCOUNT_NUMBER_EXISTS', 'Ce numéro de compte existe déjà dans le plan.');
      }
      throw err;
    }
    await this.trace(organizationId, actor, 'accounting.account_created', body.number, {
      packAccountNumber: parent.number,
    });
    const created = await this.findDoc(organizationId, body.number);
    return ownView(created!, parent);
  }

  async update(
    organizationId: string,
    number: string,
    body: UpdateAccountingAccountBody,
    actor: AccountingActor,
  ): Promise<AccountingAccountView> {
    const saved = await this.patch(organizationId, number, body.expectedRevision, actor, {
      label: body.label,
    });
    await this.trace(organizationId, actor, 'accounting.account_changed', number, {
      fields: ['label'],
    });
    return saved;
  }

  async archive(
    organizationId: string,
    number: string,
    body: ArchiveAccountingAccountBody,
    actor: AccountingActor,
  ): Promise<AccountingAccountView> {
    const active = body.active ?? false;
    if (!active) await this.assertArchivable(organizationId, number);
    const saved = await this.patch(organizationId, number, body.expectedRevision, actor, {
      active,
    });
    await this.trace(
      organizationId,
      actor,
      active ? 'accounting.account_restored' : 'accounting.account_archived',
      number,
      { moved: await accountHasEntries(this.connection, organizationId, number) },
    );
    return saved;
  }

  /**
   * Un compte visé par le jeu de règles VALIDÉ, ou prolongé par un compte propre actif,
   * ne s'archive pas (`409 ACCOUNT_IN_USE`) : les règles ou les sous-comptes viseraient un
   * compte archivé. Un compte simplement mouvementé s'archive (§ 2.3) : il reste lisible.
   */
  private async assertArchivable(organizationId: string, number: string): Promise<void> {
    const validated = await this.ruleSets
      .findOne({ organizationId, status: 'validated' })
      .lean<AccountingRuleSetLean>()
      .exec();
    const inRules =
      validated?.rules.some((r) => [...r.debit, ...r.credit].includes(number)) ?? false;
    const children = await this.accounts
      .countDocuments(
        { organizationId, origin: 'organization', packAccountNumber: number, active: true },
        { limit: 1 },
      )
      .exec();
    if (inRules || children > 0) {
      conflict(
        'ACCOUNT_IN_USE',
        'Ce compte est employé par les règles validées ou par un sous-compte actif.',
        { inRules, subAccounts: children > 0 },
      );
    }
  }

  private async patch(
    organizationId: string,
    number: string,
    expectedRevision: number | null,
    actor: AccountingActor,
    set: { label?: string; active?: boolean },
  ): Promise<AccountingAccountView> {
    const plan = await this.plan(organizationId);
    const packAccount = plan.packAccounts.get(number) ?? null;
    const doc = plan.docs.get(number) ?? null;
    if (packAccount === null && (doc === null || doc.origin !== 'organization')) {
      notFound('ACCOUNT_NOT_FOUND', 'Compte introuvable dans le plan.');
    }
    if (doc === null) {
      // Compte du pack jamais modifié : le document naît, révision attendue `null`.
      if (expectedRevision !== null) staleRevision(0);
      try {
        await this.accounts.create({
          organizationId,
          number,
          origin: 'pack',
          packAccountNumber: number,
          label: set.label ?? null,
          auxiliary: null,
          collectiveNumber: null,
          active: set.active ?? true,
          revision: 1,
          createdBy: actor.userId,
          updatedBy: actor.userId,
          _schemaVersion: 1,
        });
      } catch (err) {
        if (isDuplicateKey(err)) staleRevision(1);
        throw err;
      }
    } else {
      if (doc.revision !== expectedRevision) staleRevision(doc.revision);
      const updated = await this.accounts
        .findOneAndUpdate(
          { organizationId, number, revision: doc.revision },
          { $set: { ...set, updatedBy: actor.userId }, $inc: { revision: 1 } },
          { new: true },
        )
        .lean<AccountingAccountLean>()
        .exec();
      if (!updated) staleRevision(doc.revision);
    }
    const saved = (await this.findDoc(organizationId, number))!;
    return saved.origin === 'pack'
      ? packView(packAccount!, saved)
      : ownView(saved, plan.packAccounts.get(saved.packAccountNumber) ?? null);
  }

  private findDoc(organizationId: string, number: string): Promise<AccountingAccountLean | null> {
    return this.accounts.findOne({ organizationId, number }).lean<AccountingAccountLean>().exec();
  }

  private async trace(
    organizationId: string,
    actor: AccountingActor,
    action: string,
    number: string,
    metadata: Record<string, string | boolean | string[]>,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action,
      targetType: 'accounting_account',
      targetId: number,
      metadata,
    });
  }
}

const mention = (c: string): string | null =>
  c === 'to_confirm' ? ACCOUNTING_TO_CONFIRM_LABEL : null;

function packView(pa: ChartPackAccount, doc: AccountingAccountLean | null): AccountingAccountView {
  return {
    number: pa.number,
    label: doc?.label ?? pa.label,
    packLabel: pa.label,
    origin: 'pack',
    classNumber: pa.classNumber,
    parent: pa.parent,
    nature: pa.nature,
    confirmation: pa.confirmation,
    mention: mention(pa.confirmation),
    collective: pa.collective,
    auxiliaryKind: pa.auxiliaryKind,
    active: doc?.active ?? true,
    revision: doc?.revision ?? null,
  };
}

function ownView(d: AccountingAccountLean, parent: ChartPackAccount | null): AccountingAccountView {
  const confirmation = parent?.confirmation ?? 'to_confirm';
  return {
    number: d.number,
    label: d.label ?? '',
    packLabel: null,
    origin: 'organization',
    classNumber: parent?.classNumber ?? d.number.charAt(0),
    parent: d.packAccountNumber,
    nature: parent?.nature ?? null,
    confirmation,
    mention: mention(confirmation),
    collective: false,
    auxiliaryKind: d.auxiliary?.kind ?? null,
    // Un compte propre dont le compte du pack a disparu (changement de pack) est inactif.
    active: d.active && parent !== null,
    revision: d.revision,
  };
}
