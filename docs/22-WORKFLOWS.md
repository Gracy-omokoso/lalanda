# Workflows et machines d’état

**Statut :** Draft  
**Version :** 0.1

## Projet

`draft → active → archived → restored`  
Suppression : demande, délai de récupération, purge selon politique.

## Scénario

`draft → ready → calculating → calculated → approved`

Transitions d’erreur : `calculation_failed`, retour à `draft` après modification. Un scénario approuvé reste lisible; une évolution crée un dérivé.

## Plan

`approved → superseded`  
Un plan n’est ni modifié ni supprimé par une opération ordinaire.

## Période réalisée

`open → review → closed → reopened → closed`

La réouverture exige permission et motif. Les modifications après réouverture sont auditables.

## Country Pack

`draft → review → approved → active → retired`

Publication soumise aux tests, sources obligatoires et validation métier.

## Import

`uploaded → mapped → validated → processing → completed`

Branches : `rejected`, `failed`, `rolled_back`. Chaque étape est idempotente.

## Export

`requested → queued → rendering → validating → available → expired`

Branche `failed`. Un export disponible référence la version exacte du plan et une empreinte.

## Abonnement

`trialing → active → past_due → grace → suspended → canceled`

Les webhooks sont vérifiés et idempotents. Les capacités sont dérivées de l’état et du catalogue.

## Alerte et action

Alerte : `new → acknowledged → resolved → dismissed`.  
Action : `open → in_progress → done` ou `canceled`.

## Invitations

`pending → accepted`, `expired` ou `revoked`.

## Règles communes

- transition autorisée côté serveur;
- acteur et motif pour action sensible;
- événement d’audit;
- notification éventuelle;
- traitement répétable sans doublon;
- refus explicite d’une transition invalide.
