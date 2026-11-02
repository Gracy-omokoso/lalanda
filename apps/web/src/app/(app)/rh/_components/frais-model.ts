// Notes de frais et avances — ADR-0051 § 2.1, § 2.2, § 3, § 4 et § 10 (lot H16). Logique pure.
//
// Ce qui DÉCIDE à l'écran vit ici et se teste sans DOM : libellés des statuts, vue
// d'arrivée, gestes offerts, séparation des tâches rendue VISIBLE (celui qui demande
// ne valide pas ; celui qui a saisi pour autrui non plus ; deux étapes, deux
// personnes), lecture d'une saisie de ligne, contrôle préalable d'un justificatif.
//
// Masquer un bouton est un confort : l'API reste juge (`expenseApprovalDecision`,
// `reimbursementDecision`). La vue « à valider » de l'API ne rend que les notes que
// l'appelant peut réellement valider, exception de l'approbateur unique comprise.
// AUCUN montant n'est additionné ici : totaux, part couverte par l'avance et reste dû
// viennent du moteur, par l'API.

import {
  EXPENSE_LIMITS,
  EXPENSE_LINE_CATEGORIES,
  EXPENSE_RECEIPT_CONTENT_TYPES,
  type AdvanceKind,
  type AdvanceStatus,
  type AdvanceView,
  type ExpenseLineCategory,
  type ExpenseListView,
  type ExpenseReportStatus,
  type ExpenseReportView,
} from '@lalanda/shared/hr';

import type { OrgAction } from '@/lib/api';

import { formatMontant, lireMontantSaisi } from '../../ventes/_components/sales-model';

import type { Ton } from './rh-model';

type Actions = readonly OrgAction[] | null;
const a = (x: Actions, action: OrgAction): boolean => x !== null && x.includes(action);

export const LIEN_MES_FRAIS = '/rh/moi/frais';
export const lienFrais = (vue: ExpenseListView): string => `/rh/frais?vue=${vue}`;

// ── Droits (actions de la coquille, jamais un rôle) ─────────────────────────

export const peutDeclarerFrais = (x: Actions): boolean => a(x, 'expenses.claim');
export const peutValiderFrais = (x: Actions): boolean => a(x, 'expenses.approve');
export const peutPayerFrais = (x: Actions): boolean =>
  a(x, 'payables.pay') && a(x, 'treasury.read');
/** Liste de toutes les notes (sans justificatif pour `hr.read` seul). */
export const peutVoirToutesNotes = (x: Actions): boolean =>
  a(x, 'expenses.approve') || a(x, 'payables.pay') || a(x, 'hr.read');

/**
 * Vue de l'écran « Frais et avances » (§ 10). « À payer » exige `payables.pay` ;
 * « Toutes » exige l'une des actions de lecture générale ; « À valider » est
 * offerte à tous (un manager y trouve son équipe, l'API filtre).
 */
export function vueFrais(param: string | null, x: Actions): ExpenseListView {
  if (param === 'a-payer' && a(x, 'payables.pay')) return 'a-payer';
  if (param === 'toutes' && peutVoirToutesNotes(x)) return 'toutes';
  if (param === 'a-valider') return 'a-valider';
  if (a(x, 'expenses.approve')) return 'a-valider';
  if (a(x, 'payables.pay')) return 'a-payer';
  if (peutVoirToutesNotes(x)) return 'toutes';
  return 'a-valider';
}

/** Onglets de vue offerts, dans l'ordre. */
export function vuesFraisOffertes(x: Actions): ExpenseListView[] {
  const vues: ExpenseListView[] = ['a-valider'];
  if (a(x, 'payables.pay')) vues.push('a-payer');
  if (peutVoirToutesNotes(x)) vues.push('toutes');
  return vues;
}

export const LIBELLES_VUE: Record<ExpenseListView, string> = {
  'a-valider': 'À valider',
  'a-payer': 'À payer',
  toutes: 'Toutes',
};

// ── Libellés ────────────────────────────────────────────────────────────────

