// ADR-0047 : factures des abonnements Lalanda, émises par l'organisation vendeuse
// avec le circuit des ventes. S'inscrit auprès de `PaymentsService` au démarrage
// (`onPaymentSucceeded`) : `payments/` ne dépend d'aucun module de ventes.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminModule } from '../admin/admin.module.js';
import { Subscription, SubscriptionSchema } from '../billing/subscription.schema.js';
import { FiscalModule } from '../fiscal/fiscal.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import {
  ManualPaymentRequest,
  ManualPaymentRequestSchema,
} from '../payments/manual-payment.schema.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { Customer, CustomerSchema } from '../sales/customer.schema.js';
import { SalesModule } from '../sales/sales.module.js';
import { PlatformSubscriptionInvoicesController } from './platform-subscription-invoices.controller.js';
import {
  SubscriptionBillingProfile,
  SubscriptionBillingProfileSchema,
  SubscriptionInvoiceCustomer,
  SubscriptionInvoiceCustomerSchema,
} from './subscription-billing-profile.schema.js';
import { SubscriptionInvoice, SubscriptionInvoiceSchema } from './subscription-invoice.schema.js';
import { SubscriptionInvoicesController } from './subscription-invoices.controller.js';
import {
  SubscriptionInvoicingSettings,
  SubscriptionInvoicingSettingsSchema,
} from './subscription-invoicing-settings.schema.js';
import { SubscriptionInvoicingService } from './subscription-invoicing.service.js';

@Module({
  imports: [
    OrganizationsModule,
    IntegrationsModule,
    AdminModule,
    PaymentsModule,
    FiscalModule,
    SalesModule,
    MongooseModule.forFeature([
      { name: SubscriptionInvoice.name, schema: SubscriptionInvoiceSchema },
      { name: SubscriptionInvoicingSettings.name, schema: SubscriptionInvoicingSettingsSchema },
      { name: SubscriptionBillingProfile.name, schema: SubscriptionBillingProfileSchema },
      { name: SubscriptionInvoiceCustomer.name, schema: SubscriptionInvoiceCustomerSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: ManualPaymentRequest.name, schema: ManualPaymentRequestSchema },
    ]),
  ],
  controllers: [SubscriptionInvoicesController, PlatformSubscriptionInvoicesController],
  providers: [SubscriptionInvoicingService],
})
export class SubscriptionInvoicesModule {}
