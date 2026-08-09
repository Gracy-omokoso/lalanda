#!/usr/bin/env node
// Cliquet de vulnérabilités de dépendances (S22e — docs/17 « dépendances surveillées »).
//
// POURQUOI UN CLIQUET ET PAS `pnpm audit --audit-level=high`
//
// La CI n'exécutait aucun scan : rien n'a jamais échoué sur une dépendance
// vulnérable, et `pnpm audit` remonte aujourd'hui 3 critiques et 21 hautes.
// Brancher `--audit-level=high` tel quel rendrait `main` rouge immédiatement et
// bloquerait six chantiers parallèles pour un dette qui ne se corrige pas dans
// cette PR (le correctif principal est un bump de `next`, hors de son périmètre).
//
// Un scan non bloquant, lui, ne contrôle rien : on le regarde une semaine puis
// plus jamais. Le compromis retenu est un CLIQUET : la liste des avis connus est
// gelée dans `scripts/audit-baseline.json`; le job échoue dès qu'un avis
// haut/critique APPARAÎT hors de cette liste. La dette existante est donc
// visible et datée sans bloquer, et aucune dette NOUVELLE ne peut entrer.
//
// Le fichier de référence n'est pas une amnistie : chaque entrée porte le module
// et le titre de l'avis, et `docs/29-AUDIT-SECURITE-S22e.md` fixe l'échéance de
// résorption. Retirer une ligne de la référence après un bump est la manière
// normale de refermer le cliquet.
//
// Utilisation :
//   node scripts/audit-dependencies.mjs            # vérifie (échoue si régression)
//   node scripts/audit-dependencies.mjs --update   # regénère la référence

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BASELINE_PATH = resolve(HERE, 'audit-baseline.json');
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

/**
 * `pnpm audit --json` sort en code non nul dès qu'il trouve quoi que ce soit :
 * un code de sortie non nul n'est donc PAS une erreur d'exécution ici, et on ne
 * peut pas s'y fier. On distingue les deux cas sur la présence d'un JSON
 * exploitable sur stdout — sans quoi une panne réseau passerait pour « aucune
 * vulnérabilité » et le cliquet deviendrait décoratif.
 */
async function runAudit() {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('pnpm', ['audit', '--json'], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (err) {
    stdout = typeof err?.stdout === 'string' ? err.stdout : '';
    if (!stdout.trim()) {
      throw new Error(
        `\`pnpm audit\` n'a produit aucune sortie exploitable (réseau ou registre indisponible ?).\n` +
          `${err?.stderr ?? err?.message ?? err}`,
      );
    }
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error('Sortie de `pnpm audit --json` illisible — arrêt plutôt que faux vert.');
  }
}

/** Avis haut/critique, réduits à ce qui identifie durablement un problème. */
function blockingAdvisories(report) {
  return Object.values(report.advisories ?? {})
    .filter((a) => BLOCKING_SEVERITIES.has(a.severity))
    .map((a) => ({
      // `github_advisory_id` (GHSA-…) est stable dans le temps, contrairement à
      // l'`id` numérique du registre qui peut être réattribué.
      id: a.github_advisory_id ?? `npm-${a.id}`,
      module: a.module_name,
      severity: a.severity,
      title: a.title,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    return { generatedAt: null, advisories: [] };
  }
}

const report = await runAudit();
const found = blockingAdvisories(report);
const counts = report.metadata?.vulnerabilities ?? {};

if (process.argv.includes('--update')) {
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), advisories: found }, null, 2)}\n`,
  );
  console.log(`Référence mise à jour : ${found.length} avis haut/critique gelés.`);
  process.exit(0);
}

const baseline = loadBaseline();
const known = new Set(baseline.advisories.map((a) => a.id));
const regressions = found.filter((a) => !known.has(a.id));
const resolved = baseline.advisories.filter((a) => !found.some((f) => f.id === a.id));

console.log(
  `pnpm audit : ${counts.critical ?? 0} critique(s), ${counts.high ?? 0} haute(s), ` +
    `${counts.moderate ?? 0} modérée(s), ${counts.low ?? 0} basse(s) sur ` +
    `${report.metadata?.totalDependencies ?? '?'} dépendances.`,
);
console.log(
  `Référence du ${baseline.generatedAt ?? 'néant'} : ${known.size} avis haut/critique connus.`,
);

if (resolved.length > 0) {
  console.log(
    `\n${resolved.length} avis de la référence ont disparu — retirez-les via ` +
      `\`node scripts/audit-dependencies.mjs --update\` pour refermer le cliquet :`,
  );
  for (const a of resolved) console.log(`  - ${a.id} (${a.module})`);
}

if (regressions.length === 0) {
  console.log('\nAucune vulnérabilité haute ou critique NOUVELLE. OK.');
  process.exit(0);
}

console.error(
  `\n::error::${regressions.length} vulnérabilité(s) haute(s)/critique(s) NOUVELLE(S) :`,
);
for (const a of regressions) {
  console.error(`  - [${a.severity}] ${a.module} — ${a.title} (${a.id})`);
}
console.error(
  '\nCorrigez la dépendance, ou — si le risque est accepté et documenté dans ' +
    'docs/29-AUDIT-SECURITE-S22e.md — regénérez la référence avec ' +
    '`node scripts/audit-dependencies.mjs --update`.',
);
process.exit(1);
