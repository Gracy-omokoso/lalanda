// Lettrage (ADR-0049 § 6.11, § 2.7 `accounting_lettering`). ADR-0049 — K5.
//
// - Automatique : quand une écriture d'encaissement ou de paiement cite sa facture
//   (`matchRef`), les lignes `posted` non lettrées du même compte auxiliaire qui citent la
//   même pièce sont lettrées dès que leur somme EN DEVISE DE LA PIÈCE est nulle
//   (`suggestLettering`, moteur K3). Un reste dû : rien n'est lettré.
// - Manuel (`accounting.post`) : `checkLettering` (même compte auxiliaire, même devise,
//   somme nulle) ; `409 LETTERING_NOT_BALANCED`, `LETTERING_MIXED_ACCOUNTS`…
// - Délettrage par événement inverse ; la contre-passation d'une écriture lettrée délettre.
//
// Événements en ajout seul ; le code actif est recopié sur les lignes pour la lecture
// (hors empreinte de l'écriture).

import {
  checkLettering,
  suggestLettering,
  type ReportingEntry,
} from '@lalanda/engine';
import type { AccountingLetteringView } from '@lalanda/shared/accounting';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, notFound, type AccountingActor } from '../accounting.common.js';
import type { AccountingEntryLean } from '../entries/accounting-entry.schema.js';
import { AccountingEntryStore, reportingOf } from '../entries/accounting-entry-store.service.js';
import { AccountingLettering, type AccountingLetteringLean } from './accounting-lettering.schema.js';

const MESSAGES: Record<string, string> = {
  LETTERING_TOO_FEW_LINES: 'Deux lignes au moins.',
  LETTERING_UNKNOWN_LINE: 'Ligne introuvable.',
  LETTERING_DUPLICATE_LINE: 'Une ligne est citée deux fois.',
  LETTERING_LINE_NOT_POSTED: 'Seules les lignes d’écritures validées se lettrent.',
  LETTERING_LINE_WITHOUT_AUXILIARY: 'Seules les lignes d’un compte client ou fournisseur se lettrent.',
  LETTERING_MIXED_ACCOUNTS: 'Les lignes doivent viser le même compte auxiliaire.',
  LETTERING_MIXED_CURRENCIES: 'Les lignes doivent être dans la même devise.',
  LETTERING_NOT_BALANCED: 'La somme des lignes n’est pas nulle dans la devise de la pièce.',
  LETTERING_ALREADY_LETTERED: 'Une ligne est déjà lettrée : délettrez-la d’abord.',
};

function splitRef(ref: string): { id: string; index: number } {
  const [id = '', index = '0'] = ref.split('#');
  return { id, index: Number(index) };
}

