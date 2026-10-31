// Stocks — règles communes aux écrans (ADR-0046 § 5.1, § 8, lot S8). Logique pure.
//
// Les droits viennent des ACTIONS servies par `GET /me/permissions` (coquille,
// `useShell().actions`), jamais d'un nom de rôle. Masquer ou désactiver est un
// confort : `PermissionsGuard` refuse côté API de toute façon.
//
// AUCUN calcul : quantités, coûts moyens, valeurs et écarts sont ceux de l'API
// (moteur). Ce module ne fait que METTRE EN FORME des chaînes décimales (groupes
// de milliers, virgule) et lire leur SIGNE pour choisir un ton d'affichage.
//
// VALEURS (§ 5) : elles ne s'affichent qu'avec `purchase.read` OU `treasury.read`
// (en plus de `stock.read`), et seulement si la réponse ne les masque pas
// (`valuesHidden`). Le Magasinier ne voit aucune valeur.

import type { OrgAction } from '@/lib/api';
import type {
  StockCountStatus,
  StockItemKind,
  StockLocationKind,
  StockMovementKind,
  StockPendingReason,
  StockVoucherKind,
  StockVoucherStatus,
} from '@/lib/api-stock';

export {
  formatInstantJour,
  formatJour,
  nomPersonne,
  type Membre,
} from '../../achats/_components/achats-model';

export const STOCKS_BASE = '/stocks';

type Actions = readonly OrgAction[] | null;

const a = (actions: Actions, action: OrgAction): boolean =>
  actions !== null && actions.includes(action);

export const peutLireStocks = (x: Actions): boolean => a(x, 'stock.read');
export const peutMouvementer = (x: Actions): boolean => a(x, 'stock.move');
export const peutCompter = (x: Actions): boolean => a(x, 'stock.count');
export const peutGererStocks = (x: Actions): boolean => a(x, 'stock.manage');
export const peutDemanderAchat = (x: Actions): boolean => a(x, 'purchase.request');

/**
 * Les valeurs (coûts, valeur du stock, écarts valorisés) sont-elles permises à ce
 * rôle ? `stock.read` ET (`purchase.read` OU `treasury.read`) — ADR-0046 § 5.
 */
export function peutVoirValeurs(x: Actions): boolean {
  return peutLireStocks(x) && (a(x, 'purchase.read') || a(x, 'treasury.read'));
}

/**
 * Afficher les valeurs d'une réponse : le rôle les permet ET l'API ne les a pas
 * masquées. Les deux conditions : un écran ne montre jamais une valeur que l'API
 * aurait servie par erreur à un rôle qui ne doit pas la voir.
 */
export function valeursAffichees(x: Actions, valuesHidden: boolean | undefined): boolean {
  return peutVoirValeurs(x) && valuesHidden !== true;
}

// ── Liens ───────────────────────────────────────────────────────────────────

export const lienArticle = (id: string): string =>
  `${STOCKS_BASE}/articles/${encodeURIComponent(id)}`;
export const lienInventaire = (id: string): string =>
  `${STOCKS_BASE}/inventaires/${encodeURIComponent(id)}`;
export const lienMouvementsArticle = (id: string): string =>
  `${STOCKS_BASE}/mouvements?article=${encodeURIComponent(id)}`;

// ── Lectures ────────────────────────────────────────────────────────────────

export type Lecture<T> = { ok: true; valeur: T } | { ok: false; erreur: unknown };

/** Transforme une promesse en lecture, sans jamais rejeter. */
export function lire<T>(p: Promise<T>): Promise<Lecture<T>> {
  return p.then(
    (valeur) => ({ ok: true as const, valeur }),
    (erreur: unknown) => ({ ok: false as const, erreur }),
  );
}

// ── Erreurs ─────────────────────────────────────────────────────────────────

/** Phrase d'une route d'API qui n'existe pas encore (lot non fusionné) : 404. */
export const PHRASE_PAS_ENCORE =
  'Cette partie des stocks n’est pas encore disponible sur ce serveur. Elle arrive avec une prochaine livraison : rien n’est affiché plutôt que des données inventées.';

