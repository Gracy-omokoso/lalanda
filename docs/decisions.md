# Journal des micro-décisions

Les décisions non structurantes prises en cours de développement sont consignées ici :
`date — choix — raison` (une ligne).

Les décisions structurantes passent par un ADR dans [`adr/`](adr/).

---

- 2026-07-30 — Node 20 LTS retenu (fixé par `.nvmrc` et `engines.node`) — LTS stable, requis par NestJS 10 et Next.js 15.
- 2026-07-30 — pnpm `packageManager` épinglé dans le `package.json` racine — reproductibilité entre postes.
- 2026-07-30 — Tailwind CSS 4 (nouvelle syntaxe `@theme`) sur `apps/web` — dernière version stable au démarrage, aligné avec shadcn/ui.
- 2026-07-30 — MongoDB 7.0 (pas 8.x) dans `docker-compose.yml` — même version que la cible prod, moins de risques d'écart de comportement.
- 2026-07-30 — MinIO comme mock local de DigitalOcean Spaces — S3-compatible, gratuit, container léger.
- 2026-07-30 — Poppins reportée à S5 (interface) — sera intégrée via `next/font/local` avec woff2 auto-hébergés pour éviter la dépendance réseau à Google Fonts (build échoue si `fonts.gstatic.com` inaccessible). En S0 : polices système.
