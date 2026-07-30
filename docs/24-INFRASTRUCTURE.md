# Infrastructure et exploitation

**Statut :** Draft  
**Version :** 0.1

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
