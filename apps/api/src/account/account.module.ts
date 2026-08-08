import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Membership, MembershipSchema } from '../organizations/membership.schema.js';
import { Organization, OrganizationSchema } from '../organizations/organization.schema.js';
import { AccountAuthGuard } from './account-auth.guard.js';
import { AccountSessionsService } from './account-sessions.service.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { EmailChangeRequest, EmailChangeRequestSchema } from './email-change.schema.js';
import { EmailChangeService } from './email-change.service.js';
import { EmailVerificationController } from './email-verification.controller.js';
import { UserPreferences, UserPreferencesSchema } from './user-preferences.schema.js';

/**
 * Espace compte (S20b) — profil, sécurité, sessions, préférences.
 *
 * `Membership` et `Organization` sont enregistrés ici en LECTURE des schémas
 * définis par le module organisations : la règle du dernier propriétaire
 * (docs/12, ADR-0012) impose de compter les propriétaires d'une organisation
 * avant d'autoriser une suppression de compte. Les schémas sont importés tels
 * quels, sans modification — la refonte RBAC en cours dans `organizations/` reste
 * seule propriétaire de leur définition.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserPreferences.name, schema: UserPreferencesSchema },
      { name: EmailChangeRequest.name, schema: EmailChangeRequestSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [AccountController, EmailVerificationController],
  providers: [AccountService, AccountSessionsService, EmailChangeService, AccountAuthGuard],
  exports: [AccountService],
})
export class AccountModule {}
