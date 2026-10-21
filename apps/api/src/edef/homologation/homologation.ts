// Outil d'exploitation : campagne d'homologation DGI RÉELLE (ADR-0026 § 7).
//
//   pnpm --filter @lalanda/api edef:homologation -- --org <id> --operator <userId> --out <dossier> [--dry-run]
//   node dist/edef/homologation/homologation.js …      (image de production)
//
// Joue les 29 cas officiels, en TTC puis en HT (58 normalisations), pour UNE
// organisation dont la facture normalisée est active dans l'environnement de
// TEST de la DGI, en passant par les services de Lalanda (contexte Nest, sans
// serveur HTTP) : exactement le chemin d'un utilisateur. Ce n'est PAS une
// fonction pour les clients : aucune route, aucun écran, aucun rôle ne la
// déclenche.
//
// Garde-fous, tous vérifiés AVANT le premier brouillon :
// - `DGI_PRODUCTION_ENABLED` vrai → refus (dans l'environnement ET dans la
//   configuration chargée) ; URL de test = production DGI → refus ;
// - environnement DGI de l'organisation ≠ `test`, ou facture normalisée non
//   active → refus ;
// - opérateur non membre, ou sans `sales.manage` + `sales.invoice` → refus ;
// - un seul point de vente actif (celui que les brouillons retiennent d'office) ;
// - dossier de sortie suivi par git → refus (le dépôt est public) ;
// - confirmation tapée (`OUI`) sauf `--yes`.
// Puis arrêt à la PREMIÈRE erreur ; relance = reprise (voir `campaign-run.ts`).

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Writable } from 'node:stream';

import type { INestApplicationContext } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { config as loadDotenv } from 'dotenv';
import { ObjectId } from 'mongodb';
import type { Connection } from 'mongoose';

import { DgiEnvSchema, withoutEmptyValues } from '@lalanda/shared';

import { AuthzService } from '../../authz/authz.service.js';
import { canAll, type Action } from '../../authz/permissions.js';
import { NormalizedInvoicingStateReader } from '../../fiscal/normalized-invoicing-state.reader.js';
import {
  DGI_PLATFORM_CONFIG,
  type DgiPlatformConfig,
} from '../../platform-config/dgi-platform.config.js';
import { CustomersService } from '../../sales/customers.service.js';
import { InvoiceDocumentsService } from '../../sales/documents/invoice-documents.service.js';
import { InvoiceDraftsService } from '../../sales/invoices/invoice-drafts.service.js';
import { InvoiceFreezingService } from '../../sales/invoices/invoice-freezing.service.js';
import type { InvoiceActor } from '../../sales/invoices/invoice.types.js';
import { REPOSITORY_ROOT } from '../calibration/report.js';
import {
  CalibrationRefusal,
  assertNotTrackedByGit,
  assertTestTarget,
  readVisibleLine,
  type PromptInput,
} from '../calibration/safety.js';
import {
  CampaignRefusal,
  CampaignStop,
  STATE_FILE,
  buildPlan,
  buildReport,
  missingOrigins,
  newState,
  parseCampaignArgs,
  readState,
  writeReports,
  writeState,
  type StepKey,
} from './campaign-plan.js';
import {
  findCampaignCustomers,
  normalizedKeysOf,
  runCampaign,
  type CampaignHooks,
  type CampaignServices,
} from './campaign-run.js';

/** Droits exigés de l'opérateur : composer un brouillon et normaliser. */
export const OPERATOR_ACTIONS: readonly Action[] = Object.freeze(['sales.manage', 'sales.invoice']);

export interface HomologationIo {
  stdin: PromptInput;
  stdout: Writable;
  stderr: Writable;
  env: NodeJS.ProcessEnv;
  /** Faux seulement dans les tests : la confirmation exige un vrai terminal. */
  requireTty?: boolean;
  /** Tests : contexte applicatif fourni (défaut : `AppModule`, sans serveur HTTP). */
  createContext?: () => Promise<INestApplicationContext>;
  hooks?: CampaignHooks;
  now?: () => Date;
}

async function defaultContext(): Promise<INestApplicationContext> {
  // Pas d'ordonnanceur dans ce processus : les tâches de fond restent à l'API.
  process.env['SCHEDULER_ENABLED'] = 'false';
  process.env['LOG_LEVEL'] ??= 'warn';
  await import('reflect-metadata');
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../app.module.js');
  return NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
}

const refuse = (message: string): never => {
  throw new CampaignRefusal(message);
};

