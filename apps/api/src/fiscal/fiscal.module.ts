// Module fiscal — identité fiscale, facture normalisée, points de vente e-MCF
// (ADR-0021 §2, §3, §4.1 ; chantier B).
//
// ── Coffre d'organisation ────────────────────────────────────────────────────
// Le coffre chiffré (`OrganizationSecretsService`, chantier A) est fourni par
// `IntegrationsModule` sous le jeton `ORGANIZATION_SECRETS` : ce module n'en
// connaît que le port, jamais la clé maîtresse. Le faux coffre en mémoire
// (`testing/in-memory-organization-secrets.ts`) ne sert qu'aux tests unitaires.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { EdefModule } from '../edef/edef.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
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

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService` ; le
    // module ré-exporte les modèles `Organization` et `Membership`, et
    // `MembersService` (identités des Propriétaires à avertir).
    OrganizationsModule,
    // Coffre d'organisation (`ORGANIZATION_SECRETS`) et garde de ré-authentification
    // récente (`RecentReauthGuard`) : même fenêtre liée à la session qu'`/admin`.
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
    NormalizedInvoicingStateReader,
    FiscalProfileService,
    PointsOfSaleService,
    NormalizedInvoicingService,
    ReferenceDataService,
  ],
  // `NormalizedInvoicingStateReader` : lecture seule de l'environnement DGI de
  // l'organisation, consommée par `sales/` (ADR-0022 § S25c.4).
  // `FiscalProfileService` : fiche vendeur figée au gel d'une facture (ADR-0023 § S25e.6).
  exports: [
    NormalizedInvoicingService,
    PointsOfSaleService,
    NormalizedInvoicingStateReader,
    FiscalProfileService,
  ],
})
export class FiscalModule {}
