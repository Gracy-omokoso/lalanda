// Client HTTP typé pour appeler apps/api. Toutes les requêtes envoient les cookies
// de session (`credentials: 'include'`) — sinon AuthGuard renvoie 401.

export const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

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
  /**
   * Origine de chaque valeur (ADR-0031 § 3, ADR-0034 § 5) : `manual` (saisie
   * dans cet onglet), `run.sales` (écrite par le pont depuis les ventes) ou
   * `run.expenses` (écrite par le report des dépenses). Absente : saisie
   * antérieure d'origine inconnue.
   */
  sources?: Record<string, ActualValueSourceView>;
  closedAt: string | null;
  closedBy: string | null;
  reopenedLog: { reopenedAt: string; reopenedBy: string; reason: string }[];
  updatedAt: string;
}

/** Ponts RUN qui alimentent le réalisé (un seul vocabulaire, unifié le 26 oct. 2026). */
export type RunActualSource = 'run.sales' | 'run.expenses';

export type ActualValueSourceView =
  | {
      source: 'manual';
      at: string;
      by: string | null;
      replaced?: { source: RunActualSource; value: number } | null;
    }
  | {
      source: RunActualSource;
      at: string;
      by: string | null;
      version: string;
      /** Absent des valeurs écrites par les dépenses avant l'unification. */
      calendarMonth?: string;
      documents: number;
      fingerprint: string;
    };

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

