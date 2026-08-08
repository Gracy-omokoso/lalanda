import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Préférences d'un utilisateur (S20b — docs/04 § Langues, § Conventions).
 *
 * POURQUOI UNE COLLECTION DÉDIÉE plutôt que des `additionalFields` better-auth
 * sur la collection `user` :
 *
 * 1. La collection `user` appartient à better-auth. Y ajouter des champs impose
 *    de déclarer ces champs dans la factory `auth.ts` (option `user.additionalFields`),
 *    donc de modifier le socle d'authentification pour un besoin purement applicatif.
 * 2. `user` est écrite par better-auth (inscription, changement de mot de passe,
 *    vérification d'email). Mélanger des préférences produit à un magasin d'identité
 *    rend les migrations et les purges RGPD plus difficiles à raisonner.
 * 3. Une collection applicative porte `_schemaVersion` et suit les conventions du
 *    dépôt (docs/15), ce que le schéma better-auth ne fait pas.
 *
 * Le lien est `userId` (better-auth `user._id` en string, même convention que
 * `memberships.userId`). Un document au plus par utilisateur — index unique.
 *
 * Le document est OPTIONNEL : un utilisateur qui n'a jamais rien réglé n'en a pas.
 * La lecture retombe alors sur `DEFAULT_PREFERENCES`, jamais sur un 404.
 */
@Schema({ collection: 'user_preferences', timestamps: true, strict: true })
export class UserPreferences {
  /** Propriétaire. Toujours issu de la session, JAMAIS du corps de la requête. */
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  /**
   * Langue d'interface. docs/04 § Langues : le français est la langue initiale,
   * la structure prépare l'ajout d'autres langues. L'énumération est volontairement
   * limitée à ce qui est réellement traduit — voir SUPPORTED_LOCALES.
   */
  @Prop({ type: String, required: true, enum: ['fr'], default: 'fr' })
  locale!: 'fr';

  /** Fuseau horaire IANA (ex. `Africa/Kinshasa`). Validé à l'écriture via Intl. */
  @Prop({ type: String, required: true, default: 'Africa/Kinshasa' })
  timezone!: string;

  /**
   * Thème d'affichage. `system` suit la préférence du navigateur.
   * Persisté côté serveur EN PLUS du localStorage : le localStorage seul ne suit
   * pas l'utilisateur d'un appareil à l'autre.
   */
  @Prop({ type: String, required: true, enum: ['light', 'dark', 'system'], default: 'system' })
  theme!: 'light' | 'dark' | 'system';

  /**
   * Devise d'affichage proposée par défaut à la création d'un projet.
   * Même énumération que `projects.dto.ts` — c'est une valeur par défaut d'UI,
   * elle ne change aucun calcul du moteur financier.
   */
  @Prop({ type: String, required: true, enum: ['USD', 'CDF', 'XOF', 'XAF', 'EUR'], default: 'USD' })
  displayCurrency!: 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR';

  /**
   * Préférences de notification. STRUCTURE ET STOCKAGE UNIQUEMENT (S20b) :
   * aucun envoi n'existe côté serveur — il n'y a ni SMTP ni worker de notification
   * (docs/17 § Restant). Ces booléens sont conservés pour que le jour où l'envoi
   * existe, le consentement de l'utilisateur soit déjà connu et respecté.
   */
  @Prop({
    type: {
      securite: { type: Boolean, default: true },
      produit: { type: Boolean, default: true },
      projet: { type: Boolean, default: true },
      resumeHebdomadaire: { type: Boolean, default: false },
    },
    required: true,
    default: () => ({
      securite: true,
      produit: true,
      projet: true,
      resumeHebdomadaire: false,
    }),
    _id: false,
  })
  notifications!: NotificationPreferences;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  // timestamps: true
  createdAt!: Date;
  updatedAt!: Date;
}

export interface NotificationPreferences {
  /** Alertes de sécurité (connexion inhabituelle, changement de mot de passe). */
  securite: boolean;
  /** Nouveautés produit. */
  produit: boolean;
  /** Activité sur les projets de l'organisation. */
  projet: boolean;
  /** Résumé hebdomadaire. */
  resumeHebdomadaire: boolean;
}

export type UserPreferencesDocument = HydratedDocument<UserPreferences>;
export const UserPreferencesSchema = SchemaFactory.createForClass(UserPreferences);

// Un seul document de préférences par utilisateur — l'upsert du PUT s'appuie dessus.
UserPreferencesSchema.index({ userId: 1 }, { unique: true });
