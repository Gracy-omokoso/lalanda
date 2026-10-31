// Bons de stock — ADR-0046 § 2.4 et § 5.1 : sortie, entrée (retour au magasin),
// transfert, retour fournisseur (`stock.move`) et ajustement avec motif
// (`stock.manage`). Logique pure : types proposés, formulaire, gestes.
//
// Un bon naît BROUILLON puis est PASSÉ (mouvements écrits par l'API, transaction
// unique) ; l'annuler ajoute des contre-mouvements, avec motif. Le disponible et
// le refus `409 STOCK_INSUFFICIENT` sont jugés par l'API (moteur), jamais ici.

import { STOCK_LIMITS } from '@lalanda/shared/stock';

import type { OrgAction } from '@/lib/api';
import type {
  ListStockVouchersParams,
  StockVoucherInput,
  StockVoucherKind,
  StockVoucherStatus,
  StockVoucherView,
} from '@/lib/api-stock';

import { LIBELLES_BON, lireQuantiteSaisie, peutGererStocks, peutMouvementer } from './stocks-model';

type Actions = readonly OrgAction[] | null;

// ── Types proposés ──────────────────────────────────────────────────────────

export const ORDRE_BONS: readonly StockVoucherKind[] = [
  'issue',
  'issue_return',
  'transfer',
  'adjustment',
  'supplier_return',
];

export const RAISON_AJUSTEMENT =
  'Un ajustement change la valeur du stock : il est réservé aux gestionnaires des stocks.';
export const RAISON_SANS_MOUVEMENT = 'Réservé aux rôles qui mouvementent le stock.';

/** Droit exigé pour créer, passer ou annuler un bon de ce type (§ 5.1). */
export function droitBon(kind: StockVoucherKind): OrgAction {
  return kind === 'adjustment' ? 'stock.manage' : 'stock.move';
}

export function peutTraiterBon(kind: StockVoucherKind, actions: Actions): boolean {
  return kind === 'adjustment' ? peutGererStocks(actions) : peutMouvementer(actions);
}

export interface TypeBon {
  kind: StockVoucherKind;
  libelle: string;
  actif: boolean;
  raison: string | null;
}

/**
 * Types de bon proposés au bouton « Nouveau bon ». Un rôle sans `stock.move` n'en
 * voit aucun ; l'ajustement reste VISIBLE mais désactivé, avec sa raison, pour
 * qui mouvemente sans gérer (le Magasinier).
 */
export function typesBon(actions: Actions): TypeBon[] {
  if (!peutMouvementer(actions) && !peutGererStocks(actions)) return [];
  return ORDRE_BONS.map((kind) => {
    const ok = peutTraiterBon(kind, actions);
    return {
      kind,
      libelle: LIBELLES_BON[kind],
      actif: ok,
      raison: ok ? null : kind === 'adjustment' ? RAISON_AJUSTEMENT : RAISON_SANS_MOUVEMENT,
    };
  });
}

/** Emplacements qu'un type de bon exige : départ, arrivée. */
export function emplacementsDuBon(kind: StockVoucherKind): { depart: boolean; arrivee: boolean } {
  switch (kind) {
    case 'transfer':
      return { depart: true, arrivee: true };
    case 'issue_return':
      return { depart: false, arrivee: true };
    default:
      return { depart: true, arrivee: false };
  }
}

// ── Liste ───────────────────────────────────────────────────────────────────

export type FiltreBons = 'tous' | StockVoucherStatus;

export const FILTRES_BONS: readonly { valeur: FiltreBons; label: string }[] = [
  { valeur: 'tous', label: 'Tous' },
  { valeur: 'draft', label: 'Brouillons' },
  { valeur: 'posted', label: 'Passés' },
  { valeur: 'cancelled', label: 'Annulés' },
];

export function requeteBons(f: FiltreBons, cursor: string | null = null): ListStockVouchersParams {
  return { limit: 50, ...(f === 'tous' ? {} : { status: f }), ...(cursor ? { cursor } : {}) };
}

// ── Formulaire ──────────────────────────────────────────────────────────────

export interface LigneBon {
  itemId: string;
  /** Pour l'affichage seulement : seul l'identifiant part à l'API. */
  itemName: string;
  unit: string;
  quantity: string;
  /** Ajustement : entrée (+) ou sortie (−). */
  sens: 'in' | 'out';
  note: string;
}

export interface FormulaireBon {
  kind: StockVoucherKind;
  fromLocationId: string;
  toLocationId: string;
  postedOn: string;
  workProjectId: string;
  recipient: string;
  reason: string;
  reasonNote: string;
  lignes: LigneBon[];
}

export const ligneBonVide = (): LigneBon => ({
  itemId: '',
  itemName: '',
  unit: '',
  quantity: '1',
  sens: 'out',
  note: '',
});

export function formulaireBon(
  kind: StockVoucherKind,
  aujourdhui: string,
  emplacementParDefaut = '',
): FormulaireBon {
  const e = emplacementsDuBon(kind);
  return {
    kind,
    fromLocationId: e.depart ? emplacementParDefaut : '',
    toLocationId: !e.depart && e.arrivee ? emplacementParDefaut : '',
    postedOn: aujourdhui,
    workProjectId: '',
    recipient: '',
    reason: '',
    reasonNote: '',
    lignes: [ligneBonVide()],
  };
}

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const ouNul = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * Vérification locale et corps de `POST /stock/vouchers`. Clés d'erreur :
 * `from`, `to`, `postedOn`, `reason`, `lignes`, `ligne-<i>-item|quantity`.
 * La date « jamais future » se compare au jour de Kinshasa (`aujourdhui`).
 */
