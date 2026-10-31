// Lecture des stocks pour le brief du matin — ADR-0046 § 6.6. ADR-0046 — S7.
//
// Module à part, SANS dépendance vers `StockModule` (motif de `HrBriefModule`) : le
// module du brief l'importe pour fournir le port `STOCK_SOURCE`. La connexion Mongo
// vient du module racine.

import { Module } from '@nestjs/common';

import { StockBriefSource } from './stock-brief.source.js';

@Module({
  providers: [StockBriefSource],
  exports: [StockBriefSource],
})
export class StockBriefModule {}
