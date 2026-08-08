# Stratégie de tests

**Statut :** Draft  
**Version :** 0.1

## Pyramide

- unitaires : formules, règles, validations et permissions;
- intégration : base, files, stockage, paiement et Country Packs;
- contrats : API et événements;
- parcours : onboarding, wizard, validation, réalisé, export;
- non fonctionnels : sécurité, performance, accessibilité et reprise.

## Moteur financier

Chaque formule possède cas normal, limites, zéros, valeurs négatives, arrondis et propriétés invariantes.

Golden files :

- entrées extraites du classeur source;
- résultats attendus;
- version de référence;
- tolérance documentée;
- justification de tout écart.

Les résultats API, écran, Excel et PDF sont comparés à la même exécution.

## Validation Excel

Les classeurs générés sont ouverts et recalculés par LibreOffice en automatisation. Les tests contrôlent absence d’erreur de formule, feuilles, cellules clés, formats et valeurs attendues.

## Multi-tenant et permissions

Tests systématiques de lecture, écriture, recherche, export, tâche asynchrone et URL de fichier entre deux organisations. Toute nouvelle ressource cliente ajoute ces cas.

## Country Packs

- périodes avant/après date d’effet;
- règle absente;
- surcharge;
- version retirée;
- source obligatoire;
- reproduction historique;
- publication empêchée si validation incomplète.

## Imports

Fichiers volumineux, colonnes manquantes, types invalides, doublons, formules malveillantes, encodages, annulation et idempotence.

## Performance

Budgets à fixer pour navigation, calcul, export, import et dashboards. Les tests utilisent volumes réalistes par plan et détectent les requêtes non bornées.

## Accessibilité

Contrôles automatisés et scénarios clavier/lecteur d’écran sur onboarding, wizard, tableaux, modales et erreurs.

## CI

Sur pull request : format, lint, types, unitaires, contrats et sécurité rapide. Sur branche principale : intégration, golden files et parcours. Planifié : dépendances, performance et restauration.

## CI e2e (S19a)

### Le problème corrigé

Les suites e2e de `apps/api/src/__tests__/` s’auto-skippaient quand `MONGODB_URI` était absent. Le workflow GitHub Actions ne fournissait pas MongoDB : elles ne s’exécutaient **jamais** en CI. Les quatre merges du batch S18 sont passés au vert alors que la suite complète était rouge en local — un faux sens de sécurité. Sur `main`, 142 tests s’exécutaient réellement en CI et 56 étaient silencieusement skippés.

Deux causes se cumulaient :

1. **aucun service MongoDB** dans le workflow;
2. **`envMode` strict de Turborepo 2** — une tâche ne reçoit que les variables déclarées dans `globalEnv`. Même en ajoutant un service Mongo, `MONGODB_URI` n’aurait pas atteint le process vitest et les suites seraient restées skippées.

### Service MongoDB en CI

Le moteur ouvre des transactions Mongoose (ADR-0004), indisponibles sur un `mongod` autonome : il faut un **replica set**. Un bloc `services:` de GitHub Actions ne permet ni de surcharger la commande du conteneur (`--replSet`) ni de lancer `rs.initiate` — le conteneur est donc démarré à la main, en miroir de `docker-compose.yml` :

- `mongo:7.0` lancé avec `--replSet rs0 --bind_ip_all`, port 27017 publié;
- attente de `db.adminCommand({ ping: 1 })`, puis `rs.initiate` avec le membre déclaré sur `localhost:27017` (l’adresse vue par le runner — `directConnection=true` évite toute redécouverte de topologie sur un hostname non résolvable);
- attente de l’élection du primaire (`db.hello().isWritablePrimary`);
- **sonde de transaction** explicite : une transaction est ouverte et committée avant de lancer les tests, pour échouer sur un message clair plutôt que sur une erreur obscure au milieu de la suite.

Chaque attente est bornée (120 s) et échoue avec les journaux du conteneur.

Variables fournies au job de test — secrets factices, aucun service externe n’est appelé : `MONGODB_URI` (base dédiée `lalanda_ci`, jamais `lalanda`), `MONGODB_DB`, `AUTH_SECRET` (≥ 32 caractères, exigé par `packages/shared/src/env`), `AUTH_URL`, `API_URL`, `WEB_URL`, `OPENAI_API_KEY`. `REDIS_URL` et les variables `S3_*` restent optionnelles depuis S16a. Toutes sont déclarées dans `globalEnv` de `turbo.json`, sans quoi elles n’atteignent pas les tests.

### Lancer les e2e en local

```bash
docker compose up -d mongo mongo-init   # rs0 sur 27017
cp .env.example .env                    # MONGODB_URI y est déjà renseignée
pnpm install
pnpm --filter @lalanda/shared --filter @lalanda/engine build
pnpm test                               # ou: pnpm --filter @lalanda/api test
```

Sans `MONGODB_URI`, les suites e2e se skippent — confort assumé pour un dev sans docker en marche. Le `.env` est chargé par `apps/api/src/__tests__/e2e-utils.ts`; en CI les variables viennent du process.

Pour reproduire exactement le comportement de la CI en local, ajouter `LALANDA_REQUIRE_E2E=1`.

### Garantie anti-skip

Un job vert doit prouver que les e2e ont tourné. Deux garde-fous indépendants, tous deux activés par `LALANDA_REQUIRE_E2E=1` :

1. **Garde de suite** — `e2eSuite()` (`apps/api/src/__tests__/e2e-utils.ts`) remplace le `describe.skip` local. Si `MONGODB_URI` manque alors que `LALANDA_REQUIRE_E2E=1`, la fonction **lève à la collecte** : le fichier échoue au lieu d’être ignoré. Toute nouvelle suite e2e doit passer par ce helper.
2. **Comptage des tests exécutés** — vitest écrit un rapport JSON (`apps/api/.vitest/report.json`, produit uniquement en CI) que `scripts/verify-e2e-executed.mjs` inspecte dans une étape dédiée. Il échoue si un fichier `*.e2e.test.ts` compte le moindre test skippé, ou n’en a exécuté aucun. Il affiche le détail par fichier et le total exécuté.

Les skips conditionnels des tests **unitaires** ne sont pas concernés : ils dépendent des templates embarqués (ex. `it.skipIf` sur les drivers de BFR), pas de la disponibilité d’une base.

### Nettoyage des données de test

Les `afterAll` utilisaient `mongoose.connection` — la connexion **globale** du driver, que personne n’ouvre : Nest ouvre la sienne via `MongooseModule.forRootAsync`. `mongoose.connection.db` valait `undefined`, le garde `if (db)` sautait tout le bloc en silence et chaque exécution laissait users, organisations, projets et snapshots en base.

`teardown(app, emails)` remplace ces blocs : il récupère la connexion réellement utilisée par l’application, puis purge **en cascade** à partir des seuls emails de test — users → organisations → collections applicatives (toutes portent un `organizationId`). Les anciens `deleteMany({})` sans filtre sur `session`, `account`, `memberships`, `subscriptions` et `invitations` ont été supprimés : inoffensifs tant qu’ils écrivaient sur une connexion morte, ils auraient déconnecté les suites encore en cours une fois le bug corrigé (vitest exécute les fichiers en parallèle sur la même base).

## Sortie

Un défaut financier ou d’isolation bloque la livraison. Les exceptions documentent risque, propriétaire, échéance et mesure compensatoire.
