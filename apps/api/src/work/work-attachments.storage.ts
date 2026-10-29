// Stockage objet des pièces jointes — ADR-0039 § 2.5.
//
// Même règle que l'avatar, le logo et les reçus (`storage/object-key.ts`) :
// l'identifiant est tiré au hasard, sans aucune dérivation de l'organisation ni
// de la tâche ; le préfixe est un rangement. Un objet orphelin est inoffensif
// (clé au hasard, aucune URL publique) : la suppression est au mieux.

import type { Logger } from '@nestjs/common';

import {
  ObjectStorageUnavailableError,
  type ObjectStorageService,
} from '../storage/object-storage.service.js';

export function workAttachmentObjectKey(objectId: string): string {
  return `work-attachments/${objectId}`;
}

export function requireUploadsBucket(storage: ObjectStorageService): string {
  const bucket = storage.uploadsBucket();
  if (!bucket) {
    const a = storage.availability();
    throw new ObjectStorageUnavailableError(a.available ? 'Bucket absent.' : a.reason);
  }
  return bucket;
}

/** Efface des objets au mieux ; un échec est journalisé, jamais remonté. */
export async function dropAttachmentObjects(
  storage: ObjectStorageService,
  objectIds: readonly string[],
  logger: Logger,
): Promise<void> {
  if (objectIds.length === 0) return;
  const bucket = storage.uploadsBucket();
  if (!bucket) return;
  for (const objectId of objectIds) {
    try {
      await storage.deleteObject(bucket, workAttachmentObjectKey(objectId));
    } catch (err) {
      logger.warn(`Pièce ${objectId} non supprimée du stockage : ${(err as Error).message}`);
    }
  }
}
