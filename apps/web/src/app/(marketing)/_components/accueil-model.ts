// Contenu de la page d'accueil publique (v1.2 · v1.3) : les trois modules
// BUILD · RUN · GROW, le détail de RUN et le travail en équipe.
//
// Règle de la dirigeante : la page ne promet RIEN qui ne soit livré. Deux
// garde-fous en découlent, vérifiés par `accueil-model.test.ts` :
//
//   1. Les applications listées sous chaque module ne sont pas recopiées : elles
//      sont lues dans `NAV_APPS` (la navigation de l'application, qui ne liste
//      que des écrans qui existent — ADR-0016, ADR-0038). Un identifiant qui
//      n'y figure pas, ou qui change de module, casse le test.
//   2. Ce qui est livré mais FERMÉ en production porte un `etat` explicite et
//      s'affiche avec sa mention : la normalisation DGI en production (ouverte
//      après l'homologation de Lalanda, ADR-0026) et la personnalisation des
//      autorisations par membre (interrupteur `memberPermissionsEnabled`,
//      ADR-0041).
//
// Sources des phrases : ADR-0019/0023/0024 (factures, avoirs, DGI), ADR-0031
// (encaissements, pont vers le réalisé), ADR-0034 (dépenses, trésorerie),
// ADR-0035 et ADR-0040 (devis, CRM), ADR-0039 (projets et tâches), ADR-0012,
// ADR-0040 § 4 et ADR-0041 (rôles, Commercial, autorisations).

import type { ModuleId } from '@lalanda/ui';

import { NAV_APPS, NAV_MODULES, type NavApp } from '../../(app)/_components/nav-model';

// ─── Les trois modules ──────────────────────────────────────────────────────

export interface ModulePublic {
  id: ModuleId;
  /** « BUILD », lu dans `NAV_MODULES`. */
  label: string;
  /** « Concevoir », lu dans `NAV_MODULES`. */
  verb: string;
  /** Promesse du module, en une phrase. */
  promesse: string;
  /** Applications du module, dans l'ordre de la navigation. */
  apps: readonly string[];
}

const PROMESSES: Record<ModuleId, string> = {
  build:
    'Partir d’une idée, la valider, puis bâtir l’initiative : Canvas, objectifs, plan financier SYSCOHADA sur cinq ans et business plan rédigé.',
  run: 'Faire tourner l’entreprise chaque jour : projets, clients, devis, factures, encaissements et trésorerie, dans la même application.',
  grow: 'Lire les chiffres réels pour décider : tableau de bord, brief du matin, santé de l’entreprise et indicateurs pour un investisseur.',
};

/** Identifiants d'applications par module (voir `NAV_APPS`). */
export const APPS_PAR_MODULE: Readonly<Record<ModuleId, readonly string[]>> = {
  build: ['idees', 'validation', 'initiatives', 'business-plan'],
  run: [
    'projets',
    'crm',
    'factures',
    'devis',
    'encaissements',
    'clients',
    'catalogue',
    'tresorerie',
  ],
  grow: ['pilotage', 'brief', 'sante', 'investisseurs', 'parcours'],
};

export const MODULES_PUBLICS: readonly ModulePublic[] = NAV_MODULES.map((m) => ({
  id: m.id,
  label: m.label,
  verb: m.verb,
  promesse: PROMESSES[m.id],
  apps: APPS_PAR_MODULE[m.id],
}));

/** L'application de la navigation qui porte cet identifiant (lève si absente). */
export function appNav(id: string): NavApp {
  const app = NAV_APPS.find((a) => a.id === id);
  if (!app) throw new Error(`Application inconnue de la navigation : ${id}`);
  return app;
}

// ─── RUN en détail ──────────────────────────────────────────────────────────

/**
 * `disponible` : utilisable aujourd'hui.
 * `bientot` : livré dans le code, mais pas encore ouvert en production ; la
 * page l'écrit avec sa mention, jamais comme une promesse tenue.
 */
export type EtatFonction = 'disponible' | 'bientot';

export interface PointRun {
  texte: string;
  etat: EtatFonction;
}

export interface BlocRun {
  /** Identifiant de l'application de la navigation (`NAV_APPS`). */
  app: string;
  titre: string;
  resume: string;
  points: readonly PointRun[];
}

const ok = (texte: string): PointRun => ({ texte, etat: 'disponible' });

