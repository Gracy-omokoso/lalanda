// Réceptions — ADR-0044 § 2.4, § 3.4 et § 8 (lot P8). Logique pure.
//
// Une réception constate une livraison (ou un « service fait ») sur une commande,
// totale ou partielle. Aucune quantité n'est additionnée ici : le reste à recevoir
// et le statut de la commande sont rendus par l'API (moteur `orderReceptionStatus`)
// après chaque écriture. Recevoir plus que commandé n'est pas un refus : c'est un
// écart que l'API signale (`RECEIVED_OVER_ORDERED`).

import type { PurchaseOrderStatus, PurchaseReceptionStatus } from '@lalanda/shared/purchases';

import type { OrgAction } from '@/lib/api';
import type {
  ListReceptionsParams,
  PurchaseOrderDetailView,
  PurchaseReceptionView,
  PurchaseReceptionWriteResult,
  ReceptionInput,
} from '@/lib/api-purchases-payables';

import { peutGererAchats } from './achats-model';
import { lireQuantite } from './commandes-model';

type Actions = readonly OrgAction[] | null;

/** Statuts d'une commande qui acceptent une réception (§ 2.4). */
const RECEVABLES: ReadonlySet<PurchaseOrderStatus> = new Set([
  'approved',
  'sent',
  'partially_received',
]);

export const LIBELLES_STATUT_RECEPTION: Record<PurchaseReceptionStatus, string> = {
  recorded: 'Enregistrée',
  cancelled: 'Annulée',
};

/** « 2,5 » : une quantité de l'API, virgule décimale, sans calcul. */
export function formatQuantite(q: string): string {
  return q.replace('.', ',');
}

/**
 * Peut-on enregistrer une réception sur cette commande ? `purchase.manage`, une
 * commande approuvée ou envoyée, et au moins une ligne à réceptionner ou de service.
 */
export function peutRecevoir(
  o: Pick<PurchaseOrderDetailView, 'phase' | 'status' | 'lines'>,
  actions: Actions,
): boolean {
  return (
    peutGererAchats(actions) &&
    o.phase === 'order' &&
    RECEVABLES.has(o.status) &&
    o.lines.length > 0
  );
}

/** Avertissement d'une commande approuvée mais pas encore envoyée (livraison sur appel). */
export function avertissementNonEnvoyee(o: Pick<PurchaseOrderDetailView, 'status'>): string | null {
  return o.status === 'approved'
    ? 'Cette commande n’a pas encore été envoyée au fournisseur : vous enregistrez une livraison sur appel.'
    : null;
}

// ── Formulaire ──────────────────────────────────────────────────────────────

export interface LigneReception {
  orderLineId: string;
  label: string;
  unit: string | null;
  /** Quantité commandée, telle que rendue par l'API (affichage seulement). */
  commande: string;
  service: boolean;
  /** Quantités des réceptions déjà enregistrées, une par réception (jamais sommées). */
  dejaRecu: { receivedOn: string; quantity: string }[];
  saisie: string;
}

export interface FormulaireReception {
  receivedOn: string;
  deliveryNoteRef: string;
  note: string;
  lignes: LigneReception[];
}

/**
 * Lignes proposées : celles « à réceptionner » et les services (« service fait »).
 * Les quantités déjà reçues sont listées réception par réception, sans total.
 */
export function formulaireReception(
  o: Pick<PurchaseOrderDetailView, 'lines' | 'receptions'>,
  aujourdhui: string,
): FormulaireReception {
  const enregistrees = o.receptions.filter((r) => r.status === 'recorded');
  return {
    receivedOn: aujourdhui,
    deliveryNoteRef: '',
    note: '',
    lignes: o.lines.map((l) => ({
      orderLineId: l.id,
      label: l.label,
      unit: l.unit,
      commande: l.quantity,
      service: !l.receivable,
      dejaRecu: enregistrees.flatMap((r) =>
        r.lines
          .filter((x) => x.orderLineId === l.id)
          .map((x) => ({ receivedOn: r.receivedOn, quantity: x.quantity })),
      ),
      saisie: '',
    })),
  };
}

/** Une réception a-t-elle déjà été enregistrée sur la commande ? */
export function aDejaDesReceptions(f: FormulaireReception): boolean {
  return f.lignes.some((l) => l.dejaRecu.length > 0);
}

/**
 * « Tout est arrivé » : recopie la quantité COMMANDÉE de chaque ligne (aucune
 * soustraction). Après une réception partielle, l'écran le déconseille : l'API
 * signalerait alors un excédent.
 */
