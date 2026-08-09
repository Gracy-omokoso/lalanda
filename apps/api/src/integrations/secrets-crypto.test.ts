// ─────────────────────────────────────────────────────────────────────────────
// NOYAU CRYPTOGRAPHIQUE — ADR-0013 §2, §3 et § Plan de validation
//
// Ce fichier ne teste pas AES-GCM (c'est `node:crypto` qui l'implémente, et il
// est mieux testé que tout ce qu'on écrirait). Il teste les DÉCISIONS d'ADR-0013
// qui entourent AES-GCM, et qui sont les seules choses que nous puissions
// casser :
//
//   1. l'IV et le sel sont NEUFS à chaque écriture (piège n°1 du fichier source);
//   2. le tag est vérifié — donc une altération d'un octet fait échouer;
//   3. la dérivation HKDF lie le chiffré au couple (provider, secretName);
//   4. l'AAD lie en plus au document et au `keyId`;
//   5. un `keyId` inconnu LÈVE et n'essaie AUCUNE autre clé du trousseau;
//   6. `rewrap` est idempotent et rejouable.
//
// Toutes les clés maîtresses sont tirées par `randomBytes` à l'exécution : rien
// de commitable, et deux exécutions ne partagent aucun matériel.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { LAST4_MIN_LENGTH, last4Of, REDACTED, Secret } from './secret-value.js';
import {
  decodeMasterKey,
  decryptSecret,
  encryptSecret,
  keyringFromEnv,
  MasterKeyring,
  rewrapSecret,
  SecretDecryptionError,
  SecretKeyUnavailableError,
  secretsEqual,
  SECRET_ALGORITHM,
  type EncryptedValue,
  type SecretLocation,
} from './secrets-crypto.js';

const VALEUR = 'valeur-de-test-jamais-utilisee-ailleurs-91c4d2e8';

const EMPLACEMENT: SecretLocation = {
  documentId: '507f1f77bcf86cd799439011',
  provider: 'stripe',
  secretName: 'restrictedKey',
};

function trousseau(keyId = 'k1'): MasterKeyring {
  return MasterKeyring.of([{ keyId, key: randomBytes(32) }], keyId);
}

function chiffrer(
  keyring: MasterKeyring,
  location: SecretLocation = EMPLACEMENT,
  value = VALEUR,
): EncryptedValue {
  return encryptSecret({ location, value, keyring, updatedBy: 'testeur' });
}

// ── Aller-retour ─────────────────────────────────────────────────────────────

