// Écritures : lecture, opérations diverses, contre-passation (ADR-0049 § 2.6, § 6.9, § 11).
// ADR-0049 — K5.
//
// - Lecture (`accounting.read`) : en mode `simulation`, les écritures sont CALCULÉES à la
//   volée et jamais enregistrées ; sinon, celles enregistrées (après une désactivation,
//   les livres restent lisibles).
// - Opérations diverses (`accounting.post`, mode actif) : brouillon sur un journal `OD` ou
//   `AN`, lignes libres sur des comptes du plan, motif obligatoire ; validation avec
//   séparation des tâches (`manualEntryDecision` : l'auteur ne valide pas, sauf
//   approbateur unique, marqué `soleApprover`) ; numéro et chaînage à la validation.
// - Une écriture validée ne se modifie ni ne se supprime (`409 ENTRY_NOT_DRAFT`) : on la
//   contre-passe (`POST …/:id/reverse`), une seule fois (`409 ENTRY_ALREADY_REVERSED`).

import { checkEntry, reverseEntry, type ProposedEntry, type ReportingEntry } from '@lalanda/engine';
import {
  type AccountingEntrySearchBody,
  type AccountingEntryView,
  type AccountingPage,
  type AccountingPendingView,
  type CreateManualEntryBody,
  type ReverseEntryBody,
  type UpdateManualEntryBody,
  type ValidateManualEntryBody,
} from '@lalanda/shared/accounting';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type FilterQuery, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { AuthzService } from '../../authz/authz.service.js';
import { manualEntryDecision } from '../../authz/permissions.js';
import { kinshasaDayOf } from '../../sales/receipts/kinshasa-day.js';
import { conflict, notFound, staleRevision, type AccountingActor } from '../accounting.common.js';
import {
  AccountingAccount,
  type AccountingAccountLean,
} from '../chart/accounting-account.schema.js';
import { AccountingAccountsService } from '../chart/accounting-accounts.service.js';
import { AccountingLetteringService } from '../lettering/accounting-lettering.service.js';
import { AccountingPendingService } from '../pending/accounting-pending.service.js';
import { AccountingSettingsService } from '../settings/accounting-settings.service.js';
import type { AccountingSettingsLean } from '../settings/accounting-settings.schema.js';
import {
  ACCOUNTING_SUSPENSE_ACCOUNT,
  AccountingSyncService,
  newEntryDoc,
} from '../sync/accounting-sync.service.js';
import type { AccountingEntryLean, StoredEntryLine } from './accounting-entry.schema.js';
import {
  AccountingEntryStore,
  entryView,
  lineView,
  proposedOf,
  reportingOf,
  type EntryLike,
  type NewEntryDoc,
} from './accounting-entry-store.service.js';

const DEFAULT_LIMIT = 50;
const SUSPENSE_LABEL = 'Compte d’attente (technique, à désigner par l’expert-comptable)';

function escapeRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Curseur opaque `<date>_<clé>` (tri par date puis identifiant, décroissants). */
function cursorOf(date: string, key: string): string {
  return Buffer.from(`${date}_${key}`, 'utf8').toString('base64url');
}
function readCursor(cursor: string | undefined): { date: string; key: string } | null {
  if (cursor === undefined) return null;
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const i = raw.indexOf('_');
  if (i !== 10) return null;
  return { date: raw.slice(0, 10), key: raw.slice(11) };
}

/** Filtre en mémoire (simulation) : mêmes critères que la recherche enregistrée. */
function matches(e: EntryLike, f: AccountingEntrySearchBody): boolean {
  if (f.journalCode !== undefined && e.journalCode !== f.journalCode) return false;
  if (f.from !== undefined && e.date < f.from) return false;
  if (f.to !== undefined && e.date > f.to) return false;
  if (
    f.accountNumber !== undefined &&
    !e.lines.some(
      (l) => l.accountNumber === f.accountNumber || l.auxiliaryAccountNumber === f.accountNumber,
    )
  ) {
    return false;
  }
  if (
    f.sourceNumber !== undefined &&
    (e.source?.number ?? '').toLowerCase() !== f.sourceNumber.toLowerCase()
  ) {
    return false;
  }
  if (f.sourceKind !== undefined && (e.source?.kind ?? 'manual') !== f.sourceKind) return false;
  if (f.sourceId !== undefined && e.source?.id !== f.sourceId) return false;
  if (f.status !== undefined && e.status !== f.status) return false;
  if (f.suspense !== undefined && e.suspense !== f.suspense) return false;
  return true;
}