export const LIBELLES_STATUT_NOTE: Record<ExpenseReportStatus, string> = {
  draft: 'Brouillon',
  submitted: 'En validation',
  approved: 'Approuvée, à rembourser',
  rejected: 'Refusée',
  reimbursed: 'Remboursée',
  settled_by_advance: 'Soldée par l’avance',
  partially_settled: 'Avance déduite, complément à rembourser',
  cancelled: 'Annulée',
};

export function tonStatutNote(s: ExpenseReportStatus): Ton {
  switch (s) {
    case 'submitted':
      return 'info';
    case 'approved':
    case 'partially_settled':
      return 'warning';
    case 'reimbursed':
    case 'settled_by_advance':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const LIBELLES_STATUT_AVANCE: Record<AdvanceStatus, string> = {
  draft: 'Brouillon',
  submitted: 'En validation',
  approved: 'Approuvée, à verser',
  rejected: 'Refusée',
  disbursed: 'Versée, à régulariser',
  partially_settled: 'Partiellement régularisée',
  settled: 'Régularisée',
  cancelled: 'Annulée',
  written_off: 'Abandonnée',
};

export function tonStatutAvance(s: AdvanceStatus): Ton {
  switch (s) {
    case 'submitted':
      return 'info';
    case 'approved':
    case 'disbursed':
    case 'partially_settled':
      return 'warning';
    case 'settled':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * Nature d'une avance à l'écran. `null` (lecteur sans droit à la nature, § 4) :
 * « Avance », jamais « sur salaire ».
 */
export function libelleNatureAvance(kind: AdvanceKind | null): string {
  if (kind === 'expenses') return 'Avance de frais';
  if (kind === 'salary') return 'Avance sur salaire';
  return 'Avance';
}

export const LIBELLES_ETAPE: Record<'manager' | 'finance', string> = {
  manager: 'Manager',
  finance: 'Validation financière',
};

/**
 * Libellés des douze catégories d'une ligne (catégories de dépense d'ADR-0034 § 1,
 * investissement et remboursement d'emprunt exclus : ils passent par les achats).
 */
export const LIBELLES_CATEGORIE: Record<ExpenseLineCategory, string> = {
  achats: 'Achats de marchandises et matières',
  personnel: 'Salaires et charges sociales',
  loyer: 'Loyer et charges locatives',
  transport: 'Transport et logistique',
  marketing: 'Marketing et publicité',
  outils_logiciels: 'Outils, logiciels et abonnements',
  energie_telecom: 'Énergie, eau et télécommunications',
  services_exterieurs: 'Honoraires et services extérieurs',
  impots_taxes: 'Impôts et taxes (hors impôt sur les bénéfices)',
  impot_benefices: 'Impôt sur les bénéfices',
  frais_financiers: 'Frais bancaires et intérêts',
  charges_diverses: 'Charges diverses',
};

export const CATEGORIES_LIGNE: readonly ExpenseLineCategory[] = EXPENSE_LINE_CATEGORIES;

/** Montant de l'API mis en forme (jamais arrondi ni additionné). */
export const montant = (valeur: string | null, devise: string): string =>
  valeur === null ? '—' : formatMontant(valeur, devise);

// ── Séparation des tâches (§ 3) ─────────────────────────────────────────────

export interface Moi {
  /** Fiche reliée à mon compte (`GET /hr/me`), ou `null`. */
  employeeId: string | null;
  /** Mon compte (`userId` de ma fiche), ou `null` si inconnu. */
  userId: string | null;
}

export type Separation = 'beneficiaire' | 'auteur' | 'deja-valide';

export const PHRASES_SEPARATION: Record<Separation, string> = {
  beneficiaire:
    'C’est votre propre demande : vous ne pouvez pas la valider. Une autre personne s’en charge.',
  auteur:
    'Vous avez saisi cette demande pour un collègue : vous ne pouvez pas la valider. Une autre personne s’en charge.',
  'deja-valide':
    'Vous avez déjà validé une étape de cette demande : l’étape suivante revient à une autre personne.',
};

type Demande = Pick<ExpenseReportView, 'employeeId' | 'createdBy'> & {
  approvals: readonly { userId: string; decision: string }[];
};

/**
 * Pourquoi l'appelant ne peut pas valider cette demande, ou `null`. Bénéficiaire,
 * auteur d'une saisie pour autrui, approbateur d'une étape précédente.
 */
export function separation(d: Demande, moi: Moi): Separation | null {
  if (moi.employeeId !== null && d.employeeId === moi.employeeId) return 'beneficiaire';
  if (moi.userId !== null && d.createdBy === moi.userId) return 'auteur';
  if (moi.userId !== null && d.approvals.some((x) => x.userId === moi.userId)) {
    return 'deja-valide';
  }
  return null;
}

/** Phrase rappelée quand la vue « à valider » rend tout de même sa propre demande. */
export const PHRASE_APPROBATEUR_UNIQUE =
  'Vous êtes la seule personne habilitée à valider : votre décision sera marquée « approbateur unique » et journalisée.';

export interface GestesNote {
  modifier: boolean;
  soumettre: boolean;
  annuler: boolean;
  dupliquer: boolean;
  valider: boolean;
  rembourser: boolean;
  annulerRemboursement: boolean;
  /** Phrase de séparation à afficher (bouton absent), ou `null`. */
  phrase: string | null;
}

/**
 * Gestes offerts sur une note. `dansAValider` : la note vient de la vue « à valider »
 * de l'API (elle a déjà jugé que l'appelant peut décider). Ailleurs, une note
 * soumise n'offre la décision qu'à qui n'est ni bénéficiaire, ni auteur, ni déjà
 * approbateur — et la phrase dit pourquoi.
 */
export function gestesNote(
  n: Pick<ExpenseReportView, 'status' | 'employeeId' | 'createdBy' | 'approvals' | 'reimbursement'>,
  moi: Moi,
  x: Actions,
  dansAValider: boolean,
): GestesNote {
  const proprietaire =
    (moi.employeeId !== null && n.employeeId === moi.employeeId) ||
    (moi.userId !== null && n.createdBy === moi.userId);
  const sep = separation(n, moi);
  const decidable = n.status === 'submitted';
  const valider = decidable && (dansAValider || (sep === null && peutValiderFrais(x)));
  let phrase: string | null = null;
  if (decidable && dansAValider && sep !== null) phrase = PHRASE_APPROBATEUR_UNIQUE;
  else if (decidable && !dansAValider && sep !== null) phrase = PHRASES_SEPARATION[sep];
  const payable = n.status === 'approved' || n.status === 'partially_settled';
  return {
    modifier: n.status === 'draft' && proprietaire,
    soumettre: n.status === 'draft' && proprietaire,
    annuler:
      ((n.status === 'draft' || n.status === 'submitted') && proprietaire) ||
      (n.status === 'approved' && n.reimbursement === null && peutValiderFrais(x)),
    dupliquer: (n.status === 'rejected' || n.status === 'cancelled') && proprietaire,
    valider,
    rembourser: payable && n.reimbursement === null && peutPayerFrais(x),
    annulerRemboursement: n.reimbursement !== null && peutPayerFrais(x),
    phrase,
  };
}

export interface GestesAvance {
  soumettre: boolean;
  annuler: boolean;
  valider: boolean;
  verser: boolean;
  regulariser: boolean;
  phrase: string | null;
}

export function gestesAvance(
  v: Pick<
    AdvanceView,
    'status' | 'employeeId' | 'createdBy' | 'approvals' | 'disbursement' | 'kind'
  >,
  moi: Moi,
  x: Actions,
  equipe: readonly string[] = [],
): GestesAvance {
  const proprietaire =
    (moi.employeeId !== null && v.employeeId === moi.employeeId) ||
    (moi.userId !== null && v.createdBy === moi.userId);
  const sep = separation(v, moi);
  const decidable = v.status === 'submitted';
  // Avance sur salaire : la validation financière seule ; jamais le manager (§ 2.2).
  const manager = v.kind !== 'salary' && equipe.includes(v.employeeId);
  const autorite = peutValiderFrais(x) || manager;
  return {
    soumettre: v.status === 'draft' && proprietaire,
    annuler:
      ((v.status === 'draft' || v.status === 'submitted') && proprietaire) ||
      (v.status === 'approved' && peutValiderFrais(x)),
    valider: decidable && autorite && sep === null,
    verser: v.status === 'approved' && v.disbursement === null && peutPayerFrais(x),
    regulariser:
      (v.status === 'disbursed' || v.status === 'partially_settled') &&
      (peutPayerFrais(x) || peutValiderFrais(x)) &&
      !proprietaire,
    phrase: decidable && autorite && sep !== null ? PHRASES_SEPARATION[sep] : null,
  };
}

// ── Saisie d'une ligne ──────────────────────────────────────────────────────

export interface SaisieLigne {
  /** Identifiant d'une ligne existante (brouillon modifié) : garde son justificatif. */
  id?: string;
  spentOn: string;
  category: ExpenseLineCategory | '';
  label: string;
  amount: string;
  merchant: string;
  missingReceiptReason: string;
  /** Projet RUN imputé, ou `''`. */
  workProjectId: string;
  /** Marque informative ; seulement avec un projet (§ 2.1). */
  rebillable: boolean;
}

export const ligneVide = (jour: string): SaisieLigne => ({
  spentOn: jour,
  category: '',
  label: '',
  amount: '',
  merchant: '',
  missingReceiptReason: '',
  workProjectId: '',
  rebillable: false,
});

export interface LigneLue {
  id?: string;
  spentOn: string;
  category: ExpenseLineCategory;
  label: string;
  amount: string;
  merchant?: string;
  missingReceiptReason?: string;
  workProjectId?: string | null;
  rebillable?: boolean;
}

export type LectureLigne = { ok: true; ligne: LigneLue } | { ok: false; erreurs: string[] };

/**
 * Lit une ligne saisie : date jamais future, catégorie, libellé, montant à la
 * française (chaîne, jamais un nombre). L'API revérifie tout.
 */
export function lireLigne(s: SaisieLigne, aujourdhui: string): LectureLigne {
  const erreurs: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.spentOn)) erreurs.push('Indiquez la date de la dépense.');
  else if (s.spentOn > aujourdhui) erreurs.push('La date de la dépense ne peut pas être future.');
  if (s.category === '') erreurs.push('Choisissez une catégorie.');
  const label = s.label.trim();
  if (label === '') erreurs.push('Indiquez ce qui a été payé.');
  else if (label.length > EXPENSE_LIMITS.lineLabel) {
    erreurs.push(`Libellé : ${EXPENSE_LIMITS.lineLabel} caractères au plus.`);
  }
  const m = lireMontantSaisi(s.amount);
  if (!m.ok) erreurs.push(m.erreur);
  const projet = s.workProjectId.trim();
  if (s.rebillable && projet === '')
    erreurs.push('Une ligne refacturable est imputée à un projet.');
  if (erreurs.length > 0 || s.category === '' || !m.ok) return { ok: false, erreurs };
  const merchant = s.merchant.trim();
  const motif = s.missingReceiptReason.trim();
  return {
    ok: true,
    ligne: {
      ...(s.id ? { id: s.id } : {}),
      spentOn: s.spentOn,
      category: s.category,
      label,
      amount: m.valeur,
      ...(merchant ? { merchant } : {}),
      ...(motif ? { missingReceiptReason: motif } : {}),
      ...(projet ? { workProjectId: projet, rebillable: s.rebillable } : {}),
    },
  };
}

/** Saisie d'une ligne existante (brouillon rouvert) : garde son identifiant. */
export function saisieDepuis(l: {
  id: string;
  spentOn: string;
  category: ExpenseLineCategory;
  label: string;
  amount: string;
  merchant: string | null;
  missingReceiptReason: string | null;
  workProjectId: string | null;
  rebillable: boolean;
}): SaisieLigne {
  return {
    id: l.id,
    spentOn: l.spentOn,
    category: l.category,
    label: l.label,
    amount: l.amount.replace('.', ','),
    merchant: l.merchant ?? '',
    missingReceiptReason: l.missingReceiptReason ?? '',
    workProjectId: l.workProjectId ?? '',
    rebillable: l.rebillable,
  };
}

// ── Justificatif ────────────────────────────────────────────────────────────

const TYPES_IMAGES = ['image/png', 'image/jpeg', 'image/webp'];

/** `accept` du champ fichier : photo du ticket depuis le téléphone, ou PDF. */
export const ACCEPT_JUSTIFICATIF = EXPENSE_RECEIPT_CONTENT_TYPES.join(',');

/**
 * Contrôle préalable d'un justificatif (type et taille) ; `null` s'il est recevable.
 * L'API reste juge (signature réelle du fichier, assainissement des images).
 */
export function controleJustificatif(f: { type: string; size: number }): string | null {
  if (!(EXPENSE_RECEIPT_CONTENT_TYPES as readonly string[]).includes(f.type)) {
    return 'Format refusé : photo (PNG, JPEG, WebP) ou PDF seulement.';
  }
  const max = TYPES_IMAGES.includes(f.type)
    ? EXPENSE_LIMITS.receiptImageMaxBytes
    : EXPENSE_LIMITS.receiptPdfMaxBytes;
  if (f.size > max) {
    return TYPES_IMAGES.includes(f.type)
      ? 'Photo trop lourde : 2 Mo au plus.'
      : 'PDF trop lourd : 10 Mo au plus.';
  }
  return null;
}

/** Un aperçu s'affiche dans la page pour une image ; un PDF s'enregistre (servi inerte). */
export const apercuEnLigne = (contentType: string): boolean => TYPES_IMAGES.includes(contentType);

/** Taille lisible d'un fichier. */
export function taille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

// ── Messages d'erreur propres au second volet ───────────────────────────────

export const MESSAGES_FRAIS: Record<string, string> = {
  HR_FEATURE_DISABLED: 'Cette fonction est éteinte dans les réglages des ressources humaines.',
  EXPENSE_REPORT_CURRENCY_MISMATCH: 'Une note n’a qu’une devise : faites une autre note.',
  EXPENSE_IN_FUTURE: 'La date d’une dépense ne peut pas être future.',
  EXPENSE_LINE_CATEGORY_NOT_ALLOWED:
    'Une immobilisation ou un remboursement d’emprunt passe par les achats.',
  EXPENSE_WORK_PROJECT_UNKNOWN: 'Ce projet n’existe pas ou est archivé.',
  EXPENSE_RECEIPT_TYPE: 'Format refusé : photo (PNG, JPEG, WebP) ou PDF seulement.',
  EXPENSE_RECEIPT_REASON_REQUIRED:
    'Une ligne sans justificatif doit dire pourquoi : ajoutez la photo du ticket ou un motif.',
  SELF_APPROVAL_FORBIDDEN: PHRASES_SEPARATION.beneficiaire,
  CREATOR_APPROVAL_FORBIDDEN: PHRASES_SEPARATION.auteur,
  APPROVER_ALREADY_APPROVED: PHRASES_SEPARATION['deja-valide'],
  EXPENSE_NOT_YOUR_STEP: 'Cette demande attend la décision d’une autre personne.',
  SELF_PAYMENT_FORBIDDEN: 'On ne se rembourse pas soi-même : une autre personne paie.',
  APPROVER_CANNOT_PAY:
    'Vous avez validé cette demande : une autre personne habilitée doit la payer.',
  ADVANCE_KIND_DISABLED: 'Ce type d’avance est éteint dans les réglages.',
  ADVANCE_ABOVE_ORGANIZATION_LIMIT: 'Ce montant dépasse le plafond fixé par votre organisation.',
  ADVANCE_SALARY_NOT_YOUR_STEP:
    'Une avance sur salaire est validée par une personne qui a aussi accès aux données sensibles.',
  ADVANCE_SETTLEMENT_EXCEEDS_OUTSTANDING: 'Ce montant dépasse ce qui reste dû sur l’avance.',
  ADVANCE_DECLARED_PAYROLL_DISABLED: 'La régularisation sur la paie est éteinte dans les réglages.',
  EMPLOYEE_NOT_LINKED:
    'Aucun dossier collaborateur n’est relié à votre compte. Demandez aux ressources humaines de relier votre fiche.',
  STALE_REVISION:
    'La demande a été modifiée entre-temps par quelqu’un d’autre. Rechargez avant de recommencer.',
};