const MESSAGES: Record<string, string> = {
  STALE_REVISION:
    'Cette fiche a été modifiée entre-temps par quelqu’un d’autre. Rechargez la page avant de recommencer.',
  STOCK_ITEM_CODE_EXISTS: 'Un article porte déjà ce code.',
  CATALOG_ITEM_ALREADY_STOCKED: 'Cet article du catalogue est déjà lié à un autre article stocké.',
  CATALOG_ITEM_NOT_STOCKABLE:
    'Seul un bien du catalogue peut être stocké : un service ou une taxe n’a pas de stock.',
  STOCK_ITEM_NOT_EMPTY:
    'Il reste du stock de cet article : sortez-le ou ajustez-le avant de l’archiver.',
  STOCK_ITEM_UNIT_LOCKED: 'L’unité ne change plus après le premier mouvement.',
  STOCK_ITEM_CURRENCY_LOCKED:
    'La devise de coût ne change plus après la première entrée valorisée.',
  STOCK_LOCATION_NAME_EXISTS: 'Un emplacement porte déjà ce nom.',
  STOCK_LOCATION_NOT_EMPTY:
    'Il reste du stock à cet emplacement : transférez-le avant de l’archiver.',
  STOCK_INSUFFICIENT:
    'Stock insuffisant : la quantité demandée dépasse ce qui est disponible à cet emplacement.',
  STOCK_TRANSFER_SAME_LOCATION: 'Un transfert part d’un emplacement vers un AUTRE emplacement.',
  COUNT_SELF_VALIDATION:
    'Vous avez compté une ligne de cet inventaire : un autre gestionnaire des stocks doit le valider (séparation des tâches).',
  QUANTITY_ZERO: 'La quantité ne peut pas être nulle.',
  INVALID_QUANTITY: 'Quantité invalide : trois décimales au plus.',
  INVALID_UNIT_COST: 'Coût invalide : six décimales au plus.',
  INVALID_DATE: 'Date invalide.',
};

interface ErreurApi {
  status?: unknown;
  detail?: unknown;
}

