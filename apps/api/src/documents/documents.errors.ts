// Erreurs HTTP de la bibliothèque (ADR-0046 § 4, § 5.3). ADR-0046 — S6.
//
// Forme des contrôleurs d'achats : `{ code, message }`, message en français. Une
// ressource d'une autre organisation, ou invisible de l'appelant, répond 404 — y compris
// un dossier restreint et une entité liée par identifiant forgé.

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { Action, OrgRole } from '../authz/permissions.js';

export function documentNotFound(): never {
  throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' });
}

export function folderNotFound(): never {
  throw new NotFoundException({ code: 'FOLDER_NOT_FOUND', message: 'Dossier introuvable.' });
}

export function versionNotFound(): never {
  throw new NotFoundException({
    code: 'DOCUMENT_VERSION_NOT_FOUND',
    message: 'Version introuvable.',
  });
}

export function linkedEntityNotFound(): never {
  throw new NotFoundException({
    code: 'DOCUMENT_ENTITY_NOT_FOUND',
    message: 'L’élément lié est introuvable.',
  });
}

/** 403 au format du guard : l'action manquante est nommée. */
export function documentsForbidden(
  action: Action,
  role: OrgRole | string | null,
  message: string,
): never {
  throw new ForbiddenException({ code: 'FORBIDDEN', action, role, customized: false, message });
}

export function staleRevision(): never {
  throw new ConflictException({
    code: 'STALE_REVISION',
    message: 'Ce document a été modifié entre-temps : rechargez-le.',
  });
}

export function documentConflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

export function documentsSecretsNotConfigured(): never {
  throw new ServiceUnavailableException({
    code: 'SECRETS_NOT_CONFIGURED',
    message:
      'Le coffre de chiffrement n’est pas configuré : un document sensible ne peut être ni déposé ni lu.',
  });
}

export function documentsAuditUnavailable(): never {
  throw new ServiceUnavailableException({
    code: 'DOCUMENTS_AUDIT_UNAVAILABLE',
    message: 'Le journal d’audit est indisponible : rien n’a été servi. Réessayez plus tard.',
  });
}

export function documentUnreadable(): never {
  throw new HttpException(
    { code: 'DOCUMENT_UNREADABLE', message: 'Ce document ne peut pas être déchiffré.' },
    500,
  );
}
