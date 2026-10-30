// Navigation par modules — ADR-0038 (amende ADR-0030 § 2), barre basse ADR-0030 § 6.
//
// Ce que ces tests protègent : les applications de chaque module et leur ordre
// (le parcours BUILD Idées → Validation → Initiatives → Business plan), les
// sous-options, le conditionnement par ACTIONS servies par le serveur, le
// module et l'application allumés par le chemin, et le fait que le choix des
// modules range l'accueil sans jamais rien retirer.

import { describe, expect, it } from 'vitest';

import type { OrgAction } from '@/lib/api';

import {
  actionsRapides,
  appActive,
  ACHATS_SOUS_OPTIONS_PREVUES,
  appsVisibles,
  cleModules,
  CRM_SOUS_OPTIONS_PREVUES,
  ecrireModules,
  estAccueil,
  estBureau,
  lireModules,
  moduleCourant,
  NAV_APPS,
  NAV_MODULES,
  ordreAccueil,
  sousOptionActive,
} from './nav-model';

const PROPRIETAIRE: OrgAction[] = [
  'organization.manage',
  'billing.manage',
  'fiscal.manage',
  'sales.read',
  'sales.manage',
  'sales.invoice',
  'project.read',
  'treasury.read',
  'crm.read',
  'crm.manage',
  'work.read',
  'work.update',
  'work.manage',
  'purchase.read',
  'purchase.request',
  'purchase.manage',
  'purchase.approve',
  'payables.pay',
];
const LECTEUR: OrgAction[] = ['project.read', 'sales.read'];
const SANS_VENTES: OrgAction[] = ['project.read'];

const ids = (items: { id: string }[]): string[] => items.map((i) => i.id);

describe('modules', () => {
  it('trois modules, dans l’ordre de la trajectoire, chacun avec son bureau', () => {
    expect(NAV_MODULES.map((m) => [m.label, m.verb, m.href])).toEqual([
      ['BUILD', 'Concevoir', '/build'],
      ['RUN', 'Exploiter', '/run'],
      ['GROW', 'Croître', '/grow'],
    ]);
  });

  it('aucune application « Organisation » : les réglages sont dans le menu de l’avatar', () => {
    for (const app of NAV_APPS) {
      expect(['build', 'run', 'grow']).toContain(app.module);
      expect(app.href).not.toMatch(
        /^\/organisation\/(identite|fiscalite|membres|parametres|mise-en-route)/,
      );
    }
  });
});

describe('applications et ordre', () => {
  it('BUILD : Idées → Validation → Initiatives → Business plan', () => {
    const build = appsVisibles(null, 'build');
    expect(build.map((a) => a.label)).toEqual([
      'Idées',
      'Validation',
      'Initiatives',
      'Business plan',
    ]);
    expect(build.map((a) => a.href)).toEqual([
      '/idees',
      '/idees/validation',
      '/initiatives',
      '/business-plan',
    ]);
  });

  it('le mot « Plans financiers » a disparu ; « Projets » est le seul gestionnaire de RUN (ADR-0039)', () => {
    for (const app of NAV_APPS) {
      expect(app.label).not.toMatch(/plans? financiers?/i);
      if (app.id !== 'projets') expect(app.label).not.toMatch(/projet/i);
    }
    const projets = NAV_APPS.find((a) => a.id === 'projets')!;
    expect(projets.module).toBe('run');
    expect(projets.href).toBe('/projets');
  });

  it('RUN, pour un propriétaire', () => {
    expect(ids(appsVisibles(PROPRIETAIRE, 'run'))).toEqual([
      'projets',
      'crm',
      'factures',
      'devis',
      'encaissements',
      'clients',
      'catalogue',
      'achats',
      'tresorerie',
    ]);
  });

  it('GROW : pilotage, brief, puis les trois écrans Croissance (ADR-0032, ADR-0033)', () => {
    expect(appsVisibles(null, 'grow').map((a) => a.href)).toEqual([
      '/organisation',
      '/organisation/brief',
      '/croissance/sante',
      '/croissance/investisseurs',
      '/croissance/parcours',
    ]);
  });

  it('permissions inconnues : seules les applications sans condition', () => {
    expect(ids(appsVisibles(null))).toEqual([
      'idees',
      'validation',
      'initiatives',
      'business-plan',
      'pilotage',
      'brief',
      'sante',
      'investisseurs',
      'parcours',
    ]);
  });

  it('filtre par actions serveur, pas par nom de rôle', () => {
    expect(ids(appsVisibles(SANS_VENTES, 'run'))).toEqual([]);
    expect(ids(appsVisibles(LECTEUR, 'run'))).not.toContain('crm');
    expect(ids(appsVisibles(LECTEUR, 'run'))).not.toContain('tresorerie');
    expect(ids(appsVisibles(['treasury.read'], 'run'))).toEqual(['tresorerie']);
    expect(ids(appsVisibles(['work.read'], 'run'))).toEqual(['projets']);
  });

  it('chaque application a une description pour sa tuile', () => {
    for (const app of NAV_APPS) expect(app.description.length).toBeGreaterThan(10);
  });
});

