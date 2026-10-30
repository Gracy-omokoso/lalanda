// Collaborateurs (ADR-0045 § 2.1, § 3.1) — logique pure de la liste et du
// formulaire de fiche, lot H6. Dossier NON sensible seulement : ni salaire, ni
// coordonnées bancaires, ni pièce d'identité, ni coordonnées personnelles.
//
// Les vérifications sont de forme (requis, bornes, ordre des dates) ; matricule
// unique, manager sans cycle, compte membre sont jugés par l'API.

import { HR_DEFAULT_CONTRACT_TYPES, HR_LIMITS, type EmployeeStatus } from '@lalanda/shared/hr';

import type { OrgAction } from '@/lib/api';
import type {
  HrEmployeeInput,
  HrEmployeeListItem,
  HrEmployeeView,
  HrSettingsContractType,
  ListEmployeesParams,
} from '@/lib/api-hr';

import { formatJour, nomAffiche } from './rh-model';

// ── Liste ───────────────────────────────────────────────────────────────────

export interface FiltresCollaborateurs {
  q: string;
  statut: EmployeeStatus | '';
  departmentId: string;
}

export const FILTRES_COLLABORATEURS_INITIAUX: FiltresCollaborateurs = {
  q: '',
  statut: 'active',
  departmentId: '',
};

