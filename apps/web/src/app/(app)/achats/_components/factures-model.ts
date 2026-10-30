// Factures fournisseurs et rapprochement — ADR-0044 § 2.5, § 3.5, § 5 et § 8 (lot
// P8). Logique pure.
//
// Le rapprochement (écarts, mode, statut), le reste à payer et le règlement sont
// rendus par l'API (moteur `matchInvoice`, `payableSettlement`) : l'écran les
// traduit en français clair, sans rien recalculer. Les taxes sont recopiées de la
// facture du fournisseur, jamais calculées ; le total est saisi tel qu'imprimé et
// l'API vérifie l'addition au centime (§ 9).

import type {
  PayableSettlementStatus,
  PurchaseCurrency,
  PurchaseMatchingMode,
  PurchaseMatchingStatus,
} from '@lalanda/shared/purchases';

import type { OrgAction } from '@/lib/api';
import type {
  ListInvoicesParams,
  SupplierInvoiceInput,
  SupplierInvoiceListItem,
  SupplierInvoicePrefill,
  SupplierInvoiceVarianceView,
  SupplierInvoiceView,
} from '@/lib/api-purchases-payables';

import { formatMontant } from '../../ventes/_components/sales-model';

import {
  peutApprouverAchats,
  peutGererAchats,
  peutPayerFournisseurs,
  type TonStatut,
} from './achats-model';
import { lirePrix, lireQuantite, type TaxeSaisie } from './commandes-model';
import { formatQuantite } from './receptions-model';

type Actions = readonly OrgAction[] | null;

// ── Statuts ─────────────────────────────────────────────────────────────────

export const LIBELLES_REGLEMENT: Record<PayableSettlementStatus, string> = {
  unpaid: 'À payer',
  partially_paid: 'Payée en partie',
  paid: 'Payée',
};

export interface EtatFacture {
  libelle: string;
  ton: TonStatut;
}

/**
 * État lisible d'une facture, d'après les champs rendus par l'API : annulée, en
 * litige, en écart, brouillon, puis le règlement dérivé des paiements.
 */
export function etatFacture(
  f: Pick<
    SupplierInvoiceListItem,
    'status' | 'disputed' | 'matchingStatus' | 'settlementStatus' | 'kind' | 'forced'
  >,
): EtatFacture {
  if (f.status === 'cancelled') return { libelle: 'Annulée', ton: 'danger' };
  if (f.disputed) return { libelle: 'En litige', ton: 'danger' };
  if (f.status === 'draft') {
    return f.matchingStatus === 'variance'
      ? { libelle: 'En écart', ton: 'warning' }
      : { libelle: 'Brouillon', ton: 'neutral' };
  }
  if (f.kind === 'credit_note') return { libelle: 'Avoir validé', ton: 'success' };
  if (f.settlementStatus === 'paid') return { libelle: 'Payée', ton: 'success' };
  if (f.settlementStatus === 'partially_paid') return { libelle: 'Payée en partie', ton: 'info' };
  return { libelle: f.forced ? 'Bonne à payer (forcée)' : 'Bonne à payer', ton: 'info' };
}

export function natureFacture(f: Pick<SupplierInvoiceListItem, 'kind'>): string {
  return f.kind === 'credit_note' ? 'Avoir fournisseur' : 'Facture fournisseur';
}

// ── Liste ───────────────────────────────────────────────────────────────────

export type FiltreFactures =
  'toutes' | 'brouillons' | 'ecart' | 'validees' | 'en-retard' | 'litiges';

export const FILTRES_FACTURES: readonly { valeur: FiltreFactures; label: string }[] = [
  { valeur: 'toutes', label: 'Toutes' },
  { valeur: 'brouillons', label: 'Brouillons' },
  { valeur: 'ecart', label: 'En écart' },
  { valeur: 'validees', label: 'Validées' },
  { valeur: 'en-retard', label: 'En retard' },
  { valeur: 'litiges', label: 'En litige' },
];

const FILTRES_VALIDES = new Set<string>(FILTRES_FACTURES.map((f) => f.valeur));

/** Filtre lu dans l'adresse (`?filtre=ecart`) ; inconnu → « toutes ». */
export function lireFiltreFactures(v: string | null): FiltreFactures {
  return v !== null && FILTRES_VALIDES.has(v) ? (v as FiltreFactures) : 'toutes';
}

