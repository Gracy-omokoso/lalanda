import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { avatarObjectKey, newObjectId } from '../storage/object-key.js';
import {
  ObjectStorageService,
  ObjectStorageUnavailableError,
} from '../storage/object-storage.service.js';
import type { ImageAcceptance } from './image-validation.js';
import { UserAvatar, type UserAvatarDocument } from './avatar.schema.js';

export interface AvatarRecord {
  objectId: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  byteSize: number;
  updatedAt: Date;
}

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    @InjectModel(UserAvatar.name) private readonly model: Model<UserAvatarDocument>,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
  ) {}

  async find(userId: string): Promise<AvatarRecord | null> {
    return toRecord(await this.model.findOne({ userId }).lean().exec());
  }

  /**
   * Écrit (ou remplace) la photo. `image` est le RÉSULTAT de la validation :
   * ce service ne reçoit jamais d'octets non assainis.
   *
   * ── L'ordre des trois étapes est le sujet ──────────────────────────────────
   *
   *   1. écrire le NOUVEL objet ;
   *   2. faire pointer la base dessus, en retenant l'ancien pointeur ;
   *   3. supprimer l'ANCIEN objet.
   *
   * Aucune étape ne laisse un état où la base désigne un objet absent : à tout
   * instant, le pointeur en base vise un objet qui existe. Un échec en 2 laisse
   * un objet orphelin dans le bucket — sans référence, sous une clé de 128 bits
   * qu'aucune route ne sait retrouver : c'est de l'espace perdu, pas une fuite.
   * L'inverse (supprimer d'abord) produirait une photo cassée pour l'utilisateur
   * à la moindre panne d'écriture.
   *
   * L'échec de l'étape 3 est journalisé sans interrompre : l'utilisateur a sa
   * nouvelle photo, et refuser l'opération pour un nettoyage raté le laisserait
   * avec l'ancienne.
   */
  async replace(userId: string, image: ImageAcceptance): Promise<AvatarRecord> {
    const bucket = this.requireBucket();
    const objectId = newObjectId();
    const objectKey = avatarObjectKey(objectId);

    await this.storage.putObject(bucket, objectKey, image.bytes, image.contentType);

    const precedent = await this.model
      .findOneAndUpdate(
        { userId },
        {
          $set: {
            objectId,
            objectKey,
            contentType: image.contentType,
            width: image.width,
            height: image.height,
            byteSize: image.bytes.length,
          },
          $setOnInsert: { userId, _schemaVersion: 1 },
        },
        { upsert: true, new: false, lean: true },
      )
      .exec();

    if (precedent?.objectKey && precedent.objectKey !== objectKey) {
      await this.purge(bucket, precedent.objectKey);
    }

    const enregistre = await this.model.findOne({ userId }).lean().exec();
    return toRecord(enregistre)!;
  }

  /**
   * Retire la photo. `false` si l'utilisateur n'en avait pas — retirer une photo
   * absente n'est pas une erreur, c'est déjà l'état voulu.
   *
   * La base est vidée AVANT le stockage, à l'inverse de `replace`. La raison est
   * la même dans les deux cas : ne jamais laisser l'utilisateur dans un état
   * qu'il ne peut pas corriger. Ici, l'enregistrement supprimé rend tout jeton
   * déjà distribué inopérant immédiatement ; si la purge du bucket échoue
   * ensuite, l'objet reste sans aucune route capable de le servir.
   */
  async remove(userId: string): Promise<boolean> {
    const supprime = await this.model.findOneAndDelete({ userId }).lean().exec();
    if (!supprime) return false;
    const bucket = this.storage.uploadsBucket();
    if (bucket) await this.purge(bucket, supprime.objectKey);
    return true;
  }

  /**
   * Octets et type d'un objet, par son identifiant — le chemin de la servitude.
   *
   * La consultation de la BASE fait autorité, pas celle du bucket : un
   * identifiant dont aucun enregistrement ne parle rend `null` sans qu'aucune
   * requête ne parte vers le stockage. Un objet orphelin resté dans le bucket
   * n'est donc servi par personne.
   */
  async readByObjectId(
    objectId: string,
  ): Promise<{ body: Buffer; contentType: string; updatedAt: Date } | null> {
    const doc = await this.model.findOne({ objectId }).lean().exec();
    if (!doc) return null;

    const bucket = this.storage.uploadsBucket();
    if (!bucket) return null;

    const objet = await this.storage.getObject(bucket, doc.objectKey);
    if (!objet) return null;

    // Le `Content-Type` servi est CELUI DE LA BASE, issu de notre analyse du
    // contenu à l'upload — jamais celui que renvoie le stockage, qui pourrait
    // avoir été écrit par un autre chemin que le nôtre.
    return { body: objet.body, contentType: doc.contentType, updatedAt: doc.updatedAt };
  }

  /** Le stockage est-il configuré ? Sert à répondre 503 plutôt qu'à échouer tard. */
  storageAvailability(): { available: boolean; reason?: string } {
    const a = this.storage.availability();
    return a.available ? { available: true } : { available: false, reason: a.reason };
  }

  private requireBucket(): string {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) {
      const a = this.storage.availability();
      throw new ObjectStorageUnavailableError(a.available ? 'Bucket absent.' : a.reason);
    }
    return bucket;
  }

  private async purge(bucket: string, objectKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(bucket, objectKey);
    } catch (cause) {
      // La clé n'est pas journalisée : elle désigne l'objet (docs/17 § Journalisation).
      this.logger.warn(`Purge d’un objet d’avatar en échec : ${(cause as Error).message}`);
    }
  }
}

function toRecord(doc: UserAvatar | null): AvatarRecord | null {
  if (!doc) return null;
  // Champs recopiés UN PAR UN, jamais `...doc` : la même discipline que
  // `toIntegrationView()` (docs/17 § S21b). Un champ ajouté au schéma demain ne
  // se retrouvera pas dans une réponse d'API par accident.
  return {
    objectId: doc.objectId,
    contentType: doc.contentType,
    width: doc.width,
    height: doc.height,
    byteSize: doc.byteSize,
    updatedAt: doc.updatedAt,
  };
}
