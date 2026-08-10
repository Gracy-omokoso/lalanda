import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Photo de profil d'un utilisateur.
 *
 * Collection dédiée, pour les mêmes raisons que `user_preferences` : la
 * collection `user` appartient à better-auth, et y ajouter un champ imposerait
 * de déclarer `user.additionalFields` dans la factory d'authentification pour un
 * besoin purement applicatif.
 *
 * LE DOCUMENT EST L'AUTORITÉ SUR L'EXISTENCE DE LA PHOTO. Pas de photo = pas de
 * document, et le profil retombe sur les initiales. C'est ce qui rend la
 * révocation immédiate : supprimer ce document suffit à faire répondre 404 à
 * toute URL déjà distribuée, avant même que l'objet soit purgé du stockage.
 *
 * AUCUN OCTET D'IMAGE N'EST STOCKÉ ICI. Mongo garde les métadonnées et le
 * pointeur ; les octets vivent dans le bucket. Les mettre en base ferait entrer
 * des mégaoctets binaires dans chaque sauvegarde et chaque réplication du jeu de
 * réplicas (ADR-0004).
 */
@Schema({ collection: 'user_avatars', timestamps: true, strict: true })
export class UserAvatar {
  /** Propriétaire. TOUJOURS issu de la session, jamais du corps de la requête. */
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  /**
   * Identifiant d'objet tiré au hasard (voir `storage/object-key.ts`).
   *
   * Il est indexé et unique parce que la route de servitude fait le chemin
   * INVERSE — objet → propriétaire — pour retrouver le type MIME à servir. Il ne
   * dérive d'aucune donnée de l'utilisateur : c'est ce qui rend les photos non
   * énumérables.
   */
  @Prop({ type: String, required: true })
  objectId!: string;

  /** Clé complète dans le bucket. Stockée telle quelle : le préfixe peut évoluer. */
  @Prop({ type: String, required: true })
  objectKey!: string;

  /** Type MIME DÉDUIT DU CONTENU à l'upload. C'est lui qui sera servi. */
  @Prop({ type: String, required: true, enum: ['image/png', 'image/jpeg', 'image/webp'] })
  contentType!: 'image/png' | 'image/jpeg' | 'image/webp';

  @Prop({ type: Number, required: true })
  width!: number;

  @Prop({ type: Number, required: true })
  height!: number;

  /** Taille des octets ASSAINIS, c'est-à-dire de ce qui est réellement stocké. */
  @Prop({ type: Number, required: true })
  byteSize!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserAvatarDocument = HydratedDocument<UserAvatar>;
export const UserAvatarSchema = SchemaFactory.createForClass(UserAvatar);

/** Une photo au plus par utilisateur — l'upsert du POST s'appuie dessus. */
UserAvatarSchema.index({ userId: 1 }, { unique: true });

/**
 * Unicité de l'identifiant d'objet.
 *
 * L'index sert la lecture (objet → document, à chaque affichage), mais son
 * caractère UNIQUE est une garantie : deux utilisateurs ne peuvent pas partager
 * un identifiant d'objet, donc une URL ne peut jamais désigner deux photos.
 */
UserAvatarSchema.index({ objectId: 1 }, { unique: true });
