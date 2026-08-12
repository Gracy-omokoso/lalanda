// Acheminement d'un message (S22a, deux chemins depuis S22m).
//
// ── Le repli n'est pas un accident ────────────────────────────────────────────
// Sans `ZEPTOMAIL_TOKEN` ni `SMTP_HOST`, l'application DÉMARRE et fonctionne : le
// message est journalisé, `delivered` vaut `false`, et l'appelant le dit à
// l'utilisateur. C'est exactement le comportement d'avant S22a (docs/17 § Bloqué
// par l'absence de SMTP), conservé tel quel. Rendre le démarrage dépendant d'un
// serveur de mail transformerait une fonctionnalité optionnelle en point de panne
// du produit entier — un développeur sans MailHog ne pourrait plus lancer l'API.
//
// ── Un chemin, une tentative ─────────────────────────────────────────────────
// Le chemin est choisi par `MailCredentialsProvider` (ZeptoMail s'il y a un
// jeton, sinon SMTP, sinon journal). Un échec sur le chemin choisi n'entraîne
// AUCUN essai sur l'autre : un envoi qui échoue en ayant peut-être abouti — délai
// dépassé après acceptation par Zoho — partirait deux fois, et l'utilisateur
// recevrait deux liens de réinitialisation dont un seul fonctionne. La
// délivrabilité n'est pas améliorée par un doublon; elle est rendue ambiguë.
//
// ── Ce qui n'apparaît JAMAIS dans les journaux ────────────────────────────────
// docs/17 § Journalisation : « aucun token, secret […] ne doit apparaître dans les
// logs ». Le repli journalise donc le destinataire et le sujet, jamais le corps —
// le corps contient précisément le lien porteur du jeton. Un opérateur qui a
// besoin du lien active un vrai SMTP (MailHog en local) ; il ne le lit pas dans
// journalctl.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { MailCredentialsProvider } from './mail-credentials.provider.js';
import {
  DELIVERED,
  type MailCredentials,
  type MailDeliveryResult,
  type MailMessage,
  type SmtpCredentials,
} from './mail.types.js';
import { envoyerViaZeptoMail } from './zeptomail.client.js';

/** Contrat d'acheminement. Substituable en test par un espion sans réseau. */
@Injectable()
export abstract class MailTransport {
  abstract send(message: MailMessage): Promise<MailDeliveryResult>;
}

/**
 * Transport à deux chemins — API ZeptoMail ou SMTP — avec repli journal.
 *
 * Le nom reste `SmtpMailTransport` : il est cité par `mail.module.ts`, par
 * `password-reset.e2e.test.ts` et par le plan de validation d'ADR-0014. Le
 * renommer pour un gain purement cosmétique ferait rougir des fichiers qui n'ont
 * rien à voir avec l'envoi d'emails, et le chemin SMTP reste bel et bien l'un des
 * deux qu'il sert.
 *
 * Le transporteur nodemailer est mis en cache et réutilisé entre les envois : il
 * maintient un pool de connexions, et en recréer un à chaque message rouvrirait
 * une connexion TLS par email. Le cache est invalidé dès que les identifiants
 * changent — indispensable le jour où ils viennent de la base (voir
 * `MailCredentialsProvider`) et non plus d'un environnement figé au démarrage.
 * ZeptoMail n'a rien d'équivalent à mettre en cache : chaque envoi est une requête
 * HTTP isolée, et `undici` gère lui-même la réutilisation des connexions.
 */
@Injectable()
export class SmtpMailTransport extends MailTransport {
  private readonly logger = new Logger('MailTransport');
  private cached: { fingerprint: string; transporter: Transporter } | null = null;

  // Jeton d'injection EXPLICITE : voir `mail.service.ts` — esbuild (vitest)
  // n'émet pas `design:paramtypes`, et une injection par type y devient
  // silencieusement `undefined`.
  constructor(
    @Inject(MailCredentialsProvider) private readonly credentials: MailCredentialsProvider,
  ) {
    super();
  }

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    const creds = await this.credentials.resolve();

    if (!creds) {
      // Repli : ni jeton ni corps dans le journal (cf. en-tête de fichier).
      this.logger.warn(
        `Email NON ENVOYÉ (aucun chemin d'envoi configuré) → destinataire=${message.to} ` +
          `sujet="${message.subject}". Renseignez ZEPTOMAIL_TOKEN (recommandé) ou ` +
          `SMTP_HOST pour activer l'envoi.`,
      );
      return { delivered: false, reason: 'MAIL_NOT_CONFIGURED' };
    }

    try {
      await this.deliver(creds, message);
      return DELIVERED;
    } catch (err) {
      // Un envoi qui échoue ne doit pas faire échouer l'opération métier qui l'a
      // déclenché : une invitation créée reste créée, son lien reste copiable
      // depuis l'interface. Mais il ne doit pas non plus disparaître : c'est la
      // SEULE trace qu'un utilisateur attend un email qui n'arrivera pas. On
      // journalise donc la panne, le chemin emprunté, le destinataire et le sujet
      // — jamais le corps, qui porte le lien et son jeton.
      this.logger.error(
        `Envoi ${creds.kind} en ÉCHEC → destinataire=${message.to} ` +
          `sujet="${message.subject}" : ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return {
        delivered: false,
        reason: creds.kind === 'zeptomail' ? 'ZEPTOMAIL_ERROR' : 'SMTP_ERROR',
      };
    }
  }

  /**
   * Aiguillage sur le chemin résolu. `switch` EXHAUSTIF sur le discriminant : le
   * jour où un troisième chemin s'ajoute à `MailCredentials`, ce fichier refuse de
   * compiler tant qu'il n'est pas traité — plutôt que de tomber silencieusement
   * dans un `else` SMTP qui n'a pas les bons identifiants.
   */
  private async deliver(creds: MailCredentials, message: MailMessage): Promise<void> {
    switch (creds.kind) {
      case 'zeptomail':
        await envoyerViaZeptoMail(creds, message);
        return;
      case 'smtp':
        await this.transporterFor(creds).sendMail({
          from: creds.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        return;
    }
  }

  /** Transporteur du jeu d'identifiants courant, recréé seulement s'il a changé. */
  private transporterFor(creds: SmtpCredentials): Transporter {
    // Le mot de passe entre dans l'empreinte (une rotation doit recréer le
    // transporteur) mais n'est jamais journalisé ni exposé : l'empreinte reste en
    // mémoire du process.
    const fingerprint = JSON.stringify([
      creds.host,
      creds.port,
      creds.secure,
      creds.user ?? null,
      creds.password ?? null,
    ]);
    if (this.cached?.fingerprint === fingerprint) return this.cached.transporter;

    const transporter = createTransport({
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      ...(creds.user ? { auth: { user: creds.user, pass: creds.password ?? '' } } : {}),
    });

    this.cached = { fingerprint, transporter };
    return transporter;
  }
}
