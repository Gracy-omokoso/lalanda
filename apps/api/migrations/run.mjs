// Exécuteur de migrations — minimal, en attendant l'outillage complet.
//
// `apps/api/migrations/README.md` documente déjà la commande d'exécution
// manuelle (`node --env-file=… apps/api/migrations/AAAAMMJJ-NNNN-xxx.mjs`) et
// annonce le runner comme « itération ultérieure ». Or les fichiers de migration
// n'exportent que `up`/`down` : les exécuter directement ne fait RIEN, en
// silence, et rend un code de sortie 0. La commande documentée était donc un
// piège — elle rapporte un succès sans avoir touché la base.
//
// Ce fichier comble ce trou, sans prétendre être le runner complet :
//
//   ✔ résout la connexion depuis MONGODB_URI / MONGODB_DB;
//   ✔ exécute `up` (défaut) ou `down` (`--down`) d'UNE migration nommée;
//   ✔ échoue avec un code de sortie non nul et un message explicite;
//   ✘ PAS de verrou distribué — deux exécutions simultanées ne sont pas
//     protégées. Ne pas l'utiliser sur un déploiement multi-instances sans
//     s'assurer d'être seul;
//   ✘ PAS d'ordonnancement automatique — une migration à la fois, nommée à la
//     main, dans l'ordre lexicographique du répertoire.
//
// La consignation dans `_migrations` reste la responsabilité de chaque
// migration (convention du README), pas celle du runner : une migration peut
// légitimement décider de ne rien consigner si elle n'a rien fait.
//
// Usage :
//   node --env-file=.env apps/api/migrations/run.mjs 20260810-0001-amorcage-premier-super-admin
//   node --env-file=.env apps/api/migrations/run.mjs <nom> --down

import { MongoClient } from 'mongodb';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function usage(message) {
  console.error(`Erreur : ${message}

Usage :
  node --env-file=.env apps/api/migrations/run.mjs <nom-de-migration> [--down]

Le nom est celui du fichier, avec ou sans l'extension .mjs.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const down = args.includes('--down');
const rawName = args.find((a) => !a.startsWith('--'));

if (!rawName) usage('aucune migration nommée.');

const name = rawName.endsWith('.mjs') ? rawName.slice(0, -4) : rawName;
const uri = process.env['MONGODB_URI'];
const dbName = process.env['MONGODB_DB'];

if (!uri) usage('MONGODB_URI absent — passer --env-file=.env, ou exporter la variable.');
if (!dbName) usage('MONGODB_DB absent — passer --env-file=.env, ou exporter la variable.');

let migration;
try {
  migration = await import(pathToFileURL(resolve(__dirname, `${name}.mjs`)).href);
} catch (cause) {
  usage(`migration « ${name} » introuvable ou illisible (${cause.message}).`);
}

const direction = down ? 'down' : 'up';
if (typeof migration[direction] !== 'function') {
  usage(`la migration « ${name} » n'exporte pas de fonction \`${direction}\`.`);
}

const client = new MongoClient(uri);
try {
  await client.connect();
  console.log(`[run] ${direction} ${name} → base « ${dbName} »`);
  await migration[direction](client.db(dbName));
  console.log(`[run] ${direction} ${name} : terminé.`);
} catch (cause) {
  // Un échec de migration doit se voir et se distinguer d'un succès : code de
  // sortie non nul, sinon un script d'orchestration enchaînerait sur le
  // déploiement d'une version dont le schéma n'est pas en place.
  console.error(`[run] ${direction} ${name} : ÉCHEC — ${cause.stack ?? cause.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
