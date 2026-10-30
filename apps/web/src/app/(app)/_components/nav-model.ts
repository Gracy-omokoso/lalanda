// Logique pure de la navigation par modules (ADR-0038, amende ADR-0030 § 2).
//
// Trois niveaux : la barre du haut (Accueil · BUILD · RUN · GROW), le bureau du
// module (grille de tuiles) et la colonne de gauche qui ne liste QUE les
// applications du module courant, avec leurs sous-options dépliables.
//
// Même discipline que `user-menu-model.ts` : ce qui DÉCIDE — les applications,
// leur module, leurs sous-options, leur condition d'affichage, le module et
// l'application allumés par le chemin — vit ici et se teste sans DOM (vitest
// tourne en environnement `node`). Les `.tsx` ne font qu'assembler.
//
// Rien de ce fichier n'AUTORISE quoi que ce soit. Une entrée masquée est un
// confort ; `PermissionsGuard` refuse côté API de toute façon (ADR-0012 §8).
// Les conditions sont des actions servies par `GET /me/permissions` — jamais
// un nom de rôle recopié.

import type { ModuleId } from '@lalanda/ui';

import type { OrgAction } from '@/lib/api';

export type NavIconId =
  | 'idees'
  | 'validation'
  | 'plans'
  | 'business-plan'
  | 'factures'
  | 'encaissements'
  | 'clients'
  | 'catalogue'
  | 'tresorerie'
  | 'devis'
  | 'crm'
  | 'projets'
  | 'achats'
  | 'rh'
  | 'pilotage'
  | 'sante'
  | 'investisseurs'
  | 'parcours'
  | 'mise-en-route'
  | 'identite'
  | 'fiscalite'
  | 'membres'
  | 'abonnement'
  | 'parametres';

/** Une sous-option d'application (ex. « Journal » sous « Factures »). */
export interface NavSousOption {
  id: string;
  href: string;
  label: string;
  /** Action exigée pour AFFICHER la sous-option (liste : l'une d'elles), ou `null`. */
  action: OrgAction | readonly OrgAction[] | null;
}

/** Une application d'un module : une tuile du bureau, une entrée de la colonne. */
export interface NavApp {
  /** Stable : clé de rendu et clé de test. */
  id: string;
  href: string;
  label: string;
  /** Courte phrase sous le libellé de la tuile. */
  description: string;
  module: ModuleId;
  icon: NavIconId;
  /**
   * Action exigée pour AFFICHER l'application, ou `null` si elle est offerte à
   * tout membre. Une LISTE vaut « l'une de ces actions » (ADR-0045 § 8 : les
   * Ressources humaines s'ouvrent avec `leave.request` OU `hr.read`).
   */
  action: OrgAction | readonly OrgAction[] | null;
  sousOptions: readonly NavSousOption[];
  /**
   * Correspondance EXACTE du chemin. Sert au pilotage (`/organisation`) : ses
   * pages sœurs (`/organisation/fiscalite`…) sont des réglages hors module, pas
   * des descendants du pilotage.
   */
  exact?: boolean;
}

export interface NavModule {
  id: ModuleId;
  label: string;
  verb: string;
  /** Destination de l'onglet : le bureau du module. */
  href: string;
  description: string;
}

/** Ordre de la trajectoire : BUILD → RUN → GROW. Fixe (ADR-0038 § 5). */
export const NAV_MODULES: readonly NavModule[] = [
  {
    id: 'build',
    label: 'BUILD',
    verb: 'Concevoir',
    href: '/build',
    description: 'De l’idée au business plan : valider, chiffrer, rédiger.',
  },
  {
    id: 'run',
    label: 'RUN',
    verb: 'Exploiter',
    href: '/run',
    description: 'Vendre, facturer, encaisser et suivre la trésorerie au quotidien.',
  },
  {
    id: 'grow',
    label: 'GROW',
    verb: 'Croître',
    href: '/grow',
    description: 'Piloter l’entreprise, lire ses écarts et préparer sa croissance.',
  },
];

export const MODULE_IDS: readonly ModuleId[] = ['build', 'run', 'grow'];

/** Page d'arrivée après connexion (ADR-0038 § 5). */
export const ACCUEIL_HREF = '/accueil';

/**
 * Les applications, dans l'ordre d'affichage (ADR-0038 § 2).
 *
 * Ne figurent ici que des pages qui EXISTENT — la barre ne promet rien (règle
 * d'ADR-0016). Les réglages de l'organisation ne sont plus un module : ils
 * vivent dans le menu de l'avatar (`user-menu-model.ts`).
 */
