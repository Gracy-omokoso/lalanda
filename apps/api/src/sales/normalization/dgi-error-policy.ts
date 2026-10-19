// Conduite face aux erreurs DGI pendant une normalisation — ADR-0024 § 5.
//
// TABLE PROVISOIRE (chantier F2) : la traduction de référence des codes de
// l'annexe DGI (catégorie, message français) appartient au chantier F1
// (`edef/edef-errors.ts`), qui n'est pas encore fusionné. Ce fichier reprend
// SEULEMENT le tableau du § 5 de l'ADR (codes → catégorie → réessayable) dont
// la normalisation a besoin pour décider ; il sera remplacé par la lecture
// d'`edef-errors.ts` au rebase sur F1. Aucun libellé DGI n'est recopié : nos
// messages sont rédigés par nous, et l'utilisateur voit TOUJOURS aussi le code
// et le libellé renvoyés par la DGI (exigence DGI).

import type { NormalizationErrorCategory } from '../invoices/invoice.contract.js';

/** Catégories d'une erreur métier DGI (§ 5). */
export type DgiBusinessCategory = Extract<
  NormalizationErrorCategory,
  | 'data'
  | 'configuration'
  | 'capacity'
  | 'temporary'
  | 'server'
  | 'state'
  | 'totals_mismatch'
  | 'duplicate_pending'
  | 'unknown'
>;

const CODES: Readonly<Record<DgiBusinessCategory, readonly number[]>> = {
  data: [
    3, 4, 5, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 31, 33, 41,
    42,
  ],
  configuration: [32],
  capacity: [1],
  temporary: [10, 60],
  server: [61, 99],
  state: [20],
  totals_mismatch: [50, 51],
  duplicate_pending: [63],
  unknown: [],
};

const BY_CODE: ReadonlyMap<string, DgiBusinessCategory> = new Map(
  (Object.entries(CODES) as [DgiBusinessCategory, readonly number[]][]).flatMap(
    ([category, codes]) => codes.map((c) => [String(c), category] as const),
  ),
);

/** Code DGI normalisé (« 01 » et « 1 » désignent la même erreur). */
function normalizeCode(code: string): string {
  const trimmed = code.trim();
  return /^\d+$/.test(trimmed) ? trimmed.replace(/^0+(?=\d)/, '') : trimmed;
}

export function categoryOfDgiCode(code: string | null): DgiBusinessCategory {
  if (code === null) return 'unknown';
  return BY_CODE.get(normalizeCode(code)) ?? 'unknown';
}

/** Réessayable par une personne (bouton « Relancer ») une fois la cause levée. */
export const RETRYABLE_CATEGORIES: ReadonlySet<NormalizationErrorCategory> = new Set([
  'capacity',
  'temporary',
  'network',
  'token_rejected',
]);

/** Catégories qui, sur un document validé par nos contrôles, sont aussi une alerte plateforme. */
export const ALERT_CATEGORIES: ReadonlySet<NormalizationErrorCategory> = new Set([
  'data',
  'configuration',
  'totals_mismatch',
  'unknown',
]);

/** Notre phrase, par catégorie (jamais une copie du libellé DGI). */
export const CATEGORY_MESSAGES: Readonly<Record<NormalizationErrorCategory, string>> = {
  data: 'La DGI a refusé cette facture : son contenu ne respecte pas une règle de la DGI. Reprenez-la en brouillon pour la corriger.',
  configuration:
    'La DGI a refusé cette facture à cause d’un paramètre de la plateforme Lalanda. L’équipe Lalanda est prévenue.',
  capacity:
    'L’e-MCF est saturé, sans doute par un autre logiciel de caisse : réessayez dans deux minutes.',
  temporary:
    'Un contrôle de la DGI est momentanément indisponible : réessayez dans quelques minutes.',
  server: 'Le serveur de la DGI a rencontré une erreur : Lalanda vérifie l’état de la facture.',
  state: 'La DGI ne reconnaît pas cette demande dans l’état attendu : Lalanda vérifie.',
  totals_mismatch:
    'Écart de calcul entre Lalanda et la DGI : la facture a été annulée auprès de la DGI. L’équipe Lalanda est prévenue.',
  duplicate_pending:
    'Une demande portant ce numéro est déjà en attente à la DGI : Lalanda la vérifie et l’annule.',
  unknown:
    'La DGI a refusé cette facture pour une raison que Lalanda ne connaît pas encore. L’équipe Lalanda est prévenue.',
  network:
    'La DGI n’a pas répondu : Lalanda vérifie auprès d’elle. Ne refaites pas cette vente en attendant.',
  token_rejected:
    'La DGI a refusé le jeton du point de vente : renouvelez-le, puis relancez la normalisation.',
  precondition: 'La normalisation n’a pas pu partir : un prérequis manque.',
};