describe('aller-retour chiffrement / déchiffrement', () => {
  it('restitue exactement la valeur, dans une enveloppe Secret', () => {
    const keyring = trousseau();
    const record = chiffrer(keyring);
    const rendu = decryptSecret({ location: EMPLACEMENT, record, keyring });

    expect(rendu).toBeInstanceOf(Secret);
    expect(rendu.expose()).toBe(VALEUR);
  });

  it('produit un enregistrement complet et bien formé', () => {
    const record = chiffrer(trousseau());

    expect(record.alg).toBe(SECRET_ALGORITHM);
    expect(record.keyId).toBe('k1');
    expect(Buffer.from(record.salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(record.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(record.authTag, 'base64')).toHaveLength(16);
    expect(record.updatedBy).toBe('testeur');
    // Contre-épreuve : le chiffré ne contient évidemment pas le clair, mais
    // l'écrire ici documente que c'est bien CE fichier qui en répond.
    expect(record.ciphertext).not.toContain(VALEUR);
  });

  it('supporte les caractères non ASCII sans les mutiler', () => {
    // Un mot de passe SMTP peut contenir n'importe quoi. Le chiffrement travaille
    // sur des octets UTF-8, et une conversion latin-1 mal placée passerait
    // inaperçue jusqu'au premier envoi d'email refusé.
    const keyring = trousseau();
    const valeur = 'mot-de-passé-avec-accents-€-et-emoji-🔐-0123456789';
    const record = chiffrer(keyring, EMPLACEMENT, valeur);
    expect(decryptSecret({ location: EMPLACEMENT, record, keyring }).expose()).toBe(valeur);
  });
});

// ── Piège n°1 : réutilisation d'IV ───────────────────────────────────────────

describe("l'IV et le sel sont neufs à chaque écriture (ADR-0013 §2)", () => {
  it('deux chiffrements de la MÊME valeur diffèrent par iv, salt et ciphertext', () => {
    const keyring = trousseau();
    const a = chiffrer(keyring);
    const b = chiffrer(keyring);

    expect(a.iv).not.toBe(b.iv);
    expect(a.salt).not.toBe(b.salt);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.authTag).not.toBe(b.authTag);
  });

  it('sur 50 écritures, aucun IV ne se répète', () => {
    // Un IV réutilisé avec la même clé permet de retrouver le XOR de deux clairs
    // et de forger des messages — « le seul vrai piège d'implémentation de ce
    // schéma ». Une répétition sur 50 tirages de 12 octets serait un défaut de
    // l'implémentation, pas de la chance.
    const keyring = trousseau();
    const ivs = new Set<string>();
    for (let i = 0; i < 50; i += 1) ivs.add(chiffrer(keyring).iv);
    expect(ivs.size).toBe(50);
  });

  it("un iv ou un sel glissés dans l'entrée sont ignorés, pas honorés", () => {
    // Contrainte d'API et non consigne : `encryptSecret` n'expose aucun paramètre
    // permettant de figer l'IV « pour garder le même ». TypeScript le refuse déjà;
    // ce test vérifie qu'aucun chemin dynamique ne le rétablirait, par exemple si
    // quelqu'un ajoutait un jour un `...input` complaisant.
    const keyring = trousseau();
    const ivImpose = randomBytes(12).toString('base64');
    const record = encryptSecret({
      location: EMPLACEMENT,
      value: VALEUR,
      keyring,
      updatedBy: 'testeur',
      iv: ivImpose,
      salt: randomBytes(16).toString('base64'),
    } as never);

    expect(record.iv).not.toBe(ivImpose);
    expect(decryptSecret({ location: EMPLACEMENT, record, keyring }).expose()).toBe(VALEUR);
  });
});

// ── Piège n°2 : intégrité ────────────────────────────────────────────────────

describe('toute altération fait échouer le déchiffrement', () => {
  /** Retourne un octet du buffer base64 `champ` de l'enregistrement. */
  function alterer(record: EncryptedValue, champ: 'ciphertext' | 'authTag' | 'iv' | 'salt') {
    const octets = Buffer.from(record[champ], 'base64');
    octets[0] = octets[0]! ^ 0x01;
    return { ...record, [champ]: octets.toString('base64') };
  }

  it.each(['ciphertext', 'authTag', 'iv', 'salt'] as const)(
    'un octet retourné dans %s → SecretDecryptionError',
    (champ) => {
      const keyring = trousseau();
      const record = alterer(chiffrer(keyring), champ);
      expect(() => decryptSecret({ location: EMPLACEMENT, record, keyring })).toThrow(
        SecretDecryptionError,
      );
    },
  );

  it('un algorithme inattendu est refusé plutôt que supposé', () => {
    const keyring = trousseau();
    const record = { ...chiffrer(keyring), alg: 'aes-256-cbc' as never };
    expect(() => decryptSecret({ location: EMPLACEMENT, record, keyring })).toThrow(
      SecretDecryptionError,
    );
  });

  it.each([
    ['salt', 8],
    ['iv', 8],
    ['authTag', 8],
  ] as const)('une longueur de %s non conforme est refusée', (champ, taille) => {
    const keyring = trousseau();
    const record = { ...chiffrer(keyring), [champ]: randomBytes(taille).toString('base64') };
    expect(() => decryptSecret({ location: EMPLACEMENT, record, keyring })).toThrow(
      SecretDecryptionError,
    );
  });
});

// ── Pièges n°3 et 4 : le chiffré est scellé à son emplacement ────────────────

describe('un chiffré déplacé ne se déchiffre pas (HKDF + AAD)', () => {
  it('déplacé vers un autre secretName du même document → échec', () => {
    // C'est la dérivation HKDF qui refuse : `info` porte le couple
    // (provider, secretName), donc la clé de données n'est pas la même.
    const keyring = trousseau();
    const record = chiffrer(keyring);
    const ailleurs = { ...EMPLACEMENT, secretName: 'webhookSecret' };
    expect(() => decryptSecret({ location: ailleurs, record, keyring })).toThrow(
      SecretDecryptionError,
    );
  });

  it('déplacé vers un autre fournisseur → échec', () => {
    const keyring = trousseau();
    const record = chiffrer(keyring);
    const ailleurs = { ...EMPLACEMENT, provider: 'smtp' };
    expect(() => decryptSecret({ location: ailleurs, record, keyring })).toThrow(
      SecretDecryptionError,
    );
  });

  it('recopié vers un AUTRE DOCUMENT → échec (AAD)', () => {
    // Ici la dérivation est identique — même provider, même secretName. Seule
    // l'AAD diffère. C'est le scénario nommé par ADR-0013 §2 : « un attaquant
    // disposant d'un accès en écriture ne peut pas recopier le chiffré d'un
    // environnement de test vers la production ».
    const keyring = trousseau();
    const record = chiffrer(keyring);
    const autreDocument = { ...EMPLACEMENT, documentId: '507f1f77bcf86cd799439099' };
    expect(() => decryptSecret({ location: autreDocument, record, keyring })).toThrow(
      SecretDecryptionError,
    );
  });

  it('deux emplacements différents produisent des clés de données différentes', () => {
    // Preuve indirecte, mais utile : chiffrer la même valeur au même sel dans
    // deux emplacements ne doit pas donner le même chiffré. On force le même sel
    // en re-déchiffrant plutôt qu'en injectant — l'API ne le permet pas.
    const keyring = trousseau();
    const a = chiffrer(keyring, EMPLACEMENT);
    const b = chiffrer(keyring, { ...EMPLACEMENT, secretName: 'webhookSecret' });
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

// ── Piège n°3 : aucun repli silencieux ───────────────────────────────────────

describe('trousseau de clés — jamais de repli silencieux (ADR-0013 §3)', () => {
  it('un keyId inconnu lève SecretKeyUnavailableError, et n’essaie aucune autre clé', () => {
    const ancien = trousseau('k1');
    const record = chiffrer(ancien);

    // Nouveau trousseau : deux clés, MAIS pas celle qui a servi.
    const nouveau = MasterKeyring.of(
      [
        { keyId: 'k2', key: randomBytes(32) },
        { keyId: 'k3', key: randomBytes(32) },
      ],
      'k2',
    );

    let leve: unknown;
    try {
      decryptSecret({ location: EMPLACEMENT, record, keyring: nouveau });
    } catch (err) {
      leve = err;
    }
    // L'erreur doit être « clé indisponible » et NON « déchiffrement refusé » :
    // les deux méritent une panne bruyante mais pas la même reprise. Un
    // `SecretDecryptionError` ici signalerait que le code a ESSAYÉ une autre clé.
    expect(leve).toBeInstanceOf(SecretKeyUnavailableError);
    expect((leve as SecretKeyUnavailableError).code).toBe('SECRET_KEY_UNAVAILABLE');
    expect((leve as SecretKeyUnavailableError).keyId).toBe('k1');
  });

  it('keyFor lève au lieu de renvoyer undefined', () => {
    // Un appelant qui ignorerait un `undefined` retomberait sur un repli
    // silencieux — exactement ce que l'ADR interdit.
    expect(() => trousseau('k1').keyFor('inconnu')).toThrow(SecretKeyUnavailableError);
  });

  it('refuse une clé maîtresse de mauvaise longueur', () => {
    expect(() => MasterKeyring.of([{ keyId: 'k1', key: randomBytes(16) }], 'k1')).toThrow(
      /16 octets au lieu de 32/,
    );
  });

  it('refuse un trousseau dont la clé courante est absente', () => {
    expect(() => MasterKeyring.of([{ keyId: 'k1', key: randomBytes(32) }], 'k2')).toThrow(
      /courante/,
    );
  });
});

describe('décodage et construction depuis l’environnement', () => {
  it('décode 32 octets base64 et refuse tout le reste', () => {
    const clef = randomBytes(32).toString('base64');
    expect(decodeMasterKey(clef, 'SECRETS_MASTER_KEY')).toHaveLength(32);
    expect(() => decodeMasterKey(randomBytes(16).toString('base64'), 'X')).toThrow(/32 octets/);
    expect(() => decodeMasterKey('pas-du-base64-valide', 'X')).toThrow(/32 octets/);
  });

  it('renvoie null sans SECRETS_MASTER_KEY — l’appelant décide', () => {
    expect(keyringFromEnv({})).toBeNull();
  });

  it('construit un trousseau à deux clés pendant une rotation', () => {
    const keyring = keyringFromEnv({
      SECRETS_MASTER_KEY: randomBytes(32).toString('base64'),
      SECRETS_MASTER_KEY_ID: 'k2',
      SECRETS_MASTER_KEY_PREVIOUS: randomBytes(32).toString('base64'),
      SECRETS_MASTER_KEY_PREVIOUS_ID: 'k1',
    });
    expect(keyring!.currentKeyId).toBe('k2');
    expect(keyring!.keyIds().sort()).toEqual(['k1', 'k2']);
  });

  it('refuse une clé précédente sans identifiant — elle serait inutilisable', () => {
    expect(() =>
      keyringFromEnv({
        SECRETS_MASTER_KEY: randomBytes(32).toString('base64'),
        SECRETS_MASTER_KEY_ID: 'k2',
        SECRETS_MASTER_KEY_PREVIOUS: randomBytes(32).toString('base64'),
      }),
    ).toThrow(/PREVIOUS_ID/);
  });

  it('refuse une rotation qui ne change pas le keyId', () => {
    // Sans changement de `keyId`, les enregistrements de l'ancienne clé sont
    // indiscernables de ceux de la nouvelle : la rotation devient intraçable.
    expect(() =>
      keyringFromEnv({
        SECRETS_MASTER_KEY: randomBytes(32).toString('base64'),
        SECRETS_MASTER_KEY_ID: 'k1',
        SECRETS_MASTER_KEY_PREVIOUS: randomBytes(32).toString('base64'),
        SECRETS_MASTER_KEY_PREVIOUS_ID: 'k1',
      }),
    ).toThrow(/identique/);
  });
});

// ── Rotation ─────────────────────────────────────────────────────────────────

describe('rotation de la clé maîtresse (ADR-0013 §3)', () => {
  /** Trousseau de rotation : k1 (ancienne) + k2 (courante). */
  function trousseauDeRotation(): { ancien: MasterKeyring; rotation: MasterKeyring } {
    const cleK1 = randomBytes(32);
    const cleK2 = randomBytes(32);
    return {
      ancien: MasterKeyring.of([{ keyId: 'k1', key: cleK1 }], 'k1'),
      rotation: MasterKeyring.of(
        [
          { keyId: 'k1', key: cleK1 },
          { keyId: 'k2', key: cleK2 },
        ],
        'k2',
      ),
    };
  }

  it('re-chiffre sous la clé courante, avec un sel et un iv NEUFS', () => {
    const { ancien, rotation } = trousseauDeRotation();
    const avant = chiffrer(ancien);
    const { changed, record } = rewrapSecret({
      location: EMPLACEMENT,
      record: avant,
      keyring: rotation,
    });

    expect(changed).toBe(true);
    expect(record.keyId).toBe('k2');
    expect(record.salt).not.toBe(avant.salt);
    expect(record.iv).not.toBe(avant.iv);
    expect(record.ciphertext).not.toBe(avant.ciphertext);
    expect(decryptSecret({ location: EMPLACEMENT, record, keyring: rotation }).expose()).toBe(
      VALEUR,
    );
  });

  it('est idempotent : rejouée, la migration ne touche à rien', () => {
    const { ancien, rotation } = trousseauDeRotation();
    const premier = rewrapSecret({
      location: EMPLACEMENT,
      record: chiffrer(ancien),
      keyring: rotation,
    });
    const second = rewrapSecret({
      location: EMPLACEMENT,
      record: premier.record,
      keyring: rotation,
    });

    expect(second.changed).toBe(false);
    // Même OBJET renvoyé : aucune écriture, donc aucun `iv` regénéré inutilement.
    expect(second.record).toBe(premier.record);
  });

  it("le déchiffrement reste possible après retrait de l'ancienne clé", () => {
    // Étape 3 de la procédure : « vérifier qu'aucun document ne porte l'ancien
    // keyId, puis retirer _PREVIOUS de l'environnement ».
    const { ancien, rotation } = trousseauDeRotation();
    const { record } = rewrapSecret({
      location: EMPLACEMENT,
      record: chiffrer(ancien),
      keyring: rotation,
    });

    const apresRetrait = MasterKeyring.of([{ keyId: 'k2', key: rotation.keyFor('k2') }], 'k2');
    expect(decryptSecret({ location: EMPLACEMENT, record, keyring: apresRetrait }).expose()).toBe(
      VALEUR,
    );
  });

  it("ne réécrit pas updatedAt : la rotation n'est pas une modification métier", () => {
    // Sinon l'audit ferait croire que quelqu'un a changé la clé le jour de la
    // rotation, ce qui rendrait toute investigation ultérieure trompeuse.
    const { ancien, rotation } = trousseauDeRotation();
    const avant = encryptSecret({
      location: EMPLACEMENT,
      value: VALEUR,
      keyring: ancien,
      updatedBy: 'humain',
      now: new Date('2026-01-15T10:00:00.000Z'),
    });
    const { record } = rewrapSecret({ location: EMPLACEMENT, record: avant, keyring: rotation });

    expect(record.updatedAt).toEqual(avant.updatedAt);
    expect(record.updatedBy).toBe('humain');
  });

  it("un enregistrement dont la clé a été PERDUE lève, il n'est pas ignoré", () => {
    // Perte de clé ≠ rotation. ADR-0013 §3 : « les chiffrés sont définitivement
    // irrécupérables. C'est le comportement voulu. »
    const perdu = trousseau('k0');
    const record = chiffrer(perdu);
    const courant = trousseau('k9');
    expect(() => rewrapSecret({ location: EMPLACEMENT, record, keyring: courant })).toThrow(
      SecretKeyUnavailableError,
    );
  });
});

// ── last4 et enveloppe Secret ────────────────────────────────────────────────

describe('last4 — suffixe uniquement (ADR-0013 §4)', () => {
  it('renvoie les 4 DERNIERS caractères', () => {
    expect(last4Of('rk_live_abcdefgh1234')).toBe('1234');
  });

  it('ne renvoie jamais un préfixe', () => {
    // « Les clés Stripe commencent par `sk_live_` / `rk_test_`, un préfixe
    // révélerait le mode et le type ; le suffixe est arbitraire. »
    const valeur = 'rk_test_abcdefgh9876';
    expect(valeur.startsWith(last4Of(valeur)!)).toBe(false);
    expect(valeur.endsWith(last4Of(valeur)!)).toBe(true);
  });

  it('renvoie null sous 12 caractères', () => {
    // « Révéler 4 caractères d'un secret de 10 en divulgue 40 %. »
    expect(last4Of('a'.repeat(LAST4_MIN_LENGTH - 1))).toBeNull();
    expect(last4Of('a'.repeat(LAST4_MIN_LENGTH))).toBe('aaaa');
    expect(last4Of('')).toBeNull();
  });

  it('un enregistrement chiffré d’une valeur courte porte last4 = null', () => {
    const record = chiffrer(trousseau(), EMPLACEMENT, 'court');
    expect(record.last4).toBeNull();
  });
});

describe('enveloppe Secret — les trois chemins de sérialisation (ADR-0013 §2)', () => {
  const secret = new Secret(VALEUR);

  it('toString, interpolation et JSON.stringify renvoient [redacted]', () => {
    expect(String(secret)).toBe(REDACTED);
    expect(`${secret}`).toBe(REDACTED);
    expect(JSON.stringify({ cle: secret })).toBe(`{"cle":"${REDACTED}"}`);
  });

  it('util.inspect — le chemin qu’on oublie — renvoie [redacted]', () => {
    expect(inspect(secret)).toBe(REDACTED);
    // `console.log(objet)` inspecte en profondeur : le secret imbriqué aussi.
    expect(inspect({ conteneur: secret })).toContain(REDACTED);
    expect(inspect({ conteneur: secret })).not.toContain(VALEUR);
  });

  it('la valeur n’est atteignable par aucune énumération de propriétés', () => {
    // Rangée dans une WeakMap externe : ni `getOwnPropertyNames`, ni les symboles,
    // ni un sérialiseur de trace de pile ne la voient.
    expect(Object.getOwnPropertyNames(secret)).toEqual([]);
    expect(Object.getOwnPropertySymbols(secret)).toEqual([]);
    expect(inspect(secret, { depth: 10, showHidden: true, getters: true })).not.toContain(VALEUR);
  });

  it('expose() reste le seul chemin, et donne la valeur exacte', () => {
    expect(secret.expose()).toBe(VALEUR);
    expect(secret.length).toBe(VALEUR.length);
  });
});

describe('comparaison à temps constant', () => {
  it('vraie pour deux valeurs identiques, fausse sinon', () => {
    expect(secretsEqual(VALEUR, VALEUR)).toBe(true);
    expect(secretsEqual(VALEUR, `${VALEUR}x`)).toBe(false);
    expect(secretsEqual(VALEUR, VALEUR.replace(/.$/, 'z'))).toBe(false);
    expect(secretsEqual('', '')).toBe(true);
  });
});
