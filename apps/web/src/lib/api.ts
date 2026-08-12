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

/**
 * Envoi d'un fichier en CORPS BRUT.
 *
 * Volontairement distinct de `jsonRequest`, qui impose
 * `content-type: application/json` et sérialise son corps : les deux ne
 * pouvaient pas cohabiter dans la même fonction sans un drapeau qui aurait fini
 * par être posé au mauvais endroit.
 *
 * Le `Content-Type` est celui du fichier choisi. On ne le devine pas depuis
 * l'extension : c'est le navigateur qui le renseigne, et c'est l'API qui
 * tranche pour de bon en analysant le contenu.
 */
async function binaryRequest<T>(path: string, file: Blob): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': file.type },
    body: file,
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
  /**
   * Initiales calculées par le serveur depuis le NOM AFFICHÉ (repli sur
   * l'adresse). TOUJOURS servies, photo comprise : c'est le repli pendant le
   * chargement de l'image, à l'expiration de son URL et si le stockage tombe.
   * Autorité unique — `apps/web` n'en calcule aucune (ADR-0016 §7).
   */
  initials: string;
  locale: string;
  timezone: string;
  /**
   * URL absolue de la photo, ou `null`. Elle porte un jeton à DURÉE LIMITÉE et
   * est refrappée à chaque lecture de profil.
   *
   * NE PAS LA PERSISTER au-delà de la page — ni localStorage, ni cache client :
   * une URL conservée devient un 404 silencieux, et l'image casse chez
   * l'utilisateur sans que rien ne le signale côté serveur.
   */
  avatarUrl: string | null;
  /** Métadonnées de la photo, ou `null` si aucune n'est posée. */
  avatar: AvatarView | null;
  pendingEmailChange: PendingEmailChangeView | null;
}

export interface AvatarView {
  contentType: string;
  width: number;
  height: number;
  byteSize: number;
  updatedAt: string;
}

/**
 * Bornes servies par `GET /account/avatar-limits`.
 *
 * Elles pilotent l'interface — `accept` du champ fichier, message de taille,
 * bouton désactivé quand `storageAvailable` est faux. La validation côté client
 * reste un CONFORT : l'API est l'autorité et refuse de toute façon.
 */
export interface AvatarLimitsView {
  maxBytes: number;
  minDimension: number;
  maxDimension: number;
  acceptedTypes: string[];
  urlTtlSeconds: number;
  /** Faux quand le magasin d'objets ne répond pas : l'envoi échouerait en 503. */
  storageAvailable: boolean;
}

