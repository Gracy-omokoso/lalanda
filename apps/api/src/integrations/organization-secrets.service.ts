// ─────────────────────────────────────────────────────────────────────────────
// COFFRE DE PORTÉE ORGANISATION — ADR-0021 §4.2 (chantier A)
//
// Implémentation réelle d'`OrganizationSecretsPort`, fournie sous le jeton
// `ORGANIZATION_SECRETS`. Le module fiscal (chantier B) n'en connaît que le port.
//
// ── Ce que ce service garantit ────────────────────────────────────────────────
//
// 1. LIAISON CRYPTOGRAPHIQUE À L'ORGANISATION. `secrets-crypto.ts` n'est pas
//    modifié : on lui passe un emplacement dont le `provider` est `org:<nature>`
//    et le `secretName` `<organisation>:<propriétaire>:value`. La dérivation HKDF
//    et l'AAD lient donc le chiffré au document, à l'organisation, au point de
//    vente et au `keyId`. Un chiffré recopié vers une autre organisation, un autre
//    point de vente ou un autre document — ou un document dont on réécrit
//    `organizationId` en base — ne se déchiffre plus. Le préfixe `org:` rend toute
//    collision avec un fournisseur plateforme (`openai`, `smtp`…) impossible.
//
// 2. JAMAIS DE SECOURS PAR L'ENVIRONNEMENT. Ce fichier ne lit aucune variable
//    d'environnement : un secret d'organisation n'a pas d'amorçage (logique
//    d'ADR-0017). Coffre absent → `VaultUnavailableError`, à chaque appel.
//
// 3. PAS DE CACHE. Le déchiffrement coûte quelques microsecondes, et une
//    révocation (`destroy`) doit valoir à la requête suivante.
//
// 4. JAMAIS DE VALEUR EN CLAIR NI DE MATÉRIEL CHIFFRÉ EN SORTIE. Les méthodes
//    renvoient une description (`configured`, `last4`, `updatedAt`, `updatedBy`)
//    ou un `Secret` dont toute sérialisation donne `[redacted]`. Aucun journal
//    n'est écrit ici : ni valeur, ni `last4`.
// ─────────────────────────────────────────────────────────────────────────────

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type ClientSession, type Model, Types } from 'mongoose';

import { MASTER_KEYRING } from './keyring.provider.js';
import {
  OrganizationSecret,
  type OrganizationSecretDocument,
} from './organization-secret.schema.js';
import {
  ORGANIZATION_SECRET_KINDS,
  VaultUnavailableError,
  type OrganizationSecretDescription,
  type OrganizationSecretKind,
  type OrganizationSecretRef,
  type OrganizationSecretsPort,
} from './organization-secrets.port.js';
import {
  decryptSecret,
  encryptSecret,
  type EncryptedValue,
  type MasterKeyring,
  type SecretLocation,
} from './secrets-crypto.js';
import type { Secret } from './secret-value.js';

/** Code d'erreur MongoDB d'une violation d'index unique. */
const DUPLICATE_KEY = 11000;

/** Description d'un secret absent. */
const NOT_CONFIGURED: OrganizationSecretDescription = Object.freeze({
  configured: false,
  last4: null,
  updatedAt: null,
  updatedBy: null,
});

/**
 * Emplacement cryptographique d'un secret d'organisation — ADR-0021 §4.2, à la
 * lettre. Exporté pour la rotation (`rewrap.ts`) et les tests : il ne doit exister
 * qu'UNE définition, sans quoi la rotation re-chiffrerait sous un autre emplacement
 * que celui qu'utilise la lecture, et tout deviendrait indéchiffrable.
 */
export function organizationSecretLocation(doc: {
  _id: unknown;
  organizationId: string;
  kind: string;
  ownerId: string;
}): SecretLocation {
  return {
    documentId: String(doc._id),
    provider: `org:${doc.kind}`,
    secretName: `${doc.organizationId}:${doc.ownerId}:value`,
  };
}

