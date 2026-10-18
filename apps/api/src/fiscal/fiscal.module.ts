// Module fiscal — identité fiscale, facture normalisée, points de vente e-MCF
// (ADR-0021 §2, §3, §4.1 ; chantier B).
//
// ── Coffre d'organisation : provisoire, À RETIRER à la fusion du chantier A ───
// Le vrai coffre (`OrganizationSecretsService`, chiffré, chantier A) sera fourni
// par `IntegrationsModule` sous le jeton `ORGANIZATION_SECRETS`. En attendant,
// ce module déclare son propre fournisseur :
//   - hors production : le faux coffre EN MÉMOIRE (non chiffré, perdu au
//     redémarrage) — pour développer et tester ;
//   - en production : un coffre « indisponible » qui répond 503 VAULT_UNAVAILABLE.
//     Un jeton de contribuable n'est jamais conservé en clair dans un processus
//     de production.
// À la fusion de A, supprimer la ligne `ORGANIZATION_SECRETS` ci-dessous : un
// fournisseur local masquerait celui, importé, d'`IntegrationsModule`.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { EdefModule } from '../edef/edef.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import {
  ORGANIZATION_SECRETS,
  VaultUnavailableError,
  type OrganizationSecretsPort,
} from '../integrations/organization-secrets.port.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { EmcfPointOfSale, EmcfPointOfSaleSchema } from './emcf-point-of-sale.schema.js';
import { FiscalProfileController } from './fiscal-profile.controller.js';
import {
  OrganizationFiscalProfile,
  OrganizationFiscalProfileSchema,
} from './fiscal-profile.schema.js';
import { FiscalProfileService } from './fiscal-profile.service.js';
import {
  NormalizedInvoicingSettings,
  NormalizedInvoicingSettingsSchema,
} from './normalized-invoicing-settings.schema.js';
import { NormalizedInvoicingStateReader } from './normalized-invoicing-state.reader.js';
import { NormalizedInvoicingController } from './normalized-invoicing.controller.js';
import { NormalizedInvoicingService } from './normalized-invoicing.service.js';
import { PointsOfSaleService } from './points-of-sale.service.js';
import { ReferenceDataService } from './reference-data.service.js';
import { InMemoryOrganizationSecrets } from './testing/in-memory-organization-secrets.js';

/** Coffre absent : toute opération lève `VaultUnavailableError` (→ 503). */
const UNAVAILABLE_VAULT: OrganizationSecretsPort = {
  put: () => Promise.reject(new VaultUnavailableError()),
  resolve: () => Promise.reject(new VaultUnavailableError()),
  describe: () => Promise.reject(new VaultUnavailableError()),
  describeMany: () => Promise.reject(new VaultUnavailableError()),
  destroy: () => Promise.reject(new VaultUnavailableError()),
};

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService` ; le
    // module ré-exporte les modèles `Organization` et `Membership`, et
    // `MembersService` (identités des Propriétaires à avertir).
    OrganizationsModule,
    // `ReauthService` : même fenêtre de ré-authentification qu'`/admin`.
    IntegrationsModule,
    EdefModule,
    MongooseModule.forFeature([
      { name: OrganizationFiscalProfile.name, schema: OrganizationFiscalProfileSchema },
      { name: NormalizedInvoicingSettings.name, schema: NormalizedInvoicingSettingsSchema },
      { name: EmcfPointOfSale.name, schema: EmcfPointOfSaleSchema },
    ]),
  ],
  controllers: [FiscalProfileController, NormalizedInvoicingController],
  providers: [
    // PROVISOIRE — voir l'en-tête : à retirer à la fusion du chantier A.
    {
      provide: ORGANIZATION_SECRETS,
      useFactory: (): OrganizationSecretsPort =>
        process.env['NODE_ENV'] === 'production'
          ? UNAVAILABLE_VAULT
          : new InMemoryOrganizationSecrets(),
    },
    NormalizedInvoicingStateReader,
    FiscalProfileService,
    PointsOfSaleService,
    NormalizedInvoicingService,
    ReferenceDataService,
  ],
  exports: [NormalizedInvoicingService, PointsOfSaleService],
})
export class FiscalModule {}
