// Équipements — règles communes aux écrans (ADR-0046 § 3, § 5.2, § 8 ; lot S9).
// Logique pure, testée.
//
// Les droits viennent des ACTIONS servies par `GET /me/permissions` (coquille,
// `useShell().actions`), jamais d'un nom de rôle ; masquer est un confort,
// `PermissionsGuard` refuse côté API de toute façon.
//
// AUCUN calcul : estimation de gestion, coût de possession, échéances, totaux par
// devise viennent du moteur, par l'API. Ce module ne fait que METTRE EN FORME des
// chaînes décimales (groupes de milliers, virgule) et lire des saisies dans la forme
// du contrat (« 1 200,5 » → « 1200.5 »).
//
// VALEURS (§ 5) : coûts et estimation ne s'affichent qu'avec `purchase.read` OU
// `treasury.read`, et seulement si la réponse ne les masque pas (`valuesHidden`).

import type {
  AssetAssigneeView,
  AssetCoverageKind,
  AssetDisposalKind,
  AssetFindingCode,
  AssetMaintenanceKind,
  AssetMaintenanceStatus,
  AssetStatus,
  ExpiryStatus,
} from '@/lib/api-assets';
import type { OrgAction } from '@/lib/api';

export { formatInstantJour, formatJour } from '../../achats/_components/achats-model';

export const EQUIPEMENTS_BASE = '/equipements';

type Actions = readonly OrgAction[] | null;

const a = (actions: Actions, action: OrgAction): boolean =>
  actions !== null && actions.includes(action);

export const peutLireEquipements = (x: Actions): boolean => a(x, 'assets.read');
export const peutGererEquipements = (x: Actions): boolean => a(x, 'assets.manage');
/** Export du registre : `assets.read` ET `report.export` (§ 5.2). */
export const peutExporterRegistre = (x: Actions): boolean =>
  a(x, 'assets.read') && a(x, 'report.export');

/** Le rôle voit-il les valeurs ? `purchase.read` OU `treasury.read` (§ 5). */
export function peutVoirValeurs(x: Actions): boolean {
  return a(x, 'purchase.read') || a(x, 'treasury.read');
}

/** Afficher les valeurs d'une réponse : le rôle les permet ET l'API ne les masque pas. */
export function valeursAffichees(x: Actions, valuesHidden: boolean | undefined): boolean {
  return peutVoirValeurs(x) && valuesHidden !== true;
}

// ── Liens ───────────────────────────────────────────────────────────────────

export const lienEquipement = (id: string): string =>
  `${EQUIPEMENTS_BASE}/${encodeURIComponent(id)}`;

// ── Lectures ────────────────────────────────────────────────────────────────

export type Lecture<T> = { ok: true; valeur: T } | { ok: false; erreur: unknown };

/** Transforme une promesse en lecture, sans jamais rejeter. */
export function lire<T>(p: Promise<T>): Promise<Lecture<T>> {
  return p.then(
    (valeur) => ({ ok: true as const, valeur }),
    (erreur: unknown) => ({ ok: false as const, erreur }),
  );
}

export function statutDe(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}

