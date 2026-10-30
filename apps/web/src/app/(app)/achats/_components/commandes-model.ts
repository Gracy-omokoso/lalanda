// Demandes d'achat et bons de commande — ADR-0044 § 2.3, § 3.2 et § 8. Logique pure.
//
// Un seul document en deux phases : il naît demande (`DA…`), devient bon de
// commande (`BC…`) à l'approbation complète. Les totaux sont ceux du moteur
// (`computeOrderTotals`), rendus par l'API après chaque écriture : le formulaire
// n'en affiche aucun. Les boutons d'action se décident ici, d'après le statut et
// les ACTIONS servies par le serveur ; l'API reste juge (séparation des tâches).

import type { PurchaseCurrency, PurchaseLineKind } from '@lalanda/shared/purchases';

import type { OrgAction } from '@/lib/api';
import type {
  CreatePurchaseOrderInput,
  ListOrdersParams,
  PurchaseOrderView,
} from '@/lib/api-purchases';

import {
  peutApprouverAchats,
  peutDemanderAchat,
  peutGererAchats,
  peutLireAchats,
} from './achats-model';

type Actions = readonly OrgAction[] | null;

// ── Liste ───────────────────────────────────────────────────────────────────

export type FiltreCommandes = 'toutes' | 'miennes' | 'brouillons' | 'a-approuver' | 'commandes';

export const FILTRES_COMMANDES: readonly { valeur: FiltreCommandes; label: string }[] = [
  { valeur: 'toutes', label: 'Toutes' },
  { valeur: 'miennes', label: 'Mes demandes' },
  { valeur: 'brouillons', label: 'Brouillons' },
  { valeur: 'a-approuver', label: 'À approuver' },
  { valeur: 'commandes', label: 'Bons de commande' },
];

export function requeteCommandes(
  filtre: FiltreCommandes,
  cursor: string | null = null,
): ListOrdersParams {
  const base: ListOrdersParams = { limit: 50, ...(cursor ? { cursor } : {}) };
  switch (filtre) {
    case 'miennes':
      return { ...base, requestedBy: 'me' };
    case 'brouillons':
      return { ...base, status: 'draft' };
    case 'a-approuver':
      return { ...base, status: 'submitted' };
    case 'commandes':
      return { ...base, phase: 'order' };
    default:
      return base;
  }
}

/** Numéro affiché : le `BC` l'emporte sur le `DA` ; un brouillon n'en a pas. */
export function numeroCommande(
  o: Pick<PurchaseOrderView, 'orderNumber' | 'requestNumber'>,
): string {
  return o.orderNumber ?? o.requestNumber ?? 'Brouillon sans numéro';
}

/** Nature du document : demande d'achat ou bon de commande. */
export function natureCommande(o: Pick<PurchaseOrderView, 'phase'>): string {
  return o.phase === 'order' ? 'Bon de commande' : 'Demande d’achat';
}

/**
 * « 1 approbation sur 2 » : décompte des décisions rendues par l'API ; `null`
 * pour un brouillon (le nombre requis n'est figé qu'à la soumission).
 */
export function phraseApprobations(
  o: Pick<PurchaseOrderView, 'requiredApprovals' | 'approvals' | 'status'>,
): string | null {
  if (o.requiredApprovals === null) return null;
  if (o.requiredApprovals === 0) return 'Aucune approbation requise pour ce montant';
  const faites = o.approvals.filter((x) => x.decision === 'approved').length;
  const pluriel = o.requiredApprovals > 1 ? 's' : '';
  return `${faites} approbation${faites > 1 ? 's' : ''} sur ${o.requiredApprovals} requise${pluriel}`;
}

/** L'approbation a-t-elle été réduite par la règle de l'approbateur unique ? */
export function approbateurUnique(o: Pick<PurchaseOrderView, 'approvals'>): boolean {
  return o.approvals.some((x) => x.soleApprover);
}

// ── Boutons d'action ────────────────────────────────────────────────────────

export type IdAction =
  | 'soumettre'
  | 'supprimer'
  | 'approuver'
  | 'refuser'
  | 'dupliquer'
  | 'marquer-envoyee'
  | 'annuler'
  | 'apercu';

export interface ActionCommande {
  id: IdAction;
  libelle: string;
  actif: boolean;
  /** Pourquoi le bouton est désactivé ; `null` s'il est actif. */
  raison: string | null;
}

