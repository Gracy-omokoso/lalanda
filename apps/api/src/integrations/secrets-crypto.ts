// ─────────────────────────────────────────────────────────────────────────────
// SCHÉMA CRYPTOGRAPHIQUE DES SECRETS D'INTÉGRATION — ADR-0013 §2 et §3
//
// AES-256-GCM, clé dérivée PAR ENREGISTREMENT depuis une clé maîtresse
// d'environnement, IV régénéré à chaque écriture, données authentifiées
// additionnelles (AAD) scellant le chiffré à son emplacement logique.
//
// Aucune dépendance : `node:crypto` uniquement (ADR-0013 § Conséquences).
//
// ── Les trois pièges de ce schéma, et où ils sont traités ─────────────────────
//
// 1. RÉUTILISATION D'IV. « La réutilisation d'un IV en GCM est catastrophique —
//    c'est le seul vrai piège d'implémentation de ce schéma » (ADR-0013 §2). Un
//    IV réutilisé avec la même clé permet de retrouver le XOR de deux clairs et
//    de forger des messages. Ici l'IV est tiré par `randomBytes(12)` à CHAQUE
//    appel d'`encryptSecret`, et il n'existe aucun chemin d'écriture qui
//    réutilise un `EncryptedValue` existant : `updateSecret` reconstruit
//    intégralement l'enregistrement. Le test « deux chiffrements de la même
//    valeur produisent des iv et des ciphertext différents » verrouille cela.
//
// 2. TAG NON VÉRIFIÉ. `decipher.final()` lève si le tag ne correspond pas — à
//    condition d'avoir appelé `setAuthTag`. L'oublier transforme GCM en simple
//    CTR : confidentialité sans intégrité, donc altération silencieuse en base.
//
// 3. REPLI SILENCIEUX SUR UNE AUTRE CLÉ. ADR-0013 §3 : « Jamais de repli
//    silencieux sur une autre clé ni sur une valeur par défaut ». La clé est
//    choisie PAR `keyId`; un `keyId` inconnu lève `SecretKeyUnavailableError` et
//    n'essaie aucune autre clé du trousseau.
// ─────────────────────────────────────────────────────────────────────────────

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { last4Of, Secret } from './secret-value.js';

/** Algorithme littéral, vérifié au déchiffrement (ADR-0013 §1). */
export const SECRET_ALGORITHM = 'aes-256-gcm';

const MASTER_KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const DATA_KEY_BYTES = 32;

/** Forme persistée d'une valeur chiffrée (ADR-0013 §1, tableau `EncryptedValue`). */
export interface EncryptedValue {
  alg: typeof SECRET_ALGORITHM;
  keyId: string;
  salt: string;
  iv: string;
  ciphertext: string;
  authTag: string;
  last4: string | null;
  updatedAt: Date;
  updatedBy: string;
}

/** Emplacement logique d'un secret — entre dans la dérivation ET dans l'AAD. */
export interface SecretLocation {
  /** `_id` du document `integrations` porteur. */
  documentId: string;
  provider: string;
  secretName: string;
}

/**
 * Erreur de clé maîtresse indisponible (ADR-0013 §3).
 *
 * Distincte d'un échec de déchiffrement : elle signale un problème
 * d'EXPLOITATION (clé retirée de l'environnement, rotation inachevée), pas une
 * altération de données. Les deux méritent une panne bruyante, mais pas la même
 * procédure de reprise.
 */
export class SecretKeyUnavailableError extends Error {
  readonly code = 'SECRET_KEY_UNAVAILABLE';
  constructor(readonly keyId: string) {
    super(
      `Clé maîtresse « ${keyId} » indisponible : ce secret ne peut pas être déchiffré. ` +
        'Vérifiez SECRETS_MASTER_KEY / SECRETS_MASTER_KEY_PREVIOUS, ou re-saisissez le secret.',
    );
    this.name = 'SecretKeyUnavailableError';
  }
}

