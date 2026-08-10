// Menu du compte — ADR-0016 §1 et §5.
//
// Ce que ces tests protègent : l'ORDRE et le CONDITIONNEMENT des entrées. C'est
// exactement le genre de règle qu'on casse sans s'en apercevoir — une entrée
// ajoutée au mauvais endroit, un `canReadAdmin` oublié, un séparateur qui reste
// seul quand l'entrée qu'il bordait disparaît. Rien de tout cela ne fait échouer
// un typecheck, et tout se voit à l'écran.

import { describe, expect, it } from 'vitest';

import {
  entreeActive,
  entreesMenu,
  libelleDeclencheur,
  separateurAvant,
  type UserMenuItem,
} from './user-menu-model';

const OPERATEUR = { canReadAdmin: true };
const MEMBRE = { canReadAdmin: false };

describe('contenu et ordre du menu (ADR-0016 §1)', () => {
  it('liste les six entrées dans l’ordre exact, pour un opérateur', () => {
    expect(entreesMenu(OPERATEUR).map((e) => e.label)).toEqual([
      'Tableau de bord',
      'Mon compte',
      'Organisation',
      'Abonnement',
      'Administration',
      'Déconnexion',
    ]);
  });

  it('mène « Tableau de bord » sur /projects — aucune page de synthèse n’existe', () => {
    const item = entreesMenu(MEMBRE).find((e) => e.id === 'tableau-de-bord');
    expect(item).toMatchObject({ kind: 'link', href: '/projects' });
  });

  it('représente le compte par UNE SEULE entrée vers /compte', () => {
    const liens = entreesMenu(OPERATEUR).filter(
      (e) => e.kind === 'link' && e.href.startsWith('/compte'),
    );
    expect(liens).toHaveLength(1);
    expect(liens[0]).toMatchObject({ href: '/compte', label: 'Mon compte' });
  });

  it('n’expose PAS « Membres » : c’est un onglet de /organisation, pas une entrée', () => {
    const hrefs = entreesMenu(OPERATEUR).map((e) => (e.kind === 'link' ? e.href : null));
    expect(hrefs).not.toContain('/members');
    expect(hrefs).not.toContain('/organisation/membres');
  });

  it('fait de la déconnexion une action, jamais un lien', () => {
    const sortie = entreesMenu(MEMBRE).at(-1);
    expect(sortie).toEqual({ kind: 'action', id: 'signout', label: 'Déconnexion', group: 3 });
    expect(sortie).not.toHaveProperty('href');
  });

  it('donne à chaque entrée un identifiant unique', () => {
    const ids = entreesMenu(OPERATEUR).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('conditionnement par le drapeau serveur (ADR-0016 §5)', () => {
  it('masque « Administration » sans canReadAdmin, et ne masque rien d’autre', () => {
    const membre = entreesMenu(MEMBRE).map((e) => e.label);
    expect(membre).not.toContain('Administration');
    expect(membre).toEqual([
      'Tableau de bord',
      'Mon compte',
      'Organisation',
      'Abonnement',
      'Déconnexion',
    ]);
  });

  it('n’a qu’UNE seule entrée conditionnée — les cinq autres sont invariantes', () => {
    const avec = entreesMenu(OPERATEUR).map((e) => e.id);
    const sans = entreesMenu(MEMBRE).map((e) => e.id);
    expect(avec.filter((id) => !sans.includes(id))).toEqual(['admin']);
    expect(sans.filter((id) => !avec.includes(id))).toEqual([]);
  });

  it('ne propose PAS « Administration » tant que le fait est inconnu', () => {
    // Le header initialise `canReadAdmin` à `false` et un échec de
    // `GET /me/platform-access` l'y laisse : ne rien proposer vaut mieux que
    // proposer une page qui répondra 403.
    expect(entreesMenu({ canReadAdmin: false }).some((e) => e.id === 'admin')).toBe(false);
  });

  it('ne masque JAMAIS « Mon compte » : c’est l’espace de secours sans organisation', () => {
    expect(entreesMenu(MEMBRE).some((e) => e.id === 'compte')).toBe(true);
  });
});

describe('groupes et séparateurs', () => {
  it('sépare personne / organisation / déconnexion, pour un opérateur', () => {
    const items = entreesMenu(OPERATEUR);
    const avant = items.map((_, i) => separateurAvant(items, i));
    //           TdB    Compte  Orga   Abo    Admin  Déco
    expect(avant).toEqual([false, false, true, false, false, true]);
  });

  it('ne laisse AUCUN séparateur orphelin quand « Administration » disparaît', () => {
    const items = entreesMenu(MEMBRE);
    const avant = items.map((_, i) => separateurAvant(items, i));
    //           TdB    Compte  Orga   Abo    Déco
    expect(avant).toEqual([false, false, true, false, true]);
    // Deux séparateurs dans les deux cas : le dessin ne dépend pas d'un index
    // codé en dur, donc retirer une entrée ne peut pas produire un trait seul.
    expect(avant.filter(Boolean)).toHaveLength(2);
  });

  it('ne pose jamais de séparateur en tête de menu', () => {
    expect(separateurAvant(entreesMenu(OPERATEUR), 0)).toBe(false);
  });
});

describe('entrée active déduite du chemin (ADR-0016 §6.3)', () => {
  const items = entreesMenu(OPERATEUR);

  it('allume l’entrée de la page exacte', () => {
    expect(entreeActive('/projects', items)).toBe('tableau-de-bord');
    expect(entreeActive('/compte', items)).toBe('compte');
    expect(entreeActive('/organisation', items)).toBe('organisation');
    expect(entreeActive('/souscription', items)).toBe('souscription');
    expect(entreeActive('/admin', items)).toBe('admin');
  });

  it('allume l’entrée de l’espace depuis n’importe quelle sous-page', () => {
    // Le menu ne liste qu'une entrée par espace : elle vaut pour tout l'espace.
    expect(entreeActive('/compte/securite', items)).toBe('compte');
    expect(entreeActive('/compte/preferences', items)).toBe('compte');
    expect(entreeActive('/organisation/membres', items)).toBe('organisation');
    expect(entreeActive('/organisation/journal/2026', items)).toBe('organisation');
    expect(entreeActive('/projects/abc/plan', items)).toBe('tableau-de-bord');
  });

  it('compare des frontières de segment, jamais des préfixes nus', () => {
    // `/comptes-annuels` commence par `/compte` sans en faire partie.
    expect(entreeActive('/comptes-annuels', items)).toBeNull();
    expect(entreeActive('/administration-fiscale', items)).toBeNull();
    expect(entreeActive('/projectsomething', items)).toBeNull();
  });

  it('n’allume rien sur une page hors du menu', () => {
    expect(entreeActive('/aide', items)).toBeNull();
    expect(entreeActive('/aide/glossaire', items)).toBeNull();
    expect(entreeActive('/', items)).toBeNull();
  });

  it('n’allume pas « Administration » quand elle est masquée', () => {
    // Sinon un `aria-current="page"` désignerait une entrée absente du DOM.
    expect(entreeActive('/admin', entreesMenu(MEMBRE))).toBeNull();
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
