// Outil d'exploitation : étalonnage des arrondis et sondes de l'e-MCF —
// ADR-0024 § 7 (chantier F4).
//
//   pnpm --filter @lalanda/api edef:calibrate                 → étalonnage
//   pnpm --filter @lalanda/api edef:calibrate probe --liste   → liste des sondes
//   pnpm --filter @lalanda/api edef:calibrate probe --sonde apres-annulation
//
// Ce n'est PAS une fonction pour les clients : aucune route, aucun écran, aucun
// rôle ne le déclenche. Il ne vise QUE l'environnement de TEST de la DGI
// (`DGI_EDEF_TEST_URL`, refusée si elle désigne la production) ; aucun
// paramètre ne permet la production. Le jeton se tape à une invite masquée.
// Mode d'emploi pas à pas : docs/21-MOTEUR-FINANCIER.md, « Étalonnage des
// arrondis ».

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Writable } from 'node:stream';

import { config as loadDotenv } from 'dotenv';

import { DgiEnvSchema, withoutEmptyValues } from '@lalanda/shared';

import {
  DEFAULT_NORMALIZATION_TIMINGS,
  type DgiPlatformConfig,
} from '../../platform-config/dgi-platform.config.js';
import { EdefClient } from '../edef.client.js';
import { runCalibration } from './calibration-run.js';
import { createMemoryJournal } from './memory-journal.js';
import { DEFAULT_REPORT_DIR, REPOSITORY_ROOT, fileStamp } from './report.js';
import {
  CalibrationRefusal,
  assertTestTarget,
  readHiddenSecret,
  readVisibleLine,
  type PromptInput,
} from './safety.js';

export interface CliOptions {
  command: 'etalonner' | 'probe';
  outDir: string;
  probes: string[];
  list: boolean;
  expiryWaitSeconds: number | null;
}

export const USAGE = [
  'Usage :',
  '  pnpm --filter @lalanda/api edef:calibrate [etalonner] [--sortie <dossier>]',
  '  pnpm --filter @lalanda/api edef:calibrate probe --liste',
  '  pnpm --filter @lalanda/api edef:calibrate probe --sonde <nom> [--sonde <nom>…] [--sortie <dossier>] [--attente-expiration <secondes>]',
  'Le jeton ne se passe JAMAIS en argument : il se tape à l’invite masquée.',
].join('\n');

const UNKNOWN_ARGUMENT =
  'Argument inconnu (il n’est pas réaffiché). Rappel : le jeton ne se passe JAMAIS dans la ' +
  'commande, il se tape à l’invite masquée. Si vous venez de l’écrire dans la commande, il est ' +
  'resté dans l’historique du terminal : effacez cet historique et faites renouveler le jeton.';

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    command: 'etalonner',
    outDir: DEFAULT_REPORT_DIR,
    probes: [],
    list: false,
    expiryWaitSeconds: null,
  };
  const args = [...argv];
  if (args[0] === '--') args.shift();
  if (args[0] === 'etalonner' || args[0] === 'probe') {
    options.command = args.shift() as CliOptions['command'];
  }
  while (args.length) {
    const arg = args.shift()!;
    const value = (): string => {
      const v = args.shift();
      if (v === undefined || v.startsWith('--')) {
        throw new CalibrationRefusal(`Valeur manquante après ${arg}.\n${USAGE}`);
      }
      return v;
    };
    if (arg === '--sortie') options.outDir = resolve(value());
    else if (arg === '--sonde' && options.command === 'probe') options.probes.push(value());
    else if (arg === '--liste' && options.command === 'probe') options.list = true;
    else if (arg === '--attente-expiration' && options.command === 'probe') {
      const seconds = Number(value());
      if (!Number.isInteger(seconds) || seconds < 130 || seconds > 900) {
        throw new CalibrationRefusal(
          '--attente-expiration : entre 130 et 900 secondes (la DGI expire une demande à 120 s).',
        );
      }
      options.expiryWaitSeconds = seconds;
    } else if (arg === '--aide' || arg === '--help') {
      throw new CalibrationRefusal(USAGE);
    } else {
      throw new CalibrationRefusal(`${UNKNOWN_ARGUMENT}\n${USAGE}`);
    }
  }
  return options;
}

export interface CliIo {
  stdin: PromptInput;
  stdout: Writable;
  stderr: Writable;
  env: NodeJS.ProcessEnv;
  /** Faux seulement dans les tests : l'invite masquée exige un vrai terminal. */
  requireTty?: boolean;
  /** Fabrique du client (tests : client branché sur le faux serveur). */
  makeClient?: (config: DgiPlatformConfig) => EdefClient;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  spacingMs?: number;
}

