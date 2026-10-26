import { defineConfig } from 'vitest/config';

// En CI (`LALANDA_REQUIRE_E2E=1`), on produit en plus du rendu console un rapport
// JSON exploité par `scripts/verify-e2e-executed.mjs` : il vérifie que les suites
// e2e ont RÉELLEMENT tourné et n'ont pas été skippées faute de MongoDB (S19a).
// Hors CI, aucun fichier n'est écrit — le confort local reste inchangé.
const reportForCI = process.env['LALANDA_REQUIRE_E2E'] === '1';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Une base par fichier e2e, délais e2e, préchargement de l'application :
    // voir l'en-tête du fichier. Sans effet sur les tests unitaires.
    setupFiles: ['src/__tests__/e2e-database.setup.ts'],
    ...(reportForCI
      ? {
          reporters: ['default', 'json'],
          outputFile: { json: '.vitest/report.json' },
        }
      : {}),
  },
});
