import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccountAuthGuard } from '../account/account-auth.guard.js';
import { LegalController } from './legal.controller.js';
import { LegalService } from './legal.service.js';
import { TermsAcceptance, TermsAcceptanceSchema } from './terms-acceptance.schema.js';

/**
 * Module légal (S22c) — preuve d'acceptation des conditions.
 *
 * Périmètre volontairement minuscule : les TEXTES sont des pages statiques du
 * web, versionnées dans le dépôt. Seule la preuve d'acceptation a besoin d'un
 * serveur, et rien d'autre n'est ajouté ici.
 *
 * `AccountAuthGuard` est déclaré en provider et non importé d'un module : c'est
 * un guard sans dépendance, et le déclarer évite de faire de `AccountModule` une
 * dépendance du module légal pour une classe de vingt lignes. Le module compte
 * n'est pas modifié.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: TermsAcceptance.name, schema: TermsAcceptanceSchema }]),
  ],
  controllers: [LegalController],
  providers: [LegalService, AccountAuthGuard],
  exports: [LegalService],
})
export class LegalModule {}
