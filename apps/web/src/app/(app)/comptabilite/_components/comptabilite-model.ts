// Comptabilité — règles communes aux écrans (ADR-0049 § 3.1, § 8, § 10, § 13), lot K8.
// Logique pure, testée sans DOM.
//
// Les droits viennent des ACTIONS servies par `GET /me/permissions` (coquille), jamais
// d'un nom de rôle — sauf la réouverture d'une période, réservée au Propriétaire par
// l'ADR (§ 4, `REOPEN_OWNER_ONLY`) : seul cas où le titre compte, et l'API refuse de
// toute façon.
//
// AUCUN calcul : montants, soldes, totaux et réserves viennent de l'API (moteur). Ce
// module ne fait que METTRE EN FORME des chaînes décimales. AUCUN numéro de compte n'est
// écrit ici : les comptes viennent du pack et des règles validées de l'organisation.

import {
  ACCOUNTING_ACTIVATABLE_PACK_STATUSES,
  ACCOUNTING_MODE_BANNERS,
  type AccountingChartPackStatus,
  type AccountingMode,
} from '@lalanda/shared/accounting';

import type { OrgAction, OrgRole } from '@/lib/api';

export { formatInstantJour, formatJour } from '../../achats/_components/achats-model';
export { formatValeur, lire, statutDe, type Lecture } from '../../stocks/_components/stocks-model';

import { formatValeur } from '../../stocks/_components/stocks-model';

export const COMPTA_BASE = '/comptabilite';

type Actions = readonly OrgAction[] | null;

const a = (actions: Actions, action: OrgAction): boolean =>
  actions !== null && actions.includes(action);

export const peutLireCompta = (x: Actions): boolean => a(x, 'accounting.read');
export const peutSaisir = (x: Actions): boolean => a(x, 'accounting.post');
export const peutCloturer = (x: Actions): boolean => a(x, 'accounting.close');
export const peutExporter = (x: Actions): boolean => a(x, 'accounting.export');
export const peutParametrer = (x: Actions): boolean => a(x, 'accounting.manage');
/** Activer engage l'organisation : `accounting.manage` ET `fiscal.manage` (§ 3.1). */
export const peutActiver = (x: Actions): boolean =>
  a(x, 'accounting.manage') && a(x, 'fiscal.manage');
/** Réouverture d'un mois ou d'un exercice : Propriétaire seul (§ 4). */
export const peutRouvrir = (role: OrgRole | null | undefined): boolean => role === 'owner';

// ── Bandeaux (§ 3.1, § 10) ──────────────────────────────────────────────────

export interface BandeauCompta {
  id: 'projet' | 'simulation';
  ton: 'info' | 'warning';
  texte: string;
}

/**
 * Bandeaux de TOUT écran de la comptabilité, quel que soit l'état (chargement, vide,
 * erreur, mode inconnu) : le bandeau « Projet — à valider par un expert-comptable » est
 * TOUJOURS présent ; en simulation, le bandeau « Simulation » passe devant.
 * Les textes viennent de `@lalanda/shared/accounting`, jamais recopiés.
 */
export function bandeauxCompta(mode: AccountingMode | null): BandeauCompta[] {
  const projet: BandeauCompta = {
    id: 'projet',
    ton: 'info',
    texte: ACCOUNTING_MODE_BANNERS.active,
  };
  if (mode === 'simulation') {
    return [
      { id: 'simulation', ton: 'warning', texte: ACCOUNTING_MODE_BANNERS.simulation },
      projet,
    ];
  }
  return [projet];
}

export const LIBELLES_MODE: Record<AccountingMode, string> = {
  off: 'Éteinte',
  simulation: 'Simulation',
  active: 'Tenue active',
};

export const EXPLICATIONS_MODE: Record<AccountingMode, string> = {
  off: 'Rien n’est lu, rien n’est calculé. Vos ventes, dépenses et paiements continuent comme avant.',
  simulation:
    'Lalanda calcule à la volée les écritures, la balance et les projets d’états à partir de vos pièces. Rien n’est enregistré, rien n’est numéroté.',
  active:
    'Les écritures sont enregistrées, numérotées et chaînées ; les mois se clôturent ; les exports sont prêts pour votre expert-comptable.',
};

