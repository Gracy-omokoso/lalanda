// Configuration ESLint partagée des paquets Node/TypeScript : apps/api,
// packages/engine, packages/shared. Chaque paquet a son propre
// `eslint.config.js` qui appelle `typescriptConfig(import.meta.dirname)`.
//
// apps/web garde `next lint` (eslint-config-next) : ce fichier ne le concerne pas.
//
// Linting TYPÉ (règles qui ont besoin du vérificateur de types) : chaque paquet
// fournit un `tsconfig.eslint.json` qui reprend son `tsconfig.json` en y
// réintégrant les tests (exclus du build). Les imports entre paquets du monorepo
// se résolvent sur leur `dist` : la tâche turbo `lint` dépend donc de `^build`.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** @param {string} tsconfigRootDir dossier du paquet (`import.meta.dirname`) */
export function typescriptConfig(tsconfigRootDir) {
  return tseslint.config(
    {
      ignores: ['dist/**', 'coverage/**', '.turbo/**', '.vitest/**', 'node_modules/**'],
    },
    {
      linterOptions: {
        // Une directive `eslint-disable` devenue inutile est une exception
        // oubliée : on la signale pour qu'elle disparaisse.
        reportUnusedDisableDirectives: 'error',
      },
    },
    {
      files: ['**/*.ts'],
      extends: [js.configs.recommended, ...tseslint.configs.recommended],
      languageOptions: {
        parserOptions: {
          project: ['./tsconfig.eslint.json'],
          tsconfigRootDir,
        },
      },
      rules: {
        // --- Ajouts au socle `recommended` -----------------------------------
        // Une promesse oubliée est une écriture Mongo qui peut échouer en
        // silence, ou une réponse envoyée avant la fin d'une transaction.
        '@typescript-eslint/no-floating-promises': 'error',
        // Une fonction async passée là où un callback synchrone est attendu
        // (forEach, écouteur, condition) : son rejet n'est jamais observé.
        '@typescript-eslint/no-misused-promises': 'error',
        // Le dépôt écrit déjà `import type` / `{ type X }` : la règle fige ce
        // style. typescript-eslint lit `emitDecoratorMetadata` dans le tsconfig
        // et ne convertit pas, dans les fichiers à décorateurs Nest, les classes
        // injectées (elles doivent rester des imports de valeur).
        // `typeof import('…')` reste permis : c'est la forme idiomatique de
        // vitest (`vi.importActual<typeof import('./x.js')>`) pour typer un
        // module simulé sans l'importer.
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
        ],
        // Le code produit journalise par le logger Nest/pino, jamais par
        // `console` : les rares exceptions (amorçage avant que le logger
        // existe) portent déjà un `eslint-disable-next-line no-console`.
        'no-console': 'error',
        // Un seul `import` de valeurs par module (doublons trouvés dans cinq
        // suites e2e). Un `import type` séparé reste permis : c'est un style
        // courant du dépôt, pas un doublon.
        'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],

        // --- Exceptions explicites -------------------------------------------
        // Préfixe `_` = paramètre ou variable volontairement ignoré (signature
        // imposée par Nest ou par un callback, déstructuration pour retirer une
        // clé d'un objet).
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
            destructuredArrayIgnorePattern: '^_',
            ignoreRestSiblings: true,
          },
        ],
      },
    },
    {
      files: ['**/*.test.ts', '**/__tests__/**/*.ts'],
      rules: {
        // Les tests lisent des réponses HTTP (supertest) et des documents Mongo
        // bruts dont le type n'est pas celui du domaine ; les forcer en `any`
        // à la frontière est le choix lisible. Le code produit reste soumis à
        // la règle.
        '@typescript-eslint/no-explicit-any': 'off',
        // Un test peut tracer un diagnostic (durées, contexte d'échec).
        'no-console': 'off',
      },
    },
    {
      // Scripts JavaScript en ligne de commande (migrations, génération
      // d'assets, contrôles manuels) : Node, ESM, `console` est leur sortie.
      files: ['**/*.mjs', '**/*.js'],
      extends: [js.configs.recommended],
      languageOptions: {
        sourceType: 'module',
        globals: { ...globals.node },
      },
      rules: {
        'no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
      },
    },
  );
}