export async function main(argv: readonly string[], io: HomologationIo): Promise<number> {
  const out = (line: string): void => void io.stdout.write(`${line}\n`);
  const fail = (message: string): number => {
    io.stderr.write(`${message}\n`);
    return 1;
  };
  const now = io.now ?? (() => new Date());

  let ctx: INestApplicationContext | null = null;
  try {
    const options = parseCampaignArgs(argv);

    // 1. Garde-fous qui ne demandent rien d'autre que l'environnement. La valeur
    //    BRUTE d'abord : toute valeur autre que vide, « false » ou « 0 » refuse,
    //    avant même la validation du reste de la configuration.
    const rawProduction = (io.env['DGI_PRODUCTION_ENABLED'] ?? '').trim().toLowerCase();
    const parsedEnv = DgiEnvSchema.safeParse(withoutEmptyValues(io.env));
    if (
      (rawProduction !== '' && rawProduction !== 'false' && rawProduction !== '0') ||
      (parsedEnv.success && parsedEnv.data.DGI_PRODUCTION_ENABLED)
    ) {
      return fail(
        'Refus : DGI_PRODUCTION_ENABLED est vrai. La campagne d’homologation ne tourne que sur ' +
          'une plateforme dont la production DGI est fermée.',
      );
    }
    if (!parsedEnv.success) {
      return fail(
        `Configuration DGI invalide : ${parsedEnv.error.issues
          .map((i) => `${i.path.join('.')} : ${i.message}`)
          .join(' ; ')}`,
      );
    }
    if (options.outDir !== null) assertNotTrackedByGit(join(options.outDir, STATE_FILE));
    if (!options.dryRun && !options.yes && io.requireTty !== false && !io.stdin.isTTY) {
      return fail('Refus : la confirmation exige un terminal interactif (ou --yes).');
    }

    // 2. Contexte applicatif : les vrais services, la vraie base.
    ctx = await (io.createContext ?? defaultContext)();
    const config = ctx.get<DgiPlatformConfig>(DGI_PLATFORM_CONFIG);
    if (config.productionEnabled)
      refuse('Refus : la production DGI est ouverte sur cette plateforme.');
    const testUrl = assertTestTarget(config.baseUrl.test, config.baseUrl.production);

    const connection = ctx.get<Connection>(getConnectionToken());
    const db = connection.db;
    if (!db) refuse('Base de données indisponible.');
    const org = await db!
      .collection('organizations')
      .findOne({ _id: new ObjectId(options.organizationId) }, { projection: { name: 1 } });
    if (!org) refuse(`Organisation ${options.organizationId} introuvable.`);
    const orgName = typeof org!['name'] === 'string' ? org!['name'] : '(sans nom)';

    const settings = await ctx.get(NormalizedInvoicingStateReader).read(options.organizationId);
    if (settings.environment !== 'test') {
      refuse(
        `Refus : l’environnement DGI de « ${orgName} » est « ${settings.environment} ». ` +
          'La campagne d’homologation ne tourne QUE sur l’environnement de TEST.',
      );
    }
    if (settings.state !== 'enabled') {
      refuse(
        `Refus : la facture normalisée n’est pas active pour « ${orgName} » (état ${settings.state}).`,
      );
    }

    const resolved = await ctx
      .get(AuthzService)
      .resolveOrgRole(options.operatorUserId, options.organizationId);
    if (!resolved)
      refuse(`Refus : l’utilisateur ${options.operatorUserId} n’est pas membre de « ${orgName} ».`);
    if (!canAll(resolved!.role, OPERATOR_ACTIONS, resolved!.context)) {
      refuse(
        `Refus : le rôle « ${resolved!.role} » de l’opérateur ne permet pas de normaliser ` +
          `(${OPERATOR_ACTIONS.join(' + ')} exigés).`,
      );
    }
    const user = ObjectId.isValid(options.operatorUserId)
      ? await db!
          .collection('user')
          .findOne(
            { _id: new ObjectId(options.operatorUserId) },
            { projection: { name: 1, email: 1 } },
          )
      : null;
    if (!user) refuse(`Refus : utilisateur ${options.operatorUserId} introuvable.`);
    const userName = typeof user!['name'] === 'string' ? user!['name'].trim() : '';
    const actor: InvoiceActor = {
      userId: options.operatorUserId,
      name: userName !== '' ? userName : String(user!['email'] ?? options.operatorUserId),
      role: resolved!.role,
    };

    const services: CampaignServices = {
      customers: ctx.get(CustomersService, { strict: false }),
      drafts: ctx.get(InvoiceDraftsService, { strict: false }),
      freezing: ctx.get(InvoiceFreezingService, { strict: false }),
      documents: ctx.get(InvoiceDocumentsService, { strict: false }),
    };

    const pos = await services.drafts.selectablePointsOfSale(options.organizationId);
    if (pos.items.length !== 1) {
      refuse(
        `Refus : ${pos.items.length} point(s) de vente actif(s) en TEST. La campagne utilise le ` +
          'point de vente retenu d’office, ce qui exige exactement UN point de vente actif.',
      );
    }
    const point = pos.items[0]!;

    // 3. Plan : état local + étiquettes en base.
    const state =
      options.outDir !== null
        ? readState(options.outDir, {
            campaignId: options.campaignId,
            organizationId: options.organizationId,
          })
        : null;
    const labelled = await services.drafts.campaignDocuments(
      options.organizationId,
      options.campaignId,
    );
    const done = new Set<StepKey>([
      ...(Object.keys(state?.entries ?? {}) as StepKey[]),
      ...normalizedKeysOf(labelled),
    ]);
    const steps = buildPlan(options);
    const missing = missingOrigins(steps, done);
    if (missing.length > 0)
      refuse(`Refus : enchaînement d’avoir impossible — ${missing.join(' ; ')}.`);
    const toDo = steps.filter((s) => !done.has(s.key));
    const customers = await findCampaignCustomers(services.customers, options.organizationId);

    out('');
    out('Campagne d’homologation DGI — 29 cas officiels (SFE v1.2)');
    out(`  Organisation      : ${orgName} (${options.organizationId})`);
    out(`  Environnement DGI : TEST — ${new URL(testUrl).host} (production refusée)`);
    out(`  Point de vente    : ${point.label}${point.nim ? ` — NIM ${point.nim}` : ''}`);
    out(`  Opérateur         : ${actor.name} (${actor.role})`);
    out(`  Campagne          : ${options.campaignId}`);
    out(
      `  Modes, cas        : ${options.modes.map((m) => m.toUpperCase()).join(' puis ')} ; cas ${options.cases.join(', ')}`,
    );
    out(`  Dossier de sortie : ${options.outDir ?? '(aucun : --dry-run)'}`);
    out(
      `  Clients fictifs   : ${customers
        .map((c) => `${c.type} ${c.existingId ? 'existant' : 'à créer'}`)
        .join(', ')}`,
    );
    out(
      `  Normalisations    : ${steps.length} prévues, ${steps.length - toDo.length} déjà faites, ${toDo.length} à faire`,
    );
    if (options.dryRun) {
      out('');
      for (const s of steps) {
        out(
          `  cas ${String(s.caseNumber).padStart(2, '0')} ${s.mode.toUpperCase()} ${s.type} — ${s.title}` +
            `${s.originCase !== null ? ` (avoir du cas ${s.originCase})` : ''} : ${done.has(s.key) ? 'déjà normalisé' : 'à normaliser'}`,
        );
      }
      out('');
      out('--dry-run : rien n’a été écrit, aucune normalisation.');
      return 0;
    }
    if (toDo.length === 0)
      out('Aucune normalisation à faire : PDF et rapports mis à jour seulement.');

    if (!options.yes && toDo.length > 0) {
      const answer = await readVisibleLine(
        `\nLancer ${toDo.length} normalisation(s) RÉELLE(S) sur l’environnement de TEST de la DGI pour « ${orgName} » ? Tapez OUI :`,
        { input: io.stdin, output: io.stdout },
      );
      if (answer.toUpperCase() !== 'OUI') return fail('Abandon : rien n’a été fait.');
    }

    // 4. Exécution.
    const outDir = options.outDir!;
    const current = state ?? newState(options.campaignId, options.organizationId, now());
    writeState(outDir, current, now());
    try {
      await runCampaign({
        services,
        organizationId: options.organizationId,
        actor,
        campaignId: options.campaignId,
        steps,
        state: current,
        outDir,
        out,
        now,
        ...(io.hooks ? { hooks: io.hooks } : {}),
      });
    } catch (err) {
      writeState(outDir, current, now());
      writeReports(outDir, buildReport(current, steps, now()));
      if (err instanceof CampaignStop) {
        return fail(`\nARRÊT : ${err.message}\nRelancez la même commande pour reprendre.`);
      }
      throw err;
    }
    const report = buildReport(current, steps, now());
    out('');
    out(`Terminé : ${report.normalized} / ${report.planned} normalisations.`);
    out(`PDF, rapport.json, rapport.md et ${STATE_FILE} : ${outDir}`);
    return 0;
  } catch (err) {
    if (err instanceof CampaignRefusal || err instanceof CalibrationRefusal)
      return fail(err.message);
    if (err instanceof CampaignStop) return fail(`ARRÊT : ${err.message}`);
    return fail(`Arrêt sur erreur : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
  } finally {
    await ctx?.close();
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
    // Sortie explicite : un navigateur de rendu PDF resté ouvert ne doit pas
    // retenir le processus.
    process.exit(code);
  });
}
