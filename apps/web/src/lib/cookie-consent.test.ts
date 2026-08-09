// Consentement aux cookies (S22c).
//
// Ces tests portent sur la seule promesse qui compte : un refus, ou une absence
// de réponse, doit se traduire par « rien de non essentiel ». C'est le genre de
// règle qui se casse en silence — un cookie mal formé interprété comme un
// accord ne produit aucune erreur visible, juste un traceur qui repart.

import { describe, expect, it } from 'vitest';

import {
  CONSENT_COOKIE_NAME,
  CONSENT_VERSION,
  DEFAULT_CONSENT,
  FULL_CONSENT,
  buildConsentClearCookie,
  buildConsentCookie,
  hasDecided,
  isAllowed,
  readConsent,
  readCookieValue,
  serializeConsent,
} from './cookie-consent';

const NOW = new Date('2026-08-09T10:00:00.000Z');

/** Fabrique une chaîne `document.cookie` contenant le consentement donné. */
function cookieStringFor(value: string, extra = ''): string {
  return `${extra}${extra ? '; ' : ''}${CONSENT_COOKIE_NAME}=${encodeURIComponent(value)}`;
}

describe('refus par défaut', () => {
  it('aucun cookie → aucune catégorie autorisée', () => {
    expect(readConsent(undefined)).toBeNull();
    expect(readConsent('')).toBeNull();
    expect(isAllowed(null, 'mesure')).toBe(false);
  });

  it('la valeur par défaut refuse toutes les catégories non essentielles', () => {
    for (const allowed of Object.values(DEFAULT_CONSENT)) {
      expect(allowed).toBe(false);
    }
  });

  it('un cookie illisible vaut refus, jamais acceptation', () => {
    for (const broken of ['pas-du-json', '{', '{"version":1}', '[]', 'null']) {
      const stored = readConsent(cookieStringFor(broken));
      expect(isAllowed(stored, 'mesure')).toBe(false);
    }
  });

  it('un cookie d’une version antérieure du formulaire est ignoré', () => {
    const ancien = JSON.stringify({
      version: CONSENT_VERSION - 1,
      decidedAt: NOW.toISOString(),
      state: { mesure: true },
    });
    // Le consentement d'hier ne dit rien du formulaire d'aujourd'hui : la
    // question doit être reposée, et entre-temps rien ne se charge.
    expect(readConsent(cookieStringFor(ancien))).toBeNull();
    expect(isAllowed(readConsent(cookieStringFor(ancien)), 'mesure')).toBe(false);
  });

  it('une catégorie absente du cookie retombe sur le refus', () => {
    const partiel = JSON.stringify({
      version: CONSENT_VERSION,
      decidedAt: NOW.toISOString(),
      state: {},
    });
    const stored = readConsent(cookieStringFor(partiel));
    expect(stored).not.toBeNull();
    expect(isAllowed(stored, 'mesure')).toBe(false);
  });

  it('une valeur non booléenne ne vaut pas acceptation', () => {
    for (const truthy of ['"true"', '1', '"oui"']) {
      const bidouille = `{"version":${CONSENT_VERSION},"decidedAt":"${NOW.toISOString()}","state":{"mesure":${truthy}}}`;
      expect(isAllowed(readConsent(cookieStringFor(bidouille)), 'mesure')).toBe(false);
    }
  });
});

describe('persistance du choix', () => {
  it('un refus est enregistré comme un choix — la bannière ne revient pas', () => {
    const value = serializeConsent(DEFAULT_CONSENT, NOW);
    const stored = readConsent(cookieStringFor(value));
    expect(hasDecided(stored)).toBe(true);
    expect(isAllowed(stored, 'mesure')).toBe(false);
  });

  it('une acceptation est relue à l’identique', () => {
    const value = serializeConsent(FULL_CONSENT, NOW);
    const stored = readConsent(cookieStringFor(value));
    expect(hasDecided(stored)).toBe(true);
    expect(isAllowed(stored, 'mesure')).toBe(true);
    expect(stored?.decidedAt).toBe(NOW.toISOString());
  });

  it('se relit au milieu d’autres cookies', () => {
    const value = serializeConsent(FULL_CONSENT, NOW);
    const withOthers = cookieStringFor(value, 'better-auth.session_token=abc; theme=dark');
    expect(isAllowed(readConsent(withOthers), 'mesure')).toBe(true);
  });

  it('ne confond pas un cookie dont le nom est un préfixe', () => {
    const value = serializeConsent(FULL_CONSENT, NOW);
    const piege = `${CONSENT_COOKIE_NAME}_autre=${encodeURIComponent(value)}`;
    expect(readConsent(piege)).toBeNull();
  });
});

describe('attributs du cookie', () => {
  it('porte Path, Max-Age et SameSite, et Secure seulement en HTTPS', () => {
    const clair = buildConsentCookie(DEFAULT_CONSENT, NOW, false);
    expect(clair).toContain('Path=/');
    expect(clair).toContain('SameSite=Lax');
    expect(clair).toMatch(/Max-Age=\d+/);
    // Sans cette exception, le cookie serait rejeté sur http://localhost et la
    // bannière réapparaîtrait à chaque navigation en développement.
    expect(clair).not.toContain('Secure');
    expect(buildConsentCookie(DEFAULT_CONSENT, NOW, true)).toContain('Secure');
  });

  it('l’effacement remet le compteur à zéro', () => {
    expect(buildConsentClearCookie()).toContain('Max-Age=0');
  });
});

describe('readCookieValue', () => {
  it('découpe sur le premier « = » seulement', () => {
    expect(readCookieValue('a=b=c', 'a')).toBe('b=c');
  });

  it('renvoie null pour un cookie absent ou une chaîne vide', () => {
    expect(readCookieValue('a=1; b=2', 'c')).toBeNull();
    expect(readCookieValue('', 'a')).toBeNull();
    expect(readCookieValue(null, 'a')).toBeNull();
  });
});