export interface JsonRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Exportée pour les clients d'API voisins (`api-crm.ts`, ADR-0035). */
export async function jsonRequest<T>(path: string, init: JsonRequestInit = {}): Promise<T> {
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
  // `204 No Content` (suppressions des ventes, ADR-0022 § S25c.5) : aucun corps
  // à lire — `res.json()` lèverait sur une réponse vide.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * PDF d'un document de vente (ADR-0025) ; erreurs sous la forme de `jsonRequest`.
 * Les en-têtes `content-disposition` et `x-duplicate-number` ne sont lisibles
 * que si l'API les expose en CORS : sinon, `fallbackName` et `null`.
 */
async function invoicePdfRequest(
  invoiceId: string,
  kind: 'pdf' | 'duplicate',
  fallbackName: string,
): Promise<{ blob: Blob; filename: string; duplicateNumber: number | null }> {
  const res = await fetch(`${API_URL}/sales/invoices/${encodeURIComponent(invoiceId)}/${kind}`, {
    method: kind === 'pdf' ? 'GET' : 'POST',
    credentials: 'include',
    headers: kind === 'pdf' ? undefined : { 'content-type': 'application/json' },
    body: kind === 'pdf' ? undefined : '{}',
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
  const cd = res.headers.get('content-disposition') ?? '';
  const match = cd.match(/filename="([^"]+)"/);
  const dup = res.headers.get('x-duplicate-number');
  return {
    blob: await res.blob(),
    filename: match?.[1] ?? fallbackName,
    duplicateNumber: dup === null ? null : Number(dup),
  };
}

/** `GET /sales/journal/export` (ADR-0026 § 6.3) — paramètres. */
export interface SalesJournalExportQuery {
  from: string;
  to: string;
  format: 'json' | 'csv';
  dataset: 'ventes' | 'echanges';
}

/** Export du journal : fichier à enregistrer ; erreurs sous la forme de `jsonRequest`. */
async function salesJournalExportRequest(
  q: SalesJournalExportQuery,
  fallbackName: string,
): Promise<{ blob: Blob; filename: string }> {
  const params = new URLSearchParams({ from: q.from, to: q.to, format: q.format });
  if (q.format === 'csv') params.set('dataset', q.dataset);
  const res = await fetch(`${API_URL}/sales/journal/export?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
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
  const cd = res.headers.get('content-disposition') ?? '';
  const match = cd.match(/filename="([^"]+)"/);
  return { blob: await res.blob(), filename: match?.[1] ?? fallbackName };
}

// ─── Identité visuelle et modèles de facture (ADR-0028) ─────────────────────

export type LogoVariant = 'primary' | 'horizontal' | 'symbol' | 'light';
export type InvoiceTemplateId =
  'classique' | 'bandeau' | 'laterale' | 'minimal' | 'compacte' | 'editoriale';
export type InvoicePalette = 'brand' | 'mono';

export interface BrandLogoView {
  variant: LogoVariant;
  label: string;
  assetId: string;
  /** URL signée à durée limitée, révoquée au remplacement du logo. */
  url: string;
  contentType: string;
  width: number;
  height: number;
  byteSize: number;
}

/** `GET /organizations/current/brand` (`organization.manage`). */
export interface BrandView {
  logos: Record<LogoVariant, BrandLogoView | null>;
  primaryColor: string | null;
  secondaryColor: string | null;
  font: string | null;
  revision: number;
  updatedAt: string | null;
  fonts: { id: string; label: string }[];
  variants: { id: LogoVariant; label: string }[];
  limits: {
    maxBytes: number;
    minDimension: number;
    maxDimension: number;
    acceptedTypes: readonly string[];
    urlTtlSeconds: number;
    storageAvailable: boolean;
  };
}

export interface PutBrandIdentityInput {
  primaryColor: string | null;
  secondaryColor: string | null;
  font: string | null;
  expectedRevision: number;
}

export interface InvoiceTemplateOptions {
  palette: InvoicePalette;
  accent: string;
  font: string;
}

export interface InvoiceTemplateOptionsInput {
  palette: InvoicePalette | null;
  accent: string | null;
  font: string | null;
}

export interface InvoiceTemplateCatalogEntry {
  id: InvoiceTemplateId;
  version: string;
  label: string;
  description: string;
  defaults: InvoiceTemplateOptions;
  palettes: readonly InvoicePalette[];
  fonts: { id: string; label: string }[];
  accentSuggestions: string[];
}

/** `GET /sales/invoice-templates` (`sales.read`). */
export interface InvoiceTemplatesView {
  templates: InvoiceTemplateCatalogEntry[];
  current: {
    /** `sur-mesure` : un modèle personnalisé est en vigueur (ADR-0029). */
    templateId: InvoiceTemplateId | 'sur-mesure';
    version: string;
    options: InvoiceTemplateOptionsInput;
    resolved: InvoiceTemplateOptions;
    package?: FrozenPackageRef | null;
  } | null;
  identity: {
    primaryColor: string | null;
    secondaryColor: string | null;
    font: string | null;
    logos: Record<LogoVariant, boolean>;
  };
  revision: number;
}

// ─── Modèles de facture sur mesure (ADR-0029) ──────────────────────────────

/** Paquet figé dans une facture : identifiant, version et empreinte. */
export interface FrozenPackageRef {
  packageId: string;
  id: string;
  name: string;
  version: string;
  sha256: string;
}

export interface TemplatePackageIssue {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  case?: string;
}

/** Rapport de validation d'un paquet (téléversement). */
export interface TemplatePackageReport {
  ok: boolean;
  errors: TemplatePackageIssue[];
  warnings: TemplatePackageIssue[];
  truncated: boolean;
  digest: string | null;
  manifest: { id: string; name: string; version: string } | null;
  files: { path: string; bytes: number }[];
  cases: { name: string; ok: boolean }[];
}

export interface TemplatePackageView {
  packageId: string;
  templateId: string;
  version: string;
  name: string;
  description: string;
  contentSha256: string;
  byteSize: number;
  author: { name: string; email?: string | null; url?: string | null };
  publisher: { id: string; name: string; url?: string | null } | null;
  license: string;
  options: {
    palettes: InvoicePalette[];
    accent: string;
    fonts: { id: string; label: string }[];
    font: string;
  };
  installedAt: string;
  active: boolean;
}

/** `GET /sales/invoice-template-packages` (`sales.read`). */
export interface TemplatePackagesView {
  packages: TemplatePackageView[];
  current: { packageId: string; options: InvoiceTemplateOptionsInput } | null;
  revision: number;
  limits: { maxArchiveBytes: number; storageAvailable: boolean };
}

export interface TemplatePackageInstallResult extends TemplatePackagesView {
  installed: TemplatePackageView;
  created: boolean;
  report: TemplatePackageReport;
}

/** Aperçu d'un paquet installé (PNG ou PDF) ; erreurs sous la forme de `jsonRequest`. */
async function templatePackagePreviewRequest(
  packageId: string,
  options: Partial<InvoiceTemplateOptions>,
  format: 'png' | 'pdf',
): Promise<Blob> {
  const params = new URLSearchParams({ format });
  if (options.palette) params.set('palette', options.palette);
  if (options.accent) params.set('accent', options.accent);
  if (options.font) params.set('font', options.font);
  const res = await fetch(
    `${API_URL}/sales/invoice-template-packages/${encodeURIComponent(packageId)}/preview?${params.toString()}`,
    { method: 'GET', credentials: 'include' },
  );
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
  return res.blob();
}

export interface PutInvoiceTemplateInput {
  templateId: InvoiceTemplateId | null;
  options: InvoiceTemplateOptionsInput;
  expectedRevision: number;
}

/** Aperçu d'un modèle (PNG ou PDF) ; erreurs sous la forme de `jsonRequest`. */
async function invoiceTemplatePreviewRequest(
  templateId: InvoiceTemplateId,
  options: Partial<InvoiceTemplateOptions>,
  format: 'png' | 'pdf',
): Promise<Blob> {
  const params = new URLSearchParams({ format });
  if (options.palette) params.set('palette', options.palette);
  if (options.accent) params.set('accent', options.accent);
  if (options.font) params.set('font', options.font);
  const res = await fetch(
    `${API_URL}/sales/invoice-templates/${encodeURIComponent(templateId)}/preview?${params.toString()}`,
    { method: 'GET', credentials: 'include' },
  );
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
  return res.blob();
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

/** Les 27 actions granulaires (docs/12, ADR-0021 §8, ADR-0022 § S25c.1, ADR-0023 § S25e.11, ADR-0031 § 4, ADR-0034 § 8, ADR-0035 § 3, ADR-0039 § 7). Union fermée, alignée sur l'API. */
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
  | 'audit.read'
  // ADR-0021 §8 — identité fiscale et facture normalisée. Propriétaire et
  // Directeur financier seulement ; interdite à tout rôle plateforme.
  | 'fiscal.manage'
  // ADR-0022 § S25c.1 — clients et catalogue. Consulter (Analyste et Lecteur
  // compris) et gérer (Propriétaire, Administrateur, Directeur financier,
  // Comptable). La matrice vit côté API ; l'interface ne fait que lire
  // `GET /me/permissions`.
  | 'sales.read'
  | 'sales.manage'
  // ADR-0023 § S25e.11 — émettre et normaliser des factures et des avoirs :
  // engage le contribuable. Propriétaire, Directeur financier, Comptable ;
  // interdite à tout rôle plateforme.
  | 'sales.invoice'
  // ADR-0031 § 4 — enregistrer et annuler des encaissements. Propriétaire,
  // Directeur financier, Comptable ; interdite à tout rôle plateforme.
  | 'sales.receipt'
  // ADR-0034 § 8 — dépenses, comptes et prévision de trésorerie. Consulter
  // (sauf Chef de projet et Conseiller) et enregistrer (Propriétaire, Directeur
  // financier, Comptable).
  | 'treasury.read'
  | 'treasury.manage'
  // ADR-0035 § 3 — CRM minimal : même répartition que `sales.read` / `sales.manage`.
  | 'crm.read'
  | 'crm.manage'
  // ADR-0039 § 7 — projets et tâches du RUN (module `work`). Consulter (sauf Chef
  // de projet et Conseiller), travailler sur les tâches (sauf Lecteur, en plus),
  // gérer les projets (Propriétaire, Administrateur, Directeur financier).
  | 'work.read'
  | 'work.update'
  | 'work.manage';

/**
 * Offres — RÉEXPORTÉES du catalogue partagé, jamais réécrites.
 *
 * Cette union valait `'free' | 'pro' | 'business'` : elle est restée à trois
 * paliers pendant que l'API en servait cinq, et TypeScript ne pouvait pas s'en
 * plaindre puisque les réponses HTTP ne sont pas typées à l'exécution — un
 * `plan: 'cabinet'` renvoyé par l'API arrivait ici dans une variable qui jurait
 * qu'il ne pouvait pas exister. Le catalogue est désormais la seule définition.
 */
export type { Entitlements, Plan } from '@lalanda/shared/pricing';

import type { Entitlements, Plan } from '@lalanda/shared/pricing';

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

// ─── Fiscalité et facture normalisée (S25b — ADR-0021 §10) ───
// Miroir du CONTRAT HTTP de l'ADR-0021 §10. L'API (`apps/api/src/fiscal/`)
// reste la source de vérité ; le web ne peut pas l'importer.
//
// Aucun de ces types ne porte la valeur d'un jeton e-MCF. Le jeton ne voyage
// que dans le CORPS d'un `POST` ou d'un `PUT` (création d'un point de vente,
// remplacement du jeton) ; l'API ne le renvoie jamais — seulement `last4`.

/**
 * Fenêtre de ré-authentification de la SESSION d'un membre (`/me/reauth`).
 * Distincte de `ReauthStatus` (`/admin/reauth`), dont la forme diffère.
 */
export interface MeReauthStatus {
  valid: boolean;
  expiresAt: string | null;
  /** Comment se ré-authentifier : mot de passe, ou connexion Google récente (compte sans mot de passe). */
  method: 'password' | 'google';
}

export type FiscalLegalForm =
  | 'entreprise_individuelle'
  | 'sarl'
  | 'sarlu'
  | 'sa'
  | 'sas'
  | 'sasu'
  | 'snc'
  | 'scs'
  | 'gie'
  | 'cooperative'
  | 'asbl'
  | 'etablissement_public'
  | 'autre';

export interface FiscalHeadOffice {
  line1: string;
  line2: string | null;
  commune: string | null;
  city: string;
  province: string | null;
  /** ISO-2. */
  country: string;
}

/** Corps COMPLET de `PUT /organizations/current/fiscal-profile` (champs inconnus refusés). */
export interface FiscalProfileBody {
  legalName: string;
  tradeName: string | null;
  legalForm: FiscalLegalForm | null;
  legalFormOther: string | null;
  nif: string;
  rccm: string | null;
  nationalId: string | null;
  vatRegistered: boolean;
  headOffice: FiscalHeadOffice;
  phone: string;
  email: string;
}

export interface FiscalProfile extends FiscalProfileBody {
  updatedAt: string | null;
}

export interface FiscalProfileView {
  /** `null` tant qu'aucune fiche n'a été enregistrée. */
  profile: FiscalProfile | null;
  /** `nif: true` pendant l'activation de la facture normalisée (409 sinon). */
  locks: { nif: boolean };
  options: { legalForms: Array<{ value: FiscalLegalForm; label: string }> };
}

export type EdefEnvironment = 'test' | 'production';

export type PointOfSaleStatus =
  'disabled' | 'token_missing' | 'nif_mismatch' | 'token_expired' | 'failing' | 'active';

export interface PointOfSaleView {
  id: string;
  label: string;
  environment: EdefEnvironment;
  expectedNim: string | null;
  enabled: boolean;
  status: PointOfSaleStatus;
  /** Jamais la valeur : `last4` = 4 derniers caractères, `null` sous 12 caractères. */
  token: { configured: boolean; last4: string | null; updatedAt: string | null };
  /** `null` tant qu'aucun test n'a réussi. */
  dgi: {
    nif: string | null;
    nim: string | null;
    tokenValidUntil: string | null;
    emcfStatus: string | null;
    shopName: string | null;
    address: string[];
    contacts: string[];
    apiVersion: string | null;
    checkedAt: string;
  } | null;
  lastTest: { at: string; ok: boolean; code: string | null; message: string } | null;
}

export interface NormalizedInvoicingView {
  state: 'disabled' | 'enabled';
  environment: EdefEnvironment;
  firstActivatedAt: string | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  prerequisites: {
    fiscalProfileComplete: boolean;
    countryIsCd: boolean;
    activePointOfSaleInEnvironment: boolean;
    productionAvailable: boolean;
    /** `false` : une autre organisation Lalanda a déjà activé ce NIF dans cet environnement. */
    nifAvailable: boolean;
  };
  canActivate: boolean;
  pointsOfSale: PointOfSaleView[];
}

export interface CreatePointOfSaleBody {
  label: string;
  environment: EdefEnvironment;
  expectedNim: string | null;
  token: string;
}

export type EdefReferenceListName =
  | 'taxGroups'
  | 'invoiceTypes'
  | 'paymentTypes'
  | 'clientTypes'
  | 'referenceTypes'
  | 'itemTypes'
  | 'currencyRates';

export interface EdefReferenceDataView {
  environment: EdefEnvironment;
  fetchedAt: string;
  lists: {
    taxGroups?: Record<string, number>;
    invoiceTypes?: Array<{ type: string; description: string }>;
    paymentTypes?: Array<{ type: string; description: string }>;
    clientTypes?: Array<{ type: string; description: string }>;
    referenceTypes?: Array<{ type: string; description: string }>;
    itemTypes?: Array<{ type: string; description: string }>;
    currencyRates?: Array<{ type: string; description: string; date: string; rate: number }>;
  };
  /** Listes non obtenues, avec la raison. */
  failures: Partial<Record<EdefReferenceListName, { kind: string; message: string }>>;
  warnings: Array<{ code: string; group: string; dgi: number; pack: number }>;
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

// ─── Appel vocal avec Lala ───────────────────────────────────────────────────
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ AUCUNE DE CES REQUÊTES NE TRANSPORTE DE DONNÉE DE PROJET.                ║
// ║                                                                          ║
// ║ Comparer avec `askLala` juste en dessous : le chat ÉCRIT envoie `lines`, ║
// ║ `sheetId`, `devise` — c'est ce qui permet à l'API de vérifier les nombres ║
// ║ cités par le modèle (`lala-nombres.ts`). L'agent VOCAL n'a pas cet        ║
// ║ équivalent : en temps réel, la parole part avant qu'on puisse la relire. ║
// ║ La seule protection est de ne rien lui donner, et elle commence ici.     ║
// ║                                                                          ║
// ║ `ouvrirAppelVocal()` poste donc un corps VIDE. L'API le valide contre un ║
// ║ schéma strict et sans champ : y ajouter quoi que ce soit produit un 400. ║
// ╚══════════════════════════════════════════════════════════════════════════╝

/** Ce que l'interface sait du quota de minutes vocales. */
export interface QuotaVocalView {
  plan: string;
  /** `null` = illimité (offre négociée au contrat). */
  limiteMinutes: number | null;
  minutesConsommees: number;
  minutesRestantes: number | null;
  reinitialisationLe: string;
}

/** Pourquoi l'appel vocal n'est pas ouvert, quand il ne l'est pas. */
export type MotifVocalIndisponible = 'non_configure' | 'quota_epuise' | 'offre_sans_voix';

export interface EtatVocalView {
  disponible: boolean;
  motif: MotifVocalIndisponible | null;
  message: string | null;
  quota: QuotaVocalView | null;
}

export interface SessionVocaleView {
  /**
   * Jeton de session signé par ElevenLabs, produit PAR L'API.
   *
   * La clé d'API ElevenLabs, elle, ne quitte jamais le serveur : elle est lue
   * dans le coffre chiffré et sert à signer cette URL. Ce que le navigateur
   * reçoit est un jeton de session à durée de vie courte, pas un identifiant
   * réutilisable. Il ne se journalise pas et ne se met pas en cache.
   */
  signedUrl: string;
  sessionId: string;
  dureeMaxSecondes: number;
  mention: string;
  quota: QuotaVocalView;
}

export interface ClotureVocaleView {
  quota: QuotaVocalView;
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

// ─── Ventes : clients et catalogue (S25c — ADR-0022 § S25c.5) ──────────────
//
// Contrat HTTP de l'ADR-0022, recopié tel quel. Deux règles le gouvernent :
//
// - Les MONTANTS sont des chaînes décimales dans les deux sens (`"464.00"`) :
//   un `number` JSON est refusé par l'API (`DECIMAL_MUST_BE_STRING`). Aucun de
//   ces types ne porte un montant en `number`, et l'interface n'en calcule
//   aucun (docs/26).
// - Le TAUX d'un groupe de taxation vient de l'instantané DGI de
//   l'organisation, jamais du code (ADR-0019) ; il vaut `null` quand l'API sert
//   sa liste par défaut.

/** Les cinq types de client de la DGI (`ClientTypeEnum` de la spécification e-DEF). */
export type CustomerType = 'PP' | 'PM' | 'PC' | 'PL' | 'AO';

/** Filtre d'état des listes : actifs par défaut. */
export type SalesStatusFilter = 'active' | 'inactive' | 'all';

export interface CustomerView {
  id: string;
  type: CustomerType;
  typeLabel: string;
  name: string;
  nif: string | null;
  exemptionReference: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  deactivatedAt: string | null;
  /** Déjà facturé : la suppression est refusée, seule la désactivation reste. */
  invoiced: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPage {
  items: CustomerView[];
  /** `null` = dernière page. Opaque : se renvoie tel quel. */
  nextCursor: string | null;
}

/** Corps de `POST /sales/customers`. Le NIF part tel que saisi : l'API le normalise. */
export interface CustomerBody {
  type: CustomerType;
  name: string;
  nif: string | null;
  exemptionReference: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

/** Corps COMPLET de `PUT /sales/customers/:id`, avec la révision attendue. */
export interface CustomerUpdateBody extends CustomerBody {
  expectedRevision: number;
}

export interface CustomerListQuery {
  q?: string;
  type?: CustomerType;
  status?: SalesStatusFilter;
  limit?: number;
  cursor?: string;
}

export type CatalogItemType = 'BIE' | 'SER' | 'TAX';
export type CatalogPriceMode = 'ttc' | 'ht';
/** Lettres des seize groupes de taxation en vigueur (A à P, ADR-0022). */
export type TaxGroupLetter =
  'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P';

export type CatalogSpecificTax =
  { kind: 'per_unit'; amount: string } | { kind: 'percent'; rate: string };

export interface CatalogItemView {
  id: string;
  code: string | null;
  /** Code transmis à la DGI : « HORS CHAMP » pour une opération hors champ. Calculé par l'API. */
  edefCode: string | null;
  name: string;
  itemType: CatalogItemType;
  taxGroup: TaxGroupLetter;
  /** `false` : le groupe n'est plus proposé — il faut en changer pour modifier l'article. */
  taxGroupAvailable: boolean;
  outOfScope: boolean;
  /** Décimal canonique à deux décimales (`"464.00"`). */
  unitPrice: string;
  priceMode: CatalogPriceMode;
  /** Devise du prix (ADR-0023, amendement d'ADR-0022) : `CDF` ou `USD`. */
  currency: 'CDF' | 'USD';
  unit: string;
  specificTax: CatalogSpecificTax | null;
  active: boolean;
  deactivatedAt: string | null;
  invoiced: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogItemPage {
  items: CatalogItemView[];
  nextCursor: string | null;
}

export interface CatalogItemBody {
  code: string | null;
  name: string;
  itemType: CatalogItemType;
  taxGroup: TaxGroupLetter;
  outOfScope: boolean;
  /** Chaîne décimale, point comme séparateur (`"1234.5"`) ; l'API la canonicalise. */
  unitPrice: string;
  priceMode: CatalogPriceMode;
  /** Devise du prix (ADR-0023, amendement d'ADR-0022) : `CDF` ou `USD`. */
  currency: 'CDF' | 'USD';
  unit: string;
  specificTax: CatalogSpecificTax | null;
}

export interface CatalogItemUpdateBody extends CatalogItemBody {
  expectedRevision: number;
}

export interface CatalogItemListQuery {
  q?: string;
  taxGroup?: TaxGroupLetter;
  itemType?: CatalogItemType;
  status?: SalesStatusFilter;
  limit?: number;
  cursor?: string;
}

export interface TaxGroupOption {
  letter: TaxGroupLetter;
  label: string;
  /** Taux en pour cent, en chaîne (`"16"`, `"16.5"`). `null` quand `source = "default"`. */
  ratePercent: string | null;
  itemTypes: CatalogItemType[];
  outOfScopeAllowed: boolean;
}

export interface TaxGroupList {
  source: 'dgi_snapshot' | 'default';
  environment: EdefEnvironment;
  fetchedAt: string | null;
  sha256: string | null;
  groups: TaxGroupOption[];
}

// ─── Ventes : factures, pro forma et avoirs (S25e — ADR-0023 § S25e.14) ─────
//
// Miroir de `apps/api/src/sales/invoices/invoice.contract.ts` (jalon E0, figé),
// qui reste la source de vérité — le web n'importe ni de l'API ni du moteur.
// Les formes du moteur dont la vue a besoin (`InvoiceTotals`, remise, contrôle
// des paiements) sont recopiées à l'identique.
//
// Montants : TOUJOURS des chaînes décimales canoniques, dans les deux sens.
// L'interface n'en calcule aucun : totaux, conversion en CDF, contre-valeur USD
// et contrôles viennent du moteur, par l'API.

/** Décimal canonique, sans signe ni exposant (`"4064.00"`). Jamais un `number`. */
export type DecimalString = string;

export type InvoiceStatus =
  'draft' | 'issued' | 'pending_normalization' | 'normalized' | 'normalization_failed';
/** Filtre de liste : les statuts, plus `final` (`issued` + `normalized`) et `all`. */
export type InvoiceListStatus = InvoiceStatus | 'final' | 'all';
/** Six types e-DEF : vente, acompte, avoir, et leurs pendants à l'export. */
export type InvoiceType = 'FV' | 'FT' | 'FA' | 'EV' | 'ET' | 'EA';
export type CreditNoteNature = 'COR' | 'RAN' | 'RAM' | 'RRR';
export type CreditNoteScope = 'remaining' | 'empty';
export type DocumentCurrency = 'CDF' | 'USD';
export type InvoicePriceMode = 'ttc' | 'ht';
export type EmissionMode = 'standard' | 'normalized';
/** Ce que l'on peut imprimer : `invoice` seulement pour `issued` et `normalized`. */
export type DocumentKind = 'proforma' | 'invoice';
export type InvoiceSeries = 'real' | 'test' | 'proforma';
export type InvoiceLineSource = 'catalog' | 'free' | 'origin';
export type CommentLine = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
export type InvoiceComments = Readonly<Record<CommentLine, string | null>>;
export type ConversionRateSource =
  'dgi_currency_rates' | 'user_within_tolerance' | 'identity' | 'origin_invoice';
/** Modes de paiement e-DEF (distincts des moyens de paiement de l'abonnement). */
export type InvoicePaymentMethod =
  'ESPECES' | 'VIREMENT' | 'CARTEBANCAIRE' | 'MOBILEMONEY' | 'CHEQUES' | 'CREDIT' | 'AUTRE';
export type JournalEvent =
  | 'issued'
  | 'submitted'
  | 'number_reserved'
  | 'normalized'
  | 'normalization_failed'
  | 'number_released'
  | 'returned_to_draft'
  | 'duplicate_issued'
  | 'report_issued'
  // ADR-0024 § 10
  | 'normalization_uncertain'
  | 'normalization_review_required'
  | 'number_abandoned';

export type LineDiscount =
  { kind: 'percent'; value: DecimalString } | { kind: 'total_amount'; value: DecimalString };

export interface PaymentInput {
  method: InvoicePaymentMethod;
  amount: DecimalString;
}

export type InvoiceCustomerBody =
  | { customerId: string; printContactDetails: boolean }
  | { customerId: null; walkIn: { name: string | null } };

export interface CatalogLineBody {
  source: 'catalog';
  catalogItemId: string;
  quantity: DecimalString;
  /** `null` : prix de l'article (si l'article est dans la devise du document). */
  unitPrice: DecimalString | null;
  discount: LineDiscount | null;
}

export interface FreeLineBody {
  source: 'free';
  code: string | null;
  name: string;
  itemType: CatalogItemType;
  taxGroup: TaxGroupLetter;
  outOfScope: boolean;
  unit: string | null;
  quantity: DecimalString;
  unitPrice: DecimalString;
  specificTax: CatalogSpecificTax | null;
  discount: LineDiscount | null;
}

/** Ligne d'avoir hors RRR : reprise d'une ligne de l'origine, seule la quantité varie. */
export interface OriginLineBody {
  source: 'origin';
  originLineIndex: number;
  quantity: DecimalString;
}

export type InvoiceLineBody = CatalogLineBody | FreeLineBody | OriginLineBody;

/** `POST /sales/invoices` — brouillon. */
export interface CreateInvoiceBody {
  type: InvoiceType;
  currency: DocumentCurrency;
  priceMode: InvoicePriceMode;
  customer: InvoiceCustomerBody;
  /** `null` : le seul point de vente actif, s'il y en a un (sinon à choisir, ADR-0026 C6). */
  pointOfSaleId: string | null;
  lines: readonly InvoiceLineBody[];
  /** Dans la devise du document. */
  payments: readonly PaymentInput[];
  /** Seules A et C sont saisissables (§ S25e.7). */
  comments: { A: string | null; C: string | null };
  /** Requis pour `FA`/`EA`, interdit sinon. */
  creditNote: { nature: CreditNoteNature; originInvoiceId: string | null } | null;
  /** Document en CDF : indiquer la contre-valeur USD à la normalisation. */
  showUsdCounterValue: boolean;
}

/** `PUT /sales/invoices/:invoiceId` — corps COMPLET, brouillon seulement. */
export interface PutInvoiceBody extends CreateInvoiceBody {
  expectedRevision: number;
}

export interface CreateCreditNoteBody {
  nature: CreditNoteNature;
  scope: CreditNoteScope;
}

export interface NormalizeInvoiceBody {
  expectedRevision: number;
  /** `null` : taux officiel DGI du jour ; sinon un taux à ±1 % de celui-ci. */
  exchangeRate: { rate: DecimalString; date: string } | null;
}

export interface ListInvoicesQuery {
  status?: InvoiceListStatus;
  type?: InvoiceType;
  currency?: DocumentCurrency;
  customerId?: string;
  year?: number;
  /** Cherche dans le numéro, la référence de pro forma et le nom du client. */
  q?: string;
  limit?: number;
  cursor?: string;
}

/** Problème rendu par `computeInvoiceTotals` (message en français, affichable). */
export interface InvoiceTotalsIssue {
  code: string;
  lineIndex: number | null;
  field: string | null;
  message: string;
}

/** Problème des contrôles de paiement, d'avoir ou de conversion (moteur). */
export interface InvoiceCheckIssue {
  code: string;
  lineIndex: number | null;
  message: string;
  details?: Readonly<Record<string, string>>;
}

export interface InvoiceGroupTotals {
  group: TaxGroupLetter;
  ratePercent: DecimalString;
  total: DecimalString;
  ht: DecimalString;
  vat: DecimalString;
  specificTax: DecimalString;
}

export interface InvoiceTotals {
  calculationVersion: string;
  policyId: string;
  priceMode: InvoicePriceMode;
  lines: readonly {
    index: number;
    amount: DecimalString;
    specificTaxAmount: DecimalString;
    specificTaxValue: string | null;
  }[];
  groups: readonly InvoiceGroupTotals[];
  specificTax: DecimalString;
  total: DecimalString;
  vatTotal: DecimalString;
}

export interface InvoiceCustomerView {
  customerId: string | null;
  type: CustomerType;
  typeLabel: string;
  name: string | null;
  nif: string | null;
  exemptionReference: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  printContactDetails: boolean;
}

export interface InvoiceLineView {
  index: number;
  source: InvoiceLineSource;
  catalogItemId: string | null;
  originLineIndex?: number | null;
  code: string | null;
  edefCode: string | null;
  name: string;
  unit: string | null;
  itemType: CatalogItemType;
  taxGroup: TaxGroupLetter;
  outOfScope: boolean;
  quantity: DecimalString;
  originalPrice: DecimalString | null;
  discount: LineDiscount | null;
  /** Prix après remise, dans la devise du document. */
  unitPrice: DecimalString;
  priceModification: string | null;
  priceOverridden: boolean;
  specificTax: CatalogSpecificTax | null;
  amount: DecimalString | null;
  /** Facture d'origine seulement : quantités déjà créditées et restantes. */
  credited?: DecimalString;
  remaining?: DecimalString;
}

export interface InvoicePaymentView {
  method: InvoicePaymentMethod;
  methodLabel: string;
  amount: DecimalString;
}

export interface PaymentsCheck {
  ok: boolean;
  issues: readonly InvoiceCheckIssue[];
  paidTotal: DecimalString;
  amountOnCredit: DecimalString;
}

/** En brouillon, `ok: false`, `totals: null` et tous les problèmes. */
export interface InvoiceCalculationView {
  ok: boolean;
  issues: readonly InvoiceTotalsIssue[];
  totals: InvoiceTotals | null;
}

export interface DocumentAmountsView {
  label: string;
  currency: DocumentCurrency;
  calculation: InvoiceCalculationView;
  payments: readonly InvoicePaymentView[];
  paymentsCheck: PaymentsCheck | null;
}

export interface ConversionView {
  from: DocumentCurrency;
  to: 'CDF';
  /** CDF pour 1 USD ; "1" si `from` = CDF. */
  rate: DecimalString;
  rateDate: string;
  rateSource: ConversionRateSource;
  reference: {
    rate: DecimalString;
    date: string;
    environment: EdefEnvironment;
    sha256: string;
  } | null;
  originInvoiceId: string | null;
  conversionVersion: string;
}

/** « Montants normalisés (CDF) — font foi » : les seuls qui ont valeur fiscale. */
export interface NormalizedAmountsView {
  label: string;
  currency: 'CDF';
  lines: readonly {
    index: number;
    unitPrice: DecimalString;
    originalPrice: DecimalString | null;
    priceModification: string | null;
    specificTax: CatalogSpecificTax | null;
  }[];
  payments: readonly PaymentInput[];
  calculation: InvoiceTotals;
  counterValueUsd: { amount: DecimalString; rate: DecimalString; date: string } | null;
}

export interface CreditNoteView {
  nature: CreditNoteNature;
  originInvoiceId: string | null;
  originNumber: string | null;
  reference: string | null;
}

export interface InvoiceCreditNoteSummary {
  id: string;
  status: InvoiceStatus;
  documentKind: DocumentKind;
  proformaRef: string;
  number: string | null;
  nature: CreditNoteNature;
}

export interface SellerView {
  legalName: string;
  tradeName: string | null;
  nif: string;
  rccm: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  vatRegistered: boolean;
}

export interface OperatorView {
  userId: string;
  name: string;
}

/**
 * Phase exposée (ADR-0024 § 9.2) : `submitting`, `comparing`, `cancelling` et
 * `confirming` se lisent `in_progress`.
 */
export type NormalizationViewPhase =
  'queued' | 'in_progress' | 'uncertain' | 'needs_review' | 'done' | 'failed';

/** Catégorie d'une erreur de normalisation (ADR-0024 § 5 et § 9.2). */
export type NormalizationErrorCategory =
  | 'data'
  | 'configuration'
  | 'capacity'
  | 'temporary'
  | 'server'
  | 'state'
  | 'totals_mismatch'
  | 'duplicate_pending'
  | 'unknown'
  | 'network'
  | 'token_rejected'
  | 'precondition';

/** Dernière erreur : NOTRE message, PUIS code et libellé DGI tels quels (ADR-0024 § 5). */
export interface NormalizationErrorView {
  /** Code Lalanda. */
  code: string;
  category: NormalizationErrorCategory | null;
  /** Français, à afficher. */
  message: string;
  /** Code renvoyé par la DGI, à afficher tel quel. */
  dgiErrorCode: string | null;
  /** Libellé renvoyé par la DGI, à afficher tel quel. */
  dgiMessage: string | null;
  retryable: boolean;
}

/** Sous-document écrit par S25f (connexion DGI) — ADR-0023, élargi par ADR-0024 § 9.2. */
export interface NormalizationView {
  attempts: number;
  /** JAMAIS affiché comme numéro de facture. */
  reservedNumber: string | null;
  codeDefDgi: string | null;
  nim: string | null;
  counters: string | null;
  dgiDateTime: string | null;
  qrCode: string | null;
  lastError: NormalizationErrorView | null;
  normalizedAt: string | null;
  phase: NormalizationViewPhase;
  /** `uid` DGI de la demande, utile à l'assistance DGI ; `null` avant l'envoi. */
  dgiRequestId: string | null;
  /** Écart de totaux : `[{ field: "vab", ours: "64.00", dgi: "64.01" }]`. */
  differences: readonly { field: string; ours: string | null; dgi: string | null }[] | null;
  /** `uncertain` et `needs_review` : prochaine vérification. */
  nextCheckAt: string | null;
  /** `needs_review` seulement. */
  review: { since: string; reason: string } | null;
  /** Calculé par l'API selon la phase ET les permissions : l'interface n'en déduit rien d'autre. */
  actions: {
    retry: boolean;
    check: boolean;
    declareNotNormalized: boolean;
    backToDraft: boolean;
  };
}

/**
 * Entrée du journal des échanges DGI d'un document (ADR-0024 § 6 et § 9.3).
 * Corps rédigés par l'API ; JAMAIS d'en-tête ni de jeton.
 */
export interface DgiExchangeView {
  at: string;
  /** Lie la requête à sa réponse. */
  exchangeId: string;
  entry: 'request' | 'response' | 'complete';
  method: string;
  path: string;
  httpStatus: number | null;
  durationMs: number | null;
  /** `ok` ou un type d'échec du client e-MCF ; `null` pour une entrée `request`. */
  outcome: string | null;
  dgiErrorCode: string | null;
  body: string | null;
}

/** `GET /sales/invoices/:invoiceId/dgi-exchanges` — ordre chronologique. */
export interface DgiExchangePage {
  items: readonly DgiExchangeView[];
}

export interface InvoiceReadiness {
  /** Brouillon : `issue` (organisation ordinaire) ou `normalize` (mode normalisé). */
  action: 'issue' | 'normalize';
  ready: boolean;
  blockers: readonly { code: string; message: string; lineIndex?: number | null }[];
  /** Points à vérifier qui n'empêchent pas d'émettre (ADR-0023, amendement du 20 oct. 2026). */
  warnings?: readonly { code: string; message: string; lineIndex?: number | null }[];
}

export interface InvoiceView {
  id: string;
  status: InvoiceStatus;
  documentKind: DocumentKind;
  /** « Pro forma — non valable comme facture » tant que `documentKind = proforma`. */
  documentLabel: string;
  proformaRef: string;
  number: string | null;
  series: InvoiceSeries | null;
  fiscalYear: number | null;
  issuedAt: string | null;
  type: InvoiceType;
  typeLabel: string;
  currency: DocumentCurrency;
  priceMode: InvoicePriceMode;
  /** Document en CDF : contre-valeur USD demandée (relue à la réouverture d'un brouillon). */
  showUsdCounterValue: boolean;
  emissionMode: EmissionMode | null;
  environment: EdefEnvironment | null;
  isf: string | null;
  customer: InvoiceCustomerView;
  pointOfSaleId: string | null;
  lines: readonly InvoiceLineView[];
  documentAmounts: DocumentAmountsView;
  conversion: ConversionView | null;
  normalizedAmounts: NormalizedAmountsView | null;
  calculationVersion: string | null;
  roundingPolicyId: string | null;
  taxRates: {
    source: 'dgi_snapshot';
    environment: EdefEnvironment;
    fetchedAt: string;
    sha256: string;
  } | null;
  comments: InvoiceComments;
  creditNote: CreditNoteView | null;
  creditNotes: readonly InvoiceCreditNoteSummary[];
  seller: SellerView | null;
  operator: OperatorView | null;
  /** Version de Lalanda qui a gelé le document ; `null` : brouillon, ou gelé avant le 20 oct. 2026. */
  softwareVersion: string | null;
  /** Présentation figée au gel (ADR-0028 § 6) ; `null` : brouillon. */
  presentation: InvoicePresentationView | null;
  normalization: NormalizationView | null;
  readiness: InvoiceReadiness;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Modèle et version qui impriment le document (`original` : présentation d'origine). */
export interface InvoicePresentationView {
  kind: 'template' | 'original';
  templateId: string | null;
  templateLabel: string | null;
  version: string | null;
  options: { palette: string; accent: string; font: string } | null;
}

export interface InvoiceSummary {
  id: string;
  status: InvoiceStatus;
  documentKind: DocumentKind;
  proformaRef: string;
  number: string | null;
  type: InvoiceType;
  currency: DocumentCurrency;
  issuedAt: string | null;
  customer: { name: string | null; type: CustomerType };
  documentAmounts: { calculation: { totals: { total: DecimalString } | null } };
  normalizedAmounts: { calculation: { total: DecimalString } } | null;
  emissionMode: EmissionMode | null;
  /** `test` = normalisé dans l'environnement de TEST DGI ; `null` sans numéro. */
  series: InvoiceSeries | null;
  revision: number;
}

export interface InvoicePage {
  items: InvoiceSummary[];
  nextCursor: string | null;
}

export interface JournalEntryView {
  seq: number;
  at: string;
  event: JournalEvent;
  invoiceId: string | null;
  proformaRef: string | null;
  number: string | null;
  series: InvoiceSeries | null;
  type: InvoiceType | null;
  creditNature: CreditNoteNature | null;
  originNumber: string | null;
  documentTotals: {
    currency: DocumentCurrency;
    total: DecimalString;
    vatTotal: DecimalString;
  } | null;
  normalizedTotals: {
    total: DecimalString;
    vatTotal: DecimalString;
    specificTax: DecimalString;
  } | null;
  conversion: { rate: DecimalString; rateDate: string; rateSource: ConversionRateSource } | null;
  contentSha256: string | null;
  codeDefDgi: string | null;
  nim: string | null;
  counters: string | null;
  /** `null` pour l'ordonnanceur. */
  actor: OperatorView | null;
  hash: string;
}

export interface JournalPage {
  items: JournalEntryView[];
  nextCursor: string | null;
  /** Le chaînage `prevHash` → `hash` est-il intact ? */
  chainValid: boolean;
}

/** `GET /health` de l'API (version de release : ADR-0026 § 6.2). */
export interface ApiHealth {
  status: 'ok' | 'degraded';
  service: 'lalanda-api';
  version: string;
  versionSource: 'release' | 'package';
  uptimeSec: number;
  checks: { mongo: 'up' | 'down' };
}

/** Point de vente e-MCF proposable dans l'éditeur (ADR-0026, écart C6). */
export interface SelectablePointOfSale {
  id: string;
  label: string;
  nim: string | null;
  shopName: string | null;
}

/** `GET /sales/points-of-sale` — points de vente ACTIFS dans l'environnement de l'organisation. */
export interface SelectablePointsOfSale {
  emissionMode: EmissionMode;
  environment: EdefEnvironment;
  items: SelectablePointOfSale[];
}

/** `GET /sales/exchange-rate-reference`. */
export interface ExchangeRateReference {
  currency: 'USD';
  rate: DecimalString;
  /** Date DGI conservée telle quelle, décalage horaire compris. */
  date: string;
  source: 'dgi_snapshot';
  environment: EdefEnvironment;
  fetchedAt: string;
  tolerancePercent: DecimalString;
}

/** Chaîne de requête d'une liste des ventes. Les champs absents ou vides ne partent pas. */
export function salesQuery(params: object): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    search.set(k, String(v));
  }
  const q = search.toString();
  return q ? `?${q}` : '';
}

// ─── Encaissements, règlement et pont vers le réalisé (ADR-0031) ───────────
// Miroir de `apps/api/src/sales/receipts/` et `apps/api/src/actuals/run-bridge/`.
// Montants : chaînes décimales calculées par le moteur ; l'interface n'en
// calcule aucun.

export type ReceiptMethod =
  'ESPECES' | 'VIREMENT' | 'CARTEBANCAIRE' | 'MOBILEMONEY' | 'CHEQUES' | 'AUTRE';

export interface ReceiptAllocationView {
  invoiceId: string;
  invoiceNumber: string | null;
  amount: string;
}

export interface ReceiptView {
  id: string;
  status: 'recorded' | 'cancelled';
  receivedOn: string;
  amount: string;
  currency: 'CDF' | 'USD';
  method: ReceiptMethod;
  reference: string | null;
  note: string | null;
  /** Compte de trésorerie (ADR-0034, non intégré), facultatif. */
  accountId: string | null;
  allocations: ReceiptAllocationView[];
  cancellation: { at: string; by: string; reason: string } | null;
  calculationVersion: string;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptBody {
  receivedOn: string;
  amount: string;
  currency: 'CDF' | 'USD';
  method: ReceiptMethod;
  reference: string | null;
  note: string | null;
  accountId?: string | null;
  allocations: { invoiceId: string; amount: string }[];
}

export interface MonthlyCurrencyTotal {
  month: string;
  currency: 'CDF' | 'USD';
  total: string;
  count: number;
}

export interface ReceiptsSummary {
  from: string | null;
  to: string | null;
  months: MonthlyCurrencyTotal[];
  version: string;
}

export type SettlementStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overdue';

export interface SettlementView {
  invoiceId: string;
  number: string | null;
  type: string;
  currency: 'CDF' | 'USD';
  customerName: string | null;
  issuedOn: string | null;
  total: string | null;
  dueDate: string | null;
  status: SettlementStatus | 'not_applicable';
  reason: 'NOT_FINAL' | 'CREDIT_NOTE' | 'TEST_SERIES' | 'NO_PAYMENTS_DECLARED' | null;
  settlement: {
    status: SettlementStatus;
    overdue: boolean;
    due: string;
    credited: string;
    received: string;
    outstanding: string;
    creditBalance: string;
    version: string;
  } | null;
  asOf: string;
}

export interface ActualsBridgeView {
  state: 'disabled' | 'not_configured' | 'active';
  enabled: boolean;
  projectId: string | null;
  projectName: string | null;
  projectCurrency: string | null;
  revenueLineId: string | null;
  exerciseStart: string | null;
  lastSync: {
    at: string;
    by: string;
    version: string;
    written: number;
    unchanged: number;
    removed: number;
    blocked: number;
    skipped: number;
  } | null;
}

export interface ActualsBridgeCandidate {
  projectId: string;
  name: string;
  currency: string;
  approvedPlanVersion: number | null;
  lines: { lineId: string; label: string }[];
}

export interface ActualsBridgeSettings {
  enabled: boolean;
  projectId: string | null;
  revenueLineId: string | null;
  exerciseStart: string | null;
}

export type ActualsSyncOutcome =
  | 'written'
  | 'unchanged'
  | 'removed'
  | 'PERIOD_CLOSED'
  | 'MANUAL_VALUE_PRESENT'
  | 'OTHER_SOURCE_PRESENT';

export interface ActualsSyncReport {
  dryRun: boolean;
  at: string;
  version: string;
  projectId: string;
  projectCurrency: string;
  revenueLineId: string;
  exerciseStart: string;
  entries: {
    calendarMonth: string | null;
    year: number;
    month: number;
    lineId: string;
    value: string | null;
    storedValue: number | null;
    outcome: ActualsSyncOutcome;
    documents: number;
  }[];
  skipped: {
    calendarMonth: string;
    reason: 'OUTSIDE_PLAN_HORIZON' | 'CURRENCY_NOT_CONVERTIBLE';
    fiscal: { year: number; month: number } | null;
    documentIds: string[];
  }[];
  excludedDepositIds: string[];
  counts: { written: number; unchanged: number; removed: number; blocked: number; skipped: number };
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

  // ─── Fiscalité et facture normalisée (S25b — ADR-0021 §10) ───
  //
  // Ré-authentification de SA PROPRE session (membre d'organisation). Sans mot
  // de passe : compte créé par Google, fenêtre ouverte seulement si la session
  // a moins de dix minutes (sinon `401 REAUTH_GOOGLE_REQUIRED`).
  getMeReauth: () => jsonRequest<MeReauthStatus>(`/me/reauth`, { method: 'GET' }),
  confirmMeReauth: (password?: string) =>
    jsonRequest<{ expiresAt: string }>(`/me/reauth`, {
      method: 'POST',
      body: password === undefined ? {} : { password },
    }),

  getFiscalProfile: () =>
    jsonRequest<FiscalProfileView>(`/organizations/current/fiscal-profile`, { method: 'GET' }),
  putFiscalProfile: (body: FiscalProfileBody) =>
    jsonRequest<FiscalProfileView>(`/organizations/current/fiscal-profile`, {
      method: 'PUT',
      body,
    }),

  getNormalizedInvoicing: () =>
    jsonRequest<NormalizedInvoicingView>(`/organizations/current/normalized-invoicing`, {
      method: 'GET',
    }),
  activateNormalizedInvoicing: (environment: EdefEnvironment) =>
    jsonRequest<NormalizedInvoicingView>(`/organizations/current/normalized-invoicing/activate`, {
      method: 'POST',
      body: { environment },
    }),
  deactivateNormalizedInvoicing: (reason: string) =>
    jsonRequest<NormalizedInvoicingView>(`/organizations/current/normalized-invoicing/deactivate`, {
      method: 'POST',
      body: { reason },
    }),
  changeNormalizedInvoicingEnvironment: (environment: EdefEnvironment, reason?: string) =>
    jsonRequest<NormalizedInvoicingView>(
      `/organizations/current/normalized-invoicing/environment`,
      {
        method: 'POST',
        body: reason === undefined ? { environment } : { environment, reason },
      },
    ),

  /**
   * Le jeton part dans le CORPS, jamais dans l'URL ; l'API le teste auprès de la
   * DGI AVANT toute écriture (ADR-0021 §4.1) et ne le renvoie jamais.
   */
  createPointOfSale: (body: CreatePointOfSaleBody) =>
    jsonRequest<PointOfSaleView>(`/organizations/current/normalized-invoicing/points-of-sale`, {
      method: 'POST',
      body,
    }),
  updatePointOfSale: (posId: string, body: { label?: string; expectedNim?: string | null }) =>
    jsonRequest<PointOfSaleView>(
      `/organizations/current/normalized-invoicing/points-of-sale/${encodeURIComponent(posId)}`,
      {
        method: 'PATCH',
        body,
      },
    ),
  replacePointOfSaleToken: (posId: string, token: string) =>
    jsonRequest<PointOfSaleView>(
      `/organizations/current/normalized-invoicing/points-of-sale/${encodeURIComponent(posId)}/token`,
      {
        method: 'PUT',
        body: { token },
      },
    ),
  testPointOfSale: (posId: string) =>
    jsonRequest<PointOfSaleView>(
      `/organizations/current/normalized-invoicing/points-of-sale/${encodeURIComponent(posId)}/test`,
      {
        method: 'POST',
      },
    ),
  disablePointOfSale: (posId: string, reason?: string) =>
    jsonRequest<PointOfSaleView>(
      `/organizations/current/normalized-invoicing/points-of-sale/${encodeURIComponent(posId)}/disable`,
      {
        method: 'POST',
        body: reason === undefined ? {} : { reason },
      },
    ),
  getPointOfSaleReferenceData: (posId: string) =>
    jsonRequest<EdefReferenceDataView>(
      `/organizations/current/normalized-invoicing/points-of-sale/${encodeURIComponent(posId)}/reference-data`,
      { method: 'GET' },
    ),

  // ─── Ventes : clients et catalogue (S25c — ADR-0022 § S25c.5) ─────────────
  // Scopées par l'organisation ACTIVE (cookie) : aucun identifiant
  // d'organisation ne part dans l'URL ni le corps. Une fiche d'une autre
  // organisation répond 404.
  listCustomers: (query: CustomerListQuery = {}) =>
    jsonRequest<CustomerPage>(`/sales/customers${salesQuery(query)}`, { method: 'GET' }),
  getCustomer: (customerId: string) =>
    jsonRequest<CustomerView>(`/sales/customers/${encodeURIComponent(customerId)}`, {
      method: 'GET',
    }),
  createCustomer: (body: CustomerBody) =>
    jsonRequest<CustomerView>(`/sales/customers`, { method: 'POST', body }),
  updateCustomer: (customerId: string, body: CustomerUpdateBody) =>
    jsonRequest<CustomerView>(`/sales/customers/${encodeURIComponent(customerId)}`, {
      method: 'PUT',
      body,
    }),
  deactivateCustomer: (customerId: string) =>
    jsonRequest<CustomerView>(`/sales/customers/${encodeURIComponent(customerId)}/deactivate`, {
      method: 'POST',
    }),
  reactivateCustomer: (customerId: string) =>
    jsonRequest<CustomerView>(`/sales/customers/${encodeURIComponent(customerId)}/reactivate`, {
      method: 'POST',
    }),
  /** 204 ; `409 CUSTOMER_ALREADY_INVOICED` si le client a déjà été facturé. */
  deleteCustomer: (customerId: string) =>
    jsonRequest<void>(`/sales/customers/${encodeURIComponent(customerId)}`, {
      method: 'DELETE',
    }),

  listCatalogItems: (query: CatalogItemListQuery = {}) =>
    jsonRequest<CatalogItemPage>(`/sales/catalog-items${salesQuery(query)}`, { method: 'GET' }),
  getCatalogItem: (itemId: string) =>
    jsonRequest<CatalogItemView>(`/sales/catalog-items/${encodeURIComponent(itemId)}`, {
      method: 'GET',
    }),
  createCatalogItem: (body: CatalogItemBody) =>
    jsonRequest<CatalogItemView>(`/sales/catalog-items`, { method: 'POST', body }),
  updateCatalogItem: (itemId: string, body: CatalogItemUpdateBody) =>
    jsonRequest<CatalogItemView>(`/sales/catalog-items/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      body,
    }),
  deactivateCatalogItem: (itemId: string) =>
    jsonRequest<CatalogItemView>(`/sales/catalog-items/${encodeURIComponent(itemId)}/deactivate`, {
      method: 'POST',
    }),
  reactivateCatalogItem: (itemId: string) =>
    jsonRequest<CatalogItemView>(`/sales/catalog-items/${encodeURIComponent(itemId)}/reactivate`, {
      method: 'POST',
    }),
  /** 204 ; `409 CATALOG_ITEM_ALREADY_INVOICED` si l'article a déjà été facturé. */
  deleteCatalogItem: (itemId: string) =>
    jsonRequest<void>(`/sales/catalog-items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
    }),

  getTaxGroups: () => jsonRequest<TaxGroupList>(`/sales/tax-groups`, { method: 'GET' }),

  // ─── Ventes : factures, pro forma et avoirs (S25e — ADR-0023 § S25e.14) ────
  // Lecture `sales.read` ; brouillons `sales.manage` ; émission et
  // normalisation `sales.invoice`. Aucun montant n'est calculé ici.
  listInvoices: (query: ListInvoicesQuery = {}) =>
    jsonRequest<InvoicePage>(`/sales/invoices${salesQuery(query)}`, { method: 'GET' }),
  getInvoice: (invoiceId: string) =>
    jsonRequest<InvoiceView>(`/sales/invoices/${encodeURIComponent(invoiceId)}`, {
      method: 'GET',
    }),
  createInvoice: (body: CreateInvoiceBody) =>
    jsonRequest<InvoiceView>(`/sales/invoices`, { method: 'POST', body }),
  updateInvoice: (invoiceId: string, body: PutInvoiceBody) =>
    jsonRequest<InvoiceView>(`/sales/invoices/${encodeURIComponent(invoiceId)}`, {
      method: 'PUT',
      body,
    }),
  /** 204 ; brouillon seulement (`409 INVOICE_NOT_DRAFT` sinon). */
  deleteInvoice: (invoiceId: string) =>
    jsonRequest<void>(`/sales/invoices/${encodeURIComponent(invoiceId)}`, { method: 'DELETE' }),
  /** Crée un brouillon d'avoir prérempli sur une facture finale. */
  createCreditNote: (invoiceId: string, body: CreateCreditNoteBody) =>
    jsonRequest<InvoiceView>(`/sales/invoices/${encodeURIComponent(invoiceId)}/credit-notes`, {
      method: 'POST',
      body,
    }),
  /** Organisation ordinaire : numéro définitif, contenu figé. */
  issueInvoice: (invoiceId: string, expectedRevision: number) =>
    jsonRequest<InvoiceView>(`/sales/invoices/${encodeURIComponent(invoiceId)}/issue`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  /** Organisation en facture normalisée : conversion CDF, gel, « en attente DGI ». */
  normalizeInvoice: (invoiceId: string, body: NormalizeInvoiceBody) =>
    jsonRequest<InvoiceView>(`/sales/invoices/${encodeURIComponent(invoiceId)}/normalize`, {
      method: 'POST',
      body,
    }),
  // ADR-0024 § 9.1 — un refus de la DGI n'est PAS une erreur HTTP : ces routes
  // répondent 200 avec l'état obtenu. Aucune n'est rejouée automatiquement.
  /** Depuis `failed` réessayable ou `queued` ; `409 NORMALIZATION_NOT_RETRYABLE` sinon. */
  retryNormalization: (invoiceId: string) =>
    jsonRequest<InvoiceView>(
      `/sales/invoices/${encodeURIComponent(invoiceId)}/normalization/retry`,
      { method: 'POST' },
    ),
  /** Vérification immédiate auprès de la DGI (`uncertain` échu, `needs_review`). */
  checkNormalization: (invoiceId: string) =>
    jsonRequest<InvoiceView>(
      `/sales/invoices/${encodeURIComponent(invoiceId)}/normalization/check`,
      { method: 'POST' },
    ),
  /**
   * `needs_review` seulement (`409 NORMALIZATION_NOT_UNDER_REVIEW` sinon) ;
   * `fiscal.manage` et ré-authentification (`401 REAUTH_REQUIRED`). Motif de 20
   * à 500 caractères.
   */
  declareNotNormalized: (invoiceId: string, reason: string) =>
    jsonRequest<InvoiceView>(
      `/sales/invoices/${encodeURIComponent(invoiceId)}/normalization/declare-not-normalized`,
      { method: 'POST', body: { reason } },
    ),
  /** Échanges DGI du document, en ordre chronologique ; jamais d'en-tête ni de jeton. */
  listDgiExchanges: (invoiceId: string) =>
    jsonRequest<DgiExchangePage>(`/sales/invoices/${encodeURIComponent(invoiceId)}/dgi-exchanges`, {
      method: 'GET',
    }),
  backToDraft: (invoiceId: string, expectedRevision: number) =>
    jsonRequest<InvoiceView>(`/sales/invoices/${encodeURIComponent(invoiceId)}/back-to-draft`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  /**
   * ADR-0025 : PDF de l'original (`GET`, reproduit à l'identique, `sales.read`)
   * ou d'un duplicata numéroté (`POST`, journalisé, `sales.manage`).
   */
  downloadInvoicePdf: (invoiceId: string, fallbackName: string) =>
    invoicePdfRequest(invoiceId, 'pdf', fallbackName),
  downloadInvoiceDuplicate: (invoiceId: string, fallbackName: string) =>
    invoicePdfRequest(invoiceId, 'duplicate', fallbackName),
  // ─── Encaissements et règlement (ADR-0031) ─────────────────────
  // Lecture `sales.read` ; écriture `sales.receipt` ; échéance `sales.manage`.
  listReceipts: (
    query: { status?: 'recorded' | 'cancelled' | 'all'; invoiceId?: string; limit?: number } = {},
  ) =>
    jsonRequest<{ items: ReceiptView[] }>(`/sales/receipts${salesQuery(query)}`, { method: 'GET' }),
  getReceiptsSummary: () =>
    jsonRequest<ReceiptsSummary>(`/sales/receipts/summary`, { method: 'GET' }),
  createReceipt: (body: ReceiptBody) =>
    jsonRequest<ReceiptView>(`/sales/receipts`, { method: 'POST', body }),
  cancelReceipt: (receiptId: string, reason: string, expectedRevision: number) =>
    jsonRequest<ReceiptView>(`/sales/receipts/${encodeURIComponent(receiptId)}/cancel`, {
      method: 'POST',
      body: { reason, expectedRevision },
    }),
  /** Statuts de règlement d'un lot de factures (100 au plus). */
  getSettlements: (invoiceIds: readonly string[]) =>
    jsonRequest<{ items: SettlementView[] }>(
      `/sales/settlements${salesQuery({ invoiceIds: invoiceIds.join(',') })}`,
      { method: 'GET' },
    ),
  /** Factures avec un reste à encaisser, les plus anciennes d'abord. */
  getOpenSettlements: (currency?: 'CDF' | 'USD') =>
    jsonRequest<{ items: SettlementView[] }>(
      `/sales/settlements${salesQuery({ open: 'true', currency })}`,
      { method: 'GET' },
    ),
  setInvoiceDueDate: (invoiceId: string, dueDate: string | null) =>
    jsonRequest<SettlementView>(`/sales/settlements/${encodeURIComponent(invoiceId)}/due-date`, {
      method: 'PUT',
      body: { dueDate },
    }),
  // Pont vers le réalisé : lecture `sales.read` ; réglage et synchronisation
  // `actuals.import` + `sales.read`.
  getActualsBridge: () =>
    jsonRequest<ActualsBridgeView>(`/sales/actuals-bridge`, { method: 'GET' }),
  getActualsBridgeCandidates: () =>
    jsonRequest<{ items: ActualsBridgeCandidate[] }>(`/sales/actuals-bridge/candidates`, {
      method: 'GET',
    }),
  putActualsBridge: (settings: ActualsBridgeSettings) =>
    jsonRequest<ActualsBridgeView>(`/sales/actuals-bridge`, { method: 'PUT', body: settings }),
  syncActualsBridge: (dryRun: boolean) =>
    jsonRequest<ActualsSyncReport>(`/sales/actuals-bridge/sync`, {
      method: 'POST',
      body: { dryRun },
    }),
  // ─── Identité visuelle et modèles de facture (ADR-0028) ───────
  getBrand: () => jsonRequest<BrandView>(`/organizations/current/brand`, { method: 'GET' }),
  putBrandIdentity: (input: PutBrandIdentityInput) =>
    jsonRequest<BrandView>(`/organizations/current/brand/identity`, {
      method: 'PUT',
      body: input,
    }),
  /** Corps BINAIRE brut, comme la photo de profil ; l'API assainit et tranche le type. */
  uploadBrandLogo: (variant: LogoVariant, file: File) =>
    binaryRequest<BrandView>(
      `/organizations/current/brand/logos/${encodeURIComponent(variant)}`,
      file,
    ),
  removeBrandLogo: (variant: LogoVariant) =>
    jsonRequest<BrandView & { removed: boolean }>(
      `/organizations/current/brand/logos/${encodeURIComponent(variant)}`,
      { method: 'DELETE' },
    ),
  getInvoiceTemplates: () =>
    jsonRequest<InvoiceTemplatesView>(`/sales/invoice-templates`, { method: 'GET' }),
  putInvoiceTemplate: (input: PutInvoiceTemplateInput) =>
    jsonRequest<InvoiceTemplatesView>(`/sales/invoice-template`, { method: 'PUT', body: input }),
  /** Modèles sur mesure installés (ADR-0029). */
  getInvoiceTemplatePackages: () =>
    jsonRequest<TemplatePackagesView>(`/sales/invoice-template-packages`, { method: 'GET' }),
  /** Archive ZIP en corps BRUT ; l'API valide tout et rend le rapport (422 si invalide). */
  uploadInvoiceTemplatePackage: (file: File) =>
    binaryRequest<TemplatePackageInstallResult>(`/sales/invoice-template-packages`, file),
  activateInvoiceTemplatePackage: (input: {
    packageId: string;
    options: InvoiceTemplateOptionsInput;
    expectedRevision: number;
  }) =>
    jsonRequest<TemplatePackagesView>(`/sales/invoice-template/custom`, {
      method: 'PUT',
      body: input,
    }),
  getInvoiceTemplatePackagePreview: (
    packageId: string,
    options: Partial<InvoiceTemplateOptions>,
    format: 'png' | 'pdf' = 'png',
  ) => templatePackagePreviewRequest(packageId, options, format),
  /** Aperçu RÉEL rendu par l'API d'une facture fictive marquée EXEMPLE. */
  getInvoiceTemplatePreview: (
    templateId: InvoiceTemplateId,
    options: Partial<InvoiceTemplateOptions>,
    format: 'png' | 'pdf' = 'png',
  ) => invoiceTemplatePreviewRequest(templateId, options, format),
  listJournal: (query: { limit?: number; cursor?: string } = {}) =>
    jsonRequest<JournalPage>(`/sales/journal${salesQuery(query)}`, { method: 'GET' }),
  getExchangeRateReference: () =>
    jsonRequest<ExchangeRateReference>(`/sales/exchange-rate-reference`, { method: 'GET' }),
  /** Export du journal des ventes et des échanges e-MCF (ADR-0026 § 6.3, `fiscal.manage`). */
  downloadSalesJournalExport: (q: SalesJournalExportQuery, fallbackName: string) =>
    salesJournalExportRequest(q, fallbackName),
  /** `GET /health` — version du serveur (ADR-0026 § 6.2). Publique, sans session. */
  getHealth: () => jsonRequest<ApiHealth>(`/health`, { method: 'GET' }),
  listSelectablePointsOfSale: () =>
    jsonRequest<SelectablePointsOfSale>(`/sales/points-of-sale`, { method: 'GET' }),

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

  // ─── Appel vocal — voir l'encadré au-dessus de `QuotaVocalView` ───────────
  //
  // Aucune de ces trois méthodes ne prend de paramètre décrivant le projet.
  // Ce n'est pas une simplification : c'est la frontière.

  /** État du bouton d'appel. Lire un quota n'en consomme pas. */
  etatAppelVocal: () => jsonRequest<EtatVocalView>('/ai/lala/vocal/etat'),

  /**
   * Ouvre une session vocale.
   *
   * Aucun argument, et aucun corps : l'API n'accepte rien d'autre que
   * l'identité déjà portée par le cookie de session. Si cette signature gagne
   * un jour un paramètre, c'est que la frontière a été franchie.
   */
  ouvrirAppelVocal: () =>
    jsonRequest<SessionVocaleView>('/ai/lala/vocal/sessions', { method: 'POST', body: {} }),

  /**
   * Rapporte la durée réelle d'une session terminée.
   *
   * `minutes` est une DURÉE, pas un contenu : c'est le seul chiffre qui remonte
   * d'une conversation vocale, et il ne dit rien de ce qui s'y est dit. Ne pas
   * l'appeler n'est jamais avantageux — le serveur a déjà débité le plafond de
   * session, et cet appel ne peut que le corriger à la baisse.
   */
  cloturerAppelVocal: (input: { sessionId: string; minutes: number }) =>
    jsonRequest<ClotureVocaleView>('/ai/lala/vocal/cloture', { method: 'POST', body: input }),

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
