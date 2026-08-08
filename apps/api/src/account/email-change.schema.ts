import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Demande de changement d'adresse email en attente de vérification (S20b).
 *
 * RÈGLE CENTRALE : la nouvelle adresse n'est JAMAIS écrite sur `user.email` au
 * moment de la demande. Elle reste ici jusqu'à ce que le porteur de la NOUVELLE
 * adresse prouve qu'il la contrôle en présentant le token. Sans cette règle, un
 * attaquant disposant d'une session ouverte pourrait déplacer le compte vers une
 * adresse qu'il contrôle (docs/17 § Menaces prioritaires — « prise de compte »).
 *
 * POURQUOI UNE IMPLÉMENTATION MAISON plutôt que `auth.api.changeEmail` :
 * l'endpoint better-auth existe mais répond `CHANGE_EMAIL_DISABLED` tant que
 * `user.changeEmail.enabled` n'est pas activé dans la factory `auth.ts` — fichier
 * hors périmètre de ce lot (refonte RBAC en cours en parallèle). Le flux est donc
 * porté par ce module, avec la même sémantique.
 *
 * LIVRAISON DE L'EMAIL : inexistante. Aucun fournisseur SMTP n'est configuré
 * (docs/17 § Restant, S16a). `notifiedAt` reste `null` et l'API annonce
 * explicitement `verificationDelivered: false` — le flux est complet côté serveur
 * mais NON UTILISABLE par un utilisateur final tant que SMTP n'est pas branché.
 *
 * Le token suit la convention des invitations (S5d) : 32 octets aléatoires en
 * 64 caractères hexadécimaux, opaque, indexé unique.
 */
@Schema({ collection: 'email_change_requests', timestamps: true, strict: true })
export class EmailChangeRequest {
  /** Demandeur. Toujours issu de la session, JAMAIS du corps de la requête. */
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  /** Adresse actuelle au moment de la demande — trace d'audit du changement. */
  @Prop({ type: String, required: true, lowercase: true, trim: true })
  currentEmail!: string;

  /** Adresse cible, normalisée lowercase. Appliquée seulement à la vérification. */
  @Prop({ type: String, required: true, lowercase: true, trim: true, index: true })
  newEmail!: string;

  /** Token opaque envoyé à la NOUVELLE adresse. 64 chars hex, unique. */
  @Prop({ type: String, required: true, unique: true, index: true })
  token!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  /** Horodatage de l'application effective du changement. */
  @Prop({ type: Date, default: null })
  verifiedAt!: Date | null;

  /** Annulation explicite par l'utilisateur. */
  @Prop({ type: Date, default: null })
  canceledAt!: Date | null;

  /**
   * Horodatage de l'envoi RÉEL de l'email de vérification.
   * Reste `null` tant qu'aucun fournisseur SMTP n'existe — ce champ est la preuve
   * en base que la vérification n'a pas pu être délivrée, plutôt qu'un succès simulé.
   */
  @Prop({ type: Date, default: null })
  notifiedAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type EmailChangeRequestDocument = HydratedDocument<EmailChangeRequest>;
export const EmailChangeRequestSchema = SchemaFactory.createForClass(EmailChangeRequest);

// Une seule demande EN ATTENTE par utilisateur. L'index partiel n'indexe que les
// demandes ni vérifiées ni annulées : une nouvelle demande reste possible après
// annulation, expiration traitée ou changement abouti.
EmailChangeRequestSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { verifiedAt: null, canceledAt: null },
  },
);
