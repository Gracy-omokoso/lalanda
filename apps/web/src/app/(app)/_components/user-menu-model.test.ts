// Menu du compte — ADR-0016 §1 et §5, amendés par ADR-0038 § 6.
//
// Ce que ces tests protègent : l'ORDRE et le CONDITIONNEMENT des entrées. C'est
// exactement le genre de règle qu'on casse sans s'en apercevoir — une entrée
// ajoutée au mauvais endroit, une condition oubliée, un séparateur qui reste
// seul quand l'entrée qu'il bordait disparaît. Rien de tout cela ne fait échouer
// un typecheck, et tout se voit à l'écran.

import { describe, expect, it } from 'vitest';

import type { OrgAction } from '@/lib/api';

import {
  entreeActive,
  entreesMenu,
  libelleDeclencheur,
  separateurAvant,
  type UserMenuItem,
} from './user-menu-model';

const PROPRIETAIRE: OrgAction[] = ['organization.manage', 'fiscal.manage', 'billing.manage'];
const DIRECTEUR_FINANCIER: OrgAction[] = ['fiscal.manage', 'sales.read'];
const OPERATEUR = { canReadAdmin: true, actions: PROPRIETAIRE };
const MEMBRE = { canReadAdmin: false, actions: PROPRIETAIRE };
const INCONNU = { canReadAdmin: false, actions: null };

const labels = (items: UserMenuItem[]): string[] => items.map((e) => e.label);

