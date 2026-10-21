// Module d'identité visuelle — ADR-0028 § 7.
//
// Exporte `BrandingService`, consommé par `sales/` : le gel d'une facture fige
// la présentation, le rendu PDF résout logos et modèle. Le stockage objet est
// fourni par `StorageModule` (@Global), l'audit par `AuthzModule` (@Global).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { BrandAssetImageController } from './brand-asset-image.controller.js';
import { BrandingController } from './branding.controller.js';
import {
  OrganizationBrand,
  OrganizationBrandAsset,
  OrganizationBrandAssetSchema,
  OrganizationBrandSchema,
} from './branding.schema.js';
import { BrandingService } from './branding.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: OrganizationBrand.name, schema: OrganizationBrandSchema },
      { name: OrganizationBrandAsset.name, schema: OrganizationBrandAssetSchema },
    ]),
  ],
  controllers: [BrandingController, BrandAssetImageController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
