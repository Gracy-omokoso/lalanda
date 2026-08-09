// Ce que le produit sait envoyer (S22a).
//
// `MailService` est l'INTERFACE que consomment `auth/`, `account/` et
// `organizations/`. Elle est délibérément exprimée en intentions métier
// (« envoie une invitation ») et non en primitives de transport (« envoie ce
// HTML ») : un appelant ne doit jamais composer un sujet ni un corps. Sans cette
// frontière, le libellé d'un email finit dupliqué dans trois contrôleurs et
// diverge à la première correction de formulation.
//
// REMPLAÇABILITÉ. La classe est abstraite et injectée par son type ; le module
// racine décide de l'implémentation :
//
//   { provide: MailService, useClass: TemplatedMailService }   // aujourd'hui
//   { provide: MailService, useClass: QueuedMailService }      // demain (BullMQ)
//
// Les tests substituent une implémentation en mémoire — aucun envoi réseau n'a
// lieu dans la suite, jamais (docs/18-TESTS).

import { Injectable } from '@nestjs/common';

import {
  renderEmailVerification,
  renderInvitation,
  renderPasswordReset,
} from './mail.templates.js';
import { MailTransport } from './mail.transport.js';
import type { MailDeliveryResult } from './mail.types.js';

/** Vérification d'une adresse — inscription ou changement d'adresse. */
export interface EmailVerificationMail {
  to: string;
  /** URL complète de confirmation. Construite par l'appelant, qui seul sait d'où vient le jeton. */
  url: string;
  name?: string | null | undefined;
  /** Vrai pour un changement d'adresse (le texte diffère), faux à l'inscription. */
  isEmailChange?: boolean | undefined;
  expiresInHours: number;
}

/** Invitation à rejoindre une organisation. */
export interface InvitationMail {
  to: string;
  url: string;
  organizationName: string;
  roleLabel: string;
  inviterName?: string | null | undefined;
  expiresAt: Date;
}

/** Réinitialisation de mot de passe. */
export interface PasswordResetMail {
  to: string;
  url: string;
  name?: string | null | undefined;
  expiresInMinutes: number;
}

/**
 * Contrat d'envoi du produit. Voir l'en-tête de fichier.
 *
 * Aucune méthode ne LÈVE sur échec d'envoi : toutes retournent un
 * `MailDeliveryResult`. Une invitation créée reste créée même si son email n'est
 * pas parti — faire échouer l'opération métier pour un incident de messagerie
 * ferait dépendre l'écriture en base de la disponibilité d'un serveur SMTP.
 */
@Injectable()
export abstract class MailService {
  abstract sendEmailVerification(input: EmailVerificationMail): Promise<MailDeliveryResult>;
  abstract sendInvitation(input: InvitationMail): Promise<MailDeliveryResult>;
  abstract sendPasswordReset(input: PasswordResetMail): Promise<MailDeliveryResult>;
}

/** Implémentation par défaut : rendu des gabarits puis remise au transport. */
@Injectable()
export class TemplatedMailService extends MailService {
  constructor(private readonly transport: MailTransport) {
    super();
  }

  async sendEmailVerification(input: EmailVerificationMail): Promise<MailDeliveryResult> {
    const body = renderEmailVerification({
      url: input.url,
      name: input.name ?? null,
      isEmailChange: input.isEmailChange ?? false,
      expiresInHours: input.expiresInHours,
    });
    return this.transport.send({ to: input.to, ...body });
  }

  async sendInvitation(input: InvitationMail): Promise<MailDeliveryResult> {
    const body = renderInvitation({
      url: input.url,
      organizationName: input.organizationName,
      roleLabel: input.roleLabel,
      inviterName: input.inviterName ?? null,
      expiresAt: input.expiresAt,
    });
    return this.transport.send({ to: input.to, ...body });
  }

  async sendPasswordReset(input: PasswordResetMail): Promise<MailDeliveryResult> {
    const body = renderPasswordReset({
      url: input.url,
      name: input.name ?? null,
      expiresInMinutes: input.expiresInMinutes,
    });
    return this.transport.send({ to: input.to, ...body });
  }
}
