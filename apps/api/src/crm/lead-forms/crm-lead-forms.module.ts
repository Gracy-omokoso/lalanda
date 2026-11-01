// Formulaire public de prospects — ADR-0048. Module PROPRE (motif de
// `CrmOverviewModule`) : il compose le CRM (comptes, contacts, activités,
// opportunités), les membres du module work (éligibilité du responsable) et
// l'identité visuelle (logo de la page publique).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BrandingModule } from '../../branding/branding.module.js';
import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { WorkModule } from '../../work/work.module.js';
import { CrmModule } from '../crm.module.js';
import { CrmActivity, CrmActivitySchema } from '../crm.schemas.js';
import { CrmLeadFormsController } from './crm-lead-forms.controller.js';
import { CrmLeadFormsService } from './crm-lead-forms.service.js';
import {
  LeadFormFormThrottlerGuard,
  LeadFormIpThrottlerGuard,
} from './lead-form-throttler.guard.js';
import {
  CrmLeadForm,
  CrmLeadFormSchema,
  CrmLeadSubmission,
  CrmLeadSubmissionSchema,
} from './lead-form.schema.js';
import { LeadIntakeService } from './lead-intake.service.js';
import { PublicLeadFormsController } from './public-lead-forms.controller.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    CrmModule,
    WorkModule,
    BrandingModule,
    MongooseModule.forFeature([
      { name: CrmLeadForm.name, schema: CrmLeadFormSchema },
      { name: CrmLeadSubmission.name, schema: CrmLeadSubmissionSchema },
      // Compte posé sur l'activité créée (fil du compte).
      { name: CrmActivity.name, schema: CrmActivitySchema },
    ]),
  ],
  controllers: [CrmLeadFormsController, PublicLeadFormsController],
  providers: [
    CrmLeadFormsService,
    LeadIntakeService,
    LeadFormIpThrottlerGuard,
    LeadFormFormThrottlerGuard,
  ],
})
export class CrmLeadFormsModule {}
