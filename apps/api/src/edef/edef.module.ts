// Module du client e-MCF (ADR-0021 §6, chantier B).
//
// Aucune route : le client est consommé par `fiscal/`. Le journal des échanges
// n'est exposé par aucune route dans ce lot. `DGI_PLATFORM_CONFIG` vient du
// module global `PlatformConfigModule`.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { EdefExchange, EdefExchangeSchema } from './edef-exchange.schema.js';
import { EdefExchangeJournal, MongoEdefExchangeJournal } from './edef-exchange.journal.js';
import {
  EdefReferenceSnapshot,
  EdefReferenceSnapshotSchema,
} from './edef-reference-snapshot.schema.js';
import { EdefReferenceSnapshotsService } from './edef-reference-snapshots.service.js';
import { EdefClient } from './edef.client.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EdefExchange.name, schema: EdefExchangeSchema },
      { name: EdefReferenceSnapshot.name, schema: EdefReferenceSnapshotSchema },
    ]),
  ],
  providers: [
    { provide: EdefExchangeJournal, useClass: MongoEdefExchangeJournal },
    EdefClient,
    EdefReferenceSnapshotsService,
  ],
  exports: [EdefClient, EdefReferenceSnapshotsService],
})
export class EdefModule {}
