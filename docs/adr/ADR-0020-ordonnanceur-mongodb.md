# ADR-0020 — Ordonnanceur : tâches planifiées stockées dans MongoDB

Statut : Accepted
Date : 2026-10-18
Décideurs : Gracy Omokoso (trajectoire, ADR-0018) ; choix technique délégué à l'équipe de développement

## Contexte

Lalanda n'avait aucun moyen de déclencher une action dans le temps (ADR-0009,
S16a) : les transitions d'abonnement étaient appliquées paresseusement à la
lecture, et un balayage manuel (`POST /payments/maintenance/sweep`) servait les
rapports. Le module ventes (ADR-0018) en a besoin — échéances, relances — et la
facture normalisée aussi : une demande envoyée à la DGI mais ni confirmée ni
annulée doit être soldée sans intervention (ADR-0019).

Contexte d'exploitation : une seule machine, un seul processus d'API, MongoDB en
replica set `rs0` (transactions disponibles), Redis présent mais inutilisé.

## Options considérées

1. **`@nestjs/schedule` (cron en mémoire).** Écarté : rien n'est persisté. Une
   tâche ponctuelle (« relancer cette facture le 12 ») disparaît au redémarrage,
   et deux instances exécuteraient chaque cron deux fois.
2. **BullMQ sur Redis.** Écarté pour l'instant : une infrastructure de plus à
   surveiller et à sauvegarder, et surtout aucune atomicité avec l'écriture
   métier — une facture enregistrée en base dont l'échéance se perdrait dans Redis
   est exactement le défaut à éviter.
3. **Collection `scheduled_jobs` dans MongoDB, réclamation atomique.** Retenu.

## Décision

- **Une tâche est un document** (`name`, `key` unique, `payload`, `status`
  `pending|running|done|failed`, `runAt`, `everyMs`, `attempts`, `maxAttempts`,
  bail `lockedBy`/`lockedUntil`, `lastError`).
- **Réclamation** par `findOneAndUpdate` atomique : tâche échue la plus ancienne,
  ou tâche `running` dont le bail (5 min) a expiré — son processus est présumé
  mort. La réclamation consomme une tentative.
- **Échec** : nouvelle tentative après 30 s, 1 min, 2 min… (plafond 1 h) ; au-delà
  de `maxAttempts`, une tâche ponctuelle passe en `failed`. Une tâche récurrente ne
  s'éteint jamais : elle repart à la période suivante.
- **`schedule()` est rejouable** grâce à l'index unique sur `key`.
- **Garantie « au moins une fois »** : un gestionnaire doit être idempotent et finir
  bien avant le bail. Aucune promesse « exactement une fois ».
- **Passage toutes les 15 s** dans le processus d'API (`SCHEDULER_ENABLED`, actif
  par défaut, coupé dans les tests e2e qui pilotent le temps).
- Seules les tâches dont l'instance connaît le gestionnaire sont réclamées : après
  un retour arrière de déploiement, une tâche orpheline attend au lieu d'échouer.
- **Premier client** : `billing.sweep`, toutes les heures.

## Conséquences

- Une tâche peut être créée dans la même transaction que l'écriture qui la motive.
- Le débit est limité (20 tâches par passage, une à la fois) : suffisant pour des
  échéances et des reprises, pas pour des envois de masse. Le jour où il faudra
  davantage, BullMQ redevient une option — l'interface `schedule/register/every`
  ne change pas.
- **Constat associé (même lot)** : en production, `autoIndex` est coupé et aucun
  index n'existait, unique ou non. `IndexesService` crée désormais au démarrage
  les index manquants des modèles et des collections de better-auth (création
  seule, jamais de suppression). Deux schémas déclaraient deux index sous le même
  nom (`user_preferences`, `email_change_requests`) ; corrigés.

## Plan de validation

`scheduler.e2e.test.ts` contre une vraie base : clé unique, échéance respectée,
deux instances concurrentes → une exécution, reprise après bail expiré,
replanification puis abandon, récurrence, tâches orphelines, annulation.
`database-indexes.e2e.test.ts` : création sur base vierge sans échec, rejouable.

## Liens

- [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) — trajectoire ERP ; [ADR-0019](ADR-0019-facture-normalisee-dgi-rdc.md) — facture normalisée.
- `apps/api/src/scheduler/`, `apps/api/src/database/indexes.service.ts`, `apps/api/src/billing/billing.jobs.ts`.
