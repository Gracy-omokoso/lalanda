// Équipes (ADR-0060 § 2), module autonome importé par `HrModule`.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { HrTeamsController } from './hr-teams.controller.js';
import { HrTeamsService } from './hr-teams.service.js';
import { Team, TeamSchema } from './team.schema.js';

@Module({
  imports: [
    // `AuthGuard` (organisation active), `MembersService` (noms) et `Membership`.
    OrganizationsModule,
    MongooseModule.forFeature([{ name: Team.name, schema: TeamSchema }]),
  ],
  controllers: [HrTeamsController],
  providers: [HrTeamsService],
  exports: [HrTeamsService],
})
export class HrTeamsModule {}
