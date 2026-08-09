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

/** Identifiants d'un serveur SMTP, d'où qu'ils viennent (env aujourd'hui, base demain). */
export interface SmtpCredentials {
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
 * Résultat d'un envoi.
 *
 * `delivered: false` n'est PAS une erreur : c'est le mode de repli documenté quand
 * aucun SMTP n'est configuré (le message est journalisé, l'application continue).
 * Les appelants s'en servent pour dire la vérité à l'utilisateur — S20b affiche
 * déjà `verificationDelivered` dans l'interface plutôt que de mentir.
 */
export interface MailDeliveryResult {
  delivered: boolean;
  /** Motif machine quand `delivered` vaut false. */
  reason?: 'SMTP_NOT_CONFIGURED' | 'SMTP_ERROR';
}

/** Le message a bien été remis au serveur SMTP. */
export const DELIVERED: MailDeliveryResult = { delivered: true };
