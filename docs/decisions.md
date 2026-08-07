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
- 2026-07-31 — `apps/api` charge le `.env` via `dotenv` (pas `node --env-file`) — le parser strict de Node rejette les commentaires unicode (`─`, `—`) du template `.env.example`. `dotenv` (v16) les accepte.
- 2026-07-31 — Le projet vit désormais dans `~/Code/lalanda` (hors iCloud) — `~/Documents` est syncé iCloud par défaut sur macOS, ce qui offloade `node_modules` et déclenche des `ETIMEDOUT` sur `readFileSync`. Règle : jamais de projet Node lourd dans `~/Documents` ou `~/Desktop`.
- 2026-07-31 — Dev sans Docker local, DB dev = MongoDB Atlas M0 (`cluster0.qbpsuky`) — plus léger et plus proche de la prod (DO Managed) que `docker-compose` local. Docker reste utile pour Redis/MinIO à partir de S8 (files d'attente + stockage objet). Le `docker-compose.yml` est conservé pour ceux qui veulent tout en local.
- 2026-07-31 — Atlas Network Access : l'IP du dev doit être whitelistée dans Atlas → Network Access. Documenté dans `README.md` section « Démarrage ».
- 2026-07-31 — Excel = export-only, jamais d'import (ADR-0010). SheetJS retiré. Brief §11 S11 superseded. Toute saisie se fait dans Lalanda.
- 2026-08-04 — Poppins vendored dans `apps/web/public/fonts/` (poids 400/500/600/700) et chargée via `next/font/local` — évite définitivement les timeouts `fonts.gstatic.com` au build (rencontrés en S0 et à nouveau en S5b). Coût : ~32 Ko dans le repo, valeur : builds reproductibles offline.
- 2026-08-04 — Thème light/dark sans dépendance externe (pas de `next-themes`) — variables CSS pilotées par `[data-theme]` sur `<html>`, avec un script inline dans `layout.tsx` qui applique le thème avant le premier paint pour éviter le FOUC.
- 2026-08-08 — Canvas et Objectifs exposés comme des onglets de niveau projet (`/projects/:id/canvas`, `/projects/:id/objectifs`) plutôt que comme des onglets d'état interne — chaque section devient une URL partageable, le retour navigateur fonctionne, et le chantier n'entre pas en conflit avec les onglets de RÉSULTATS (`SheetTabs`) qui restent pilotés par `?tab=` (ADR-0011, périmètres S18).
- 2026-08-08 — Le taux d'atteinte renvoie `atteinte: null` + `raison: 'LIGNE_INDISPONIBLE'` quand la ligne source manque au snapshot du plan validé, au lieu d'une liste séparée d'objectifs « non évaluables » — un seul tableau d'objectifs, plus simple à afficher, et la forme colle au libellé d'ADR-0011 (contrat 4). Jamais 0, jamais de valeur inventée.
- 2026-08-08 — Rétention des révisions de Canvas bornée à 20 par projet, purge à l'écriture — l'historique docs/05 sert à retracer les changements récents, pas à archiver indéfiniment ; borne assumée et testée.