export const NAV_APPS: readonly NavApp[] = [
  // ─── BUILD : Idées → Validation → Initiatives → Business plan ───────────
  // ADR-0036 — lecture sous `project.read` (détenu par les huit rôles), donc
  // offerte à tout membre ; l'écriture se règle à l'écran et à l'API.
  {
    id: 'idees',
    href: '/idees',
    label: 'Idées',
    description: 'Noter une idée : problème, client cible, proposition de valeur.',
    module: 'build',
    icon: 'idees',
    action: null,
    sousOptions: [],
  },
  {
    id: 'validation',
    href: '/idees/validation',
    label: 'Validation',
    description: 'Tester les hypothèses et comparer les idées sur preuves.',
    module: 'build',
    icon: 'validation',
    action: null,
    sousOptions: [],
  },
  // L'objet appelé « projet » dans le code (`Project`, API `/projects`) :
  // seul le nom visible et la route web changent (ADR-0038 § 1).
  {
    id: 'initiatives',
    href: '/initiatives',
    label: 'Initiatives',
    description: 'Canvas, plan financier, objectifs et réalisé de chaque initiative.',
    module: 'build',
    icon: 'plans',
    action: null,
    sousOptions: [],
  },
  // ADR-0037 — business plan narratif, lecture sous `project.read`.
  {
    id: 'business-plan',
    href: '/business-plan',
    label: 'Business plan',
    description: 'Le document narratif, appuyé sur les chiffres du plan figé.',
    module: 'build',
    icon: 'business-plan',
    action: null,
    sousOptions: [],
  },

  // ─── RUN ─────────────────────────────────────────────────────────────────
  // ADR-0039 § 8 — le gestionnaire de projets et de tâches, EN TÊTE de RUN (le
  // travail du jour). « Projets » désigne désormais ce module ; le plan BUILD
  // s'appelle « Initiative » (ADR-0038). Lecture `work.read` (CDP et CON exclus).
  {
    id: 'projets',
    href: '/projets',
    label: 'Projets',
    description: 'Projets clients et internes : tâches, Kanban, échéances.',
    module: 'run',
    icon: 'projets',
    action: 'work.read',
    sousOptions: [
      {
        id: 'projets-mes-taches',
        href: '/projets/mes-taches',
        label: 'Mes tâches',
        action: 'work.read',
      },
      { id: 'projets-tous', href: '/projets', label: 'Tous les projets', action: 'work.read' },
    ],
  },
  // ADR-0045 § 8 — H6 : Ressources humaines, JUSTE APRÈS Projets (le travail,
  // puis les personnes). Ouverte avec `leave.request` (self-service, presque
  // tous les membres) OU `hr.read`. « Mon équipe » est offerte à qui demande
  // des absences : l'écran dit simplement qu'il n'encadre personne si `GET
  // /hr/me` ne le reconnaît pas manager (la portée est calculée par l'API).
  // Échéances, rapports et réglages arrivent avec H7 (`RH_SOUS_OPTIONS_PREVUES`).
  {
    id: 'rh',
    href: '/rh',
    label: 'Ressources humaines',
    description: 'Mon espace, mes absences, mon équipe, les collaborateurs et l’organigramme.',
    module: 'run',
    icon: 'rh',
    action: ['leave.request', 'hr.read'],
    sousOptions: [
      { id: 'rh-moi', href: '/rh/moi', label: 'Mon espace', action: 'leave.request' },
      { id: 'rh-equipe', href: '/rh/equipe', label: 'Mon équipe', action: 'leave.request' },
      {
        id: 'rh-a-valider',
        href: '/rh/absences',
        label: 'À valider',
        action: 'leave.approve',
      },
      {
        id: 'rh-calendrier',
        href: '/rh/calendrier',
        label: 'Calendrier',
        action: 'leave.request',
      },
      {
        id: 'rh-collaborateurs',
        href: '/rh/collaborateurs',
        label: 'Collaborateurs',
        action: 'hr.read',
      },
      { id: 'rh-services', href: '/rh/services', label: 'Services', action: 'hr.read' },
      {
        id: 'rh-organigramme',
        href: '/rh/organigramme',
        label: 'Organigramme',
        action: ['leave.request', 'hr.read'],
      },
    ],
  },
  // ADR-0040 § 8.1 (amende ADR-0038 § 2) — le CRM est une application RUN à
  // part, sortie de Ventes : juste après Projets et avant Factures (le
  // commercial travaille l'opportunité avant de facturer). Lecture `crm.read`.
  //
  // Sous-options prévues : Pipeline, Comptes, Contacts, Activités, Rapports,
  // Réglages. Ne figurent ici que celles dont l'écran EXISTE (règle d'ADR-0016
  // rappelée plus haut : la barre ne promet rien). Comptes et Activités sont
  // livrés par C5, Rapports (`/crm/rapports`) par C6. Voir
  // `CRM_SOUS_OPTIONS_PREVUES`.
  {
    id: 'crm',
    href: '/crm',
    label: 'CRM',
    description: 'Pipeline des opportunités, comptes, contacts et relances.',
    module: 'run',
    icon: 'crm',
    action: 'crm.read',
    sousOptions: [
      { id: 'crm-pipeline', href: '/crm', label: 'Pipeline', action: 'crm.read' },
      { id: 'crm-comptes', href: '/crm/comptes', label: 'Comptes', action: 'crm.read' },
      { id: 'crm-contacts', href: '/crm/contacts', label: 'Contacts', action: 'crm.read' },
      { id: 'crm-activites', href: '/crm/activites', label: 'Activités', action: 'crm.read' },
      { id: 'crm-rapports', href: '/crm/rapports', label: 'Rapports', action: 'crm.read' },
      { id: 'crm-reglages', href: '/crm/reglages', label: 'Réglages', action: 'crm.read' },
    ],
  },
  {
    id: 'factures',
    href: '/ventes/factures',
    label: 'Factures',
    description: 'Factures, pro forma et avoirs, facture normalisée DGI.',
    module: 'run',
    icon: 'factures',
    action: 'sales.read',
    sousOptions: [
      // ADR-0028 : galerie ouverte à `sales.read`, le choix exige
      // `organization.manage` (la page l'annonce, l'API le refuse).
      {
        id: 'modele-facture',
        href: '/ventes/modele-facture',
        label: 'Modèle de facture',
        action: 'sales.read',
      },
      // ADR-0023 § S25e.12 : journal électronique, lecture `sales.read`.
      {
        id: 'journal-ventes',
        href: '/ventes/factures/journal',
        label: 'Journal',
        action: 'sales.read',
      },
    ],
  },
  // ADR-0035 : devis, document distinct qui se convertit en facture.
  {
    id: 'devis',
    href: '/ventes/devis',
    label: 'Devis',
    description: 'Chiffrer une offre, puis la convertir en facture.',
    module: 'run',
    icon: 'devis',
    action: 'sales.read',
    sousOptions: [],
  },
  // ADR-0031 : argent reçu, statut de règlement et pont vers le réalisé.
  {
    id: 'encaissements',
    href: '/ventes/encaissements',
    label: 'Encaissements',
    description: 'L’argent reçu, les factures à régler et en retard.',
    module: 'run',
    icon: 'encaissements',
    action: 'sales.read',
    sousOptions: [],
  },
  {
    id: 'clients',
    href: '/ventes/clients',
    label: 'Clients',
    description: 'Le fichier clients, prêt pour la facture normalisée.',
    module: 'run',
    icon: 'clients',
    action: 'sales.read',
    sousOptions: [],
  },
  {
    id: 'catalogue',
    href: '/ventes/catalogue',
    label: 'Catalogue',
    description: 'Articles et services, prix et groupes de taxation.',
    module: 'run',
    icon: 'catalogue',
    action: 'sales.read',
    sousOptions: [],
  },
  // ADR-0044 § 8 — achats et fournisseurs, JUSTE AVANT Trésorerie (on engage,
  // puis on paie). Lecture `purchase.read`. Ne figurent que les sous-options
  // dont l'écran EXISTE (lots P7 et P8) ; les réglages arrivent avec un lot
  // suivant (`ACHATS_SOUS_OPTIONS_PREVUES`).
  {
    id: 'achats',
    href: '/achats',
    label: 'Achats',
    description: 'Fournisseurs, commandes approuvées, factures fournisseurs et paiements.',
    module: 'run',
    icon: 'achats',
    action: 'purchase.read',
    sousOptions: [
      { id: 'achats-vue', href: '/achats', label: 'Vue d’ensemble', action: 'purchase.read' },
      {
        id: 'achats-commandes',
        href: '/achats/commandes',
        label: 'Demandes et commandes',
        action: 'purchase.read',
      },
      {
        id: 'achats-validations',
        href: '/achats/validations',
        label: 'À approuver',
        action: 'purchase.approve',
      },
      // ADR-0044 — P8 : réceptions, factures fournisseurs, échéancier et paiements.
      {
        id: 'achats-receptions',
        href: '/achats/receptions',
        label: 'Réceptions',
        action: 'purchase.read',
      },
      {
        id: 'achats-factures',
        href: '/achats/factures',
        label: 'Factures fournisseurs',
        action: 'purchase.read',
      },
      {
        id: 'achats-a-payer',
        href: '/achats/a-payer',
        label: 'À payer',
        action: 'purchase.read',
      },
      {
        id: 'achats-fournisseurs',
        href: '/achats/fournisseurs',
        label: 'Fournisseurs',
        action: 'purchase.read',
      },
    ],
  },
  // ADR-0034 — dépenses, comptes, prévision et réalisé vs prévu.
  {
    id: 'tresorerie',
    href: '/tresorerie',
    label: 'Trésorerie',
    description: 'Dépenses, comptes et soldes, prévision à 7–180 jours.',
    module: 'run',
    icon: 'tresorerie',
    action: 'treasury.read',
    sousOptions: [
      {
        id: 'tresorerie-depenses',
        href: '/tresorerie/depenses',
        label: 'Dépenses',
        action: 'treasury.read',
      },
      {
        id: 'tresorerie-comptes',
        href: '/tresorerie/comptes',
        label: 'Comptes',
        action: 'treasury.read',
      },
      {
        id: 'tresorerie-realise',
        href: '/tresorerie/realise',
        label: 'Réalisé vs prévu',
        action: 'treasury.read',
      },
    ],
  },

  // ─── GROW ────────────────────────────────────────────────────────────────
  // Le tableau de bord de l'organisation EST le pilotage : blocs par rôle,
  // ratios au rouge, écarts, validations (S21a). Rangé dans GROW (ADR-0038 § 6).
  {
    id: 'pilotage',
    href: '/organisation',
    label: 'Pilotage',
    description: 'Le tableau de bord de l’organisation, selon votre rôle.',
    module: 'grow',
    icon: 'pilotage',
    action: null,
    sousOptions: [],
    exact: true,
  },
  // ADR-0033 — même garde que le pilotage (`analytics.read`, huit rôles).
  {
    id: 'brief',
    href: '/organisation/brief',
    label: 'Brief du matin',
    description: 'Les faits, alertes et recommandations du jour.',
    module: 'grow',
    icon: 'pilotage',
    action: null,
    sousOptions: [],
  },
  // ADR-0032 — espace Croissance, lecture sous `analytics.read` (huit rôles).
  {
    id: 'sante',
    href: '/croissance/sante',
    label: 'Santé',
    description: 'Le score de santé de l’entreprise et ses risques.',
    module: 'grow',
    icon: 'sante',
    action: null,
    sousOptions: [],
  },
  {
    id: 'investisseurs',
    href: '/croissance/investisseurs',
    label: 'Indicateurs investisseurs',
    description: 'Les indicateurs qu’un investisseur demande, calculés sur le réel.',
    module: 'grow',
    icon: 'investisseurs',
    action: null,
    sousOptions: [],
  },
  {
    id: 'parcours',
    href: '/croissance/parcours',
    label: 'Parcours',
    description: 'L’étape de l’entreprise et ce qui reste à franchir.',
    module: 'grow',
    icon: 'parcours',
    action: null,
    sousOptions: [],
  },
];

