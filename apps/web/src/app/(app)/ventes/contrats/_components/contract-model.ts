// Logique pure des écrans Contrats (et briques partagées avec Commandes) — ADR-0050 § 9,
// lot V7.
//
// Ce qui DÉCIDE (droits affichés, formulaires, corps des requêtes, libellés, messages
// d'erreur) vit ici et se teste sans DOM. AUCUN montant ni AUCUNE date n'est calculé :
// totaux, restes, termes, date limite de préavis et échéances viennent de l'API (moteurs
// `invoice-totals` et `contracts`). Les clauses de durée, de reconduction et de préavis
// sont SAISIES : l'écran les transmet telles quelles, sans les juger (§ 10, critère 18).
//
// Rien ici n'autorise quoi que ce soit : `PermissionsGuard` refuse côté API de toute
// façon ; masquer un bouton est un confort.

import {
  SALES_CONTRACT_LIMITS as L,
  findForbiddenSalesContractWords,
  type SalesContractBillingFrequency,
  type SalesContractBillingKind,
  type SalesContractBillingTiming,
  type SalesContractFileKind,
  type SalesContractOccurrenceStatus,
  type SalesContractRenewalMode,
  type SalesContractSignatorySide,
  type SalesContractTerminationParty,
  type SalesDepositInvoiceType,
} from '@lalanda/shared/sales-contracts';

import type { InvoiceCustomerView, InvoiceLineBody, InvoiceView, OrgAction } from '@/lib/api';
import type {
  ContractBillingBody,
  ContractBillingView,
  ContractClausesBody,
  EngagementLineView,
  PrepareDepositBody,
  SalesContractStatus,
  SignatureBody,
  TerminateBody,
} from '@/lib/api-sales-contracts';

import { lireMontantSaisi } from '../../_components/sales-model';
import {
  formulaireDepuisVue,
  formulaireVide,
  lireQuantiteSaisie,
  quantitePourSaisie,
  type FormulaireDocument,
} from '../../factures/_components/invoice-model';

export const CONTRATS_BASE = '/ventes/contrats';
export const COMMANDES_BASE = '/ventes/commandes';

// ─── Droits affichés (ADR-0050 § 8) ─────────────────────────────────────────

type Actions = readonly OrgAction[] | null;

const a = (actions: Actions, action: OrgAction): boolean =>
  actions !== null && actions.includes(action);

/** Préparer contrats, avenants et commandes, déclarer une signature, téléverser. */
export function peutPreparerEngagement(actions: Actions): boolean {
  return a(actions, 'sales.contract');
}

/** Approuver ou rejeter, constater une reconduction, résilier, réglages. */
export function peutApprouverContrat(actions: Actions): boolean {
  return a(actions, 'sales.contract.approve');
}

/** Préparer un BROUILLON de facture (acompte, échéance, commande) : `sales.read` + `sales.manage`. */
export function peutPreparerBrouillon(actions: Actions): boolean {
  return a(actions, 'sales.read') && a(actions, 'sales.manage');
}

/**
 * L'approbation d'un contrat ou d'un avenant soumis (§ 8.3). Visible seulement pour
 * `sales.contract.approve`. Celui qui a soumis (ou créé) ne l'approuve pas — sauf
 * l'approbateur UNIQUE de l'organisation, quand le réglage le permet : l'écran ne connaît
 * pas le nombre de détenteurs, il propose le geste et le dit ; l'API tranche (`409
 * SELF_APPROVAL_FORBIDDEN`) et marque l'approbation « approbateur unique ».
 */
