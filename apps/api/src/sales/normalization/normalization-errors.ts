// Erreurs de normalisation exposées dans `normalization.lastError` — ADR-0024
// § 5 et § 9. Notre phrase d'abord ; le code et le libellé DGI, quand il y en a,
// sont conservés TELS QUE REÇUS à côté (l'interface affiche les deux).

import {
  EDEF_CATEGORY_RULES,
  describeEdefError,
  type EdefErrorCategory,
} from '../../edef/edef-errors.js';
import type { EdefFailure } from '../../edef/edef.types.js';
import type { NormalizationError } from './normalization-recorder.js';

/** Nos phrases pour ce qui n'est pas un code de l'annexe DGI (transport, prérequis). */
export const NORMALIZATION_MESSAGES = {
  noResponse:
    'La DGI n’a pas répondu : Lalanda vérifie auprès d’elle. Ne refaites pas cette vente en attendant.',
  tokenRejected:
    'La DGI a refusé le jeton du point de vente : renouvelez-le, puis relancez la normalisation.',
  totalsMismatch:
    'Écart de calcul entre Lalanda et la DGI : la facture a été annulée auprès de la DGI. L’équipe Lalanda est prévenue.',
} as const;

/** Catégorie d'un code DGI (table du client e-MCF, F1). */
export function categoryOfDgiCode(code: string | null): EdefErrorCategory {
  return code === null ? 'unknown' : describeEdefError(code).category;
}

/** Alerte plateforme pour cette catégorie (table du client e-MCF, F1). */
export function isPlatformAlert(category: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(EDEF_CATEGORY_RULES, category) &&
    EDEF_CATEGORY_RULES[category as EdefErrorCategory].platformAlert
  );
}

/** Code et libellé DGI TELS QUE REÇUS (client e-MCF, `dgiErrorDesc`). */
function dgiPart(failure: EdefFailure): { dgiErrorCode: string | null; dgiMessage: string | null } {
  return {
    dgiErrorCode: failure.dgiErrorCode,
    dgiMessage: failure.dgiErrorDesc ?? null,
  };
}

/** Aucune réponse sûre : le document passe en `uncertain` (jamais réessayable à la main). */
export function noResponseError(failure: EdefFailure | null): NormalizationError {
  const server =
    failure?.kind === 'server' ||
    failure?.kind === 'invalid_response' ||
    failure?.kind === 'business';
  return {
    code: 'EDEF_NO_RESPONSE',
    category: server ? 'server' : 'network',
    message: NORMALIZATION_MESSAGES.noResponse,
    ...(failure ? dgiPart(failure) : { dgiErrorCode: null, dgiMessage: null }),
    retryable: false,
  };
}

/** Refus métier SÛR de la DGI (`uid` nul) : catégorie, message et conduite de la table F1. */
export function businessRefusal(failure: EdefFailure): NormalizationError {
  const d = describeEdefError(failure.dgiErrorCode ?? '');
  return {
    code: `EDEF_REFUSED_${d.category.toUpperCase()}`,
    category: d.category,
    message: d.message,
    ...dgiPart(failure),
    retryable: d.retryable,
  };
}

export function tokenRejected(failure: EdefFailure | null): NormalizationError {
  return {
    code: 'EDEF_TOKEN_REJECTED',
    category: 'token_rejected',
    message: NORMALIZATION_MESSAGES.tokenRejected,
    dgiErrorCode: failure?.dgiErrorCode ?? null,
    dgiMessage: null,
    retryable: true,
  };
}

export function totalsMismatch(failure: EdefFailure | null): NormalizationError {
  return {
    code: 'EDEF_TOTALS_MISMATCH',
    category: 'totals_mismatch',
    message: NORMALIZATION_MESSAGES.totalsMismatch,
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

/** Journal des échanges indisponible : rien n'est parti (ADR-0024 O4). */
export function journalUnavailable(): NormalizationError {
  return {
    code: 'EDEF_JOURNAL_UNAVAILABLE',
    category: 'precondition',
    message:
      'Lalanda n’a pas pu enregistrer l’échange avec la DGI : rien n’a été envoyé. Réessayez dans quelques instants.',
    dgiErrorCode: null,
    dgiMessage: null,
    retryable: true,
  };
}
