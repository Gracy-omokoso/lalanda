// ─────────────────────────────────────────────────────────────────────────────
// CYCLE DE VIE DU SECOND FACTEUR — enrôlement, activation, vérification,
// codes de secours, désactivation.
//
// ── Ce que ce service refuse de faire ─────────────────────────────────────────
//
// Il n'expose AUCUNE route ni méthode qui rendrait un secret TOTP en clair après
// l'enrôlement. Le secret sort une seule fois, dans la réponse de `enroll()`, au
// moment où il faut bien le transmettre à l'application d'authentification. Il
// n'existe pas de « réafficher mon QR code » : quelqu'un qui a perdu son
// téléphone utilise un code de secours, puis réenrôle. Ajouter cette commodité
// transformerait toute session volée en copie du facteur.
//
// De même, les codes de secours ne sont montrés qu'à leur génération. Le
// document ne porte que des empreintes : les réafficher est techniquement
// impossible, ce qui est exactement le niveau de garantie voulu — la propriété
// ne dépend d'aucun contrôle qu'on pourrait oublier d'écrire.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import qrcode from 'qrcode-generator';

import { getAuth } from '../auth/auth.js';
import { sessionFingerprint } from '../auth/session-fingerprint.js';
import { MASTER_KEYRING } from '../integrations/keyring.provider.js';
import {
  decryptSecret,
  encryptSecret,
  type EncryptedValue,
  type MasterKeyring,
  type SecretLocation,
} from '../integrations/secrets-crypto.js';
import {
  BACKUP_CODE_COUNT,
  findBackupCodeIndex,
  formatBackupCode,
  generateBackupCodeSet,
} from './backup-codes.js';
import {
  MFA_LOCK_MS,
  MFA_MAX_FAILED_ATTEMPTS,
  MfaCredential,
  type MfaCredentialDocument,
  type MfaStatusView,
} from './mfa-credential.schema.js';
import {
  MFA_VERIFICATION_TTL_MS,
  MfaVerification,
  type MfaVerificationDocument,
} from './mfa-verification.schema.js';
import { buildOtpAuthUri, generateTotpSecret, verifyTotp } from './totp.js';

/** Nom affiché dans l'application d'authentification. */
export const MFA_ISSUER = 'Lalanda';

/**
 * Emplacement logique du secret TOTP dans le schéma cryptographique d'ADR-0013.
 *
 * La primitive `encryptSecret` est réutilisée TELLE QUELLE — c'est la consigne
 * du chantier, et c'est la bonne : réécrire AES-256-GCM pour un second usage
 * doublerait la surface où l'on peut réutiliser un IV (piège n°1 d'ADR-0013 §2).
 *
 * `provider: 'mfa'` n'est pas un fournisseur d'intégration, et c'est assumé :
 * `SecretLocation` décrit un EMPLACEMENT, pas une taxonomie de fournisseurs. La
 * conséquence utile est mécanique — la dérivation HKDF et l'AAD portent la
 * chaîne `mfa`, donc un chiffré déplacé depuis `integrations` (ou l'inverse) ne
 * se déchiffre pas, et un chiffré déplacé d'un utilisateur à un autre non plus,
 * puisque `documentId` est l'identifiant du document MFA.
 */
function locationFor(documentId: string): SecretLocation {
  return { documentId, provider: 'mfa', secretName: 'totp' };
}

/** Résultat d'un enrôlement — les seules données secrètes que l'API émette. */
export interface MfaEnrollmentView {
  /** Secret en base32, pour la saisie manuelle quand la caméra ne lit pas le QR. */
  secret: string;
  /** URI `otpauth://` — le contenu du QR code. */
  otpauthUri: string;
  /** QR code SVG, en data-URI, prêt pour un `<img src>`. */
  qrCodeSvg: string;
}

