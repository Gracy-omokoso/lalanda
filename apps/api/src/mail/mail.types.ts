// Types du module mail (S22a). Aucun import de nodemailer ici : ces types sont la
// frontière entre « ce que le produit veut envoyer » et « comment c'est acheminé ».
// Un futur transport (API HTTP d'un fournisseur, file d'attente) doit pouvoir les
// implémenter sans que rien d'autre ne change.

/** Message prêt à partir. Le HTML est déjà rendu, la locale déjà appliquée. */
export interface MailMessage {
  /** Destinataire unique — le produit n'envoie jamais en masse depuis ce chemin. */
  to: string;
  subject: string;
  /** HTML simple, sans image distante ni script (docs/17 § Application). */
  html: string;
  /**
   * Variante texte. Toujours fournie : un client qui refuse le HTML doit lire un
   * message complet, lien compris — pas une invitation à « activer le HTML ».
   */
  text: string;
}

/**
 * Identifiants de l'API ZeptoMail (Zoho) — chemin d'envoi PRÉFÉRÉ (ADR-0014 § S22m).
 *
 * Une seule route HTTP, un seul secret. Pas de connexion persistante, donc rien à
 * mettre en cache : contrairement à SMTP, chaque envoi est une requête isolée.
 */
export interface ZeptoMailCredentials {
  kind: 'zeptomail';
  /** « Send Mail Token » de la console Zoho, sans son préfixe `Zoho-enczapikey`. */
  token: string;
  /**
   * Route d'envoi complète. Zoho exploite trois centres de données
   * (`api.zeptomail.com`, `.eu`, `.in`) et un jeton émis dans l'un est refusé par
   * les deux autres : le point d'entrée fait partie des identifiants, pas du décor.
   */
  apiUrl: string;
  /** Expéditeur affiché. `"Lalanda <no-reply@…>"` ou une simple adresse. */
  from: string;
}

/** Identifiants d'un serveur SMTP, d'où qu'ils viennent (env aujourd'hui, base demain). */
export interface SmtpCredentials {
  kind: 'smtp';
  host: string;
  port: number;
  /**
   * TLS implicite (port 465). Déduit du port quand il n'est pas donné : 465 → true,
   * tout le reste → false + STARTTLS opportuniste, ce que fait nodemailer par défaut.
   */
  secure: boolean;
  /** Authentification facultative : un relais interne peut n'en demander aucune. */
  user?: string | undefined;
  password?: string | undefined;
  /** Expéditeur affiché. `"Lalanda <no-reply@…>"` ou une simple adresse. */
  from: string;
}

/**
 * Le jeu d'identifiants effectivement en vigueur, ET le chemin qu'il désigne.
 *
 * Union DISCRIMINÉE, et c'est ce qui compte : `kind` fait du choix du transport
 * une donnée résolue en un seul endroit (`MailCredentialsProvider`) plutôt qu'une
 * suite de `if` disséminés. Ajouter un troisième chemin d'envoi un jour consiste
 * à ajouter un membre — et le `switch` exhaustif du transport refuse alors de
 * compiler tant qu'il n'est pas traité.
 */
export type MailCredentials = ZeptoMailCredentials | SmtpCredentials;

/**
 * Résultat d'un envoi.
 *
 * `delivered: false` n'est PAS une erreur : c'est le mode de repli documenté quand
 * aucun chemin d'envoi n'est configuré (le message est journalisé, l'application
 * continue). Les appelants s'en servent pour dire la vérité à l'utilisateur — S20b
 * affiche déjà `verificationDelivered` dans l'interface plutôt que de mentir.
 */
export interface MailDeliveryResult {
  delivered: boolean;
  /**
   * Motif machine quand `delivered` vaut false.
   *
   * `MAIL_NOT_CONFIGURED` remplace l'ancien `SMTP_NOT_CONFIGURED` : depuis S22m il
   * y a DEUX chemins possibles, et un motif qui n'en nomme qu'un ferait chercher
   * un serveur SMTP absent là où c'est le jeton ZeptoMail qui manque.
   */
  reason?: 'MAIL_NOT_CONFIGURED' | 'SMTP_ERROR' | 'ZEPTOMAIL_ERROR';
}

/** Le message a bien été remis au serveur SMTP. */
export const DELIVERED: MailDeliveryResult = { delivered: true };