describe('sous-options', () => {
  it('Factures se déroule sur « Modèle de facture » et « Journal »', () => {
    const factures = appsVisibles(LECTEUR, 'run').find((a) => a.id === 'factures');
    expect(factures?.sousOptions.map((s) => s.label)).toEqual(['Modèle de facture', 'Journal']);
  });

  it('CRM : Pipeline, Comptes, Contacts, Activités, Rapports, Réglages ; Trésorerie : Dépenses, Comptes, Réalisé vs prévu', () => {
    const run = appsVisibles(PROPRIETAIRE, 'run');
    expect(run.find((a) => a.id === 'crm')?.sousOptions.map((s) => s.label)).toEqual([
      'Pipeline',
      'Comptes',
      'Contacts',
      'Activités',
      'Rapports',
      'Réglages',
    ]);
    expect(run.find((a) => a.id === 'tresorerie')?.sousOptions.map((s) => s.href)).toEqual([
      '/tresorerie/depenses',
      '/tresorerie/comptes',
      '/tresorerie/realise',
    ]);
  });

  it('ADR-0040 § 8.1 : le CRM est une application RUN à part, sortie de Ventes', () => {
    const crm = NAV_APPS.find((a) => a.id === 'crm')!;
    expect(crm.module).toBe('run');
    expect(crm.href).toBe('/crm');
    expect(crm.action).toBe('crm.read');
    expect(crm.icon).toBe('crm');
    // Plus aucune entrée ne mène sous `/ventes/crm` (redirigé en 308).
    for (const app of NAV_APPS) {
      for (const href of [app.href, ...app.sousOptions.map((s) => s.href)]) {
        expect(href === '/ventes/crm' || href.startsWith('/ventes/crm/')).toBe(false);
      }
    }
    // Ouvert à `crm.read` seul, sans `sales.read`.
    expect(ids(appsVisibles(['crm.read'], 'run'))).toEqual(['crm']);
  });

  it('CRM : les sous-options affichées suivent l’ordre cible, sans écran promis', () => {
    const crm = NAV_APPS.find((a) => a.id === 'crm')!;
    const affichees = crm.sousOptions.map((s) => s.id);
    const ordre = CRM_SOUS_OPTIONS_PREVUES.filter((id) => affichees.includes(id));
    expect(affichees).toEqual(ordre);
    // Comptes et Activités sont livrés (C5), Rapports (C6) : toutes les
    // sous-options prévues sont affichées.
    expect(affichees).toEqual([...CRM_SOUS_OPTIONS_PREVUES]);
  });

  it('les sous-options sont filtrées comme les applications', () => {
    const sansPermission = NAV_APPS.find((a) => a.id === 'factures')!;
    expect(sansPermission.sousOptions.every((s) => s.action !== null)).toBe(true);
    // Une application visible sans condition n'expose pas de sous-option conditionnée.
    for (const app of appsVisibles(null)) expect(app.sousOptions).toEqual([]);
  });
});

describe('Projets (ADR-0039 § 8)', () => {
  it('se déroule sur « Mes tâches » et « Tous les projets », sous `work.read`', () => {
    const [projets] = appsVisibles(['work.read'], 'run');
    expect(projets!.sousOptions.map((s) => [s.label, s.href])).toEqual([
      ['Mes tâches', '/projets/mes-taches'],
      ['Tous les projets', '/projets'],
    ]);
    expect(projets!.sousOptions.every((s) => s.action === 'work.read')).toBe(true);
  });

  it('caché sans `work.read` (Chef de projet, Conseiller externe)', () => {
    expect(ids(appsVisibles(['project.read', 'analytics.read'] as OrgAction[], 'run'))).toEqual([]);
  });

  it('allume la bonne sous-option et le module RUN, sans confondre avec /projects', () => {
    expect(moduleCourant('/projets')).toBe('run');
    expect(moduleCourant('/projets/abc/kanban')).toBe('run');
    expect(appActive('/projets/abc/kanban')).toBe('projets');
    expect(sousOptionActive('/projets/mes-taches')).toBe('projets-mes-taches');
    expect(sousOptionActive('/projets/abc/liste')).toBe('projets-tous');
    expect(appActive('/projets-archives')).toBeNull();
    expect(appActive('/initiatives/abc')).toBe('initiatives');
  });
});

