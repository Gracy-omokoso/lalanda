// Configuration vitest de apps/web (S18c).
// Portée : logique pure uniquement (pas de rendu React — aucun environnement DOM
// n'est installé). Le seul réglage nécessaire est l'alias `@/` du tsconfig.

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
