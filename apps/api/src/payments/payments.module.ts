// Module paiements (S22b).
//
// Tout est câblé par `useFactory` et jamais par injection de type. Deux raisons,
// toutes deux constatées dans ce dépôt :
//
//  1. vitest n'émet pas `emitDecoratorMetadata` — l'injection par type de
//     constructeur y est silencieusement vide. Le reste du code applique déjà
//     cette discipline (`@Inject` explicite dans AuthGuard, BillingController);
//  2. les fournisseurs de paiement prennent des dépendances qui ne sont pas des
//     classes Nest (une fonction HTTP, un résolveur de secrets). Un jeton
//     explicite les rend remplaçables en test sans toucher au module.
//
// ── Point d'extension prévu ──────────────────────────────────────────────────
//
// Le jour où `apps/api/src/integrations/` livre son `SecretsService` (ADR-0013),
// la bascule tient en une ligne : remplacer la fabrique de `PAYMENT_SECRETS` par
// `new LayeredPaymentSecrets(secretsService, new EnvPaymentSecrets())`. Aucun
// fournisseur de paiement ne change, aucun test ne change.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BillingModule } from '../billing/billing.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { nodeHttpClient, PAYMENT_HTTP, type HttpClient } from './http.js';
import { ManualProvider } from './manual.provider.js';
import { ManualPaymentRequest, ManualPaymentRequestSchema } from './manual-payment.schema.js';
import { PayPalProvider } from './paypal.provider.js';
import { PaymentEvent, PaymentEventSchema } from './payment-event.schema.js';
import type { PaymentProvider } from './payment-provider.js';
import {
  EnvPaymentSecrets,
  PAYMENT_SECRETS,
  type PaymentSecretsResolver,
} from './payment-secrets.js';
import { PaymentsController } from './payments.controller.js';
import { PAYMENT_PROVIDER_REGISTRY, PaymentsService } from './payments.service.js';
import { StripeProvider } from './stripe.provider.js';

const STRIPE_PROVIDER = Symbol('STRIPE_PROVIDER');
const PAYPAL_PROVIDER = Symbol('PAYPAL_PROVIDER');
const MANUAL_PROVIDER = Symbol('MANUAL_PROVIDER');

@Module({
  imports: [
    // `AuthGuard` (routes d'administration) résout l'organisation active.
    OrganizationsModule,
    BillingModule,
    MongooseModule.forFeature([
      { name: PaymentEvent.name, schema: PaymentEventSchema },
      { name: ManualPaymentRequest.name, schema: ManualPaymentRequestSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [
    {
      provide: PAYMENT_SECRETS,
      // Repli environnement tant qu'`IntegrationsService` n'existe pas
      // (ADR-0013 §C, « base d'abord, environnement en secours »).
      useFactory: (): PaymentSecretsResolver => new EnvPaymentSecrets(),
    },
    {
      provide: PAYMENT_HTTP,
      useFactory: (): HttpClient => nodeHttpClient(),
    },
    {
      provide: STRIPE_PROVIDER,
      useFactory: (secrets: PaymentSecretsResolver, http: HttpClient) =>
        new StripeProvider(secrets, http),
      inject: [PAYMENT_SECRETS, PAYMENT_HTTP],
    },
    {
      provide: PAYPAL_PROVIDER,
      useFactory: (secrets: PaymentSecretsResolver, http: HttpClient) =>
        new PayPalProvider(secrets, http),
      inject: [PAYMENT_SECRETS, PAYMENT_HTTP],
    },
    {
      provide: MANUAL_PROVIDER,
      useFactory: (secrets: PaymentSecretsResolver) => new ManualProvider(secrets),
      inject: [PAYMENT_SECRETS],
    },
    {
      provide: PAYMENT_PROVIDER_REGISTRY,
      useFactory: (stripe: PaymentProvider, paypal: PaymentProvider, manual: PaymentProvider) => ({
        stripe,
        paypal,
        manual,
      }),
      inject: [STRIPE_PROVIDER, PAYPAL_PROVIDER, MANUAL_PROVIDER],
    },
    PaymentsService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