/** Échec de vérification du tag d'authentification GCM, ou chiffré malformé. */
export class SecretDecryptionError extends Error {
  readonly code = 'SECRET_DECRYPTION_FAILED';
  constructor(location: SecretLocation, cause?: unknown) {
    super(
      `Déchiffrement refusé pour ${location.provider}.${location.secretName} : ` +
        "tag d'authentification invalide, chiffré altéré ou déplacé.",
    );
    this.name = 'SecretDecryptionError';
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Trousseau de clés maîtresses, indexé par `keyId`.
 *
 * Deux clés au plus (ADR-0013 §3) : la courante et, pendant une rotation, la
 * précédente. Le trousseau est une DONNÉE et non un singleton global : les tests
 * en construisent plusieurs, et la migration `rewrap` en a besoin de deux à la
 * fois.
 */
export class MasterKeyring {
  private constructor(
    private readonly keys: ReadonlyMap<string, Buffer>,
    readonly currentKeyId: string,
  ) {}

  static of(
    entries: ReadonlyArray<{ keyId: string; key: Buffer }>,
    currentKeyId: string,
  ): MasterKeyring {
    const map = new Map<string, Buffer>();
    for (const e of entries) {
      if (e.key.length !== MASTER_KEY_BYTES) {
        throw new Error(
          `Clé maîtresse « ${e.keyId} » invalide : ${e.key.length} octets au lieu de ${MASTER_KEY_BYTES}.`,
        );
      }
      map.set(e.keyId, e.key);
    }
    if (!map.has(currentKeyId)) {
      throw new Error(`Clé courante « ${currentKeyId} » absente du trousseau.`);
    }
    return new MasterKeyring(map, currentKeyId);
  }

  /**
   * Clé maîtresse d'un `keyId`. Lève plutôt que de retourner `undefined` : un
   * appelant qui ignore un `undefined` retomberait sur un repli silencieux, ce
   * que l'ADR interdit explicitement.
   */
  keyFor(keyId: string): Buffer {
    const key = this.keys.get(keyId);
    if (!key) throw new SecretKeyUnavailableError(keyId);
    return key;
  }

  has(keyId: string): boolean {
    return this.keys.has(keyId);
  }

  keyIds(): string[] {
    return [...this.keys.keys()];
  }
}

/** Variables d'environnement lues par `keyringFromEnv` (ADR-0013 §8). */
export interface SecretsEnv {
  SECRETS_MASTER_KEY?: string | undefined;
  SECRETS_MASTER_KEY_ID?: string | undefined;
  SECRETS_MASTER_KEY_PREVIOUS?: string | undefined;
  SECRETS_MASTER_KEY_PREVIOUS_ID?: string | undefined;
}

/** Décodage strict d'une clé base64 de 32 octets — refus explicite sinon. */
export function decodeMasterKey(raw: string, label: string): Buffer {
  const key = Buffer.from(raw, 'base64');
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error(
      `${label} doit être 32 octets encodés en base64 (44 caractères). ` +
        `Longueur décodée : ${key.length} octets. Générer : openssl rand -base64 32`,
    );
  }
  return key;
}

/**
 * Construit le trousseau depuis l'environnement.
 *
 * Retourne `null` si `SECRETS_MASTER_KEY` est absente — l'appelant décide alors
 * s'il refuse de démarrer (production) ou s'il tourne sans coffre (tests
 * unitaires n'y touchant pas). La validation « refus de démarrer » d'ADR-0013
 * § Conséquences vit dans le schéma Zod de `packages/shared/src/env`, appliqué
 * au boot de l'API.
 */
export function keyringFromEnv(env: SecretsEnv): MasterKeyring | null {
  const current = env.SECRETS_MASTER_KEY;
  if (!current) return null;

  const currentId = env.SECRETS_MASTER_KEY_ID ?? 'k1';
  const entries = [{ keyId: currentId, key: decodeMasterKey(current, 'SECRETS_MASTER_KEY') }];

  const previous = env.SECRETS_MASTER_KEY_PREVIOUS;
  const previousId = env.SECRETS_MASTER_KEY_PREVIOUS_ID;
  if (previous) {
    if (!previousId) {
      throw new Error(
        'SECRETS_MASTER_KEY_PREVIOUS est définie sans SECRETS_MASTER_KEY_PREVIOUS_ID. ' +
          'Sans identifiant, la clé précédente est inutilisable : le déchiffrement choisit par `keyId`.',
      );
    }
    if (previousId === currentId) {
      throw new Error(
        `SECRETS_MASTER_KEY_PREVIOUS_ID (« ${previousId} ») est identique à SECRETS_MASTER_KEY_ID. ` +
          'Une rotation qui ne change pas le keyId ne peut pas être suivie : les enregistrements ' +
          "chiffrés avec l'ancienne clé seraient indiscernables de ceux de la nouvelle.",
      );
    }
    entries.push({
      keyId: previousId,
      key: decodeMasterKey(previous, 'SECRETS_MASTER_KEY_PREVIOUS'),
    });
  }

  return MasterKeyring.of(entries, currentId);
}

/**
 * Contexte HKDF — « lier cryptographiquement le chiffré à son emplacement
 * logique » (ADR-0013 §2). Un `ciphertext` déplacé de `smtp.password` vers
 * `stripe.restrictedKey` est dérivé d'une autre clé : il ne se déchiffre pas.
 */
function hkdfInfo(location: SecretLocation): Buffer {
  return Buffer.from(`lalanda:integration:${location.provider}:${location.secretName}`, 'utf8');
}

/**
 * AAD — « elle scelle le chiffré à son document » (ADR-0013 §2). Complémentaire
 * de la dérivation : celle-ci lie au COUPLE (provider, secretName), l'AAD lie en
 * plus au DOCUMENT et au `keyId`. Un chiffré recopié depuis une base de test vers
 * la production échoue à la vérification du tag.
 */
function aadFor(location: SecretLocation, keyId: string): Buffer {
  return Buffer.from(
    `${location.documentId}|${location.provider}|${location.secretName}|${keyId}`,
    'utf8',
  );
}

function deriveDataKey(masterKey: Buffer, salt: Buffer, location: SecretLocation): Buffer {
  return Buffer.from(
    hkdfSync('sha256', masterKey, salt, hkdfInfo(location), DATA_KEY_BYTES) as ArrayBuffer,
  );
}

/**
 * Chiffre une valeur pour un emplacement donné.
 *
 * `salt` et `iv` sont TOUJOURS neufs : cette fonction n'accepte aucun paramètre
 * permettant de les fournir, précisément pour qu'aucun appelant ne puisse
 * réutiliser un IV « pour garder le même ». C'est une contrainte d'API, pas une
 * consigne — voir le piège n°1 en tête de fichier.
 */
export function encryptSecret(input: {
  location: SecretLocation;
  value: string;
  keyring: MasterKeyring;
  updatedBy: string;
  now?: Date;
}): EncryptedValue {
  const keyId = input.keyring.currentKeyId;
  const masterKey = input.keyring.keyFor(keyId);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const dataKey = deriveDataKey(masterKey, salt, input.location);

  const cipher = createCipheriv(SECRET_ALGORITHM, dataKey, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(aadFor(input.location, keyId));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(input.value, 'utf8')),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    alg: SECRET_ALGORITHM,
    keyId,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64'),
    last4: last4Of(input.value),
    updatedAt: input.now ?? new Date(),
    updatedBy: input.updatedBy,
  };
}

