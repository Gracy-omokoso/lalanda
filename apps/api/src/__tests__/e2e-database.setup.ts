// UNE BASE PAR FICHIER e2e (S20c).
//
// ── Le problème ────────────────────────────────────────────────────────────────
//
// vitest exécute les FICHIERS de test en parallèle, et toutes les suites e2e
// ouvraient jusqu'ici la même base. Chaque suite se croyait isolée parce que son
// nettoyage est scopé par utilisateur et par organisation (voir `purgeTestUsers`,
// et l'incident S19a qu'il documente) — mais le scope des données n'est pas la
// seule chose que deux suites partagent quand elles visent la même base : elles
// partagent aussi ses collections, ses index, ses verrous d'écriture et le budget
// d'un unique mongod. Un `afterAll` qui purge pendant qu'une autre suite démarre
// suffit à faire répondre 500 à une lecture par ailleurs correcte — et une suite
// qui lit `body.version` sur cette réponse voit `undefined` au lieu d'un nombre.
// C'est la forme qu'avait le flake intermittent de `canvas.e2e.test.ts`.
//
// ── La correction ──────────────────────────────────────────────────────────────
//
// `MONGODB_DB` pilote À LA FOIS la connexion Mongoose (`app.module.ts`) et
// l'adapter mongodb de better-auth (`auth.module.ts`). Le suffixer par le nom du
// fichier de test donne à chaque suite SA base, sans toucher au code applicatif
// ni à aucune des onze suites : elles construisent leur application après ce
// fichier de setup, et lisent donc la valeur posée ici.
//
// Trois propriétés en découlent :
//   1. la CI reste PARALLÈLE — l'isolation ne coûte pas la sérialisation;
//   2. aucune suite ne devient skippable — `e2eSuite` et sa garde anti-skip
//      (`LALANDA_REQUIRE_E2E`) sont inchangés;
//   3. chaque suite démarre sur une base VIDE, y compris après une exécution
//      précédente interrompue (hook en timeout, process tué) : le `drop` a lieu
//      à l'ouverture, pas seulement au nettoyage.
//
// `process.env` est propre à chaque worker vitest (les worker_threads en
// reçoivent une copie), et un worker n'exécute qu'un fichier à la fois : écrire
// `MONGODB_DB` ici ne peut pas fuiter vers une suite concurrente.
//
// Les tests unitaires ne sont pas concernés : ce setup ne fait rien hors des
// fichiers `*.e2e.test.ts`, et rien du tout sans `MONGODB_URI`.

import { MongoClient } from 'mongodb';
import { basename } from 'node:path';
import { beforeAll, expect } from 'vitest';

/** Base de rattachement — celle de la CI (`lalanda_ci`) ou le défaut applicatif. */
const BASE_DB = process.env['MONGODB_DB'] ?? 'lalanda';

/**
 * Nom de base dérivé du fichier de test.
 *
 * Les caractères interdits par MongoDB (`/\. "$*<>:|?`) sont remplacés, et le
 * résultat est tronqué : un nom de base dépasse rarement 63 octets, mais rien
 * n'empêche un futur fichier au nom très long.
 */
function suiteDbName(testPath: string): string {
  const slug = basename(testPath)
    .replace(/\.e2e\.test\.ts$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase();
  return `${BASE_DB}_${slug}`.slice(0, 63);
}

const testPath = expect.getState().testPath ?? '';
const isE2E = testPath.endsWith('.e2e.test.ts');
const uri = process.env['MONGODB_URI'];

if (isE2E && uri) {
  const dbName = suiteDbName(testPath);
  process.env['MONGODB_DB'] = dbName;

  beforeAll(async () => {
    // Table rase AVANT la suite, et non seulement après : une exécution
    // précédente tuée en plein vol (hook en timeout) laisserait sinon ses
    // documents derrière elle, et la suite suivante démarrerait sur un état
    // qu'elle n'a pas produit.
    const client = new MongoClient(uri);
    try {
      await client.connect();
      await client.db(dbName).dropDatabase();
    } finally {
      await client.close();
    }
  }, 30_000);
}
