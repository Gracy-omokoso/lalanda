// Module des paramètres plateforme (ADR-0021 §5, jalon A0).
//
// GLOBAL, par le même raisonnement que `MailModule` et `StorageModule` : un
// fournisseur sans état, sans route ni schéma, consommé par plusieurs domaines
// (client e-DEF et facture normalisée dans ce lot, émission des factures au lot
// S25f). Le faire importer par chacun n'isolerait rien.
//
// `useFactory` est évalué au démarrage : une variable `DGI_*` invalide fait
// échouer le démarrage de l'application (ADR-0021 §5), au lieu d'une panne au
// premier appel à la DGI.

import { Global, Module } from '@nestjs/common';

import { DGI_PLATFORM_CONFIG, loadDgiPlatformConfig } from './dgi-platform.config.js';

@Global()
@Module({
  providers: [{ provide: DGI_PLATFORM_CONFIG, useFactory: () => loadDgiPlatformConfig() }],
  exports: [DGI_PLATFORM_CONFIG],
})
export class PlatformConfigModule {}
