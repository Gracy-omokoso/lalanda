// Gestionnaire de projets et de tâches du RUN — ADR-0039 (lot L1, API cœur).
//
// Routes sous `/work/…`. Lit les clients, opportunités et devis en LECTURE
// seule par la connexion (sans importer leurs modules, motif du CRM).
// `ObjectStorageService` (pièces jointes) et `SchedulerService` (rappels)
// viennent de modules globaux ; les notifications partent par le port
// `NOTIFICATIONS_PORT` (module générique du lot L2, facultatif ici).
//
// Points d'extension du lot L4a (`work/billing/**`, `work/margin/**`) : il
// importe ce module et réutilise `WorkProjectsService`, `WorkTasksService`,
// `WorkActivityService` et `WorkMembersService`, exportés ci-dessous.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { WorkActivityService } from './work-activity.service.js';
import { WorkAttachmentsController } from './work-attachments.controller.js';
import { WorkAttachmentsService } from './work-attachments.service.js';
import { WorkCommentsController } from './work-comments.controller.js';
import { WorkCommentsService } from './work-comments.service.js';
import { WorkMembersController } from './work-members.controller.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkNotifier } from './work-notifier.js';
import { WorkProjectsController } from './work-projects.controller.js';
import { WorkProjectsService } from './work-projects.service.js';
import { WorkDueRemindersJob } from './work-reminders.job.js';
import { WorkSettingsController } from './work-settings.controller.js';
import { WorkSettingsService } from './work-settings.service.js';
import { WorkTasksController } from './work-tasks.controller.js';
import { WorkTasksService } from './work-tasks.service.js';
import { WorkTimeController } from './work-time.controller.js';
import { WorkTimeService } from './work-time.service.js';
import {
  WorkActivity,
  WorkActivitySchema,
  WorkAttachment,
  WorkAttachmentSchema,
  WorkComment,
  WorkCommentSchema,
  WorkMemberRate,
  WorkMemberRateSchema,
  WorkProject,
  WorkProjectSchema,
  WorkSettings,
  WorkSettingsSchema,
  WorkTask,
  WorkTaskSchema,
  WorkTimeEntry,
  WorkTimeEntrySchema,
} from './work.schemas.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active ; `MembersService` et le modèle
    // `Membership` servent l'éligibilité des membres.
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: WorkSettings.name, schema: WorkSettingsSchema },
      { name: WorkProject.name, schema: WorkProjectSchema },
      { name: WorkTask.name, schema: WorkTaskSchema },
      { name: WorkComment.name, schema: WorkCommentSchema },
      { name: WorkAttachment.name, schema: WorkAttachmentSchema },
      { name: WorkTimeEntry.name, schema: WorkTimeEntrySchema },
      { name: WorkMemberRate.name, schema: WorkMemberRateSchema },
      { name: WorkActivity.name, schema: WorkActivitySchema },
    ]),
  ],
  controllers: [
    WorkSettingsController,
    WorkMembersController,
    WorkProjectsController,
    WorkTasksController,
    WorkCommentsController,
    WorkAttachmentsController,
    WorkTimeController,
  ],
  providers: [
    WorkMembersService,
    WorkActivityService,
    WorkNotifier,
    WorkSettingsService,
    WorkProjectsService,
    WorkTasksService,
    WorkCommentsService,
    WorkAttachmentsService,
    WorkTimeService,
    WorkDueRemindersJob,
  ],
  exports: [
    MongooseModule,
    WorkMembersService,
    WorkActivityService,
    WorkNotifier,
    WorkSettingsService,
    WorkProjectsService,
    WorkTasksService,
  ],
})
export class WorkModule {}