export function requeteCollaborateurs(
  f: FiltresCollaborateurs,
  cursor: string | null,
): ListEmployeesParams {
  const q = f.q.trim().slice(0, HR_LIMITS.search);
  return {
    ...(q ? { q } : {}),
    ...(f.statut ? { status: f.statut } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(cursor ? { cursor } : {}),
    limit: 50,
  };
}

/** Types de contrat : ceux des réglages, sinon les valeurs proposées à l'activation. */
export function typesContrat(
  reglages: readonly HrSettingsContractType[] | null,
): readonly HrSettingsContractType[] {
  return reglages && reglages.length > 0 ? reglages : HR_DEFAULT_CONTRACT_TYPES;
}

export function libelleContrat(
  e: Pick<HrEmployeeListItem, 'contractType' | 'contractTypeLabel'>,
  types: readonly HrSettingsContractType[],
): string {
  return (
    e.contractTypeLabel ?? types.find((t) => t.key === e.contractType)?.label ?? e.contractType
  );
}

/** Sous-titre d'une carte : poste, service, entrée. */
export function sousTitreCarte(e: HrEmployeeListItem): string {
  return [e.jobTitle, e.departmentName, `Entré le ${formatJour(e.startDate)}`]
    .filter(Boolean)
    .join(' · ');
}

// ── Formulaire de fiche ─────────────────────────────────────────────────────

export interface FormCollaborateur {
  firstName: string;
  lastName: string;
  preferredName: string;
  employeeNumber: string;
  jobTitle: string;
  departmentId: string;
  managerEmployeeId: string;
  contractType: string;
  startDate: string;
  probationEndDate: string;
  contractEndDate: string;
  workEmail: string;
  workPhone: string;
  workLocation: string;
  notes: string;
}

export function formCollaborateur(
  e: HrEmployeeView | null,
  contratParDefaut: string,
  aujourdhui: string,
): FormCollaborateur {
  return {
    firstName: e?.firstName ?? '',
    lastName: e?.lastName ?? '',
    preferredName: e?.preferredName ?? '',
    employeeNumber: e?.employeeNumber ?? '',
    jobTitle: e?.jobTitle ?? '',
    departmentId: e?.departmentId ?? '',
    managerEmployeeId: e?.managerEmployeeId ?? '',
    contractType: e?.contractType ?? contratParDefaut,
    startDate: e?.startDate ?? aujourdhui,
    probationEndDate: e?.probationEndDate ?? '',
    contractEndDate: e?.contractEndDate ?? '',
    workEmail: e?.workEmail ?? '',
    workPhone: e?.workPhone ?? '',
    workLocation: e?.workLocation ?? '',
    notes: e?.notes ?? '',
  };
}

export type ChampCollaborateur = keyof FormCollaborateur;
export type ErreursCollaborateur = Partial<Record<ChampCollaborateur, string>>;

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEPHONE = /^\+?[0-9][0-9 .-]{6,19}$/;

const BORNES: Partial<Record<ChampCollaborateur, number>> = {
  firstName: HR_LIMITS.firstName,
  lastName: HR_LIMITS.lastName,
  preferredName: HR_LIMITS.preferredName,
  employeeNumber: HR_LIMITS.employeeNumber,
  jobTitle: HR_LIMITS.jobTitle,
  workEmail: HR_LIMITS.workEmail,
  workPhone: HR_LIMITS.workPhone,
  workLocation: HR_LIMITS.workLocation,
  notes: HR_LIMITS.notes,
};

const vide = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export function validerCollaborateur(
  f: FormCollaborateur,
  types: readonly HrSettingsContractType[],
  selfId: string | null = null,
): { ok: true; corps: HrEmployeeInput } | { ok: false; erreurs: ErreursCollaborateur } {
  const e: ErreursCollaborateur = {};
  if (f.firstName.trim() === '') e.firstName = 'Le prénom est obligatoire.';
  if (f.lastName.trim() === '') e.lastName = 'Le nom est obligatoire.';
  if (f.jobTitle.trim() === '') e.jobTitle = 'Le poste est obligatoire.';
  for (const [champ, max] of Object.entries(BORNES) as [ChampCollaborateur, number][]) {
    if (!e[champ] && f[champ].trim().length > max) e[champ] = `${max} caractères au plus.`;
  }
  const type = types.find((t) => t.key === f.contractType);
  if (!type) e.contractType = 'Choisissez un type de contrat.';
  if (!JOUR.test(f.startDate)) e.startDate = 'La date d’entrée est obligatoire.';
  if (f.probationEndDate && JOUR.test(f.startDate) && f.probationEndDate < f.startDate) {
    e.probationEndDate = 'La fin d’essai ne peut pas précéder l’entrée.';
  }
  if (type?.hasEndDate && f.contractEndDate === '') {
    e.contractEndDate = `Un contrat « ${type.label} » porte une date de fin.`;
  } else if (f.contractEndDate && JOUR.test(f.startDate) && f.contractEndDate < f.startDate) {
    e.contractEndDate = 'La fin de contrat ne peut pas précéder l’entrée.';
  }
  if (!e.workEmail && f.workEmail.trim() !== '' && !EMAIL.test(f.workEmail.trim())) {
    e.workEmail = 'Adresse e-mail invalide.';
  }
  if (!e.workPhone && f.workPhone.trim() !== '' && !TELEPHONE.test(f.workPhone.trim())) {
    e.workPhone = 'Numéro de téléphone invalide.';
  }
  if (selfId !== null && f.managerEmployeeId === selfId) {
    e.managerEmployeeId = 'Un collaborateur ne peut pas être son propre manager.';
  }
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };
  return {
    ok: true,
    corps: {
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      preferredName: vide(f.preferredName),
      employeeNumber: vide(f.employeeNumber),
      jobTitle: f.jobTitle.trim(),
      departmentId: vide(f.departmentId),
      managerEmployeeId: vide(f.managerEmployeeId),
      contractType: f.contractType,
      startDate: f.startDate,
      probationEndDate: vide(f.probationEndDate),
      contractEndDate: vide(f.contractEndDate),
      workEmail: vide(f.workEmail),
      workPhone: vide(f.workPhone),
      workLocation: vide(f.workLocation),
      notes: vide(f.notes),
    },
  };
}

