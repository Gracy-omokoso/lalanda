// Erreurs HTTP des comptes CRM (ADR-0040 § 3.1). ADR-0040 — C1.
//
// Même forme que les contrôleurs de ventes : `{ code, message, details? }`,
// message en français. Un compte d'une autre organisation répond 404, jamais 403.
// Codes stables : `CRM_ACCOUNT_ERROR_CODES` de `@lalanda/shared/crm`.

import { BadRequestException, NotFoundException } from '@nestjs/common';

import { conflict } from '../../sales/sales.errors.js';

export function accountNotFound(): never {
  throw new NotFoundException({ code: 'CRM_ACCOUNT_NOT_FOUND', message: 'Compte introuvable.' });
}

export function ownerNotFound(): never {
  throw new NotFoundException({
    code: 'CRM_MEMBER_NOT_FOUND',
    message: 'Membre introuvable dans cette organisation.',
  });
}

export function ownerNotEligible(): never {
  throw new BadRequestException({
    code: 'CRM_OWNER_NOT_ELIGIBLE',
    message: 'Le responsable d’un compte doit pouvoir gérer le CRM.',
  });
}

export function accountMerged(mergedInto: string): never {
  conflict('CRM_ACCOUNT_MERGED', 'Ce compte a été fusionné dans un autre compte.', {
    mergedInto,
  });
}

export function identityFromCustomer(): never {
  conflict(
    'CRM_ACCOUNT_IDENTITY_FROM_CUSTOMER',
    'Le nom d’un compte client vient de sa fiche client : modifiez-la dans Ventes.',
  );
}

export function followsCustomer(): never {
  conflict(
    'CRM_ACCOUNT_FOLLOWS_CUSTOMER',
    'Un compte client suit sa fiche client : archivez ou supprimez la fiche dans Ventes.',
  );
}

export function notProspect(): never {
  conflict('CRM_ACCOUNT_NOT_PROSPECT', 'Seul un prospect peut être converti ou fusionné.');
}

export function mergeIntoSelf(): never {
  conflict('CRM_ACCOUNT_MERGE_INTO_SELF', 'Un compte ne peut pas être fusionné dans lui-même.');
}

export function accountInUse(details: Record<string, number>): never {
  conflict(
    'CRM_ACCOUNT_IN_USE',
    'Ce compte a des contacts, des opportunités ou des activités : archivez-le ou fusionnez-le.',
    details,
  );
}
