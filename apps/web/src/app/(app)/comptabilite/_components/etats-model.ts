// Projets d'états (ADR-0049 § 10, § 13) : bandeau projet et réserves EN TÊTE, rubriques
// « à confirmer » marquées, tableau des flux « non disponible » plutôt que deviné.
// Logique pure.

import {
  ACCOUNTING_DISCLAIMER,
  ACCOUNTING_STATEMENT_KINDS,
  ACCOUNTING_STATEMENT_STATUS,
  type AccountingStatementKind,
} from '@lalanda/shared/accounting';

import type { AccountingStatementView } from '@/lib/api-accounting';

import { codeDe } from './comptabilite-model';
import { LIBELLES_ETAT } from './libelles';

export const ONGLETS_ETATS: readonly { kind: AccountingStatementKind; libelle: string }[] =
  ACCOUNTING_STATEMENT_KINDS.map((kind) => ({ kind, libelle: LIBELLES_ETAT[kind] }));

/**
 * Bandeau d'un projet d'état : TOUJOURS présent, avant toute lecture et quelle qu'en
 * soit l'issue. Le texte est celui de `@lalanda/shared/accounting` ; si l'API en sert
 * un autre (`disclaimer`), il s'affiche à la suite, jamais à la place.
 */
export function bandeauxEtat(vue: AccountingStatementView | null): string[] {
  const textes = [ACCOUNTING_DISCLAIMER];
  if (vue && vue.disclaimer && vue.disclaimer !== ACCOUNTING_DISCLAIMER)
    textes.push(vue.disclaimer);
  return textes;
}

/** L'API a-t-elle bien rendu un projet (`status: "draft_unverified"`) ? */
export const estProjet = (vue: AccountingStatementView): boolean =>
  vue.status === ACCOUNTING_STATEMENT_STATUS;

/** Refus `409 STATEMENT_NOT_AVAILABLE` (tableau des flux tant que E8 n'est pas tranchée). */
export const etatNonDisponible = (err: unknown): boolean =>
  codeDe(err) === 'STATEMENT_NOT_AVAILABLE';

/** Nombre de rubriques encore « à confirmer » (sections comprises). */
export function rubriquesAConfirmer(vue: AccountingStatementView): number {
  let n = 0;
  for (const s of vue.sections) {
    for (const r of s.rubrics) if (r.toConfirm || s.toConfirm) n += 1;
  }
  return n;
}
