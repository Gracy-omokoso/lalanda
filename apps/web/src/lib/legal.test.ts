// Registre des documents légaux (S22c).
//
// Le risque couvert ici n'est pas une exception à l'exécution : c'est une page
// légale qui existe mais qu'on ne peut pas atteindre, ou une page annoncée dans
// un footer qui renvoie un 404. Les deux passent le build et les types.

import { describe, expect, it } from 'vitest';

import { LEGAL_DOCUMENTS, LEGAL_PATHS, LEGAL_VERSION, isLegalPath, legalDocument } from './legal';
import { isAuthPath, isMarketingPath, isProtectedPath } from './routes';

describe('registre des documents légaux', () => {
  it('publie les cinq documents attendus', () => {
    expect(LEGAL_DOCUMENTS.map((d) => d.slug).sort()).toEqual([
      'cgu',
      'cgv',
      'confidentialite',
      'cookies',
      'mentions-legales',
    ]);
  });

  it('donne à chaque document un chemin, un titre et une date de mise à jour', () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.href).toBe(`/${doc.slug}`);
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.shortTitle.length).toBeGreaterThan(0);
      expect(doc.summary.length).toBeGreaterThan(0);
      expect(doc.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('n’a ni doublon de slug ni doublon de chemin', () => {
    expect(new Set(LEGAL_DOCUMENTS.map((d) => d.slug)).size).toBe(LEGAL_DOCUMENTS.length);
    expect(new Set(LEGAL_PATHS).size).toBe(LEGAL_PATHS.length);
  });

  it('expose une version de corpus au format date', () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lève sur un slug inconnu plutôt que de renvoyer un document vide', () => {
    // @ts-expect-error — slug volontairement hors union
    expect(() => legalDocument('inexistant')).toThrow();
  });
});

describe('accessibilité des pages légales (S22c)', () => {
  it('aucune page légale n’exige de session', () => {
    // Une page légale derrière une session est inopposable : le visiteur qui
    // doit décider de s'inscrire est justement celui qui n'en a pas.
    for (const path of LEGAL_PATHS) {
      expect(isProtectedPath(path)).toBe(false);
      expect(isLegalPath(path)).toBe(true);
    }
  });

  it('aucune page légale n’est classée marketing ni auth', () => {
    // Conséquence concrète : les pages marketing redirigent un utilisateur
    // CONNECTÉ vers /projects. Classer /cgu ici renverrait vers l'application
    // tout membre cliquant sur « CGU » depuis le footer applicatif.
    for (const path of LEGAL_PATHS) {
      expect(isMarketingPath(path)).toBe(false);
      expect(isAuthPath(path)).toBe(false);
    }
  });

  it('compare par égalité exacte', () => {
    expect(isLegalPath('/cgu')).toBe(true);
    expect(isLegalPath('/cgu/annexe')).toBe(false);
    expect(isLegalPath('/cgu-entreprise')).toBe(false);
  });
});