function codeDe(err: unknown): string | null {
  const detail = (err as { detail?: unknown } | null)?.detail;
  if (typeof detail !== 'object' || detail === null) return null;
  const code = (detail as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

const MESSAGES: Record<string, string> = {
  STALE_REVISION:
    'Cette fiche a été modifiée entre-temps par quelqu’un d’autre. Rechargez la page avant de recommencer.',
  ASSET_TAG_EXISTS: 'Un autre équipement porte déjà cette étiquette.',
  ASSET_DISPOSED: 'Cet équipement est cédé : réintégrez-le d’abord.',
  ASSET_NOT_DISPOSED: 'Cet équipement n’est pas cédé.',
  ASSET_ALREADY_ASSIGNED: 'Cet équipement est déjà affecté à ce bénéficiaire.',
  ASSET_ASSIGNMENT_OVERLAP:
    'Affectation refusée : elle chevaucherait une affectation existante. La date de remise ne peut pas précéder la dernière remise ou le dernier retour de cet équipement.',
  ASSET_ASSIGNMENT_HISTORY_INVALID:
    'L’historique des affectations de cet équipement est incohérent : rien n’a été enregistré.',
  ASSET_NOT_ASSIGNED: 'Cet équipement n’est affecté à personne : rien à retourner.',
  ASSET_CATEGORY_NAME_EXISTS: 'Une catégorie porte déjà ce nom.',
  CURRENCY_REQUIRED: 'Un montant exige sa devise.',
  END_BEFORE_START: 'La date de fin précède la date de début.',
  RECURRENCE_PREVENTIVE_ONLY: 'Seule une maintenance préventive se répète.',
  INVALID_DATE: 'Date invalide.',
  INVALID_AMOUNT: 'Montant invalide : deux décimales au plus.',
};

/** Le refus de chevauchement, à afficher clairement (§ 3.2). */
export function estRefusChevauchement(err: unknown): boolean {
  const c = codeDe(err);
  return c === 'ASSET_ASSIGNMENT_OVERLAP' || c === 'ASSET_ALREADY_ASSIGNED';
}

/** Message d'une erreur d'API des équipements, en français clair. */
export function messageEquipements(err: unknown, repli: string): string {
  if (typeof err !== 'object' || err === null) return repli;
  const code = codeDe(err);
  if (code !== null && MESSAGES[code]) return MESSAGES[code]!;
  const status = statutDe(err);
  if (status === 403) return 'Votre rôle ne permet pas cette action sur les équipements.';
  if (status === 404) return 'Élément introuvable : il a peut-être été supprimé.';
  if (status === 429) return 'Trop de demandes en peu de temps : réessayez plus tard.';
  const detail = (err as { detail?: unknown }).detail;
  if (typeof detail === 'object' && detail !== null) {
    const m = (detail as { message?: unknown }).message;
    if (typeof m === 'string' && m !== '') return m;
  }
  return repli;
}

// ── Mise en forme (aucun calcul) ────────────────────────────────────────────

const INSECABLE = ' ';
const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Montant de l'API (`"1200.00"`) → « 1 200,00 USD ». */
export function formatMontant(v: string | null | undefined, devise: string | null): string {
  if (v === null || v === undefined) return '—';
  const suffixe = devise ? `${INSECABLE}${devise}` : '';
  const m = DECIMAL.exec(v.trim());
  if (m === null) return `${v}${suffixe}`;
  const fraction = (m[3] ?? '').padEnd(2, '0');
  const entier = m[2]!.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, INSECABLE);
  const nul = /^0*$/.test(m[2]!) && /^0*$/.test(fraction);
  return `${m[1] === '-' && !nul ? '−' : ''}${entier},${fraction}${suffixe}`;
}

/** Pourcentage servi par l'API (`"33.33"`) → « 33,33 % ». */
export function formatPourcentage(v: string | null): string {
  if (v === null) return '—';
  return `${v.replace('.', ',')}${INSECABLE}%`;
}

export type LectureSaisie = { ok: true; valeur: string } | { ok: false; erreur: string };

/** Montant saisi (« 1 200,5 ») → chaîne du contrat (« 1200.5 »), deux décimales au plus. */
export function lireMontantSaisi(saisie: string): LectureSaisie {
  const s = saisie.replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '') return { ok: false, erreur: 'Saisissez un montant.' };
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(s)) {
    return {
      ok: false,
      erreur: 'Montant invalide : deux décimales au plus, par exemple 1 200,50.',
    };
  }
  return { ok: true, valeur: s };
}

/** Montant de l'API → texte à éditer (`"1200.00"` → `"1200,00"`). */
export function montantPourSaisie(v: string | null | undefined): string {
  return v ? v.replace('.', ',') : '';
}

