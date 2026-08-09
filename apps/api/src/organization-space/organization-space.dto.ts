// Contrats d'entrée et de sortie de l'espace organisation (S21a).
//
// Aucune décision d'autorisation ici : la matrice est dans `authz/permissions.ts`
// (ADR-0012 §8) et ce fichier ne fait que DÉCRIRE ce que le serveur renvoie une
// fois la décision prise.

import { z } from 'zod';

import type { Action, OrgRole } from '../authz/permissions.js';
import type { Entitlements, Plan } from '../billing/entitlements.js';

/**
 * Devises d'affichage acceptées.
 *
 * Recopiées de `account/account.dto.ts` (S20b) plutôt qu'importées : `account/`
 * appartient à un autre périmètre d'écriture (ADR-0012 §9) et une organisation
 * n'a aucune raison de dépendre du module « compte utilisateur ». Un test
 * verrouille l'égalité des deux listes — la duplication est surveillée, pas subie.
 */
export const DISPLAY_CURRENCIES = ['USD', 'CDF', 'XOF', 'XAF', 'EUR'] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/** Réglages servis quand l'organisation n'a encore jamais été paramétrée. */
export const DEFAULT_ORGANIZATION_SETTINGS = {
  deviseAffichage: 'USD' as DisplayCurrency,
  logoUrl: null as string | null,
};

/**
 * Écriture des paramètres d'organisation.
 *
 * `.strict()` : un champ inconnu est refusé plutôt qu'ignoré. Sans cela, une
 * interface qui enverrait `plan` ou `ownerId` recevrait un 200 en croyant les
 * avoir modifiés.
 */
export const UpdateOrganizationSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    // Même contrainte que `POST /organizations` (organizations.controller.ts) :
    // code ISO-3166-1 alpha-2. La cohérence avec un Country Pack existant n'est
    // PAS vérifiée ici — un pays sans pack reste un choix légitime, c'est le
    // projet qui exige un pack, pas l'organisation (docs/09).
    pays: z
      .string()
      .trim()
      .length(2)
      .regex(/^[A-Za-z]{2}$/, 'Code pays ISO-2 attendu (ex. CD).'),
    deviseAffichage: z.enum(DISPLAY_CURRENCIES),
    // URL seulement, http(s) uniquement : `javascript:` et `data:` sont des
    // vecteurs d'injection dès qu'on rend l'URL dans un `<img>` (docs/17).
    logoUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
        message: 'Le logo doit être une URL http(s).',
      })
      .nullable()
      .or(z.literal('').transform(() => null)),
  })
  .strict();

export type UpdateOrganizationSettingsInput = z.infer<typeof UpdateOrganizationSettingsSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Paramètres
// ─────────────────────────────────────────────────────────────────────────────

export interface OrganizationSettingsView {
  id: string;
  name: string;
  slug: string;
  type: string;
  pays: string;
  deviseAffichage: DisplayCurrency;
  logoUrl: string | null;
  updatedAt: string | null;
  /** Valeurs acceptées, servies par l'API — l'interface ne les code pas en dur. */
  options: { currencies: readonly string[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tableau de bord
// ─────────────────────────────────────────────────────────────────────────────

/** Identité de l'organisation, servie à TOUT membre — aucune donnée financière. */
export interface DashboardOrganization {
  id: string;
  name: string;
  slug: string;
  type: string;
  pays: string;
  deviseAffichage: DisplayCurrency;
  logoUrl: string | null;
}

/** Consommation face aux limites du plan (S16b) — jamais recalculée ici. */
export interface ConsommationView {
  plan: Plan;
  projets: { utilise: number; limite: number | null };
  sieges: { utilise: number; limite: number | null };
}

/** Bloc `organization.manage` — Propriétaire et Administrateur. */
export interface GouvernanceSection {
  projets: number;
  /** Plans validés depuis le 1er du mois courant (UTC). */
  plansValidesCeMois: number;
  membresActifs: number;
  consommation: ConsommationView;
}

/**
 * Ratio au rouge, LU dans le snapshot d'un plan validé.
 *
 * Le feu tricolore est produit par le moteur au moment de la validation et figé
 * dans `financial_plans.result.lines[].seuil` (S16c). On le relit; on ne le
 * recalcule jamais — CLAUDE.md : « le moteur financier est l'unique source de
 * vérité des calculs ».
 */
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

export type PlanEnAttenteRaison = 'AUCUN_PLAN' | 'HYPOTHESES_MODIFIEES';

export interface PlanEnAttenteView {
  projectId: string;
  projectName: string;
  /** Dernière version validée, `null` si le projet n'a jamais été validé. */
  derniereVersion: number | null;
  raison: PlanEnAttenteRaison;
  /** Date de la dernière modification d'hypothèses, si connue. */
  modifieLe: string | null;
}

export interface EcartProjetView {
  projectId: string;
  projectName: string;
  year: number;
  planVersion: number;
  lignesDefavorables: number;
  /** Écart relatif le plus défavorable (fraction : 0.12 = 12 %). */
  pireEcart: { lineId: string; label: string; ecartPct: number } | null;
}

/** Bloc `plan.approve` — Propriétaire et Directeur financier. */
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

/** Bloc `actuals.import` — Comptable, et les rôles qui le couvrent. */
export interface ComptabiliteSection {
  /** Case ⚙ de la matrice : le Comptable ne clôture que si le droit lui est accordé. */
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
  /** R2 — plan auto-approuvé faute d'un second approbateur (ADR-0012 §6). */
  soleApprover: boolean;
}

/** Bloc `project.read` — tous les rôles, y compris Conseiller et Lecteur. */
export interface ProjetsSection {
  projets: ProjetResumeView[];
  dernieresValidations: ValidationRecenteView[];
}

/**
 * Un bloc que le rôle de l'appelant ne permet pas de voir, avec la raison en
 * français.
 *
 * Sa présence est le contraire d'une fuite : la liste ne contient JAMAIS de
 * données, seulement le nom du bloc absent et l'action qui l'ouvrirait. Elle
 * existe pour que l'interface puisse dire « votre rôle ne donne pas accès à ceci »
 * au lieu d'afficher un trou ou de crier une panne (docs/12, page Membres S20a).
 */
export interface BlocMasqueView {
  section: 'gouvernance' | 'validation' | 'comptabilite' | 'projets';
  titre: string;
  action: Action;
  raison: string;
}

export interface OrganizationDashboardView {
  organization: DashboardOrganization;
  role: OrgRole;
  roleLabel: string;
  /** Actions effectives de l'appelant — même source que `GET /me/permissions`. */
  actions: Action[];
  /** Aucune action d'écriture proposée : Conseiller et Lecteur. */
  lectureSeule: boolean;
  sections: {
    gouvernance: GouvernanceSection | null;
    validation: ValidationSection | null;
    comptabilite: ComptabiliteSection | null;
    projets: ProjetsSection | null;
  };
  masque: BlocMasqueView[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Facturation
// ─────────────────────────────────────────────────────────────────────────────

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
  /** Ressources déjà au-dessus de la limite du plan (docs/13 § Changements de plan). */
  depassements: DepassementView[];
  historique: HistoriqueAbonnementView[];
  /**
   * Aucun fournisseur de paiement n'est branché (docs/13 § Hors périmètre S16b).
   * Le dire dans la réponse plutôt que de laisser l'interface l'inventer.
   */
  paiement: { integre: false; message: string };
}
