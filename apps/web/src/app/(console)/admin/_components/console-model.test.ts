// Coquille de la console Lalanda (ADR-0053 — P1, critère d'acceptation 22).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  PLATFORM_ACTIONS,
  PLATFORM_ACTION_DEFINITIONS,
  type PlatformAction,
} from '@lalanda/shared/platform';
import { describe, expect, it } from 'vitest';

import {
  ACTION_CONSOLE,
  CONSOLE_MODULES,
  CONSOLE_SHELL_CALLS,
  actionsDe,
  estRouteOrganisation,
  etatPage,
  hrefModule,
  libelleRoles,
  moduleDuChemin,
  modulesVisibles,
  ouvreConsole,
  segmentConsole,
} from './console-model';

/**
 * Matrice d'ADR-0053 § 5.2, recopiée ici pour éprouver la navigation rôle par rôle.
 * Le web ne la consomme jamais : il ne lit que les actions servies.
 */
const MATRICE: Record<string, PlatformAction[]> = {
  super_admin: PLATFORM_ACTIONS.filter(
    (a) => a !== 'platform.packs.manage' && a !== 'platform.templates.manage',
  ),
  admin: [
    'platform.console.read',
    'platform.orgs.read',
    'platform.orgs.suspend',
    'platform.users.read',
    'platform.users.block',
    'platform.billing.read',
    'platform.billing.grant',
    'platform.features.read',
    'platform.features.override',
    'platform.audit.read',
    'platform.announcements.draft',
    'platform.announcements.approve',
    'platform.stats.read',
  ],
  support: [
    'platform.console.read',
    'platform.orgs.read',
    'platform.users.read',
    'platform.features.read',
  ],
  billing: [
    'platform.console.read',
    'platform.orgs.read',
    'platform.billing.read',
    'platform.billing.confirm',
    'platform.billing.grant',
    'platform.features.read',
    'platform.stats.read',
    'platform.finance.read',
    'platform.finance.export',
  ],
  template_editor: ['platform.console.read', 'platform.templates.manage'],
  country_pack_manager: ['platform.console.read', 'platform.packs.manage'],
};

const ids = (actions: readonly PlatformAction[]): string[] =>
  modulesVisibles(actions).map((m) => m.id);

describe('catalogue des modules', () => {
  it('ouvre chaque module par une action du catalogue, du bon module de l’ADR', () => {
    const MODULE_ADR: Record<string, string> = {
      'tableau-de-bord': 'socle',
      organisations: 'accounts',
      comptes: 'accounts',
      abonnements: 'billing',
      fonctionnalites: 'features',
      integrations: 'integrations',
      journal: 'audit',
      annonces: 'announcements',
      statistiques: 'stats',
      finances: 'finance',
      packs: 'packs',
      modeles: 'templates',
    };
    for (const m of CONSOLE_MODULES) {
      expect(PLATFORM_ACTIONS).toContain(m.action);
      expect(PLATFORM_ACTION_DEFINITIONS[m.action].module).toBe(MODULE_ADR[m.id]);
    }
  });

  it('a des identifiants et des segments uniques', () => {
    expect(new Set(CONSOLE_MODULES.map((m) => m.id)).size).toBe(CONSOLE_MODULES.length);
    expect(new Set(CONSOLE_MODULES.map((m) => m.segment)).size).toBe(CONSOLE_MODULES.length);
  });

  it('couvre chaque module de console de l’ADR par au moins un écran', () => {
    const couverts = new Set(
      CONSOLE_MODULES.map((m) => PLATFORM_ACTION_DEFINITIONS[m.action].module),
    );
    for (const action of PLATFORM_ACTIONS) {
      expect(couverts).toContain(PLATFORM_ACTION_DEFINITIONS[action].module);
    }
  });

  it('conserve les URL des écrans repris de S21b, et marque les lots à venir', () => {
    const disponibles = CONSOLE_MODULES.filter((m) => m.etat === 'disponible').map(hrefModule);
    expect(disponibles).toEqual([
      '/admin',
      '/admin/organisations',
      '/admin/utilisateurs',
      '/admin/fonctionnalites',
      '/admin/integrations',
      '/admin/journal',
    ]);
    const bientot = CONSOLE_MODULES.filter((m) => m.etat === 'bientot').map((m) => m.id);
    expect(bientot).toEqual([
      'abonnements',
      'annonces',
      'statistiques',
      'finances',
      'packs',
      'modeles',
    ]);
  });

  it('n’emploie aucun mot réservé aux pièces fiscales (ADR-0053 § 6.8)', () => {
    for (const m of CONSOLE_MODULES) {
      const texte = `${m.label} ${m.description}`.toLowerCase();
      expect(texte).not.toContain('chiffre d’affaires');
      expect(texte).not.toContain("chiffre d'affaires");
      expect(texte).not.toContain('facturé');
      expect(texte).not.toContain('tva');
    }
  });
});

