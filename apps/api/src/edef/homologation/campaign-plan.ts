// Campagne d'homologation DGI RÉELLE — arguments, plan, fichier d'état et
// rapports (ADR-0026 § 7). Module PUR : aucun accès à la base, aucun appel
// réseau ; la ligne de commande (`homologation.ts`) et l'exécution
// (`campaign-run.ts`) s'appuient dessus, les tests unitaires aussi.
//
// Le fichier d'état et les rapports ne contiennent JAMAIS de jeton : la ligne de
// commande ne le connaît pas (il reste dans le coffre, déchiffré par le service
// de normalisation au moment de l'appel e-MCF).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { PriceMode } from '@lalanda/engine';

import {
  HOMOLOGATION_CASES,
  HOMOLOGATION_CASES_VERSION,
  HOMOLOGATION_PRICE_MODES,
  homologationCase,
} from './homologation-cases.js';

/** Refus d'exécuter : message français affichable tel quel, sans secret. */
export class CampaignRefusal extends Error {
  override readonly name = 'CampaignRefusal';
}

/** Arrêt en cours de campagne (première erreur) : la campagne est reprenable. */
export class CampaignStop extends Error {
  override readonly name = 'CampaignStop';
}

export const DEFAULT_CAMPAIGN_ID = `sfe-v${HOMOLOGATION_CASES_VERSION}`;
export const STATE_FILE = 'etat-campagne.json';
export const REPORT_JSON = 'rapport.json';
export const REPORT_MD = 'rapport.md';

export interface CampaignOptions {
  organizationId: string;
  operatorUserId: string;
  modes: PriceMode[];
  cases: number[];
  /** Absolu ; `null` seulement en `--dry-run`. */
  outDir: string | null;
  dryRun: boolean;
  yes: boolean;
  campaignId: string;
}

export const USAGE = [
  'Usage :',
  '  edef:homologation --org <organizationId> --operator <userId> --out <dossier>',
  '                    [--modes ttc,ht] [--cases 1-29] [--campaign <id>] [--dry-run] [--yes]',
  '',
  '  --org        organisation (identifiant) : environnement DGI de TEST obligatoire',
  '  --operator   utilisateur membre de l’organisation, droit de normaliser (sales.invoice)',
  '  --modes      ttc, ht ou ttc,ht (défaut : les deux)',
  '  --cases      sous-ensemble des 29 cas : 1-29, 1,3,10-12… (défaut : tous)',
  '  --out        dossier des PDF, du rapport et du fichier d’état (obligatoire hors --dry-run)',
  `  --campaign   étiquette de campagne (défaut : ${DEFAULT_CAMPAIGN_ID})`,
  '  --dry-run    affiche le plan, n’écrit rien',
  '  --yes        pas de confirmation interactive',
  'Aucun jeton ne se passe à cette commande : il reste dans le coffre de Lalanda.',
].join('\n');

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CAMPAIGN_ID = /^[a-z0-9][a-z0-9.-]{0,39}$/;