@Injectable()
export class AccountingEntriesService {
  constructor(
    @Inject(AccountingEntryStore) private readonly store: AccountingEntryStore,
    @Inject(AccountingSyncService) private readonly sync: AccountingSyncService,
    @Inject(AccountingSettingsService) private readonly settings: AccountingSettingsService,
    @Inject(AccountingAccountsService) private readonly accountsService: AccountingAccountsService,
    @Inject(AccountingPendingService) private readonly pending: AccountingPendingService,
    @Inject(AccountingLetteringService) private readonly lettering: AccountingLetteringService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(AuditService) private readonly audit: AuditService,
    @InjectModel(AccountingAccount.name) private readonly accounts: Model<AccountingAccountLean>,
  ) {}

  /** Libellés du plan de l'organisation (pack + comptes propres et auxiliaires). */
  private async labels(organizationId: string): Promise<Map<string, string>> {
    const list = await this.accountsService.list(organizationId);
    const out = new Map(list.map((a) => [a.number, a.label]));
    out.set(ACCOUNTING_SUSPENSE_ACCOUNT, SUSPENSE_LABEL);
    return out;
  }

  private simulatedView(e: EntryLike, labels: ReadonlyMap<string, string>): AccountingEntryView {
    const id = String(e._id);
    return {
      id,
      journalCode: e.journalCode,
      journalKind: e.journalKind,
      fiscalYear: null,
      number: null,
      date: e.date,
      status: e.status,
      bookCurrency: e.bookCurrency,
      label: e.label,
      source: e.source
        ? { ...e.source, kind: e.source.kind as NonNullable<AccountingEntryView['source']>['kind'] }
        : null,
      sourceKey: e.sourceKey,
      lines: e.lines.map((l, i) => lineView(id, i, l, labels)),
      reversalOf: e.reversalOfKey,
      reversedBy: null,
      reversalReason: e.reversalReason,
      generation: e.generation,
      manual: null,
      suspense: e.suspense,
      seq: null,
      hash: null,
      postedAt: null,
      simulation: true,
      revision: null,
    };
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  async search(
    organizationId: string,
    f: AccountingEntrySearchBody,
  ): Promise<AccountingPage<AccountingEntryView>> {
    const settings = await this.settings.ensure(organizationId);
    const limit = f.limit ?? DEFAULT_LIMIT;
    const cursor = readCursor(f.cursor);
    const labels = await this.labels(organizationId);
    if (settings.mode === 'simulation') {
      const state = (await this.sync.state(organizationId, settings))!;
      const { entries } = await this.sync.simulate(organizationId, state);
      const sorted = entries
        .filter((e) => matches(e, f))
        .sort((a, b) =>
          a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.sourceKey < b.sourceKey ? 1 : -1,
        )
        .filter(
          (e) =>
            cursor === null ||
            e.date < cursor.date ||
            (e.date === cursor.date && e.sourceKey < cursor.key),
        );
      const page = sorted.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((e) => this.simulatedView(e, labels)),
        nextCursor: sorted.length > limit && last ? cursorOf(last.date, last.sourceKey) : null,
        simulation: true,
      };
    }
    const filter: FilterQuery<AccountingEntryLean> = { organizationId };
    if (f.journalCode !== undefined) filter.journalCode = f.journalCode;
    if (f.from !== undefined || f.to !== undefined) {
      filter.date = {
        ...(f.from !== undefined ? { $gte: f.from } : {}),
        ...(f.to !== undefined ? { $lte: f.to } : {}),
      };
    }
    if (f.accountNumber !== undefined) {
      filter.$or = [
        { 'lines.accountNumber': f.accountNumber },
        { 'lines.auxiliaryAccountNumber': f.accountNumber },
      ];
    }
    if (f.sourceNumber !== undefined) {
      filter['source.number'] = { $regex: `^${escapeRegex(f.sourceNumber)}$`, $options: 'i' };
    }
    if (f.sourceKind !== undefined) {
      if (f.sourceKind === 'manual') filter.source = null;
      else filter['source.kind'] = f.sourceKind;
    }
    if (f.sourceId !== undefined) filter['source.id'] = f.sourceId;
    if (f.status !== undefined) filter.status = f.status;
    if (f.suspense !== undefined) filter.suspense = f.suspense;
    if (cursor !== null && Types.ObjectId.isValid(cursor.key)) {
      filter.$and = [
        {
          $or: [
            { date: { $lt: cursor.date } },
            { date: cursor.date, _id: { $lt: new Types.ObjectId(cursor.key) } },
          ],
        },
      ];
    }
    const docs = await this.store.entries
      .find(filter)
      .sort({ date: -1, _id: -1 })
      .limit(limit + 1)
      .lean<AccountingEntryLean[]>()
      .exec();
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((d) => entryView(d, labels)),
      nextCursor: docs.length > limit && last ? cursorOf(last.date, String(last._id)) : null,
      simulation: false,
    };
  }

  async get(organizationId: string, id: string): Promise<AccountingEntryView> {
    const settings = await this.settings.ensure(organizationId);
    const labels = await this.labels(organizationId);
    if (settings.mode === 'simulation') {
      const state = (await this.sync.state(organizationId, settings))!;
      const { entries } = await this.sync.simulate(organizationId, state);
      const found = entries.find((e) => e.sourceKey === id);
      if (!found) notFound('ENTRY_NOT_FOUND', 'Écriture introuvable.');
      return this.simulatedView(found, labels);
    }
    return entryView(await this.find(organizationId, id), labels);
  }

  private async find(organizationId: string, id: string): Promise<AccountingEntryLean> {
    if (!Types.ObjectId.isValid(id) || !/^[0-9a-f]{24}$/i.test(id)) {
      notFound('ENTRY_NOT_FOUND', 'Écriture introuvable.');
    }
    const doc = await this.store.entries
      .findOne({ _id: id, organizationId })
      .lean<AccountingEntryLean>()
      .exec();
    if (!doc) notFound('ENTRY_NOT_FOUND', 'Écriture introuvable.');
    return doc;
  }

  /**
   * Écritures en vue de restitution (K3) : en simulation, calculées à la volée ; sinon,
   * enregistrées (tous statuts : le moteur de restitution écarte ce qui n'est pas validé).
   * Point d'extension des lots K6 (grand livre, balances, états) et K7.
   */
  async reportingEntries(
    organizationId: string,
    range: { from?: string; to?: string } = {},
  ): Promise<{ mode: AccountingSettingsLean['mode']; entries: ReportingEntry[] }> {
    const settings = await this.settings.ensure(organizationId);
    const inRange = (date: string): boolean =>
      (range.from === undefined || date >= range.from) && (range.to === undefined || date <= range.to);
    if (settings.mode === 'simulation') {
      const state = (await this.sync.state(organizationId, settings))!;
      const { entries } = await this.sync.simulate(organizationId, state);
      return {
        mode: 'simulation',
        entries: entries.filter((e) => inRange(e.date)).map((e) => reportingOf(e)),
      };
    }
    const docs = await this.store.entries
      .find({
        organizationId,
        ...(range.from !== undefined || range.to !== undefined
          ? {
              date: {
                ...(range.from !== undefined ? { $gte: range.from } : {}),
                ...(range.to !== undefined ? { $lte: range.to } : {}),
              },
            }
          : {}),
      })
      .sort({ date: 1, _id: 1 })
      .lean<AccountingEntryLean[]>()
      .exec();
    return { mode: settings.mode, entries: docs.map((d) => reportingOf(d)) };
  }

  /** « À comptabiliser » : enregistré (mode actif), ou calculé (simulation). */
  async listPending(organizationId: string): Promise<AccountingPage<AccountingPendingView>> {
    const settings = await this.settings.ensure(organizationId);
    if (settings.mode !== 'simulation') {
      return { ...(await this.pending.list(organizationId)), simulation: false };
    }
    const state = (await this.sync.state(organizationId, settings))!;
    const { outcomes } = await this.sync.simulate(organizationId, state);
    const now = new Date().toISOString();
    const items: AccountingPendingView[] = [];
    for (const o of outcomes) {
      const reasons = o.result === null ? ['UNSUPPORTED_SOURCE'] : o.result.pending;
      for (const reason of [...new Set(reasons)]) {
        const r = (
          [
            'NO_TREASURY_ACCOUNT',
            'RATE_MISSING',
            'PERIOD_CLOSED',
            'SOURCE_CHANGED_IN_CLOSED_PERIOD',
            'UNSUPPORTED_SOURCE',
          ] as const
        ).find((x) => x === reason) ?? 'UNSUPPORTED_SOURCE';
        items.push({
          id: `${o.source.kind}:${o.source.id}:${r}`,
          reason: r,
          status: 'open',
          source: {
            kind: o.source.kind,
            id: o.source.id,
            number: o.source.number,
            date: o.source.date,
          },
          entryId: null,
          createdAt: now,
          lastSeenAt: now,
          resolvedAt: null,
          resolvedBy: null,
          resolution: null,
        });
      }
    }
    items.sort((a, b) => (a.source.date < b.source.date ? 1 : a.source.date > b.source.date ? -1 : 0));
    return { items, nextCursor: null, simulation: true };
  }

  // ── Opérations diverses ──────────────────────────────────────────────────

  private async activeSettings(organizationId: string): Promise<AccountingSettingsLean> {
    const s = await this.settings.ensure(organizationId);
    if (s.mode !== 'active' || s.bookCurrency === null) {
      conflict(
        'ACCOUNTING_NOT_ACTIVE',
        'La saisie d’écritures n’existe qu’en mode actif : en simulation, rien n’est enregistré.',
      );
    }
    return s;
  }

  /** Lignes saisies → lignes d'écriture, comptes vérifiés dans le plan, équilibre au moteur. */
  private async manualLines(
    organizationId: string,
    settings: AccountingSettingsLean,
    date: string,
    label: string,
    lines: CreateManualEntryBody['lines'],
  ): Promise<StoredEntryLine[]> {
    const plan = await this.accountsService.activeNumbers(organizationId);
    const auxNumbers = lines
      .map((l) => l.auxiliaryAccountNumber)
      .filter((v): v is string => typeof v === 'string');
    const aux = await this.accounts
      .find({ organizationId, number: { $in: auxNumbers }, auxiliary: { $ne: null } })
      .lean<AccountingAccountLean[]>()
      .exec();
    const currency = settings.bookCurrency!;
    const stored: StoredEntryLine[] = lines.map((l, i) => {
      if (l.accountNumber !== ACCOUNTING_SUSPENSE_ACCOUNT && !plan.has(l.accountNumber)) {
        conflict('ACCOUNT_NOT_IN_PLAN', `Ligne ${i + 1} : ce compte n’est pas un compte actif du plan.`, {
          line: i,
          accountNumber: l.accountNumber,
        });
      }
      const auxNumber = l.auxiliaryAccountNumber ?? null;
      if (auxNumber !== null) {
        const a = aux.find((x) => x.number === auxNumber);
        if (!a || !a.active || a.collectiveNumber !== l.accountNumber) {
          conflict(
            'ACCOUNT_NOT_IN_PLAN',
            `Ligne ${i + 1} : ce compte auxiliaire n’est pas rattaché à ce compte collectif.`,
            { line: i, auxiliaryAccountNumber: auxNumber },
          );
        }
      }
      const side: 'debit' | 'credit' = l.debit !== undefined ? 'debit' : 'credit';
      const amount = (l.debit ?? l.credit)!;
      return {
        operationKey: 'manual',
        side,
        accountNumber: l.accountNumber,
        auxiliaryAccountNumber: auxNumber,
        label: l.label ?? label,
        currency,
        amount,
        bookAmount: amount,
        debit: side === 'debit' ? amount : '0.00',
        credit: side === 'credit' ? amount : '0.00',
        rate: '1',
        rateSource: 'same_currency',
        rateRef: null,
        letteringCode: null,
        matchRef: null,
        suspenseReason: null,
        exchangeDifference: false,
      };
    });
    const proposed: ProposedEntry = {
      sourceKey: 'manual',
      status: 'ready',
      journal: { kind: 'misc', treasuryAccountId: null },
      date,
      bookCurrency: currency,
      label,
      source: { kind: 'sales_invoice', id: '', event: '', number: null, date, partyName: null },
      lines: stored,
      reversalOf: null,
      reversalReason: null,
      generation: { ruleSetVersion: null, chartPack: null, engineVersion: '' },
      suspense: false,
    };
    const check = checkEntry(proposed);
    const unbalanced = check.issues.find(
      (i) => i.code === 'ENTRY_UNBALANCED' || i.code === 'ENTRY_UNBALANCED_IN_CURRENCY',
    );
    if (unbalanced) {
      conflict('ENTRY_UNBALANCED', 'Les débits et les crédits ne s’équilibrent pas.', {
        totals: check.bookTotals,
      });
    }
    if (!check.ok) {
      conflict('ENTRY_INVALID', 'Écriture invalide.', { issues: check.issues });
    }
    return stored;
  }

  async create(
    organizationId: string,
    body: CreateManualEntryBody,
    actor: AccountingActor,
  ): Promise<AccountingEntryView> {
    const settings = await this.activeSettings(organizationId);
    const journals = await this.store.journalsOf(organizationId);
    const journal = journals.find((j) => j.code === body.journalCode);
    if (!journal) notFound('JOURNAL_NOT_FOUND', 'Journal introuvable.');
    if (journal.kind !== 'misc' && journal.kind !== 'opening') {
      conflict(
        'JOURNAL_NOT_MANUAL',
        'Une opération diverse se saisit dans un journal d’opérations diverses ou d’à-nouveaux.',
      );
    }
    const label = body.label ?? body.reason;
    const lines = await this.manualLines(organizationId, settings, body.date, label, body.lines);
    const id = new Types.ObjectId();
    const doc: NewEntryDoc & { _id: Types.ObjectId } = {
      _id: id,
      organizationId,
      journalCode: journal.code,
      journalKind: journal.kind,
      date: body.date,
      status: 'draft',
      bookCurrency: settings.bookCurrency!,
      label,
      source: null,
      sourceKey: `manual:${id.toHexString()}`,
      keyed: true,
      lines,
      reversalOf: null,
      reversalOfKey: null,
      reversalReason: null,
      generation: null,
      manual: {
        authorId: actor.userId,
        validatorId: null,
        soleApprover: false,
        attachmentKey: body.attachmentKey ?? null,
        reason: body.reason,
      },
      regeneration: null,
      suspense: lines.some((l) => l.accountNumber === ACCOUNTING_SUSPENSE_ACCOUNT),
      createdBy: actor.userId,
      updatedBy: actor.userId,
    };
    const created = await this.store.insertUnposted(organizationId, doc);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.entry_drafted',
      targetType: 'accounting_entry',
      targetId: id.toHexString(),
      metadata: { journalCode: journal.code, lines: lines.length },
    });
    return entryView(created!, await this.labels(organizationId));
  }

  async update(
    organizationId: string,
    id: string,
    body: UpdateManualEntryBody,
    actor: AccountingActor,
  ): Promise<AccountingEntryView> {
    const settings = await this.activeSettings(organizationId);
    const current = await this.find(organizationId, id);
    if (current.status !== 'draft' || current.manual === null) {
      conflict('ENTRY_NOT_DRAFT', 'Une écriture validée ne se modifie jamais : contre-passez-la.');
    }
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const date = body.date ?? current.date;
    const reason = body.reason ?? current.manual.reason;
    const label = body.label === undefined ? (current.label ?? reason) : (body.label ?? reason);
    const set: Partial<AccountingEntryLean> = {
      date,
      label,
      manual: {
        ...current.manual,
        reason,
        attachmentKey:
          body.attachmentKey === undefined ? current.manual.attachmentKey : body.attachmentKey,
      },
      updatedBy: actor.userId,
    };
    if (body.lines !== undefined || body.date !== undefined) {
      const raw =
        body.lines ??
        current.lines.map((l) => ({
          accountNumber: l.accountNumber,
          auxiliaryAccountNumber: l.auxiliaryAccountNumber,
          label: l.label,
          ...(l.side === 'debit' ? { debit: l.amount } : { credit: l.amount }),
        }));
      set.lines = await this.manualLines(organizationId, settings, date, label, raw);
      set.suspense = set.lines.some((l) => l.accountNumber === ACCOUNTING_SUSPENSE_ACCOUNT);
    }
    const updated = await this.store.entries
      .findOneAndUpdate(
        { _id: id, organizationId, status: 'draft', revision: body.expectedRevision },
        { $set: set, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<AccountingEntryLean>()
      .exec();
    if (!updated) staleRevision(current.revision);
    return entryView(updated, await this.labels(organizationId));
  }

  async remove(organizationId: string, id: string, actor: AccountingActor): Promise<void> {
    const current = await this.find(organizationId, id);
    if (current.status !== 'draft') {
      conflict('ENTRY_NOT_DRAFT', 'Une écriture validée ne se supprime jamais : contre-passez-la.');
    }
    const res = await this.store.entries
      .deleteOne({ _id: id, organizationId, status: 'draft' })
      .exec();
    if (res.deletedCount === 0) {
      conflict('ENTRY_NOT_DRAFT', 'Une écriture validée ne se supprime jamais : contre-passez-la.');
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.entry_draft_deleted',
      targetType: 'accounting_entry',
      targetId: id,
      metadata: { journalCode: current.journalCode },
    });
  }

  /** Validation d'une opération diverse : séparation des tâches, numéro, chaînage. */
  async validate(
    organizationId: string,
    id: string,
    body: ValidateManualEntryBody,
    actor: AccountingActor,
  ): Promise<AccountingEntryView> {
    const settings = await this.activeSettings(organizationId);
    const current = await this.find(organizationId, id);
    if (current.manual === null) {
      conflict('ENTRY_NOT_DRAFT', 'Seule une opération diverse en brouillon se valide.');
    }
    const decision = manualEntryDecision({
      status: current.status,
      validatorUserId: actor.userId,
      authorUserId: current.manual.authorId,
      approverCountInOrg: await this.authz.countApprovers(organizationId, 'accounting.post'),
    });
    if (!decision.ok) {
      conflict(
        decision.code,
        decision.code === 'ENTRY_NOT_DRAFT'
          ? 'Cette écriture est déjà validée : elle ne se valide plus, elle se contre-passe.'
          : 'Vous avez saisi cette écriture : une autre personne autorisée doit la valider.',
      );
    }
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const period = await this.store.periodOf(organizationId, current.date);
    if (period === null || period.status !== 'open') {
      conflict('ACCOUNTING_PERIOD_CLOSED', 'Le mois de cette écriture n’est pas ouvert.');
    }
    // L'équilibre est revérifié : le plan a pu changer depuis la saisie.
    await this.manualLines(
      organizationId,
      settings,
      current.date,
      current.label ?? '',
      current.lines.map((l) => ({
        accountNumber: l.accountNumber,
        auxiliaryAccountNumber: l.auxiliaryAccountNumber,
        label: l.label,
        ...(l.side === 'debit' ? { debit: l.amount } : { credit: l.amount }),
      })),
    );
    const posted = await this.store.post(
      organizationId,
      {
        existingId: id,
        expectedRevision: current.revision,
        patch: {
          manual: { ...current.manual, validatorId: actor.userId, soleApprover: decision.soleApprover },
        },
      },
      period.fiscalYear,
      actor.userId,
    );
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.entry_validated',
      targetType: 'accounting_entry',
      targetId: id,
      metadata: {
        journalCode: posted!.journalCode,
        fiscalYear: posted!.fiscalYear,
        number: posted!.number,
        soleApprover: decision.soleApprover,
      },
    });
    return entryView(posted!, await this.labels(organizationId));
  }

  /** Contre-passation d'une écriture validée (générée ou saisie), liée à l'origine. */
  async reverse(
    organizationId: string,
    id: string,
    body: ReverseEntryBody,
    actor: AccountingActor,
  ): Promise<AccountingEntryView> {
    await this.activeSettings(organizationId);
    const current = await this.find(organizationId, id);
    if (current.status !== 'posted') {
      conflict('ENTRY_NOT_POSTED', 'Seule une écriture validée se contre-passe ; un brouillon se supprime.');
    }
    if (current.reversalOf !== null) {
      conflict('ENTRY_IS_REVERSAL', 'Une contre-passation ne se contre-passe pas.');
    }
    if (current.reversedBy !== null) {
      conflict('ENTRY_ALREADY_REVERSED', 'Cette écriture est déjà contre-passée.');
    }
    const date = body.date ?? kinshasaDayOf(new Date());
    const period = await this.store.periodOf(organizationId, date);
    if (period === null || period.status !== 'open') {
      conflict('ACCOUNTING_PERIOD_CLOSED', 'Le mois de la contre-passation n’est pas ouvert.');
    }
    const rev = reverseEntry(proposedOf(current), {
      sourceKey: `${current.sourceKey}:reversal`,
      date,
      reason: 'MANUAL',
    });
    const doc = newEntryDoc(
      organizationId,
      rev,
      { code: current.journalCode, kind: current.journalKind },
      actor.userId,
      {
        source: current.source,
        reversalOf: String(current._id),
        generation: current.generation,
        manual: {
          authorId: actor.userId,
          validatorId: actor.userId,
          soleApprover: false,
          attachmentKey: null,
          reason: body.reason,
        },
      },
    );
    const posted = await this.store.post(organizationId, { doc }, period.fiscalYear, actor.userId);
    if (!posted) conflict('ENTRY_ALREADY_REVERSED', 'Cette écriture est déjà contre-passée.');
    await this.store.markReversed(organizationId, id, String(posted._id));
    await this.lettering.unletterEntry(organizationId, current, actor.userId);
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.entry_reversed',
      targetType: 'accounting_entry',
      targetId: id,
      metadata: { reversalId: String(posted._id), date, journalCode: current.journalCode },
    });
    return entryView(posted, await this.labels(organizationId));
  }
}
