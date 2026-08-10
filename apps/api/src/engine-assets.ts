// Localisation des fichiers YAML du moteur (templates, packs de paramètres).
//
// ── Le défaut que ce fichier corrige ─────────────────────────────────────────
//
// Trois registres résolvaient leurs YAML par un chemin relatif remontant quatre
// niveaux : `resolve(__dirname, '../../../../packages/engine/src/…')`. Cela
// suppose que le code tourne DANS l'arborescence du dépôt.
//
// En production ce n'est pas le cas. L'image embarque le moteur en dépendance
// (`pnpm deploy`), le code s'exécute depuis `/app/dist/…`, et la remontée de
// quatre niveaux aboutit à `/packages/engine/src/…` — un chemin qui n'existe
// pas. Toutes les routes de templates et de packs répondaient 500 : aucun
// projet ne pouvait être créé. Les fichiers, eux, étaient bien présents, à
// `/app/node_modules/@lalanda/engine/src/`.
//
// ── Pourquoi cette forme ─────────────────────────────────────────────────────
//
// On demande au résolveur de modules de Node où se trouve `@lalanda/engine`,
// puis on repart de là. Cela fonctionne partout où l'import fonctionne :
// dépôt en développement (lien de l'espace de travail), image de production
// (dépendance installée), et tout futur agencement — parce que c'est la même
// mécanique qui trouve le paquet à l'exécution.
//
// On résout `@lalanda/engine/package.json`, et non le point d'entrée du paquet.
// Deux impasses écartées, toutes deux constatées et non supposées :
//   - `createRequire().resolve('@lalanda/engine')` échoue avec « No "exports"
//     main defined » : le moteur est un paquet ESM dont la carte `exports` ne
//     déclare que la condition `import`, invisible au résolveur CJS;
//   - `import.meta.resolve` fonctionne sous Node, mais pas sous vitest, dont la
//     transformation SSR ne le fournit pas — les tests ne pourraient donc pas
//     couvrir ce chemin, ce qui est précisément ce qu'on veut éviter ici.
//
// D'où l'entrée `"./package.json"` ajoutée à la carte d'exports du moteur :
// c'est l'usage courant, et elle rend le chemin du paquet lisible par tous les
// résolveurs. Les YAML sont des SOURCES, pas des artefacts de compilation —
// `tsc` ne les copie pas dans `dist/`, et c'est bien `src/` qui fait foi.

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const exiger = createRequire(import.meta.url);

/** Racine `src/` du paquet moteur, quelle que soit la manière dont il est installé. */
export const ENGINE_SRC = resolve(dirname(exiger.resolve('@lalanda/engine/package.json')), 'src');

/** Chemin absolu d'un actif du moteur, à partir de sa racine `src/`. */
export function engineAsset(...segments: string[]): string {
  return resolve(ENGINE_SRC, ...segments);
}
