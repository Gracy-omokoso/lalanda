// Erreurs HTTP des demandes et commandes (ADR-0044 § 2.3, § 3.2). ADR-0044 — P3.
//
// Forme des contrôleurs de ventes et du CRM : `{ code, message, details? }`. Une
// demande d'une autre organisation répond 404, jamais 403.

import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { forbidden } from '../../authz/authz.service.js';
import { conflict } from '../../sales/sales.errors.js';

export function orderNotFound(): never {
  throw new NotFoundException({
    code: 'PURCHASE_ORDER_NOT_FOUND',
    message: 'Demande ou commande introuvable.',
  });
}

export function workProjectUnknown(): never {
  throw new NotFoundException({
    code: 'PURCHASE_WORK_PROJECT_UNKNOWN',
    message: 'Projet introuvable ou archivé dans cette organisation.',
  });
}

export function orderStatusConflict(status: string, message: string): never {
  conflict('PURCHASE_ORDER_STATUS', message, { status });
}

export function notEditable(status: string): never {
  conflict(
    'PURCHASE_ORDER_NOT_EDITABLE',
    'Cette commande n’est plus modifiable : annulez le reste et faites-en une autre.',
    { status },
  );
}

/** Geste réservé à `purchase.manage` hors de sa propre demande en brouillon. */
export function requiresManage(role: string | null): never {
  throw new ForbiddenException(forbidden('purchase.manage', role));
}