export const RAISON_SANS_APPROBATION =
  'Réservé aux rôles qui approuvent les achats (autorité de dépense).';
export const RAISON_PROPRE_DEMANDE =
  'Vous avez demandé cet achat : un autre approbateur doit le valider (séparation des tâches).';
export const RAISON_DEJA_APPROUVE =
  'Vous avez déjà approuvé : la seconde approbation doit venir d’une autre personne.';

export interface ContexteActions {
  actions: Actions;
  /** Utilisateur connecté (`null` : inconnu, l'API tranchera). */
  moi: string | null;
  /**
   * La demande figure dans `GET /purchases/approvals/pending` de l'utilisateur :
   * l'API la juge approuvable par lui (approbateur unique compris). `null` si la
   * liste n'a pas pu être lue.
   */
  enAttentePourMoi: boolean | null;
}

const ANNULABLES = new Set(['submitted', 'approved', 'sent', 'partially_received']);

/**
 * Boutons proposés pour une demande ou commande. Une action étrangère au statut
 * est ABSENTE ; approuver et refuser restent visibles mais DÉSACTIVÉS, avec leur
 * raison, quand le droit ou la séparation des tâches l'empêche.
 */
export function actionsCommande(o: PurchaseOrderView, ctx: ContexteActions): ActionCommande[] {
  const { actions, moi } = ctx;
  const gerer = peutGererAchats(actions);
  const auteur = moi !== null && (o.requestedBy === moi || o.createdBy === moi);
  const liste: ActionCommande[] = [];
  const actif = (id: IdAction, libelle: string): void => {
    liste.push({ id, libelle, actif: true, raison: null });
  };

  if (o.status === 'draft' && (gerer || (auteur && peutDemanderAchat(actions)))) {
    actif('soumettre', 'Soumettre pour approbation');
    actif('supprimer', 'Supprimer le brouillon');
  }

  if (o.status === 'submitted') {
    let raison: string | null = null;
    if (!peutApprouverAchats(actions)) raison = RAISON_SANS_APPROBATION;
    else if (ctx.enAttentePourMoi === true) raison = null;
    else if (
      moi !== null &&
      o.approvals.some((x) => x.userId === moi && x.decision === 'approved')
    ) {
      raison = RAISON_DEJA_APPROUVE;
    } else if (auteur) raison = RAISON_PROPRE_DEMANDE;
    for (const [id, libelle] of [
      ['approuver', 'Approuver'],
      ['refuser', 'Refuser'],
    ] as const) {
      liste.push({ id, libelle, actif: raison === null, raison });
    }
  }

  if (o.phase === 'order' && o.status !== 'cancelled' && peutLireAchats(actions)) {
    actif('apercu', 'Aperçu du bon de commande');
  }
  if (o.status === 'approved' && gerer) actif('marquer-envoyee', 'Marquer comme envoyée');
  if (ANNULABLES.has(o.status) && gerer) actif('annuler', 'Annuler');
  if (o.status !== 'draft' && peutDemanderAchat(actions)) actif('dupliquer', 'Dupliquer');
  return liste;
}

// ── Formulaire de création ──────────────────────────────────────────────────

export interface LigneSaisie {
  label: string;
  kind: PurchaseLineKind;
  quantity: string;
  unit: string;
  unitPrice: string;
}

export interface TaxeSaisie {
  label: string;
  amount: string;
}

export interface FormulaireCommande {
  title: string;
  justification: string;
  supplierId: string;
  currency: PurchaseCurrency;
  expectedOn: string;
  deliveryAddress: string;
  lignes: LigneSaisie[];
  taxes: TaxeSaisie[];
}

export const ligneVide = (): LigneSaisie => ({
  label: '',
  kind: 'goods',
  quantity: '1',
  unit: '',
  unitPrice: '',
});

export function formulaireCommande(
  devise: PurchaseCurrency = 'USD',
  supplierId = '',
): FormulaireCommande {
  return {
    title: '',
    justification: '',
    supplierId,
    currency: devise,
    expectedOn: '',
    deliveryAddress: '',
    lignes: [ligneVide()],
    taxes: [],
  };
}

const sansEspaces = (s: string): string => s.replace(/[\s  ]/g, '').replace(',', '.');