/**
 * Déchiffre une valeur. Renvoie un `Secret`, jamais une chaîne nue : le type de
 * retour est la première des trois barrières anti-fuite (ADR-0013 §4).
 *
 * Lève `SecretKeyUnavailableError` si le `keyId` n'est pas au trousseau, et
 * `SecretDecryptionError` si le tag ne vérifie pas. Ne retourne JAMAIS `null` en
 * cas d'échec : « un secret qu'on ne sait plus déchiffrer doit provoquer une
 * panne bruyante, pas une dégradation invisible » (ADR-0013 §3).
 */
export function decryptSecret(input: {
  location: SecretLocation;
  record: EncryptedValue;
  keyring: MasterKeyring;
}): Secret {
  const { record, location, keyring } = input;

  // `alg` est un littéral vérifié (ADR-0013 §1) : un document portant un autre
  // algorithme vient d'ailleurs, ou d'une version future. On refuse au lieu de
  // supposer.
  if (record.alg !== SECRET_ALGORITHM) {
    throw new SecretDecryptionError(location, `algorithme inattendu : ${String(record.alg)}`);
  }

  const masterKey = keyring.keyFor(record.keyId);
  const salt = Buffer.from(record.salt, 'base64');
  const iv = Buffer.from(record.iv, 'base64');
  const authTag = Buffer.from(record.authTag, 'base64');

  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new SecretDecryptionError(location, 'longueurs de salt/iv/authTag non conformes');
  }

  const dataKey = deriveDataKey(masterKey, salt, location);
  try {
    const decipher = createDecipheriv(SECRET_ALGORITHM, dataKey, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(aadFor(location, record.keyId));
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return new Secret(plain.toString('utf8'));
  } catch (err) {
    throw new SecretDecryptionError(location, err);
  }
}

/**
 * Re-chiffre un enregistrement sous la clé COURANTE — étape 2 de la procédure de
 * rotation (ADR-0013 §3).
 *
 * Idempotente au sens de l'ADR : un enregistrement déjà au `keyId` courant est
 * renvoyé tel quel, sans déchiffrement ni écriture. La migration est donc
 * rejouable sans effet, y compris après une interruption en plein vol.
 *
 * Un nouveau `salt`, un nouvel `iv` et une nouvelle AAD sont produits — le
 * `keyId` change, donc l'AAD change nécessairement : ré-utiliser l'ancienne
 * rendrait le chiffré indéchiffrable après retrait de l'ancienne clé.
 */
export function rewrapSecret(input: {
  location: SecretLocation;
  record: EncryptedValue;
  keyring: MasterKeyring;
}): { changed: boolean; record: EncryptedValue } {
  if (input.record.keyId === input.keyring.currentKeyId) {
    return { changed: false, record: input.record };
  }
  const plain = decryptSecret(input);
  const next = encryptSecret({
    location: input.location,
    value: plain.expose(),
    keyring: input.keyring,
    updatedBy: input.record.updatedBy,
    // La rotation n'est pas une modification métier : `updatedAt` reste celui de
    // la dernière saisie humaine, sans quoi l'audit ferait croire que quelqu'un a
    // changé la clé le jour de la rotation.
    now: input.record.updatedAt,
  });
  return { changed: true, record: next };
}

/**
 * Comparaison à temps constant de deux valeurs secrètes.
 *
 * Utilisée pour détecter une re-saisie à l'identique sans stocker d'empreinte
 * (ADR-0013 §1 : « pas d'empreinte, pas de HMAC de vérification »). Le temps
 * constant évite qu'une mesure de latence révèle le préfixe commun.
 */
export function secretsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
