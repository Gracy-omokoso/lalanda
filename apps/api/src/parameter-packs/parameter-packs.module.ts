import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ParameterPacksController } from './parameter-packs.controller.js';

@Module({
  imports: [OrganizationsModule],
  controllers: [ParameterPacksController],
})
export class ParameterPacksModule {}