describe('module courant (déduit du chemin)', () => {
  it.each([
    ['/build', 'build'],
    ['/run', 'run'],
    ['/grow', 'grow'],
    ['/idees', 'build'],
    ['/idees/validation', 'build'],
    ['/initiatives', 'build'],
    ['/initiatives/abc/realise', 'build'],
    ['/business-plan', 'build'],
    ['/ventes/factures/nouvelle', 'run'],
    ['/ventes/modele-facture', 'run'],
    ['/crm/contacts', 'run'],
    ['/crm/opportunites/abc', 'run'],
    ['/tresorerie/depenses', 'run'],
    ['/organisation', 'grow'],
    ['/organisation/brief', 'grow'],
    ['/croissance/sante', 'grow'],
  ] as const)('%s est dans %s', (chemin, attendu) => {
    expect(moduleCourant(chemin)).toBe(attendu);
  });

  it.each([
    '/accueil',
    '/compte',
    '/compte/securite',
    '/organisation/fiscalite',
    '/organisation/membres',
    '/organisation/mise-en-route',
    '/souscription',
    '/admin',
    '/organisations-amies',
    '/initiatives-x',
    '/builder',
  ])('%s n’est dans aucun module', (chemin) => {
    expect(moduleCourant(chemin)).toBeNull();
  });

  it('accueil et bureaux', () => {
    expect(estAccueil('/accueil')).toBe(true);
    expect(estAccueil('/accueillir')).toBe(false);
    expect(estBureau('/run')).toBe(true);
    expect(estBureau('/ventes/factures')).toBe(false);
  });
});

describe('application et sous-option actives', () => {
  it.each([
    ['/idees/0123456789abcdef01234567', 'idees'],
    ['/idees/validation', 'validation'],
    ['/initiatives', 'initiatives'],
    ['/initiatives/abc/canvas', 'initiatives'],
    ['/ventes/factures', 'factures'],
    ['/ventes/factures/journal', 'factures'],
    ['/ventes/modele-facture', 'factures'],
    ['/crm/opportunites/abc', 'crm'],
    ['/crm/reglages', 'crm'],
    ['/organisation', 'pilotage'],
    ['/organisation/brief', 'brief'],
    ['/croissance/parcours', 'parcours'],
  ])('%s allume %s', (chemin, attendu) => {
    expect(appActive(chemin)).toBe(attendu);
  });

  it('allume la sous-option, la plus longue gagne', () => {
    expect(sousOptionActive('/ventes/modele-facture')).toBe('modele-facture');
    expect(sousOptionActive('/ventes/factures/journal')).toBe('journal-ventes');
    expect(sousOptionActive('/ventes/factures/abc')).toBeNull();
    expect(sousOptionActive('/crm')).toBe('crm-pipeline');
    expect(sousOptionActive('/crm/opportunites/abc')).toBe('crm-pipeline');
    expect(sousOptionActive('/crm/contacts')).toBe('crm-contacts');
    expect(sousOptionActive('/crm/comptes')).toBe('crm-comptes');
    expect(sousOptionActive('/crm/comptes/abc')).toBe('crm-comptes');
    expect(sousOptionActive('/crm/activites')).toBe('crm-activites');
    expect(sousOptionActive('/crm/rapports')).toBe('crm-rapports');
    expect(sousOptionActive('/crm/reglages')).toBe('crm-reglages');
    expect(sousOptionActive('/tresorerie/realise')).toBe('tresorerie-realise');
  });

  it('compare par segment', () => {
    expect(appActive('/organisation/fiscalite')).toBeNull();
    expect(appActive('/ventes/facturesX')).toBeNull();
    expect(appActive('/crm-public')).toBeNull();
  });
});

describe('choix des modules (mise en route, étape 4)', () => {
  it('range l’accueil sans rien retirer', () => {
    expect(ordreAccueil(null)).toEqual(['build', 'run', 'grow']);
    expect(ordreAccueil(['grow'])).toEqual(['grow', 'build', 'run']);
    expect(ordreAccueil(['run', 'grow'])).toEqual(['run', 'grow', 'build']);
  });

  it('relit un stockage valide, ignore le reste', () => {
    expect(lireModules('["run","build"]')).toEqual(['build', 'run']);
    expect(lireModules(null)).toBeNull();
    expect(lireModules('pas du json')).toBeNull();
    expect(lireModules('{"run":true}')).toBeNull();
    expect(lireModules('[]')).toBeNull();
    expect(lireModules('["autre"]')).toBeNull();
  });

  it('un choix vide ou complet ne range rien', () => {
    expect(ecrireModules([])).toBeNull();
    expect(ecrireModules(['grow', 'run', 'build'])).toBeNull();
    expect(ecrireModules(['run'])).toBe('["run"]');
  });

  it('la clé dépend de l’organisation', () => {
    expect(cleModules('a')).not.toBe(cleModules('b'));
  });
});

