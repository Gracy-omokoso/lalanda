// Rattachement RUN → BUILD commun aux deux ponts (ventes, dépenses) — voir
// `run-link.service.ts`. Module à part pour que le module Trésorerie le lise
// sans importer le module du réalisé (qui, lui, importe la Trésorerie pour le
// verrou des lignes) : aucune dépendance circulaire.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  RunActualsBridge,
  RunActualsBridgeSchema,
} from '../run-bridge/run-actuals-bridge.schema.js';
import { RunLinkService } from './run-link.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: RunActualsBridge.name, schema: RunActualsBridgeSchema }]),
  ],
  providers: [RunLinkService],
  exports: [RunLinkService],
})
export class RunLinkModule {}
