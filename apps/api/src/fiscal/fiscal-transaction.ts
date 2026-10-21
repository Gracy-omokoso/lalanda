// Transaction MongoDB du module fiscal — ADR-0021 §3 (R3) et §4.1.
//
// PAS de repli sans transaction, contrairement à `members.service.ts` : la règle
// « pas de désactivation sans trace » et « document, secret et audit ensemble ou
// pas du tout » n'a de valeur que si elle est une propriété de la base. Une
// topologie sans transaction (Mongo autonome) doit échouer bruyamment, pas
// écrire à moitié.
//
// ── Rejeu avec attente ───────────────────────────────────────────────────────
// `withTransaction` (driver mongodb 6.20) rejoue une transaction en conflit
// d'écriture (`TransientTransactionError`) IMMÉDIATEMENT, en boucle, pendant au
// plus 120 s. Quand N transactions visent le même document — le compteur de
// numérotation sous 50 émissions ou normalisations simultanées —, elles se
// rejouent au même instant et s'annulent de nouveau : chaque vague n'en valide
// qu'une, les autres consomment leur budget. Constaté sous charge le 21 oct.
// 2026 : une normalisation a reçu « Write conflict during plan execution »
// APRÈS 120 s de rejeux, soit une erreur 500 alors qu'aucune règle n'était
// violée. Les rejeux sont donc espacés d'une attente exponentielle avec gigue
// (5 ms, ×1,5, plafond 500 ms), qui désynchronise les concurrents. L'attente a
// lieu au DÉBUT d'une nouvelle tentative, avant toute commande : la transaction
// n'existe pas encore côté serveur, rien n'est verrouillé pendant l'attente.

import type { ClientSession, Connection } from 'mongoose';

const BACKOFF_INITIAL_MS = 5;
const BACKOFF_GROWTH = 1.5;
const BACKOFF_MAX_MS = 500;

/** Attente avant la tentative n° `attempt` (≥ 2) : gigue pleine sous un plafond exponentiel. */
export function transactionBackoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_INITIAL_MS * BACKOFF_GROWTH ** (attempt - 2), BACKOFF_MAX_MS);
  return random() * ceiling;
}

export async function inFiscalTransaction<T>(
  connection: Connection,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let result!: T;
    let attempt = 0;
    await session.withTransaction(async () => {
      attempt += 1;
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, transactionBackoffMs(attempt)));
      }
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
