// Lecture des achats pour le brief du matin — ADR-0044 § 6.4. ADR-0044 — P6.
//
// Module à part, SANS dépendance (motif de `PurchasesAgendaModule`) : le module du
// brief l'importe pour fournir le port `PURCHASES_SOURCE` sans dépendre du module des
// achats. `AuthzService` vient du module global d'autorisation ; la connexion Mongo,
// du module racine.

import { Module } from '@nestjs/common';

import { PurchasesBriefSource } from './purchases-brief.source.js';

@Module({
  providers: [PurchasesBriefSource],
  exports: [PurchasesBriefSource],
})
export class PurchasesBriefModule {}
