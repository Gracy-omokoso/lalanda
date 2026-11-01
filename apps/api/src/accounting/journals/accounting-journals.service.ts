// Journaux (ADR-0049 § 2.5). ADR-0049 — K4.
//
// `VE`, `AC`, `OD`, `AN` sont créés au passage en simulation ou à l'activation (codes
// proposés, libellés modifiables). Les journaux de TRÉSORERIE naissent un par compte de
// trésorerie à la synchronisation (lot K5) : jamais à la main. Le code d'un journal ne
// change pas (numérotation sans trou par journal et exercice, § 2.6).

import {
  ACCOUNTING_DEFAULT_JOURNALS,
  type AccountingJournalView,
  type CreateAccountingJournalBody,
  type UpdateAccountingJournalBody,
} from '@lalanda/shared/accounting';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import {
  conflict,
  isDuplicateKey,
  notFound,
  staleRevision,
  type AccountingActor,
} from '../accounting.common.js';
import { AccountingJournal, type AccountingJournalLean } from './accounting-journal.schema.js';

@Injectable()
export class AccountingJournalsService {
  constructor(
    @InjectModel(AccountingJournal.name) private readonly journals: Model<AccountingJournalLean>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Journaux par défaut, idempotent (un code déjà pris n'est pas recréé). */
  async ensureDefaults(organizationId: string, actorUserId: string): Promise<void> {
    for (const j of ACCOUNTING_DEFAULT_JOURNALS) {
      await this.journals
        .updateOne(
          { organizationId, code: j.code },
          {
            $setOnInsert: {
              organizationId,
              code: j.code,
              label: j.label,
              kind: j.kind,
              treasuryAccountId: null,
              active: true,
              revision: 1,
              createdBy: actorUserId,
              updatedBy: actorUserId,
              _schemaVersion: 1,
            },
          },
          { upsert: true },
        )
        .exec()
        .catch((err: unknown) => {
          if (!isDuplicateKey(err)) throw err;
        });
    }
  }

  async list(organizationId: string): Promise<AccountingJournalView[]> {
    const rows = await this.journals
      .find({ organizationId })
      .sort({ code: 1 })
      .lean<AccountingJournalLean[]>()
      .exec();
    return rows.map(viewOf);
  }

  async create(
    organizationId: string,
    body: CreateAccountingJournalBody,
    actor: AccountingActor,
  ): Promise<AccountingJournalView> {
    try {
      await this.journals.create({
        organizationId,
        code: body.code,
        label: body.label,
        kind: body.kind,
        treasuryAccountId: null,
        active: true,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (isDuplicateKey(err)) conflict('JOURNAL_CODE_EXISTS', 'Ce code de journal existe déjà.');
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.journal_created',
      targetType: 'accounting_journal',
      targetId: body.code,
      metadata: { kind: body.kind },
    });
    return viewOf((await this.find(organizationId, body.code))!);
  }

  async update(
    organizationId: string,
    code: string,
    body: UpdateAccountingJournalBody,
    actor: AccountingActor,
  ): Promise<AccountingJournalView> {
    const current = await this.find(organizationId, code);
    if (!current) notFound('JOURNAL_NOT_FOUND', 'Journal introuvable.');
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    if (body.label !== undefined) set['label'] = body.label;
    if (body.active !== undefined) set['active'] = body.active;
    const updated = await this.journals
      .findOneAndUpdate(
        { organizationId, code, revision: body.expectedRevision },
        { $set: set, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<AccountingJournalLean>()
      .exec();
    if (!updated) staleRevision(current.revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.journal_changed',
      targetType: 'accounting_journal',
      targetId: code,
      metadata: { fields: Object.keys(set).filter((k) => k !== 'updatedBy') },
    });
    return viewOf(updated);
  }

  private find(organizationId: string, code: string): Promise<AccountingJournalLean | null> {
    return this.journals.findOne({ organizationId, code }).lean<AccountingJournalLean>().exec();
  }
}

function viewOf(d: AccountingJournalLean): AccountingJournalView {
  return {
    code: d.code,
    label: d.label,
    kind: d.kind,
    treasuryAccountId: d.treasuryAccountId,
    active: d.active,
    revision: d.revision,
  };
}
