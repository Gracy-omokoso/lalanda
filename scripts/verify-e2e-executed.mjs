#!/usr/bin/env node
// Garde anti-« vert parce que skippé » (S19a).
//
// Contexte : toutes les suites e2e de apps/api s'auto-skippent quand MONGODB_URI
// est absent. La CI ne fournissait pas MongoDB — les suites n'ont jamais tourné
// et les quatre merges du batch S18 sont passés au vert alors que la suite
// complète était rouge en local. Un job vert ne prouvait rien.
//
// Ce script lit le rapport JSON de vitest (produit uniquement quand
// LALANDA_REQUIRE_E2E=1, cf. apps/api/vitest.config.ts) et refuse de laisser
// passer un run où une suite e2e n'aurait pas réellement été exécutée.
//
// Contrôles :
//   1. le rapport existe (sinon la commande de test n'a pas tourné);
//   2. au moins un fichier `*.e2e.test.ts` est présent dans le rapport;
//   3. AUCUN test d'un fichier `*.e2e.test.ts` n'est en statut `pending`/`skipped`;
//   4. chaque fichier `*.e2e.test.ts` compte au moins un test réellement passé.
//
// Les skips conditionnels des tests UNITAIRES sont laissés tranquilles : ils
// dépendent des templates embarqués (ex. `it.skipIf` sur les drivers de BFR),
// pas de la disponibilité d'une base.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPORT = resolve(process.argv[2] ?? 'apps/api/.vitest/report.json');
const E2E = /\.e2e\.test\.ts$/;

let report;
try {
  report = JSON.parse(readFileSync(REPORT, 'utf8'));
} catch (err) {
  console.error(`❌ Rapport vitest introuvable ou illisible : ${REPORT}`);
  console.error(`   ${err.message}`);
  console.error('   La commande de test a-t-elle bien tourné avec LALANDA_REQUIRE_E2E=1 ?');
  process.exit(1);
}

const results = report.testResults ?? [];
const e2eFiles = results.filter((f) => E2E.test(f.name ?? ''));

const erreurs = [];
if (e2eFiles.length === 0) {
  erreurs.push('aucun fichier `*.e2e.test.ts` dans le rapport — les suites e2e sont introuvables.');
}

let totalExecutes = 0;
let totalSkippes = 0;
const parFichier = [];

for (const file of results) {
  const assertions = file.assertionResults ?? [];
  const passes = assertions.filter((a) => a.status === 'passed').length;
  const skippes = assertions.filter((a) => a.status === 'pending' || a.status === 'skipped').length;
  const echecs = assertions.filter((a) => a.status === 'failed').length;

  totalExecutes += passes + echecs;
  totalSkippes += skippes;

  const court = (file.name ?? '').split('/').slice(-1)[0];
  if (!E2E.test(file.name ?? '')) continue;

  parFichier.push({ court, passes, skippes, echecs });

  if (skippes > 0) {
    erreurs.push(`${court} : ${skippes} test(s) skippé(s) alors que MongoDB doit être disponible.`);
  }
  if (passes + echecs === 0) {
    erreurs.push(`${court} : aucun test exécuté — suite entièrement inerte.`);
  }
}

console.log('\n── Exécution réelle des suites e2e ──');
for (const f of parFichier.sort((a, b) => a.court.localeCompare(b.court))) {
  const etat = f.skippes > 0 || f.passes + f.echecs === 0 ? '✗' : '✓';
  console.log(
    `  ${etat} ${f.court.padEnd(30)} ${String(f.passes).padStart(3)} passés, ` +
      `${f.echecs} échoués, ${f.skippes} skippés`,
  );
}
console.log(`\n  Fichiers e2e            : ${e2eFiles.length}`);
console.log(`  Tests exécutés (total)  : ${totalExecutes}`);
console.log(`  Tests skippés (total)   : ${totalSkippes}`);

if (erreurs.length > 0) {
  console.error('\n❌ Les tests e2e ne se sont pas réellement exécutés :');
  for (const e of erreurs) console.error(`   - ${e}`);
  console.error(
    '\n   Causes fréquentes :\n' +
      "   - MONGODB_URI absent de l'environnement du job;\n" +
      '   - variable non déclarée dans `globalEnv` de turbo.json (envMode strict de Turborepo 2);\n' +
      '   - service MongoDB non démarré ou replica set rs0 non initialisé.',
  );
  process.exit(1);
}

console.log('\n✅ Toutes les suites e2e se sont réellement exécutées.\n');
