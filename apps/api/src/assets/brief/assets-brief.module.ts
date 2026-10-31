// Lecture des équipements pour le brief du matin — ADR-0046 § 6.6. ADR-0046 — S7.
//
// Importe `AssetsModule` (qui n'importe que les organisations) pour `AssetsService` :
// le module du brief l'importe à son tour pour fournir le port `ASSETS_SOURCE`.

import { Module } from '@nestjs/common';

import { AssetsModule } from '../assets.module.js';
import { AssetsBriefSource } from './assets-brief.source.js';

@Module({
  imports: [AssetsModule],
  providers: [AssetsBriefSource],
  exports: [AssetsBriefSource],
})
export class AssetsBriefModule {}