export function toutRecu(f: FormulaireReception): FormulaireReception {
  return { ...f, lignes: f.lignes.map((l) => ({ ...l, saisie: formatQuantite(l.commande) })) };
}

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Vérification locale et corps de `POST /purchases/receptions`. Une ligne vide
 * n'est pas reçue cette fois ; il en faut au moins une. Clés d'erreur :
 * `receivedOn`, `lignes`, `ligne-<i>`, `deliveryNoteRef`, `note`.
 */
export function preparerReception(
  orderId: string,
  f: FormulaireReception,
  aujourdhui: string,
): { ok: true; corps: ReceptionInput } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  if (!JOUR.test(f.receivedOn)) champs['receivedOn'] = 'Date de réception obligatoire.';
  else if (f.receivedOn > aujourdhui) champs['receivedOn'] = 'La date ne peut pas être future.';
  if (f.deliveryNoteRef.length > 100) champs['deliveryNoteRef'] = '100 caractères au plus.';
  if (f.note.length > 1000) champs['note'] = '1 000 caractères au plus.';
  const lines: ReceptionInput['lines'] = [];
  f.lignes.forEach((l, i) => {
    if (l.saisie.trim() === '') return;
    const q = lireQuantite(l.saisie);
    if (!q.ok) champs[`ligne-${i}`] = q.erreur;
    else lines.push({ orderLineId: l.orderLineId, quantity: q.valeur });
  });
  if (lines.length === 0 && !Object.keys(champs).some((k) => k.startsWith('ligne-'))) {
    champs['lignes'] = 'Indiquez la quantité reçue d’au moins une ligne.';
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  const ref = f.deliveryNoteRef.trim();
  const note = f.note.trim();
  return {
    ok: true,
    corps: {
      orderId,
      receivedOn: f.receivedOn,
      lines,
      ...(ref ? { deliveryNoteRef: ref } : {}),
      ...(note ? { note } : {}),
    },
  };
}

// ── Résultat d'une écriture (rendu par l'API) ──────────────────────────────

export interface LigneResultat {
  label: string;
  phrase: string;
  excedent: boolean;
}

/**
 * Phrases du reste à recevoir rendu par l'API après l'écriture : « reste 4 »,
 * « tout reçu », « 2 de plus que commandé ». Aucune quantité n'est calculée.
 */
export function phrasesResultat(
  r: PurchaseReceptionWriteResult,
  libelles: ReadonlyMap<string, string>,
): LigneResultat[] {
  return r.order.lines
    .filter((l) => l.receivable)
    .map((l) => {
      const label = libelles.get(l.orderLineId) ?? 'Ligne';
      const excedent = !/^0+(\.0+)?$/.test(l.overReceived);
      const reste = /^0+(\.0+)?$/.test(l.remaining);
      const phrase = excedent
        ? `${formatQuantite(l.overReceived)} de plus que commandé (écart signalé)`
        : reste
          ? 'Tout est reçu'
          : `Reste à recevoir : ${formatQuantite(l.remaining)}`;
      return { label, phrase, excedent };
    });
}

// ── Liste ───────────────────────────────────────────────────────────────────

export type FiltreReceptions = 'toutes' | 'commande';

export function requeteReceptions(
  orderId: string | null,
  cursor: string | null = null,
): ListReceptionsParams {
  return {
    limit: 50,
    ...(orderId ? { orderId } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/** Ligne de résumé d'une réception : « 3 lignes · BL 4521 ». */
export function resumeReception(
  r: Pick<PurchaseReceptionView, 'lines' | 'deliveryNoteRef'>,
): string {
  const n = r.lines.length;
  return [`${n} ligne${n > 1 ? 's' : ''}`, r.deliveryNoteRef ? `BL ${r.deliveryNoteRef}` : null]
    .filter((x): x is string => x !== null)
    .join(' · ');
}

/** Annuler une réception : `purchase.manage`, réception encore enregistrée. */
export function peutAnnulerReception(
  r: Pick<PurchaseReceptionView, 'status'>,
  actions: Actions,
): boolean {
  return r.status === 'recorded' && peutGererAchats(actions);
}

// ── Jour de Kinshasa ────────────────────────────────────────────────────────

/** Jour civil `AAAA-MM-JJ` à Kinshasa (ADR-0027), pour préremplir une date. */
export function jourKinshasa(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kinshasa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
