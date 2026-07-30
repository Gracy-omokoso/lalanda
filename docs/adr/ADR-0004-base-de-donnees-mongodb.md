# ADR-0004 — Base de données : MongoDB 7 + Mongoose 8

Statut : Accepted
Date : 2026-07-30
Décideurs : Gracy Omokoso

## Contexte

`docs/14-ARCHITECTURE.md:36` : *« MongoDB si le brief source le confirme »*. Le brief §4 et §5 confirment et imposent des règles précises.

## Décision

**MongoDB 7 + Mongoose 8** via `@nestjs/mongoose`.

Règles obligatoires (brief §5) :

1. **Replica set mono-nœud en local** (`--replSet rs0`, `rs.initiate()` automatique via un service `mongo-init`).
2. **`CascadeService` central** pour l'intégrité référentielle (aucun orphelin toléré).
3. **Transactions Mongoose obligatoires** pour : création de version, débit de crédits, publication de template, suppression en cascade.
4. **Index explicites** dans les schémas, listés au brief §6. `mongoose.set('debug')` en dev.
5. **Argent** : entiers en centimes (`Money { amount, currency }`), taux et pourcentages en `Decimal128`.
6. **Limite 16 Mo** : agrégats dans le document, grille complète en JSON gzippé sur stockage objet.
7. **Pas de tableau non borné** dans un document.
8. **`_schemaVersion`** sur chaque document, migrations idempotentes dans `apps/api/src/migrations/`.
9. **`strict: true` et `strictQuery: true`** partout.
10. **Pipelines d'agrégation** pour tout calcul de groupe.

## Conséquences

- Le schéma détaillé du brief §6 sera implémenté en Sprint 3 (données et API).
- Le `docker-compose.yml` de S0 démarre déjà le replica set.

## Alternative rejetée

**PostgreSQL + Prisma** — proposé initialement pour la richesse des contraintes et des transactions. Rejeté : le brief tranche pour MongoDB et impose les disciplines complémentaires (§5).

## Liens

- `sources/brief/lalanda-brief.md` §4, §5, §6
- `docs/14-ARCHITECTURE.md`
- `docs/15-DATABASE.md`