export function requeteFactures(
  filtre: FiltreFactures,
  cursor: string | null = null,
): ListInvoicesParams {
  const base: ListInvoicesParams = { limit: 50, ...(cursor ? { cursor } : {}) };
  switch (filtre) {
    case 'brouillons':
      return { ...base, status: 'draft' };
    case 'ecart':
      return { ...base, status: 'draft', matching: 'variance' };
    case 'validees':
      return { ...base, status: 'validated' };
    case 'en-retard':
      return { ...base, due: 'overdue' };
    case 'litiges':
      return { ...base, disputed: 'true' };
    default:
      return base;
  }
}

// ── Rapprochement (§ 5) ─────────────────────────────────────────────────────

export const LIBELLES_MODE: Record<PurchaseMatchingMode, string> = {
  none: 'Sans commande : pas de rapprochement',
  two_way: 'À deux voies : facture comparée à la commande',
  three_way: 'À trois voies : facture comparée à la commande et aux réceptions',
};

export const LIBELLES_RAPPROCHEMENT: Record<PurchaseMatchingStatus, string> = {
  not_applicable: 'Non applicable',
  matched: 'Conforme',
  variance: 'En écart',
};

export function tonRapprochement(s: PurchaseMatchingStatus): TonStatut {
  return s === 'variance' ? 'warning' : s === 'matched' ? 'success' : 'neutral';
}

/** Écarts nommés par l'ADR (§ 5.2) et rendus par le moteur, en français clair. */
export const LIBELLES_ECART: Record<string, string> = {
  PRICE_ABOVE_ORDER: 'Prix facturé plus élevé que le prix commandé',
  QUANTITY_ABOVE_ORDER: 'Quantité facturée plus grande que la quantité commandée',
  QUANTITY_ABOVE_RECEIVED: 'Quantité facturée plus grande que la quantité reçue',
  LINE_NOT_ON_ORDER: 'Ligne facturée absente de la commande',
  TOTAL_ABOVE_ORDER: 'Total facturé plus élevé que le total approuvé',
  TAXES_DIFFER_FROM_ORDER:
    'Taxes différentes de celles du devis (information : ce n’est pas un contrôle fiscal)',
  RECEIVED_OVER_ORDERED: 'Plus de quantité reçue que commandée (information)',
  PRICE_BELOW_ORDER: 'Prix facturé plus bas que commandé (information)',
  QUANTITY_BELOW_ORDER:
    'Quantité facturée plus petite que commandée : facture partielle (information)',
};

export interface EcartAffiche {
  code: string;
  bloquant: boolean;
  titre: string;
  /** Ligne concernée (« Ensemble de la facture » pour un écart global). */
  ligne: string;
  attendu: string;
  constate: string;
  difference: string;
}

function valeurEcart(
  v: string,
  unit: SupplierInvoiceVarianceView['unit'],
  devise: PurchaseCurrency,
): string {
  return unit === 'quantity' ? formatQuantite(v) : formatMontant(v, devise);
}

/** Différence signée rendue par l'API : « +4 », « −10,00 USD » (aucun calcul). */
function differenceEcart(v: SupplierInvoiceVarianceView, devise: PurchaseCurrency): string {
  const negatif = v.difference.startsWith('-');
  const brut = negatif || v.difference.startsWith('+') ? v.difference.slice(1) : v.difference;
  return `${negatif ? '−' : '+'}${valeurEcart(brut, v.unit, devise)}`;
}

/** Libellé de la ligne visée par un écart. */
export function ligneEcart(
  v: Pick<SupplierInvoiceVarianceView, 'invoiceLineIndex' | 'orderLineId'>,
  lignes: readonly { orderLineId: string | null; label: string }[],
): string {
  if (v.invoiceLineIndex !== null && lignes[v.invoiceLineIndex]) {
    return lignes[v.invoiceLineIndex]!.label;
  }
  if (v.orderLineId !== null) {
    const l = lignes.find((x) => x.orderLineId === v.orderLineId);
    if (l) return l.label;
    return 'Ligne de la commande';
  }
  return 'Ensemble de la facture';
}

/**
 * Écarts à afficher, BLOQUANTS d'abord : titre en français, ligne, attendu,
 * constaté, différence — toutes valeurs rendues par l'API.
 */
