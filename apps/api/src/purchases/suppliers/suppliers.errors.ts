// Erreurs HTTP des fournisseurs (ADR-0044 § 3.1). ADR-0044 — P2.
//
// Même forme que les contrôleurs de ventes et du CRM : `{ code, message, details? }`,
// message en français. Une fiche d'une autre organisation répond 404, jamais 403.

import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { conflict } from '../../sales/sales.errors.js';

/** Codes propres au lot P2, en plus de ceux nommés par l'ADR (`PURCHASE_ERROR_CODES`). */
export const SUPPLIER_P2_ERROR_CODES = [
  'SUPPLIER_NOT_FOUND',
  'SUPPLIER_MERGED',
  'SUPPLIER_ARCHIVED',
  'SUPPLIER_MERGE_INTO_SELF',
  'SUPPLIER_MERGE_NIF_MISMATCH',
  'SUPPLIER_PAYMENT_METHOD_NOT_FOUND',
  'SUPPLIER_PAYMENT_METHODS_LIMIT',
  'SUPPLIER_PAYMENT_METHOD_KIND_MISMATCH',
  'SUPPLIER_MIGRATION_REPORT_NOT_FOUND',
  'CATEGORY_UNKNOWN',
] as const;

export function supplierNotFound(): never {
  throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Fournisseur introuvable.' });
}

export function paymentMethodNotFound(): never {
  throw new NotFoundException({
    code: 'SUPPLIER_PAYMENT_METHOD_NOT_FOUND',
    message: 'Moyen de paiement introuvable.',
  });
}

export function supplierMerged(mergedInto: string): never {
  conflict('SUPPLIER_MERGED', 'Cette fiche a été fusionnée dans une autre fiche.', { mergedInto });
}

export function supplierArchived(): never {
  conflict('SUPPLIER_ARCHIVED', 'Ce fournisseur est archivé : restaurez-le avant de l’utiliser.');
}

export function nifExists(supplierId: string): never {
  conflict('SUPPLIER_NIF_EXISTS', 'Un autre fournisseur porte déjà ce NIF.', { supplierId });
}

export function mergeIntoSelf(): never {
  conflict('SUPPLIER_MERGE_INTO_SELF', 'Une fiche ne peut pas être fusionnée dans elle-même.');
}

export function mergeNifMismatch(): never {
  conflict(
    'SUPPLIER_MERGE_NIF_MISMATCH',
    'Ces deux fiches portent des NIF différents : ce ne sont pas le même fournisseur.',
  );
}

export function supplierInUse(details: Record<string, number>): never {
  conflict(
    'SUPPLIER_IN_USE',
    'Ce fournisseur a des commandes, des factures, des paiements ou des dépenses : archivez-le ou fusionnez-le.',
    details,
  );
}

export function supplierHasOpenPayables(): never {
  conflict(
    'SUPPLIER_HAS_OPEN_PAYABLES',
    'Ce fournisseur a des factures validées non soldées : réglez-les avant de l’archiver.',
  );
}

export function paymentMethodsLimit(max: number): never {
  conflict('SUPPLIER_PAYMENT_METHODS_LIMIT', `${max} moyens de paiement au plus par fournisseur.`);
}

export function paymentMethodKindMismatch(): never {
  conflict(
    'SUPPLIER_PAYMENT_METHOD_KIND_MISMATCH',
    'La nature d’un moyen de paiement ne change pas : retirez-le et ajoutez-en un autre.',
  );
}

/** Sans trousseau configuré, rien n'est stocké en clair : l'écriture est refusée. */
export function secretsNotConfigured(): never {
  throw new ServiceUnavailableException({
    code: 'SECRETS_NOT_CONFIGURED',
    message:
      'Le coffre de chiffrement n’est pas configuré : les coordonnées de paiement ne peuvent pas être enregistrées.',
  });
}
