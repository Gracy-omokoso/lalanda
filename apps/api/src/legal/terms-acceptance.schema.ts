import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Acceptation des conditions par un utilisateur, pour une version du corpus (S22c).
 *
 * ── CE QUE CE DOCUMENT EST ────────────────────────────────────────────────────
 *
 * Une PREUVE : qui a accepté quoi, et quand. Elle n'a de valeur que si elle est
 * exacte. Trois choix de conception en découlent.
 *
 * 1. UN DOCUMENT PAR (UTILISATEUR, VERSION), PAS UN PAR UTILISATEUR.
 *    Écraser l'acceptation précédente à chaque nouvelle version effacerait la
 *    trace de ce que l'utilisateur avait accepté avant — précisément ce qu'on
 *    veut pouvoir montrer en cas de contestation portant sur une période passée.
 *    L'historique est conservé ; l'état courant se déduit (`isCurrent`).
 *
 * 2. `acceptedAt` N'EST JAMAIS RÉÉCRIT.
 *    Une seconde acceptation de la MÊME version ne déplace pas la date : c'est un
 *    doublon d'appel (double clic, rejeu d'un formulaire), pas un nouvel accord.
 *    L'écriture se fait en `$setOnInsert` — voir `legal.service.ts`.
 *
 * 3. AUCUNE DONNÉE DE TRAÇAGE N'EST STOCKÉE ICI.
 *    Pas d'adresse IP, pas de `User-Agent`. On pourrait arguer qu'ils
 *    renforceraient la preuve ; ils constitueraient surtout une collecte
 *    supplémentaire que la politique de confidentialité devrait déclarer, pour un
 *    gain douteux (une IP ne prouve pas l'identité d'une personne). La politique
 *    publiée annonce « date et version » — ce schéma doit rester exactement ce
 *    qu'elle annonce.
 *
 * ── CE QUE CE DOCUMENT N'EST PAS ──────────────────────────────────────────────
 *
 * Il ne conserve PAS le texte accepté. La version (`termsVersion`) désigne un
 * état du corpus ; le texte correspondant vit dans le dépôt, sous contrôle de
 * version. `KNOWN_LEGAL_VERSIONS` (`@lalanda/shared/legal`) garantit qu'aucune
 * version jamais publiée ne puisse être enregistrée.
 */
@Schema({ collection: 'terms_acceptances', timestamps: true, strict: true })
export class TermsAcceptance {
  /**
   * Qui a accepté. TOUJOURS issu de la session, JAMAIS du corps de la requête.
   *
   * Pas d'`index: true` ici : l'index composé déclaré en bas de fichier commence
   * par `userId` et sert donc aussi les recherches par utilisateur seul. En
   * déclarer un second ferait doublon (mongoose l'avertit au démarrage) pour
   * exactement la même couverture.
   */
  @Prop({ type: String, required: true })
  userId!: string;

  /**
   * Version du corpus contractuel acceptée (format `YYYY-MM-DD`).
   *
   * Validée contre `KNOWN_LEGAL_VERSIONS` AVANT écriture : sans ce contrôle, un
   * client pourrait enregistrer une version future et ne plus jamais se voir
   * redemander son accord, puisque toute comparaison à la version courante le
   * donnerait pour à jour.
   */
  @Prop({ type: String, required: true })
  termsVersion!: string;

  /**
   * Date de l'acceptation. Posée à la première écriture et jamais modifiée
   * ensuite — c'est la donnée qui fait la preuve.
   */
  @Prop({ type: Date, required: true })
  acceptedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  // timestamps: true
  createdAt!: Date;
  updatedAt!: Date;
}

export type TermsAcceptanceDocument = HydratedDocument<TermsAcceptance>;
export const TermsAcceptanceSchema = SchemaFactory.createForClass(TermsAcceptance);

/**
 * Un seul enregistrement par (utilisateur, version).
 *
 * L'unicité est ce qui rend l'écriture idempotente : un double envoi du
 * formulaire d'inscription ne crée pas deux preuves contradictoires.
 */
TermsAcceptanceSchema.index({ userId: 1, termsVersion: 1 }, { unique: true });