/** Quantité saisie (« 2,5 ») → chaîne du contrat (« 2.5 ») : > 0, trois décimales au plus. */
export function lireQuantite(
  saisie: string,
): { ok: true; valeur: string } | { ok: false; erreur: string } {
  const s = sansEspaces(saisie);
  const m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(s);
  if (m === null) return { ok: false, erreur: 'Quantité invalide : trois décimales au plus.' };
  if (/^0*$/.test(m[1]!) && /^0*$/.test(m[2] ?? '')) {
    return { ok: false, erreur: 'La quantité doit être supérieure à zéro.' };
  }
  return { ok: true, valeur: s };
}

/** Montant saisi (« 1 234,50 ») → chaîne du contrat ; zéro permis (prix ≥ 0). */
export function lirePrix(
  saisie: string,
): { ok: true; valeur: string } | { ok: false; erreur: string } {
  const s = sansEspaces(saisie);
  if (s === '') return { ok: false, erreur: 'Saisissez un montant.' };
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(s)) {
    return {
      ok: false,
      erreur: 'Montant invalide : deux décimales au plus, par exemple 1 234,50.',
    };
  }
  return { ok: true, valeur: s };
}

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const ouNul = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * Vérification locale et corps de `POST /purchases/orders`. Le fournisseur est
 * facultatif au brouillon (exigé à la soumission par l'API). Clés d'erreur :
 * `title`, `lignes`, `ligne-<i>-label|quantity|unitPrice`, `taxe-<i>-label|amount`.
 */
export function preparerCommande(
  f: FormulaireCommande,
): { ok: true; corps: CreatePurchaseOrderInput } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  const title = f.title.trim();
  if (title === '') champs['title'] = 'L’objet de la demande est obligatoire.';
  else if (title.length > 200) champs['title'] = '200 caractères au plus.';
  if (f.justification.length > 2000) champs['justification'] = '2 000 caractères au plus.';
  if (f.expectedOn !== '' && !JOUR.test(f.expectedOn)) champs['expectedOn'] = 'Date invalide.';
  if (f.deliveryAddress.length > 500) champs['deliveryAddress'] = '500 caractères au plus.';
  if (f.lignes.length === 0) champs['lignes'] = 'Ajoutez au moins une ligne.';
  if (f.lignes.length > 100) champs['lignes'] = '100 lignes au plus.';

  const lignes: CreatePurchaseOrderInput['lines'] = [];
  f.lignes.forEach((l, i) => {
    const label = l.label.trim();
    if (label === '') champs[`ligne-${i}-label`] = 'Désignation obligatoire.';
    else if (label.length > 200) champs[`ligne-${i}-label`] = '200 caractères au plus.';
    const q = lireQuantite(l.quantity);
    if (!q.ok) champs[`ligne-${i}-quantity`] = q.erreur;
    const p = lirePrix(l.unitPrice);
    if (!p.ok) champs[`ligne-${i}-unitPrice`] = p.erreur;
    if (q.ok && p.ok && label !== '') {
      lignes.push({
        label,
        kind: l.kind,
        quantity: q.valeur,
        unitPrice: p.valeur,
        unit: ouNul(l.unit),
      });
    }
  });

  const taxes: { label: string; amount: string }[] = [];
  if (f.taxes.length > 5) champs['taxes'] = 'Cinq taxes au plus.';
  f.taxes.forEach((t, i) => {
    const label = t.label.trim();
    if (label === '') champs[`taxe-${i}-label`] = 'Libellé obligatoire (TVA, autre).';
    const m = lirePrix(t.amount);
    if (!m.ok) champs[`taxe-${i}-amount`] = m.erreur;
    if (label !== '' && m.ok) taxes.push({ label, amount: m.valeur });
  });

  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      title,
      justification: ouNul(f.justification),
      supplierId: f.supplierId === '' ? null : f.supplierId,
      currency: f.currency,
      lines: lignes,
      declaredTaxes: taxes,
      expectedOn: f.expectedOn === '' ? null : f.expectedOn,
      deliveryAddress: ouNul(f.deliveryAddress),
    },
  };
}

/** Phrase des taxes : elles sont recopiées du devis du fournisseur, jamais calculées (§ 9). */
export const MENTION_TAXES = 'Taxes telles qu’indiquées par le fournisseur (jamais calculées).';