// ── Pack et mode actif (§ 3.1, décision ouverte n° 5) ───────────────────────

export const LIBELLES_STATUT_PACK: Record<AccountingChartPackStatus, string> = {
  draft: 'Brouillon, non relu',
  review: 'En relecture chez l’expert-comptable',
  approved: 'Relu et approuvé',
  active: 'En service',
  retired: 'Retiré',
};

/** Le statut du pack permet-il le mode `active` ? */
export function packActivable(statut: AccountingChartPackStatus | null | undefined): boolean {
  return (
    statut !== null && statut !== undefined && ACCOUNTING_ACTIVATABLE_PACK_STATUSES.includes(statut)
  );
}

// ── Erreurs ─────────────────────────────────────────────────────────────────

/** Phrase d'une route d'API pas encore livrée (404) : jamais de donnée inventée. */
export const PHRASE_BIENTOT =
  'Bientôt disponible : cette partie de la comptabilité arrive avec une prochaine livraison. Rien n’est affiché plutôt que des chiffres inventés.';

const MESSAGES: Record<string, string> = {
  ACCOUNTING_ACTIVATION_PRECONDITION:
    'La tenue active n’est pas encore possible : des conditions manquent (voir la liste).',
  BOOK_CURRENCY_LOCKED: 'La monnaie de tenue ne change plus après la première écriture validée.',
  CUTOVER_LOCKED: 'La date de bascule ne change plus après la première écriture validée.',
  SELF_APPROVAL_FORBIDDEN:
    'Vous êtes l’auteur : une autre personne habilitée doit valider (séparation des tâches).',
  EXPERT_REVIEW_DECLARATION_REQUIRED:
    'Indiquez le nom de votre expert-comptable et la date de sa relecture avant de valider les règles.',
  RULE_SET_IMMUTABLE: 'Cette version des règles est validée : elle ne se modifie plus.',
  ENTRY_UNBALANCED: 'L’écriture n’est pas équilibrée : total des débits différent des crédits.',
  ACCOUNTING_PERIOD_CLOSED: 'Ce mois est clos : aucune écriture nouvelle n’y entre.',
  ENTRY_ALREADY_REVERSED: 'Cette écriture a déjà été contre-passée.',
  ENTRY_NOT_DRAFT: 'Seul un brouillon se modifie ou se supprime.',
  PERIOD_HAS_DRAFTS: 'Des brouillons occupent encore ce mois : validez-les ou supprimez-les.',
  FISCAL_YEAR_NOT_CLOSABLE: 'L’exercice ne peut pas encore être clos (voir les conditions).',
  REOPEN_OWNER_ONLY: 'Seul le Propriétaire de l’organisation rouvre une période.',
  REOPEN_REASON_REQUIRED: 'Le motif de réouverture est obligatoire.',
  STATEMENT_NOT_AVAILABLE:
    'Cet état n’est pas disponible tant que votre expert-comptable n’a pas précisé sa méthode.',
  LETTERING_NOT_BALANCED: 'Les lignes choisies ne se compensent pas : le lettrage est refusé.',
  LETTERING_MIXED_ACCOUNTS: 'Le lettrage porte sur les lignes d’un seul et même compte.',
  STALE_REVISION:
    'Ces réglages ont été modifiés entre-temps. Rechargez la page avant de recommencer.',
};

interface ErreurApi {
  status?: unknown;
  detail?: unknown;
}