@Injectable()
export class AccountingLetteringService {
  constructor(
    @InjectModel(AccountingLettering.name)
    private readonly events: Model<AccountingLetteringLean>,
    @Inject(AccountingEntryStore) private readonly store: AccountingEntryStore,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async entriesOf(organizationId: string, ids: readonly string[]): Promise<AccountingEntryLean[]> {
    const valid = [...new Set(ids)].filter((id) => /^[0-9a-f]{24}$/i.test(id));
    return this.store.entries
      .find({ organizationId, _id: { $in: valid } })
      .lean<AccountingEntryLean[]>()
      .exec();
  }

  private async write(
    organizationId: string,
    code: string,
    head: { accountNumber: string; auxiliary: string | null; currency: string; bookDifference: string | null },
    lineRefs: readonly string[],
    automatic: boolean,
    by: string,
  ): Promise<void> {
    const at = new Date();
    await this.events.create({
      organizationId,
      code,
      accountNumber: head.accountNumber,
      auxiliary: head.auxiliary,
      currency: head.currency,
      lineRefs: [...lineRefs],
      action: 'letter',
      automatic,
      bookDifference: head.bookDifference,
      at,
      by,
      _schemaVersion: 1,
    });
    for (const ref of lineRefs) {
      const { id, index } = splitRef(ref);
      await this.store.entries
        .updateOne({ _id: id, organizationId }, { $set: { [`lines.${index}.letteringCode`]: code } })
        .exec();
    }
  }

  /**
   * Lettrage automatique des pièces citées (`matchRef`) par les écritures données : chaque
   * groupe complet (somme nulle en devise) reçoit un code. Rend le nombre de lettrages.
   */
  async autoLetter(organizationId: string, matchRefs: readonly string[]): Promise<number> {
    const refs = [...new Set(matchRefs.filter((r) => r !== ''))];
    if (refs.length === 0) return 0;
    const docs = await this.store.entries
      .find({ organizationId, status: 'posted', 'lines.matchRef': { $in: refs } })
      .lean<AccountingEntryLean[]>()
      .exec();
    const reporting: ReportingEntry[] = docs.map((d) => reportingOf(d));
    const lettered = new Set<string>();
    docs.forEach((d) =>
      d.lines.forEach((l, i) => {
        if (l.letteringCode) lettered.add(`${String(d._id)}#${i}`);
      }),
    );
    const { suggestions } = suggestLettering(reporting, lettered);
    let n = 0;
    for (const s of suggestions) {
      // Compte auxiliaire seulement (§ 6.11) : le compte d'attente ne se lettre pas.
      if (s.status !== 'full' || s.auxiliaryAccountNumber === null) continue;
      if (!refs.includes(s.documentRef)) continue;
      const code = await this.store.nextLetteringCode(organizationId);
      await this.write(
        organizationId,
        code,
        {
          accountNumber: s.accountNumber,
          auxiliary: s.auxiliaryAccountNumber,
          currency: s.currency,
          bookDifference: s.bookDifference,
        },
        s.lineRefs,
        true,
        'system',
      );
      n += 1;
    }
    return n;
  }

  /** Délettre tout code qui touche une ligne de l'écriture (contre-passation). */
  async unletterEntry(organizationId: string, entry: AccountingEntryLean, by: string): Promise<void> {
    const codes = [...new Set(entry.lines.map((l) => l.letteringCode).filter((c): c is string => !!c))];
    for (const code of codes) await this.unletterCode(organizationId, code, by);
  }

  private async unletterCode(organizationId: string, code: string, by: string): Promise<AccountingLetteringLean> {
    const letter = await this.events
      .findOne({ organizationId, code, action: 'letter' })
      .lean<AccountingLetteringLean>()
      .exec();
    if (!letter) notFound('LETTERING_NOT_FOUND', 'Lettrage introuvable.');
    const done = await this.events
      .findOne({ organizationId, code, action: 'unletter' })
      .lean<AccountingLetteringLean>()
      .exec();
    if (done) conflict('LETTERING_NOT_ACTIVE', 'Ce lettrage est déjà défait.');
    await this.events.create({
      ...letter,
      _id: undefined,
      action: 'unletter',
      automatic: by === 'system',
      at: new Date(),
      by,
    });
    for (const ref of letter.lineRefs) {
      const { id, index } = splitRef(ref);
      await this.store.entries
        .updateOne(
          { _id: id, organizationId, [`lines.${index}.letteringCode`]: code },
          { $set: { [`lines.${index}.letteringCode`]: null } },
        )
        .exec();
    }
    return letter;
  }

  /** `POST /accounting/lettering` : lettrage manuel. */
  async letter(
    organizationId: string,
    lineRefs: readonly string[],
    actor: AccountingActor,
  ): Promise<AccountingLetteringView> {
    const docs = await this.entriesOf(
      organizationId,
      lineRefs.map((r) => splitRef(r).id),
    );
    const lettered = new Set<string>();
    docs.forEach((d) =>
      d.lines.forEach((l, i) => {
        if (l.letteringCode) lettered.add(`${String(d._id)}#${i}`);
      }),
    );
    const check = checkLettering({
      entries: docs.map((d) => reportingOf(d)),
      lineRefs,
      alreadyLettered: lettered,
    });
    if (!check.ok) {
      if (check.code === 'LETTERING_UNKNOWN_LINE') notFound('LETTERING_UNKNOWN_LINE', MESSAGES[check.code]!);
      conflict(check.code, MESSAGES[check.code] ?? 'Lettrage refusé.', { lineRefs: check.lineRefs });
    }
    const code = await this.store.nextLetteringCode(organizationId);
    await this.write(
      organizationId,
      code,
      {
        accountNumber: check.accountNumber,
        auxiliary: check.auxiliaryAccountNumber,
        currency: check.currency,
        bookDifference: check.bookDifference,
      },
      check.lineRefs,
      false,
      actor.userId,
    );
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.lettered',
      targetType: 'accounting_lettering',
      targetId: code,
      metadata: { lines: check.lineRefs.length, accountNumber: check.accountNumber },
    });
    return {
      code,
      accountNumber: check.accountNumber,
      auxiliaryAccountNumber: check.auxiliaryAccountNumber,
      currency: check.currency,
      lineRefs: check.lineRefs,
      bookDifference: check.bookDifference,
      automatic: false,
      at: new Date().toISOString(),
    };
  }

  /** `POST /accounting/lettering/:code/unletter`. */
  async unletter(
    organizationId: string,
    code: string,
    actor: AccountingActor,
  ): Promise<{ code: string; lineRefs: string[] }> {
    const letter = await this.unletterCode(organizationId, code, actor.userId);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.unlettered',
      targetType: 'accounting_lettering',
      targetId: code,
      metadata: { lines: letter.lineRefs.length },
    });
    return { code, lineRefs: letter.lineRefs };
  }
}
