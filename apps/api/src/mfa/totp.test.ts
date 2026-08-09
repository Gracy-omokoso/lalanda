// Vérification de l'implémentation TOTP contre les VECTEURS DE TEST des RFC.
//
// C'est la raison pour laquelle écrire TOTP à la main est défendable : l'IETF
// publie, dans RFC 4226 annexe D et RFC 6238 annexe B, les valeurs exactes que
// doit produire une implémentation correcte. Un test qui les rejoue ne vérifie
// pas « que le code fait ce que son auteur croyait » — il vérifie que le code est
// conforme à une norme écrite par d'autres. Une bibliothèque tierce n'apporterait
// pas mieux : elle apporterait la même conformité, plus un arbre de dépendances.

import { describe, expect, it } from 'vitest';

import {
  TOTP_DIGITS,
  TOTP_STEP_SECONDS,
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  currentStep,
  generateTotpSecret,
  hotp,
  normalizeCode,
  totpAt,
  verifyTotp,
} from './totp.js';

describe('base32 (RFC 4648)', () => {
  // Vecteurs de RFC 4648 § 10, remplissage retiré (voir `base32Encode`).
  const VECTEURS: Array<[string, string]> = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];

  it('encode les vecteurs de RFC 4648 § 10', () => {
    for (const [clair, encode] of VECTEURS) {
      expect(base32Encode(Buffer.from(clair, 'utf8')), clair).toBe(encode);
    }
  });

  it('décode les vecteurs de RFC 4648 § 10', () => {
    for (const [clair, encode] of VECTEURS) {
      expect(base32Decode(encode).toString('utf8'), encode).toBe(clair);
    }
  });

  it('aller-retour sur 200 secrets aléatoires', () => {
    for (let i = 0; i < 200; i += 1) {
      const secret = generateTotpSecret();
      expect(base32Encode(base32Decode(secret))).toBe(secret);
    }
  });

  it('tolère casse, espaces et remplissage — la saisie manuelle en contient', () => {
    expect(base32Decode('mzxw 6ytb oi==').toString('utf8')).toBe('foobar');
  });

  it('refuse un caractère hors alphabet plutôt que de l’ignorer', () => {
    // Un `1` (confondu avec `I`) ignoré silencieusement produirait un secret
    // DIFFÉRENT : l'enrôlement réussirait puis tous les codes seraient refusés.
    expect(() => base32Decode('MZXW1YTB')).toThrow(/base32 invalide/);
  });

  it('un secret généré fait 160 bits (RFC 4226 § 4, exigence R6)', () => {
    expect(base32Decode(generateTotpSecret()).length).toBe(20);
  });

  it('deux secrets générés diffèrent', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(50);
  });
});

describe('HOTP (RFC 4226 annexe D)', () => {
  // Secret de la RFC : la chaîne ASCII « 12345678901234567890 ».
  const SECRET = Buffer.from('12345678901234567890', 'utf8');
  const ATTENDUS = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];

  it('produit les 10 valeurs de la table de RFC 4226 annexe D', () => {
    ATTENDUS.forEach((attendu, compteur) => {
      expect(hotp(SECRET, compteur), `compteur ${compteur}`).toBe(attendu);
    });
  });
});

describe('TOTP (RFC 6238 annexe B)', () => {
  // RFC 6238 annexe B, colonne SHA1. Le secret est le même que celui de RFC 4226.
  const SECRET_BASE32 = base32Encode(Buffer.from('12345678901234567890', 'utf8'));

  const VECTEURS: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it('reproduit les six vecteurs SHA-1 de RFC 6238 annexe B (8 chiffres)', () => {
    for (const [instantUnix, attendu] of VECTEURS) {
      const pas = Math.floor(instantUnix / TOTP_STEP_SECONDS);
      expect(totpAt(SECRET_BASE32, pas, 8), `T=${instantUnix}`).toBe(attendu);
    }
  });

  it('les mêmes vecteurs tronqués à 6 chiffres — le format réellement utilisé', () => {
    for (const [instantUnix, attendu] of VECTEURS) {
      const pas = Math.floor(instantUnix / TOTP_STEP_SECONDS);
      expect(totpAt(SECRET_BASE32, pas, 6), `T=${instantUnix}`).toBe(attendu.slice(-6));
    }
  });

  it('`currentStep` suit la définition T = unixTime / 30', () => {
    expect(currentStep(59_000)).toBe(1);
    expect(currentStep(1111111109_000)).toBe(37037036);
  });
});