export function ecartsAffiches(
  variances: readonly SupplierInvoiceVarianceView[],
  lignes: readonly { orderLineId: string | null; label: string }[],
  devise: PurchaseCurrency,
): EcartAffiche[] {
  return [...variances]
    .sort((a, b) => Number(b.blocking) - Number(a.blocking))
    .map((v) => ({
      code: v.code,
      bloquant: v.blocking,
      titre: LIBELLES_ECART[v.code] ?? 'Écart signalé par le rapprochement',
      ligne: ligneEcart(v, lignes),
      attendu: valeurEcart(v.expected, v.unit, devise),
      constate: valeurEcart(v.actual, v.unit, devise),
      difference: differenceEcart(v, devise),
    }));
}

/** Phrase de synthèse du rapprochement d'une facture. */
export function phraseRapprochement(
  m: Pick<SupplierInvoiceView['matching'], 'status' | 'variances'>,
): string {
  const bloquants = m.variances.filter((v) => v.blocking).length;
  const infos = m.variances.length - bloquants;
  if (m.status === 'not_applicable')
    return 'Facture sans commande : seuls le total et la référence sont contrôlés.';
  if (bloquants > 0) {
    return `${bloquants} écart${bloquants > 1 ? 's' : ''} bloquant${bloquants > 1 ? 's' : ''} : la facture ne se valide que corrigée ou forcée par un approbateur.`;
  }
  if (infos > 0) {
    return `Conforme, avec ${infos} information${infos > 1 ? 's' : ''} à lire (rien de bloquant).`;
  }
  return 'Conforme à la commande.';
}

// ── Refus de l'API ──────────────────────────────────────────────────────────

interface ErreurApi {
  detail?: unknown;
}

function detailDe(err: unknown): { code?: unknown; details?: Record<string, unknown> } | null {
  const d = (err as ErreurApi | null)?.detail;
  return typeof d === 'object' && d !== null
    ? (d as { code?: unknown; details?: Record<string, unknown> })
    : null;
}

/** Facture existante d'un doublon (`409 SUPPLIER_INVOICE_DUPLICATE`), sinon `null`. */
export function doublonDe(err: unknown): string | null {
  const d = detailDe(err);
  if (d?.code !== 'SUPPLIER_INVOICE_DUPLICATE') return null;
  const v = d.details?.['invoiceId'];
  return typeof v === 'string' && v !== '' ? v : null;
}

/** Écarts bloquants portés par un refus de validation (`409 SUPPLIER_INVOICE_VARIANCE`). */
export function ecartsDuRefus(err: unknown): SupplierInvoiceVarianceView[] | null {
  const d = detailDe(err);
  if (d?.code !== 'SUPPLIER_INVOICE_VARIANCE') return null;
  const v = d.details?.['variances'];
  return Array.isArray(v) ? (v as SupplierInvoiceVarianceView[]) : [];
}

/** Différence d'un total refusé (`SUPPLIER_INVOICE_TOTAL_MISMATCH`), rendue par l'API. */
export function ecartTotalDuRefus(
  err: unknown,
): { attendu: string; saisi: string; difference: string } | null {
  const d = detailDe(err);
  if (d?.code !== 'SUPPLIER_INVOICE_TOTAL_MISMATCH') return null;
  const x = d.details ?? {};
  const s = (k: string): string => (typeof x[k] === 'string' ? (x[k] as string) : '');
  return { attendu: s('expected'), saisi: s('actual'), difference: s('difference') };
}

// ── Gestes ──────────────────────────────────────────────────────────────────

export type IdActionFacture =
  'valider' | 'forcer' | 'litige' | 'lever-litige' | 'avoir' | 'payer' | 'annuler';

export interface ActionFacture {
  id: IdActionFacture;
  libelle: string;
  actif: boolean;
  raison: string | null;
}

export const RAISON_ECART_BLOQUANT =
  'Écart bloquant : corrigez la facture, mettez-la en litige, ou faites-la forcer par un approbateur.';
export const RAISON_FORCER_APPROBATEUR =
  'Réservé aux approbateurs (autorité de dépense) : ils peuvent forcer une facture en écart, avec un motif.';
export const RAISON_LITIGE = 'Facture en litige : levez d’abord le litige.';

