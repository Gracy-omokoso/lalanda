import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { randomBytes } from 'node:crypto';

import { getAuth } from '../auth/auth.js';
import { emailChangeVerificationUrl } from '../mail/mail.links.js';
import { MailService } from '../mail/mail.service.js';
import { EmailChangeRequest, type EmailChangeRequestDocument } from './email-change.schema.js';

/** Durée de validité d'un lien de vérification. Assez long pour un email lu le lendemain,
 *  assez court pour limiter la fenêtre d'exploitation d'un lien intercepté. */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Changement d'adresse email vérifié (S20b, livraison réelle en S22a).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * L'EMAIL EST MAINTENANT ENVOYÉ — QUAND UN SMTP EXISTE.
 *
 * Jusqu'à S22a, le flux était complet côté serveur mais l'email n'était envoyé
 * nulle part : `notifiedAt` restait `null` et l'utilisateur ne pouvait pas
 * terminer un changement d'adresse par lui-même. S22a branche `MailService`.
 *
 * Ce qui N'A PAS changé, et ne doit pas changer : `notifiedAt` n'est renseigné
 * que si l'envoi a RÉELLEMENT abouti. Sans SMTP configuré, le transport se replie
 * sur un log serveur et renvoie `delivered: false` — le champ reste `null` et
 * l'API continue d'annoncer `verificationDelivered: false`. Marquer l'envoi comme
 * fait dès qu'on a « appelé la fonction d'envoi » reviendrait à afficher
 * « vérifiez votre boîte » à quelqu'un qui ne recevra jamais rien.
 *
 * Ce qui n'a pas changé non plus : l'adresse ne bouge qu'à la présentation du
 * token. Appliquer le changement sans vérification ouvrirait un chemin de prise
 * de compte (docs/17 § Menaces prioritaires).
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);

  constructor(
    @InjectModel(EmailChangeRequest.name)
    private readonly model: Model<EmailChangeRequestDocument>,
    @InjectConnection() private readonly connection: Connection,
    // Jeton explicite : esbuild (vitest) n'émet pas `design:paramtypes`, une
    // injection par type y serait silencieusement `undefined` (voir mail/).
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  /** Demande en attente et non expirée, ou `null`. */
  async findPending(userId: string): Promise<EmailChangeRequestDocument | null> {
    const pending = await this.model.findOne({ userId, verifiedAt: null, canceledAt: null }).exec();
    if (!pending) return null;
    if (pending.expiresAt.getTime() <= Date.now()) return null;
    return pending;
  }

  /**
   * Ouvre une demande de changement. N'ÉCRIT RIEN sur `user.email` :
   * l'adresse ne bouge qu'à la vérification du token.
   */
  async request(
    userId: string,
    currentEmail: string,
    newEmail: string,
    headers: Headers,
    userName?: string | null,
  ): Promise<EmailChangeRequestDocument> {
    if (newEmail === currentEmail.toLowerCase()) {
      throw new BadRequestException({
        code: 'EMAIL_UNCHANGED',
        message: 'Cette adresse est déjà celle de votre compte.',
      });
    }

    await this.assertEmailAvailable(newEmail);

    // Une demande en cours est remplacée : l'utilisateur qui se trompe d'adresse
    // doit pouvoir recommencer sans attendre l'expiration de 24 h.
    await this.model
      .updateMany(
        { userId, verifiedAt: null, canceledAt: null },
        { $set: { canceledAt: new Date() } },
      )
      .exec();

    const created = await this.model.create({
      userId,
      currentEmail: currentEmail.toLowerCase(),
      newEmail,
      // Même convention que les invitations (S5d) : 32 octets → 64 chars hex.
      token: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      verifiedAt: null,
      canceledAt: null,
      // Renseigné juste après, et SEULEMENT si l'envoi aboutit (cf. en-tête de classe).
      notifiedAt: null,
      _schemaVersion: 1,
    });

    // L'email part vers la NOUVELLE adresse : c'est elle dont on veut la preuve
    // de contrôle. L'envoyer à l'ancienne prouverait l'inverse de ce qu'on cherche.
    const delivery = await this.mail.sendEmailVerification({
      to: created.newEmail,
      url: emailChangeVerificationUrl(created.token),
      name: userName ?? null,
      isEmailChange: true,
      expiresInHours: TOKEN_TTL_MS / 3_600_000,
    });

    if (delivery.delivered) {
      created.notifiedAt = new Date();
      await created.save();
    } else {
      // Trace d'exploitation SANS le token : docs/17 § Journalisation interdit
      // qu'un secret apparaisse dans les logs. On journalise le fait, pas le moyen.
      this.logger.warn(
        `Changement d'email demandé pour l'utilisateur ${userId} : email de vérification NON DÉLIVRÉ ` +
          `(${delivery.reason ?? 'raison inconnue'}). La demande expire le ${created.expiresAt.toISOString()}.`,
      );
    }

    void headers; // réservé : l'envoi réel utilisera la locale de la requête.
    return created;
  }

  /**
   * Applique un changement à partir du token reçu par la NOUVELLE adresse.
   *
   * La disponibilité de l'adresse est revérifiée ici : entre la demande et la
   * vérification, quelqu'un d'autre a pu prendre cette adresse. Se fier au
   * contrôle fait à la demande créerait deux comptes de même email.
   */
  async verify(token: string): Promise<{ userId: string; newEmail: string }> {
    const req = await this.model.findOne({ token }).exec();

    // Message uniforme : ne révèle pas si un token a existé, expiré ou été utilisé.
    const invalid = new BadRequestException({
      code: 'INVALID_TOKEN',
      message: 'Ce lien de vérification est invalide, expiré ou déjà utilisé.',
    });
    if (!req || req.verifiedAt || req.canceledAt) throw invalid;
    if (req.expiresAt.getTime() <= Date.now()) throw invalid;

    await this.assertEmailAvailable(req.newEmail);

    const db = this.connection.db;
    if (!db) throw new Error('Connexion Mongo indisponible — changement d’email interrompu.');

    const { ObjectId } = await import('mongodb');
    if (!ObjectId.isValid(req.userId)) throw invalid;

    // `emailVerified: true` : le porteur du token vient précisément de prouver
    // qu'il contrôle cette boîte — c'est la définition de la vérification.
    await db
      .collection('user')
      .updateOne(
        { _id: new ObjectId(req.userId) },
        { $set: { email: req.newEmail, emailVerified: true, updatedAt: new Date() } },
      );

    req.verifiedAt = new Date();
    await req.save();

    return { userId: req.userId, newEmail: req.newEmail };
  }

  /** Annule la demande en cours. Idempotent : aucune demande = rien à faire. */
  async cancel(userId: string): Promise<{ canceled: boolean }> {
    const res = await this.model
      .updateMany(
        { userId, verifiedAt: null, canceledAt: null },
        { $set: { canceledAt: new Date() } },
      )
      .exec();
    return { canceled: res.modifiedCount > 0 };
  }

  /**
   * Vérifie le mot de passe courant du porteur de la session.
   *
   * Délégué à better-auth : lui seul connaît l'algorithme et le sel utilisés pour
   * la collection `account`. Réimplémenter la comparaison ici signifierait
   * dupliquer — et à terme désynchroniser — la politique de hachage.
   */
  async assertPassword(headers: Headers, password: string): Promise<void> {
    const auth = getAuth();
    try {
      const res = (await auth.api.verifyPassword({
        body: { password },
        headers,
      })) as { status?: boolean } | null;
      if (res?.status === true) return;
    } catch {
      // better-auth lève sur mot de passe invalide — traité comme un refus.
    }
    throw new BadRequestException({
      code: 'INVALID_PASSWORD',
      message: 'Mot de passe incorrect.',
    });
  }

  /**
   * Refuse une adresse déjà portée par un autre compte.
   *
   * ATTENTION — la collection `user` de better-auth n'a AUCUN index unique sur
   * `email` (constaté en base : seul `_id_` existe). Ce contrôle est donc
   * applicatif et laisse une fenêtre de concurrence théorique entre la lecture et
   * l'écriture. Poser un index unique sur une collection appartenant à
   * better-auth dépasse le périmètre de ce lot et demande une migration des
   * doublons éventuels : à traiter par un ADR dédié.
   */
  private async assertEmailAvailable(email: string): Promise<void> {
    const db = this.connection.db;
    if (!db) throw new Error('Connexion Mongo indisponible — contrôle d’unicité impossible.');
    const taken = await db.collection('user').findOne({ email }, { projection: { _id: 1 } });
    if (taken) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'Cette adresse est déjà utilisée par un autre compte.',
      });
    }
  }
}
