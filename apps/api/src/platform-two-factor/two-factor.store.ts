// Lectures de la double authentification par le pilote natif (ADR-0053 — P8).
//
// Utilisées par `PlatformAuthGuard` sur CHAQUE requête de console : aucune injection de
// modèle, seulement la base de la connexion Nest.

import type { Db } from 'mongodb';

import { TWO_FACTOR_COLLECTION, TWO_FACTOR_SESSIONS_COLLECTION } from './two-factor.schema.js';

export interface TwoFactorRow {
  userId: string;
  status: 'pending' | 'active';
  backupCodes?: Array<{ hash: string; salt: string; usedAt: Date | null }>;
}

/**
 * Verdict de la console pour un utilisateur et une session :
 *   - `not_operator` : aucun rôle plateforme actif — `PermissionsGuard` tranchera (403) ;
 *   - `enrollment_required` : opérateur sans double authentification active ;
 *   - `verification_required` : enrôlé, session pas (ou plus) vérifiée par un code ;
 *   - `ok`.
 */
export type TwoFactorGate = 'not_operator' | 'enrollment_required' | 'verification_required' | 'ok';

export async function activeTwoFactorOf(db: Db, userId: string): Promise<TwoFactorRow | null> {
  return db
    .collection<TwoFactorRow>(TWO_FACTOR_COLLECTION)
    .findOne(
      { userId, status: 'active' },
      { projection: { userId: 1, status: 1, backupCodes: 1 } },
    );
}

export async function isSessionVerified(
  db: Db,
  userId: string,
  fingerprint: string | null,
  now = new Date(),
): Promise<boolean> {
  if (!fingerprint) return false;
  const row = await db
    .collection(TWO_FACTOR_SESSIONS_COLLECTION)
    .findOne({ userId, sessionFingerprint: fingerprint, expiresAt: { $gt: now } });
  return row !== null;
}

/** Au moins un rôle plateforme non révoqué et non expiré (même règle qu'`AuthzService`). */
export async function isPlatformOperator(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const row = await db.collection('platform_roles').findOne(
    {
      userId,
      revokedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    },
    { projection: { _id: 1 } },
  );
  return row !== null;
}

export async function twoFactorGateOf(
  db: Db,
  userId: string,
  fingerprint: string | null,
): Promise<TwoFactorGate> {
  const active = await activeTwoFactorOf(db, userId);
  if (active && (await isSessionVerified(db, userId, fingerprint))) return 'ok';
  if (!(await isPlatformOperator(db, userId))) return 'not_operator';
  return active ? 'verification_required' : 'enrollment_required';
}