function codeDe(err: unknown): string | null {
  const detail = (err as ErreurApi | null)?.detail;
  if (typeof detail !== 'object' || detail === null) return null;
  const code = (detail as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function statutDe(err: unknown): number | null {
  const s = (err as ErreurApi | null)?.status;
  return typeof s === 'number' ? s : null;
}

/** Message d'une erreur d'API des stocks, en français clair. */
export function messageStocks(err: unknown, repli: string): string {
  if (typeof err !== 'object' || err === null) return repli;
  const status = statutDe(err);
  const code = codeDe(err);
  if (code !== null && MESSAGES[code]) return MESSAGES[code]!;
  if (status === 403) return 'Votre rôle ne permet pas cette action sur les stocks.';
  if (status === 404) return PHRASE_PAS_ENCORE;
  if (status === 429) return 'Trop de demandes en peu de temps : réessayez plus tard.';
  const detail = (err as ErreurApi).detail;
  if (typeof detail === 'object' && detail !== null) {
    const m = (detail as { message?: unknown }).message;
    if (typeof m === 'string' && m !== '') return m;
  }
  return repli;
}

/** Phrase d'une tuile illisible : jamais un zéro inventé. */
export function phraseIndisponible(erreur: unknown): string {
  const s = statutDe(erreur);
  if (s === 404) return 'Pas encore disponible';
  if (s === 403) return 'Réservé à d’autres rôles';
  return 'Lecture impossible pour le moment';
}

// ── Mise en forme des décimaux (aucun calcul) ───────────────────────────────

const INSECABLE = ' ';
const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

function grouper(entier: string): string {
  return entier.replace(/\B(?=(\d{3})+(?!\d))/g, INSECABLE);
}

/**
 * Quantité de l'API (`"1234.500"`) → « 1 234,5 », suivie de l'unité si donnée.
 * Les zéros de fin de la partie décimale sont retirés ; une chaîne qui n'est
 * pas un décimal est rendue telle quelle.
 */
export function formatQuantite(q: string | null | undefined, unite?: string | null): string {
  if (q === null || q === undefined) return '—';
  const m = DECIMAL.exec(q.trim());
  const suffixe = unite ? `${INSECABLE}${unite}` : '';
  if (m === null) return `${q}${suffixe}`;
  const fraction = (m[3] ?? '').replace(/0+$/, '');
  const entier = grouper(m[2]!.replace(/^0+(?=\d)/, ''));
  const nul = /^0*$/.test(m[2]!) && fraction === '';
  const signe = m[1] === '-' && !nul ? '−' : '';
  return `${signe}${entier}${fraction ? `,${fraction}` : ''}${suffixe}`;
}

/** Quantité signée d'un mouvement : « +72 », « −5 ». */
export function formatQuantiteSignee(q: string, unite?: string | null): string {
  const texte = formatQuantite(q, unite);
  return estNegatif(q) || estNul(q) ? texte : `+${texte}`;
}

/** Montant de l'API (deux décimales, signé ou non) → « −1 234,50 USD ». */
export function formatValeur(v: string | null | undefined, devise: string): string {
  if (v === null || v === undefined) return '—';
  const m = DECIMAL.exec(v.trim());
  if (m === null) return `${v}${INSECABLE}${devise}`;
  const fraction = (m[3] ?? '').padEnd(2, '0');
  const nul = /^0*$/.test(m[2]!) && /^0*$/.test(fraction);
  const signe = m[1] === '-' && !nul ? '−' : '';
  return `${signe}${grouper(m[2]!.replace(/^0+(?=\d)/, ''))},${fraction}${INSECABLE}${devise}`;
}

/** Coût unitaire (six décimales au plus) → « 1,25 USD » (zéros de fin retirés, deux gardés). */
export function formatCoutUnitaire(c: string | null | undefined, devise: string): string {
  if (c === null || c === undefined) return '—';
  const m = DECIMAL.exec(c.trim());
  if (m === null) return `${c}${INSECABLE}${devise}`;
  const fraction = (m[3] ?? '').replace(/0+$/, '').padEnd(2, '0');
  return `${grouper(m[2]!.replace(/^0+(?=\d)/, ''))},${fraction}${INSECABLE}${devise}`;
}

/** Le décimal est-il strictement négatif ? (lecture du signe, aucun calcul) */
export function estNegatif(q: string): boolean {
  const m = DECIMAL.exec(q.trim());
  return m !== null && m[1] === '-' && !/^0*$/.test(`${m[2]}${m[3] ?? ''}`);
}

/** Le décimal vaut-il zéro ? */
export function estNul(q: string): boolean {
  const m = DECIMAL.exec(q.trim());
  return m !== null && /^0*$/.test(`${m[2]}${m[3] ?? ''}`);
}

/** Rupture : quantité nulle ou négative à l'emplacement (fait du brief `stock.ruptures`). */
export function estEnRupture(q: string): boolean {
  return estNul(q) || estNegatif(q);
}

// ── Saisie (forme du contrat, aucun calcul) ─────────────────────────────────

const sansEspaces = (s: string): string => s.replace(/[\s  ]/g, '').replace(',', '.');

export type LectureSaisie = { ok: true; valeur: string } | { ok: false; erreur: string };

/**
 * Quantité saisie (« 2,5 ») → chaîne du contrat (« 2.5 »), trois décimales au
 * plus. `zero` : zéro permis (quantité comptée, seuil).
 */
export function lireQuantiteSaisie(saisie: string, zero = false): LectureSaisie {
  const s = sansEspaces(saisie);
  if (s === '') return { ok: false, erreur: 'Saisissez une quantité.' };
  const m = /^(\d{1,12})(?:\.(\d{1,3}))?$/.exec(s);
  if (m === null) return { ok: false, erreur: 'Quantité invalide : trois décimales au plus.' };
  if (!zero && /^0*$/.test(`${m[1]}${m[2] ?? ''}`)) {
    return { ok: false, erreur: 'La quantité doit être supérieure à zéro.' };
  }
  return { ok: true, valeur: s };
}

/** Coût unitaire saisi → chaîne du contrat, six décimales au plus, zéro permis. */
export function lireCoutSaisi(saisie: string): LectureSaisie {
  const s = sansEspaces(saisie);
  if (s === '') return { ok: false, erreur: 'Saisissez un coût.' };
  if (!/^\d{1,13}(\.\d{1,6})?$/.test(s)) {
    return { ok: false, erreur: 'Coût invalide : six décimales au plus, par exemple 1,25.' };
  }
  return { ok: true, valeur: s };
}

/** Quantité de l'API (`"16.000"`) → texte à éditer (`"16"`). */
export function quantitePourSaisie(q: string | null): string {
  if (q === null) return '';
  return formatQuantite(q).replace(new RegExp(INSECABLE, 'g'), '').replace('−', '-');
}

/** Jour civil à Kinshasa (`AAAA-MM-JJ`) de l'instant donné : valeur par défaut d'une date. */
export function jourKinshasa(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kinshasa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

// ── Libellés ────────────────────────────────────────────────────────────────

export type Ton = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const LIBELLES_NATURE_ARTICLE: Record<StockItemKind, string> = {
  goods: 'Marchandise',
  consumable: 'Consommable',
  material: 'Matière ou pièce',
};

export const LIBELLES_TYPE_EMPLACEMENT: Record<StockLocationKind, string> = {
  warehouse: 'Entrepôt',
  shop: 'Magasin',
  vehicle: 'Véhicule',
  site: 'Chantier',
  other: 'Autre',
};

export const LIBELLES_MOUVEMENT: Record<StockMovementKind, string> = {
  opening: 'Stock initial',
  purchase_receipt: 'Réception d’achat',
  purchase_receipt_reversal: 'Annulation de réception',
  sale_issue: 'Sortie de vente',
  sale_return: 'Retour de vente',
  issue: 'Bon de sortie',
  issue_return: 'Retour au magasin',
  transfer_out: 'Transfert (départ)',
  transfer_in: 'Transfert (arrivée)',
  adjustment: 'Ajustement',
  count_adjustment: 'Écart d’inventaire',
  supplier_return: 'Retour fournisseur',
};

export const LIBELLES_BON: Record<StockVoucherKind, string> = {
  issue: 'Bon de sortie',
  issue_return: 'Bon d’entrée (retour au magasin)',
  transfer: 'Bon de transfert',
  adjustment: 'Ajustement',
  supplier_return: 'Retour fournisseur',
};

export const LIBELLES_STATUT_BON: Record<StockVoucherStatus, string> = {
  draft: 'Brouillon',
  posted: 'Passé',
  cancelled: 'Annulé',
};

export function tonStatutBon(s: StockVoucherStatus): Ton {
  return s === 'posted' ? 'success' : s === 'cancelled' ? 'danger' : 'neutral';
}

export const LIBELLES_STATUT_INVENTAIRE: Record<StockCountStatus, string> = {
  draft: 'En préparation',
  counting: 'Comptage ouvert',
  submitted: 'À valider',
  validated: 'Validé',
  cancelled: 'Annulé',
};

export function tonStatutInventaire(s: StockCountStatus): Ton {
  switch (s) {
    case 'counting':
      return 'info';
    case 'submitted':
      return 'warning';
    case 'validated':
      return 'success';
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const LIBELLES_A_TRAITER: Record<StockPendingReason, string> = {
  unknown_item: 'Article non reconnu',
  unknown_unit: 'Unité inconnue',
  pending_cost: 'Coût à saisir',
  sale_return_proposed: 'Retour de vente à confirmer',
  cost_differs: 'Coût différent de la facture',
};

export const LIBELLES_CONSTAT: Record<string, string> = {
  NEGATIVE_STOCK: 'Stock négatif',
  BELOW_REORDER: 'Sous le seuil',
  UNVALUED_ENTRIES: 'Entrées sans coût : valeur incomplète',
  ENTRY_COST_DIFFERS_FROM_INVOICE: 'Coût d’entrée différent de la facture fournisseur',
  DORMANT_ITEM: 'Article dormant (aucun mouvement depuis longtemps)',
  STOCK_LEVEL_DRIFT: 'Écart entre le cache et le grand livre',
};

/** Libellé d'un constat ; un code inconnu reste lisible tel quel. */
export function libelleConstat(code: string): string {
  return LIBELLES_CONSTAT[code] ?? code;
}

/** Les constats qui portent sur une VALEUR sont retirés quand les valeurs sont masquées. */
const CONSTATS_DE_VALEUR = new Set(['UNVALUED_ENTRIES', 'ENTRY_COST_DIFFERS_FROM_INVOICE']);

export function constatsVisibles<T extends { code: string }>(
  constats: readonly T[] | undefined,
  valeurs: boolean,
): T[] {
  return (constats ?? []).filter((c) => valeurs || !CONSTATS_DE_VALEUR.has(c.code));
}