/**
 * Ordre cible des sous-options du CRM (ADR-0040 § 8.1). Les identifiants absents
 * de `NAV_APPS` sont ceux dont l'écran n'est pas encore livré : ils restent
 * masqués plutôt que de mener à une page vide. Le test de navigation vérifie
 * que les sous-options affichées suivent cet ordre.
 */
export const CRM_SOUS_OPTIONS_PREVUES = [
  'crm-pipeline',
  'crm-comptes',
  'crm-contacts',
  'crm-activites',
  'crm-rapports',
  'crm-reglages',
] as const;

/**
 * Ordre cible des sous-options des Achats (ADR-0044 § 8). Les identifiants
 * absents de `NAV_APPS` sont ceux dont l'écran n'est pas encore livré
 * (réglages) : masqués plutôt que vides.
 */
export const ACHATS_SOUS_OPTIONS_PREVUES = [
  'achats-vue',
  'achats-commandes',
  'achats-validations',
  'achats-receptions',
  'achats-factures',
  'achats-a-payer',
  'achats-fournisseurs',
  'achats-reglages',
] as const;

/**
 * Ordre cible des sous-options des Ressources humaines (ADR-0045 § 8). Les
 * identifiants absents de `NAV_APPS` (échéances, rapports, réglages : lot H7)
 * restent masqués plutôt que vides.
 */
