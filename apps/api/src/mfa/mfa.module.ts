// Module MFA (S22h — docs/17 § Identité).
//
// ── Ce que ce module N'IMPORTE PAS, et pourquoi ───────────────────────────────
//
// Ni `AuthzModule` ni `IntegrationsModule`. `AuthzModule` importe CE module —
// `PermissionsGuard` a besoin de `MfaGateService` — et l'importer en retour
// fermerait un cycle, que Nest signale de la plus obscure des façons : une
// dépendance injectée à `undefined` au démarrage, donc un garde qui laisse
// passer au lieu de refuser. Un cycle dans le graphe d'un contrôle d'accès n'est
// pas un problème d'élégance.
//
// `AuthzModule` et `AuthModule` étant `@Global`, leurs exports (`AuthzService`,
// `AuthGuard`) restent disponibles ici sans import — c'est précisément ce à quoi
// sert leur globalité.
//
// De `integrations/`, ce module ne prend que du CODE (la primitive
// `secrets-crypto.ts` et le fournisseur de trousseau), jamais un provider
// exporté : il déclare `MasterKeyringProvider` pour son propre compte. Le
// trousseau est construit depuis l'environnement par une fonction pure
// (`keyringFromEnv`), deux instances lisent donc les mêmes clés — il n'y a pas
// deux sources de vérité, seulement deux lecteurs de la même.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { MasterKeyringProvider } from '../integrations/keyring.provider.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { MfaGateService } from './mfa-gate.service.js';
import { MfaCredential, MfaCredentialSchema } from './mfa-credential.schema.js';
import { MfaVerification, MfaVerificationSchema } from './mfa-verification.schema.js';
import { MfaController } from './mfa.controller.js';
import { MfaService } from './mfa.service.js';

@Module({
  imports: [
    // Requis pour instancier `AuthGuard`, qui dépend d'`OrganizationsService` —
    // même raison que dans `IntegrationsModule`.
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: MfaCredential.name, schema: MfaCredentialSchema },
      { name: MfaVerification.name, schema: MfaVerificationSchema },
    ]),
  ],
  controllers: [MfaController],
  providers: [MasterKeyringProvider, MfaService, MfaGateService],
  // `MfaGateService` est exporté pour `AuthzModule` (le garde) ; `MfaService`
  // pour `AccountModule`, qui purge le facteur à la suppression de compte.
  // `MongooseModule` est ré-exporté pour que ces consommateurs n'aient pas à
  // redéclarer les modèles.
  exports: [MfaGateService, MfaService, MongooseModule],
})
export class MfaModule {}
