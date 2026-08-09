// Client HTTP typé pour appeler apps/api. Toutes les requêtes envoient les cookies
// de session (`credentials: 'include'`) — sinon AuthGuard renvoie 401.

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export interface ProjectView {
  id: string;
  organizationId: string;
  createdBy: string;
  name: string;
  templateSlug: string;
  pays: string;
  parameterPackSlug: string;
  systemeComptable: string;
  deviseAffichage: string;
  driverValues: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

// ─── Parameter Packs (multi-pays, S9) ─────────────────────────
export interface ParameterPackSummary {
  slug: string;
  pays: string;
  pays_couverts?: string[];
  annee: number;
  systeme_comptable: string;
  devise_principale: 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR';
  devise_secondaire?: 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR';
  label: string;
  description?: string;
}

/** (S18c) Paramètre fiscal d'un pack, avec son doute d'audit `a_confirmer`. */
export interface ParameterPackParam {
  valeur: number;
  unite?: string;
  aide?: string;
  source?: string;
  a_confirmer: boolean;
}

/** Pack complet servi par `GET /parameter-packs/:slug` — utilisé par la synthèse. */
export interface ParameterPackDetail extends ParameterPackSummary {
  params: Record<string, ParameterPackParam>;
  /** Note d'avertissement légal du pack (également reprise dans le PDF). */
  avertissement?: string;
}

export interface LineResult {
  sheetId: string;
  lineId: string;
  label: string;
  formulaSource: string;
  value: number;
  format: 'money' | 'number' | 'percent';
  /** (S10) Feu tricolore, présent seulement pour les lignes avec seuil_pack + pack chargé. */
  seuil?: {
    valeur: number;
    direction: 'min' | 'max';
    statut: 'vert' | 'orange' | 'rouge';
  };
}

/** (S14c) Feuille amortissements SYSCOHADA renvoyée par l'API. */
export interface AmortissementsLigne {
  label: string;
  categorie: string;
  montantHt: number;
  valeurResiduelle: number;
  dureeAnnees: number;
  dateAcquisition: string;
  prorataPremiereAnnee: number;
  dotations: number[];
  vnc: number[];
}

export interface AmortissementsView {
  horizonAnnees: number;
  lignes: AmortissementsLigne[];
  dapParAnnee: number[];
  vncParAnnee: number[];
}

/**
 * (S18a, FIN-001) États financiers prévisionnels renvoyés par l'API.
 * Les mêmes chiffres existent dans `lines` (feuilles `bilan`, `caf`,
 * `seuil_rentabilite`, lignes `pf_bfr_*`) ; cette structure sert aux tableaux
 * matriciels du dashboard (postes × exercices).
 */
export interface BilanExercice {
  annee: number;
  immobilisationsBrutes: number;
  amortissementsCumules: number;
  actifImmobilise: number;
  stocks: number;
  creancesClients: number;
  actifCirculant: number;
  tresorerieActif: number;
  totalActif: number;
  capitalApporte: number;
  resultatsCumules: number;
  capitauxPropres: number;
  dettesFinancieres: number;
  fournisseurs: number;
  dettesFiscalesSociales: number;
  totalPassif: number;
  ecartEquilibre: number;
  autonomieFinanciere: number;
}

export interface BfrExercice {
  annee: number;
  stocks: number;
  creancesClients: number;
  dettesFournisseurs: number;
  dettesFiscalesSociales: number;
  bfr: number;
  variation: number;
  bfrJoursCa: number;
}

export interface CafExercice {
  annee: number;
  resultatNet: number;
  dotationsAmortissements: number;
  caf: number;
}

export interface SeuilExercice {
  annee: number;
  ca: number;
  chargesVariables: number;
  margeSurCoutsVariables: number;
  tauxMargeVariable: number;
  chargesFixes: number;
  caSeuil: number;
  pointMortMois: number;
  pointMortJours: number;
  margeSecurite: number;
}

export interface EcheanceDette {
  annee: number;
  capitalRestantOuverture: number;
  remboursementCapital: number;
  interets: number;
  capitalRestantCloture: number;
}

export interface EtatsFinanciersView {
  horizonAnnees: number;
  ouverture: {
    actifImmobilise: number;
    actifCirculant: number;
    tresorerieActif: number;
    totalActif: number;
    capitauxPropres: number;
    dettesFinancieres: number;
    totalPassif: number;
    ecartEquilibre: number;
  };
  bilan: BilanExercice[];
  bfr: BfrExercice[];
  caf: CafExercice[];
  seuilRentabilite: SeuilExercice[];
  echeancierDette: EcheanceDette[];
  /** (S18a) `incoherent` → l'interface affiche un avertissement rouge sur le bilan. */
  coherenceImmobilisations: {
    baseBilan: number;
    baseDeclaree: number;
    ecart: number;
    statut: 'coherent' | 'incoherent';
    dotationsPlafonnees: boolean;
  };
}

export interface EvaluateResponse {
  project: ProjectView;
  lines: LineResult[];
  /** (S14c) Absent si le template ne déclare pas d'immobilisations. */
  amortissements?: AmortissementsView;
  /** (S18a) Absent si le template ne déclare pas `structure_financiere`. */
  etatsFinanciers?: EtatsFinanciersView;
}

// ─── Métadonnées de template (S5a) ─────────────────────────────
// Forme partielle du Template du moteur — juste ce dont le wizard a besoin.
// Le typage strict vit dans @lalanda/engine ; ici on reste tolérant pour rester
// résilient aux évolutions du DSL.
export interface TemplateDriverMeta {
  id: string;
  groupe?: string;
  label?: string;
  type: 'number' | 'percent' | 'money';
  devise?: 'USD' | 'CDF';
  defaut?: number;
  min?: number;
  max?: number;
  unite?: string;
  aide?: string;
}

export interface TemplateGroupMeta {
  id: string;
  label: string;
}

/**
 * (S18c) Étape du wizard de saisie déclarée par le template. Purement
 * présentationnel — le moteur ignore ce champ. Absent → fallback « une étape par
 * groupe d'hypothèses » (voir `buildWizardSteps`).
 */
export interface TemplateEtapeMeta {
  id: string;
  label: string;
  description?: string;
  groupes: string[];
  ordre?: number;
}

export interface TemplateMeta {
  slug: string;
  version: string;
  secteur?: string;
  pays?: string[];
  devise_base?: 'USD' | 'CDF';
  horizon_mois?: number;
  groupes_hypotheses?: TemplateGroupMeta[];
  /** (S18c) Bloc de présentation du wizard — voir ADR-0011, Contrat 3. */
  wizard?: { etapes: TemplateEtapeMeta[] };
  drivers: TemplateDriverMeta[];
}

/** Résumé de template — servi par GET /evaluate/templates (S6). */
export interface TemplateSummary {
  slug: string;
  version: string;
  secteur?: string;
  pays?: string[];
  devise_base?: 'USD' | 'CDF';
  horizon_mois?: number;
}

// ─── Rôles d'organisation (S20a — ADR-0012 §1) ─────────────────
/**
 * Les 8 rôles d'organisation. Miroir de `apps/api/src/authz/permissions.ts`,
 * SOURCE DE VÉRITÉ — le web ne peut pas importer de l'API.
 *
 * Volontairement limité à l'union de slugs : les LIBELLÉS et les DESCRIPTIONS ne
 * sont pas recopiés ici. Ils arrivent du serveur (`roleLabel`, `roleOptions`),
 * qui les lit de la matrice. Deux tables de traduction finiraient par diverger,
 * et c'est celle de l'interface qui aurait tort.
 */
export const ORG_ROLES = [
  'owner',
  'admin',
  'finance_director',
  'accountant',
  'analyst',
  'project_manager',
  'advisor',
  'viewer',
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

// ─── Organisations (S5c, rôles S20a) ───────────────────────────
export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  type: string;
  pays: string;
  role: OrgRole;
  roleLabel: string;
  /** Droit conditionnel de clôture (case ⚙). */
  canClosePeriods: boolean;
}

// ─── Invitations (S5d, rôles S20a) ─────────────────────────────
export interface InvitationView {
  id: string;
  organizationId: string;
  email: string;
  role: OrgRole;
  roleLabel: string;
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

// ─── Membres (S20a — ADR-0012 §6) ──────────────────────────────
export interface MemberView {
  userId: string;
  /** `null` si le compte n'existe plus : la ligne reste affichée et révocable. */
  email: string | null;
  name: string | null;
  role: OrgRole;
  roleLabel: string;
  canClosePeriods: boolean;
  acceptedAt: string | null;
  /** R1 — dernier propriétaire : ni rétrogradable ni révocable. */
  isLastOwner: boolean;
  /** R7 — l'acteur courant peut-il agir sur cette ligne ? */
  manageable: boolean;
}

export interface RoleOption {
  value: OrgRole;
  label: string;
  description: string;
  /** R7 — l'acteur courant peut-il attribuer ce rôle ? */
  grantable: boolean;
}

// ─── Plans validés figés et versionnés (S16c — FIN-003) ────────
export interface PlanSummaryView {
  id: string;
  projectId: string;
  version: number;
  status: 'approved' | 'superseded';
  fingerprint: string;
  approvedAt: string;
  approvedBy: string;
  createdAt: string;
}

export interface PlanDetailView extends PlanSummaryView {
  driverValues: Record<string, number>;
  templateSlug: string;
  templateVersion: string;
  parameterPackSlug?: string;
  packVersion?: string;
  engineVersion: string;
  result: {
    lines: LineResult[];
    amortissements?: AmortissementsView;
    etatsFinanciers?: EtatsFinanciersView;
  };
}

// ─── Business Model Canvas (S18d — docs/05) ────────────────────
/** Les 9 blocs BMC, dans l'ordre canonique docs/05. */
export const CANVAS_BLOCKS = [
  'segments_clients',
  'proposition_valeur',
  'canaux',
  'relations_clients',
  'revenus',
  'ressources_cles',
  'activites_cles',
  'partenaires_cles',
  'couts',
] as const;

export type CanvasBlockId = (typeof CANVAS_BLOCKS)[number];

export interface CanvasCard {
  id: string;
  texte: string;
  ordre: number;
}

export type CanvasBlocks = Record<CanvasBlockId, CanvasCard[]>;

export interface CanvasView {
  projectId: string;
  /** 0 = jamais sauvegardé (l'API renvoie alors 9 blocs vides, pas un 404). */
  version: number;
  blocs: CanvasBlocks;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface CanvasRevisionView {
  version: number;
  blocs: CanvasBlocks;
  savedBy: string;
  savedAt: string;
}

/** Contraintes de validation côté API — dupliquées ici pour le feedback immédiat. */
export const CANVAS_MAX_CARD_TEXT = 500;
export const CANVAS_MAX_CARDS_PER_BLOCK = 20;

// ─── Objectifs financiers et taux d'atteinte (S18d — docs/01) ──
export const OBJECTIVE_KEYS = [
  'ca_cible_an1',
  'ca_cible_an5',
  'resultat_net_cible_an1',
  'resultat_net_cible_an5',
  'tresorerie_cible',
] as const;

export type ObjectiveKey = (typeof OBJECTIVE_KEYS)[number];

export type ObjectivesInput = Partial<Record<ObjectiveKey, number>>;

export interface ObjectivesView extends ObjectivesInput {
  projectId: string;
  updatedAt: string | null;
}

export type AttainmentStatut = 'atteint' | 'partiel' | 'non_atteint' | 'indisponible';

export interface ObjectiveAttainment {
  objectif: ObjectiveKey;
  label: string;
  cible: number;
  lineId: string | null;
  valeur: number | null;
  /**
   * Taux d'atteinte en %, calculé PAR L'API (docs/26 : aucune règle financière
   * dans un composant UI). `null` = non mesurable — ne jamais afficher 0.
   */
  atteinte: number | null;
  statut: AttainmentStatut;
  /**
   * `LIGNE_INDISPONIBLE` : la ligne n'existe pas dans le plan validé.
   * `VALEUR_NON_NUMERIQUE` : elle existe mais ne porte pas un nombre exploitable.
   */
  raison: 'LIGNE_INDISPONIBLE' | 'VALEUR_NON_NUMERIQUE' | null;
}

export interface AttainmentView {
  source: 'plan_valide';
  planVersion: number;
  planApprovedAt: string;
  seuilPartielPct: number;
  objectifs: ObjectiveAttainment[];
}

// ─── Suivi prévisionnel vs réalisé (S18b — docs/08) ────────────

export interface ActualPeriodView {
  id: string;
  projectId: string;
  /** Année d'EXERCICE (1..5), pas une année calendaire. */
  year: number;
  month: number;
  status: 'open' | 'closed';
  values: Record<string, number>;
  closedAt: string | null;
  closedBy: string | null;
  reopenedLog: { reopenedAt: string; reopenedBy: string; reason: string }[];
  updatedAt: string;
}

/** Pourquoi une ligne n'a pas de contrepartie comparable dans le plan validé. */
export type NonComparableRaison =
  'LIGNE_ABSENTE_DU_PLAN' | 'LIGNE_HORS_COMPTE_EXPLOITATION' | 'EXERCICE_ABSENT_DU_PLAN';

/** D'où vient la base annuelle : série `projection` du plan, ou activite × 12. */
export type BaseSource = 'projection' | 'activite_x12';

export type VarianceStatut = 'favorable' | 'defavorable' | 'conforme';

/** Anomalie signalée sur la saisie — jamais corrigée d'office. */
export interface VarianceDiagnostic {
  code: 'INCOHERENCE_SOLDE';
  message: string;
  months: number[];
}

export interface VarianceLineView {
  lineId: string;
  label: string;
  sens: 'produit' | 'charge';
  /** false → aucune base prévue : tous les champs de comparaison sont `null`. */
  comparable: boolean;
  raison: NonComparableRaison | null;
  /** false → jamais saisie sur la période : réalisé et écart sont `null`, pas 0. */
  saisi: boolean;
  base: BaseSource | null;
  prevuMensuel: number | null;
  prevuCumule: number | null;
  realiseCumule: number | null;
  ecart: number | null;
  /** Fraction (0.05 = +5 %) — null si la base prévue est nulle ou absente. */
  ecartPct: number | null;
  statut: VarianceStatut | null;
  diagnostics: VarianceDiagnostic[];
}

export interface VariancesView {
  year: number;
  planVersion: number;
  monthsCounted: number[];
  convention: 'annuel/12';
  lines: VarianceLineView[];
}

export interface ProjectionLineView {
  lineId: string;
  label: string;
  sens: 'produit' | 'charge';
  comparable: boolean;
  raison: NonComparableRaison | null;
  base: BaseSource | null;
  planAnnuel: number | null;
  /** `null` quand des mois sont clôturés mais que la ligne n'y figure pas. */
  realiseClos: number | null;
  previsionnelRestant: number | null;
  totalProjete: number | null;
  ecartVsPlan: number | null;
}

export interface UpdatedProjectionView {
  year: number;
  planVersion: number;
  monthsClosed: number[];
  convention: 'annuel/12';
  lines: ProjectionLineView[];
}

export const ACTIVE_ORG_COOKIE = 'active_org_id';

/**
 * Positionne le cookie `active_org_id` côté client (non-HttpOnly pour l'UI).
 * Le guard côté API le lit à la requête suivante et scope les données à cette org.
 * SameSite=Lax : le cookie n'est pas envoyé sur requêtes cross-site (protection CSRF de base).
 */
export function setActiveOrgCookie(orgId: string): void {
  if (typeof document === 'undefined') return;
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${ACTIVE_ORG_COOKIE}=${encodeURIComponent(orgId)}; Max-Age=${oneYear}; Path=/; SameSite=Lax`;
}

export function readActiveOrgCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === ACTIVE_ORG_COOKIE) return decodeURIComponent(rest.join('=') ?? '') || undefined;
  }
  return undefined;
}

interface JsonRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

async function jsonRequest<T>(path: string, init: JsonRequestInit = {}): Promise<T> {
  const { body, headers, method } = init;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let detail: unknown = text;
    try {
      detail = JSON.parse(text);
    } catch {
      /* garde le texte brut */
    }
    const err = new Error(
      typeof detail === 'object' && detail !== null && 'message' in detail
        ? String((detail as { message: unknown }).message)
        : `HTTP ${res.status}`,
    ) as Error & { status: number; detail: unknown };
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return (await res.json()) as T;
}

// ─── Espace compte (S20b) ──────────────────────────────────
// Toutes ces routes sont scopées par la SESSION : aucune ne prend d'identifiant
// d'utilisateur. Un `userId` glissé dans un corps est refusé (400) côté API.

export interface AccountProfileView {
  id: string;
  name: string;
  email: string;
  /** Faux pour tout le monde tant qu'aucun SMTP n'est branché (docs/17). */
  emailVerified: boolean;
  initials: string;
  locale: string;
  timezone: string;
  pendingEmailChange: PendingEmailChangeView | null;
}

export interface PendingEmailChangeView {
  newEmail: string;
  expiresAt: string;
  requestedAt: string;
  /** Faux tant qu'aucun SMTP n'existe : le lien de vérification n'est PAS parti. */
  verificationDelivered: boolean;
  reason: string | null;
}

export interface NotificationPreferences {
  securite: boolean;
  produit: boolean;
  projet: boolean;
  resumeHebdomadaire: boolean;
}

export interface AccountPreferencesView {
  locale: string;
  timezone: string;
  theme: 'light' | 'dark' | 'system';
  displayCurrency: 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR';
  notifications: NotificationPreferences;
  updatedAt: string | null;
  /** Valeurs acceptées, servies par l'API — l'UI ne les code pas en dur. */
  options: { locales: string[]; themes: string[]; currencies: string[] };
}

/** Session active. Le token n'est JAMAIS exposé : seul un id opaque circule. */
export interface AccountSessionView {
  id: string;
  device: string;
  browser: string | null;
  os: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
}

export interface DeletionAssessment {
  canDelete: boolean;
  /** Organisations dont l'utilisateur est le dernier propriétaire (docs/12). */
  blockingOrganizations: Array<{ id: string; name: string; otherMemberCount: number }>;
  organizationsDeletedWithAccount: Array<{ id: string; name: string }>;
}

// ─── Espace organisation (S21a) ────────────────────────────────
// Miroir de `apps/api/src/organization-space/organization-space.dto.ts`, qui
// reste la source de vérité — le web ne peut pas importer de l'API.
//
// Règle qui gouverne ces types : `null` n'est jamais un synonyme de « vide ».
// `sections.gouvernance === null` signifie « le serveur n'a pas chargé ce bloc
// parce que votre rôle ne l'ouvre pas », ce qui n'est pas la même chose qu'un
// bloc chargé et sans contenu. L'interface doit distinguer les deux : dans un
// cas elle explique, dans l'autre elle affiche un état vide.

export type DisplayCurrency = 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR';

/** Les 15 actions granulaires (docs/12). Union fermée, alignée sur l'API. */
export type OrgAction =
  | 'organization.manage'
  | 'billing.manage'
  | 'members.invite'
  | 'project.create'
  | 'project.read'
  | 'project.update'
  | 'canvas.update'
  | 'inputs.update'
  | 'plan.calculate'
  | 'plan.approve'
  | 'actuals.import'
  | 'period.close'
  | 'analytics.read'
  | 'report.export'
  | 'audit.read';

export type Plan = 'free' | 'pro' | 'business';

export interface Entitlements {
  maxProjects: number | null;
  pdfWatermark: boolean;
  seats?: number;
}

export interface ConsommationView {
  plan: Plan;
  /** `limite: null` = illimité, jamais un grand nombre. */
  projets: { utilise: number; limite: number | null };
  /** `limite: null` = sièges non contractuels sur ce plan, jamais 0. */
  sieges: { utilise: number; limite: number | null };
}

export interface GouvernanceSection {
  projets: number;
  plansValidesCeMois: number;
  membresActifs: number;
  consommation: ConsommationView;
}

export interface RatioRougeView {
  projectId: string;
  projectName: string;
  planVersion: number;
  lineId: string;
  label: string;
  valeur: number;
  seuilValeur: number;
  seuilDirection: 'min' | 'max';
}

export interface PlanEnAttenteView {
  projectId: string;
  projectName: string;
  derniereVersion: number | null;
  raison: 'AUCUN_PLAN' | 'HYPOTHESES_MODIFIEES';
  modifieLe: string | null;
}

export interface EcartProjetView {
  projectId: string;
  projectName: string;
  year: number;
  planVersion: number;
  lignesDefavorables: number;
  /** `null` quand la base prévue est nulle — ne jamais afficher 0 % à la place. */
  pireEcart: { lineId: string; label: string; ecartPct: number } | null;
}

export interface ValidationSection {
  ratiosRouges: RatioRougeView[];
  plansEnAttente: PlanEnAttenteView[];
  ecartsDefavorables: EcartProjetView[];
}

export interface PeriodeRefView {
  projectId: string;
  projectName: string;
  year: number;
  month: number;
}

export interface AnomalieView {
  projectId: string;
  projectName: string;
  year: number;
  lineId: string;
  label: string;
  code: 'INCOHERENCE_SOLDE';
  message: string;
  months: number[];
}

export interface ComptabiliteSection {
  peutCloturer: boolean;
  periodesASaisir: PeriodeRefView[];
  periodesACloturer: PeriodeRefView[];
  anomalies: AnomalieView[];
}

export interface ProjetResumeView {
  id: string;
  name: string;
  deviseAffichage: string;
  updatedAt: string;
  dernierPlan: { version: number; approvedAt: string; soleApprover: boolean } | null;
}

export interface ValidationRecenteView {
  projectId: string;
  projectName: string;
  version: number;
  approvedAt: string;
  soleApprover: boolean;
}

export interface ProjetsSection {
  projets: ProjetResumeView[];
  dernieresValidations: ValidationRecenteView[];
}

/** Bloc fermé par le rôle. Ne porte AUCUNE donnée : un nom, une action, une raison. */
export interface BlocMasqueView {
  section: 'gouvernance' | 'validation' | 'comptabilite' | 'projets';
  titre: string;
  action: OrgAction;
  raison: string;
}

export interface OrganizationDashboardView {
  organization: {
    id: string;
    name: string;
    slug: string;
    type: string;
    pays: string;
    deviseAffichage: DisplayCurrency;
    logoUrl: string | null;
  };
  role: OrgRole;
  roleLabel: string;
  actions: OrgAction[];
  lectureSeule: boolean;
  sections: {
    gouvernance: GouvernanceSection | null;
    validation: ValidationSection | null;
    comptabilite: ComptabiliteSection | null;
    projets: ProjetsSection | null;
  };
  masque: BlocMasqueView[];
}

export interface OrganizationSettingsView {
  id: string;
  name: string;
  slug: string;
  type: string;
  pays: string;
  deviseAffichage: DisplayCurrency;
  logoUrl: string | null;
  updatedAt: string | null;
  options: { currencies: string[] };
}

export interface DepassementView {
  code: 'PROJETS' | 'SIEGES';
  libelle: string;
  utilise: number;
  limite: number;
}

export interface HistoriqueAbonnementView {
  plan: Plan;
  status: string;
  depuis: string;
  evenement: string;
}

export interface OrganizationBillingView {
  plan: Plan;
  entitlements: Entitlements;
  consommation: ConsommationView;
  depassements: DepassementView[];
  historique: HistoriqueAbonnementView[];
  paiement: { integre: false; message: string };
}

/**
 * Permissions effectives de l'appelant sur son organisation active (S20a).
 *
 * Servies par `GET /me/permissions`. Elles ne servent QU'À MASQUER ce qui serait
 * de toute façon refusé (ADR-0012 §8) : le serveur refuse quand même, et une
 * divergence produit au pire un onglet en trop.
 */
export interface MyPermissionsView {
  organizationId: string;
  role: OrgRole;
  roleLabel: string;
  actions: OrgAction[];
  grantableRoles: Array<{ value: OrgRole; label: string; description: string }>;
  canClosePeriods: boolean;
}

/** Événement du journal d'audit (S20a, filtrable par action depuis S21a). */
export interface AuditEventView {
  id: string;
  action: string;
  actorUserId: string;
  actorRole: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export const api = {
  listOrganizations: () =>
    jsonRequest<{ organizations: OrganizationView[] }>(`/organizations`, { method: 'GET' }),
  createOrganization: (input: { name: string }) =>
    jsonRequest<OrganizationView>(`/organizations`, { method: 'POST', body: input }),
  listTemplates: () =>
    jsonRequest<{ slugs: string[]; templates: TemplateSummary[] }>(`/evaluate/templates`, {
      method: 'GET',
    }),
  getTemplate: (slug: string) =>
    jsonRequest<{ template: TemplateMeta }>(`/evaluate/templates/${encodeURIComponent(slug)}`, {
      method: 'GET',
    }),
  listParameterPacks: () =>
    jsonRequest<{ packs: ParameterPackSummary[] }>(`/parameter-packs`, { method: 'GET' }),
  getParameterPack: (slug: string) =>
    jsonRequest<{ pack: ParameterPackDetail }>(`/parameter-packs/${encodeURIComponent(slug)}`, {
      method: 'GET',
    }),
  listProjects: () => jsonRequest<{ projects: ProjectView[] }>(`/projects`, { method: 'GET' }),
  createProject: (input: {
    name: string;
    templateSlug: string;
    pays?: string;
    parameterPackSlug?: string;
    deviseAffichage?: 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR';
  }) =>
    jsonRequest<ProjectView>(`/projects`, {
      method: 'POST',
      body: input,
    }),
  getProject: (id: string) =>
    jsonRequest<ProjectView>(`/projects/${encodeURIComponent(id)}`, { method: 'GET' }),
  evaluateProject: (id: string, driverValues?: Record<string, number>, persist = false) =>
    jsonRequest<EvaluateResponse>(`/projects/${encodeURIComponent(id)}/evaluate`, {
      method: 'POST',
      body: { driverValues, persist },
    }),
  updateDrivers: (id: string, driverValues: Record<string, number>) =>
    jsonRequest<ProjectView>(`/projects/${encodeURIComponent(id)}/drivers`, {
      method: 'POST',
      body: { driverValues },
    }),
  // ─── Invitations (S5d) ─────────────────────────────────────
  listOrgInvitations: (orgId: string) =>
    jsonRequest<{ invitations: InvitationView[] }>(
      `/organizations/${encodeURIComponent(orgId)}/invitations`,
      { method: 'GET' },
    ),
  createInvitation: (orgId: string, input: { email: string; role?: OrgRole }) =>
    jsonRequest<{ invitation: InvitationView; token: string }>(
      `/organizations/${encodeURIComponent(orgId)}/invitations`,
      { method: 'POST', body: input },
    ),
  revokeInvitation: (orgId: string, invitationId: string) =>
    jsonRequest<{ invitation: InvitationView }>(
      `/organizations/${encodeURIComponent(orgId)}/invitations/${encodeURIComponent(invitationId)}`,
      { method: 'DELETE' },
    ),
  listMyPendingInvitations: () =>
    jsonRequest<{ invitations: (InvitationView & { token: string })[] }>(`/invitations/pending`, {
      method: 'GET',
    }),
  acceptInvitation: (token: string) =>
    jsonRequest<{ organizationId: string }>(`/invitations/accept`, {
      method: 'POST',
      body: { token },
    }),
  // ─── Membres (S20a) ────────────────────────────────────────
  // `roleOptions` accompagne la liste : les rôles attribuables et leur
  // `grantable` dépendent du rôle de l'APPELANT (R7), le client ne peut pas
  // les déduire seul.
  listMembers: (orgId: string) =>
    jsonRequest<{ members: MemberView[]; roleOptions: RoleOption[] }>(
      `/organizations/${encodeURIComponent(orgId)}/members`,
      { method: 'GET' },
    ),
  changeMemberRole: (orgId: string, userId: string, role: OrgRole) =>
    jsonRequest<{ member: MemberView }>(
      `/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/role`,
      { method: 'PATCH', body: { role } },
    ),
  /** Droit conditionnel de clôture (case ⚙) — n'a de sens que pour un Comptable. */
  setMemberCloseRight: (orgId: string, userId: string, value: boolean) =>
    jsonRequest<{ member: MemberView }>(
      `/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(
        userId,
      )}/close-right`,
      { method: 'PATCH', body: { value } },
    ),
  revokeMember: (orgId: string, userId: string) =>
    jsonRequest<{ revoked: true }>(
      `/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ),
  /** Seule manière pour un propriétaire unique de se rétrograder (R1). */
  transferOwnership: (orgId: string, userId: string) =>
    jsonRequest<{ previousOwner: MemberView; newOwner: MemberView }>(
      `/organizations/${encodeURIComponent(orgId)}/transfer-ownership`,
      { method: 'POST', body: { userId } },
    ),
  // ─── Plans validés (S16c) ──────────────────────────────────
  // Fige la version courante du projet en vN+1 ; 409 { code: 'PLAN_UNCHANGED' }
  // si rien n'a changé depuis le dernier plan validé.
  approvePlan: (id: string) =>
    jsonRequest<PlanDetailView>(`/projects/${encodeURIComponent(id)}/plans`, { method: 'POST' }),
  listPlans: (id: string) =>
    jsonRequest<{ plans: PlanSummaryView[] }>(`/projects/${encodeURIComponent(id)}/plans`, {
      method: 'GET',
    }),
  getPlan: (id: string, version: number) =>
    jsonRequest<PlanDetailView>(`/projects/${encodeURIComponent(id)}/plans/${version}`, {
      method: 'GET',
    }),
  // ─── Business Model Canvas (S18d) ──────────────────────────
  // PUT = remplacement complet des 9 blocs (l'API refuse tout bloc inconnu).
  getCanvas: (id: string) =>
    jsonRequest<CanvasView>(`/projects/${encodeURIComponent(id)}/canvas`, { method: 'GET' }),
  putCanvas: (id: string, blocs: CanvasBlocks) =>
    jsonRequest<CanvasView>(`/projects/${encodeURIComponent(id)}/canvas`, {
      method: 'PUT',
      body: blocs,
    }),
  listCanvasRevisions: (id: string) =>
    jsonRequest<{ revisions: CanvasRevisionView[] }>(
      `/projects/${encodeURIComponent(id)}/canvas/revisions`,
      { method: 'GET' },
    ),
  // ─── Objectifs financiers (S18d) ───────────────────────────
  getObjectives: (id: string) =>
    jsonRequest<ObjectivesView>(`/projects/${encodeURIComponent(id)}/objectives`, {
      method: 'GET',
    }),
  putObjectives: (id: string, objectives: ObjectivesInput) =>
    jsonRequest<ObjectivesView>(`/projects/${encodeURIComponent(id)}/objectives`, {
      method: 'PUT',
      body: objectives,
    }),
  /** 409 { code: 'NO_APPROVED_PLAN' } tant qu'aucun plan n'est validé. */
  getAttainment: (id: string) =>
    jsonRequest<AttainmentView>(`/projects/${encodeURIComponent(id)}/objectives/attainment`, {
      method: 'GET',
    }),
  // ─── Réalisé, clôture, écarts (S18b — docs/08) ─────────────
  // Aucun calcul côté client : les écarts, statuts et projections viennent tous
  // de l'API (docs/26 — aucune règle financière dans un composant UI).
  listActualPeriods: (id: string, year: number) =>
    jsonRequest<{ year: number; periods: ActualPeriodView[] }>(
      `/projects/${encodeURIComponent(id)}/actual-periods?year=${year}`,
      { method: 'GET' },
    ),
  // 409 { code: 'PERIOD_CLOSED' } si la période est clôturée — la protéger est
  // une règle serveur, l'UI ne fait que refléter le refus.
  // Une valeur `null` EFFACE la cellule (retour à « non saisi », distinct d'un 0).
  upsertActualPeriod: (
    id: string,
    year: number,
    month: number,
    values: Record<string, number | null>,
  ) =>
    jsonRequest<ActualPeriodView>(
      `/projects/${encodeURIComponent(id)}/actual-periods/${year}/${month}`,
      { method: 'PUT', body: { values } },
    ),
  closeActualPeriod: (id: string, year: number, month: number) =>
    jsonRequest<ActualPeriodView>(
      `/projects/${encodeURIComponent(id)}/actual-periods/${year}/${month}/close`,
      { method: 'POST' },
    ),
  // Owner uniquement, motif obligatoire et journalisé (docs/08 § Périodes).
  reopenActualPeriod: (id: string, year: number, month: number, reason: string) =>
    jsonRequest<ActualPeriodView>(
      `/projects/${encodeURIComponent(id)}/actual-periods/${year}/${month}/reopen`,
      { method: 'POST', body: { reason } },
    ),
  // 409 { code: 'NO_APPROVED_PLAN' } tant qu'aucun plan n'a été validé.
  getVariances: (id: string, year: number) =>
    jsonRequest<VariancesView>(`/projects/${encodeURIComponent(id)}/variances?year=${year}`, {
      method: 'GET',
    }),
  getUpdatedProjection: (id: string, year: number) =>
    jsonRequest<UpdatedProjectionView>(
      `/projects/${encodeURIComponent(id)}/updated-projection?year=${year}`,
      { method: 'GET' },
    ),
  /** Permissions de l'appelant — alimente le masquage, jamais l'autorisation. */
  getMyPermissions: () => jsonRequest<MyPermissionsView>(`/me/permissions`, { method: 'GET' }),
  // ─── Espace organisation (S21a) ────────────────────────────
  // Quatre routes, trois niveaux d'accès. Un 403 sur `settings` ou `billing`
  // est une réponse NORMALE pour un rôle qui n'a pas la permission : l'appelant
  // masque le bloc, il n'affiche pas une panne (même pattern que /members, S20a).
  //
  // Le tableau de bord, lui, répond 200 à TOUS les rôles ; ce sont ses blocs qui
  // valent `null`. L'interface ne décide donc jamais elle-même qui voit quoi —
  // elle rend ce que le serveur a bien voulu charger (docs/12 § Modèle).
  getOrganizationDashboard: () =>
    jsonRequest<OrganizationDashboardView>(`/organizations/current/dashboard`, { method: 'GET' }),
  getOrganizationSettings: () =>
    jsonRequest<OrganizationSettingsView>(`/organizations/current/settings`, { method: 'GET' }),
  putOrganizationSettings: (input: {
    name: string;
    pays: string;
    deviseAffichage: DisplayCurrency;
    logoUrl: string | null;
  }) =>
    jsonRequest<OrganizationSettingsView>(`/organizations/current/settings`, {
      method: 'PUT',
      body: input,
    }),
  getOrganizationBilling: () =>
    jsonRequest<OrganizationBillingView>(`/organizations/current/billing`, { method: 'GET' }),
  /**
   * Journal d'audit de l'organisation active — lecture seule, `audit.read`.
   * `actions` accompagne les événements : le vocabulaire des filtres vient du
   * serveur, il n'est pas figé dans l'interface.
   */
  listAuditEvents: (options: { action?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.action) params.set('action', options.action);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    const query = params.toString();
    return jsonRequest<{ events: AuditEventView[]; actions: string[] }>(
      `/audit-events${query ? `?${query}` : ''}`,
      { method: 'GET' },
    );
  },
  // ─── Espace compte (S20b) ──────────────────────────────────
  getAccountProfile: () => jsonRequest<AccountProfileView>(`/account/profile`, { method: 'GET' }),
  putAccountProfile: (input: { name: string; locale: string; timezone: string }) =>
    jsonRequest<AccountProfileView>(`/account/profile`, { method: 'PUT', body: input }),
  getAccountPreferences: () =>
    jsonRequest<AccountPreferencesView>(`/account/preferences`, { method: 'GET' }),
  putAccountPreferences: (input: {
    theme: 'light' | 'dark' | 'system';
    displayCurrency: 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR';
    notifications: NotificationPreferences;
  }) => jsonRequest<AccountPreferencesView>(`/account/preferences`, { method: 'PUT', body: input }),
  /**
   * Change UNIQUEMENT le thème, en préservant le reste des préférences.
   *
   * `PUT /account/preferences` remplace tout le volet et son schéma est
   * `.strict()` : il n'existe pas d'écriture partielle. On relit donc les valeurs
   * courantes avant d'écrire, plutôt que d'envoyer des valeurs par défaut pour la
   * devise et les notifications — ce qui réinitialiserait en silence des réglages
   * que l'utilisateur n'a pas touchés.
   *
   * Utilisé par le bascule clair/sombre du header : sans cela, un thème choisi
   * là-bas resterait local et la page Préférences afficherait autre chose.
   */
  setAccountTheme: async (theme: 'light' | 'dark' | 'system') => {
    const current = await jsonRequest<AccountPreferencesView>(`/account/preferences`, {
      method: 'GET',
    });
    return jsonRequest<AccountPreferencesView>(`/account/preferences`, {
      method: 'PUT',
      body: {
        theme,
        displayCurrency: current.displayCurrency,
        notifications: current.notifications,
      },
    });
  },
  listAccountSessions: () =>
    jsonRequest<{ sessions: AccountSessionView[] }>(`/account/sessions`, { method: 'GET' }),
  /** 404 { code: 'SESSION_NOT_FOUND' } si l'id n'appartient pas à l'appelant. */
  revokeAccountSession: (id: string) =>
    jsonRequest<{ revoked: number; wasCurrent: boolean }>(
      `/account/sessions/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
  revokeOtherAccountSessions: () =>
    jsonRequest<{ revoked: number }>(`/account/sessions/revoke-others`, { method: 'POST' }),
  /**
   * Ouvre une demande de changement d'adresse. Répond 202 : la demande est
   * ACCEPTÉE, l'adresse n'est PAS modifiée tant que le token n'est pas vérifié.
   * 409 { code: 'EMAIL_TAKEN' }, 400 { code: 'INVALID_PASSWORD' }.
   */
  requestEmailChange: (input: { newEmail: string; currentPassword: string }) =>
    jsonRequest<{ pending: PendingEmailChangeView }>(`/account/email/change`, {
      method: 'POST',
      body: input,
    }),
  cancelEmailChange: () =>
    jsonRequest<{ canceled: boolean }>(`/account/email/change`, { method: 'DELETE' }),
  getAccountDeletion: () => jsonRequest<DeletionAssessment>(`/account/deletion`, { method: 'GET' }),
  /** 409 { code: 'LAST_OWNER' } si l'utilisateur est dernier propriétaire (docs/12). */
  deleteAccount: (input: { confirmEmail: string; currentPassword: string }) =>
    jsonRequest<{ deleted: true; deletedOrganizations: number }>(`/account/delete`, {
      method: 'POST',
      body: input,
    }),
  // ─── Reports PDF (S14a) ────────────────────────────────────
  // `planVersion` (S16c) : export depuis le snapshot figé du plan validé vN — aucun recalcul.
  async downloadProjectPdf(
    id: string,
    planVersion?: number,
  ): Promise<{ blob: Blob; filename: string }> {
    const query = planVersion !== undefined ? `?planVersion=${planVersion}` : '';
    const res = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}/report/pdf${query}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
    const cd = res.headers.get('content-disposition') ?? '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? 'plan-financier.pdf';
    return { blob: await res.blob(), filename };
  },
  // ─── Reports Excel (S14b) ──────────────────────────────────
  // Une feuille par feuille moteur, formules DSL préservées en formules Excel natives.
  // `planVersion` (S16c) : export depuis le snapshot figé du plan validé vN — aucun recalcul.
  async downloadProjectXlsx(
    id: string,
    planVersion?: number,
  ): Promise<{ blob: Blob; filename: string }> {
    const query = planVersion !== undefined ? `?planVersion=${planVersion}` : '';
    const res = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}/report/xlsx${query}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
    const cd = res.headers.get('content-disposition') ?? '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? 'plan-financier.xlsx';
    return { blob: await res.blob(), filename };
  },
};