describe('contenu et ordre du menu (ADR-0038 § 6)', () => {
  it('liste les entrées dans l’ordre exact, pour un opérateur propriétaire', () => {
    expect(labels(entreesMenu(OPERATEUR))).toEqual([
      'Mon compte',
      'Mise en route',
      'Identité visuelle',
      'Fiscalité',
      'Membres',
      'Paramètres',
      'Abonnement',
      'Administration',
      'Déconnexion',
    ]);
  });

  it('ne porte plus le travail quotidien : il est dans la barre du haut, par module', () => {
    const hrefs = entreesMenu(OPERATEUR).map((e) => (e.kind === 'link' ? e.href : null));
    for (const h of ['/projects', '/initiatives', '/ventes', '/tresorerie', '/croissance']) {
      expect(hrefs).not.toContain(h);
    }
    // « Pilotage » (`/organisation`) est rangé dans GROW.
    expect(hrefs).not.toContain('/organisation');
  });

  it('représente le compte par UNE SEULE entrée vers /compte', () => {
    const liens = entreesMenu(OPERATEUR).filter(
      (e) => e.kind === 'link' && e.href.startsWith('/compte'),
    );
    expect(liens).toHaveLength(1);
    expect(liens[0]).toMatchObject({ href: '/compte', label: 'Mon compte' });
  });

  it('fait de la déconnexion une action, jamais un lien', () => {
    const sortie = entreesMenu(MEMBRE).at(-1);
    expect(sortie).toEqual({ kind: 'action', id: 'signout', label: 'Déconnexion', group: 4 });
    expect(sortie).not.toHaveProperty('href');
  });

  it('donne à chaque entrée un identifiant unique', () => {
    const ids = entreesMenu(OPERATEUR).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('conditionnement par les faits serveur (ADR-0016 §5)', () => {
  it('masque « Administration » sans canReadAdmin', () => {
    expect(labels(entreesMenu(MEMBRE))).not.toContain('Administration');
  });

  it('permissions inconnues : seules les entrées sans condition', () => {
    expect(labels(entreesMenu(INCONNU))).toEqual([
      'Mon compte',
      'Mise en route',
      'Abonnement',
      'Déconnexion',
    ]);
    // Rétrocompatible : sans `actions`, même comportement.
    expect(labels(entreesMenu({ canReadAdmin: false }))).toEqual(labels(entreesMenu(INCONNU)));
  });

  it('filtre par action serveur, pas par nom de rôle', () => {
    const df = labels(entreesMenu({ canReadAdmin: false, actions: DIRECTEUR_FINANCIER }));
    expect(df).toContain('Fiscalité');
    expect(df).not.toContain('Identité visuelle');
    expect(df).not.toContain('Membres');
    expect(df).not.toContain('Paramètres');
  });

  it('ne masque JAMAIS « Mon compte » : c’est l’espace de secours sans organisation', () => {
    expect(entreesMenu(INCONNU).some((e) => e.id === 'compte')).toBe(true);
  });
});

describe('groupes et séparateurs', () => {
  it('sépare compte / organisation / plateforme / déconnexion, pour un opérateur', () => {
    const items = entreesMenu(OPERATEUR);
    const avant = items.map((_, i) => separateurAvant(items, i));
    //           Compte Mise   Ident. Fisc.  Membr. Param. Abo    Admin Déco
    expect(avant).toEqual([false, true, false, false, false, false, false, true, true]);
  });

  it('ne laisse AUCUN séparateur orphelin quand des entrées disparaissent', () => {
    const items = entreesMenu(INCONNU);
    const avant = items.map((_, i) => separateurAvant(items, i));
    //           Compte Mise   Abo    Déco
    expect(avant).toEqual([false, true, false, true]);
  });

  it('ne pose jamais de séparateur en tête de menu', () => {
    expect(separateurAvant(entreesMenu(OPERATEUR), 0)).toBe(false);
  });
});

describe('entrée active (frontière de segment)', () => {
  const items = entreesMenu(OPERATEUR);

  it('allume l’entrée correspondant au chemin', () => {
    expect(entreeActive('/compte', items)).toBe('compte');
    expect(entreeActive('/compte/securite', items)).toBe('compte');
    expect(entreeActive('/organisation/membres', items)).toBe('membres');
    expect(entreeActive('/organisation/fiscalite', items)).toBe('fiscalite');
    expect(entreeActive('/souscription/retour', items)).toBe('souscription');
    expect(entreeActive('/admin/journal', items)).toBe('admin');
  });

  it('compare des frontières de segment, jamais des préfixes nus', () => {
    expect(entreeActive('/comptes-annuels', items)).toBeNull();
    expect(entreeActive('/administration-fiscale', items)).toBeNull();
  });

  it('n’allume rien sur une page hors du menu', () => {
    expect(entreeActive('/organisation', items)).toBeNull();
    expect(entreeActive('/initiatives', items)).toBeNull();
    expect(entreeActive('/aide', items)).toBeNull();
    expect(entreeActive('/', items)).toBeNull();
  });

  it('n’allume pas une entrée masquée', () => {
    expect(entreeActive('/admin', entreesMenu(MEMBRE))).toBeNull();
    expect(entreeActive('/organisation/membres', entreesMenu(INCONNU))).toBeNull();
  });

  it('retient la correspondance la plus longue', () => {
    const imbriques: UserMenuItem[] = [
      { kind: 'link', id: 'parent', href: '/organisation', label: 'A', hint: '', group: 1 },
      { kind: 'link', id: 'enfant', href: '/organisation/membres', label: 'B', hint: '', group: 1 },
    ];
    expect(entreeActive('/organisation/membres', imbriques)).toBe('enfant');
    expect(entreeActive('/organisation/journal', imbriques)).toBe('parent');
  });
});

describe('nom accessible du déclencheur (ADR-0016 §6.2)', () => {
  it('annonce le nom affiché quand il existe', () => {
    expect(libelleDeclencheur({ nom: 'Marie-Claire Nsimba', email: 'mcn@lalanda.cd' })).toBe(
      'Menu du compte — Marie-Claire Nsimba',
    );
  });

  it('retombe sur l’adresse tant que le profil n’est pas chargé', () => {
    expect(libelleDeclencheur({ nom: null, email: 'mcn@lalanda.cd' })).toBe(
      'Menu du compte — mcn@lalanda.cd',
    );
    expect(libelleDeclencheur({ email: 'mcn@lalanda.cd' })).toBe('Menu du compte — mcn@lalanda.cd');
  });

  it('ignore un nom vide ou fait d’espaces — le bouton garde un nom accessible utile', () => {
    expect(libelleDeclencheur({ nom: '   ', email: 'mcn@lalanda.cd' })).toBe(
      'Menu du compte — mcn@lalanda.cd',
    );
  });
});
