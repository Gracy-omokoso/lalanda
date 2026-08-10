import { Global, Module } from '@nestjs/common';

import { ObjectStorageService } from './object-storage.service.js';

/**
 * Stockage objet (S3 / MinIO / Spaces).
 *
 * `@Global` par le même raisonnement que `MailModule` : le service est sans
 * état, sans dépendance, et destiné à plusieurs domaines (avatars aujourd'hui,
 * exports et instantanés demain — docs/24). L'alternative — l'importer dans
 * chaque module consommateur — n'apporte aucune isolation réelle puisqu'il n'y a
 * rien à isoler, et multiplie les points d'oubli.
 */
@Global()
@Module({
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class StorageModule {}