export function approbation(p: {
  actions: Actions;
  /** L'état du document permet l'approbation (`actions.approve` servi par l'API). */
  etatPermet: boolean;
  moi: string | null;
  soumisPar: string | null;
  creePar?: string | null;
  approbateurUniqueAdmis: boolean;
}): { visible: boolean; note: string | null } {
  if (!p.etatPermet || !peutApprouverContrat(p.actions)) return { visible: false, note: null };
  const auteur =
    p.moi !== null && (p.moi === p.soumisPar || (p.creePar != null && p.moi === p.creePar));
  if (!auteur) return { visible: true, note: null };
  if (!p.approbateurUniqueAdmis) {
    return {
      visible: false,
      note: 'Vous avez préparé ou soumis ce document : une autre personne habilitée doit l’approuver.',
    };
  }
  return {
    visible: true,
    note:
      'Vous avez préparé ou soumis ce document. Votre approbation n’est acceptée que si vous ' +
      'êtes la seule personne habilitée à approuver dans l’organisation ; elle sera alors ' +
      'marquée « approbateur unique ».',
  };
}

// ─── Libellés ───────────────────────────────────────────────────────────────

export const FILTRES_CONTRATS: readonly { valeur: SalesContractStatus | 'all'; label: string }[] = [
  { valeur: 'all', label: 'Tous les statuts' },
  { valeur: 'draft', label: 'Brouillons' },
  { valeur: 'submitted', label: 'À approuver' },
  { valeur: 'approved', label: 'Approuvés, à signer' },
  { valeur: 'signed', label: 'Signés' },
  { valeur: 'terminated', label: 'Résiliés' },
  { valeur: 'cancelled', label: 'Annulés' },
];

export const FILTRES_FACTURATION: readonly {
  valeur: SalesContractBillingKind | 'all';
  label: string;
}[] = [
  { valeur: 'all', label: 'Toutes les facturations' },
  { valeur: 'recurring', label: 'Récurrents (abonnements)' },
  { valeur: 'schedule', label: 'Échéancier à dates fixes' },
  { valeur: 'none', label: 'Sans échéancier' },
];

export const FACTURATION_LABELS: Record<SalesContractBillingKind, string> = {
  none: 'Sans échéancier',
  schedule: 'Échéancier à dates fixes',
  recurring: 'Abonnement',
};

export const FREQUENCE_LABELS: Record<SalesContractBillingFrequency, string> = {
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
  quarterly: 'Chaque trimestre',
  yearly: 'Chaque année',
};

export const MOMENT_LABELS: Record<SalesContractBillingTiming, string> = {
  in_advance: 'Période qui commence à l’échéance',
  in_arrears: 'Période qui finit à l’échéance',
};

export const RECONDUCTION_LABELS: Record<SalesContractRenewalMode, string> = {
  none: 'Aucune : le contrat finit au terme',
  tacit: 'Tacite : à constater par une personne habilitée',
  explicit: 'Expresse : par avenant de renouvellement',
};

export const ECHEANCE_LABELS: Record<SalesContractOccurrenceStatus, string> = {
  prepared: 'Brouillon préparé',
  to_prepare: 'À préparer',
  upcoming: 'À venir',
  blocked: 'Bloquée',
};

export const PIECE_LABELS: Record<SalesContractFileKind, string> = {
  draft_copy: 'Copie de travail',
  signed_copy: 'Copie signée',
  customer_order: 'Bon de commande du client',
};

export const COTE_LABELS: Record<SalesContractSignatorySide, string> = {
  customer: 'Client',
  organization: 'Votre organisation',
};

export const PARTIE_LABELS: Record<SalesContractTerminationParty, string> = {
  customer: 'Le client',
  organization: 'Votre organisation',
};

export const ORIGINE_TERME_LABELS: Record<string, string> = {
  initial: 'Terme initial',
  tacit_recorded: 'Reconduction constatée',
  explicit_amendment: 'Renouvellement par avenant',
};

/** Ton d'une pastille de statut : le TEXTE porte l'information (ADR-0030 § 5). */
export function tonContrat(status: string, derive: string | null): 'neutre' | 'attention' {
  if (status === 'submitted' || status === 'approved') return 'attention';
  return derive === 'expiring' || derive === 'ended' ? 'attention' : 'neutre';
}

