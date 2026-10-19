// Écriture des rapports de l'étalonnage et des sondes — ADR-0024 § 7.2 (chantier F4).
//
// Rapport JSON écrit HORS du dépôt (par défaut `dgi/etalonnage/`, ignoré par
// git) ; un chemin suivi par git est refusé. Il ne contient JAMAIS le jeton, le
// NIF ni le corps complet des requêtes : avant l'écriture, le texte est contrôlé
// (jeton → refus d'écrire ; NIF → remplacé).

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Secret } from '../../integrations/secret-value.js';
import { CalibrationRefusal, assertNotTrackedByGit } from './safety.js';

/** Racine du dépôt, depuis `apps/api/src/edef/calibration/` (ou `dist/edef/calibration/`). */
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/** Dossier par défaut : `dgi/etalonnage/`, ignoré par git (`/dgi/` dans `.gitignore`). */
export const DEFAULT_REPORT_DIR = join(REPOSITORY_ROOT, 'dgi', 'etalonnage');

export const NIF_PLACEHOLDER = '[NIF]';

/** Horodatage de fichier : `AAAAMMJJ-HHMMSS` (UTC). */
export function fileStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, '')
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('T', '-');
}

/**
 * Sérialise et contrôle un rapport : refuse s'il contenait le jeton, remplace
 * le NIF. Ne lève jamais avec le jeton dans son message.
 */
export function serializeReport(
  report: unknown,
  secrets: { token: Secret; nif: string | null },
): string {
  let text = `${JSON.stringify(report, null, 2)}\n`;
  if (text.includes(secrets.token.expose())) {
    throw new CalibrationRefusal(
      'Erreur de programmation : le jeton apparaîtrait dans le rapport. Rien n’a été écrit.',
    );
  }
  if (secrets.nif && secrets.nif.length >= 6) text = text.split(secrets.nif).join(NIF_PLACEHOLDER);
  return text;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Vérifie qu'un chemin de sortie est acceptable AVANT tout appel réseau. */
export function checkOutputPath(filePath: string): void {
  assertNotTrackedByGit(filePath);
}

/**
 * Écrit un fichier de rapport (droits 0600 dans un dossier 0700, jamais
 * d'écrasement). Le chemin est contrôlé de nouveau juste avant l'écriture.
 */
export function writeReportFile(filePath: string, text: string): { path: string; sha256: string } {
  const absolute = resolve(filePath);
  assertNotTrackedByGit(absolute);
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  writeFileSync(absolute, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return { path: absolute, sha256: sha256Hex(text) };
}