export function preparerBon(
  f: FormulaireBon,
  aujourdhui: string,
): { ok: true; corps: StockVoucherInput } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  const e = emplacementsDuBon(f.kind);
  if (e.depart && f.fromLocationId === '') champs['from'] = 'Choisissez l’emplacement de départ.';
  if (e.arrivee && f.toLocationId === '') champs['to'] = 'Choisissez l’emplacement d’arrivée.';
  if (f.kind === 'transfer' && f.fromLocationId !== '' && f.fromLocationId === f.toLocationId) {
    champs['to'] = 'Un transfert va vers un AUTRE emplacement.';
  }
  if (!JOUR.test(f.postedOn)) champs['postedOn'] = 'Date invalide.';
  else if (f.postedOn > aujourdhui) champs['postedOn'] = 'La date ne peut pas être dans le futur.';
  if (f.kind === 'adjustment' && f.reason === '') {
    champs['reason'] = 'Le motif de l’ajustement est obligatoire.';
  }
  if (f.reasonNote.length > STOCK_LIMITS.reason) champs['reasonNote'] = '500 caractères au plus.';
  if (f.recipient.length > STOCK_LIMITS.lineNote) champs['recipient'] = '500 caractères au plus.';
  if (f.lignes.length === 0) champs['lignes'] = 'Ajoutez au moins une ligne.';
  if (f.lignes.length > STOCK_LIMITS.voucherLines) champs['lignes'] = '100 lignes au plus.';

  const lignes: StockVoucherInput['lines'] = [];
  f.lignes.forEach((l, i) => {
    if (l.itemId === '') champs[`ligne-${i}-item`] = 'Choisissez un article.';
    const q = lireQuantiteSaisie(l.quantity);
    if (!q.ok) champs[`ligne-${i}-quantity`] = q.erreur;
    if (l.note.length > STOCK_LIMITS.lineNote)
      champs[`ligne-${i}-note`] = '500 caractères au plus.';
    if (l.itemId !== '' && q.ok) {
      // Ajustement : quantité positive et SENS de la ligne (`in`, `out`), comme l'API.
      lignes.push({
        itemId: l.itemId,
        quantity: q.valeur,
        ...(f.kind === 'adjustment' ? { direction: l.sens } : {}),
        note: ouNul(l.note),
      });
    }
  });

  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      kind: f.kind,
      fromLocationId: e.depart ? f.fromLocationId : null,
      toLocationId: e.arrivee ? f.toLocationId : null,
      lines: lignes,
      workProjectId: f.kind === 'issue' ? ouNul(f.workProjectId) : null,
      recipient: f.kind === 'issue' ? ouNul(f.recipient) : null,
      reason: f.kind === 'adjustment' ? { key: f.reason, note: ouNul(f.reasonNote) } : null,
      postedOn: f.postedOn,
    },
  };
}

// ── Gestes d'un bon ─────────────────────────────────────────────────────────

export interface GesteBon {
  id: 'passer' | 'annuler';
  libelle: string;
  actif: boolean;
  raison: string | null;
}

/** Brouillon : « Passer le bon » ; passé : « Annuler » (motif). Droit du type de bon. */
export function gestesBon(b: StockVoucherView, actions: Actions): GesteBon[] {
  if (b.status === 'cancelled') return [];
  const ok = peutTraiterBon(b.kind, actions);
  const raison = ok ? null : b.kind === 'adjustment' ? RAISON_AJUSTEMENT : RAISON_SANS_MOUVEMENT;
  if (b.status === 'draft') {
    return [{ id: 'passer', libelle: 'Passer le bon', actif: ok, raison }];
  }
  return [{ id: 'annuler', libelle: 'Annuler le bon', actif: ok, raison }];
}

/** Trajet lisible d'un bon : « Magasin → Chantier », « depuis Magasin ». */
export function trajetBon(b: StockVoucherView, nom: (id: string) => string): string {
  const depart = b.fromLocationId ? nom(b.fromLocationId) : null;
  const arrivee = b.toLocationId ? nom(b.toLocationId) : null;
  if (depart && arrivee) return `${depart} → ${arrivee}`;
  if (arrivee) return `vers ${arrivee}`;
  if (depart) return `depuis ${depart}`;
  return '';
}

/** Quantité signée d'une ligne d'ajustement, lue sur son SENS (aucun calcul). */
export function quantiteLigneBon(l: { quantity: string; direction: 'in' | 'out' | null }): string {
  return l.direction === 'out' ? `-${l.quantity}` : l.quantity;
}

/** Motif d'un bon : libellé du motif des réglages (sinon sa clé), et sa note. */
export function motifBon(
  b: Pick<StockVoucherView, 'reason'>,
  motifs: readonly { key: string; label: string }[] = [],
): string | null {
  if (!b.reason) return null;
  const libelle = motifs.find((m) => m.key === b.reason!.key)?.label ?? b.reason.key;
  return b.reason.note ? `${libelle} (${b.reason.note})` : libelle;
}
