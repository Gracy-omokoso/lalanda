// Contre-passation et idempotence par clé de source (ADR-0049 § 2.6, § 4, § 6).
//
// On ne supprime jamais une écriture : on la contre-passe. La contre-passation
// recopie chaque ligne à l'identique (comptes, devise, montants, montants de
// tenue, taux) en inversant le côté : la somme des deux écritures est nulle sur
// chaque compte, en devise de pièce comme en monnaie de tenue.

import { ACCOUNTING_VERSION, type ProposedEntry, type PostingResult } from '../types.js';
import { reversalKey } from './source-keys.js';

export interface ReverseOptions {
  /** Clé de la contre-passation (voir `reversalKey`). */
  sourceKey: string;
  /** Date de la contre-passation ; défaut : celle de l'écriture d'origine. */
  date?: string;
  /** Motif (`SOURCE_CANCELLED`, `SOURCE_REVISED`, `SOURCE_CHANGED_IN_CLOSED_PERIOD`, `MANUAL`…). */
  reason: string;
}

/** Écriture inverse exacte de `entry`. */
export function reverseEntry(entry: ProposedEntry, options: ReverseOptions): ProposedEntry {
  return {
    sourceKey: options.sourceKey,
    status: entry.status,
    journal: { ...entry.journal },
    date: options.date ?? entry.date,
    bookCurrency: entry.bookCurrency,
    label: `Contre-passation — ${entry.label}`,
    source: { ...entry.source },
    lines: entry.lines.map((l) => ({
      ...l,
      side: l.side === 'debit' ? 'credit' : 'debit',
      debit: l.credit,
      credit: l.debit,
      letteringCode: null,
    })),
    reversalOf: entry.sourceKey,
    reversalReason: options.reason,
    generation: { ...entry.generation, engineVersion: ACCOUNTING_VERSION },
    suspense: entry.suspense,
  };
}

export interface SyncPlan {
  /** Écritures nouvelles (pièce ou contre-passations), dans un ordre déterministe. */
  create: ProposedEntry[];
  /** Clés déjà présentes : rien à écrire. */
  unchanged: string[];
}

/**
 * Compare les écritures voulues pour une pièce (`result.entries`) à celles
 * déjà enregistrées pour la même pièce (`existing`, contre-passations
 * comprises) :
 * - une clé voulue déjà présente n'est jamais réécrite (idempotence ; une règle
 *   changée n'altère aucune écriture passée, § 2.4) ;
 * - une écriture active (ni contre-passée, ni contre-passation) qui n'est plus
 *   voulue est contre-passée — annulation ou révision remplacée.
 * Rejouer le plan sur son propre résultat ne crée plus rien.
 */
export function syncSourceEntries(
  result: PostingResult,
  existing: readonly ProposedEntry[],
  options: { reversalDate?: string } = {},
): SyncPlan {
  const keys = new Set(existing.map((e) => e.sourceKey));
  const reversed = new Set(
    existing.map((e) => e.reversalOf).filter((k): k is string => k !== null),
  );
  const wanted = new Set(result.entries.map((e) => e.sourceKey));
  const create: ProposedEntry[] = [];
  const unchanged: string[] = [];

  const active = existing
    .filter((e) => e.reversalOf === null && !reversed.has(e.sourceKey))
    .sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0));
  const obsolete = active.filter((e) => !wanted.has(e.sourceKey));
  for (const entry of obsolete) {
    const cause = result.cancelled ? 'cancel' : 'superseded';
    const key = reversalKey(entry.sourceKey, cause, active.length);
    if (keys.has(key)) continue;
    create.push(
      reverseEntry(entry, {
        sourceKey: key,
        date: options.reversalDate ?? entry.date,
        reason: result.cancelled ? 'SOURCE_CANCELLED' : 'SOURCE_REVISED',
      }),
    );
    keys.add(key);
  }
  for (const entry of result.entries) {
    if (keys.has(entry.sourceKey)) unchanged.push(entry.sourceKey);
    else {
      create.push(entry);
      keys.add(entry.sourceKey);
    }
  }
  return { create, unchanged };
}
