// Erreurs HTTP du module fiscal — ADR-0021 §10.
//
// Forme des contrôleurs existants : `{ code, message, details? }`, message en
// français. Toute erreur issue d'une réponse DGI porte `details.dgiErrorCode` et
// `details.dgiMessage` (assaini) : la DGI exige que le code et le libellé soient
// montrés à l'utilisateur.

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ZodError } from 'zod';

import { VaultUnavailableError } from '../integrations/organization-secrets.port.js';
import type { EdefFailure } from '../edef/edef.types.js';
import { issuesOf } from './fiscal.dto.js';

export function invalidRequest(error: ZodError, message = 'Corps de requête invalide.'): never {
  throw new BadRequestException({
    code: 'INVALID_REQUEST',
    message,
    details: { issues: issuesOf(error) },
  });
}

export function conflict(code: string, message: string, details?: Record<string, unknown>): never {
  throw new ConflictException({ code, message, ...(details ? { details } : {}) });
}

export function pointOfSaleNotFound(): never {
  throw new NotFoundException({
    code: 'POINT_OF_SALE_NOT_FOUND',
    message: 'Point de vente introuvable.',
  });
}

export function productionUnavailable(): never {
  conflict(
    'DGI_PRODUCTION_UNAVAILABLE',
    'La production sera ouverte après l’homologation de Lalanda par la DGI.',
  );
}

/** Codes 422 du test d'un jeton (ADR-0021 §4.1). */
export type TokenCheckCode =
  | 'EMCF_TOKEN_REJECTED'
  | 'EMCF_STATUS_FALSE'
  | 'EMCF_NIF_MISMATCH'
  | 'EMCF_NIM_MISMATCH'
  | 'EMCF_TOKEN_EXPIRED'
  | 'EMCF_DISABLED_AT_DGI'
  | 'EDEF_INVALID_RESPONSE';

/** Résultat négatif d'un test de jeton, avant traduction HTTP. */
export interface TokenCheckFailure {
  ok: false;
  /** 422, 502 ou 409 (production fermée). */
  http: 409 | 422 | 502;
  code: TokenCheckCode | 'EDEF_UNREACHABLE' | 'DGI_PRODUCTION_UNAVAILABLE';
  message: string;
  details: Record<string, unknown>;
}

/** Traduction d'une défaillance du client e-MCF en échec de test. */
export function failureOfEdef(error: EdefFailure): TokenCheckFailure {
  const dgi =
    error.dgiErrorCode !== null
      ? { dgiErrorCode: error.dgiErrorCode, dgiMessage: error.message }
      : {};
  switch (error.kind) {
    case 'production_disabled':
      return {
        ok: false,
        http: 409,
        code: 'DGI_PRODUCTION_UNAVAILABLE',
        message: 'La production sera ouverte après l’homologation de Lalanda par la DGI.',
        details: {},
      };
    case 'unauthorized':
      return {
        ok: false,
        http: 422,
        code: 'EMCF_TOKEN_REJECTED',
        message: 'La DGI a refusé ce jeton : il est invalide ou expiré.',
        details: { kind: error.kind, httpStatus: error.httpStatus },
      };
    case 'business':
      return {
        ok: false,
        http: 422,
        code: 'EMCF_TOKEN_REJECTED',
        message: error.message,
        details: { kind: error.kind, httpStatus: error.httpStatus, ...dgi },
      };
    case 'invalid_response':
      return {
        ok: false,
        http: 422,
        code: 'EDEF_INVALID_RESPONSE',
        message: error.message,
        details: { kind: error.kind, httpStatus: error.httpStatus },
      };
    case 'timeout':
    case 'network':
    case 'server':
      return {
        ok: false,
        http: 502,
        code: 'EDEF_UNREACHABLE',
        message: error.message,
        details: { kind: error.kind, httpStatus: error.httpStatus },
      };
  }
}

export function throwTokenCheckFailure(f: TokenCheckFailure): never {
  const body = { code: f.code, message: f.message, details: f.details };
  if (f.http === 502) throw new BadGatewayException(body);
  if (f.http === 409) throw new ConflictException(body);
  throw new UnprocessableEntityException(body);
}

/** `VaultUnavailableError` → 503 ; le reste remonte tel quel. */
export function rethrowVault(err: unknown): never {
  if (err instanceof VaultUnavailableError) {
    throw new ServiceUnavailableException({
      code: 'VAULT_UNAVAILABLE',
      message: 'Le coffre à secrets n’est pas configuré : les jetons e-MCF sont indisponibles.',
    });
  }
  if (err instanceof HttpException) throw err;
  throw err;
}