/**
 * Gestes proposés pour une facture. Un geste étranger à son état est ABSENT ;
 * valider et forcer restent visibles mais DÉSACTIVÉS avec leur raison quand
 * l'écart ou le droit l'empêche. L'API reste juge (séparation des tâches).
 */
export function actionsFacture(
  f: Pick<
    SupplierInvoiceView,
    'status' | 'kind' | 'disputed' | 'matchingStatus' | 'settlementStatus'
  >,
  actions: Actions,
): ActionFacture[] {
  const gerer = peutGererAchats(actions);
  const liste: ActionFacture[] = [];
  const push = (id: IdActionFacture, libelle: string, raison: string | null = null): void => {
    liste.push({ id, libelle, actif: raison === null, raison });
  };
  if (f.status === 'cancelled') return liste;

  if (f.status === 'draft') {
    if (gerer) {
      push(
        'valider',
        'Valider (bonne à payer)',
        f.disputed ? RAISON_LITIGE : f.matchingStatus === 'variance' ? RAISON_ECART_BLOQUANT : null,
      );
    }
    if (f.matchingStatus === 'variance' && (gerer || peutApprouverAchats(actions))) {
      push(
        'forcer',
        'Forcer la validation',
        !peutApprouverAchats(actions)
          ? RAISON_FORCER_APPROBATEUR
          : f.disputed
            ? RAISON_LITIGE
            : null,
      );
    }
  }

  if (gerer && f.kind === 'invoice') {
    if (f.disputed) push('lever-litige', 'Lever le litige');
    else push('litige', 'Mettre en litige');
  }

  if (
    f.status === 'validated' &&
    f.kind === 'invoice' &&
    f.settlementStatus !== 'paid' &&
    peutPayerFournisseurs(actions)
  ) {
    push('payer', 'Enregistrer un paiement', f.disputed ? RAISON_LITIGE : null);
  }
  if (f.status === 'validated' && f.kind === 'invoice' && gerer) {
    push('avoir', 'Saisir un avoir');
  }
  if (gerer) push('annuler', f.kind === 'credit_note' ? 'Annuler l’avoir' : 'Annuler la facture');
  return liste;
}

// ── Formulaire de saisie ────────────────────────────────────────────────────

export interface LigneFactureSaisie {
  orderLineId: string | null;
  label: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
}

export interface ImputationSaisie {
  category: string;
  workProjectId: string;
  amount: string;
}

export interface FormulaireFacture {
  kind: 'invoice' | 'credit_note';
  creditedInvoiceId: string;
  supplierId: string;
  supplierReference: string;
  invoiceDate: string;
  receivedOn: string;
  dueDate: string;
  currency: PurchaseCurrency;
  orderIds: string[];
  /** Vide : facture libre, le sous-total HT est saisi. */
  lignes: LigneFactureSaisie[];
  subtotal: string;
  taxes: TaxeSaisie[];
  total: string;
  deductibleVat: string;
  imputations: ImputationSaisie[];
}

const versSaisie = (v: string): string => v.replace('.', ',');

export function formulaireFactureLibre(
  aujourdhui: string,
  devise: PurchaseCurrency = 'USD',
  supplierId = '',
): FormulaireFacture {
  return {
    kind: 'invoice',
    creditedInvoiceId: '',
    supplierId,
    supplierReference: '',
    invoiceDate: aujourdhui,
    receivedOn: aujourdhui,
    dueDate: '',
    currency: devise,
    orderIds: [],
    lignes: [],
    subtotal: '',
    taxes: [],
    total: '',
    deductibleVat: '',
    imputations: [{ category: '', workProjectId: '', amount: '' }],
  };
}

/** Avoir sur une facture validée : même fournisseur, même devise (§ 2.5). */
export function formulaireAvoir(
  f: Pick<SupplierInvoiceView, 'id' | 'supplierId' | 'currency' | 'costAllocations'>,
  aujourdhui: string,
): FormulaireFacture {
  return {
    ...formulaireFactureLibre(aujourdhui, f.currency, f.supplierId),
    kind: 'credit_note',
    creditedInvoiceId: f.id,
    imputations: [
      { category: f.costAllocations[0]?.category ?? '', workProjectId: '', amount: '' },
    ],
  };
}

/**
 * Préremplissage `from-order` : lignes au reste à facturer, catégories et projets
 * des lignes de la commande. Une seule imputation reste SANS montant : elle prendra
 * le total saisi tel quel. Référence et dates du fournisseur restent à saisir.
 */
