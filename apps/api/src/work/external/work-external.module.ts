// Membres externes d'un projet et espace externe — ADR-0078.
//
// Importe `WorkModule` (modèles, services des projets, des tâches, du temps, des feuilles
// de temps, cycle de vie des accès externes). Trois contrôleurs :
//   - `WorkExternalController` : gestion côté ERP (`/work/...`, garde de l'ERP) ;
//   - `PortalAuthController`   : connexion par code (`/portal/auth/...`, publique, bornée) ;
//   - `PortalController`       : espace externe (`/portal/...`, session externe seulement).

import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { WorkModule } from '../work.module.js';
import { ExternalAuthGuard } from './external-auth.guard.js';
import { PortalAuthController } from './portal-auth.controller.js';
import { PortalController } from './portal.controller.js';
import { WorkExternalAuthService } from './work-external-auth.service.js';
import { WorkExternalController } from './work-external.controller.js';
import { WorkExternalMembersService } from './work-external-members.service.js';
import {
  ExternalRequestEmailThrottlerGuard,
  ExternalRequestIpThrottlerGuard,
  ExternalVerifyEmailThrottlerGuard,
  ExternalVerifyIpThrottlerGuard,
} from './work-external-throttler.guard.js';
import { WorkPortalService } from './work-portal.service.js';

@Module({
  imports: [
    // `AuthGuard` (routes ERP) résout l'organisation active.
    OrganizationsModule,
    WorkModule,
  ],
  controllers: [WorkExternalController, PortalAuthController, PortalController],
  providers: [
    WorkExternalMembersService,
    WorkExternalAuthService,
    WorkPortalService,
    ExternalAuthGuard,
    ExternalRequestIpThrottlerGuard,
    ExternalRequestEmailThrottlerGuard,
    ExternalVerifyIpThrottlerGuard,
    ExternalVerifyEmailThrottlerGuard,
  ],
})
export class WorkExternalModule {}
