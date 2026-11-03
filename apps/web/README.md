# @lalanda/web

Frontend Next.js 15 (App Router) — Tailwind 4 + shadcn/ui + IBM Plex Sans (ADR-0055 ; Poppins jusqu'au 3 nov. 2026).

## Statut S0

- Page d'accueil minimale.
- Route API `/health` qui proxy vers `apps/api`.
- Police de texte IBM Plex Sans via `next/font/local` (woff2 auto-hébergés dans `public/fonts/`, licence OFL 1.1).

Le wizard et les vues métier arrivent en **S5** (brief §11).

## Développement

```bash
pnpm --filter @lalanda/web dev
# → http://localhost:3000
# → http://localhost:3000/health
```