/** Entier saisi dans une borne (durée, rappel, récurrence). */
export function lireEntierSaisi(
  saisie: string,
  min: number,
  max: number,
): { ok: true; valeur: number } | { ok: false; erreur: string } {
  const s = saisie.trim();
  if (!/^\d{1,4}$/.test(s))
    return { ok: false, erreur: `Nombre entier attendu (${min} à ${max}).` };
  const n = Number(s);
  if (n < min || n > max) return { ok: false, erreur: `Entre ${min} et ${max}.` };
  return { ok: true, valeur: n };
}

/** Jour civil à Kinshasa (`AAAA-MM-JJ`) : valeur par défaut d'une date. */
export function jourKinshasa(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kinshasa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export const estJour = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v);

// ── Libellés ────────────────────────────────────────────────────────────────

export type Ton = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const LIBELLES_STATUT: Record<AssetStatus, string> = {
  in_service: 'En service',
  in_storage: 'En réserve',
  under_maintenance: 'En maintenance',
  lost: 'Perdu',
  disposed: 'Cédé ou mis au rebut',
};

export function tonStatut(s: AssetStatus): Ton {
  switch (s) {
    case 'in_service':
      return 'success';
    case 'under_maintenance':
      return 'warning';
    case 'lost':
      return 'danger';
    case 'disposed':
      return 'neutral';
    default:
      return 'info';
  }
}

export const LIBELLES_CESSION: Record<AssetDisposalKind, string> = {
  scrapped: 'Mis au rebut',
  sold: 'Vendu',
  donated: 'Donné',
  lost: 'Perdu',
  stolen: 'Volé',
  returned: 'Rendu au fournisseur ou au loueur',
};

export const LIBELLES_MAINTENANCE: Record<AssetMaintenanceKind, string> = {
  preventive: 'Préventive',
  corrective: 'Corrective (réparation)',
  inspection: 'Contrôle',
};

export const LIBELLES_STATUT_MAINTENANCE: Record<AssetMaintenanceStatus, string> = {
  planned: 'Prévue',
  done: 'Faite',
  cancelled: 'Annulée',
};

export const LIBELLES_COUVERTURE: Record<AssetCoverageKind, string> = {
  warranty: 'Garantie',
  insurance: 'Assurance',
  service_contract: 'Contrat d’entretien',
};

export const LIBELLES_EXPIRATION: Record<ExpiryStatus, string> = {
  expired: 'Expirée',
  due_soon: 'Expire bientôt',
  ok: 'En cours',
};

export function tonExpiration(s: ExpiryStatus): Ton {
  return s === 'expired' ? 'danger' : s === 'due_soon' ? 'warning' : 'success';
}

export const LIBELLES_CONSTAT: Record<AssetFindingCode, string> = {
  ASSET_SERIAL_DUPLICATE: 'Numéro de série porté par un autre équipement',
  ASSET_HELD_BY_FORMER_EMPLOYEE: 'Encore chez un collaborateur sorti',
  INVESTMENT_EXPENSES_WITHOUT_ASSET: 'Dépenses d’investissement sans équipement',
};

/** Qui détient l'équipement, en une phrase (aucune donnée RH sensible). */
export function libelleBeneficiaire(b: AssetAssigneeView | null | undefined): string {
  if (!b) return 'Personne';
  switch (b.kind) {
    case 'employee': {
      const nom = b.name ?? 'Collaborateur';
      const poste = b.jobTitle ? ` (${b.jobTitle})` : '';
      return `${nom}${poste}${b.exited ? ' — sorti de l’organisation' : ''}`;
    }
    case 'project':
      return `Projet ${b.name ?? ''}`.trim();
    case 'location':
      return `Emplacement ${b.name ?? ''}`.trim();
    case 'member':
      return b.name ?? 'Membre de l’organisation';
  }
}
