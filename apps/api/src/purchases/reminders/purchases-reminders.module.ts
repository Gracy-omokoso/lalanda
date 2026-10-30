// Rappels d'échéance des factures fournisseurs — ADR-0044 § 6.5. ADR-0044 — P6.
//
// Module à part : lecture seule des factures, paiements, réglages et adhésions par la
// connexion ; seule écriture, ses réclamations (`purchase_due_reminders`). Le port de
// notifications et l'ordonnanceur sont globaux.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PurchaseDueReminder, PurchaseDueReminderSchema } from './purchase-due-reminder.schema.js';
import { PurchasesDueRemindersJob } from './purchases-reminders.job.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PurchaseDueReminder.name, schema: PurchaseDueReminderSchema },
    ]),
  ],
  providers: [PurchasesDueRemindersJob],
  exports: [PurchasesDueRemindersJob],
})
export class PurchasesRemindersModule {}
