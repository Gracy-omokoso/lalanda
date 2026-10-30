// Erreurs HTTP et petits outils communs du module RH (ADR-0045 § 1, § 3). ADR-0045 — H2.
//
// Même forme que les contrôleurs des achats : `{ code, message, details? }`, message
// en français. Une ressource d'une autre organisation, ou un collaborateur hors de la
// portée du lecteur, répond 404 (jamais 403 : on ne confirme pas l'existence).

import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ClientSession, Connection } from 'mongoose';

import { conflict } from '../../sales/sales.errors.js';
import { kinshasaDayOf } from '../../sales/receipts/kinshasa-day.js';

export function employeeNotFound(): never {
  throw new NotFoundException({
    code: 'EMPLOYEE_NOT_FOUND',
    message: 'Collaborateur introuvable.',
  });
}

export function departmentNotFound(): never {
  throw new NotFoundException({ code: 'DEPARTMENT_NOT_FOUND', message: 'Service introuvable.' });
}

/**
 * Compte qui n'est pas membre de l'organisation : 404, y compris pour le compte d'une
 * autre organisation (critère 4 : on ne confirme pas l'existence d'un compte).
 */
export function userNotMember(): never {
  throw new NotFoundException({
    code: 'EMPLOYEE_USER_NOT_MEMBER',
    message: 'Ce compte n’est pas membre de l’organisation.',
  });
}

export function userAlreadyLinked(employeeId?: string): never {
  conflict(
    'EMPLOYEE_USER_ALREADY_LINKED',
    'Ce compte est déjà relié à une autre fiche collaborateur.',
    employeeId ? { employeeId } : undefined,
  );
}

export function employeeNumberExists(): never {
  conflict('EMPLOYEE_NUMBER_EXISTS', 'Un autre collaborateur porte déjà ce matricule.');
}

export function managerCycle(): never {
  conflict(
    'MANAGER_CYCLE',
    'Ce manager est le collaborateur lui-même ou l’un de ses subordonnés : la ligne hiérarchique bouclerait.',
  );
}

/** Sans trousseau configuré, rien n'est stocké en clair : l'écriture est refusée. */
export function secretsNotConfigured(): never {
  throw new ServiceUnavailableException({
    code: 'SECRETS_NOT_CONFIGURED',
    message:
      'Le coffre de chiffrement n’est pas configuré : les données sensibles ne peuvent pas être lues ni enregistrées.',
  });
}

/** Audit strict impossible : sans trace, rien n'est révélé (§ 2.4). */
export function auditUnavailable(): never {
  throw new ServiceUnavailableException({
    code: 'HR_AUDIT_UNAVAILABLE',
    message: 'Le journal d’audit est indisponible : rien n’a été affiché. Réessayez plus tard.',
  });
}

export function privateUnreadable(): never {
  throw new InternalServerErrorException({
    code: 'HR_PRIVATE_UNREADABLE',
    message: 'Ces données sensibles ne peuvent pas être déchiffrées.',
  });
}

export function revealRateLimited(limit: number): never {
  throw new HttpException(
    {
      code: 'HR_REVEAL_RATE_LIMITED',
      message: `${limit} affichages de données sensibles par heure au plus : réessayez plus tard.`,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/** Refus de la donnée sensible à un lecteur qui voit pourtant la fiche (même forme que le guard). */
export function sensitiveForbidden(role: string | null): never {
  throw new ForbiddenException({
    code: 'FORBIDDEN',
    action: 'hr.sensitive.read',
    role,
    customized: false,
    message: 'Votre rôle ne permet pas de consulter les données sensibles du personnel.',
  });
}

/** Jour civil de Kinshasa (ADR-0027). */
export function hrToday(now: Date = new Date()): string {
  return kinshasaDayOf(now);
}

/** Exécute `fn` dans une transaction (motif des achats). */
export async function inHrTransaction<T>(
  connection: Connection,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out;
  } finally {
    await session.endSession();
  }
}
