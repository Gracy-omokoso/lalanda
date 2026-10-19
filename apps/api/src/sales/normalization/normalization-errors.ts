// Erreurs de normalisation exposées dans `normalization.lastError` — ADR-0024
// § 5 et § 9. Notre phrase d'abord ; le code et le libellé DGI, quand il y en a,
// sont conservés TELS QUE REÇUS à côté (l'interface affiche les deux).

import type { EdefFailure } from '../../edef/edef.types.js';
import {
  CATEGORY_MESSAGES,
  RETRYABLE_CATEGORIES,
  categoryOfDgiCode,
  type DgiBusinessCategory,
} from './dgi-error-policy.js';
import type { NormalizationError } from './normalization-recorder.js';

/** Libellé DGI conservé : le client e-MCF le porte dans `message` (ADR-0021 § 6). */
function dgiPart(failure: EdefFailure): { dgiErrorCode: string | null; dgiMessage: string | null } {
  return {
    dgiErrorCode: failure.dgiErrorCode,
    dgiMessage: failure.dgiErrorCode !== null ? failure.message : null,
  };
}

/** Aucune réponse sûre : le document passe en `uncertain` (jamais réessayable à la main). */
export function noResponseError(failure: EdefFailure | null): NormalizationError {
  const server = failure?.kind === 'server' || failure?.kind === 'business';
  return {
    code: 'EDEF_NO_RESPONSE',
    category: server ? 'server' : 'network',
    message: CATEGORY_MESSAGES.network,
    ...(failure ? dgiPart(failure) : { dgiErrorCode: null, dgiMessage: null }),
    retryable: false,
  };
}

/** Refus métier SÛR de la DGI (`uid` nul), selon la catégorie du § 5. */
export function businessRefusal(
  failure: EdefFailure,
  category: DgiBusinessCategory = categoryOfDgiCode(failure.dgiErrorCode),
): NormalizationError {
  return {
    code: `EDEF_REFUSED_${category.toUpperCase()}`,
    category,
    message: CATEGORY_MESSAGES[category],
    ...dgiPart(failure),
    retryable: RETRYABLE_CATEGORIES.has(category),
  };
}

export function tokenRejected(failure: EdefFailure | null): NormalizationError {
  return {
    code: 'EDEF_TOKEN_REJECTED',
    category: 'token_rejected',
    message: CATEGORY_MESSAGES.token_rejected,
    dgiErrorCode: failure?.dgiErrorCode ?? null,
    dgiMessage: null,
    retryable: true,
  };
}

export function totalsMismatch(failure: EdefFailure | null): NormalizationError {
  return {
    code: 'EDEF_TOTALS_MISMATCH',
    category: 'totals_mismatch',
    message: CATEGORY_MESSAGES.totals_mismatch,
    ...(failure ? dgiPart(failure) : { dgiErrorCode: null, dgiMessage: null }),
    retryable: false,
  };
}

/** Garde de délai (§ 3.6) : la réponse du `POST` est trop vieille pour confirmer sans risque. */
export function confirmDeadlineExceeded(): NormalizationError {
  return {
    code: 'EDEF_CONFIRM_DEADLINE',
    category: 'temporary',
    message:
      'La DGI a répondu trop tard pour que Lalanda confirme la facture sans risque : la demande a été annulée. Relancez la normalisation.',
    dgiErrorCode: null,
    dgiMessage: null,
    retryable: true,
  };
}

/** Rattrapage : aucune confirmation acceptée, la facture n'est PAS normalisée. */
export function notNormalizedAfterCheck(): NormalizationError {
  return {
    code: 'EDEF_NOT_NORMALIZED',
    category: 'network',
    message:
      'Après vérification auprès de la DGI, cette facture n’a pas été normalisée : vous pouvez relancer la normalisation.',
    dgiErrorCode: null,
    dgiMessage: null,
    retryable: true,
  };
}

export function precondition(
  code:
    | 'POINT_OF_SALE_NOT_ACTIVE'
    | 'SELLER_NIF_MISMATCH'
    | 'ISF_NOT_CONFIGURED'
    | 'REFERENCE_LISTS_UNAVAILABLE'
    | 'DGI_PRODUCTION_UNAVAILABLE'
    | 'CREDIT_NOTE_REFERENCE_MISSING'
    | 'REQUEST_NOT_BUILDABLE',
  message: string,
  retryable: boolean,
): NormalizationError {
  return {
    code,
    category: 'precondition',
    message,
    dgiErrorCode: null,
    dgiMessage: null,
    retryable,
  };
}

export function inProgressElsewhere(): NormalizationError {
  return {
    code: 'NORMALIZATION_IN_PROGRESS',
    category: 'precondition',
    message:
      'Une autre facture de l’entreprise est en cours de normalisation : relancez celle-ci dans quelques instants.',
    dgiErrorCode: null,
    dgiMessage: null,
    retryable: true,
  };
}

/** « Vérification nécessaire » : Lalanda ne sait pas si la DGI a normalisé. */
export function reviewRequired(message: string): NormalizationError {
  return {
    code: 'EDEF_REVIEW_REQUIRED',
    category: 'server',
    message,
    dgiErrorCode: null,
    dgiMessage: null,
    retryable: false,
  };
}