export function formulaireDepuisCommande(
  p: SupplierInvoicePrefill,
  aujourdhui: string,
): FormulaireFacture {
  const imputations = p.costAllocations.map((c) => ({
    category: c.category ?? '',
    workProjectId: c.workProjectId ?? '',
    amount: p.costAllocations.length > 1 ? versSaisie(c.amount) : '',
  }));
  return {
    ...formulaireFactureLibre(aujourdhui, p.currency, p.supplierId),
    orderIds: [...p.orderIds],
    lignes: p.lines.map((l) => ({
      orderLineId: l.orderLineId,
      label: l.label,
      quantity: versSaisie(l.quantity),
      unitPrice: versSaisie(l.unitPrice),
      discountPercent: l.discountPercent === null ? '' : versSaisie(l.discountPercent),
    })),
    imputations:
      imputations.length > 0 ? imputations : [{ category: '', workProjectId: '', amount: '' }],
  };
}

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const REMISE = /^\d{1,3}(\.\d{1,2})?$/;

/**
 * Vérification locale et corps de `POST /purchases/invoices`. Aucun total n'est
 * calculé : le total TTC est celui imprimé, l'API contrôle l'addition. Les
 * imputations sans catégorie ni montant sont omises (défaut de l'API) ; une seule
 * imputation sans montant reçoit le total saisi. Clés d'erreur : `supplierId`,
 * `supplierReference`, `invoiceDate`, `receivedOn`, `dueDate`, `subtotal`, `total`,
 * `deductibleVat`, `lignes`, `ligne-<i>-<champ>`, `taxe-<i>-<champ>`,
 * `imputation-<i>-<champ>`, `imputations`.
 */