export function tonEcheance(state: SalesContractOccurrenceStatus): 'neutre' | 'attention' {
  return state === 'blocked' || state === 'to_prepare' ? 'attention' : 'neutre';
}

/** Libellé de statut affiché : le statut dérivé d'un contrat signé l'emporte. */
export function libelleStatutContrat(v: {
  statusLabel: string;
  derivedStatusLabel: string | null;
}): string {
  return v.derivedStatusLabel ?? v.statusLabel;
}

/** `12` → « 12 mois » ; `null` → « durée indéterminée ». */
export function libelleDuree(mois: number | null): string {
  return mois === null ? 'Durée indéterminée' : `${mois} mois`;
}

export function libelleReconduction(r: {
  mode: SalesContractRenewalMode;
  periodMonths: number | null;
  maxRenewals: number | null;
}): string {
  if (r.mode === 'none') return 'Aucune reconduction';
  const base = r.mode === 'tacit' ? 'Tacite' : 'Expresse (avenant)';
  const periode = r.periodMonths === null ? '' : `, par période de ${r.periodMonths} mois`;
  const max = r.maxRenewals === null ? '' : `, ${r.maxRenewals} fois au plus`;
  return `${base}${periode}${max}`;
}

/** Taille d'une pièce : « 1,2 Mo », « 830 ko ». */
export function libelleTaille(octets: number): string {
  if (octets >= 1024 * 1024) return `${(octets / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
  return `${Math.max(1, Math.round(octets / 1024))} ko`;
}

/**
 * Lien vers une facture brouillon ou émise : l'écran des factures garde « Émettre » et
 * « Normaliser » (`sales.invoice`). Aucune émission depuis ces écrans.
 */
export function lienFacture(invoiceId: string): string {
  return `/ventes/factures/${encodeURIComponent(invoiceId)}`;
}

// ─── Messages d'erreur ──────────────────────────────────────────────────────

const MESSAGES: Record<string, string> = {
  STALE_REVISION: 'Cette fiche a été modifiée entre-temps : rechargez-la, puis recommencez.',
  SELF_APPROVAL_FORBIDDEN:
    'Vous avez préparé ou soumis ce document : une autre personne habilitée doit l’approuver.',
  ORDER_EXISTS_FOR_QUOTE: 'Une commande existe déjà pour ce devis : ouvrez-la.',
  ORDER_NOT_DRAFT: 'Seule une commande en brouillon se modifie.',
  ORDER_NOT_CONFIRMED: 'La commande doit d’abord être confirmée.',
  ORDER_HAS_ISSUED_INVOICE: 'Une facture émise est liée à cette commande : elle ne s’annule plus.',
  CONTRACT_NOT_DRAFT:
    'Seul un contrat en brouillon se modifie : créez une nouvelle version ou un avenant.',
  CONTRACT_NOT_SUBMITTED: 'Le contrat n’est pas soumis à approbation.',
  CONTRACT_NOT_APPROVED: 'Le contrat doit être approuvé avant la déclaration de signature.',
  CONTRACT_NOT_SIGNED: 'Le contrat doit être signé pour cette action.',
  AMENDMENT_NOT_DRAFT: 'Seul un avenant en brouillon se modifie.',
  AMENDMENT_BEFORE_PREPARED_OCCURRENCE:
    'La date d’effet précède une échéance déjà préparée : choisissez une date plus tardive, ou supprimez d’abord ce brouillon.',
  AMENDMENT_BEFORE_CONTRACT_START: 'La date d’effet précède le début du contrat.',
  SIGNED_COPY_REQUIRED: 'Téléversez d’abord la copie signée (PDF).',
  SIGNATORIES_REQUIRED: 'Indiquez au moins un signataire du client et un de votre organisation.',
  FILE_NOT_PDF: 'Seul un fichier PDF est accepté.',
  FILE_TOO_LARGE: 'Le fichier dépasse 10 Mo.',
  QUOTE_NOT_ACCEPTED: 'Seul un devis accepté donne une commande ou un contrat.',
  CUSTOMER_REQUIRED: 'Un client est exigé : convertissez d’abord le prospect en client.',
  OWNER_WITHOUT_SALES_READ: 'Le responsable choisi n’a pas accès aux ventes.',
  RENEWAL_NOT_PROPOSED: 'Aucune reconduction n’est à constater pour l’instant.',
  OCCURRENCE_ALREADY_PREPARED: 'Cette échéance a déjà un brouillon : ouvrez-le.',
  OCCURRENCE_BLOCKED: 'Cette échéance est bloquée : voyez le motif affiché.',
  TAX_GROUP_REQUIRED: 'Choisissez le groupe de taxation de l’acompte.',
  INVALID_REQUEST: 'Certaines valeurs sont refusées. Vérifiez les champs signalés.',
};

function detailDe(err: unknown): Record<string, unknown> | null {
  const e = (typeof err === 'object' && err !== null ? err : {}) as { detail?: unknown };
  return typeof e.detail === 'object' && e.detail !== null
    ? (e.detail as Record<string, unknown>)
    : null;
}

/** Code métier d'un refus de l'API, ou `null`. */
export function codeErreur(err: unknown): string | null {
  const code = detailDe(err)?.['code'];
  return typeof code === 'string' ? code : null;
}

export function messageEngagement(err: unknown, repli: string): string {
  if (typeof err !== 'object' || err === null) return repli;
  const status = (err as { status?: unknown }).status;
  if (status === 403) return 'Votre rôle ne permet pas cette action.';
  if (status === 404) return 'Document introuvable.';
  const detail = detailDe(err);
  const code = codeErreur(err);
  if (code && MESSAGES[code]) return MESSAGES[code]!;
  if (typeof detail?.['message'] === 'string') return detail['message'] as string;
  return repli;
}

/** Problèmes champ par champ d'un refus 400 (`details.issues`). */
export function champsRefusesEngagement(err: unknown): Record<string, string> {
  const issues = (detailDe(err)?.['details'] as { issues?: unknown } | undefined)?.issues;
  if (!Array.isArray(issues)) return {};
  const out: Record<string, string> = {};
  for (const i of issues) {
    if (typeof i === 'object' && i !== null && 'path' in i && 'message' in i) {
      const p = (i as { path: unknown }).path;
      out[Array.isArray(p) ? p.join('.') : String(p)] = String((i as { message: unknown }).message);
    }
  }
  return out;
}

/** Avertissements d'une réponse (`warnings`), en phrases. */
export function phrasesAvertissements(warnings: readonly { message: string }[]): string[] {
  return warnings.map((w) => w.message).filter((m) => m.trim() !== '');
}

// ─── Clauses saisies et échéancier (§ 2.3, § 2.4) ───────────────────────────

export interface EcheanceFormulaire {
  cle: string;
  itemRef: string;
  dueDate: string;
  label: string;
  /** Quantité par index de ligne du contrat ; vide : ligne non facturée à cette échéance. */
  quantites: Record<number, string>;
}

export interface FormulaireClauses {
  startDate: string;
  /** Vide : durée indéterminée. */
  dureeMois: string;
  reconduction: SalesContractRenewalMode;
  periodeMois: string;
  /** Vide : sans limite saisie. */
  maxReconductions: string;
  preavisJours: string;
  facturation: SalesContractBillingKind;
  frequence: SalesContractBillingFrequency;
  ancre: string;
  moment: SalesContractBillingTiming;
  autoPrepare: boolean;
  echeances: EcheanceFormulaire[];
  clauses: string;
}

let compteur = 0;
function cle(): string {
  compteur += 1;
  return `e-${compteur}`;
}

export function clausesVides(aujourdhui: string): FormulaireClauses {
  return {
    startDate: aujourdhui,
    dureeMois: '12',
    reconduction: 'none',
    periodeMois: '',
    maxReconductions: '',
    preavisJours: '30',
    facturation: 'none',
    frequence: 'monthly',
    ancre: aujourdhui,
    moment: 'in_advance',
    autoPrepare: true,
    echeances: [],
    clauses: '',
  };
}

export function echeanceVide(position: number): EcheanceFormulaire {
  return { cle: cle(), itemRef: `E${position + 1}`, dueDate: '', label: '', quantites: {} };
}

/** Clé de rapprochement d'une ligne : article du catalogue ou désignation, et prix. */
function signature(l: {
  source: string;
  catalogItemId?: string | null;
  name?: string;
  unitPrice?: string | null;
}): string {
  const qui = l.source === 'catalog' ? `c:${l.catalogItemId ?? ''}` : `f:${l.name ?? ''}`;
  return `${qui}|${l.unitPrice ?? ''}`;
}

/**
 * Quantités d'une échéance stockée, rapprochées des lignes du contrat (article ou
 * désignation, et prix unitaire). Une ligne d'échéance sans correspondance est ignorée :
 * rien n'est deviné ; l'écran le signale.
 */
export function quantitesDepuisEcheance(
  lignesContrat: readonly EngagementLineView[],
  lignesEcheance: readonly EngagementLineView[],
): { quantites: Record<number, string>; ignorees: number } {
  const libres = new Map<string, number[]>();
  lignesContrat.forEach((l, i) => {
    const k = signature(l);
    libres.set(k, [...(libres.get(k) ?? []), i]);
  });
  const quantites: Record<number, string> = {};
  let ignorees = 0;
  for (const l of lignesEcheance) {
    const pile = libres.get(signature(l));
    const i = pile?.shift();
    if (i === undefined) {
      ignorees += 1;
      continue;
    }
    quantites[i] = quantitePourSaisie(l.quantity);
  }
  return { quantites, ignorees };
}

/** Formulaire des clauses d'un contrat servi par l'API. */
export function clausesDepuisVue(v: {
  startDate: string;
  initialTermMonths: number | null;
  renewal: {
    mode: SalesContractRenewalMode;
    periodMonths: number | null;
    maxRenewals: number | null;
  };
  noticeDays: number;
  billing: ContractBillingView;
  clauses: string | null;
  lines: readonly EngagementLineView[];
}): FormulaireClauses {
  const base = clausesVides(v.startDate);
  const f: FormulaireClauses = {
    ...base,
    dureeMois: v.initialTermMonths === null ? '' : String(v.initialTermMonths),
    reconduction: v.renewal.mode,
    periodeMois: v.renewal.periodMonths === null ? '' : String(v.renewal.periodMonths),
    maxReconductions: v.renewal.maxRenewals === null ? '' : String(v.renewal.maxRenewals),
    preavisJours: String(v.noticeDays),
    facturation: v.billing.kind,
    clauses: v.clauses ?? '',
  };
  if (v.billing.kind === 'recurring') {
    f.frequence = v.billing.frequency;
    f.ancre = v.billing.anchorDate;
    f.moment = v.billing.timing;
    f.autoPrepare = v.billing.autoPrepare;
  }
  if (v.billing.kind === 'schedule') {
    f.echeances = v.billing.items.map((it) => ({
      cle: cle(),
      itemRef: it.itemRef,
      dueDate: it.dueDate,
      label: it.label,
      quantites: quantitesDepuisEcheance(v.lines, it.lines).quantites,
    }));
  }
  return f;
}

/**
 * Lignes d'une échéance : les lignes du contrat retenues, à LEURS prix, avec la quantité
 * saisie pour l'échéance. Aucun pourcentage (décision ouverte n° 14).
 */
export function lignesEcheance(
  lignesContrat: readonly InvoiceLineBody[],
  quantites: Record<number, string>,
): { lignes: InvoiceLineBody[]; erreurs: Record<number, string> } {
  const lignes: InvoiceLineBody[] = [];
  const erreurs: Record<number, string> = {};
  lignesContrat.forEach((l, i) => {
    const saisie = (quantites[i] ?? '').trim();
    if (saisie === '' || l.source === 'origin') return;
    const q = lireQuantiteSaisie(saisie);
    if (!q.ok) {
      erreurs[i] = q.erreur;
      return;
    }
    lignes.push({ ...l, quantity: q.valeur });
  });
  return { lignes, erreurs };
}

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

function entier(saisie: string, min: number, max: number): number | null {
  const s = saisie.trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  return n >= min && n <= max ? n : null;
}

export type PreparationClauses =
  { ok: true; corps: ContractClausesBody } | { ok: false; champs: Record<string, string> };

/**
 * Contrôle de FORME des clauses saisies, puis corps. Aucune règle juridique : bornes du
 * contrat d'API seulement (§ 2.3).
 */
export function preparerClauses(
  f: FormulaireClauses,
  lignesContrat: readonly InvoiceLineBody[],
): PreparationClauses {
  const champs: Record<string, string> = {};
  if (!JOUR.test(f.startDate)) champs['startDate'] = 'Date de début : AAAA-MM-JJ.';
  let duree: number | null = null;
  if (f.dureeMois.trim() !== '') {
    duree = entier(f.dureeMois, L.initialTermMonthsMin, L.initialTermMonthsMax);
    if (duree === null) {
      champs['initialTermMonths'] =
        `Durée : de ${L.initialTermMonthsMin} à ${L.initialTermMonthsMax} mois, ou vide pour une durée indéterminée.`;
    }
  }
  const preavis = entier(f.preavisJours, L.noticeDaysMin, L.noticeDaysMax);
  if (preavis === null) {
    champs['noticeDays'] = `Préavis : de ${L.noticeDaysMin} à ${L.noticeDaysMax} jours.`;
  }
  let periode: number | null = null;
  let max: number | null = null;
  if (f.reconduction !== 'none') {
    periode = entier(f.periodeMois, L.renewalPeriodMonthsMin, L.renewalPeriodMonthsMax);
    if (periode === null) {
      champs['renewal.periodMonths'] =
        `Période de reconduction : de ${L.renewalPeriodMonthsMin} à ${L.renewalPeriodMonthsMax} mois.`;
    }
    if (f.maxReconductions.trim() !== '') {
      max = entier(f.maxReconductions, 0, L.maxRenewalsMax);
      if (max === null) {
        champs['renewal.maxRenewals'] = `Nombre de reconductions : de 0 à ${L.maxRenewalsMax}.`;
      }
    }
  }
  if (f.clauses.length > L.clausesMax) {
    champs['clauses'] = `${L.clausesMax.toLocaleString('fr-FR')} caractères au plus.`;
  }

  let billing: ContractBillingBody = { kind: 'none' };
  if (f.facturation === 'recurring') {
    if (!JOUR.test(f.ancre))
      champs['billing.anchorDate'] = 'Date de la première échéance : AAAA-MM-JJ.';
    billing = {
      kind: 'recurring',
      frequency: f.frequence,
      anchorDate: f.ancre,
      timing: f.moment,
      autoPrepare: f.autoPrepare,
    };
  } else if (f.facturation === 'schedule') {
    if (f.echeances.length < L.scheduleItemsMin) {
      champs['billing.items'] = 'Ajoutez au moins une échéance.';
    }
    if (f.echeances.length > L.scheduleItemsMax) {
      champs['billing.items'] = `${L.scheduleItemsMax} échéances au plus.`;
    }
    const refs = new Set<string>();
    const items = f.echeances.map((e, i) => {
      if (!JOUR.test(e.dueDate)) champs[`billing.items.${i}.dueDate`] = 'Date : AAAA-MM-JJ.';
      if (e.label.trim() === '') champs[`billing.items.${i}.label`] = 'Libellé obligatoire.';
      else if (e.label.length > L.labelMax)
        champs[`billing.items.${i}.label`] = 'Libellé trop long.';
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(e.itemRef) || refs.has(e.itemRef)) {
        champs[`billing.items.${i}.itemRef`] = 'Référence d’échéance invalide ou en double.';
      }
      refs.add(e.itemRef);
      const { lignes, erreurs } = lignesEcheance(lignesContrat, e.quantites);
      for (const [n, m] of Object.entries(erreurs)) champs[`billing.items.${i}.lines.${n}`] = m;
      if (lignes.length === 0 && Object.keys(erreurs).length === 0) {
        champs[`billing.items.${i}.lines`] = 'Indiquez au moins une quantité pour cette échéance.';
      }
      return { itemRef: e.itemRef, dueDate: e.dueDate, label: e.label.trim(), lines: lignes };
    });
    billing = { kind: 'schedule', items };
  }

  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      startDate: f.startDate,
      initialTermMonths: duree,
      renewal: {
        mode: f.reconduction,
        periodMonths: f.reconduction === 'none' ? null : periode,
        maxRenewals: f.reconduction === 'none' ? null : max,
      },
      noticeDays: preavis ?? 0,
      billing,
      clauses: f.clauses.trim() === '' ? null : f.clauses.trim(),
    },
  };
}

// ─── Acompte (§ 5.1) ────────────────────────────────────────────────────────

export interface FormulaireAcompte {
  type: SalesDepositInvoiceType;
  montant: string;
  /** Vide au départ : le groupe n'est JAMAIS prérempli (EC2, décision ouverte n° 12). */
  groupe: string;
  libelle: string;
}

export function acompteVide(): FormulaireAcompte {
  return { type: 'FT', montant: '', groupe: '', libelle: '' };
}

export function preparerAcompte(
  f: FormulaireAcompte,
  expectedRevision: number,
): { ok: true; corps: PrepareDepositBody } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  const m = lireMontantSaisi(f.montant);
  if (!m.ok) champs['requestedAmount'] = m.erreur;
  if (!/^[A-P]$/.test(f.groupe)) {
    champs['taxGroup'] = 'Choisissez le groupe de taxation : Lalanda ne le choisit pas pour vous.';
  }
  if (f.libelle.length > L.labelMax) champs['label'] = 'Libellé trop long.';
  if (!m.ok || Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      expectedRevision,
      type: f.type,
      requestedAmount: m.valeur,
      taxGroup: f.groupe,
      ...(f.libelle.trim() === '' ? {} : { label: f.libelle.trim() }),
    },
  };
}

// ─── Signature déclarée (§ 2.3 ; signature électronique hors périmètre) ─────

export interface SignataireFormulaire {
  cle: string;
  nom: string;
  fonction: string;
  cote: SalesContractSignatorySide;
}

export function signatairesVides(): SignataireFormulaire[] {
  return [
    { cle: cle(), nom: '', fonction: '', cote: 'customer' },
    { cle: cle(), nom: '', fonction: '', cote: 'organization' },
  ];
}

export function signataireVide(cote: SalesContractSignatorySide): SignataireFormulaire {
  return { cle: cle(), nom: '', fonction: '', cote };
}

export function preparerSignature(p: {
  expectedRevision: number;
  date: string;
  signataires: readonly SignataireFormulaire[];
  /** Copie signée téléversée (ou à téléverser) : exigée (décision ouverte n° 6). */
  fichierChoisi: boolean;
}):
  | { ok: true; corps: Omit<SignatureBody, 'fileId'> }
  | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  if (!JOUR.test(p.date)) champs['signedOn'] = 'Date de signature : AAAA-MM-JJ.';
  if (!p.fichierChoisi) champs['file'] = 'Choisissez la copie signée (PDF).';
  const retenus = p.signataires.filter((s) => s.nom.trim() !== '');
  if (retenus.length > L.signatoriesMax) {
    champs['signatories'] = `${L.signatoriesMax} signataires au plus.`;
  }
  if (
    !retenus.some((s) => s.cote === 'customer') ||
    !retenus.some((s) => s.cote === 'organization')
  ) {
    champs['signatories'] = 'Au moins un signataire du client et un de votre organisation.';
  }
  if (
    retenus.some(
      (s) => s.nom.length > L.signatoryNameMax || s.fonction.length > L.signatoryTitleMax,
    )
  ) {
    champs['signatories'] = 'Nom ou fonction trop long.';
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      expectedRevision: p.expectedRevision,
      signedOn: p.date,
      signatories: retenus.map((s) => ({
        name: s.nom.trim(),
        title: s.fonction.trim() === '' ? null : s.fonction.trim(),
        side: s.cote,
      })),
    },
  };
}

// ─── Résiliation (§ 2.3) ────────────────────────────────────────────────────

export function preparerResiliation(p: {
  expectedRevision: number;
  notifieeLe: string;
  par: SalesContractTerminationParty;
  effetLe: string;
  motif: string;
}): { ok: true; corps: TerminateBody } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  if (!JOUR.test(p.notifieeLe)) champs['noticeGivenOn'] = 'Date de notification : AAAA-MM-JJ.';
  if (!JOUR.test(p.effetLe)) champs['effectiveOn'] = 'Date d’effet : AAAA-MM-JJ.';
  else if (JOUR.test(p.notifieeLe) && p.effetLe < p.notifieeLe) {
    champs['effectiveOn'] = 'La date d’effet ne précède pas la notification.';
  }
  const motif = p.motif.trim();
  if (motif === '') champs['reason'] = 'Motif obligatoire.';
  else if (motif.length > L.reasonMax) champs['reason'] = `${L.reasonMax} caractères au plus.`;
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      expectedRevision: p.expectedRevision,
      noticeGivenOn: p.notifieeLe,
      by: p.par,
      effectiveOn: p.effetLe,
      reason: motif,
    },
  };
}

/** Motif ou commentaire exigé (annuler, clore, rejeter, marquer un acompte traité). */
export function lireMotif(saisie: string, max: number = L.reasonMax): string | { erreur: string } {
  const s = saisie.trim();
  if (s === '') return { erreur: 'Motif obligatoire.' };
  if (s.length > max) return { erreur: `${max} caractères au plus.` };
  return s;
}

/** Jour civil de Kinshasa (UTC+1, sans heure d'été) pour préremplir une date. */
export function aujourdhuiKinshasa(maintenant: Date = new Date()): string {
  return new Date(maintenant.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Libellés et textes affichés par ces écrans : contrôle des mots interdits (critère 18). */
export function motsInterdits(texte: string): string[] {
  return findForbiddenSalesContractWords(texte);
}

// ─── Document de vente d'un engagement ──────────────────────────────────────

/**
 * Formulaire (client, devise, mode de prix, lignes) d'une commande, d'un contrat ou des
 * lignes d'un avenant : mêmes formes qu'un brouillon de facture ; les champs propres à la
 * facture (paiements, commentaires, avoir, point de vente) sont neutres.
 */
export function formulaireDepuisEngagement(v: {
  currency: 'CDF' | 'USD';
  priceMode: 'ttc' | 'ht';
  customer: InvoiceCustomerView;
  lines: readonly EngagementLineView[];
}): FormulaireDocument {
  const commeFacture = {
    type: 'FV',
    currency: v.currency,
    priceMode: v.priceMode,
    customer: v.customer,
    lines: v.lines,
    comments: { A: null, C: null },
    creditNote: null,
    showUsdCounterValue: false,
    pointOfSaleId: null,
    documentAmounts: { payments: [] },
  } as unknown as InvoiceView;
  return { ...formulaireDepuisVue(commeFacture), paiements: [] };
}

export function formulaireEngagementVide(): FormulaireDocument {
  return { ...formulaireVide(), paiements: [] };
}
