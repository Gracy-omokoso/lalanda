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

/** E11000 sur l'index du NIM d'un point de vente (`EMCF_ALREADY_REGISTERED`). */
export function isNimConflict(err: unknown): boolean {
  if (!isDuplicateKey(err)) return false;
  const e = err as { keyPattern?: Record<string, unknown>; message?: string };
  return Boolean(e.keyPattern?.['dgi.nim']) || /dgi\.nim/.test(e.message ?? '');
}

/**
 * Transaction rejouée UNE fois sur un doublon qui n'est pas celui du NIM.
 *
 * Dans une transaction, le coffre ne réessaie pas lui-même (`put` : MongoDB a déjà
 * annulé la transaction sur l'erreur) ; c'est à l'appelant de la rejouer en
 * entier. Le seul doublon attendu ici est celui de deux écritures concurrentes du
 * même secret : la seconde tentative trouve le document existant et le remplace.
 */
export async function inFiscalTransactionWithReplay<T>(
  connection: Connection,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  try {
    return await inFiscalTransaction(connection, fn);
  } catch (err) {
    if (!isDuplicateKey(err) || isNimConflict(err)) throw err;
    return inFiscalTransaction(connection, fn);
  }
}
