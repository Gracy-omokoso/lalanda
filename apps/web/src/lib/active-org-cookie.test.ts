// Domaine du cookie `active_org_id` : il doit atteindre l'API, sinon le changement
// d'organisation reste sans effet sur les données (correctif du 2 nov. 2026).

import { describe, expect, it } from 'vitest';

import { activeOrgCookieDomain } from './api';

describe('activeOrgCookieDomain', () => {
  it('production : page lalanda.co, API api.lalanda.co → lalanda.co', () => {
    expect(activeOrgCookieDomain('lalanda.co', 'https://api.lalanda.co')).toBe('lalanda.co');
    expect(activeOrgCookieDomain('www.lalanda.co', 'https://api.lalanda.co')).toBe('lalanda.co');
  });

  it('local : localhost (le port ne compte pas pour les cookies) → aucun domaine', () => {
    expect(activeOrgCookieDomain('localhost', 'http://localhost:3001')).toBeUndefined();
    expect(activeOrgCookieDomain('127.0.0.1', 'http://127.0.0.1:3001')).toBeUndefined();
  });

  it('même hôte → aucun domaine', () => {
    expect(activeOrgCookieDomain('app.exemple.cd', 'https://app.exemple.cd/api')).toBeUndefined();
  });

  it('jamais un domaine de premier niveau seul, ni deux sites sans parent commun', () => {
    expect(activeOrgCookieDomain('a.co', 'https://b.co')).toBeUndefined();
    expect(activeOrgCookieDomain('lalanda.co', 'https://api.autre.cd')).toBeUndefined();
  });

  it('URL d’API invalide → aucun domaine', () => {
    expect(activeOrgCookieDomain('lalanda.co', 'pas une url')).toBeUndefined();
  });
});