describe('modules visibles selon les actions (ADR-0053 § 5.2)', () => {
  it('ne propose rien sans l’action de console, quoi qu’on détienne d’autre', () => {
    expect(modulesVisibles([])).toEqual([]);
    expect(modulesVisibles(['platform.orgs.read', 'platform.audit.read'])).toEqual([]);
  });

  it('montre au super-administrateur tout sauf packs et modèles', () => {
    expect(ids(MATRICE.super_admin!)).toEqual([
      'tableau-de-bord',
      'organisations',
      'comptes',
      'abonnements',
      'fonctionnalites',
      'integrations',
      'journal',
      'annonces',
      'statistiques',
      'finances',
    ]);
  });

  it('ne montre ni intégrations ni finances à l’administrateur plateforme', () => {
    const vus = ids(MATRICE.admin!);
    expect(vus).not.toContain('integrations');
    expect(vus).not.toContain('finances');
    expect(vus).toContain('journal');
  });

  it('réduit le support aux recherches et au catalogue des fonctionnalités', () => {
    expect(ids(MATRICE.support!)).toEqual([
      'tableau-de-bord',
      'organisations',
      'comptes',
      'fonctionnalites',
    ]);
  });

  it('ouvre la console à la finance (F7), sans comptes ni journal', () => {
    expect(ids(MATRICE.billing!)).toEqual([
      'tableau-de-bord',
      'organisations',
      'abonnements',
      'fonctionnalites',
      'statistiques',
      'finances',
    ]);
  });

  it('ouvre la console aux éditeurs de modèles et de packs, sur leur seul module', () => {
    expect(ids(MATRICE.template_editor!)).toEqual(['tableau-de-bord', 'modeles']);
    expect(ids(MATRICE.country_pack_manager!)).toEqual(['tableau-de-bord', 'packs']);
  });

  it('suit l’ordre du catalogue, pas celui des actions reçues', () => {
    const inverse = [...MATRICE.admin!].reverse();
    expect(ids(inverse)).toEqual(ids(MATRICE.admin!));
  });
});

describe('lecture des actions servies', () => {
  it('ignore les valeurs hors catalogue et l’absence', () => {
    expect(actionsDe({ actions: ['platform.console.read', 'platform.tout', 42, null] })).toEqual([
      'platform.console.read',
    ]);
    expect(actionsDe({})).toEqual([]);
    expect(actionsDe({ actions: null })).toEqual([]);
    expect(actionsDe(null)).toEqual([]);
  });

  it('n’ouvre la console que sur l’action de console', () => {
    expect(ouvreConsole({ actions: [ACTION_CONSOLE] })).toBe(true);
    expect(ouvreConsole({ actions: ['platform.orgs.read'] })).toBe(false);
    // Les anciens drapeaux ne suffisent pas : seules les actions décident.
    expect(ouvreConsole({ actions: [], canReadAdmin: true } as never)).toBe(false);
    expect(ouvreConsole(null)).toBe(false);
  });
});

