// Classement des routes par besoin de session (S20b).
//
// Ces tests existent parce que l'oubli est silencieux : ajouter un espace sans
// l'inscrire dans `PROTECTED_PREFIXES` ne casse ni le build, ni les types, ni le
// rendu — un visiteur non authentifié voit simplement l'application se monter
// puis des bannières d'erreur 401, au lieu de la page de connexion.

import { describe, expect, it } from 'vitest';

import { isAuthPath, isMarketingPath, isProtectedPath } from './routes';

describe('isProtectedPath (S20b)', () => {
  it('protège les trois pages de l’espace compte', () => {
    expect(isProtectedPath('/compte')).toBe(true);
    expect(isProtectedPath('/compte/securite')).toBe(true);
    expect(isProtectedPath('/compte/preferences')).toBe(true);
  });

  it('protège les quatre pages de l’espace organisation (S21a)', () => {
    for (const path of [
      '/organisation',
      '/organisation/parametres',
      '/organisation/facturation',
      '/organisation/journal',
    ]) {
      expect(isProtectedPath(path)).toBe(true);
    }
  });

  it('protège le tunnel de souscription et son retour fournisseur (S22b)', () => {
    // Le retour de paiement est la page la plus exposée du tunnel : le
    // fournisseur y renvoie le client avec une URL devinable. Sans session, elle
    // doit mener à la connexion, jamais afficher un état d'abonnement.
    expect(isProtectedPath('/souscription')).toBe(true);
    expect(isProtectedPath('/souscription/retour')).toBe(true);
  });

  it('protège les espaces existants, racine comme sous-routes', () => {
    for (const path of [
      '/projects',
      '/projects/abc',
      '/members',
      '/invitations',
      '/invitations/accept',
    ]) {
      expect(isProtectedPath(path)).toBe(true);
    }
  });

  it('laisse publiques les pages marketing et d’authentification', () => {
    for (const path of ['/', '/pricing', '/login', '/register']) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  it('compare des SEGMENTS, pas des préfixes de chaîne', () => {
    // Sans cette précaution, une future page publique « /comptes-annuels »
    // deviendrait inaccessible du seul fait de commencer par « /compte ».
    expect(isProtectedPath('/comptes-annuels')).toBe(false);
    expect(isProtectedPath('/projects-publics')).toBe(false);
  });
});

describe('isAuthPath / isMarketingPath (S20b)', () => {
  it('reconnaît les pages d’authentification et elles seules', () => {
    expect(isAuthPath('/login')).toBe(true);
    expect(isAuthPath('/register')).toBe(true);
    expect(isAuthPath('/login/oublie')).toBe(false);
  });

  it('reconnaît les pages marketing par égalité exacte', () => {
    expect(isMarketingPath('/')).toBe(true);
    expect(isMarketingPath('/pricing')).toBe(true);
    expect(isMarketingPath('/pricing/entreprise')).toBe(false);
  });
});
