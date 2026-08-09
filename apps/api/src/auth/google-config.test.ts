// Résolution de la configuration Google (S22a).
//
// La règle testée ici — « les deux variables ou rien » — est ce qui garantit la
// promesse du lot : sans identifiants Google, l'application démarre et le bouton
// ne s'affiche pas. Une demi-configuration est traitée comme une absence plutôt
// que de laisser better-auth lever `CLIENT_ID_AND_SECRET_REQUIRED` au premier
// clic, c'est-à-dire une panne visible par l'utilisateur final.

import { describe, expect, it } from 'vitest';

import { isPartialGoogleConfig, resolveGoogleCredentials } from './auth.js';

describe('resolveGoogleCredentials', () => {
  it('retourne null sur un environnement vide — cas du développement sans Google', () => {
    expect(resolveGoogleCredentials({})).toBeNull();
    expect(isPartialGoogleConfig({})).toBe(false);
  });

  it('retourne les identifiants quand les deux variables sont présentes', () => {
    expect(
      resolveGoogleCredentials({
        GOOGLE_CLIENT_ID: '1234.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'secret',
      }),
    ).toEqual({ clientId: '1234.apps.googleusercontent.com', clientSecret: 'secret' });
  });

  it("traite une configuration incomplète comme une absence, et la signale", () => {
    const idSeul = { GOOGLE_CLIENT_ID: '1234.apps.googleusercontent.com' };
    const secretSeul = { GOOGLE_CLIENT_SECRET: 'secret' };

    expect(resolveGoogleCredentials(idSeul)).toBeNull();
    expect(resolveGoogleCredentials(secretSeul)).toBeNull();
    // `isPartialGoogleConfig` existe pour que le démarrage puisse AVERTIR : sans
    // ce signal, un opérateur qui a oublié une variable cherche un bouton absent
    // sans aucune trace expliquant pourquoi.
    expect(isPartialGoogleConfig(idSeul)).toBe(true);
    expect(isPartialGoogleConfig(secretSeul)).toBe(true);
  });

  it('ignore les valeurs vides ou faites d’espaces', () => {
    // Un `.env` avec `GOOGLE_CLIENT_ID=` produit une chaîne vide, pas `undefined` :
    // sans ce nettoyage, la variable « existe » et la configuration passerait pour
    // complète à moitié.
    expect(
      resolveGoogleCredentials({ GOOGLE_CLIENT_ID: '  ', GOOGLE_CLIENT_SECRET: '  ' }),
    ).toBeNull();
    expect(isPartialGoogleConfig({ GOOGLE_CLIENT_ID: '  ', GOOGLE_CLIENT_SECRET: '  ' })).toBe(
      false,
    );
  });
});