describe('verifyTotp — fenêtre, expiration, rejets', () => {
  const SECRET = generateTotpSecret();
  // Instant arbitraire mais FIXE : un test qui lit l'horloge réelle échoue une
  // fois sur mille, à la seconde où le pas bascule entre deux lignes du test.
  const MAINTENANT = 1_760_000_000_000;
  const PAS = currentStep(MAINTENANT);

  it('accepte le code du pas courant', () => {
    const res = verifyTotp(SECRET, totpAt(SECRET, PAS), { nowMs: MAINTENANT });
    expect(res).toEqual({ valid: true, step: PAS });
  });

  it('accepte le pas précédent et le pas suivant (dérive d’horloge)', () => {
    for (const delta of [-1, 1]) {
      const res = verifyTotp(SECRET, totpAt(SECRET, PAS + delta), { nowMs: MAINTENANT });
      expect(res, `delta ${delta}`).toEqual({ valid: true, step: PAS + delta });
    }
  });

  it('REFUSE un code EXPIRÉ — deux pas dans le passé', () => {
    // 60 secondes plus tôt : hors de la fenêtre RFC 6238 § 5.2. C'est le cas
    // « code expiré » exigé par le chantier.
    const res = verifyTotp(SECRET, totpAt(SECRET, PAS - 2), { nowMs: MAINTENANT });
    expect(res).toEqual({ valid: false, step: null });
  });

  it('refuse aussi un code trop en avance', () => {
    expect(verifyTotp(SECRET, totpAt(SECRET, PAS + 2), { nowMs: MAINTENANT }).valid).toBe(false);
  });

  it('un code valide devient invalide 60 s plus tard — la fenêtre glisse', () => {
    const code = totpAt(SECRET, PAS);
    expect(verifyTotp(SECRET, code, { nowMs: MAINTENANT }).valid).toBe(true);
    expect(verifyTotp(SECRET, code, { nowMs: MAINTENANT + 60_000 }).valid).toBe(false);
  });

  it('refuse une saisie mal formée sans lever', () => {
    for (const saisie of ['', '12345', '1234567', 'abcdef', '12 34', '000000x', '../../etc']) {
      expect(verifyTotp(SECRET, saisie, { nowMs: MAINTENANT }).valid, saisie).toBe(false);
    }
  });

  it('refuse le code d’un AUTRE secret', () => {
    const autre = generateTotpSecret();
    expect(verifyTotp(SECRET, totpAt(autre, PAS), { nowMs: MAINTENANT }).valid).toBe(false);
  });

  it('accepte un code copié-collé avec espaces ou tirets', () => {
    const code = totpAt(SECRET, PAS);
    const espace = `${code.slice(0, 3)} ${code.slice(3)}`;
    const tiret = `${code.slice(0, 3)}-${code.slice(3)}`;
    expect(verifyTotp(SECRET, espace, { nowMs: MAINTENANT }).valid).toBe(true);
    expect(verifyTotp(SECRET, tiret, { nowMs: MAINTENANT }).valid).toBe(true);
    expect(normalizeCode(espace)).toBe(code);
  });

  it('un code fait bien 6 chiffres, zéros de tête compris', () => {
    // Sans le `padStart` de `hotp`, un code commençant par 0 sortirait à 5
    // chiffres et serait rejeté par le filtre de forme — panne intermittente,
    // environ une fois sur dix.
    for (let i = 0; i < 500; i += 1) {
      expect(totpAt(SECRET, PAS + i)).toMatch(new RegExp(`^\\d{${TOTP_DIGITS}}$`));
    }
  });
});

describe('URI otpauth://', () => {
  it('porte le secret, l’émetteur et les paramètres explicites', () => {
    const uri = buildOtpAuthUri({
      secretBase32: 'JBSWY3DPEHPK3PXP',
      accountName: 'alice@example.test',
      issuer: 'Lalanda',
    });
    const parsed = new URL(uri);
    expect(parsed.protocol).toBe('otpauth:');
    expect(parsed.host).toBe('totp');
    expect(decodeURIComponent(parsed.pathname)).toBe('/Lalanda:alice@example.test');
    expect(parsed.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(parsed.searchParams.get('issuer')).toBe('Lalanda');
    expect(parsed.searchParams.get('algorithm')).toBe('SHA1');
    expect(parsed.searchParams.get('digits')).toBe('6');
    expect(parsed.searchParams.get('period')).toBe('30');
  });

  it('percent-encode l’étiquette — un « @ » ou un « : » casserait l’analyse', () => {
    const uri = buildOtpAuthUri({
      secretBase32: 'JBSWY3DPEHPK3PXP',
      accountName: 'a:b@example.test',
      issuer: 'Lalanda',
    });
    expect(uri).toContain('/Lalanda:a%3Ab%40example.test?');
  });

  it('le secret de l’URI se relit et produit le même code', () => {
    const secret = generateTotpSecret();
    const uri = buildOtpAuthUri({ secretBase32: secret, accountName: 'x@y.z', issuer: 'Lalanda' });
    const relu = new URL(uri).searchParams.get('secret')!;
    expect(totpAt(relu, 1000)).toBe(totpAt(secret, 1000));
  });
});