export function preparerFacture(
  f: FormulaireFacture,
  aujourdhui: string,
): { ok: true; corps: SupplierInvoiceInput } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  if (f.supplierId === '') champs['supplierId'] = 'Choisissez le fournisseur.';
  const ref = f.supplierReference.trim();
  if (ref === '')
    champs['supplierReference'] = 'Le numéro de la facture du fournisseur est obligatoire.';
  else if (ref.length > 100) champs['supplierReference'] = '100 caractères au plus.';
  for (const k of ['invoiceDate', 'receivedOn'] as const) {
    if (!JOUR.test(f[k])) champs[k] = 'Date obligatoire.';
    else if (f[k] > aujourdhui) champs[k] = 'La date ne peut pas être future.';
  }
  if (f.dueDate !== '' && !JOUR.test(f.dueDate)) champs['dueDate'] = 'Date invalide.';
  else if (f.dueDate !== '' && JOUR.test(f.invoiceDate) && f.dueDate < f.invoiceDate) {
    champs['dueDate'] = 'L’échéance ne peut pas précéder la date de la facture.';
  }
  if (f.kind === 'credit_note' && f.creditedInvoiceId === '') {
    champs['creditedInvoiceId'] = 'Un avoir vise une facture.';
  }

  const lines: NonNullable<SupplierInvoiceInput['lines']> = [];
  if (f.orderIds.length > 0 && f.lignes.length === 0) {
    champs['lignes'] = 'Une facture liée à une commande porte ses lignes.';
  }
  f.lignes.forEach((l, i) => {
    const label = l.label.trim();
    if (l.orderLineId === null && label === '')
      champs[`ligne-${i}-label`] = 'Désignation obligatoire.';
    const q = lireQuantite(l.quantity);
    if (!q.ok) champs[`ligne-${i}-quantity`] = q.erreur;
    const p = lirePrix(l.unitPrice);
    if (!p.ok) champs[`ligne-${i}-unitPrice`] = p.erreur;
    const remise = l.discountPercent.trim().replace(',', '.');
    if (remise !== '' && (!REMISE.test(remise) || Number(remise) > 100)) {
      champs[`ligne-${i}-discountPercent`] = 'Remise : 0 à 100.';
    }
    if (q.ok && p.ok) {
      lines.push({
        orderLineId: l.orderLineId,
        ...(label ? { label } : {}),
        quantity: q.valeur,
        unitPrice: p.valeur,
        discountPercent: remise === '' ? null : remise,
      });
    }
  });

  let subtotal: string | undefined;
  if (f.lignes.length === 0) {
    const s = lirePrix(f.subtotal);
    if (!s.ok) champs['subtotal'] = s.erreur;
    else subtotal = s.valeur;
  }

  const taxes: { label: string; amount: string }[] = [];
  if (f.taxes.length > 5) champs['taxes'] = 'Cinq taxes au plus.';
  f.taxes.forEach((t, i) => {
    const label = t.label.trim();
    if (label === '') champs[`taxe-${i}-label`] = 'Libellé obligatoire (TVA, autre).';
    const m = lirePrix(t.amount);
    if (!m.ok) champs[`taxe-${i}-amount`] = m.erreur;
    if (label !== '' && m.ok) taxes.push({ label, amount: m.valeur });
  });

  const total = lirePrix(f.total);
  if (!total.ok) champs['total'] = total.erreur;
  else if (/^0+(\.0+)?$/.test(total.valeur))
    champs['total'] = 'Le total doit être supérieur à zéro.';

  let deductibleVat: string | null = null;
  if (f.deductibleVat.trim() !== '') {
    const d = lirePrix(f.deductibleVat);
    if (!d.ok) champs['deductibleVat'] = d.erreur;
    else deductibleVat = d.valeur;
  }

  const remplies = f.imputations.filter(
    (x) => x.category !== '' || x.amount.trim() !== '' || x.workProjectId !== '',
  );
  const costAllocations: NonNullable<SupplierInvoiceInput['costAllocations']> = [];
  if (remplies.length > 20) champs['imputations'] = '20 imputations au plus.';
  f.imputations.forEach((x, i) => {
    if (!remplies.includes(x)) return;
    if (x.category === '') champs[`imputation-${i}-category`] = 'Catégorie obligatoire.';
    let amount: string | null = null;
    if (x.amount.trim() === '') {
      if (remplies.length === 1 && total.ok) amount = total.valeur;
      else
        champs[`imputation-${i}-amount`] =
          'Montant obligatoire quand il y a plusieurs imputations.';
    } else {
      const m = lirePrix(x.amount);
      if (!m.ok) champs[`imputation-${i}-amount`] = m.erreur;
      else amount = m.valeur;
    }
    if (x.category !== '' && amount !== null) {
      costAllocations.push({
        category: x.category,
        workProjectId: x.workProjectId === '' ? null : x.workProjectId,
        amount,
      });
    }
  });

  if (Object.keys(champs).length > 0 || !total.ok) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      supplierId: f.supplierId,
      supplierReference: ref,
      kind: f.kind,
      ...(f.kind === 'credit_note' ? { creditedInvoiceId: f.creditedInvoiceId } : {}),
      invoiceDate: f.invoiceDate,
      receivedOn: f.receivedOn,
      ...(f.dueDate !== '' ? { dueDate: f.dueDate } : {}),
      currency: f.currency,
      ...(f.orderIds.length > 0 ? { orderIds: f.orderIds } : {}),
      ...(lines.length > 0 ? { lines } : {}),
      ...(subtotal !== undefined ? { subtotal } : {}),
      taxes,
      total: total.valeur,
      deductibleVat,
      ...(costAllocations.length > 0 ? { costAllocations } : {}),
    },
  };
}

/** Mention des taxes et de la TVA déductible (§ 9). */
export const MENTION_TAXES_FACTURE =
  'Taxes recopiées de la facture du fournisseur, jamais calculées par Lalanda.';
export const MENTION_TVA_DEDUCTIBLE =
  'Déclarée par vous et conservée pour le comptable : elle n’entre dans aucun calcul.';

// ── Pièce jointe (§ 2.7) ────────────────────────────────────────────────────

export const TYPES_PIECE = 'application/pdf,image/png,image/jpeg,image/webp';

/** Contrôle local de la pièce (l'API vérifie le contenu de toute façon). */
export function verifierPiece(file: { type: string; size: number }): string | null {
  if (file.type === 'application/pdf') {
    return file.size > 10 * 1024 * 1024 ? 'Un PDF fait 10 Mio au plus.' : null;
  }
  if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return file.size > 2 * 1024 * 1024 ? 'Une photo fait 2 Mio au plus.' : null;
  }
  return 'Seuls les PDF et les photos PNG, JPEG ou WebP sont acceptés.';
}
