# Infrastructure et exploitation

**Statut :** Draft  
**Version :** 0.2

## Implémenté (S17a)

Chaîne de déploiement conforme à l'ADR-0009 (DigitalOcean Droplets + Spaces + Caddy).

### Images Docker (multi-stage, non-root, healthchecks)

- `apps/api/Dockerfile` — build pnpm workspace (`pnpm --filter @lalanda/api... build`
  puis `pnpm deploy --prod`), runtime `node:20-slim` (Debian) avec le paquet
  `chromium` de la distribution pour Puppeteer/PDF (ADR-0007) via
  `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` — Alpine est exclu car le
  Chromium téléchargé par Puppeteer exige glibc. `HEALTHCHECK` sur `/health`.
- `apps/web/Dockerfile` — `next build` avec `output: 'standalone'`
  (activé dans `next.config.mjs`), runtime `node:20-alpine`. `HEALTHCHECK` sur
  `/health`. Attention : `NEXT_PUBLIC_API_URL` est inlinée au build (build-arg).
- `.dockerignore` racine : secrets (`.env*`), node_modules, sorties de build.

### Stack de production

- `docker-compose.prod.yml` — caddy + web + api + mongo (replica set `rs0`) +
  redis + minio ; réseau `edge` (seul Caddy publie 80/443) séparé du réseau
  `interne` (`internal: true` — mongo/redis/minio inaccessibles de l'extérieur) ;
  volumes persistants ; healthchecks ; `env_file: .env.production`
  (gabarit : `.env.production.example`, sans secrets).
- `Caddyfile` — HTTPS automatique Let's Encrypt, `APP_DOMAIN → web:3000`,
  `API_DOMAIN → api:3001`, en-têtes de sécurité (HSTS, nosniff, X-Frame-Options).
- MinIO joue le rôle de stockage S3 sur le Droplet tant que DigitalOcean Spaces
  n'est pas provisionné (bascule = changer `S3_ENDPOINT` + credentials).

### CI/CD

- `.github/workflows/deploy.yml` — sur tag `v*` : build + push des deux images
  sur GHCR (`ghcr.io/<owner>/lalanda-api|web`, tags semver + `latest`,
  `GITHUB_TOKEN` seul requis). Le job de déploiement SSH est **désactivé par
  défaut** (gate `vars.DEPLOY_ENABLED == 'true'`) : sans secrets DO il est
  skippé, le workflow ne casse pas. Activation documentée en tête du fichier.
- `scripts/deploy-vps.sh` — déploiement sur le Droplet avec garde-fous
  (vérification `.env.production`, refus des `CHANGE-ME`, attente des
  healthchecks, prune).

### Migrations

- `apps/api/migrations/README.md` — convention (fichiers datés
  `AAAAMMJJ-NNNN-*.mjs`, `up`/`down` idempotents, exécution avant démarrage,
  registre `_migrations`). Runner à outiller ultérieurement.

### Reste à faire

- provisioning des Droplets (staging + production) et DNS ;
- secrets GitHub (`DO_SSH_HOST/USER/KEY`) + variables (`DEPLOY_ENABLED`,
  `NEXT_PUBLIC_API_URL`) ;
- bascule MinIO → DigitalOcean Spaces (`ams3`) ;
- sauvegardes (mongodump + volumes, dont certificats Caddy) et restauration testée ;
- monitoring/alerting (observabilité ci-dessous) ;
- runner de migrations outillé ;
- environnement staging dédié.

## Environnements

- local;
- test/CI;
- staging;
- production.

Les données de production ne sont pas copiées en environnement inférieur sans anonymisation approuvée.

## Composants

- application web;
- API;
- workers de calcul, import et export;
- base principale;
- cache/file;
- stockage objet;
- service d’identité;
- paiement;
- observabilité;
- fournisseur IA optionnel.

Les fournisseurs sont choisis par ADR.

## Déploiement

- artefacts immuables;
- infrastructure déclarative;
- migrations contrôlées;
- stratégie de retour;
- vérifications de santé;
- déploiement progressif pour changements risqués;
- séparation des secrets;
- journal des versions.

## Observabilité

### Logs

Structurés avec corrélation, organisation pseudonymisée, composant, niveau et code d’événement.

### Métriques

Latence, erreurs, saturation, files, durée de calcul, durée d’export, imports rejetés, webhooks, quotas, cache et disponibilité.

### Traces

Suivent les appels web/API/worker sans exposer les données financières.

## SLO initiaux à définir

Disponibilité, latence API, temps de calcul, temps d’export et délai de traitement des événements de paiement. Les objectifs exacts seront fixés après prototypes et besoins commerciaux.

## Tâches asynchrones

Clé d’idempotence, tentatives bornées, backoff, file d’échec, visibilité de progression et outil de reprise.

## Coûts

Suivi par environnement et composant. Les quotas IA, stockage d’exports et rétention sont alignés sur les plans.

## Continuité

Sauvegardes, restauration testée, procédures d’incident, rotation des secrets, dépendances critiques inventoriées et communication d’état.
