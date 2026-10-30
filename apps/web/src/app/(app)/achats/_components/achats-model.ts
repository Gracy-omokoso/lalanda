// Achats et fournisseurs — règles communes aux écrans (ADR-0044 § 8). Logique pure.
//
// Les droits viennent des ACTIONS servies par `GET /me/permissions` (coquille,
// `useShell().actions`), jamais d'un nom de rôle. Masquer ou désactiver est un
// confort : `PermissionsGuard` refuse côté API de toute façon. Aucun montant
// n'est calculé ici : l'écran affiche les chaînes rendues par l'API (moteur).

import type { PurchaseOrderStatus } from '@lalanda/shared/purchases';

import type { OrgAction } from '@/lib/api';

export const ACHATS_BASE = '/achats';

type Actions = readonly OrgAction[] | null;

const a = (actions: Actions, action: OrgAction): boolean =>
  actions !== null && actions.includes(action);

export const peutLireAchats = (x: Actions): boolean => a(x, 'purchase.read');
export const peutDemanderAchat = (x: Actions): boolean => a(x, 'purchase.request');
export const peutGererAchats = (x: Actions): boolean => a(x, 'purchase.manage');
export const peutApprouverAchats = (x: Actions): boolean => a(x, 'purchase.approve');
export const peutPayerFournisseurs = (x: Actions): boolean => a(x, 'payables.pay');

// ── Liens ───────────────────────────────────────────────────────────────────

export const lienCommande = (id: string): string =>
  `${ACHATS_BASE}/commandes/${encodeURIComponent(id)}`;
export const lienFournisseur = (id: string): string =>
  `${ACHATS_BASE}/fournisseurs/${encodeURIComponent(id)}`;

// ── Erreurs ─────────────────────────────────────────────────────────────────

/** Phrase d'une route d'API qui n'existe pas encore (lot non fusionné) : 404. */
export const PHRASE_PAS_ENCORE =
  'Cette partie des achats n’est pas encore disponible sur ce serveur. Elle arrive avec une prochaine livraison : rien n’est affiché plutôt que des données inventées.';

const MESSAGES: Record<string, string> = {
  STALE_REVISION:
    'Le document a été modifié entre-temps par quelqu’un d’autre. Rechargez la page avant de recommencer.',
  SUPPLIER_NIF_EXISTS: 'Un fournisseur porte déjà ce NIF.',
  SUPPLIER_IN_USE: 'Ce fournisseur a déjà des commandes, factures ou paiements.',
  SUPPLIER_HAS_OPEN_PAYABLES: 'Ce fournisseur a encore des factures validées à payer.',
  SECRETS_NOT_CONFIGURED:
    'Le coffre des coordonnées de paiement n’est pas configuré sur ce serveur.',
  SELF_APPROVAL_FORBIDDEN:
    'Vous avez demandé cet achat : un autre approbateur doit le valider (séparation des tâches).',
  APPROVER_ALREADY_APPROVED:
    'Vous avez déjà approuvé cette demande : la seconde approbation doit venir d’une autre personne.',
  PURCHASE_ORDER_INVOICED:
    'Une facture validée vise cette commande : elle ne peut plus être annulée.',
  DOCUMENT_NOT_SENDABLE: 'Seule une commande approuvée ou envoyée peut partir au fournisseur.',
  PURCHASE_WORK_PROJECT_UNKNOWN: 'Le projet indiqué est introuvable.',
  DOCUMENT_EMAIL_RATE_LIMITED: 'Trop d’envois en peu de temps : réessayez plus tard.',
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

/** Message d'une erreur d'API des achats, en français clair. */
export function messageAchats(err: unknown, repli: string): string {
  if (typeof err !== 'object' || err === null) return repli;
  const status = statutDe(err);
  const code = codeDe(err);
  if (code !== null && MESSAGES[code]) return MESSAGES[code]!;
  if (status === 403) return 'Votre rôle ne permet pas cette action sur les achats.';
  if (status === 404) return PHRASE_PAS_ENCORE;
  if (status === 429) return 'Trop de demandes en peu de temps : réessayez plus tard.';
  const detail = (err as ErreurApi).detail;
  if (typeof detail === 'object' && detail !== null) {
    const m = (detail as { message?: unknown }).message;
    if (typeof m === 'string' && m !== '') return m;
  }
  return repli;
}

/** Identifiant existant porté par un refus (`409 SUPPLIER_NIF_EXISTS`), ou `null`. */
export function identifiantExistant(err: unknown): string | null {
  const detail = (err as ErreurApi | null)?.detail as
    { details?: { existingId?: unknown }; existingId?: unknown } | undefined;
  const v = detail?.details?.existingId ?? detail?.existingId;
  return typeof v === 'string' && v !== '' ? v : null;
}

// ── Statuts ─────────────────────────────────────────────────────────────────

export const LIBELLES_STATUT: Record<PurchaseOrderStatus, string> = {
  draft: 'Brouillon',
  submitted: 'À approuver',
  approved: 'Approuvée',
  rejected: 'Refusée',
  sent: 'Envoyée',
  partially_received: 'Reçue en partie',
  received: 'Reçue',
  closed: 'Clôturée',
  cancelled: 'Annulée',
};

export type TonStatut = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function tonStatut(s: PurchaseOrderStatus): TonStatut {
  switch (s) {
    case 'submitted':
      return 'warning';
    case 'approved':
    case 'sent':
    case 'partially_received':
      return 'info';
    case 'received':
    case 'closed':
      return 'success';
    case 'rejected':
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

// ── Dates et personnes ──────────────────────────────────────────────────────

const MOIS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

/** Date civile `AAAA-MM-JJ` → « 2 mars 2026 » (aucun fuseau : c'est un jour). */
export function formatJour(jour: string | null): string {
  if (jour === null) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jour);
  if (m === null) return jour;
  return `${Number(m[3])} ${MOIS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Instant ISO → date à Kinshasa (« 30 oct. 2026 »). */
export function formatInstantJour(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Kinshasa',
  });
}

export interface Membre {
  userId: string;
  name: string;
}

/** Nom d'un membre ; « vous » pour soi ; « un membre » si la liste n'est pas lisible. */
export function nomPersonne(
  membres: readonly Membre[],
  userId: string,
  moi: string | null,
): string {
  if (moi !== null && userId === moi) return 'vous';
  return membres.find((m) => m.userId === userId)?.name ?? 'un membre';
}
