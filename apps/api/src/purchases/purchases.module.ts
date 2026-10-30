// Achats et fournisseurs — ADR-0044 (application RUN `/achats`, module API
// `/purchases/…`). Créé par le lot P2 ; les lots P3 à P6 ajoutent chacun leurs
// lignes dans `controllers`, `providers` et `forFeature`, sous leur commentaire.
//
// Le trousseau `MASTER_KEYRING` (ADR-0013) est fourni ici par le même fournisseur
// que le module des intégrations : une fabrique sans état qui lit l'environnement,
// sans dépendre de ce module ni rien en exporter.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { MasterKeyringProvider } from '../integrations/keyring.provider.js';
import { Membership, MembershipSchema } from '../organizations/membership.schema.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
// ADR-0044 — P2
import {
  SUPPLIER_PAYABLES_SOURCE,
  noSupplierPayables,
} from './suppliers/supplier-payables.port.js';
import { Supplier, SupplierSchema } from './suppliers/supplier.schema.js';
import { PurchaseSuppliersController } from './suppliers/purchase-suppliers.controller.js';
import { SuppliersNotifier } from './suppliers/suppliers-notifier.js';
import { SuppliersService } from './suppliers/suppliers.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    MongooseModule.forFeature([
      // ADR-0044 — P2 : fiches fournisseurs ; adhésions (destinataires des alertes).
      { name: Supplier.name, schema: SupplierSchema },
      { name: Membership.name, schema: MembershipSchema },
    ]),
  ],
  controllers: [
    // ADR-0044 — P2
    PurchaseSuppliersController,
  ],
  providers: [
    MasterKeyringProvider,
    // ADR-0044 — P2 : fiches, coordonnées chiffrées, fusion. Reste dû : fournisseur
    // nul jusqu'aux factures et paiements (P4, P5), qui le remplaceront.
    SuppliersService,
    SuppliersNotifier,
    { provide: SUPPLIER_PAYABLES_SOURCE, useValue: noSupplierPayables },
  ],
  exports: [SuppliersService],
})
export class PurchasesModule {}
