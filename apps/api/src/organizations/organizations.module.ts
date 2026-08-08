import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Invitation, InvitationSchema } from './invitation.schema.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { Membership, MembershipSchema } from './membership.schema.js';
import { Organization, OrganizationSchema } from './organization.schema.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
  ],
  controllers: [OrganizationsController, InvitationsController, MembersController],
  providers: [OrganizationsService, InvitationsService, MembersService],
  exports: [OrganizationsService, InvitationsService, MembersService, MongooseModule],
})
export class OrganizationsModule {}
