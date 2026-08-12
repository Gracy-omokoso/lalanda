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
- MinIO joue le rôle de stockage S3 sur le Droplet tant qu'un stockage objet
  géré n'est pas provisionné. Voir « Stockage objet » ci-dessous : la bascule
  n'est **pas** un simple changement d'endpoint.

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
- bascule MinIO → Cloudflare R2 (procédure ci-dessous ; le code est prêt, il
  manque un compte R2 et la recopie des objets) ;
- découplage des identifiants MinIO et des identifiants du stockage distant,
  aujourd'hui portés par la même paire `S3_ACCESS_KEY`/`S3_SECRET_KEY` ;
- sauvegardes (mongodump + volumes, dont certificats Caddy) et restauration testée ;
- monitoring/alerting (observabilité ci-dessous) ;
- runner de migrations outillé ;
- environnement staging dédié.

## Stockage objet — MinIO, Spaces et Cloudflare R2

### Un seul protocole, un seul interrupteur

MinIO, DigitalOcean Spaces et Cloudflare R2 exposent **la même API S3** : même
signature SigV4, même nom de service `s3` dans le scope, mêmes verbes.
`apps/api/src/storage/sigv4.ts` est donc inchangé, et le service reste compatible
avec les trois. Le choix se fait par **une seule valeur, `S3_ENDPOINT`**, et non
par un drapeau `STORAGE_PROVIDER` : un tel drapeau serait une seconde source de
vérité, libre de contredire le serveur réellement contacté.

Ce qui change réellement d'un fournisseur à l'autre tient en deux points, tous
deux de configuration :

| | MinIO (en service) | DO Spaces | Cloudflare R2 |
|---|---|---|---|
| `S3_ENDPOINT` | `http://minio:9000` | `https://ams3.digitaloceanspaces.com` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_REGION` | `us-east-1` (défaut) | `ams3` | **laisser vide** → `auto` |
| `S3_FORCE_PATH_STYLE` | `true` (obligatoire) | `false` | `true` ou `false` |

R2 n'a pas de région au sens AWS. Mais SigV4 **exige** un jeton de région dans le
scope de signature — il n'existe pas de signature sans. Cloudflare attend le
littéral `auto`. Le code déduit donc la région de l'hôte (`auto` pour un endpoint
`*.r2.cloudflarestorage.com`, `us-east-1` sinon) plutôt que d'exiger de
l'exploitant qu'il devine une valeur pour un service qui n'a pas de régions. Un
`S3_REGION` explicite gagne toujours : le défaut ne comble que le silence.

La détection se fait sur le **suffixe** d'hôte, jamais par `includes` : un bucket
MinIO nommé `r2.cloudflarestorage.com.interne` ne doit pas basculer les défauts
d'un serveur qui n'est pas R2.

Le préfixe des variables reste `S3_` : il nomme le **protocole**, pas un
fournisseur. Ces variables sont déjà posées en production et lues par
`packages/shared` comme par le service MinIO de `docker-compose.prod.yml` ;
ADR-0013 §8 programme par ailleurs leur retrait au profit du coffre à secrets.

### Deux pièges avant de basculer

**MinIO est en service et son volume contient de vraies photos de profil.** La
bascule n'est pas un changement d'endpoint, pour deux raisons indépendantes.

1. **Les identifiants sont partagés.** `docker-compose.prod.yml` interpole
   `S3_ACCESS_KEY`/`S3_SECRET_KEY` en `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`
   (services `minio` et `minio-init`). Ces variables servent donc à la fois de
   *client* pour l'API et de *compte root* pour le serveur MinIO. Y écrire un
   jeton R2 renomme le compte root du MinIO qui tourne. Le découplage est inscrit
   au « Reste à faire ».
2. **Changer l'endpoint ne déplace aucun objet.** Le bucket R2 démarre vide ;
   les photos existantes restent dans le volume `minio-data`. Sans recopie
   préalable, elles disparaissent de l'interface au redémarrage.

### Marche à suivre (à exécuter avec de vrais identifiants R2)

1. Créer le compte R2, les buckets (`lalanda-uploads`, `lalanda-exports`,
   `lalanda-snapshots`) et un jeton d'API R2 en lecture/écriture.
2. **Recopier d'abord**, hors ligne de production :
   `mc mirror local/lalanda-uploads r2/lalanda-uploads` (ou `rclone sync`).
   Vérifier le nombre d'objets des deux côtés.
3. Saisir les identifiants dans `/admin → Intégrations → Cloudflare R2` et
   cliquer « Tester » : le test exécute un `HeadBucket` sur le bucket des
   exports — lecture seule, aucun objet lu ni écrit, aucun coût.
4. Basculer `S3_ENDPOINT` (et les identifiants, en tenant compte du piège 1),
   laisser `S3_REGION` vide, redéployer.
5. Vérifier qu'une photo de profil **existante** s'affiche encore, puis qu'un
   nouveau téléversement fonctionne.
6. **Ne supprimer le volume `minio-data` qu'après** cette vérification : c'est
   le seul retour en arrière possible.

Aucune URL d'image en circulation ne dépend du fournisseur — l'API sert les
images elle-même — donc aucun lien existant ne casse à la bascule.

### État de vérification

Le code est écrit et couvert par des tests hors ligne
(`apps/api/src/storage/storage.test.ts`,
`apps/api/src/integrations/connection-tests.test.ts`) qui vérifient la région
signée, le scope, la méthode et l'absence d'écriture. **Aucun appel réel à R2 n'a
été effectué** : cela demande un compte R2, et reste à faire à l'étape 3
ci-dessus.

## ElevenLabs (assistant vocal)

Déclaré au catalogue des intégrations en **configuration seulement** : aucune
synthèse vocale n'est implémentée, et l'usage produit n'est pas spécifié — d'où
l'absence de champ `voiceId` ou `modelId`, qui préjugerait d'une décision non
prise.

La clé se saisit exclusivement dans `/admin → Intégrations`, où elle est
chiffrée. **Aucune variable d'environnement** ne lui est ouverte, contrairement à
`OPENAI_API_KEY` : cette clé n'a jamais transité par l'environnement, et lui
créer un secours reviendrait à recréer l'hybride permanent qu'ADR-0013 rejette.

Le bouton « Tester » appelle `GET /v2/voices` — lecture seule. ElevenLabs facture
**au caractère synthétisé** : brancher le test sur un point de génération
coûterait de l'argent à chaque clic. L'authentification passe par l'en-tête
`xi-api-key`, et non par `Authorization: Bearer`.

Comme pour R2, aucun appel réel n'a été effectué faute de clé.

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