export const RH_SOUS_OPTIONS_PREVUES = [
  'rh-moi',
  'rh-equipe',
  'rh-a-valider',
  'rh-calendrier',
  'rh-collaborateurs',
  'rh-services',
  'rh-organigramme',
  'rh-echeances',
  'rh-rapports',
  'rh-reglages',
] as const;

function autorise(
  action: OrgAction | readonly OrgAction[] | null,
  actions: readonly OrgAction[] | null,
): boolean {
  if (action === null) return true;
  if (actions === null) return false;
  const besoins: readonly OrgAction[] = typeof action === 'string' ? [action] : action;
  return besoins.some((b) => actions.includes(b));
}

/**
 * Applications réellement proposées, avec leurs sous-options filtrées.
 *
 * `actions === null` (permissions pas encore connues, ou appel en échec) :
 * seules les entrées sans condition — même règle qu'`ongletsVisibles` (S21a).
 * Montrer tout puis retirer fait clignoter la barre et promet des pages qui
 * répondront 403.
 */
export function appsVisibles(
  actions: readonly OrgAction[] | null,
  module: ModuleId | null = null,
): NavApp[] {
  return NAV_APPS.filter(
    (app) => (module === null || app.module === module) && autorise(app.action, actions),
  ).map((app) => ({
    ...app,
    sousOptions: app.sousOptions.filter((s) => autorise(s.action, actions)),
  }));
}