export function codeDe(err: unknown): string | null {
  const detail = (err as ErreurApi | null)?.detail;
  if (typeof detail !== 'object' || detail === null) return null;
  const code = (detail as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function statut(err: unknown): number | null {
  const s = (err as ErreurApi | null)?.status;
  return typeof s === 'number' ? s : null;
}

/** La route n'existe pas encore sur ce serveur (lot pas encore fusionné) ? */
export const estBientot = (err: unknown): boolean => statut(err) === 404;

/** Message d'une erreur d'API comptable, en français simple. */
export function messageCompta(err: unknown, repli: string): string {
  if (typeof err !== 'object' || err === null) return repli;
  const code = codeDe(err);
  if (code !== null && MESSAGES[code]) return MESSAGES[code]!;
  const s = statut(err);
  if (s === 403) return 'Votre rôle ne permet pas cette action sur la comptabilité.';
  if (s === 404) return PHRASE_BIENTOT;
  if (s === 429) return 'Trop de demandes en peu de temps : réessayez plus tard.';
  return repli;
}

/** Phrase d'une tuile illisible : jamais un zéro inventé. */
export function phraseIndisponible(erreur: unknown): string {
  const s = statut(erreur);
  if (s === 404) return 'Bientôt disponible';
  if (s === 403) return 'Réservé à d’autres rôles';
  return 'Lecture impossible pour le moment';
}

// ── Montants (mise en forme seulement, aucun calcul) ────────────────────────

/** Montant de l'API sans devise (« 1 234,50 ») ; vide si absent. */
export function formatMontant(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  return formatValeur(v, '').trim();
}

/**
 * Solde signé de l'API (débit − crédit) → « 1 234,50 D » ou « 1 234,50 C ». Seul le
 * SIGNE est lu pour choisir le sens ; le montant est celui de l'API.
 */
export function formatSolde(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const t = v.trim();
  const negatif = t.startsWith('-');
  const absolu = negatif ? t.slice(1) : t;
  if (/^0*(\.0*)?$/.test(absolu)) return '0,00';
  return `${formatMontant(absolu)} ${negatif ? 'C' : 'D'}`;
}

// ── Périodes (aucune date inventée : bornes choisies par l'utilisateur) ─────

/** `AAAA-MM` → `{ from, to }` du mois civil (premier et dernier jour). */
export function bornesDuMois(mois: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mois);
  if (m === null) return null;
  const annee = Number(m[1]);
  const n = Number(m[2]);
  if (n < 1 || n > 12) return null;
  const bissextile = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
  const jours = [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][n - 1]!;
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(jours).padStart(2, '0')}` };
}

/** Mois civil à Kinshasa d'un instant (`AAAA-MM`), pour l'état initial des filtres. */
export function moisDe(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kinshasa',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(instant);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const mo = parts.find((p) => p.type === 'month')?.value ?? '';
  return `${y}-${mo}`;
}

const MOIS_LONGS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** `AAAA-MM` ou (année, mois) → « octobre 2026 ». */
export function libelleMois(annee: number, mois: number): string {
  return `${MOIS_LONGS[mois - 1] ?? String(mois)} ${annee}`;
}

// ── Glossaire (infobulles, § 13 : chaque terme comptable expliqué) ──────────

export const GLOSSAIRE = {
  ecriture:
    'Une écriture enregistre une opération : des montants au débit et au crédit de comptes, toujours équilibrés, reliée à sa pièce (facture, dépense, paiement…).',
  journal:
    'Un journal regroupe les écritures d’une même nature : ventes, achats, trésorerie, opérations diverses, à-nouveaux.',
  grandLivre:
    'Le grand livre montre, compte par compte, toutes les écritures validées et le solde qui en résulte.',
  balance:
    'La balance résume chaque compte : ce qu’il avait au début, ce qui a bougé au débit et au crédit, et ce qu’il a à la fin.',
  auxiliaire:
    'Un compte auxiliaire suit un client ou un fournisseur précis, sous le compte collectif des clients ou des fournisseurs.',
  lettrage:
    'Lettrer, c’est relier une facture et son règlement quand ils se compensent : ce qui reste non lettré est encore dû.',
  attente:
    'Le compte d’attente reçoit ce qu’aucune règle validée ne sait classer. Tant qu’il n’est pas soldé, les états sont incomplets.',
  monnaieTenue:
    'La monnaie dans laquelle sont tenus la balance et les états. Chaque ligne garde aussi le montant dans la devise de la pièce.',
  bascule:
    'La date à partir de laquelle Lalanda passe les pièces en écritures. La situation à cette date entre par des à-nouveaux de reprise.',
  contrePassation:
    'Une écriture validée ne se supprime jamais : on l’annule par une écriture inverse, la contre-passation.',
  reserve:
    'Une réserve dit pourquoi un chiffre peut encore changer ou rester incomplet. Elle est toujours affichée et imprimée.',
  regle:
    'Une règle de correspondance dit sur quels comptes va une opération (une vente, une dépense…). Elle est validée par votre organisation après relecture.',
} as const;
