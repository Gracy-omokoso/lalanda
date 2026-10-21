// Navigation latérale par module — ADR-0030 § 2 et § 6.
//
// Ce que ces tests protègent : l'ordre de la trajectoire (BUILD → RUN → GROW →
// Organisation), le conditionnement par ACTIONS servies par le serveur, l'entrée
// allumée par le chemin, et le fait qu'un choix de modules ne cache jamais
// l'organisation ni ne vide la barre.

import { describe, expect, it } from 'vitest';

import type { OrgAction } from '@/lib/api';

import {
  actionsRapides,
  cleModules,
  ecrireModules,
  entreeActive,
  entreesVisibles,
  groupesVisibles,
  lireModules,
  NAV_ITEMS,
} from './nav-model';

const PROPRIETAIRE: OrgAction[] = [
  'organization.manage',
  'billing.manage',
  'fiscal.manage',
  'sales.read',
  'sales.manage',
  'sales.invoice',
  'project.read',
];
const DIRECTEUR_FINANCIER: OrgAction[] = ['fiscal.manage', 'sales.read', 'sales.manage'];
const LECTEUR: OrgAction[] = ['project.read', 'sales.read'];
const SANS_VENTES: OrgAction[] = ['project.read'];

const ids = (items: { id: string }[]): string[] => items.map((i) => i.id);

describe('entrées et ordre', () => {
  it('CRM (ADR-0035) : dans RUN, après le catalogue, pour qui détient crm.read', () => {
    const avecCrm = ids(entreesVisibles([...LECTEUR, 'crm.read']));
    expect(avecCrm.slice(1, 6)).toEqual(['factures', 'devis', 'clients', 'catalogue', 'crm']);
    expect(ids(entreesVisibles(LECTEUR))).not.toContain('crm');
  });

  it('suit la trajectoire BUILD → RUN → GROW → Organisation, pour un propriétaire', () => {
    expect(ids(entreesVisibles(PROPRIETAIRE))).toEqual([
      'plans',
      'factures',
      'devis',
      'clients',
      'catalogue',
      'pilotage',
      'mise-en-route',
      'identite',
      'fiscalite',
      'membres',
      'parametres',
      'abonnement',
    ]);
    expect(groupesVisibles(entreesVisibles(PROPRIETAIRE)).map((g) => g.group.id)).toEqual([
      'build',
      'run',
      'grow',
      'organisation',
    ]);
  });

  it('ne promet que des pages existantes : GROW se limite au pilotage', () => {
    expect(NAV_ITEMS.filter((i) => i.group === 'grow').map((i) => i.href)).toEqual([
      '/organisation',
    ]);
  });

  it('permissions inconnues : seules les entrées sans condition (pas de clignotement)', () => {
    expect(ids(entreesVisibles(null))).toEqual([
      'plans',
      'pilotage',
      'mise-en-route',
      'abonnement',
    ]);
  });

  it('filtre par actions serveur, pas par nom de rôle', () => {
    const df = ids(entreesVisibles(DIRECTEUR_FINANCIER));
    expect(df).toContain('fiscalite');
    expect(df).not.toContain('identite');
    expect(df).not.toContain('membres');
    expect(ids(entreesVisibles(SANS_VENTES))).not.toContain('factures');
  });

  it('un groupe sans entrée n’est pas rendu', () => {
    expect(groupesVisibles(entreesVisibles(SANS_VENTES)).map((g) => g.group.id)).not.toContain(
      'run',
    );
  });
});

describe('choix des modules (mise en route, étape 4)', () => {
  it('filtre les modules sans jamais masquer l’organisation', () => {
    const visibles = ids(entreesVisibles(PROPRIETAIRE, ['run']));
    expect(visibles).not.toContain('plans');
    expect(visibles).not.toContain('pilotage');
    expect(visibles).toContain('factures');
    expect(visibles).toContain('mise-en-route');
    expect(visibles).toContain('abonnement');
  });

  it('ne donne aucun accès : un module choisi reste soumis aux actions', () => {
    expect(ids(entreesVisibles(SANS_VENTES, ['run']))).not.toContain('factures');
  });

  it('relit un stockage valide, ignore le reste', () => {
    expect(lireModules('["run","build"]')).toEqual(['build', 'run']);
    expect(lireModules(null)).toBeNull();
    expect(lireModules('pas du json')).toBeNull();
    expect(lireModules('{"run":true}')).toBeNull();
    expect(lireModules('[]')).toBeNull();
    expect(lireModules('["autre"]')).toBeNull();
  });

  it('un choix vide ou complet ne filtre rien', () => {
    expect(ecrireModules([])).toBeNull();
    expect(ecrireModules(['grow', 'run', 'build'])).toBeNull();
    expect(ecrireModules(['run'])).toBe('["run"]');
  });

  it('la clé dépend de l’organisation', () => {
    expect(cleModules('a')).not.toBe(cleModules('b'));
  });
});

describe('entrée active', () => {
  const tout = entreesVisibles(PROPRIETAIRE);
  it.each([
    ['/projects', 'plans'],
    ['/projects/abc/realise', 'plans'],
    ['/ventes/factures', 'factures'],
    ['/ventes/factures/nouvelle', 'factures'],
    ['/ventes/clients', 'clients'],
    ['/organisation', 'pilotage'],
    ['/organisation/fiscalite', 'fiscalite'],
    ['/organisation/mise-en-route', 'mise-en-route'],
    ['/souscription/retour', 'abonnement'],
  ])('%s allume %s', (chemin, attendu) => {
    expect(entreeActive(chemin, tout)).toBe(attendu);
  });

  it('compare par segment : /organisations-amies et /ventes/modele-facture n’allument rien', () => {
    expect(entreeActive('/organisations-amies', tout)).toBeNull();
    expect(entreeActive('/ventes/modele-facture', tout)).toBeNull();
  });
});

describe('barre d’actions basse (téléphone)', () => {
  it('n’existe pas sans accès aux ventes', () => {
    expect(actionsRapides(null)).toEqual([]);
    expect(actionsRapides(SANS_VENTES)).toEqual([]);
  });

  it('place « Facturer » au centre quand le rôle peut composer', () => {
    const a = actionsRapides(PROPRIETAIRE);
    expect(a.map((x) => x.id)).toEqual(['plans', 'factures', 'facturer', 'clients']);
    expect(a.find((x) => x.principale)?.href).toBe('/ventes/factures/nouvelle');
  });

  it('pas de « Facturer » pour un rôle en lecture seule', () => {
    expect(actionsRapides(LECTEUR).map((x) => x.id)).toEqual(['plans', 'factures', 'clients']);
  });
});