describe('chemins de la console', () => {
  it('garde le module parent sur une sous-page', () => {
    expect(segmentConsole('/admin')).toBe('');
    expect(segmentConsole('/admin/')).toBe('');
    expect(moduleDuChemin('/admin')?.id).toBe('tableau-de-bord');
    expect(moduleDuChemin('/admin/organisations/org_123')?.id).toBe('organisations');
    expect(moduleDuChemin('/admin/utilisateurs')?.id).toBe('comptes');
    expect(moduleDuChemin('/admin/inconnu')).toBeNull();
  });

  it('ne revendique rien hors de la console', () => {
    expect(segmentConsole('/projects')).toBeNull();
    expect(segmentConsole('/administration/xyz')).toBeNull();
    expect(moduleDuChemin('/accueil')).toBeNull();
  });
});

describe('état d’une page (critère 22)', () => {
  it('refuse la console à un non-opérateur, sur toute URL forcée', () => {
    for (const chemin of ['/admin', '/admin/integrations', '/admin/journal', '/admin/finances']) {
      expect(etatPage(chemin, [])).toBe('refus-console');
    }
  });

  it('refuse un module non ouvert sans monter sa page', () => {
    expect(etatPage('/admin/integrations', MATRICE.admin!)).toBe('refus-module');
    expect(etatPage('/admin/journal', MATRICE.support!)).toBe('refus-module');
    expect(etatPage('/admin/organisations', MATRICE.template_editor!)).toBe('refus-module');
  });

  it('monte la page d’un module ouvert, et laisse Next répondre 404 ailleurs', () => {
    expect(etatPage('/admin', MATRICE.country_pack_manager!)).toBe('page');
    expect(etatPage('/admin/packs', MATRICE.country_pack_manager!)).toBe('page');
    expect(etatPage('/admin/integrations', MATRICE.super_admin!)).toBe('page');
    expect(etatPage('/admin/inconnu', MATRICE.support!)).toBe('page');
  });

  it('nomme les rôles du bandeau', () => {
    expect(libelleRoles([{ label: 'Support' }, { label: 'Finance' }])).toBe('Support, Finance');
    expect(libelleRoles([])).toBe('aucun rôle plateforme');
  });
});

// ── La coquille n'appelle aucune route d'organisation (§ 2.1, critère 22) ─────

const ICI = __dirname;
const CONSOLE = join(ICI, '..', '..');

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiers(chemin);
    return /\.tsx?$/.test(nom) && !nom.endsWith('.test.ts') ? [chemin] : [];
  });
}

describe('séparation de la coquille d’organisation', () => {
  it('ne déclare comme appels de coquille que des routes sans organisation', () => {
    for (const route of CONSOLE_SHELL_CALLS) {
      expect(estRouteOrganisation(route)).toBe(false);
    }
    expect(estRouteOrganisation('/me/permissions')).toBe(true);
    expect(estRouteOrganisation('/organizations/current/settings')).toBe(true);
    expect(estRouteOrganisation('/notifications')).toBe(true);
  });

  it('n’importe aucun élément de la coquille d’organisation ni aucun appel d’organisation', () => {
    const INTERDITS = [
      // Coquille de l'organisation : sélecteur, modules, cloche, conditions, faits.
      /app-shell/,
      /app-header/,
      /org-switcher/,
      /notifications-bell/,
      /terms-gate/,
      /shell-context/,
      /nav-model/,
      /sidebar/,
      /user-menu/,
      // Appels d'API qui dépendent d'une organisation active.
      /getMyPermissions/,
      /getMyFeatures/,
      /\/organizations\/current/,
      /notifications-api/,
      /useShell\b/,
    ];
    const sources = fichiers(CONSOLE);
    expect(sources.length).toBeGreaterThan(10);
    for (const fichier of sources) {
      const texte = readFileSync(fichier, 'utf8');
      for (const motif of INTERDITS) {
        expect({ fichier, trouve: motif.test(texte) }).toEqual({ fichier, trouve: false });
      }
    }
  });

  it('a une page pour chaque module du catalogue', () => {
    for (const m of CONSOLE_MODULES) {
      const page = m.segment
        ? join(CONSOLE, 'admin', m.segment, 'page.tsx')
        : join(CONSOLE, 'admin', 'page.tsx');
      expect(statSync(page).isFile()).toBe(true);
    }
  });
});
