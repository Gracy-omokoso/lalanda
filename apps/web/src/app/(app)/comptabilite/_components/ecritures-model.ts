// Écritures (ADR-0049 § 2.6, § 13) : filtres, numéro, lien vers la pièce. Logique pure.
//
// La pièce complète exige la lecture de SON module (§ 8.1) : le lien n'est proposé
// qu'avec le droit de lecture correspondant ; sinon, la copie d'affichage portée par
// l'écriture suffit (cas de l'expert-comptable externe, décision ouverte n° 3).
// Aucun montant n'est recalculé : débits et crédits sont ceux de l'API.

import type { OrgAction } from '@/lib/api';
import type { AccountingEntrySearch, AccountingEntryView } from '@/lib/api-accounting';

import { bornesDuMois } from './comptabilite-model';

export interface FiltresEcritures {
  journal: string;
  mois: string;
  compte: string;
  piece: string;
}

/** Corps de `POST /accounting/entries/search` : seuls les filtres renseignés partent. */
export function corpsRecherche(f: FiltresEcritures, cursor?: string): AccountingEntrySearch {
  const bornes = f.mois ? bornesDuMois(f.mois) : null;
  return {
    ...(f.journal ? { journalCode: f.journal } : {}),
    ...(bornes ? { from: bornes.from, to: bornes.to } : {}),
    ...(f.compte.trim() ? { accountNumber: f.compte.trim() } : {}),
    ...(f.piece.trim() ? { sourceNumber: f.piece.trim() } : {}),
    ...(cursor ? { cursor } : {}),
    limit: 50,
  };
}

/** « VE 2026 n° 12 », ou la raison de l'absence de numéro. */
export function numeroEcriture(
  e: Pick<AccountingEntryView, 'journalCode' | 'fiscalYear' | 'number' | 'status'>,
): string {
  if (e.number !== null && e.fiscalYear !== null) {
    return `${e.journalCode} ${e.fiscalYear} n° ${e.number}`;
  }
  return e.status === 'posted'
    ? `${e.journalCode}, non numérotée`
    : `${e.journalCode}, sans numéro`;
}

const LECTURE_PAR_SOURCE: Record<string, { action: OrgAction; chemin: (id: string) => string }> = {
  sales_invoice: {
    action: 'sales.read',
    chemin: (id) => `/ventes/factures/${encodeURIComponent(id)}`,
  },
  sales_receipt: { action: 'sales.read', chemin: () => '/ventes/encaissements' },
  treasury_expense: { action: 'treasury.read', chemin: () => '/tresorerie/depenses' },
  treasury_movement: { action: 'treasury.read', chemin: () => '/tresorerie/comptes' },
  supplier_invoice: {
    action: 'purchase.read',
    chemin: (id) => `/achats/factures/${encodeURIComponent(id)}`,
  },
  supplier_payment: { action: 'purchase.read', chemin: () => '/achats/a-payer' },
  stock_movement: { action: 'stock.read', chemin: () => '/stocks/mouvements' },
};

/** Lien vers la pièce dans son module, si l'appelant lit ce module ; sinon `null`. */
export function lienPiece(
  source: AccountingEntryView['source'],
  actions: readonly OrgAction[] | null,
): string | null {
  if (source === null || actions === null) return null;
  const cible = LECTURE_PAR_SOURCE[source.kind];
  if (!cible || !actions.includes(cible.action)) return null;
  return cible.chemin(source.id);
}

/** Origine de l'écriture, en clair : règle et sa version, ou saisie manuelle. */
export function origineEcriture(e: Pick<AccountingEntryView, 'generation' | 'manual'>): string {
  if (e.generation) {
    return e.generation.ruleSetVersion === null
      ? 'Générée par Lalanda depuis la pièce, sans règle validée : lignes au compte d’attente.'
      : `Générée par Lalanda depuis la pièce, règles version ${e.generation.ruleSetVersion}.`;
  }
  if (e.manual) return `Opération diverse saisie à la main. Motif : ${e.manual.reason}`;
  return 'Origine non précisée.';
}
