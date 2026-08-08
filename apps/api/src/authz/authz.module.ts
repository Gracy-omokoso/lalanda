// Module d'autorisation (S20a). `@Global` par nécessité : `PermissionsGuard` est
// déclaré dans les `@UseGuards` de presque tous les contrôleurs de l'application —
// l'alternative (importer AuthzModule dans neuf modules) n'apporte aucune
// information et se casse silencieusement au prochain contrôleur ajouté.

import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { AuditEvent, AuditEventSchema } from './audit-event.schema.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { AuthzService } from './authz.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import {
  PlatformRoleAssignment,
  PlatformRoleAssignmentSchema,
} from './platform-role-assignment.schema.js';

@Global()
@Module({
  imports: [
    // `Membership` vient d'OrganizationsModule, qui ré-exporte son MongooseModule.
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: PlatformRoleAssignment.name, schema: PlatformRoleAssignmentSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
    ]),
  ],
  controllers: [AuditController],
  providers: [AuthzService, AuditService, PermissionsGuard],
  exports: [AuthzService, AuditService, PermissionsGuard, MongooseModule],
})
export class AuthzModule {}
