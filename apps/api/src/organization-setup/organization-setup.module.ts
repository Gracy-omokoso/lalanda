// Mise en route d'une société — statut de complétude (ADR-0052 § 3). ADR-0052 — O0.
//
// Module de LECTURE : il agrège les services qui gardent les actes (fiscal, comptabilité)
// et lit l'existence de quelques documents d'autres modules. Les modèles qui ne sont pas
// exportés par leur module propriétaire (réglages d'affichage, comptes de trésorerie) sont
// ré-enregistrés ici EN LECTURE — même pattern qu'`OrganizationSpaceModule` (@nestjs/mongoose
// déduplique les modèles par connexion) : aucune ligne de `treasury/` ni
// `organization-space/` ne change (critère 19).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccountingModule } from '../accounting/accounting.module.js';
import { BrandingModule } from '../branding/branding.module.js';
import { FiscalModule } from '../fiscal/fiscal.module.js';
import {
  OrganizationSettings,
  OrganizationSettingsSchema,
} from '../organization-space/organization-settings.schema.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { TreasuryAccount, TreasuryAccountSchema } from '../treasury/treasury.schemas.js';
import { OrganizationSetupController } from './organization-setup.controller.js';
// ADR-0052 — O1 : avancement par organisation (sélecteur).
import { OrganizationSetupProgressController } from './organization-setup-progress.controller.js';
// ADR-0052 — O2 : déclarations de § 4, écrivain unique.
import { OrganizationSetup, OrganizationSetupSchema } from './organization-setup.schema.js';
import { OrganizationSetupService } from './organization-setup.service.js';

@Module({
  imports: [
    // `AuthGuard` ; modèles `Membership` et `Invitation` (lecture).
    OrganizationsModule,
    // `FiscalProfileService`, `NormalizedInvoicingService`, `NormalizedInvoicingStateReader`.
    FiscalModule,
    // `AccountingSettingsService` et le modèle `AccountingSettings` (lecture).
    AccountingModule,
    // `BrandingService.state` (identité visuelle).
    BrandingModule,
    MongooseModule.forFeature([
      { name: OrganizationSettings.name, schema: OrganizationSettingsSchema },
      { name: TreasuryAccount.name, schema: TreasuryAccountSchema },
      { name: OrganizationSetup.name, schema: OrganizationSetupSchema },
    ]),
  ],
  controllers: [OrganizationSetupController, OrganizationSetupProgressController],
  providers: [OrganizationSetupService],
})
export class OrganizationSetupModule {}