@Injectable()
export class MfaService {
  constructor(
    @InjectModel(MfaCredential.name)
    private readonly credentials: Model<MfaCredentialDocument>,
    @InjectModel(MfaVerification.name)
    private readonly verifications: Model<MfaVerificationDocument>,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Lecture
  // ───────────────────────────────────────────────────────────────────────────

  async statusOf(userId: string): Promise<MfaStatusView> {
    const doc = await this.credentials.findOne({ userId }).lean().exec();
    if (!doc) {
      return {
        enabled: false,
        pending: false,
        backupCodesRemaining: 0,
        activatedAt: null,
        lockedUntil: null,
      };
    }
    const locked = doc.lockedUntil && doc.lockedUntil > new Date() ? doc.lockedUntil : null;
    return {
      enabled: doc.status === 'active',
      pending: doc.status === 'pending',
      backupCodesRemaining: doc.backupCodes.filter((c) => c.usedAt === null).length,
      activatedAt: doc.activatedAt ? new Date(doc.activatedAt).toISOString() : null,
      lockedUntil: locked ? new Date(locked).toISOString() : null,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Enrôlement
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Produit un secret et le range chiffré à l'état `pending`.
   *
   * ── Pourquoi un réenrôlement écrase le précédent ────────────────────────────
   *
   * Quelqu'un qui relance l'enrôlement a, dans la quasi-totalité des cas, raté le
   * scan ou changé de téléphone. Conserver l'ancien secret « au cas où »
   * laisserait deux facteurs valides dont un que l'utilisateur croit remplacé —
   * c'est-à-dire un facteur fantôme sur un ancien appareil peut-être perdu.
   *
   * ── Ce que le réenrôlement d'un facteur DÉJÀ ACTIF ne fait pas ──────────────
   *
   * Il ne désactive rien tant que le nouveau code n'est pas confirmé : le
   * document repasse à `pending`, mais les VÉRIFICATIONS de session en cours
   * restent valides. Sinon, un opérateur qui ouvre la page d'enrôlement par
   * curiosité se ferait éjecter de `/admin` séance tenante.
   */
  async enroll(input: {
    userId: string;
    accountName: string;
    headers: Headers;
    currentPassword: string;
  }): Promise<MfaEnrollmentView> {
    const keyring = this.requireKeyring();
    await this.assertPassword(input.headers, input.currentPassword);

    const secret = generateTotpSecret();

    // L'`_id` entre dans la dérivation HKDF et dans l'AAD : il doit exister
    // AVANT le chiffrement. On réserve donc le document en deux temps, ce qui
    // est aussi ce qui rend un chiffré non transposable d'un utilisateur à un
    // autre. Le `secret` provisoire n'est jamais lu : il est remplacé plus bas
    // dans la même méthode, et le document reste `pending` entre-temps.
    const reserved = await this.credentials
      .findOneAndUpdate(
        { userId: input.userId },
        {
          $set: {
            status: 'pending',
            backupCodes: [],
            backupSalt: null,
            lastUsedStep: null,
            failedAttempts: 0,
            lockedUntil: null,
            activatedAt: null,
          },
          $setOnInsert: { userId: input.userId, _schemaVersion: 1 },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, projection: { _id: 1 } },
      )
      .exec();

    const documentId = String(reserved._id);
    const encrypted = encryptSecret({
      location: locationFor(documentId),
      value: secret,
      keyring,
      updatedBy: input.userId,
    });

    await this.credentials
      .updateOne({ _id: reserved._id }, { $set: { secret: stripLast4(encrypted) } })
      .exec();

    const otpauthUri = buildOtpAuthUri({
      secretBase32: secret,
      accountName: input.accountName,
      issuer: MFA_ISSUER,
    });

    return { secret, otpauthUri, qrCodeSvg: renderQrDataUri(otpauthUri) };
  }

  /**
   * Confirme l'enrôlement par un premier code, et remet les codes de secours.
   *
   * Les codes de secours sont produits ICI et non à `enroll()` : un enrôlement
   * abandonné ne doit pas laisser derrière lui dix codes valides que personne n'a
   * jamais vus, et que rien ne relie à un facteur existant.
   */
  async activate(input: {
    userId: string;
    code: string;
  }): Promise<{ backupCodes: string[]; status: MfaStatusView }> {
    const doc = await this.credentials.findOne({ userId: input.userId }).exec();
    if (!doc) {
      throw new BadRequestException({
        code: 'MFA_NOT_ENROLLING',
        message: 'Aucun enrôlement en cours. Recommencez depuis Compte › Sécurité.',
      });
    }
    this.assertNotLocked(doc);

    const secret = this.decryptFor(doc);
    const result = verifyTotp(secret, input.code);
    if (!result.valid) {
      await this.recordFailure(doc);
      throw new UnauthorizedException({
        code: 'MFA_INVALID_CODE',
        message: 'Code invalide ou expiré. Vérifiez l’heure de votre téléphone.',
      });
    }

    const set = generateBackupCodeSet(BACKUP_CODE_COUNT);
    await this.credentials
      .updateOne(
        { _id: doc._id },
        {
          $set: {
            status: 'active',
            activatedAt: new Date(),
            // Le pas du code d'activation est consommé immédiatement : sans
            // cela, le tout premier code servirait une seconde fois pour ouvrir
            // une session plateforme, dans les 90 secondes qui suivent.
            lastUsedStep: result.step,
            failedAttempts: 0,
            lockedUntil: null,
            backupSalt: set.salt,
            backupCodes: set.hashes.map((hash) => ({ hash, usedAt: null })),
          },
        },
      )
      .exec();

    return {
      backupCodes: set.plain.map(formatBackupCode),
      status: await this.statusOf(input.userId),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Vérification
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Présente le second facteur pour la session courante et ouvre la fenêtre.
   *
   * Accepte un code TOTP ou un code de secours : la distinction est faite sur la
   * FORME (six chiffres = TOTP), pas sur un paramètre du client. Laisser
   * l'appelant déclarer « ceci est un code de secours » lui permettrait de
   * choisir quel compteur d'échecs il alimente.
   */
  async verify(input: {
    userId: string;
    code: string;
    cookieHeader: string | undefined;
  }): Promise<{ expiresAt: Date; method: 'totp' | 'backup_code' }> {
    const fingerprint = sessionFingerprint(input.cookieHeader);
    if (!fingerprint) {
      throw new UnauthorizedException({ code: 'NOT_AUTHENTICATED' });
    }

    const doc = await this.credentials.findOne({ userId: input.userId, status: 'active' }).exec();
    if (!doc) {
      throw new BadRequestException({
        code: 'MFA_NOT_ENABLED',
        message: 'Aucune authentification à deux facteurs active sur ce compte.',
      });
    }
    this.assertNotLocked(doc);

    const method = await this.consumeFactor(doc, input.code);
    if (!method) {
      await this.recordFailure(doc);
      throw new UnauthorizedException({
        code: 'MFA_INVALID_CODE',
        message: 'Code invalide, expiré ou déjà utilisé.',
      });
    }

    await this.credentials
      .updateOne({ _id: doc._id }, { $set: { failedAttempts: 0, lockedUntil: null } })
      .exec();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + MFA_VERIFICATION_TTL_MS);
    await this.verifications
      .findOneAndUpdate(
        { userId: input.userId, sessionFingerprint: fingerprint },
        {
          $set: { method, verifiedAt: now, expiresAt },
          $setOnInsert: { _schemaVersion: 1 },
        },
        { upsert: true, new: true },
      )
      .exec();

    return { expiresAt, method };
  }

  /**
   * Consomme un facteur — TOTP (avec anti-rejeu) ou code de secours (à usage
   * unique). Renvoie la méthode employée, ou `null` si rien ne correspond.
   *
   * ── Anti-rejeu TOTP ─────────────────────────────────────────────────────────
   *
   * `lastUsedStep` est le pas du dernier code accepté. Tout pas INFÉRIEUR OU ÉGAL
   * est refusé. Sans cela, un code reste valide 90 secondes et fonctionne autant
   * de fois qu'on le présente : capté dans un journal de proxy, lu par-dessus
   * l'épaule ou hameçonné en temps réel, il ouvrirait une seconde session. La
   * garantie « à usage unique » du sigle OTP n'existe pas dans l'algorithme —
   * elle est entièrement à la charge du vérificateur.
   *
   * ── Anti-rejeu des codes de secours ─────────────────────────────────────────
   *
   * La consommation est faite par un `updateOne` FILTRÉ sur `usedAt: null` à la
   * position trouvée, et l'on vérifie `modifiedCount`. Un `findOne` puis un
   * `save()` laisserait deux requêtes concurrentes consommer le même code : le
   * cas n'est pas théorique, un double-clic suffit.
   */
  private async consumeFactor(
    doc: MfaCredentialDocument,
    code: string,
  ): Promise<'totp' | 'backup_code' | null> {
    const cleaned = code.replace(/[\s-]/g, '');

    if (/^\d{6}$/.test(cleaned)) {
      const result = verifyTotp(this.decryptFor(doc), cleaned);
      if (!result.valid) return null;
      if (doc.lastUsedStep !== null && result.step! <= doc.lastUsedStep) return null;

      // Le filtre `lastUsedStep` reprend la valeur lue : deux requêtes
      // concurrentes portant le même code ne peuvent pas réussir toutes les deux,
      // la seconde ne trouvant plus le document dans l'état attendu.
      const res = await this.credentials
        .updateOne(
          { _id: doc._id, lastUsedStep: doc.lastUsedStep },
          { $set: { lastUsedStep: result.step } },
        )
        .exec();
      return res.modifiedCount === 1 ? 'totp' : null;
    }

    if (!doc.backupSalt) return null;
    const index = findBackupCodeIndex(
      cleaned,
      doc.backupSalt,
      doc.backupCodes.map((c) => c.hash),
    );
    if (index === -1) return null;
    if (doc.backupCodes[index]!.usedAt !== null) return null;

    const res = await this.credentials
      .updateOne(
        { _id: doc._id, [`backupCodes.${index}.usedAt`]: null },
        { $set: { [`backupCodes.${index}.usedAt`]: new Date() } },
      )
      .exec();
    return res.modifiedCount === 1 ? 'backup_code' : null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Codes de secours et désactivation
  // ───────────────────────────────────────────────────────────────────────────

  /** Remplace le jeu complet. Les anciens codes deviennent inutilisables. */
  async regenerateBackupCodes(input: {
    userId: string;
    headers: Headers;
    currentPassword: string;
  }): Promise<{ backupCodes: string[] }> {
    await this.assertPassword(input.headers, input.currentPassword);
    const doc = await this.credentials.findOne({ userId: input.userId, status: 'active' }).exec();
    if (!doc) {
      throw new BadRequestException({
        code: 'MFA_NOT_ENABLED',
        message: 'Aucune authentification à deux facteurs active sur ce compte.',
      });
    }
    const set = generateBackupCodeSet(BACKUP_CODE_COUNT);
    await this.credentials
      .updateOne(
        { _id: doc._id },
        {
          $set: {
            backupSalt: set.salt,
            backupCodes: set.hashes.map((hash) => ({ hash, usedAt: null })),
          },
        },
      )
      .exec();
    return { backupCodes: set.plain.map(formatBackupCode) };
  }

  /**
   * Désactive le facteur : mot de passe ET code exigés (voir `mfa.dto.ts`).
   *
   * Les preuves de session sont supprimées EN MÊME TEMPS. Sans cela, une preuve
   * survivrait au facteur qu'elle atteste, et une session déjà ouverte
   * conserverait un accès plateforme que plus rien ne justifie. `MfaGateService`
   * refuserait de toute façon (il vérifie le facteur avant la preuve), mais un
   * état incohérent laissé en base finit toujours par être lu par quelqu'un.
   */
  async disable(input: {
    userId: string;
    headers: Headers;
    currentPassword: string;
    code: string;
  }): Promise<void> {
    await this.assertPassword(input.headers, input.currentPassword);
    const doc = await this.credentials.findOne({ userId: input.userId, status: 'active' }).exec();
    if (!doc) {
      throw new BadRequestException({
        code: 'MFA_NOT_ENABLED',
        message: 'Aucune authentification à deux facteurs active sur ce compte.',
      });
    }
    this.assertNotLocked(doc);

    const method = await this.consumeFactor(doc, input.code);
    if (!method) {
      await this.recordFailure(doc);
      throw new UnauthorizedException({
        code: 'MFA_INVALID_CODE',
        message: 'Code invalide, expiré ou déjà utilisé.',
      });
    }

    await this.credentials.deleteOne({ _id: doc._id }).exec();
    await this.verifications.deleteMany({ userId: input.userId }).exec();
  }

  /** Supprime toute trace de MFA d'un compte — appelé à la suppression de compte. */
  async purgeForUser(userId: string): Promise<void> {
    await this.credentials.deleteMany({ userId }).exec();
    await this.verifications.deleteMany({ userId }).exec();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Fondations
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Trousseau, ou `503`.
   *
   * Même refus que le coffre d'intégrations (`VAULT_UNAVAILABLE`, ADR-0013) :
   * sans clé maîtresse on ne sait pas protéger ce qu'on écrirait, et écrire
   * quand même serait pire que refuser. Conséquence à assumer et à connaître :
   * une API démarrée sans `SECRETS_MASTER_KEY` ne permet aucun enrôlement, donc
   * FERME `/admin` à tout le monde. C'est le sens correct de la panne — un
   * repli qui ouvrirait `/admin` en l'absence de coffre transformerait une
   * variable oubliée en désactivation silencieuse du MFA.
   */
  private requireKeyring(): MasterKeyring {
    if (!this.keyring) {
      throw new ServiceUnavailableException({
        code: 'VAULT_UNAVAILABLE',
        message:
          'SECRETS_MASTER_KEY absente : le secret d’authentification ne peut pas être ' +
          'chiffré, l’enrôlement est refusé.',
      });
    }
    return this.keyring;
  }

  private decryptFor(doc: MfaCredentialDocument): string {
    return decryptSecret({
      location: locationFor(String(doc._id)),
      record: doc.secret as unknown as EncryptedValue,
      keyring: this.requireKeyring(),
    }).expose();
  }

  /**
   * Vérifie le mot de passe courant via better-auth.
   *
   * Même délégation que `ReauthService` et `account/email-change.service.ts` :
   * better-auth « seul connaît l'algorithme et le sel utilisés pour la collection
   * `account` ». Réimplémenter la comparaison, c'est dupliquer puis désynchroniser
   * la politique de hachage.
   */
  private async assertPassword(headers: Headers, password: string): Promise<void> {
    let ok = false;
    try {
      const res = (await getAuth().api.verifyPassword({ body: { password }, headers })) as {
        status?: boolean;
      } | null;
      ok = res?.status === true;
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new UnauthorizedException({
        code: 'INVALID_PASSWORD',
        message: 'Mot de passe incorrect.',
      });
    }
  }

  /** Refus explicite pendant un verrouillage, avec la date de fin. */
  private assertNotLocked(doc: MfaCredentialDocument): void {
    if (doc.lockedUntil && doc.lockedUntil > new Date()) {
      throw new UnauthorizedException({
        code: 'MFA_LOCKED',
        message:
          'Trop de codes incorrects. Réessayez après ' +
          new Date(doc.lockedUntil).toISOString() +
          '.',
        lockedUntil: new Date(doc.lockedUntil).toISOString(),
      });
    }
  }

  /**
   * Compte un échec et verrouille au seuil.
   *
   * ── Pourquoi ce compteur EN PLUS du quota de requêtes ───────────────────────
   *
   * `UserThrottlerGuard` borne le nombre de REQUÊTES par utilisateur et par
   * fenêtre ; ce compteur borne les ÉCHECS CONSÉCUTIFS et se remet à zéro sur un
   * succès. Les deux ne mesurent pas la même chose : un opérateur qui se trompe
   * deux fois puis réussit ne doit rien subir, alors qu'un attaquant qui échoue
   * cinq fois de suite doit être arrêté même s'il est resté sous le quota. Et
   * surtout, le compteur d'échecs est porté par le COMPTE : il survit au
   * changement d'IP, au changement de session et à l'attaque distribuée, là où un
   * seau par IP ou par process ne survit à aucun des trois.
   *
   * L'incrément est un `$inc` atomique : deux requêtes concurrentes comptent deux
   * échecs, jamais un seul.
   */
  private async recordFailure(doc: MfaCredentialDocument): Promise<void> {
    const updated = await this.credentials
      .findOneAndUpdate({ _id: doc._id }, { $inc: { failedAttempts: 1 } }, { new: true })
      .exec();
    if (updated && updated.failedAttempts >= MFA_MAX_FAILED_ATTEMPTS) {
      await this.credentials
        .updateOne(
          { _id: doc._id },
          { $set: { lockedUntil: new Date(Date.now() + MFA_LOCK_MS), failedAttempts: 0 } },
        )
        .exec();
    }
  }
}

/**
 * `last4` forcé à `null`.
 *
 * `encryptSecret` calcule les quatre derniers caractères de la valeur — utile
 * pour une clé d'API, dont l'opérateur doit pouvoir vérifier laquelle est en
 * place (ADR-0013 §4). Pour un secret TOTP, c'est un cadeau de 20 bits à qui lit
 * la base, sans aucune contrepartie : personne n'a jamais besoin d'identifier
 * « quel secret TOTP » est en place, il n'y en a qu'un par compte.
 */
function stripLast4(value: EncryptedValue): EncryptedValue {
  return { ...value, last4: null };
}

/**
 * QR code SVG en data-URI.
 *
 * ── La seule dépendance ajoutée par ce chantier ───────────────────────────────
 *
 * `qrcode-generator` : MIT, ZÉRO dépendance transitive (donc rien de nouveau à
 * surveiller dans `scripts/audit-dependencies.mjs` au-delà d'elle-même), ESM et
 * déclarations TypeScript fournies. Encoder un QR code à la main demanderait
 * Reed-Solomon, le masquage et l'information de format — quatre cents lignes
 * dont une erreur ne se manifesterait que par un QR illisible sur CERTAINS
 * téléphones, c'est-à-dire par un défaut non reproductible au cœur d'une
 * fonctionnalité de sécurité. TOTP est écrit à la main parce que la RFC en
 * publie les vecteurs de test ; ce n'est pas le cas ici.
 *
 * ── Pourquoi le rendu est fait côté SERVEUR ───────────────────────────────────
 *
 * Le web n'embarque aucune bibliothèque de rendu et son `packages/ui` est un
 * squelette vide : y ajouter la dépendance la mettrait dans le bundle de toutes
 * les pages pour un écran vu une fois par opérateur. Le SVG voyage dans la même
 * réponse que le secret qu'il encode — il n'ajoute donc aucune exposition.
 *
 * `typeNumber: 0` laisse la bibliothèque choisir la plus petite version capable
 * de porter l'URI ; correction d'erreur `M` (~15 %), le compromis usuel entre
 * densité et tolérance à un écran sale.
 */
function renderQrDataUri(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  // base64 plutôt qu'un percent-encodage : le SVG contient des guillemets et des
  // `#`, qui cassent un data-URI non encodé placé dans un attribut HTML.
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
