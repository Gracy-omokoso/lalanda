// Garde-fous de l'outil d'étalonnage et des sondes — ADR-0024 § 7.2 (chantier F4).
//
// 1. Environnement de TEST seulement : l'URL visée est `DGI_EDEF_TEST_URL` et
//    rien d'autre ; elle est refusée si elle désigne la production (celle de la
//    configuration ET celle, codée en dur, de la DGI).
// 2. Jeton saisi au clavier, à une invite MASQUÉE : jamais en argument, jamais
//    en variable d'environnement, jamais écrit sur disque. Il passe directement
//    de la frappe à un `Secret` (ADR-0013 § 2) et ne vit qu'en mémoire.
// 3. Rapport écrit hors du suivi git : un chemin que git suivrait est refusé
//    (le dépôt est PUBLIC).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { Secret } from '../../integrations/secret-value.js';

/** Refus d'exécuter : message français, affichable tel quel, sans aucun secret. */
export class CalibrationRefusal extends Error {
  override readonly name = 'CalibrationRefusal';
}

/**
 * Hôtes de PRODUCTION de la DGI connus, refusés quoi que dise la configuration.
 * Source : valeur par défaut de `DGI_EDEF_PRODUCTION_URL` (`@lalanda/shared`).
 */
export const KNOWN_DGI_PRODUCTION_HOSTS: readonly string[] = Object.freeze(['edef.dgirdc.cd']);

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Vérifie que `testUrl` vise l'environnement de test et pas la production.
 * Refuse aussi tout autre protocole que https (http seulement vers la machine
 * locale, pour le faux serveur des tests). Renvoie l'URL normalisée.
 */
export function assertTestTarget(testUrl: string, productionUrl: string): string {
  let test: URL;
  try {
    test = new URL(testUrl);
  } catch {
    throw new CalibrationRefusal('DGI_EDEF_TEST_URL n’est pas une URL valide : arrêt.');
  }
  const host = test.hostname.toLowerCase();
  let productionHost: string | null = null;
  try {
    productionHost = new URL(productionUrl).hostname.toLowerCase();
  } catch {
    productionHost = null;
  }
  if (KNOWN_DGI_PRODUCTION_HOSTS.includes(host) || host === productionHost) {
    throw new CalibrationRefusal(
      `Refus : l’URL visée (${test.origin}) est celle de la PRODUCTION de la DGI. ` +
        'L’étalonnage et les sondes ne s’exécutent que sur l’environnement de TEST.',
    );
  }
  if (test.protocol !== 'https:' && !(test.protocol === 'http:' && LOOPBACK.has(host))) {
    throw new CalibrationRefusal(
      'Refus : l’URL de test doit être en https (http accepté seulement vers la machine locale).',
    );
  }
  return testUrl.replace(/\/+$/, '');
}

/** Entrée clavier : un terminal (mode brut) ou, dans les tests, un flux. */
export type PromptInput = Readable & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

// Séquences d'échappement du terminal (flèches, collage encadré…) : ignorées.
// eslint-disable-next-line no-control-regex
const ESCAPE_SEQUENCE = /\u001b(\[[0-9;?]*[ -/]*[@-~]|[@-_])/g;

/**
 * Invite MASQUÉE : rien de ce qui est tapé n'est renvoyé à l'écran (pas même
 * des étoiles, qui révéleraient la longueur). Entrée valide la saisie ;
 * Retour arrière efface ; Ctrl-C ou Ctrl-D abandonnent.
 *
 * La valeur ne transite par aucune variable d'environnement, aucun argument,
 * aucun fichier : de la frappe à un `Secret`.
 */
export function readHiddenSecret(
  question: string,
  io: { input: PromptInput; output: Writable },
): Promise<Secret> {
  const { input, output } = io;
  output.write(
    `${question}\n(saisie masquée : rien ne s’affiche pendant la frappe, c’est normal) `,
  );

  const raw = Boolean(input.isTTY && typeof input.setRawMode === 'function');
  if (raw) input.setRawMode?.(true);
  input.setEncoding?.('utf8');

  return new Promise<Secret>((resolvePromise, reject) => {
    const chars: string[] = [];
    let settled = false;

    const finish = (outcome: { ok: true } | { ok: false; reason: string }): void => {
      if (settled) return;
      settled = true;
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      if (raw) input.setRawMode?.(false);
      input.pause();
      output.write('\n');
      if (!outcome.ok) {
        chars.fill('');
        reject(new CalibrationRefusal(outcome.reason));
        return;
      }
      const value = chars.join('').trim();
      chars.fill('');
      if (value.length === 0) {
        reject(new CalibrationRefusal('Aucun jeton saisi : arrêt.'));
        return;
      }
      resolvePromise(new Secret(value));
    };

    const onData = (chunk: string | Buffer): void => {
      const text = (typeof chunk === 'string' ? chunk : chunk.toString('utf8')).replace(
        ESCAPE_SEQUENCE,
        '',
      );
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') return finish({ ok: true });
        if (ch === '\u0003') return finish({ ok: false, reason: 'Saisie abandonnée (Ctrl-C).' });
        if (ch === '\u0004') {
          if (chars.length === 0) return finish({ ok: false, reason: 'Saisie abandonnée.' });
          return finish({ ok: true });
        }
        if (ch === '\u007f' || ch === '\b') {
          chars.pop();
          continue;
        }
        if (ch >= ' ') chars.push(ch);
      }
    };
    const onEnd = (): void => finish({ ok: true });

    input.on('data', onData);
    input.on('end', onEnd);
    input.resume();
  });
}

/** Question visible (confirmation explicite d'une sonde). Renvoie la ligne tapée. */
export function readVisibleLine(
  question: string,
  io: { input: PromptInput; output: Writable },
): Promise<string> {
  const { input, output } = io;
  output.write(`${question} `);
  input.setEncoding?.('utf8');
  return new Promise<string>((resolvePromise) => {
    let buffer = '';
    const done = (): void => {
      input.removeListener('data', onData);
      input.removeListener('end', done);
      input.pause();
      resolvePromise(buffer.trim());
    };
    const onData = (chunk: string | Buffer): void => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const nl = buffer.search(/[\r\n]/);
      if (nl >= 0) {
        buffer = buffer.slice(0, nl);
        done();
      }
    };
    input.on('data', onData);
    input.on('end', done);
    input.resume();
  });
}

/**
 * Refuse un chemin de rapport que git suivrait : le dépôt est public. Accepté :
 * un chemin ignoré par git (`dgi/` l'est), ou hors de tout dépôt.
 */
export function assertNotTrackedByGit(filePath: string): void {
  const absolute = resolve(filePath);
  let cwd = dirname(absolute);
  while (!existsSync(cwd)) {
    const parent = dirname(cwd);
    if (parent === cwd) break;
    cwd = parent;
  }
  let status: number;
  try {
    execFileSync('git', ['check-ignore', '-q', '--', absolute], { cwd, stdio: 'ignore' });
    status = 0;
  } catch (err) {
    const code = (err as { status?: number | null }).status;
    status = typeof code === 'number' ? code : -1;
  }
  if (status === 0) return; // ignoré par git : accepté
  if (status === 128) return; // hors de tout dépôt git : accepté
  if (status === 1) {
    throw new CalibrationRefusal(
      `Refus : le rapport serait écrit dans un fichier suivi par git (${absolute}). ` +
        'Le dépôt est public : choisissez un dossier ignoré, par défaut dgi/etalonnage/.',
    );
  }
  throw new CalibrationRefusal(
    'Impossible de vérifier avec git que le dossier du rapport est ignoré : arrêt par prudence.',
  );
}
