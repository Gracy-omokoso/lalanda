// Raccord K2/K3 (ADR-0049 § 2.6, § 5, § 12 ; note du 1er novembre 2026).
//
// Le moteur d'écritures (K2) produit des `ProposedEntry` ; la restitution (K3)
// lit des vues `ReportingEntry`. `toReportingEntry` traduit l'une en l'autre,
// fidèlement et sans calcul :
// - côté inactif : `'0.00'` chez K2, `null` chez K3 ; le côté actif garde le
//   montant de tenue de K2, même `0.00` (ligne convertie arrondie à zéro) ;
// - `matchRef` (pièce à lettrer) devient `documentRef` ;
// - `operationKey`, `suspenseReason`, `exchangeDifference`, taux et lettrage
//   sont recopiés ; `bookCurrency` passe à l'écriture ;
// - ce que K2 ne connaît pas (identifiant, journal, exercice, numéro, statut,
//   date de validation, chaînage) vient de la persistance (lot K5).
//
// Module PUR : aucune base, aucune horloge. Une écriture K2 incohérente (côté
// discordant, statut contradictoire) lève une `RangeError` : rien n'est deviné.

import type { ReportingEntry, ReportingLine } from './ledger/types.js';
import type { EntryLine, ProposedEntry } from './types.js';

/** Ce que la persistance attribue à une écriture K2 (§ 2.6). */
export type ReportingPersistence = Pick<
  ReportingEntry,
  'id' | 'journalCode' | 'fiscalYear' | 'number' | 'status'
> &
  Partial<Pick<ReportingEntry, 'postedOn' | 'reversalOf' | 'reversedBy' | 'manual' | 'hash'>>;

function lineOf(entry: ProposedEntry, line: EntryLine, index: number): ReportingLine {
  const where = `Écriture ${entry.sourceKey}, ligne ${index + 1}`;
  let debit: string | null = null;
  let credit: string | null = null;
  if (entry.status === 'awaiting_rate') {
    if (line.bookAmount !== null || line.debit !== null || line.credit !== null) {
      throw new RangeError(`${where} : montants de tenue sur une écriture en attente de taux`);
    }
  } else {
    if (line.bookAmount === null) throw new RangeError(`${where} : montant de tenue absent`);
    const active = line.side === 'debit' ? line.debit : line.credit;
    const inactive = line.side === 'debit' ? line.credit : line.debit;
    if (active !== line.bookAmount || inactive !== '0.00') {
      throw new RangeError(`${where} : débit et crédit ne reflètent pas le côté de la ligne`);
    }
    if (line.side === 'debit') debit = line.bookAmount;
    else credit = line.bookAmount;
  }
  return {
    accountNumber: line.accountNumber,
    auxiliaryAccountNumber: line.auxiliaryAccountNumber,
    label: line.label,
    debit,
    credit,
    currency: line.currency,
    amount: line.amount,
    rate: line.rate,
    rateSource: line.rateSource,
    rateRef: line.rateRef,
    letteringCode: line.letteringCode,
    operationKey: line.operationKey,
    suspenseReason: line.suspenseReason,
    documentRef: line.matchRef,
    exchangeDifference: line.exchangeDifference,
  };
}

/**
 * Vue de restitution d'une écriture K2 enregistrée. `reversalOf` reprend
 * l'identifiant fourni par la persistance ; à défaut, la clé de source de
 * l'écriture contre-passée (K2).
 */
export function toReportingEntry(
  entry: ProposedEntry,
  persistence: ReportingPersistence,
): ReportingEntry {
  if (entry.status === 'awaiting_rate' && persistence.status !== 'awaiting_rate') {
    throw new RangeError(
      `Écriture ${entry.sourceKey} : en attente de taux, statut « ${persistence.status} » refusé`,
    );
  }
  if (entry.status === 'ready' && persistence.status === 'awaiting_rate') {
    throw new RangeError(
      `Écriture ${entry.sourceKey} : convertie, statut « awaiting_rate » refusé`,
    );
  }
  return {
    id: persistence.id,
    journalCode: persistence.journalCode,
    fiscalYear: persistence.fiscalYear,
    number: persistence.number,
    date: entry.date,
    status: persistence.status,
    bookCurrency: entry.bookCurrency,
    label: entry.label,
    source: {
      kind: entry.source.kind,
      id: entry.source.id,
      number: entry.source.number,
      date: entry.source.date,
      partyName: entry.source.partyName,
    },
    sourceKey: entry.sourceKey,
    lines: entry.lines.map((l, i) => lineOf(entry, l, i)),
    reversalOf: persistence.reversalOf ?? entry.reversalOf,
    reversedBy: persistence.reversedBy ?? null,
    generation: {
      ruleSetVersion: entry.generation.ruleSetVersion,
      chartPack: entry.generation.chartPack,
      engineVersion: entry.generation.engineVersion,
    },
    manual: persistence.manual ?? null,
    postedOn: persistence.postedOn ?? null,
    hash: persistence.hash ?? null,
  };
}