export const BLOCS_RUN: readonly BlocRun[] = [
  {
    app: 'factures',
    titre: 'Facturation au format DGI',
    resume:
      'Factures, pro forma et avoirs au format de la facture normalisée de la DGI (RDC), avec des fiches clients prêtes : type de client et NIF.',
    points: [
      ok('Numérotation, journal des factures et PDF à votre identité visuelle'),
      ok('Catalogue d’articles et de services avec leurs groupes de taxation'),
      {
        texte:
          'Envoi à la DGI par l’e-MCF : l’intégration est faite, la production ouvrira après l’homologation de Lalanda',
        etat: 'bientot',
      },
    ],
  },
  {
    app: 'devis',
    titre: 'Devis',
    resume: 'Chiffrez une offre pour un client ou un prospect, puis convertissez-la en facture.',
    points: [
      ok('Un devis accepté peut ouvrir un projet client déjà rempli'),
      ok('Le devis garde le lien vers la facture qui en est issue'),
    ],
  },
  {
    app: 'encaissements',
    titre: 'Encaissements',
    resume:
      'L’argent reçu, rapproché de chaque facture : ce qui reste à régler et ce qui est en retard.',
    points: [ok('Les encaissements peuvent alimenter le réalisé de votre plan financier')],
  },
  {
    app: 'tresorerie',
    titre: 'Trésorerie',
    resume: 'Dépenses, comptes et soldes, avec une prévision de 7 à 180 jours.',
    points: [ok('Le réalisé comparé au prévisionnel de votre initiative')],
  },
  {
    app: 'projets',
    titre: 'Projets et tâches',
    resume:
      'Projets clients et internes : tâches, sous-tâches, responsables, échéances, priorités, dépendances et jalons.',
    points: [
      ok('Vues liste, Kanban, calendrier et chronologie (Gantt), plus « Mes tâches »'),
      ok('Commentaires avec mentions, pièces jointes et temps passé'),
      ok('Un jalon terminé prépare un brouillon de facture'),
      ok('La marge encaissée de chaque projet : encaissements, moins dépenses et temps passé'),
    ],
  },
  {
    app: 'crm',
    titre: 'CRM',
    resume:
      'Comptes, contacts et opportunités : toute l’histoire d’une entreprise cliente sur une seule fiche.',
    points: [
      ok('Pipeline en glisser-déposer et prévision pondérée'),
      ok('Relances qui arrivent dans « Mes tâches », avec rappel d’échéance'),
      ok('Rapports du CRM, montants par devise'),
      ok('Une opportunité gagnée vous propose de créer le projet'),
    ],
  },
];

/** La chaîne que RUN relie, de l'opportunité au réalisé. Chaque flèche est livrée. */
export const CHAINE_RUN: readonly string[] = [
  'Opportunité',
  'Devis',
  'Projet',
  'Facture',
  'Encaissement',
  'Réalisé du plan',
];

// ─── Travail en équipe ──────────────────────────────────────────────────────

/** Rôles attribuables à l'invitation (ADR-0012, ADR-0040 § 4), dans l'ordre de l'aide. */
export const ROLES_EQUIPE: readonly string[] = [
  'Propriétaire',
  'Administrateur',
  'Directeur financier',
  'Comptable',
  'Analyste',
  'Commercial',
  'Conseiller',
  'Lecteur',
];

export interface PointEquipe {
  titre: string;
  texte: string;
  etat: EtatFonction;
}

export const POINTS_EQUIPE: readonly PointEquipe[] = [
  {
    titre: 'Un rôle pour chaque personne',
    texte:
      'Invitez vos collaborateurs par email et donnez à chacun un rôle : il voit et fait ce que son métier demande, l’application refuse le reste.',
    etat: 'disponible',
  },
  {
    titre: 'Commercial',
    texte:
      'Gère le CRM et prépare les devis. Consulte les clients et le catalogue, mais ne voit ni la trésorerie ni les dépenses, et n’émet pas de facture.',
    etat: 'disponible',
  },
  {
    titre: 'Une seule liste de tâches',
    texte:
      'Tâches de projet et relances clients se retrouvent dans « Mes tâches » ; la cloche prévient d’une assignation, d’une mention ou d’une échéance.',
    etat: 'disponible',
  },
  {
    titre: 'Autorisations sur mesure',
    texte:
      'Le rôle restera un point de départ : ajouter ou retirer une autorisation pour une personne précise, avec des garde-fous et une trace dans le journal d’audit.',
    etat: 'bientot',
  },
];