/** URL de production volontairement invalide : le client ne peut pas l'atteindre. */
const NO_PRODUCTION_URL = 'https://production-refusee.invalid';

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  const out = (line: string): void => void io.stdout.write(`${line}\n`);
  const fail = (message: string): number => {
    io.stderr.write(`${message}\n`);
    return 1;
  };
  try {
    const options = parseArgs(argv);

    const parsed = DgiEnvSchema.safeParse(withoutEmptyValues(io.env));
    if (!parsed.success) {
      return fail(
        `Configuration DGI invalide : ${parsed.error.issues
          .map((i) => `${i.path.join('.')} : ${i.message}`)
          .join(' ; ')}`,
      );
    }
    const env = parsed.data;
    const testUrl = assertTestTarget(env.DGI_EDEF_TEST_URL, env.DGI_EDEF_PRODUCTION_URL);

    if (options.command === 'probe' && (options.list || options.probes.length === 0)) {
      const { PROBES } = await import('./probe.js');
      out('Sondes disponibles (désactivées par défaut ; nommez chacune avec --sonde) :');
      for (const [name, def] of Object.entries(PROBES)) {
        out(
          `  ${name}${def.confirms ? '  [CONFIRME une facture de test]' : ''} — ${def.description}`,
        );
      }
      return options.list ? 0 : fail('Aucune sonde demandée : rien n’a été exécuté.');
    }

    if (io.requireTty !== false && !io.stdin.isTTY) {
      return fail(
        'Refus : l’invite masquée exige un terminal interactif. Le jeton ne se transmet ni par ' +
          'un tube, ni par un fichier, ni par une variable d’environnement.',
      );
    }

    const config: DgiPlatformConfig = Object.freeze({
      baseUrl: Object.freeze({ test: testUrl, production: NO_PRODUCTION_URL }),
      isf: Object.freeze({ test: env.DGI_ISF_TEST ?? null, production: null }),
      productionEnabled: false,
      httpTimeoutMs: env.DGI_HTTP_TIMEOUT_MS,
      normalizationTimings: DEFAULT_NORMALIZATION_TIMINGS,
    });
    const client = io.makeClient
      ? io.makeClient(config)
      : new EdefClient(config, createMemoryJournal().journal);
    const now = io.now ?? (() => new Date());
    const stamp = fileStamp(now());
    const readToken = () =>
      readHiddenSecret('Jeton e-MCF de TEST (point de vente de test de Go Freelance) :', {
        input: io.stdin,
        output: io.stdout,
      });

    out('');
    out(`Environnement visé : TEST de la DGI — ${testUrl}`);
    out('La production DGI est refusée par construction.');

    if (options.command === 'etalonner') {
      out(
        'Étalonnage des arrondis : chaque facture de test est envoyée puis ANNULÉE aussitôt ; aucune n’est confirmée.',
      );
      await runCalibration({
        edef: client,
        target: { testUrl, productionUrl: env.DGI_EDEF_PRODUCTION_URL },
        isfTest: env.DGI_ISF_TEST ?? null,
        readToken,
        out,
        reportPath: join(options.outDir, `etalonnage-${stamp}.json`),
        now,
        ...(io.sleep ? { sleep: io.sleep } : {}),
        ...(io.spacingMs !== undefined ? { spacingMs: io.spacingMs } : {}),
      });
      return 0;
    }

    const { isProbeName, runProbes } = await import('./probe.js');
    const unknown = options.probes.filter((p) => !isProbeName(p));
    if (unknown.length) return fail(`Sonde inconnue : ${unknown.join(', ')}. Voir --liste.`);
    await runProbes({
      edef: client,
      target: { testUrl, productionUrl: env.DGI_EDEF_PRODUCTION_URL },
      isfTest: env.DGI_ISF_TEST ?? null,
      probes: options.probes.filter(isProbeName),
      readToken,
      ask: (q) => readVisibleLine(q, { input: io.stdin, output: io.stdout }),
      out,
      reportPath: join(options.outDir, `sondes-${stamp}.json`),
      now,
      ...(io.sleep ? { sleep: io.sleep } : {}),
      ...(io.spacingMs !== undefined ? { spacingMs: io.spacingMs } : {}),
      ...(options.expiryWaitSeconds ? { expiryWaitMs: options.expiryWaitSeconds * 1000 } : {}),
    });
    return 0;
  } catch (err) {
    if (err instanceof CalibrationRefusal) return fail(err.message);
    return fail(`Arrêt sur erreur : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
  }
}

// Point d'entrée en ligne de commande (pas lors d'un import par les tests).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  const envFile = join(REPOSITORY_ROOT, '.env');
  if (existsSync(envFile)) loadDotenv({ path: envFile });
  void main(process.argv.slice(2), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
  }).then((code) => {
    process.exitCode = code;
  });
}