describe('barre d’actions basse (téléphone)', () => {
  it('n’existe pas sans accès aux ventes', () => {
    expect(actionsRapides(null)).toEqual([]);
    expect(actionsRapides(SANS_VENTES)).toEqual([]);
  });

  it('place « Facturer » au centre quand le rôle peut composer', () => {
    const a = actionsRapides(PROPRIETAIRE);
    expect(a.map((x) => x.label)).toEqual(['Initiatives', 'Factures', 'Facturer', 'Clients']);
    expect(a[0]?.href).toBe('/initiatives');
    expect(a.find((x) => x.principale)?.href).toBe('/ventes/factures/nouvelle');
  });

  it('pas de « Facturer » pour un rôle en lecture seule', () => {
    expect(actionsRapides(LECTEUR).map((x) => x.id)).toEqual(['plans', 'factures', 'clients']);
  });
});

describe('ADR-0044 § 8 — application Achats', () => {
  it('juste avant Trésorerie, visible avec `purchase.read` seul', () => {
    const achats = NAV_APPS.find((a) => a.id === 'achats')!;
    expect(achats.module).toBe('run');
    expect(achats.href).toBe('/achats');
    expect(achats.icon).toBe('achats');
    expect(achats.action).toBe('purchase.read');
    const run = ids(appsVisibles(PROPRIETAIRE, 'run'));
    expect(run.indexOf('achats')).toBe(run.indexOf('tresorerie') - 1);
    expect(ids(appsVisibles(['purchase.read'], 'run'))).toEqual(['achats']);
    expect(ids(appsVisibles(['treasury.read'], 'run'))).not.toContain('achats');
  });

  it('sous-options livrées, dans l’ordre prévu ; « À approuver » exige `purchase.approve`', () => {
    const complet = appsVisibles(PROPRIETAIRE, 'run').find((a) => a.id === 'achats')!;
    expect(complet.sousOptions.map((s) => s.label)).toEqual([
      'Vue d’ensemble',
      'Demandes et commandes',
      'À approuver',
      'Réceptions',
      'Factures fournisseurs',
      'À payer',
      'Fournisseurs',
    ]);
    const prevues: readonly string[] = ACHATS_SOUS_OPTIONS_PREVUES;
    const positions = complet.sousOptions.map((s) => prevues.indexOf(s.id));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const demandeur = appsVisibles(['purchase.read', 'purchase.request'], 'run')[0]!;
    expect(demandeur.sousOptions.map((s) => s.id)).toEqual([
      'achats-vue',
      'achats-commandes',
      'achats-receptions',
      'achats-factures',
      'achats-a-payer',
      'achats-fournisseurs',
    ]);
  });

  it('les écrans non livrés restent masqués ; réceptions, factures et à payer sont livrés (P8)', () => {
    const hrefs = NAV_APPS.find((a) => a.id === 'achats')!.sousOptions.map((s) => s.href);
    expect(hrefs).not.toContain('/achats/reglages');
    for (const livre of ['/achats/receptions', '/achats/factures', '/achats/a-payer']) {
      expect(hrefs).toContain(livre);
    }
  });

  it('chemin → module RUN, application et sous-option', () => {
    expect(moduleCourant('/achats')).toBe('run');
    expect(appActive('/achats/commandes/abc')).toBe('achats');
    expect(sousOptionActive('/achats')).toBe('achats-vue');
    expect(sousOptionActive('/achats/commandes/abc')).toBe('achats-commandes');
    expect(sousOptionActive('/achats/validations')).toBe('achats-validations');
    expect(sousOptionActive('/achats/fournisseurs/abc')).toBe('achats-fournisseurs');
    expect(sousOptionActive('/achats/receptions/abc')).toBe('achats-receptions');
    expect(sousOptionActive('/achats/factures/abc')).toBe('achats-factures');
    expect(sousOptionActive('/achats/a-payer')).toBe('achats-a-payer');
    expect(appActive('/achats-groupes')).toBeNull();
  });
});
