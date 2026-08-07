# Migrations MongoDB — convention (S17a)

ADR-0004 prévoit des « migrations contrôlées » (`docs/24-INFRASTRUCTURE.md`,
« Déploiement »). Ce répertoire en fixe la structure ; l'outillage complet
(runner, verrou, table d'historique) viendra dans une itération ultérieure.

## Convention

- Un fichier par migration, **daté et ordonné** :

  ```
  apps/api/migrations/
    20260807-0001-exemple-ajout-index-projets.mjs
    20260815-0001-backfill-devise-organisations.mjs
  ```

  Format du nom : `AAAAMMJJ-NNNN-description-kebab.mjs` (NNNN = ordre dans la
  journée). L'ordre lexicographique = l'ordre d'exécution.

- Chaque migration est un module ES exportant deux fonctions :

  ```js
  /** @param {import('mongodb').Db} db */
  export async function up(db) {
    /* … */
  }

  /** @param {import('mongodb').Db} db — meilleure-effort, documenter si irréversible */
  export async function down(db) {
    /* … */
  }
  ```

- **Idempotence obligatoire** : une migration rejouée ne doit pas corrompre les
  données (`createIndex` est naturellement idempotent ; les backfills testent
  l'état avant d'écrire).

- Les migrations utilisent le driver `mongodb` brut (pas Mongoose) : elles ne
  doivent pas dépendre des schémas applicatifs, qui évoluent.

## Exécution

- **Avant** le démarrage de la nouvelle version de l'API (voir
  `scripts/deploy-vps.sh` — étape à insérer entre `pull` et `up -d` quand le
  runner existera).
- En attendant le runner, exécution manuelle documentée dans la PR qui introduit
  la migration :

  ```bash
  node --env-file=.env.production apps/api/migrations/AAAAMMJJ-NNNN-xxx.mjs
  ```

- Chaque migration exécutée est consignée dans la collection `_migrations`
  (`{ name, appliedAt }`) — c'est le futur registre du runner.

## Règles

1. Jamais de migration destructive sans sauvegarde préalable vérifiée.
2. Une migration = un changement de schéma/données ; pas de mélange.
3. Compatibilité N-1 : l'ancienne version de l'API doit tolérer le nouvel état
   (déploiement progressif, retour arrière possible — `docs/24-INFRASTRUCTURE.md`).
