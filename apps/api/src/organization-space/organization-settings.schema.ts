import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { DISPLAY_CURRENCIES, type DisplayCurrency } from './organization-space.dto.js';

/**
 * Réglages d'AFFICHAGE d'une organisation (S21a).
 *
 * ── Pourquoi une collection distincte de `organizations` ──────────────────────
 *
 * `organizations` porte l'IDENTITÉ du tenant : nom, slug, type, pays, propriétaire.
 * Elle est écrite par le provisionnement, la création d'organisation et le
 * transfert de propriété — tout `apps/api/src/organizations/`, dont ADR-0012 §9
 * fait un périmètre à écrivain unique.
 *
 * Les deux réglages introduits ici (devise d'affichage par défaut, logo) sont des
 * PRÉFÉRENCES de présentation, pas de l'identité : aucun calcul ne les consomme,
 * le moteur financier les ignore, et leur absence est un cas nominal. Ils suivent
 * donc exactement le partage déjà retenu en S20b pour l'utilisateur — better-auth
 * possède `user` (identité), `account/` possède `user_preferences` (présentation).
 *
 * Conséquence assumée : une organisation SANS document ici est parfaitement
 * valide et prend les défauts de `DEFAULT_ORGANIZATION_SETTINGS`. On ne crée pas
 * de document à la création d'une organisation, seulement à la première écriture.
 */
@Schema({ collection: 'organization_settings', timestamps: true, strict: true })
export class OrganizationSettings {
  /** Une seule fiche de réglages par organisation. */
  @Prop({ type: String, required: true, unique: true, index: true })
  organizationId!: string;

  /**
   * Devise d'affichage par défaut des nouveaux projets de l'organisation.
   *
   * PAR DÉFAUT, jamais rétroactif : un projet existant garde la devise figée dans
   * son document (`projects.deviseAffichage`) et dans les plans déjà validés. Une
   * organisation qui change de devise d'affichage ne réécrit aucun chiffre
   * historique — un plan parti chez un banquier reste retrouvable à l'identique
   * (docs/07 § Version validée).
   */
  @Prop({ type: String, required: true, enum: DISPLAY_CURRENCIES, default: 'USD' })
  deviseAffichage!: DisplayCurrency;

  /**
   * URL absolue du logo. URL SEULEMENT : aucun upload, le stockage de fichiers
   * n'est pas branché (même limite que la photo de profil, docs/04 § S20b).
   * `null` = pas de logo, l'interface retombe sur les initiales du nom.
   */
  @Prop({ type: String, default: null })
  logoUrl!: string | null;

  /** Dernier auteur d'une écriture de réglages — repris dans le journal d'audit. */
  @Prop({ type: String, default: null })
  updatedBy!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  // timestamps: true
  createdAt!: Date;
  updatedAt!: Date;
}

export type OrganizationSettingsDocument = HydratedDocument<OrganizationSettings>;
export const OrganizationSettingsSchema = SchemaFactory.createForClass(OrganizationSettings);