/** Managers proposés : les collaborateurs actifs, sauf la fiche elle-même. */
export function managersProposes(
  employes: readonly HrEmployeeListItem[],
  selfId: string | null,
): { id: string; nom: string }[] {
  return employes
    .filter((x) => x.status === 'active' && x.id !== selfId)
    .map((x) => ({ id: x.id, nom: `${nomAffiche(x)} — ${x.jobTitle}` }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

// ── Fiche (onglets) ─────────────────────────────────────────────────────────

export interface OngletFiche {
  id: 'dossier' | 'absences' | 'sensible' | 'documents' | 'parcours';
  libelle: string;
  /** Segment après `/rh/collaborateurs/[id]` (vide pour le dossier). */
  segment: string;
}

/**
 * Onglets de la fiche (§ 8), dans l'ordre d'affichage. Données sensibles,
 * documents et entrées et sorties sont livrés par le lot H7.
 */
export const ONGLETS_FICHE: readonly OngletFiche[] = [
  { id: 'dossier', libelle: 'Dossier', segment: '' },
  { id: 'sensible', libelle: 'Données sensibles', segment: 'sensible' },
  { id: 'absences', libelle: 'Absences et soldes', segment: 'absences' },
  { id: 'documents', libelle: 'Documents', segment: 'documents' },
  { id: 'parcours', libelle: 'Entrées et sorties', segment: 'parcours' },
];

export const ONGLETS_FICHE_PREVUS = [
  'dossier',
  'sensible',
  'absences',
  'documents',
  'parcours',
] as const;

/**
 * Onglets offerts au lecteur (ADR-0045 § 8, § 3.3) : les données sensibles avec
 * `hr.sensitive.read` ou pour soi ; les documents avec `hr.read` ou pour soi (le
 * manager, non) ; les entrées et sorties avec `hr.read`. Masquer est un confort :
 * l'API refuse de toute façon.
 */
export function ongletsVisibles(
  actions: readonly OrgAction[] | null,
  estSoi: boolean,
): readonly OngletFiche[] {
  const has = (x: OrgAction): boolean => actions !== null && actions.includes(x);
  return ONGLETS_FICHE.filter((o) => {
    switch (o.id) {
      case 'sensible':
        return estSoi || has('hr.sensitive.read');
      case 'documents':
        return estSoi || has('hr.read');
      case 'parcours':
        return has('hr.read');
      default:
        return true;
    }
  });
}

/** Onglet allumé par le chemin. */
export function ongletActif(pathname: string, base: string): OngletFiche['id'] {
  const reste = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, '') : '';
  const segment = reste.split('/')[0] ?? '';
  return ONGLETS_FICHE.find((o) => o.segment === segment)?.id ?? 'dossier';
}

/** Lignes du dossier, dans l'ordre d'affichage ; les champs vides sont omis. */
export function lignesDossier(
  e: HrEmployeeView,
  types: readonly HrSettingsContractType[],
): [string, string][] {
  const lignes: [string, string | null | undefined][] = [
    ['Poste', e.jobTitle],
    ['Service', e.departmentName],
    ['Manager', e.managerName],
    ['Type de contrat', libelleContrat(e, types)],
    ['Date d’entrée', formatJour(e.startDate)],
    ['Fin de période d’essai', e.probationEndDate ? formatJour(e.probationEndDate) : null],
    ['Fin de contrat', e.contractEndDate ? formatJour(e.contractEndDate) : null],
    ['Date de sortie', e.endDate ? formatJour(e.endDate) : null],
    ['Matricule', e.employeeNumber],
    ['Lieu de travail', e.workLocation],
    ['E-mail professionnel', e.workEmail],
    ['Téléphone professionnel', e.workPhone],
    ['Compte Lalanda', e.userId ? 'Relié à un membre' : 'Sans compte'],
  ];
  return lignes.filter((l): l is [string, string] => typeof l[1] === 'string' && l[1] !== '');
}

// ── Lien depuis la page des membres (ADR-0045 § 6.6) — lot H7 ──────────────

/**
 * Fiche RH de chaque compte relié : `userId` → lien vers la fiche. Les fiches
 * anonymisées (compte délié par l'API) ne figurent pas ; un compte relié à deux
 * fiches est impossible (unicité tenue par l'API), la première l'emporte.
 */
export function fichesParCompte(
  employes: readonly Pick<HrEmployeeListItem, 'id' | 'userId' | 'status'>[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of employes) {
    if (e.userId && e.status !== 'anonymized' && !m.has(e.userId)) {
      m.set(e.userId, `/rh/collaborateurs/${encodeURIComponent(e.id)}`);
    }
  }
  return m;
}