/**
 * Copie plate du sous-document chiffré, champ par champ.
 *
 * Lecture explicite plutôt que `toObject()` : la transformation du schéma ampute
 * précisément ce champ (c'est sa raison d'être), et un `lean()` produirait un
 * objet qui, lui, n'a plus aucune barrière s'il finit dans un journal.
 */
export function encryptedValueOf(doc: OrganizationSecretDocument): EncryptedValue {
  const v = doc.value;
  return {
    alg: v.alg as EncryptedValue['alg'],
    keyId: v.keyId,
    salt: v.salt,
    iv: v.iv,
    ciphertext: v.ciphertext,
    authTag: v.authTag,
    last4: v.last4 ?? null,
    updatedAt: v.updatedAt,
    updatedBy: v.updatedBy,
  };
}

function describeDoc(doc: OrganizationSecretDocument | null): OrganizationSecretDescription {
  if (!doc) return { ...NOT_CONFIGURED };
  return {
    configured: true,
    last4: doc.value.last4 ?? null,
    updatedAt: doc.value.updatedAt ?? null,
    updatedBy: doc.value.updatedBy ?? null,
  };
}

/**
 * Validation d'une adresse de secret. Une adresse invalide est une ERREUR DE
 * PROGRAMMATION de l'appelant (le module fiscal fournit des identifiants qu'il a
 * lui-même produits), pas une saisie utilisateur : elle lève une `Error` simple.
 *
 * Le deux-points est refusé dans les identifiants parce qu'il sépare les
 * composantes de `secretName` : sans ce refus, (`a:b`, `c`) et (`a`, `b:c`)
 * produiraient le même nom. Le document les distinguerait encore (l'AAD porte son
 * `_id`), mais une liaison ne doit pas reposer sur une seule de ses composantes.
 */
function assertRef(ref: OrganizationSecretRef): void {
  assertId(ref.organizationId, 'organizationId');
  assertId(ref.ownerId, 'ownerId');
  assertKind(ref.kind);
}

function assertId(value: unknown, label: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    value.includes(':')
  ) {
    throw new Error(`Adresse de secret d'organisation invalide : ${label}.`);
  }
}

function assertKind(kind: unknown): asserts kind is OrganizationSecretKind {
  if (!(ORGANIZATION_SECRET_KINDS as readonly unknown[]).includes(kind)) {
    throw new Error("Nature de secret d'organisation inconnue.");
  }
}

@Injectable()
export class OrganizationSecretsService implements OrganizationSecretsPort {
  constructor(
    @InjectModel(OrganizationSecret.name)
    private readonly model: Model<OrganizationSecretDocument>,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
  ) {}

  /** Le trousseau, ou `VaultUnavailableError` — jamais de repli. */
  private requireKeyring(): MasterKeyring {
    if (!this.keyring) throw new VaultUnavailableError();
    return this.keyring;
  }

  async put(
    ref: OrganizationSecretRef,
    value: string,
    actorUserId: string,
    opts: { session?: ClientSession } = {},
  ): Promise<OrganizationSecretDescription> {
    assertRef(ref);
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error("Valeur de secret d'organisation vide.");
    }
    if (typeof actorUserId !== 'string' || actorUserId.length === 0) {
      throw new Error("Auteur d'écriture de secret d'organisation absent.");
    }
    const keyring = this.requireKeyring();

