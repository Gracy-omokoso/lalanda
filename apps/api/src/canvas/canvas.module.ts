import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { CanvasController } from './canvas.controller.js';
import { Canvas, CanvasRevision, CanvasRevisionSchema, CanvasSchema } from './canvas.schema.js';
import { CanvasService } from './canvas.service.js';

@Module({
  imports: [
    OrganizationsModule,
    ProjectsModule,
    MongooseModule.forFeature([
      { name: Canvas.name, schema: CanvasSchema },
      { name: CanvasRevision.name, schema: CanvasRevisionSchema },
    ]),
  ],
  controllers: [CanvasController],
  providers: [CanvasService],
  exports: [CanvasService],
})
export class CanvasModule {}
