// Erreurs HTTP du CRM — ADR-0035 § 4. Même forme que le module ventes :
// `{ code, message, details? }`, message en français ; une ressource d'une autre
// organisation répond 404, jamais 403.

import { NotFoundException } from '@nestjs/common';

export function contactNotFound(): never {
  throw new NotFoundException({ code: 'CRM_CONTACT_NOT_FOUND', message: 'Contact introuvable.' });
}

export function opportunityNotFound(): never {
  throw new NotFoundException({
    code: 'CRM_OPPORTUNITY_NOT_FOUND',
    message: 'Opportunité introuvable.',
  });
}

export function activityNotFound(): never {
  throw new NotFoundException({ code: 'CRM_ACTIVITY_NOT_FOUND', message: 'Activité introuvable.' });
}