/** `true` si `pathname` est `href` ou l'un de ses descendants (frontière de segment). */
function couvre(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Application et sous-option correspondant au chemin.
 *
 * Frontière de SEGMENT, la correspondance la plus longue gagne, sous-options
 * comprises : `/ventes/modele-facture` allume « Factures » (par sa
 * sous-option), `/organisation/fiscalite` n'allume rien (réglage de
 * l'organisation, hors module), `/organisations-amies` n'allume rien.
 *
 * La recherche porte sur TOUTES les applications, pas seulement les visibles :
 * le module courant d'une page ne dépend pas du chargement des permissions.
 */
export function correspondance(
  pathname: string,
  apps: readonly NavApp[] = NAV_APPS,
): { app: NavApp; sousOption: NavSousOption | null } | null {
  let trouve: { app: NavApp; sousOption: NavSousOption | null; longueur: number } | null = null;
  for (const app of apps) {
    const candidats: Array<{ href: string; sousOption: NavSousOption | null }> = [
      { href: app.href, sousOption: null },
      ...app.sousOptions.map((s) => ({ href: s.href, sousOption: s })),
    ];
    for (const c of candidats) {
      const ok =
        c.sousOption === null && app.exact ? pathname === c.href : couvre(pathname, c.href);
      if (!ok) continue;
      // À longueur égale (« Pipeline » = `/crm`), la sous-option gagne :
      // c'est elle qu'il faut allumer dans la colonne.
      if (
        trouve === null ||
        c.href.length > trouve.longueur ||
        (c.href.length === trouve.longueur && trouve.sousOption === null && c.sousOption !== null)
      ) {
        trouve = { app, sousOption: c.sousOption, longueur: c.href.length };
      }
    }
  }
  return trouve === null ? null : { app: trouve.app, sousOption: trouve.sousOption };
}

/** Identifiant de l'application allumée par le chemin, ou `null`. */
export function appActive(pathname: string, apps: readonly NavApp[] = NAV_APPS): string | null {
  return correspondance(pathname, apps)?.app.id ?? null;
}

/** Identifiant de la sous-option allumée par le chemin, ou `null`. */
export function sousOptionActive(
  pathname: string,
  apps: readonly NavApp[] = NAV_APPS,
): string | null {
  return correspondance(pathname, apps)?.sousOption?.id ?? null;
}

/**
 * Module courant, déduit du chemin (ADR-0038 § 2) : le bureau du module
 * (`/build`, `/run`, `/grow`), sinon le module de l'application qui
 * correspond. `null` hors module (accueil, compte, réglages, administration).
 */
export function moduleCourant(pathname: string): ModuleId | null {
  for (const m of NAV_MODULES) if (couvre(pathname, m.href)) return m.id;
  return correspondance(pathname)?.app.module ?? null;
}

/** L'onglet Accueil est-il celui de la page ? */
export function estAccueil(pathname: string): boolean {
  return couvre(pathname, ACCUEIL_HREF);
}

/** Le chemin est-il le bureau d'un module (et non l'une de ses applications) ? */
export function estBureau(pathname: string): boolean {
  return NAV_MODULES.some((m) => pathname === m.href);
}

export function moduleParId(id: ModuleId): NavModule {
  return NAV_MODULES.find((m) => m.id === id)!;
}

/**
 * Ordre des cartes de l'accueil (ADR-0038 § 5) : les modules choisis à la mise
 * en route d'abord, puis les autres, chacun dans l'ordre de la trajectoire.
 * Un rangement, jamais un accès : aucun module n'est retiré.
 */
export function ordreAccueil(modules: readonly ModuleId[] | null): ModuleId[] {
  if (modules === null) return [...MODULE_IDS];
  return [
    ...MODULE_IDS.filter((m) => modules.includes(m)),
    ...MODULE_IDS.filter((m) => !modules.includes(m)),
  ];
}

// ─── Choix des modules (mise en route, étape 4) ─────────────────────────────

/**
 * Clé de stockage du choix des modules, PAR ORGANISATION. Stockage navigateur
 * faute d'API (ADR-0030, décision D3).
 */
export function cleModules(organizationId: string): string {
  return `lalanda.modules.${organizationId}`;
}

/**
 * Relit un choix stocké. Toute valeur illisible vaut « aucun choix » (`null`,
 * donc tous les modules) : un stockage corrompu ne doit jamais rien vider.
 */
export function lireModules(brut: string | null): ModuleId[] | null {
  if (brut === null) return null;
  let valeur: unknown;
  try {
    valeur = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!Array.isArray(valeur)) return null;
  const modules = MODULE_IDS.filter((m) => valeur.includes(m));
  return modules.length > 0 ? modules : null;
}

/** Sérialise un choix ; un choix vide ou complet s'écrit `null` (rien à ranger). */
export function ecrireModules(modules: readonly ModuleId[]): string | null {
  const propres = MODULE_IDS.filter((m) => modules.includes(m));
  if (propres.length === 0 || propres.length === MODULE_IDS.length) return null;
  return JSON.stringify(propres);
}

// ─── Barre d'actions basse (téléphone) ──────────────────────────────────────

export interface ActionRapide {
  /** Sert aussi d'identifiant d'icône (`plans` = icône des initiatives). */
  id: 'plans' | 'factures' | 'facturer' | 'clients';
  href: string;
  label: string;
  /** Application allumée par cette action (pour `aria-current`). */
  app: string | null;
  /** L'action principale, dessinée en relief. */
  principale: boolean;
}

/**
 * Barre basse du téléphone (ADR-0030 § 6), centrée sur RUN : vendre et facturer
 * au pouce. Proposée seulement si le rôle lit les ventes ; sinon le tiroir de
 * navigation suffit et la barre n'est pas rendue (tableau vide).
 *
 * « Facturer » mène au compositeur existant : il crée un BROUILLON (pro forma),
 * ouvert à `sales.manage` côté API — d'où la condition supplémentaire.
 */
export function actionsRapides(actions: readonly OrgAction[] | null): ActionRapide[] {
  if (actions === null || !actions.includes('sales.read')) return [];
  const liste: ActionRapide[] = [
    {
      id: 'plans',
      href: '/initiatives',
      label: 'Initiatives',
      app: 'initiatives',
      principale: false,
    },
    {
      id: 'factures',
      href: '/ventes/factures',
      label: 'Factures',
      app: 'factures',
      principale: false,
    },
  ];
  if (actions.includes('sales.manage')) {
    liste.push({
      id: 'facturer',
      href: '/ventes/factures/nouvelle',
      label: 'Facturer',
      app: null,
      principale: true,
    });
  }
  liste.push({
    id: 'clients',
    href: '/ventes/clients',
    label: 'Clients',
    app: 'clients',
    principale: false,
  });
  return liste;
}
