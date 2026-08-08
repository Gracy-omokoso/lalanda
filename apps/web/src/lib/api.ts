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

// ─── Organisations (S5c) ───────────────────────────────────────
export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  type: string;
  pays: string;
  role: 'owner' | 'member';
}

// ─── Invitations (S5d) ─────────────────────────────────────────
export interface InvitationView {
  id: string;
  organizationId: string;
  email: string;
  role: 'owner' | 'member';
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
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
  createInvitation: (orgId: string, input: { email: string; role?: 'owner' | 'member' }) =>
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
  // ─── Reports PDF (S8-lite) ─────────────────────────────────
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
