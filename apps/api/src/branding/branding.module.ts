// Module d'identité visuelle — ADR-0028 § 7 ; paquets de modèle sur mesure — ADR-0029.
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
import {
  InvoiceTemplatePackage,
  InvoiceTemplatePackageSchema,
} from './template-packages.schema.js';
import { TemplatePackagesService } from './template-packages.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: OrganizationBrand.name, schema: OrganizationBrandSchema },
      { name: OrganizationBrandAsset.name, schema: OrganizationBrandAssetSchema },
      { name: InvoiceTemplatePackage.name, schema: InvoiceTemplatePackageSchema },
    ]),
  ],
  controllers: [BrandingController, BrandAssetImageController],
  providers: [BrandingService, TemplatePackagesService],
  exports: [BrandingService, TemplatePackagesService],
})
export class BrandingModule {}