export interface AvatarUploadResult {
  avatar: AvatarView;
  avatarUrl: string;
  initials: string;
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

// ─── Acceptation des conditions (S22c) ─────────────────────
// Scopée par la SESSION : aucune de ces routes ne prend d'identifiant
// d'utilisateur, et l'API refuse en 400 un `userId` glissé dans le corps.

export interface TermsAcceptanceView {
  /** Version du corpus en vigueur, celle qu'il faut accepter. */
  currentVersion: string;
  /** Dernière version acceptée, `null` si l'utilisateur n'a jamais accepté. */
  acceptedVersion: string | null;
  acceptedAt: string | null;
  /** `false` aussi bien pour « jamais accepté » que pour « version périmée ». */
  isCurrent: boolean;
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

// ─── Abonnements et paiements (S22b — docs/13) ────────────────
//
// Aucune règle commerciale n'est dupliquée ici : les montants, les jours
// restants, l'éligibilité à l'essai et la disponibilité des moyens de paiement
// sont TOUS calculés par l'API. L'interface les affiche. C'est la règle
// « l'interface explique, l'API impose » appliquée à la facturation — un client
// qui déciderait lui-même qu'un essai est encore valable se l'accorderait.

export type SubscriptionStatus =
  'trialing' | 'active' | 'past_due' | 'grace' | 'suspended' | 'canceled';

export type BillingInterval = 'month' | 'year';

/** Moyens de paiement connus. `card` → Stripe, `paypal` → PayPal, le reste → manuel. */
export type PaymentMethod = 'card' | 'paypal' | 'mobile_money' | 'bank_transfer';

export interface SubscriptionStateView {
  /** Plan EFFECTIF — ce à quoi l'organisation a droit aujourd'hui. */
  plan: Plan;
  entitlements: Entitlements;
  usage: { projects: number };
  /** Plan SOUSCRIT — peut différer du plan effectif (essai, suspension). */
  subscribedPlan: Plan;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  paidAccess: boolean;
  trial: {
    used: boolean;
    endsAt: string | null;
    daysLeft: number | null;
    eligible: boolean;
    days: number;
  };
  currentPeriodEnd: string | null;
  grace: { endsAt: string | null; daysLeft: number | null; days: number };
  pendingChange: { plan: Plan; interval: BillingInterval; effectiveAt: string | null } | null;
  provider: string | null;
  notice: { level: 'info' | 'warning' | 'critical'; message: string } | null;
}

/** Chiffrage d'un changement de plan, hors taxes (docs/13 § Validation commerciale). */
export interface PlanQuoteView {
  plan: Plan;
  interval: BillingInterval;
  direction: 'upgrade' | 'downgrade' | 'same';
  effect: 'immediate' | 'period_end';
  amountDueCents: number;
  creditCents: number;
  carriedCreditCents: number;
  currency: string;
  taxIncluded: false;
  effectiveAt: string | null;
}

/** Instructions de dépôt du fournisseur manuel (mobile money, virement). */
export interface PaymentInstructionsView {
  title: string;
  steps: string[];
  accounts: { label: string; value: string }[];
  expectedDelayHours: number;
}

export interface CheckoutResultView {
  provider: string;
  mode: string;
  reference: string;
  amountDueCents: number;
  /** Présent pour un fournisseur à redirection (Stripe, PayPal). */
  redirectUrl?: string;
  /** Présent pour le fournisseur manuel. */
  instructions?: PaymentInstructionsView;
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

// ─── Espace admin plateforme (S21b — ADR-0012 §4, ADR-0013) ───
//
// Aucune de ces structures ne porte de valeur de secret, et il n'existe
// volontairement AUCUNE méthode `revealSecret` / `getSecretValue` dans ce
// fichier : le contrat d'API est en écriture seule (ADR-0013 §4). Le seul
// fragment qui circule est `last4`, les quatre DERNIERS caractères.

/** Les 6 rôles plateforme. Miroir d'`apps/api/src/authz/permissions.ts`. */
export const PLATFORM_ROLES = [
  'platform_super_admin',
  'platform_admin',
  'platform_support',
  'platform_billing',
  'platform_template_editor',
  'platform_country_pack_manager',
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Ce que l'INTERFACE a le droit d'afficher — jamais ce qu'elle a le droit de
 * faire. Masquer un onglet est un confort; le serveur refuse de toute façon
 * (docs/12 § Modèle).
 */
export interface PlatformAccessView {
  roles: Array<{ role: PlatformRole; label: string }>;
  isPlatformOperator: boolean;
  canReadAdmin: boolean;
  canManagePlatform: boolean;
  canManageIntegrations: boolean;
  /** Les trois interdits absolus (ADR-0012 §4), pour être AFFICHÉS tels quels. */
  forbiddenActions: string[];
}

export interface PlatformOverview {
  organizations: { total: number; suspended: number };
  users: { total: number; withPlatformRole: number };
  projects: { total: number };
  approvedPlans: { total: number };
  aiCalls: { last30Days: { llm: number; fallback: number; total: number } };
  plans: Record<Plan, number>;
}

export interface AdminOrganizationSummary {
  id: string;
  name: string;
  slug: string;
  type: string;
  pays: string;
  ownerId: string;
  plan: Plan;
  memberCount: number;
  projectCount: number;
  suspended: boolean;
  suspendedReason: string | null;
  createdAt: string;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string | null;
  platformRoles: Array<{ role: PlatformRole; label: string; expiresAt: string | null }>;
  organizationCount: number;
  disabledAt: string | null;
  createdAt: string | null;
}

/** Événement du journal d’audit PLATEFORME (S21b) — jamais de valeur de secret. */
export interface PlatformAuditEventView {
  id: string;
  action: string;
  actorUserId: string;
  actorRole: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

/**
 * État d'un secret — **jamais sa valeur**.
 *
 * `last4` est le SUFFIXE, jamais le préfixe : « les clés Stripe commencent par
 * `sk_live_` / `rk_test_`, un préfixe révélerait le mode et le type »
 * (ADR-0013 §4). `null` si la valeur fait moins de 12 caractères.
 *
 * `source` répond à la question « quelle clé le processus utilise-t-il
 * réellement ? » — garde-fou n°1 du chemin de migration (ADR-0013 option C).
 */
export interface IntegrationSecretView {
  configured: boolean;
  last4: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  source: 'db' | 'env' | null;
}

export interface IntegrationView {
  provider: 'openai' | 'stripe' | 'paypal' | 'smtp' | 'r2' | 'elevenlabs' | 'zeptomail';
  label: string;
  enabled: boolean;
  config: Record<string, string | number | boolean>;
  secrets: Record<string, IntegrationSecretView>;
  lastTest: { at: string; status: 'ok' | 'failed'; detail: string; forced: boolean } | null;
  requiredSecrets: string[];
  /**
   * Liste blanche des clés de `config` — des NOMS de champs, jamais de valeurs.
   *
   * `config` ne porte que ce qui est déjà enregistré; cette liste permet à
   * l'interface de proposer un champ encore vide sans recopier le catalogue de
   * `apps/api/src/integrations/providers.ts`, qui reste la source de vérité.
   */
  configFields: string[];
  requiredConfig: string[];
  /** Ce que fait le bouton « Tester », affiché AVANT qu'on le presse. */
  testDescription: string;
  updatedAt: string | null;
}

export type IntegrationProvider = IntegrationView['provider'];

/**
 * Corps d'un `PUT /admin/integrations/:provider`.
 *
 * Sémantique de remplacement (ADR-0013 §4) : une clé absente de `secrets` laisse
 * la valeur inchangée, `null` la supprime, une chaîne la remplace. Il n'existe
 * pas de modification partielle d'un secret.
 */
export interface UpdateIntegrationBody {
  enabled?: boolean;
  config?: Record<string, string | number | boolean>;
  secrets?: Record<string, string | null>;
}

export interface ReauthStatus {
  active: boolean;
  expiresAt: string | null;
}

// ─── Interprétations et assistant « Lala » (S24a) ──────────────
// L'IA explique les résultats du moteur; elle n'en produit aucun (CLAUDE.md).
// `source` dit d'où vient le texte affiché : `llm` = rédigé par le modèle,
// `fallback` = lecture déterministe écrite à partir des seuls chiffres du
// moteur. L'interface le DIT à l'utilisateur, comme pour les actions
// correctives (docs/11).

export type TexteIaSource = 'llm' | 'fallback';

export interface InterpretationView {
  lineId: string;
  texte: string;
  source: TexteIaSource;
}

export interface InterpretationsView {
  sheetId: string;
  interpretations: InterpretationView[];
  source: TexteIaSource;
  /**
   * Réserve de portée de la feuille (trésorerie mensuelle simplifiée…).
   * Renvoyée par l'API quelle que soit la source : elle ne dépend jamais de ce
   * que le modèle a bien voulu écrire.
   */
  avertissementFeuille: string | null;
  /** Mention anti-conseil, imposée côté serveur. */
  mention: string;
}

export interface LalaMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LalaChatView {
  reply: string;
  source: TexteIaSource;
  avertissementFeuille: string | null;
  mention: string;
}

/**
 * Ligne réduite à ce que l'API attend.
 *
 * `formulaSource` est écarté : la formule DSL n'apprend rien à un lecteur de
 * résultats, et « le contexte envoyé au modèle est minimal » (docs/11 § Contexte
 * envoyé au modèle). Le champ resterait de toute façon ignoré côté serveur, mais
 * l'envoyer ferait grossir chaque requête d'une feuille entière de formules.
 */
function ligneMinimale(l: LineResult): Omit<LineResult, 'formulaSource'> {
  return {
    sheetId: l.sheetId,
    lineId: l.lineId,
    label: l.label,
    value: l.value,
    format: l.format,
    ...(l.seuil ? { seuil: l.seuil } : {}),
  };
}

export const api = {
  /**
   * Enregistre l'accord de l'utilisateur connecté.
   *
   * La version est transmise par le client PARCE QU'ELLE ATTESTE du texte
   * réellement affiché au moment où la case a été cochée : un déploiement
   * pendant que le formulaire était ouvert suffirait sinon à enregistrer un
   * accord sur un texte que l'utilisateur n'a pas eu sous les yeux.
   */
  acceptTerms: (version: string) =>
    jsonRequest<TermsAcceptanceView>(`/legal/terms/acceptance`, {
      method: 'POST',
      body: { version },
    }),
  getTermsAcceptance: () =>
    jsonRequest<TermsAcceptanceView>(`/legal/terms/acceptance`, { method: 'GET' }),
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
  // ─── Abonnements et paiements (S22b) ───────────────────────
  /**
   * État d'abonnement de l'organisation active. Lisible par tout rôle disposant
   * de `analytics.read` : savoir que l'abonnement est suspendu n'est pas une
   * information de facturation, c'est une explication à un blocage subi.
   */
  getSubscription: () =>
    jsonRequest<SubscriptionStateView>(`/organizations/current/subscription`, { method: 'GET' }),
  /** Démarre l'essai de 14 jours. 409 { code: 'TRIAL_ALREADY_USED' | 'SUBSCRIPTION_ACTIVE' }. */
  startTrial: () =>
    jsonRequest<SubscriptionStateView>(`/organizations/current/subscription/trial`, {
      method: 'POST',
    }),
  /**
   * Chiffre un changement AVANT tout paiement. 409 { code: 'PLAN_NOT_SELLABLE' }
   * pour un couple (plan, périodicité) non publié — Business annuel notamment.
   */
  getPlanQuote: (plan: Plan, interval: BillingInterval) =>
    jsonRequest<PlanQuoteView>(
      `/organizations/current/subscription/quote?plan=${encodeURIComponent(plan)}&interval=${encodeURIComponent(interval)}`,
      { method: 'GET' },
    ),
  /**
   * Programme une BAISSE de gamme à l'échéance. Une montée en gamme est refusée
   * ici (409 { code: 'UPGRADE_REQUIRES_PAYMENT' }) : elle passe par `startCheckout`.
   */
  changePlan: (plan: Plan, interval: BillingInterval) =>
    jsonRequest<SubscriptionStateView>(`/organizations/current/subscription/plan`, {
      method: 'POST',
      body: { plan, interval },
    }),
  /** Résilie. Aucune donnée n'est supprimée (docs/13). */
  cancelSubscription: () =>
    jsonRequest<SubscriptionStateView>(`/organizations/current/subscription/cancel`, {
      method: 'POST',
    }),
  /**
   * Moyens de paiement RÉELLEMENT utilisables. PUBLIC — la page tarifs l'appelle
   * sans session pour n'annoncer que ce qui marche.
   */
  getPaymentMethods: () =>
    jsonRequest<{ methods: { method: PaymentMethod; available: boolean }[] }>(`/payments/methods`, {
      method: 'GET',
    }),
  /**
   * Ouvre un encaissement. Le MONTANT n'est jamais envoyé par le client : il est
   * recalculé côté API. 503 si le fournisseur du moyen choisi n'est pas configuré.
   */
  startCheckout: (input: { plan: Plan; interval: BillingInterval; method: PaymentMethod }) =>
    jsonRequest<CheckoutResultView>(`/payments/checkout`, { method: 'POST', body: input }),
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
  /**
   * Envoi de la photo — CORPS BINAIRE BRUT, PAS de multipart.
   *
   * L'API ne porte aucune dépendance multipart : elle lit le corps tel quel et
   * se fie au `Content-Type`. Un `FormData` produirait un corps encapsulé que
   * l'analyse d'image rejetterait en `MALFORMED_IMAGE` — d'où le passage direct
   * du `File`, qui porte déjà son type.
   */
  postAccountAvatar: (file: File) => binaryRequest<AvatarUploadResult>(`/account/avatar`, file),
  /** Idempotent : jamais de 404, un double clic est sans conséquence. */
  deleteAccountAvatar: () =>
    jsonRequest<{ removed: boolean; initials: string }>(`/account/avatar`, { method: 'DELETE' }),
  getAvatarLimits: () => jsonRequest<AvatarLimitsView>(`/account/avatar-limits`, { method: 'GET' }),
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
  // ─── Espace admin plateforme (S21b) ────────────────────────
  // Toutes ces routes exigent un rôle plateforme côté API. Le client ne décide
  // rien : il affiche ce que le serveur veut bien lui rendre, et relaie ses 403.

  /** Scopée par la session, accessible à tous — y compris sans aucun rôle. */
  getPlatformAccess: () =>
    jsonRequest<PlatformAccessView>(`/me/platform-access`, { method: 'GET' }),

  getAdminOverview: () => jsonRequest<PlatformOverview>(`/admin/overview`, { method: 'GET' }),

  listAdminOrganizations: (q?: string) =>
    jsonRequest<{ organizations: AdminOrganizationSummary[] }>(
      `/admin/organizations${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      { method: 'GET' },
    ),
  setOrganizationPlan: (organizationId: string, plan: Plan) =>
    jsonRequest<AdminOrganizationSummary>(
      `/admin/organizations/${encodeURIComponent(organizationId)}/plan`,
      { method: 'PATCH', body: { plan } },
    ),
  /** Motif obligatoire (10 caractères minimum) — il part dans l'audit. */
  suspendOrganization: (organizationId: string, reason: string) =>
    jsonRequest<AdminOrganizationSummary>(
      `/admin/organizations/${encodeURIComponent(organizationId)}/suspend`,
      { method: 'POST', body: { reason } },
    ),
  liftOrganizationSuspension: (organizationId: string) =>
    jsonRequest<AdminOrganizationSummary>(
      `/admin/organizations/${encodeURIComponent(organizationId)}/suspend`,
      { method: 'DELETE' },
    ),

  listAdminUsers: (q?: string) =>
    jsonRequest<{ users: AdminUserSummary[] }>(
      `/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      { method: 'GET' },
    ),
  /** 400 { code: 'SELF_DEMOTION_FORBIDDEN' } si l'on se retire son propre super-admin. */
  grantPlatformRole: (
    userId: string,
    role: PlatformRole,
    input: { reason?: string; expiresAt?: string } = {},
  ) =>
    jsonRequest<AdminUserSummary>(`/admin/users/${encodeURIComponent(userId)}/platform-roles`, {
      method: 'POST',
      body: { role, ...input },
    }),
  revokePlatformRole: (userId: string, role: PlatformRole) =>
    jsonRequest<AdminUserSummary>(
      `/admin/users/${encodeURIComponent(userId)}/platform-roles/${encodeURIComponent(role)}`,
      { method: 'DELETE' },
    ),
  setUserDisabled: (userId: string, disabled: boolean) =>
    jsonRequest<AdminUserSummary>(`/admin/users/${encodeURIComponent(userId)}/disabled`, {
      method: 'PATCH',
      body: { disabled },
    }),

  /** Journal de PORTÉE PLATEFORME uniquement — aucun événement d'organisation cliente. */
  listPlatformAuditEvents: (
    filtre: { action?: string; actorUserId?: string; limit?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (filtre.action) params.set('action', filtre.action);
    if (filtre.actorUserId) params.set('actorUserId', filtre.actorUserId);
    params.set('limit', String(filtre.limit ?? 100));
    return jsonRequest<{ events: PlatformAuditEventView[] }>(
      `/admin/audit-events?${params.toString()}`,
      { method: 'GET' },
    );
  },

  // ─── Intégrations chiffrées (S21b — ADR-0013) ──────────────
  // Écriture seule : aucune de ces méthodes ne peut rendre une valeur en clair,
  // et il n'existe pas d'endpoint qui le pourrait.

  listIntegrations: () =>
    jsonRequest<{ integrations: IntegrationView[] }>(`/admin/integrations`, { method: 'GET' }),
  getIntegration: (provider: IntegrationProvider) =>
    jsonRequest<IntegrationView>(`/admin/integrations/${provider}`, { method: 'GET' }),
  /**
   * 422 { code: 'INTEGRATION_TEST_FAILED' } si le test de connexion échoue — et
   * dans ce cas RIEN n'est enregistré (ADR-0013 §5). `force` passe outre; la
   * dérogation est tracée dans l'audit et `lastTest.status` reste `failed`.
   *
   * 401 { code: 'REAUTH_REQUIRED' } si la ré-authentification date de plus de
   * dix minutes.
   */
  updateIntegration: (provider: IntegrationProvider, body: UpdateIntegrationBody, force = false) =>
    jsonRequest<IntegrationView>(`/admin/integrations/${provider}${force ? '?force=true' : ''}`, {
      method: 'PUT',
      body,
    }),
  testIntegration: (provider: IntegrationProvider) =>
    jsonRequest<{ ok: boolean; latencyMs: number; detail: string }>(
      `/admin/integrations/${provider}/test`,
      { method: 'POST' },
    ),
  deleteIntegrationSecret: (provider: IntegrationProvider, name: string) =>
    jsonRequest<IntegrationView>(
      `/admin/integrations/${provider}/secrets/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    ),

  /** Fenêtre de ré-authentification (ADR-0013 §5) — dix minutes, liée à la session. */
  getReauthStatus: () => jsonRequest<ReauthStatus>(`/admin/reauth`, { method: 'GET' }),
  confirmReauth: (password: string) =>
    jsonRequest<{ active: true; expiresAt: string }>(`/admin/reauth`, {
      method: 'POST',
      body: { password },
    }),

  // ─── Interprétations et chat Lala (S24a) ───────────────────
  // Les LIGNES DU MOTEUR sont transmises telles quelles : elles servent à la fois
  // de contexte et de PÉRIMÈTRE des chiffres citables côté serveur. Aucun total
  // n'est recalculé ici — l'interface ne calcule rien (docs/26).
  interpretResults: (input: {
    templateSlug: string;
    sheetId: string;
    sheetLabel?: string;
    devise?: string;
    lines: LineResult[];
    lineIds: string[];
  }) =>
    jsonRequest<InterpretationsView>(`/ai/interpretations`, {
      method: 'POST',
      body: { ...input, lines: input.lines.map(ligneMinimale) },
    }),

  askLala: (input: {
    templateSlug: string;
    sheetId: string;
    sheetLabel?: string;
    lineId: string;
    devise?: string;
    lines: LineResult[];
    interpretation?: string;
    messages: LalaMessage[];
  }) =>
    jsonRequest<LalaChatView>(`/ai/lala/messages`, {
      method: 'POST',
      body: { ...input, lines: input.lines.map(ligneMinimale) },
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
