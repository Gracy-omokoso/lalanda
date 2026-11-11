// ADR-0053 — P8 : choix de l'écran de double authentification, saisie du code.

import { describe, expect, it } from 'vitest';

import {
  codeEnrolementValide,
  etapeApresErreur,
  etatDeuxFacteurs,
  motDePassePret,
  messageDeuxFacteurs,
  secondFacteurDe,
  texteCodesDeSecours,
} from './deux-facteurs-model';
import { estRouteOrganisation } from './console-model';
import { DEUX_FACTEURS_SHELL_CALLS } from './deux-facteurs-model';

const tf = (enrolled: boolean, sessionVerified: boolean, required = true) => ({
  required,
  enrolled,
  sessionVerified,
  backupCodesRemaining: enrolled ? 10 : 0,
});

describe('etatDeuxFacteurs', () => {
  it('non-opérateur : non concerné, quel que soit l’état servi', () => {
    expect(
      etatDeuxFacteurs({ isPlatformOperator: false, twoFactor: tf(false, false, false) }),
    ).toBe('non-concerne');
    expect(etatDeuxFacteurs({ isPlatformOperator: false })).toBe('non-concerne');
  });

  it('opérateur non enrôlé → enrôlement (jamais un refus sans chemin)', () => {
    expect(etatDeuxFacteurs({ isPlatformOperator: true, twoFactor: tf(false, false) })).toBe(
      'enrolement',
    );
  });

  it('enrôlé, session non vérifiée → vérification ; vérifiée → console', () => {
    expect(etatDeuxFacteurs({ isPlatformOperator: true, twoFactor: tf(true, false) })).toBe(
      'verification',
    );
    expect(etatDeuxFacteurs({ isPlatformOperator: true, twoFactor: tf(true, true) })).toBe('ok');
  });
});

describe('saisie du second facteur', () => {
  it('six chiffres → code TOTP, espaces retirés', () => {
    expect(secondFacteurDe(' 123 456 ')).toEqual({ code: '123456' });
  });

  it('douze caractères de Crockford → code de secours', () => {
    expect(secondFacteurDe('abcd-efgh-jkmn')).toEqual({ backupCode: 'abcd-efgh-jkmn' });
  });

  it('autre chose → rien n’est envoyé', () => {
    for (const s of ['', '12345', 'bonjour', 'ABCD-EFGH-JKM']) {
      expect(secondFacteurDe(s), s).toBeNull();
    }
  });

  it('enrôlement : six chiffres seulement', () => {
    expect(codeEnrolementValide('123456')).toBe(true);
    expect(codeEnrolementValide('ABCD-EFGH-JKMN')).toBe(false);
  });
});

describe('codes de secours et messages', () => {
  it('texte à conserver : en-tête, compte, un code par ligne en groupes de quatre', () => {
    const texte = texteCodesDeSecours(['ABCDEFGHJKMN', '0123456789AB'], 'gracy@lalanda.test');
    expect(texte.split('\n')).toEqual([
      'Lalanda — codes de secours de la console',
      'Compte : gracy@lalanda.test',
      'Chaque code ne sert qu’une fois. Conservez-les hors de votre téléphone.',
      '',
      'ABCD-EFGH-JKMN',
      '0123-4567-89AB',
    ]);
  });

  it('messages lisibles pour les refus de l’API', () => {
    const err = (code: string) => Object.assign(new Error('x'), { detail: { code } });
    expect(messageDeuxFacteurs(err('TWO_FACTOR_LOCKED'), 'd')).toContain('15 minutes');
    expect(messageDeuxFacteurs(err('INVALID_TWO_FACTOR_CODE'), 'd')).toContain('Code refusé');
    expect(messageDeuxFacteurs(null, 'défaut')).toBe('défaut');
  });

  it('la coquille n’appelle aucune route d’organisation pour la double authentification', () => {
    for (const route of DEUX_FACTEURS_SHELL_CALLS) expect(estRouteOrganisation(route)).toBe(false);
  });
});

describe('connexion en deux temps (ADR-0074)', () => {
  it('mot de passe refusé : retour à l’étape du mot de passe', () => {
    expect(etapeApresErreur({ detail: { code: 'INVALID_PASSWORD' } })).toBe('motdepasse');
    expect(etapeApresErreur({ detail: { code: 'REAUTH_GOOGLE_REQUIRED' } })).toBe('motdepasse');
  });

  it('code refusé, verrou ou panne : on reste sur le code', () => {
    expect(etapeApresErreur({ detail: { code: 'INVALID_TWO_FACTOR_CODE' } })).toBe('code');
    expect(etapeApresErreur({ detail: { code: 'TWO_FACTOR_LOCKED' } })).toBe('code');
    expect(etapeApresErreur(new Error('réseau'))).toBe('code');
    expect(etapeApresErreur(null)).toBe('code');
  });

  it('mot de passe exigé, sauf compte Google à l’enrôlement', () => {
    expect(motDePassePret('', false)).toBe(false);
    expect(motDePassePret('x', false)).toBe(true);
    expect(motDePassePret('', true)).toBe(true);
  });
});