    // Deux tentatives au plus : la seconde ne sert qu'au cas où une écriture
    // concurrente a créé le document entre notre lecture et notre insertion. Dans
    // une transaction, pas de seconde tentative : MongoDB a déjà annulé la
    // transaction sur l'erreur, et c'est à l'appelant de la rejouer en entier.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.writeOnce(ref, value, actorUserId, keyring, opts.session);
      } catch (err) {
        if (attempt === 0 && !opts.session && isDuplicateKey(err)) continue;
        throw err;
      }
    }
    // Inatteignable : la boucle renvoie ou lève.
    throw new Error("Écriture de secret d'organisation impossible.");
  }

  /**
   * Une écriture. Le `_id` du document entre dans l'AAD : il doit être connu AVANT
   * de chiffrer. On relit donc le document existant (dans la session, pour voir
   * une création non encore validée de la même transaction), ou l'on tire un
   * nouvel identifiant ; puis l'écriture est conditionnée par CET identifiant.
   * Si un autre écrivain a créé le document entre-temps, l'insertion viole
   * l'index unique et `put` recommence sur le document désormais existant —
   * jamais un chiffré scellé à un `_id` qui n'est pas le sien.
   */
  private async writeOnce(
    ref: OrganizationSecretRef,
    value: string,
    actorUserId: string,
    keyring: MasterKeyring,
    session: ClientSession | undefined,
  ): Promise<OrganizationSecretDescription> {
    const filter = { organizationId: ref.organizationId, kind: ref.kind, ownerId: ref.ownerId };
    const existing = await this.model
      .findOne(filter, { _id: 1 })
      .session(session ?? null)
      .exec();
    const _id = existing?._id ?? new Types.ObjectId();

    const encrypted = encryptSecret({
      location: organizationSecretLocation({ _id, ...filter }),
      value,
      keyring,
      updatedBy: actorUserId,
    });

    await this.model
      .updateOne(
        { _id, ...filter },
        { $set: { value: encrypted }, $setOnInsert: { _schemaVersion: 1 } },
        session ? { upsert: true, session } : { upsert: true },
      )
      .exec();

    return {
      configured: true,
      last4: encrypted.last4,
      updatedAt: encrypted.updatedAt,
      updatedBy: encrypted.updatedBy,
    };
  }

  async resolve(ref: OrganizationSecretRef): Promise<Secret | null> {
    assertRef(ref);
    // Coffre vérifié AVANT toute lecture : sans clé maîtresse, la réponse est la
    // même que le secret existe ou non — rien ne laisse deviner l'état du coffre.
    const keyring = this.requireKeyring();
    const doc = await this.model
      .findOne({ organizationId: ref.organizationId, kind: ref.kind, ownerId: ref.ownerId })
      .exec();
    if (!doc) return null;
    // Les composantes de l'emplacement viennent du DOCUMENT tel qu'il est en base,
    // et c'est voulu : un document dont on a réécrit `organizationId` est trouvé par
    // la nouvelle organisation, mais son chiffré reste scellé à l'ancienne — le tag
    // ne vérifie pas, `SecretDecryptionError` remonte (panne bruyante, ADR-0013 §3).
    return decryptSecret({
      location: organizationSecretLocation(doc),
      record: encryptedValueOf(doc),
      keyring,
    });
  }

  async describe(ref: OrganizationSecretRef): Promise<OrganizationSecretDescription> {
    assertRef(ref);
    const doc = await this.model
      .findOne({ organizationId: ref.organizationId, kind: ref.kind, ownerId: ref.ownerId })
      .exec();
    return describeDoc(doc);
  }

  async describeMany(
    organizationId: string,
    kind: OrganizationSecretKind,
    ownerIds: readonly string[],
  ): Promise<Map<string, OrganizationSecretDescription>> {
    assertId(organizationId, 'organizationId');
    assertKind(kind);
    for (const id of ownerIds) assertId(id, 'ownerId');

    const out = new Map<string, OrganizationSecretDescription>();
    for (const id of ownerIds) out.set(id, { ...NOT_CONFIGURED });
    if (ownerIds.length === 0) return out;

    const docs = await this.model
      .find({ organizationId, kind, ownerId: { $in: [...new Set(ownerIds)] } })
      .exec();
    for (const doc of docs) out.set(doc.ownerId, describeDoc(doc));
    return out;
  }

  async destroy(ref: OrganizationSecretRef, opts: { session?: ClientSession } = {}): Promise<void> {
    assertRef(ref);
    // Pas d'exigence de coffre : détruire un chiffré ne demande pas de le lire, et
    // un retrait de point de vente doit rester possible même clé maîtresse absente.
    await this.model
      .deleteOne(
        { organizationId: ref.organizationId, kind: ref.kind, ownerId: ref.ownerId },
        opts.session ? { session: opts.session } : {},
      )
      .exec();
  }
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === DUPLICATE_KEY
  );
}
