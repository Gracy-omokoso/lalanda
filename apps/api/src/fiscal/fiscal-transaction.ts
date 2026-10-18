// Transaction MongoDB du module fiscal — ADR-0021 §3 (R3) et §4.1.
//
// PAS de repli sans transaction, contrairement à `members.service.ts` : la règle
// « pas de désactivation sans trace » et « document, secret et audit ensemble ou
// pas du tout » n'a de valeur que si elle est une propriété de la base. Une
// topologie sans transaction (Mongo autonome) doit échouer bruyamment, pas
// écrire à moitié.

import type { ClientSession, Connection } from 'mongoose';

export async function inFiscalTransaction<T>(
  connection: Connection,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Erreur E11000 (index unique). */
export function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}