/** `1-29`, `1,3,10-12` → numéros triés, sans doublon, dans 1–29. */
export function parseCaseList(text: string): number[] {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^\s*(\d{1,2})\s*(?:-\s*(\d{1,2})\s*)?$/.exec(part);
    if (!m)
      throw new CampaignRefusal(`--cases : « ${part.trim()} » illisible (ex. 1-29, 1,3,10-12).`);
    const from = Number.parseInt(m[1]!, 10);
    const to = m[2] === undefined ? from : Number.parseInt(m[2], 10);
    if (from < 1 || to > HOMOLOGATION_CASES.length || from > to) {
      throw new CampaignRefusal(`--cases : ${part.trim()} hors de 1–${HOMOLOGATION_CASES.length}.`);
    }
    for (let n = from; n <= to; n += 1) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseModes(text: string): PriceMode[] {
  const wanted = new Set(text.split(',').map((m) => m.trim().toLowerCase()));
  for (const m of wanted) {
    if (m !== 'ttc' && m !== 'ht') throw new CampaignRefusal(`--modes : « ${m} » (ttc ou ht).`);
  }
  // Ordre fixe, celui de la campagne : TTC puis HT.
  return HOMOLOGATION_PRICE_MODES.filter((m) => wanted.has(m));
}

export function parseCampaignArgs(argv: readonly string[]): CampaignOptions {
  const args = [...argv];
  if (args[0] === '--') args.shift();
  let org: string | null = null;
  let operator: string | null = null;
  let modes: PriceMode[] = [...HOMOLOGATION_PRICE_MODES];
  let cases = HOMOLOGATION_CASES.map((c) => c.number);
  let outDir: string | null = null;
  let dryRun = false;
  let yes = false;
  let campaignId = DEFAULT_CAMPAIGN_ID;
  while (args.length) {
    const arg = args.shift()!;
    const value = (): string => {
      const v = args.shift();
      if (v === undefined || v.startsWith('--')) {
        throw new CampaignRefusal(`Valeur manquante après ${arg}.\n${USAGE}`);
      }
      return v;
    };
    if (arg === '--org') org = value();
    else if (arg === '--operator') operator = value();
    else if (arg === '--modes') modes = parseModes(value());
    else if (arg === '--cases') cases = parseCaseList(value());
    else if (arg === '--out') outDir = resolve(value());
    else if (arg === '--campaign') campaignId = value();
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--yes') yes = true;
    else if (arg === '--help' || arg === '--aide') throw new CampaignRefusal(USAGE);
    else {
      // Jamais réaffiché : ce pourrait être un jeton collé par erreur.
      throw new CampaignRefusal(`Argument inconnu (il n’est pas réaffiché).\n${USAGE}`);
    }
  }
  if (org === null || !OBJECT_ID.test(org)) {
    throw new CampaignRefusal(
      `--org <organizationId> obligatoire (24 caractères hexadécimaux).\n${USAGE}`,
    );
  }
  if (operator === null || !USER_ID.test(operator)) {
    throw new CampaignRefusal(`--operator <userId> obligatoire.\n${USAGE}`);
  }
  if (modes.length === 0) throw new CampaignRefusal('--modes : au moins un mode.');
  if (!CAMPAIGN_ID.test(campaignId)) {
    throw new CampaignRefusal(
      '--campaign : minuscules, chiffres, « . » et « - », 40 caractères au plus.',
    );
  }
  if (outDir === null && !dryRun) {
    throw new CampaignRefusal(
      `--out <dossier> obligatoire (PDF, rapport, fichier d’état).\n${USAGE}`,
    );
  }
  return {
    organizationId: org.toLowerCase(),
    operatorUserId: operator,
    modes,
    cases,
    outDir,
    dryRun,
    yes,
    campaignId,
  };
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export type StepKey = `${PriceMode}-${string}`;

export interface PlannedStep {
  key: StepKey;
  caseNumber: number;
  mode: PriceMode;
  title: string;
  type: string;
  /** Cas d'origine d'un avoir rattaché (même mode), sinon `null`. */
  originCase: number | null;
}

export const stepKey = (mode: PriceMode, caseNumber: number): StepKey =>
  `${mode}-${String(caseNumber).padStart(2, '0')}`;

/** Ordre de la campagne : chaque mode, puis les cas dans l'ordre (les origines d'abord). */
export function buildPlan(options: Pick<CampaignOptions, 'modes' | 'cases'>): PlannedStep[] {
  const steps: PlannedStep[] = [];
  for (const mode of options.modes) {
    for (const n of options.cases) {
      const c = homologationCase(n);
      steps.push({
        key: stepKey(mode, n),
        caseNumber: n,
        mode,
        title: c.title,
        type: c.type,
        originCase: c.credit !== null && c.credit.nature !== 'RRR' ? c.credit.originCase : null,
      });
    }
  }
  return steps;
}

/**
 * Avoirs dont l'origine n'est ni au plan (avant eux) ni déjà normalisée d'après
 * le fichier d'état : la campagne refuse de démarrer plutôt que de s'arrêter au
 * milieu. (Une origine retrouvée en base par son étiquette compte aussi : c'est
 * l'appelant qui passe `done`.)
 */
export function missingOrigins(
  steps: readonly PlannedStep[],
  done: ReadonlySet<StepKey>,
): string[] {
  const planned = new Set<StepKey>();
  const missing: string[] = [];
  for (const s of steps) {
    if (s.originCase !== null) {
      const origin = stepKey(s.mode, s.originCase);
      if (!planned.has(origin) && !done.has(origin)) {
        missing.push(
          `cas ${s.caseNumber} (${s.mode.toUpperCase()}) : exige le cas ${s.originCase} normalisé dans le même mode`,
        );
      }
    }
    planned.add(s.key);
  }
  return missing;
}

// ── Fichier d'état ───────────────────────────────────────────────────────────

export interface CampaignEntry {
  key: StepKey;
  caseNumber: number;
  mode: PriceMode;
  title: string;
  type: string;
  invoiceId: string;
  number: string;
  codeDefDgi: string | null;
  nim: string | null;
  counters: string | null;
  dgiDateTime: string | null;
  uid: string | null;
  totals: {
    lalanda: { total: string; vatTotal: string; specificTax: string };
    dgi: { total: string | null; vtotal: string | null; ts: string | null };
    identical: boolean;
    differences: readonly { field: string; ours: string | null; dgi: string | null }[];
  };
  /** Durée de la normalisation (appel du service), `null` si retrouvée en base. */
  durationMs: number | null;
  normalizedAt: string | null;
  /** Normalisée lors d'une exécution interrompue, retrouvée par son étiquette. */
  recoveredFromDatabase: boolean;
  /** Nom du PDF dans `--out`, `null` tant qu'il n'est pas écrit. */
  pdfFile: string | null;
}

export interface CampaignState {
  version: 1;
  campaignId: string;
  organizationId: string;
  environment: 'test';
  createdAt: string;
  updatedAt: string;
  entries: Partial<Record<StepKey, CampaignEntry>>;
}

export function newState(campaignId: string, organizationId: string, now: Date): CampaignState {
  return {
    version: 1,
    campaignId,
    organizationId,
    environment: 'test',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    entries: {},
  };
}

/** Lit l'état de `dir` ; `null` s'il n'existe pas. Refuse un état d'une autre campagne. */
export function readState(
  dir: string,
  expected: { campaignId: string; organizationId: string },
): CampaignState | null {
  const path = join(dir, STATE_FILE);
  if (!existsSync(path)) return null;
  let state: CampaignState;
  try {
    state = JSON.parse(readFileSync(path, 'utf8')) as CampaignState;
  } catch {
    throw new CampaignRefusal(`Fichier d’état illisible : ${path}. Arrêt par prudence.`);
  }
  if (state.version !== 1 || typeof state.entries !== 'object' || state.entries === null) {
    throw new CampaignRefusal(`Fichier d’état d’un format inconnu : ${path}.`);
  }
  if (
    state.organizationId !== expected.organizationId ||
    state.campaignId !== expected.campaignId
  ) {
    throw new CampaignRefusal(
      `Le dossier ${dir} contient l’état d’une autre campagne (organisation ${state.organizationId}, ` +
        `campagne ${state.campaignId}) : choisissez un autre --out.`,
    );
  }
  return state;
}

/** Écriture atomique (fichier temporaire puis renommage) : jamais d'état à moitié écrit. */
export function writeAtomic(path: string, content: string | Buffer): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export function writeState(dir: string, state: CampaignState, now: Date): void {
  mkdirSync(dir, { recursive: true });
  state.updatedAt = now.toISOString();
  writeAtomic(join(dir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

/** `cas-07-ttc-<numéro>.pdf` ; le numéro est lu du document, seuls ses caractères sûrs sont gardés. */
export function pdfFileName(caseNumber: number, mode: PriceMode, number: string): string {
  const safe = number.replace(/[^A-Za-z0-9_-]/g, '_');
  return `cas-${String(caseNumber).padStart(2, '0')}-${mode}-${safe}.pdf`;
}

// ── Rapports ─────────────────────────────────────────────────────────────────

export interface CampaignReport {
  campaignId: string;
  casesVersion: string;
  organizationId: string;
  environment: 'test';
  generatedAt: string;
  planned: number;
  normalized: number;
  complete: boolean;
  rows: (
    | CampaignEntry
    | { key: StepKey; caseNumber: number; mode: PriceMode; title: string; status: 'pending' }
  )[];
}

export function buildReport(
  state: CampaignState,
  steps: readonly PlannedStep[],
  now: Date,
): CampaignReport {
  const rows = steps.map((s) => {
    const e = state.entries[s.key];
    return (
      e ?? {
        key: s.key,
        caseNumber: s.caseNumber,
        mode: s.mode,
        title: s.title,
        status: 'pending' as const,
      }
    );
  });
  const normalized = steps.filter((s) => state.entries[s.key] !== undefined).length;
  return {
    campaignId: state.campaignId,
    casesVersion: HOMOLOGATION_CASES_VERSION,
    organizationId: state.organizationId,
    environment: 'test',
    generatedAt: now.toISOString(),
    planned: steps.length,
    normalized,
    complete: normalized === steps.length,
    rows,
  };
}

const cell = (v: string | number | null | undefined): string =>
  v === null || v === undefined || v === '' ? '—' : String(v).replaceAll('|', '\\|');

export function renderReportMarkdown(report: CampaignReport): string {
  const lines = [
    `# Campagne d’homologation DGI — ${report.campaignId}`,
    '',
    `- Cas officiels : SFE v${report.casesVersion}`,
    `- Organisation : ${report.organizationId}`,
    '- Environnement DGI : TEST',
    `- Généré le : ${report.generatedAt}`,
    `- Normalisations : ${report.normalized} / ${report.planned}${report.complete ? ' (complet)' : ' (incomplet)'}`,
    '',
    '| Cas | Mode | Type | Numéro | Code DEF/DGI | NIM | Compteurs | Total Lalanda | Total DGI | TVA Lalanda | TVA DGI | Identiques | Durée (ms) | uid | PDF |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of report.rows) {
    if ('status' in r) {
      lines.push(
        `| ${r.caseNumber} | ${r.mode.toUpperCase()} | — | non normalisé | — | — | — | — | — | — | — | — | — | — | — |`,
      );
      continue;
    }
    lines.push(
      [
        '',
        r.caseNumber,
        r.mode.toUpperCase(),
        cell(r.type),
        cell(r.number),
        cell(r.codeDefDgi),
        cell(r.nim),
        cell(r.counters),
        cell(r.totals.lalanda.total),
        cell(r.totals.dgi.total),
        cell(r.totals.lalanda.vatTotal),
        cell(r.totals.dgi.vtotal),
        r.totals.identical ? 'oui' : '**NON**',
        cell(r.durationMs),
        cell(r.uid),
        cell(r.pdfFile),
        '',
      ]
        .join(' | ')
        .trim(),
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function writeReports(dir: string, report: CampaignReport): void {
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, REPORT_JSON), `${JSON.stringify(report, null, 2)}\n`);
  writeAtomic(join(dir, REPORT_MD), renderReportMarkdown(report));
}
