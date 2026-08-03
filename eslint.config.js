// Root ESLint flat config — minimal.
// Each app/package extends this and adds framework-specific rules.
// See ADR-0003 and docs/26-CONVENTIONS.md.

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      'sources/**',
    ],
  },
];
